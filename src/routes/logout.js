import { getSessionIdFromRequest, deleteSession, makeClearSessionCookieHeader } from '../auth/session.js';

// Hono route handler for GET /logout.
export async function handleLogout(c) {
	const kv = c.env.SESSIONS;

	const sessionId = getSessionIdFromRequest(c.req.raw);
	if (sessionId) {
		await deleteSession(kv, sessionId);
	}

	const response = c.redirect('/logged-out', 302);
	response.headers.set('Set-Cookie', makeClearSessionCookieHeader());
	return response;
}
