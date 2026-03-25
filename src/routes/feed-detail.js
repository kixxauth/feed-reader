/**
 * GET /feeds/:feedId — Feed detail page.
 *
 * Displays feed metadata, recent crawl activity, and admin actions for a
 * single feed. Admin actions include toggling crawl status and toggling
 * featured status. Preserves list pagination context (listPage, disabled)
 * in the "Back to Feeds" link and the returnTo values for both toggle forms
 * so the user is returned to the correct list position after toggling.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getFeedById, getRecentActivityForFeed } from '../db.js';
import { escapeHtml } from '../html-utils.js';

export async function handleFeedDetail(c) {
	const feedId = c.req.param('feedId');

	// Look up the feed — return 404 if it doesn't exist
	const feed = await getFeedById(c.env.DB, feedId);
	if (feed === null) {
		return c.html(
			renderLayout({
				title: 'Not Found — Feed Reader',
				content: '<main><h1>Not Found</h1><p>Feed not found.</p></main>',
				isAuthenticated: true,
				currentPath: c.req.path,
			}),
			404
		);
	}

	// Load recent crawl activity (last 5 runs)
	const recentActivity = await getRecentActivityForFeed(c.env.DB, feedId, 5);

	// Parse optional query params that carry list context
	const rawListPage = parseInt(c.req.query('listPage'), 10);
	const listPage = isNaN(rawListPage) || rawListPage < 1 ? 1 : rawListPage;
	const disabled = c.req.query('disabled') === '1';

	// Build "Back to Feeds" href — preserves list pagination context
	let listHref = '/feeds';
	const listParts = [];
	if (listPage > 1) listParts.push(`page=${listPage}`);
	if (disabled) listParts.push('disabled=1');
	if (listParts.length > 0) listHref += `?${listParts.join('&')}`;

	// Build selfHref — current detail page URL used as returnTo for the toggle form
	let selfHref = `/feeds/${feedId}`;
	const selfParts = [];
	if (listPage > 1) selfParts.push(`listPage=${listPage}`);
	if (disabled) selfParts.push('disabled=1');
	if (selfParts.length > 0) selfHref += `?${selfParts.join('&')}`;

	// Build context params for "View Articles" link (same query string as selfHref)
	const contextParams = selfParts.length > 0 ? `?${selfParts.join('&')}` : '';

	// Crawl badge and toggle label
	const noCrawl = feed.no_crawl;
	const crawlBadge = noCrawl
		? `<span class="crawl-status-badge crawl-status-disabled">Disabled</span>`
		: `<span class="crawl-status-badge crawl-status-enabled">Crawling</span>`;
	const toggleLabel = noCrawl ? 'Enable' : 'Disable';

	// Featured badge and toggle label
	const isFeatured = feed.featured === 1;
	const featuredBadge = isFeatured
		? `<span class="featured-badge">Featured</span>`
		: '';
	const featuredToggleLabel = isFeatured ? 'Unfeature' : 'Feature';

	// Format a date value for display
	function formatDate(value) {
		return new Date(value).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC',
		});
	}

	// Feed meta rows (conditional)
	const htmlUrlRow = feed.html_url
		? `\n    <div class="feed-meta-row"><span class="feed-meta-label">Website:</span> <a href="${escapeHtml(feed.html_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(feed.html_url)}</a></div>`
		: '';
	const xmlUrlRow = feed.xml_url
		? `\n    <div class="feed-meta-row"><span class="feed-meta-label">Feed URL:</span> <a href="${escapeHtml(feed.xml_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(feed.xml_url)}</a></div>`
		: '';
	const descriptionRow = feed.description
		? `\n    <div class="feed-meta-row"><span class="feed-meta-label">Description:</span> <span>${escapeHtml(feed.description)}</span></div>`
		: '';

	// Admin meta values
	const lastBuildDate = feed.last_build_date ? formatDate(feed.last_build_date) : 'Unknown';
	const score = feed.score != null ? escapeHtml(feed.score) : 'None';
	const createdAt = formatDate(feed.created_at);
	const updatedAt = formatDate(feed.updated_at);

	// Recent activity list
	let activityHtml;
	if (!recentActivity || recentActivity.length === 0) {
		activityHtml = '<p>No crawl activity recorded.</p>';
	} else {
		const items = recentActivity
			.map((item) => {
				const statusClass = escapeHtml(`status-${item.status}`);
				const statusLabel = escapeHtml(item.status);
				const startedAt = formatDate(item.started_at);
				const articlesAdded = escapeHtml(item.articles_added);
				const errorHtml = item.error_message
					? `\n      <span>${escapeHtml(item.error_message)}</span>`
					: '';
				return `<li class="recent-activity-item">
      <span class="${statusClass}">${statusLabel}</span>
      <span>${startedAt}</span>
      <span>${articlesAdded} added</span>${errorHtml}
    </li>`;
			})
			.join('\n');
		activityHtml = `<ul class="recent-activity-list">
    ${items}
  </ul>`;
	}

	// "Visit Website" action link (conditional)
	const visitWebsiteLink = feed.html_url
		? `\n    <a href="${escapeHtml(feed.html_url)}" target="_blank" rel="noopener noreferrer">Visit Website</a>`
		: '';

	const content = `<main class="feed-detail">
  <h1>${escapeHtml(feed.title)}${featuredBadge ? ` ${featuredBadge}` : ''}</h1>

  <section class="feed-meta">
    <div class="feed-meta-row"><span class="feed-meta-label">Hostname:</span> <span>${escapeHtml(feed.hostname)}</span></div>${htmlUrlRow}${xmlUrlRow}${descriptionRow}
  </section>

  <section class="feed-admin-meta">
    <div class="feed-meta-row"><span class="feed-meta-label">Crawl status:</span> ${crawlBadge}</div>
    <div class="feed-meta-row"><span class="feed-meta-label">Consecutive failures:</span> <span>${escapeHtml(feed.consecutive_failure_count)}</span></div>
    <div class="feed-meta-row"><span class="feed-meta-label">Last build date:</span> <span>${lastBuildDate}</span></div>
    <div class="feed-meta-row"><span class="feed-meta-label">Score:</span> <span>${score}</span></div>
    <div class="feed-meta-row"><span class="feed-meta-label">Created:</span> <span>${createdAt}</span></div>
    <div class="feed-meta-row"><span class="feed-meta-label">Updated:</span> <span>${updatedAt}</span></div>
  </section>

  <h2>Recent Activity</h2>
  ${activityHtml}

  <div class="feed-actions">
    <a href="/feeds/${escapeHtml(feedId)}/articles${escapeHtml(contextParams)}">View Articles</a>${visitWebsiteLink}
    <a href="${escapeHtml(listHref)}">Back to Feeds</a>
    <form method="POST" action="/api/feeds/${escapeHtml(feedId)}/toggle-crawl" class="toggle-crawl-form">
      <input type="hidden" name="returnTo" value="${escapeHtml(selfHref)}">
      <button type="submit">${toggleLabel}</button>
    </form>
    <form method="POST" action="/api/feeds/${escapeHtml(feedId)}/toggle-featured" class="toggle-featured-form">
      <input type="hidden" name="returnTo" value="${escapeHtml(selfHref)}">
      <button type="submit">${featuredToggleLabel}</button>
    </form>
  </div>
</main>`;

	return c.html(
		renderLayout({
			title: `${escapeHtml(feed.title)} — Feed Reader`,
			content,
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}
