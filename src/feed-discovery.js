import { canonicalizeHttpUrl, normalizeUrlForComparison } from './feed-utils.js';
import { parseFeedPreview } from './parser.js';

const USER_AGENT = 'FeedReader/1.0';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_HTML_BYTES = 128 * 1024;
const COMMON_FEED_PATHS = ['/feed', '/rss', '/atom.xml', '/feed.xml', '/feeds/atom', '/feeds/rss'];

export const ADD_FEED_MESSAGES = {
	invalidUrl: 'Please enter a valid URL (must start with http:// or https://)',
	unreachableUrl: 'Could not reach this URL. Please check it and try again.',
	invalidTarget: 'This does not appear to be a valid RSS/Atom feed or a website with feeds. Please try a different URL.',
	noFeedsFound:
		'No RSS/Atom feeds found on this website. You can try pasting the direct feed URL instead.',
	feedParseError: 'The feed could not be parsed. Please check the URL.',
	timeout: 'The request took too long. Please try again.',
};

export class AddFeedError extends Error {
	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {unknown} [cause]
	 */
	constructor(code, message, cause) {
		super(message);
		this.code = code;
		this.cause = cause;
	}
}

/**
 * @typedef {{
 *   xmlUrl: string,
 *   title: string|null,
 *   description: string|null,
 *   htmlUrl: string|null,
 *   type: 'rss'|'atom',
 *   lastBuildDate: string|null
 * }} FeedCandidate
 */

/**
 * Fetch a user-submitted URL and classify it as a direct feed, a website with
 * a single discovered feed, a website with multiple feeds, or a website with
 * no discoverable feeds.
 *
 * @param {string} rawUrl
 * @returns {Promise<
 *   | { kind: 'direct'|'single', submittedUrl: string, candidate: FeedCandidate }
 *   | { kind: 'multiple', submittedUrl: string, candidates: FeedCandidate[] }
 *   | { kind: 'none', submittedUrl: string }
 * >}
 */
export async function discoverFeedTargets(rawUrl) {
	const submittedUrl = canonicalizeHttpUrl(rawUrl);
	if (!submittedUrl) {
		throw new AddFeedError('invalid_url', ADD_FEED_MESSAGES.invalidUrl);
	}

	let response;
	try {
		response = await fetchWithTimeout(submittedUrl);
	} catch (err) {
		throw toDiscoveryError(err);
	}

	const contentType = getContentType(response);
	const bodyText = contentType.includes('text/html')
		? await readResponseText(response, { maxBytes: MAX_HTML_BYTES, stopRegex: /<\/head>/i })
		: await response.text();

	const directCandidate = tryParseDirectFeed(submittedUrl, bodyText, contentType);
	if (directCandidate) {
		return { kind: 'direct', submittedUrl, candidate: directCandidate };
	}

	if (!looksLikeHtml(bodyText, contentType)) {
		throw new AddFeedError('invalid_target', ADD_FEED_MESSAGES.invalidTarget);
	}

	const discoveredCandidates = await discoverWebsiteFeedCandidates(submittedUrl, bodyText);
	if (discoveredCandidates.length === 0) {
		return { kind: 'none', submittedUrl };
	}

	if (discoveredCandidates.length === 1) {
		return { kind: 'single', submittedUrl, candidate: discoveredCandidates[0] };
	}

	return { kind: 'multiple', submittedUrl, candidates: discoveredCandidates };
}

/**
 * Validate and preview a direct feed URL. Used by the website fallback input.
 *
 * @param {string} rawUrl
 * @returns {Promise<FeedCandidate>}
 */
export async function previewDirectFeedUrl(rawUrl) {
	const submittedUrl = canonicalizeHttpUrl(rawUrl);
	if (!submittedUrl) {
		throw new AddFeedError('invalid_url', ADD_FEED_MESSAGES.invalidUrl);
	}

	let response;
	try {
		response = await fetchWithTimeout(submittedUrl);
	} catch (err) {
		throw toDiscoveryError(err);
	}

	const contentType = getContentType(response);
	const bodyText = await response.text();
	const candidate = tryParseDirectFeed(submittedUrl, bodyText, contentType);
	if (!candidate) {
		throw new AddFeedError('invalid_target', ADD_FEED_MESSAGES.invalidTarget);
	}
	return candidate;
}

/**
 * @param {string} submittedUrl
 * @param {string} bodyText
 * @param {string} contentType
 * @returns {FeedCandidate|null}
 */
function tryParseDirectFeed(submittedUrl, bodyText, contentType) {
	try {
		const preview = parseFeedPreview(bodyText);
		if (!preview) {
			return null;
		}

		return {
			xmlUrl: submittedUrl,
			title: preview.title,
			description: preview.description,
			htmlUrl: preview.htmlUrl,
			type: preview.type,
			lastBuildDate: preview.lastBuildDate,
		};
	} catch (err) {
		if (looksLikeFeedContent(bodyText, contentType)) {
			console.error('Feed preview parse failed:', submittedUrl, err);
			throw new AddFeedError('feed_parse', ADD_FEED_MESSAGES.feedParseError, err);
		}
		return null;
	}
}

/**
 * @param {string} siteUrl
 * @param {string} htmlText
 * @returns {Promise<FeedCandidate[]>}
 */
async function discoverWebsiteFeedCandidates(siteUrl, htmlText) {
	const pageTitle = extractHtmlTitle(htmlText);
	const discoveredUrls = new Map();

	for (const candidateUrl of extractLinkedFeedUrls(siteUrl, htmlText)) {
		discoveredUrls.set(normalizeUrlForComparison(candidateUrl), candidateUrl);
	}

	for (const candidateUrl of buildCommonFeedUrls(siteUrl)) {
		discoveredUrls.set(normalizeUrlForComparison(candidateUrl), candidateUrl);
	}

	/** @type {FeedCandidate[]} */
	const candidates = [];
	for (const candidateUrl of discoveredUrls.values()) {
		const candidate = await fetchCandidatePreview(candidateUrl, pageTitle);
		if (candidate) {
			candidates.push(candidate);
		}
	}

	return candidates;
}

/**
 * @param {string} candidateUrl
 * @param {string|null} pageTitle
 * @returns {Promise<FeedCandidate|null>}
 */
async function fetchCandidatePreview(candidateUrl, pageTitle) {
	try {
		const response = await fetchWithTimeout(candidateUrl);
		if (!response.ok) {
			return null;
		}

		const bodyText = await response.text();
		const preview = parseFeedPreview(bodyText);
		if (!preview) {
			return null;
		}

		return {
			xmlUrl: candidateUrl,
			title: preview.title ?? pageTitle,
			description: preview.description,
			htmlUrl: preview.htmlUrl,
			type: preview.type,
			lastBuildDate: preview.lastBuildDate,
		};
	} catch (err) {
		const message = String(err?.message || err);
		if (!message.startsWith('HTTP ')) {
			console.error('Skipping discovered candidate after preview failure:', candidateUrl, err);
		}
		return null;
	}
}

/**
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url) {
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

		return response;
	} catch (err) {
		if (err.name === 'AbortError') {
			throw new AddFeedError('timeout', ADD_FEED_MESSAGES.timeout, err);
		}
		throw err;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Read a response body incrementally so website scraping does not need the
 * entire document.
 *
 * @param {Response} response
 * @param {{ maxBytes: number, stopRegex?: RegExp }} options
 * @returns {Promise<string>}
 */
async function readResponseText(response, { maxBytes, stopRegex }) {
	if (!response.body) {
		return await response.text();
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytesRead = 0;
	let text = '';

	while (bytesRead < maxBytes) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		bytesRead += value.byteLength;
		text += decoder.decode(value, { stream: true });

		if (stopRegex && stopRegex.test(text)) {
			break;
		}
	}

	text += decoder.decode();
	return text;
}

/**
 * @param {string} siteUrl
 * @param {string} htmlText
 * @returns {string[]}
 */
function extractLinkedFeedUrls(siteUrl, htmlText) {
	const results = [];
	const linkTagRegex = /<link\b[^>]*>/gi;
	const hrefRegex = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;
	const relRegex = /\brel\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;
	const typeRegex = /\btype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;

	for (const tag of htmlText.match(linkTagRegex) ?? []) {
		const hrefMatch = tag.match(hrefRegex);
		if (!hrefMatch) {
			continue;
		}

		const relValue = getAttributeValue(tag.match(relRegex));
		const typeValue = getAttributeValue(tag.match(typeRegex));
		const relTokens = relValue ? relValue.toLowerCase().split(/\s+/) : [];
		const isFeedRel = relTokens.includes('alternate') || relTokens.includes('feed');
		const isFeedType = typeValue === 'application/rss+xml' || typeValue === 'application/atom+xml';

		if (!isFeedRel && !isFeedType) {
			continue;
		}

		const resolved = resolveUrl(siteUrl, getAttributeValue(hrefMatch));
		if (resolved) {
			results.push(resolved);
		}
	}

	return results;
}

/**
 * @param {string} siteUrl
 * @returns {string[]}
 */
function buildCommonFeedUrls(siteUrl) {
	return COMMON_FEED_PATHS.map((path) => resolveUrl(siteUrl, path)).filter(Boolean);
}

/**
 * @param {string} baseUrl
 * @param {string|null} href
 * @returns {string|null}
 */
function resolveUrl(baseUrl, href) {
	if (!href) {
		return null;
	}

	try {
		return new URL(href, baseUrl).toString();
	} catch {
		return null;
	}
}

/**
 * @param {RegExpMatchArray|null} match
 * @returns {string|null}
 */
function getAttributeValue(match) {
	if (!match) {
		return null;
	}

	return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * @param {string} htmlText
 * @returns {string|null}
 */
function extractHtmlTitle(htmlText) {
	const match = htmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match) {
		return null;
	}

	return match[1].replace(/\s+/g, ' ').trim() || null;
}

/**
 * @param {Response} response
 * @returns {string}
 */
function getContentType(response) {
	return response.headers.get('content-type')?.toLowerCase() ?? '';
}

/**
 * @param {string} bodyText
 * @param {string} contentType
 * @returns {boolean}
 */
function looksLikeHtml(bodyText, contentType) {
	if (contentType.includes('text/html')) {
		return true;
	}

	return /<html[\s>]|<!doctype html/i.test(bodyText);
}

/**
 * @param {string} bodyText
 * @param {string} contentType
 * @returns {boolean}
 */
function looksLikeFeedContent(bodyText, contentType) {
	if (
		contentType.includes('xml') ||
		contentType.includes('rss') ||
		contentType.includes('atom')
	) {
		return true;
	}

	return /^\s*(<\?xml\b[^>]*\?>)?\s*<(rss|feed)\b/i.test(bodyText);
}

/**
 * @param {unknown} err
 * @returns {AddFeedError}
 */
function toDiscoveryError(err) {
	if (err instanceof AddFeedError) {
		return err;
	}

	return new AddFeedError('unreachable_url', ADD_FEED_MESSAGES.unreachableUrl, err);
}
