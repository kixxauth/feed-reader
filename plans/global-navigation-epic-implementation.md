# Global Navigation Epic — Implementation Plan

## Implementation Approach

Extend the shared `renderLayout` function in `src/layout.js` (the single place authenticated chrome is assembled; see MANUAL.md §12) with primary links labeled Home, Feeds List, and Crawl History plus a visually separate Logout control, keeping the nav block before `${content}` so it precedes main page content. Add a `currentPath` option (string, default `'/'`) to `renderLayout` and implement an internal helper that maps path → active section (`'/'` exact → home; prefix `/feeds` or `/api/feeds` → feeds; prefix `/crawl-history` → crawl-history) and applies exactly one active treatment (`aria-current="page"` plus a CSS class `nav-link-active`) to the matching primary link. When `isAuthenticated` is false or `currentPath` is omitted, the nav header is not rendered — public pages (login, logged-out, callback access-denied) are unchanged.

Thread `currentPath: c.req.path` into every authenticated `renderLayout` invocation. For most route handlers this means adding the property directly to the `renderLayout` call. For the add-feed flow, `renderAddFeedPage` in `src/routes/add-feed.js` already receives the Hono context `c` and is the sole caller of `renderLayout` for all add-feed states — so modifying it once covers the GET handler and all ~17 POST re-renders from `src/routes/api/add-feed.js` without changing that file.

Add focused CSS rules in `src/styles.css` for header layout, active-state contrast, and separation between primary destinations and Logout. Do not remove or relocate existing page-level links and forms in `src/routes/feeds.js`, `feed-detail.js`, `articles.js`, `add-feed.js`, or `src/routes/crawl-history.js` unless a structural conflict appears. Extend `test/index.spec.js` to assert nav labels, `href` values, and representative active states.

**Out of scope:** Routes that call `renderLayout` with `isAuthenticated: false` (`callback.js`, `login.js`, `logged-out.js`) do not need changes since the nav header is omitted for unauthenticated pages.

---

- [x] **Nav markup, active-section helper, and `currentPath` option in `renderLayout`**
  - **Story**: Move between the app's main sections from any in-scope page; Understand where I am in the site; Keep logout available in the header; Use clear, stable labels for the primary destinations; Limit the change to the requested pages
  - **What**: Replace the current authenticated `<nav>` in `renderLayout` (`<nav><a href="/crawl-history">Crawl History</a> <a href="/logout">Logout</a></nav>`) with a structured header containing: (1) a primary `<nav>` with anchor links to `/` ("Home"), `/feeds` ("Feeds List"), and `/crawl-history` ("Crawl History") using those exact labels; (2) a visually separate Logout control (e.g. in a secondary group with `aria-label="Account"`) linking to `/logout`. Add a `currentPath` parameter to the function signature (string, default `'/'`). Implement an internal helper that maps `currentPath` to the active section using these rules: exact match `'/'` → home; prefix `/feeds` → feeds; prefix `/api/feeds` → feeds; prefix `/crawl-history` → crawl-history; no match → no active state. Apply `aria-current="page"` and class `nav-link-active` to exactly one matching primary link. When `isAuthenticated` is false, continue to omit the header entirely (no change to public pages).
  - **Where**: `src/layout.js`
  - **Acceptance criteria**: Nav appears only for authenticated layout; includes correct labels and destinations (Home → `/`, Feeds List → `/feeds`, Crawl History → `/crawl-history`); nav appears before main content; only one primary item is active at a time; detail URLs under `/feeds/...` and `/crawl-history/...` highlight Feeds List and Crawl History respectively; `/api/feeds/...` paths highlight Feeds List; Logout remains visible and visually distinct from the three destinations; labels stable across pages; when `currentPath` is omitted, no link is marked active.
  - **Depends on**: none

- [x] **Styles for app header, primary nav, active state, and Logout separation**
  - **Story**: Understand where I am in the site; Keep logout available in the header
  - **What**: Add CSS rules for the new header wrapper, primary nav links, and Logout: horizontal flex layout that wraps on narrow screens; clear hover/focus styles; a visually distinct active state using the `nav-link-active` class (not color alone — use underline, font-weight, or background); Logout styled as an account action visually separated from the three primary destinations (via spacing, grouping, or typographic treatment).
  - **Where**: `src/styles.css`
  - **Acceptance criteria**: Active state is visually distinct from inactive links by more than color alone; Logout is visually separate from Home / Feeds List / Crawl History; layout remains usable on narrow viewports.
  - **Depends on**: Nav markup, active-section helper, and `currentPath` option in `renderLayout`

- [x] **Pass `currentPath` from `GET /` handler**
  - **Story**: Move between the app's main sections from any in-scope page; Understand where I am in the site
  - **What**: In the inline home handler in `src/index.js`, add `currentPath: c.req.path` to the `renderLayout` call alongside `isAuthenticated: true`. Keep the existing `<a href="/feeds">Feeds</a>` link in the page content — it remains a useful entry point.
  - **Where**: `src/index.js`
  - **Acceptance criteria**: `/` shows global nav with Home active; Home link targets `/`; existing `/feeds` link in page content is preserved.
  - **Depends on**: Nav markup, active-section helper, and `currentPath` option in `renderLayout`

- [x] **Pass `currentPath` from feeds-section route handlers**
  - **Story**: Move between the app's main sections from any in-scope page; Understand where I am in the site; Keep secondary page actions understandable
  - **What**: Add `currentPath: c.req.path` to the `renderLayout` call in each of these handlers: (1) `handleFeeds` in `src/routes/feeds.js` (one call). (2) `renderAddFeedPage` in `src/routes/add-feed.js` (one call — since this function already receives the Hono context `c` and is the sole `renderLayout` caller for the add-feed flow, this single change also covers all ~17 POST re-renders in `src/routes/api/add-feed.js`; no changes needed in that file). (3) `handleFeedDetail` in `src/routes/feed-detail.js` (two calls: successful render and 404). (4) `handleArticles` in `src/routes/articles.js` (two calls: articles list and 404). Do not change Add Feed button, pagination, toggle forms, returnTo values, date filter, back links, or any other page-specific UI.
  - **Where**: `src/routes/feeds.js`, `src/routes/add-feed.js`, `src/routes/feed-detail.js`, `src/routes/articles.js`
  - **Acceptance criteria**: `/feeds` shows nav with Feeds List active; `/feeds/add` (GET and all POST re-render states) shows nav with Feeds List active; `/feeds/:feedId` highlights Feeds List (including 404); `/feeds/:feedId/articles` highlights Feeds List (including 404); all page-specific actions (Add Feed, pagination, toggle, filters, back links) remain unchanged.
  - **Depends on**: Nav markup, active-section helper, and `currentPath` option in `renderLayout`

- [x] **Pass `currentPath` from crawl-history and toggle-crawl handlers**
  - **Story**: Move between the app's main sections from any in-scope page; Understand where I am in the site; Keep secondary page actions understandable; Limit the change to the requested pages
  - **What**: Add `currentPath: c.req.path` to all authenticated `renderLayout` calls in: (1) `handleCrawlHistory` in `src/routes/crawl-history.js` (one call). (2) `handleCrawlHistoryDetail` in `src/routes/crawl-history.js` (two calls: detail render and 404). (3) `handleToggleFeedCrawl` 404 response in `src/routes/api/toggle-feed-crawl.js` (one call — the success path is a 303 redirect and produces no HTML). Keep "Back to Feeds", "Back to Crawl History", run list links, and detail row links as they are. Do not change redirect or toggle behavior.
  - **Where**: `src/routes/crawl-history.js`, `src/routes/api/toggle-feed-crawl.js`
  - **Acceptance criteria**: `/crawl-history` highlights Crawl History; `/crawl-history/:crawlRunId` highlights Crawl History (including 404); toggle-crawl 404 highlights Feeds List (path is `/api/feeds/...`); toggle POST success path still 303 redirects; page-local navigation unchanged.
  - **Depends on**: Nav markup, active-section helper, and `currentPath` option in `renderLayout`

- [x] **Vitest coverage for global navigation**
  - **Story**: Move between the app's main sections from any in-scope page; Understand where I am in the site; Keep logout available in the header; Use clear, stable labels for the primary destinations
  - **What**: Extend `test/index.spec.js` (or a focused spec) using the `makeAuthenticatedRequest` / `SELF.fetch` patterns already in the test file: for representative routes (`/`, `/feeds`, `/feeds/add`, a feed detail URL with seeded data, an articles URL with seeded data, `/crawl-history`, a crawl detail with seeded run), assert response bodies contain the three nav labels ("Home", "Feeds List", "Crawl History"), correct `href` targets (`/`, `/feeds`, `/crawl-history`), a Logout link to `/logout`, and `aria-current="page"` (or the `nav-link-active` class) on the expected active link only. Add at least one check per section that an existing page-specific element still appears (e.g. "Add Feed" on `/feeds`, "Back to Feeds" on crawl-history, filter form on articles).
  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: Automated regression for nav labels, URLs, active highlighting per section, and presence of Logout; confirms local page actions are not accidentally dropped by the layout change.
  - **Depends on**: Styles for app header, primary nav, active state, and Logout separation; Pass `currentPath` from `GET /` handler; Pass `currentPath` from feeds-section route handlers; Pass `currentPath` from crawl-history and toggle-crawl handlers
