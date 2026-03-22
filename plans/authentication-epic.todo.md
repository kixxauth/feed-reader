# TODO: Authentication Epic Implementation Plan

## Overview

Implement GitHub OAuth 2.0 authentication for the Feed Reader Cloudflare Worker using the Hono framework. Sessions are stored in Cloudflare KV. All pages require authentication except `/login`, `/auth/callback`, `/logout`, and `/logged-out`. An email allow list gates access.

## Background

- **Framework:** Hono v4 on Cloudflare Workers
- **Entry point:** `src/index.js`
- **Current state:** Single `GET /` route returning inline HTML. No auth, no middleware, no bindings.
- **Testing:** Vitest with `@cloudflare/vitest-pool-workers`. Tests are in `test/index.spec.js`. Config in `vitest.config.js` points to `wrangler.jsonc`.
- **Formatting:** Tabs, single quotes, semicolons (`prettierrc`)

---

## TODO Items

### 1. Create Cloudflare KV Namespace for Sessions

**File to modify:** `wrangler.jsonc`

Add a `kv_namespaces` array binding to `wrangler.jsonc` for storing sessions and OAuth state tokens. Use the binding name `SESSIONS`.

The binding should be added as a top-level key after the `routes` array and before the comment block. **Note:** a comma must be added after the closing `]` of the `routes` array (line 27 of `wrangler.jsonc`) to keep the JSONC valid. Example shape:

```jsonc
"kv_namespaces": [
    {
        "binding": "SESSIONS",
        "id": "REPLACE_WITH_REAL_KV_ID"
    }
]
```

**Important:** The `id` field must contain a real KV namespace ID from Cloudflare. Instruct the user to run the following command to create the namespace and insert the returned ID:

```bash
npx wrangler kv namespace create SESSIONS
```

For local development with `wrangler dev`, Wrangler creates a local KV automatically — no preview ID is needed.

For tests using `@cloudflare/vitest-pool-workers`, the KV namespace will be available automatically from the wrangler config once the binding is declared.

---

### 2. Add Environment Variables to wrangler.jsonc

**File to modify:** `wrangler.jsonc`

Add a `vars` object to `wrangler.jsonc` for non-sensitive runtime configuration. Add the following variables:

```jsonc
"vars": {
    "SESSION_TTL_SECONDS": "86400",
    "GITHUB_OAUTH_CALLBACK_URL": "https://reader.kixx.news/auth/callback"
}
```

- `SESSION_TTL_SECONDS`: Number of seconds before an idle session expires. Default `86400` (24 hours). The value is a string in wrangler vars — parse it with `parseInt()` in code.
- `GITHUB_OAUTH_CALLBACK_URL`: The full callback URL registered in the GitHub OAuth App settings. For local dev testing, this will need to match whatever URL is registered in the GitHub OAuth App.

---

### 3. Document Required Secrets

**File to create:** `plans/authentication-secrets.md`

Create a short document explaining the secrets the operator must configure manually via `wrangler secret put`. Do not put actual secret values anywhere in the codebase.

The following secrets must be configured:

- `GITHUB_CLIENT_ID` — The Client ID from the GitHub OAuth App.
- `GITHUB_CLIENT_SECRET` — The Client Secret from the GitHub OAuth App.
- `ALLOWED_EMAILS` — A comma-separated list of email addresses permitted to log in. Example: `alice@example.com,bob@example.com`. Whitespace around commas is ignored at runtime.

Commands to set secrets:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ALLOWED_EMAILS
```

---

### 4. Create Shared HTML Layout Module

**File to create:** `src/layout.js`

Extract the HTML shell from `src/index.js` into a reusable layout function. The layout must accept `{ title, content, isAuthenticated }` options and return an HTML string.

Requirements:
- Same `<head>` structure as the current `GET /` handler (charset, viewport, title, inlined CSS).
- When `isAuthenticated` is `true`, render a `<nav>` element in the `<body>` containing a logout link: `<a href="/logout">Logout</a>`.
- The `content` parameter is injected raw (unsanitized) into the `<body>` — it is always trusted server-generated HTML.
- Import and inline `./styles.css` the same way as the current route does.
- Export a single named function: `export function renderLayout({ title, content, isAuthenticated = false })`.

Example skeleton:

```js
import styles from './styles.css';

export function renderLayout({ title, content, isAuthenticated = false }) {
    const nav = isAuthenticated
        ? `<nav><a href="/logout">Logout</a></nav>`
        : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>${styles}</style>
</head>
<body>
    ${nav}
    ${content}
</body>
</html>`;
}
```

---

### 5. Create Session Management Module

**File to create:** `src/auth/session.js`

Implements all KV-backed session operations. Sessions are stored under the key `session:{sessionId}`. The session value is a JSON string: `{ "email": "user@example.com" }`.

The KV `put` call uses the `expirationTtl` option (in seconds) so Cloudflare handles expiry automatically — no manual `expiresAt` field is needed in the stored value.

**Cookie name:** `feed_reader_session`
**Cookie attributes:** `HttpOnly; Secure; SameSite=Lax; Path=/`

Export the following functions:

```js
// Creates a new session in KV and returns the session ID (a UUID string).
// kv: the SESSIONS KV namespace binding
// email: string - the authenticated user's email
// ttlSeconds: number - session lifetime in seconds
export async function createSession(kv, email, ttlSeconds)

// Reads and validates a session from KV. Returns the session object { email }
// or null if the session does not exist or has expired.
export async function getSession(kv, sessionId)

// Refreshes the TTL of an existing session by re-putting it with a new TTL.
// Returns true if successful, false if the session did not exist.
export async function refreshSession(kv, sessionId, ttlSeconds)

// Deletes a session from KV. Safe to call even if the session does not exist.
export async function deleteSession(kv, sessionId)

// Reads the session ID from the Cookie header of a Request object.
// Returns the session ID string or null if the cookie is not present.
export function getSessionIdFromRequest(request)

// Returns a Set-Cookie header value string that sets the session cookie.
// Must include Max-Age={ttlSeconds} in addition to the cookie attributes above.
export function makeSessionCookieHeader(sessionId, ttlSeconds)

// Returns a Set-Cookie header value string that clears the session cookie.
export function makeClearSessionCookieHeader()
```

Use `crypto.randomUUID()` (available globally in Workers) to generate session IDs.

For parsing the Cookie header, parse it manually — do not rely on any cookie parsing library. A simple implementation:

```js
export function getSessionIdFromRequest(request) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('feed_reader_session='));
    return match ? match.split('=')[1] : null;
}
```

---

### 6. Create CSRF State Token Module

**File to create:** `src/auth/state.js`

Implements CSRF state token management for the OAuth flow. State tokens are stored in KV under the key `oauth_state:{state}` with a short TTL (10 minutes). The value stored is a JSON string containing the `next` URL to redirect to after authentication.

Export the following functions:

```js
// Creates a CSRF state token, stores it in KV with a 10-minute TTL,
// and returns the state string (a UUID).
// nextUrl: the URL the user originally requested (to redirect back after login)
export async function createState(kv, nextUrl)

// Validates a state token by looking it up in KV.
// If valid, deletes it (one-time use) and returns the stored nextUrl string.
// If invalid or expired, returns null.
export async function consumeState(kv, state)
```

Use `crypto.randomUUID()` for state token generation.

---

### 7. Create GitHub OAuth Module

**File to create:** `src/auth/github.js`

Implements the GitHub OAuth 2.0 web application flow.

Reference: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#web-application-flow

Export the following functions:

```js
// Returns the GitHub OAuth authorization URL string.
// Must include the query parameter scope=user:email so the token grants
// permission to read the user's email addresses from the GitHub API.
// clientId: GitHub OAuth App client ID
// state: CSRF state string
// callbackUrl: the redirect_uri registered with the GitHub OAuth App
export function getAuthorizationUrl(clientId, state, callbackUrl)

// Exchanges an authorization code for an access token.
// Makes a POST to https://github.com/login/oauth/access_token
// Returns the access token string on success, or throws on failure.
export async function exchangeCodeForToken(clientId, clientSecret, code, callbackUrl)

// Fetches all known email addresses for the authenticated user.
// Makes a GET to https://api.github.com/user/emails with the access token.
// Returns an array of email address strings (only verified emails).
// GitHub API returns objects like: { email, primary, verified, visibility }
// Filter to only verified emails before returning.
export async function getUserEmails(accessToken)
```

Implementation notes:
- The access token exchange request must send `Accept: application/json` and expect a JSON response.
- The user emails request must send `Authorization: Bearer {accessToken}` and `User-Agent: feed-reader` headers (GitHub API requires a User-Agent header).
- Use the global `fetch()` available in Workers.

---

### 8. Create Auth Middleware

**File to create:** `src/auth/middleware.js`

Implements Hono middleware that protects all routes. The middleware must:

1. Skip authentication entirely for the following paths (exact match only, using `c.req.path`):
   - `/login`
   - `/auth/callback`
   - `/logout`
   - `/logged-out`

   Requests to `/login/foo` or `/auth/callback?foo` will not match and will require authentication.

2. For all other paths:
   a. Read the session ID from the request cookie using `getSessionIdFromRequest`.
   b. Validate the session using `getSession(kv, sessionId)`.
   c. If the session is valid:
      - Refresh the session TTL using `refreshSession(kv, sessionId, ttlSeconds)`.
      - Store the authenticated email on Hono context: `c.set('email', session.email)`.
      - Use `c.header('Set-Cookie', makeSessionCookieHeader(sessionId, ttlSeconds))` to set the refreshed cookie. Hono's `c.header()` applies headers to the downstream response automatically.
      - Call `await next()`.
   d. If the session is invalid or missing:
      - Redirect to `/login?next=<encoded-original-url>` with HTTP 302.
      - Build the `next` value from `c.req.path` plus `c.req.url`'s query string (if any), then URL-encode it.

The middleware function signature is `export async function authMiddleware(c, next)`.

Access `kv` and `ttlSeconds` from `c.env`:
- `c.env.SESSIONS` — KV namespace
- `parseInt(c.env.SESSION_TTL_SECONDS)` — TTL in seconds

Use Hono's `c.redirect()` for redirects and Hono's response headers API for setting cookies.

---

### 9. Create Login Route and Page

**File to create:** `src/routes/login.js`

Exports a Hono route handler function (not a full app) for `GET /login`.

The handler must:
1. Read the `next` query parameter from the URL (default to `/` if absent).
2. Create a CSRF state token using `createState(kv, nextUrl)` storing the `next` URL.
3. Build the GitHub OAuth authorization URL using `getAuthorizationUrl(clientId, state, callbackUrl)`.
4. Render an HTML login page using `renderLayout` with:
   - `title`: `'Feed Reader — Login'`
   - `isAuthenticated`: `false`
   - `content`: An HTML block with a heading and a prominent link/button pointing to the GitHub OAuth URL. Example:
     ```html
     <main>
       <h1>Login</h1>
       <p><a href="{githubAuthUrl}">Login with GitHub</a></p>
     </main>
     ```
5. Return the rendered HTML with `c.html(...)`.

Access environment from `c.env`:
- `c.env.SESSIONS` — KV namespace (for state token storage)
- `c.env.GITHUB_CLIENT_ID`
- `c.env.GITHUB_OAUTH_CALLBACK_URL`

Export a single named function: `export async function handleLogin(c)`.

---

### 10. Create OAuth Callback Route

**File to create:** `src/routes/callback.js`

Exports a Hono route handler function for `GET /auth/callback`.

The handler must:
1. Read `code` and `state` query parameters from the request URL.
2. If either is missing, return a 400 response with a plain error message: `'Bad Request'`.
3. Validate the state token using `consumeState(kv, state)`:
   - If `null` is returned (invalid/expired state), return a 403 response: `'Forbidden'`.
   - If valid, `consumeState` returns the `nextUrl` to redirect to after login.
4. Exchange the code for an access token using `exchangeCodeForToken`.
   - If the exchange fails, return a 500 response: `'Authentication failed'`.
5. Fetch user emails using `getUserEmails(accessToken)`.
   - If the fetch fails, return a 500 response: `'Authentication failed'`.
   - Note: `getUserEmails` returns only verified emails from the GitHub API.
6. Parse the allow list from `c.env.ALLOWED_EMAILS`: split by comma, trim whitespace, lowercase all.
7. Check if any of the user's emails (lowercased) appear in the allow list. Use the first matching email for the session.
   - If no match: render an "Access Denied" page using `renderLayout` with:
     - `title`: `'Feed Reader — Access Denied'`
     - `isAuthenticated`: `false`
     - `content`:
       ```html
       <main>
         <h1>Access Denied</h1>
         <p>You do not have permission to access this site.</p>
       </main>
       ```
     - Return HTTP 403.
   - If matched: continue to step 8.
8. Create a session using `createSession(kv, matchedEmail, ttlSeconds)`.
9. Build the redirect response to `nextUrl` with validation:
   - Validate `nextUrl` is a relative path: starts with `/` but not `//` to prevent open redirects.
   - Reject URLs containing control characters (newlines, carriage returns) to prevent header injection.
   - Default to `/` if validation fails.
10. Set the session cookie on the redirect response using `makeSessionCookieHeader`.
11. Return the redirect response with HTTP 302.

Access environment from `c.env`:
- `c.env.SESSIONS`
- `c.env.GITHUB_CLIENT_ID`
- `c.env.GITHUB_CLIENT_SECRET`
- `c.env.GITHUB_OAUTH_CALLBACK_URL`
- `c.env.ALLOWED_EMAILS`
- `parseInt(c.env.SESSION_TTL_SECONDS)`

Export a single named function: `export async function handleCallback(c)`.

---

### 11. Create Logout Route

**File to create:** `src/routes/logout.js`

Exports a Hono route handler function for `GET /logout`.

The handler must:
1. Read the session ID from the request cookie using `getSessionIdFromRequest`.
2. If a session ID exists, call `deleteSession(kv, sessionId)` to remove it from KV.
3. Build a redirect response to `/logged-out`.
4. Set the clear-session cookie header using `makeClearSessionCookieHeader()`.
5. Return the redirect response with HTTP 302.

Access environment from `c.env`:
- `c.env.SESSIONS`

Export a single named function: `export async function handleLogout(c)`.

---

### 12. Create Logged-Out Page Route

**File to create:** `src/routes/logged-out.js`

Exports a Hono route handler function for `GET /logged-out`.

The handler must render an HTML page using `renderLayout` with:
- `title`: `'Feed Reader — Logged Out'`
- `isAuthenticated`: `false`
- `content`:
  ```html
  <main>
    <h1>You have been logged out.</h1>
    <p><a href="/login">Log back in</a> or <a href="/">go to the home page</a>.</p>
  </main>
  ```

Return the rendered HTML with `c.html(...)`.

Export a single named function: `export async function handleLoggedOut(c)`.

---

### 13. Update src/index.js to Wire Everything Together

**File to modify:** `src/index.js`

Refactor `src/index.js` to:

1. Import `renderLayout` from `./layout.js`.
2. Import `authMiddleware` from `./auth/middleware.js`.
3. Import route handlers from `./routes/login.js`, `./routes/callback.js`, `./routes/logout.js`, `./routes/logged-out.js`.
4. Register the auth middleware globally: `app.use('*', authMiddleware)`. The middleware itself skips public paths (`/login`, `/auth/callback`, `/logout`, `/logged-out`) — route registration order does not affect which routes are protected.
5. Register routes:
   - `app.get('/login', handleLogin)`
   - `app.get('/auth/callback', handleCallback)`
   - `app.get('/logout', handleLogout)`
   - `app.get('/logged-out', handleLoggedOut)`
6. Update the existing `GET /` route to use `renderLayout`:
   - Pass `isAuthenticated: true` (the middleware guarantees this).
   - Pass `c.get('email')` into the content or title if desired.
   - Keep the `<h1>Hello World!</h1>` content for now.

The resulting `src/index.js` should import and compose modules; it should not contain inline HTML.

---

### 14. Update Tests

**File to modify:** `test/index.spec.js`

Update the existing tests and add new ones to cover the authentication flow. The test environment uses `@cloudflare/vitest-pool-workers` which provides the Worker environment including KV bindings declared in `wrangler.jsonc`.

For tests that require `SESSIONS` KV binding, mock env values, and secrets, use the Miniflare-style `env` bindings available in `SELF.fetch` or direct `worker.fetch(request, env, ctx)` calls.

Required test coverage:

**Unauthenticated access (existing tests):**
- Update both existing tests: `GET /` without a session cookie must now return HTTP 302 redirect to `/login?next=%2F` (not 200).

**Login page:**
- `GET /login` returns HTTP 200 and contains `'Login with GitHub'` text.
- `GET /login?next=%2Fsome-page` returns HTTP 200 (state is stored using the KV binding).

**Authenticated access:**
- `GET /` with a valid session cookie returns HTTP 200 and contains `'Hello World!'` and `'Logout'`.

**Logout:**
- `GET /logout` with a valid session cookie returns HTTP 302 to `/logged-out` and sets a clear-cookie header.

**Logged-out page:**
- `GET /logged-out` returns HTTP 200 and contains `'logged out'` (case-insensitive).

**Providing secrets to the test environment:** The `@cloudflare/vitest-pool-workers` test runner reads bindings from `wrangler.jsonc`. Secrets set via `wrangler secret put` are not available in tests. To make `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `ALLOWED_EMAILS` available, add them to the `vars` block in `wrangler.jsonc` with placeholder test values:

```jsonc
"vars": {
    "SESSION_TTL_SECONDS": "86400",
    "GITHUB_OAUTH_CALLBACK_URL": "https://reader.kixx.news/auth/callback",
    "GITHUB_CLIENT_ID": "test-client-id",
    "GITHUB_CLIENT_SECRET": "test-client-secret",
    "ALLOWED_EMAILS": "allowed@example.com"
}
```

In production, the real secrets set via `wrangler secret put` will override these placeholder values. The `SESSIONS` KV binding is available automatically once declared in `wrangler.jsonc`.

For tests that need a pre-existing session (authenticated access, logout), import the `env` object from the vitest-pool-workers test context (this provides the Worker environment with KV bindings from `wrangler.jsonc`). Use it to call `createSession(env.SESSIONS, 'allowed@example.com', 86400)` in test setup, then attach the resulting session ID as a `Cookie` header on the test request.

Example test setup:
```js
import { env } from 'cloudflare:test';
// or equivalent import pattern for vitest-pool-workers

// In test setup:
const sessionId = await createSession(env.SESSIONS, 'allowed@example.com', 86400);
const request = new Request('http://localhost:8787/', {
  headers: { Cookie: `feed_reader_session=${sessionId}` }
});
```

---

### 15. Validate Implementation

After all items above are complete:

1. Run `npm test` — all tests must pass.
2. Run `npm start` and verify:
   - `GET http://localhost:8787/` redirects to `/login`.
   - `GET http://localhost:8787/login` renders the login page with a GitHub link.
   - `GET http://localhost:8787/logged-out` renders the logged-out page.
   - The `/logout` route clears the cookie and redirects.
3. Kill the dev server after validation.
