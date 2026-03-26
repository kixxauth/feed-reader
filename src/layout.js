import { html, raw } from 'hono/html';
import styles from './styles.css';

/**
 * Maps a request path to an active nav section identifier.
 * Returns one of: 'home', 'feeds', 'crawl-history', 'reader', or null.
 */
function getActiveSection(currentPath) {
	if (!currentPath) {
		return null;
	}
	if (currentPath === '/') {
		return 'home';
	}
	if (currentPath.startsWith('/feeds') || currentPath.startsWith('/api/feeds')) {
		return 'feeds';
	}
	if (currentPath.startsWith('/crawl-history')) {
		return 'crawl-history';
	}
	if (currentPath.startsWith('/reader')) {
		return 'reader';
	}
	return null;
}

export function renderLayout({ title, content, isAuthenticated = false, currentPath }) {
	const fonts = raw(`<link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,300..700&display=swap" rel="stylesheet">`);

	if (isAuthenticated) {
		const activeSection = getActiveSection(currentPath);

		const homeAttrs   = activeSection === 'home'          ? raw(' aria-current="page"') : raw('');
		const readerAttrs = activeSection === 'reader'        ? raw(' aria-current="page"') : raw('');
		const feedsAttrs  = activeSection === 'feeds'         ? raw(' aria-current="page"') : raw('');
		const crawlAttrs  = activeSection === 'crawl-history' ? raw(' aria-current="page"') : raw('');

		return html`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${fonts}
    <style>${raw(styles)}</style>
</head>
<body>
    <div class="app-shell">
        <aside class="sidebar">
            <div class="sidebar__brand">
                <span class="sidebar__brand-name">Feed Reader</span>
                <span class="sidebar__brand-rule"></span>
            </div>
            <nav class="sidebar__nav" aria-label="Primary">
                <a class="sidebar__nav-item" href="/"${homeAttrs}>
                    <i class="sidebar__nav-icon">⌂</i>Home
                </a>
                <a class="sidebar__nav-item" href="/reader"${readerAttrs}>
                    <i class="sidebar__nav-icon">◈</i>Reader
                </a>
                <a class="sidebar__nav-item" href="/feeds"${feedsAttrs}>
                    <i class="sidebar__nav-icon">≡</i>Feeds
                </a>
                <a class="sidebar__nav-item" href="/crawl-history"${crawlAttrs}>
                    <i class="sidebar__nav-icon">◷</i>History
                </a>
            </nav>
            <div class="sidebar__footer">
                <nav aria-label="Account">
                    <a href="/logout">Sign out</a>
                </nav>
            </div>
        </aside>
        <div class="page-content">
            ${content}
        </div>
    </div>
</body>
</html>`;
	}

	return html`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${fonts}
    <style>${raw(styles)}</style>
</head>
<body>
    ${content}
</body>
</html>`;
}
