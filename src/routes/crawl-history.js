/**
 * Crawl history pages.
 *
 * GET /crawl-history        — List of recent crawl runs (newest-first).
 * GET /crawl-history/:id    — Per-feed detail for a single crawl run.
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getCrawlRuns, getCrawlRunById, getCrawlRunDetails } from '../db.js';
import { escapeHtml } from '../html-utils.js';

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
	if (isNaN(d.getTime())) return escapeHtml(isoString);
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
 * GET /crawl-history — Paginated list of the most recent 30 crawl runs.
 */
export async function handleCrawlHistory(c) {
	const runs = await getCrawlRuns(c.env.DB, 30);

	let content;
	if (runs.length === 0) {
		content = `<main>
  <h1>Crawl History</h1>
  <a href="/feeds">Back to Feeds</a>
  <p>No crawl history available</p>
</main>`;
	} else {
		const items = runs
			.map((run) => {
				const startedAt = formatDateTime(run.started_at);
				const runId = escapeHtml(run.id);
				return `<li class="crawl-run-summary">
    <div class="crawl-run-stats">
      <span class="crawl-run-stat"><strong>Started:</strong> ${startedAt}</span>
      <span class="crawl-run-stat"><strong>Feeds attempted:</strong> ${run.total_feeds_attempted}</span>
      <span class="crawl-run-stat"><strong>Feeds failed:</strong> ${run.total_feeds_failed}</span>
      <span class="crawl-run-stat"><strong>Articles added:</strong> ${run.total_articles_added}</span>
    </div>
    <a href="/crawl-history/${runId}">View Details</a>
  </li>`;
			})
			.join('\n');

		content = `<main>
  <h1>Crawl History</h1>
  <a href="/feeds">Back to Feeds</a>
  <ul class="crawl-run-list">
${items}
  </ul>
</main>`;
	}

	return c.html(
		renderLayout({
			title: 'Crawl History — Feed Reader',
			content,
			isAuthenticated: true,
		})
	);
}

/**
 * GET /crawl-history/:crawlRunId — Per-feed detail view for a single crawl run.
 */
export async function handleCrawlHistoryDetail(c) {
	const crawlRunId = c.req.param('crawlRunId');

	const run = await getCrawlRunById(c.env.DB, crawlRunId);
	if (run === null) {
		return c.html(
			renderLayout({
				title: 'Not Found — Feed Reader',
				content: '<main><h1>Not Found</h1><p>Crawl run not found.</p></main>',
				isAuthenticated: true,
			}),
			404
		);
	}

	const failedOnly = c.req.query('failed') === '1';

	const allDetails = await getCrawlRunDetails(c.env.DB, crawlRunId);
	const details = failedOnly
		? allDetails.filter((d) => d.status === 'failed' || d.status === 'auto_disabled')
		: allDetails;

	const startedAt = formatDateTime(run.started_at);

	const summary = `<div class="crawl-run-summary">
    <div class="crawl-run-stats">
      <span class="crawl-run-stat"><strong>Started:</strong> ${startedAt}</span>
      <span class="crawl-run-stat"><strong>Feeds attempted:</strong> ${run.total_feeds_attempted}</span>
      <span class="crawl-run-stat"><strong>Feeds failed:</strong> ${run.total_feeds_failed}</span>
      <span class="crawl-run-stat"><strong>Articles added:</strong> ${run.total_articles_added}</span>
    </div>
  </div>`;

	const filterControl = failedOnly
		? `<p class="feed-filter">Showing failed only — <a href="/crawl-history/${escapeHtml(crawlRunId)}">Show all</a></p>`
		: `<p class="feed-filter"><a href="/crawl-history/${escapeHtml(crawlRunId)}?failed=1">Show failed only</a></p>`;

	let detailRows;
	if (details.length === 0) {
		const emptyMessage = failedOnly
			? `<p>No failed feed attempts in this crawl run. <a href="/crawl-history/${escapeHtml(crawlRunId)}">Show all</a></p>`
			: '<p>No feed detail records for this crawl run.</p>';
		detailRows = emptyMessage;
	} else {
		const rows = details
			.map((detail) => {
				// Use feed title from JOIN if available; fall back to feed_id
				const feedText = detail.feed_title
					? escapeHtml(detail.feed_title)
					: escapeHtml(detail.feed_id);
				const feedLabel = detail.feed_title
					? `<a href="/feeds/${escapeHtml(detail.feed_id)}">${feedText}</a>`
					: feedText;

				// Determine status badge CSS class and display text
				let statusClass;
				let statusText;
				if (detail.status === 'auto_disabled') {
					statusClass = 'status-auto-disabled';
					statusText = 'Auto-disabled';
				} else if (detail.status === 'failed') {
					statusClass = 'status-failed';
					statusText = 'Failed';
				} else {
					statusClass = 'status-success';
					statusText = 'Success';
				}

				const xmlLinkHtml = detail.feed_xml_url
					? ` <a href="${escapeHtml(detail.feed_xml_url)}" target="_blank" rel="noopener noreferrer">(XML)</a>`
					: '';

				const errorHtml =
					detail.error_message
						? `<span class="crawl-detail-error">${escapeHtml(detail.error_message)}</span>`
						: '';

				return `<li class="crawl-detail-row">
      <span class="crawl-detail-feed">${feedLabel}${xmlLinkHtml}</span>
      <span class="crawl-detail-articles"><strong>Articles added:</strong> ${detail.articles_added}</span>
      <span class="crawl-detail-status ${statusClass}">${statusText}</span>
      ${errorHtml}
    </li>`;
			})
			.join('\n');

		detailRows = `<ul class="crawl-detail-list">
${rows}
  </ul>`;
	}

	const content = `<main>
  <h1>Crawl Run Details</h1>
  <a href="/crawl-history">Back to Crawl History</a>
  ${summary}
  ${filterControl}
  ${detailRows}
</main>`;

	return c.html(
		renderLayout({
			title: 'Crawl Run Details — Feed Reader',
			content,
			isAuthenticated: true,
		})
	);
}
