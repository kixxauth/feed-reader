# Feed Reader
An RSS feed reader application built and deployed on Cloudflare Workers.

## Development
The local development environment uses Node.js and Cloudflare Wrangler.

**Install dependencies:**

```bash
npm install
```

**Start the development server:**

```bash
npm start
```

Or use wrangler directly:

```bash
npx wrangler dev
```

If the default port is in use, you can try a different port with:

```bash
npx wrangler dev --port <port_number>
```

**Run the tests:**

```bash
npm test
```

Or use vitest directly:

```bash
npx vitest run
```

## Testing
This application uses the Vitest test framework. You can find the API for writing tests at: https://vitest.dev/api/test.html

This application is built on Cloudflare Workers which has a specialized integration with Vitest you can learn more about here: https://developers.cloudflare.com/workers/testing/vitest-integration/

## Deployment
Be sure to run migrations before deploying. See [Database](#database) below.

```bash
npx wrangler deploy
```

## Database

This app uses a Cloudflare D1 SQLite database (binding name `DB`) to store feed metadata.

Migrations live in `migrations/`. The `migrations_dir` field in `wrangler.jsonc` tells wrangler where to find them.

**Apply migrations**

```bash
npx wrangler d1 migrations apply feed-reader-db --local
npx wrangler d1 migrations apply feed-reader-db --remote
```

**Run a SQL command**

```bash
npx wrangler d1 execute feed-reader-db --local --command "SELECT * FROM feeds LIMIT 10"
npx wrangler d1 execute feed-reader-db --remote --command "SELECT * FROM feeds LIMIT 10"
```

**Run a SQL script file**

```bash
npx wrangler d1 execute feed-reader-db --local --file ./path/to/script.sql
npx wrangler d1 execute feed-reader-db --remote --file ./path/to/script.sql
```

## Feed Crawling

Feeds are crawled automatically to fetch new articles.

**Schedule**: The schedule is configurable via `triggers.crons` in `wrangler.jsonc`.

**Crawl history**: Authenticated users can view a history of crawl runs at `/crawl-history`.

**Immediate crawl on add**: When a user confirms a newly discovered feed, the Worker schedules a single-feed crawl in the background so the `/feeds` redirect returns immediately.

**Manually invoke a crawl**: You can manually invoke a crawl on the remote application by visiting the page at `/dispatch-crawl`.

**Local testing**: To trigger the scheduled crawl handler locally, start the dev server with scheduled event support and then call the scheduled endpoint:

```bash
npx wrangler dev --test-scheduled
```

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+2+*+*+*"
```

## Sync Feeds to Remote

`scripts/sync-feeds-to-remote.js` syncs the local D1 `feeds` table to the remote D1 `feeds` table. It bulk-fetches all existing remote IDs in one query, then inserts new records and updates existing ones in batches.

```bash
# Dry run — no remote changes
node scripts/sync-feeds-to-remote.js --dry-run

# Live sync (default batch size: 100)
node scripts/sync-feeds-to-remote.js

# Custom batch size
node scripts/sync-feeds-to-remote.js --batch-size=200
```

## Recover Failed Feeds

`scripts/recover-failed-feeds.js` examines feeds that failed in the most recent crawl run and attempts to find a new working feed URL by scraping each feed's website. If a new URL is found and parses successfully, the script updates `xml_url` in the database and re-enables the feed if it was auto-disabled.

For operational safety (especially on remote), this script does **not** insert articles. The next scheduled crawl run will pick up articles after the feed URL is corrected.

```bash
# Dry run — discover and report, no DB changes
node scripts/recover-failed-feeds.js --env local --dry-run

# Apply changes to local D1
node scripts/recover-failed-feeds.js --env local

# Apply changes to production D1
node scripts/recover-failed-feeds.js --env remote
```

## Template Hydration

The `scripts/hydrate-template.js` utility substitutes `{{variable}}` placeholders in template files with values from a YAML context file. This is useful for generating configuration files or documents from templates.

**Usage:**

```bash
node scripts/hydrate-template.js <template-file> <context-yaml-file>
```
