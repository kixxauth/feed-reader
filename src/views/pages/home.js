import { html } from 'hono/html';

/**
 * Renders the home page content.
 *
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function homePage() {
	return html`<main>
  <h1>Feed Reader</h1>
  <a href="/feeds">Feeds</a>
</main>`;
}
