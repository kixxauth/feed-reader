CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  feed_id TEXT,
  link TEXT,
  title TEXT,
  published TEXT,
  updated TEXT,
  added TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_feed_published ON articles(feed_id, published);
