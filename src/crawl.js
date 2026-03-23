/**
 * RSS/Atom feed crawl logic.
 *
 * Exports:
 *   performCrawl(db) — fetches all enabled feeds, parses each feed's XML,
 *   inserts new articles, tracks per-feed failure counts, auto-disables feeds
 *   after 5 consecutive failures, and records crawl history.
 *
 * Supports both RSS 2.0 (rss.channel.item) and Atom 1.0 (feed.entry).
 *
 * Returns a summary object { crawlRunId, totalFeeds, totalFailed, totalArticlesAdded }
 * suitable for logging by the scheduled handler.
 */

import { XMLParser } from 'fast-xml-parser';
import {
	getEnabledFeeds,
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
 * Parse a date string into an ISO 8601 string, or return null if the date
 * is missing or invalid.
 *
 * @param {string|undefined|null} dateString - RFC 2822 or ISO 8601 date string
 * @returns {string|null}
 */
function parseDate(dateString) {
	if (!dateString) {
		return null;
	}
	const d = new Date(dateString);
	if (isNaN(d.getTime())) {
		return null;
	}
	return d.toISOString();
}

/**
 * Normalize a string value: trim whitespace and collapse internal whitespace.
 * Returns null if the result is empty or the input is falsy.
 *
 * @param {string|undefined|null} value
 * @returns {string|null}
 */
function normalizeString(value) {
	if (!value) {
		return null;
	}
	const trimmed = String(value).trim().replace(/\s+/g, ' ');
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derive a stable article id from feedId and the article's guid or link.
 *
 * @param {string} feedId - The feed's database id
 * @param {string|null} guid - The article's guid (RSS) or id (Atom)
 * @param {string|null} link - The article's link URL (fallback)
 * @returns {string|null} - Returns null if neither guid nor link is available
 */
function deriveArticleId(feedId, guid, link) {
	const identifier = normalizeString(guid) || normalizeString(link);
	if (!identifier) {
		return null;
	}
	return `${feedId}:${identifier}`;
}

/**
 * Extract the alternate or primary href from an Atom link value.
 * Atom <link> can be a string, a single object, or an array of objects when
 * multiple link elements are present.
 *
 * @param {string|object|Array} linkValue - Parsed link value from fast-xml-parser
 * @returns {string|null}
 */
function extractAtomLinkHref(linkValue) {
	if (!linkValue) {
		return null;
	}

	// Simple string — treat as href directly
	if (typeof linkValue === 'string') {
		return normalizeString(linkValue);
	}

	// Array of link objects — find the alternate or first without rel
	if (Array.isArray(linkValue)) {
		// Prefer rel="alternate" or no rel attribute
		const preferred = linkValue.find((l) => !l.rel || l.rel === 'alternate');
		if (preferred && preferred.href) {
			return normalizeString(preferred.href);
		}
		// Fall back to first element with an href
		const first = linkValue.find((l) => l.href);
		return first ? normalizeString(first.href) : null;
	}

	// Single link object
	if (typeof linkValue === 'object' && linkValue.href) {
		return normalizeString(linkValue.href);
	}

	return null;
}

/**
 * Extract normalized article data from a single RSS 2.0 <item> element.
 *
 * @param {object} item - Parsed RSS item object
 * @param {string} feedId
 * @returns {{ id: string|null, link: string|null, title: string|null, published: string|null, updated: string|null }}
 */
function extractRssArticle(item, feedId) {
	const guid = normalizeString(item.guid?.['#text'] ?? item.guid);
	const link = normalizeString(item.link);
	const title = normalizeString(item.title);
	const published = parseDate(item.pubDate);

	return {
		id: deriveArticleId(feedId, guid, link),
		link,
		title,
		published,
		updated: null, // RSS 2.0 has no updated field distinct from pubDate
	};
}

/**
 * Extract normalized article data from a single Atom 1.0 <entry> element.
 *
 * @param {object} entry - Parsed Atom entry object
 * @param {string} feedId
 * @returns {{ id: string|null, link: string|null, title: string|null, published: string|null, updated: string|null }}
 */
function extractAtomArticle(entry, feedId) {
	const atomId = normalizeString(entry.id);
	const link = extractAtomLinkHref(entry.link);

	// Atom <title> may be a string or an object with a #text property
	const title = normalizeString(entry.title?.['#text'] ?? entry.title);

	const published = parseDate(entry.published || entry.updated);
	const updated = parseDate(entry.updated);

	return {
		id: deriveArticleId(feedId, atomId, link),
		link,
		title,
		published,
		updated,
	};
}

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
 * Parse raw XML text and extract a flat array of article data objects.
 * Handles both RSS 2.0 and Atom 1.0.
 *
 * @param {string} xmlText - The raw feed XML
 * @param {string} feedId - Used for article id derivation
 * @returns {Array<{ id: string|null, link: string|null, title: string|null, published: string|null, updated: string|null }>}
 * @throws {Error} - If the XML cannot be parsed or has an unexpected structure
 */
function parseFeedXml(xmlText, feedId) {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '', // attributes accessed without @_ prefix
		isArray: (name) => name === 'item' || name === 'entry', // always arrays
	});

	let parsed;
	try {
		parsed = parser.parse(xmlText);
	} catch (err) {
		throw new Error(`Invalid XML: ${err.message}`);
	}

	// RSS 2.0
	if (parsed.rss && parsed.rss.channel) {
		const items = parsed.rss.channel.item ?? [];
		return items.map((item) => extractRssArticle(item, feedId));
	}

	// Atom 1.0
	if (parsed.feed) {
		const entries = parsed.feed.entry ?? [];
		return entries.map((entry) => extractAtomArticle(entry, feedId));
	}

	// Unrecognized structure — treat as empty feed rather than error so we
	// don't rack up failure counts on feeds that temporarily serve empty XML.
	return [];
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
		return { status: 'failed', articlesAdded: 0, errorMessage: 'No xml_url configured for feed' };
	}

	let xmlText;
	try {
		xmlText = await fetchFeedXml(feed.xml_url);
	} catch (err) {
		return { status: 'failed', articlesAdded: 0, errorMessage: err.message };
	}

	let articles;
	try {
		articles = parseFeedXml(xmlText, feed.id);
	} catch (err) {
		return { status: 'failed', articlesAdded: 0, errorMessage: err.message };
	}

	let articlesAdded = 0;
	for (const article of articles) {
		// Skip articles where we could not derive a stable id
		if (!article.id) {
			continue;
		}

		const result = await insertArticle(db, {
			id: article.id,
			feedId: feed.id,
			link: article.link,
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
	const startedAt = new Date().toISOString();

	const feeds = await getEnabledFeeds(db);

	let totalFailed = 0;
	let totalArticlesAdded = 0;

	for (const feed of feeds) {
		const feedResult = await processFeed(feed, startedAt, db);

		let autoDisabled = 0;

		if (feedResult.status === 'success') {
			// Reset consecutive failure count on a successful crawl
			await resetFeedFailureCount(db, feed.id);
			totalArticlesAdded += feedResult.articlesAdded;
		} else {
			// Failure: increment consecutive failure count
			totalFailed += 1;
			const newFailureCount = (feed.consecutive_failure_count ?? 0) + 1;

			if (newFailureCount >= AUTO_DISABLE_THRESHOLD) {
				// Auto-disable the feed after 5 consecutive failures
				await disableFeed(db, feed.id);
				autoDisabled = 1;
			} else {
				await updateFeedFailureCount(db, feed.id, newFailureCount);
			}
		}

		// Record per-feed detail row — status is 'auto_disabled' when feed was disabled
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

	// Record the crawl_runs summary row now that all feeds have been processed
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
