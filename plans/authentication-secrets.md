# Authentication Secrets

The following secrets must be configured manually via `wrangler secret put`. Do not put actual secret values in the codebase.

## Required Secrets

- `GITHUB_CLIENT_ID` — The Client ID from the GitHub OAuth App.
- `GITHUB_CLIENT_SECRET` — The Client Secret from the GitHub OAuth App.
- `ALLOWED_EMAILS` — A comma-separated list of email addresses permitted to log in. Whitespace around commas is ignored at runtime. Example: `alice@example.com, bob@example.com`.

## Setting Secrets

Run the following commands and enter the secret value when prompted:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ALLOWED_EMAILS
```

## Creating the KV Namespace

The `SESSIONS` KV namespace must be created before deploying. Run:

```bash
npx wrangler kv namespace create SESSIONS
```

Copy the returned `id` value and replace `"REPLACE_WITH_REAL_KV_ID"` in `wrangler.jsonc`.

## Notes

- `wrangler.jsonc` contains placeholder values for `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `ALLOWED_EMAILS` under `vars`. These are used by the test suite. In production, secrets set via `wrangler secret put` override the `vars` values.
- `SESSION_TTL_SECONDS` and `GITHUB_OAUTH_CALLBACK_URL` are non-sensitive and live in `vars` in `wrangler.jsonc`.
