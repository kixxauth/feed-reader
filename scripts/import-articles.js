#!/usr/bin/env node
/**
 * import-articles.js
 *
 * Reads article rows from a source SQLite database and upserts them into the
 * D1 database via the wrangler CLI.
 *
 * Usage:
 *   node scripts/import-articles.js --env local <path/to/source.sqlite>
 *   node scripts/import-articles.js --env remote <path/to/source.sqlite>
 *
 * Optional flags:
 *   --table <table_name>   Name of the articles table in the source SQLite file.
 *                          If omitted the script auto-detects the first table
 *                          whose column set matches the expected schema.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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
	console.error('  node scripts/import-articles.js --env local path/to/source.sqlite');
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

// Auto-detect the articles table if --table was not provided
function detectArticlesTable(db, preferredTable) {
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
	const expectedColumns = new Set(['id', 'feed_id', 'link', 'title', 'published']);
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

const tableName = detectArticlesTable(sourceDb, tableFlag);
console.log(`Reading articles from table "${tableName}" in ${sourcePath}`);

// ---------------------------------------------------------------------------
// Read all article rows from source
// ---------------------------------------------------------------------------
const articleRows = sourceDb.prepare(`SELECT * FROM ${tableName}`).all();
console.log(`Found ${articleRows.length} article(s) in source database`);

if (articleRows.length === 0) {
	console.log('Nothing to import.');
	process.exit(0);
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

for (const row of articleRows) {
	const id = escapeSqlString(row.id);
	const feedId = escapeSqlString(row.feed_id);
	const link = escapeSqlString(row.link);
	const title = escapeSqlString(row.title);
	const published = escapeSqlString(row.published);
	const updated = escapeSqlString(row.updated);
	const added = escapeSqlString(row.added);

	const sql = [
		`INSERT INTO articles (id, feed_id, link, title, published, updated, added)`,
		`VALUES (${id}, ${feedId}, ${link}, ${title}, ${published}, ${updated}, ${added})`,
		`ON CONFLICT(id) DO UPDATE SET`,
		`  feed_id = excluded.feed_id,`,
		`  link = excluded.link,`,
		`  title = excluded.title,`,
		`  published = excluded.published,`,
		`  updated = excluded.updated,`,
		`  added = excluded.added`,
	].join(' ');

	try {
		execSync(`npx wrangler d1 execute DB ${locationFlag} --command "${sql.replace(/"/g, '\\"')}"`, {
			stdio: 'pipe',
		});
		insertedCount++;
	} catch (err) {
		console.error(`Failed to upsert article id=${row.id}: ${err.message}`);
		errorCount++;
	}
}

// We cannot easily distinguish inserts from updates via the wrangler CLI (no
// RETURNING clause support in this flow), so we report the total as "imported".
const total = insertedCount + errorCount;
console.log(
	`Imported ${insertedCount} of ${total} article(s) successfully` +
		(errorCount > 0 ? ` (${errorCount} error(s))` : '')
);
