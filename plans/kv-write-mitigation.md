# KV Write Mitigation Implementation Plan

## Implementation Approach

The SESSIONS KV store was hit with over 1,000 writes from a bot repeatedly requesting `/login`, which unconditionally creates a state token via `kv.put()` on every page load. Two changes mitigate this. First, we introduce a `GET /auth/start` route that owns state token creation and the redirect to GitHub, turning the `/login` page into a pure HTML render with zero KV operations. Second, we throttle `refreshSession` in the auth middleware so that authenticated page loads only re-put the session when more than half the TTL has elapsed, cutting KV writes from once-per-request to roughly once-per-4.5-days. Both changes touch the auth layer and share test infrastructure, so they are sequenced to land the new route first (since it changes the login flow) followed by the middleware optimization.

---

## TODO Items

- [x] **Create `/auth/start` route handler**
  - **Story**: Move state token creation out of `/login`
  - **What**: Create a new Hono route handler `handleAuthStart` for `GET /auth/start`. It reads the `next` query parameter (default `/`), calls `createState(kv, nextUrl)` to generate the CSRF state token, builds the GitHub authorization URL via `getAuthorizationUrl`, and returns a 302 redirect to that URL. This is the only place state tokens are created during the login flow. The handler reads `c.env.SESSIONS`, `c.env.GITHUB_CLIENT_ID`, and `c.env.GITHUB_OAUTH_CALLBACK_URL` — the same env vars currently used in `handleLogin`.
  - **Where**: `src/routes/auth-start.js` (new file)
  - **Acceptance criteria**: Visiting `/auth/start` creates a state token in KV and redirects to GitHub's OAuth authorize endpoint. The `next` param is preserved in the state token. No HTML is rendered.
  - **Depends on**: none

- [x] **Remove state token creation from login page**
  - **Story**: Move state token creation out of `/login`
  - **What**: Modify `handleLogin` so it no longer imports or calls `createState` or `getAuthorizationUrl`. Instead, the "Login with GitHub" link points to `/auth/start?next=${encodeURIComponent(nextUrl)}`. Remove the `createState` and `getAuthorizationUrl` imports, and the `clientId`, `callbackUrl` env var reads. The login page becomes a pure HTML render with no KV operations.
  - **Where**: `src/routes/login.js`
  - **Acceptance criteria**: `GET /login` returns 200 with HTML containing a link to `/auth/start`. No KV reads or writes occur. The `next` query param is forwarded as a URL-encoded value in the link href (e.g., `GET /login?next=%2Fsome-page` produces `href="/auth/start?next=%2Fsome-page"`).
  - **Depends on**: Create `/auth/start` route handler

- [x] **Add `/auth/start` to public paths and register route**
  - **Story**: Move state token creation out of `/login`
  - **What**: Add `/auth/start` to the `PUBLIC_PATHS` set in `src/auth/middleware.js` so the middleware skips auth for it. In `src/index.js`, import `handleAuthStart` from `./routes/auth-start.js` and register `app.get('/auth/start', handleAuthStart)` alongside the other public auth routes.
  - **Where**: `src/auth/middleware.js`, `src/index.js`
  - **Acceptance criteria**: Unauthenticated requests to `/auth/start` are not redirected to `/login`. The route is reachable and produces a redirect to GitHub.
  - **Depends on**: Create `/auth/start` route handler

- [x] **Update tests for login page and `/auth/start`**
  - **Story**: Move state token creation out of `/login`
  - **What**: Update the existing "Login page" tests in `test/index.spec.js`:
    - In the first test (`GET /login returns 200 and contains "Login with GitHub"`): keep the existing `toContain('Login with GitHub')` assertion and add a new assertion that `body` contains `href="/auth/start"`.
    - In the second test (`GET /login?next=%2Fsome-page returns 200`): add an assertion that `body` contains `href="/auth/start?next=%2Fsome-page"`.

    Add new tests for `GET /auth/start`:
    - Verify it returns a 302 redirect whose `Location` header begins with `https://github.com/login/oauth/authorize`.
    - Verify that `GET /auth/start?next=%2Fsome-page` preserves the next URL in the state token: extract the `state` query param from the `Location` header, then call `consumeState(env.SESSIONS, state)` (import `consumeState` from `../src/auth/state.js`) and assert the returned value is `/some-page`.
    - Verify the OAuth callback flow still works end-to-end (the existing callback tests should pass unchanged since the state token format is identical).
  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: All existing tests pass (with updated assertions for the login page link). New tests cover `/auth/start` redirect behavior and state token creation. `consumeState` is imported alongside the existing `createState` import.
  - **Depends on**: Remove state token creation from login page, Add `/auth/start` to public paths and register route

- [x] **Add `createdAt` timestamp to session value**
  - **Story**: Throttle session refresh
  - **What**: Modify `createSession` in `src/auth/session.js` to store `{ email, createdAt: Date.now() }` instead of just `{ email }`. Modify `refreshSession` to update `createdAt` when it re-puts the value: parse the raw JSON string obtained from `kv.get()` to extract `email`, construct `{ email, createdAt: Date.now() }`, re-serialize, and put that new value. If the existing value cannot be parsed (malformed JSON), treat it as a missing session and return `false` without writing. No changes to `getSession` — it continues to return whatever is in the JSON value, so callers can access `session.createdAt`.

    Note: `refreshSession` currently stores the raw string it reads from KV. After this change it will parse and re-serialize, which means it does a KV get + parse + put instead of a KV get + put. This extra parse step is intentional and necessary to reset `createdAt`.
  - **Where**: `src/auth/session.js`
  - **Acceptance criteria**: New sessions include a `createdAt` field (millisecond Unix timestamp). Refreshed sessions get an updated `createdAt`. Existing sessions without `createdAt` still parse correctly (backward compatible — `session.createdAt` will be `undefined`, which the throttle logic handles via `|| 0`).
  - **Depends on**: none

- [x] **Throttle `refreshSession` calls in auth middleware**
  - **Story**: Throttle session refresh
  - **What**: Modify the auth middleware so that after validating a session, it only calls `refreshSession` and re-sets the cookie if the session's `createdAt` is older than half the TTL. Specifically: compute `const elapsed = Date.now() - (session.createdAt || 0)` and `const threshold = (ttlSeconds * 1000) / 2`. Only call `refreshSession` and `c.header('Set-Cookie', ...)` when `elapsed >= threshold`. When the refresh is skipped, the middleware still sets `c.set('email', session.email)` and calls `await next()` — the user remains authenticated, they just don't get a KV write on every request.
  - **Where**: `src/auth/middleware.js`
  - **Acceptance criteria**: Authenticated requests within the first half of the TTL window produce zero KV writes from the middleware and no `Set-Cookie` header. Requests after the halfway point refresh the session and reset the cookie. Sessions without a `createdAt` field (legacy) always refresh (the `|| 0` fallback makes `elapsed` large, ensuring `elapsed >= threshold` is true).
  - **Depends on**: Add `createdAt` timestamp to session value

- [x] **Update tests for throttled session refresh**
  - **Story**: Throttle session refresh
  - **What**: Add tests in `test/index.spec.js` that verify the throttle behavior. `SESSION_TTL_SECONDS` is `"777600"` (9 days) in the test environment, available via `parseInt(env.SESSION_TTL_SECONDS)` if needed.

    - **Test 1 (fresh session — no refresh)**: Call `createSession(env.SESSIONS, 'allowed@example.com', 86400)` (which now sets `createdAt: Date.now()`), immediately make an authenticated request using that session ID, and verify the response does NOT have a `Set-Cookie` header (elapsed ≈ 0, below threshold).
    - **Test 2 (stale session — refresh)**: Directly put a session value into `env.SESSIONS` using `env.SESSIONS.put('session:<uuid>', JSON.stringify({ email: 'allowed@example.com', createdAt: 0 }), { expirationTtl: 86400 })`. Using `createdAt: 0` (Unix epoch) guarantees elapsed is always above any threshold. Make an authenticated request with that session ID and verify the response DOES have a `Set-Cookie` header.

    Existing authenticated-access tests should still pass — `makeAuthenticatedRequest` calls `createSession` which sets a fresh `createdAt`, so those tests will exercise the "no refresh" path. They don't assert on `Set-Cookie` presence, so they will pass unchanged.
  - **Where**: `test/index.spec.js`
  - **Acceptance criteria**: Tests confirm that fresh sessions skip the KV write and stale sessions trigger it. All existing tests continue to pass.
  - **Depends on**: Throttle `refreshSession` calls in auth middleware

- [x] **Validate all tests pass**
  - **Story**: Both stories
  - **What**: Run `npm test` and verify all existing and new tests pass. Start the dev server with `npm start`, verify that visiting `/` redirects to `/login`, that the login page links to `/auth/start`, and that `/auth/start` redirects to GitHub. Kill the dev server after validation.
  - **Where**: n/a (validation step)
  - **Acceptance criteria**: `npm test` exits with 0. Manual smoke test confirms the login flow works end-to-end with the new `/auth/start` intermediary.
  - **Depends on**: Update tests for login page and `/auth/start`, Update tests for throttled session refresh

---

## Implementation notes

All items completed as specified with one minor deviation:

**Login page test assertion**: The plan specified asserting `href="/auth/start"` in the first login test. In practice, `handleLogin` always appends `?next=…` — there is no code path that produces a bare `/auth/start` href. When no `next` param is present the default is `/`, so the href is `/auth/start?next=%2F`. The test was written to assert the actual output: `href="/auth/start?next=%2F"`.
