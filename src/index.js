import { Hono } from 'hono';
import styles from './styles.css';

const app = new Hono();

app.get('/', (c) => {
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Feed Reader</title>
    <style>${styles}</style>
</head>
<body>
    <h1>Hello World!</h1>
</body>
</html>`);
});

export default app;
