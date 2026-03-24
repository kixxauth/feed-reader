import { renderLayout } from '../layout.js';
import { escapeHtml } from '../html-utils.js';

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
 *   errorHtml?: string|null,
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
	const enteredUrl = state.enteredUrl ?? '';
	const fallbackUrl = state.fallbackUrl ?? '';
	const selectionState = state.selectionState ?? null;
	const confirmationState = state.confirmationState ?? null;

	const alertHtml = state.errorHtml
		? `<div class="notice notice-error">${state.errorHtml}</div>`
		: state.errorMessage
			? `<div class="notice notice-error">${escapeHtml(state.errorMessage)}</div>`
			: '';

	let content = `<main class="add-feed-page">
  <h1>Add Feed</h1>
  ${alertHtml}
  ${buildUrlForm(enteredUrl)}
  <p><a href="/feeds">Back</a></p>`;

	if (state.showFallbackInput) {
		content += `
  <section class="add-feed-fallback">
    <h2>Try a Direct Feed URL</h2>
    <form method="POST" action="/api/feeds/add" class="add-feed-form">
      <input type="hidden" name="intent" value="fallback">
      <input type="hidden" name="sourceUrl" value="${escapeHtml(enteredUrl)}">
      <label for="fallback-url">Feed URL</label>
      <input id="fallback-url" name="fallbackUrl" type="url" value="${escapeHtml(fallbackUrl)}" required>
      <button type="submit">Submit Feed URL</button>
    </form>
  </section>`;
	}

	if (selectionState) {
		content += buildSelectionSection(selectionState);
	}

	if (confirmationState) {
		content += buildConfirmationSection(confirmationState);
	}

	content += '\n</main>';

	return c.html(
		renderLayout({
			title: 'Add Feed — Feed Reader',
			content,
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

function buildUrlForm(enteredUrl) {
	return `<form method="POST" action="/api/feeds/add" class="add-feed-form">
    <input type="hidden" name="intent" value="submit">
    <label for="feed-url">URL</label>
    <input id="feed-url" name="url" type="url" value="${escapeHtml(enteredUrl)}" required>
    <button type="submit">Submit</button>
  </form>`;
}

function buildSelectionSection(selectionState) {
	const serializedSelectionState = serializeAddFeedState(selectionState);
	const items = selectionState.candidates
		.map((candidate) => {
			const title = candidate.title ?? candidate.xmlUrl;
			const description = candidate.description
				? `<p>${escapeHtml(candidate.description)}</p>`
				: '';
			return `<li class="feed-candidate-card">
    <div class="feed-candidate-meta">
      <strong>${escapeHtml(title)}</strong>
      <span class="feed-candidate-type">${escapeHtml(candidate.type.toUpperCase())}</span>
      ${description}
      <code>${escapeHtml(candidate.xmlUrl)}</code>
    </div>
    <form method="POST" action="/api/feeds/add">
      <input type="hidden" name="intent" value="select">
      <input type="hidden" name="selectionState" value="${escapeHtml(serializedSelectionState)}">
      <input type="hidden" name="selectedXmlUrl" value="${escapeHtml(candidate.xmlUrl)}">
      <button type="submit">Select</button>
    </form>
  </li>`;
		})
		.join('\n');

	return `
  <section class="add-feed-selection">
    <h2>Select a Feed</h2>
    <ul class="feed-candidate-list">
${items}
    </ul>
    <form method="GET" action="/feeds/add">
      <input type="hidden" name="url" value="${escapeHtml(selectionState.sourceUrl)}">
      <button type="submit">Back</button>
    </form>
  </section>`;
}

function buildConfirmationSection(confirmationState) {
	const candidate = confirmationState.candidate;
	const title = candidate.title ?? candidate.xmlUrl;
	const descriptionRow = candidate.description
		? `\n    <div class="feed-meta-row"><span class="feed-meta-label">Description:</span> <span>${escapeHtml(candidate.description)}</span></div>`
		: '';
	const websiteRow = candidate.htmlUrl
		? `\n    <div class="feed-meta-row"><span class="feed-meta-label">Website:</span> <a href="${escapeHtml(candidate.htmlUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate.htmlUrl)}</a></div>`
		: '';

	const previewState = serializeAddFeedState(confirmationState);

	const backControl = confirmationState.backMode === 'selection' && confirmationState.selectionState
		? `<form method="POST" action="/api/feeds/add">
      <input type="hidden" name="intent" value="show-selection">
      <input type="hidden" name="selectionState" value="${escapeHtml(confirmationState.selectionState)}">
      <button type="submit">Back</button>
    </form>`
		: `<form method="GET" action="/feeds/add">
      <input type="hidden" name="url" value="${escapeHtml(confirmationState.sourceUrl)}">
      <button type="submit">Back</button>
    </form>`;

	return `
  <section class="add-feed-confirmation">
    <h2>Confirm Feed</h2>
    <div class="feed-meta">
      <div class="feed-meta-row"><span class="feed-meta-label">Title:</span> <span>${escapeHtml(title)}</span></div>
      <div class="feed-meta-row"><span class="feed-meta-label">Feed type:</span> <span>${escapeHtml(candidate.type.toUpperCase())}</span></div>${descriptionRow}${websiteRow}
      <div class="feed-meta-row"><span class="feed-meta-label">Feed URL:</span> <code>${escapeHtml(candidate.xmlUrl)}</code></div>
    </div>
    <div class="feed-actions">
      <form method="POST" action="/api/feeds/add">
        <input type="hidden" name="intent" value="confirm">
        <input type="hidden" name="previewState" value="${escapeHtml(previewState)}">
        <button type="submit">Confirm</button>
      </form>
      ${backControl}
    </div>
  </section>`;
}
