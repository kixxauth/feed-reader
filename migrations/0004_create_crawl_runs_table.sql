CREATE TABLE IF NOT EXISTS crawl_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  total_feeds_attempted INTEGER NOT NULL,
  total_feeds_failed INTEGER NOT NULL,
  total_articles_added INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crawl_runs_started_at ON crawl_runs(started_at DESC);
