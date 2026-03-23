import {
	getSessionIdFromRequest,
	getSession,
	refreshSession,
	makeSessionCookieHeader,
} from './session.js';

// Paths that do not require authentication (exact match only).
const PUBLIC_PATHS = new Set(['/login', '/auth/start', '/auth/callback', '/logout', '/logged-out']);

// Hono middleware that protects all routes except the public paths above.
//
// Session refresh throttle: after validating a session, the middleware only
// calls refreshSession (KV write) and re-sets the cookie when more than half
// the TTL has elapsed since the session was created or last refreshed. This
// cuts KV writes from once-per-request to roughly once per half-TTL period.
// Sessions without a createdAt field (created before this field was added)
// always refresh because `createdAt || 0` makes elapsed very large.
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
		// Valid session: store email on context, continue.
		// Only refresh the session (KV write + Set-Cookie) when more than half the TTL has elapsed.
		const elapsed = Date.now() - (session.createdAt || 0);
		const threshold = (ttlSeconds * 1000) / 2;
		if (elapsed >= threshold) {
			await refreshSession(kv, sessionId, ttlSeconds);
			c.header('Set-Cookie', makeSessionCookieHeader(sessionId, ttlSeconds));
		}
		c.set('email', session.email);
		return await next();
	}

	// No valid session: redirect to login with the original URL as `next`.
	const url = new URL(c.req.url);
	const nextPath = c.req.path + (url.search ? url.search : '');
	const loginUrl = `/login?next=${encodeURIComponent(nextPath)}`;
	return c.redirect(loginUrl, 302);
}
