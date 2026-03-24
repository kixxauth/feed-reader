#!/usr/bin/env node
/**
 * recover-failed-feeds.js
 *
 * For each feed that failed in the most recent crawl run, attempts to
 * re-discover a working feed URL by scraping the feed's html_url. If a new
 * (different) xml_url is found and can be parsed, the feed's xml_url is
 * updated in the database, new articles are inserted, and the feed is
 * re-enabled if it was previously auto-disabled.
 *
 * Usage:
 *   node scripts/recover-failed-feeds.js --env local
 *   node scripts/recover-failed-feeds.js --env remote
 *
 * Optional flags:
 *   --dry-run   Discover and parse but do not write any changes to the DB
 */

import { execSync } from 'node:child_process';
import { discoverFeedTargets } from '../src/feed-discovery.js';
import { parseFeedPreview, parseFeedXml } from '../src/parser.js';
import { canonicalizeHttpUrl, deriveHostname, normalizeUrlForComparison } from '../src/feed-utils.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function hasFlag(flag) {
	return args.includes(flag);
}

function getFlag(flag) {
	const idx = args.indexOf(flag);
	if (idx === -1) return null;
	return args[idx + 1] ?? null;
}

const envFlag = getFlag('--env');
const dryRun = hasFlag('--dry-run');

if (!envFlag || !['local', 'remote'].includes(envFlag)) {
	console.error('Error: --env must be "local" or "remote"');
	process.exit(1);
}

const locationFlag = envFlag === 'local' ? '--local' : '--remote';

if (dryRun) {
	console.log('[dry-run] No database changes will be made.\n');
}

// ---------------------------------------------------------------------------
// Wrangler D1 helpers
// ---------------------------------------------------------------------------

/**
 * Execute a SQL query via wrangler and return the result rows.
 *
 * @param {string} sql
 * @returns {Array<object>}
 */
function d1Query(sql) {
	const escaped = sql.replace(/"/g, '\\"');
	const output = execSync(
		`npx wrangler d1 execute DB ${locationFlag} --json --command "${escaped}"`,
		{ stdio: ['pipe', 'pipe', 'pipe'] }
	);
	const parsed = JSON.parse(output.toString('utf8'));
	// wrangler returns an array of result sets; we always issue a single statement
	return parsed[0]?.results ?? [];
}

/**
 * Execute a SQL statement via wrangler (no result needed).
 *
 * @param {string} sql
 */
function d1Execute(sql) {
	const escaped = sql.replace(/"/g, '\\"');
	execSync(`npx wrangler d1 execute DB ${locationFlag} --command "${escaped}"`, {
		stdio: 'pipe',
	});
}

// ---------------------------------------------------------------------------
// SQL string helpers
// ---------------------------------------------------------------------------

function escapeSqlString(value) {
	if (value === null || value === undefined) {
		return 'NULL';
	}
	return `'${String(value).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const USER_AGENT = 'FeedReader/1.0';
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch a URL and return the response body text.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchText(url) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { 'User-Agent': USER_AGENT },
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		return await response.text();
	} catch (err) {
		if (err.name === 'AbortError') {
			throw new Error('Request timeout (30s)');
		}
		throw err;
	} finally {
		clearTimeout(timeoutId);
	}
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------

async function main() {
	// 1. Find the most recent crawl run.
	const runRows = d1Query('SELECT id FROM crawl_runs ORDER BY started_at DESC LIMIT 1');
	if (runRows.length === 0) {
		console.log('No crawl runs found. Nothing to do.');
		return;
	}
	const crawlRunId = runRows[0].id;
	console.log(`Most recent crawl run: ${crawlRunId}\n`);

	// 2. Fetch all failed/auto_disabled details for that run, joined with feed data.
	const detailRows = d1Query(`
		SELECT
			d.feed_id,
			d.status,
			d.error_message,
			f.title,
			f.xml_url,
			f.html_url,
			f.no_crawl,
			f.consecutive_failure_count
		FROM crawl_run_details d
		JOIN feeds f ON d.feed_id = f.id
		WHERE d.crawl_run_id = '${crawlRunId.replace(/'/g, "''")}'
		  AND d.status IN ('failed', 'auto_disabled')
	`);

	if (detailRows.length === 0) {
		console.log('No failed feeds in the most recent crawl run. Nothing to do.');
		return;
	}

	console.log(`Found ${detailRows.length} failed feed(s) to examine.\n`);

	let recoveredCount = 0;
	let skippedCount = 0;
	let failedCount = 0;

	for (const row of detailRows) {
		const feedId = row.feed_id;
		const feedTitle = row.title ?? feedId;
		console.log(`--- Feed: ${feedTitle} (${feedId})`);
		console.log(`    Status: ${row.status} — ${row.error_message ?? 'no message'}`);

		if (!row.html_url) {
			console.log('    Skipping: no html_url to discover from.\n');
			skippedCount++;
			continue;
		}

		// 3. Attempt feed re-discovery from the website.
		let discoveryResult;
		try {
			discoveryResult = await discoverFeedTargets(row.html_url);
		} catch (err) {
			console.log(`    Discovery failed: ${err.message}\n`);
			skippedCount++;
			continue;
		}

		if (discoveryResult.kind === 'none') {
			console.log('    No feeds found at the website. Skipping.\n');
			skippedCount++;
			continue;
		}

		// Pick the best candidate. For 'direct' and 'single', there is one.
		// For 'multiple', prefer the first one (they are ordered by discovery).
		const candidate =
			discoveryResult.kind === 'multiple'
				? discoveryResult.candidates[0]
				: discoveryResult.candidate;

		const newXmlUrl = canonicalizeHttpUrl(candidate.xmlUrl) ?? candidate.xmlUrl;
		const oldNormalized = normalizeUrlForComparison(row.xml_url);
		const newNormalized = normalizeUrlForComparison(newXmlUrl);

		console.log(`    Discovered feed URL: ${newXmlUrl}`);

		if (oldNormalized && newNormalized && oldNormalized === newNormalized) {
			console.log('    Same URL as current xml_url. No update needed. Skipping.\n');
			skippedCount++;
			continue;
		}

		// 4. Fetch and parse the new feed URL to verify it works.
		let xmlText;
		try {
			xmlText = await fetchText(newXmlUrl);
		} catch (err) {
			console.log(`    Could not fetch new feed URL: ${err.message}. Skipping.\n`);
			skippedCount++;
			continue;
		}

		let preview;
		let articles;
		try {
			preview = parseFeedPreview(xmlText);
			if (!preview) {
				console.log('    New feed URL returned unparseable content. Skipping.\n');
				skippedCount++;
				continue;
			}
			articles = parseFeedXml(xmlText, feedId);
		} catch (err) {
			console.log(`    Failed to parse new feed: ${err.message}. Skipping.\n`);
			skippedCount++;
			continue;
		}

		console.log(`    Parsed OK — ${articles.length} article(s) found.`);

		// 5. Write changes to the database.
		const newHostname = deriveHostname(newXmlUrl, row.html_url);
		const newTitle = preview.title ?? row.title;
		const newHtmlUrl = preview.htmlUrl ? (canonicalizeHttpUrl(preview.htmlUrl) ?? preview.htmlUrl) : row.html_url;

		if (dryRun) {
			console.log(`    [dry-run] Would update xml_url to: ${newXmlUrl}`);
			console.log(`    [dry-run] Would update hostname to: ${newHostname}`);
			console.log(`    [dry-run] Would insert up to ${articles.length} article(s).`);
			if (row.no_crawl) {
				console.log('    [dry-run] Would re-enable feed (no_crawl → 0).');
			}
			console.log();
			recoveredCount++;
			continue;
		}

		// Update xml_url, hostname, title, html_url, and re-enable if needed.
		try {
			const noCrawlValue = 0;
			const updateSql = [
				`UPDATE feeds SET`,
				`  xml_url = ${escapeSqlString(newXmlUrl)},`,
				`  hostname = ${escapeSqlString(newHostname)},`,
				`  title = ${escapeSqlString(newTitle)},`,
				`  html_url = ${escapeSqlString(newHtmlUrl)},`,
				`  no_crawl = ${noCrawlValue},`,
				`  consecutive_failure_count = 0,`,
				`  updated_at = CURRENT_TIMESTAMP`,
				`WHERE id = ${escapeSqlString(feedId)}`,
			].join(' ');

			d1Execute(updateSql);
			console.log(`    Updated feed record.`);
		} catch (err) {
			console.error(`    Failed to update feed record: ${err.message}. Skipping.\n`);
			failedCount++;
			continue;
		}

		// Insert articles.
		const addedAt = new Date().toISOString();
		let articlesInserted = 0;

		for (const article of articles) {
			if (!article.id) {
				continue;
			}

			try {
				const insertSql = [
					`INSERT INTO articles (id, feed_id, link, title, published, updated, added)`,
					`VALUES (`,
					`  ${escapeSqlString(article.id)},`,
					`  ${escapeSqlString(feedId)},`,
					`  ${escapeSqlString(article.link)},`,
					`  ${escapeSqlString(article.title)},`,
					`  ${escapeSqlString(article.published)},`,
					`  ${escapeSqlString(article.updated)},`,
					`  ${escapeSqlString(addedAt)}`,
					`)`,
					`ON CONFLICT(id) DO NOTHING`,
				].join(' ');

				d1Execute(insertSql);
				articlesInserted++;
			} catch (err) {
				// Non-fatal: log and continue to next article.
				console.error(`    Warning: failed to insert article ${article.id}: ${err.message}`);
			}
		}

		console.log(`    Inserted ${articlesInserted} article(s).`);
		if (row.no_crawl) {
			console.log('    Feed re-enabled (was auto-disabled).');
		}
		console.log();
		recoveredCount++;
	}

	// Summary
	console.log('---');
	console.log(`Done. Recovered: ${recoveredCount}, Skipped: ${skippedCount}, Errors: ${failedCount}`);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
