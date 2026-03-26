import { html } from 'hono/html';

/**
 * Renders a generic "Not Found" page content block.
 *
 * @param {string} [message='Page not found.'] - The message to display below the heading.
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function notFoundPage(message = 'Page not found.') {
	return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow">404</span>
        <h1 class="page-header__title">Not Found</h1>
    </div>
    <div class="empty-state">
        <div class="empty-state__glyph">⊘</div>
        <div class="empty-state__title">Page not found</div>
        <div class="empty-state__message">${message}</div>
    </div>
</main>`;
}

/**
 * Renders a notice banner.
 *
 * @param {'error'|'success'|'warning'|'info'} type - The notice type (controls CSS class).
 * @param {import('hono/html').HtmlEscapedString} contentHtml - Pre-built HtmlEscapedString
 *   from an `html` tagged template call. Do NOT pass a raw string — use the `html` tag.
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function noticeBanner(type, contentHtml) {
	const cssClass = type === 'success' ? 'notice notice--success'
		: type === 'error' ? 'notice notice--error'
		: 'notice notice--info';
	return html`<div class="${cssClass}">${contentHtml}</div>`;
}
