# Implementation Plan: Server-Side Rendering View Layer Cleanup

## Implementation Approach

This refactor keeps the existing Hono route structure and Cloudflare Worker deployment model intact while moving HTML generation from manual string concatenation with `escapeHtml()` calls to Hono's `html` tagged template literal from `hono/html`, which auto-escapes all interpolated values. The `raw()` helper (also from `hono/html`) is used when trusted HTML must be injected without escaping (e.g., inlined CSS, pre-built HTML notices). Partials are plain functions that return `HtmlEscapedString` via the `html` tag; nesting one `html` result inside another composes without double-escaping. The existing `escapeHtml()` utility from `src/html-utils.js` must be removed from all migrated code — using it inside an `html` template would double-encode.

The migration is incremental: convert the shared layout first with a `raw()` bridge so unmigrated routes can continue passing plain string `content`, then migrate routes one at a time. Each page migration extracts a view module under `src/views/` and rewires the route handler to call it. Tests are updated after each migration group to catch regressions early rather than deferring all verification to the end.

**Out of scope:** Changes to route URLs, status codes, redirect behavior, query parameters, form workflows, database queries, authentication, or CSS. The rendering output should be visually and structurally identical after migration.

---

- [x] **Convert the shared layout to use the `html` tagged template**
  - **Story**: Adopt an incremental rendering pattern that fits Hono on Workers
  - **What**: Refactor `renderLayout` to use `import { html, raw } from 'hono/html'` instead of a template literal string. The CSS must be injected via `raw(styles)` since it contains `<`, `>`, and `"` characters that would otherwise be escaped. The `content` parameter — currently a plain string from unmigrated routes — must be wrapped in `raw(content)` so existing callers continue working during the migration. Once all routes are migrated and pass `HtmlEscapedString` values, remove the `raw()` wrapper on `content`. The `title` parameter must also use `raw(title)` during migration since some routes pre-escape it (e.g., `reader.js` passes `escapeHtml(displayDate)` in the title); after migration, titles should be passed unescaped and the `html` tag will handle escaping. Preserve the `getActiveSection` helper, nav structure, and `isAuthenticated` behavior unchanged.
  - **Where**: `src/layout.js`
  - **Acceptance criteria**: `renderLayout` returns an `HtmlEscapedString`; all existing routes continue to produce identical HTML output without modification; CSS renders correctly (not escaped); nav markup and active-section highlighting are preserved; `c.html()` accepts the return value without error.
  - **Depends on**: none

- [x] **Create shared SSR partial helpers**
  - **Story**: Reduce duplication in common page fragments
  - **What**: Create a module exporting partial functions that return `HtmlEscapedString` via the `html` tag. Include: `notFoundPage(message?)` — renders `<main><h1>Not Found</h1><p>${message}</p></main>` (defaults to "Page not found."); `noticeBanner(type, contentHtml)` — renders a `<div class="notice notice-{type}">` block where `contentHtml` is a pre-built `HtmlEscapedString` from an `html` call (not a raw string). Do NOT extract badges, pagination, or back-links as shared partials — these are page-specific and used in only 1–2 places each.
  - **Where**: `src/views/partials.js`
  - **Acceptance criteria**: Each partial returns `HtmlEscapedString`; `notFoundPage()` produces the same markup currently in toggle-feed-crawl.js and toggle-featured.js 404 blocks; partials compose correctly when nested in an `html` template.
  - **Depends on**: Convert the shared layout to use the `html` tagged template

- [x] **Migrate public auth pages and home page, then verify with tests**
  - **Story**: See the same pages and workflows after the rendering refactor
  - **What**: Create `src/views/pages/login.js` (exports `loginPage(authStartUrl)`), `src/views/pages/logged-out.js` (exports `loggedOutPage()`), and `src/views/pages/home.js` (exports `homePage()`). Each returns the `content` portion as `HtmlEscapedString` via the `html` tag. Update the route handlers in `src/routes/login.js`, `src/routes/logged-out.js`, and the inline home handler in `src/index.js` to import and call the view function, passing the result as `content` to `renderLayout`. For the callback access-denied case in `src/routes/callback.js`, convert its small error content inline to `html` — it does not need its own view file. Remove `escapeHtml` imports from migrated files. Update `test/index.spec.js` to assert these pages still return 200 with expected content strings (login link text, logged-out message, home page heading).
  - **Where**: `src/views/pages/login.js` (new), `src/views/pages/logged-out.js` (new), `src/views/pages/home.js` (new), `src/routes/login.js`, `src/routes/logged-out.js`, `src/routes/callback.js`, `src/index.js`, `test/index.spec.js`
  - **Acceptance criteria**: `/login` returns 200 with "Login with GitHub" link; `/logged-out` returns 200 with expected content; `/` returns 200 with "Feed Reader" heading and `/feeds` link; `/auth/callback` with bad state returns 403 with error content; no `escapeHtml` calls in migrated view code; existing tests pass; new assertions verify basic rendering.
  - **Depends on**: Create shared SSR partial helpers

- [x] **Replace duplicated 404 responses in feed toggle APIs**
  - **Story**: Reduce duplication in common page fragments
  - **What**: Update the 404 blocks in `handleToggleFeedCrawl` and `handleToggleFeatured` to use `notFoundPage('Feed not found.')` from `src/views/partials.js` instead of inline HTML strings. Replace the `import { renderLayout }` with imports of both `renderLayout` and `notFoundPage`. Remove the `escapeHtml` import if no longer used in these files (currently it isn't used in either).
  - **Where**: `src/routes/api/toggle-feed-crawl.js`, `src/routes/api/toggle-featured.js`
  - **Acceptance criteria**: Both handlers return 404 with identical visible content to current behavior; `notFoundPage` partial is used instead of inline strings; toggle POST success paths (303 redirect) are unchanged.
  - **Depends on**: Create shared SSR partial helpers

- [x] **Migrate the Add Feed page view and route**
  - **Story**: Continue to receive safe, readable content on dynamic pages
  - **What**: Create `src/views/pages/add-feed.js` exporting view functions that use the `html` tag to render each add-feed state: URL form, fallback form, selection list, and confirmation section. Move `buildUrlForm`, `buildSelectionSection`, and `buildConfirmationSection` from `src/routes/add-feed.js` into the new view module, converting from string concatenation to `html` templates. The `state.errorHtml` field (pre-built trusted HTML for duplicate-feed notices) must be passed as an `HtmlEscapedString` from the caller or wrapped in `raw()` at the view boundary — document this in a code comment. Update `renderAddFeedPage` in `src/routes/add-feed.js` to call the new view functions. The `serializeAddFeedState` and `deserializeAddFeedState` helpers stay in `src/routes/add-feed.js` (they are route logic, not view logic). No changes to `src/routes/api/add-feed.js` — it calls `renderAddFeedPage` which is the integration point. Remove `escapeHtml` calls from all markup that moves to `html` templates. Add test assertions to `test/index.spec.js` verifying: GET `/feeds/add` returns 200 with the URL form; POST add-feed with invalid URL returns the error notice.
  - **Where**: `src/views/pages/add-feed.js` (new), `src/routes/add-feed.js`, `test/index.spec.js`
  - **Acceptance criteria**: All add-feed states render identically to current output; `errorHtml` trusted content renders without double-escaping; `escapeHtml` removed from migrated markup; serialization helpers stay in route file; `src/routes/api/add-feed.js` requires no changes; new test assertions pass.
  - **Depends on**: Create shared SSR partial helpers

- [x] **Migrate the Feeds list page view and route**
  - **Story**: Continue to see clear, consistent page structure
  - **What**: Create `src/views/pages/feeds.js` exporting a view function that receives prepared data (feeds array, pagination state, filter state, banner HTML) and returns the page content as `HtmlEscapedString`. Move the feed-item `.map()`, pagination link construction, filter controls, empty states, and `buildAddFeedBanner` from `src/routes/feeds.js` into the view module, converting to `html` templates. The route handler retains query parsing, database calls, page clamping, and banner state preparation. Remove `escapeHtml` from migrated markup. Add test assertions verifying: GET `/feeds` returns 200 with "Feeds" heading; pagination renders when >50 feeds exist; disabled filter link is present.
  - **Where**: `src/views/pages/feeds.js` (new), `src/routes/feeds.js`, `test/index.spec.js`
  - **Acceptance criteria**: `/feeds` renders identically; pagination links preserve `disabled` and `page` query params; add-feed banner renders when `addedFeedId` and `crawlRunId` are present; `escapeHtml` removed from migrated markup; new test assertions pass.
  - **Depends on**: Create shared SSR partial helpers

- [x] **Migrate the Feed Detail page view and route**
  - **Story**: Continue to see clear, consistent page structure
  - **What**: Create `src/views/pages/feed-detail.js` exporting a view function for the feed detail page and a not-found view. Move metadata rows, badges, recent activity output, action links, and toggle forms from `src/routes/feed-detail.js`, converting to `html` templates. The route handler retains data fetching, list-context URL construction, and the 404 branch (calling the not-found view). Remove `escapeHtml` from migrated markup. Add test assertion: GET `/feeds/:feedId` returns 200 with feed title for a seeded feed.
  - **Where**: `src/views/pages/feed-detail.js` (new), `src/routes/feed-detail.js`, `test/index.spec.js`
  - **Acceptance criteria**: Feed detail page renders identically; back-link and toggle `returnTo` targets are preserved; 404 case renders not-found content with 404 status; `escapeHtml` removed from migrated markup; new test assertion passes.
  - **Depends on**: Create shared SSR partial helpers

- [x] **Migrate the Articles page view and route**
  - **Story**: Continue to receive safe, readable content on dynamic pages
  - **What**: Create `src/views/pages/articles.js` exporting a view function that renders article rows, date-filter controls, pagination, empty states, and a not-found view. Move markup from `src/routes/articles.js`, converting to `html` templates. The route handler retains query parsing, page clamping, filter preservation, database calls, and back-link context. Remove `escapeHtml` from migrated markup. Add test assertion: GET `/feeds/:feedId/articles` returns 200 with expected content for a seeded feed.
  - **Where**: `src/views/pages/articles.js` (new), `src/routes/articles.js`, `test/index.spec.js`
  - **Acceptance criteria**: Articles page renders identically; date filter and pagination preserve query params; 404 case renders not-found content; `escapeHtml` removed from migrated markup; new test assertion passes.
  - **Depends on**: Create shared SSR partial helpers

- [x] **Migrate the Crawl History page views and routes**
  - **Story**: See the same pages and workflows after the rendering refactor
  - **What**: Create `src/views/pages/crawl-history.js` exporting view functions for the crawl history list page and the crawl run detail page. Move list summaries, detail tables, failed-only filter controls, empty states, and not-found output from `src/routes/crawl-history.js`, converting to `html` templates. The route handlers retain data fetching, filtering logic, and 404 branching. Remove `escapeHtml` from migrated markup. Add test assertions: GET `/crawl-history` returns 200; GET `/crawl-history/:id` returns 200 for a seeded run and 404 for a nonexistent one.
  - **Where**: `src/views/pages/crawl-history.js` (new), `src/routes/crawl-history.js`, `test/index.spec.js`
  - **Acceptance criteria**: Both crawl history pages render identically; filter controls preserve query params; back links work; 404 returns correct status; `escapeHtml` removed from migrated markup; new test assertions pass.
  - **Depends on**: Create shared SSR partial helpers

- [x] **Migrate the Reader page view and route**
  - **Story**: Continue to receive safe, readable content on dynamic pages
  - **What**: Create `src/views/pages/reader.js` exporting a view function that receives prepared data (featured groups, regular groups, date controls state, display date) and returns page content as `HtmlEscapedString`. Move the date controls, feed group rendering, featured/regular section assembly, and empty state from `src/routes/reader.js`, converting to `html` templates. The route handler retains date parsing, database query, grouping logic, and featured/regular sorting. Remove `escapeHtml` from migrated markup. Add test assertion: GET `/reader` returns 200 with the date heading.
  - **Where**: `src/views/pages/reader.js` (new), `src/routes/reader.js`, `test/index.spec.js`
  - **Acceptance criteria**: Reader page renders identically; date controls and Previous/Next links work; featured and regular sections render correctly; empty state shows message; `escapeHtml` removed from migrated markup; new test assertion passes.
  - **Depends on**: Create shared SSR partial helpers

- [x] **Remove the `raw()` bridge from `renderLayout` and clean up `html-utils.js`**
  - **Story**: Keep the migration safe and easy to verify
  - **What**: Now that all routes pass `HtmlEscapedString` content to `renderLayout`, remove the `raw(content)` and `raw(title)` wrappers from `src/layout.js`. Verify that no route still passes a plain string — grep for `renderLayout` calls and confirm each passes output from an `html` tag. Remove `escapeHtml` imports from any remaining files. If `src/html-utils.js` has no remaining exports, delete it. Run the full test suite to confirm no regressions.
  - **Where**: `src/layout.js`, `src/html-utils.js` (delete if empty), all files with stale `escapeHtml` imports
  - **Acceptance criteria**: `renderLayout` no longer wraps `content` or `title` in `raw()`; no file imports `escapeHtml`; `src/html-utils.js` is deleted or contains only non-escaping utilities; full test suite passes.
  - **Depends on**: Migrate public auth pages and home page, Migrate the Add Feed page view and route, Migrate the Feeds list page view and route, Migrate the Feed Detail page view and route, Migrate the Articles page view and route, Migrate the Crawl History page views and routes, Migrate the Reader page view and route
  - **Deviation**: `src/routes/api/add-feed.js` was explicitly out of scope for this migration and still imports `escapeHtml` to build the duplicate-feed error notice as a plain string. As a result, `src/html-utils.js` was NOT deleted. The acceptance criterion "no file imports `escapeHtml`" was not fully met. `renderLayout`'s `raw()` bridges were correctly removed — all migrated view functions pass `HtmlEscapedString`. A compatibility shim remains in `renderAddFeedPage` (`src/routes/add-feed.js`) that wraps the plain string `errorHtml` from `api/add-feed.js` in `raw()` before passing it to the view. See follow-up: migrate `api/add-feed.js` to complete the removal.

- [x] **Document the new SSR view-layer structure**
  - **Story**: Adopt an incremental rendering pattern that fits Hono on Workers
  - **What**: Update `MANUAL.md` §1 (Architecture Overview) to describe the `html` tagged template rendering approach, the `raw()` usage policy for trusted content, and the `src/views/` module organization. Update §12 (File Structure) to list the new `src/views/pages/` and `src/views/partials.js` files and their roles. Remove or update any references to the old string-template approach and `escapeHtml`.
  - **Where**: `MANUAL.md`
  - **Acceptance criteria**: MANUAL.md accurately describes the current rendering approach; references `hono/html` imports (`html`, `raw`); lists the `src/views/` directory structure; no references to the removed `escapeHtml` utility or string-template pattern.
  - **Depends on**: Remove the `raw()` bridge from `renderLayout` and clean up `html-utils.js`
