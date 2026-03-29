/**
 * POST /api/dispatch-crawl — Manually trigger a crawl dispatch.
 *
 * Calls dispatchCrawl() to enqueue crawl jobs for all enabled feeds,
 * then renders the dispatch-crawl page with the result summary.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../../layout.js';
import { dispatchCrawlPage } from '../../views/pages/dispatch-crawl.js';
import { dispatchCrawl } from '../../crawl.js';

export async function handleDispatchCrawl(c) {
	const result = await dispatchCrawl(c.env.DB, c.env.CRAWL_QUEUE);

	return c.html(
		renderLayout({
			title: 'Dispatch Crawl — Feed Reader',
			content: dispatchCrawlPage({ result }),
			isAuthenticated: true,
			currentPath: '/dispatch-crawl',
		})
	);
}
