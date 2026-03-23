# Feed Reader: Articles Browsing Feature

## Overview

Import thousands of existing articles from an external SQLite database into the Feed Reader app, and allow the website user to browse those articles organized by feed source. Articles are paginated (20 per page) within each feed, and can be filtered by publication date range. Clicking an article opens the original content in a new browser tab.

---

## Website User Stories

### Story 1: User views articles for a specific feed

**As a** website user
**I want to** click on a feed and see a list of its articles
**So that** I can browse content from that feed

**Acceptance Criteria:**
- The Feeds page includes a way to navigate to the articles for each feed (e.g., a link on the feed title or a separate "View Articles" link)
- Clicking that link takes the user to an Articles page for that specific feed
- The Articles page shows the feed's title at the top so the user knows which feed they are browsing
- The Articles page includes a link back to the Feeds page
- The Articles page is only accessible to logged-in users

---

### Story 2: User sees articles listed in reverse chronological order

**As a** website user
**I want to** see the most recently published articles at the top of the list
**So that** I can quickly find the newest content first

**Acceptance Criteria:**
- Articles are sorted by publication date, newest first
- Each article in the list shows its title and publication date
- Articles with no publication date are shown at the end of the list

---

### Story 3: User navigates through pages of articles

**As a** website user
**I want to** navigate through articles using Previous and Next buttons
**So that** I can browse all articles even when there are hundreds of them

**Acceptance Criteria:**
- Articles are paginated at 20 articles per page
- Previous and Next navigation buttons are displayed on the Articles page
- The Previous button is disabled (or hidden) when the user is on the first page
- The Next button is disabled (or hidden) when the user is on the last page
- The current page number and total page count are displayed (e.g., "Page 2 of 14")
- Navigating between pages does not clear any active date filter

---

### Story 4: User opens an article in its original location

**As a** website user
**I want to** click on an article title to read its full content
**So that** I can read the original article from the source website

**Acceptance Criteria:**
- Each article title is a clickable link
- Clicking an article title opens the original article URL in a new browser tab
- Articles without a link are still displayed in the list, but their title is not clickable

---

### Story 5: User filters articles by date range

**As a** website user
**I want to** filter a feed's articles to only show articles published within a specific date range
**So that** I can find articles from a particular time period without scrolling through everything

**Acceptance Criteria:**
- The Articles page includes a "From" date input and a "To" date input
- The user can enter a start date, an end date, or both
- Submitting the filter reloads the article list showing only articles whose publication date falls within the specified range (inclusive of both endpoints)
- Pagination resets to page 1 when a filter is applied
- The applied date values remain visible in the date inputs after filtering, so the user can see what filter is active
- A "Clear" button (or equivalent) removes the date filter and shows all articles again
- If no articles match the filter, a message is shown explaining that no articles were found for that date range

---

### Story 6: User sees an empty state when a feed has no articles

**As a** website user
**I want to** see a clear message when a feed has no articles
**So that** I understand why the articles list is empty

**Acceptance Criteria:**
- When a feed has zero articles in the database, the Articles page displays a message indicating there are no articles available
- The date filter controls are not shown in the empty state
- Navigation buttons are not shown in the empty state

---

## Website Owner Stories

### Story 7: Owner imports existing articles into the app

**As a** the website owner
**I want to** run a script that imports articles from my existing SQLite database into the app
**So that** my historical archive of articles becomes available on the website

**Acceptance Criteria:**
- A script exists that reads articles from an external SQLite file and imports them into the D1 database
- The script is run from the command line and accepts the path to the source SQLite file as an argument
- The script supports importing to the local development environment and to the production environment (via a `--env` flag, matching the existing `import-feeds.js` pattern)
- The import is idempotent: re-running the script with the same source file does not create duplicate articles
- The script prints progress information to the terminal (e.g., how many articles were processed)
- The source articles table must have these columns: `id`, `feed_id`, `link`, `title`, `published`, `updated`, `added`

---

### Story 8: Owner ensures all pages remain private

**As a** the website owner
**I want to** ensure that the articles pages (like all other pages on this site) require a login
**So that** the content is only accessible to authorized users

**Acceptance Criteria:**
- The Articles page for any feed requires an active login session
- A visitor who is not logged in and attempts to access an articles URL is redirected to the login page
- After logging in, the visitor is redirected back to the articles page they originally tried to visit

---

### Story 9: Owner can navigate from the Feeds page to each feed's articles

**As a** the website owner
**I want to** the Feeds page to link to each feed's articles
**So that** I can quickly reach the articles for any feed while browsing

**Acceptance Criteria:**
- Every feed shown on the Feeds page retains its existing link to the feed's external website (the html_url), opening in a new browser tab
- Every feed shown on the Feeds page also has a second, clearly labeled link to that feed's Articles page (e.g., labeled "Articles")
- Both links are visible at the same time for each feed — neither replaces the other

---

## Implementation Notes

- The articles database table (`articles`) must be created via a new D1 migration, following the same migration pattern already in use
- The articles table schema: `id TEXT PRIMARY KEY`, `feed_id TEXT`, `link TEXT`, `title TEXT`, `published TEXT`, `updated TEXT`, `added TEXT`
- Article date filtering applies to the `published` date column
- Crawling feeds to fetch new articles automatically is **out of scope** for this feature
- Feed management (adding, editing, deleting feeds) is **out of scope**
- The page size for articles is fixed at 20 per page
- All pages on the site already require authentication; this feature must continue to enforce that requirement
