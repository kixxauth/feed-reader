import { renderLayout } from '../layout.js';
import { consumeState } from '../auth/state.js';
import { exchangeCodeForToken, getUserEmails } from '../auth/github.js';
import { createSession, makeSessionCookieHeader } from '../auth/session.js';

// Validates that a redirect URL is safe to use (relative path, no open redirect).
function validateNextUrl(url) {
	if (!url) {
		return '/';
	}
	// Must be a relative path starting with / but not //
	if (!url.startsWith('/') || url.startsWith('//')) {
		return '/';
	}
	// Reject URLs containing control characters (newlines, carriage returns)
	if (/[\r\n]/.test(url)) {
		return '/';
	}
	return url;
}

// Hono route handler for GET /auth/callback.
export async function handleCallback(c) {
	const code = c.req.query('code');
	const state = c.req.query('state');

	if (!code || !state) {
		return c.text('Bad Request', 400);
	}

	const kv = c.env.SESSIONS;
	const clientId = c.env.GITHUB_CLIENT_ID;
	const clientSecret = c.env.GITHUB_CLIENT_SECRET;
	const callbackUrl = c.env.GITHUB_OAUTH_CALLBACK_URL;
	const ttlSeconds = parseInt(c.env.SESSION_TTL_SECONDS);

	// Validate the CSRF state token (one-time use).
	const nextUrl = await consumeState(kv, state);
	if (!nextUrl) {
		return c.text('Forbidden', 403);
	}

	// Exchange the authorization code for an access token.
	let accessToken;
	try {
		accessToken = await exchangeCodeForToken(clientId, clientSecret, code, callbackUrl);
	} catch {
		return c.text('Authentication failed', 500);
	}

	// Fetch the user's verified email addresses from GitHub.
	let userEmails;
	try {
		userEmails = await getUserEmails(accessToken);
	} catch {
		return c.text('Authentication failed', 500);
	}

	// Parse the allow list from env: split by comma, trim, lowercase.
	const allowList = c.env.ALLOWED_EMAILS
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);

	// Check if any user email matches the allow list.
	const matchedEmail = userEmails
		.map((e) => e.toLowerCase())
		.find((e) => allowList.includes(e));

	if (!matchedEmail) {
		const content = `<main>
  <h1>Access Denied</h1>
  <p>You do not have permission to access this site.</p>
</main>`;
		return c.html(
			renderLayout({
				title: 'Feed Reader — Access Denied',
				content,
				isAuthenticated: false,
			}),
			403
		);
	}

	// Create a session for the matched email.
	const sessionId = await createSession(kv, matchedEmail, ttlSeconds);

	// Validate and sanitize the redirect target.
	const safeNextUrl = validateNextUrl(nextUrl);

	// Build the redirect response with the session cookie.
	const response = c.redirect(safeNextUrl, 302);
	response.headers.set('Set-Cookie', makeSessionCookieHeader(sessionId, ttlSeconds));
	return response;
}
