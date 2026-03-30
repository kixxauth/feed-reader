# Implementation Plan: Automatic Feed Crawling Epic

## Status note (implementation reality)

This document is a historical implementation plan. The epic was implemented, but some details here no longer match the current codebase:

- The crawler uses a **queue fan-out** model (`dispatchCrawl` + `processCrawlJob`) rather than a single `performCrawl(db)` loop.
- Feed parsing is implemented via an event-driven **SAX parser** in `src/parser.js` (not `fast-xml-parser`).
- `crawl_runs` has been simplified via migrations: it now stores **only** `id`, `started_at`, and `created_at` (no `completed_at` or denormalized totals).

Use this plan for high-level intent and rationale, but trust the current code and migrations for exact behavior and schema.

## Implementation Approach

This epic adds automatic background crawling of all RSS feeds once every 24 hours, with per-feed crawl control, failure tracking, and a history UI for the site owner. The strategy involves:

(1) **Database schema updates** — add a `consecutive_failure_count` column to the `feeds` table (already has `no_crawl` flag), and create two new tables: `crawl_runs` (one row per crawl execution) and `crawl_run_details` (one row per feed result in each crawl);

(2) **Scheduled crawl job** — register a `scheduled` event handler on the Worker's default export that runs once per day (24 hours), triggered by a Cloudflare cron trigger configured in `wrangler.jsonc` under `"triggers": { "crons": [...] }`;

(3) **Crawl logic module** (`src/crawl.js`) — fetch all non-disabled feeds' RSS XML URLs, parse each feed using the `fast-xml-parser` library, extract articles, upsert new articles to the database, track per-feed failure count and auto-disable after 5 consecutive failures, and record comprehensive crawl history (per-crawl summary and per-feed details);

(4) **Crawl history UI** (`src/routes/crawl-history.js`) — create an owner-only page listing recent crawl runs (newest first) with a separate detail page per run (`/crawl-history/:crawlRunId`), showing articles added, errors, and auto-disable events;

(5) **Per-feed crawl control** — modify the Feeds page to show each feed's crawl status and add a form-based enable/disable toggle that submits a POST and redirects back to the feeds page (consistent with the server-rendered HTML pattern used throughout the app);

(6) **Database query functions** (`src/db.js`) — add functions for querying crawl history, crawl details, updating feed failure counts, recording crawl results, and inserting crawled articles;

(7) **Refactor Worker export** — change `src/index.js` from `export default app` to `export default { fetch: app.fetch, scheduled(...) { ... } }` to support both HTTP and scheduled event handling. Update test imports accordingly;

(8) **Tests** — ensure crawl logic is testable, mock RSS fetches using `vi.spyOn(globalThis, 'fetch')` (matching the existing project convention), verify upsert behavior, validate history page rendering, and test the enable/disable toggle.

The crawl is fully idempotent: articles are matched by their `id` (derived from `feed_id` + RSS `<guid>` or `<link>`) to prevent duplicates within the crawl. Crawls run in the background; users automatically see new articles without manual refresh.

**Article ID note**: The existing import scripts (`scripts/import-articles.js`) copy article IDs verbatim from the source database — they do not define an ID format. Crawled articles will use a new scheme: `${feedId}:${guid}` (or `${feedId}:${link}` if no guid/id element is present). Articles imported from external sources may have IDs in a different format, so some overlap is possible in edge cases. The `ON CONFLICT(id) DO NOTHING` strategy prevents duplicates within the crawl cycle itself. This is an accepted constraint of one-time historical imports.

---

## TODO Items

- [x] **Extend feeds table migration with failure tracking column**
  - **Story**: Story 4 — Failed feeds are automatically disabled after repeated failures
  - **What**: Create a new migration file (`migrations/0003_add_failure_count_to_feeds.sql`) that adds `consecutive_failure_count INTEGER DEFAULT 0` column to the `feeds` table. This column tracks how many consecutive failed crawls a feed has had; it resets to 0 on success and increments on failure. After 5 consecutive failures, the `no_crawl` flag is set to true (auto-disable logic happens in the crawl routine, not the schema)
  - **Where**: `migrations/0003_add_failure_count_to_feeds.sql` (new file)
  - **Implementation note**: SQLite's `ALTER TABLE ... ADD COLUMN` does not support `IF NOT EXISTS`. The migration will run exactly once via wrangler's migration tracking, so no guard is needed. Use: `ALTER TABLE feeds ADD COLUMN consecutive_failure_count INTEGER DEFAULT 0;`
  - **Acceptance criteria**: Migration adds `consecutive_failure_count` column with default value 0; column is accessible after applying migration
  - **Depends on**: none

- [x] **Create crawl_runs table migration**
  - **Story**: Story 3 — Owner sees a history of crawl runs
  - **What**: Create a migration file (`migrations/0004_create_crawl_runs_table.sql`) defining the `crawl_runs` table that stores one row per crawl execution. Columns: `id` (TEXT PRIMARY KEY, generated via `crypto.randomUUID()`), `started_at` (TEXT NOT NULL, ISO 8601 timestamp), `completed_at` (TEXT, nullable ISO 8601 timestamp — reserved for future partial-recovery use; in the current implementation it is always set when the row is inserted at crawl completion), `total_feeds_attempted` (INTEGER NOT NULL), `total_feeds_failed` (INTEGER NOT NULL, count of feeds with errors), `total_articles_added` (INTEGER NOT NULL, sum across all feeds), `created_at` (TEXT DEFAULT CURRENT_TIMESTAMP). Add an index on `started_at DESC` for efficient reverse-chronological queries
  - **Where**: `migrations/0004_create_crawl_runs_table.sql` (new file)
  - **Acceptance criteria**: `crawl_runs` table exists with all columns per schema; `id` is primary key; index on `started_at DESC` exists; migration uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`
  - **Depends on**: none

- [x] **Create crawl_run_details table migration**
  - **Story**: Story 3 — Owner sees a history of crawl runs
  - **What**: Create a migration file (`migrations/0005_create_crawl_run_details_table.sql`) defining the `crawl_run_details` table that stores per-feed results for each crawl. Use a composite primary key `(crawl_run_id, feed_id)` since each feed appears at most once per crawl run — no separate `id` column needed. Columns: `crawl_run_id` (TEXT NOT NULL), `feed_id` (TEXT NOT NULL), `status` (TEXT NOT NULL, one of: 'success', 'failed', 'auto_disabled'), `articles_added` (INTEGER NOT NULL, number of new articles inserted), `error_message` (TEXT, nullable), `auto_disabled` (INTEGER DEFAULT 0, 1 if feed was auto-disabled as a result of this crawl), `created_at` (TEXT DEFAULT CURRENT_TIMESTAMP). Primary key is `(crawl_run_id, feed_id)`. No additional index needed since the composite PK already covers lookups by crawl_run_id
  - **Where**: `migrations/0005_create_crawl_run_details_table.sql` (new file)
  - **Acceptance criteria**: `crawl_run_details` table exists with all columns per schema; composite primary key on `(crawl_run_id, feed_id)` exists; migration uses `CREATE TABLE IF NOT EXISTS`
  - **Depends on**: none

- [x] **Install fast-xml-parser dependency**
  - **Story**: Story 2 — Feeds are crawled automatically every 24 hours
  - **What**: Add `fast-xml-parser` as a production dependency (`npm install fast-xml-parser`). This library is used by the crawl module to parse RSS 2.0 and Atom 1.0 XML feeds. It is lightweight, has no native dependencies, and works in the Workers runtime
  - **Where**: `package.json`
  - **Acceptance criteria**: `fast-xml-parser` appears in `dependencies` in `package.json`; `npm install` succeeds; the library can be imported in Workers code
  - **Depends on**: none

- [x] **Add crawl query functions to database module**
  - **Story**: Story 2, 3, 4 — Crawling, history view, and failure tracking
  - **What**: Add the following exported functions to `src/db.js`:
    1. `getEnabledFeeds(db)` — returns all feeds where `no_crawl = 0`, selecting all columns (`SELECT *`); the crawl module needs at minimum `id`, `xml_url`, and `consecutive_failure_count`
    2. `getCrawlRuns(db, limit)` — returns the most recent N crawl runs ordered by `started_at DESC` (for history page listing)
    3. `getCrawlRunById(db, crawlRunId)` — returns a single crawl run row by `id`, or null if not found (for detail page)
    4. `getCrawlRunDetails(db, crawlRunId)` — returns all `crawl_run_details` rows for a specific crawl, LEFT JOINed with `feeds` to include `feeds.title` and `feeds.hostname` (if a feed has been deleted, these will be null — display `feed_id` as fallback in the UI)
    5. `recordCrawlRun(db, { id, startedAt, completedAt, totalFeedsAttempted, totalFeedsFailed, totalArticlesAdded })` — inserts a new row into `crawl_runs`. The caller generates the `id` via `crypto.randomUUID()` before calling this, so it can be used to link detail rows during the crawl. The row is inserted once at crawl completion with all fields populated
    6. `recordCrawlRunDetail(db, { crawlRunId, feedId, status, articlesAdded, errorMessage, autoDisabled })` — inserts a row into `crawl_run_details`
    7. `updateFeedFailureCount(db, feedId, count)` — sets `consecutive_failure_count` to the given value for a feed
    8. `disableFeed(db, feedId)` — sets `no_crawl = 1` and `consecutive_failure_count = 0` for a feed (resetting count prevents re-triggering if someone queries the DB directly)
    9. `updateFeedCrawlStatus(db, feedId, noCrawl)` — sets `no_crawl` to the given value for a feed (used by the toggle endpoint)
    10. `resetFeedFailureCount(db, feedId)` — sets `consecutive_failure_count = 0` (called on success or when user manually re-enables)
    11. `insertArticle(db, { id, feedId, link, title, published, updated, added })` — inserts a single article row using `INSERT INTO articles (id, feed_id, link, title, published, updated, added) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`. Returns the D1Result; use `result.meta.changes` to determine whether a row was actually inserted (1 = new, 0 = duplicate)
  - **Where**: `src/db.js`
  - **Implementation notes**:
    - All functions use prepared statements with parameter binding for safety
    - `getCrawlRunDetails` SQL: `SELECT d.*, f.title AS feed_title, f.hostname AS feed_hostname FROM crawl_run_details d LEFT JOIN feeds f ON d.feed_id = f.id WHERE d.crawl_run_id = ?`
  - **Acceptance criteria**: All eleven functions exist and are exported; `recordCrawlRun` accepts a caller-provided `id`; `getCrawlRun*` functions return correctly ordered and filtered results; failure/disable/toggle functions update the feeds table correctly; `insertArticle` returns D1Result with `meta.changes`; all queries use parameter binding
  - **Depends on**: Create crawl_runs table migration, Create crawl_run_details table migration

- [x] **Create RSS crawl logic module**
  - **Story**: Story 2 — Feeds are crawled automatically every 24 hours
  - **What**: Create `src/crawl.js` exporting `performCrawl(db)` — an async function that:
    1. Generates a `crawlRunId` via `crypto.randomUUID()` and records the start time as `startedAt = new Date().toISOString()`
    2. Fetches all enabled feeds from the database via `getEnabledFeeds(db)`
    3. For each feed, fetches the RSS XML from its `xml_url` using `fetch()` with a 30-second timeout via `AbortController` + `setTimeout`. Include a `User-Agent: FeedReader/1.0` header on the fetch request
    4. Parses the RSS/Atom XML using `fast-xml-parser` (see XML parsing note below)
    5. Handles both RSS 2.0 (`rss.channel.item`) and Atom 1.0 (`feed.entry`) structures:
       - RSS 2.0: extract `title`, `link`, `guid`, `pubDate`
       - Atom 1.0: extract `title`, link href (see attribute note below), `id`, `published` or `updated`
    6. For each article, derives a stable `id`: use `${feedId}:${guid}` if `<guid>` (RSS) or `<id>` (Atom) is present; otherwise use `${feedId}:${link}`. Trim and normalize whitespace in guid/link values before use
    7. Converts `pubDate` (RFC 2822) or `published`/`updated` (ISO 8601) to ISO 8601 format via `new Date(dateString).toISOString()`. If the date is invalid or missing, stores `null`
    8. Inserts each article using `insertArticle(db, { id, feedId, link, title, published, updated, added: startedAt })`. The `added` field is set to `startedAt` (the crawl's start time). Counts articles actually inserted via `result.meta.changes`
    9. On success: resets the feed's `consecutive_failure_count` to 0 via `resetFeedFailureCount`
    10. On failure: increments `consecutive_failure_count` by 1 (read the current value from the feed row returned by `getEnabledFeeds`, add 1). If the new count reaches 5, calls `disableFeed(db, feedId)` and sets the detail record's `auto_disabled` flag to 1. After `disableFeed` the DB holds `no_crawl=1` and `consecutive_failure_count=0`
    11. Records a `crawl_run_details` row for each feed (status, articles_added, error_message, auto_disabled)
    12. After all feeds are processed, records the `crawl_runs` summary row with totals (via `recordCrawlRun`)
    13. Returns a summary object `{ crawlRunId, totalFeeds, totalFailed, totalArticlesAdded }` for logging
  - **Where**: `src/crawl.js` (new file)
  - **Error handling**:
    - Network errors (timeout, connection refused, DNS failure) — catch, set status to 'failed', record error message, increment failure count
    - HTTP errors (4xx, 5xx) — treat as failure; record status code in error message (e.g., `"HTTP 404"`)
    - XML parse errors — treat as failure; record error message (e.g., `"Invalid XML: ..."`)
    - Database errors — log and re-throw; crawl is aborted (next scheduled run will retry all feeds)
    - One feed's failure does not stop the crawl; continue to next feed
  - **Timeout implementation**: Use `AbortController` with `setTimeout(30000)`. Clear the timeout on completion via `clearTimeout`. Catch `AbortError` and record as `"Request timeout (30s)"`
  - **XML parsing note**: Instantiate the parser as:
    ```js
    import { XMLParser } from 'fast-xml-parser';
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',  // attributes accessed without @_ prefix
      isArray: (name) => name === 'item' || name === 'entry',  // always array
    });
    const parsed = parser.parse(xmlText);
    ```
    With `attributeNamePrefix: ''`, Atom link attributes are accessed as `entry.link.href` and `entry.link.rel`. With `isArray`, `channel.item` and `feed.entry` are always arrays (no manual normalization needed). If a feed has multiple `<link>` elements (common in Atom), `entry.link` will be an array — find the one where `rel === 'alternate'` or `rel` is absent, and use its `href`
  - **Partial-run data**: `crawl_run_details` rows are inserted during the crawl; the parent `crawl_runs` row is inserted once at the end. If the Worker times out mid-crawl, orphaned detail rows may exist without a parent row. This is an accepted edge case (out-of-scope for partial recovery)
  - **Acceptance criteria**: `performCrawl` fetches all enabled feeds; fetches and parses RSS/Atom XML; inserts new articles without duplicates; sets `added` to the crawl's start time; updates feed failure counts correctly; auto-disables after 5 consecutive failures (DB state after disable: `no_crawl=1`, `consecutive_failure_count=0`); records crawl history; returns summary; one feed's failure doesn't stop crawl; 30-second per-feed timeout via AbortController; User-Agent header set on each fetch
  - **Depends on**: Add crawl query functions to database module, Install fast-xml-parser dependency

- [x] **Refactor Worker export to support scheduled handler**
  - **Story**: Story 2 — Feeds are crawled automatically every 24 hours
  - **What**: Change `src/index.js` from `export default app;` to:
    ```js
    import { performCrawl } from './crawl.js';

    export default {
      fetch: app.fetch,
      async scheduled(controller, env, ctx) {
        ctx.waitUntil(
          performCrawl(env.DB)
            .then((summary) => console.log('Crawl completed:', JSON.stringify(summary)))
            .catch((err) => console.error('Crawl failed:', err))
        );
      },
    };
    ```
    `ctx.waitUntil()` is required to keep the Worker alive for the duration of the async crawl. Without it, the runtime may kill the Worker before the crawl finishes. This is required because Cloudflare Workers' cron triggers invoke the `scheduled` method on the default export. Hono's `app` object only has a `fetch` method. The Cloudflare docs explicitly show this pattern for Hono + scheduled handlers
  - **Where**: `src/index.js`
  - **Impact on tests**: The test file (`test/index.spec.js`) imports `worker from '../src'` and calls `worker.fetch(request, env, ctx)`. After this change, `worker.fetch` will still work because we're exporting `{ fetch: app.fetch, ... }`. The `SELF.fetch` integration tests are unaffected. Verify all existing tests still pass after the change
  - **Acceptance criteria**: Default export is an object with `fetch` and `scheduled` properties; all existing tests pass unchanged; `scheduled` handler wraps `performCrawl(env.DB)` in `ctx.waitUntil`; errors are caught and logged
  - **Depends on**: Create RSS crawl logic module

- [x] **Add cron trigger to wrangler.jsonc**
  - **Story**: Story 2 — Feeds are crawled automatically every 24 hours
  - **What**: Add the following to `wrangler.jsonc`:
    ```jsonc
    "triggers": {
      "crons": ["0 2 * * *"]
    }
    ```
    This triggers the `scheduled` handler at 02:00 UTC daily. The time can be adjusted by the deployer
  - **Where**: `wrangler.jsonc`
  - **Testing note**: For local testing, use `npx wrangler dev --test-scheduled` and then curl `http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+2+*+*+*` to manually trigger. Alternatively, call `performCrawl(db)` directly in a test
  - **Acceptance criteria**: `triggers.crons` array is present and valid in `wrangler.jsonc`; cron syntax is correct 5-field format
  - **Depends on**: Refactor Worker export to support scheduled handler

- [x] **Create crawl history list page route**
  - **Story**: Story 3 — Owner sees a history of crawl runs
  - **What**: Create `src/routes/crawl-history.js` exporting `handleCrawlHistory` for `GET /crawl-history`. Import `escapeHtml` from `'../html-utils.js'` (same pattern as all other route files). The handler:
    1. Queries the most recent 30 crawl runs using `getCrawlRuns(db, 30)`
    2. Renders a list of crawl run summaries, each showing: `started_at` (formatted as human-readable date + time, e.g., "Mar 23, 2026 02:15 AM"), total feeds attempted, total failed, total articles added
    3. Each run has a "View Details" link to `/crawl-history/:crawlRunId`
    4. Empty state: "No crawl history available" if no runs exist
    5. Back link to `/feeds`
    6. Returns HTML rendered with `renderLayout`
  - **Where**: `src/routes/crawl-history.js` (new file)
  - **Acceptance criteria**: Page lists crawl runs newest-first; shows summary data; each run links to detail page; dates formatted as human-readable; empty state handled; HTML-escaped content; consistent styling with rest of site
  - **Depends on**: Add crawl query functions to database module

- [x] **Create crawl history detail page route**
  - **Story**: Story 3 — Owner sees a history of crawl runs
  - **What**: In `src/routes/crawl-history.js`, add a second exported handler `handleCrawlHistoryDetail` for `GET /crawl-history/:crawlRunId`. Import `escapeHtml` from `'../html-utils.js'`. The handler:
    1. Fetches the crawl run by ID via `getCrawlRunById(db, crawlRunId)`. Returns 404 if not found
    2. Fetches per-feed details via `getCrawlRunDetails(db, crawlRunId)`
    3. Renders the crawl run summary at the top (same fields as list page)
    4. Renders per-feed detail rows:
       - Feed title (from JOIN) or feed_id if feed deleted
       - Articles added (count)
       - Status: "Success" (green-ish), "Failed" (red-ish), "Auto-disabled" (orange-ish) — use CSS classes, not inline styles
       - Error message if status is failed or auto-disabled
    5. Back link to `/crawl-history`
    6. Returns HTML rendered with `renderLayout`
  - **Where**: `src/routes/crawl-history.js`
  - **Acceptance criteria**: Detail page shows per-feed results; feed titles displayed (with fallback to feed_id); status badges styled via CSS classes; error messages shown; all content HTML-escaped; 404 for invalid crawl run IDs
  - **Depends on**: Create crawl history list page route

- [x] **Register crawl history routes in main app**
  - **Story**: Story 3 — Owner sees a history of crawl runs
  - **What**: In `src/index.js`, import `handleCrawlHistory` and `handleCrawlHistoryDetail` from `./routes/crawl-history.js` and register:
    - `app.get('/crawl-history', handleCrawlHistory)`
    - `app.get('/crawl-history/:crawlRunId', handleCrawlHistoryDetail)`
    Place them after the `/feeds/:feedId/articles` route. Both are automatically protected by `authMiddleware` (exact-match public paths are `/login`, `/auth/start`, `/auth/callback`, `/logout`, `/logged-out` — `/crawl-history` is not in that set)
  - **Where**: `src/index.js`
  - **Acceptance criteria**: Both routes are registered; accessible to authenticated users; unauthenticated requests redirect to `/login?next=...`
  - **Depends on**: Create crawl history detail page route

- [x] **Add crawl history link to navigation**
  - **Story**: Story 3 — Owner sees a history of crawl runs
  - **What**: Add a "Crawl History" link to the site navigation. The navigation lives in `src/layout.js` inside the `renderLayout` function. Currently the authenticated nav is:
    ```js
    const nav = isAuthenticated
      ? `<nav><a href="/logout">Logout</a></nav>`
      : '';
    ```
    Change it to:
    ```js
    const nav = isAuthenticated
      ? `<nav><a href="/crawl-history">Crawl History</a> <a href="/logout">Logout</a></nav>`
      : '';
    ```
  - **Where**: `src/layout.js`
  - **Acceptance criteria**: "Crawl History" link visible on all authenticated pages; links to `/crawl-history`
  - **Depends on**: Register crawl history routes in main app

- [x] **Add per-feed crawl toggle to Feeds page**
  - **Story**: Story 5 — Owner can enable or disable crawling per feed
  - **What**: Modify `src/routes/feeds.js` to display crawl status and a toggle form for each feed. Currently each feed `<li>` shows: title link, hostname span, articles link. Add:
    1. A crawl status indicator: a small badge showing "Crawling" or "Disabled" (using a CSS class for styling, e.g., `class="crawl-status-badge"`)
    2. A `<form method="POST" action="/api/feeds/${feedId}/toggle-crawl">` with a hidden `<input type="hidden" name="_method" value="POST">` is not needed — plain POST form is sufficient. Use a submit button labeled "Disable" (when `no_crawl=0`) or "Enable" (when `no_crawl=1`). This uses standard form submission (no client-side JavaScript) consistent with the rest of the app
    3. The form POST will be handled by a separate API endpoint (next TODO) which redirects back to `/feeds` after toggling
  - **Where**: `src/routes/feeds.js`
  - **Acceptance criteria**: Each feed shows crawl status badge; toggle form submits POST; button text is contextual ("Disable" when enabled, "Enable" when disabled)
  - **Depends on**: none (frontend only; backend will be added next)

- [x] **Create API endpoint to toggle per-feed crawling**
  - **Story**: Story 5 — Owner can enable or disable crawling per feed
  - **What**: Create `src/routes/api/toggle-feed-crawl.js` exporting `handleToggleFeedCrawl` for `POST /api/feeds/:feedId/toggle-crawl`. Note: the directory `src/routes/api/` does not yet exist and must be created. The handler:
    1. Reads the feed ID from the URL path parameter
    2. Fetches the current feed via `getFeedById(db, feedId)`. If not found, returns 404 HTML page
    3. Toggles the `no_crawl` flag: if currently 1, set to 0; if currently 0, set to 1
    4. Updates via `updateFeedCrawlStatus(db, feedId, newNoCrawl)`
    5. When enabling (setting `no_crawl = 0`), also calls `resetFeedFailureCount(db, feedId)` to clear the failure counter
    6. Redirects to `/feeds` with a 303 (See Other) status, following the POST-redirect-GET pattern
  - **Where**: `src/routes/api/toggle-feed-crawl.js` (new file in new directory)
  - **Acceptance criteria**: POST toggles `no_crawl` flag; enabling resets failure count; redirects back to `/feeds` with 303; 404 for nonexistent feed; protected by auth middleware
  - **Depends on**: Add crawl query functions to database module, Add per-feed crawl toggle to Feeds page

- [x] **Register crawl toggle API endpoint in main app**
  - **Story**: Story 5 — Owner can enable or disable crawling per feed
  - **What**: In `src/index.js`, import `handleToggleFeedCrawl` from `./routes/api/toggle-feed-crawl.js` and register: `app.post('/api/feeds/:feedId/toggle-crawl', handleToggleFeedCrawl)`. Place after other routes. Protected by `authMiddleware` automatically (the `/api/` path prefix is not in `PUBLIC_PATHS`)
  - **Where**: `src/index.js`
  - **Acceptance criteria**: Route registered; POST requests work; auth protection in place
  - **Depends on**: Create API endpoint to toggle per-feed crawling

- [x] **Add CSS for crawl history page and feed toggles**
  - **Story**: Story 3, 5 — Crawl history UI and feed toggle styling
  - **What**: Append styles to `src/styles.css` for:
    - `.crawl-run-summary` — container for crawl run row (border-bottom, padding)
    - `.crawl-run-stats` — flex container for attempted/failed/added counts
    - `.crawl-run-stat` — individual stat item
    - `.crawl-detail-row` — per-feed result row in detail view
    - `.status-success`, `.status-failed`, `.status-auto-disabled` — status badge styling using opacity/color
    - `.crawl-toggle` — toggle button styling (consistent with other buttons)
    - `.crawl-status-badge` — small indicator on feed list
  - **Where**: `src/styles.css`
  - **Acceptance criteria**: Crawl history rows are visually distinct; status badges are visible; feed toggle button styled consistently; styles use CSS custom properties (the existing CSS defines `--color-background` and `--color-on-background` in `:root`) where appropriate
  - **Depends on**: Create crawl history list page route, Add per-feed crawl toggle to Feeds page

- [x] **Write tests for crawl logic**
  - **Story**: Story 2, 4 — Crawl execution and failure tracking
  - **What**: In `test/index.spec.js`, add helpers and a `describe('Crawl functionality')` block. Import `performCrawl` from `'../src/crawl.js'` at the top of the file.

    **Helpers** (add to top of file alongside existing helpers):
    - `clearCrawlRuns()` — `DELETE FROM crawl_runs`
    - `clearCrawlRunDetails()` — `DELETE FROM crawl_run_details`
    - Update `seedFeeds` to support the new `consecutive_failure_count` column. The existing `seedFeeds` INSERT does not include this column; it will default to 0. For tests that need a non-zero initial count, pass the column explicitly or add a separate `seedFeedWithCount(feed, count)` helper that includes `consecutive_failure_count` in the INSERT

    **Tests** (call `performCrawl(env.DB)` directly with `vi.spyOn(globalThis, 'fetch')` to mock RSS responses):
    - `performCrawl fetches enabled feeds and inserts new articles` — seed feeds, mock RSS XML responses, verify articles inserted and crawl history recorded
    - `performCrawl skips feeds with no_crawl = 1` — verify disabled feeds are not fetched
    - `performCrawl increments failure count on fetch error` — mock timeout, verify count incremented, `no_crawl` still 0
    - `performCrawl auto-disables feed after 5 consecutive failures` — seed feed with `consecutive_failure_count=4`, mock failure, verify `no_crawl=1` and `consecutive_failure_count=0` in DB (note: `disableFeed` resets count to 0)
    - `performCrawl resets failure count to 0 on success` — seed feed with `consecutive_failure_count=3`, mock success, verify `consecutive_failure_count=0`
    - `performCrawl does not duplicate articles on re-crawl` — run twice with same articles, verify no duplicates
    - `performCrawl stores error message on failure` — verify crawl_run_details has error_message populated
    - `performCrawl returns summary with correct counts` — verify returned object matches actual DB state

  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: All tests pass; crawl logic tested without real network calls; edge cases covered; auto-disable test verifies `no_crawl=1` and `consecutive_failure_count=0` (not count=5)
  - **Depends on**: Create RSS crawl logic module

- [x] **Write tests for crawl history pages**
  - **Story**: Story 3 — Owner sees a history of crawl runs
  - **What**: In `test/index.spec.js`, add `describe('Crawl history page')`:
    - `GET /crawl-history without session redirects to login`
    - `GET /crawl-history with session shows crawl runs newest-first` — seed crawl runs, verify order
    - `GET /crawl-history with no runs shows empty state` — verify "No crawl history available"
    - `GET /crawl-history/:id shows per-feed details` — seed run with details, verify feed titles, counts, statuses
    - `GET /crawl-history/:id HTML-escapes content` — seed with `<script>` in error_message, verify no XSS
    - `GET /crawl-history/:badId returns 404`

  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: All tests pass; route protection verified; content rendering verified
  - **Depends on**: Register crawl history routes in main app

- [x] **Write tests for feed crawl toggle**
  - **Story**: Story 5 — Owner can enable or disable crawling per feed
  - **What**: In `test/index.spec.js`, add `describe('Feed crawl toggle API')`:
    - `POST /api/feeds/:feedId/toggle-crawl without session redirects to login`
    - `POST /api/feeds/:feedId/toggle-crawl disables an enabled feed` — seed feed with `no_crawl=0`, POST, verify `no_crawl=1` in DB and 303 redirect to `/feeds`
    - `POST /api/feeds/:feedId/toggle-crawl enables a disabled feed and resets failure count` — seed with `no_crawl=1, consecutive_failure_count=3`, POST, verify `no_crawl=0` and `consecutive_failure_count=0`
    - `POST /api/feeds/:feedId/toggle-crawl for nonexistent feed returns 404`

  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: All tests pass; toggle behavior verified; auth protection verified
  - **Depends on**: Register crawl toggle API endpoint in main app

- [x] **Update README with crawl documentation**
  - **Story**: Documentation for site owner
  - **What**: Add a "Feed Crawling" section to `README.md` describing:
    - Crawl runs automatically at 02:00 UTC daily (configurable via `triggers.crons` in `wrangler.jsonc`)
    - View crawl history at `/crawl-history`
    - Toggle crawling on/off per feed on the `/feeds` page
    - Feeds are auto-disabled after 5 consecutive failures; re-enable manually on `/feeds`
    - New articles appear automatically
    - Local testing: `npx wrangler dev --test-scheduled` then curl the scheduled endpoint
  - **Where**: `README.md`
  - **Acceptance criteria**: Documentation is clear and accurate
  - **Depends on**: Add cron trigger to wrangler.jsonc, Register crawl history routes in main app, Register crawl toggle API endpoint in main app

- [x] **Validate implementation end-to-end**
  - **Story**: All stories
  - **What**: Run through the complete workflow:
    1. Apply migrations: `npx wrangler d1 migrations apply feed-reader-db --local`
    2. Verify tables: `npx wrangler d1 execute feed-reader-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"`
    3. Import test feeds: `npm run import-feeds -- --env local path/to/source.sqlite`
    4. Run all tests: `npm test` — verify all pass
    5. Start dev server with scheduled test support: `npx wrangler dev --test-scheduled`
    6. Log in, navigate to `/feeds`, verify crawl status badges and toggle buttons
    7. Toggle a feed's crawl on/off, verify it works
    8. Navigate to `/crawl-history`, verify empty state
    9. Trigger a crawl: `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+2+*+*+*"`
    10. Check `/crawl-history`, verify run appeared with stats
    11. Check `/feeds/:feedId/articles` for a crawled feed, verify new articles
    12. Kill dev server
  - **Where**: Manual testing (local dev environment)
  - **Acceptance criteria**: Migrations apply; tables exist; feeds display with crawl status; toggle works; crawl history works; crawl adds articles; all tests pass; no runtime errors
  - **Depends on**: All other tasks

---

## Implementation Notes

### Database Schema

#### Feeds Table (extended)
The existing `feeds` table is modified to add:
```sql
ALTER TABLE feeds ADD COLUMN consecutive_failure_count INTEGER DEFAULT 0;
```

#### Crawl Runs Table
```sql
CREATE TABLE IF NOT EXISTS crawl_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  total_feeds_attempted INTEGER NOT NULL,
  total_feeds_failed INTEGER NOT NULL,
  total_articles_added INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crawl_runs_started_at ON crawl_runs(started_at DESC);
```

Note: `completed_at` is nullable for forward-compatibility with future partial-recovery patterns. In the current implementation, the `crawl_runs` row is inserted once at the end of the crawl with `completed_at` always set.

#### Crawl Run Details Table
```sql
CREATE TABLE IF NOT EXISTS crawl_run_details (
  crawl_run_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  status TEXT NOT NULL,
  articles_added INTEGER NOT NULL,
  error_message TEXT,
  auto_disabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (crawl_run_id, feed_id)
);
```

### Worker Export Structure

The current `export default app` must change to support both HTTP and scheduled handlers:
```js
import { performCrawl } from './crawl.js';

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      performCrawl(env.DB)
        .then((summary) => console.log('Crawl completed:', JSON.stringify(summary)))
        .catch((err) => console.error('Crawl failed:', err))
    );
  },
};
```

`ctx.waitUntil()` keeps the Worker alive while the async crawl runs. Without it, the runtime may terminate the Worker before the crawl finishes. The existing test import (`import worker from '../src'`) continues to work because `worker.fetch` resolves to `app.fetch`.

### Crawl Logic

- **Feed fetching**: One `fetch()` call per feed with a 30-second timeout via `AbortController` + `setTimeout`. Set `User-Agent: FeedReader/1.0` on each request. Clear the timeout with `clearTimeout` on completion (both success and failure) to avoid timer leaks
- **XML parsing**: Use `fast-xml-parser` with `ignoreAttributes: false`, `attributeNamePrefix: ''`, and `isArray: (name) => name === 'item' || name === 'entry'`
- **RSS 2.0 vs Atom 1.0**: Detect by checking `parsed.rss` (RSS 2.0) vs `parsed.feed` (Atom 1.0). Items are at `parsed.rss.channel.item` or `parsed.feed.entry`. With the `isArray` parser option, both are always arrays
- **Atom link extraction**: Atom entries often have multiple `<link>` elements. When `entry.link` is an array, find the element where `rel === 'alternate'` or `rel` is absent/undefined, and use its `href`. When `entry.link` is a single object (rare with `isArray` option but possible if the parser processes it as a non-item element), use `entry.link.href` directly
- **RSS date conversion**: RSS 2.0 uses RFC 2822 dates (e.g., `Thu, 23 Mar 2026 12:00:00 GMT`); Atom uses ISO 8601. Both are handled by `new Date(dateString).toISOString()`. If parsing fails (`Invalid Date`), store `null`
- **Article ID derivation**: `${feedId}:${guid}` where `guid` is the RSS `<guid>` or Atom `<id>` element value. If neither exists, use `${feedId}:${link}`. These IDs are specific to the crawl pipeline and may differ from IDs used by the historical import scripts (which copied IDs verbatim from external source databases). This is an accepted constraint
- **Article insertion**: Use `insertArticle` from db.js; set `added` to `startedAt` (the crawl's start time, captured before iterating feeds)
- **Article deduplication**: `INSERT INTO articles ... ON CONFLICT(id) DO NOTHING` — append-only, no updates to existing articles. `result.meta.changes` returns 1 if inserted, 0 if skipped
- **Failure handling**: One feed's failure does not stop the crawl; continue processing remaining feeds
- **Auto-disable sequence**: On failure: (1) read current count from the feed row (returned by `getEnabledFeeds`), (2) compute new count = old count + 1, (3) call `updateFeedFailureCount(db, feedId, newCount)`, (4) if new count >= 5: call `disableFeed(db, feedId)` (sets `no_crawl=1` and resets `consecutive_failure_count=0`) and record detail with `auto_disabled=1`, status `'auto_disabled'`
- **Idempotency**: Re-running with the same articles produces no duplicates (ON CONFLICT DO NOTHING)

### RSS Parsing with fast-xml-parser

```js
import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',     // access link.href, not link['@_href']
  isArray: (name) => name === 'item' || name === 'entry',
});
const parsed = parser.parse(xmlText);

// RSS 2.0
if (parsed.rss) {
  const items = parsed.rss.channel.item; // always array due to isArray option
  for (const item of items) {
    const guid = item.guid ?? null;
    const link = item.link ?? null;
    const title = item.title ?? null;
    const pubDate = item.pubDate ?? null;
  }
}

// Atom 1.0
if (parsed.feed) {
  const entries = parsed.feed.entry; // always array due to isArray option
  for (const entry of entries) {
    const id = entry.id ?? null;
    // entry.link may be an array (multiple <link> elements)
    const links = Array.isArray(entry.link) ? entry.link : (entry.link ? [entry.link] : []);
    const altLink = links.find(l => !l.rel || l.rel === 'alternate') ?? links[0];
    const link = altLink?.href ?? null;
    const title = entry.title ?? null;
    const published = entry.published ?? entry.updated ?? null;
  }
}
```

### Scheduled Event

- Cron trigger configured in `wrangler.jsonc` under `"triggers": { "crons": ["0 2 * * *"] }`
- Handler signature: `async scheduled(controller, env, ctx)` — `controller.cron` contains the matched cron string, `env.DB` provides the D1 binding, `ctx.waitUntil()` keeps the worker alive for async work
- Local testing: `npx wrangler dev --test-scheduled`, then `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+2+*+*+*"`
- Workers CPU limits: Scheduled Workers on the paid plan get up to 15 minutes wall-clock time. If the feed list is very large, consider processing in batches in a future iteration (out of scope for now)

### Crawl History UI

- **List page** (`/crawl-history`): lists crawl runs newest-first, each linking to detail page
- **Detail page** (`/crawl-history/:crawlRunId`): shows per-feed results with status badges
- Display feed title (from `feeds` table LEFT JOIN) or `feed_id` as fallback if feed deleted
- Show articles added, status (success/failed/auto-disabled), and error message
- Empty state when no crawl runs exist
- Both routes import `escapeHtml` from `'../html-utils.js'` for XSS protection

### Per-Feed Toggle

- Uses standard HTML `<form method="POST">` with redirect (POST-redirect-GET pattern)
- No client-side JavaScript required — consistent with the rest of the app
- Toggle endpoint returns 303 redirect to `/feeds`
- On enable, resets `consecutive_failure_count = 0`
- Route file lives in `src/routes/api/` (new directory)

### Error Messages

- Network errors: `"Request timeout (30s)"`, `"DNS resolution failed"`, `"Connection refused"`
- HTTP errors: `"HTTP 404"`, `"HTTP 500"`, etc. — derived from `response.status`
- XML parse errors: `"Invalid XML: ..."` — derived from fast-xml-parser error message
- Database errors: logged but not stored in crawl history (abort the crawl)

### Testing Strategy

- Mock `fetch()` using `vi.spyOn(globalThis, 'fetch')` — matching the existing project pattern (used in OAuth callback tests)
- Seed test data using `env.DB.prepare().bind().run()`
- Call `performCrawl(env.DB)` directly for unit tests; import `performCrawl` from `'../src/crawl.js'`
- Test UI routes via `worker.fetch(request, env, ctx)` (unit style) or `SELF.fetch()` matching existing test patterns
- Test edge cases: duplicate articles, missing fields, feed failures, auto-disable threshold
- Clean up crawl tables in `beforeEach` blocks via `clearCrawlRuns()` and `clearCrawlRunDetails()`
- For tests requiring non-zero `consecutive_failure_count`, include the column explicitly in the feed INSERT (the `seedFeeds` helper currently does not include it; it defaults to 0)

---

## Open Question Requiring Owner Input

**Article ID overlap with historical imports**: The import scripts copy article IDs verbatim from source databases; they do not define a format. Crawled articles will use `${feedId}:${guid-or-link}`. If the source database used the same scheme, crawl and import will never duplicate. If the source used a different scheme (e.g., bare GUIDs, hashed values), the same article may exist twice with two different IDs. Is this acceptable, or should the crawl use a different ID strategy to minimize overlap?

---

## Out of Scope

- Crawling feeds on a schedule other than every 24 hours (cron expression can be modified by deployer)
- Real-time crawling or event-based triggers (always scheduled, not on-demand)
- Feed list caching or stale-while-revalidate patterns
- Partial crawl recovery (if crawl fails mid-run, next run retries all feeds; orphaned `crawl_run_details` rows from a timed-out run are an accepted edge case)
- Per-user feed subscriptions (single-user app)
- Article updates (crawl is append-only; existing articles are not modified or deleted)
- Full article body fetching (only RSS metadata: title, link, pubDate)
- Feed validation or health checks outside of crawl cycle
- Email/Slack notifications on failures (crawl history page serves this role)
- Batch processing for very large feed lists (acceptable given Workers' 15-minute limit on paid plans)
- Deduplication between historically-imported articles and crawled articles with different ID formats
