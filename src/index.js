import { Hono } from 'hono';
import { renderLayout } from './layout.js';
import { authMiddleware } from './auth/middleware.js';
import { handleLogin } from './routes/login.js';
import { handleAuthStart } from './routes/auth-start.js';
import { handleCallback } from './routes/callback.js';
import { handleLogout } from './routes/logout.js';
import { handleLoggedOut } from './routes/logged-out.js';
import { handleFeeds } from './routes/feeds.js';
import { handleArticles } from './routes/articles.js';
import { handleToggleFeedCrawl } from './routes/api/toggle-feed-crawl.js';
import { handleCrawlHistory, handleCrawlHistoryDetail } from './routes/crawl-history.js';
import { performCrawl } from './crawl.js';

const app = new Hono();

// Apply auth middleware globally. The middleware skips public paths internally.
app.use('*', authMiddleware);

// Public auth routes
app.get('/login', handleLogin);
app.get('/auth/start', handleAuthStart);
app.get('/auth/callback', handleCallback);
app.get('/logout', handleLogout);
app.get('/logged-out', handleLoggedOut);

// Protected routes
app.get('/feeds', handleFeeds);
app.get('/feeds/:feedId/articles', handleArticles);
app.post('/api/feeds/:feedId/toggle-crawl', handleToggleFeedCrawl);
app.get('/crawl-history', handleCrawlHistory);
app.get('/crawl-history/:crawlRunId', handleCrawlHistoryDetail);

app.get('/', (c) => {
	const content = `<main>
  <h1>Feed Reader</h1>
  <a href="/feeds">Feeds</a>
</main>`;

	return c.html(
		renderLayout({
			title: 'Feed Reader',
			content,
			isAuthenticated: true,
		})
	);
});

export default {
	fetch: app.fetch,
	async scheduled(controller, env, ctx) {
		ctx.waitUntil(
			performCrawl(env.DB)
				.then((summary) => console.log('Crawl completed:', JSON.stringify(summary)))
				.catch((err) => console.error('Crawl failed:', err))
		);
	},
};
