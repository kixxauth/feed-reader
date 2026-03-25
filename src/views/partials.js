import { html } from 'hono/html';

/**
 * Renders a generic "Not Found" page content block.
 *
 * @param {string} [message='Page not found.'] - The message to display below the heading.
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function notFoundPage(message = 'Page not found.') {
	return html`<main><h1>Not Found</h1><p>${message}</p></main>`;
}

/**
 * Renders a notice banner.
 *
 * NOTE: This function is not currently called by any view. It exists as a shared
 * primitive for future use. If it remains unused, consider removing it.
 *
 * @param {'error'|'success'|'warning'|'info'} type - The notice type (controls CSS class).
 * @param {import('hono/html').HtmlEscapedString} contentHtml - Pre-built HtmlEscapedString
 *   from an `html` tagged template call. Do NOT pass a raw string — use the `html` tag.
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function noticeBanner(type, contentHtml) {
	return html`<div class="notice notice-${type}">${contentHtml}</div>`;
}
