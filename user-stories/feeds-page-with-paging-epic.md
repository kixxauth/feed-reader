# Feed Reader: Feeds Page Feature

## Overview
Move the feeds list from the home page to a dedicated "Feeds" page with pagination. The home page will contain only a link to the Feeds page.

---

## Website User Stories

### Story 1: User views all feeds on dedicated Feeds page
**As a** website user
**I want to** see all the feeds on a dedicated "Feeds" page
**So that** the home page is clean and I have a dedicated place to browse available feeds

**Acceptance Criteria:**
- A new "Feeds" page exists at an appropriate URL path
- The Feeds page displays feeds in a paginated list (50 feeds per page)
- Feeds are sorted alphabetically by domain name
- Each feed shows the feed title and domain name
- The Feeds page is accessible from the home page via a link

---

### Story 2: User navigates between pages of feeds
**As a** website user
**I want to** navigate through the feeds list using Previous/Next buttons
**So that** I can browse all feeds even though they're split across multiple pages

**Acceptance Criteria:**
- Previous/Next buttons are displayed on the Feeds page
- Previous button is disabled when viewing the first page
- Next button is disabled when viewing the last page
- Clicking Next takes the user to the next page of feeds
- Clicking Previous takes the user to the previous page
- The current page number is displayed (or implied by the state of the buttons)

---

### Story 3: User sees empty state when no feeds exist
**As a** website user
**I want to** see a message when there are no feeds available
**So that** I understand why the Feeds page appears empty

**Acceptance Criteria:**
- When there are zero feeds in the database, the Feeds page displays a message
- The message clearly indicates that there are no feeds available
- Previous/Next buttons are not displayed in the empty state

---

### Story 4: User visits a feed's website
**As a** website user
**I want to** click on a feed to visit the author's website
**So that** I can read the full content on the original website

**Acceptance Criteria:**
- Each feed in the list is clickable
- Clicking a feed takes the user to the feed's website (HTML URL)
- The link opens in a new browser tab

---

## Website Owner Stories

### Story 5: Owner presents organized feeds to visitors
**As a** the website owner
**I want to** organize feeds on a dedicated Feeds page sorted by domain name
**So that** visitors can easily browse and discover available feeds in a logical order

**Acceptance Criteria:**
- Feeds are always sorted alphabetically by domain name
- The sort order is consistent across all pages
- Feeds with the same domain name appear together
- The sorting happens automatically (no user interaction needed to change it)

---

### Story 6: Owner creates a clean home page landing page
**As a** the website owner
**I want to** have a home page that is minimal and links to the Feeds page
**So that** the home page serves as a clean entry point to the website

**Acceptance Criteria:**
- The home page contains no feeds list
- The home page has a link to the Feeds page labeled "Feeds"
- The link is plain text with no special styling
- The home page is the default landing page when visiting the site

---

## Implementation Notes
- No user authentication/roles are required
- Feed management (adding/editing feeds) is not part of this feature
- No filtering or additional sorting options are needed beyond domain name sorting
- Pagination is fixed at 50 feeds per page
- No loading indicators or spinners are needed while fetching feeds
