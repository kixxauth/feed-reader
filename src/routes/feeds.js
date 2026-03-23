/**
 * GET /feeds — Paginated feeds list page.
 *
 * Pagination strategy:
 * - Page size is fixed at PAGE_SIZE (50). No user-configurable page size.
 * - Page numbers are 1-indexed in URLs (?page=1, ?page=2, …).
 * - Out-of-bounds pages (< 1 or > totalPages) are clamped silently with a 200
 *   response — no redirect. This avoids redirect loops and keeps URLs clean.
 * - The handler runs one COUNT query directly before calling getFeedsPaginated,
 *   which runs a second COUNT internally. This is a minor redundancy kept
 *   intentionally so getFeedsPaginated stays self-contained and testable
 *   independently of the handler's clamping logic.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getFeedsPaginated, PAGE_SIZE } from '../db.js';
import { escapeHtml } from '../html-utils.js';

export async function handleFeeds(c) {
	const rawPage = parseInt(c.req.query('page'), 10);
	let page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

	// Count first to clamp out-of-bounds page values
	const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM feeds').first();
	const total = countRow.total;
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	if (total > 0 && page > totalPages) {
		page = totalPages;
	}

	const { feeds } = await getFeedsPaginated(c.env.DB, page);

	let content;
	if (total === 0) {
		content = `<main>
  <h1>Feeds</h1>
  <p>No feeds available</p>
</main>`;
	} else {
		const items = feeds
			.map((feed) => {
				const title = escapeHtml(feed.title);
				const hostname = escapeHtml(feed.hostname);
				const htmlUrl = escapeHtml(feed.html_url);
				const feedId = escapeHtml(feed.id);
				return `<li class="feed-item">
    <a href="${htmlUrl}" target="_blank" rel="noopener noreferrer">${title}</a>
    <span class="feed-hostname">${hostname}</span>
    <a href="/feeds/${feedId}/articles">Articles</a>
  </li>`;
			})
			.join('\n');

		const prevLink =
			page === 1
				? `<a aria-disabled="true">Previous</a>`
				: `<a href="/feeds?page=${page - 1}">Previous</a>`;

		const nextLink =
			page === totalPages
				? `<a aria-disabled="true">Next</a>`
				: `<a href="/feeds?page=${page + 1}">Next</a>`;

		content = `<main>
  <h1>Feeds</h1>
  <ul class="feed-list">
${items}
  </ul>
  <nav class="pagination">
    ${prevLink}
    <span>Page ${page} of ${totalPages}</span>
    ${nextLink}
  </nav>
</main>`;
	}

	return c.html(
		renderLayout({
			title: 'Feeds — Feed Reader',
			content,
			isAuthenticated: true,
		})
	);
}
