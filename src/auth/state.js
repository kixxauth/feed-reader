const STATE_TTL_SECONDS = 600; // 10 minutes

// Creates a CSRF state token, stores it in KV with a 10-minute TTL,
// and returns the state string (a UUID).
// nextUrl: the URL the user originally requested (to redirect back after login)
export async function createState(kv, nextUrl) {
	const state = crypto.randomUUID();
	const value = JSON.stringify({ nextUrl });
	await kv.put(`oauth_state:${state}`, value, { expirationTtl: STATE_TTL_SECONDS });
	return state;
}

// Validates a state token by looking it up in KV.
// If valid, deletes it (one-time use) and returns the stored nextUrl string.
// If invalid or expired, returns null.
export async function consumeState(kv, state) {
	if (!state) {
		return null;
	}
	const value = await kv.get(`oauth_state:${state}`);
	if (!value) {
		return null;
	}
	await kv.delete(`oauth_state:${state}`);
	try {
		const parsed = JSON.parse(value);
		return parsed.nextUrl || null;
	} catch {
		return null;
	}
}
