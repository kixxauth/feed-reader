import { html } from 'hono/html';

/**
 * Renders the login page content.
 *
 * @param {string} authStartUrl - The URL to start the OAuth flow (e.g. /auth/start?next=...).
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function loginPage(authStartUrl) {
	return html`<main>
  <h1>Login</h1>
  <p><a href="${authStartUrl}">Login with GitHub</a></p>
</main>`;
}
