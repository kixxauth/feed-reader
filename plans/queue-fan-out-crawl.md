# Queue Fan-Out Crawl Implementation Plan

## Implementation Approach

The current single-invocation sequential crawl is replaced with a two-phase pipeline: a lightweight **dispatcher** (cron-triggered) that enqueues batches of feed IDs, and **queue consumer** invocations that each process one batch of ~50 feeds concurrently (up to 6 at a time, the per-invocation connection limit). The dispatcher queries only feed IDs from D1, inserts the `crawl_runs` header row, and sends batches of 50 IDs as queue messages — each carrying the shared `crawlRunId` and `startedAt` timestamp so all batches contribute to one logical crawl run. Crawl history totals are dropped from the `crawl_runs` table and derived at query time by aggregating `crawl_run_details` rows, which eliminates the need for any end-of-crawl coordination across consumers. The single-feed crawl path used after a user adds a feed (`performFeedCrawl`) is unchanged in behaviour, adapted only to call the new internal building blocks.

## Implementation Notes

**Status**: Complete. All TODO items implemented. Tests: 188 passing.

**Deviation from plan**: The plan did not specify `max_batch_timeout` for the queue consumer. The implementation chose `max_batch_timeout: 0` (immediate delivery) — the right default for a crawl pipeline where there is no benefit to waiting for more messages to accumulate.

**Dead code removed post-implementation**: `getEnabledFeeds` in `db.js` was exported but no longer called after `performCrawlForFeeds` was removed. Removed in cleanup.

**`completed_at` column**: Was retained through migration `0010` but subsequently removed by migration `0011`. It was never written to and there is no mechanism to determine run completion time in the queue fan-out architecture.

**Queue creation required before deploy**: The `feed-crawl-queue` queue must be created in Cloudflare (`npx wrangler queues create feed-crawl-queue`) before the first deploy. The queue does not auto-create from `wrangler.jsonc`.

---

## TODO

- [x] **Migration: simplify crawl_runs table**
  - **Story**: Remove denormalized summary columns from `crawl_runs`
  - **What**: New migration that recreates `crawl_runs` with only `id`, `started_at`, `completed_at`, and `created_at` — dropping `total_feeds_attempted`, `total_feeds_failed`, and `total_articles_added`. Use the SQLite table-recreation pattern: create new table, copy rows, drop old, rename.
  - **Where**: `migrations/0010_simplify_crawl_runs_table.sql` (new file)
  - **Acceptance criteria**: Existing crawl run rows are preserved minus the summary columns; the index on `started_at` is recreated.
  - **Depends on**: none

- [ ] **db.js: Simplify recordCrawlRun**
  - **Story**: Write-side DB change to match the new schema
  - **What**: Change the function signature from `{ id, startedAt, completedAt, totalFeedsAttempted, totalFeedsFailed, totalArticlesAdded }` to `{ id, startedAt }`. Update the INSERT statement to only write `id` and `started_at`. Remove the JSDoc params for the removed fields.
  - **Where**: `src/db.js`
  - **Acceptance criteria**: `recordCrawlRun` inserts a row with `id` and `started_at` only. All existing callers (`performCrawlForFeeds`, `performFeedCrawl`) will be updated in later tasks.
  - **Depends on**: Migration: simplify crawl_runs table

- [ ] **db.js: Add getEnabledFeedIds**
  - **Story**: Lightweight dispatcher query — only IDs needed to build queue messages
  - **What**: New exported function `getEnabledFeedIds(db)` that runs `SELECT id FROM feeds WHERE no_crawl = 0` and returns an array of ID strings.
  - **Where**: `src/db.js`
  - **Acceptance criteria**: Returns only the `id` field; does not fetch full feed rows.
  - **Depends on**: none

- [ ] **db.js: Add getFeedsByIds**
  - **Story**: Consumer-side batch query — re-hydrate full feed objects from IDs
  - **What**: New exported function `getFeedsByIds(db, ids)` that runs `SELECT * FROM feeds WHERE id IN (…)` with the provided array of ID strings. Returns the full feed row objects needed by `processFeed`.
  - **Where**: `src/db.js`
  - **Acceptance criteria**: Accepts an array of IDs of any length; returns an array of full feed objects (same shape as `getEnabledFeeds` rows). Returns an empty array when `ids` is empty.
  - **Depends on**: none

- [ ] **db.js: Update getCrawlRuns to aggregate from detail rows**
  - **Story**: Crawl history option C — aggregate totals at query time
  - **What**: Rewrite the SQL in `getCrawlRuns` to LEFT JOIN `crawl_run_details` and compute `total_feeds_attempted`, `total_feeds_failed`, and `total_articles_added` via `COUNT`, `SUM(CASE WHEN … END)`, and `SUM`. Results must still be ordered by `started_at DESC` and limited. The returned row objects must have the same field names as before so that the route handler and tests continue to work.
  - **Where**: `src/db.js`
  - **Acceptance criteria**: Returns aggregate totals derived from detail rows; returns 0 for all totals when no detail rows exist for a run (LEFT JOIN semantics with COALESCE).
  - **Depends on**: Migration: simplify crawl_runs table

- [ ] **db.js: Update getCrawlRunById to aggregate from detail rows**
  - **Story**: Crawl history option C — aggregate totals at query time
  - **What**: Same aggregate JOIN pattern as `getCrawlRuns` but for a single run by ID. Must return `null` when no `crawl_runs` row exists for the given ID.
  - **Where**: `src/db.js`
  - **Acceptance criteria**: Returns a single run object with computed totals, or `null` if not found.
  - **Depends on**: Migration: simplify crawl_runs table

- [ ] **wrangler.jsonc: Add queue producer and consumer bindings**
  - **Story**: Wire up Cloudflare Queues infrastructure
  - **What**: Add a `queues` section with one producer entry (binding `CRAWL_QUEUE`, queue name `feed-crawl-queue`) and one consumer entry (queue name `feed-crawl-queue`, `max_batch_size: 1`, `max_batch_timeout: 0`). `max_batch_size: 1` means each consumer invocation handles one dispatch message (which itself contains up to 50 feed IDs).
  - **Where**: `wrangler.jsonc`
  - **Acceptance criteria**: Config is valid wrangler JSONC; the queue must be created in the Cloudflare dashboard / via `wrangler queues create` before deploying.
  - **Depends on**: none

- [ ] **crawl.js: Add processCrawlBatch**
  - **Story**: Queue consumer — process one batch of feeds
  - **What**: New exported function `processCrawlBatch(db, { crawlRunId, startedAt, feedIds })`. It: (1) calls `getFeedsByIds(db, feedIds)` to get full feed objects, (2) processes them in groups of 6 using `Promise.all` so at most 6 concurrent outgoing connections are open at once, (3) for each feed calls the existing `processFeed`, then writes failure-count / disable DB updates and `recordCrawlRunDetail`, (4) returns `{ crawlRunId, totalFeeds, totalFailed, totalArticlesAdded }`. It does NOT insert the `crawl_runs` row — that is the dispatcher's responsibility.
  - **Where**: `src/crawl.js`
  - **Acceptance criteria**: Processes feeds in concurrent groups of 6; all per-feed DB writes (failure count, article inserts, detail row) happen correctly; returns an accurate summary object.
  - **Depends on**: db.js: Add getFeedsByIds, db.js: Simplify recordCrawlRun

- [ ] **crawl.js: Add dispatchCrawl**
  - **Story**: Cron-triggered dispatcher — replace the monolithic performCrawl entry point
  - **What**: New exported function `dispatchCrawl(db, queue)`. It: (1) calls `getEnabledFeedIds(db)` to get all crawlable feed IDs, (2) generates a `crawlRunId` via `crypto.randomUUID()`, (3) calls `recordCrawlRun(db, { id: crawlRunId, startedAt })` to insert the run header row, (4) splits the IDs into batches of 50, (5) enqueues each batch as a message `{ crawlRunId, startedAt, feedIds }` via `queue.sendBatch()`. Returns `{ crawlRunId, totalFeeds: ids.length, batchCount }` for logging.
  - **Where**: `src/crawl.js`
  - **Acceptance criteria**: Creates exactly one `crawl_runs` row per invocation; enqueues `ceil(N/50)` messages; each message payload contains `crawlRunId`, `startedAt`, and `feedIds`.
  - **Depends on**: db.js: Add getEnabledFeedIds, db.js: Simplify recordCrawlRun, wrangler.jsonc: Add queue producer and consumer bindings

- [ ] **crawl.js: Update performFeedCrawl and remove old functions**
  - **Story**: Adapt single-feed crawl path; clean up replaced code
  - **What**: (1) Update `performFeedCrawl` to: insert the `crawl_runs` row via the simplified `recordCrawlRun(db, { id: crawlRunId, startedAt })`, then delegate to `processCrawlBatch(db, { crawlRunId, startedAt, feedIds: [feedId] })`, then return the summary. (2) Remove `performCrawl` and `performCrawlForFeeds` entirely, since they are replaced by `dispatchCrawl` and `processCrawlBatch`. Update the module-level JSDoc comment to reflect the new exports.
  - **Where**: `src/crawl.js`
  - **Acceptance criteria**: `performFeedCrawl` still returns `{ crawlRunId, totalFeeds, totalFailed, totalArticlesAdded }` and correctly records a `crawl_runs` row and one `crawl_run_details` row. `performCrawl` and `performCrawlForFeeds` no longer exist.
  - **Depends on**: crawl.js: Add processCrawlBatch, crawl.js: Add dispatchCrawl

- [ ] **index.js: Update scheduled handler and add queue handler**
  - **Story**: Wire dispatcher and consumer into the Worker entry point
  - **What**: (1) In the `scheduled` handler, replace `performCrawl(env.DB)` with `dispatchCrawl(env.DB, env.CRAWL_QUEUE)`. Update the log message to reflect the dispatch summary (batchCount, totalFeeds). (2) Add a `queue` export handler: `async queue(batch, env)` — for each message in `batch.messages`, call `processCrawlBatch(env.DB, message.body)`, log the per-batch summary, and call `message.ack()`. Update imports accordingly.
  - **Where**: `src/index.js`
  - **Acceptance criteria**: `scheduled` dispatches batches and logs the result; `queue` processes each message and acknowledges it; a message that throws propagates the error so the queue can retry it.
  - **Depends on**: crawl.js: Add dispatchCrawl, crawl.js: Update performFeedCrawl and remove old functions

- [ ] **Tests: Update seedCrawlRuns helper and crawl history seeding**
  - **Story**: Adapt test infrastructure to the new crawl_runs schema
  - **What**: (1) Update the `seedCrawlRuns` helper to only insert `id`, `started_at`, and `completed_at` — remove the three summary columns from the INSERT. (2) For crawl history tests that previously relied on seeded summary columns (e.g. "shows crawl runs newest-first"), ensure the companion `seedCrawlRunDetails` calls provide enough rows for the aggregate query to return meaningful totals where the test assertions depend on specific numbers.
  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: All crawl history route tests pass; `seedCrawlRuns` no longer references the dropped columns.
  - **Depends on**: Migration: simplify crawl_runs table, db.js: Update getCrawlRuns to aggregate, db.js: Update getCrawlRunById to aggregate

- [ ] **Tests: Rewrite performCrawl tests as processCrawlBatch tests**
  - **Story**: Cover the batch consumer logic that replaces the old monolithic crawl
  - **What**: Replace all `performCrawl(env.DB)` test cases in the "Crawl functionality" describe block with equivalent `processCrawlBatch(env.DB, { crawlRunId, startedAt, feedIds })` calls. Each test must first insert a `crawl_runs` row (via `seedCrawlRuns` or `recordCrawlRun`) since `processCrawlBatch` no longer creates it. Assertions that previously checked summary columns on `crawl_runs` rows should instead aggregate from `crawl_run_details` or check the returned summary object. The test for "does not duplicate articles on re-crawl" should call `processCrawlBatch` twice.
  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: All behaviours currently tested (article insertion, failure count increment, auto-disable, failure count reset, no duplicate articles, error message recording, summary return) are covered with the new function. Import `processCrawlBatch` instead of `performCrawl`.
  - **Depends on**: crawl.js: Add processCrawlBatch, Tests: Update seedCrawlRuns helper and crawl history seeding

- [ ] **Tests: Update performFeedCrawl test**
  - **Story**: Confirm single-feed crawl path still works end-to-end after the refactor
  - **What**: The existing `performFeedCrawl` test at the bottom of the "Crawl functionality" block should continue to pass with minimal or no changes since the function's external contract (signature, return shape, DB side-effects) is preserved. Verify the test still imports `performFeedCrawl` and that any assertions on `crawl_runs` row shape are updated if they reference the dropped summary columns.
  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: The `performFeedCrawl` test passes; it verifies a `crawl_runs` row and a `crawl_run_details` row are created with the correct values.
  - **Depends on**: crawl.js: Update performFeedCrawl and remove old functions, Tests: Rewrite performCrawl tests as processCrawlBatch tests
