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
 *   bannerHtml: import('hono/html').HtmlEscapedString,
 * }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function feedsPage({ feeds, total, page, totalPages, disabled, bannerHtml }) {
	const disabledParam = disabled ? '?disabled=1' : '';
	const addFeedButton = html`<p class="page-actions"><a class="button-link" href="/feeds/add">Add Feed</a></p>`;
	// Normalize null banner to empty html
	const banner = bannerHtml ?? html``;

	if (total === 0) {
		const emptyMessage = disabled
			? html`<p>No disabled feeds. <a href="/feeds">Clear filter</a></p>`
			: html`<p>No feeds available</p>`;

		return html`<main>
  <h1>Feeds</h1>
  ${banner}
  ${addFeedButton}
  ${emptyMessage}
</main>`;
	}

	const filterControl = disabled
		? html`<p class="feed-filter">Showing disabled feeds only — <a href="/feeds">Clear filter</a></p>`
		: html`<p class="feed-filter"><a href="/feeds?disabled=1">Show disabled only</a></p>`;

	// items is an Array<HtmlEscapedString>. Array.join() coerces each element to a plain
	// string via toString() — safe because HtmlEscapedString values are already escaped.
	// raw() prevents the joined string from being double-escaped when interpolated.
	const items = feeds.map((feed) => {
		const noCrawl = feed.no_crawl;
		const crawlBadge = noCrawl
			? html`<span class="crawl-status-badge crawl-status-disabled">Disabled</span>`
			: html`<span class="crawl-status-badge crawl-status-enabled">Crawling</span>`;
		const toggleButtonLabel = noCrawl ? 'Enable' : 'Disable';

		// Build detail href with optional listPage and disabled params
		let detailHref = `/feeds/${feed.id}`;
		if (page > 1 && disabled) {
			detailHref += `?listPage=${page}&disabled=1`;
		} else if (page > 1) {
			detailHref += `?listPage=${page}`;
		} else if (disabled) {
			detailHref += `?disabled=1`;
		}

		// Visit Website link — only when html_url is not null
		const visitWebsiteLink = feed.html_url
			? html`<a href="${feed.html_url}" target="_blank" rel="noopener noreferrer">Visit Website</a>`
			: html``;

		return html`<li class="feed-item">
    <a href="${detailHref}">${feed.title}</a>
    <span class="feed-hostname">${feed.hostname}</span>
    ${crawlBadge}
    ${visitWebsiteLink}
    <form method="POST" action="/api/feeds/${feed.id}/toggle-crawl" class="toggle-crawl-form">
      <input type="hidden" name="returnTo" value="/feeds${raw(disabledParam)}">
      <button type="submit">${toggleButtonLabel}</button>
    </form>
  </li>`;
	});

	let prevLink;
	if (page === 1) {
		prevLink = html`<a aria-disabled="true">Previous</a>`;
	} else if (disabled) {
		prevLink = html`<a href="/feeds?disabled=1&page=${page - 1}">Previous</a>`;
	} else {
		prevLink = html`<a href="/feeds?page=${page - 1}">Previous</a>`;
	}

	let nextLink;
	if (page === totalPages) {
		nextLink = html`<a aria-disabled="true">Next</a>`;
	} else if (disabled) {
		nextLink = html`<a href="/feeds?disabled=1&page=${page + 1}">Next</a>`;
	} else {
		nextLink = html`<a href="/feeds?page=${page + 1}">Next</a>`;
	}

	return html`<main>
  <h1>Feeds</h1>
  ${banner}
  ${addFeedButton}
  ${filterControl}
  <ul class="feed-list">
${raw(items.join('\n'))}
  </ul>
  <nav class="pagination">
    ${prevLink}
    <span>Page ${page} of ${totalPages}</span>
    ${nextLink}
  </nav>
</main>`;
}

/**
 * Builds the add-feed banner shown after a feed is successfully added.
 * Returns an HtmlEscapedString so it can be nested in the feedsPage template.
 *
 * @param {object|null} detail - Crawl run detail record for the new feed, or null if not yet available.
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function addFeedBanner(detail) {
	const successNotice = html`<div class="notice notice-success">Feed added successfully.</div>`;

	if (!detail) {
		return html`${successNotice}
  <div class="notice notice-info">Feed added. Initial crawl in progress.</div>`;
	}

	if (detail.status === 'failed' || detail.status === 'auto_disabled') {
		const reason = detail.error_message || 'Unknown error';
		return html`${successNotice}
  <div class="notice notice-warning">Feed added, but could not fetch articles yet. Reason: ${reason}. Articles will be fetched at the next scheduled crawl (2am UTC).</div>`;
	}

	return html`${successNotice}
  <div class="notice notice-info">Feed added. Initial crawl completed.</div>`;
}
