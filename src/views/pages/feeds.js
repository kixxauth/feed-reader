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
 *   titleSearch: string,
 *   domainSearch: string,
 *   bannerHtml: import('hono/html').HtmlEscapedString,
 * }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function feedsPage({ feeds, total, page, totalPages, disabled, titleSearch, domainSearch, bannerHtml }) {
	const banner = bannerHtml ?? html``;

	// Build a base query string carrying all active filters (search + disabled), no page.
	function buildParams({ overrideDisabled, page: pageNum } = {}) {
		const params = new URLSearchParams();
		const isDisabled = overrideDisabled !== undefined ? overrideDisabled : disabled;
		if (isDisabled) params.set('disabled', '1');
		if (titleSearch) params.set('title', titleSearch);
		if (domainSearch) params.set('domain', domainSearch);
		if (pageNum && pageNum > 1) params.set('page', String(pageNum));
		const qs = params.toString();
		return qs ? `?${qs}` : '';
	}

	const disabledParam = buildParams();

	const filterLink = disabled
		? html`<a class="toolbar__filter-link" href="${'/feeds' + buildParams({ overrideDisabled: false })}">All feeds</a>
        <span class="toolbar__separator"></span>
        <span class="toolbar__filter-link toolbar__filter-link--active">Disabled only</span>`
		: html`<span class="toolbar__filter-link toolbar__filter-link--active">All feeds</span>
        <span class="toolbar__separator"></span>
        <a class="toolbar__filter-link" href="${'/feeds' + buildParams({ overrideDisabled: true })}">Disabled only</a>`;

	function buildClearSearchHref() {
		const params = new URLSearchParams();
		if (disabled) params.set('disabled', '1');
		const qs = params.toString();
		return '/feeds' + (qs ? `?${qs}` : '');
	}

	const searchForm = html`<form class="toolbar__search" method="GET" action="/feeds">
    ${disabled ? html`<input type="hidden" name="disabled" value="1">` : html``}
    <input class="toolbar__search-input" type="search" name="title" placeholder="Search by title" value="${titleSearch}">
    <input class="toolbar__search-input" type="search" name="domain" placeholder="Search by domain" value="${domainSearch}">
    <button class="btn btn--ghost btn--sm" type="submit">Search</button>
    ${titleSearch || domainSearch ? html`<a class="btn btn--ghost btn--sm" href="${buildClearSearchHref()}">Clear</a>` : html``}
</form>`;

	if (total === 0) {
		let emptyMessage;
		if (titleSearch || domainSearch) {
			emptyMessage = 'No feeds match your search.';
		} else if (disabled) {
			emptyMessage = 'No disabled feeds match the current filter.';
		} else {
			emptyMessage = 'No feeds yet. Add your first feed to get started.';
		}

		return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow">Subscriptions</span>
        <h1 class="page-header__title">Feeds</h1>
        <div class="page-header__actions">
            <a class="btn btn--primary" href="/feeds/add">+ Add Feed</a>
        </div>
    </div>
    ${banner}
    <div class="toolbar">${filterLink}${searchForm}</div>
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

		const listParams = new URLSearchParams();
		if (page > 1) listParams.set('listPage', String(page));
		if (disabled) listParams.set('disabled', '1');
		if (titleSearch) listParams.set('title', titleSearch);
		if (domainSearch) listParams.set('domain', domainSearch);
		const listQs = listParams.toString();
		const detailHref = `/feeds/${feed.id}` + (listQs ? `?${listQs}` : '');

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

	const prevLink =
		page === 1
			? html`<a class="btn btn--ghost btn--sm" aria-disabled="true">← Prev</a>`
			: html`<a class="btn btn--ghost btn--sm" href="${'/feeds' + buildParams({ page: page - 1 })}">← Prev</a>`;

	const nextLink =
		page === totalPages
			? html`<a class="btn btn--ghost btn--sm" aria-disabled="true">Next →</a>`
			: html`<a class="btn btn--ghost btn--sm" href="${'/feeds' + buildParams({ page: page + 1 })}">Next →</a>`;

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
    <div class="toolbar">${filterLink}${searchForm}</div>
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
