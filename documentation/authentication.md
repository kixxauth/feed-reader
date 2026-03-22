# Authentication

Feed Reader uses GitHub OAuth 2.0 to authenticate users. Access is restricted to a pre-approved list of email addresses. Sessions are stored in Cloudflare KV and expire automatically after a configurable idle period.

## How It Works

### Login Flow

1. A visitor requests any protected page (e.g. `/`).
2. The auth middleware detects no valid session and redirects to `/login?next=%2F`, preserving the original destination.
3. The login page generates a one-time CSRF state token (stored in KV, valid for 10 minutes) and renders a "Login with GitHub" link pointing to the GitHub OAuth authorization URL.
4. The visitor clicks the link and is sent to GitHub to authorize the application.
5. GitHub redirects back to `/auth/callback?code=...&state=...`.
6. The callback handler:
   - Validates the state token (CSRF protection) — invalid or expired tokens are rejected with 403.
   - Exchanges the authorization code for a GitHub access token.
   - Fetches the visitor's verified email addresses from the GitHub API.
   - Checks each email against the allow list (case-insensitive). If no match, returns a 403 Access Denied page.
   - Creates a session in KV tied to the matched email address.
   - Sets a session cookie and redirects to the original destination.

### Session Lifecycle

- The session cookie is named `feed_reader_session` and is `HttpOnly`, `Secure`, and `SameSite=Lax`.
- The session TTL is configured by `SESSION_TTL_SECONDS` (default: 86400 seconds / 24 hours).
- The TTL is **sliding** — it resets on every authenticated request, so active users stay logged in.
- Session data (the user's email) is stored in the `SESSIONS` Cloudflare KV namespace under the key `session:{sessionId}`. Cloudflare handles expiry automatically.

### Logout Flow

Visiting `/logout` deletes the session from KV, clears the session cookie, and redirects to `/logged-out`.

### Public Routes

The following routes are accessible without a session:

| Path | Purpose |
|---|---|
| `/login` | Login page |
| `/auth/callback` | OAuth callback (GitHub redirects here) |
| `/logout` | Clears the session |
| `/logged-out` | Confirmation page after logout |

All other routes require a valid session.

---

## Configuration

### GitHub OAuth App

You must create a GitHub OAuth App and register the callback URL.

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set the **Authorization callback URL** to `https://reader.kixx.news/auth/callback`.
3. After creating the app, generate a **Client Secret**.
4. Note the **Client ID** and **Client Secret** — you will need them in the next step.

For local development, create a second OAuth App with the callback URL set to `http://localhost:8787/auth/callback`. See [Local Development](#local-development) below.

### Cloudflare KV Namespace

Sessions are stored in a Cloudflare KV namespace bound to the Worker as `SESSIONS`. This was already created during initial setup. If you need to recreate it:

```bash
npx wrangler kv namespace create SESSIONS
```

Copy the returned `id` value and update `"id"` under `kv_namespaces` in `wrangler.jsonc`.

### Secrets

The following secrets must be set via Wrangler. They are never stored in the codebase.

| Secret | Description |
|---|---|
| `GITHUB_CLIENT_ID` | Client ID from the GitHub OAuth App |
| `GITHUB_CLIENT_SECRET` | Client Secret from the GitHub OAuth App |
| `ALLOWED_EMAILS` | Comma-separated list of permitted email addresses |

Set each secret by running the command below and entering the value when prompted:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ALLOWED_EMAILS
```

`ALLOWED_EMAILS` example value: `alice@example.com, bob@example.com`

Whitespace around commas is ignored. Matching is case-insensitive. Only **verified** email addresses from GitHub are checked against this list.

### Non-Secret Configuration

These values live in the `vars` block in `wrangler.jsonc` and can be edited directly.

| Variable | Default | Description |
|---|---|---|
| `SESSION_TTL_SECONDS` | `86400` | Session idle timeout in seconds (24 hours). Parsed as an integer at runtime. |
| `GITHUB_OAUTH_CALLBACK_URL` | `https://reader.kixx.news/auth/callback` | Must exactly match the callback URL registered in the GitHub OAuth App. |

---

## Managing Access

To **grant access** to a new user, add their GitHub-verified email address to the `ALLOWED_EMAILS` secret:

```bash
npx wrangler secret put ALLOWED_EMAILS
# Enter the full updated list, e.g.:
# alice@example.com, bob@example.com, carol@example.com
```

`wrangler secret put` replaces the entire value, so always supply the complete list.

To **revoke access**, run the same command and omit the email from the list. Any active session for that user will continue until it expires (up to `SESSION_TTL_SECONDS`). There is no mechanism to immediately invalidate a specific user's session short of deleting it directly from the `SESSIONS` KV namespace via the Cloudflare dashboard.

---

## Local Development

To test the OAuth flow on localhost:

1. Create a separate GitHub OAuth App with the callback URL `http://localhost:8787/auth/callback`.
2. Create a `.dev.vars` file in the project root (already gitignored):

```
GITHUB_CLIENT_ID=<your-local-app-client-id>
GITHUB_CLIENT_SECRET=<your-local-app-client-secret>
ALLOWED_EMAILS=your@email.com
GITHUB_OAUTH_CALLBACK_URL=http://localhost:8787/auth/callback
```

3. Start the dev server:

```bash
npm start
```

Wrangler loads `.dev.vars` automatically and its values override `wrangler.jsonc` `vars` during local development only. The production secrets are unaffected.
