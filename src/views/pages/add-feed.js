import { html, raw } from 'hono/html';

/**
 * Builds the URL submission form.
 *
 * @param {string} enteredUrl
 * @returns {import('hono/html').HtmlEscapedString}
 */
function buildUrlForm(enteredUrl) {
	return html`<form method="POST" action="/api/feeds/add" class="add-feed-form">
    <input type="hidden" name="intent" value="submit">
    <label for="feed-url">URL</label>
    <input id="feed-url" name="url" type="url" value="${enteredUrl}" required>
    <button type="submit">Submit</button>
  </form>`;
}

/**
 * Builds the multi-feed selection section.
 *
 * @param {{ sourceUrl: string, candidates: Array<object> }} selectionState
 * @param {string} serializedSelectionState - Already URL-encoded JSON from serializeAddFeedState
 * @returns {import('hono/html').HtmlEscapedString}
 */
function buildSelectionSection(selectionState, serializedSelectionState) {
	const items = selectionState.candidates.map((candidate) => {
		const title = candidate.title ?? candidate.xmlUrl;
		const description = candidate.description
			? html`<p>${candidate.description}</p>`
			: html``;

		return html`<li class="feed-candidate-card">
    <div class="feed-candidate-meta">
      <strong>${title}</strong>
      <span class="feed-candidate-type">${candidate.type.toUpperCase()}</span>
      ${description}
      <code>${candidate.xmlUrl}</code>
    </div>
    <form method="POST" action="/api/feeds/add">
      <input type="hidden" name="intent" value="select">
      <input type="hidden" name="selectionState" value="${serializedSelectionState}">
      <input type="hidden" name="selectedXmlUrl" value="${candidate.xmlUrl}">
      <button type="submit">Select</button>
    </form>
  </li>`;
	});

	return html`
  <section class="add-feed-selection">
    <h2>Select a Feed</h2>
    <ul class="feed-candidate-list">
${raw(items.join('\n'))}
    </ul>
    <form method="GET" action="/feeds/add">
      <input type="hidden" name="url" value="${selectionState.sourceUrl}">
      <button type="submit">Back</button>
    </form>
  </section>`;
}

/**
 * Builds the confirmation section.
 *
 * @param {object} confirmationState
 * @param {string} previewState - Already serialized state from serializeAddFeedState
 * @returns {import('hono/html').HtmlEscapedString}
 */
function buildConfirmationSection(confirmationState, previewState) {
	const candidate = confirmationState.candidate;
	const title = candidate.title ?? candidate.xmlUrl;

	const descriptionRow = candidate.description
		? html`
    <div class="feed-meta-row"><span class="feed-meta-label">Description:</span> <span>${candidate.description}</span></div>`
		: html``;

	const websiteRow = candidate.htmlUrl
		? html`
    <div class="feed-meta-row"><span class="feed-meta-label">Website:</span> <a href="${candidate.htmlUrl}" target="_blank" rel="noopener noreferrer">${candidate.htmlUrl}</a></div>`
		: html``;

	let backControl;
	if (confirmationState.backMode === 'selection' && confirmationState.selectionState) {
		backControl = html`<form method="POST" action="/api/feeds/add">
      <input type="hidden" name="intent" value="show-selection">
      <input type="hidden" name="selectionState" value="${confirmationState.selectionState}">
      <button type="submit">Back</button>
    </form>`;
	} else {
		backControl = html`<form method="GET" action="/feeds/add">
      <input type="hidden" name="url" value="${confirmationState.sourceUrl}">
      <button type="submit">Back</button>
    </form>`;
	}

	return html`
  <section class="add-feed-confirmation">
    <h2>Confirm Feed</h2>
    <div class="feed-meta">
      <div class="feed-meta-row"><span class="feed-meta-label">Title:</span> <span>${title}</span></div>
      <div class="feed-meta-row"><span class="feed-meta-label">Feed type:</span> <span>${candidate.type.toUpperCase()}</span></div>${descriptionRow}${websiteRow}
      <div class="feed-meta-row"><span class="feed-meta-label">Feed URL:</span> <code>${candidate.xmlUrl}</code></div>
    </div>
    <div class="feed-actions">
      <form method="POST" action="/api/feeds/add">
        <input type="hidden" name="intent" value="confirm">
        <input type="hidden" name="previewState" value="${previewState}">
        <button type="submit">Confirm</button>
      </form>
      ${backControl}
    </div>
  </section>`;
}

/**
 * Renders the full add-feed page content in one of several states.
 *
 * @param {{
 *   enteredUrl?: string,
 *   errorMessage?: string|null,
 *   errorHtml?: import('hono/html').HtmlEscapedString|null,
 *   fallbackUrl?: string,
 *   showFallbackInput?: boolean,
 *   selectionState?: { sourceUrl: string, candidates: Array<object> }|null,
 *   serializedSelectionState?: string|null,
 *   confirmationState?: object|null,
 *   previewState?: string|null
 * }} state
 * @returns {import('hono/html').HtmlEscapedString}
 */
export function addFeedPage(state) {
	const enteredUrl = state.enteredUrl ?? '';
	const fallbackUrl = state.fallbackUrl ?? '';
	const selectionState = state.selectionState ?? null;
	const confirmationState = state.confirmationState ?? null;

	// errorHtml is a pre-built HtmlEscapedString from the caller (trusted HTML for
	// duplicate-feed notices). errorMessage is a plain string and will be auto-escaped
	// by the html tag. Only one is expected to be set at a time.
	let alertHtml;
	if (state.errorHtml) {
		// state.errorHtml is already an HtmlEscapedString — nesting it is safe (no double-escaping)
		alertHtml = html`<div class="notice notice-error">${state.errorHtml}</div>`;
	} else if (state.errorMessage) {
		alertHtml = html`<div class="notice notice-error">${state.errorMessage}</div>`;
	} else {
		alertHtml = html``;
	}

	let fallbackSection = html``;
	if (state.showFallbackInput) {
		fallbackSection = html`
  <section class="add-feed-fallback">
    <h2>Try a Direct Feed URL</h2>
    <form method="POST" action="/api/feeds/add" class="add-feed-form">
      <input type="hidden" name="intent" value="fallback">
      <input type="hidden" name="sourceUrl" value="${enteredUrl}">
      <label for="fallback-url">Feed URL</label>
      <input id="fallback-url" name="fallbackUrl" type="url" value="${fallbackUrl}" required>
      <button type="submit">Submit Feed URL</button>
    </form>
  </section>`;
	}

	let selectionSection = html``;
	if (selectionState) {
		selectionSection = buildSelectionSection(selectionState, state.serializedSelectionState ?? '');
	}

	let confirmationSection = html``;
	if (confirmationState) {
		confirmationSection = buildConfirmationSection(confirmationState, state.previewState ?? '');
	}

	return html`<main class="add-feed-page">
  <h1>Add Feed</h1>
  ${alertHtml}
  ${buildUrlForm(enteredUrl)}
  <p><a href="/feeds">Back</a></p>${fallbackSection}${selectionSection}${confirmationSection}
</main>`;
}
