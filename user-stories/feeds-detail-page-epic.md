# Epic: Feed Detail Page and Disabled Feed Filter

## Epic Goal

Improve feed management and feed discovery by adding an in-app feed detail page, changing the feeds list so the feed title opens that detail page, and adding a simple filter that shows only disabled feeds.

This epic should preserve the app's existing server-rendered, authenticated workflow and avoid introducing unnecessary complexity into the feeds list.

## Decisions Captured For This Draft

- Clicking a feed title on `/feeds` should open a new in-app feed detail page.
- The feeds list should no longer show the current `Articles` link.
- The feeds list should show a separate link for visiting the feed's website.
- The feed detail page should include owner/admin details, recent activity summary where available, and quick actions.
- The feeds list filter should be a simple "disabled only" option rather than a multi-state filter.
- When a user returns from a feed detail page or completes an action, the current list filter and page should be preserved when possible.

---

## User Stories And Acceptance Criteria

- [ ] **Open a feed detail page from the feeds list**
  - **Story**: Website User - As a website user, I want to click a feed title on the feeds list and open a detail page inside the app so I can review the feed before leaving the site.
  - **What**: Update the feeds list so the feed title links to a new detail page for that feed instead of linking directly to the external website.
  - **Acceptance criteria**:
    - On `/feeds`, each feed title links to that feed's in-app detail page.
    - Clicking the feed title keeps the user inside the app instead of opening the external site.
    - The feed list still clearly identifies the feed by title and hostname.
    - If the feed does not exist, the detail route returns a clear not-found response.

- [ ] **Show complete feed information on the detail page**
  - **Story**: Website User - As a website user, I want to see the important details for a feed on one page so I can understand what the feed is and where it comes from.
  - **What**: Create a feed detail page that displays the feed's available metadata in a readable layout.
  - **Acceptance criteria**:
    - The detail page shows the feed title and hostname.
    - The detail page shows the feed website URL as a visitable link if one exists.
    - The detail page shows the feed URL if one exists.
    - The detail page shows the feed description when available.
    - Missing optional values are handled gracefully without broken layout or placeholder errors.
    - All user-visible feed values are HTML-escaped before rendering.

- [ ] **Provide clear actions from the detail page**
  - **Story**: Website User - As a website user, I want clear next steps on the detail page so I can continue browsing without going back to the list just to act.
  - **What**: Add action links and controls on the detail page for the most useful next steps.
  - **Acceptance criteria**:
    - The detail page includes a clear action to open the feed's website when a website URL exists.
    - The detail page includes a clear action to view that feed's articles.
    - The detail page includes a clear way to return to the feeds list.
    - Returning to the feeds list preserves the prior page and disabled-only filter when that context is available.

- [ ] **Show owner-facing feed administration details**
  - **Story**: Website Owner - As the website owner, I want to see operational metadata for a feed so I can understand its current status and manage it confidently.
  - **What**: Extend the detail page to show owner/admin-specific feed metadata that already exists in the system.
  - **Acceptance criteria**:
    - The detail page shows whether crawling is currently enabled or disabled.
    - The detail page shows the feed's consecutive failure count.
    - The detail page shows the feed's last build date when available.
    - The detail page shows the feed's score when available.
    - The detail page shows created and updated timestamps when available.
    - The page labels admin metadata clearly so the owner can distinguish it from public feed information.

- [ ] **Allow crawl status changes from the detail page**
  - **Story**: Website Owner - As the website owner, I want to enable or disable crawling from the detail page so I can manage a feed without going back to the list.
  - **What**: Add the existing crawl toggle capability to the feed detail page and preserve navigation context after the action completes.
  - **Acceptance criteria**:
    - The detail page includes an enable/disable crawl action for the current feed.
    - Submitting the action updates the crawl status using the existing server-side toggle flow.
    - Re-enabling a feed still resets the consecutive failure count according to current app behavior.
    - After the action completes, the user returns to a sensible location with prior list context preserved when it was available.
    - If the feed does not exist, the toggle flow returns a clear not-found response.

- [ ] **Show recent activity context on the detail page**
  - **Story**: Website Owner - As the website owner, I want recent activity context on the feed detail page so I can quickly understand whether the feed has been healthy or problematic.
  - **What**: Surface a concise summary of recent crawl-related information on the detail page using data already available in the system where possible.
  - **Acceptance criteria**:
    - The detail page shows recent crawl-related context that is meaningful for the selected feed when such data exists.
    - If recent crawl-related data is unavailable, the page falls back gracefully rather than showing errors or empty broken sections.
    - The recent activity section is concise and does not overwhelm the primary feed details.
    - The information shown is consistent with the current crawl history data model and wording used elsewhere in the app.

- [ ] **Filter the feeds list to show disabled feeds only**
  - **Story**: Website Owner - As the website owner, I want a simple way to show only disabled feeds so I can quickly review feeds that may need attention.
  - **What**: Add a simple filter control on `/feeds` that switches between the default view and a disabled-only view.
  - **Acceptance criteria**:
    - The feeds list includes a visible control for showing only disabled feeds.
    - The default feeds list still shows all feeds.
    - When the disabled-only filter is active, only feeds with disabled crawling appear in the list.
    - Pagination, item counts, and empty states reflect the filtered result set rather than the unfiltered total.
    - The filter state is reflected in the URL so the view is shareable and can be preserved during navigation.
    - The filter can be cleared easily to return to the default feeds list.

- [ ] **Preserve list state across navigation**
  - **Story**: Website Owner - As the website owner, I want the app to remember where I was in the feeds list so I can review multiple feeds efficiently without losing my place.
  - **What**: Preserve feeds list context, especially page number and disabled-only filter state, across navigation paths related to this epic.
  - **Acceptance criteria**:
    - Navigating from the feeds list to a feed detail page preserves the current page and filter context.
    - Returning from the detail page to the feeds list restores that context when it is available.
    - Performing an enable/disable action does not unexpectedly reset the user to the unfiltered first page if context was available before the action.
    - Context preservation works for both the default feeds view and the disabled-only view.

---

## Implementation Considerations

- The current app already has `/feeds`, `/feeds/:feedId/articles`, and `POST /api/feeds/:feedId/toggle-crawl`.
- The current feeds list links the title to the external website and separately links to articles. This epic intentionally changes that behavior.
- The feeds list and articles pages already use query-string-driven pagination. The same approach should be used for the disabled-only filter and return-state preservation.
- The current toggle endpoint redirects back to `/feeds`. This epic likely needs context-aware redirect behavior so the user can land back on the filtered or paginated view they came from.
- The app already stores the fields needed for most of the detail page, including `description`, `xml_url`, `html_url`, `no_crawl`, `last_build_date`, `score`, `created_at`, `updated_at`, and `consecutive_failure_count`.

## Out Of Scope

- Adding an enabled-only filter or a full multi-state filter chooser.
- Redesigning site-wide navigation beyond what is required to support this flow.
- Replacing the existing articles page with an articles preview embedded directly into the detail page.
- Adding new background crawling behavior, new crawl rules, or new feed health calculations.
- Creating a brand-new API surface for feeds if the server-rendered route pattern remains sufficient.

## Suggested Validation

- Verify that feed titles on `/feeds` open the new detail page.
- Verify that the external website link is still available from the list or detail page as designed.
- Verify that the list no longer shows the `Articles` link and that article access remains available from the detail page.
- Verify that the disabled-only filter changes the result set, pagination, and empty state correctly.
- Verify that the detail page shows feed metadata safely and gracefully for feeds with partial data.
- Verify that enabling or disabling a feed from the detail page preserves the user's browsing context.
- Verify that returning to `/feeds` from a detail page restores the previous page and filter when that context exists.
