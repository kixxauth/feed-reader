-- Remove articles that were bulk-imported with source-database UUIDs as their
-- primary key when a crawled duplicate (keyed as {feedId}:{guid-or-link})
-- already exists for the same feed and link.
--
-- Imported article IDs are 32-char hex strings (no colons).
-- Crawled article IDs follow the pattern "{feedId}:{identifier}".
-- Matching on (feed_id, link) identifies the same logical article.
DELETE FROM articles
WHERE id NOT LIKE '%:%'
  AND EXISTS (
    SELECT 1 FROM articles AS dup
    WHERE dup.feed_id = articles.feed_id
      AND dup.link = articles.link
      AND dup.id LIKE dup.feed_id || ':%'
      AND dup.id != articles.id
  );
