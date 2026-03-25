-- Recreate crawl_runs without the denormalized summary columns.
-- Totals (total_feeds_attempted, total_feeds_failed, total_articles_added) are
-- now derived at query time by aggregating crawl_run_details rows.

-- Step 1: create new simplified table
CREATE TABLE crawl_runs_new (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: copy existing rows, preserving id, started_at, completed_at, created_at
INSERT INTO crawl_runs_new (id, started_at, completed_at, created_at)
SELECT id, started_at, completed_at, created_at FROM crawl_runs;

-- Step 3: drop old table
DROP TABLE crawl_runs;

-- Step 4: rename new table to canonical name
ALTER TABLE crawl_runs_new RENAME TO crawl_runs;

-- Step 5: recreate the index on started_at
CREATE INDEX IF NOT EXISTS idx_crawl_runs_started_at ON crawl_runs(started_at DESC);
