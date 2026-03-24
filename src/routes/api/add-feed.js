import { performFeedCrawl } from '../../crawl.js';
import { createFeed, getFeedByXmlUrl } from '../../db.js';
import {
	ADD_FEED_MESSAGES,
	discoverFeedTargets,
	previewDirectFeedUrl,
	AddFeedError,
} from '../../feed-discovery.js';
import { deriveHostname, canonicalizeHttpUrl, normalizeUrlForComparison } from '../../feed-utils.js';
import { escapeHtml } from '../../html-utils.js';
import {
	deserializeAddFeedState,
	renderAddFeedPage,
	serializeAddFeedState,
} from '../add-feed.js';

/**
 * POST /api/feeds/add — server-rendered add-feed flow.
 *
 * @param {import('hono').Context} c
 * @returns {Promise<Response>}
 */
export async function handleAddFeed(c) {
	const body = await c.req.parseBody();
	const intent = getBodyString(body, 'intent') || 'submit';

	switch (intent) {
		case 'submit':
			return await handleSubmit(c, body);
		case 'fallback':
			return await handleFallback(c, body);
		case 'select':
			return await handleSelect(c, body);
		case 'show-selection':
			return handleShowSelection(c, body);
		case 'confirm':
			return await handleConfirm(c, body);
		default:
			return renderAddFeedPage(c, {
				errorMessage: ADD_FEED_MESSAGES.invalidTarget,
			});
	}
}

async function handleSubmit(c, body) {
	const enteredUrl = getBodyString(body, 'url');

	try {
		const result = await discoverFeedTargets(enteredUrl);

		if (result.kind === 'none') {
			return renderAddFeedPage(c, {
				enteredUrl: result.submittedUrl,
				errorMessage: ADD_FEED_MESSAGES.noFeedsFound,
				showFallbackInput: true,
			});
		}

		if (result.kind === 'multiple') {
			return renderAddFeedPage(c, {
				enteredUrl: result.submittedUrl,
				selectionState: {
					sourceUrl: result.submittedUrl,
					candidates: result.candidates,
				},
			});
		}

		const duplicateFeed = await getFeedByXmlUrl(c.env.DB, result.candidate.xmlUrl);
		if (duplicateFeed) {
			return renderDuplicateFeedError(c, result.submittedUrl, duplicateFeed);
		}

		return renderAddFeedPage(c, {
			enteredUrl: result.submittedUrl,
			confirmationState: {
				sourceUrl: result.submittedUrl,
				candidate: result.candidate,
				backMode: 'form',
			},
		});
	} catch (err) {
		return renderDiscoveryError(c, enteredUrl, err);
	}
}

async function handleFallback(c, body) {
	const sourceUrl = getBodyString(body, 'sourceUrl');
	const fallbackUrl = getBodyString(body, 'fallbackUrl');

	try {
		const candidate = await previewDirectFeedUrl(fallbackUrl);
		const duplicateFeed = await getFeedByXmlUrl(c.env.DB, candidate.xmlUrl);
		if (duplicateFeed) {
			return renderDuplicateFeedError(c, sourceUrl || fallbackUrl, duplicateFeed, {
				showFallbackInput: true,
				fallbackUrl: fallbackUrl,
			});
		}

		return renderAddFeedPage(c, {
			enteredUrl: sourceUrl || fallbackUrl,
			confirmationState: {
				sourceUrl: sourceUrl || fallbackUrl,
				candidate,
				backMode: 'form',
			},
		});
	} catch (err) {
		return renderDiscoveryError(c, sourceUrl || fallbackUrl, err, {
			showFallbackInput: true,
			fallbackUrl,
		});
	}
}

async function handleSelect(c, body) {
	const selectionState = deserializeAddFeedState(getBodyString(body, 'selectionState'));
	const selectedXmlUrl = normalizeUrlForComparison(getBodyString(body, 'selectedXmlUrl'));

	if (!selectionState || !Array.isArray(selectionState.candidates)) {
		return renderAddFeedPage(c, {
			errorMessage: ADD_FEED_MESSAGES.invalidTarget,
		});
	}

	const candidate = selectionState.candidates.find((item) => normalizeUrlForComparison(item.xmlUrl) === selectedXmlUrl);
	if (!candidate) {
		return renderAddFeedPage(c, {
			enteredUrl: selectionState.sourceUrl,
			selectionState,
			errorMessage: ADD_FEED_MESSAGES.invalidTarget,
		});
	}

	const duplicateFeed = await getFeedByXmlUrl(c.env.DB, candidate.xmlUrl);
	if (duplicateFeed) {
		return renderDuplicateFeedError(c, selectionState.sourceUrl, duplicateFeed, {
			selectionState,
		});
	}

	return renderAddFeedPage(c, {
		enteredUrl: selectionState.sourceUrl,
		confirmationState: {
			sourceUrl: selectionState.sourceUrl,
			candidate,
			backMode: 'selection',
			selectionState: serializeAddFeedState(selectionState),
		},
	});
}

function handleShowSelection(c, body) {
	const selectionState = deserializeAddFeedState(getBodyString(body, 'selectionState'));
	if (!selectionState || !Array.isArray(selectionState.candidates)) {
		return renderAddFeedPage(c, {
			errorMessage: ADD_FEED_MESSAGES.invalidTarget,
		});
	}

	return renderAddFeedPage(c, {
		enteredUrl: selectionState.sourceUrl,
		selectionState,
	});
}

async function handleConfirm(c, body) {
	const previewState = deserializeAddFeedState(getBodyString(body, 'previewState'));
	if (!previewState || !previewState.candidate) {
		return renderAddFeedPage(c, {
			errorMessage: ADD_FEED_MESSAGES.invalidTarget,
		});
	}

	const candidate = previewState.candidate;
	const xmlUrl = canonicalizeHttpUrl(candidate.xmlUrl);
	if (!xmlUrl) {
		return renderAddFeedPage(c, {
			enteredUrl: previewState.sourceUrl,
			errorMessage: ADD_FEED_MESSAGES.invalidUrl,
		});
	}

	const duplicateFeed = await getFeedByXmlUrl(c.env.DB, xmlUrl);
	if (duplicateFeed) {
		return renderDuplicateFeedError(c, previewState.sourceUrl, duplicateFeed, {
			confirmationState: previewState,
		});
	}

	const feedId = crypto.randomUUID();
	const crawlRunId = crypto.randomUUID();

	try {
		await createFeed(c.env.DB, {
			id: feedId,
			hostname: deriveHostname(candidate.htmlUrl, xmlUrl),
			type: candidate.type,
			title: candidate.title ?? deriveHostname(candidate.htmlUrl, xmlUrl),
			xml_url: xmlUrl,
			html_url: candidate.htmlUrl,
			no_crawl: 0,
			description: candidate.description,
			last_build_date: candidate.lastBuildDate,
			score: null,
		});
	} catch (err) {
		if (isDuplicateXmlUrlError(err)) {
			const existingFeed = await getFeedByXmlUrl(c.env.DB, xmlUrl);
			if (existingFeed) {
				return renderDuplicateFeedError(c, previewState.sourceUrl, existingFeed, {
					confirmationState: previewState,
				});
			}
		}

		console.error('Failed to create feed:', err);
		return renderAddFeedPage(c, {
			enteredUrl: previewState.sourceUrl,
			errorMessage: ADD_FEED_MESSAGES.invalidTarget,
		});
	}

	c.executionCtx.waitUntil(
		performFeedCrawl(c.env.DB, feedId, crawlRunId).catch((err) => {
			console.error('Immediate feed crawl failed:', feedId, err);
		})
	);

	const redirectUrl = new URL('/feeds', c.req.url);
	redirectUrl.searchParams.set('addedFeedId', feedId);
	redirectUrl.searchParams.set('crawlRunId', crawlRunId);
	return c.redirect(`${redirectUrl.pathname}${redirectUrl.search}`, 303);
}

function renderDiscoveryError(c, enteredUrl, err, extraState = {}) {
	if (err instanceof AddFeedError) {
		return renderAddFeedPage(c, {
			enteredUrl: enteredUrl || '',
			errorMessage: err.message,
			...extraState,
		});
	}

	console.error('Unexpected add-feed discovery error:', err);
	return renderAddFeedPage(c, {
		enteredUrl: enteredUrl || '',
		errorMessage: ADD_FEED_MESSAGES.unreachableUrl,
		...extraState,
	});
}

function renderDuplicateFeedError(c, enteredUrl, duplicateFeed, extraState = {}) {
	const duplicateHtml = `This feed is already in your subscriptions. <a href="/feeds/${escapeHtml(duplicateFeed.id)}">View existing feed</a>`;
	return renderAddFeedPage(c, {
		enteredUrl: enteredUrl || '',
		errorHtml: duplicateHtml,
		...extraState,
	});
}

function isDuplicateXmlUrlError(err) {
	const message = String(err?.message || err);
	return message.includes('idx_feeds_xml_url_normalized_unique') || message.includes('UNIQUE constraint failed');
}

function getBodyString(body, key) {
	const value = body[key];
	return typeof value === 'string' ? value : '';
}
