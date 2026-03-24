/**
 * Shared helpers for feed and website URLs.
 */

/**
 * Parse an HTTP/HTTPS URL and return a URL instance, or null when invalid.
 *
 * @param {unknown} value
 * @returns {URL|null}
 */
export function parseHttpUrl(value) {
	const trimmed = String(value ?? '').trim();
	if (trimmed.length === 0) {
		return null;
	}

	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return null;
		}
		return url;
	} catch {
		return null;
	}
}

/**
 * Canonical string form used for storage and fetches.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function canonicalizeHttpUrl(value) {
	const url = parseHttpUrl(value);
	return url ? url.toString() : null;
}

/**
 * Normalized comparison form used for duplicate checks.
 *
 * The duplicate rules for this app are intentionally case-insensitive and trim
 * surrounding whitespace to match the product requirements.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeUrlForComparison(value) {
	const canonical = canonicalizeHttpUrl(value);
	return canonical ? canonical.toLowerCase() : null;
}

/**
 * Resolve a possibly-relative article URL against a base URL.
 *
 * Handles three cases:
 *   1. link is already absolute (has protocol) — returned as-is via canonicalizeHttpUrl.
 *   2. link is relative (e.g. "/path/to/article") and a valid baseUrl is available —
 *      resolved using the URL constructor's two-argument form.
 *   3. link is null/empty or baseUrl is unavailable — returns the link unchanged
 *      (may still be null or a bare path, but we avoid losing data).
 *
 * @param {string|null|undefined} link - The article link from the feed XML
 * @param {string|null|undefined} baseUrl - The feed's html_url or xml_url to resolve against
 * @returns {string|null}
 */
export function resolveArticleUrl(link, baseUrl) {
	if (!link) {
		return null;
	}

	const trimmed = String(link).trim();
	if (trimmed.length === 0) {
		return null;
	}

	const absolute = canonicalizeHttpUrl(trimmed);
	if (absolute) {
		return absolute;
	}

	const base = parseHttpUrl(baseUrl);
	if (!base) {
		return trimmed;
	}

	try {
		const resolved = new URL(trimmed, base);
		if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
			return resolved.toString();
		}
	} catch {
		// malformed relative URL — return as-is
	}

	return trimmed;
}

/**
 * Derive the hostname shown in the feeds list from an HTML or XML URL.
 *
 * @param {string|null|undefined} preferredUrl
 * @param {string|null|undefined} fallbackUrl
 * @returns {string}
 */
export function deriveHostname(preferredUrl, fallbackUrl) {
	const preferred = parseHttpUrl(preferredUrl);
	if (preferred) {
		return preferred.hostname;
	}

	const fallback = parseHttpUrl(fallbackUrl);
	return fallback ? fallback.hostname : 'unknown';
}
