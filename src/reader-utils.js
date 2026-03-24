/**
 * Shared date helpers for the daily reader view.
 *
 * All date math uses UTC to avoid timezone-shift bugs, matching the
 * timeZone: 'UTC' fix already applied in src/routes/articles.js.
 *
 * Exports:
 *   getTodayUtc()               — returns today's UTC date as YYYY-MM-DD.
 *   parseSelectedDate(raw)      — validates a YYYY-MM-DD string (format + calendar);
 *                                 returns it if valid, or today's UTC date if invalid/absent.
 *   getPreviousDate(dateStr)    — returns the day before the given YYYY-MM-DD string (UTC).
 *   getNextDate(dateStr)        — returns the day after the given YYYY-MM-DD string (UTC).
 *   formatDateForDisplay(dateStr) — formats YYYY-MM-DD as "Tuesday, March 24, 2026" (UTC).
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Return today's UTC date as a YYYY-MM-DD string.
 *
 * @returns {string}
 */
export function getTodayUtc() {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Validate a raw date param and return a YYYY-MM-DD string.
 *
 * Validation is two-stage:
 *   1. Format check — must match /^\d{4}-\d{2}-\d{2}$/.
 *   2. Calendar check — round-trip through Date to reject impossible dates like
 *      2026-02-30 (which JS parses as 2026-03-02, not the same string).
 *
 * Returns the input unchanged if both checks pass;
 * returns today's UTC date if invalid or absent.
 *
 * @param {string|null|undefined} raw - The raw query-param value
 * @returns {string} A YYYY-MM-DD date string
 */
export function parseSelectedDate(raw) {
	if (raw && DATE_REGEX.test(raw)) {
		const d = new Date(`${raw}T00:00:00.000Z`);
		if (!isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw) {
			return raw;
		}
	}
	return getTodayUtc();
}

/**
 * Given a YYYY-MM-DD string, return the previous day as YYYY-MM-DD (UTC).
 * Correctly crosses month and year boundaries.
 *
 * @param {string} dateStr - A YYYY-MM-DD date string
 * @returns {string} The previous day as YYYY-MM-DD
 */
export function getPreviousDate(dateStr) {
	// Parse as UTC midnight, subtract one day in milliseconds
	const d = new Date(`${dateStr}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}

/**
 * Given a YYYY-MM-DD string, return the next day as YYYY-MM-DD (UTC).
 * Correctly crosses month and year boundaries.
 *
 * @param {string} dateStr - A YYYY-MM-DD date string
 * @returns {string} The next day as YYYY-MM-DD
 */
export function getNextDate(dateStr) {
	const d = new Date(`${dateStr}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

/**
 * Format a YYYY-MM-DD string for page display, e.g. "Tuesday, March 24, 2026".
 * Uses UTC to avoid off-by-one day errors near midnight.
 *
 * @param {string} dateStr - A YYYY-MM-DD date string
 * @returns {string} Human-readable date string
 */
export function formatDateForDisplay(dateStr) {
	const d = new Date(`${dateStr}T00:00:00.000Z`);
	return d.toLocaleDateString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC',
	});
}
