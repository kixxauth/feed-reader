# Queue Fan-Out Crawl Implementation Plan

## Implementation Approach

The crawl system uses a two-phase pipeline: a lightweight **dispatcher** (cron-triggered) that enqueues one message per enabled feed, and **queue consumer** invocations that each fully process a single feed (fetch, parse, insert articles, record crawl history).

Key properties:

- One `crawl_runs` header row per dispatch.
- One `crawl_run_details` row per feed per run.
- Crawl history totals are derived from `crawl_run_details` rows (not denormalized onto `crawl_runs`).
- The single-feed crawl path used after a user adds a feed (`performFeedCrawl`) is unchanged in user-visible behaviour; it creates its own `crawl_runs` row and then processes the feed inline.

## Implementation Notes

**Status**: Complete. Plan updated to match final implementation.

**Note (2026-03-30): article-batch fan-out removed**: A temporary “article-batch” queue phase was introduced to work around an older D1 per-message SQL/statement limit. That limit has since been raised (50 → 10,000), so the extra queue fan-out is no longer needed. The final design has the feed crawl job insert articles directly and record the final `articles_added` count in `crawl_run_details`.

**Deviation from plan**: The plan did not specify `max_batch_timeout` for the queue consumer. The implementation chose `max_batch_timeout: 0` (immediate delivery) — the right default for a crawl pipeline where there is no benefit to waiting for more messages to accumulate.

**Dead code removed post-implementation**: `getEnabledFeeds` in `db.js` was exported but no longer called after `performCrawlForFeeds` was removed. Removed in cleanup.

**`completed_at` column**: Was retained through migration `0010` but subsequently removed by migration `0011`. It was never written to and there is no mechanism to determine run completion time in the queue fan-out architecture.

**Queue creation required before deploy**: The `feed-crawl-queue` queue must be created in Cloudflare (`npx wrangler queues create feed-crawl-queue`) before the first deploy. The queue does not auto-create from `wrangler.jsonc`.

---

## TODO

This plan file originally contained an itemized TODO checklist. It has been removed because the implementation has landed and the list was no longer an accurate record (it described intermediate architecture choices that were later changed).
