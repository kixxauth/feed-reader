/**
 * GET /feeds/:feedId/articles — Paginated articles list for a feed.
 *
 * Pagination strategy:
 * - Page size is fixed at ARTICLES_PAGE_SIZE (20).
 * - Page numbers are 1-indexed in URLs (?page=1, ?page=2, …).
 * - Out-of-bounds pages are clamped silently with a 200 response — no redirect.
 *   Clamping calls getArticlesByFeedPaginated a second time with the corrected page.
 * - Active filter params (from/to) are preserved in pagination links.
 *
 * Date filtering:
 * - `from` and `to` query params must match /^\d{4}-\d{2}-\d{2}$/ to be accepted.
 * - Invalid or absent values are silently set to null (no error shown to user).
 * - Both endpoints are inclusive.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getFeedById, getArticlesByFeedPaginated, ARTICLES_PAGE_SIZE } from '../db.js';
import { resolveArticleUrl } from '../feed-utils.js';
import { notFoundPage } from '../views/partials.js';
import { articlesPage } from '../views/pages/articles.js';

const DATE_PARAM_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function handleArticles(c) {
	const feedId = c.req.param('feedId');

	// Look up the feed — return 404 if it doesn't exist
	const feed = await getFeedById(c.env.DB, feedId);
	if (feed === null) {
		return c.html(
			renderLayout({
				title: 'Not Found — Feed Reader',
				content: notFoundPage('Feed not found.'),
				isAuthenticated: true,
				currentPath: c.req.path,
			}),
			404
		);
	}

	// Parse and validate query parameters
	const rawPage = parseInt(c.req.query('page'), 10);
	let page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

	const rawFrom = c.req.query('from');
	const rawTo = c.req.query('to');
	const fromDate = rawFrom && DATE_PARAM_REGEX.test(rawFrom) ? rawFrom : null;
	const toDate = rawTo && DATE_PARAM_REGEX.test(rawTo) ? rawTo : null;

	const rawListPage = parseInt(c.req.query('listPage'), 10);
	const listPage = isNaN(rawListPage) || rawListPage < 1 ? 1 : rawListPage;
	const listDisabled = c.req.query('disabled') === '1';

	// Fetch articles — may need a second call if page is out of bounds
	let { articles, total } = await getArticlesByFeedPaginated(
		c.env.DB,
		feedId,
		page,
		fromDate,
		toDate
	);

	const totalPages = Math.max(1, Math.ceil(total / ARTICLES_PAGE_SIZE));

	// Clamp out-of-bounds page silently and re-fetch
	if (page > totalPages) {
		page = totalPages;
		({ articles, total } = await getArticlesByFeedPaginated(
			c.env.DB,
			feedId,
			page,
			fromDate,
			toDate
		));
	}

	const filtersActive = fromDate !== null || toDate !== null;

	const listParams = [];
	if (listPage > 1) listParams.push(`page=${listPage}`);
	if (listDisabled) listParams.push('disabled=1');
	const backToFeedsHref = listParams.length > 0 ? `/feeds?${listParams.join('&')}` : '/feeds';

	// Build filter query string for pagination links (preserves active filters)
	const filterParts = [];
	if (fromDate !== null) filterParts.push(`from=${encodeURIComponent(fromDate)}`);
	if (toDate !== null) filterParts.push(`to=${encodeURIComponent(toDate)}`);
	if (listPage > 1) filterParts.push(`listPage=${listPage}`);
	if (listDisabled) filterParts.push('disabled=1');
	const filterQs = filterParts.join('&');

	const feedBaseUrl = feed.html_url || feed.xml_url;

	return c.html(
		renderLayout({
			title: `${feed.title} Articles — Feed Reader`,
			content: articlesPage({
				feed,
				articles,
				total,
				page,
				totalPages,
				fromDate,
				toDate,
				filtersActive,
				feedId,
				feedBaseUrl,
				backToFeedsHref,
				filterQs,
			}, resolveArticleUrl),
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}
