# Feed Reader: Automatic Feed Crawling Epic

## Overview

Add a background job that automatically fetches and processes all RSS feeds once every 24 hours. New articles discovered during each crawl are added to the database. Feeds that consistently fail are automatically disabled after 5 consecutive failures. The website owner can view a history of crawl runs and manually enable or disable crawling on a per-feed basis.

---

## Website User Stories

### Story 1: User sees up-to-date articles

**As a** website user
**I want to** see recently published articles when I browse a feed
**So that** I am reading current content without needing anyone to manually update the site

**Acceptance Criteria:**
- When I browse articles for a feed, the list includes articles that were published since the last time someone manually imported data
- New articles appear automatically without any manual action required from me or the site owner
- The experience of browsing articles is unchanged — same pagination, same date filtering, same layout

---

## Website Owner Stories

### Story 2: Feeds are crawled automatically every 24 hours

**As a** website owner
**I want** all crawlable feeds to be fetched automatically once per day
**So that** I do not have to manually run import scripts to keep articles up to date

**Acceptance Criteria:**
- The crawl job runs automatically once every 24 hours
- Each feed's RSS XML URL (`xml_url`) is fetched during the crawl
- Articles found in the RSS feed that do not already exist in the database are added as new articles
- Articles that already exist in the database are not duplicated
- Articles are never deleted from the database during a crawl, even if they no longer appear in the feed
- Feeds with the `no_crawl` flag set to true are skipped during the crawl
- The crawl processes all eligible feeds in a single run

---

### Story 3: Owner sees a history of crawl runs

**As a** website owner
**I want to** view a dedicated Crawl History page
**So that** I can see what happened during recent crawl runs, including what was added and what failed

**Acceptance Criteria:**
- A Crawl History page is accessible from the main navigation or feeds page (owner-only, requires login)
- The page lists recent crawl runs in reverse chronological order (most recent first)
- Each crawl run entry shows:
  - The date and time the crawl ran
  - Total number of feeds attempted
  - Total number of new articles added across all feeds
  - Total number of feeds that failed
- Each crawl run can be expanded or linked to a detail view showing per-feed results:
  - Feed title
  - Number of new articles added (or zero if none)
  - Error message if the feed failed (e.g., "HTTP 404", "connection timeout", "invalid XML")
  - Whether the feed was auto-disabled as a result of this run
- Crawl history is retained for at least 30 days
- Crawl runs with zero failures and zero new articles are still recorded so the owner can confirm the job is running

---

### Story 4: Failed feeds are automatically disabled after repeated failures

**As a** website owner
**I want** feeds that consistently fail to be automatically disabled
**So that** dead or broken feeds do not waste crawl time indefinitely

**Acceptance Criteria:**
- Each feed tracks a consecutive failure count
- When a feed fails during a crawl (network error, HTTP error, unparseable XML, etc.), its failure count increments by 1
- When a feed succeeds during a crawl, its failure count resets to 0
- After a feed accumulates 5 consecutive failures, its `no_crawl` flag is automatically set to true, disabling it from future crawls
- When a feed is auto-disabled, the crawl history for that run records the auto-disable event for that feed
- A feed that is auto-disabled can be manually re-enabled by the owner (see Story 5)

---

### Story 5: Owner can enable or disable crawling per feed

**As a** website owner
**I want to** manually toggle crawling on or off for individual feeds
**So that** I have full control over which feeds are crawled, including re-enabling auto-disabled feeds

**Acceptance Criteria:**
- The Feeds page displays, for each feed, whether crawling is currently enabled or disabled
- The owner can toggle crawling on or off for any feed directly from the Feeds page (e.g., an enable/disable button or toggle)
- When a feed is manually re-enabled, its consecutive failure count resets to 0
- Toggling takes effect immediately — the next crawl run will respect the updated setting
- The toggle is only visible and actionable to logged-in users (the owner)
- No confirmation dialog is required for toggling (it is easily reversible)

---

## Out of Scope

The following are explicitly not part of this epic:

- Updating or editing existing articles (crawling is additive only)
- Sending notifications or alerts when feeds fail or are auto-disabled (the crawl history page serves this purpose)
- Crawling on a schedule other than every 24 hours
- Per-user feed subscriptions or preferences
- Fetching full article body content (only the metadata available in the RSS feed is stored: title, link, publication date)
