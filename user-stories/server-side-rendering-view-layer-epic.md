# Epic: Server-Side Rendering View Layer Cleanup

## Epic Goal

Reduce the complexity of server-rendered page markup by replacing large inline HTML string construction with a safer, more maintainable view-layer pattern based on Hono's `html` helper and shared view partials.

This epic is intended to improve maintainability without changing the application's core workflows, route structure, or authenticated user experience.

## Decisions Captured For This Draft

- The preferred implementation approach is an incremental migration to Hono's `html` helper for server-side rendering.
- The app should stay server-rendered in the Cloudflare Worker and should not introduce a client-side SPA architecture as part of this epic.
- Existing route URLs, form actions, redirects, and authenticated workflows should remain unchanged unless a later epic explicitly changes them.
- The migration should prioritize shared layout and reusable partials so route handlers can focus more on request handling and data preparation than markup assembly.
- Existing page behavior should be preserved for users while the rendering internals are cleaned up.
- Full migration to JSX or TSX is out of scope for this epic, though the resulting structure should keep that option open for the future.

---

## User Stories And Acceptance Criteria

- [ ] **See the same pages and workflows after the rendering refactor**
  - **Story**: Website User - As a website user, I want the site's pages and workflows to behave the same after the rendering cleanup so I can keep using the app without relearning it.
  - **What**: Preserve the existing user-facing behavior while the server-side rendering implementation is refactored internally.
  - **Acceptance criteria**:
    - The authenticated pages continue to render successfully in the browser after the refactor.
    - Existing routes such as `/`, `/feeds`, `/feeds/add`, `/feeds/:feedId`, `/feeds/:feedId/articles`, `/reader`, and `/crawl-history` continue to be available at the same URLs.
    - Existing forms, buttons, navigation links, and redirects continue to work as they do today.
    - The user does not need to take any new steps to complete existing tasks such as browsing feeds, opening articles, or adding a feed.

- [ ] **Continue to see clear, consistent page structure**
  - **Story**: Website User - As a website user, I want the site's shared layout and navigation to remain consistent across pages so the app still feels cohesive while internal rendering code changes.
  - **What**: Preserve the existing shared page shell while moving rendering responsibilities into reusable view functions.
  - **Acceptance criteria**:
    - Shared header and navigation content remain consistent across authenticated pages.
    - The current section highlighting continues to work on pages that already support it.
    - Shared page shell changes are made in one central place rather than duplicated across route handlers.
    - Any repeated page fragments that are currently duplicated across routes can be rendered from shared partials.

- [ ] **Continue to receive safe, readable content on dynamic pages**
  - **Story**: Website User - As a website user, I want feed titles, article titles, notices, and other dynamic content to render correctly and safely so that pages remain readable and trustworthy.
  - **What**: Use rendering primitives that escape dynamic values by default and make trusted raw HTML usage explicit.
  - **Acceptance criteria**:
    - Dynamic values rendered into HTML are escaped by default.
    - Any intentionally unescaped HTML is explicit and limited to trusted content paths.
    - Existing notices, lists, metadata sections, and form values continue to display correctly after migration.
    - The rendering refactor does not introduce obvious broken markup in complex pages such as Add Feed, Feeds, Reader, or Articles.

- [ ] **Make route handlers easier to maintain**
  - **Story**: Website Owner - As the website owner, I want route handlers to contain less inline markup so that the code is easier to read, change, and review.
  - **What**: Separate request handling and data preparation from HTML presentation by extracting page views and partials from route modules.
  - **Acceptance criteria**:
    - Route handlers no longer need to assemble entire pages from large concatenated template strings.
    - The shared document layout is represented through a reusable view-layer abstraction rather than ad hoc string assembly in each route.
    - Complex pages can be read in terms of named page sections or partials instead of one large block of markup.
    - New page-level UI changes can be made with less duplication across route files.

- [ ] **Adopt an incremental rendering pattern that fits Hono on Workers**
  - **Story**: Website Owner - As the website owner, I want a rendering approach that matches the existing Hono and Cloudflare Worker stack so that the refactor stays low-risk and easy to evolve.
  - **What**: Standardize server-side rendering on Hono's `html` helper and reusable server-side view modules.
  - **Acceptance criteria**:
    - New or refactored server-rendered views use Hono's `html` helper as the default rendering pattern.
    - Shared view helpers or partials can be composed from plain JavaScript modules without introducing a client-side framework.
    - The selected approach works within the current Cloudflare Worker deployment model.
    - The implementation does not require introducing a new client-side rendering framework as part of this epic.

- [ ] **Reduce duplication in common page fragments**
  - **Story**: Website Owner - As the website owner, I want repeated UI fragments extracted into shared partials so that common markup only has to be updated in one place.
  - **What**: Identify repeated fragments such as common notices, pagination controls, empty states, and standard page shells, and move them into reusable server-side view helpers where appropriate.
  - **Acceptance criteria**:
    - Repeated page fragments that currently appear in multiple route modules can be rendered from shared helpers or partials.
    - Shared fragments are named clearly enough that their purpose is obvious during code review.
    - Updating a repeated UI fragment no longer requires editing multiple unrelated route handlers when a shared abstraction exists.
    - The refactor does not force every fragment to become shared if keeping it local is clearer.

- [ ] **Keep the migration safe and easy to verify**
  - **Story**: Website Owner - As the website owner, I want this refactor delivered in small, testable steps so that internal cleanup does not quietly break important pages.
  - **What**: Migrate rendering page-by-page or area-by-area, with clear validation of the main authenticated flows.
  - **Acceptance criteria**:
    - The migration can be completed incrementally rather than as a single all-or-nothing rewrite.
    - Each migrated page preserves its existing route behavior, status codes, and redirects.
    - High-value pages such as Feeds, Add Feed, Reader, Articles, and Crawl History are validated after migration.
    - The epic is considered complete when the app's main server-rendered pages use the new rendering pattern consistently enough that inline HTML assembly is no longer the default approach.

---

## Implementation Considerations

- The current app already has a shared layout seam in `src/layout.js`; that is a natural starting point for introducing a reusable view-layer abstraction.
- Several routes currently mix database access, query parsing, conditional workflow logic, and large inline HTML strings in the same file. This epic should separate those concerns without changing page behavior.
- The Add Feed flow is a useful stress test because it contains multiple states, forms, notices, and conditional sections in a single server-rendered page.
- The Feeds, Reader, and Articles pages are good candidates for extracting reusable list, pagination, and empty-state partials.
- The rendering approach should make escaped-by-default output the normal path and make trusted raw HTML insertion explicit.
- The migration should keep future options open, including a later move to JSX-based SSR if the project chooses that direction in a separate epic.

## Out Of Scope

- Rewriting the application into a client-side SPA.
- Changing the authentication model or login flow.
- Redesigning the information architecture, page layout, or navigation labels.
- Changing route URLs, form workflows, or database behavior as part of the rendering cleanup.
- Full migration to JSX, TSX, React, Preact, HTM, Mustache, or another rendering system in this epic.
- Introducing browser-side hydration or interactive front-end state management beyond what already exists.

## Suggested Validation

- Verify the authenticated routes still render and respond correctly after the refactor.
- Verify shared header and navigation still appear correctly on pages that currently use them.
- Verify the Add Feed workflow still supports its existing states, notices, and back/confirm actions.
- Verify Feeds, Reader, Articles, Feed Detail, and Crawl History still render their dynamic lists, notices, and empty states correctly.
- Verify known 404 pages and other status-specific responses still return the expected status code and visible content.
- Verify dynamic values continue to be escaped unless intentionally rendered as trusted raw HTML.
