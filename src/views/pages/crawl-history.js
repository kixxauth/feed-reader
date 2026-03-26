import { html, raw } from 'hono/html';

/**
 * Format an ISO 8601 timestamp as a human-readable date+time string.
 * Example output: "Mar 23, 2026 02:15 AM"
 *
 * @param {string|null} isoString
 * @returns {string}
 */
function formatDateTime(isoString) {
	if (!isoString) return 'Unknown';
	const d = new Date(isoString);
	if (isNaN(d.getTime())) return String(isoString);
	return d.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	});
}

/**
 * Renders the crawl history list page content.
 *
 * @param {{ runs: Array<object> }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function crawlHistoryPage({ runs }) {
	if (runs.length === 0) {
		return html`<main>
  <h1>Crawl History</h1>
  <a href="/feeds">Back to Feeds</a>
  <p>No crawl history available</p>
</main>`;
	}

	const items = runs.map((run) => {
		const startedAt = formatDateTime(run.started_at);
		return html`<li>
    <div>
      <span><strong>Started:</strong> ${startedAt}</span>
      <span><strong>Feeds attempted:</strong> ${run.total_feeds_attempted}</span>
      <span><strong>Feeds failed:</strong> ${run.total_feeds_failed}</span>
      <span><strong>Articles added:</strong> ${run.total_articles_added}</span>
    </div>
    <a href="/crawl-history/${run.id}">View Details</a>
  </li>`;
	});

	return html`<main>
  <h1>Crawl History</h1>
  <a href="/feeds">Back to Feeds</a>
  <ul>
${raw(items.join('\n'))}
  </ul>
</main>`;
}

/**
 * Renders the crawl run detail page content.
 *
 * @param {{
 *   run: object,
 *   details: Array<object>,
 *   failedOnly: boolean,
 *   crawlRunId: string,
 * }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function crawlRunDetailPage({ run, details, failedOnly, crawlRunId }) {
	const startedAt = formatDateTime(run.started_at);

	const summary = html`<div>
    <div>
      <span><strong>Started:</strong> ${startedAt}</span>
      <span><strong>Feeds attempted:</strong> ${run.total_feeds_attempted}</span>
      <span><strong>Feeds failed:</strong> ${run.total_feeds_failed}</span>
      <span><strong>Articles added:</strong> ${run.total_articles_added}</span>
    </div>
  </div>`;

	const filterControl = failedOnly
		? html`<p>Showing failed only — <a href="/crawl-history/${crawlRunId}">Show all</a></p>`
		: html`<p><a href="/crawl-history/${crawlRunId}?failed=1">Show failed only</a></p>`;

	let detailRows;
	if (details.length === 0) {
		if (failedOnly) {
			detailRows = html`<p>No failed feed attempts in this crawl run. <a href="/crawl-history/${crawlRunId}">Show all</a></p>`;
		} else {
			detailRows = html`<p>No feed detail records for this crawl run.</p>`;
		}
	} else {
		const rows = details.map((detail) => {
			// Use feed title from JOIN if available; fall back to feed_id
			const feedLabel = detail.feed_title
				? html`<a href="/feeds/${detail.feed_id}">${detail.feed_title}</a>`
				: html`${detail.feed_id}`;

			const xmlLinkHtml = detail.feed_xml_url
				? html` <a href="${detail.feed_xml_url}" target="_blank" rel="noopener noreferrer">(XML)</a>`
				: html``;

			// Determine status display text
			let statusText;
			if (detail.status === 'auto_disabled') {
				statusText = 'Auto-disabled';
			} else if (detail.status === 'failed') {
				statusText = 'Failed';
			} else {
				statusText = 'Success';
			}

			const errorContent = detail.error_message
				? html`<span>${detail.error_message}</span>`
				: html``;

			return html`<li>
      <span>${feedLabel}${xmlLinkHtml}</span>
      <span><strong>Articles added:</strong> ${detail.articles_added}</span>
      <span>${statusText}</span>
      ${errorContent}
    </li>`;
		});

		detailRows = html`<ul>
${raw(rows.join('\n'))}
  </ul>`;
	}

	return html`<main>
  <h1>Crawl Run Details</h1>
  <a href="/crawl-history">Back to Crawl History</a>
  ${summary}
  ${filterControl}
  ${detailRows}
</main>`;
}
