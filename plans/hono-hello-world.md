# Plan: Convert to Hono + Hello World HTML

## Goal

Replace the raw Cloudflare Workers fetch handler with a Hono app that renders a minimal HTML page
displaying "Hello World!". The CSS will be stored in a separate file and imported as a text string
via Wrangler's `rules` configuration (type `"Text"`), then inlined into the HTML `<head>`.

---

## Current State

| File | Role |
|------|------|
| `src/index.js` | Single raw Worker export: `export default { async fetch() {} }` returning `'Hello World! (from worker)'` |
| `package.json` | No runtime dependencies; dev-only (wrangler, vitest, vitest-pool-workers) |
| `wrangler.jsonc` | `main: "src/index.js"`, `nodejs_compat` flag, custom domain `reader.kixx.news` |
| `test/index.spec.js` | Two tests with inline snapshots asserting `"Hello World!"` (note: these snapshots are stale—the worker actually returns `"Hello World! (from worker)"`) |

---

## Files to Create

### `src/styles.css`

A new file containing CSS reset/base styles. Use the CSS in the **Stylesheet** section below.

### `src/index.js` (replace)

Replace the existing raw fetch handler with a Hono app:

```js
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
```

**Notes:**
- `c.html()` sets `Content-Type: text/html` automatically.
- A Hono app instance is itself a valid Cloudflare Workers export default—no wrapper needed.
- The CSS import resolves to a plain string at build/dev time because of the `rules` config in
  `wrangler.jsonc` (see below). No `?raw` suffix is needed—that is a Vite convention, not
  supported by Wrangler's esbuild bundler.

---

## Files to Modify

### `package.json`

Add `hono` as a runtime dependency:

```json
"dependencies": {
    "hono": "^4"
}
```

No other changes.

### `wrangler.jsonc`

Add a `rules` entry so that `.css` files are imported as text strings. Insert after the
`"compatibility_flags"` array:

```jsonc
"rules": [
    {
        "type": "Text",
        "globs": ["**/*.css"]
    }
]
```

This tells Wrangler's bundler to treat CSS files as `Text` modules, making
`import styles from './styles.css'` resolve to the file's content as a JavaScript string.
Without this rule, the import will fail because esbuild does not know how to handle `.css`
files as text by default.

Everything else in `wrangler.jsonc` (`main`, `nodejs_compat`, routes) remains unchanged.

### `test/index.spec.js`

**Test runner:** Vitest with `@cloudflare/vitest-pool-workers`, configured in `vitest.config.js` to
run tests inside the actual Workers runtime (via `wrangler.jsonc`). This means tests run against
the real Workers environment, not Node.js—important for validating text module imports and Hono's
fetch integration end-to-end.

**Current test file (for reference):**
```js
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Hello World worker', () => {
    it('responds with Hello World! (unit style)', async () => {
        const request = new Request('http://example.com');
        const ctx = createExecutionContext();
        const response = await worker.fetch(request, env, ctx);
        await waitOnExecutionContext(ctx);
        expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
    });

    it('responds with Hello World! (integration style)', async () => {
        const response = await SELF.fetch('http://example.com');
        expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
    });
});
```

**What breaks and why:**
- Both `toMatchInlineSnapshot` assertions currently match the literal plain-text string
  `"Hello World!"` (which is already stale relative to the actual worker response of
  `"Hello World! (from worker)"`). After the change, the response body will be a full HTML
  document, so both will fail regardless.
- The `describe` label `'Hello World worker'` remains accurate and does not need to change.
- The imports from `cloudflare:test` and the test structure (unit + integration styles) are
  unchanged—Hono exports a standard `{ fetch }` handler, so `worker.fetch(request, env, ctx)` still
  works identically.

**Updated assertions** — replace both `toMatchInlineSnapshot` calls with:
```js
expect(response.status).toBe(200);
expect(response.headers.get('content-type')).toContain('text/html');
expect(await response.text()).toContain('<h1>Hello World!</h1>');
```

This validates three things that are meaningful for the Hono MVP:
1. The route resolves (not a 404 from an unmatched path)
2. Hono sets the correct `Content-Type` header via `c.html()`
3. The HTML body contains the expected heading

The `await waitOnExecutionContext(ctx)` call in the unit test stays—it is still correct practice
even though the handler is synchronous.

---

## Files That Need No Changes

| File | Reason |
|------|--------|
| `vitest.config.js` | No test runner changes needed; it already points at `wrangler.jsonc` which will pick up the new `rules` |
| `.prettierrc` | Style config unaffected |

## Stylesheet


```css
/*
Inspired by:
https://www.joshwcomeau.com/css/custom-css-reset/
*/

:root {
    /* Use light text on a dark background as the default to start.
       Replace these colors with your own.
    */
    --color-background: hsla(162, 20%, 6%, 1);
    --color-on-background: hsla(162, 20%, 88%, 1);

    --font-family-body: sans-serif;
}

*, *::before, *::after {
    /*
    A more intuitive box sizing model:

    **Set the box-sizing to border-box:** The width and height properties include the content,
    padding, and border, but do not include the margin

    With this rule applied, percentages will resolve based on the border-box. In the example above, our pink box would be 200px, and the inner content-box would shrink down to 156px (200px - 40px - 4px).
    Instead of applying it on a case-by-case basis, apply it to all elements (with the wildcard *), as well as all pseudo-elements (*::before and *::after).
    */
    box-sizing: border-box;
}

body {
    /*
    Add accessible line-height:

    The WCAG criteria states that line-height should be at least 1.5. This standard is meant
    for body text and not headings, so you'll want to override this for your headings.
    */
    line-height: 1.5;
    /*
    Improve rendering of text on dark backgrounds

    Confusingly, macOS browsers like Chrome and Safari still use subpixel antialiasing by default.
    We need to explicitly turn it off, by setting font-smoothing to antialiased. macOS is the
    only operating system to use subpixel-antialiasing, and so this rule has no effect
    on other systems.
    */
    -moz-osx-font-smoothing: grayscale;
    -webkit-font-smoothing: antialiased;

    background: var(--color-background);
    color: var(--color-on-background);
    font-family: var(--font-family-body);
}

h1, h2, h3, h4, h5, h6 {
    /* Override the large WCAG accessible setting for body text here for headings. */
    line-height: 1.2;
}

/* Carry basic preferences over to links */
a {
    color: var(--color-on-background);
}

/*
Improve media defaults:

Images are considered "inline" elements but this doesn't jive with how we use images most of
the time. Typically, we treat images as layout elements, so using display: block sets a
sensible default for most use cases.

Also set max-width: 100% to keep large images from overflowing, if they're placed in a
container that isn't wide enough to contain them.
*/
img, picture, video, canvas, svg {
    display: block;
    max-width: 100%;
}

/*
Inherit fonts for form controls:

By default, buttons and inputs don't inherit typographical styles from their parents.

`font` is a rarely-used shorthand that sets a bunch of font-related properties, like
font-size, font-weight, and font-family. By setting it to inherit, we instruct
these elements to match the typography in their surrounding environment.
*/
input, button, textarea, select {
    font: inherit;
}

/*
Avoid text overflows:

The overflow-wrap property lets us tweak the line-wrapping algorithm, and give it permission to
use hard wraps when no soft wrap opportunties can be found. This prevents text overflows from
breaking the layout.
*/
p, li, h1, h2, h3, h4, h5, h6 {
    overflow-wrap: break-word;
}
```

---

## Step-by-Step Execution Order

1. **Install Hono** — `npm install hono`
2. **Add `rules` to `wrangler.jsonc`** — configure `.css` files as `Text` modules
3. **Create `src/styles.css`** — add the CSS content
4. **Replace `src/index.js`** — Hono app with `GET /` returning HTML with inlined styles
5. **Update `test/index.spec.js`** — replace inline snapshots with status + content-type + substring checks
6. **Run the test suite** — `npm test` to confirm both unit and integration tests pass inside the Workers runtime
7. **Verify locally** — `npm start`, open `http://localhost:8787/` and confirm the page renders with
   dark background and "Hello World!" heading

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| CSS text import fails at build time | Wrangler `rules` with `type: "Text"` is the documented approach for non-JS module imports—no extra bundler plugins needed |
| CSS text import fails in test environment | `@cloudflare/vitest-pool-workers` reads `wrangler.jsonc` for its config, so `rules` apply to the test build too |
| Hono version incompatibility with Workers runtime | Hono v4 targets the WinterCG/Workers fetch API; `nodejs_compat` flag does not conflict |
| Test suite fails after HTML body change | Tests are updated in step 5 before running `npm test` |
| Hono default export shape differs from raw Worker | Hono v4 app instances satisfy the `{ fetch }` interface Workers expects—verified by Hono docs |
