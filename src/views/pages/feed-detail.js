import { html, raw } from 'hono/html';

/**
 * Formats a date value for display.
 *
 * @param {string} value
 * @returns {string}
 */
function formatDate(value) {
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});
}

/**
 * Renders the feed detail page content.
 *
 * @param {{
 *   feed: object,
 *   recentActivity: Array<object>,
 *   feedId: string,
 *   listHref: string,
 *   selfHref: string,
 *   contextParams: string,
 * }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function feedDetailPage({ feed, recentActivity, feedId, listHref, selfHref, contextParams }) {
	const noCrawl = feed.no_crawl;
	const isFeatured = feed.featured === 1;

	const crawlBadge = noCrawl
		? html`<span class="badge badge--disabled">Disabled</span>`
		: html`<span class="badge badge--success">Crawling</span>`;

	const featuredBadge = isFeatured
		? html`<span class="badge badge--featured">Featured</span>`
		: html``;

	const toggleCrawlLabel  = noCrawl    ? 'Enable crawl'   : 'Disable crawl';
	const toggleCrawlClass  = noCrawl    ? 'btn btn--ghost'  : 'btn btn--ghost';
	const toggleFeatLabel   = isFeatured ? 'Unfeature'       : 'Mark as featured';

	const htmlUrlRow = feed.html_url ? html`
    <div class="meta-row">
        <span class="meta-row__key">Website</span>
        <span class="meta-row__value"><a href="${feed.html_url}" target="_blank" rel="noopener noreferrer">${feed.html_url}</a></span>
    </div>` : html``;

	const xmlUrlRow = feed.xml_url ? html`
    <div class="meta-row">
        <span class="meta-row__key">Feed URL</span>
        <span class="meta-row__value"><a href="${feed.xml_url}" target="_blank" rel="noopener noreferrer">${feed.xml_url}</a></span>
    </div>` : html``;

	const descriptionRow = feed.description ? html`
    <div class="meta-row">
        <span class="meta-row__key">Description</span>
        <span class="meta-row__value" style="font-family:var(--font-sans);font-size:13px;">${feed.description}</span>
    </div>` : html``;

	const lastBuildDate = feed.last_build_date ? formatDate(feed.last_build_date) : 'Unknown';
	const score         = feed.score != null ? String(feed.score) : '—';
	const createdAt     = formatDate(feed.created_at);
	const updatedAt     = formatDate(feed.updated_at);

	let activityContent;
	if (!recentActivity || recentActivity.length === 0) {
		activityContent = html`<p style="font-family:var(--font-mono);font-size:12px;color:var(--color-accent-muted);padding:16px 0;">No crawl activity recorded.</p>`;
	} else {
		const items = recentActivity.map((item) => {
			const startedAt = formatDate(item.started_at);
			let statusBadge;
			if (item.status === 'success') {
				statusBadge = html`<span class="badge badge--success">Success</span>`;
			} else if (item.status === 'auto_disabled') {
				statusBadge = html`<span class="badge badge--disabled">Auto-disabled</span>`;
			} else {
				statusBadge = html`<span class="badge badge--error">Failed</span>`;
			}
			const errorContent = item.error_message
				? html`<span class="activity-item__error">${item.error_message}</span>`
				: html``;

			return html`<li class="activity-item">
        ${statusBadge}
        <span class="activity-item__date">${startedAt}</span>
        <span class="activity-item__added"><strong>${item.articles_added}</strong> added</span>
        ${errorContent}
    </li>`;
		});

		activityContent = html`<ul class="activity-list">${raw(items.join('\n'))}</ul>`;
	}

	const visitWebsiteLink = feed.html_url
		? html`<a class="btn btn--ghost" href="${feed.html_url}" target="_blank" rel="noopener noreferrer">Visit website ↗</a>`
		: html``;

	const titleSuffix = isFeatured ? html` ${featuredBadge}` : html``;

	return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow"><a class="back-link" href="${listHref}">← Feeds</a></span>
        <h1 class="page-header__title" style="font-family:var(--font-serif);font-weight:400;font-size:22px;">${feed.title}${titleSuffix}</h1>
        <p class="page-header__subtitle">${feed.hostname}</p>
        <div class="page-header__actions">
            <a class="btn btn--primary" href="/feeds/${feedId}/articles${contextParams}">View articles</a>
            ${visitWebsiteLink}
            <form method="POST" action="/api/feeds/${feedId}/toggle-crawl" style="display:inline;">
                <input type="hidden" name="returnTo" value="${selfHref}">
                <button class="${toggleCrawlClass}" type="submit">${toggleCrawlLabel}</button>
            </form>
            <form method="POST" action="/api/feeds/${feedId}/toggle-featured" style="display:inline;">
                <input type="hidden" name="returnTo" value="${selfHref}">
                <button class="btn btn--ghost" type="submit">${toggleFeatLabel}</button>
            </form>
        </div>
    </div>

    <section>
        <span class="section-label">Feed metadata</span>
        <div class="meta-table mt-3">
            <div class="meta-row">
                <span class="meta-row__key">Hostname</span>
                <span class="meta-row__value">${feed.hostname}</span>
            </div>${htmlUrlRow}${xmlUrlRow}${descriptionRow}
        </div>
    </section>

    <section class="mt-4">
        <span class="section-label">Status &amp; admin</span>
        <div class="meta-table mt-3">
            <div class="meta-row">
                <span class="meta-row__key">Crawl</span>
                <span class="meta-row__value">${crawlBadge}</span>
            </div>
            <div class="meta-row">
                <span class="meta-row__key">Failures</span>
                <span class="meta-row__value">${feed.consecutive_failure_count}</span>
            </div>
            <div class="meta-row">
                <span class="meta-row__key">Last build</span>
                <span class="meta-row__value">${lastBuildDate}</span>
            </div>
            <div class="meta-row">
                <span class="meta-row__key">Score</span>
                <span class="meta-row__value">${score}</span>
            </div>
            <div class="meta-row">
                <span class="meta-row__key">Created</span>
                <span class="meta-row__value">${createdAt}</span>
            </div>
            <div class="meta-row">
                <span class="meta-row__key">Updated</span>
                <span class="meta-row__value">${updatedAt}</span>
            </div>
        </div>
    </section>

    <section class="mt-4">
        <span class="section-label">Recent crawl activity</span>
        <div class="mt-3">${activityContent}</div>
    </section>
</main>`;
}
