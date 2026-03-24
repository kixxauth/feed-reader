CREATE UNIQUE INDEX idx_feeds_xml_url_normalized_unique
ON feeds(LOWER(TRIM(xml_url)))
WHERE xml_url IS NOT NULL AND LENGTH(TRIM(xml_url)) > 0;
