---
name: add-feed plan
overview: Implementation plan for the add-feed epic, grounded in the current Hono/Cloudflare Worker codebase and existing feed crawl architecture.
todos:
  - id: plan-db-foundation
    content: Define migration and database helper work for duplicate-safe feed creation.
    status: completed
  - id: plan-discovery-crawl
    content: Define parser, discovery, and single-feed crawl refactors needed for the add-flow.
    status: completed
  - id: plan-routes-ui
    content: Define add-feed routes, Feeds page updates, and styling tasks in dependency order.
    status: completed
  - id: plan-tests
    content: Define unit and integration coverage for discovery, confirmation, and async crawl behavior.
    status: completed
isProject: false
---

# Add Feed Feature Implementation Plan

## Implementation Approach

Implement the add-feed feature as a protected, server-rendered multi-step flow that fits the current Hono app: `GET /feeds/add` renders the entry page, POST handlers validate the submitted URL, optionally render a selection step, and finish on a confirmation step that inserts the feed and redirects back to `/feeds`. Shared discovery logic should live outside the route layer so URL validation, timeout handling, website scraping, duplicate checks, and feed preview parsing are reusable and testable. The existing crawl pipeline in [src/crawl.js](src/crawl.js) and crawl history tables should be reused by adding a single-feed entry point that can be scheduled from the request execution context via Hono's `c.executionCtx.waitUntil(...)`, so confirm redirects immediately while the initial crawl finishes in the background. To fully satisfy duplicate prevention and concurrency safety, duplicate enforcement should be backed by a normalized `xml_url` uniqueness rule in D1, with the route layer translating constraint failures into the user-facing messages from the epic.

- **Enforce normalized feed URL uniqueness**
  - **Story**: US-3: Prevent Duplicate Feeds; US-10: Ensure System Stability During Feed Addition
  - **What**: Add a D1 migration that creates a uniqueness rule for normalized feed URLs (`LOWER(TRIM(xml_url))` for non-null values) so duplicate prevention is case-insensitive, whitespace-insensitive, and safe under concurrent confirms.
  - **Where**: [migrations/0006_add_unique_index_on_feed_xml_url.sql](migrations/0006_add_unique_index_on_feed_xml_url.sql)
  - **Acceptance criteria**: Duplicate detection is case-insensitive and trims whitespace; duplicate feeds are prevented reliably; concurrent add-feed requests do not create race-condition duplicates.
  - **Depends on**: none
- **Keep feed imports compatible with duplicate rules**
  - **Story**: US-3: Prevent Duplicate Feeds; US-9: Monitor Feed Addition Activity
  - **What**: Update the feed import script to normalize `xml_url` the same way as the Worker flow and fail with a clear message if imported rows would violate the new uniqueness rule, so imported feeds and UI-added feeds share the same duplicate contract.
  - **Where**: [scripts/import-feeds.js](scripts/import-feeds.js)
  - **Acceptance criteria**: Duplicate detection works for feeds imported via the CLI script as well as feeds added from the UI; crawl history and feed records continue to behave the same for imported and user-added feeds.
  - **Depends on**: Enforce normalized feed URL uniqueness
- **Extend the parser with feed preview metadata**
  - **Story**: US-5: Confirm Feed Selection; US-7: Auto-Discover Feed Website URL
  - **What**: Extend the SAX parser so it can extract feed-level metadata needed before insertion: feed type, title, RSS description or Atom subtitle, website URL (`html_url`), and last-build/update date, while preserving the existing article parsing used by scheduled crawls.
  - **Where**: [src/parser.js](src/parser.js)
  - **Acceptance criteria**: Confirmation can show feed title, description, and website URL; RSS and Atom feeds expose `html_url` from the expected elements; feed parse failures can be distinguished from non-feed input.
  - **Depends on**: none
- **Create a shared feed discovery and validation service**
  - **Story**: US-1: Add a New Feed via URL; US-2: Handle Invalid URLs; US-4: Discover Feeds from a Website; US-10: Ensure System Stability During Feed Addition
  - **What**: Create a reusable service that trims and validates HTTP/HTTPS URLs, fetches with the existing 30-second timeout and user agent, detects feed XML vs HTML, scans `<link rel="alternate">` / `<link rel="feed">` plus common feed paths, resolves relative URLs, enriches discovered candidates with preview metadata, and maps timeout/network/invalid/no-feed cases to the canonical user-friendly messages while logging the underlying errors.
  - **Where**: [src/feed-discovery.js](src/feed-discovery.js)
  - **Acceptance criteria**: Valid feed URLs skip to confirmation; website URLs are scraped for feed links; no-feed sites show the fallback direct-feed prompt; malformed, unreachable, timeout, and parse-error cases use the specified messages; website scraping stays efficient and bounded.
  - **Depends on**: Extend the parser with feed preview metadata
- **Add database helpers for add-feed lookups and inserts**
  - **Story**: US-3: Prevent Duplicate Feeds; US-8: Handle Crawl Failures During Feed Addition; US-9: Monitor Feed Addition Activity
  - **What**: Add DB helpers to look up feeds by normalized `xml_url`, create a new feed row for UI adds, and fetch the latest crawl result for a feed so routes can block duplicates before confirmation, gracefully handle uniqueness conflicts, and show immediate-crawl status on `/feeds`.
  - **Where**: [src/db.js](src/db.js)
  - **Acceptance criteria**: Duplicate detection works against existing rows regardless of source; feed creation uses the existing feeds table shape; crawl history and recent crawl status are queryable for newly added feeds.
  - **Depends on**: Enforce normalized feed URL uniqueness
- **Refactor crawl logic for single-feed immediate crawls**
  - **Story**: US-1: Add a New Feed via URL; US-8: Handle Crawl Failures During Feed Addition; US-10: Ensure System Stability During Feed Addition
  - **What**: Refactor the crawl module to expose a single-feed crawl entry point that reuses the existing fetch/parse/article-insert/failure-history pipeline, normalizes crawl error messages to the epic’s wording, and can be scheduled from a request without blocking the redirect.
  - **Where**: [src/crawl.js](src/crawl.js)
  - **Acceptance criteria**: Confirm does not block on the initial crawl; failed initial crawls still record `crawl_run_details` with `failed` status and an error message; successful crawls insert articles the same way as scheduled crawls; feeds remain enabled for the next 2am crawl retry path.
  - **Depends on**: Extend the parser with feed preview metadata, Add database helpers for add-feed lookups and inserts
- **Build the add-feed page renderer**
  - **Story**: US-1: Add a New Feed via URL; US-2: Handle Invalid URLs; US-4: Discover Feeds from a Website; US-5: Confirm Feed Selection; US-6: Cancel Adding a Feed; US-7: Auto-Discover Feed Website URL
  - **What**: Build the protected SSR page that renders the initial URL form, inline validation errors, the no-feed fallback direct-feed input, the multi-feed selection list, the confirmation summary, and the back/cancel controls, escaping all submitted and discovered values with the existing HTML utility.
  - **Where**: [src/routes/add-feed.js](src/routes/add-feed.js)
  - **Acceptance criteria**: `/feeds/add` shows the required URL form and Back link; multiple discovered feeds can be selected; confirmation shows title/description/website URL when present; Back works at each step without adding feeds or triggering crawls; the entered URL stays filled after errors.
  - **Depends on**: Create a shared feed discovery and validation service
- **Build the add-feed POST handlers**
  - **Story**: US-1: Add a New Feed via URL; US-2: Handle Invalid URLs; US-3: Prevent Duplicate Feeds; US-4: Discover Feeds from a Website; US-5: Confirm Feed Selection; US-6: Cancel Adding a Feed; US-8: Handle Crawl Failures During Feed Addition; US-10: Ensure System Stability During Feed Addition
  - **What**: Create POST handlers for submit, select, fallback-submit, and confirm steps that call discovery, re-check duplicates at each step, create the feed row with hostname and discovered metadata, catch uniqueness conflicts as duplicate errors, and start the immediate crawl in the background before redirecting back to `/feeds`.
  - **Where**: [src/routes/api/add-feed.js](src/routes/api/add-feed.js)
  - **Acceptance criteria**: Submitting a valid URL moves to selection or confirmation as appropriate; duplicate feeds stop before confirmation and link to the existing feed; confirming adds the feed and redirects; confirming never blocks on crawl completion; all validation, scrape, and crawl errors are logged.
  - **Depends on**: Create a shared feed discovery and validation service, Add database helpers for add-feed lookups and inserts, Refactor crawl logic for single-feed immediate crawls, Build the add-feed page renderer
- **Register the new add-feed routes**
  - **Story**: US-1: Add a New Feed via URL; US-6: Cancel Adding a Feed
  - **What**: Register `GET /feeds/add` and the new add-feed POST endpoints in the Hono app so they are protected by the existing auth middleware and follow the current route wiring pattern in the Worker entrypoint.
  - **Where**: [src/index.js](src/index.js)
  - **Acceptance criteria**: Clicking the Add Feed CTA can reach a dedicated `/feeds/add` page; all add-feed interactions are available only to authenticated users; the new handlers are wired into the live app.
  - **Depends on**: Build the add-feed page renderer, Build the add-feed POST handlers
- **Update the feeds list with CTA and add-flow banners**
  - **Story**: US-1: Add a New Feed via URL; US-8: Handle Crawl Failures During Feed Addition; US-9: Monitor Feed Addition Activity
  - **What**: Update the feeds page to render the "Add Feed" button, preserve hostname sorting, and show add-flow banners by reading the redirect query state plus the latest crawl result for the newly added feed so the page can display "added", "initial crawl in progress", or "failed with reason".
  - **Where**: [src/routes/feeds.js](src/routes/feeds.js)
  - **Acceptance criteria**: The Feeds page shows an Add Feed button; after confirm, the new feed appears in hostname order; the page shows the success message and initial crawl-in-progress message; if the immediate crawl fails, the page shows the warning with the failure reason.
  - **Depends on**: Add database helpers for add-feed lookups and inserts, Build the add-feed POST handlers, Register the new add-feed routes
- **Style the add-feed workflow and banners**
  - **Story**: US-1: Add a New Feed via URL; US-2: Handle Invalid URLs; US-4: Discover Feeds from a Website; US-5: Confirm Feed Selection; US-6: Cancel Adding a Feed; US-8: Handle Crawl Failures During Feed Addition
  - **What**: Add styles for the add-feed form, alerts, fallback input, selection cards, confirmation summary, and Feeds-page status banners so the new SSR screens are readable and consistent with the existing layout.
  - **Where**: [src/styles.css](src/styles.css)
  - **Acceptance criteria**: The add-feed form is prominent and usable; error and warning states are visually clear; selection and confirmation screens are readable; Back and Confirm actions remain clear throughout the flow.
  - **Depends on**: Build the add-feed page renderer, Update the feeds list with CTA and add-flow banners
- **Add parser and discovery coverage**
  - **Story**: US-2: Handle Invalid URLs; US-3: Prevent Duplicate Feeds; US-4: Discover Feeds from a Website; US-5: Confirm Feed Selection; US-7: Auto-Discover Feed Website URL; US-10: Ensure System Stability During Feed Addition
  - **What**: Add focused tests for preview metadata extraction, RSS vs Atom website URL parsing, invalid XML handling, website link discovery, common-path probing, URL normalization, timeout mapping, and duplicate normalization behavior.
  - **Where**: [test/index.spec.js](test/index.spec.js)
  - **Acceptance criteria**: Feed metadata parsing is covered; invalid, timeout, and no-feed cases are covered; duplicate matching is verified as case-insensitive and whitespace-insensitive; discovery logic is validated without relying on manual testing alone.
  - **Depends on**: Extend the parser with feed preview metadata, Create a shared feed discovery and validation service, Add database helpers for add-feed lookups and inserts
- **Add authenticated add-feed integration tests**
  - **Story**: US-1: Add a New Feed via URL; US-2: Handle Invalid URLs; US-3: Prevent Duplicate Feeds; US-4: Discover Feeds from a Website; US-5: Confirm Feed Selection; US-6: Cancel Adding a Feed; US-8: Handle Crawl Failures During Feed Addition; US-9: Monitor Feed Addition Activity; US-10: Ensure System Stability During Feed Addition
  - **What**: Add end-to-end Worker tests for `/feeds/add`, duplicate rejection with a link to the existing feed, no-feed fallback submission, Back navigation, confirm redirect behavior, background single-feed crawl recording, and Feeds-page banners for in-progress and failed initial crawl states.
  - **Where**: [test/index.spec.js](test/index.spec.js)
  - **Acceptance criteria**: The full add-feed flow is covered for direct feeds and website discovery; duplicate and error paths are covered; confirm redirects immediately while crawl work finishes in the execution context; crawl history continues to work for user-added feeds.
  - **Depends on**: Build the add-feed POST handlers, Register the new add-feed routes, Update the feeds list with CTA and add-flow banners, Refactor crawl logic for single-feed immediate crawls

## Post-Implementation Notes

### Outcome

This plan was implemented substantially as written. The shipped work added the new add-feed routes, feed discovery helpers, parser preview support, a single-feed immediate crawl entry point, the normalized `xml_url` uniqueness migration, and integration coverage for the new flow.

### Notable implementation details

- The multi-step flow was implemented as a stateless SSR workflow using hidden serialized form state in `src/routes/add-feed.js` and `src/routes/api/add-feed.js`. The plan did not prescribe how intermediate state should be stored; hidden form state was chosen to avoid introducing new KV or D1 draft-storage concerns.
- The `/feeds` post-confirm banner uses `addedFeedId` and `crawlRunId` query params and reads `crawl_run_details` to determine whether the initial crawl is still in progress, completed, or failed. This matches the planned outcome but is more specific than the original plan text.
- No new dependencies, environment variables, or Wrangler bindings were required.

### Deferred or adjusted scope

- The implementation keeps feed discovery intentionally lightweight: it scans feed `<link>` tags and probes a short list of common feed paths, but it does not attempt broader crawling or JavaScript-rendered discovery.
- The plan’s duplicate-prevention and immediate-crawl goals were met, but the add-feed flow still relies on query-string-driven banners rather than a more general flash-message system.

