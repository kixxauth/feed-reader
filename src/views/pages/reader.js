import { html, raw } from 'hono/html';

/**
 * Renders a feed group section for the reader.
 *
 * @param {object} group - Feed group with articles.
 * @param {Function} resolveArticleUrl - Function to resolve article URLs.
 * @returns {import('hono/html').HtmlEscapedString}
 */
function renderFeedGroup(group, resolveArticleUrl) {
	const articleCount = group.articles.length;

	const articleItems = group.articles.map((article) => {
		const effectiveDateStr = article.article_published || article.article_added;
		const formattedDate = effectiveDateStr
			? new Date(effectiveDateStr).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					timeZone: 'UTC',
				})
			: 'Date unknown';

		const resolvedLink = resolveArticleUrl(article.article_link, group.feedBaseUrl);
		const titleContent = resolvedLink
			? html`<a href="${resolvedLink}" target="_blank" rel="noopener noreferrer">${article.article_title ?? '(no title)'}</a>`
			: html`<span>${article.article_title ?? '(no title)'}</span>`;

		return html`<li>
        ${titleContent}
        <span>${formattedDate}</span>
      </li>`;
	});

	return html`<section>
  <h2><a href="/feeds/${group.feedId}">${group.feedTitle}</a> <span>(${articleCount})</span></h2>
  <ul>
${raw(articleItems.join('\n'))}
  </ul>
</section>`;
}

/**
 * Renders the reader page content.
 *
 * @param {{
 *   featuredGroups: Array<object>,
 *   regularGroups: Array<object>,
 *   selectedDate: string,
 *   prevDate: string,
 *   nextDate: string,
 *   displayDate: string,
 *   todayUtc: string,
 * }} params
 * @param {Function} resolveArticleUrl - Function to resolve article URLs.
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function readerPage({
	featuredGroups,
	regularGroups,
	selectedDate,
	prevDate,
	nextDate,
	displayDate,
	todayUtc,
}, resolveArticleUrl) {
	const dateControls = html`<div>
  <a href="/reader?date=${prevDate}">Previous</a>
  <form method="GET" action="/reader">
    <input type="date" name="date" value="${selectedDate}" max="${todayUtc}">
    <button type="submit">Go</button>
  </form>
  <a href="/reader?date=${nextDate}">Next</a>
</div>`;

	const hasAny = featuredGroups.length > 0 || regularGroups.length > 0;

	let bodyContent;
	if (!hasAny) {
		bodyContent = html`<p>No articles found for this date.</p>`;
	} else {
		let featuredContent = html``;
		if (featuredGroups.length > 0) {
			const featuredItems = featuredGroups.map((g) =>
				renderFeedGroup(g, resolveArticleUrl)
			);
			featuredContent = html`<div>
  <h2>Featured</h2>
${raw(featuredItems.join('\n'))}
</div>`;
		}

		const regularItems = regularGroups.map((g) =>
			renderFeedGroup(g, resolveArticleUrl)
		);
		const regularContent = raw(regularItems.join('\n'));

		bodyContent = html`${featuredContent}${regularContent}`;
	}

	return html`<main>
  <h1>${displayDate}</h1>
  ${dateControls}
  ${bodyContent}
</main>`;
}
