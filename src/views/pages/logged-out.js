import { html } from 'hono/html';

/**
 * Renders the logged-out page content.
 *
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function loggedOutPage() {
	return html`<main>
  <h1>You have been logged out.</h1>
  <p><a href="/login">Log back in</a> or <a href="/">go to the home page</a>.</p>
</main>`;
}
