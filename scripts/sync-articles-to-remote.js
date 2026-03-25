#!/usr/bin/env node
/**
 * Syncs the local D1 "articles" table to the remote D1 "articles" table.
 * - Uses INSERT … ON CONFLICT(id) DO UPDATE (upsert) so there is no need
 *   to pre-fetch remote IDs — avoids ENOBUFS on large tables.
 * - Executes each batch via a SQL file (multiple statements per wrangler call)
 *
 * Usage:
 *   node scripts/sync-articles-to-remote.js [--dry-run] [--batch-size=N]
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const DB_NAME = 'feed-reader-db';
const TABLE = 'articles';
const ID_COL = 'id';
const LOCAL_DB_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

const COLUMNS = [
  'id', 'feed_id', 'link', 'title',
  'published', 'updated', 'added', 'created_at',
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

function runRemoteFile(filePath) {
  return execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --file="${filePath}"`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

function buildUpsert(record) {
  const cols = COLUMNS.filter(c => c in record);
  const vals = cols.map(c => escapeVal(record[c]));
  const updateCols = cols.filter(c => c !== ID_COL);
  const sets = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
  return `INSERT INTO ${TABLE} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT(${ID_COL}) DO UPDATE SET ${sets};`;
}

async function main() {
  const { dryRun, batchSize } = parseArgs();

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

  const tmpDir = os.tmpdir();
  const totalBatches = Math.ceil(total / batchSize);
  let synced = 0;
  let failed = 0;

  for (let i = 0; i < total; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    process.stdout.write(`UPSERT batch ${batchNum}/${totalBatches} (${batch.length} records)...`);

    const sql = batch.map(buildUpsert).join('\n');

    try {
      if (!dryRun) {
        const tmpFile = path.join(tmpDir, `sync-articles-batch-${Date.now()}.sql`);
        fs.writeFileSync(tmpFile, sql);
        try {
          runRemoteFile(tmpFile);
        } finally {
          fs.unlinkSync(tmpFile);
        }
      }
      synced += batch.length;
      console.log(' done.');
    } catch (err) {
      failed += batch.length;
      console.error(` ERROR: ${err.message}`);
    }

    if (i + batchSize < total) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nSync complete.`);
  console.log(`  Synced : ${synced}`);
  console.log(`  Failed : ${failed}`);
  console.log(`  Total  : ${total}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
