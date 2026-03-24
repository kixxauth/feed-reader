# Daily Reader View Implementation Plan

## Implementation Approach

Implement the feature as a new protected server-rendered route at `/reader` that follows the app's existing Hono + `renderLayout` pattern and uses a `?date=YYYY-MM-DD` query string. Keep UTC day-selection logic and the effective-date rule in a small shared helper module (`src/reader-utils.js`) so the route handler, database query, and tests all use the same definitions for "today", previous/next day, and the `published`-before-`added` date rule. Add the cross-feed query in `src/db.js` using `DATE(COALESCE(published, added))` for same-day matching (SQLite's `DATE()` handles both date-only strings like `2026-03-24` and full ISO timestamps like `2026-03-24T02:00:00.000Z`). The query returns flat joined rows; the route handler groups them by feed in JavaScript and renders the page with `renderLayout`. Wire the page into the shared authenticated navigation in `src/layout.js`, add focused styles, extend regression tests in `test/index.spec.js`, and update `MANUAL.md`.

**Performance note:** The cross-feed query cannot use the existing `idx_articles_feed_published` index (which is per-feed). For the expected dataset size (thousands of articles, not millions) a table scan is acceptable. If performance becomes an issue later, add an index on `DATE(COALESCE(published, added))` or a materialized effective-date column.

**Pagination:** The daily reader view does not paginate. It shows all matching articles for the selected day. This is acceptable because a single day's articles across all feeds is unlikely to exceed a manageable count. If this assumption is violated, pagination can be added later.

**Out of scope:** Per-user read tracking, article search, marking articles, and any changes to the existing `/feeds/:feedId/articles` per-feed articles page.

---

- [x] **Create reader date and UTC helpers**
  - **Story**: Change the selected day easily
  - **What**: Create a shared helper module that exports:
    1. `parseSelectedDate(raw)` — validates a `YYYY-MM-DD` string (regex `/^\d{4}-\d{2}-\d{2}$/`); returns the string if valid, or today's UTC date (`YYYY-MM-DD`) if invalid/absent.
    2. `getPreviousDate(dateStr)` / `getNextDate(dateStr)` — given a `YYYY-MM-DD` string, returns the previous/next day as `YYYY-MM-DD` in UTC.
    3. `formatDateForDisplay(dateStr)` — formats `YYYY-MM-DD` for the page heading, e.g. `"Tuesday, March 24, 2026"` (using `toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })`).
    All date math uses UTC to avoid timezone-shift bugs (matching the `timeZone: 'UTC'` fix already applied in `src/routes/articles.js`).
  - **Where**: `src/reader-utils.js` (new file)
  - **Acceptance criteria**: Valid `YYYY-MM-DD` input is returned as-is; invalid or missing input defaults to today's UTC date; previous/next date computation crosses month/year boundaries correctly; display format is human-readable and UTC-based.
  - **Depends on**: none

- [x] **Add cross-feed daily reader query to the database module**
  - **Story**: Open a day-focused reader view across all feeds
  - **What**: Add a new exported function `getDailyReaderArticles(db, selectedDate)` in `src/db.js` that accepts a `YYYY-MM-DD` string and returns flat joined rows from `feeds` and `articles`. The SQL should:
    - JOIN `articles` to `feeds` on `articles.feed_id = feeds.id`
    - Filter: `feeds.no_crawl = 0` (exclude disabled feeds)
    - Filter: `DATE(COALESCE(articles.published, articles.added)) = ?` (same-day match using the effective-date rule; SQLite's `DATE()` extracts `YYYY-MM-DD` from both date-only and full ISO timestamp formats)
    - SELECT columns: `feeds.id AS feed_id`, `feeds.title AS feed_title`, `articles.id AS article_id`, `articles.title AS article_title`, `articles.link AS article_link`, `articles.published AS article_published`, `articles.added AS article_added`
    - ORDER BY: `feeds.title ASC`, then `COALESCE(articles.published, articles.added) DESC`, then `articles.id ASC` (stable fallback)
    - Return `result.results` (flat array of row objects)
    The route handler will group these flat rows by `feed_id` in JavaScript, compute per-feed article counts, and sort the groups by count descending (with feed title ascending as tie-breaker). Sorting groups in JS rather than SQL avoids a subquery and keeps the SQL simple.
  - **Where**: `src/db.js`
  - **Acceptance criteria**: Only articles whose effective date (`published` when present, else `added`) matches the selected day are returned; disabled feeds (`no_crawl = 1`) are excluded; rows include enough metadata for the route handler to group by feed and render article links; the result set is empty (not an error) when no articles match.
  - **Depends on**: Create reader date and UTC helpers

- [x] **Create the reader route handler**
  - **Story**: Open a day-focused reader view across all feeds
  - **What**: Create a new route handler exporting `handleReader` for `GET /reader`. The handler should:
    1. Read the `date` query param via `c.req.query('date')` and resolve it with `parseSelectedDate()`.
    2. Call `getDailyReaderArticles(c.env.DB, selectedDate)` to get flat rows.
    3. Group rows by `feed_id` in JavaScript, producing an array of `{ feedId, feedTitle, articles: [...] }` objects, sorted by article count descending then feed title ascending.
    4. Render the page with `renderLayout({ title, content, isAuthenticated: true, currentPath: c.req.path })`:
       - A heading showing the formatted selected date (via `formatDateForDisplay`).
       - A date-picker row: `<input type="date" name="date">` inside a `<form method="GET" action="/reader">` with a Submit button, plus Previous/Next day links (`<a href="/reader?date=YYYY-MM-DD">`). Previous/next links always use explicit `?date=` values even when the current date is the default.
       - For each feed group: a section with the feed title as a heading (including article count), and a list of articles. Each article shows its title as a link (`<a href="..." target="_blank" rel="noopener noreferrer">`) when `article_link` is non-null, or as a `<span>` when null. Show the formatted effective date below each article title (using `toLocaleDateString` with `timeZone: 'UTC'`).
       - Empty state (no groups): show the same date controls and heading, plus a "No articles found for this date" message. Do not render empty feed-group shells.
    5. Import `escapeHtml` from `../html-utils.js` and escape all user-controlled data (feed titles, article titles, article links).
  - **Where**: `src/routes/reader.js` (new file)
  - **Acceptance criteria**: The page renders for authenticated users; date defaults to today UTC when absent; explicit `?date=` is honored; previous/next links navigate by one day; date picker submits to `/reader`; articles are grouped by feed; each group shows feed title and article count; articles without links render as plain text; all user data is HTML-escaped; empty state shows date controls with a clear message.
  - **Depends on**: Add cross-feed daily reader query to the database module

- [x] **Register the reader route in the Hono app**
  - **Story**: Make the reader view easy to revisit and navigate
  - **What**: In `src/index.js`, add `import { handleReader } from './routes/reader.js'` and register `app.get('/reader', handleReader)` alongside the existing protected routes (after the crawl-history routes). Do not add `/reader` to `PUBLIC_PATHS` in `src/auth/middleware.js` — it is automatically protected by `authMiddleware` and participates in the existing redirect-to-login pattern with `next=` preservation.
  - **Where**: `src/index.js`
  - **Acceptance criteria**: `GET /reader` is accessible to authenticated users and returns 200; unauthenticated requests redirect to `/login?next=%2Freader` (or with `?date=` preserved).
  - **Depends on**: Create the reader route handler

- [x] **Add the reader view to shared authenticated navigation**
  - **Story**: Make the reader view easy to revisit and navigate
  - **What**: In `src/layout.js`:
    1. Add a case to `getActiveSection()`: `if (currentPath.startsWith('/reader')) return 'reader';`
    2. Add a "Reader" link to the primary `<nav>` (e.g., `<a href="/reader">Reader</a>`) alongside the existing Home, Feeds List, and Crawl History links.
    3. Apply the same `nav-link-active` / `aria-current="page"` pattern used for the other sections.
    Keep all existing nav links intact.
  - **Where**: `src/layout.js`
  - **Acceptance criteria**: A "Reader" link appears in the shared header for authenticated pages; visiting `/reader` or `/reader?date=...` highlights the Reader nav link; existing nav links (Home, Feeds List, Crawl History, Logout) remain unchanged.
  - **Depends on**: Register the reader route in the Hono app

- [x] **Add reader-view and navigation styles**
  - **Story**: See results grouped by feed
  - **What**: Add CSS rules in `src/styles.css` for the reader page, following the existing dark-theme patterns (CSS custom properties, opacity for subordinate text, `currentColor` borders). Cover at minimum:
    - `.reader-date-controls` — horizontal flex row for the date picker, prev/next links, and submit button.
    - `.reader-feed-group` — container for one feed's section (light border or spacing to separate groups).
    - `.reader-feed-group-header` — feed title + article count heading.
    - `.reader-article-list` — list of articles within a group (reuse `.article-list` / `.article-item` / `.article-date` patterns if the markup matches, or add new classes if the structure differs).
    - Empty state — consistent with other pages' empty-state styling.
    No changes to existing CSS rules. The nav already handles additional links via flex-wrap.
  - **Where**: `src/styles.css`
  - **Acceptance criteria**: Feed groups are visually separated and each clearly identifies its feed; date controls are usable; the page is readable on the existing dark theme; the added nav link does not break the header layout on narrow viewports.
  - **Depends on**: Create the reader route handler; Add the reader view to shared authenticated navigation

- [x] **Add regression tests for the daily reader view**
  - **Story**: Apply the date rule consistently across all articles
  - **What**: Extend `test/index.spec.js` with a new `describe('Reader page')` block using the existing `seedFeeds`, `seedArticles`, `makeAuthenticatedRequest`, `clearFeeds`, `clearArticles`, `SELF.fetch`, and Worker execution-context patterns. Tests to include:
    1. **Auth redirect**: `GET /reader` without a session redirects to `/login?next=...` (integration-style with `SELF.fetch`).
    2. **Default date**: With `vi.useFakeTimers()` set to a known UTC date, `GET /reader` (no `?date=`) returns articles for that date and shows the date in the heading.
    3. **Explicit date**: `GET /reader?date=YYYY-MM-DD` returns articles matching that date.
    4. **Effective-date rule — published preferred**: Seed an article with both `published` and `added` on different days; request the `published` day and verify the article appears.
    5. **Effective-date rule — added fallback**: Seed an article with `published = null` and `added` on a known day; request that day and verify the article appears.
    6. **Disabled feeds excluded**: Seed a feed with `no_crawl = 1` and articles on the selected day; verify those articles do not appear.
    7. **Grouping by feed**: Seed articles across 2+ feeds on the same day; verify each feed title appears as a group heading.
    8. **Group ordering**: Seed feeds with different article counts on the same day; verify the feed with more articles appears first.
    9. **Article ordering within group**: Seed multiple articles in one feed on the same day with different timestamps; verify newest appears first.
    10. **Previous/next links**: Verify the rendered HTML contains `href="/reader?date=YYYY-MM-DD"` links for the day before and after the selected date.
    11. **Empty state**: Request a date with no matching articles; verify the "no articles" message appears, date controls remain, and no empty feed-group markup is rendered.
    12. **Nav link**: Verify the response body contains a link to `/reader` in the navigation.
    Use `beforeEach` to clear feeds and articles tables.
  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: Tests cover the effective-date rule (both branches), disabled-feed exclusion, grouping, ordering, date navigation, empty state, and auth protection; all existing tests continue to pass.
  - **Depends on**: Register the reader route in the Hono app; Add the reader view to shared authenticated navigation; Add reader-view and navigation styles

- [x] **Update the operations manual for the new reader feature**
  - **Story**: Apply the date rule consistently across all articles
  - **What**: Update `MANUAL.md`:
    1. Add `/reader` to the "Protected paths" list in §1 (Request Flow).
    2. Add a "Reader" subsection to §4 (Pages and Features) describing: the route (`/reader?date=YYYY-MM-DD`), the effective-date rule, UTC interpretation, disabled-feed exclusion, no pagination, and the date navigation controls.
    3. Add `src/reader-utils.js` and `src/routes/reader.js` to the file-structure notes in §12.
  - **Where**: `MANUAL.md`
  - **Acceptance criteria**: The reader view is listed as a protected route; its behavior (effective-date rule, UTC, disabled-feed exclusion) is documented; new source files are listed in the file structure section.
  - **Depends on**: Register the reader route in the Hono app
