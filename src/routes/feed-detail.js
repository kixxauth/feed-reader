/**
 * GET /feeds/:feedId — Feed detail page.
 *
 * Displays feed metadata, recent crawl activity, and admin actions for a
 * single feed. Admin actions include toggling crawl status and toggling
 * featured status. Preserves list pagination context (listPage, disabled)
 * in the "Back to Feeds" link and the returnTo values for both toggle forms
 * so the user is returned to the correct list position after toggling.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getFeedById, getRecentActivityForFeed } from '../db.js';
import { notFoundPage } from '../views/partials.js';
import { feedDetailPage } from '../views/pages/feed-detail.js';

export async function handleFeedDetail(c) {
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

	// Load recent crawl activity (last 5 runs)
	const recentActivity = await getRecentActivityForFeed(c.env.DB, feedId, 5);

	// Parse optional query params that carry list context
	const rawListPage = parseInt(c.req.query('listPage'), 10);
	const listPage = isNaN(rawListPage) || rawListPage < 1 ? 1 : rawListPage;
	const disabled = c.req.query('disabled') === '1';

	// Build "Back to Feeds" href — preserves list pagination context
	let listHref = '/feeds';
	const listParts = [];
	if (listPage > 1) listParts.push(`page=${listPage}`);
	if (disabled) listParts.push('disabled=1');
	if (listParts.length > 0) listHref += `?${listParts.join('&')}`;

	// Build selfHref — current detail page URL used as returnTo for the toggle form
	let selfHref = `/feeds/${feedId}`;
	const selfParts = [];
	if (listPage > 1) selfParts.push(`listPage=${listPage}`);
	if (disabled) selfParts.push('disabled=1');
	if (selfParts.length > 0) selfHref += `?${selfParts.join('&')}`;

	// Build context params for "View Articles" link (same query string as selfHref)
	const contextParams = selfParts.length > 0 ? `?${selfParts.join('&')}` : '';

	return c.html(
		renderLayout({
			title: `${feed.title} — Feed Reader`,
			content: feedDetailPage({
				feed,
				recentActivity,
				feedId,
				listHref,
				selfHref,
				contextParams,
			}),
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}
