# TODO: Hono + Hello World HTML Implementation

## Dependency Installation
- [x] Install Hono v4 via `npm install hono`

## Configuration Changes
- [x] Add `rules` entry to `wrangler.jsonc` for `.css` as `Text` modules (globs: `**/*.css`), inserted after the `compatibility_flags` array

## File Creation
- [x] Create `src/styles.css` with the CSS from the Stylesheet section of the plan

## File Modification
- [ ] Replace `src/index.js` with Hono app
  - Import Hono and styles
  - `GET /` route returning HTML via `c.html()` with inlined CSS and `<h1>Hello World!</h1>`
  - Export app as default

- [ ] Update `test/index.spec.js` assertions (keep existing structure and imports)
  - Both tests get the same 3 assertions, replacing their `toMatchInlineSnapshot` calls:
    1. `expect(response.status).toBe(200)`
    2. `expect(response.headers.get('content-type')).toContain('text/html')`
    3. `expect(await response.text()).toContain('<h1>Hello World!</h1>')`
  - Unit test: keep `await waitOnExecutionContext(ctx)` in place (still correct even though the handler is synchronous)

## Validation
- [ ] Run `npm test` — both unit and integration tests should pass
- [ ] Run `npm start`, open `http://localhost:8787/`, confirm: dark background, light text, and `<h1>Hello World!</h1>` rendered on screen
