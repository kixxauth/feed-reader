import { html } from 'hono/html';

/**
 * Renders the logged-out page content.
 *
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function loggedOutPage() {
	return html`<div class="login-wrap">
    <main class="login-card">
        <div class="login-card__masthead">Feed Reader</div>
        <h1 class="login-card__title">Signed out</h1>
        <p class="login-card__subtitle">You have been signed out successfully.</p>
        <div class="login-card__actions">
            <a class="btn btn--primary" href="/login">Sign back in</a>
            <a class="btn btn--ghost" href="/">Go to home page</a>
        </div>
    </main>
</div>`;
}
