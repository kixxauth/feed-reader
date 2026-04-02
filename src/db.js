/**
 * Database query helpers for the feeds and articles tables.
 *
 * All functions accept a D1 database binding as the first argument
 * (i.e. `c.env.DB` from a Hono context, or `env.DB` in tests).
 *
 * Exports:
 *   PAGE_SIZE                  — feeds per page (50), used by route handlers for pagination math
 *   ARTICLES_PAGE_SIZE         — articles per page (20), used by articles route handler
 *   getFeedsPaginated          — returns one page of feeds plus the total count; accepts optional { disabledOnly, titleSearch, domainSearch } filters
 *   getFeedById                — returns a single feed by id, or null if not found
 *   getFeedByXmlUrl            — returns a single feed by normalized xml_url, or null if not found
 *   getArticlesByFeedPaginated — returns paginated articles for a feed with optional date filtering
 *   createFeed                 — inserts a single feed row for UI-driven feed creation
 *   upsertFeed                 — insert-or-update a single feed row (used by future admin endpoints)
 *   getEnabledFeedIds          — returns only feed IDs where no_crawl = 0 (used by dispatcher)
 *   getFeedsByIds              — returns full feed rows for an array of IDs (used by queue consumer)
 *   getCrawlRuns               — returns the most recent N crawl runs (for history page)
 *   getCrawlRunById            — returns a single crawl run by id, or null if not found
 *   getCrawlRunDetails         — returns all crawl_run_details rows for a crawl, joined with feeds
 *   recordCrawlRun             — inserts a new crawl_runs row at crawl start (id and started_at only)
 *   recordCrawlRunDetail       — inserts a row into crawl_run_details
 *   updateFeedFailureCount     — sets consecutive_failure_count for a feed
 *   disableFeed                — sets no_crawl = 1 and consecutive_failure_count = 0 for a feed
 *   updateFeedCrawlStatus      — sets no_crawl to a given value for a feed (toggle endpoint)
 *   resetFeedFailureCount      — sets consecutive_failure_count = 0 for a feed
 *   insertArticle              — inserts a single article, ON CONFLICT DO NOTHING
 *   getRecentActivityForFeed   — returns the most recent N crawl_run_details rows for a feed, joined with crawl_runs
 *   getCrawlRunDetailByFeed    — returns one crawl_run_details row for a crawl run + feed pair
 *   getDailyReaderArticles     — returns flat joined rows for all enabled-feed articles on a given UTC day
 *   updateFeedFeatured         — sets featured to a given value for a feed (toggle endpoint)
 */

import { canonicalizeHttpUrl, normalizeUrlForComparison } from './feed-utils.js';

export const PAGE_SIZE = 50;
export const ARTICLES_PAGE_SIZE = 20;

/**
 * Return a paginated slice of feeds sorted by hostname ascending, plus the total count.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {number} page - 1-indexed page number (clamped to 1 if < 1)
 * @param {{ disabledOnly?: boolean, titleSearch?: string, domainSearch?: string }} [options]
 * @returns {Promise<{ feeds: Array, total: number }>}
 */
export async function getFeedsPaginated(db, page, { disabledOnly = false, titleSearch = '', domainSearch = '' } = {}) {
	const clampedPage = Math.max(1, page);
	const offset = (clampedPage - 1) * PAGE_SIZE;

	const conditions = [];
	const bindings = [];

	if (disabledOnly) {
		conditions.push('no_crawl = 1');
	}
	if (titleSearch) {
		conditions.push('title LIKE ?');
		bindings.push(`%${titleSearch}%`);
	}
	if (domainSearch) {
		conditions.push('hostname LIKE ?');
		bindings.push(`%${domainSearch}%`);
	}

	const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

	const countRow = await db
		.prepare(`SELECT COUNT(*) AS total FROM feeds${whereClause}`)
		.bind(...bindings)
		.first();
	const total = countRow.total;

	const result = await db
		.prepare(`SELECT * FROM feeds${whereClause} ORDER BY hostname ASC LIMIT ? OFFSET ?`)
		.bind(...bindings, PAGE_SIZE, offset)
		.all();

	return { feeds: result.results, total };
}

/**
 * Return a single feed by its id, or null if no feed with that id exists.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} feedId - The feed id to look up
 * @returns {Promise<Object|null>}
 */
export async function getFeedById(db, feedId) {
	const row = await db.prepare('SELECT * FROM feeds WHERE id = ?').bind(feedId).first();
	return row ?? null;
}

/**
 * Return a single feed by normalized xml_url, or null if not found.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} xmlUrl - The feed URL to look up
 * @returns {Promise<Object|null>}
 */
export async function getFeedByXmlUrl(db, xmlUrl) {
	const normalizedUrl = normalizeUrlForComparison(xmlUrl);
	if (!normalizedUrl) {
		return null;
	}

	const row = await db
		.prepare('SELECT * FROM feeds WHERE xml_url IS NOT NULL AND LOWER(TRIM(xml_url)) = ?')
		.bind(normalizedUrl)
		.first();
	return row ?? null;
}

/**
 * Return a paginated slice of articles for a feed, sorted newest-first (NULLs last),
 * optionally filtered by published date range. Returns the filtered total count.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} feedId - The feed id to query
 * @param {number} page - 1-indexed page number
 * @param {string|null} fromDate - Optional inclusive lower bound on published (YYYY-MM-DD)
 * @param {string|null} toDate - Optional inclusive upper bound on published (YYYY-MM-DD)
 * @returns {Promise<{ articles: Array, total: number }>}
 */
export async function getArticlesByFeedPaginated(db, feedId, page, fromDate, toDate) {
	const offset = (page - 1) * ARTICLES_PAGE_SIZE;

	// Build dynamic WHERE clause — feed_id is always required
	const conditions = ['feed_id = ?'];
	const bindings = [feedId];

	if (fromDate !== null && fromDate !== undefined) {
		// DATE() normalizes both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM:SS.mmmZ' to 'YYYY-MM-DD'
		// so the comparison is correct regardless of which format is stored in the column.
		conditions.push('DATE(published) >= ?');
		bindings.push(fromDate);
	}

	if (toDate !== null && toDate !== undefined) {
		conditions.push('DATE(published) <= ?');
		bindings.push(toDate);
	}

	const whereClause = conditions.join(' AND ');

	// COUNT query uses the same WHERE clause so total reflects the filtered result set
	const countRow = await db
		.prepare(`SELECT COUNT(*) AS total FROM articles WHERE ${whereClause}`)
		.bind(...bindings)
		.first();
	const total = countRow.total;

	// SELECT query with NULL-safe descending sort and pagination
	const result = await db
		.prepare(
			`SELECT * FROM articles WHERE ${whereClause} ORDER BY (published IS NULL), published DESC LIMIT ? OFFSET ?`
		)
		.bind(...bindings, ARTICLES_PAGE_SIZE, offset)
		.all();

	return { articles: result.results, total };
}

/**
 * Insert a new feed row.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {{
 *   id: string,
 *   hostname: string,
 *   type: string|null,
 *   title: string,
 *   xml_url: string,
 *   html_url: string|null,
 *   no_crawl: number,
 *   description: string|null,
 *   last_build_date: string|null,
 *   score: number|null
 * }} feedData - The feed data to insert
 * @returns {Promise<D1Result>}
 */
export async function createFeed(db, feedData) {
	const sql = `
		INSERT INTO feeds (id, hostname, type, title, xml_url, html_url, no_crawl, description, last_build_date, score)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;

	return db
		.prepare(sql)
		.bind(
			feedData.id,
			feedData.hostname,
			feedData.type ?? null,
			feedData.title,
			canonicalizeHttpUrl(feedData.xml_url),
			canonicalizeHttpUrl(feedData.html_url),
			feedData.no_crawl ?? 0,
			feedData.description ?? null,
			feedData.last_build_date ?? null,
			feedData.score ?? null
		)
		.run();
}

/**
 * Insert a feed row, or update all fields if a feed with the same id already exists.
 *
 * Note: bulk importing is handled by scripts/import-feeds.js (Node.js CLI), which
 * generates its own inline SQL rather than calling this function. Worker-side
 * user feed creation uses createFeed(); upsertFeed remains available for import-
 * style or future administrative flows that intentionally update existing ids.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {{
 *   id: string,
 *   hostname: string,
 *   type: string|null,
 *   title: string,
 *   xml_url: string|null,
 *   html_url: string|null,
 *   no_crawl: number,
 *   description: string|null,
 *   last_build_date: string|null,
 *   score: number|null
 * }} feedData - The feed data to upsert
 * @returns {Promise<D1Result>}
 */
export async function upsertFeed(db, feedData) {
	const xmlUrl = canonicalizeHttpUrl(feedData.xml_url);
	const htmlUrl = canonicalizeHttpUrl(feedData.html_url);

	const sql = `
		INSERT INTO feeds (id, hostname, type, title, xml_url, html_url, no_crawl, description, last_build_date, score)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		  hostname = excluded.hostname,
		  type = excluded.type,
		  title = excluded.title,
		  xml_url = excluded.xml_url,
		  html_url = excluded.html_url,
		  no_crawl = excluded.no_crawl,
		  description = excluded.description,
		  last_build_date = excluded.last_build_date,
		  score = excluded.score,
		  updated_at = CURRENT_TIMESTAMP
	`;

	return db
		.prepare(sql)
		.bind(
			feedData.id,
			feedData.hostname,
			feedData.type ?? null,
			feedData.title,
			xmlUrl,
			htmlUrl,
			feedData.no_crawl ?? 0,
			feedData.description ?? null,
			feedData.last_build_date ?? null,
			feedData.score ?? null
		)
		.run();
}

/**
 * Return only the IDs of all crawl-enabled feeds (no_crawl = 0).
 * Used by the dispatcher to build queue messages without fetching full feed rows.
 *
 * @param {D1Database} db - The D1 database binding
 * @returns {Promise<string[]>}
 */
export async function getEnabledFeedIds(db) {
	const result = await db.prepare('SELECT id FROM feeds WHERE no_crawl = 0').all();
	return result.results.map((row) => row.id);
}

/**
 * Return full feed rows for the given array of feed IDs.
 * Used by the queue consumer to re-hydrate feed objects from the IDs enqueued by the dispatcher.
 * Returns an empty array when ids is empty.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string[]} ids - Array of feed IDs to fetch
 * @returns {Promise<Array>}
 */
export async function getFeedsByIds(db, ids) {
	if (!ids || ids.length === 0) {
		return [];
	}
	const placeholders = ids.map(() => '?').join(', ');
	const result = await db
		.prepare(`SELECT * FROM feeds WHERE id IN (${placeholders})`)
		.bind(...ids)
		.all();
	return result.results;
}

/**
 * Return the most recent N crawl runs ordered by started_at DESC.
 * Aggregate totals are derived at query time from crawl_run_details rows via LEFT JOIN.
 * Returns 0 for all totals when no detail rows exist for a run.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {number} limit - Maximum number of rows to return
 * @returns {Promise<Array>}
 */
export async function getCrawlRuns(db, limit) {
	const sql = `
		SELECT
			r.id,
			r.started_at,
			r.created_at,
			COALESCE(COUNT(d.feed_id), 0) AS total_feeds_attempted,
			COALESCE(SUM(CASE WHEN d.status = 'failed' OR d.status = 'auto_disabled' THEN 1 ELSE 0 END), 0) AS total_feeds_failed,
			COALESCE(SUM(d.articles_added), 0) AS total_articles_added
		FROM crawl_runs r
		LEFT JOIN crawl_run_details d ON r.id = d.crawl_run_id
		GROUP BY r.id, r.started_at, r.created_at
		ORDER BY r.started_at DESC
		LIMIT ?
	`;
	const result = await db.prepare(sql).bind(limit).all();
	return result.results;
}

/**
 * Return a single crawl run by its id, or null if not found.
 * Aggregate totals are derived at query time from crawl_run_details rows via LEFT JOIN.
 * Returns 0 for all totals when no detail rows exist for the run.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} crawlRunId - The crawl run id to look up
 * @returns {Promise<Object|null>}
 */
export async function getCrawlRunById(db, crawlRunId) {
	const sql = `
		SELECT
			r.id,
			r.started_at,
			r.created_at,
			COALESCE(COUNT(d.feed_id), 0) AS total_feeds_attempted,
			COALESCE(SUM(CASE WHEN d.status = 'failed' OR d.status = 'auto_disabled' THEN 1 ELSE 0 END), 0) AS total_feeds_failed,
			COALESCE(SUM(d.articles_added), 0) AS total_articles_added
		FROM crawl_runs r
		LEFT JOIN crawl_run_details d ON r.id = d.crawl_run_id
		WHERE r.id = ?
		GROUP BY r.id, r.started_at, r.created_at
	`;
	const row = await db.prepare(sql).bind(crawlRunId).first();
	return row ?? null;
}

/**
 * Return all crawl_run_details rows for a specific crawl run, LEFT JOINed with feeds
 * to include feeds.title and feeds.hostname. If a feed has been deleted, these will be null.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} crawlRunId - The crawl run id
 * @returns {Promise<Array>}
 */
export async function getCrawlRunDetails(db, crawlRunId) {
	const sql = `
		SELECT d.*, f.title AS feed_title, f.hostname AS feed_hostname, f.html_url AS feed_html_url, f.xml_url AS feed_xml_url
		FROM crawl_run_details d
		LEFT JOIN feeds f ON d.feed_id = f.id
		WHERE d.crawl_run_id = ?
	`;
	const result = await db.prepare(sql).bind(crawlRunId).all();
	return result.results;
}

/**
 * Insert a new row into crawl_runs when a crawl run begins.
 * The caller generates the id via crypto.randomUUID() before calling this.
 * Totals are no longer stored here; they are derived at query time from crawl_run_details.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {{
 *   id: string,
 *   startedAt: string
 * }} crawlRun - The crawl run data to insert
 * @returns {Promise<D1Result>}
 */
export async function recordCrawlRun(db, { id, startedAt }) {
	const sql = `
		INSERT INTO crawl_runs (id, started_at)
		VALUES (?, ?)
	`;
	return db
		.prepare(sql)
		.bind(id, startedAt)
		.run();
}

/**
 * Insert a row into crawl_run_details for a single feed's result in a crawl.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {{
 *   crawlRunId: string,
 *   feedId: string,
 *   status: string,
 *   articlesAdded: number,
 *   errorMessage: string|null,
 *   autoDisabled: number
 * }} detail - The crawl run detail data to insert
 * @returns {Promise<D1Result>}
 */
export async function recordCrawlRunDetail(db, { crawlRunId, feedId, status, articlesAdded, errorMessage, autoDisabled }) {
	const sql = `
		INSERT OR IGNORE INTO crawl_run_details (crawl_run_id, feed_id, status, articles_added, error_message, auto_disabled)
		VALUES (?, ?, ?, ?, ?, ?)
	`;
	return db
		.prepare(sql)
		.bind(crawlRunId, feedId, status, articlesAdded, errorMessage ?? null, autoDisabled ?? 0)
		.run();
}

/**
 * Increment articles_added on an existing crawl_run_details row.
 */
export async function updateFeedFailureCount(db, feedId, count) {
	return db
		.prepare('UPDATE feeds SET consecutive_failure_count = ? WHERE id = ?')
		.bind(count, feedId)
		.run();
}

/**
 * Disable a feed by setting no_crawl = 1 and consecutive_failure_count = 0.
 * Resetting the count prevents re-triggering if someone queries the DB directly.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} feedId - The feed id to disable
 * @returns {Promise<D1Result>}
 */
export async function disableFeed(db, feedId) {
	return db
		.prepare('UPDATE feeds SET no_crawl = 1, consecutive_failure_count = 0 WHERE id = ?')
		.bind(feedId)
		.run();
}

/**
 * Set no_crawl to the given value for a feed (used by the toggle endpoint).
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} feedId - The feed id
 * @param {number} noCrawl - The new no_crawl value (0 or 1)
 * @returns {Promise<D1Result>}
 */
export async function updateFeedCrawlStatus(db, feedId, noCrawl) {
	return db
		.prepare('UPDATE feeds SET no_crawl = ? WHERE id = ?')
		.bind(noCrawl, feedId)
		.run();
}

/**
 * Reset consecutive_failure_count to 0 for a feed.
 * Called on a successful crawl or when the user manually re-enables a feed.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} feedId - The feed id
 * @returns {Promise<D1Result>}
 */
export async function resetFeedFailureCount(db, feedId) {
	return db
		.prepare('UPDATE feeds SET consecutive_failure_count = 0 WHERE id = ?')
		.bind(feedId)
		.run();
}

/**
 * Insert a single article row using ON CONFLICT(id) DO NOTHING to prevent duplicates.
 * Returns the D1Result; use result.meta.changes to determine whether a row was actually
 * inserted (1 = new article, 0 = duplicate).
 *
 * @param {D1Database} db - The D1 database binding
 * @param {{
 *   id: string,
 *   feedId: string,
 *   link: string|null,
 *   title: string|null,
 *   published: string|null,
 *   updated: string|null,
 *   added: string
 * }} article - The article data to insert
 * @returns {Promise<D1Result>}
 */
export async function insertArticle(db, { id, feedId, link, title, published, updated, added }) {
	const sql = `
		INSERT INTO articles (id, feed_id, link, title, published, updated, added)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING
	`;
	return db
		.prepare(sql)
		.bind(id, feedId, link ?? null, title ?? null, published ?? null, updated ?? null, added)
		.run();
}

/**
 * Return the most recent crawl activity rows for a specific feed, ordered newest-first.
 * Each row combines columns from crawl_run_details and the associated crawl_runs row.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} feedId - The feed id to query activity for
 * @param {number} [limit=5] - Maximum number of rows to return
 * @returns {Promise<Array<{
 *   started_at: string,
 *   status: string,
 *   articles_added: number,
 *   error_message: string|null,
 *   auto_disabled: number
 * }>>} Array of recent crawl activity rows, empty when no history exists
 */
export async function getRecentActivityForFeed(db, feedId, limit = 5) {
	const sql = `
		SELECT r.started_at, d.status, d.articles_added, d.error_message, d.auto_disabled
		FROM crawl_run_details d
		JOIN crawl_runs r ON d.crawl_run_id = r.id
		WHERE d.feed_id = ?
		ORDER BY r.started_at DESC
		LIMIT ?
	`;
	const result = await db.prepare(sql).bind(feedId, limit).all();
	return result.results;
}

/**
 * Return one crawl_run_details row for the given crawl run + feed pair, or null
 * if the background crawl has not recorded a result yet.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} crawlRunId - The crawl run id
 * @param {string} feedId - The feed id
 * @returns {Promise<Object|null>}
 */
export async function getCrawlRunDetailByFeed(db, crawlRunId, feedId) {
	const row = await db
		.prepare('SELECT * FROM crawl_run_details WHERE crawl_run_id = ? AND feed_id = ?')
		.bind(crawlRunId, feedId)
		.first();
	return row ?? null;
}

/**
 * Return all articles for a given UTC day across all enabled feeds, as flat joined rows.
 *
 * The effective date of an article is `published` when present, else `added`
 * (the "published preferred, added fallback" rule). SQLite's DATE() extracts
 * YYYY-MM-DD from both date-only strings ('2026-03-24') and full ISO timestamps
 * ('2026-03-24T02:00:00.000Z'), so the same function works for both formats.
 *
 * Disabled feeds (no_crawl = 1) are excluded. The route handler groups the flat
 * rows by feed_id in JavaScript and sorts groups by article count descending.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} selectedDate - A YYYY-MM-DD string for the day to query
 * @returns {Promise<Array<{
 *   feed_id: string,
 *   feed_title: string,
 *   feed_html_url: string|null,
 *   feed_xml_url: string|null,
 *   feed_featured: number,
 *   article_id: string,
 *   article_title: string|null,
 *   article_link: string|null,
 *   article_published: string|null,
 *   article_added: string|null
 * }>>}
 */
export async function getDailyReaderArticles(db, selectedDate) {
	const sql = `
		WITH feed_frequency AS (
			SELECT feed_id, COUNT(*) AS post_count_30d
			FROM articles
			WHERE DATE(COALESCE(published, added)) >= DATE(?, '-30 days')
			  AND DATE(COALESCE(published, added)) <= DATE(?)
			GROUP BY feed_id
		)
		SELECT
			feeds.id AS feed_id,
			feeds.title AS feed_title,
			feeds.html_url AS feed_html_url,
			feeds.xml_url AS feed_xml_url,
			feeds.featured AS feed_featured,
			COALESCE(ff.post_count_30d, 0) AS feed_post_count_30d,
			articles.id AS article_id,
			articles.title AS article_title,
			articles.link AS article_link,
			articles.published AS article_published,
			articles.added AS article_added
		FROM articles
		JOIN feeds ON articles.feed_id = feeds.id
		LEFT JOIN feed_frequency ff ON ff.feed_id = feeds.id
		WHERE feeds.no_crawl = 0
		  AND DATE(COALESCE(articles.published, articles.added)) = ?
		ORDER BY feeds.title ASC, COALESCE(articles.published, articles.added) DESC, articles.id ASC
	`;
	const result = await db.prepare(sql).bind(selectedDate, selectedDate, selectedDate).all();
	return result.results;
}

/**
 * Set featured to the given value for a feed (used by the toggle endpoint).
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} feedId - The feed id
 * @param {number} featured - The new featured value (0 or 1)
 * @returns {Promise<D1Result>}
 */
export async function updateFeedFeatured(db, feedId, featured) {
	return db
		.prepare('UPDATE feeds SET featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
		.bind(featured, feedId)
		.run();
}
