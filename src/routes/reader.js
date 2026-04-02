/**
 * GET /reader — Daily reader view: all articles across enabled feeds for a selected UTC day.
 *
 * Query params:
 *   ?date=YYYY-MM-DD  — the day to display; defaults to today's UTC date if absent or invalid.
 *
 * The effective date of an article is `published` when present, else `added`.
 * Disabled feeds (no_crawl = 1) are excluded.
 *
 * Articles are grouped by feed. Groups from feeds marked as featured (featured = 1)
 * are rendered in a visually distinct "Featured" section at the top. Remaining groups
 * appear below. Within each section, groups are sorted by 30-day post frequency ascending
 * (least-frequent posters first), with feed title ascending as a tie-breaker.
 * Within a group, articles are newest-first.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getDailyReaderArticles } from '../db.js';
import { resolveArticleUrl } from '../feed-utils.js';
import {
	parseSelectedDate,
	getPreviousDate,
	getNextDate,
	formatDateForDisplay,
	getTodayUtc,
} from '../reader-utils.js';
import { readerPage } from '../views/pages/reader.js';

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
				featured: row.feed_featured === 1,
				postCount30d: row.feed_post_count_30d,
				articles: [],
			});
		}
		groupMap.get(row.feed_id).articles.push(row);
	}

	const sortGroups = (a, b) => {
		const freqDiff = a.postCount30d - b.postCount30d;
		if (freqDiff !== 0) return freqDiff;
		return a.feedTitle.localeCompare(b.feedTitle);
	};

	const featuredGroups = [];
	const regularGroups = [];
	for (const group of groupMap.values()) {
		(group.featured ? featuredGroups : regularGroups).push(group);
	}
	featuredGroups.sort(sortGroups);
	regularGroups.sort(sortGroups);

	const prevDate = getPreviousDate(selectedDate);
	const nextDate = getNextDate(selectedDate);
	const displayDate = formatDateForDisplay(selectedDate);
	const todayUtc = getTodayUtc();

	return c.html(
		renderLayout({
			title: `Reader — ${displayDate}`,
			content: readerPage({
				featuredGroups,
				regularGroups,
				selectedDate,
				prevDate,
				nextDate,
				displayDate,
				todayUtc,
			}, resolveArticleUrl),
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}
