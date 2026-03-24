---
name: SAX parser migration completed
description: RSS/Atom parser was migrated from fast-xml-parser to sax event-driven parsing in src/parser.js
type: project
---

The RSS/Atom parser migration (plans/rss-parser-migration.md) is complete as of 2026-03-24.

- `fast-xml-parser` removed from package.json; `sax@1.6.0` added as explicit dependency.
- `src/parser.js` created with `parseFeedXml(xmlText, feedId)` as the sole public export.
- `src/crawl.js` updated to import `parseFeedXml` from `./parser.js`; all parser helpers removed from crawl.js.
- 32 parser-specific regression tests added to `test/parser.spec.js`.
- Full test suite: 93 tests passing (32 parser + 61 crawl/integration).

**Why:** Replaced tree-building parser that failed on large ignored content sections (content:encoded, summary, etc.) with event-driven SAX parser that never buffers ignored fields.

**How to apply:** The correct sax import form for this ESM project is `import sax from 'sax'` (default import). The parser uses strict mode: `sax.parser(true, {...})`. All tag comparisons use `normalizeTagName()` which strips namespace prefix and lowercases.
