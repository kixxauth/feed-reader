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
	return html`<form method="GET" class="filter-form">
    <input type="date" name="from" value="${fromDate ?? ''}">
    <input type="date" name="to" value="${toDate ?? ''}">
    <button type="submit">Filter</button>
    <a href="/feeds/${feedId}/articles">Clear</a>
  </form>`;
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
	if (total === 0 && !filtersActive) {
		// Empty state: no articles at all for this feed
		return html`<main>
  <h1>${feed.title}</h1>
  <a href="${backToFeedsHref}">Back to Feeds</a>
  <p>No articles available for this feed</p>
</main>`;
	}

	if (total === 0 && filtersActive) {
		// Empty state: filters active but no matches — show filter form so user can clear
		return html`<main>
  <h1>${feed.title}</h1>
  <a href="${backToFeedsHref}">Back to Feeds</a>
  ${buildFilterForm(feedId, fromDate, toDate)}
  <p>No articles match the current filter</p>
</main>`;
	}

	// Articles found — show filter form, article list, and pagination
	const items = articles.map((article) => {
		const resolvedLink = resolveArticleUrl(article.link, feedBaseUrl);
		const titleContent = resolvedLink
			? html`<a href="${resolvedLink}" target="_blank" rel="noopener noreferrer">${article.title}</a>`
			: html`<span class="article-title">${article.title}</span>`;

		const formattedDate = article.published
			? new Date(article.published).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					timeZone: 'UTC',
				})
			: 'Date unknown';

		return html`<li class="article-item">
    ${titleContent}
    <span class="article-date">${formattedDate}</span>
  </li>`;
	});

	const prevLink = page === 1
		? html`<a aria-disabled="true">Previous</a>`
		: html`<a href="/feeds/${feedId}/articles?${raw(filterQs ? filterQs + '&' : '')}page=${page - 1}">Previous</a>`;

	const nextLink = page === totalPages
		? html`<a aria-disabled="true">Next</a>`
		: html`<a href="/feeds/${feedId}/articles?${raw(filterQs ? filterQs + '&' : '')}page=${page + 1}">Next</a>`;

	return html`<main>
  <h1>${feed.title}</h1>
  <a href="${backToFeedsHref}">Back to Feeds</a>
  ${buildFilterForm(feedId, fromDate, toDate)}
  <ul class="article-list">
${raw(items.join('\n'))}
  </ul>
  <nav class="pagination">
    ${prevLink}
    <span>Page ${page} of ${totalPages}</span>
    ${nextLink}
  </nav>
</main>`;
}
