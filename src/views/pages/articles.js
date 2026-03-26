import { html, raw } from 'hono/html';

/**
 * Builds the date filter form.
 *
 * @param {string} feedId
 * @param {string|null} fromDate
 * @param {string|null} toDate
 * @returns {import('hono/html').HtmlEscapedString}
 */
function buildFilterForm(feedId, fromDate, toDate) {
	return html`<div class="toolbar">
    <form class="form-row" method="GET">
        <label class="form-label" style="margin:0;" for="filter-from">From</label>
        <input class="form-input form-input--date" id="filter-from" type="date" name="from" value="${fromDate ?? ''}">
        <label class="form-label" style="margin:0;" for="filter-to">To</label>
        <input class="form-input form-input--date" id="filter-to" type="date" name="to" value="${toDate ?? ''}">
        <button class="btn btn--primary btn--sm" type="submit">Filter</button>
        <a class="btn btn--ghost btn--sm" href="/feeds/${feedId}/articles">Clear</a>
    </form>
</div>`;
}

/**
 * Renders the articles page content.
 *
 * @param {{
 *   feed: object,
 *   articles: Array<object>,
 *   total: number,
 *   page: number,
 *   totalPages: number,
 *   fromDate: string|null,
 *   toDate: string|null,
 *   filtersActive: boolean,
 *   feedId: string,
 *   feedBaseUrl: string|null,
 *   backToFeedsHref: string,
 *   filterQs: string,
 * }} params
 * @param {Function} resolveArticleUrl - Function to resolve article URLs.
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function articlesPage({
	feed,
	articles,
	total,
	page,
	totalPages,
	fromDate,
	toDate,
	filtersActive,
	feedId,
	feedBaseUrl,
	backToFeedsHref,
	filterQs,
}, resolveArticleUrl) {
	const pageHeader = html`<div class="page-header">
    <span class="page-header__eyebrow"><a class="back-link" href="${backToFeedsHref}">← Feeds</a></span>
    <h1 class="page-header__title" style="font-family:var(--font-serif);font-weight:400;font-size:22px;">${feed.title}</h1>
    <p class="page-header__subtitle">${feed.hostname}</p>
</div>`;

	if (total === 0 && !filtersActive) {
		return html`<main>
    ${pageHeader}
    <div class="empty-state">
        <div class="empty-state__glyph">∅</div>
        <div class="empty-state__title">No articles</div>
        <div class="empty-state__message">No articles have been collected for this feed yet.</div>
    </div>
</main>`;
	}

	if (total === 0 && filtersActive) {
		return html`<main>
    ${pageHeader}
    ${buildFilterForm(feedId, fromDate, toDate)}
    <div class="empty-state">
        <div class="empty-state__glyph">⊘</div>
        <div class="empty-state__title">No matches</div>
        <div class="empty-state__message">No articles match the current date filter.</div>
    </div>
</main>`;
	}

	const items = articles.map((article) => {
		const resolvedLink = resolveArticleUrl(article.link, feedBaseUrl);
		const titleContent = resolvedLink
			? html`<a href="${resolvedLink}" target="_blank" rel="noopener noreferrer">${article.title}</a>`
			: html`<span>${article.title}</span>`;

		const formattedDate = article.published
			? new Date(article.published).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					timeZone: 'UTC',
				})
			: 'Unknown';

		return html`<li class="article-item">
    <span class="article-item__title">${titleContent}</span>
    <span class="article-item__date">${formattedDate}</span>
</li>`;
	});

	const prevLink = page === 1
		? html`<a class="pagination__link" aria-disabled="true">← Prev</a>`
		: html`<a class="pagination__link" href="/feeds/${feedId}/articles?${raw(filterQs ? filterQs + '&' : '')}page=${page - 1}">← Prev</a>`;

	const nextLink = page === totalPages
		? html`<a class="pagination__link" aria-disabled="true">Next →</a>`
		: html`<a class="pagination__link" href="/feeds/${feedId}/articles?${raw(filterQs ? filterQs + '&' : '')}page=${page + 1}">Next →</a>`;

	return html`<main>
    ${pageHeader}
    ${buildFilterForm(feedId, fromDate, toDate)}
    <ul class="article-list mt-2">
        ${raw(items.join('\n'))}
    </ul>
    <nav class="pagination" aria-label="Article list pagination">
        ${prevLink}
        <span class="pagination__info">Page ${page} of ${totalPages} &nbsp;·&nbsp; ${total} articles</span>
        ${nextLink}
    </nav>
</main>`;
}
