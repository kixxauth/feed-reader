#!/usr/bin/env node
/**
 * Syncs the local D1 "feeds" table to the remote D1 "feeds" table.
 * - Bulk fetches all remote IDs in one query
 * - Inserts records that don't exist remotely (by id)
 * - Updates records that already exist remotely (by id)
 * - Executes each batch via a SQL file (multiple statements per wrangler call)
 *
 * Usage:
 *   node scripts/sync-feeds-to-remote.js [--dry-run] [--batch-size=N]
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const DB_NAME = 'feed-reader-db';
const TABLE = 'feeds';
const ID_COL = 'id';
const LOCAL_DB_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

const COLUMNS = [
  'id', 'hostname', 'type', 'title', 'xml_url', 'html_url',
  'no_crawl', 'description', 'last_build_date', 'score',
  'created_at', 'updated_at', 'consecutive_failure_count',
];

const DEFAULT_BATCH_SIZE = 100;
const DELAY_MS = 500;

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const batchArg = args.find(a => a.startsWith('--batch-size='));
  const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : DEFAULT_BATCH_SIZE;
  return { dryRun, batchSize };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeVal(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function runRemoteCommand(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  return execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --json --command="${escaped}"`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

function runRemoteFile(filePath) {
  return execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --file="${filePath}"`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

function fetchRemoteIds() {
  console.log('Fetching all remote IDs...');
  const out = runRemoteCommand(`SELECT ${ID_COL} FROM ${TABLE}`);
  // wrangler --json returns: [{ results: [{id: "..."}], success: true, ... }]
  const parsed = JSON.parse(out);
  const results = parsed[0]?.results ?? [];
  const ids = new Set(results.map(r => r[ID_COL]));
  console.log(`  Found ${ids.size} existing remote records.\n`);
  return ids;
}

const SKIP_COLUMNS = new Set(['no_crawl', 'consecutive_failure_count']);

function buildInsert(record) {
  const cols = COLUMNS.filter(c => c in record && !SKIP_COLUMNS.has(c));
  const vals = cols.map(c => escapeVal(record[c]));
  return `INSERT INTO ${TABLE} (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
}

function buildUpdate(record) {
  const setCols = COLUMNS.filter(c => c in record && c !== ID_COL && !SKIP_COLUMNS.has(c));
  const sets = setCols.map(c => `${c} = ${escapeVal(record[c])}`).join(', ');
  return `UPDATE ${TABLE} SET ${sets} WHERE ${ID_COL} = ${escapeVal(record[ID_COL])};`;
}

async function main() {
  const { dryRun, batchSize } = parseArgs();

  // Locate local DB
  const dbFiles = fs.readdirSync(LOCAL_DB_DIR).filter(f => f.endsWith('.sqlite'));
  if (dbFiles.length === 0) {
    console.error(`No .sqlite file found in ${LOCAL_DB_DIR}`);
    process.exit(1);
  }
  const dbPath = path.join(LOCAL_DB_DIR, dbFiles[0]);

  const localDb = new Database(dbPath, { readonly: true });
  const records = localDb.prepare(`SELECT * FROM ${TABLE}`).all();
  localDb.close();

  const total = records.length;
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Found ${total} local records.\n`);

  // Bulk fetch remote IDs (one query)
  let remoteIds = new Set();
  if (!dryRun) {
    remoteIds = fetchRemoteIds();
  }

  // Partition into inserts and updates
  const toInsert = records.filter(r => !remoteIds.has(r[ID_COL]));
  const toUpdate = records.filter(r => remoteIds.has(r[ID_COL]));
  console.log(`  To insert: ${toInsert.length}`);
  console.log(`  To update: ${toUpdate.length}\n`);

  const tmpDir = os.tmpdir();
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  async function runBatches(label, rows, buildSql) {
    const totalBatches = Math.ceil(rows.length / batchSize);
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      process.stdout.write(`${label} batch ${batchNum}/${totalBatches} (${batch.length} records)...`);

      const sql = batch.map(buildSql).join('\n');

      try {
        if (!dryRun) {
          const tmpFile = path.join(tmpDir, `sync-feeds-batch-${Date.now()}.sql`);
          fs.writeFileSync(tmpFile, sql);
          try {
            runRemoteFile(tmpFile);
          } finally {
            fs.unlinkSync(tmpFile);
          }
        }
        if (label === 'INSERT') inserted += batch.length;
        else updated += batch.length;
        console.log(' done.');
      } catch (err) {
        failed += batch.length;
        console.error(` ERROR: ${err.message}`);
      }

      if (i + batchSize < rows.length) {
        await sleep(DELAY_MS);
      }
    }
  }

  await runBatches('INSERT', toInsert, buildInsert);
  if (toInsert.length > 0 && toUpdate.length > 0) await sleep(DELAY_MS);
  await runBatches('UPDATE', toUpdate, buildUpdate);

  console.log(`\nSync complete.`);
  console.log(`  Inserted : ${inserted}`);
  console.log(`  Updated  : ${updated}`);
  console.log(`  Failed   : ${failed}`);
  console.log(`  Total    : ${total}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
