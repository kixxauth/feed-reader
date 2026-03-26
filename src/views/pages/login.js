import { html } from 'hono/html';

/**
 * Renders the login page content.
 *
 * @param {string} authStartUrl - The URL to start the OAuth flow (e.g. /auth/start?next=...).
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function loginPage(authStartUrl) {
	return html`<div class="login-wrap">
    <main class="login-card">
        <div class="login-card__masthead">Feed Reader</div>
        <h1 class="login-card__title">Sign in</h1>
        <p class="login-card__subtitle">Authentication is required to access your feeds.</p>
        <div class="login-card__actions">
            <a class="btn btn--primary" href="${authStartUrl}">Continue with GitHub</a>
        </div>
    </main>
</div>`;
}
