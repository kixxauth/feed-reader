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
		? html`<span>Disabled</span>`
		: html`<span>Crawling</span>`;
	const toggleLabel = noCrawl ? 'Enable' : 'Disable';

	// Featured badge and toggle label
	const isFeatured = feed.featured === 1;
	const featuredBadge = isFeatured
		? html`<span>Featured</span>`
		: html``;
	const featuredToggleLabel = isFeatured ? 'Unfeature' : 'Feature';

	// Feed meta rows (conditional)
	const htmlUrlRow = feed.html_url
		? html`
    <div><span>Website:</span> <a href="${feed.html_url}" target="_blank" rel="noopener noreferrer">${feed.html_url}</a></div>`
		: html``;
	const xmlUrlRow = feed.xml_url
		? html`
    <div><span>Feed URL:</span> <a href="${feed.xml_url}" target="_blank" rel="noopener noreferrer">${feed.xml_url}</a></div>`
		: html``;
	const descriptionRow = feed.description
		? html`
    <div><span>Description:</span> <span>${feed.description}</span></div>`
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
			const startedAt = formatDate(item.started_at);
			const errorContent = item.error_message
				? html`
      <span>${item.error_message}</span>`
				: html``;
			return html`<li>
      <span>${item.status}</span>
      <span>${startedAt}</span>
      <span>${item.articles_added} added</span>${errorContent}
    </li>`;
		});

		activityContent = html`<ul>
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

	return html`<main>
  <h1>${titleContent}</h1>

  <section>
    <div><span>Hostname:</span> <span>${feed.hostname}</span></div>${htmlUrlRow}${xmlUrlRow}${descriptionRow}
  </section>

  <section>
    <div><span>Crawl status:</span> ${crawlBadge}</div>
    <div><span>Consecutive failures:</span> <span>${feed.consecutive_failure_count}</span></div>
    <div><span>Last build date:</span> <span>${lastBuildDate}</span></div>
    <div><span>Score:</span> <span>${score}</span></div>
    <div><span>Created:</span> <span>${createdAt}</span></div>
    <div><span>Updated:</span> <span>${updatedAt}</span></div>
  </section>

  <h2>Recent Activity</h2>
  ${activityContent}

  <div>
    <a href="/feeds/${feedId}/articles${contextParams}">View Articles</a>${visitWebsiteLink}
    <a href="${listHref}">Back to Feeds</a>
    <form method="POST" action="/api/feeds/${feedId}/toggle-crawl">
      <input type="hidden" name="returnTo" value="${selfHref}">
      <button type="submit">${toggleLabel}</button>
    </form>
    <form method="POST" action="/api/feeds/${feedId}/toggle-featured">
      <input type="hidden" name="returnTo" value="${selfHref}">
      <button type="submit">${featuredToggleLabel}</button>
    </form>
  </div>
</main>`;
}
