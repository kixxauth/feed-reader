/**
 * RSS/Atom feed crawl logic.
 *
 * Exports:
 *   performCrawl(db) — fetches all enabled feeds, parses each feed's XML,
 *   inserts new articles, tracks per-feed failure counts, auto-disables feeds
 *   after 5 consecutive failures, and records crawl history.
 *
 * Supports both RSS 2.0 and Atom 1.0.
 *
 * Returns a summary object { crawlRunId, totalFeeds, totalFailed, totalArticlesAdded }
 * suitable for logging by the scheduled handler.
 */

import { parseFeedPreview, parseFeedXml } from './parser.js';
import { resolveArticleUrl } from './feed-utils.js';
import {
	getEnabledFeeds,
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
		const preview = parseFeedPreview(xmlText);
		if (!preview) {
			return {
				status: 'failed',
				articlesAdded: 0,
				errorMessage: 'The feed returned invalid content',
			};
		}

		articles = parseFeedXml(xmlText, feed.id);
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

	if (message === 'Request timeout (30s)' || message.startsWith('HTTP ') || message.length > 0) {
		return 'Could not reach the feed URL (network error or server unavailable)';
	}

	return 'Could not reach the feed URL (network error or server unavailable)';
}

/**
 * Crawl a specific list of feeds, record history, and return the summary.
 *
 * @param {D1Database} db
 * @param {Array<object>} feeds
 * @param {string} crawlRunId
 * @returns {Promise<{ crawlRunId: string, totalFeeds: number, totalFailed: number, totalArticlesAdded: number }>}
 */
async function performCrawlForFeeds(db, feeds, crawlRunId) {
	const startedAt = new Date().toISOString();

	let totalFailed = 0;
	let totalArticlesAdded = 0;

	for (const feed of feeds) {
		const feedResult = await processFeed(feed, startedAt, db);

		let autoDisabled = 0;

		if (feedResult.status === 'success') {
			await resetFeedFailureCount(db, feed.id);
			totalArticlesAdded += feedResult.articlesAdded;
		} else {
			totalFailed += 1;
			const newFailureCount = (feed.consecutive_failure_count ?? 0) + 1;

			if (newFailureCount >= AUTO_DISABLE_THRESHOLD) {
				await disableFeed(db, feed.id);
				autoDisabled = 1;
			} else {
				await updateFeedFailureCount(db, feed.id, newFailureCount);
			}
		}

		const detailStatus = autoDisabled ? 'auto_disabled' : feedResult.status;
		await recordCrawlRunDetail(db, {
			crawlRunId,
			feedId: feed.id,
			status: detailStatus,
			articlesAdded: feedResult.articlesAdded,
			errorMessage: feedResult.errorMessage,
			autoDisabled,
		});
	}

	const completedAt = new Date().toISOString();

	await recordCrawlRun(db, {
		id: crawlRunId,
		startedAt,
		completedAt,
		totalFeedsAttempted: feeds.length,
		totalFeedsFailed: totalFailed,
		totalArticlesAdded,
	});

	return {
		crawlRunId,
		totalFeeds: feeds.length,
		totalFailed,
		totalArticlesAdded,
	};
}

/**
 * Crawl all enabled feeds, insert new articles, track failures, and record
 * crawl history. This is the main entry point called by the scheduled handler.
 *
 * Database errors (from history recording or failure tracking) are allowed to
 * propagate so the scheduled handler can log them. One feed's failure does not
 * stop the crawl; processing continues to the next feed.
 *
 * @param {D1Database} db - The D1 database binding (env.DB)
 * @returns {Promise<{ crawlRunId: string, totalFeeds: number, totalFailed: number, totalArticlesAdded: number }>}
 */
export async function performCrawl(db) {
	const crawlRunId = crypto.randomUUID();
	const feeds = await getEnabledFeeds(db);
	return await performCrawlForFeeds(db, feeds, crawlRunId);
}

/**
 * Crawl one feed immediately after it is added via the UI.
 *
 * @param {D1Database} db - The D1 database binding (env.DB)
 * @param {string} feedId - The feed id to crawl
 * @param {string} crawlRunId - The pre-generated crawl run id used by the redirect banner
 * @returns {Promise<{ crawlRunId: string, totalFeeds: number, totalFailed: number, totalArticlesAdded: number }>}
 */
export async function performFeedCrawl(db, feedId, crawlRunId) {
	const feed = await getFeedById(db, feedId);
	if (feed === null) {
		throw new Error(`Feed not found: ${feedId}`);
	}

	return await performCrawlForFeeds(db, [feed], crawlRunId);
}
