import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src';
import { createSession } from '../src/auth/session.js';
import { createState } from '../src/auth/state.js';

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
	it('GET / with a valid session cookie returns 200 with Hello World! and Logout', async () => {
		const sessionId = await createSession(env.SESSIONS, 'allowed@example.com', 86400);
		const request = new Request('http://example.com/', {
			headers: { Cookie: `feed_reader_session=${sessionId}` },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Hello World!');
		expect(body).toContain('Logout');
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
