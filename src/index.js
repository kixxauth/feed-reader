import { Hono } from 'hono';
import { renderLayout } from './layout.js';
import { authMiddleware } from './auth/middleware.js';
import { handleLogin } from './routes/login.js';
import { handleCallback } from './routes/callback.js';
import { handleLogout } from './routes/logout.js';
import { handleLoggedOut } from './routes/logged-out.js';
import { handleFeeds } from './routes/feeds.js';

const app = new Hono();

// Apply auth middleware globally. The middleware skips public paths internally.
app.use('*', authMiddleware);

// Public auth routes
app.get('/login', handleLogin);
app.get('/auth/callback', handleCallback);
app.get('/logout', handleLogout);
app.get('/logged-out', handleLoggedOut);

// Protected routes
app.get('/feeds', handleFeeds);

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

export default app;
