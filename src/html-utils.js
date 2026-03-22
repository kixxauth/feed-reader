/**
 * Escape special HTML characters to prevent XSS when interpolating
 * untrusted data (titles, hostnames, URLs) into HTML templates.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
