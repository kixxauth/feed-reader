import { renderLayout } from '../layout.js';

// Hono route handler for GET /logged-out.
export async function handleLoggedOut(c) {
	const content = `<main>
  <h1>You have been logged out.</h1>
  <p><a href="/login">Log back in</a> or <a href="/">go to the home page</a>.</p>
</main>`;

	return c.html(
		renderLayout({
			title: 'Feed Reader — Logged Out',
			content,
			isAuthenticated: false,
		})
	);
}
