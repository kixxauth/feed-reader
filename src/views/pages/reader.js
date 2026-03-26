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
			: 'Unknown';

		const resolvedLink = resolveArticleUrl(article.article_link, group.feedBaseUrl);
		const titleContent = resolvedLink
			? html`<a href="${resolvedLink}" target="_blank" rel="noopener noreferrer">${article.article_title ?? '(no title)'}</a>`
			: html`<span>${article.article_title ?? '(no title)'}</span>`;

		return html`<li class="article-item">
        <span class="article-item__title">${titleContent}</span>
        <span class="article-item__date">${formattedDate}</span>
    </li>`;
	});

	return html`<div class="feed-group">
    <div class="feed-group__header">
        <h2 class="feed-group__title">
            <a href="/feeds/${group.feedId}">${group.feedTitle}</a>
        </h2>
        <span class="feed-group__count">${articleCount}</span>
    </div>
    <ul class="article-list feed-group__articles">
        ${raw(articleItems.join('\n'))}
    </ul>
</div>`;
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
	const isToday = selectedDate === todayUtc;

	const nextArrowAttrs = isToday ? raw(' aria-disabled="true"') : raw('');

	const dateControls = html`<div class="date-nav">
    <a class="btn btn--ghost" href="/reader?date=${prevDate}">← Prev</a>
    <div class="date-nav__form">
        <form class="form-row" method="GET" action="/reader">
            <input class="form-input form-input--date" type="date" name="date" value="${selectedDate}" max="${todayUtc}">
            <button class="btn btn--ghost" type="submit">Go</button>
        </form>
    </div>
    <a class="btn btn--ghost" href="/reader?date=${nextDate}"${nextArrowAttrs}>Next →</a>
</div>`;

	const hasAny = featuredGroups.length > 0 || regularGroups.length > 0;

	let bodyContent;
	if (!hasAny) {
		bodyContent = html`<div class="empty-state">
    <div class="empty-state__glyph">∅</div>
    <div class="empty-state__title">No articles</div>
    <div class="empty-state__message">No articles were collected for this date.</div>
</div>`;
	} else {
		let featuredContent = html``;
		if (featuredGroups.length > 0) {
			const featuredItems = featuredGroups.map((g) => renderFeedGroup(g, resolveArticleUrl));
			featuredContent = html`<div class="featured-section">
    <span class="featured-label">★ Featured</span>
    <div class="featured-groups">
        ${raw(featuredItems.join('\n'))}
    </div>
</div>`;
		}

		const regularItems = regularGroups.map((g) => renderFeedGroup(g, resolveArticleUrl));
		const regularContent = raw(regularItems.join('\n'));

		bodyContent = html`${featuredContent}${regularContent}`;
	}

	return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow">Daily digest</span>
        <h1 class="page-header__title">${displayDate}</h1>
    </div>
    ${dateControls}
    ${bodyContent}
</main>`;
}
