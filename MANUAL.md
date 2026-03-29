# Feed Reader Manual

This document is the current reference for the Feed Reader system: what it is, how to use it, and how it works.

## 1. What This System Is

Feed Reader is a server-rendered RSS/Atom reader built on Cloudflare Workers. Authenticated users share one common pool of feeds, articles, and crawl history. There is no per-user subscription state, read tracking, or personalization.

Core capabilities:

- Authenticate with GitHub OAuth.
- Browse feeds and feed details.
- Add a new feed from a website URL or direct feed URL.
- Read articles by feed or by day in the cross-feed reader.
- Review crawl history.
- Manually dispatch a crawl of all enabled feeds.

## 2. Everyday Use

### Main pages

- `/` - home page for authenticated users
- `/reader` - daily cross-feed reading view
- `/feeds` - feed list with filtering, search, and feed management
- `/feeds/add` - add-feed flow
- `/crawl-history` - crawl runs and per-feed results
- `/dispatch-crawl` - manual crawl dispatch page

### Navigation

Authenticated pages use a sidebar layout from `src/layout.js`.

Sidebar links:

- `Home`
- `Reader`
- `Feeds`
- `History`
- `Sign out`

`/dispatch-crawl` exists but is not linked from the sidebar.

### Feeds list

`/feeds` is the main management page.

Behavior:

- Pagination is `?page=N`, 1-indexed, 50 feeds per page.
- Feeds are sorted by `hostname ASC`.
- `?disabled=1` shows only disabled feeds.
- `?title=` filters by partial title match.
- `?domain=` filters by partial hostname match.
- Pagination preserves active filters and search terms.
- Empty states differ for:
  - no feeds at all
  - disabled-only view with no matches
  - title/domain search with no matches

Per-feed actions:

- Open the feed detail page
- Enable or disable crawling

After a feed is added, `/feeds` may show one of three banners:

- feed added and initial crawl still in progress
- feed added and initial crawl succeeded
- feed added and initial crawl failed

### Feed detail

`/feeds/:feedId` shows:

- feed metadata
- crawl status
- consecutive failure count
- featured status
- recent crawl activity
- actions to toggle crawling and featured status

The page preserves `listPage` and `disabled` context for its back link and form redirects. It does not preserve the title/domain search filters.

### Articles page

`/feeds/:feedId/articles` shows articles for one feed.

Behavior:

- Pagination is `?page=N`, 20 articles per page.
- Sorted by `published DESC`, with null dates last.
- Optional inclusive date filtering with `?from=YYYY-MM-DD` and `?to=YYYY-MM-DD`.
- Relative article links are resolved against `html_url` first, then `xml_url`.

### Reader page

`/reader?date=YYYY-MM-DD` shows all articles across enabled feeds for one UTC day.

Behavior:

- Defaults to today in UTC if `date` is missing or invalid.
- Uses the article's effective date: `published`, or `added` if `published` is null.
- Excludes disabled feeds.
- Splits featured feeds into a separate section when present.
- Groups articles by feed.
- Has previous/next day navigation and a date picker.
- Has no pagination.

### Manual crawl dispatch

`/dispatch-crawl` renders a simple admin page with a button that dispatches a crawl for all enabled feeds.

Submitting the form calls `POST /api/dispatch-crawl`, which:

- creates a new `crawl_runs` row unless there are no enabled feeds
- enqueues one crawl job per enabled feed
- renders the result summary inline:
  - `crawlRunId`
  - `totalFeeds`
  - `batchCount`

## 3. Architecture

### Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| HTTP framework | Hono |
| Database | Cloudflare D1 (SQLite) |
| Session store | Cloudflare KV (`SESSIONS`) |
| Queue | Cloudflare Queues (`feed-crawl-queue`) |
| Feed parsing | `sax` |
| Testing | Vitest + `@cloudflare/vitest-pool-workers` |

### High-level request flow

1. All requests pass through `authMiddleware` in `src/auth/middleware.js`.
2. Public paths skip auth.
3. Protected paths require a valid KV-backed session cookie.
4. Route handlers fetch data and render HTML via view helpers.
5. `renderLayout()` wraps authenticated pages in the shared sidebar shell.

### Public paths

These exact paths are public:

- `/login`
- `/auth/start`
- `/auth/callback`
- `/logout`
- `/logged-out`

Everything else registered in `src/index.js` is protected.

### Worker exports

The default Worker export in `src/index.js` provides:

- `fetch` - the Hono app
- `scheduled` - daily crawl dispatch
- `queue` - queue consumer for crawl and article-batch jobs

### Server-side rendering

Views use Hono's `html` tag from `hono/html`.

Important notes:

- interpolated values are escaped by default
- `raw()` is used only for trusted HTML fragments or inlined CSS
- CSS is loaded from `src/styles.css` as a text module and inlined into every page

## 4. Authentication

Authentication uses GitHub OAuth plus an allowlist of verified email addresses.

Flow:

1. Unauthenticated access redirects to `/login?next=...`.
2. `/auth/start` creates a one-time OAuth state token in KV.
3. GitHub redirects back to `/auth/callback`.
4. The callback exchanges the code for a token and fetches verified emails.
5. Access is granted only if one verified email matches `ALLOWED_EMAILS`.
6. A session is created in KV and a session cookie is set.

### Session model

| Property | Value |
|---|---|
| Cookie name | `feed_reader_session` |
| Cookie attributes | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<ttl>` |
| KV key | `session:{uuid}` |
| KV value | JSON with `email` and `createdAt` |
| Default TTL | `777600` seconds (9 days) |

Session refresh is throttled. After a session is validated, the middleware only refreshes KV and reissues the cookie once half the TTL has elapsed.

### OAuth state tokens

| Property | Value |
|---|---|
| KV key | `oauth_state:{uuid}` |
| Value | JSON with `nextUrl` |
| TTL | 10 minutes |
| Use | one-time, consumed on first valid callback |

### Redirect safety

The post-login `next` target must:

- start with `/`
- not start with `//`
- not contain carriage return or newline characters

## 5. Database

### `feeds`

Stores feed metadata and crawl state.

Important columns:

- `id` - primary key
- `hostname`
- `title`
- `xml_url`
- `html_url`
- `no_crawl` - `1` means disabled
- `consecutive_failure_count`
- `featured`
- `created_at`, `updated_at`

Key migrations:

- `0001_create_feeds_table.sql`
- `0003_add_failure_count_to_feeds.sql`
- `0006_add_unique_index_on_feed_xml_url.sql`
- `0008_add_featured_to_feeds.sql`

The unique index on `LOWER(TRIM(xml_url))` prevents duplicate feeds with case or whitespace differences.

### `articles`

Stores article metadata only, not full article content.

Important columns:

- `id`
- `feed_id`
- `link`
- `title`
- `published`
- `updated`
- `added`
- `created_at`

Notes:

- Imported articles may use source UUID-style IDs.
- Crawled articles use `{feedId}:{guid-or-link}`.
- `published` should be ISO 8601 text.

Key migrations:

- `0002_create_articles_table.sql`
- `0007_add_effective_date_index_on_articles.sql`
- `0009_remove_duplicate_imported_articles.sql`

`0007` adds the expression index used by the daily reader query:

- `DATE(COALESCE(published, added))`

`0009` is a data cleanup migration that removes imported duplicate articles when a crawled duplicate for the same `(feed_id, link)` already exists.

### `crawl_runs`

One row per crawl dispatch.

Important columns:

- `id`
- `started_at`
- `created_at`

Totals are not stored on the row. They are derived from `crawl_run_details`.

Key migrations:

- `0004_create_crawl_runs_table.sql`
- `0010_simplify_crawl_runs_table.sql`
- `0011_remove_completed_at_from_crawl_runs.sql`

### `crawl_run_details`

One row per feed per crawl run.

Important columns:

- `crawl_run_id`
- `feed_id`
- `status`
- `articles_added`
- `error_message`
- `auto_disabled`

Status values:

- `success`
- `failed`
- `auto_disabled`

### Migration rules

Local migrations:

```bash
npx wrangler d1 migrations apply feed-reader-db --local
```

Remote migrations:

```bash
npx wrangler d1 migrations apply feed-reader-db --remote
```

Do not apply remote migrations without explicit instruction from the project owner.

## 6. Crawling

### Schedule

The Worker dispatches a crawl daily at `02:00 UTC` via the cron trigger in `wrangler.jsonc`:

```json
"triggers": { "crons": ["0 2 * * *"] }
```

### Crawl pipeline

The crawl system is queue-backed and has three phases.

#### Phase 1: dispatch

Implemented by `dispatchCrawl(db, queue)` in `src/crawl.js`.

It:

1. reads all enabled feed IDs (`no_crawl = 0`)
2. creates a shared `crawlRunId` and `startedAt`
3. inserts the `crawl_runs` header row
4. sends one `type: 'crawl'` message per feed

Dispatch messages are sent in chunks of 100, which matches the Cloudflare `sendBatch()` limit.

If there are no enabled feeds, dispatch returns:

```js
{ crawlRunId: null, totalFeeds: 0, batchCount: 0 }
```

#### Phase 2: crawl job

Implemented by `processCrawlJob(db, queue, job)`.

Per feed, it:

1. loads the feed row
2. fetches the feed XML with a 30-second timeout
3. parses RSS or Atom
4. records success or failure
5. resets or increments failure count
6. auto-disables the feed after 5 consecutive failures
7. records a `crawl_run_details` row
8. enqueues article batches when running through the queue path

Normalized user-facing crawl errors are intentionally simple:

- invalid XML -> `Failed to parse the feed XML`
- network and fetch failures -> `Could not reach the feed URL (network error or server unavailable)`

#### Phase 3: article-batch job

Implemented by `processArticleBatchJob(db, job)`.

Each message carries up to 20 prepared articles. The consumer:

1. inserts each article with `ON CONFLICT(id) DO NOTHING`
2. increments `crawl_run_details.articles_added` by the number of new inserts

Article-batch messages are also sent to the queue in chunks of 100 messages.

### Single-feed crawl after add

When a user adds a feed through the UI, the system immediately starts a background crawl with `performFeedCrawl()`.

This path:

- creates its own `crawl_runs` row
- calls `processCrawlJob()` with `queue = null`
- inserts articles directly instead of enqueueing article-batch messages

That keeps the add-feed redirect fast while still recording crawl history.

### Auto-disable behavior

After 5 consecutive crawl failures:

- `no_crawl` is set to `1`
- the feed stops participating in scheduled and manual dispatches
- crawl history shows `auto_disabled`

Re-enabling a feed from the UI resets `consecutive_failure_count` to `0`.

## 7. Routes and Behavior

### Feed management routes

| Route | Purpose |
|---|---|
| `GET /feeds` | feed list |
| `GET /feeds/add` | add-feed page |
| `POST /api/feeds/add` | add-feed submission |
| `GET /feeds/:feedId` | feed detail |
| `GET /feeds/:feedId/articles` | feed articles |
| `POST /api/feeds/:feedId/toggle-crawl` | enable or disable crawling |
| `POST /api/feeds/:feedId/toggle-featured` | feature or unfeature feed |

`returnTo` for both toggle endpoints must start with `/feeds`, otherwise the redirect falls back to `/feeds`.

### Crawl routes

| Route | Purpose |
|---|---|
| `GET /crawl-history` | list recent crawl runs |
| `GET /crawl-history/:crawlRunId` | show per-feed crawl results |
| `GET /dispatch-crawl` | manual dispatch page |
| `POST /api/dispatch-crawl` | trigger dispatch immediately |

### Reader and auth routes

| Route | Purpose |
|---|---|
| `GET /` | home page |
| `GET /reader` | daily cross-feed reader |
| `GET /login` | login page |
| `GET /auth/start` | begin GitHub OAuth |
| `GET /auth/callback` | GitHub OAuth callback |
| `GET /logout` | delete session and clear cookie |
| `GET /logged-out` | logged-out confirmation page |

## 8. Configuration

Primary config lives in `wrangler.jsonc`.

Important settings:

- entrypoint: `src/index.js`
- compatibility date: `2026-03-10`
- `nodejs_compat` enabled
- CSS imported as text via a Wrangler rule
- custom domain route: `reader.kixx.news`
- D1 binding: `DB`
- KV binding: `SESSIONS`
- Queue producer binding: `CRAWL_QUEUE`
- queue name: `feed-crawl-queue`
- queue consumer:
  - `max_batch_size: 1`
  - `max_batch_timeout: 0`
  - `max_retries: 3`
- cron: `0 2 * * *`
- observability enabled

### Vars

| Var | Purpose |
|---|---|
| `SESSION_TTL_SECONDS` | session lifetime |
| `GITHUB_OAUTH_CALLBACK_URL` | OAuth callback URL |

### Secrets

| Secret | Purpose |
|---|---|
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `ALLOWED_EMAILS` | comma-separated allowlist of verified emails |

Secrets are runtime bindings and do not require redeploy after changes.

### Local development secrets

Create `.dev.vars` in the project root for local OAuth and auth testing:

```dotenv
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
ALLOWED_EMAILS=you@example.com
GITHUB_OAUTH_CALLBACK_URL=http://localhost:8787/auth/callback
```

## 9. Development and Testing

### Install

```bash
npm install
```

### Start the Worker locally

```bash
npm start
```

or:

```bash
npx wrangler dev
```

### Test the scheduled handler locally

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+2+*+*+*"
```

After using the dev server for validation, stop it so the port is free for normal development.

### Run tests

```bash
npm test
```

or:

```bash
npx vitest run
```

Tests run inside the Cloudflare Workers Vitest environment defined by `@cloudflare/vitest-pool-workers`.

The test suite covers the major auth, feed, add-feed, reader, crawl-history, and crawl pipeline flows. It also includes coverage for feeds search/filter behavior and manual crawl dispatch.

## 10. Scripts and Operations

### Sync feeds to remote

`scripts/sync-feeds-to-remote.js`

```bash
node scripts/sync-feeds-to-remote.js --dry-run
node scripts/sync-feeds-to-remote.js
node scripts/sync-feeds-to-remote.js --batch-size=200
```

This syncs the local `feeds` table to the remote D1 `feeds` table.

### Sync articles to remote

`scripts/sync-articles-to-remote.js`

```bash
node scripts/sync-articles-to-remote.js --dry-run
node scripts/sync-articles-to-remote.js
node scripts/sync-articles-to-remote.js --batch-size=200
```

This syncs the local `articles` table to the remote D1 `articles` table using upserts.

### Recover failed feeds

`scripts/recover-failed-feeds.js`

```bash
node scripts/recover-failed-feeds.js --env local --dry-run
node scripts/recover-failed-feeds.js --env local
node scripts/recover-failed-feeds.js --env remote
```

This script looks at feeds that failed in the most recent crawl run, tries discovery against each feed's `html_url`, and updates the feed if a new working `xml_url` is found.

### Hydrate a template

`scripts/hydrate-template.js`

```bash
node scripts/hydrate-template.js <template-file> <context-yaml-file>
```

### Operational commands

Stream Worker logs:

```bash
npx wrangler tail
```

Run a local D1 query:

```bash
npx wrangler d1 execute feed-reader-db --local --command "SELECT COUNT(*) FROM feeds"
```

Run a remote D1 query:

```bash
npx wrangler d1 execute feed-reader-db --remote --command "SELECT COUNT(*) FROM feeds"
```

Do not deploy or run remote migrations unless explicitly instructed.

### Note about package scripts

`package.json` still defines:

- `npm run import-feeds`
- `npm run import-articles`

But the referenced files `scripts/import-feeds.js` and `scripts/import-articles.js` are not present in this repository. Treat those commands as stale until the scripts are restored or removed.

## 11. Deployment and Setup Notes

This project uses manual deploys only.

Typical Cloudflare resources:

- one Worker
- one D1 database: `feed-reader-db`
- one KV namespace bound as `SESSIONS`
- one Queue named `feed-crawl-queue`

Typical setup tasks:

1. create D1, KV, and Queue resources
2. populate `wrangler.jsonc` bindings and IDs
3. set secrets
4. apply migrations
5. deploy manually when instructed

Do not deploy the Worker yourself unless explicitly asked.

## 12. File Map

Key files:

| File | Purpose |
|---|---|
| `src/index.js` | route registration, auth middleware, `scheduled`, and `queue` |
| `src/layout.js` | shared page shell and sidebar |
| `src/db.js` | database queries and mutations |
| `src/crawl.js` | crawl dispatch and queue consumer logic |
| `src/feed-discovery.js` | add-feed discovery and validation |
| `src/parser.js` | RSS/Atom parsing |
| `src/auth/` | OAuth, session, and auth middleware |
| `src/routes/` | request handlers |
| `src/views/pages/` | page-specific HTML renderers |
| `src/routes/dispatch-crawl.js` | manual dispatch page |
| `src/routes/api/dispatch-crawl.js` | manual dispatch action |
| `src/views/pages/dispatch-crawl.js` | manual dispatch page HTML |
| `migrations/` | schema and data migrations |
| `scripts/` | maintenance and sync scripts |
| `test/index.spec.js` | application test suite |

## 13. Current Limitations

- All authenticated users share the same feeds and articles.
- There is no UI for editing or deleting feeds.
- There is no article full-text search.
- There is no read tracking, bookmarking, or user preference model.
- Articles are metadata-only; article body content is not stored.
- Feed detail preserves list page and disabled filter state, but not title/domain search state.
- Add-feed discovery only uses HTML metadata and a short list of common feed paths; JavaScript-rendered discovery is not supported.
- Session revocation is coarse-grained: removing an email from `ALLOWED_EMAILS` blocks future logins but does not instantly kill an active session.
- There are no foreign keys or cascading deletes between `feeds` and `articles`.
