/**
 * RSS/Atom feed XML parser.
 *
 * Exports:
 *   parseFeedXml(xmlText, feedId) — parses RSS 2.0 or Atom 1.0 feed XML and
 *   returns a flat array of article data objects.
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
 * Tracks only title, link, guid, pubDate within <item> elements.
 * All other fields are ignored without buffering.
 *
 * @param {string} xmlText
 * @param {string} feedId
 * @returns {Array<{ id: string|null, link: string|null, title: string|null, published: string|null, updated: null }>}
 * @throws {Error} - If XML is malformed (message starts with "Invalid XML:")
 */
function parseRssFeed(xmlText, feedId) {
	const parser = sax.parser(true, { xmlns: false, trim: false });

	const articles = [];
	let inItem = false;

	// Field buffers for the current item
	let guidBuf = null;
	let linkBuf = null;
	let titleBuf = null;
	let pubDateBuf = null;

	// Which field is currently being buffered (or null)
	let currentField = null;
	let textBuffer = '';

	parser.onerror = (err) => {
		throw new Error('Invalid XML: ' + err.message);
	};

	parser.onopentag = (node) => {
		const tag = normalizeTagName(node.name);

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

		if (!inItem) return;

		// Only track these four fields; ignore everything else
		if (tag === 'title' || tag === 'link' || tag === 'guid' || tag === 'pubdate') {
			currentField = tag;
			textBuffer = '';
		}
		// All other tags: leave currentField as-is (do not start buffering)
	};

	parser.onclosetag = (name) => {
		const tag = normalizeTagName(name);

		if (tag === 'item') {
			// Commit the collected buffers into an article
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
			return;
		}

		if (!inItem) return;

		// On closing a tracked field, commit the buffer
		if (currentField !== null && tag === currentField) {
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
			currentField = null;
			textBuffer = '';
		}
	};

	parser.ontext = (text) => {
		if (inItem && currentField !== null) {
			textBuffer += text;
		}
	};

	parser.oncdata = (text) => {
		if (inItem && currentField !== null) {
			textBuffer += text;
		}
	};

	parser.write(xmlText).close();
	return articles;
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
 * Tracks id, title, published, updated, and link candidates within <entry>
 * elements. Ignores content, summary, author, category, rights.
 *
 * @param {string} xmlText
 * @param {string} feedId
 * @returns {Array<{ id: string|null, link: string|null, title: string|null, published: string|null, updated: string|null }>}
 * @throws {Error} - If XML is malformed (message starts with "Invalid XML:")
 */
function parseAtomFeed(xmlText, feedId) {
	const parser = sax.parser(true, { xmlns: false, trim: false });

	const articles = [];
	let inEntry = false;

	// Field buffers for the current entry
	let atomIdBuf = null;
	let titleBuf = null;
	let publishedBuf = null;
	let updatedBuf = null;
	let links = [];

	// Text buffering state
	let currentField = null;
	let textBuffer = '';

	// Link state: tracking the current <link> element's attributes and text
	let currentLinkHref = null;
	let currentLinkRel = null;
	let inLink = false;

	parser.onerror = (err) => {
		throw new Error('Invalid XML: ' + err.message);
	};

	parser.onopentag = (node) => {
		const tag = normalizeTagName(node.name);

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
			return;
		}

		if (!inEntry) return;

		if (tag === 'link') {
			// Capture href and rel attributes; will buffer text as fallback
			const attrs = node.attributes || {};
			currentLinkHref = normalizeString(attrs.href || null);
			currentLinkRel = normalizeString(attrs.rel || null);
			inLink = true;
			// Buffer text in case there is no href attribute
			currentField = null; // don't use the main currentField for link text
			textBuffer = '';
			return;
		}

		// Tracked text fields
		if (tag === 'id' || tag === 'title' || tag === 'published' || tag === 'updated') {
			currentField = tag;
			textBuffer = '';
			return;
		}

		// Ignored fields: content, summary, author, category, rights — do not set currentField
	};

	parser.onclosetag = (name) => {
		const tag = normalizeTagName(name);

		if (tag === 'entry') {
			// Select the best link from collected candidates
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
			return;
		}

		if (!inEntry) return;

		if (tag === 'link') {
			// Commit link candidate: prefer href attribute, fall back to text content
			let href = currentLinkHref;
			if (href === null) {
				// Use buffered text as fallback
				href = normalizeString(textBuffer);
			}
			links.push({ href, rel: currentLinkRel });
			inLink = false;
			currentLinkHref = null;
			currentLinkRel = null;
			textBuffer = '';
			return;
		}

		// Commit tracked text fields
		if (currentField !== null && tag === currentField) {
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
			currentField = null;
			textBuffer = '';
		}
	};

	parser.ontext = (text) => {
		if (!inEntry) return;
		if (inLink && currentLinkHref === null) {
			// Accumulate text for link fallback
			textBuffer += text;
		} else if (currentField !== null) {
			textBuffer += text;
		}
	};

	parser.oncdata = (text) => {
		if (!inEntry) return;
		if (inLink && currentLinkHref === null) {
			textBuffer += text;
		} else if (currentField !== null) {
			textBuffer += text;
		}
	};

	parser.write(xmlText).close();
	return articles;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
	const format = detectFeedFormat(xmlText);

	if (format === 'rss') {
		return parseRssFeed(xmlText, feedId);
	}

	if (format === 'atom') {
		return parseAtomFeed(xmlText, feedId);
	}

	// Unrecognized root or non-XML input
	return [];
}
