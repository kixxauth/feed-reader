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

## Importing Articles

The `scripts/import-articles.js` script reads article rows from an existing SQLite database and upserts them into D1. It is idempotent: re-running with the same source file updates existing articles and adds new ones without creating duplicates.

**Import to local dev environment:**

```bash
npm run import-articles -- --env local path/to/source.sqlite
```

**Import to production:**

```bash
npm run import-articles -- --env remote path/to/source.sqlite
```

If the source database has multiple tables, the script auto-detects the articles table by looking for a table with columns `id`, `feed_id`, `link`, `title`, `published`. Use `--table <name>` to override:

```bash
npm run import-articles -- --env local --table my_articles path/to/source.sqlite
```

The source table must have these columns: `id`, `feed_id`, `link`, `title`, `published`, `updated`, `added`.

**Important:** The `published` column must be stored as ISO 8601 text (e.g., `2026-03-23` or `2026-03-23T12:00:00Z`). Date filtering and display depend on this format. If the source stores dates differently (e.g., Unix timestamps), filtering will produce incorrect results.

## Browsing Articles

Once articles are imported, authenticated users can browse them at `/feeds/:feedId/articles`. The page shows articles for a single feed sorted newest-first, with:

- Pagination (20 per page)
- Optional date range filtering (`?from=YYYY-MM-DD&to=YYYY-MM-DD`)
- Clickable article titles that open the original URL in a new tab

The Feeds page (`/feeds`) includes an "Articles" link for each feed.

## Testing
This application uses the Vitest test framework. You can find the API for writing tests at: https://vitest.dev/api/test.html

This application is built on Cloudflare Workers which has a specialized integration with Vitest you can learn more about here: https://developers.cloudflare.com/workers/testing/vitest-integration/

