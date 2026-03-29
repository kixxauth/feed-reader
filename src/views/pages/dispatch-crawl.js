import { html } from 'hono/html';

/**
 * Renders the dispatch crawl page content.
 *
 * @param {{ result: object|null }} params
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function dispatchCrawlPage({ result }) {
	const resultBlock = result
		? html`<div class="dispatch-crawl__result">
			<p class="dispatch-crawl__result-line">Crawl Run ID: <code>${result.crawlRunId ?? 'none'}</code></p>
			<p class="dispatch-crawl__result-line">Total Feeds: <code>${result.totalFeeds}</code></p>
			<p class="dispatch-crawl__result-line">Batches Sent: <code>${result.batchCount}</code></p>
		</div>`
		: html``;

	return html`<section class="space-y-4">
		<header class="page-header">
			<h1 class="page-header__title">Dispatch Crawl</h1>
		</header>
		<p class="dispatch-crawl__description">Manually trigger a crawl of all enabled feeds. This enqueues one job per feed into the crawl queue.</p>
		<form method="POST" action="/api/dispatch-crawl">
			<button class="btn btn--primary" type="submit">Dispatch Crawl</button>
		</form>
		${resultBlock}
	</section>`;
}
