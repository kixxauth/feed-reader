import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import worker from '../src';
import { createSession } from '../src/auth/session.js';
import { createState, consumeState } from '../src/auth/state.js';
import { performCrawl, performFeedCrawl } from '../src/crawl.js';
import { discoverFeedTargets, previewDirectFeedUrl, ADD_FEED_MESSAGES } from '../src/feed-discovery.js';
import { parseFeedPreview } from '../src/parser.js';

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
			`INSERT INTO feeds (id, hostname, type, title, xml_url, html_url, no_crawl, description, last_build_date, score, consecutive_failure_count)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
				feed.score ?? null,
				feed.consecutive_failure_count ?? 0
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

// ---------------------------------------------------------------------------
// Helper: clear the crawl_runs table between tests
// ---------------------------------------------------------------------------
async function clearCrawlRuns() {
	await env.DB.prepare('DELETE FROM crawl_runs').run();
}

// ---------------------------------------------------------------------------
// Helper: clear the crawl_run_details table between tests
// ---------------------------------------------------------------------------
async function clearCrawlRunDetails() {
	await env.DB.prepare('DELETE FROM crawl_run_details').run();
}

// ---------------------------------------------------------------------------
// Helper: seed the DB with sample crawl_runs rows for testing
// ---------------------------------------------------------------------------
async function seedCrawlRuns(runs) {
	for (const run of runs) {
		await env.DB.prepare(
			`INSERT INTO crawl_runs (id, started_at, completed_at, total_feeds_attempted, total_feeds_failed, total_articles_added)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
			.bind(
				run.id,
				run.started_at,
				run.completed_at ?? null,
				run.total_feeds_attempted ?? 0,
				run.total_feeds_failed ?? 0,
				run.total_articles_added ?? 0
			)
			.run();
	}
}

// ---------------------------------------------------------------------------
// Helper: seed the DB with sample crawl_run_details rows for testing
// ---------------------------------------------------------------------------
async function seedCrawlRunDetails(details) {
	for (const detail of details) {
		await env.DB.prepare(
			`INSERT INTO crawl_run_details (crawl_run_id, feed_id, status, articles_added, error_message, auto_disabled)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
			.bind(
				detail.crawl_run_id,
				detail.feed_id,
				detail.status,
				detail.articles_added ?? 0,
				detail.error_message ?? null,
				detail.auto_disabled ?? 0
			)
			.run();
	}
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

	it('GET /feeds page shows detail page link for each feed', async () => {
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
		expect(body).toContain('href="/feeds/feed-1"');
		expect(body).toContain('href="/feeds/feed-2"');
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

describe('Feed crawl toggle API', () => {
	beforeEach(async () => {
		await clearFeeds();
	});

	it('POST /api/feeds/:feedId/toggle-crawl without session redirects to login', async () => {
		const response = await SELF.fetch('http://example.com/api/feeds/feed-1/toggle-crawl', {
			method: 'POST',
			redirect: 'manual',
		});
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/login?next=');
	});

	it('POST /api/feeds/:feedId/toggle-crawl disables an enabled feed', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'alpha.example.com', title: 'Alpha Feed', html_url: 'https://alpha.example.com', no_crawl: 0 },
		]);

		const sessionRequest = await makeAuthenticatedRequest('http://example.com/api/feeds/feed-1/toggle-crawl');
		const postRequest = new Request(sessionRequest.url, {
			method: 'POST',
			headers: sessionRequest.headers,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(postRequest, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/feeds');

		// Verify no_crawl is now 1 in the database
		const row = await env.DB.prepare('SELECT no_crawl FROM feeds WHERE id = ?').bind('feed-1').first();
		expect(row.no_crawl).toBe(1);
	});

	it('POST /api/feeds/:feedId/toggle-crawl enables a disabled feed and resets failure count', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'alpha.example.com', title: 'Alpha Feed', html_url: 'https://alpha.example.com', no_crawl: 1 },
		]);
		// Set a non-zero failure count to verify it gets reset on enable
		await env.DB.prepare('UPDATE feeds SET consecutive_failure_count = 3 WHERE id = ?').bind('feed-1').run();

		const sessionRequest = await makeAuthenticatedRequest('http://example.com/api/feeds/feed-1/toggle-crawl');
		const postRequest = new Request(sessionRequest.url, {
			method: 'POST',
			headers: sessionRequest.headers,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(postRequest, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/feeds');

		// Verify no_crawl is now 0 and consecutive_failure_count was reset to 0
		const row = await env.DB.prepare('SELECT no_crawl, consecutive_failure_count FROM feeds WHERE id = ?').bind('feed-1').first();
		expect(row.no_crawl).toBe(0);
		expect(row.consecutive_failure_count).toBe(0);
	});

	it('POST /api/feeds/:feedId/toggle-crawl for nonexistent feed returns 404', async () => {
		const sessionRequest = await makeAuthenticatedRequest('http://example.com/api/feeds/nonexistent/toggle-crawl');
		const postRequest = new Request(sessionRequest.url, {
			method: 'POST',
			headers: sessionRequest.headers,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(postRequest, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
	});
});

describe('Crawl history page', () => {
	beforeEach(async () => {
		await clearCrawlRuns();
		await clearCrawlRunDetails();
		await clearFeeds();
	});

	it('GET /crawl-history without session redirects to login', async () => {
		const response = await SELF.fetch('http://example.com/crawl-history', { redirect: 'manual' });
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/login?next=%2Fcrawl-history');
	});

	it('GET /crawl-history with session shows crawl runs newest-first', async () => {
		await seedCrawlRuns([
			{
				id: 'run-older',
				started_at: '2026-03-20T02:00:00.000Z',
				total_feeds_attempted: 5,
				total_feeds_failed: 1,
				total_articles_added: 10,
			},
			{
				id: 'run-newer',
				started_at: '2026-03-23T02:00:00.000Z',
				total_feeds_attempted: 7,
				total_feeds_failed: 0,
				total_articles_added: 3,
			},
		]);

		const request = await makeAuthenticatedRequest('http://example.com/crawl-history');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();

		// Both runs should appear
		expect(body).toContain('run-newer');
		expect(body).toContain('run-older');

		// Newer run should appear before older run
		expect(body.indexOf('run-newer')).toBeLessThan(body.indexOf('run-older'));
	});

	it('GET /crawl-history with no runs shows empty state', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/crawl-history');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('No crawl history available');
	});

	it('GET /crawl-history/:id shows per-feed details', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'alpha.example.com', title: 'Alpha Feed', html_url: 'https://alpha.example.com' },
		]);
		await seedCrawlRuns([
			{
				id: 'run-detail-test',
				started_at: '2026-03-23T02:00:00.000Z',
				total_feeds_attempted: 2,
				total_feeds_failed: 1,
				total_articles_added: 5,
			},
		]);
		await seedCrawlRunDetails([
			{
				crawl_run_id: 'run-detail-test',
				feed_id: 'feed-1',
				status: 'success',
				articles_added: 5,
				error_message: null,
				auto_disabled: 0,
			},
			{
				crawl_run_id: 'run-detail-test',
				feed_id: 'feed-missing',
				status: 'failed',
				articles_added: 0,
				error_message: 'Could not reach the feed URL (network error or server unavailable)',
				auto_disabled: 0,
			},
		]);

		const request = await makeAuthenticatedRequest('http://example.com/crawl-history/run-detail-test');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();

		// Feed title links to the detail page (not external)
		expect(body).toContain('href="/feeds/feed-1"');
		expect(body).toContain('Alpha Feed');
		expect(body).not.toContain('href="https://alpha.example.com"');
		// Articles added count should appear
		expect(body).toContain('5');
		// Status indicators should appear
		expect(body).toContain('success');
		expect(body).toContain('failed');
		// Error message for failed feed
		expect(body).toContain('Could not reach the feed URL (network error or server unavailable)');
		// Fallback to feed_id for deleted feed (no link — detail page would 404)
		expect(body).toContain('feed-missing');
	});

	it('GET /crawl-history/:id HTML-escapes content', async () => {
		await seedCrawlRuns([
			{
				id: 'run-xss-test',
				started_at: '2026-03-23T02:00:00.000Z',
				total_feeds_attempted: 1,
				total_feeds_failed: 1,
				total_articles_added: 0,
			},
		]);
		await seedCrawlRunDetails([
			{
				crawl_run_id: 'run-xss-test',
				feed_id: 'feed-xss',
				status: 'failed',
				articles_added: 0,
				error_message: '<script>alert("xss")</script>',
				auto_disabled: 0,
			},
		]);

		const request = await makeAuthenticatedRequest('http://example.com/crawl-history/run-xss-test');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).not.toContain('<script>alert("xss")</script>');
		expect(body).toContain('&lt;script&gt;');
	});

	it('GET /crawl-history/:id shows "Show failed only" link when unfiltered', async () => {
		await seedCrawlRuns([{ id: 'run-filter-test', started_at: '2026-03-23T02:00:00.000Z' }]);
		const request = await makeAuthenticatedRequest('http://example.com/crawl-history/run-filter-test');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Show failed only');
		expect(body).toContain('href="/crawl-history/run-filter-test?failed=1"');
	});

	it('GET /crawl-history/:id?failed=1 shows only failed and auto-disabled rows', async () => {
		await seedFeeds([
			{ id: 'feed-ok', hostname: 'ok.example.com', title: 'OK Feed', html_url: 'https://ok.example.com' },
			{ id: 'feed-bad', hostname: 'bad.example.com', title: 'Bad Feed', html_url: 'https://bad.example.com' },
			{ id: 'feed-gone', hostname: 'gone.example.com', title: 'Gone Feed', html_url: 'https://gone.example.com' },
		]);
		await seedCrawlRuns([{ id: 'run-filter-test', started_at: '2026-03-23T02:00:00.000Z' }]);
		await seedCrawlRunDetails([
			{ crawl_run_id: 'run-filter-test', feed_id: 'feed-ok', status: 'success', articles_added: 3 },
			{ crawl_run_id: 'run-filter-test', feed_id: 'feed-bad', status: 'failed', articles_added: 0, error_message: 'timeout' },
			{ crawl_run_id: 'run-filter-test', feed_id: 'feed-gone', status: 'auto_disabled', articles_added: 0 },
		]);
		const request = await makeAuthenticatedRequest('http://example.com/crawl-history/run-filter-test?failed=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Bad Feed');
		expect(body).toContain('Gone Feed');
		expect(body).not.toContain('OK Feed');
	});

	it('GET /crawl-history/:id?failed=1 shows "Show all" link', async () => {
		await seedCrawlRuns([{ id: 'run-filter-test', started_at: '2026-03-23T02:00:00.000Z' }]);
		const request = await makeAuthenticatedRequest('http://example.com/crawl-history/run-filter-test?failed=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Show all');
		expect(body).toContain('href="/crawl-history/run-filter-test"');
	});

	it('GET /crawl-history/:id?failed=1 with no failures shows empty message with show-all link', async () => {
		await seedFeeds([
			{ id: 'feed-ok', hostname: 'ok.example.com', title: 'OK Feed', html_url: 'https://ok.example.com' },
		]);
		await seedCrawlRuns([{ id: 'run-filter-test', started_at: '2026-03-23T02:00:00.000Z' }]);
		await seedCrawlRunDetails([
			{ crawl_run_id: 'run-filter-test', feed_id: 'feed-ok', status: 'success', articles_added: 5 },
		]);
		const request = await makeAuthenticatedRequest('http://example.com/crawl-history/run-filter-test?failed=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('No failed feed attempts');
		expect(body).toContain('Show all');
	});

	it('GET /crawl-history/:badId returns 404', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/crawl-history/nonexistent-run-id');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// Helper: build a minimal valid RSS 2.0 feed XML string for crawl tests
// ---------------------------------------------------------------------------
function makeRssFeed(items = []) {
	const itemsXml = items
		.map(
			({ guid, link, title, pubDate }) => `
    <item>
      ${guid ? `<guid>${guid}</guid>` : ''}
      ${link ? `<link>${link}</link>` : ''}
      ${title ? `<title>${title}</title>` : ''}
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
    </item>`
		)
		.join('');
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    ${itemsXml}
  </channel>
</rss>`;
}

function makeAtomFeed(entries = []) {
	const entriesXml = entries
		.map(
			({ id, link, title, published, updated }) => `
    <entry>
      ${id ? `<id>${id}</id>` : ''}
      ${title ? `<title>${title}</title>` : ''}
      ${link ? `<link rel="alternate" href="${link}" />` : ''}
      ${published ? `<published>${published}</published>` : ''}
      ${updated ? `<updated>${updated}</updated>` : ''}
    </entry>`
		)
		.join('');

	return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Test Feed</title>
  <subtitle>Atom subtitle</subtitle>
  <link rel="alternate" href="https://atom.example.com" />
  <updated>2026-03-24T00:00:00Z</updated>
  ${entriesXml}
</feed>`;
}

function makeWebsiteHtml(feedLinks = []) {
	const linksHtml = feedLinks
		.map(
			({ href, rel = 'alternate', type = 'application/rss+xml' }) =>
				`<link rel="${rel}" type="${type}" href="${href}">`
		)
		.join('');

	return `<!doctype html>
<html lang="en">
  <head>
    <title>Example Site</title>
    ${linksHtml}
  </head>
  <body>
    <h1>Example Site</h1>
  </body>
</html>`;
}

describe('Feed preview parsing', () => {
	it('parseFeedPreview extracts RSS metadata', () => {
		const preview = parseFeedPreview(
			`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>RSS Preview Feed</title>
    <description>Preview description</description>
    <link>https://rss.example.com</link>
    <lastBuildDate>Tue, 24 Mar 2026 12:00:00 GMT</lastBuildDate>
  </channel>
</rss>`
		);

		expect(preview).toEqual({
			type: 'rss',
			title: 'RSS Preview Feed',
			description: 'Preview description',
			htmlUrl: 'https://rss.example.com/',
			lastBuildDate: '2026-03-24T12:00:00.000Z',
		});
	});

	it('parseFeedPreview extracts Atom metadata', () => {
		const preview = parseFeedPreview(makeAtomFeed([{ id: 'entry-1', link: 'https://atom.example.com/1', title: 'Entry 1' }]));
		expect(preview).toEqual({
			type: 'atom',
			title: 'Atom Test Feed',
			description: 'Atom subtitle',
			htmlUrl: 'https://atom.example.com/',
			lastBuildDate: '2026-03-24T00:00:00.000Z',
		});
	});
});

describe('Feed discovery', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('discoverFeedTargets treats a direct RSS URL as a feed candidate', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(makeRssFeed([{ guid: 'entry-1', link: 'https://example.com/1', title: 'Article 1' }]), {
				headers: { 'Content-Type': 'application/rss+xml' },
			})
		);

		const result = await discoverFeedTargets('https://example.com/feed.xml');
		expect(result.kind).toBe('direct');
		expect(result.candidate.xmlUrl).toBe('https://example.com/feed.xml');
		expect(result.candidate.title).toBe('Test Feed');
		expect(result.candidate.htmlUrl).toBe('https://example.com/');
	});

	it('discoverFeedTargets discovers multiple website feeds', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url) === 'https://example.com/') {
				return new Response(
					makeWebsiteHtml([
						{ href: '/feed.xml', type: 'application/rss+xml' },
						{ href: '/atom.xml', type: 'application/atom+xml' },
					]),
					{ headers: { 'Content-Type': 'text/html; charset=utf-8' } }
				);
			}

			if (String(url) === 'https://example.com/feed.xml') {
				return new Response(makeRssFeed(), {
					headers: { 'Content-Type': 'application/rss+xml' },
				});
			}

			if (String(url) === 'https://example.com/atom.xml') {
				return new Response(makeAtomFeed(), {
					headers: { 'Content-Type': 'application/atom+xml' },
				});
			}

			return new Response('Not Found', { status: 404 });
		});

		const result = await discoverFeedTargets('https://example.com');
		expect(result.kind).toBe('multiple');
		expect(result.candidates).toHaveLength(2);
		expect(result.candidates.map((candidate) => candidate.xmlUrl)).toEqual([
			'https://example.com/feed.xml',
			'https://example.com/atom.xml',
		]);
	});

	it('discoverFeedTargets returns none when a website has no discoverable feeds', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url) === 'https://example.com/') {
				return new Response(makeWebsiteHtml(), {
					headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
			}

			return new Response('Not Found', { status: 404 });
		});

		const result = await discoverFeedTargets('https://example.com');
		expect(result).toEqual({
			kind: 'none',
			submittedUrl: 'https://example.com/',
		});
	});

	it('previewDirectFeedUrl maps timeouts to the canonical message', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(
			() =>
				new Promise((_, reject) => {
					setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 0);
				})
		);

		await expect(previewDirectFeedUrl('https://example.com/feed.xml')).rejects.toMatchObject({
			message: ADD_FEED_MESSAGES.timeout,
		});
	});
});

describe('Crawl functionality', () => {
	beforeEach(async () => {
		await clearFeeds();
		await clearArticles();
		await clearCrawlRuns();
		await clearCrawlRunDetails();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('performCrawl fetches enabled feeds and inserts new articles', async () => {
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				xml_url: 'https://example.com/feed.xml',
				html_url: 'https://example.com',
			},
		]);

		const rssXml = makeRssFeed([
			{ guid: 'guid-1', link: 'https://example.com/1', title: 'Article One', pubDate: 'Thu, 23 Mar 2026 12:00:00 GMT' },
			{ guid: 'guid-2', link: 'https://example.com/2', title: 'Article Two', pubDate: 'Wed, 22 Mar 2026 12:00:00 GMT' },
		]);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(rssXml, { headers: { 'Content-Type': 'application/rss+xml' } })
		);

		const summary = await performCrawl(env.DB);

		// Summary reflects the inserted articles
		expect(summary.totalFeeds).toBe(1);
		expect(summary.totalFailed).toBe(0);
		expect(summary.totalArticlesAdded).toBe(2);
		expect(summary.crawlRunId).toBeTruthy();

		// Articles are actually in the DB
		const { results } = await env.DB.prepare('SELECT * FROM articles ORDER BY title').all();
		expect(results).toHaveLength(2);
		expect(results[0].title).toBe('Article One');
		expect(results[1].title).toBe('Article Two');

		// Crawl run is recorded
		const { results: runs } = await env.DB.prepare('SELECT * FROM crawl_runs').all();
		expect(runs).toHaveLength(1);
		expect(runs[0].total_articles_added).toBe(2);
		expect(runs[0].total_feeds_attempted).toBe(1);
		expect(runs[0].total_feeds_failed).toBe(0);
	});

	it('performCrawl skips feeds with no_crawl = 1', async () => {
		await seedFeeds([
			{
				id: 'feed-enabled',
				hostname: 'enabled.example.com',
				title: 'Enabled Feed',
				xml_url: 'https://enabled.example.com/feed.xml',
				html_url: 'https://enabled.example.com',
				no_crawl: 0,
			},
			{
				id: 'feed-disabled',
				hostname: 'disabled.example.com',
				title: 'Disabled Feed',
				xml_url: 'https://disabled.example.com/feed.xml',
				html_url: 'https://disabled.example.com',
				no_crawl: 1,
			},
		]);

		const rssXml = makeRssFeed([
			{ guid: 'guid-1', link: 'https://enabled.example.com/1', title: 'Enabled Article' },
		]);

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(rssXml, { headers: { 'Content-Type': 'application/rss+xml' } })
		);

		await performCrawl(env.DB);

		// Only one fetch call — the disabled feed is skipped entirely
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const calledUrl = String(fetchSpy.mock.calls[0][0]);
		expect(calledUrl).toContain('enabled.example.com');
		expect(calledUrl).not.toContain('disabled.example.com');
	});

	it('performCrawl increments failure count on fetch error', async () => {
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				xml_url: 'https://example.com/feed.xml',
				html_url: 'https://example.com',
				consecutive_failure_count: 0,
			},
		]);

		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

		await performCrawl(env.DB);

		// Failure count incremented to 1, feed still enabled (not auto-disabled)
		const row = await env.DB.prepare('SELECT * FROM feeds WHERE id = ?').bind('feed-1').first();
		expect(row.consecutive_failure_count).toBe(1);
		expect(row.no_crawl).toBe(0);
	});

	it('performCrawl auto-disables feed after 5 consecutive failures', async () => {
		// Feed already has 4 consecutive failures; one more triggers auto-disable
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				xml_url: 'https://example.com/feed.xml',
				html_url: 'https://example.com',
				consecutive_failure_count: 4,
			},
		]);

		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

		await performCrawl(env.DB);

		// After the 5th failure the feed should be auto-disabled.
		// disableFeed() sets no_crawl=1 AND resets consecutive_failure_count=0.
		const row = await env.DB.prepare('SELECT * FROM feeds WHERE id = ?').bind('feed-1').first();
		expect(row.no_crawl).toBe(1);
		expect(row.consecutive_failure_count).toBe(0);

		// crawl_run_details should record auto_disabled=1 and status='auto_disabled'
		const detail = await env.DB.prepare(
			'SELECT * FROM crawl_run_details WHERE feed_id = ?'
		).bind('feed-1').first();
		expect(detail.auto_disabled).toBe(1);
		expect(detail.status).toBe('auto_disabled');
	});

	it('performCrawl resets failure count to 0 on success', async () => {
		// Feed has pre-existing failures; a successful crawl should reset the count
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				xml_url: 'https://example.com/feed.xml',
				html_url: 'https://example.com',
				consecutive_failure_count: 3,
			},
		]);

		const rssXml = makeRssFeed([
			{ guid: 'guid-1', link: 'https://example.com/1', title: 'Fresh Article' },
		]);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(rssXml, { headers: { 'Content-Type': 'application/rss+xml' } })
		);

		await performCrawl(env.DB);

		// Failure count reset to 0 after a successful crawl
		const row = await env.DB.prepare('SELECT * FROM feeds WHERE id = ?').bind('feed-1').first();
		expect(row.consecutive_failure_count).toBe(0);
		expect(row.no_crawl).toBe(0);
	});

	it('performCrawl does not duplicate articles on re-crawl', async () => {
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				xml_url: 'https://example.com/feed.xml',
				html_url: 'https://example.com',
			},
		]);

		const rssXml = makeRssFeed([
			{ guid: 'guid-1', link: 'https://example.com/1', title: 'Repeated Article' },
		]);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(rssXml, { headers: { 'Content-Type': 'application/rss+xml' } })
		);

		// Run crawl twice with identical feed content
		await performCrawl(env.DB);
		await performCrawl(env.DB);

		// Only one article row should exist despite two crawls (ON CONFLICT DO NOTHING)
		const { results } = await env.DB.prepare('SELECT * FROM articles').all();
		expect(results).toHaveLength(1);
	});

	it('performCrawl stores error message on failure', async () => {
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				xml_url: 'https://example.com/feed.xml',
				html_url: 'https://example.com',
			},
		]);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('Not Found', { status: 404 })
		);

		await performCrawl(env.DB);

		// crawl_run_details should record the HTTP error message
		const detail = await env.DB.prepare(
			'SELECT * FROM crawl_run_details WHERE feed_id = ?'
		).bind('feed-1').first();
		expect(detail).toBeTruthy();
		expect(detail.status).toBe('failed');
		expect(detail.error_message).toBe('Could not reach the feed URL (network error or server unavailable)');
	});

	it('performCrawl returns summary with correct counts', async () => {
		await seedFeeds([
			{
				id: 'feed-ok',
				hostname: 'ok.example.com',
				title: 'OK Feed',
				xml_url: 'https://ok.example.com/feed.xml',
				html_url: 'https://ok.example.com',
			},
			{
				id: 'feed-bad',
				hostname: 'bad.example.com',
				title: 'Bad Feed',
				xml_url: 'https://bad.example.com/feed.xml',
				html_url: 'https://bad.example.com',
			},
		]);

		const rssXml = makeRssFeed([
			{ guid: 'guid-a', link: 'https://ok.example.com/a', title: 'Article A' },
			{ guid: 'guid-b', link: 'https://ok.example.com/b', title: 'Article B' },
		]);

		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url).includes('ok.example.com')) {
				return new Response(rssXml, { headers: { 'Content-Type': 'application/rss+xml' } });
			}
			// bad feed returns an HTTP error
			return new Response('Internal Server Error', { status: 500 });
		});

		const summary = await performCrawl(env.DB);

		expect(summary.totalFeeds).toBe(2);
		expect(summary.totalFailed).toBe(1);
		expect(summary.totalArticlesAdded).toBe(2);
		expect(typeof summary.crawlRunId).toBe('string');
		expect(summary.crawlRunId.length).toBeGreaterThan(0);

		// Verify the crawl_runs row matches the returned summary
		const run = await env.DB.prepare(
			'SELECT * FROM crawl_runs WHERE id = ?'
		).bind(summary.crawlRunId).first();
		expect(run).toBeTruthy();
		expect(run.total_feeds_attempted).toBe(2);
		expect(run.total_feeds_failed).toBe(1);
		expect(run.total_articles_added).toBe(2);
	});

	it('performFeedCrawl records a failed single-feed crawl with the invalid-content message', async () => {
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				xml_url: 'https://example.com/feed.xml',
				html_url: 'https://example.com',
			},
		]);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('<html><body>not a feed</body></html>', {
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			})
		);

		const summary = await performFeedCrawl(env.DB, 'feed-1', 'single-run-1');
		expect(summary.crawlRunId).toBe('single-run-1');
		expect(summary.totalFeeds).toBe(1);
		expect(summary.totalFailed).toBe(1);

		const detail = await env.DB
			.prepare('SELECT * FROM crawl_run_details WHERE crawl_run_id = ? AND feed_id = ?')
			.bind('single-run-1', 'feed-1')
			.first();
		expect(detail.error_message).toBe('The feed returned invalid content');
	});
});

// ---------------------------------------------------------------------------
// Feed detail page
// ---------------------------------------------------------------------------
describe('Feed detail page', () => {
	const baseFeed = {
		id: 'feed-1',
		hostname: 'example.com',
		title: 'Example Feed',
		html_url: 'https://example.com',
		xml_url: 'https://example.com/feed.xml',
		description: 'A test feed',
		no_crawl: 0,
		consecutive_failure_count: 2,
		score: 42,
	};

	beforeEach(async () => {
		await clearCrawlRunDetails();
		await clearCrawlRuns();
		await clearFeeds();
		await seedFeeds([baseFeed]);
	});

	it('GET /feeds/feed-1 returns 200 and contains the feed title as <h1>', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('<h1>Example Feed</h1>');
	});

	it('GET /feeds/feed-1 contains the hostname', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('example.com');
	});

	it('GET /feeds/feed-1 contains "View Articles" link to /feeds/feed-1/articles', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('href="/feeds/feed-1/articles"');
		expect(body).toContain('View Articles');
	});

	it('GET /feeds/feed-1 contains "Back to Feeds" link to /feeds', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('href="/feeds"');
		expect(body).toContain('Back to Feeds');
	});

	it('GET /feeds/feed-1 contains the crawl toggle form with action /api/feeds/feed-1/toggle-crawl', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('action="/api/feeds/feed-1/toggle-crawl"');
	});

	it('GET /feeds/feed-1 contains a hidden returnTo input with value /feeds/feed-1', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('name="returnTo"');
		expect(body).toContain('value="/feeds/feed-1"');
	});

	it('GET /feeds/unknown-id returns 404', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/unknown-id');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
	});

	it('GET /feeds/feed-1 with null description does NOT contain "Description:" label', async () => {
		await clearFeeds();
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				html_url: 'https://example.com',
				xml_url: 'https://example.com/feed.xml',
				description: null,
				no_crawl: 0,
			},
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).not.toContain('Description:');
	});

	it('GET /feeds/feed-1 with null html_url does NOT contain "Visit Website"', async () => {
		await clearFeeds();
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				html_url: null,
				xml_url: 'https://example.com/feed.xml',
				description: 'A test feed',
				no_crawl: 0,
			},
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).not.toContain('Visit Website');
	});

	it('XSS: feed with script title renders escaped on the detail page', async () => {
		await clearFeeds();
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: '<script>alert(1)</script>',
				html_url: 'https://example.com',
				xml_url: 'https://example.com/feed.xml',
				no_crawl: 0,
			},
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).not.toContain('<script>alert(1)</script>');
		expect(body).toContain('&lt;script&gt;');
	});

	it('GET /feeds/feed-1 shows crawl run status in recent activity list', async () => {
		await seedCrawlRuns([
			{ id: 'run-1', started_at: '2024-01-15T10:00:00Z', completed_at: '2024-01-15T10:01:00Z' },
		]);
		await seedCrawlRunDetails([
			{
				crawl_run_id: 'run-1',
				feed_id: 'feed-1',
				status: 'success',
				articles_added: 3,
				error_message: null,
				auto_disabled: 0,
			},
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('success');
	});

	it('GET /feeds/feed-1 with no crawl history shows "No crawl activity recorded."', async () => {
		// No crawl runs or details seeded
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('No crawl activity recorded.');
	});
});

// ---------------------------------------------------------------------------
// Feed detail page — list context
// ---------------------------------------------------------------------------
describe('Feed detail page — list context', () => {
	beforeEach(async () => {
		await clearCrawlRunDetails();
		await clearCrawlRuns();
		await clearFeeds();
		await seedFeeds([
			{
				id: 'feed-1',
				hostname: 'example.com',
				title: 'Example Feed',
				html_url: 'https://example.com',
				xml_url: 'https://example.com/feed.xml',
				no_crawl: 0,
			},
		]);
	});

	it('GET /feeds/feed-1?listPage=3&disabled=1 — "Back to Feeds" link contains /feeds?page=3&disabled=1', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1?listPage=3&disabled=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('/feeds?page=3&amp;disabled=1');
	});

	it('GET /feeds/feed-1?listPage=3&disabled=1 — "View Articles" link contains listPage=3 and disabled=1', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1?listPage=3&disabled=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('listPage=3');
		expect(body).toContain('disabled=1');
		// View Articles link should have both params
		expect(body).toMatch(/href="\/feeds\/feed-1\/articles\?[^"]*listPage=3[^"]*"/);
	});

	it('GET /feeds/feed-1?listPage=3&disabled=1 — hidden returnTo input contains listPage=3 and disabled=1', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1?listPage=3&disabled=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		// The returnTo value is the self href with context params
		expect(body).toMatch(/value="\/feeds\/feed-1\?[^"]*listPage=3[^"]*"/);
		expect(body).toMatch(/value="\/feeds\/feed-1\?[^"]*disabled=1[^"]*"/);
	});

	it('GET /feeds/feed-1 (no context params) — "Back to Feeds" link is /feeds with no extra params', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('href="/feeds"');
		expect(body).not.toContain('href="/feeds?');
	});
});

// ---------------------------------------------------------------------------
// Feeds list — disabled filter
// ---------------------------------------------------------------------------
describe('Feeds list — disabled filter', () => {
	beforeEach(async () => {
		await clearFeeds();
	});

	it('GET /feeds?disabled=1 shows only the disabled feed, not the enabled feed', async () => {
		await seedFeeds([
			{ id: 'feed-enabled', hostname: 'enabled.example.com', title: 'Enabled Feed', html_url: 'https://enabled.example.com', no_crawl: 0 },
			{ id: 'feed-disabled', hostname: 'disabled.example.com', title: 'Disabled Feed', html_url: 'https://disabled.example.com', no_crawl: 1 },
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds?disabled=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Disabled Feed');
		expect(body).not.toContain('Enabled Feed');
	});

	it('GET /feeds (no filter) shows both enabled and disabled feeds', async () => {
		await seedFeeds([
			{ id: 'feed-enabled', hostname: 'enabled.example.com', title: 'Enabled Feed', html_url: 'https://enabled.example.com', no_crawl: 0 },
			{ id: 'feed-disabled', hostname: 'disabled.example.com', title: 'Disabled Feed', html_url: 'https://disabled.example.com', no_crawl: 1 },
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Enabled Feed');
		expect(body).toContain('Disabled Feed');
	});

	it('GET /feeds?disabled=1 with no disabled feeds shows "No disabled feeds"', async () => {
		await seedFeeds([
			{ id: 'feed-enabled', hostname: 'enabled.example.com', title: 'Enabled Feed', html_url: 'https://enabled.example.com', no_crawl: 0 },
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds?disabled=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('No disabled feeds');
	});

	it('GET /feeds?disabled=1 shows "Clear filter" link', async () => {
		await seedFeeds([
			{ id: 'feed-disabled', hostname: 'disabled.example.com', title: 'Disabled Feed', html_url: 'https://disabled.example.com', no_crawl: 1 },
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds?disabled=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Clear filter');
	});

	it('GET /feeds shows "Show disabled only" link', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'example.com', title: 'Example Feed', html_url: 'https://example.com', no_crawl: 0 },
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Show disabled only');
	});

	it('Feed title on /feeds links to /feeds/:feedId (detail page), not an external URL', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'example.com', title: 'Example Feed', html_url: 'https://example.com', no_crawl: 0 },
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('href="/feeds/feed-1"');
		// The feed title link should be to the detail page
		expect(body).toContain('href="/feeds/feed-1">Example Feed');
	});

	it('/feeds no longer contains href="/feeds/feed-1/articles" link directly', async () => {
		await seedFeeds([
			{ id: 'feed-1', hostname: 'example.com', title: 'Example Feed', html_url: 'https://example.com', no_crawl: 0 },
		]);
		const request = await makeAuthenticatedRequest('http://example.com/feeds');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).not.toContain('href="/feeds/feed-1/articles"');
	});
});

// ---------------------------------------------------------------------------
// Toggle crawl — returnTo redirect
// ---------------------------------------------------------------------------
describe('Toggle crawl — returnTo redirect', () => {
	beforeEach(async () => {
		await clearFeeds();
		await seedFeeds([
			{ id: 'feed-1', hostname: 'example.com', title: 'Example Feed', html_url: 'https://example.com', no_crawl: 0 },
		]);
	});

	async function makeToggleRequest(returnTo) {
		const sessionId = await createSession(env.SESSIONS, 'allowed@example.com', 86400);
		const bodyParams = returnTo !== undefined
			? new URLSearchParams({ returnTo }).toString()
			: '';
		return SELF.fetch('http://example.com/api/feeds/feed-1/toggle-crawl', {
			method: 'POST',
			redirect: 'manual',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Cookie: `feed_reader_session=${sessionId}`,
			},
			body: bodyParams,
		});
	}

	it('POST with no returnTo field redirects to /feeds', async () => {
		const response = await makeToggleRequest(undefined);
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/feeds');
	});

	it('POST with returnTo=/feeds/feed-1 redirects to /feeds/feed-1', async () => {
		const response = await makeToggleRequest('/feeds/feed-1');
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/feeds/feed-1');
	});

	it('POST with returnTo=/feeds?disabled=1 redirects to /feeds?disabled=1', async () => {
		const response = await makeToggleRequest('/feeds?disabled=1');
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/feeds?disabled=1');
	});

	it('POST with returnTo=https://evil.com (external) falls back to /feeds', async () => {
		const response = await makeToggleRequest('https://evil.com');
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/feeds');
	});

	it("POST with returnTo=/other/path (doesn't start with /feeds) falls back to /feeds", async () => {
		const response = await makeToggleRequest('/other/path');
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/feeds');
	});
});

// ---------------------------------------------------------------------------
// Articles page — list context
// ---------------------------------------------------------------------------
describe('Articles page — list context', () => {
	beforeEach(async () => {
		await clearArticles();
		await clearFeeds();
		await seedFeeds([
			{ id: 'feed-1', hostname: 'example.com', title: 'Test Feed', html_url: 'https://example.com' },
		]);
	});

	it('GET /feeds/feed-1/articles?listPage=2&disabled=1 — "Back to Feeds" link contains /feeds?page=2&disabled=1', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles?listPage=2&disabled=1');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		// The href may use & or &amp; depending on how it's rendered
		expect(body).toMatch(/\/feeds\?page=2(&amp;|&)disabled=1/);
	});

	it('GET /feeds/feed-1/articles (no context params) — "Back to Feeds" link is just /feeds', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/feed-1/articles');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('href="/feeds"');
		expect(body).not.toContain('href="/feeds?');
	});
});

// ---------------------------------------------------------------------------
// Add feed flow
// ---------------------------------------------------------------------------
describe('Add feed flow', () => {
	beforeEach(async () => {
		await clearArticles();
		await clearFeeds();
		await clearCrawlRuns();
		await clearCrawlRunDetails();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function makeAuthenticatedFormRequest(url, formData) {
		const sessionId = await createSession(env.SESSIONS, 'allowed@example.com', 86400);
		return new Request(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Cookie: `feed_reader_session=${sessionId}`,
			},
			body: new URLSearchParams(formData).toString(),
		});
	}

	it('GET /feeds/add renders the URL form and Back link', async () => {
		const request = await makeAuthenticatedRequest('http://example.com/feeds/add');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('<h1>Add Feed</h1>');
		expect(body).toContain('name="url"');
		expect(body).toContain('action="/api/feeds/add"');
		expect(body).toContain('href="/feeds"');
	});

	it('POST /api/feeds/add with an invalid URL shows the canonical message', async () => {
		const request = await makeAuthenticatedFormRequest('http://example.com/api/feeds/add', {
			intent: 'submit',
			url: 'ftp://example.com/feed.xml',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain(ADD_FEED_MESSAGES.invalidUrl);
		expect(body).toContain('value="ftp://example.com/feed.xml"');
	});

	it('POST /api/feeds/add with a duplicate feed shows a link to the existing feed', async () => {
		await seedFeeds([
			{
				id: 'existing-feed',
				hostname: 'example.com',
				title: 'Existing Feed',
				xml_url: 'https://example.com/feed.xml',
				html_url: 'https://example.com',
			},
		]);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(makeRssFeed(), { headers: { 'Content-Type': 'application/rss+xml' } })
		);

		const request = await makeAuthenticatedFormRequest('http://example.com/api/feeds/add', {
			intent: 'submit',
			url: '  HTTPS://EXAMPLE.COM/feed.xml  ',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.text();
		expect(body).toContain('This feed is already in your subscriptions.');
		expect(body).toContain('href="/feeds/existing-feed"');
	});

	it('POST /api/feeds/add discovers multiple website feeds and renders the selection step', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url) === 'https://example.com/') {
				return new Response(
					makeWebsiteHtml([
						{ href: '/feed.xml', type: 'application/rss+xml' },
						{ href: '/atom.xml', type: 'application/atom+xml' },
					]),
					{ headers: { 'Content-Type': 'text/html; charset=utf-8' } }
				);
			}

			if (String(url) === 'https://example.com/feed.xml') {
				return new Response(makeRssFeed(), {
					headers: { 'Content-Type': 'application/rss+xml' },
				});
			}

			if (String(url) === 'https://example.com/atom.xml') {
				return new Response(makeAtomFeed(), {
					headers: { 'Content-Type': 'application/atom+xml' },
				});
			}

			return new Response('Not Found', { status: 404 });
		});

		const request = await makeAuthenticatedFormRequest('http://example.com/api/feeds/add', {
			intent: 'submit',
			url: 'https://example.com',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.text();
		expect(body).toContain('Select a Feed');
		expect(body).toContain('https://example.com/feed.xml');
		expect(body).toContain('https://example.com/atom.xml');
	});

	it('POST /api/feeds/add shows the fallback direct-feed input when no feeds are found', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url) === 'https://example.com/') {
				return new Response(makeWebsiteHtml(), {
					headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
			}

			return new Response('Not Found', { status: 404 });
		});

		const request = await makeAuthenticatedFormRequest('http://example.com/api/feeds/add', {
			intent: 'submit',
			url: 'https://example.com',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.text();
		expect(body).toContain(ADD_FEED_MESSAGES.noFeedsFound);
		expect(body).toContain('name="fallbackUrl"');
	});

	it('confirming a direct feed creates the feed and redirects with add-feed banners', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(
			async () =>
				new Response(makeRssFeed([{ guid: 'guid-1', link: 'https://example.com/1', title: 'Article One' }]), {
					headers: { 'Content-Type': 'application/rss+xml' },
				})
		);

		const previewRequest = await makeAuthenticatedFormRequest('http://example.com/api/feeds/add', {
			intent: 'submit',
			url: 'https://example.com/feed.xml',
		});
		const previewCtx = createExecutionContext();
		const previewResponse = await worker.fetch(previewRequest, env, previewCtx);
		await waitOnExecutionContext(previewCtx);
		const previewBody = await previewResponse.text();
		const previewState = previewBody.match(/name="previewState" value="([^"]+)"/)?.[1];
		expect(previewState).toBeTruthy();

		const confirmRequest = await makeAuthenticatedFormRequest('http://example.com/api/feeds/add', {
			intent: 'confirm',
			previewState,
		});
		const confirmCtx = createExecutionContext();
		const confirmResponse = await worker.fetch(confirmRequest, env, confirmCtx);
		await waitOnExecutionContext(confirmCtx);
		expect(confirmResponse.status).toBe(303);
		expect(confirmResponse.headers.get('location')).toMatch(/^\/feeds\?addedFeedId=.*crawlRunId=/);

		const { results: feeds } = await env.DB.prepare('SELECT * FROM feeds').all();
		expect(feeds).toHaveLength(1);
		expect(feeds[0].xml_url).toBe('https://example.com/feed.xml');

		const feedsPageRequest = await makeAuthenticatedRequest(`http://example.com${confirmResponse.headers.get('location')}`);
		const feedsPageCtx = createExecutionContext();
		const feedsPageResponse = await worker.fetch(feedsPageRequest, env, feedsPageCtx);
		await waitOnExecutionContext(feedsPageCtx);
		const feedsPageBody = await feedsPageResponse.text();
		expect(feedsPageBody).toContain('Feed added successfully.');
		expect(feedsPageBody).toContain('Initial crawl completed');
		expect(feedsPageBody).toContain('Add Feed');
	});

	it('confirming a direct feed with a failed immediate crawl shows the warning banner on /feeds', async () => {
		let fetchCount = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			fetchCount += 1;
			if (fetchCount === 1) {
				return new Response(makeRssFeed([{ guid: 'guid-1', link: 'https://example.com/1', title: 'Article One' }]), {
					headers: { 'Content-Type': 'application/rss+xml' },
				});
			}

			return new Response('<html><body>not a feed</body></html>', {
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			});
		});

		const previewRequest = await makeAuthenticatedFormRequest('http://example.com/api/feeds/add', {
			intent: 'submit',
			url: 'https://example.com/feed.xml',
		});
		const previewCtx = createExecutionContext();
		const previewResponse = await worker.fetch(previewRequest, env, previewCtx);
		await waitOnExecutionContext(previewCtx);
		const previewBody = await previewResponse.text();
		const previewState = previewBody.match(/name="previewState" value="([^"]+)"/)?.[1];
		expect(previewState).toBeTruthy();

		const confirmRequest = await makeAuthenticatedFormRequest('http://example.com/api/feeds/add', {
			intent: 'confirm',
			previewState,
		});
		const confirmCtx = createExecutionContext();
		const confirmResponse = await worker.fetch(confirmRequest, env, confirmCtx);
		await waitOnExecutionContext(confirmCtx);

		const feedsPageRequest = await makeAuthenticatedRequest(`http://example.com${confirmResponse.headers.get('location')}`);
		const feedsPageCtx = createExecutionContext();
		const feedsPageResponse = await worker.fetch(feedsPageRequest, env, feedsPageCtx);
		await waitOnExecutionContext(feedsPageCtx);
		const feedsPageBody = await feedsPageResponse.text();
		expect(feedsPageBody).toContain('Feed added, but could not fetch articles yet.');
		expect(feedsPageBody).toContain('The feed returned invalid content');
	});
});
