import { html, raw } from 'hono/html';

/**
 * Format an ISO 8601 timestamp as a human-readable date+time string.
 *
 * @param {string|null} isoString
 * @returns {string}
 */
function formatDateTime(isoString) {
	if (!isoString) return 'Unknown';
	const d = new Date(isoString);
	if (isNaN(d.getTime())) return String(isoString);
	return d.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	});
}

/**
 * Renders the crawl history list page content.
 *
 * @param {{ runs: Array<object> }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function crawlHistoryPage({ runs }) {
	if (runs.length === 0) {
		return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow"><a class="back-link" href="/feeds">← Feeds</a></span>
        <h1 class="page-header__title">Crawl History</h1>
    </div>
    <div class="empty-state">
        <div class="empty-state__glyph">◷</div>
        <div class="empty-state__title">No history yet</div>
        <div class="empty-state__message">Crawl runs will appear here after the first scheduled crawl.</div>
    </div>
</main>`;
	}

	const items = runs.map((run) => {
		const startedAt = formatDateTime(run.started_at);
		return html`<li class="crawl-run">
    <span class="crawl-run__time">${startedAt}</span>
    <span class="crawl-run__stats">
        <span class="crawl-run__stat"><strong>${run.total_feeds_attempted}</strong> attempted</span>
        <span class="crawl-run__stat"><strong>${run.total_feeds_failed}</strong> failed</span>
        <span class="crawl-run__stat"><strong>${run.total_articles_added}</strong> articles added</span>
    </span>
    <span class="crawl-run__action">
        <a class="btn btn--ghost btn--sm" href="/crawl-history/${run.id}">Details →</a>
    </span>
</li>`;
	});

	return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow"><a class="back-link" href="/feeds">← Feeds</a></span>
        <h1 class="page-header__title">Crawl History</h1>
        <p class="page-header__subtitle">Scheduled crawl runs — daily at 2am UTC.</p>
    </div>
    <ul class="crawl-run-list">
        ${raw(items.join('\n'))}
    </ul>
</main>`;
}

/**
 * Renders the crawl run detail page content.
 *
 * @param {{
 *   run: object,
 *   details: Array<object>,
 *   failedOnly: boolean,
 *   crawlRunId: string,
 * }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function crawlRunDetailPage({ run, details, failedOnly, crawlRunId }) {
	const startedAt = formatDateTime(run.started_at);

	const filterControl = failedOnly
		? html`<div class="toolbar">
        <span class="toolbar__filter-link toolbar__filter-link--active">Failed only</span>
        <span class="toolbar__separator"></span>
        <a class="toolbar__filter-link" href="/crawl-history/${crawlRunId}">Show all</a>
    </div>`
		: html`<div class="toolbar">
        <span class="toolbar__filter-link toolbar__filter-link--active">All feeds</span>
        <span class="toolbar__separator"></span>
        <a class="toolbar__filter-link" href="/crawl-history/${crawlRunId}?failed=1">Failed only</a>
    </div>`;

	let detailContent;
	if (details.length === 0) {
		const emptyMsg = failedOnly
			? html`No failed feed attempts in this run. <a class="ml-2" href="/crawl-history/${crawlRunId}">Show all</a>`
			: html`No feed detail records for this crawl run.`;

		detailContent = html`<div class="empty-state">
    <div class="empty-state__glyph">✓</div>
    <div class="empty-state__title">No records</div>
    <div class="empty-state__message">${emptyMsg}</div>
</div>`;
	} else {
		const rows = details.map((detail) => {
			const feedLabel = detail.feed_title
				? html`<a href="/feeds/${detail.feed_id}">${detail.feed_title}</a>`
				: html`<span>${detail.feed_id}</span>`;

			const xmlLinkHtml = detail.feed_xml_url
				? html`<a class="crawl-detail-item__xml-link" href="${detail.feed_xml_url}" target="_blank" rel="noopener noreferrer">[XML ↗]</a>`
				: html``;

			let statusBadge;
			if (detail.status === 'auto_disabled') {
				statusBadge = html`<span class="badge badge--disabled">Auto-disabled</span>`;
			} else if (detail.status === 'failed') {
				statusBadge = html`<span class="badge badge--error">Failed</span>`;
			} else {
				statusBadge = html`<span class="badge badge--success">Success</span>`;
			}

			const errorContent = detail.error_message
				? html`<div class="crawl-detail-item__error">${detail.error_message}</div>`
				: html``;

			return html`<li class="crawl-detail-item">
        <div style="flex:1;min-width:0;">
            <div class="crawl-detail-item__feed">
                ${feedLabel}${xmlLinkHtml}
            </div>
            ${errorContent}
        </div>
        <span class="crawl-detail-item__added"><strong>${detail.articles_added}</strong> added</span>
        ${statusBadge}
    </li>`;
		});

		detailContent = html`<ul class="crawl-detail-list mt-2">
    ${raw(rows.join('\n'))}
</ul>`;
	}

	return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow"><a class="back-link" href="/crawl-history">← Crawl History</a></span>
        <h1 class="page-header__title">Crawl Run</h1>
        <p class="page-header__subtitle">${startedAt}</p>
    </div>
    <div class="stat-grid mb-4">
        <div class="stat-chip">
            <span class="stat-chip__value">${run.total_feeds_attempted}</span>
            <span class="stat-chip__label">Attempted</span>
        </div>
        <div class="stat-chip">
            <span class="stat-chip__value">${run.total_feeds_failed}</span>
            <span class="stat-chip__label">Failed</span>
        </div>
        <div class="stat-chip">
            <span class="stat-chip__value">${run.total_articles_added}</span>
            <span class="stat-chip__label">Articles added</span>
        </div>
    </div>
    ${filterControl}
    ${detailContent}
</main>`;
}
