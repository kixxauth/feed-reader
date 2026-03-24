/**
 * GET /feeds — Paginated feeds list page.
 *
 * Pagination strategy:
 * - Page size is fixed at PAGE_SIZE (50). No user-configurable page size.
 * - Page numbers are 1-indexed in URLs (?page=1, ?page=2, …).
 * - Out-of-bounds pages (< 1 or > totalPages) are clamped silently with a 200
 *   response — no redirect. This avoids redirect loops and keeps URLs clean.
 * - getFeedsPaginated returns both the page of feeds and the total count.
 *   If the requested page exceeds totalPages the handler clamps and re-fetches,
 *   matching the same pattern used by the articles handler.
 *
 * Query params:
 * - page: 1-indexed page number
 * - disabled: when '1', filter to disabled (no_crawl = 1) feeds only; absent
 *   (or any value other than '1') shows all feeds
 *
 * Auth: protected by authMiddleware in src/index.js (no PUBLIC_PATHS entry).
 */

import { renderLayout } from '../layout.js';
import { getCrawlRunDetailByFeed, getFeedsPaginated, PAGE_SIZE } from '../db.js';
import { escapeHtml } from '../html-utils.js';

export async function handleFeeds(c) {
	const rawPage = parseInt(c.req.query('page'), 10);
	let page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

	const disabled = c.req.query('disabled') === '1';
	const addedFeedId = c.req.query('addedFeedId') || '';
	const crawlRunId = c.req.query('crawlRunId') || '';

	let { feeds, total } = await getFeedsPaginated(c.env.DB, page, { disabledOnly: disabled });
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	if (total > 0 && page > totalPages) {
		page = totalPages;
		({ feeds } = await getFeedsPaginated(c.env.DB, page, { disabledOnly: disabled }));
	}

	const disabledParam = disabled ? '?disabled=1' : '';
	const addFeedButton = `<p class="page-actions"><a class="button-link" href="/feeds/add">Add Feed</a></p>`;
	const bannerHtml = addedFeedId && crawlRunId
		? await buildAddFeedBanner(c.env.DB, addedFeedId, crawlRunId)
		: '';

	let content;
	if (total === 0) {
		const emptyMessage = disabled
			? `<p>No disabled feeds. <a href="/feeds">Clear filter</a></p>`
			: `<p>No feeds available</p>`;
		content = `<main>
  <h1>Feeds</h1>
  ${bannerHtml}
  ${addFeedButton}
  ${emptyMessage}
</main>`;
	} else {
		const filterControl = disabled
			? `<p class="feed-filter">Showing disabled feeds only — <a href="/feeds">Clear filter</a></p>`
			: `<p class="feed-filter"><a href="/feeds?disabled=1">Show disabled only</a></p>`;

		const items = feeds
			.map((feed) => {
				const title = escapeHtml(feed.title);
				const hostname = escapeHtml(feed.hostname);
				const feedId = escapeHtml(feed.id);
				const noCrawl = feed.no_crawl;
				const crawlBadge = noCrawl
					? `<span class="crawl-status-badge crawl-status-disabled">Disabled</span>`
					: `<span class="crawl-status-badge crawl-status-enabled">Crawling</span>`;
				const toggleButtonLabel = noCrawl ? 'Enable' : 'Disable';

				// Build detail href with optional listPage and disabled params
				let detailHref = `/feeds/${feedId}`;
				if (page > 1 && disabled) {
					detailHref += `?listPage=${page}&disabled=1`;
				} else if (page > 1) {
					detailHref += `?listPage=${page}`;
				} else if (disabled) {
					detailHref += `?disabled=1`;
				}

				// Visit Website link — only when html_url is not null
				const visitWebsiteLink =
					feed.html_url
						? `<a href="${escapeHtml(feed.html_url)}" target="_blank" rel="noopener noreferrer">Visit Website</a>`
						: '';

				return `<li class="feed-item">
    <a href="${detailHref}">${title}</a>
    <span class="feed-hostname">${hostname}</span>
    ${crawlBadge}
    ${visitWebsiteLink}
    <form method="POST" action="/api/feeds/${feedId}/toggle-crawl" class="toggle-crawl-form">
      <input type="hidden" name="returnTo" value="/feeds${disabledParam}">
      <button type="submit">${toggleButtonLabel}</button>
    </form>
  </li>`;
			})
			.join('\n');

		let prevLink;
		if (page === 1) {
			prevLink = `<a aria-disabled="true">Previous</a>`;
		} else if (disabled) {
			prevLink = `<a href="/feeds?disabled=1&page=${page - 1}">Previous</a>`;
		} else {
			prevLink = `<a href="/feeds?page=${page - 1}">Previous</a>`;
		}

		let nextLink;
		if (page === totalPages) {
			nextLink = `<a aria-disabled="true">Next</a>`;
		} else if (disabled) {
			nextLink = `<a href="/feeds?disabled=1&page=${page + 1}">Next</a>`;
		} else {
			nextLink = `<a href="/feeds?page=${page + 1}">Next</a>`;
		}

		content = `<main>
  <h1>Feeds</h1>
  ${bannerHtml}
  ${addFeedButton}
  ${filterControl}
  <ul class="feed-list">
${items}
  </ul>
  <nav class="pagination">
    ${prevLink}
    <span>Page ${page} of ${totalPages}</span>
    ${nextLink}
  </nav>
</main>`;
	}

	return c.html(
		renderLayout({
			title: 'Feeds — Feed Reader',
			content,
			isAuthenticated: true,
			currentPath: c.req.path,
		})
	);
}

async function buildAddFeedBanner(db, feedId, crawlRunId) {
	const detail = await getCrawlRunDetailByFeed(db, crawlRunId, feedId);

	const successHtml = '<div class="notice notice-success">Feed added successfully.</div>';
	if (!detail) {
		return `${successHtml}\n  <div class="notice notice-info">Feed added. Initial crawl in progress.</div>`;
	}

	if (detail.status === 'failed' || detail.status === 'auto_disabled') {
		const reason = detail.error_message || 'Unknown error';
		return `${successHtml}\n  <div class="notice notice-warning">Feed added, but could not fetch articles yet. Reason: ${escapeHtml(reason)}. Articles will be fetched at the next scheduled crawl (2am UTC).</div>`;
	}

	return `${successHtml}\n  <div class="notice notice-info">Feed added. Initial crawl completed.</div>`;
}
