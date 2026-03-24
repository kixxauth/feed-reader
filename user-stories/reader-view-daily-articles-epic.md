# Epic: Daily Reader View Across All Feeds

## Epic Goal

Add a dedicated reader view that shows all articles for a selected day across the site's feeds, grouped by feed, so a person can review one day's reading from one place instead of opening each feed separately.

This view should stay aligned with the app's existing server-rendered, authenticated patterns and should complement the existing per-feed articles pages rather than replace them.

## Decisions Captured For This Draft

- The reader view should use a dedicated route with a date query, following the app's existing query-string pattern. Draft assumption: `/reader?date=YYYY-MM-DD`.
- When the reader view is opened without a date, it should default to today's date in UTC and immediately show results for that day.
- The view should provide both a date picker and previous/next day controls.
- Only articles from feeds that are currently crawl-enabled should appear in this view.
- A day's matching rule should be:
  - use the article's `published` date when it exists
  - otherwise use the article's `added` date
- The selected day should be interpreted in UTC.
- Results should be grouped by feed.
- Feed groups should be ordered by the number of matching articles for the selected day, highest first.
- When two feeds have the same number of matching articles, the draft tie-breaker should be alphabetical by feed title so the order is stable.
- Within each feed group, the draft assumption is to sort articles newest first using the same effective date rule used for matching: `published` when present, otherwise `added`.

---

## User Stories And Acceptance Criteria

- [ ] **Open a day-focused reader view across all feeds**
  - **Story**: Website User - As a website user, I want one page that shows all articles for a chosen day across the site's feeds so I can review that day's reading in one place.
  - **What**: Add a dedicated reader page that aggregates articles across feeds for a selected date.
  - **Acceptance criteria**:
    - A dedicated authenticated reader view exists at a stable route.
    - The reader view accepts a date as the primary query input.
    - When no date is supplied, the view loads today's UTC date by default.
    - The page shows only articles whose effective date matches the selected day.
    - The effective date is `published` when present, otherwise `added`.
    - Articles from feeds that are currently disabled from crawling are not shown in this view.

- [ ] **Change the selected day easily**
  - **Story**: Website User - As a website user, I want simple controls for changing the day so I can move through daily reading without manually editing the URL.
  - **What**: Provide both direct date selection and stepwise day navigation.
  - **Acceptance criteria**:
    - The page includes a date picker for choosing a specific day.
    - The page includes a control to move to the previous day.
    - The page includes a control to move to the next day.
    - Using any of these controls updates the selected day and reloads the matching results.
    - The currently selected date is visible on the page so the user always knows which day is being shown.
    - The reader view's URL reflects the selected date so the view can be revisited or shared.

- [ ] **See results grouped by feed**
  - **Story**: Website User - As a website user, I want the day's articles grouped by feed so I can quickly understand which source each set of stories came from.
  - **What**: Render separate feed sections rather than a single mixed list of articles.
  - **Acceptance criteria**:
    - Matching articles are displayed in feed-based groups.
    - Each group clearly identifies the feed it belongs to.
    - Only feeds with at least one matching article for the selected day appear in the results.
    - Articles are not duplicated across groups.
    - The grouping remains readable when multiple feeds have articles on the same day.

- [ ] **Scan the busiest feeds first**
  - **Story**: Website User - As a website user, I want feeds with the most articles for the selected day to appear first so I can see the busiest sources before the quieter ones.
  - **What**: Order feed groups by the number of matching articles for the selected date.
  - **Acceptance criteria**:
    - Feed groups are ordered by matching-article count in descending order.
    - If two or more feeds have the same matching-article count, their order is stable and predictable.
    - The ordering reflects only the selected day's matching articles, not all-time article totals.
    - Changing the selected day can change the group order when the day's counts change.

- [ ] **Read each feed group in a sensible article order**
  - **Story**: Website User - As a website user, I want the articles inside each feed group presented in a sensible order so I can scan that feed's coverage quickly.
  - **What**: Sort each feed's matching articles by recency within the selected day.
  - **Acceptance criteria**:
    - Articles inside a feed group are sorted newest first using the effective date used by this view.
    - When `published` exists, it is used for ordering and day matching even if `added` is different.
    - When `published` is absent, `added` is used for ordering and day matching.
    - The ordering is stable enough that refreshing the same date does not randomly reshuffle equal items.

- [ ] **Understand when a selected day has no matching articles**
  - **Story**: Website User - As a website user, I want a clear empty state when there are no matching articles for a chosen day so I know the page is working and can pick another date.
  - **What**: Show a helpful no-results state while keeping the date controls available.
  - **Acceptance criteria**:
    - When no enabled feeds have matching articles for the selected day, the page shows a clear no-results message.
    - The no-results state still shows the selected date.
    - The date picker remains available in the no-results state.
    - Previous and next day controls remain available in the no-results state.
    - The no-results state does not show empty feed-group shells.

- [ ] **Apply the date rule consistently across all articles**
  - **Story**: Website Owner - As the website owner, I want the reader view to apply one clear date rule consistently so the results are predictable and explainable.
  - **What**: Use a single effective-date rule for inclusion, grouping, and ordering.
  - **Acceptance criteria**:
    - Articles with a non-null `published` value are matched against the selected UTC day using `published`.
    - Articles with a null `published` value are matched against the selected UTC day using `added`.
    - An article with both fields present is included or excluded based on `published`, even if `added` falls on a different day.
    - The same effective-date rule is used wherever the reader view needs to decide article placement or order.
    - The behavior is documented clearly enough in the implementation notes or tests that future changes do not silently alter it.

- [ ] **Keep disabled feeds out of the reader view**
  - **Story**: Website Owner - As the website owner, I want the daily reader view limited to currently crawl-enabled feeds so the reading surface reflects the active set of sources I still care about.
  - **What**: Exclude articles belonging to feeds whose crawl status is currently disabled.
  - **Acceptance criteria**:
    - Articles from feeds with crawl disabled do not appear in the reader view.
    - Re-enabling a previously disabled feed makes its matching articles eligible to appear again.
    - Disabling a feed removes its articles from subsequent reader-view results without needing any article data rewrite.
    - This filtering rule applies consistently for every selected date.

- [ ] **Make the reader view easy to revisit and navigate**
  - **Story**: Website Owner - As the website owner, I want the new reader view to fit naturally into the app so it can be discovered and reused instead of becoming a hidden page.
  - **What**: Give the page a stable route and integrate it into the app's normal navigation patterns.
  - **Acceptance criteria**:
    - The reader view has a stable URL structure that supports a selected date.
    - The selected date remains in the URL after navigation actions within the page.
    - The view is reachable through an intentional in-app navigation path rather than only by manually typing a URL.
    - Adding this navigation path does not remove access to the existing feeds list, feed detail pages, or per-feed articles pages.

- [ ] **Keep the release focused on daily reading, not a broader article-management redesign**
  - **Story**: Website Owner - As the website owner, I want this feature scoped to a daily grouped reader view so the release stays focused and low-risk.
  - **What**: Add a new cross-feed reading surface without turning this epic into a broader article-search or article-management project.
  - **Acceptance criteria**:
    - The epic is complete when a user can open the reader view for a day, change days, and review grouped results from enabled feeds.
    - Existing per-feed article pages continue to work and remain available.
    - This epic does not require read/unread state, saved filters, full-text search, or article management actions unless added in a future epic.
    - This epic does not require mixing all articles into one ungrouped timeline.

---

## Implementation Considerations

- The app already has per-feed article browsing with date filters, so this epic likely extends the existing article-query and server-rendered route patterns rather than introducing a separate client-side application.
- The current app uses query parameters for paging and date filtering, which makes a `?date=YYYY-MM-DD` approach a natural fit for this view.
- The database currently stores both `published` and `added`, but the existing feed-specific article browsing is based on `published` only. This epic introduces a cross-feed effective-date rule and should make that rule explicit in query logic and tests.
- Because the results are grouped by feed instead of shown as a single mixed timeline, the implementation will likely need a query and render flow that gathers all same-day matches first and then groups them by feed in the route layer or query layer.
- The choice to exclude disabled feeds means the reader view depends on current feed status, not only historical article records.
- The current navigation epics suggest this view should probably be added to shared authenticated navigation once implementation begins, but that navigation work should stay limited to what is needed to make the view discoverable.

## Out Of Scope

- Replacing the existing per-feed articles pages.
- Adding read/unread tracking, bookmarking, or article archiving.
- Adding keyword search, full-text search, or multi-day range filtering.
- Showing articles from disabled feeds.
- Rebuilding the app around an infinite-scroll article timeline.
- Adding per-user preferences for timezone or saved default dates as part of this epic.

## Suggested Validation

- Verify that opening the reader view without a `date` query shows today's UTC results.
- Verify that selecting a date shows only articles whose effective date falls on that UTC day.
- Verify that `published` takes precedence over `added` when both exist.
- Verify that articles with no `published` value can still appear based on `added`.
- Verify that disabled feeds are excluded even when they have matching articles for the selected day.
- Verify that feed groups are ordered by matching-article count descending, with stable tie behavior.
- Verify that articles inside each feed group are sorted newest first by the effective date rule.
- Verify that previous/next day controls and the date picker all keep the URL and visible date in sync.
- Verify that a no-results day shows a clear empty state while keeping all day-navigation controls available.
