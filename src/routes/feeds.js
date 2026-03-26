/**
 * GET /feeds — Paginated feeds list page.
 *
 * Pagination strategy:
 * - Page size is fixed at PAGE_SIZE (50). No user-configurable page size.
 * - Page numbers are 1-indexed in URLs (?page=1, ?page=2, …).
 * - Out-of-bounds pages (< 1 or > totalPages) are clamped silently with a 200
 *   response — no redirect. This avoids redirect loops and keeps URLs clean.
 * - getFeedsPaginated returns both the page of feeds and the total count.
 *   If the requested page exceeds totalPages the handler clamps and re-fetches,
 *   matching the same pattern used by the articles handler.
 *
 * Query params:
 * - page: 1-indexed page number
 * - disabled: when '1', filter to disabled (no_crawl = 1) feeds only; absent
 *   (or any value other than '1') shows all feeds
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getCrawlRunDetailByFeed, getFeedsPaginated, PAGE_SIZE } from '../db.js';
import { feedsPage, addFeedBanner } from '../views/pages/feeds.js';

export async function handleFeeds(c) {
	const rawPage = parseInt(c.req.query('page'), 10);
	let page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

	const disabled = c.req.query('disabled') === '1';
	const titleSearch = c.req.query('title') || '';
	const domainSearch = c.req.query('domain') || '';
	const addedFeedId = c.req.query('addedFeedId') || '';
	const crawlRunId = c.req.query('crawlRunId') || '';

	const dbOptions = { disabledOnly: disabled, titleSearch, domainSearch };

	let { feeds, total } = await getFeedsPaginated(c.env.DB, page, dbOptions);
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	if (total > 0 && page > totalPages) {
		page = totalPages;
		({ feeds } = await getFeedsPaginated(c.env.DB, page, dbOptions));
	}

	let bannerHtml;
	if (addedFeedId && crawlRunId) {
		const detail = await getCrawlRunDetailByFeed(c.env.DB, crawlRunId, addedFeedId);
		bannerHtml = addFeedBanner(detail);
	} else {
		bannerHtml = null;
	}

	return c.html(
		renderLayout({
			title: 'Feeds — Feed Reader',
			content: feedsPage({
				feeds,
				total,
				page,
				totalPages,
				disabled,
				titleSearch,
				domainSearch,
				bannerHtml,
			}),
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}
