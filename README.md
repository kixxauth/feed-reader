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

## Feed Crawling

Feeds are crawled automatically on configured to fetch new articles.

**Schedule**: The schedule is configurable via `triggers.crons` in `wrangler.jsonc`.

**Crawl history**: Authenticated users can view a history of crawl runs at `/crawl-history`.

**Local testing**: To trigger the scheduled crawl handler locally, start the dev server with scheduled event support and then call the scheduled endpoint:

```bash
npx wrangler dev --test-scheduled
```

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+2+*+*+*"
```

## Testing
This application uses the Vitest test framework. You can find the API for writing tests at: https://vitest.dev/api/test.html

This application is built on Cloudflare Workers which has a specialized integration with Vitest you can learn more about here: https://developers.cloudflare.com/workers/testing/vitest-integration/

