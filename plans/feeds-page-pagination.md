# Implementation Plan: Feeds Page with Pagination

## Implementation Approach

Move the feeds list from the home page to a dedicated `/feeds` route with server-rendered pagination (50 feeds per page). The home page becomes a minimal landing page with a link to the Feeds page. The `escapeHtml` utility in `src/index.js` must be extracted to a shared module so the new feeds route can use it. Pagination uses `<a>` links with `?page=N` query parameters — no client-side JavaScript is needed. Existing tests that assert home page feed rendering must be updated to target `/feeds` instead, and new tests must cover pagination behavior.

**Note:** The `/feeds` path is not in the `PUBLIC_PATHS` set in `src/auth/middleware.js`, so it is automatically protected by auth — no middleware changes needed.

---

## Implementation Tasks

- [x] **Extract `escapeHtml` to a shared utility module**
  - **Story**: Cross-cutting (needed by Story 1, Story 4)
  - **What**: Move the `escapeHtml` function from `src/index.js` into a new file `src/html-utils.js` and export it as a named export. Update `src/index.js` to `import { escapeHtml } from './html-utils.js'` in place of the local function definition. The home route still uses `escapeHtml` at this point, so the import must remain.
  - **Where**: `src/html-utils.js` (new file), `src/index.js`
  - **Acceptance criteria**: `escapeHtml` is importable from `src/html-utils.js`; `src/index.js` still works after the import change; the function is not duplicated anywhere
  - **Depends on**: none
  - **Deviation**: The plan said `src/index.js` should temporarily import `escapeHtml` during this step, then remove it in the "Simplify home page" step. In practice both tasks were done together: `src/index.js` never imported from `html-utils.js` because the home page simplification happened simultaneously. No functional impact.

- [x] **Add paginated feeds query to database module**
  - **Story**: Story 1, Story 5
  - **What**: Add a new exported function `getFeedsPaginated(db, page)` and an exported constant `PAGE_SIZE = 50` to `src/db.js`. The function takes a 1-indexed page number. If `page` is less than 1, clamp it to 1. It runs two D1 queries:
    1. `db.prepare('SELECT COUNT(*) AS total FROM feeds').first()` — returns a single row object; read the count as `row.total`.
    2. `db.prepare('SELECT * FROM feeds ORDER BY hostname ASC LIMIT ? OFFSET ?').bind(PAGE_SIZE, (page - 1) * PAGE_SIZE).all()` — access rows as `result.results`.
    Returns `{ feeds, total }` where `feeds` is the row array and `total` is the integer count.
  - **Where**: `src/db.js`
  - **Acceptance criteria**: Returns correct slice of feeds sorted by hostname; returns integer total count; page < 1 is clamped to 1; offset math is correct (page 1 → offset 0, page 2 → offset 50)
  - **Depends on**: none

- [x] **Create feeds route handler**
  - **Story**: Story 1, Story 2, Story 3, Story 4, Story 5
  - **What**: Create `src/routes/feeds.js` exporting `handleFeeds` for `GET /feeds`. Import `renderLayout` from `../layout.js`, `{ getFeedsPaginated, PAGE_SIZE }` from `../db.js`, and `{ escapeHtml }` from `../html-utils.js`. The handler:
    1. Reads `c.req.query('page')`, parses with `parseInt`, defaults to 1 if missing, `NaN`, or < 1.
    2. Computes `totalPages` and clamps `page` **before** querying for feed data. Specifically:
       a. Run the count query: `db.prepare('SELECT COUNT(*) AS total FROM feeds').first()` to get `total`.
       b. Compute `totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))`.
       c. If `page > totalPages` and `total > 0`, clamp `page` to `totalPages`.
       d. Then call `getFeedsPaginated(c.env.DB, page)` with the (possibly clamped) page to get `{ feeds, total }`.
       Return a 200 — do not redirect.

       **Implementation note**: To avoid running the count query twice (once here for clamping, once inside `getFeedsPaginated`), refactor `getFeedsPaginated` to accept an already-clamped page and trust the caller. Alternatively, have `getFeedsPaginated` return the count first and the caller can decide whether to re-call with a clamped page. The simplest correct approach: run the count query in the handler, compute `totalPages`, clamp `page`, then call `getFeedsPaginated(db, clampedPage)` which will run its own count query (a minor redundancy, but keeps the db function simple and self-contained). Choose whichever you prefer — the key requirement is that out-of-bounds pages return data for the last page, not an empty result.
    3. Renders HTML inside a `<main>`:
       - `<h1>Feeds</h1>`
       - **Empty state** (`total === 0`): `<p>No feeds available</p>`. No pagination controls.
       - **With feeds**: `<ul class="feed-list">` where each `<li class="feed-item">` contains `<a href="{html_url}" target="_blank" rel="noopener noreferrer">{title}</a>` and `<span class="feed-hostname">{hostname}</span>`. All interpolated values escaped with `escapeHtml`. (Note: the existing home page does not use `target="_blank"` on links — this is an intentional addition.)
       - **Pagination controls** (only when `total > 0`): `<nav class="pagination">` containing:
         - Previous: `<a aria-disabled="true">Previous</a>` (no `href`) when on page 1; otherwise `<a href="/feeds?page={page-1}">Previous</a>`.
         - `<span>Page {current} of {totalPages}</span>`
         - Next: `<a aria-disabled="true">Next</a>` (no `href`) when on last page; otherwise `<a href="/feeds?page={page+1}">Next</a>`.
    4. Returns `c.html(renderLayout({ title: 'Feeds — Feed Reader', content, isAuthenticated: true }))`.
  - **Where**: `src/routes/feeds.js` (new file)
  - **Acceptance criteria**: 50 feeds per page; sorted by hostname; current page and total pages displayed; Previous disabled on page 1; Next disabled on last page; empty state shown when zero feeds; all user data HTML-escaped; links open in new tab; out-of-bounds page renders last page with 200 status
  - **Depends on**: Extract `escapeHtml` to a shared utility module, Add paginated feeds query to database module
  - **Implementation choice**: The "minor redundancy" path was taken — the handler runs its own COUNT query to determine `totalPages` and clamp the page, then calls `getFeedsPaginated` which runs a second COUNT internally. This keeps `getFeedsPaginated` self-contained (it doesn't need to trust a pre-clamped caller) at the cost of two COUNT queries per request.

- [x] **Simplify home page and register feeds route**
  - **Story**: Story 6
  - **What**: In `src/index.js`:
    1. Add `import { handleFeeds } from './routes/feeds.js'` alongside the other route imports.
    2. Register `app.get('/feeds', handleFeeds)` alongside the other route registrations (after the public auth routes, before or alongside the home route).
    3. Replace the home route handler body: remove the `getAllFeedsSortedByHostname` call and all feed rendering. The new body renders `<main>` with `<h1>Feed Reader</h1>` and `<a href="/feeds">Feeds</a>`. The home page no longer shows any feed data or empty state messages.
    4. Remove the now-unused `import { getAllFeedsSortedByHostname } from './db.js'`.
    5. Remove the now-unused `import { escapeHtml } from './html-utils.js'` (the home route no longer renders feed data, so it no longer needs escaping).
  - **Where**: `src/index.js`
  - **Acceptance criteria**: Home page renders a simple landing page without querying the database; contains a "Feeds" link pointing to `/feeds`; `/feeds` route is registered and accessible; no unused imports remain in `src/index.js`
  - **Depends on**: Create feeds route handler

- [x] **Remove unused `getAllFeedsSortedByHostname` from database module**
  - **Story**: Cleanup
  - **What**: Remove the `getAllFeedsSortedByHostname` function from `src/db.js`. Verify with a grep that nothing in the codebase still imports or references it before deleting.
  - **Where**: `src/db.js`
  - **Acceptance criteria**: Function is removed; no remaining references in the codebase
  - **Depends on**: Simplify home page and register feeds route

- [x] **Add CSS for feed list and pagination controls**
  - **Story**: Story 2
  - **What**: Append styles to `src/styles.css` (the existing stylesheet has no feed or pagination styles):
    - `.feed-list`: `list-style: none; padding: 0; margin: 0` — remove default bullets and indent.
    - `.feed-item`: `display: flex; gap: 0.5rem; align-items: baseline` — place title link and hostname on one line with spacing.
    - `.feed-hostname`: `opacity: 0.7; font-size: 0.85em` — visually subordinate the hostname to the title.
    - `.pagination`: `display: flex; gap: 1rem; align-items: center; margin-top: 1rem` — lay out prev/page/next horizontally.
    - `.pagination a[aria-disabled="true"]`: `opacity: 0.4; pointer-events: none; cursor: default` — mute and disable interaction on disabled nav links.
  - **Where**: `src/styles.css`
  - **Acceptance criteria**: Feed list has no bullet markers; feed items display title and hostname on one line; pagination links are visible; disabled state is visually distinct and non-interactive
  - **Depends on**: Create feeds route handler

- [x] **Update existing tests and add feeds page tests**
  - **Story**: Story 1, Story 2, Story 3, Story 4, Story 5, Story 6
  - **What**: In `test/index.spec.js`:

    **(1) Update the `Authenticated access` describe block:**
    - Keep the `"GET / with a valid session returns 200 with Logout link"` test as-is.
    - Remove the three feed-specific tests: `"GET / with no feeds shows empty state message"`, `"GET / with seeded feeds shows feed titles and hostnames sorted by hostname"`, and `"GET / with seeded feeds HTML-escapes feed data"`. These assertions move to the new `/feeds` tests below.
    - Add a new test: `"GET / contains a link to /feeds and does not render feed data"` — use the unit-style pattern (`makeAuthenticatedRequest` → `worker.fetch(request, env, ctx)` → `waitOnExecutionContext(ctx)`). Assert the body contains `href="/feeds"` and does NOT contain `<ul class="feed-list">`.
    - The `beforeEach(clearFeeds)` can remain (harmless) or be removed since the home page no longer queries feeds.

    **(2) Add a new `describe('Feeds page')` block with `beforeEach(clearFeeds)`:**

    All authenticated tests below use the **unit-style pattern**: call `makeAuthenticatedRequest(url)` to get a `Request`, then `worker.fetch(request, env, ctx)` + `waitOnExecutionContext(ctx)` to get the `Response`. This matches the existing authenticated test pattern.

    - `GET /feeds without a session redirects to /login?next=%2Ffeeds` — use **integration-style**: `SELF.fetch('http://example.com/feeds', { redirect: 'manual' })`. The `redirect: 'manual'` option is required to capture the 302 instead of following it. Assert status 302 and `location` header value `/login?next=%2Ffeeds`.
    - `GET /feeds with valid session and no feeds shows "No feeds available"` — assert 200, body contains `"No feeds available"`, body does NOT contain `<nav class="pagination">`.
    - `GET /feeds with seeded feeds shows titles and hostnames sorted by hostname` — same assertion pattern as the removed home page test, but targeting `http://example.com/feeds`.
    - `GET /feeds HTML-escapes feed data` — same XSS assertion pattern as the removed home page test, targeting `http://example.com/feeds`.
    - `GET /feeds?page=2 shows second page` — seed 51 feeds (one more than PAGE_SIZE) to exercise the page boundary. Generate feeds programmatically: `Array.from({ length: 51 }, (_, i) => ({ id: \`feed-${i}\`, hostname: \`host-${String(i).padStart(3, '0')}.example.com\`, title: \`Feed ${i}\`, html_url: \`https://host-${String(i).padStart(3, '0')}.example.com\` }))`. Assert body contains `"Page 2 of 2"` and shows only the 51st feed (by sort order: `host-050`).
    - `GET /feeds?page=1 disables Previous link` — assert body contains `aria-disabled="true"` adjacent to "Previous" and does NOT contain `href="/feeds?page=0"`.
    - `GET /feeds on last page disables Next link` — assert body contains `aria-disabled="true"` adjacent to "Next" and does NOT contain a Next href beyond the last page.
    - `GET /feeds?page=0 clamps to page 1` — assert 200 and body shows page 1 content (e.g., `"Page 1 of"`).
    - `GET /feeds?page=999 clamps to last page` — seed a few feeds, assert 200 and body shows the last page (e.g., `"Page 1 of 1"`).

  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: All existing non-feed tests pass unchanged; home page test updated to match new landing page; new tests cover: auth protection, empty state, sort order, XSS escaping, pagination navigation, disabled states, and invalid/out-of-bounds page parameters
  - **Depends on**: Simplify home page and register feeds route, Add CSS for feed list and pagination controls
