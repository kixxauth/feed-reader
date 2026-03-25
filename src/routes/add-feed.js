import { raw } from 'hono/html';
import { renderLayout } from '../layout.js';
import { addFeedPage } from '../views/pages/add-feed.js';

/**
 * Render the add-feed page in one of three states:
 * - initial URL form
 * - multi-feed selection
 * - confirmation
 *
 * The flow stays stateless on the server between POSTs by serializing the
 * selected candidate set into hidden form fields. That keeps the add-feed flow
 * inside plain SSR handlers without introducing temporary KV or D1 state.
 *
 * @param {import('hono').Context} c
 * @param {{
 *   enteredUrl?: string,
 *   errorMessage?: string|null,
 *   errorHtml?: import('hono/html').HtmlEscapedString|null,
 *   fallbackUrl?: string,
 *   showFallbackInput?: boolean,
 *   selectionState?: { sourceUrl: string, candidates: Array<object> }|null,
 *   confirmationState?: {
 *     sourceUrl: string,
 *     candidate: {
 *       xmlUrl: string,
 *       title: string|null,
 *       description: string|null,
 *       htmlUrl: string|null,
 *       type: 'rss'|'atom',
 *       lastBuildDate: string|null
 *     },
 *     backMode: 'form'|'selection',
 *     selectionState?: string|null
 *   }|null
 * }} state
 * @param {number} [status=200]
 * @returns {Response}
 */
export function renderAddFeedPage(c, state, status = 200) {
	const selectionState = state.selectionState ?? null;
	const confirmationState = state.confirmationState ?? null;

	// Serialize state values needed by the view for hidden form fields
	const serializedSelectionState = selectionState
		? serializeAddFeedState(selectionState)
		: null;
	const previewState = confirmationState
		? serializeAddFeedState(confirmationState)
		: null;

	// src/routes/api/add-feed.js builds errorHtml as a plain string using escapeHtml()
	// (that file was out of scope for this migration). Wrap it in raw() here so the view
	// renders it as trusted HTML rather than double-escaping it.
	const errorHtml = state.errorHtml != null && typeof state.errorHtml === 'string'
		? raw(state.errorHtml)
		: state.errorHtml ?? null;

	return c.html(
		renderLayout({
			title: 'Add Feed — Feed Reader',
			content: addFeedPage({
				enteredUrl: state.enteredUrl ?? '',
				fallbackUrl: state.fallbackUrl ?? '',
				errorMessage: state.errorMessage ?? null,
				errorHtml,
				showFallbackInput: state.showFallbackInput ?? false,
				selectionState,
				serializedSelectionState,
				confirmationState,
				previewState,
			}),
			isAuthenticated: true,
			currentPath: c.req.path,
		}),
		status
	);
}

export async function handleAddFeedPage(c) {
	return renderAddFeedPage(c, {
		enteredUrl: c.req.query('url') || '',
	});
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function serializeAddFeedState(value) {
	return encodeURIComponent(JSON.stringify(value));
}

/**
 * @param {unknown} rawValue
 * @returns {any|null}
 */
export function deserializeAddFeedState(rawValue) {
	if (typeof rawValue !== 'string' || rawValue.length === 0) {
		return null;
	}

	try {
		return JSON.parse(decodeURIComponent(rawValue));
	} catch {
		return null;
	}
}
