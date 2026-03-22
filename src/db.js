/**
 * Database query helpers for the feeds table.
 *
 * All functions accept a D1 database binding as the first argument
 * (i.e. `c.env.DB` from a Hono context, or `env.DB` in tests).
 *
 * Exports:
 *   PAGE_SIZE           — feeds per page (50), used by route handlers for pagination math
 *   getFeedsPaginated   — returns one page of feeds plus the total count
 *   upsertFeed          — insert-or-update a single feed row (used by future admin endpoints)
 */

export const PAGE_SIZE = 50;

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
