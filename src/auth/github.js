const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_EMAILS_URL = 'https://api.github.com/user/emails';

// Returns the GitHub OAuth authorization URL string.
// Includes scope=user:email so the token grants permission to read the user's email addresses.
// clientId: GitHub OAuth App client ID
// state: CSRF state string
// callbackUrl: the redirect_uri registered with the GitHub OAuth App
export function getAuthorizationUrl(clientId, state, callbackUrl) {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callbackUrl,
		scope: 'user:email',
		state,
	});
	return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

// Exchanges an authorization code for an access token.
// Makes a POST to https://github.com/login/oauth/access_token
// Returns the access token string on success, or throws on failure.
export async function exchangeCodeForToken(clientId, clientSecret, code, callbackUrl) {
	const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: callbackUrl,
		}),
	});

	if (!response.ok) {
		throw new Error(`GitHub token exchange failed: ${response.status}`);
	}

	const data = await response.json();

	if (data.error) {
		throw new Error(`GitHub token exchange error: ${data.error_description || data.error}`);
	}

	if (!data.access_token) {
		throw new Error('GitHub token exchange returned no access token');
	}

	return data.access_token;
}

// Fetches all known email addresses for the authenticated user.
// Makes a GET to https://api.github.com/user/emails with the access token.
// Returns an array of verified email address strings.
export async function getUserEmails(accessToken) {
	const response = await fetch(GITHUB_USER_EMAILS_URL, {
		headers: {
			'Authorization': `Bearer ${accessToken}`,
			'User-Agent': 'feed-reader',
			'Accept': 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`GitHub user emails fetch failed: ${response.status}`);
	}

	const emails = await response.json();

	// Filter to only verified emails, return the email strings
	return emails
		.filter((entry) => entry.verified)
		.map((entry) => entry.email);
}
