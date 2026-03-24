# Feed Detail Page and Disabled Feed Filter

## Implementation Approach

Implement this epic as an extension of the app's existing server-rendered Hono routes, keeping `/feeds` as the main listing page while adding a new authenticated detail route at `/feeds/:feedId`. Reuse the current D1-backed feed metadata and crawl-history tables instead of adding new schema, extending `src/db.js` only where the UI needs filtered feed pagination and feed-specific recent activity. Preserve browsing state with query-string-driven context, following the same URL-based pattern already used for pagination and article date filters. Keep HTML escaping, 404 handling, POST-redirect-GET toggles, and Worker integration tests aligned with the existing route conventions.

### Key Decisions

- **Disabled filter parameter**: Use `?disabled=1` on `/feeds` to toggle the disabled-only view. Omitting the parameter (or any value other than `1`) shows all feeds. This follows the boolean filter convention: present = active, absent = inactive.
- **List context parameters**: Carry feeds-list state through detail and article pages using `?listPage=N&disabled=1` query parameters. These are separate from the page's own `?page=N` parameter. On the detail page, these params are forwarded to action links and the toggle form. On articles, they are used to build the "Back to Feeds" link.
- **Return-path for toggle**: The toggle form includes a hidden `<input name="returnTo" value="...">` field containing the relative path to redirect to after the POST. The toggle handler validates this is a same-origin relative path starting with `/feeds` before using it; otherwise falls back to `/feeds`.
- **Recent activity**: Show the 5 most recent `crawl_run_details` rows for the feed, joined with `crawl_runs` for the timestamp. Display status, articles added, error message (if any), and the crawl run date. When no crawl history exists, show "No crawl activity recorded."
- **Route registration order**: Register `GET /feeds/:feedId` **after** `GET /feeds/:feedId/articles` in `src/index.js` so the more specific articles route matches first and the wildcard `:feedId` does not swallow `/articles`.
- **Disabled filter UI**: Use a simple toggle link (not a form). When viewing all feeds: show "Show disabled only" link. When filtered: show "Showing disabled feeds only" with a "Clear filter" link. This matches the lightweight style of the existing UI.
- **Handler's separate COUNT query**: The feeds list handler (`src/routes/feeds.js` line 26) currently runs a raw `SELECT COUNT(*) FROM feeds` for clamping before calling `getFeedsPaginated`. When adding the disabled filter, both the handler's COUNT and the db function's COUNT must apply the same WHERE clause. The simplest approach: modify `getFeedsPaginated` to accept an optional `disabledOnly` boolean, and remove the handler's separate COUNT query in favor of relying on `getFeedsPaginated`'s returned total (matching how articles already work — the handler calls the db function, then clamps, then re-fetches if needed).

---

- [x] **Add disabled-only filter support to `getFeedsPaginated`**
  - **Story**: Filter the feeds list to show disabled feeds only
  - **What**: Add an optional `{ disabledOnly }` options parameter to `getFeedsPaginated`. When `disabledOnly` is true, add `WHERE no_crawl = 1` to both the COUNT and SELECT queries. When false/omitted, query all feeds (current behavior). Return `{ feeds, total }` as before, with `total` reflecting the filtered count.
  - **Where**: `src/db.js` — modify `getFeedsPaginated`
  - **Acceptance criteria**: `getFeedsPaginated(db, page)` continues to work unchanged (backwards compatible); `getFeedsPaginated(db, page, { disabledOnly: true })` returns only disabled feeds with an accurate total; pagination offsets are correct for filtered results.
  - **Depends on**: none

- [x] **Add per-feed recent activity query**
  - **Story**: Show recent activity context on the detail page
  - **What**: Add a new `getRecentActivityForFeed(db, feedId, limit)` function that returns the most recent `limit` (default 5) crawl results for a specific feed. Query `crawl_run_details` joined with `crawl_runs` on `crawl_run_id = id`, filtered by `feed_id`, ordered by `crawl_runs.started_at DESC`. Return columns: `started_at` (from crawl_runs), `status`, `articles_added`, `error_message`, `auto_disabled` (from crawl_run_details).
  - **Where**: `src/db.js` — add new exported function
  - **Acceptance criteria**: Returns up to N recent crawl results for the given feed; returns an empty array when no crawl history exists; joins correctly so each row has a timestamp from the parent crawl run.
  - **Depends on**: none

- [x] **Create the feed detail route handler**
  - **Story**: Show complete feed information on the detail page; Provide clear actions from the detail page; Show owner-facing feed administration details; Show recent activity context on the detail page
  - **What**: Add a new route handler for `GET /feeds/:feedId` that:
    1. Loads the feed via `getFeedById` — returns a 404 page (matching existing 404 pattern) if not found.
    2. Loads recent activity via `getRecentActivityForFeed(db, feedId, 5)`.
    3. Parses optional `listPage` and `disabled` query params to build a return-to-list link (e.g., `/feeds?page=2&disabled=1`).
    4. Renders the detail page with all feed fields, escaping all interpolated values with `escapeHtml()`:
       - **General info**: title (as `<h1>`), hostname, website link (if `html_url` exists — opens in new tab), feed URL (if `xml_url` exists — opens in new tab), description (if present).
       - **Admin info** (visually distinct section): crawl status badge (reuse existing `.crawl-status-badge` classes), consecutive failure count, last build date (formatted like articles dates, or "Unknown" if null), score (display raw value or "None" if null), created/updated timestamps (formatted).
       - **Recent activity**: List of recent crawl results or "No crawl activity recorded" fallback. Each row shows date, status badge, articles added, and error message if present.
       - **Actions**: "View Articles" link → `/feeds/:feedId/articles` (with `listPage`/`disabled` forwarded), "Visit Website" link → `html_url` (new tab, only if exists), "Back to Feeds" link → `/feeds` (with preserved `page`/`disabled` params), crawl toggle form (POST to `/api/feeds/:feedId/toggle-crawl` with hidden `returnTo` input set to the current detail page URL including context params).
    5. Uses `renderLayout()` with `isAuthenticated: true`.
  - **Where**: `src/routes/feed-detail.js` (new file)
  - **Acceptance criteria**: All feed columns are displayed with proper escaping; optional fields (description, html_url, xml_url, score, last_build_date) degrade gracefully when null; 404 for nonexistent feeds uses the standard layout; action links carry list context; toggle form includes a validated returnTo path.
  - **Depends on**: Add disabled-only filter support to `getFeedsPaginated`; Add per-feed recent activity query

- [x] **Register the new detail endpoint**
  - **Story**: Open a feed detail page from the feeds list
  - **What**: Import `handleFeedDetail` from `src/routes/feed-detail.js` and register `app.get('/feeds/:feedId', handleFeedDetail)` in `src/index.js`. Register it **after** the existing `app.get('/feeds/:feedId/articles', handleArticles)` line (line 29) so the more-specific articles route matches first.
  - **Where**: `src/index.js`
  - **Acceptance criteria**: `GET /feeds/:feedId` routes to the detail handler; `GET /feeds/:feedId/articles` still routes to the articles handler; no existing routes are broken.
  - **Depends on**: Create the feed detail route handler

- [x] **Update the feeds list route for detail links and disabled-only filtering**
  - **Story**: Open a feed detail page from the feeds list; Filter the feeds list to show disabled feeds only; Preserve list state across navigation
  - **What**: Modify `src/routes/feeds.js`:
    1. Parse `disabled` query param: treat `?disabled=1` as the disabled-only filter being active.
    2. Replace the handler's raw COUNT query (line 26) with a call to `getFeedsPaginated(db, page, { disabledOnly })`, using the returned `total` for clamping (matching the articles handler pattern where clamping triggers a re-fetch).
    3. Change the feed title `<a>` from linking to `html_url` (external) to linking to `/feeds/:feedId` (detail page). Forward current `page` and `disabled` as `?listPage=N&disabled=1` on the detail link.
    4. Remove the current "Articles" `<a>` from each feed item (users will reach articles through the detail page).
    5. Add a "Visit Website" link (`html_url`, new tab) to each feed item — only render it when `html_url` is not null.
    6. Add filter UI above the feed list: when `disabled` is not active, show a "Show disabled only" link to `?disabled=1`; when active, show "Showing disabled feeds only" label with a "Clear filter" link to `/feeds`. Preserve the disabled param in pagination links when active (e.g., `?disabled=1&page=2`).
    7. Update empty-state messages: "No feeds available" when unfiltered and empty; "No disabled feeds" when filtered and empty (with "Clear filter" link).
  - **Where**: `src/routes/feeds.js`
  - **Acceptance criteria**: Feed titles link to the detail page, not externally; "Articles" link is removed; website link appears only when `html_url` exists; disabled filter toggles correctly via URL; pagination links preserve the active filter; empty states reflect the active filter; list context params are forwarded to detail links.
  - **Depends on**: Add disabled-only filter support to `getFeedsPaginated`; Register the new detail endpoint

- [x] **Make crawl-toggle redirects context-aware**
  - **Story**: Allow crawl status changes from the detail page; Preserve list state across navigation
  - **What**: Modify `src/routes/api/toggle-feed-crawl.js`:
    1. After the toggle succeeds, read the `returnTo` value from the POST body (`c.req.parseBody()` — Hono's form body parser).
    2. Validate `returnTo`: it must be a string that starts with `/feeds` (same-origin, scoped to feeds routes). If missing or invalid, fall back to `/feeds`.
    3. Redirect to the validated `returnTo` path with 303 status (preserving current POST-redirect-GET pattern).
    4. All existing behavior (feed lookup, 404, toggle logic, failure count reset) remains unchanged.
  - **Where**: `src/routes/api/toggle-feed-crawl.js`
  - **Acceptance criteria**: Toggle from the feeds list (no `returnTo`) still redirects to `/feeds`; toggle from the detail page redirects back to the detail page with context; toggle with a malicious or invalid `returnTo` falls back to `/feeds`; re-enabling still resets failure count; unknown feeds still 404.
  - **Depends on**: Create the feed detail route handler; Update the feeds list route for detail links and disabled-only filtering

- [x] **Preserve feeds-list context from article pages**
  - **Story**: Provide clear actions from the detail page; Preserve list state across navigation
  - **What**: Modify `src/routes/articles.js`:
    1. Parse optional `listPage` and `disabled` query params (same validation as other handlers — integer for listPage, `"1"` for disabled).
    2. Build the "Back to Feeds" link dynamically: if `listPage` or `disabled` are present, link to `/feeds?page=N&disabled=1` (as appropriate); otherwise keep the current hardcoded `/feeds` link.
    3. Preserve `listPage` and `disabled` in pagination links alongside the existing `from`/`to` filter params.
  - **Where**: `src/routes/articles.js`
  - **Acceptance criteria**: Articles page reached from the detail page shows a "Back to Feeds" link that restores the prior list page and filter; articles page reached directly (no context params) still shows a plain `/feeds` link; article pagination links preserve all context params alongside date filters.
  - **Depends on**: Update the feeds list route for detail links and disabled-only filtering; Create the feed detail route handler

- [x] **Add styles for the detail page and filter controls**
  - **Story**: Show complete feed information on the detail page; Provide clear actions from the detail page; Show owner-facing feed administration details; Filter the feeds list to show disabled feeds only
  - **What**: Add CSS to `src/styles.css` for:
    1. **Detail page layout**: `.feed-detail` container with reasonable max-width. `.feed-detail h1` for the title.
    2. **Metadata groups**: `.feed-meta` for general info, `.feed-admin-meta` for admin section (visually distinct — e.g., border-top, reduced opacity like existing `.crawl-run-summary` pattern). Each field as a labeled key-value pair.
    3. **Recent activity**: `.recent-activity-list` — compact list. Reuse existing `.status-success`, `.status-failed`, `.status-auto-disabled` badges from crawl-history styles.
    4. **Action row**: `.feed-actions` — flex row with gap for action links/buttons.
    5. **Filter UI on feeds list**: `.feed-filter` — simple inline element above the feed list. Style the active filter label and clear link.
    6. Keep all new styles consistent with the existing dark theme, opacity patterns, and spacing conventions.
  - **Where**: `src/styles.css`
  - **Acceptance criteria**: Detail page is readable with optional fields omitted; admin metadata is visually separated from general info; recent activity is compact; filter control is visible without disrupting the feed list layout.
  - **Depends on**: none (CSS classes are defined here and consumed by route handlers)

- [x] **Add integration coverage for detail, filtering, and return-state flows**
  - **Story**: All stories
  - **What**: Add tests to `test/index.spec.js` covering:
    1. **Feed detail page**: Renders all feed fields with proper escaping; 404 for nonexistent feed; optional fields (null description, null html_url, etc.) omitted gracefully; recent activity shows when data exists; "No crawl activity recorded" fallback when no crawl history.
    2. **Disabled-only filter**: `/feeds?disabled=1` shows only disabled feeds; pagination totals reflect filtered count; empty state shows "No disabled feeds" with clear link; filter UI toggles correctly.
    3. **Detail links from list**: Feed titles on `/feeds` link to `/feeds/:feedId` (not external); "Articles" link is no longer present on list items.
    4. **Context preservation**: Detail page "Back to Feeds" link includes `page`/`disabled` from `listPage`/`disabled` params; articles "Back to Feeds" link includes context when available; pagination on articles preserves context params.
    5. **Toggle from detail**: POST with `returnTo` redirects to that path; POST without `returnTo` redirects to `/feeds`; POST with invalid `returnTo` (e.g., `https://evil.com`) redirects to `/feeds`; failure count reset still works.
    6. **XSS**: Feed fields with HTML characters are escaped on the detail page.
  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: All new routes and behaviors have integration test coverage in the existing test harness; tests follow the established patterns (seed data, `makeAuthenticatedRequest`, assert on response body).
  - **Depends on**: Make crawl-toggle redirects context-aware; Preserve feeds-list context from article pages; Add styles for the detail page and filter controls

---

## Implementation Notes

All 8 TODO items completed. 35 new integration tests added; all 123 tests pass.

### Deviations from plan

**`getFeedsPaginated` clamping pattern**: The plan described removing the handler's raw COUNT in favor of relying on the db function's returned `total`. Implemented exactly as described — the handler now calls `getFeedsPaginated` once, uses the returned `total` to compute `totalPages`, and re-fetches with a clamped page only when needed. This matches the articles handler pattern.

**`escapeHtml` on query strings in hrefs**: URL query strings containing `&` are passed through `escapeHtml` before interpolation into HTML attributes. This produces `&amp;` in the rendered HTML, which is correct — browsers decode `&amp;` back to `&` when following links. Tests assert on the `&amp;` form. This is intentional, not a bug.

**`buildFilterForm` context forwarding (articles page)**: The plan specified preserving `listPage`/`disabled` in pagination links on the articles page. The filter form itself (submit button and "Clear" link) does not forward these params — this was not mentioned in the plan and was left unaddressed. See follow-up items.

### Known gaps not addressed (follow-up items)

- The articles page date filter form does not preserve `listPage`/`disabled` — submitting or clearing the filter drops list context. Requires adding hidden fields to `buildFilterForm`.
- The "Clear" link in `buildFilterForm` (`/feeds/:feedId/articles`) similarly loses context.
