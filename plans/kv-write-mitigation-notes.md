# KV Write Mitigation — Implementation Notes

These notes capture decisions and context that aren't visible from reading the code.

## What changed and why

The SESSIONS KV namespace was taking over 1,000 writes from a bot repeatedly hitting
`GET /login`, which unconditionally called `kv.put()` on every page load. Two changes
address this.

### 1. `GET /auth/start` — state token creation moved out of `/login`

**Before**: `GET /login` called `createState(kv, nextUrl)` on every render, writing a
CSRF state token to KV regardless of whether the user actually clicked the login button.

**After**: `GET /login` is a pure HTML render with no KV operations. The "Login with
GitHub" link points to `GET /auth/start?next=<url>`. Only when the user actually follows
that link does a state token get created.

**Login flow**:
1. `GET /login` — renders HTML, zero KV ops
2. `GET /auth/start?next=<url>` — creates state token in KV, redirects to GitHub OAuth
3. GitHub redirects to `GET /auth/callback?code=…&state=…` — consumes state token,
   creates session, redirects to `next`

The `next` param is forwarded as a URL-encoded query param through each step. It is not
validated until the callback handler, which sanitizes non-relative URLs to `/`.

### 2. Session refresh throttle in auth middleware

**Before**: Every authenticated request called `refreshSession` (one KV write) and
re-sent `Set-Cookie`, even for requests made seconds apart.

**After**: The middleware only refreshes when `Date.now() - session.createdAt >= ttl / 2`.
With the default 9-day TTL (`SESSION_TTL_SECONDS=777600`), this means at most one KV
write per ~4.5 days per active session.

`createdAt` is stored as a millisecond Unix timestamp in the session JSON value. It is
reset to `Date.now()` whenever `refreshSession` is called. Sessions created before this
field was added have `createdAt = undefined`, which the `|| 0` fallback treats as epoch,
guaranteeing they always refresh on the first post-deploy request (backward compatible).

## Files changed

| File | Change |
|---|---|
| `src/routes/auth-start.js` | New file — `handleAuthStart` handler |
| `src/routes/login.js` | Removed `createState` / `getAuthorizationUrl` calls; link now points to `/auth/start` |
| `src/auth/middleware.js` | Added `/auth/start` to `PUBLIC_PATHS`; added throttle logic |
| `src/auth/session.js` | `createSession` stores `createdAt`; `refreshSession` parses + re-serializes to reset `createdAt` |
| `src/index.js` | Registered `GET /auth/start` route |
| `test/index.spec.js` | Updated login assertions; added `/auth/start` and throttle tests |

## Decisions not visible from the code

**Why the link always includes `?next=`**: `handleLogin` always appends the `next` param
(defaulting to `/`). There is no bare `/auth/start` href. This simplifies `handleAuthStart`
— it always reads `next` from the query string without needing to handle a missing-param
case separately from a `/` value.

**Why `refreshSession` parses and re-serializes**: It needs to emit a fresh `createdAt`
timestamp. Storing the raw string from `kv.get()` would carry the old `createdAt` forward,
defeating the throttle. The extra parse step is intentional.

**Why the throttle check is in the middleware, not in `refreshSession`**: `refreshSession`
is a data-layer function. The policy of *when* to call it belongs at the middleware layer
where the TTL and business context are available.

**Why `/auth/start` is exact-match in `PUBLIC_PATHS`**: The set uses exact path matching
(no trailing slash, no prefix). This is consistent with all other public paths in the set.

## Known limitations

- **`/auth/start` has no rate limiting at the application layer.** A bot that discovers
  `/auth/start` instead of `/login` would produce the same KV write storm. Mitigation
  should be a Cloudflare WAF rate-limiting rule on `GET /auth/start`, not application code.

- **`next` is not validated at `/auth/start`.** A direct request with
  `?next=http://evil.com` will store the URL in a state token. The callback handler
  sanitizes it to `/`. Failing earlier (at `/auth/start`) would be a cleaner boundary.

- **Double KV read on refresh.** When a session is stale enough to trigger a refresh,
  the middleware calls `getSession` (one `kv.get`) then `refreshSession` (another
  `kv.get` + one `kv.put`). The value is fetched twice. Fixing this would require
  changing the interface to pass the raw value through, which isn't worth the complexity
  given the infrequency of refreshes.

## Environment variables

No new environment variables. The throttle uses `SESSION_TTL_SECONDS` (already required).
The new route uses `GITHUB_CLIENT_ID` and `GITHUB_OAUTH_CALLBACK_URL` (already required),
previously used in `handleLogin`.
