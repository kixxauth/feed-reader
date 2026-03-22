# Feed Reader
A simple RSS feed reader application built and deployed on Cloudflare Workers.

## Development
The local development environment uses Node.js and Cloudflare Wranger.

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

Example using custom port:

```bash
npx wrangler dev --port 8383
```

**Run the tests:**

```bash
npm test
```

Or use vitest directly:

```bash
npx vitest run
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

## Importing Feeds

The `scripts/import-feeds.js` script reads feed rows from an existing SQLite database and upserts them into D1. It is idempotent: re-running with the same source file updates existing feeds and adds new ones without creating duplicates.

**Import to local dev environment:**

```bash
npm run import-feeds -- --env local path/to/source.sqlite
```

**Import to production:**

```bash
npm run import-feeds -- --env remote path/to/source.sqlite
```

If the source database has multiple tables, the script auto-detects the feeds table by looking for a table with columns `id`, `hostname`, `title`, `xml_url`, `html_url`. Use `--table <name>` to override:

```bash
npm run import-feeds -- --env local --table my_feeds path/to/source.sqlite
```

The source table must have these columns: `id`, `hostname`, `type`, `title`, `xml_url`, `html_url`, `no_crawl`, `description`, `last_build_date`, `score`.

## Testing
This application uses the Vitest test framework. You can find the API for writing tests at: https://vitest.dev/api/test.html

This application is built on Cloudflare Workers which has a specialized integration with Vitest you can learn more about here: https://developers.cloudflare.com/workers/testing/vitest-integration/

