#!/usr/bin/env node
/**
 * import-feeds.js
 *
 * Reads feed rows from a source SQLite database and upserts them into the
 * D1 database via the wrangler CLI.
 *
 * Usage:
 *   node scripts/import-feeds.js --env local <path/to/source.sqlite>
 *   node scripts/import-feeds.js --env remote <path/to/source.sqlite>
 *
 * Optional flags:
 *   --table <table_name>   Name of the feeds table in the source SQLite file.
 *                          If omitted the script auto-detects the first table
 *                          whose column set matches the expected schema.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { canonicalizeHttpUrl, normalizeUrlForComparison } from '../src/feed-utils.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getFlag(flag) {
	const idx = args.indexOf(flag);
	if (idx === -1) return null;
	return args[idx + 1] ?? null;
}

const envFlag = getFlag('--env');
const tableFlag = getFlag('--table');

if (!envFlag || !['local', 'remote'].includes(envFlag)) {
	console.error('Error: --env must be "local" or "remote"');
	process.exit(1);
}

// The source sqlite file is the last positional argument (non-flag value)
const positionalArgs = args.filter((a, i) => {
	if (a.startsWith('--')) return false;
	// skip values that immediately follow a flag
	if (i > 0 && args[i - 1].startsWith('--')) return false;
	return true;
});

const sourcePath = positionalArgs[0];

if (!sourcePath) {
	console.error('Error: supply the path to the source SQLite file as a positional argument');
	console.error('  node scripts/import-feeds.js --env local path/to/source.sqlite');
	process.exit(1);
}

if (!existsSync(sourcePath)) {
	console.error(`Error: source file not found: ${sourcePath}`);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Open source SQLite
// ---------------------------------------------------------------------------
const sourceDb = new Database(path.resolve(sourcePath), { readonly: true });

// Auto-detect the feeds table if --table was not provided
function detectFeedsTable(db, preferredTable) {
	if (preferredTable) {
		return preferredTable;
	}

	const tables = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
		.all()
		.map((r) => r.name);

	if (tables.length === 0) {
		throw new Error('Source SQLite database contains no tables');
	}

	if (tables.length === 1) {
		return tables[0];
	}

	// Try to find a table that has the expected columns
	const expectedColumns = new Set(['id', 'hostname', 'title', 'xml_url', 'html_url']);
	for (const table of tables) {
		const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
		const columnSet = new Set(columns);
		const hasAll = [...expectedColumns].every((c) => columnSet.has(c));
		if (hasAll) {
			return table;
		}
	}

	// Fall back to the first table and let an error surface naturally
	return tables[0];
}

const tableName = detectFeedsTable(sourceDb, tableFlag);
console.log(`Reading feeds from table "${tableName}" in ${sourcePath}`);

// ---------------------------------------------------------------------------
// Read all feed rows from source
// ---------------------------------------------------------------------------
const feedRows = sourceDb.prepare(`SELECT * FROM ${tableName}`).all();
console.log(`Found ${feedRows.length} feed(s) in source database`);

if (feedRows.length === 0) {
	console.log('Nothing to import.');
	process.exit(0);
}

const seenXmlUrls = new Map();
for (const row of feedRows) {
	const normalizedXmlUrl = normalizeUrlForComparison(row.xml_url);
	if (!normalizedXmlUrl) {
		continue;
	}

	const existingId = seenXmlUrls.get(normalizedXmlUrl);
	if (existingId) {
		console.error(
			`Error: duplicate xml_url detected in source data for feed ids ${existingId} and ${row.id}: ${row.xml_url}`
		);
		process.exit(1);
	}

	seenXmlUrls.set(normalizedXmlUrl, row.id);
}

// ---------------------------------------------------------------------------
// Escape single-quoted string values for safe SQL embedding
// ---------------------------------------------------------------------------
function escapeSqlString(value) {
	if (value === null || value === undefined) {
		return 'NULL';
	}
	// Escape single quotes by doubling them
	return `'${String(value).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Build and execute upsert SQL via wrangler
// ---------------------------------------------------------------------------
const locationFlag = envFlag === 'local' ? '--local' : '--remote';

let insertedCount = 0;
let errorCount = 0;

for (const row of feedRows) {
	const id = escapeSqlString(row.id);
	const hostname = escapeSqlString(row.hostname);
	const type = escapeSqlString(row.type);
	const title = escapeSqlString(row.title);
	const xmlUrl = escapeSqlString(canonicalizeHttpUrl(row.xml_url) ?? row.xml_url);
	const htmlUrl = escapeSqlString(canonicalizeHttpUrl(row.html_url) ?? row.html_url);
	const noCrawl = row.no_crawl !== null && row.no_crawl !== undefined ? Number(row.no_crawl) : 0;
	const description = escapeSqlString(row.description);
	const lastBuildDate = escapeSqlString(row.last_build_date);
	const score = row.score !== null && row.score !== undefined ? Number(row.score) : 'NULL';

	const sql = [
		`INSERT INTO feeds (id, hostname, type, title, xml_url, html_url, no_crawl, description, last_build_date, score)`,
		`VALUES (${id}, ${hostname}, ${type}, ${title}, ${xmlUrl}, ${htmlUrl}, ${noCrawl}, ${description}, ${lastBuildDate}, ${score})`,
		`ON CONFLICT(id) DO UPDATE SET`,
		`  hostname = excluded.hostname,`,
		`  type = excluded.type,`,
		`  title = excluded.title,`,
		`  xml_url = excluded.xml_url,`,
		`  html_url = excluded.html_url,`,
		`  no_crawl = excluded.no_crawl,`,
		`  description = excluded.description,`,
		`  last_build_date = excluded.last_build_date,`,
		`  score = excluded.score,`,
		`  updated_at = CURRENT_TIMESTAMP`,
	].join(' ');

	try {
		execSync(`npx wrangler d1 execute DB ${locationFlag} --command "${sql.replace(/"/g, '\\"')}"`, {
			stdio: 'pipe',
		});
		insertedCount++;
	} catch (err) {
		const message = String(err.message || err);
		if (message.includes('idx_feeds_xml_url_normalized_unique') || message.includes('UNIQUE constraint failed')) {
			console.error(`Failed to upsert feed id=${row.id}: duplicate xml_url after normalization (${row.xml_url})`);
		} else {
			console.error(`Failed to upsert feed id=${row.id}: ${message}`);
		}
		errorCount++;
	}
}

// We cannot easily distinguish inserts from updates via the wrangler CLI (no
// RETURNING clause support in this flow), so we report the total as "imported".
const total = insertedCount + errorCount;
console.log(
	`Imported ${insertedCount} of ${total} feed(s) successfully` +
		(errorCount > 0 ? ` (${errorCount} error(s))` : '')
);
