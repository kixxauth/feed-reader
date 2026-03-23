const COOKIE_NAME = 'feed_reader_session';
const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';

// Creates a new session in KV and returns the session ID (a UUID string).
// kv: the SESSIONS KV namespace binding
// email: string - the authenticated user's email
// ttlSeconds: number - session lifetime in seconds
export async function createSession(kv, email, ttlSeconds) {
	const sessionId = crypto.randomUUID();
	const value = JSON.stringify({ email, createdAt: Date.now() });
	await kv.put(`session:${sessionId}`, value, { expirationTtl: ttlSeconds });
	return sessionId;
}

// Reads and validates a session from KV. Returns the session object { email, createdAt }
// or null if the session does not exist or has expired.
export async function getSession(kv, sessionId) {
	if (!sessionId) {
		return null;
	}
	const value = await kv.get(`session:${sessionId}`);
	if (!value) {
		return null;
	}
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

// Refreshes an existing session: re-puts it with a new TTL and resets createdAt to now.
// Returns true if successful, false if the session did not exist or could not be parsed.
export async function refreshSession(kv, sessionId, ttlSeconds) {
	const value = await kv.get(`session:${sessionId}`);
	if (!value) {
		return false;
	}
	let email;
	try {
		({ email } = JSON.parse(value));
	} catch {
		return false;
	}
	await kv.put(`session:${sessionId}`, JSON.stringify({ email, createdAt: Date.now() }), { expirationTtl: ttlSeconds });
	return true;
}

// Deletes a session from KV. Safe to call even if the session does not exist.
export async function deleteSession(kv, sessionId) {
	await kv.delete(`session:${sessionId}`);
}

// Reads the session ID from the Cookie header of a Request object.
// Returns the session ID string or null if the cookie is not present.
export function getSessionIdFromRequest(request) {
	const cookie = request.headers.get('Cookie') || '';
	const match = cookie
		.split(';')
		.map((s) => s.trim())
		.find((s) => s.startsWith(`${COOKIE_NAME}=`));
	return match ? match.split('=')[1] : null;
}

// Returns a Set-Cookie header value string that sets the session cookie.
// Includes Max-Age={ttlSeconds} in addition to the standard cookie attributes.
export function makeSessionCookieHeader(sessionId, ttlSeconds) {
	return `${COOKIE_NAME}=${sessionId}; Max-Age=${ttlSeconds}; ${COOKIE_ATTRIBUTES}`;
}

// Returns a Set-Cookie header value string that clears the session cookie.
export function makeClearSessionCookieHeader() {
	return `${COOKIE_NAME}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`;
}
