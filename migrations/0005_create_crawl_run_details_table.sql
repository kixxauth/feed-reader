CREATE TABLE IF NOT EXISTS crawl_run_details (
  crawl_run_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  status TEXT NOT NULL,
  articles_added INTEGER NOT NULL,
  error_message TEXT,
  auto_disabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (crawl_run_id, feed_id)
);
