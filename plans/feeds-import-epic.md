# TODO: Feed Import Epic Implementation Plan

## Implementation Approach

This epic adds RSS feed management to the Feed Reader. The strategy involves:
(1) Creating a D1 SQLite database with a `feeds` table to persist imported feed metadata;
(2) Building an admin CLI script (`scripts/import-feeds.js`) that reads from a source SQLite file and performs upsert operations to prevent duplicates;
(3) Updating the `GET /` route to display the authenticated user's feeds sorted by hostname, with empty-state messaging;
(4) Adding a database query module (`src/db.js`) that provides the query helpers needed by the Worker.

The import is idempotent: running it multiple times will update existing feeds (matched by `id`) and add new ones without duplication. All feed data is owned by the single authenticated user and is displayed immediately after import without cache clearing.

---

## TODO Items

- [x] **Create D1 database and add binding to wrangler.jsonc**
  - **Story**: Story 1 — Import Feeds from SQLite
  - **What**: Create a D1 database using `wrangler d1 create feed-reader-db`, then add the resulting database ID as a D1 binding in `wrangler.jsonc` so the Worker can execute SQL queries
  - **Where**: `wrangler.jsonc` (add `d1_databases` array)
  - **Acceptance criteria**: `wrangler d1 create` has been run; `d1_databases` binding with name `DB` is in `wrangler.jsonc`; `npx wrangler dev` starts without binding errors
  - **Depends on**: none

- [x] **Create feeds table schema in D1**
  - **Story**: Story 1 — Import Feeds from SQLite
  - **What**: Write a SQL migration file (`migrations/0001_create_feeds_table.sql`) and apply it using `wrangler d1 migrations apply`. The feeds table should have all columns from the schema below. Add an index on `hostname` for sort performance
  - **Where**: `migrations/0001_create_feeds_table.sql` (new file), applied via `wrangler d1 migrations apply`
  - **Acceptance criteria**: Feeds table exists with all columns per the schema section below; `id` is primary key; `hostname` index exists; migration is repeatable (uses `CREATE TABLE IF NOT EXISTS`)
  - **Depends on**: Create D1 database and add binding to wrangler.jsonc

- [x] **Create database query module**
  - **Story**: Story 1 & 2 — Import Feeds / Re-import Without Duplicates
  - **What**: Build `src/db.js` with two functions: `getAllFeedsSortedByHostname(db)` and `upsertFeed(db, feedData)`. Each takes the D1 database binding as the first argument. `upsertFeed` uses `INSERT ... ON CONFLICT(id) DO UPDATE` to handle duplicates. `getAllFeedsSortedByHostname` returns all rows ordered by `hostname ASC`
  - **Where**: `src/db.js` (new file)
  - **Acceptance criteria**: Both functions work with the D1 binding; upsert handles duplicate `id` gracefully by updating all fields; `getAllFeedsSortedByHostname` returns results sorted by hostname
  - **Depends on**: Create feeds table schema in D1

- [x] **Create feed import CLI script**
  - **Story**: Story 1 & 2 — Import Feeds / Re-import Without Duplicates
  - **What**: Build `scripts/import-feeds.js` that reads a source SQLite database file (path provided as CLI argument), extracts all feed rows, and upserts them into D1. For local development, the script generates SQL and pipes it through `wrangler d1 execute --local`. For production, it uses `wrangler d1 execute --remote`. The script accepts `--env local` or `--env remote` to select the target. It reports inserted/updated counts when done
  - **Where**: `scripts/import-feeds.js` (new file)
  - **How**: Use `better-sqlite3` (add as devDependency) to read the source file. Generate `INSERT ... ON CONFLICT` SQL statements matching the upsert logic. Execute via `child_process.execSync` calling `wrangler d1 execute DB --local` or `--remote` with `--command` flag
  - **Source SQLite schema**: The source file is expected to have a table with columns: `id`, `hostname`, `type`, `title`, `xml_url`, `html_url`, `no_crawl`, `description`, `last_build_date`, `score`. The table name will be determined at implementation time (query `sqlite_master` to find it, or accept a `--table` flag)
  - **Acceptance criteria**: Script reads source SQLite; accepts `--env local` or `--env remote`; uses wrangler CLI to execute upserts; logs results (e.g., "Imported 10 feeds: 8 inserted, 2 updated")
  - **Deviation**: Insert vs. update counts are not reported separately. The `wrangler d1 execute --command` path does not return row-level metadata, and `INSERT ... ON CONFLICT DO UPDATE` has no `RETURNING` clause surfaced through the CLI. The script reports total successfully executed upserts instead (e.g., "Imported 10 of 10 feed(s) successfully"). Separate counts would require using the Cloudflare REST API directly or running a pre-import `SELECT` to compare.
  - **Depends on**: Create feeds table schema in D1

- [x] **Update home page to display feed list**
  - **Story**: Story 3 & 4 — View Feed List / Feed List Reflects Latest Import
  - **What**: Modify the `GET /` route handler in `src/index.js` to query all feeds via `getAllFeedsSortedByHostname(c.env.DB)` and render them in the page. Replace the existing "Hello World" content. Each feed entry shows its title (HTML-escaped), hostname, and a link to `html_url`. Show an empty-state message ("No feeds imported yet") when the query returns zero rows. All output must be HTML-escaped to prevent XSS from feed data
  - **Where**: `src/index.js` (modify `GET /` route handler)
  - **Acceptance criteria**: Home page renders all feeds sorted by hostname; each feed shows title, hostname, and link; empty state message displays if no feeds; feed data is HTML-escaped; no manual refresh needed to reflect latest import
  - **Depends on**: Create database query module

- [x] **Update tests for feed list page**
  - **Story**: Story 3 & 4 — View Feed List / Feed List Reflects Latest Import
  - **What**: Update `test/index.spec.js` to reflect the new home page content. The existing "Hello World!" assertion in the authenticated access test must be replaced. Add test cases: (1) authenticated `GET /` with no feeds shows empty state message; (2) authenticated `GET /` with seeded feeds shows feed titles and hostnames sorted by hostname. Seed test data by executing SQL inserts against the test D1 binding available via `env.DB`
  - **Where**: `test/index.spec.js` (modify existing tests, add new ones)
  - **Note**: The `@cloudflare/vitest-pool-workers` test pool automatically provisions a local D1 instance from the `d1_databases` binding in `wrangler.jsonc`. Use `env.DB.exec()` or `env.DB.prepare().run()` to seed test data
  - **Acceptance criteria**: Existing tests updated (no "Hello World!" assertion); empty state test passes; seeded feed list test passes; all existing tests still pass
  - **Depends on**: Update home page to display feed list

- [x] **Add npm script for importing feeds**
  - **Story**: Story 1 — Import Feeds from SQLite
  - **What**: Add an npm script entry in `package.json`: `"import-feeds": "node scripts/import-feeds.js"`
  - **Where**: `package.json` (`scripts` object)
  - **Acceptance criteria**: `npm run import-feeds -- --env local path/to/source.sqlite` works
  - **Depends on**: Create feed import CLI script

- [x] **Validate implementation end-to-end**
  - **Story**: All stories
  - **What**: Run through the complete workflow manually: create or obtain a source SQLite file with sample feeds, run import against local D1, start dev server, verify feeds appear on home page, run import again with modified data, verify updates appear without duplicates, run `npm test` and confirm all tests pass
  - **Where**: Manual testing (local dev environment)
  - **Acceptance criteria**: Import works against local D1; feeds display on home page; re-import updates without duplicates; all automated tests pass
  - **Depends on**: All other tasks

---

## Notes on Architecture

### Database Schema

The `feeds` table stores all imported feed metadata:

```sql
CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  type TEXT,
  title TEXT NOT NULL,
  xml_url TEXT,
  html_url TEXT,
  no_crawl INTEGER DEFAULT 0,
  description TEXT,
  last_build_date TEXT,
  score REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feeds_hostname ON feeds(hostname);
```

12 columns total: 10 from the source data plus `created_at` and `updated_at` auto-managed timestamps.

### Import Logic (Upsert)

The import script performs an upsert for each feed using:

```sql
INSERT INTO feeds (id, hostname, type, title, xml_url, html_url, no_crawl, description, last_build_date, score)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  hostname = excluded.hostname,
  type = excluded.type,
  title = excluded.title,
  xml_url = excluded.xml_url,
  html_url = excluded.html_url,
  no_crawl = excluded.no_crawl,
  description = excluded.description,
  last_build_date = excluded.last_build_date,
  score = excluded.score,
  updated_at = CURRENT_TIMESTAMP;
```

- If a feed with matching `id` exists, update all fields
- If the feed does not exist, insert it as a new row
- Feeds in the database but not in the source file are left unchanged (no deletion)

### Import Script Mechanism

The import script uses the `wrangler d1 execute` CLI command rather than the Cloudflare REST API directly. This avoids needing to manage API tokens, account IDs, and database IDs in the script — wrangler handles auth and routing.

- `--env local` → `wrangler d1 execute DB --local --command "..."`
- `--env remote` → `wrangler d1 execute DB --remote --command "..."`

The source SQLite file is read using `better-sqlite3` (devDependency) to extract feed rows.

### HTML Escaping

Feed data (titles, descriptions, URLs) comes from external RSS sources and must be HTML-escaped before rendering to prevent XSS. Use a simple escape function for `&`, `<`, `>`, `"`, `'` characters when interpolating into HTML templates.

### Single-User Model

All feed data is implicitly owned by the single authenticated user. The app does not store per-user feed subscriptions or per-user state beyond authentication. All imported feeds are visible to anyone logged in.

### Out of Scope

- Per-user feed subscriptions or multi-tenant data isolation
- Feed content fetching/crawling (only metadata is stored)
- Deletion of feeds not present in the source file
- Admin UI for adding/editing/removing individual feeds
- Pagination of the feed list
