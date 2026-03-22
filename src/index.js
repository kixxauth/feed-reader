import { Hono } from 'hono';
import { renderLayout } from './layout.js';
import { authMiddleware } from './auth/middleware.js';
import { handleLogin } from './routes/login.js';
import { handleCallback } from './routes/callback.js';
import { handleLogout } from './routes/logout.js';
import { handleLoggedOut } from './routes/logged-out.js';
import { getAllFeedsSortedByHostname } from './db.js';

const app = new Hono();

// Apply auth middleware globally. The middleware skips public paths internally.
app.use('*', authMiddleware);

// Public auth routes
app.get('/login', handleLogin);
app.get('/auth/callback', handleCallback);
app.get('/logout', handleLogout);
app.get('/logged-out', handleLoggedOut);

/**
 * Escape special HTML characters to prevent XSS when interpolating
 * untrusted feed data (titles, hostnames, URLs) into HTML templates.
 *
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// Protected routes
app.get('/', async (c) => {
	const feeds = await getAllFeedsSortedByHostname(c.env.DB);

	let feedsHtml;
	if (feeds.length === 0) {
		feedsHtml = '<p class="empty-state">No feeds imported yet</p>';
	} else {
		const items = feeds
			.map((feed) => {
				const title = escapeHtml(feed.title);
				const hostname = escapeHtml(feed.hostname);
				const htmlUrl = escapeHtml(feed.html_url);
				return `<li class="feed-item">
    <a href="${htmlUrl}" rel="noopener noreferrer">${title}</a>
    <span class="feed-hostname">${hostname}</span>
  </li>`;
			})
			.join('\n');
		feedsHtml = `<ul class="feed-list">\n${items}\n</ul>`;
	}

	const content = `<main>
  <h1>Feed Reader</h1>
  ${feedsHtml}
</main>`;

	return c.html(
		renderLayout({
			title: 'Feed Reader',
			content,
			isAuthenticated: true,
		})
	);
});

export default app;
