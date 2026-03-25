import { renderLayout } from '../layout.js';
import { loggedOutPage } from '../views/pages/logged-out.js';

// Hono route handler for GET /logged-out.
export async function handleLoggedOut(c) {
	return c.html(
		renderLayout({
			title: 'Feed Reader — Logged Out',
			content: loggedOutPage(),
			isAuthenticated: false,
		})
	);
}
