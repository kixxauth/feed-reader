#!/usr/bin/env node
/**
 * recover-failed-feeds.js
 *
 * For each feed that failed in the most recent crawl run, attempts to
 * re-discover a working feed URL by scraping the feed's html_url. If a new
 * (different) xml_url is found and can be parsed, the feed's xml_url is
 * updated in the database, and the feed is re-enabled if it was previously
 * auto-disabled. Articles are NOT inserted by this script — the next scheduled
 * crawl will pick them up.
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
import {
	canonicalizeHttpUrl,
	deriveHostname,
	normalizeUrlForComparison,
} from '../src/feed-utils.js';

/**
 * Wrangler failures often contain useful JSON in stdout; Node's default error
 * formatting truncates buffers. This prints the full stdout/stderr payloads.
 *
 * @param {unknown} err
 * @param {{ command: string }} context
 */
function logExecSyncFailure(err, { command }) {
	// eslint-disable-next-line no-console
	console.error('\n[wrangler] Command failed:', command);

	/** @type {any} */
	const e = err;
	// eslint-disable-next-line no-console
	console.error('[wrangler] status:', e?.status ?? null, 'signal:', e?.signal ?? null);

	const stdoutBuf = e?.stdout ?? (Array.isArray(e?.output) ? e.output[1] : null);
	const stderrBuf = e?.stderr ?? (Array.isArray(e?.output) ? e.output[2] : null);

	if (stdoutBuf) {
		// eslint-disable-next-line no-console
		console.error('\n[wrangler] stdout:\n' + Buffer.from(stdoutBuf).toString('utf8'));
	}
	if (stderrBuf) {
		// eslint-disable-next-line no-console
		console.error('\n[wrangler] stderr:\n' + Buffer.from(stderrBuf).toString('utf8'));
	}

	// If stdout looks like JSON, print a parsed view too.
	try {
		const stdoutText = stdoutBuf ? Buffer.from(stdoutBuf).toString('utf8').trim() : '';
		if (stdoutText.startsWith('{') || stdoutText.startsWith('[')) {
			// eslint-disable-next-line no-console
			console.error('\n[wrangler] stdout (parsed JSON):\n' + JSON.stringify(JSON.parse(stdoutText), null, 2));
		}
	} catch {
		// ignore parse failures
	}

	// Re-throw so the script still exits non-zero.
	throw err;
}

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
	const command = `npx wrangler d1 execute DB ${locationFlag} --json --command "${escaped}"`;
	let output;
	try {
		output = execSync(command, { stdio: ['pipe', 'pipe', 'pipe'] });
	} catch (err) {
		logExecSyncFailure(err, { command });
	}
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
	const command = `npx wrangler d1 execute DB ${locationFlag} --command "${escaped}"`;
	try {
		execSync(command, { stdio: 'pipe' });
	} catch (err) {
		logExecSyncFailure(err, { command });
	}
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

		// Avoid "recovering" feeds to archived sources (e.g. Wayback Machine).
		try {
			const host = new URL(newXmlUrl).hostname.toLowerCase();
			if (host === 'web.archive.org') {
				console.log('    Skipping: discovered URL is an archived web.archive.org feed.\n');
				skippedCount++;
				continue;
			}
		} catch {
			// If it's not a valid URL, later normalization/fetch will fail and be handled.
		}

		if (oldNormalized && newNormalized && oldNormalized === newNormalized) {
			console.log('    Same URL as current xml_url. No update needed. Skipping.\n');
			skippedCount++;
			continue;
		}

		// 4a. Ensure the new XML URL doesn't collide with the normalized-unique index.
		if (newNormalized) {
			const collisionRows = d1Query(`
				SELECT id, title, xml_url
				FROM feeds
				WHERE xml_url IS NOT NULL
				  AND LOWER(TRIM(xml_url)) = ${escapeSqlString(newNormalized)}
				  AND id != ${escapeSqlString(feedId)}
				LIMIT 1
			`);
			if (collisionRows.length > 0) {
				const collision = collisionRows[0];
				console.log(
					`    Skipping: discovered URL conflicts with existing feed (${collision.title ?? collision.id}).\n`
				);
				skippedCount++;
				continue;
			}
		}

		// 4b. Fetch and parse the new feed URL to verify it works.
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
		const shouldReEnable = row.status === 'auto_disabled';

		if (dryRun) {
			console.log(`    [dry-run] Would update xml_url to: ${newXmlUrl}`);
			console.log(`    [dry-run] Would update hostname to: ${newHostname}`);
			console.log(`    [dry-run] Would not insert articles (next scheduled crawl will pick them up).`);
			if (shouldReEnable) {
				console.log('    [dry-run] Would re-enable feed (no_crawl → 0).');
			}
			console.log();
			recoveredCount++;
			continue;
		}

		// Update xml_url, hostname, title, html_url, and re-enable if needed.
		try {
			const noCrawlValue = shouldReEnable ? 0 : (row.no_crawl ?? 0);
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

		console.log(`    Skipping article inserts (next scheduled crawl will pick them up).`);
		if (shouldReEnable) {
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
