# Feed Reader
A simple RSS feed reader application built and deployed on Cloudflare Workers.

Users can add feeds from the UI at `/feeds/add`, or import feeds and articles through the CLI scripts.

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

**Apply migrations (local):**

```bash
npx wrangler d1 migrations apply feed-reader-db --local
```

**Apply migrations (production):**

```bash
npx wrangler d1 migrations apply feed-reader-db --remote
```

Migrations live in `migrations/`. The `migrations_dir` field in `wrangler.jsonc` tells wrangler where to find them.

The add-feed flow relies on the normalized `xml_url` uniqueness rule added by `migrations/0006_add_unique_index_on_feed_xml_url.sql`, so apply migrations before testing feed creation locally.

## Feed Crawling

Feeds are crawled automatically to fetch new articles.

**Schedule**: The schedule is configurable via `triggers.crons` in `wrangler.jsonc`.

**Crawl history**: Authenticated users can view a history of crawl runs at `/crawl-history`.

**Immediate crawl on add**: When a user confirms a newly discovered feed, the Worker schedules a single-feed crawl in the background so the `/feeds` redirect returns immediately.

## Add Feed Flow

The add-feed workflow is server-rendered and multi-step:

1. Submit a website URL or direct feed URL at `/feeds/add`
2. Discover one feed, many feeds, or no feeds from the submitted target
3. Confirm the feed details before inserting the new `feeds` row
4. Redirect back to `/feeds` while the first crawl runs asynchronously

For implementation details and tradeoffs, see `documentation/add-feed.md` and `MANUAL.md`.

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

`scripts/recover-failed-feeds.js` examines feeds that failed in the most recent crawl run and attempts to find a new working feed URL by scraping each feed's website. If a new URL is found and parses successfully, the script updates `xml_url` in the database, inserts new articles, and re-enables the feed if it was auto-disabled.

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
