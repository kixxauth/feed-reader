import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import worker from '../src';
import { createSession } from '../src/auth/session.js';
import { createState, consumeState } from '../src/auth/state.js';

// ---------------------------------------------------------------------------
// Helper: create an authenticated request with a valid session cookie
// ---------------------------------------------------------------------------
async function makeAuthenticatedRequest(url) {
	const sessionId = await createSession(env.SESSIONS, 'allowed@example.com', 86400);
	return new Request(url, {
		headers: { Cookie: `feed_reader_session=${sessionId}` },
	});
}

// ---------------------------------------------------------------------------
// Helper: seed the DB with sample feed rows for testing
// ---------------------------------------------------------------------------
async function seedFeeds(feeds) {
	for (const feed of feeds) {
		await env.DB.prepare(
			`INSERT INTO feeds (id, hostname, type, title, xml_url, html_url, no_crawl, description, last_build_date, score)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				feed.id,
				feed.hostname,
				feed.type ?? null,
				feed.title,
				feed.xml_url ?? null,
				feed.html_url ?? null,
				feed.no_crawl ?? 0,
				feed.description ?? null,
				feed.last_build_date ?? null,
				feed.score ?? null
			)
			.run();
	}
}

// ---------------------------------------------------------------------------
// Helper: clear the feeds table between tests
// ---------------------------------------------------------------------------
async function clearFeeds() {
	await env.DB.prepare('DELETE FROM feeds').run();
}

// ---------------------------------------------------------------------------
// Helper: seed the DB with sample article rows for testing
// ---------------------------------------------------------------------------
async function seedArticles(articles) {
	for (const article of articles) {
		await env.DB.prepare(
			`INSERT INTO articles (id, feed_id, link, title, published, updated, added)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				article.id,
				article.feed_id,
				article.link ?? null,
				article.title,
				article.published ?? null,
				article.updated ?? null,
				article.added ?? null
			)
			.run();
	}
}

// ---------------------------------------------------------------------------
// Helper: clear the articles table between tests
// ---------------------------------------------------------------------------
async function clearArticles() {
	await env.DB.prepare('DELETE FROM articles').run();
}

describe('Unauthenticated access', () => {
	it('GET / without a session cookie redirects to /login (unit style)', async () => {
		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/login?next=%2F');
	});

	it('GET / without a session cookie redirects to /login (integration style)', async () => {
		const response = await SELF.fetch('http://example.com/', { redirect: 'manual' });
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/login?next=%2F');
	});
});

describe('Login page', () => {
	it('GET /login returns 200 and contains "Login with GitHub"', async () => {
		const response = await SELF.fetch('http://example.com/login');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
		const body = await response.text();
		expect(body).toContain('Login with GitHub');
		expect(body).toContain('href="/auth/start?next=%2F"');
	});

	it('GET /login?next=%2Fsome-page returns 200 with link to /auth/start preserving next', async () => {
		const response = await SELF.fetch('http://example.com/login?next=%2Fsome-page');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
		const body = await response.text();
		expect(body).toContain('href="/auth/start?next=%2Fsome-page"');
	});
});

describe('/auth/start', () => {
	it('GET /auth/start returns 302 redirect to GitHub OAuth', async () => {
		const response = await SELF.fetch('http://example.com/auth/start', { redirect: 'manual' });
		expect(response.status).toBe(302);
		const location = response.headers.get('location');
		expect(location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize/);
	});

	it('GET /auth/start?next=%2Fsome-page preserves next in state token', async () => {
		const response = await SELF.fetch('http://example.com/auth/start?next=%2Fsome-page', { redirect: 'manual' });
		expect(response.status).toBe(302);
		const location = response.headers.get('location');
		const locationUrl = new URL(location);
		const state = locationUrl.searchParams.get('state');
		const nextUrl = await consumeState(env.SESSIONS, state);
		expect(nextUrl).toBe('/some-page');
	});
});

describe('Authenticated access', () => {
	beforeEach(async () => {
		await clearFeeds();
	});

	it('GET / with a valid session returns 200 with Logout link', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Logout');
	});

	it('GET / contains a link to /feeds and does not render feed data', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('href="/feeds"');
		expect(body).not.toContain('<ul class="feed-list">');
	});
});

describe('Feeds page', () => {
	beforeEach(async () => {
		await clearFeeds();
	});

	it('GET /feeds without a session redirects to /login?next=%2Ffeeds', async () => {
		const response = await SELF.fetch('http://example.com/feeds', { redirect: 'manual' });
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/login?next=%2Ffeeds');
	});

	it('GET /feeds with valid session and no feeds shows "No feeds available"', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('No feeds available');
		expect(body).not.toContain('<nav class="pagination">');
	});

	it('GET /feeds with seeded feeds shows titles and hostnames sorted by hostname', async () => {
		await seedFeeds([
			{
				id: 'feed-z',
				hostname: 'zebra.example.com',
				title: 'Zebra Feed',
				html_url: 'https://zebra.example.com',
			},
			{
				id: 'feed-a',
				hostname: 'alpha.example.com',
				title: 'Alpha Feed',
				html_url: 'https://alpha.example.com',
			},
			{
				id: 'feed-m',
				hostname: 'monkey.example.com',
				title: 'Monkey Feed',
				html_url: 'https://monkey.example.com',
			},
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();

		expect(body).toContain('Alpha Feed');
		expect(body).toContain('Monkey Feed');
		expect(body).toContain('Zebra Feed');

		expect(body).toContain('alpha.example.com');
		expect(body).toContain('monkey.example.com');
		expect(body).toContain('zebra.example.com');

		expect(body).not.toContain('No feeds available');

		const alphaPos = body.indexOf('alpha.example.com');
		const monkeyPos = body.indexOf('monkey.example.com');
		const zebraPos = body.indexOf('zebra.example.com');
		expect(alphaPos).toBeLessThan(monkeyPos);
		expect(monkeyPos).toBeLessThan(zebraPos);
	});

	it('GET /feeds HTML-escapes feed data', async () => {
		await seedFeeds([
			{
				id: 'feed-xss',
				hostname: 'safe.example.com',
				title: '<script>alert("xss")</script>',
				html_url: 'https://safe.example.com',
			},
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();

		expect(body).not.toContain('<script>alert("xss")</script>');
		expect(body).toContain('&lt;script&gt;');
	});

	it('GET /feeds?page=2 shows second page', async () => {
		await seedFeeds(
			Array.from({ length: 51 }, (_, i) => ({
				id: `feed-${i}`,
				hostname: `host-${String(i).padStart(3, '0')}.example.com`,
				title: `Feed ${i}`,
				html_url: `https://host-${String(i).padStart(3, '0')}.example.com`,
			}))
		);

		const request = await makeAuthenticatedRequest('http://example.com/feeds?page=2');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Page 2 of 2');
		expect(body).toContain('host-050.example.com');
	});

	it('GET /feeds?page=1 disables Previous link', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'alpha.example.com', title: 'Alpha Feed', html_url: 'https://alpha.example.com' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds?page=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('aria-disabled="true"');
		expect(body).not.toContain('href="/feeds?page=0"');
	});

	it('GET /feeds on last page disables Next link', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'alpha.example.com', title: 'Alpha Feed', html_url: 'https://alpha.example.com' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		// Next link should be disabled on the last (only) page
		const nextDisabledPos = body.lastIndexOf('aria-disabled="true"');
		const nextTextPos = body.indexOf('Next');
		expect(nextDisabledPos).toBeLessThan(nextTextPos);
		expect(body).not.toContain('href="/feeds?page=2"');
	});

	it('GET /feeds?page=0 clamps to page 1', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'alpha.example.com', title: 'Alpha Feed', html_url: 'https://alpha.example.com' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds?page=0');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Page 1 of');
	});

	it('GET /feeds?page=999 clamps to last page', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'alpha.example.com', title: 'Alpha Feed', html_url: 'https://alpha.example.com' },
			{ id: 'feed-2', hostname: 'beta.example.com', title: 'Beta Feed', html_url: 'https://beta.example.com' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds?page=999');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Page 1 of 1');
	});

	it('GET /feeds page shows articles link for each feed', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'alpha.example.com', title: 'Alpha Feed', html_url: 'https://alpha.example.com' },
			{ id: 'feed-2', hostname: 'beta.example.com', title: 'Beta Feed', html_url: 'https://beta.example.com' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('href="/feeds/feed-1/articles"');
		expect(body).toContain('href="/feeds/feed-2/articles"');
	});
});

describe('Articles page', () => {
	beforeEach(async () => {
		await clearFeeds();
		await clearArticles();
		await seedFeeds([
			{ id: 'feed-1', hostname: 'example.com', title: 'Test Feed', html_url: 'https://example.com' },
		]);
	});

	it('GET /feeds/{feedId}/articles without a session redirects to login', async () => {
		const response = await SELF.fetch('http://example.com/feeds/feed-1/articles', { redirect: 'manual' });
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/login?next=');
	});

	it('GET /feeds/{nonexistent}/articles returns 404', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/nonexistent/articles');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
	});

	it('GET /feeds/{feedId}/articles with valid session and no articles shows empty state', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('No articles available');
		expect(body).not.toContain('<form');
		expect(body).not.toContain('<nav class="pagination">');
	});

	it('GET /feeds/{feedId}/articles with seeded articles shows titles and dates sorted newest first', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'Oldest Article', published: '2026-01-01' },
			{ id: 'a2', feed_id: 'feed-1', title: 'Middle Article', published: '2026-02-01' },
			{ id: 'a3', feed_id: 'feed-1', title: 'Newest Article', published: '2026-03-23' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Newest Article');
		expect(body).toContain('Middle Article');
		expect(body).toContain('Oldest Article');
		// Newest should appear before oldest
		expect(body.indexOf('Newest Article')).toBeLessThan(body.indexOf('Oldest Article'));
		// Dates should be formatted
		expect(body).toContain('Jan 1, 2026');
		expect(body).toContain('Mar 23, 2026');
	});

	it('GET /feeds/{feedId}/articles with NULL published date shows "Date unknown"', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'No Date Article', published: null },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Date unknown');
	});

	it('GET /feeds/{feedId}/articles without filter returns all articles', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'Article One', published: '2026-01-01' },
			{ id: 'a2', feed_id: 'feed-1', title: 'Article Two', published: '2026-02-01' },
			{ id: 'a3', feed_id: 'feed-1', title: 'Article Three', published: '2026-03-01' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Article One');
		expect(body).toContain('Article Two');
		expect(body).toContain('Article Three');
	});

	it('GET /feeds/{feedId}/articles with from/to date filter returns only articles in range', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'Too Old', published: '2025-12-31' },
			{ id: 'a2', feed_id: 'feed-1', title: 'In Range', published: '2026-02-01' },
			{ id: 'a3', feed_id: 'feed-1', title: 'Too New', published: '2026-04-01' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles?from=2026-01-01&to=2026-03-31');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('In Range');
		expect(body).not.toContain('Too Old');
		expect(body).not.toContain('Too New');
	});

	it('GET /feeds/{feedId}/articles with invalid date param ignores filter', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'Article One', published: '2026-01-01' },
			{ id: 'a2', feed_id: 'feed-1', title: 'Article Two', published: '2026-02-01' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles?from=banana');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Article One');
		expect(body).toContain('Article Two');
	});

	it('GET /feeds/{feedId}/articles with filters active and no results shows filter form', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'Old Article', published: '2025-01-01' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles?from=2026-01-01&to=2026-12-31');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('<form');
		expect(body).toContain('No articles match');
		expect(body).not.toContain('<ul class="article-list">');
	});

	it('GET /feeds/{feedId}/articles?page=2 shows second page of articles', async () => {
		// Seed 21 articles with descending dates so oldest (a21) is on page 2
		const articles = Array.from({ length: 21 }, (_, i) => ({
			id: `a${i + 1}`,
			feed_id: 'feed-1',
			title: `Article ${i + 1}`,
			published: `2026-03-${String(21 - i).padStart(2, '0')}`,
		}));
		await seedArticles(articles);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles?page=2');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Page 2 of 2');
		// The 21st article (oldest) should be on page 2
		expect(body).toContain('Article 21');
	});

	it('GET /feeds/{feedId}/articles on page 1 disables Previous link', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'Article One', published: '2026-01-01' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles?page=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		const prevDisabledPos = body.indexOf('aria-disabled="true"');
		const prevTextPos = body.indexOf('Previous');
		expect(prevDisabledPos).toBeGreaterThanOrEqual(0);
		expect(prevDisabledPos).toBeLessThan(prevTextPos);
	});

	it('GET /feeds/{feedId}/articles on last page disables Next link', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'Article One', published: '2026-01-01' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		const nextDisabledPos = body.lastIndexOf('aria-disabled="true"');
		const nextTextPos = body.indexOf('Next');
		expect(nextDisabledPos).toBeGreaterThanOrEqual(0);
		expect(nextDisabledPos).toBeLessThan(nextTextPos);
	});

	it('GET /feeds/{feedId}/articles?page=999 clamps to last page', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'Article One', published: '2026-01-01' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles?page=999');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Page 1 of 1');
		expect(body).toContain('Article One');
	});

	it('GET /feeds/{feedId}/articles pagination links preserve filter params', async () => {
		// Seed 21 articles all in range
		const articles = Array.from({ length: 21 }, (_, i) => ({
			id: `a${i + 1}`,
			feed_id: 'feed-1',
			title: `Article ${i + 1}`,
			published: `2026-02-${String(i + 1).padStart(2, '0')}`,
		}));
		await seedArticles(articles);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles?from=2026-01-01&to=2026-12-31');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('page=2');
		expect(body).toContain('from=2026-01-01');
		expect(body).toContain('to=2026-12-31');
	});

	it('GET /feeds/{feedId}/articles HTML-escapes title and link', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: '<script>alert("xss")</script>', link: 'https://example.com', published: '2026-01-01' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).not.toContain('<script>alert("xss")</script>');
		expect(body).toContain('&lt;script&gt;');
	});

	it('GET /feeds/{feedId}/articles article without link shows title as plain text', async () => {
		await seedArticles([
			{ id: 'a1', feed_id: 'feed-1', title: 'No Link Article', link: null, published: '2026-01-01' },
		]);

		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('<span class="article-title">No Link Article</span>');
		// Should not have an anchor wrapping the title
		expect(body).not.toMatch(/href="[^"]*"[^>]*>No Link Article/);
	});
});

describe('Session refresh throttle', () => {
	it('fresh session does not set Set-Cookie header', async () => {
		const sessionId = await createSession(env.SESSIONS, 'allowed@example.com', 86400);
		const request = new Request('http://example.com/', {
			headers: { Cookie: `feed_reader_session=${sessionId}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	it('stale session (createdAt=0) does set Set-Cookie header', async () => {
		const sessionId = crypto.randomUUID();
		await env.SESSIONS.put(
			`session:${sessionId}`,
			JSON.stringify({ email: 'allowed@example.com', createdAt: 0 }),
			{ expirationTtl: 86400 }
		);
		const request = new Request('http://example.com/', {
			headers: { Cookie: `feed_reader_session=${sessionId}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toContain('feed_reader_session=');
	});
});

describe('Logout', () => {
	it('GET /logout with a valid session cookie redirects to /logged-out and clears cookie', async () => {
		const sessionId = await createSession(env.SESSIONS, 'allowed@example.com', 86400);
		const request = new Request('http://example.com/logout', {
			headers: { Cookie: `feed_reader_session=${sessionId}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/logged-out');
		const setCookie = response.headers.get('set-cookie');
		expect(setCookie).toContain('feed_reader_session=');
		expect(setCookie).toContain('Max-Age=0');
	});
});

describe('Logged-out page', () => {
	it('GET /logged-out returns 200 and contains "logged out" (case-insensitive)', async () => {
		const response = await SELF.fetch('http://example.com/logged-out');
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body.toLowerCase()).toContain('logged out');
	});
});

describe('OAuth callback', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('GET /auth/callback without code or state returns 400', async () => {
		const response = await SELF.fetch('http://example.com/auth/callback');
		expect(response.status).toBe(400);
	});

	it('GET /auth/callback with invalid state returns 403', async () => {
		const response = await SELF.fetch(
			'http://example.com/auth/callback?code=someCode&state=invalid-state'
		);
		expect(response.status).toBe(403);
	});

	it('GET /auth/callback with valid state and allowed email creates session and redirects', async () => {
		const state = await createState(env.SESSIONS, '/');

		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url).includes('access_token')) {
				return new Response(JSON.stringify({ access_token: 'test-token' }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}
			if (String(url).includes('user/emails')) {
				return new Response(
					JSON.stringify([{ email: 'allowed@example.com', verified: true, primary: true }]),
					{ headers: { 'Content-Type': 'application/json' } }
				);
			}
			return new Response('Not Found', { status: 404 });
		});

		const request = new Request(
			`http://example.com/auth/callback?code=test-code&state=${state}`
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/');
		expect(response.headers.get('set-cookie')).toContain('feed_reader_session=');
	});

	it('GET /auth/callback with valid state but disallowed email returns 403', async () => {
		const state = await createState(env.SESSIONS, '/');

		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url).includes('access_token')) {
				return new Response(JSON.stringify({ access_token: 'test-token' }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}
			if (String(url).includes('user/emails')) {
				return new Response(
					JSON.stringify([{ email: 'notallowed@example.com', verified: true, primary: true }]),
					{ headers: { 'Content-Type': 'application/json' } }
				);
			}
			return new Response('Not Found', { status: 404 });
		});

		const request = new Request(
			`http://example.com/auth/callback?code=test-code&state=${state}`
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(403);
		const body = await response.text();
		expect(body).toContain('Access Denied');
	});

	it('GET /auth/callback rejects open redirect in nextUrl', async () => {
		const state = await createState(env.SESSIONS, 'http://evil.com/steal');

		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url).includes('access_token')) {
				return new Response(JSON.stringify({ access_token: 'test-token' }), {
					headers: { 'Content-Type': 'application/json' },
				});
			}
			if (String(url).includes('user/emails')) {
				return new Response(
					JSON.stringify([{ email: 'allowed@example.com', verified: true, primary: true }]),
					{ headers: { 'Content-Type': 'application/json' } }
				);
			}
			return new Response('Not Found', { status: 404 });
		});

		const request = new Request(
			`http://example.com/auth/callback?code=test-code&state=${state}`
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/');
	});
});
