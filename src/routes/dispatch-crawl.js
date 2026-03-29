/**
 * GET /dispatch-crawl — Page with a button to manually trigger a crawl dispatch.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { dispatchCrawlPage } from '../views/pages/dispatch-crawl.js';

export async function handleDispatchCrawlPage(c) {
	return c.html(
		renderLayout({
			title: 'Dispatch Crawl — Feed Reader',
			content: dispatchCrawlPage({ result: null }),
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}
