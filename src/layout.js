import styles from './styles.css';

export function renderLayout({ title, content, isAuthenticated = false }) {
	const nav = isAuthenticated
		? `<nav><a href="/crawl-history">Crawl History</a> <a href="/logout">Logout</a></nav>`
		: '';
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
