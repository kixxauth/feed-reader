import { createState } from '../auth/state.js';
import { getAuthorizationUrl } from '../auth/github.js';

// Hono route handler for GET /auth/start.
// Creates a CSRF state token in KV, then redirects to the GitHub OAuth authorization URL.
// Accepts a `next` query parameter (default '/') that is preserved in the state token.
export async function handleAuthStart(c) {
	const nextUrl = c.req.query('next') || '/';

	const kv = c.env.SESSIONS;
	const clientId = c.env.GITHUB_CLIENT_ID;
	const callbackUrl = c.env.GITHUB_OAUTH_CALLBACK_URL;

	const state = await createState(kv, nextUrl);
	const githubAuthUrl = getAuthorizationUrl(clientId, state, callbackUrl);

	return c.redirect(githubAuthUrl, 302);
}
