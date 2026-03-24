# Epic: Add RSS Feed via URL

## Overview

Currently, users cannot add new RSS feeds directly from the UI. Feeds can only be added via command-line import scripts. This epic adds a user-facing feature that allows users to add a new RSS feed by pasting in either:
1. A direct RSS/Atom feed URL
2. A website URL (the system will scrape it to find feed links)

**Key Behaviors:**
- User pastes a URL (website or direct feed) into a form
- System auto-detects whether it's a valid feed or a website
- If it's a website, system scrapes for RSS/Atom feed links
- If one feed is found, it's auto-selected; if multiple feeds are found, user picks one
- User sees the feed's title, description, and website URL for confirmation
- If no feeds are found on website, user can paste the direct feed URL instead
- User clicks "Confirm" to add the feed to the database
- Feed starts an immediate asynchronous crawl to fetch initial articles
- Duplicate feeds are detected and prevented with a clear error message
- No artificial limit on the number of feeds a user can add

---

## User Stories

### Website User Stories

#### US-1: Add a New Feed via URL (Website or Direct Feed)

**As a** website user
**I want to** add a new RSS feed by pasting either a website URL or a direct feed URL
**So that** I can subscribe to new content without needing to know the exact feed URL

**Acceptance Criteria:**
- [ ] A new "Add Feed" button appears on the Feeds page (e.g., in the header or top section)
- [ ] Clicking the button navigates to a dedicated `/feeds/add` page with a single form
- [ ] The form has a text input field labeled "URL" (accepting both website and feed URLs) and a "Submit" button, plus a "Back" link to return to Feeds page
- [ ] When I enter any valid URL (website or feed) and click "Submit", the system processes it:
  - **If it's a valid RSS/Atom feed**: skip to confirmation (see US-5)
  - **If it's a website**: scrape it to find RSS/Atom feed links (see US-4)
  - **If it's neither**: show an error message (see US-2)
- [ ] When I click "Confirm" on the final confirmation screen, the feed is added to the database and I am redirected to the Feeds page
- [ ] The newly added feed appears in its sorted position (by hostname) in the Feeds list
- [ ] A success message appears on the Feeds page confirming the feed was added
- [ ] The Feeds page shows an initial status message: "Feed added. Initial crawl in progress."
- [ ] If the immediate crawl fails (see US-8), the feed is still added and a warning message explains the failure reason

#### US-2: Handle Invalid URLs

**As a** website user
**I want** to receive a clear error message if I paste an invalid or unreachable URL
**So that** I understand what went wrong and can correct it

**Acceptance Criteria:**
- [ ] If the URL is malformed (not a valid HTTP/HTTPS URL), an error message appears: "Please enter a valid URL (must start with http:// or https://)"
- [ ] If the URL is valid but the server is unreachable (network error, 404, 500, etc.), an error message appears: "Could not reach this URL. Please check it and try again."
- [ ] If the URL is neither a valid feed nor a website with discoverable feeds, an error message appears: "This does not appear to be a valid RSS/Atom feed or a website with feeds. Please try a different URL."
- [ ] If a feed URL is not parseable, an error message appears: "The feed could not be parsed. Please check the URL."
- [ ] Error messages appear on the form page; the form remains filled with the entered URL so the user can edit and retry
- [ ] All error messages are user-friendly (non-technical language)

#### US-3: Prevent Duplicate Feeds

**As a** website user
**I want** to be prevented from adding the same feed twice
**So that** I don't accidentally create duplicate subscriptions

**Acceptance Criteria:**
- [ ] If I try to add a feed that already exists (by `xml_url`), the system detects this during validation
- [ ] An error message appears: "This feed is already in your subscriptions" with a link to the existing feed
- [ ] The form does not proceed to the confirmation step
- [ ] Duplicate detection is case-insensitive and handles trailing/leading whitespace in URLs
- [ ] Duplicate detection works for feeds that were added manually and feeds imported via the CLI script

#### US-4: Discover Feeds from a Website

**As a** website user
**I want** to paste a website URL and have the system find its RSS/Atom feeds
**So that** I don't need to manually find the feed URL for a website

**Acceptance Criteria:**
- [ ] When I paste a website URL (e.g., `https://example.com`), the system fetches the website and looks for feed links
- [ ] The system searches for feed links in common locations:
  - `<link rel="alternate" type="application/rss+xml" href="...">` (RSS)
  - `<link rel="alternate" type="application/atom+xml" href="...">` (Atom)
  - `<link rel="feed" href="...">` (generic feed)
  - Common feed URLs: `/feed`, `/rss`, `/atom.xml`, `/feed.xml`, `/feeds/atom`, etc.
- [ ] If exactly one feed is found, it is automatically selected and the confirmation screen appears (see US-5)
- [ ] If multiple feeds are found, a selection screen appears showing:
  - Feed title (if available from the HTML title tag)
  - Feed type (RSS, Atom, etc.)
  - A "Select" button for each feed
- [ ] If I click "Select" on one of the feeds, the confirmation screen appears
- [ ] If no feeds are found, an error message appears: "No RSS/Atom feeds found on this website. You can try pasting the direct feed URL instead." with an input field to paste the feed URL directly
- [ ] If the user pastes a direct feed URL in the fallback field, the system validates it as a feed and proceeds to confirmation

#### US-5: Confirm Feed Selection

**As a** website user
**I want** to review feed details before confirming its addition
**So that** I'm sure I'm adding the correct feed

**Acceptance Criteria:**
- [ ] The confirmation screen displays:
  - Feed title (from `<title>` in RSS/Atom)
  - Feed description (from `<description>` in RSS or `<subtitle>` in Atom)
  - Website URL (auto-discovered from feed)
- [ ] I can click "Confirm" to add the feed, or "Back" to change my selection or try a different URL
- [ ] When I click "Confirm", the feed is added to the database and I'm redirected to the Feeds page
- [ ] A success message appears on the Feeds page confirming the feed was added

#### US-6: Cancel Adding a Feed

**As a** website user
**I want** to cancel the add-feed process at any point
**So that** I don't accidentally add a feed I changed my mind about

**Acceptance Criteria:**
- [ ] On the URL entry form (`/feeds/add`), a "Back" link takes me back to the Feeds page without making any changes
- [ ] On the feed selection screen (if multiple feeds found), a "Back" button takes me back to the URL entry form with the URL still filled in
- [ ] On the confirmation screen, a "Back" button takes me back to the previous screen (feed selection or URL form)
- [ ] Clicking "Back" at any point does not add the feed to the database
- [ ] Clicking "Back" at any point does not trigger any feed crawls

#### US-7: Auto-Discover Feed Website URL

**As a** website user
**I want** the system to automatically discover the feed's website URL
**So that** I can click through to the website from the Feeds page without manually entering it

**Acceptance Criteria:**
- [ ] When a feed is fetched and parsed, the system attempts to extract the website URL (`html_url`) from:
  - RSS: `<channel><link>` element
  - Atom: `<link rel="alternate" href="...">` or first `<link>` element
- [ ] If a website URL is found, it is displayed on the confirmation screen before the user confirms the feed
- [ ] If no website URL is found in the feed, the confirmation page shows the feed title and description but omits the website URL field
- [ ] The discovered website URL is stored in the `html_url` column of the feed record
- [ ] The website URL is clickable from the Feeds page (existing functionality applies)

#### US-8: Handle Crawl Failures During Feed Addition

**As a** website user
**I want** to understand if the initial crawl of my newly added feed succeeded or failed
**So that** I know whether articles are available or if I need to wait for the next scheduled crawl

**Acceptance Criteria:**
- [ ] When a feed is added, the system immediately attempts to crawl it
- [ ] The HTTP response for "Confirm" is not blocked by the immediate crawl (asynchronous behavior)
- [ ] After redirect, the Feeds page shows: "Feed added. Initial crawl in progress."
- [ ] If the crawl succeeds quickly, articles become visible in the feed on refresh or next navigation
- [ ] If the crawl fails (network error, invalid content, etc.), the Feeds page shows: "Feed added, but could not fetch articles yet. Reason: [specific error message]. Articles will be fetched at the next scheduled crawl (2am UTC)."
- [ ] Examples of specific error messages:
  - "Could not reach the feed URL (network error or server unavailable)"
  - "The feed returned invalid content"
  - "Failed to parse the feed XML"
- [ ] Even if the crawl fails, the feed is still saved to the database with `no_crawl = 0`
- [ ] The feed will be automatically retried at the next scheduled 2am crawl
- [ ] Crawl failures are recorded in the crawl history (`crawl_run_details` table) with status `failed` and the error message
- [ ] The user is never blocked from confirming feed addition due to immediate crawl outcome

---

### Website Owner Stories

#### US-9: Monitor Feed Addition Activity

**As a** website owner
**I want** to be able to see which feeds have been added recently
**So that** I can monitor usage and understand what feeds users are subscribing to

**Acceptance Criteria:**
- [ ] The database records when each feed was created (already have `created_at` column)
- [ ] There are no artificial limits preventing users from adding feeds
- [ ] The crawl history and crawl run details continue to work correctly for user-added feeds (same as imported feeds)

#### US-10: Ensure System Stability During Feed Addition

**As a** website owner
**I want** the feed addition process to be robust and not cause system outages
**So that** users can add feeds reliably without affecting other users or the application

**Acceptance Criteria:**
- [ ] Feed validation (fetching and parsing) has a reasonable timeout (e.g., 30 seconds)
- [ ] If fetching a feed or website during validation takes too long, the system shows an error: "The request took too long. Please try again."
- [ ] Website scraping is efficient and doesn't download the entire website
- [ ] Adding a feed does not block other users from browsing or adding their own feeds
- [ ] The immediate crawl of a newly added feed runs asynchronously (does not block the HTTP response)
- [ ] All errors during feed validation, website scraping, and immediate crawl are logged for debugging
- [ ] The system handles concurrent add-feed requests gracefully (no race conditions)

---

## Acceptance Criteria Summary (All Stories)

### Functional
- ✅ Users can enter either a website URL or a direct feed URL in a form
- ✅ System auto-detects if URL is a feed or website
- ✅ System scrapes websites to find RSS/Atom feed links
- ✅ If 1 feed found on website, it's auto-selected; if multiple, user picks one
- ✅ System displays feed title, description, and website URL for confirmation
- ✅ User confirms addition, feed is saved to database
- ✅ Feed starts an immediate asynchronous crawl for articles
- ✅ Duplicate feeds are detected and rejected
- ✅ If no feeds found on website, user can paste direct feed URL
- ✅ Clear, user-friendly error messages for all failure scenarios
- ✅ Back/cancel navigation works at all steps

### Non-Functional
- ✅ Feed validation completes within 30 seconds
- ✅ No artificial limit on number of feeds
- ✅ Concurrent requests are handled safely
- ✅ All feed data (user-added or imported) is treated identically
- ✅ XSS protection applied to user input and feed data
- ✅ Failed crawls do not prevent feed from being added

---

## Technical Notes

### Database & Schema
- No schema changes required; feeds table already has all needed columns
- `created_at` column will track when feed was added
- Standard feed record structure applies to user-added feeds

### UI Location
- "Add Feed" button on the Feeds page (top/header area) that navigates to `/feeds/add`
- Dedicated `/feeds/add` page with a form to enter the feed URL
- Form is simple and prominent
- "Back" links/buttons navigate back to previous page without making changes

### Feed Validation & Discovery Process
1. User enters URL → basic URL format validation
2. System fetches URL with 30-second timeout
3. **Auto-detect**: Is it a valid feed?
   - If yes: Parse as feed (skip to step 5)
   - If no: Try to scrape as a website (step 4)
4. **Website scraping** (if step 3 detected it's not a feed):
   - Fetch the HTML content
   - Search for feed links in `<head>` and `<link>` tags:
     - `<link rel="alternate" type="application/rss+xml">`
     - `<link rel="alternate" type="application/atom+xml">`
     - `<link rel="feed">`
   - Check common feed URL patterns: `/feed`, `/rss`, `/atom.xml`, `/feed.xml`, etc.
   - If 1 feed found: use it (proceed to step 5)
   - If multiple feeds found: show selection screen (user picks one, then proceed to step 5)
   - If 0 feeds found: show error with option to paste direct feed URL
5. Parse feed with `parseFeedXml` from `src/parser.js`
6. Extract title, description, feed type (RSS/Atom), and website URL (`html_url`)
7. Check for duplicate by `xml_url`
8. Display confirmation screen with extracted metadata
9. On user confirmation, create feed record
10. Trigger immediate crawl asynchronously
11. Redirect to Feeds page with "Feed added. Initial crawl in progress."
12. Show crawl success/failure outcome when available

### Feed Record Creation
- Generate a new UUID for `id` field
- Extract and store from parsed feed:
  - `title`: feed title
  - `xml_url`: the feed URL (discovered from website or directly provided by user)
  - `html_url`: auto-discovered website URL (RSS: `<channel><link>`, Atom: `<link rel="alternate">` or first `<link>`)
  - `type`: feed format (RSS, Atom, etc.)
  - `description`: auto-populated from feed metadata
- Set `no_crawl = 0` (feed is enabled for crawling)
- Set `consecutive_failure_count = 0`
- Let `created_at` and `updated_at` be set by database defaults

### Immediate Crawl
- After feed is saved to the database, trigger an immediate crawl of that feed asynchronously (does not block the HTTP response)
- Crawl logic: Fetch feed from `xml_url`, parse with `parseFeedXml` from `src/parser.js`, extract articles, upsert them
- If crawl succeeds: articles are inserted and become visible in the feed
- If crawl fails: record the failure reason; show warning message on the Feeds page; feed remains in database with `no_crawl = 0`
- Feed will be retried at the next scheduled 2am crawl
- Record crawl result in `crawl_run_details` table with status (`success` or `failed`) and error message if applicable
- Possible errors to handle and report:
  - Network error (could not reach the feed URL)
  - Invalid content (returned HTML or non-feed data)
  - Malformed XML (cannot be parsed)
  - Server errors (5xx responses)

### Error Handling (Canonical)
- Invalid URL format → "Please enter a valid URL (must start with http:// or https://)"
- Network/server error while fetching submitted URL → "Could not reach this URL. Please check it and try again."
- Timeout while validating URL/feed → "The request took too long. Please try again."
- URL is not a feed and website has no discoverable feeds → "No RSS/Atom feeds found on this website. You can try pasting the direct feed URL instead."
- Feed parse error during validation → "The feed could not be parsed. Please check the URL."
- Duplicate feed (`xml_url`) → "This feed is already in your subscriptions" (with link to existing feed)
- Immediate crawl network error → "Could not reach the feed URL (network error or server unavailable)"
- Immediate crawl invalid content → "The feed returned invalid content"
- Immediate crawl malformed XML → "Failed to parse the feed XML"

---

## Out of Scope (Future Enhancements)

- Per-user subscriptions (currently all users share the same feeds)
- Bulk add multiple feeds at once
- Import feeds from OPML file
- Auto-discovery of website feeds without user intervention (e.g., browser extension)
- Edit feed settings after adding (title, crawl frequency, etc.)
- Delete feeds via UI
- User permissions or roles (only owner can add feeds, etc.)
- Feed import from another feed reader service
- Display creation date or feed source (imported vs. added) on Feeds page
- Subscription/follow notifications for new feeds
- Search for feeds by name or URL

---

## Success Metrics

- Users can add a new feed in < 2 minutes using the UI
- No server errors when adding feeds
- Duplicate detection prevents accidental re-subscriptions
- Feed articles appear within 1 minute of adding the feed
- Clear error messages guide users to resolution
