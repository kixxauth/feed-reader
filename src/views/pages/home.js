import { html } from 'hono/html';

/**
 * Renders the home page content.
 *
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function homePage() {
	return html`<main>
    <div class="home-hero">
        <div class="home-hero__kicker">RSS aggregator</div>
        <h1 class="home-hero__title">Feed Reader</h1>
        <p class="home-hero__desc">A personal, chronological reading experience. Curate your sources, read at your own pace.</p>
    </div>
    <nav class="home-grid" aria-label="Quick navigation">
        <a class="home-card" href="/reader">
            <span class="home-card__label">Daily view</span>
            <div class="home-card__title">Reader</div>
            <div class="home-card__desc">Browse articles by date. Featured sources appear at the top.</div>
        </a>
        <a class="home-card" href="/feeds">
            <span class="home-card__label">Manage</span>
            <div class="home-card__title">Feeds</div>
            <div class="home-card__desc">Add, disable, and inspect your subscribed RSS and Atom feeds.</div>
        </a>
        <a class="home-card" href="/crawl-history">
            <span class="home-card__label">System</span>
            <div class="home-card__title">Crawl History</div>
            <div class="home-card__desc">Inspect past crawl runs, article counts, and feed errors.</div>
        </a>
        <a class="home-card" href="/feeds/add">
            <span class="home-card__label">Subscribe</span>
            <div class="home-card__title">Add a Feed</div>
            <div class="home-card__desc">Paste a website URL or direct feed URL to subscribe.</div>
        </a>
    </nav>
</main>`;
}
