/**
 * Database query helpers for the feeds and articles tables.
 *
 * All functions accept a D1 database binding as the first argument
 * (i.e. `c.env.DB` from a Hono context, or `env.DB` in tests).
 *
 * Exports:
 *   PAGE_SIZE                  — feeds per page (50), used by route handlers for pagination math
 *   ARTICLES_PAGE_SIZE         — articles per page (20), used by articles route handler
 *   getFeedsPaginated          — returns one page of feeds plus the total count
 *   getFeedById                — returns a single feed by id, or null if not found
 *   getArticlesByFeedPaginated — returns paginated articles for a feed with optional date filtering
 *   upsertFeed                 — insert-or-update a single feed row (used by future admin endpoints)
 */

export const PAGE_SIZE = 50;
export const ARTICLES_PAGE_SIZE = 20;

/**
 * Return a paginated slice of feeds sorted by hostname ascending, plus the total count.
 *
 * @param {D1Database} db - The D1 database binding
 * @param {number} page - 1-indexed page number (clamped to 1 if < 1)
 * @returns {Promise<{ feeds: Array, total: number }>}
 */
export async function getFeedsPaginated(db, page) {
	const clampedPage = Math.max(1, page);
	const offset = (clampedPage - 1) * PAGE_SIZE;

	const countRow = await db.prepare('SELECT COUNT(*) AS total FROM feeds').first();
	const total = countRow.total;

	const result = await db
		.prepare('SELECT * FROM feeds ORDER BY hostname ASC LIMIT ? OFFSET ?')
		.bind(PAGE_SIZE, offset)
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
		conditions.push('published >= ?');
		bindings.push(fromDate);
	}

	if (toDate !== null && toDate !== undefined) {
		conditions.push('published <= ?');
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
 * Insert a feed row, or update all fields if a feed with the same id already exists.
 *
 * Note: bulk importing is handled by scripts/import-feeds.js (Node.js CLI), which
 * generates its own inline SQL rather than calling this function. This function is
 * here for use by future Worker-side admin API endpoints (e.g., POST /admin/feeds).
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
			feedData.xml_url ?? null,
			feedData.html_url ?? null,
			feedData.no_crawl ?? 0,
			feedData.description ?? null,
			feedData.last_build_date ?? null,
			feedData.score ?? null
		)
		.run();
}
