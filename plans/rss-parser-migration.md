# RSS/Atom Parser Migration to SAX Event-Driven Parsing

## Implementation Approach

This migration replaces the `fast-xml-parser` tree-building parser in `src/crawl.js` with an event-driven `sax` parser in a new `src/parser.js` module, preserving the existing `parseFeedXml(xmlText, feedId)` contract and all observable crawl behavior. The rollback-safe sequence is: confirm the `sax` import form in the Workers test environment, scaffold the new module with real shared helpers and function stubs, write regression tests against the stubs (tests will fail until implementation — this is expected), implement RSS then Atom parsing until all parser tests pass, wire `src/crawl.js` to the new module, then remove the old dependency last. A cross-cutting concern is that `sax` is a CJS package in an ESM project — the import form confirmed in the first task must be used consistently throughout. Namespace handling is centralized in a single `normalizeTagName` helper that strips prefixes and lowercases, and the SAX strict-mode decision is validated empirically through tests rather than assumed upfront.

---

## Reference: Goals

- Eliminate the current failure mode caused by parsing large ignored content sections.
- Preserve current observable crawl behavior wherever it is already defined by code and tests.
- Keep `processFeed`, `performCrawl`, fetch timeout handling, failure counting, and DB writes unchanged.
- Continue supporting both RSS 2.0 and Atom 1.0 feeds.
- Add parser-focused tests so future parser changes are safe and localized.

---

## Reference: Non-Goals

- Implementing true streaming from `response.body`.
- Changing the database schema, crawl history logic, failure tracking, or scheduled crawl flow.
- Adding new article fields or changing the article row shape.
- Refactoring unrelated parts of `src/crawl.js` beyond extracting parser logic.
- Supporting feed formats beyond the RSS/Atom variants already handled by the app.
- Optimizing for maximum throughput; correctness and robustness are the priority.

---

## Reference: Verified Current State

- `src/crawl.js` currently owns all parser helpers: `parseDate`, `normalizeString`, `deriveArticleId`, `extractAtomLinkHref`, `extractRssArticle`, `extractAtomArticle`, and `parseFeedXml`.
- `processFeed` calls `parseFeedXml(xmlText, feed.id)` and then filters out articles with `id === null` before insertion. The parser must continue returning article objects even when an ID cannot be derived.
- Current Atom link behavior accepts three shapes from `fast-xml-parser`: string, object with `href`, or array of link objects. It prefers `rel="alternate"` or an absent `rel`, then falls back to the first link with `href`.
- Current Atom published-date behavior is `parseDate(entry.published || entry.updated)`.
- Current unrecognized-feed behavior is to return `[]`, not throw.
- `sax@1.6.0` is already present in `node_modules` as a transitive dependency via `heat → soap → sax`. Running `npm install sax` will add it as an explicit direct dependency without fetching a new copy.
- The existing test convention uses `test/index.spec.js`. The new parser-focused file follows the same `.spec.js` naming convention.

---

## Reference: Design Decisions

### Library Choice

Use the `sax` npm package:

```bash
npm install sax
```

`sax` is a CJS module. This project uses `"type": "module"` (ESM). The bundler (wrangler/esbuild) handles CJS-to-ESM interop, but the correct import syntax must be confirmed by the smoke test in TODO 1 before being used in `src/parser.js`. Do not assume either `import sax from 'sax'` or `import * as sax from 'sax'` — the smoke test resolves this.

### Public API Surface

Create a new module `src/parser.js` with a single public export:

- `parseFeedXml(xmlText, feedId)`

Keep parser helpers internal unless a real cross-module use appears during implementation. Do not export helpers only to make them testable; parser tests should target observable behavior through `parseFeedXml`.

### Behavior Preservation Rules

The new parser must preserve these behaviors:

- Return article objects shaped like `{ id, link, title, published, updated }`.
- Include articles with `id: null`; `processFeed` remains responsible for skipping them.
- Preserve RSS `updated: null`.
- Preserve Atom published fallback to updated.
- Preserve unrecognized-root behavior as `[]`.
- Preserve malformed-XML behavior as a thrown `Error` whose message starts with `Invalid XML:`.

### Namespace Handling

Add one shared helper `normalizeTagName(name)` that:

1. Strips any namespace prefix (everything up to and including the first `:`).
2. Lowercases the result.

All root detection and element matching uses this normalized form. In strict `sax` mode, tag names preserve case as written in the XML; lowercasing handles that uniformly. In non-strict mode, `sax` uppercases tag names — lowercasing in `normalizeTagName` handles that too.

### SAX Strictness

Start with strict mode: `sax.parser(true, {...})`. Strict mode is case-sensitive and emits `onerror` for malformed XML, which preserves current failure semantics.

Validate the choice with parser tests and at least one malformed-XML regression test. If real-world compatibility requires non-strict mode, document that as an intentional deviation instead of silently broadening accepted input.

### Error Throwing in `onerror`

The `sax` parser does not throw automatically on errors — it calls `onerror` and continues unless you explicitly stop it. The implementation must throw immediately inside `onerror`:

```js
parser.onerror = (err) => {
  throw new Error('Invalid XML: ' + err.message);
};
```

Throwing inside `onerror` propagates through `parser.write()` and terminates parsing. Do not use a capture-then-rethrow pattern (capture error flag, continue parsing, throw after `.close()`) — that approach risks emitting partial results and is unnecessarily complex.

### What Makes the Migration Safer

Do not rely on undocumented `sax` internals as success criteria. The migration is justified by application-level behavior: the parser consumes XML as events instead of building a full JS object tree, and ignored fields are not accumulated into application-managed buffers. Tests should verify the observable failure mode is fixed, not encode assumptions about `sax` internal buffers or undocumented parser limits.

---

## Reference: Target Architecture

### New Module: `src/parser.js`

Exports:
- `parseFeedXml(xmlText, feedId)`

Internal helpers:
- `detectFeedFormat(xmlText)` — regex or small scanner; returns `'rss'`, `'atom'`, or `null`
- `normalizeTagName(name)` — strips prefix, lowercases
- `parseRssFeed(xmlText, feedId)`
- `parseAtomFeed(xmlText, feedId)`
- `selectAtomLink(links)`
- `parseDate(dateString)` — moved from `src/crawl.js`
- `normalizeString(value)` — moved from `src/crawl.js`
- `deriveArticleId(feedId, guid, link)` — moved from `src/crawl.js`

### Changes to `src/crawl.js`

- Remove the `fast-xml-parser` import.
- Import `parseFeedXml` from `./parser.js`.
- Remove the parser-only helpers that move into `src/parser.js`.
- Keep `fetchFeedXml`, `processFeed`, and `performCrawl` behavior unchanged.

### Rollback-Friendly Sequence

1. Scaffold the new parser module and its tests first. (The module must exist before tests can import it.)
2. Implement the parser until all parser-specific tests pass.
3. Integrate `src/crawl.js` only after the new parser passes its own tests.
4. Remove `fast-xml-parser` last.

This prevents a half-migrated state where the old parser has been removed before the new one is validated.

---

## Reference: Detailed Parser Design

### Format Detection

`parseFeedXml` detects the feed type via `detectFeedFormat(xmlText)` before dispatching.

Requirements:
- Ignore leading XML declarations, comments, and doctype blocks.
- Match the first real root element's local name (after namespace-prefix stripping).
- Treat local-name `rss` as RSS and local-name `feed` as Atom, regardless of optional prefix.
- Return `null` for non-XML input or unrecognized roots (causing `parseFeedXml` to return `[]`).

Note: `parseFeedXml` calls `detectFeedFormat` first, then calls the appropriate concrete parser. The XML string is therefore scanned twice — once cheaply for format detection (regex or small scanner), once fully by the SAX parser. This two-pass approach is intentional.

### Shared Parser State

Each concrete parser maintains:
- `elementStack`: normalized local tag names for path tracking
- `inEntry`: whether the parser is inside an RSS `<item>` or Atom `<entry>`
- `currentField`: the logical field currently buffering, or `null`
- `textBuffer`: the current field's buffered text
- `article`: accumulator for the current item/entry
- `articles`: result array

For Atom only:
- `links`: collected link candidates for the current entry

### Text Buffering Rules

When a field is being tracked:
1. Reset `textBuffer` when the field opens.
2. Append both `ontext` and `oncdata` callbacks.
3. Commit the buffered value when the matching field closes.

This is required because XML content may be split across multiple parser callbacks.

### RSS Parsing

Within an RSS `<item>`, track only these fields:

| XML element | Article field | Notes |
|---|---|---|
| `<title>` | `title` | normalize text |
| `<link>` | `link` | normalize text |
| `<guid>` | used for `id` | ignore attributes like `isPermaLink` |
| `<pubDate>` | `published` | parse to ISO or `null` |

All other fields are ignored without buffering (do not set `currentField` for `content:encoded`, `description`, `author`, `category`, `comments`, `enclosure`, etc.).

On closing `</item>`:
```text
guid      = normalizeString(buffered guid) or null
link      = normalizeString(buffered link) or null
title     = normalizeString(buffered title) or null
published = parseDate(buffered pubDate) or null
updated   = null
id        = deriveArticleId(feedId, guid, link)
```

Push the article even if `id` is `null`.

### Atom Parsing

Within an Atom `<entry>`, track:

| XML element | Article field | Notes |
|---|---|---|
| `<id>` | used for `id` | normalize text |
| `<title>` | `title` | normalize text |
| `<published>` | `published` | parse to ISO or `null` |
| `<updated>` | `updated` | parse to ISO or `null` |
| `<link>` | `link` | collect candidates from attributes and text fallback |

Ignored fields (do not set `currentField`): `content`, `summary`, `author`, `category`, `rights`.

**Atom Link Handling**

For each `<link>` inside an entry:
1. On open, capture `href` and `rel` attributes if present.
2. If there is no usable `href`, buffer text content as a fallback candidate.
3. On close, store one normalized candidate in the entry's `links` array.

`selectAtomLink(links)` selection order:
1. First candidate where `rel === "alternate"` or `rel` is absent.
2. Fall back to first candidate with a non-null URL.
3. Return `null` if none exist.

**Atom Article Derivation**

On closing `</entry>`:
```text
atomId    = normalizeString(buffered id) or null
link      = selectAtomLink(links)
title     = normalizeString(buffered title) or null
published = parseDate(buffered published) || parseDate(buffered updated)
updated   = parseDate(buffered updated) or null
id        = deriveArticleId(feedId, atomId, link)
```

### Error Handling

See "SAX Strictness" and "Error Throwing in `onerror`" in the Design Decisions section. Non-fatal conditions remain unchanged:
- Missing fields become `null`.
- Invalid dates become `null`.
- Empty but valid feeds return `[]`.

---

## TODO Items

- [x] **Install sax and verify import form**
  - **Story**: RSS/Atom Parser Migration
  - **What**: Add `sax` as an explicit direct dependency (`npm install sax`). Note: `sax@1.6.0` is already in `node_modules` as a transitive dep (`heat → soap → sax`), so this command only adds it to `package.json` — no new download. Then create a minimal smoke test in a new `test/parser.spec.js` file: import `sax`, create a parser, and parse a trivial XML string (e.g., `<r/>`). Run `npm test` to confirm the correct ESM import form for this CJS module as bundled by wrangler. Do NOT assume the import form — the smoke test must pass before writing `src/parser.js`.
  - **Where**: `package.json`, `package-lock.json`, `test/parser.spec.js` (new file)
  - **Acceptance criteria**: `sax` appears in `dependencies` in `package.json`; smoke test passes in the Workers Vitest pool; `test/parser.spec.js` exists and uses the `.spec.js` naming convention
  - **Depends on**: none

- [x] **Scaffold `src/parser.js` with stubs**
  - **Story**: RSS/Atom Parser Migration
  - **What**: Create `src/parser.js` using the import form confirmed in TODO 1. The file must:
    1. Export only `parseFeedXml(xmlText, feedId)` — stub: returns `[]`.
    2. Provide real implementations (copied verbatim from `src/crawl.js`) for: `parseDate`, `normalizeString`, `deriveArticleId`.
    3. Provide stub implementations for: `normalizeTagName(name)` (stub: return name as-is), `detectFeedFormat(xmlText)` (stub: return `null`), `parseRssFeed(xmlText, feedId)` (stub: return `[]`), `parseAtomFeed(xmlText, feedId)` (stub: return `[]`), `selectAtomLink(links)` (stub: return `null`).
    4. Do NOT modify `src/crawl.js` — it still uses its own in-file helpers and `fast-xml-parser`.
  - **Where**: `src/parser.js` (new file)
  - **Acceptance criteria**: File exists and exports only `parseFeedXml`; `parseDate`, `normalizeString`, `deriveArticleId` have real (copied) implementations; all other functions are stubs; `src/crawl.js` is unchanged
  - **Depends on**: Install sax and verify import form

- [x] **Add parser regression tests**
  - **Story**: RSS/Atom Parser Migration
  - **What**: Write the full suite of regression tests in `test/parser.spec.js` (replacing the smoke test), importing `parseFeedXml` from `../src/parser.js`. Tests are the specification for the new parser — they are expected to FAIL (returning `[]` from stubs) until TODOs 4 and 5 are complete. This is intentional. Use inline XML strings; no fixture files are required. Do not export helpers from `src/parser.js` just for testing.
  - **Where**: `test/parser.spec.js`
  - **Required test cases**:
    ```
    describe('RSS parsing')
      - parses basic RSS items
      - derives id from guid
      - falls back to link when guid is missing
      - returns id: null when both guid and link are missing
      - handles guid attributes such as isPermaLink (ignored, text content used)
      - normalizes whitespace in title and link
      - parses valid pubDate values to ISO string
      - returns null for invalid pubDate values
      - handles multiple items
      - ignores large content:encoded sections (does not buffer or fail on them)
      - succeeds on entity-heavy content in ignored fields
      - returns [] for an RSS feed with an empty channel
      - throws "Invalid XML: ..." on malformed RSS

    describe('Atom parsing')
      - parses basic Atom entries
      - derives id from atom:id text content
      - prefers link with rel="alternate"
      - treats link with no rel attribute as alternate
      - falls back to first candidate URL when no alternate exists
      - supports text-only link content (no href attribute)
      - falls back to updated when published is missing
      - returns updated: null when updated is also missing
      - normalizes whitespace in title and id
      - handles multiple entries
      - ignores large content and summary sections
      - throws "Invalid XML: ..." on malformed Atom

    describe('format detection')
      - detects RSS root and returns RSS articles
      - detects Atom root and returns Atom entries
      - handles XML declaration before the root
      - handles comments before the root
      - handles namespace-prefixed roots (atom:feed, rss:rss)
      - returns [] for an unrecognized root element
      - returns [] for non-XML input
    ```
  - **Acceptance criteria**: All required test cases exist in `test/parser.spec.js`; tests import from `src/parser.js` (not `src/crawl.js`); tests fail with incorrect results (not import errors) because stubs return `[]`; at least one test targets entity-heavy content in ignored fields
  - **Depends on**: Scaffold `src/parser.js` with stubs

- [x] **Implement RSS SAX parsing**
  - **Story**: RSS/Atom Parser Migration
  - **What**: Implement `normalizeTagName`, `detectFeedFormat`, and `parseRssFeed` in `src/parser.js`, and wire them into `parseFeedXml`. Use the `sax` import form confirmed in TODO 1.
    - `normalizeTagName(name)`: strip everything up to and including the first `:`, then lowercase.
    - `detectFeedFormat(xmlText)`: scan for the first real root element (skip XML declaration, comments, doctypes). Return `'rss'` for local-name `rss`, `'atom'` for local-name `feed`, `null` otherwise. An anchored regex or small scanner is acceptable.
    - `parseFeedXml` dispatch: call `detectFeedFormat`; if `'rss'` call `parseRssFeed`; if `'atom'` call `parseAtomFeed`; otherwise return `[]`.
    - `parseRssFeed`: create `sax.parser(true, {...})` (strict mode). Set `onerror` to throw immediately: `parser.onerror = (err) => { throw new Error('Invalid XML: ' + err.message); }`. Track only `title`, `link`, `guid`, `pubDate` within `<item>` using the text-buffering rules in the Reference section. Ignore all other fields by not setting `currentField`. On `</item>`, derive the article per the RSS derivation rules and push it (even if `id` is null). Call `parser.write(xmlText).close()` and return `articles`.
  - **Where**: `src/parser.js`
  - **Acceptance criteria**: All RSS tests and format-detection tests in `test/parser.spec.js` pass; malformed RSS throws `Invalid XML: ...`; `updated: null` for all RSS articles; large ignored content fields do not cause failures
  - **Depends on**: Add parser regression tests

- [x] **Implement Atom SAX parsing**
  - **Story**: RSS/Atom Parser Migration
  - **What**: Implement `parseAtomFeed` and `selectAtomLink` in `src/parser.js`. Use `normalizeTagName` for all tag comparisons so that namespace-prefixed tags (e.g., `atom:entry`, `atom:id`) resolve identically to their unprefixed forms.
    - `parseAtomFeed`: same error handling pattern as `parseRssFeed` (throw in `onerror`). Track `id`, `title`, `published`, `updated`, and link candidates within `<entry>`. For `<link>`: on open, capture `href` and `rel` attributes; if no `href`, buffer text content as fallback; on close, store one candidate in `links`. Ignore `content`, `summary`, `author`, `category`, `rights` (do not set `currentField`). On `</entry>`, derive the article per the Atom derivation rules and push it.
    - `selectAtomLink(links)`: (1) return first candidate where `rel === "alternate"` or `rel` is absent; (2) fall back to first candidate with a non-null URL; (3) return `null`.
  - **Where**: `src/parser.js`
  - **Acceptance criteria**: All Atom tests in `test/parser.spec.js` pass; namespace-prefixed Atom roots and entries are handled correctly; Atom link selection semantics (including text-link fallback) pass their tests
  - **Depends on**: Implement RSS SAX parsing

- [x] **Wire `src/crawl.js` to `src/parser.js`**
  - **Story**: RSS/Atom Parser Migration
  - **What**: Integrate the new parser module into `src/crawl.js`. Remove the `XMLParser` import from `fast-xml-parser`. Add `import { parseFeedXml } from './parser.js'`. Remove the following in-file functions (they now live in `src/parser.js`): `parseDate`, `normalizeString`, `deriveArticleId`, `extractAtomLinkHref`, `extractRssArticle`, `extractAtomArticle`, and the `parseFeedXml` implementation. Keep `fetchFeedXml`, `processFeed`, and `performCrawl` unchanged.
  - **Where**: `src/crawl.js`
  - **Acceptance criteria**: `src/crawl.js` imports `parseFeedXml` from `./parser.js`; no parser implementation or `fast-xml-parser` import remains in `src/crawl.js`; all existing crawl tests in `test/index.spec.js` pass
  - **Depends on**: Implement Atom SAX parsing

- [x] **Remove `fast-xml-parser` dependency**
  - **Story**: RSS/Atom Parser Migration
  - **What**: Uninstall `fast-xml-parser` (`npm uninstall fast-xml-parser`). Verify with a grep that no imports or references remain. Run `npm test` to confirm the full test suite passes.
  - **Where**: `package.json`, `package-lock.json`
  - **Acceptance criteria**: `fast-xml-parser` is absent from `package.json` and lockfile; no imports or references remain anywhere in the codebase; full test suite passes
  - **Depends on**: Wire `src/crawl.js` to `src/parser.js`

- [x] **Full validation**
  - **Story**: RSS/Atom Parser Migration
  - **What**: Run `npm test` and confirm all tests pass. Optionally, run `npx wrangler dev --test-scheduled`, trigger a crawl with `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+2+*+*+*"`, verify crawl completion and article insertion, then stop the dev server.
  - **Where**: (no file changes)
  - **Acceptance criteria**: All tests pass; verification checklist below is satisfied; dev server is stopped if manual validation was performed
  - **Depends on**: Remove `fast-xml-parser` dependency

---

## Implementation Notes (2026-03-24)

All TODO items completed. The implementation matched the plan with one noteworthy deviation: TODOs 4 and 5 (RSS and Atom parsing) were implemented together in a single pass rather than sequentially. The plan allowed for this — both parsers share the same structural pattern and the acceptance criteria for each were verified together.

SAX strict mode (`sax.parser(true, {...})`) worked without issue for all synthetic test cases. No real-world feeds requiring non-strict mode were encountered. Risk 1 was not triggered.

Atom link behavior was implemented cleanly using SAX attributes rather than the old `fast-xml-parser` object shapes. Risk 2 was not triggered; the `selectAtomLink` helper covers all three original shapes (string, object with href, array) through the unified `{ href, rel }` candidate list.

The ESM import form confirmed in TODO 1 was `import sax from 'sax'` (default import). This is used consistently throughout `src/parser.js`.

---

## Verification Checklist

The migration is complete when all of the following are true:

- `src/crawl.js` no longer imports `fast-xml-parser`. ✓
- `src/parser.js` exists and owns all feed parsing. ✓
- `parseFeedXml(xmlText, feedId)` returns the existing article shape `{ id, link, title, published, updated }`. ✓
- Parser-specific tests exist in `test/parser.spec.js`. ✓
- Existing crawl tests in `test/index.spec.js` continue to pass. ✓
- `fast-xml-parser` has been removed from `package.json` and the lockfile. ✓
- Large or entity-heavy ignored content no longer causes parser failures. ✓

---

## Risks, Recovery, and Open Questions

### Risks

**Risk 1: SAX strict mode changes acceptance behavior**

Strict mode throws on malformed XML that `fast-xml-parser` may have silently accepted or vice versa. Mitigation: validate with tests and document any intentional behavior change. If strict mode is too strict for real-world feeds, switch to non-strict only after documenting it as a deviation.

**Risk 2: Atom link behavior regresses**

Current code supports string/object/array link representations from the `fast-xml-parser` object tree. The SAX implementation receives raw XML events instead. Mitigation: lock down link-selection semantics with tests (including text-link fallback) before integration.

**Risk 3: Namespace handling missed in one path**

Using `normalizeTagName` for all tag comparisons prevents ad hoc prefix checks scattered through the code. Mitigation: test namespace-prefixed roots and entry tags explicitly.

### Recovery Guidance

- Keep `src/crawl.js` unchanged until `test/parser.spec.js` is green (TODOs 4–5 done).
- Integrate the new module before removing the old dependency.
- If integration exposes an unexpected regression, revert only the `src/crawl.js` import switch and continue iterating on `src/parser.js`.

### Open Questions

- If you have a real feed URL or sanitized XML sample that currently fails due to entity-heavy ignored content, add it to manual validation. Automated tests use synthetic reproductions.
- If strictness validation reveals a genuine trade-off between preserving current malformed-feed failures and accepting more real-world feeds, owner input may be needed before intentionally broadening acceptance.
