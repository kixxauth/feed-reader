# Add Feed Feature

## Summary

The add-feed feature introduces a protected, server-rendered workflow for creating feeds from either a direct RSS/Atom URL or a website URL. The implementation adds new add-feed routes, feed discovery helpers, feed preview parsing, immediate single-feed crawling, and a normalized duplicate-prevention rule in D1. No new runtime dependencies or environment variables were added.

## What Changed

### Routes and UI

- `src/routes/add-feed.js`
  - Renders the add-feed form, selection step, fallback direct-feed step, and confirmation step.
  - Serializes discovered candidates into hidden form fields so the flow remains stateless on the server between POSTs.
- `src/routes/api/add-feed.js`
  - Handles URL submission, website discovery, feed selection, direct-feed fallback, duplicate checks, final insert, and background immediate crawl scheduling.
- `src/routes/feeds.js`
  - Adds the `Add Feed` CTA and post-confirm banners for success, in-progress immediate crawl, and failed immediate crawl.
- `src/styles.css`
  - Adds styling for notices, forms, selection cards, and add-feed flow layout.
- `src/index.js`
  - Registers `GET /feeds/add` and `POST /api/feeds/add`.

### Feed discovery and parsing

- `src/feed-discovery.js`
  - Validates user-entered HTTP/HTTPS URLs.
  - Detects direct feed URLs vs. websites.
  - Scrapes `<link>` tags and probes common feed paths.
  - Maps validation and reachability failures to user-facing messages.
- `src/feed-utils.js`
  - Centralizes URL canonicalization, duplicate-comparison normalization, and hostname derivation.
- `src/parser.js`
  - Adds `parseFeedPreview(xmlText)` for feed-level metadata (`type`, `title`, `description`, `htmlUrl`, `lastBuildDate`) while preserving the existing article parsing API.

### Persistence and crawl integration

- `migrations/0006_add_unique_index_on_feed_xml_url.sql`
  - Adds a normalized unique index on `LOWER(TRIM(xml_url))`.
- `src/db.js`
  - Adds `getFeedByXmlUrl()`, `createFeed()`, and `getCrawlRunDetailByFeed()`.
- `src/crawl.js`
  - Adds `performFeedCrawl()` for a one-feed immediate crawl that shares the scheduled crawl’s history and failure tracking.
- `scripts/import-feeds.js`
  - Normalizes imported URLs to stay consistent with UI duplicate rules.

### Tests

- `test/index.spec.js`
  - Adds coverage for feed preview parsing, discovery cases, duplicate handling, add-feed route flow, and immediate crawl outcomes.

## Key Decisions and Why

### Stateless multi-step flow

The add-feed flow keeps discovery and selection state in hidden form fields instead of storing draft state in KV or D1. This keeps the feature aligned with the current SSR architecture, avoids introducing temporary persistence, and makes the flow easy to test with plain form submissions. The tradeoff is that the serialized candidate data travels in the HTML between steps.

### Duplicate prevention at both app and database layers

Duplicate detection happens twice:

- First in `src/routes/api/add-feed.js` through `getFeedByXmlUrl()`, so the user sees a friendly error before confirm.
- Again in D1 through the normalized unique index, so concurrent requests cannot create duplicate rows.

This is more robust than relying on either the route layer or the database alone.

### Immediate crawl reuses existing crawl history tables

The implementation reuses `crawl_runs` and `crawl_run_details` for the post-confirm crawl instead of adding a special-purpose status table. That keeps scheduled and immediate crawl behavior visible in one history system and lets `/feeds` reuse persisted crawl detail rows for user-facing banners.

### Preview metadata comes from the XML parser, not ad-hoc string matching

The parser now exposes `parseFeedPreview()` so the add-feed flow and the crawl system use the same RSS/Atom understanding. This was chosen over a separate preview parser to reduce drift between “feed is valid enough to confirm” and “feed is valid enough to crawl.”

## Patterns to Reuse

- New multi-step SSR flows should prefer explicit intent-based POST handling plus hidden serialized state over introducing ad-hoc temporary storage.
- User-submitted feed URLs should always go through `canonicalizeHttpUrl()` / `normalizeUrlForComparison()` before storing or comparing them.
- If a feature needs “do work after redirect,” schedule it with `c.executionCtx.waitUntil(...)` and persist enough information for the next GET to render a meaningful status message.
- Keep user-facing validation messages centralized instead of hardcoding strings across route handlers.

## Setup and Operational Notes

- Apply migration `0006_add_unique_index_on_feed_xml_url.sql` before using the add-feed flow against an environment.
- No new secrets, bindings, or `wrangler.jsonc` changes are required.
- The feature relies on outbound fetch from the Worker to third-party sites and feed URLs.
- CLI imports now need to respect the normalized duplicate rule; importing two feeds whose `xml_url` values normalize to the same URL will fail.

## Known Limitations

- The add-feed flow serializes discovered candidates into hidden form fields, which is fine for small candidate sets but not ideal for unusually large discovery results.
- Website discovery only checks `<link>` metadata and a short list of common feed paths; it does not crawl arbitrary pages or JavaScript-rendered sites.
- The flow does not yet persist “draft add-feed sessions,” so if the page is closed mid-flow the state is lost.
- Immediate crawl banners are based on persisted crawl detail rows. If a crawl has not written a detail row yet, `/feeds` shows “Initial crawl in progress.”
- There is still no UI for editing or deleting feeds.

## Documentation Placement Recommendations

- `MANUAL.md`
  - Keep route inventory, operational behavior, migrations, and architecture summaries here.
  - This file should be updated when routes, crawl behavior, or schema guarantees change.
- `documentation/add-feed.md`
  - Keep the design rationale and feature-specific tradeoffs here.
  - This is the right place for future contributors to understand why the flow is stateless and why duplicate prevention is layered.
- Inline comments in `src/routes/add-feed.js`
  - Keep short comments about the hidden serialized state approach close to the implementation.
- Inline comments in `src/feed-discovery.js`
  - Add comments only when discovery heuristics grow more complex than the current link-scan and common-path strategy.

## Future Extension Guidance

- If the flow gains more steps or needs larger intermediate state, consider moving from hidden serialized state to a signed token or short-lived KV-backed draft state.
- If users need more reliable website discovery, expand the candidate strategy in `src/feed-discovery.js` carefully and add coverage before changing the heuristics.
- If immediate crawl status needs to persist longer on `/feeds`, consider replacing query-string-driven banners with a flash-message mechanism or a dedicated status field.
