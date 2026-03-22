import {
	getSessionIdFromRequest,
	getSession,
	refreshSession,
	makeSessionCookieHeader,
} from './session.js';

// Paths that do not require authentication (exact match only).
const PUBLIC_PATHS = new Set(['/login', '/auth/callback', '/logout', '/logged-out']);

// Hono middleware that protects all routes except the public paths above.
export async function authMiddleware(c, next) {
	// Skip auth for public paths (exact match).
	if (PUBLIC_PATHS.has(c.req.path)) {
		return await next();
	}

	const kv = c.env.SESSIONS;
	const ttlSeconds = parseInt(c.env.SESSION_TTL_SECONDS);

	const sessionId = getSessionIdFromRequest(c.req.raw);
	const session = await getSession(kv, sessionId);

	if (session) {
		// Valid session: refresh TTL, store email on context, continue.
		await refreshSession(kv, sessionId, ttlSeconds);
		c.set('email', session.email);
		c.header('Set-Cookie', makeSessionCookieHeader(sessionId, ttlSeconds));
		return await next();
	}

	// No valid session: redirect to login with the original URL as `next`.
	const url = new URL(c.req.url);
	const nextPath = c.req.path + (url.search ? url.search : '');
	const loginUrl = `/login?next=${encodeURIComponent(nextPath)}`;
	return c.redirect(loginUrl, 302);
}
