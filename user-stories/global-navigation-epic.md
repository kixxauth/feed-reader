# Epic: Global Navigation For Core Pages

## Epic Goal

Add a clear global navigation section at the top of the app's core authenticated pages so people can quickly move between Home, Feeds List, and Crawl History without relying on page-specific back links.

This navigation should improve orientation and consistency while keeping the change intentionally limited to the pages named in this request.

## Decisions Captured For This Draft

- The new global navigation is in scope only for these pages:
  - `/`
  - `/feeds`
  - `/feeds/add`
  - `/feeds/:feedId`
  - `/feeds/:feedId/articles`
  - `/crawl-history`
  - `/crawl-history/:crawlRunId`
- The navigation should include links to:
  - `/` labeled `Home`
  - `/feeds` labeled `Feeds List`
  - `/crawl-history` labeled `Crawl History`
- The existing `Logout` action should remain available in the header alongside the new navigation.
- The current section should be visibly highlighted.
- Clicking `Home` in the header should always go to `/`.

---

## User Stories And Acceptance Criteria

- [ ] **Move between the app's main sections from any in-scope page**
  - **Story**: Website User - As a website user, I want a navigation section at the top of the main app pages so I can quickly move between the site's primary destinations.
  - **What**: Add a shared top navigation section to the in-scope pages with links to `Home`, `Feeds List`, and `Crawl History`.
  - **Acceptance criteria**:
    - The top navigation is shown on `/`, `/feeds`, `/feeds/add`, `/feeds/:feedId`, `/feeds/:feedId/articles`, `/crawl-history`, and `/crawl-history/:crawlRunId`.
    - The navigation includes visible links labeled `Home`, `Feeds List`, and `Crawl History`.
    - The `Home` link goes to `/`.
    - The `Feeds List` link goes to `/feeds`.
    - The `Crawl History` link goes to `/crawl-history`.
    - The navigation appears before the main page content so it is easy to find consistently.

- [ ] **Understand where I am in the site**
  - **Story**: Website User - As a website user, I want the current section to be highlighted in the navigation so I can tell where I am without reading the whole page.
  - **What**: Show an active state in the global navigation that reflects the current section, including detail pages that belong to a parent section.
  - **Acceptance criteria**:
    - On `/`, `Home` is visibly highlighted as the active navigation item.
    - On `/feeds`, `/feeds/add`, `/feeds/:feedId`, and `/feeds/:feedId/articles`, `Feeds List` is visibly highlighted as the active navigation item.
    - On `/crawl-history` and `/crawl-history/:crawlRunId`, `Crawl History` is visibly highlighted as the active navigation item.
    - Only one primary navigation item is highlighted at a time.
    - The active state is visually distinct enough to be recognized quickly.

- [ ] **Keep secondary page actions understandable**
  - **Story**: Website User - As a website user, I want the new global navigation to work alongside each page's existing page-specific actions so I can still complete tasks without confusion.
  - **What**: Introduce the global navigation without removing the page-specific links and actions that are still useful on individual screens.
  - **Acceptance criteria**:
    - Existing page-specific actions such as `Back to Feeds`, `View Articles`, `Add Feed`, and crawl-history detail navigation continue to work as designed unless explicitly replaced in a future epic.
    - The new global navigation does not make task-specific actions harder to find.
    - Pages with detail-level context still preserve their local actions in addition to the new global navigation.

- [ ] **Keep logout available in the header**
  - **Story**: Website Owner - As the website owner, I want the existing logout action to remain available in the header so the navigation upgrade does not remove an important account action.
  - **What**: Extend the top header rather than replacing it with only the three new destination links.
  - **Acceptance criteria**:
    - `Logout` remains visible in the header on the in-scope authenticated pages.
    - Adding the global navigation does not remove or hide the ability to sign out.
    - The `Logout` action remains visually separate enough from the primary navigation destinations that it is not confused for a content section.

- [ ] **Limit the change to the requested pages**
  - **Story**: Website Owner - As the website owner, I want this navigation change limited to the requested pages so the release stays focused and low-risk.
  - **What**: Implement the global navigation only on the pages listed in this request, rather than treating it as a broader redesign of every authenticated screen.
  - **Acceptance criteria**:
    - The epic is considered complete when the navigation appears on the seven requested route patterns and behaves consistently there.
    - Pages outside this list are not required to adopt the new navigation as part of this epic.
    - The design and implementation avoid creating extra scope such as a full sitewide information architecture redesign.

- [ ] **Use clear, stable labels for the primary destinations**
  - **Story**: Website Owner - As the website owner, I want the primary navigation labels to stay simple and predictable so people can learn the app quickly.
  - **What**: Use the requested labels consistently across the navigation and do not rename the primary destinations within this epic.
  - **Acceptance criteria**:
    - The header uses `Home`, `Feeds List`, and `Crawl History` as the navigation labels.
    - The labels appear consistently across all in-scope pages.
    - The active state and destination URLs remain aligned with those labels.

---

## Implementation Considerations

- The current shared layout already renders an authenticated header with `Crawl History` and `Logout`, so this epic likely extends that shared layout rather than building separate navigation markup inside each route.
- The current `/` page is a minimal home screen with a link to `/feeds`; this epic formalizes `Home` as a first-class navigation destination.
- Detail pages such as `/feeds/:feedId`, `/feeds/:feedId/articles`, and `/crawl-history/:crawlRunId` should map to their parent section in the active navigation state.
- This epic should avoid replacing local workflow links that still have value, since global navigation and page-level navigation solve different problems.
- The navigation is only required on the listed pages, even if implementation convenience makes it tempting to apply it more broadly.

## Out Of Scope

- Redesigning every authenticated page in the product.
- Changing route URLs for the existing pages.
- Renaming the requested navigation labels.
- Replacing page-specific back links or task actions unless a later story explicitly calls for it.
- Changing authentication, session, or logout behavior beyond keeping `Logout` available in the header.

## Suggested Validation

- Verify the header appears on each in-scope route.
- Verify the header contains `Home`, `Feeds List`, `Crawl History`, and `Logout`.
- Verify `Home` always links to `/`, `Feeds List` links to `/feeds`, and `Crawl History` links to `/crawl-history`.
- Verify the correct navigation item is highlighted for list, add, detail, and history-detail pages.
- Verify existing page-level actions still remain usable after the header change.
