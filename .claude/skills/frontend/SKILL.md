---
name: frontend
description: Apply when writing or editing HTML templates, CSS components, or UI styling in this project. Covers the Hono html template system, the Architectural Dark design system (Obsidian palette, typography, component specs), BEM CSS methodology, and layout utility classes. Load for any task touching src/views/, src/styles.css, or src/layout.js.
---

## HTML Templating

This project renders HTML server-side using Hono's `html` tagged template literal — not JSX. Views are plain JavaScript functions that return an `HtmlEscapedString`.

### Template Rules

- Import `html` and `raw` from `'hono/html'`
- Use `html\`...\`` to build all HTML strings — it auto-escapes plain string interpolations
- Use `raw(str)` only for values that are already safely escaped (e.g., pre-rendered child views, inlined CSS)
- Use `escapeHtml(value)` from `src/html-utils.js` for untrusted user data (titles, URLs, feed names, etc.)
- **Never** use string concatenation or template literals without `html` for HTML output

```js
import { html, raw } from 'hono/html';
import { escapeHtml } from '../html-utils.js';

export function articleItem({ title, url }) {
    return html`<article class="article-item">
        <a class="article-item__title" href="${escapeHtml(url)}">${title}</a>
    </article>`;
}
```

### View Conventions

- Page views live in `src/views/pages/*.js`, one file per page
- Partial/shared components live in `src/views/partials.js`
- Views take plain data objects as arguments and return `HtmlEscapedString`
- Pages are composed into the layout via `renderLayout()` in `src/layout.js`

### CSS

All styles live in a single file: **`src/styles.css`**. It is inlined into the `<style>` tag at render time by `layout.js` — there are no external stylesheets or CSS imports in views.

When adding new CSS components: add the block styles to `src/styles.css`. Utility classes from `css-utilities-reference.css` (in this skill directory) are also part of `src/styles.css`.

**At the start of any HTML/CSS task, read `css-utilities-reference.css` (in this skill's directory) to see all available utility classes before writing any HTML or CSS.**

---

## Design System: Architectural Dark

A high-density, technical-editorial interface inspired by Material Design 3. Prioritizes information hierarchy and rapid scanning for power users.

### Core Philosophy

- **High Signal-to-Noise:** Remove all non-functional ornamentation.
- **Structural Rigidity:** Favor sharp geometry and clear axes over organic shapes.
- **Tonal Elevation:** Depth is communicated through color shifts, not drop shadows.

### Color Palette (Obsidian — Dark Only)

Use only these hex values. Do not use pure black (`#000000`) for surfaces.

| Token | Hex | Usage |
| :--- | :--- | :--- |
| Base Surface | `#0F1113` | Global background |
| Surface Low | `#16181A` | Secondary containers, sidebar background |
| Surface High | `#222427` | Active list items, cards, form fields |
| Primary Accent | `#E0E2E4` | High-emphasis text, active states |
| Muted Accent | `#6B727A` | Metadata, timestamps, borders, inactive icons |
| Action Color | `#A8C7FA` | Interactive links, primary CTAs |

Map these to CSS custom properties in `src/styles.css`:

```css
:root {
    --color-surface-base: #0F1113;
    --color-surface-low: #16181A;
    --color-surface-high: #222427;
    --color-accent-primary: #E0E2E4;
    --color-accent-muted: #6B727A;
    --color-action: #A8C7FA;
}
```

### Typography

Tension between a high-contrast serif for content and a functional sans/mono for UI.

| Role | Typeface | Size | Weight | Color |
| :--- | :--- | :--- | :--- | :--- |
| Article titles / headlines | Serif (Charter, Source Serif Pro, IBM Plex Serif) | 16–18px | Medium | Primary Accent |
| UI elements, metadata | Sans-serif (Inter, Google Sans) | 12–13px | Regular / Semi-bold | Muted Accent |
| Query forms, system info | Monospace | — | — | — |

### Geometry & Grid

Standard Material 3 uses heavy rounding; this spec diverges to maintain a technical, grounded tone.

- **Corners:** 0px to 2px maximum. No rounded buttons or pill shapes. All containers, inputs, and buttons are sharp or nearly sharp.
- **Borders:** 1px borders used sparingly. Use `#222427` (Surface High) for structural dividers.
- **Spacing:** 8px base grid.
  - List density: 12px padding between list items.
  - Outer container margins: 24px–32px to give the eye room to rest.

### Component Specifications

#### List Items

| State | Style |
| :--- | :--- |
| Resting | No border, transparent background |
| Hover | Background → Surface Low; 1px left border in Action Color |
| Active/Read | Headline opacity drops to 50%; metadata remains visible but dimmed |

#### Forms & Inputs

- Flat background using Surface High. Full 1px stroke in Surface High (not bottom-border-only).
- Focus: border color changes to Action Color. No glow or outer shadow.
- Buttons: rectangular. Primary = Action Color background + black text. Secondary = ghost (border only).

#### Links

- Default: Action Color (`#A8C7FA`).
- Hover: underline (1px solid). No color change.

### Motion

Motion is functional, not decorative.

- **Hover transitions:** 150ms ease-out for all hover states.
- **Loading indicator:** Linear indeterminate progress bar at the top of list views, in Action Color. No circular spinners.

### Implementation Latitude

- **Iconography:** Outlined or filled icons, consistent, 20–24px.
- **Sidebar layout:** Flexible, provided sharp-corner and color constraints are respected.
- **Empty states:** Creative use of typography or minimalist wireframe-style illustrations is encouraged.

---

## CSS: BEM Methodology

Use Block, Element, Modifier (BEM) for all CSS components.

### Syntax

```css
.block {}
.block__element {}
.block--modifier {}
.block__element--modifier {}
```

- **Block** — a standalone, reusable component (`.card`, `.navbar`, `.button`)
- **Element** — a part of a block that has no standalone meaning (`.card__title`, `.nav__item`)
- **Modifier** — a variant or state (`.button--primary`, `.card--featured`)

### Rules

**Naming:** Lowercase Latin letters, digits, dashes. Double underscores (`__`) separate block from element. Double hyphens (`--`) separate block or element from modifier.

**Elements don't chain.** Never write `.block__element__subelement`. If you need depth, name it flat: `.card__footer-tag`, not `.card__footer__tag`.

**Blocks are independent.** A block must not depend on where it's placed. If you find yourself writing `.sidebar .card { }`, use a modifier instead: `.card--sidebar`.

**Modifiers never stand alone.** `.button--primary` is meaningless without `.button`. Always apply both classes.

**Element selectors must not depend on parent context** — unless the parent has a modifier:

```css
/* Good */
.block__elem { color: #042; }
.block--new-state .block__elem { color: #042; }

/* Bad */
.block .block__elem { color: #042; }
div.block__elem { color: #042; }
```

### Example

```html
<form class="form form--theme-xmas form--simple">
    <input class="form__input" type="text" />
    <input class="form__submit form__submit--disabled" type="submit" />
</form>
```

```css
.form { }
.form--theme-xmas { }
.form--simple { }
.form__input { }
.form__submit { }
.form__submit--disabled { }
```

### Refactor for Reusability

When adding new blocks, look for similar existing blocks and generalize. Prefer a generic block with modifiers over two near-identical blocks:

```css
/* Before — two near-identical blocks */
.toast { padding: 1rem; border: 1px solid green; color: green; }
.error { padding: 1rem; border: 1px solid red; color: red; }

/* After — one generic block with modifiers */
.alert { padding: 1rem; border: 1px solid transparent; }
.alert__icon { margin-right: 0.5rem; }
.alert--success { color: green; border-color: green; }
.alert--error { color: red; border-color: red; }
```

---

## Layout: Utility Classes

Use utility classes for layout and spacing **between and around** blocks — not inside them. Do not use utility classes on elements within a BEM block.

```html
<!-- Correct: utility classes on the container, BEM on the components -->
<div class="flex space-x-4">
    <div class="feed-card">...</div>
    <div class="feed-card">...</div>
</div>

<!-- Wrong: utility class inside a BEM block -->
<div class="card">
    <h2 class="card__title mt-2">Title</h2>
</div>
```

**Before writing any HTML or CSS, read `css-utilities-reference.css`** in this skill's directory to see all available utility classes (spacing, margin, padding, flex, grid, alignment).

---

## Accessibility Conventions

Follow the patterns already established in `src/layout.js`:

- Use semantic HTML elements: `<header>`, `<nav>`, `<main>`, `<article>`, `<aside>`, `<section>`
- Add `aria-label` to `<nav>` elements to distinguish multiple navs on the same page
- Use `aria-current="page"` on the active navigation link
- Prefer `<button>` for actions, `<a>` for navigation
