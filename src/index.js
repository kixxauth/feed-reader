import { Hono } from 'hono';
import { renderLayout } from './layout.js';
import { homePage } from './views/pages/home.js';
import { authMiddleware } from './auth/middleware.js';
import { handleLogin } from './routes/login.js';
import { handleAuthStart } from './routes/auth-start.js';
import { handleCallback } from './routes/callback.js';
import { handleLogout } from './routes/logout.js';
import { handleLoggedOut } from './routes/logged-out.js';
import { handleAddFeedPage } from './routes/add-feed.js';
import { handleFeeds } from './routes/feeds.js';
import { handleArticles } from './routes/articles.js';
import { handleFeedDetail } from './routes/feed-detail.js';
import { handleAddFeed } from './routes/api/add-feed.js';
import { handleToggleFeedCrawl } from './routes/api/toggle-feed-crawl.js';
import { handleToggleFeatured } from './routes/api/toggle-featured.js';
import { handleCrawlHistory, handleCrawlHistoryDetail } from './routes/crawl-history.js';
import { handleReader } from './routes/reader.js';
import { dispatchCrawl, processCrawlJob } from './crawl.js';

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
app.get('/feeds/add', handleAddFeedPage);
app.get('/feeds/:feedId/articles', handleArticles);
app.get('/feeds/:feedId', handleFeedDetail);
app.post('/api/feeds/add', handleAddFeed);
app.post('/api/feeds/:feedId/toggle-crawl', handleToggleFeedCrawl);
app.post('/api/feeds/:feedId/toggle-featured', handleToggleFeatured);
app.get('/crawl-history', handleCrawlHistory);
app.get('/crawl-history/:crawlRunId', handleCrawlHistoryDetail);
app.get('/reader', handleReader);

app.get('/', (c) => {
	return c.html(
		renderLayout({
			title: 'Feed Reader',
			content: homePage(),
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
});

export default {
	fetch: app.fetch,
	async scheduled(controller, env, ctx) {
		ctx.waitUntil(
			dispatchCrawl(env.DB, env.CRAWL_QUEUE)
				.then((summary) =>
					console.log(
						`Crawl dispatched: ${summary.batchCount} batch(es) for ${summary.totalFeeds} feeds (crawlRunId=${summary.crawlRunId})`
					)
				)
				.catch((err) => console.error('Crawl dispatch failed:', err))
		);
	},
	async queue(batch, env) {
		for (const message of batch.messages) {
			const { crawlRunId, feedId } = message.body;
			try {
				const result = await processCrawlJob(env.DB, message.body);
				console.log('Crawl job processed:', JSON.stringify(result));
				message.ack();
			} catch (err) {
				console.error(`Crawl job failed (crawlRunId=${crawlRunId}, feedId=${feedId}):`, err);
				throw err;
			}
		}
	},
};
