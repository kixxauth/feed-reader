-- Remove the completed_at column from crawl_runs.
-- The column was never written to; totals are derived from crawl_run_details
-- and there is no mechanism to record a run's end time in the queue fan-out
-- architecture.

-- Step 1: create new table without completed_at
CREATE TABLE crawl_runs_new (
  id         TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: copy existing rows
INSERT INTO crawl_runs_new (id, started_at, created_at)
SELECT id, started_at, created_at FROM crawl_runs;

-- Step 3: drop old table
DROP TABLE crawl_runs;

-- Step 4: rename
ALTER TABLE crawl_runs_new RENAME TO crawl_runs;

-- Step 5: recreate index
CREATE INDEX IF NOT EXISTS idx_crawl_runs_started_at ON crawl_runs(started_at DESC);
