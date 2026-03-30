/**
 * RSS/Atom feed crawl logic.
 *
 * Exports:
 *   dispatchCrawl(db, queue)   — cron-triggered dispatcher: queries enabled feed IDs,
 *                                inserts the crawl_runs header row, and enqueues one
 *                                message per feed (sent to the queue in batches of 100).
 *   processCrawlJob(db, { crawlRunId, startedAt, feedId })
 *                              — queue consumer: fetches the feed object for the given
 *                                ID, fetches and parses the XML, records crawl status,
 *                                and inserts discovered articles into the database.
 *   performFeedCrawl(db, feedId, crawlRunId)
 *                              — single-feed crawl used immediately after a user adds a
 *                                feed via the UI; inserts its own crawl_runs row and
 *                                delegates to processCrawlJob for the actual crawl.
 *
 * Supports both RSS 2.0 and Atom 1.0.
 *
 * Design note: article inserts happen inline within the crawl job. A previous version
 * used a second “article-batch” queue fan-out to work around an older D1 per-message
 * limit; that extra phase is intentionally not used anymore to keep the pipeline simple.
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
 * Fetch and parse a single feed, returning prepared article objects
 * ready for insertion. Does NOT insert anything into the database.
 *
 * @param {object} feed - Feed row from the database (must have id, xml_url, html_url)
 * @returns {Promise<{ status: 'success'|'failed', articles: Array, errorMessage: string|null }>}
 */
async function fetchAndParseFeed(feed) {
	if (!feed.xml_url) {
		return {
			status: 'failed',
			articles: [],
			errorMessage: 'Could not reach the feed URL (network error or server unavailable)',
		};
	}

	let xmlText;
	try {
		xmlText = await fetchFeedXml(feed.xml_url);
	} catch (err) {
		return {
			status: 'failed',
			articles: [],
			errorMessage: normalizeCrawlErrorMessage(err.message),
		};
	}

	let parsedArticles;
	try {
		const parsed = parseFeed(xmlText, feed.id);
		if (!parsed) {
			return {
				status: 'failed',
				articles: [],
				errorMessage: 'The feed returned invalid content',
			};
		}

		parsedArticles = parsed.articles;
	} catch (err) {
		return {
			status: 'failed',
			articles: [],
			errorMessage: normalizeCrawlErrorMessage(err.message),
		};
	}

	// Prepare article objects for insertion, filtering out those without a stable id
	// and resolving relative URLs.
	const articles = [];
	for (const article of parsedArticles) {
		if (!article.id) {
			continue;
		}

		const resolvedLink = resolveArticleUrl(article.link, feed.html_url || feed.xml_url);

		articles.push({
			id: article.id,
			feedId: feed.id,
			link: resolvedLink,
			title: article.title,
			published: article.published,
			updated: article.updated,
		});
	}

	return { status: 'success', articles, errorMessage: null };
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
				body: { type: 'crawl', crawlRunId, startedAt, feedId },
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
 * Fetches the full feed object by ID, fetches and parses the XML,
 * updates failure counts, inserts discovered articles into the database,
 * and writes a crawl_run_details row.
 *
 * Does NOT insert the crawl_runs row — that is the dispatcher's responsibility
 * via dispatchCrawl.
 *
 * @param {D1Database} db
 * @param {{ crawlRunId: string, startedAt: string, feedId: string }} job
 * @returns {Promise<{ crawlRunId: string, feedId: string, status: string, articlesFound: number, errorMessage: string|null }>}
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
		return { crawlRunId, feedId, status: 'failed', articlesFound: 0, errorMessage: `Feed not found: ${feedId}` };
	}

	const feedResult = await fetchAndParseFeed(feed);

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

	let articlesAdded = 0;

	for (const article of feedResult.articles) {
		const result = await insertArticle(db, {
			id: article.id,
			feedId: article.feedId,
			link: article.link,
			title: article.title,
			published: article.published,
			updated: article.updated,
			added: startedAt,
		});

		articlesAdded += result.meta.changes;
	}

	await recordCrawlRunDetail(db, {
		crawlRunId,
		feedId: feed.id,
		status,
		articlesAdded,
		errorMessage: feedResult.errorMessage,
		autoDisabled,
	});

	return {
		crawlRunId,
		feedId: feed.id,
		status,
		articlesFound: feedResult.articles.length,
		errorMessage: feedResult.errorMessage,
	};
}

/**
 * Crawl one feed immediately after it is added via the UI.
 * Inserts its own crawl_runs row and delegates to processCrawlJob for the
 * actual crawl.
 *
 * @param {D1Database} db - The D1 database binding (env.DB)
 * @param {string} feedId - The feed id to crawl
 * @param {string} crawlRunId - The pre-generated crawl run id used by the redirect banner
 * @returns {Promise<{ crawlRunId: string, feedId: string, status: string, articlesFound: number, errorMessage: string|null }>}
 */
export async function performFeedCrawl(db, feedId, crawlRunId) {
	const startedAt = new Date().toISOString();
	await recordCrawlRun(db, { id: crawlRunId, startedAt });

	return await processCrawlJob(db, { crawlRunId, startedAt, feedId });
}
