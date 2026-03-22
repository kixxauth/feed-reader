import { renderLayout } from '../layout.js';
import { createState } from '../auth/state.js';
import { getAuthorizationUrl } from '../auth/github.js';

// Hono route handler for GET /login.
export async function handleLogin(c) {
	const nextUrl = c.req.query('next') || '/';

	const kv = c.env.SESSIONS;
	const clientId = c.env.GITHUB_CLIENT_ID;
	const callbackUrl = c.env.GITHUB_OAUTH_CALLBACK_URL;

	const state = await createState(kv, nextUrl);
	const githubAuthUrl = getAuthorizationUrl(clientId, state, callbackUrl);

	const content = `<main>
  <h1>Login</h1>
  <p><a href="${githubAuthUrl}">Login with GitHub</a></p>
</main>`;

	return c.html(
		renderLayout({
			title: 'Feed Reader — Login',
			content,
			isAuthenticated: false,
		})
	);
}
