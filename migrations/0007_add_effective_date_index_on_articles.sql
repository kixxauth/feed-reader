-- Expression index to speed up the daily reader query in getDailyReaderArticles.
-- DATE(COALESCE(published, added)) is the effective-date used to match articles
-- to a selected day. Without this index the query requires a full table scan.
CREATE INDEX idx_articles_effective_date ON articles (DATE(COALESCE(published, added)));
