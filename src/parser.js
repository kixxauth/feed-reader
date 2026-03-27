/**
 * RSS/Atom feed XML parser.
 *
 * Exports:
 *   parseFeedXml(xmlText, feedId) — parses RSS 2.0 or Atom 1.0 feed XML and
 *   returns a flat array of article data objects.
 *   parseFeedPreview(xmlText) — parses feed-level metadata used by the add-feed flow
 *
 * ## Design notes
 *
 * **Why sax instead of a tree-building parser?**
 * The previous fast-xml-parser implementation accumulated the entire parsed
 * document into a JS object, including large ignored fields like
 * <content:encoded> and <summary>. Feeds with multi-megabyte bodies in those
 * fields caused memory pressure and parse failures. sax emits events without
 * building a tree, so ignored fields are never buffered into application memory.
 *
 * **Two-pass format detection**
 * parseFeedXml calls detectFeedFormat first (a cheap regex scanner), then
 * dispatches to parseRssFeed or parseAtomFeed. The XML is therefore scanned
 * twice. This is intentional: format detection is O(n) on the prologue only,
 * and keeping it separate from parsing keeps the concrete parsers simpler.
 *
 * **SAX strict mode**
 * Both parsers use sax.parser(true, {...}) (strict mode). Strict mode is
 * case-sensitive, preserves tag name casing, and calls onerror for malformed
 * XML. normalizeTagName() handles both case-sensitive strict mode and the
 * uppercasing behavior of non-strict mode uniformly. The onerror handler
 * throws immediately to match the behavior callers expect.
 *
 * **Namespace handling**
 * All tag comparisons go through normalizeTagName(), which strips the prefix
 * and lowercases. This means atom:entry and entry are treated identically,
 * and rss:rss and rss are treated identically. sax's built-in namespace
 * parsing (xmlns option) is NOT used — normalizeTagName is simpler and
 * sufficient for the tag names this parser cares about.
 *
 * **Text buffering**
 * SAX may split element text content across multiple ontext callbacks.
 * currentField/textBuffer are reset on field open and committed on field close.
 * Both ontext and oncdata append to textBuffer.
 *
 * **Import form**
 * sax is a CJS package. In this ESM project (type: module), wrangler/esbuild
 * handles CJS interop. The correct import is: import sax from 'sax'
 * (default import). import * as sax from 'sax' does NOT work in the Workers
 * Vitest pool.
 */

import sax from 'sax';
import { canonicalizeHttpUrl } from './feed-utils.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Namespace and tag helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a tag name by stripping any namespace prefix and lowercasing.
 * E.g. "atom:entry" → "entry", "RSS" → "rss", "content:encoded" → "encoded".
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeTagName(name) {
	const colon = name.indexOf(':');
	const localName = colon >= 0 ? name.slice(colon + 1) : name;
	return localName.toLowerCase();
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the XML string is an RSS or Atom feed by finding the first
 * real root element (skipping the XML declaration, comments, and doctypes).
 *
 * Returns 'rss' for local-name "rss", 'atom' for local-name "feed", or null
 * for non-XML input or unrecognized root elements.
 *
 * @param {string} xmlText
 * @returns {'rss'|'atom'|null}
 */
function detectFeedFormat(xmlText) {
	// Strip leading whitespace
	const trimmed = xmlText.trimStart();

	// Use a regex scanner to skip prologue nodes and find the first element tag.
	// We advance through the string position by position.
	let pos = 0;
	const len = trimmed.length;

	while (pos < len) {
		// Skip whitespace
		while (pos < len && /\s/.test(trimmed[pos])) {
			pos++;
		}
		if (pos >= len) break;

		if (trimmed[pos] !== '<') {
			// Not XML at all
			return null;
		}

		pos++; // skip '<'

		if (pos >= len) return null;

		const nextChar = trimmed[pos];

		if (nextChar === '?') {
			// XML declaration or processing instruction: skip to ?>
			const end = trimmed.indexOf('?>', pos);
			if (end < 0) return null;
			pos = end + 2;
		} else if (nextChar === '!') {
			// Comment <!-- ... --> or DOCTYPE <!DOCTYPE ...>
			pos++; // skip '!'
			if (trimmed.startsWith('--', pos)) {
				// Comment: skip to -->
				const end = trimmed.indexOf('-->', pos);
				if (end < 0) return null;
				pos = end + 3;
			} else {
				// DOCTYPE or CDATA: skip to next >
				const end = trimmed.indexOf('>', pos);
				if (end < 0) return null;
				pos = end + 1;
			}
		} else {
			// This is the first real element tag — extract local name
			// Read characters until whitespace, '>', or '/'
			let nameStart = pos;
			while (pos < len && trimmed[pos] !== '>' && trimmed[pos] !== '/' && !/\s/.test(trimmed[pos])) {
				pos++;
			}
			const rawName = trimmed.slice(nameStart, pos);
			if (!rawName) return null;
			const local = normalizeTagName(rawName);
			if (local === 'rss') return 'rss';
			if (local === 'feed') return 'atom';
			return null;
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// RSS parser
// ---------------------------------------------------------------------------

/**
 * Parse an RSS 2.0 feed XML string using sax event-driven parsing.
 *
 * @param {string} xmlText
 * @param {string} feedId
 * @returns {{
 *   metadata: {
 *     type: 'rss',
 *     title: string|null,
 *     description: string|null,
 *     htmlUrl: string|null,
 *     lastBuildDate: string|null
 *   },
 *   articles: Array<{ id: string|null, link: string|null, title: string|null, published: string|null, updated: null }>
 * }}
 * @throws {Error} - If XML is malformed (message starts with "Invalid XML:")
 */
function parseRssFeed(xmlText, feedId) {
	const parser = sax.parser(true, { xmlns: false, trim: false });

	const articles = [];
	const pathStack = [];
	let inItem = false;

	let channelTitleBuf = null;
	let channelDescriptionBuf = null;
	let channelLinkBuf = null;
	let channelLastBuildDateBuf = null;

	let guidBuf = null;
	let linkBuf = null;
	let titleBuf = null;
	let pubDateBuf = null;

	let currentField = null;
	let textBuffer = '';

	parser.onerror = (err) => {
		throw new Error('Invalid XML: ' + err.message);
	};

	parser.onopentag = (node) => {
		const tag = normalizeTagName(node.name);
		pathStack.push(tag);

		if (tag === 'item') {
			inItem = true;
			guidBuf = null;
			linkBuf = null;
			titleBuf = null;
			pubDateBuf = null;
			currentField = null;
			textBuffer = '';
			return;
		}

		const parentTag = pathStack[pathStack.length - 2] ?? null;
		if (inItem && parentTag === 'item') {
			if (tag === 'title' || tag === 'link' || tag === 'guid' || tag === 'pubdate') {
				currentField = tag;
				textBuffer = '';
			}
			return;
		}

		if (!inItem && parentTag === 'channel') {
			if (tag === 'title' || tag === 'description' || tag === 'link' || tag === 'lastbuilddate') {
				currentField = tag;
				textBuffer = '';
			}
		}
	};

	parser.onclosetag = (name) => {
		const tag = normalizeTagName(name);

		if (tag === 'item') {
			const guid = normalizeString(guidBuf);
			const link = normalizeString(linkBuf);
			const title = normalizeString(titleBuf);
			const published = parseDate(pubDateBuf);

			articles.push({
				id: deriveArticleId(feedId, guid, link),
				link,
				title,
				published,
				updated: null,
			});

			inItem = false;
			currentField = null;
			textBuffer = '';
			pathStack.pop();
			return;
		}

		if (currentField !== null && tag === currentField) {
			if (inItem) {
				switch (currentField) {
					case 'title':
						titleBuf = textBuffer;
						break;
					case 'link':
						linkBuf = textBuffer;
						break;
					case 'guid':
						guidBuf = textBuffer;
						break;
					case 'pubdate':
						pubDateBuf = textBuffer;
						break;
				}
			} else {
				switch (currentField) {
					case 'title':
						channelTitleBuf = textBuffer;
						break;
					case 'description':
						channelDescriptionBuf = textBuffer;
						break;
					case 'link':
						channelLinkBuf = textBuffer;
						break;
					case 'lastbuilddate':
						channelLastBuildDateBuf = textBuffer;
						break;
				}
			}
			currentField = null;
			textBuffer = '';
		}

		pathStack.pop();
	};

	parser.ontext = (text) => {
		if (currentField !== null) {
			textBuffer += text;
		}
	};

	parser.oncdata = (text) => {
		if (currentField !== null) {
			textBuffer += text;
		}
	};

	parser.write(xmlText).close();

	return {
		metadata: {
			type: 'rss',
			title: normalizeString(channelTitleBuf),
			description: normalizeString(channelDescriptionBuf),
			htmlUrl: canonicalizeHttpUrl(normalizeString(channelLinkBuf)),
			lastBuildDate: parseDate(channelLastBuildDateBuf),
		},
		articles,
	};
}

// ---------------------------------------------------------------------------
// Atom parser
// ---------------------------------------------------------------------------

/**
 * Select the best link URL from a list of Atom link candidates.
 *
 * Selection order:
 * 1. First candidate where rel === "alternate" or rel is absent.
 * 2. Fall back to first candidate with a non-null URL.
 * 3. Return null if none exist.
 *
 * @param {Array<{ href: string|null, rel: string|null }>} links
 * @returns {string|null}
 */
function selectAtomLink(links) {
	// Prefer rel="alternate" or missing rel
	for (const candidate of links) {
		if (candidate.rel === null || candidate.rel === 'alternate') {
			if (candidate.href !== null) return candidate.href;
		}
	}
	// Fall back to first with any non-null URL
	for (const candidate of links) {
		if (candidate.href !== null) return candidate.href;
	}
	return null;
}

/**
 * Parse an Atom 1.0 feed XML string using sax event-driven parsing.
 *
 * @param {string} xmlText
 * @param {string} feedId
 * @returns {{
 *   metadata: {
 *     type: 'atom',
 *     title: string|null,
 *     description: string|null,
 *     htmlUrl: string|null,
 *     lastBuildDate: string|null
 *   },
 *   articles: Array<{ id: string|null, link: string|null, title: string|null, published: string|null, updated: string|null }>
 * }}
 * @throws {Error} - If XML is malformed (message starts with "Invalid XML:")
 */
function parseAtomFeed(xmlText, feedId) {
	const parser = sax.parser(true, { xmlns: false, trim: false });

	const articles = [];
	const pathStack = [];
	let inEntry = false;

	let feedTitleBuf = null;
	let feedSubtitleBuf = null;
	let feedUpdatedBuf = null;
	let feedLinks = [];

	let atomIdBuf = null;
	let titleBuf = null;
	let publishedBuf = null;
	let updatedBuf = null;
	let links = [];

	let currentField = null;
	let textBuffer = '';
	let currentLinkHref = null;
	let currentLinkRel = null;
	let linkTarget = null;
	let inLink = false;

	parser.onerror = (err) => {
		throw new Error('Invalid XML: ' + err.message);
	};

	parser.onopentag = (node) => {
		const tag = normalizeTagName(node.name);
		pathStack.push(tag);

		if (tag === 'entry') {
			inEntry = true;
			atomIdBuf = null;
			titleBuf = null;
			publishedBuf = null;
			updatedBuf = null;
			links = [];
			currentField = null;
			textBuffer = '';
			inLink = false;
			currentLinkHref = null;
			currentLinkRel = null;
			linkTarget = null;
			return;
		}

		const parentTag = pathStack[pathStack.length - 2] ?? null;

		if (tag === 'link') {
			const attrs = node.attributes || {};
			currentLinkHref = normalizeString(attrs.href || null);
			currentLinkRel = normalizeString(attrs.rel || null);
			linkTarget = inEntry ? 'entry' : parentTag === 'feed' ? 'feed' : null;
			inLink = true;
			currentField = null;
			textBuffer = '';
			return;
		}

		if (inEntry && parentTag === 'entry') {
			if (tag === 'id' || tag === 'title' || tag === 'published' || tag === 'updated') {
				currentField = tag;
				textBuffer = '';
			}
			return;
		}

		if (!inEntry && parentTag === 'feed') {
			if (tag === 'title' || tag === 'subtitle' || tag === 'updated') {
				currentField = tag;
				textBuffer = '';
			}
		}
	};

	parser.onclosetag = (name) => {
		const tag = normalizeTagName(name);

		if (tag === 'entry') {
			const link = selectAtomLink(links);
			const atomId = normalizeString(atomIdBuf);
			const title = normalizeString(titleBuf);
			const published = parseDate(publishedBuf) || parseDate(updatedBuf);
			const updated = parseDate(updatedBuf);

			articles.push({
				id: deriveArticleId(feedId, atomId, link),
				link,
				title,
				published,
				updated,
			});

			inEntry = false;
			currentField = null;
			textBuffer = '';
			inLink = false;
			currentLinkHref = null;
			currentLinkRel = null;
			linkTarget = null;
			pathStack.pop();
			return;
		}

		if (tag === 'link') {
			let href = currentLinkHref;
			if (href === null) {
				href = normalizeString(textBuffer);
			}

			if (linkTarget === 'entry') {
				links.push({ href, rel: currentLinkRel });
			} else if (linkTarget === 'feed') {
				feedLinks.push({ href, rel: currentLinkRel });
			}

			inLink = false;
			currentLinkHref = null;
			currentLinkRel = null;
			linkTarget = null;
			textBuffer = '';
			pathStack.pop();
			return;
		}

		if (currentField !== null && tag === currentField) {
			if (inEntry) {
				switch (currentField) {
					case 'id':
						atomIdBuf = textBuffer;
						break;
					case 'title':
						titleBuf = textBuffer;
						break;
					case 'published':
						publishedBuf = textBuffer;
						break;
					case 'updated':
						updatedBuf = textBuffer;
						break;
				}
			} else {
				switch (currentField) {
					case 'title':
						feedTitleBuf = textBuffer;
						break;
					case 'subtitle':
						feedSubtitleBuf = textBuffer;
						break;
					case 'updated':
						feedUpdatedBuf = textBuffer;
						break;
				}
			}
			currentField = null;
			textBuffer = '';
		}

		pathStack.pop();
	};

	parser.ontext = (text) => {
		if (inLink && currentLinkHref === null) {
			textBuffer += text;
		} else if (currentField !== null) {
			textBuffer += text;
		}
	};

	parser.oncdata = (text) => {
		if (inLink && currentLinkHref === null) {
			textBuffer += text;
		} else if (currentField !== null) {
			textBuffer += text;
		}
	};

	parser.write(xmlText).close();

	return {
		metadata: {
			type: 'atom',
			title: normalizeString(feedTitleBuf),
			description: normalizeString(feedSubtitleBuf),
			htmlUrl: canonicalizeHttpUrl(selectAtomLink(feedLinks)),
			lastBuildDate: parseDate(feedUpdatedBuf),
		},
		articles,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse raw XML text and return both feed-level metadata and articles in one pass.
 * Handles both RSS 2.0 and Atom 1.0.
 *
 * Returns null for unrecognized root elements or non-XML input.
 *
 * @param {string} xmlText - The raw feed XML
 * @param {string} feedId - Used for article id derivation
 * @returns {{
 *   metadata: {
 *     type: 'rss'|'atom',
 *     title: string|null,
 *     description: string|null,
 *     htmlUrl: string|null,
 *     lastBuildDate: string|null
 *   },
 *   articles: Array<{ id: string|null, link: string|null, title: string|null, published: string|null, updated: string|null }>
 * }|null}
 * @throws {Error} - If the XML is malformed (message starts with "Invalid XML:")
 */
export function parseFeed(xmlText, feedId) {
	const format = detectFeedFormat(xmlText);

	if (format === 'rss') {
		return parseRssFeed(xmlText, feedId);
	}

	if (format === 'atom') {
		return parseAtomFeed(xmlText, feedId);
	}

	return null;
}

/**
 * Parse raw XML text and extract a flat array of article data objects.
 * Handles both RSS 2.0 and Atom 1.0.
 *
 * @param {string} xmlText - The raw feed XML
 * @param {string} feedId - Used for article id derivation
 * @returns {Array<{ id: string|null, link: string|null, title: string|null, published: string|null, updated: string|null }>}
 * @throws {Error} - If the XML is malformed (message starts with "Invalid XML:")
 */
export function parseFeedXml(xmlText, feedId) {
	const result = parseFeed(xmlText, feedId);
	return result ? result.articles : [];
}

/**
 * Parse raw XML text and return only the feed-level metadata needed by the
 * add-feed confirmation flow.
 *
 * @param {string} xmlText - The raw feed XML
 * @returns {{
 *   type: 'rss'|'atom',
 *   title: string|null,
 *   description: string|null,
 *   htmlUrl: string|null,
 *   lastBuildDate: string|null
 * }|null}
 * @throws {Error} - If the XML is malformed (message starts with "Invalid XML:")
 */
export function parseFeedPreview(xmlText) {
	const result = parseFeed(xmlText, 'preview-feed');
	return result ? result.metadata : null;
}
