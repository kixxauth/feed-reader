import { html, raw } from 'hono/html';

/**
 * Formats a date value for display.
 *
 * @param {string} value
 * @returns {string}
 */
function formatDate(value) {
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});
}

/**
 * Renders the feed detail page content.
 *
 * @param {{
 *   feed: object,
 *   recentActivity: Array<object>,
 *   feedId: string,
 *   listHref: string,
 *   selfHref: string,
 *   contextParams: string,
 * }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function feedDetailPage({ feed, recentActivity, feedId, listHref, selfHref, contextParams }) {
	// Crawl badge and toggle label
	const noCrawl = feed.no_crawl;
	const crawlBadge = noCrawl
		? html`<span class="crawl-status-badge crawl-status-disabled">Disabled</span>`
		: html`<span class="crawl-status-badge crawl-status-enabled">Crawling</span>`;
	const toggleLabel = noCrawl ? 'Enable' : 'Disable';

	// Featured badge and toggle label
	const isFeatured = feed.featured === 1;
	const featuredBadge = isFeatured
		? html`<span class="featured-badge">Featured</span>`
		: html``;
	const featuredToggleLabel = isFeatured ? 'Unfeature' : 'Feature';

	// Feed meta rows (conditional)
	const htmlUrlRow = feed.html_url
		? html`
    <div class="feed-meta-row"><span class="feed-meta-label">Website:</span> <a href="${feed.html_url}" target="_blank" rel="noopener noreferrer">${feed.html_url}</a></div>`
		: html``;
	const xmlUrlRow = feed.xml_url
		? html`
    <div class="feed-meta-row"><span class="feed-meta-label">Feed URL:</span> <a href="${feed.xml_url}" target="_blank" rel="noopener noreferrer">${feed.xml_url}</a></div>`
		: html``;
	const descriptionRow = feed.description
		? html`
    <div class="feed-meta-row"><span class="feed-meta-label">Description:</span> <span>${feed.description}</span></div>`
		: html``;

	// Admin meta values
	const lastBuildDate = feed.last_build_date ? formatDate(feed.last_build_date) : 'Unknown';
	const score = feed.score != null ? String(feed.score) : 'None';
	const createdAt = formatDate(feed.created_at);
	const updatedAt = formatDate(feed.updated_at);

	// Recent activity list
	let activityContent;
	if (!recentActivity || recentActivity.length === 0) {
		activityContent = html`<p>No crawl activity recorded.</p>`;
	} else {
		const items = recentActivity.map((item) => {
			const statusClass = `status-${item.status}`;
			const startedAt = formatDate(item.started_at);
			const errorContent = item.error_message
				? html`
      <span>${item.error_message}</span>`
				: html``;
			return html`<li class="recent-activity-item">
      <span class="${statusClass}">${item.status}</span>
      <span>${startedAt}</span>
      <span>${item.articles_added} added</span>${errorContent}
    </li>`;
		});

		activityContent = html`<ul class="recent-activity-list">
    ${raw(items.join('\n'))}
  </ul>`;
	}

	// "Visit Website" action link (conditional)
	const visitWebsiteLink = feed.html_url
		? html`
    <a href="${feed.html_url}" target="_blank" rel="noopener noreferrer">Visit Website</a>`
		: html``;

	// Title with optional featured badge
	const titleContent = isFeatured
		? html`${feed.title} ${featuredBadge}`
		: html`${feed.title}`;

	return html`<main class="feed-detail">
  <h1>${titleContent}</h1>

  <section class="feed-meta">
    <div class="feed-meta-row"><span class="feed-meta-label">Hostname:</span> <span>${feed.hostname}</span></div>${htmlUrlRow}${xmlUrlRow}${descriptionRow}
  </section>

  <section class="feed-admin-meta">
    <div class="feed-meta-row"><span class="feed-meta-label">Crawl status:</span> ${crawlBadge}</div>
    <div class="feed-meta-row"><span class="feed-meta-label">Consecutive failures:</span> <span>${feed.consecutive_failure_count}</span></div>
    <div class="feed-meta-row"><span class="feed-meta-label">Last build date:</span> <span>${lastBuildDate}</span></div>
    <div class="feed-meta-row"><span class="feed-meta-label">Score:</span> <span>${score}</span></div>
    <div class="feed-meta-row"><span class="feed-meta-label">Created:</span> <span>${createdAt}</span></div>
    <div class="feed-meta-row"><span class="feed-meta-label">Updated:</span> <span>${updatedAt}</span></div>
  </section>

  <h2>Recent Activity</h2>
  ${activityContent}

  <div class="feed-actions">
    <a href="/feeds/${feedId}/articles${contextParams}">View Articles</a>${visitWebsiteLink}
    <a href="${listHref}">Back to Feeds</a>
    <form method="POST" action="/api/feeds/${feedId}/toggle-crawl" class="toggle-crawl-form">
      <input type="hidden" name="returnTo" value="${selfHref}">
      <button type="submit">${toggleLabel}</button>
    </form>
    <form method="POST" action="/api/feeds/${feedId}/toggle-featured" class="toggle-featured-form">
      <input type="hidden" name="returnTo" value="${selfHref}">
      <button type="submit">${featuredToggleLabel}</button>
    </form>
  </div>
</main>`;
}
