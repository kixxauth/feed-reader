# Feed Reader — Operations Manual

A simple RSS feed reader built on Cloudflare Workers. This document describes the current architecture, configuration, deployment, and maintenance procedures.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Authentication System](#3-authentication-system)
4. [Pages and Features](#4-pages-and-features)
5. [Configuration Reference](#5-configuration-reference)
6. [First-Time Setup](#6-first-time-setup)
7. [Deployment](#7-deployment)
8. [Importing Data](#8-importing-data)
9. [Testing](#9-testing)
10. [Maintenance and Operations](#10-maintenance-and-operations)
11. [File Structure](#11-file-structure)
12. [Known Limitations](#12-known-limitations)

---

## 1. Architecture Overview

### Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (V8) |
| Web framework | Hono v4 |
| Database | Cloudflare D1 (SQLite) |
| Session store | Cloudflare KV |
| Authentication | GitHub OAuth 2.0 |
| Tests | Vitest + @cloudflare/vitest-pool-workers |
| Dev tooling | Node.js, Wrangler CLI |

### Request Flow

All incoming requests pass through `authMiddleware` (registered globally). The middleware:

1. Checks if the path is a **public path** (exact match against a fixed list).
2. For protected paths: reads the session cookie, validates the session in KV, and either continues or redirects to `/login?next=<original-url>`.
3. On a valid session: stores the user's email on the Hono context (`c.set('email', ...)`) and applies **throttled session refresh** (KV write at most once per ~4.5 days for a 9-day session TTL).

**Public paths** (no auth required): `/login`, `/auth/start`, `/auth/callback`, `/logout`, `/logged-out`

**Protected paths** (auth required): `/`, `/feeds`, `/feeds/:feedId/articles`

### Data Model

The application uses a **single-user-pool** model. All authenticated users share the same set of feeds and articles. There is no per-user subscription, preference, or read-tracking.

### CSS Delivery

Styles are defined in `src/styles.css` and imported as a text module (via a Wrangler `rules` entry). The layout function inlines CSS directly into the `<head>` of every HTML response — no external stylesheet requests.

---

## 2. Database Schema

### `feeds` table

Created by migration `0001_create_feeds_table.sql`.

```sql
CREATE TABLE feeds (
  id            TEXT PRIMARY KEY,
  hostname      TEXT NOT NULL,
  type          TEXT,
  title         TEXT NOT NULL,
  xml_url       TEXT,
  html_url      TEXT,
  no_crawl      INTEGER DEFAULT 0,
  description   TEXT,
  last_build_date TEXT,
  score         REAL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_feeds_hostname ON feeds(hostname);
```

| Column | Notes |
|---|---|
| `id` | Primary key (string UUID from source data) |
| `hostname` | Domain of the feed source; indexed for sort |
| `type` | Feed format (e.g., `rss`, `atom`); nullable |
| `title` | Human-readable name |
| `xml_url` | URL to the RSS/Atom XML |
| `html_url` | URL to the feed's website |
| `no_crawl` | `1` to exclude from future crawling |
| `description` | Optional description |
| `last_build_date` | When feed was last updated (ISO 8601) |
| `score` | Numeric quality/ranking score |
| `created_at`, `updated_at` | Auto-managed timestamps |

### `articles` table

Created by migration `0002_create_articles_table.sql`.

```sql
CREATE TABLE articles (
  id         TEXT PRIMARY KEY,
  feed_id    TEXT,
  link       TEXT,
  title      TEXT,
  published  TEXT,
  updated    TEXT,
  added      TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_articles_feed_published ON articles(feed_id, published);
```

| Column | Notes |
|---|---|
| `id` | Primary key (string UUID from source data) |
| `feed_id` | References `feeds.id`; no FK constraint |
| `link` | URL to the article; nullable |
| `title` | Article title |
| `published` | **Must be ISO 8601 text** (`YYYY-MM-DD` or `YYYY-MM-DDThh:mm:ssZ`); date filtering depends on this |
| `updated` | Date article was updated; nullable |
| `added` | Date added to source database; nullable |
| `created_at` | Row insert timestamp |

**Index**: The composite index `(feed_id, published)` covers both the full query pattern (feed + date filtering, sorted by date) and feed-only lookups (leftmost-prefix rule).

**No foreign key constraints**: Articles referencing deleted feeds are not removed automatically.

### Applying Migrations

```bash
# Local development
npx wrangler d1 migrations apply feed-reader-db --local

# Production
npx wrangler d1 migrations apply feed-reader-db --remote
```

---

## 3. Authentication System

### GitHub OAuth Flow

```
User visits /            → redirect to /login?next=/
User visits /login       → renders login page with link to /auth/start?next=%2F
User clicks link         → GET /auth/start
  - Creates CSRF state token in KV (10-minute TTL)
  - Redirects to github.com/login/oauth/authorize
GitHub redirects to      → GET /auth/callback?code=...&state=...
  - Validates and consumes state token (one-time use)
  - Exchanges code for GitHub access token
  - Fetches user's verified emails from GitHub API
  - Checks email against ALLOWED_EMAILS secret (comma-separated)
  - Match → create session in KV, set cookie, redirect to original URL
  - No match → 403 Access Denied
```

### Session Management

| Property | Value |
|---|---|
| Cookie name | `feed_reader_session` |
| Cookie attributes | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| KV key format | `session:{uuid}` |
| KV value | JSON: `{ email, createdAt }` |
| Default TTL | 777600 seconds (9 days), set via `SESSION_TTL_SECONDS` var |

**Throttled refresh**: Sessions are refreshed (new TTL + new cookie header) only when `Date.now() - session.createdAt >= TTL / 2`. For a 9-day TTL this means at most one KV write per ~4.5 days per active session. This prevents excessive KV writes from frequent users.

### OAuth State Tokens (CSRF protection)

| Property | Value |
|---|---|
| KV key format | `oauth_state:{uuid}` |
| KV value | JSON: `{ nextUrl }` |
| TTL | 10 minutes |
| Usage | One-time: consumed (deleted) on first use |

State token creation happens at `/auth/start`, not on the login page view, to avoid KV writes from bot traffic scanning `/login`.

### Redirect Safety

After login, the `nextUrl` is validated before redirecting:
- Must start with `/` (relative, not external)
- Must not start with `//` (protocol-relative redirect)
- Must not contain `\r` or `\n` (header injection)

---

## 4. Pages and Features

### Home (`/`)

Protected. Simple landing page with navigation to `/feeds`.

### Login (`/login`)

Public. Renders a "Login with GitHub" link pointing to `/auth/start?next={encoded-next}`. The `next` query param carries the originally-requested URL through the auth flow.

### Feeds List (`/feeds`)

Protected. Displays all imported feeds with pagination.

- **Sort**: By `hostname ASC`
- **Page size**: 50 feeds per page
- **Pagination**: `?page=N` (1-indexed). Out-of-bounds pages are clamped to the last valid page (200 response, no redirect).
- **Per feed**: external link to `html_url`, feed hostname (subordinate text), "Articles" link to `/feeds/{feedId}/articles`
- **XSS protection**: All feed data HTML-escaped before rendering

### Articles List (`/feeds/:feedId/articles`)

Protected. Displays articles for a single feed.

- Returns **404** if the feed ID is not found.
- **Sort**: `published DESC`, NULLs last
- **Page size**: 20 articles per page
- **Pagination**: `?page=N` (1-indexed). Same clamping behavior as feeds.
- **Date filtering**: `?from=YYYY-MM-DD` and/or `?to=YYYY-MM-DD` (both inclusive). Invalid values are silently ignored.
- Pagination links preserve active filter params (e.g., `?from=2026-01-01&page=2`).
- **Date display**: `Mar 23, 2026` format (UTC locale); NULL dates show "Date unknown"
- **Empty state** (no articles at all): "No articles available for this feed" — filter form hidden
- **Empty state** (filter active, no matches): Filter form shown + "No articles match the current filter"

### Logout (`/logout`)

Public. Deletes the session from KV, clears the cookie, and redirects to `/logged-out`.

---

## 5. Configuration Reference

### `wrangler.jsonc` Summary

```jsonc
{
  "name": "feed-reader",
  "main": "src/index.js",
  "compatibility_date": "2026-03-10",
  "compatibility_flags": ["nodejs_compat"],
  "rules": [{ "type": "Text", "globs": ["**/*.css"] }],
  "routes": [{ "pattern": "reader.kixx.news", "custom_domain": true }],
  "kv_namespaces": [{ "binding": "SESSIONS", "id": "<kv-namespace-id>" }],
  "d1_databases": [{
    "binding": "DB",
    "database_name": "feed-reader-db",
    "database_id": "<d1-database-id>",
    "migrations_dir": "migrations"
  }],
  "observability": { "enabled": true },
  "keep_vars": true,
  "vars": {
    "SESSION_TTL_SECONDS": "777600",
    "GITHUB_OAUTH_CALLBACK_URL": "https://reader.kixx.news/auth/callback"
  }
}
```

### Environment Variables (`vars`)

| Variable | Description | Default |
|---|---|---|
| `SESSION_TTL_SECONDS` | Session lifetime in seconds | `"777600"` (9 days) |
| `GITHUB_OAUTH_CALLBACK_URL` | Full callback URL registered with GitHub OAuth App | `"https://reader.kixx.news/auth/callback"` |

### Secrets

Set via `npx wrangler secret put <NAME>`. **Never commit these to source control.**

| Secret | Description |
|---|---|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `ALLOWED_EMAILS` | Comma-separated list of permitted email addresses (e.g., `alice@example.com,bob@example.com`) |

Secrets are read at request time. **Redeployment is not required after changing secrets.**

### Local Development Secrets

For local development, create a `.dev.vars` file (gitignored) in the project root:

```
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
ALLOWED_EMAILS=you@example.com
```

---

## 6. First-Time Setup

### Prerequisites

- Cloudflare account with Workers and D1 enabled
- GitHub account with an OAuth App registered
- Node.js and npm installed

### Step 1: GitHub OAuth App

1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Set **Authorization callback URL** to `https://reader.kixx.news/auth/callback`
3. Note the **Client ID** and generate a **Client Secret**

### Step 2: Cloudflare Resources

```bash
# Create the D1 database
npx wrangler d1 create feed-reader-db

# Create the KV namespace
npx wrangler kv namespace create SESSIONS
```

Copy the returned `id` values into `wrangler.jsonc` under `d1_databases[0].database_id` and `kv_namespaces[0].id`.

### Step 3: Set Secrets

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ALLOWED_EMAILS
```

### Step 4: Apply Migrations

```bash
npx wrangler d1 migrations apply feed-reader-db --remote
```

### Step 5: Deploy

```bash
npm install
npm run deploy
```

---

## 7. Deployment

> **Important**: Do not deploy without explicit instructions from the project owner. This project uses manual deploys only.

### Deploy Command

```bash
npm run deploy
# equivalent to: npx wrangler deploy
```

### Wrangler Commands Reference

```bash
# Deploy
npx wrangler deploy

# Stream live logs
npx wrangler tail

# Apply database migrations (production)
npx wrangler d1 migrations apply feed-reader-db --remote

# Execute arbitrary SQL (production)
npx wrangler d1 execute feed-reader-db --remote --command "SELECT COUNT(*) FROM feeds"
```

---

## 8. Importing Data

Both import scripts read from a source SQLite database file and upsert rows into D1. They are **idempotent**: re-running with the same source updates existing records without creating duplicates.

### Import Feeds

```bash
# Local
npm run import-feeds -- --env local path/to/source.sqlite

# Production
npm run import-feeds -- --env remote path/to/source.sqlite

# Override table name (if auto-detection fails)
npm run import-feeds -- --env local --table my_table path/to/source.sqlite
```

**Auto-detection**: Looks for a table with columns `id`, `hostname`, `title`, `xml_url`, `html_url`.

**Required source columns**: `id`, `hostname`, `type`, `title`, `xml_url`, `html_url`, `no_crawl`, `description`, `last_build_date`, `score`

### Import Articles

```bash
# Local
npm run import-articles -- --env local path/to/source.sqlite

# Production
npm run import-articles -- --env remote path/to/source.sqlite
```

**Auto-detection**: Looks for a table with columns `id`, `feed_id`, `link`, `title`, `published`.

**Required source columns**: `id`, `feed_id`, `link`, `title`, `published`, `updated`, `added`

**Critical**: The `published` column in the source **must be ISO 8601 text** (`YYYY-MM-DD` or `YYYY-MM-DDThh:mm:ssZ`). Date filtering depends on lexicographic string comparison. Unix timestamps or other formats will produce incorrect filtering results and must be converted before import.

---

## 9. Testing

### Running Tests

```bash
npm test               # run all tests
npx vitest run         # same
npx vitest --watch     # watch mode
```

### Test Environment

Tests run inside the actual Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`. The test runner automatically provisions a local D1 instance and KV namespace from the bindings defined in `wrangler.jsonc`.

### Test Helper Patterns

```js
// Unauthenticated request
const response = await SELF.fetch('http://example.com/feeds');

// Authenticated request (uses makeAuthenticatedRequest helper)
const request = makeAuthenticatedRequest('http://example.com/feeds');
const response = await SELF.fetch(request);

// Capture redirect without following it
const response = await SELF.fetch(url, { redirect: 'manual' });

// Seed test data
await seedFeeds([{ id: '1', hostname: 'example.com', title: 'Example', ... }]);
await clearFeeds();
await seedArticles([{ id: 'a1', feed_id: '1', title: 'Article', published: '2026-01-01', ... }]);
await clearArticles();
```

### Coverage Areas

- Unauthenticated access → redirect to login
- Login page renders correctly
- `/auth/start` creates state token and redirects to GitHub
- OAuth callback validates state, checks email, creates session
- Session refresh throttle (no KV write within TTL/2 window)
- Feeds page: pagination, empty state, XSS escaping
- Articles page: pagination, date filtering, empty states, NULL published dates, XSS escaping
- Logout: session deleted, cookie cleared

---

## 10. Maintenance and Operations

### Monitoring

```bash
# Stream live logs from the deployed Worker
npx wrangler tail
```

Observability is enabled in `wrangler.jsonc` (`"observability": { "enabled": true }`).

### Rotating Secrets

```bash
# Update GitHub OAuth credentials
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET

# Update allowed email list
npx wrangler secret put ALLOWED_EMAILS
```

No redeployment required — secrets are read at request time.

### Adding New Allowed Users

Update the `ALLOWED_EMAILS` secret with the full comma-separated list (including existing users):

```bash
npx wrangler secret put ALLOWED_EMAILS
# Enter: existing@example.com,newuser@example.com
```

### Database Queries (Production)

```bash
# Count feeds and articles
npx wrangler d1 execute feed-reader-db --remote --command "SELECT COUNT(*) FROM feeds"
npx wrangler d1 execute feed-reader-db --remote --command "SELECT COUNT(*) FROM articles"

# Check a specific feed
npx wrangler d1 execute feed-reader-db --remote --command "SELECT * FROM feeds WHERE id = 'some-id'"
```

### Adding a New Database Migration

1. Create a new file in `migrations/` following the naming pattern: `0003_description.sql`
2. Write your `CREATE TABLE`, `ALTER TABLE`, or index SQL
3. Apply locally: `npx wrangler d1 migrations apply feed-reader-db --local`
4. Run tests: `npm test`
5. Apply to production after deploying: `npx wrangler d1 migrations apply feed-reader-db --remote`

---

## 11. File Structure

```
feed-reader/
├── src/
│   ├── index.js              # App entry: route registration, middleware wiring
│   ├── layout.js             # Shared HTML layout (renderLayout)
│   ├── db.js                 # Database query helpers (getFeedsPaginated, etc.)
│   ├── html-utils.js         # escapeHtml() utility
│   ├── styles.css            # Stylesheet (imported as text, inlined into HTML)
│   ├── auth/
│   │   ├── middleware.js     # Auth middleware, public paths, session throttle
│   │   ├── session.js        # Session CRUD (KV-backed)
│   │   ├── state.js          # OAuth CSRF state tokens (KV-backed)
│   │   └── github.js         # GitHub OAuth 2.0 implementation
│   └── routes/
│       ├── login.js          # GET /login
│       ├── auth-start.js     # GET /auth/start
│       ├── callback.js       # GET /auth/callback
│       ├── logout.js         # GET /logout
│       ├── logged-out.js     # GET /logged-out
│       ├── feeds.js          # GET /feeds
│       └── articles.js       # GET /feeds/:feedId/articles
├── migrations/
│   ├── 0001_create_feeds_table.sql
│   └── 0002_create_articles_table.sql
├── scripts/
│   ├── import-feeds.js       # CLI: bulk import feeds from SQLite
│   └── import-articles.js    # CLI: bulk import articles from SQLite
├── test/
│   └── index.spec.js         # All test cases
├── plans/                    # Implementation plans (historical reference)
├── wrangler.jsonc            # Cloudflare Workers configuration
├── vitest.config.js          # Test configuration
├── package.json
├── .prettierrc
├── .dev.vars                 # Local dev secrets (gitignored)
├── CLAUDE.md                 # Agent instructions
└── README.md                 # Quick-start development commands
```

### Key Source Files

| File | Responsibility |
|---|---|
| `src/index.js` | Mounts middleware and all routes; exports the Hono app |
| `src/db.js` | `getFeedsPaginated`, `getFeedById`, `getArticlesByFeedPaginated`, `upsertFeed` |
| `src/auth/middleware.js` | Auth gate for all requests; session validation and throttled refresh |
| `src/auth/session.js` | `createSession`, `getSession`, `refreshSession`, `deleteSession`, cookie helpers |
| `src/auth/github.js` | `getAuthorizationUrl`, `exchangeCodeForToken`, `getUserEmails` |
| `src/routes/articles.js` | Articles page: date filtering, pagination, empty states, XSS-safe rendering |

---

## 12. Known Limitations

| Area | Limitation |
|---|---|
| Multi-user | All users share the same feeds and articles; no per-user data |
| Feed management | No UI for adding, editing, or deleting feeds — CLI import only |
| Article refresh | Articles only update via manual import scripts; no automatic crawling |
| Full-text search | No article content search |
| Read tracking | No mark-as-read, bookmarks, or history |
| Cascading deletes | Articles are not removed when a feed is deleted |
| Rate limiting | No application-layer rate limiting; enforce via Cloudflare WAF if needed (particularly on `/auth/start` to limit KV writes) |
