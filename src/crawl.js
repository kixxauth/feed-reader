/**
 * RSS/Atom feed crawl logic.
 *
 * Exports:
 *   dispatchCrawl(db, queue)   — cron-triggered dispatcher: queries enabled feed IDs,
 *                                inserts the crawl_runs header row, and enqueues one
 *                                message per feed (sent to the queue in batches of 100).
 *   processCrawlJob(db, { crawlRunId, startedAt, feedId })
 *                              — queue consumer: fetches the feed object for the given
 *                                ID, fetches and parses the XML, inserts new articles,
 *                                writes DB updates and the crawl_run_details row, and
 *                                returns a result object.
 *   performFeedCrawl(db, feedId, crawlRunId)
 *                              — single-feed crawl used immediately after a user adds a
 *                                feed via the UI; inserts its own crawl_runs row and
 *                                delegates to processCrawlJob for the actual crawl.
 *
 * Supports both RSS 2.0 and Atom 1.0.
 */

import { parseFeed } from './parser.js';
import { resolveArticleUrl } from './feed-utils.js';
import {
	getEnabledFeedIds,
	getFeedById,
	resetFeedFailureCount,
	updateFeedFailureCount,
	disableFeed,
	insertArticle,
	recordCrawlRunDetail,
	recordCrawlRun,
} from './db.js';

const USER_AGENT = 'FeedReader/1.0';
const FETCH_TIMEOUT_MS = 30_000;
const AUTO_DISABLE_THRESHOLD = 5;

/**
 * Fetch a feed URL with a 30-second AbortController timeout.
 * Returns the response body text on success.
 *
 * @param {string} url
 * @returns {Promise<string>} - The raw XML text
 * @throws {Error} - On network error, timeout, or non-2xx HTTP status
 */
async function fetchFeedXml(url) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				'User-Agent': USER_AGENT,
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		return await response.text();
	} catch (err) {
		if (err.name === 'AbortError') {
			throw new Error('Request timeout (30s)');
		}
		throw err;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Process a single feed: fetch its XML, parse articles, insert new ones,
 * and return a result object describing what happened.
 *
 * Does NOT write anything to the database — the caller is responsible for
 * recording crawl_run_details and updating failure counts so the outer loop
 * retains full control over DB state.
 *
 * @param {object} feed - Feed row from the database (must have id, xml_url, consecutive_failure_count)
 * @param {string} startedAt - ISO 8601 timestamp of the crawl start (used as article.added)
 * @param {D1Database} db
 * @returns {Promise<{ status: 'success'|'failed', articlesAdded: number, errorMessage: string|null }>}
 */
async function processFeed(feed, startedAt, db) {
	if (!feed.xml_url) {
		return {
			status: 'failed',
			articlesAdded: 0,
			errorMessage: 'Could not reach the feed URL (network error or server unavailable)',
		};
	}

	let xmlText;
	try {
		xmlText = await fetchFeedXml(feed.xml_url);
	} catch (err) {
		return {
			status: 'failed',
			articlesAdded: 0,
			errorMessage: normalizeCrawlErrorMessage(err.message),
		};
	}

	let articles;
	try {
		const parsed = parseFeed(xmlText, feed.id);
		if (!parsed) {
			return {
				status: 'failed',
				articlesAdded: 0,
				errorMessage: 'The feed returned invalid content',
			};
		}

		articles = parsed.articles;
	} catch (err) {
		return {
			status: 'failed',
			articlesAdded: 0,
			errorMessage: normalizeCrawlErrorMessage(err.message),
		};
	}

	let articlesAdded = 0;
	for (const article of articles) {
		// Skip articles where we could not derive a stable id
		if (!article.id) {
			continue;
		}

		// Resolve relative article links (e.g. "/path/to/post") to absolute URLs
		// before storage. Render-time resolution in reader.js and articles.js
		// provides a safety net for articles already stored with relative links.
		const resolvedLink = resolveArticleUrl(article.link, feed.html_url || feed.xml_url);

		const result = await insertArticle(db, {
			id: article.id,
			feedId: feed.id,
			link: resolvedLink,
			title: article.title,
			published: article.published,
			updated: article.updated,
			added: startedAt,
		});

		articlesAdded += result.meta.changes;
	}

	return { status: 'success', articlesAdded, errorMessage: null };
}

/**
 * Normalize low-level crawl errors into user-facing messages for immediate
 * crawl status and crawl history detail rows.
 *
 * @param {string} message
 * @returns {string}
 */
function normalizeCrawlErrorMessage(message) {
	if (message.startsWith('Invalid XML:')) {
		return 'Failed to parse the feed XML';
	}

	return 'Could not reach the feed URL (network error or server unavailable)';
}


/**
 * Cron-triggered dispatcher: query all enabled feed IDs, insert the crawl_runs
 * header row, and enqueue one message per feed. Messages are sent to the queue
 * in batches of 100 (the Cloudflare sendBatch limit). Each message carries the
 * shared crawlRunId and startedAt so all consumer invocations contribute to one
 * logical crawl run.
 *
 * @param {D1Database} db
 * @param {Queue} queue - Cloudflare Queue producer binding (env.CRAWL_QUEUE)
 * @returns {Promise<{ crawlRunId: string|null, totalFeeds: number, batchCount: number }>}
 *   crawlRunId is null when there are no enabled feeds (no crawl_runs row is inserted).
 */
export async function dispatchCrawl(db, queue) {
	const ids = await getEnabledFeedIds(db);

	if (ids.length === 0) {
		console.log('Crawl dispatch skipped: no enabled feeds');
		return { crawlRunId: null, totalFeeds: 0, batchCount: 0 };
	}

	const crawlRunId = crypto.randomUUID();
	const startedAt = new Date().toISOString();

	await recordCrawlRun(db, { id: crawlRunId, startedAt });

	// One message per feed, sent in batches of 100 (CF sendBatch limit)
	const SEND_BATCH_SIZE = 100;
	let batchCount = 0;
	for (let i = 0; i < ids.length; i += SEND_BATCH_SIZE) {
		const chunk = ids.slice(i, i + SEND_BATCH_SIZE);
		await queue.sendBatch(
			chunk.map((feedId) => ({
				body: { crawlRunId, startedAt, feedId },
			}))
		);
		batchCount += 1;
	}

	return {
		crawlRunId,
		totalFeeds: ids.length,
		batchCount,
	};
}

/**
 * Process a single feed as a queue consumer invocation.
 * Fetches the full feed object by ID, fetches and parses the XML, inserts new
 * articles, updates failure counts, and writes a crawl_run_details row.
 *
 * Does NOT insert the crawl_runs row — that is the dispatcher's responsibility
 * via dispatchCrawl.
 *
 * @param {D1Database} db
 * @param {{ crawlRunId: string, startedAt: string, feedId: string }} job
 * @returns {Promise<{ crawlRunId: string, feedId: string, status: string, articlesAdded: number, errorMessage: string|null }>}
 */
export async function processCrawlJob(db, { crawlRunId, startedAt, feedId }) {
	const feed = await getFeedById(db, feedId);

	if (!feed) {
		await recordCrawlRunDetail(db, {
			crawlRunId,
			feedId,
			status: 'failed',
			articlesAdded: 0,
			errorMessage: `Feed not found: ${feedId}`,
			autoDisabled: 0,
		});
		return { crawlRunId, feedId, status: 'failed', articlesAdded: 0, errorMessage: `Feed not found: ${feedId}` };
	}

	const feedResult = await processFeed(feed, startedAt, db);

	let autoDisabled = 0;

	if (feedResult.status === 'success') {
		await resetFeedFailureCount(db, feed.id);
	} else {
		const newFailureCount = (feed.consecutive_failure_count ?? 0) + 1;

		if (newFailureCount >= AUTO_DISABLE_THRESHOLD) {
			await disableFeed(db, feed.id);
			autoDisabled = 1;
		} else {
			await updateFeedFailureCount(db, feed.id, newFailureCount);
		}
	}

	const status = autoDisabled ? 'auto_disabled' : feedResult.status;
	await recordCrawlRunDetail(db, {
		crawlRunId,
		feedId: feed.id,
		status,
		articlesAdded: feedResult.articlesAdded,
		errorMessage: feedResult.errorMessage,
		autoDisabled,
	});

	return {
		crawlRunId,
		feedId: feed.id,
		status,
		articlesAdded: feedResult.articlesAdded,
		errorMessage: feedResult.errorMessage,
	};
}

/**
 * Crawl one feed immediately after it is added via the UI.
 * Inserts its own crawl_runs row and delegates to processCrawlJob for the actual crawl.
 *
 * @param {D1Database} db - The D1 database binding (env.DB)
 * @param {string} feedId - The feed id to crawl
 * @param {string} crawlRunId - The pre-generated crawl run id used by the redirect banner
 * @returns {Promise<{ crawlRunId: string, feedId: string, status: string, articlesAdded: number, errorMessage: string|null }>}
 */
export async function performFeedCrawl(db, feedId, crawlRunId) {
	const startedAt = new Date().toISOString();
	await recordCrawlRun(db, { id: crawlRunId, startedAt });

	return await processCrawlJob(db, { crawlRunId, startedAt, feedId });
}
