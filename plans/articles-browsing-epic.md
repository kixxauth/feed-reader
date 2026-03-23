# Implementation Plan: Articles Browsing Feature

## Implementation Approach

This epic adds article browsing to the Feed Reader, allowing users to view and filter articles imported from an external SQLite database. The strategy involves:

(1) Creating a D1 SQLite migration for an `articles` table to store article metadata (no foreign-key constraint — articles may reference deleted feeds; acceptable for this app);
(2) Building a CLI script (`scripts/import-articles.js`) that reads articles from a source SQLite file and performs upsert operations to prevent duplicates;
(3) Adding database query functions (`src/db.js`) to retrieve paginated, sortable, and filterable articles;
(4) Creating an articles route handler (`src/routes/articles.js`) that renders a feed's articles with pagination (20 per page), reverse-chronological sorting, and date range filtering;
(5) Updating the Feeds page to include a second link (labeled "Articles") to each feed's articles;
(6) Ensuring all pages remain protected by authentication; and
(7) Updating tests to cover the new functionality.

The import is idempotent: running it multiple times will update existing articles (matched by `id`) and add new ones without duplication. Articles are always displayed in reverse chronological order (newest first), with pagination controls and optional date filtering.

**Date format assumption:** The `published` column is stored as ISO 8601 text (e.g., `2026-03-23` or `2026-03-23T12:00:00Z`). Both SQLite text-comparison filtering and `new Date()` parsing depend on this. The import script copies `published` verbatim from the source database. If the source stores dates in a different format (e.g., Unix timestamps), filtering and display will be incorrect. Verify source date format before importing.

---

## TODO Items

- [x] **Create D1 migration for articles table**
  - **Story**: Story 7 — Owner imports existing articles into the app
  - **What**: Write a SQL migration file (`migrations/0002_create_articles_table.sql`) that creates the `articles` table with all required columns: `id`, `feed_id`, `link`, `title`, `published`, `updated`, `added`, `created_at`. Add a composite index on `(feed_id, published)` to optimize the primary query pattern (articles for a feed sorted by published date). This composite index also covers feed_id-only lookups via SQLite's leftmost-prefix rule, so no separate single-column feed_id index is needed.
  - **Where**: `migrations/0002_create_articles_table.sql` (new file)
  - **Acceptance criteria**: `articles` table exists with all columns per the schema below; `id` is primary key; composite index on `(feed_id, published)` exists; migration is repeatable (uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`)
  - **Depends on**: none

- [x] **Add articles query functions to database module**
  - **Story**: Story 1, 2, 3, 5 — View articles, sort, paginate, and filter by date
  - **What**: Add three exported items to `src/db.js`:
    1. `ARTICLES_PAGE_SIZE = 20` — exported constant for use by route handlers (distinct from the existing `PAGE_SIZE = 50` used for feeds)
    2. `getFeedById(db, feedId)` — retrieve a single feed by ID. Returns the feed row object, or `null` if not found
    3. `getArticlesByFeedPaginated(db, feedId, page, fromDate, toDate)` — returns paginated articles for a feed, optionally filtered by date range. Returns `{ articles, total }` where `total` is the count of articles matching the filter (not total articles for the feed). Filters on `published` column (inclusive of both endpoints: `published >= fromDate AND published <= toDate`). Articles sorted by `published DESC` (newest first); articles with NULL published date appear at the end. `fromDate` and `toDate` are optional — when omitted, that side of the range is unbounded. The function builds the WHERE clause dynamically based on which filter params are provided
  - **Where**: `src/db.js`
  - **Implementation notes**:
    - The COUNT query and the SELECT query must use the same WHERE clause (including date filters) so that `total` accurately reflects the filtered result set. Pagination math depends on this
    - For NULL published handling in ORDER BY, use: `ORDER BY (published IS NULL), published DESC` — this sorts NULLs last; their order among themselves is undefined and not guaranteed to be stable across pages (acceptable for this app)
    - Page clamping (for out-of-bounds pages) is handled by the route handler, not this function. This function trusts the caller to provide a valid page number (matching the `getFeedsPaginated` pattern)
  - **Acceptance criteria**: `getArticlesByFeedPaginated` returns correct articles in reverse chronological order; `total` reflects the filtered count (not unfiltered total); date filtering works correctly (inclusive range); NULL published dates handled correctly (end of list); pagination math correct (page 1 → offset 0, page 2 → offset 20); `getFeedById` returns feed object or `null`
  - **Depends on**: Create D1 migration for articles table

- [x] **Create articles import CLI script**
  - **Story**: Story 7 — Owner imports existing articles into the app
  - **What**: Build `scripts/import-articles.js` that reads a source SQLite database file (path provided as CLI argument), extracts all article rows, and upserts them into D1. Follow the same structure as `scripts/import-feeds.js`: reads from a source SQLite file, generates SQL statements, and executes them via `wrangler d1 execute`. Accepts `--env local` or `--env remote` to select the target environment. Reports progress and completion count
  - **Where**: `scripts/import-articles.js` (new file)
  - **How**: Use `better-sqlite3` (already a devDependency) to read the source file. For each article row, generate an `INSERT ... ON CONFLICT(id) DO UPDATE` statement. Execute via `wrangler d1 execute DB --local` or `--remote` with `--command` flag. Mirror the `escapeSqlString` helper, argument parsing, and progress logging from `import-feeds.js`
  - **Auto-detection**: If `--table` is not provided, detect the articles table by looking for a table with columns `id`, `feed_id`, `link`, `title`, `published` (matching the pattern in `import-feeds.js` which checks for `id`, `hostname`, `title`, `xml_url`, `html_url`)
  - **Source columns**: `id`, `feed_id`, `link`, `title`, `published`, `updated`, `added`
  - **Acceptance criteria**: Script reads source SQLite; accepts `--env local` or `--env remote`; detects or accepts table name; uses wrangler CLI to execute upserts; logs progress (e.g., "Imported 150 of 150 article(s) successfully")
  - **Depends on**: Create D1 migration for articles table

- [x] **Add npm script for importing articles**
  - **Story**: Story 7 — Owner imports existing articles into the app
  - **What**: Add an npm script entry in `package.json`: `"import-articles": "node scripts/import-articles.js"`
  - **Where**: `package.json` (`scripts` object)
  - **Acceptance criteria**: `npm run import-articles -- --env local path/to/source.sqlite` works
  - **Depends on**: Create articles import CLI script

- [x] **Create articles route handler**
  - **Story**: Story 1, 2, 3, 4, 5, 6 — All article-viewing user stories
  - **What**: Create `src/routes/articles.js` exporting `handleArticles` for `GET /feeds/:feedId/articles`. The handler:
    1. Reads feed ID from URL path parameter `c.req.param('feedId')`
    2. Fetches the feed metadata (title, hostname) via `getFeedById(db, feedId)`. If `null` (feed not found), return 404 with an error page
    3. Parses query parameters: `page` (integer, default 1), `from` (date string, optional), `to` (date string, optional). For `from`/`to`: validate that they are in YYYY-MM-DD format using a regex (`/^\d{4}-\d{2}-\d{2}$/`). If invalid format, set that parameter to `null` (silently ignore bad values). Store the validated values as `fromDate` and `toDate` — these are `null` when absent or invalid, or the validated YYYY-MM-DD string otherwise
    4. Call `getArticlesByFeedPaginated(db, feedId, page, fromDate, toDate)` to get `{ articles, total }`. Compute `totalPages = Math.max(1, Math.ceil(total / ARTICLES_PAGE_SIZE))`. If `page > totalPages`, clamp: set `page = totalPages` and call `getArticlesByFeedPaginated` again with the clamped page to get the correct articles. (This avoids a separate COUNT query and matches the effective outcome of the handleFeeds clamping pattern)
    5. Determine if filters are active: `const filtersActive = fromDate !== null || toDate !== null`
    6. Renders HTML inside a `<main>`:
       - Feed title and breadcrumb: `<h1>{feed_title}</h1>` and `<a href="/feeds">Back to Feeds</a>`
       - **Empty state** (`total === 0` and `filtersActive === false`): `<p>No articles available for this feed</p>`. No filter or pagination controls
       - **Empty state with filters** (`total === 0` and `filtersActive === true`): Show the filter form (so user can clear it) plus `<p>No articles match the current filter</p>`. No pagination controls
       - **With articles** (`total > 0`):
         - Date filter form: `<form method="GET" class="filter-form">` with `<input type="date" name="from" value="{fromDate ?? ''}">`, `<input type="date" name="to" value="{toDate ?? ''}">`, `<button type="submit">Filter</button>`, and `<a href="/feeds/{feedId}/articles">Clear</a>` (a plain link that reloads the page without any query params, effectively clearing all filters and resetting to page 1)
         - Article list: `<ul class="article-list">` where each `<li class="article-item">` shows:
           - If article has `link`: `<a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>`
           - If article has no `link`: `<span class="article-title">${escapeHtml(article.title)}</span>` (not clickable; `.article-title` is intentionally unstyled — it inherits default text styling)
           - Published date: `<span class="article-date">${formattedDate}</span>` where `formattedDate` is computed as: if `article.published` is non-null, `new Date(article.published).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })` (e.g., "Mar 23, 2026"); if NULL, the string `"Date unknown"`
         - Pagination controls (same structure as `/feeds`): Previous/Next links with disabled state on first/last page, page indicator. **Pagination links must preserve active filter params.** Build the base query string from active filters (e.g., `from=2026-01-01&to=2026-03-31`), then append `&page=N` for each link. E.g., `/feeds/{feedId}/articles?from=2026-01-01&to=2026-03-31&page=2`
    7. Returns `c.html(renderLayout({ title: \`${escapeHtml(feed.title)} Articles — Feed Reader\`, content, isAuthenticated: true }))`
  - **Where**: `src/routes/articles.js` (new file)
  - **Imports**: `renderLayout` from `../layout.js`, `{ getFeedById, getArticlesByFeedPaginated, ARTICLES_PAGE_SIZE }` from `../db.js`, `{ escapeHtml }` from `../html-utils.js`
  - **Acceptance criteria**: Displays correct feed title and articles; articles sorted newest first; date filtering works correctly; invalid date params silently ignored; pagination at 20 per page; pagination links preserve active filters; previous/next buttons disabled appropriately; empty state shown when zero articles (distinct messages for "no articles" vs "no matches"; filter form shown only in the "no matches" case); all user data HTML-escaped including link hrefs; article links open in new tab; NULL published dates show "Date unknown"; out-of-bounds pages clamp silently to last page with 200 status; feed-not-found returns 404
  - **Depends on**: Add articles query functions to database module

- [x] **Register articles route in main app**
  - **Story**: Cross-cutting (needed by Story 1, 3, 4, 5)
  - **What**: In `src/index.js`, add `import { handleArticles } from './routes/articles.js'` and register the route: `app.get('/feeds/:feedId/articles', handleArticles)`. Place it after the `/feeds` route. No changes to `PUBLIC_PATHS` — the route is automatically protected by `authMiddleware`
  - **Where**: `src/index.js`
  - **Acceptance criteria**: Route is registered; `/feeds/{feedId}/articles` is accessible to authenticated users; unauthenticated requests redirect to `/login?next=...`
  - **Depends on**: Create articles route handler

- [x] **Update Feeds page to add articles links**
  - **Story**: Story 9 — Owner can navigate from Feeds page to each feed's articles
  - **What**: Modify `src/routes/feeds.js` to add a second link to each feed's articles. Each feed `<li>` currently renders: `<a href="{html_url}" target="_blank">{title}</a> <span class="feed-hostname">{hostname}</span>`. Add an articles link after the hostname: `<a href="/feeds/${escapeHtml(feed.id)}/articles">Articles</a>`. The existing `display: flex` on `.feed-item` will align all three elements horizontally
  - **Where**: `src/routes/feeds.js`
  - **Acceptance criteria**: Every feed shows title link, hostname, and "Articles" link; all three are visible side-by-side; external link still opens in new tab; "Articles" link goes to correct feed's articles page
  - **Depends on**: Register articles route in main app

- [x] **Add CSS for articles page**
  - **Story**: Story 2, 3, 5, 6 — Styling for articles list, filters, and pagination
  - **What**: Append styles to `src/styles.css`. Use the existing CSS custom properties (`--color-background`, `--color-on-background`) and opacity patterns (like `.feed-hostname { opacity: 0.7 }`) to stay consistent with the dark theme:
    - `.article-list`: `list-style: none; padding: 0; margin: 0` — remove bullets
    - `.article-item`: `display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem` — stack title and date vertically
    - `.article-date`: `opacity: 0.6; font-size: 0.85em` — visually subordinate date (no hardcoded color — inherits from `--color-on-background` via opacity)
    - `.filter-form`: `margin-bottom: 1.5rem; padding: 1rem; border: 1px solid currentColor; border-radius: 4px; opacity: 0.85` — style filter controls with a border instead of a background color, compatible with dark theme
    - `.filter-form input, .filter-form button, .filter-form a`: `margin-right: 0.5rem` — space controls
    - No rule needed for `.article-title` — it is intentionally unstyled and inherits default text rendering
  - **Where**: `src/styles.css`
  - **Acceptance criteria**: Articles render without bullets; title and date are vertically stacked and spaced; filter form is visually distinct and works on dark background; buttons and inputs are properly spaced
  - **Depends on**: Create articles route handler

- [x] **Update tests for articles feature**
  - **Story**: Story 1, 2, 3, 4, 5, 6, 8, 9 — All articles-related functionality
  - **What**: In `test/index.spec.js`:

    **(0) Add test helpers:**
    - `seedArticles(articles)` — inserts article rows into the `articles` table using `env.DB.prepare(...).bind(...).run()`. Each article object has: `id`, `feed_id`, `link` (nullable), `title`, `published` (nullable), `updated` (nullable), `added` (nullable)
    - `clearArticles()` — runs `DELETE FROM articles`
    - In the new `describe('Articles page')` block, use `beforeEach` to call both `clearFeeds()` and `clearArticles()`, then seed at least one feed for the feed-exists tests

    **(1) Add a new `describe('Articles page')` block with tests:**

    - `GET /feeds/{feedId}/articles without a session redirects to login` — integration-style (SELF.fetch with `redirect: 'manual'`). Verify 302 and location header contains `/login?next=`
    - `GET /feeds/{nonexistent}/articles returns 404` — unit-style with auth. Verify 404 status
    - `GET /feeds/{feedId}/articles with valid session and no articles shows empty state` — seed a feed but no articles. Assert 200, body contains "No articles available", body does NOT contain `<form` or `<nav class="pagination">`
    - `GET /feeds/{feedId}/articles with seeded articles shows titles and dates sorted newest first` — seed ~5 articles with various publish dates. Assert they appear in reverse chronological order (check position of each title/date in body). Assert dates are formatted as human-readable (e.g., "Mar 23, 2026")
    - `GET /feeds/{feedId}/articles with NULL published date shows "Date unknown"` — seed article with NULL published. Verify body contains "Date unknown"
    - `GET /feeds/{feedId}/articles without filter returns all articles` — seed a few articles. Verify count by checking all titles appear
    - `GET /feeds/{feedId}/articles with from/to date filter returns only articles in range` — seed articles spanning a date range, request with `?from=DATE&to=DATE`. Assert only matching articles appear in body and others do not
    - `GET /feeds/{feedId}/articles with invalid date param ignores filter` — request with `?from=banana`. Assert all articles returned (filter silently ignored)
    - `GET /feeds/{feedId}/articles with filters active and no results shows filter form` — seed articles outside the filtered range. Assert body contains `<form` and "No articles match", does NOT contain `<ul class="article-list">`
    - `GET /feeds/{feedId}/articles?page=2 shows second page of articles` — seed 21 articles. Assert page 2 contains only the 21st article (oldest), assert "Page 2 of 2"
    - `GET /feeds/{feedId}/articles on page 1 disables Previous link` — assert `aria-disabled="true"` appears before "Previous"
    - `GET /feeds/{feedId}/articles on last page disables Next link` — assert no Next href beyond last page
    - `GET /feeds/{feedId}/articles?page=999 clamps to last page` — assert 200 and body shows last page content
    - `GET /feeds/{feedId}/articles pagination links preserve filter params` — seed >20 articles, request with `?from=DATE&to=DATE`. Assert Next link href contains both `page=` and `from=` and `to=`
    - `GET /feeds/{feedId}/articles HTML-escapes title and link` — seed article with `<script>` in title. Verify XSS prevention
    - `GET /feeds/{feedId}/articles article without link shows title as plain text` — seed article with NULL link. Verify `<span` appears, not `<a href`
    - `GET /feeds page shows articles link for each feed` — seed feeds, verify each has `href="/feeds/{feedId}/articles"`

  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: All auth-protected tests use unit-style pattern; public redirect test uses integration-style; all existing tests still pass; new tests cover articles functionality including filter-pagination interaction and both empty state variants
  - **Depends on**: Update Feeds page to add articles links, Add CSS for articles page, Register articles route in main app

- [ ] **Validate implementation end-to-end**
  - **Story**: All stories
  - **What**: Run through the complete workflow manually:
    1. Run migrations: `npx wrangler d1 migrations apply feed-reader-db --local`
    2. Verify tables exist: `npx wrangler d1 execute feed-reader-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"`
    3. Import test articles (requires a source SQLite file with an articles table — you must provide this): `npm run import-articles -- --env local path/to/source.sqlite`. If no source file is available, skip this step and manually insert a few article rows for testing
    4. Start dev server: `npm start`
    5. Open http://localhost:8787/ (log in if needed)
    6. Navigate to `/feeds`, verify each feed has an "Articles" link
    7. Click an "Articles" link, verify articles display for that feed in reverse chronological order
    8. Test pagination: verify Next/Previous work. Apply a date filter, verify pagination links preserve the filter params
    9. Test filter clear: click the "Clear" link, verify filter is removed and all articles show
    10. Test empty state: navigate to a feed with zero articles, verify empty message and no filter/pagination controls
    11. Test filter with no results: navigate to a feed with articles, apply a date range that matches nothing, verify filter form remains visible with "No articles match" message
    12. Test article links: click article titles, verify they open in new tab; verify non-linked articles show as plain text
    13. Run tests: `npm test`, verify all pass
    14. Kill the dev server to free the port
  - **Where**: Manual testing (local dev environment)
  - **Acceptance criteria**: Migrations apply successfully; articles import works (or rows inserted manually); articles display on `/feeds/:feedId/articles` route; pagination works (20 per page); pagination preserves filters; date filtering works; sorting is newest-first; both empty states display correctly; all automated tests pass
  - **Depends on**: All other tasks

---

## Implementation Notes (Post-completion)

All TODO items completed. Two minor deviations from the plan:

1. **`encodeURIComponent` on filter query params** — The plan specified building filter query strings as literal `from=2026-01-01&to=2026-03-31`. The implementation uses `encodeURIComponent(fromDate)` and `encodeURIComponent(toDate)`. Since YYYY-MM-DD dates contain no URL-special characters, this makes no observable difference but is more correct.

2. **Date formatting fix not in plan** — The plan specified `toLocaleDateString('en-US', { year, month, day })`. This was implemented exactly as specified, but tests revealed that the Cloudflare Workers runtime defaults to a non-UTC timezone, causing date-only strings (e.g. `2026-01-01`) to render as the previous day. Fixed by adding `timeZone: 'UTC'` to the options. The plan's architecture notes did not anticipate this; the fix is in `src/routes/articles.js:108`.

---

## Notes on Architecture

### Database Schema

The `articles` table stores imported article metadata:

```sql
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  feed_id TEXT,
  link TEXT,
  title TEXT,
  published TEXT,
  updated TEXT,
  added TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_feed_published ON articles(feed_id, published);
```

7 columns from source data plus `created_at` auto-managed timestamp. The composite index on `(feed_id, published)` supports the primary query pattern (articles for a specific feed sorted by published date) and also covers feed_id-only lookups via SQLite's leftmost-prefix rule — no separate single-column index on `feed_id` is needed.

**Note:** The `published` column stores dates as text. SQLite text comparison is used for date range filtering, which requires ISO 8601 format (e.g., `2026-03-23` or `2026-03-23T12:00:00Z`) stored in the source database. Verify source date format before importing.

### Query Functions

- **`getArticlesByFeedPaginated(db, feedId, page, fromDate, toDate)`** — retrieves articles for a specific feed. Builds WHERE clause dynamically: always includes `feed_id = ?`, optionally adds `published >= ?` and/or `published <= ?`. Both the COUNT and SELECT queries use the same WHERE clause so `total` reflects the filtered count. Uses `ORDER BY (published IS NULL), published DESC` to sort NULLs last. Returns `{ articles, total }`
- **`getFeedById(db, feedId)`** — retrieves feed metadata (title, hostname, etc.) needed for display. Returns `null` if not found
- **`ARTICLES_PAGE_SIZE = 20`** — used by route handlers for pagination math (separate from the existing `PAGE_SIZE = 50` for feeds)

### Page Clamping Strategy

The route handler calls `getArticlesByFeedPaginated` once with the user-supplied page. It uses the returned `total` to compute `totalPages`. If `page > totalPages`, it clamps `page = totalPages` and calls `getArticlesByFeedPaginated` again to fetch the correct articles. This avoids a separate COUNT-only query. For most requests (valid page numbers), only one call is made.

### Import Script

Similar to `import-feeds.js`, `import-articles.js`:
- Reads a source SQLite file (path as CLI argument)
- Auto-detects the articles table by looking for a table with columns `id`, `feed_id`, `link`, `title`, `published` (or accepts `--table` flag)
- Source columns: `id`, `feed_id`, `link`, `title`, `published`, `updated`, `added`
- Generates `INSERT ... ON CONFLICT(id) DO UPDATE` SQL statements
- Executes via `wrangler d1 execute` with `--local` or `--remote`
- Logs progress and completion count

### Articles Route URL Structure

- `/feeds/:feedId/articles` — paginated articles for a feed
- Query parameters: `?page=N`, `?from=YYYY-MM-DD`, `?to=YYYY-MM-DD`
- Example: `/feeds/bbc-news/articles?from=2026-01-01&to=2026-03-31&page=2`
- Pagination links preserve active filter parameters

### Date Filtering

- `from` and `to` are optional query parameters validated against `/^\d{4}-\d{2}-\d{2}$/`
- Invalid date values are silently ignored (treated as `null`)
- Both endpoints are inclusive: articles where `published >= from AND published <= to`
- Either endpoint can be used independently (from-only or to-only filtering works)
- When both are omitted, all articles are shown
- Submitting the filter form naturally resets pagination to page 1 (the form doesn't include a `page` input)
- If no articles match the filter, the filter form remains visible with a "No articles match" message so the user can adjust or clear
- "Clear" is implemented as a plain `<a href="/feeds/{feedId}/articles">` link that strips all query params

### Sorting and NULL Handling

- Articles sorted by `published DESC` (newest first) within each feed
- Articles with NULL `published` appear at the end via `ORDER BY (published IS NULL), published DESC`
- NULL-published articles have no stable sort order among themselves; this is acceptable for this app
- Front-end displays "Date unknown" for NULL published dates
- Date formatting: `new Date(published).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })` → "Mar 23, 2026"

### Empty State Logic

Two distinct empty states:
- **No articles for feed** (`total === 0` and `filtersActive === false`): Show "No articles available for this feed". No filter form, no pagination
- **No matches for filter** (`total === 0` and `filtersActive === true`): Show the filter form (so user can adjust or clear) plus "No articles match the current filter". No pagination

`filtersActive` is `true` if `fromDate !== null || toDate !== null` (i.e., at least one filter was provided and passed validation).

### Single-Feed, Single-User Model

- Articles are tied to a `feed_id`; URL route path includes the feed ID
- All articles for a logged-in user are visible (no per-user restrictions)
- All feeds and articles are visible to any authenticated user

### Authentication & Authorization

- The `/feeds/:feedId/articles` route is automatically protected by `authMiddleware` (not in `PUBLIC_PATHS`)
- Unauthenticated requests redirect to `/login?next=%2Ffeeds%2F{feedId}%2Farticles`
- No additional per-feed authorization logic (single-user app)

### Out of Scope

- Automatically fetching/crawling articles from feeds
- Marking articles as read/unread
- Article search or full-text indexing
- Per-user article preferences or history
- Article deletion or archive management
- Feed-to-article foreign key constraint (articles can reference deleted feeds; this is acceptable for a simple app)
