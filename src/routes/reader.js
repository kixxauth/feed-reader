/**
 * GET /reader — Daily reader view: all articles across enabled feeds for a selected UTC day.
 *
 * Query params:
 *   ?date=YYYY-MM-DD  — the day to display; defaults to today's UTC date if absent or invalid.
 *
 * The effective date of an article is `published` when present, else `added`.
 * Disabled feeds (no_crawl = 1) are excluded.
 * Articles are grouped by feed and each group is sorted by article count descending,
 * with feed title ascending as a tie-breaker. Within a group, articles are newest-first.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getDailyReaderArticles } from '../db.js';
import { escapeHtml } from '../html-utils.js';
import { resolveArticleUrl } from '../feed-utils.js';
import {
	parseSelectedDate,
	getPreviousDate,
	getNextDate,
	formatDateForDisplay,
	getTodayUtc,
} from '../reader-utils.js';

export async function handleReader(c) {
	const rawDate = c.req.query('date');
	const selectedDate = parseSelectedDate(rawDate);

	const rows = await getDailyReaderArticles(c.env.DB, selectedDate);

	// Group flat rows by feed_id, preserving the SQL feed-title order within each group.
	// The SQL already orders by feeds.title ASC then article date DESC, so article order
	// within each group is correct as rows are appended.
	const groupMap = new Map();
	for (const row of rows) {
		if (!groupMap.has(row.feed_id)) {
			groupMap.set(row.feed_id, {
				feedId: row.feed_id,
				feedTitle: row.feed_title,
				feedBaseUrl: row.feed_html_url || row.feed_xml_url,
				articles: [],
			});
		}
		groupMap.get(row.feed_id).articles.push(row);
	}

	// Sort groups: most articles first, feed title ascending as tie-breaker.
	const groups = Array.from(groupMap.values()).sort((a, b) => {
		const countDiff = b.articles.length - a.articles.length;
		if (countDiff !== 0) return countDiff;
		return a.feedTitle.localeCompare(b.feedTitle);
	});

	const prevDate = getPreviousDate(selectedDate);
	const nextDate = getNextDate(selectedDate);
	const displayDate = formatDateForDisplay(selectedDate);
	const todayUtc = getTodayUtc();

	const dateControls = `<div class="reader-date-controls">
  <a href="/reader?date=${escapeHtml(prevDate)}" class="button-link">Previous</a>
  <form method="GET" action="/reader">
    <input type="date" name="date" value="${escapeHtml(selectedDate)}" max="${escapeHtml(todayUtc)}">
    <button type="submit">Go</button>
  </form>
  <a href="/reader?date=${escapeHtml(nextDate)}" class="button-link">Next</a>
</div>`;

	let bodyContent;

	if (groups.length === 0) {
		bodyContent = `<p class="reader-empty-state">No articles found for this date.</p>`;
	} else {
		const groupsHtml = groups
			.map((group) => {
				const articleCount = group.articles.length;
				const articlesHtml = group.articles
					.map((article) => {
						// Determine effective date for display (published preferred, added fallback)
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
						const titleHtml = resolvedLink
							? `<a href="${escapeHtml(resolvedLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.article_title ?? '(no title)')}</a>`
							: `<span>${escapeHtml(article.article_title ?? '(no title)')}</span>`;

						return `<li class="article-item">
        ${titleHtml}
        <span class="article-date">${formattedDate}</span>
      </li>`;
					})
					.join('\n');

				return `<section class="reader-feed-group">
  <h2 class="reader-feed-group-header"><a href="/feeds/${escapeHtml(group.feedId)}">${escapeHtml(group.feedTitle)}</a> <span class="reader-article-count">(${articleCount})</span></h2>
  <ul class="reader-article-list article-list">
${articlesHtml}
  </ul>
</section>`;
			})
			.join('\n');

		bodyContent = groupsHtml;
	}

	const content = `<main>
  <h1 class="reader-heading">${escapeHtml(displayDate)}</h1>
  ${dateControls}
  ${bodyContent}
</main>`;

	return c.html(
		renderLayout({
			title: `Reader — ${escapeHtml(displayDate)}`,
			content,
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}
