import { renderLayout } from '../layout.js';

// Hono route handler for GET /login.
export async function handleLogin(c) {
	const nextUrl = c.req.query('next') || '/';

	const authStartUrl = `/auth/start?next=${encodeURIComponent(nextUrl)}`;

	const content = `<main>
  <h1>Login</h1>
  <p><a href="${authStartUrl}">Login with GitHub</a></p>
</main>`;

	return c.html(
		renderLayout({
			title: 'Feed Reader — Login',
			content,
			isAuthenticated: false,
		})
	);
}
