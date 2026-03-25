import { renderLayout } from '../layout.js';
import { loginPage } from '../views/pages/login.js';

// Hono route handler for GET /login.
export async function handleLogin(c) {
	const nextUrl = c.req.query('next') || '/';

	const authStartUrl = `/auth/start?next=${encodeURIComponent(nextUrl)}`;

	return c.html(
		renderLayout({
			title: 'Feed Reader — Login',
			content: loginPage(authStartUrl),
			isAuthenticated: false,
		})
	);
}
