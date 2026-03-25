/**
 * POST /api/feeds/:feedId/toggle-featured — Toggle per-feed featured status.
 *
 * Reads the current featured flag for the feed and flips it:
 * - If currently not featured (featured=0), sets featured=1
 * - If currently featured (featured=1), sets featured=0
 *
 * Follows the POST-redirect-GET pattern: on success, redirects with a 303
 * (See Other) status so a browser back/refresh does not re-POST. The redirect
 * target is taken from the `returnTo` POST body field (must start with /feeds),
 * defaulting to /feeds if absent or invalid.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../../layout.js';
import { getFeedById, updateFeedFeatured } from '../../db.js';

export async function handleToggleFeatured(c) {
	const feedId = c.req.param('feedId');

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

	const newFeatured = feed.featured === 1 ? 0 : 1;
	await updateFeedFeatured(c.env.DB, feedId, newFeatured);

	const body = await c.req.parseBody();
	const rawReturnTo = body['returnTo'];
	const returnTo = (typeof rawReturnTo === 'string' && rawReturnTo.startsWith('/feeds'))
		? rawReturnTo
		: '/feeds';

	return c.redirect(returnTo, 303);
}
