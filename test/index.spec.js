import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import worker from '../src';
import { createSession } from '../src/auth/session.js';
import { createState } from '../src/auth/state.js';

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
		expect(await response.text()).toContain('Login with GitHub');
	});

	it('GET /login?next=%2Fsome-page returns 200', async () => {
		const response = await SELF.fetch('http://example.com/login?next=%2Fsome-page');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
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
