/**
 * Crawl history pages.
 *
 * GET /crawl-history        — List of recent crawl runs (newest-first).
 * GET /crawl-history/:id    — Per-feed detail for a single crawl run.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getCrawlRuns, getCrawlRunById, getCrawlRunDetails } from '../db.js';
import { notFoundPage } from '../views/partials.js';
import { crawlHistoryPage, crawlRunDetailPage } from '../views/pages/crawl-history.js';

/**
 * GET /crawl-history — Paginated list of the most recent 30 crawl runs.
 */
export async function handleCrawlHistory(c) {
	const runs = await getCrawlRuns(c.env.DB, 30);

	return c.html(
		renderLayout({
			title: 'Crawl History — Feed Reader',
			content: crawlHistoryPage({ runs }),
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}

/**
 * GET /crawl-history/:crawlRunId — Per-feed detail view for a single crawl run.
 */
export async function handleCrawlHistoryDetail(c) {
	const crawlRunId = c.req.param('crawlRunId');

	const run = await getCrawlRunById(c.env.DB, crawlRunId);
	if (run === null) {
		return c.html(
			renderLayout({
				title: 'Not Found — Feed Reader',
				content: notFoundPage('Crawl run not found.'),
				isAuthenticated: true,
				currentPath: c.req.path,
			}),
			404
		);
	}

	const failedOnly = c.req.query('failed') === '1';

	const allDetails = await getCrawlRunDetails(c.env.DB, crawlRunId);
	const details = failedOnly
		? allDetails.filter((d) => d.status === 'failed' || d.status === 'auto_disabled')
		: allDetails;

	return c.html(
		renderLayout({
			title: 'Crawl Run Details — Feed Reader',
			content: crawlRunDetailPage({ run, details, failedOnly, crawlRunId }),
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}
