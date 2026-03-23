/**
 * POST /api/feeds/:feedId/toggle-crawl — Toggle per-feed crawl status.
 *
 * Reads the current no_crawl flag for the feed and flips it:
 * - If currently enabled (no_crawl=0), sets no_crawl=1 (disables crawling)
 * - If currently disabled (no_crawl=1), sets no_crawl=0 (enables crawling)
 *   and also resets consecutive_failure_count to 0 so the feed gets a fresh
 *   start rather than immediately tripping the auto-disable threshold again.
 *
 * Follows the POST-redirect-GET pattern: on success, redirects to /feeds
 * with a 303 (See Other) status so a browser back/refresh does not re-POST.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../../layout.js';
import { getFeedById, updateFeedCrawlStatus, resetFeedFailureCount } from '../../db.js';

export async function handleToggleFeedCrawl(c) {
	const feedId = c.req.param('feedId');

	// Look up the feed — return 404 if it doesn't exist
	const feed = await getFeedById(c.env.DB, feedId);
	if (feed === null) {
		return c.html(
			renderLayout({
				title: 'Not Found — Feed Reader',
				content: '<main><h1>Not Found</h1><p>Feed not found.</p></main>',
				isAuthenticated: true,
			}),
			404
		);
	}

	// Toggle the no_crawl flag
	const currentNoCrawl = feed.no_crawl;
	const newNoCrawl = currentNoCrawl === 0 ? 1 : 0;

	await updateFeedCrawlStatus(c.env.DB, feedId, newNoCrawl);

	// When enabling crawling, reset the failure count so the feed gets a fresh start
	if (newNoCrawl === 0) {
		await resetFeedFailureCount(c.env.DB, feedId);
	}

	// POST-redirect-GET: redirect to /feeds so back/refresh doesn't re-POST
	return c.redirect('/feeds', 303);
}
