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
