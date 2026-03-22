CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  type TEXT,
  title TEXT NOT NULL,
  xml_url TEXT,
  html_url TEXT,
  no_crawl INTEGER DEFAULT 0,
  description TEXT,
  last_build_date TEXT,
  score REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feeds_hostname ON feeds(hostname);
