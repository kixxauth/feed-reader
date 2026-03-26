import { html, raw } from 'hono/html';

/**
 * Builds the URL submission form.
 *
 * @param {string} enteredUrl
 * @returns {import('hono/html').HtmlEscapedString}
 */
function buildUrlForm(enteredUrl) {
	return html`<form method="POST" action="/api/feeds/add">
    <input type="hidden" name="intent" value="submit">
    <div class="form-group">
        <label class="form-label" for="feed-url">Website or feed URL</label>
        <input class="form-input" id="feed-url" name="url" type="url" value="${enteredUrl}"
            placeholder="https://example.com" required>
    </div>
    <button class="btn btn--primary" type="submit">Discover feeds →</button>
</form>`;
}

/**
 * Builds the multi-feed selection section.
 *
 * @param {{ sourceUrl: string, candidates: Array<object> }} selectionState
 * @param {string} serializedSelectionState
 * @returns {import('hono/html').HtmlEscapedString}
 */
function buildSelectionSection(selectionState, serializedSelectionState) {
	const items = selectionState.candidates.map((candidate) => {
		const title = candidate.title ?? candidate.xmlUrl;
		const description = candidate.description
			? html`<p class="candidate-item__desc">${candidate.description}</p>`
			: html``;

		return html`<li class="candidate-item">
    <div class="candidate-item__body">
        <div class="candidate-item__title">${title}</div>
        <div class="candidate-item__url">${candidate.xmlUrl}</div>
        ${description}
    </div>
    <div class="candidate-item__action">
        <span class="badge badge--type">${candidate.type.toUpperCase()}</span>
        <form method="POST" action="/api/feeds/add" style="margin-top:8px;">
            <input type="hidden" name="intent" value="select">
            <input type="hidden" name="selectionState" value="${serializedSelectionState}">
            <input type="hidden" name="selectedXmlUrl" value="${candidate.xmlUrl}">
            <button class="btn btn--primary btn--sm" type="submit">Select</button>
        </form>
    </div>
</li>`;
	});

	return html`<div class="wizard-step">
    <div class="wizard-step__title">Step 2 — Select a feed</div>
    <ul class="candidate-list">
        ${raw(items.join('\n'))}
    </ul>
    <form method="GET" action="/feeds/add">
        <input type="hidden" name="url" value="${selectionState.sourceUrl}">
        <button class="btn btn--ghost btn--sm" type="submit">← Back</button>
    </form>
</div>`;
}

/**
 * Builds the confirmation section.
 *
 * @param {object} confirmationState
 * @param {string} previewState
 * @returns {import('hono/html').HtmlEscapedString}
 */
function buildConfirmationSection(confirmationState, previewState) {
	const candidate = confirmationState.candidate;
	const title = candidate.title ?? candidate.xmlUrl;

	const descriptionRow = candidate.description ? html`
    <div class="meta-row">
        <span class="meta-row__key">Description</span>
        <span class="meta-row__value" style="font-family:var(--font-sans);font-size:13px;">${candidate.description}</span>
    </div>` : html``;

	const websiteRow = candidate.htmlUrl ? html`
    <div class="meta-row">
        <span class="meta-row__key">Website</span>
        <span class="meta-row__value">
            <a href="${candidate.htmlUrl}" target="_blank" rel="noopener noreferrer">${candidate.htmlUrl}</a>
        </span>
    </div>` : html``;

	let backControl;
	if (confirmationState.backMode === 'selection' && confirmationState.selectionState) {
		backControl = html`<form method="POST" action="/api/feeds/add">
        <input type="hidden" name="intent" value="show-selection">
        <input type="hidden" name="selectionState" value="${confirmationState.selectionState}">
        <button class="btn btn--ghost btn--sm" type="submit">← Back</button>
    </form>`;
	} else {
		backControl = html`<form method="GET" action="/feeds/add">
        <input type="hidden" name="url" value="${confirmationState.sourceUrl}">
        <button class="btn btn--ghost btn--sm" type="submit">← Back</button>
    </form>`;
	}

	return html`<div class="wizard-step">
    <div class="wizard-step__title">Step 3 — Confirm subscription</div>
    <div class="meta-table mb-4">
        <div class="meta-row">
            <span class="meta-row__key">Title</span>
            <span class="meta-row__value" style="font-family:var(--font-serif);font-size:15px;">${title}</span>
        </div>
        <div class="meta-row">
            <span class="meta-row__key">Feed type</span>
            <span class="meta-row__value"><span class="badge badge--type">${candidate.type.toUpperCase()}</span></span>
        </div>${descriptionRow}${websiteRow}
        <div class="meta-row">
            <span class="meta-row__key">Feed URL</span>
            <span class="meta-row__value">${candidate.xmlUrl}</span>
        </div>
    </div>
    <div class="flex gap-2">
        <form method="POST" action="/api/feeds/add">
            <input type="hidden" name="intent" value="confirm">
            <input type="hidden" name="previewState" value="${previewState}">
            <button class="btn btn--primary" type="submit">Confirm &amp; subscribe</button>
        </form>
        ${backControl}
    </div>
</div>`;
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
	const enteredUrl      = state.enteredUrl      ?? '';
	const fallbackUrl     = state.fallbackUrl     ?? '';
	const selectionState  = state.selectionState  ?? null;
	const confirmationState = state.confirmationState ?? null;

	let alertHtml;
	if (state.errorHtml) {
		alertHtml = html`<div class="notice notice--error">${state.errorHtml}</div>`;
	} else if (state.errorMessage) {
		alertHtml = html`<div class="notice notice--error">${state.errorMessage}</div>`;
	} else {
		alertHtml = html``;
	}

	let fallbackSection = html``;
	if (state.showFallbackInput) {
		fallbackSection = html`<div class="wizard-step">
    <div class="wizard-step__title">Try a direct feed URL</div>
    <form method="POST" action="/api/feeds/add">
        <input type="hidden" name="intent" value="fallback">
        <input type="hidden" name="sourceUrl" value="${enteredUrl}">
        <div class="form-group">
            <label class="form-label" for="fallback-url">Direct feed URL</label>
            <input class="form-input" id="fallback-url" name="fallbackUrl" type="url" value="${fallbackUrl}"
                placeholder="https://example.com/feed.xml" required>
        </div>
        <button class="btn btn--primary" type="submit">Submit feed URL →</button>
    </form>
</div>`;
	}

	let selectionSection = html``;
	if (selectionState) {
		selectionSection = buildSelectionSection(selectionState, state.serializedSelectionState ?? '');
	}

	let confirmationSection = html``;
	if (confirmationState) {
		confirmationSection = buildConfirmationSection(confirmationState, state.previewState ?? '');
	}

	return html`<main>
    <div class="page-header">
        <span class="page-header__eyebrow"><a class="back-link" href="/feeds">← Feeds</a></span>
        <h1 class="page-header__title">Add Feed</h1>
        <p class="page-header__subtitle">Paste a website URL or direct RSS/Atom feed URL.</p>
    </div>
    ${alertHtml}
    <div class="wizard-step">
        <div class="wizard-step__title">Step 1 — Enter URL</div>
        ${buildUrlForm(enteredUrl)}
    </div>
    ${fallbackSection}${selectionSection}${confirmationSection}
</main>`;
}
