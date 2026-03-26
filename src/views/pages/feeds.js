import { html, raw } from 'hono/html';

/**
 * Renders the feeds list page content.
 *
 * @param {{
 *   feeds: Array<object>,
 *   total: number,
 *   page: number,
 *   totalPages: number,
 *   disabled: boolean,
 *   bannerHtml: import('hono/html').HtmlEscapedString,
 * }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function feedsPage({ feeds, total, page, totalPages, disabled, bannerHtml }) {
	const disabledParam = disabled ? '?disabled=1' : '';
	const banner = bannerHtml ?? html``;

	const filterLink = disabled
		? html`<a class="toolbar__filter-link" href="/feeds">All feeds</a>
        <span class="toolbar__separator"></span>
        <span class="toolbar__filter-link toolbar__filter-link--active">Disabled only</span>`
		: html`<span class="toolbar__filter-link toolbar__filter-link--active">All feeds</span>
        <span class="toolbar__separator"></span>
        <a class="toolbar__filter-link" href="/feeds?disabled=1">Disabled only</a>`;

	if (total === 0) {
		const emptyMessage = disabled
			? 'No disabled feeds match the current filter.'
			: 'No feeds yet. Add your first feed to get started.';

		return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow">Subscriptions</span>
        <h1 class="page-header__title">Feeds</h1>
        <div class="page-header__actions">
            <a class="btn btn--primary" href="/feeds/add">+ Add Feed</a>
        </div>
    </div>
    ${banner}
    <div class="toolbar">${filterLink}</div>
    <div class="empty-state">
        <div class="empty-state__glyph">⊘</div>
        <div class="empty-state__title">No feeds found</div>
        <div class="empty-state__message">${emptyMessage}</div>
    </div>
</main>`;
	}

	const items = feeds.map((feed) => {
		const noCrawl = feed.no_crawl;
		const statusBadge = noCrawl
			? html`<span class="badge badge--disabled">Disabled</span>`
			: html`<span class="badge badge--success">Crawling</span>`;
		const toggleLabel = noCrawl ? 'Enable' : 'Disable';
		const toggleClass = noCrawl ? 'btn btn--ghost btn--sm' : 'btn btn--ghost btn--sm';

		let detailHref = `/feeds/${feed.id}`;
		if (page > 1 && disabled) {
			detailHref += `?listPage=${page}&disabled=1`;
		} else if (page > 1) {
			detailHref += `?listPage=${page}`;
		} else if (disabled) {
			detailHref += `?disabled=1`;
		}

		const itemClass = noCrawl ? 'feed-item feed-item--disabled' : 'feed-item';

		return html`<li class="${itemClass}">
    <span class="feed-item__title">
        <a href="${detailHref}">${feed.title}</a>
    </span>
    <span class="feed-item__hostname">${feed.hostname}</span>
    <span class="feed-item__meta">
        ${statusBadge}
    </span>
    <span class="feed-item__actions">
        <form method="POST" action="/api/feeds/${feed.id}/toggle-crawl">
            <input type="hidden" name="returnTo" value="/feeds${raw(disabledParam)}">
            <button class="${toggleClass}" type="submit">${toggleLabel}</button>
        </form>
    </span>
</li>`;
	});

	let prevLink;
	if (page === 1) {
		prevLink = html`<a class="pagination__link" aria-disabled="true">← Prev</a>`;
	} else if (disabled) {
		prevLink = html`<a class="pagination__link" href="/feeds?disabled=1&page=${page - 1}">← Prev</a>`;
	} else {
		prevLink = html`<a class="pagination__link" href="/feeds?page=${page - 1}">← Prev</a>`;
	}

	let nextLink;
	if (page === totalPages) {
		nextLink = html`<a class="pagination__link" aria-disabled="true">Next →</a>`;
	} else if (disabled) {
		nextLink = html`<a class="pagination__link" href="/feeds?disabled=1&page=${page + 1}">Next →</a>`;
	} else {
		nextLink = html`<a class="pagination__link" href="/feeds?page=${page + 1}">Next →</a>`;
	}

	return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow">Subscriptions</span>
        <h1 class="page-header__title">Feeds
            <span style="font-size:13px;font-weight:400;color:var(--color-accent-muted);margin-left:10px;">${total}</span>
        </h1>
        <div class="page-header__actions">
            <a class="btn btn--primary" href="/feeds/add">+ Add Feed</a>
        </div>
    </div>
    ${banner}
    <div class="toolbar">${filterLink}</div>
    <ul class="feed-list">
        ${raw(items.join('\n'))}
    </ul>
    <nav class="pagination" aria-label="Feed list pagination">
        ${prevLink}
        <span class="pagination__info">Page ${page} of ${totalPages}</span>
        ${nextLink}
    </nav>
</main>`;
}

/**
 * Builds the add-feed banner shown after a feed is successfully added.
 *
 * @param {object|null} detail - Crawl run detail record for the new feed, or null.
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function addFeedBanner(detail) {
	if (!detail) {
		return html`<div class="notice notice--info">Feed added. Initial crawl in progress — articles will appear shortly.</div>`;
	}

	if (detail.status === 'failed' || detail.status === 'auto_disabled') {
		const reason = detail.error_message || 'Unknown error';
		return html`<div class="notice notice--error">Feed added, but the initial crawl failed: ${reason}. Articles will be retried at the next scheduled crawl (2am UTC).</div>`;
	}

	return html`<div class="notice notice--success">Feed added successfully. Initial crawl completed.</div>`;
}
