-- Preview: show duplicate (feed_id, link) groups and which rows would be deleted
SELECT
  a.feed_id,
  a.link,
  a.id,
  LENGTH(a.id) AS id_len,
  CASE
    WHEN LENGTH(a.id) < MAX(LENGTH(b.id)) THEN 'DELETE'
    ELSE 'KEEP'
  END AS action
FROM articles a
JOIN articles b ON b.link = a.link AND b.feed_id = a.feed_id
GROUP BY a.id
HAVING COUNT(*) > 1
ORDER BY a.feed_id, a.link, id_len DESC;

-- Delete duplicates: remove rows where a longer ID exists for the same (feed_id, link)
DELETE FROM articles
WHERE id IN (
  SELECT a.id
  FROM articles a
  WHERE EXISTS (
    SELECT 1
    FROM articles b
    WHERE b.link    = a.link
      AND b.feed_id = a.feed_id
      AND LENGTH(b.id) > LENGTH(a.id)
  )
);
