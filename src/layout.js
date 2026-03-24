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
	let nav = '';

	if (isAuthenticated) {
		const activeSection = getActiveSection(currentPath);

		const homeAttrs = activeSection === 'home'
			? ' class="nav-link-active" aria-current="page"'
			: '';
		const feedsAttrs = activeSection === 'feeds'
			? ' class="nav-link-active" aria-current="page"'
			: '';
		const crawlAttrs = activeSection === 'crawl-history'
			? ' class="nav-link-active" aria-current="page"'
			: '';
		const readerAttrs = activeSection === 'reader'
			? ' class="nav-link-active" aria-current="page"'
			: '';

		nav = `<header>
    <nav aria-label="Primary">
        <a href="/"${homeAttrs}>Home</a>
        <a href="/feeds"${feedsAttrs}>Feeds List</a>
        <a href="/crawl-history"${crawlAttrs}>Crawl History</a>
        <a href="/reader"${readerAttrs}>Reader</a>
    </nav>
    <nav aria-label="Account">
        <a href="/logout">Logout</a>
    </nav>
</header>`;
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>${styles}</style>
</head>
<body>
    ${nav}
    ${content}
</body>
</html>`;
}
