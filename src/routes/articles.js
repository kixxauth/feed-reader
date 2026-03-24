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
import { escapeHtml } from '../html-utils.js';
import { resolveArticleUrl } from '../feed-utils.js';

const DATE_PARAM_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function handleArticles(c) {
	const feedId = c.req.param('feedId');

	// Look up the feed — return 404 if it doesn't exist
	const feed = await getFeedById(c.env.DB, feedId);
	if (feed === null) {
		return c.html(
			renderLayout({
				title: 'Not Found — Feed Reader',
				content: '<main><h1>Not Found</h1><p>Feed not found.</p></main>',
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

	let content;

	if (total === 0 && !filtersActive) {
		// Empty state: no articles at all for this feed
		content = `<main>
  <h1>${escapeHtml(feed.title)}</h1>
  <a href="${backToFeedsHref}">Back to Feeds</a>
  <p>No articles available for this feed</p>
</main>`;
	} else if (total === 0 && filtersActive) {
		// Empty state: filters active but no matches — show filter form so user can clear
		const filterForm = buildFilterForm(feedId, fromDate, toDate);
		content = `<main>
  <h1>${escapeHtml(feed.title)}</h1>
  <a href="${backToFeedsHref}">Back to Feeds</a>
  ${filterForm}
  <p>No articles match the current filter</p>
</main>`;
	} else {
		// Articles found — show filter form, article list, and pagination
		const filterForm = buildFilterForm(feedId, fromDate, toDate);
		const feedBaseUrl = feed.html_url || feed.xml_url;

		const items = articles
			.map((article) => {
				const resolvedLink = resolveArticleUrl(article.link, feedBaseUrl);
				const titleHtml = resolvedLink
					? `<a href="${escapeHtml(resolvedLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>`
					: `<span class="article-title">${escapeHtml(article.title)}</span>`;

				const formattedDate = article.published
					? new Date(article.published).toLocaleDateString('en-US', {
							year: 'numeric',
							month: 'short',
							day: 'numeric',
							timeZone: 'UTC',
						})
					: 'Date unknown';

				return `<li class="article-item">
    ${titleHtml}
    <span class="article-date">${formattedDate}</span>
  </li>`;
			})
			.join('\n');

		// Build filter query string for pagination links (preserves active filters)
		const filterParts = [];
		if (fromDate !== null) filterParts.push(`from=${encodeURIComponent(fromDate)}`);
		if (toDate !== null) filterParts.push(`to=${encodeURIComponent(toDate)}`);
		if (listPage > 1) filterParts.push(`listPage=${listPage}`);
		if (listDisabled) filterParts.push('disabled=1');
		const filterQs = filterParts.join('&');

		const prevLink =
			page === 1
				? `<a aria-disabled="true">Previous</a>`
				: `<a href="/feeds/${feedId}/articles?${filterQs ? filterQs + '&' : ''}page=${page - 1}">Previous</a>`;

		const nextLink =
			page === totalPages
				? `<a aria-disabled="true">Next</a>`
				: `<a href="/feeds/${feedId}/articles?${filterQs ? filterQs + '&' : ''}page=${page + 1}">Next</a>`;

		content = `<main>
  <h1>${escapeHtml(feed.title)}</h1>
  <a href="${backToFeedsHref}">Back to Feeds</a>
  ${filterForm}
  <ul class="article-list">
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
			title: `${escapeHtml(feed.title)} Articles — Feed Reader`,
			content,
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}

/**
 * Build the date filter form HTML.
 *
 * @param {string} feedId
 * @param {string|null} fromDate
 * @param {string|null} toDate
 * @returns {string}
 */
function buildFilterForm(feedId, fromDate, toDate) {
	return `<form method="GET" class="filter-form">
    <input type="date" name="from" value="${fromDate ?? ''}">
    <input type="date" name="to" value="${toDate ?? ''}">
    <button type="submit">Filter</button>
    <a href="/feeds/${escapeHtml(feedId)}/articles">Clear</a>
  </form>`;
}
