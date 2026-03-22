# Feed Import Epic — User Stories & Acceptance Criteria

## Background

The website owner has an existing SQLite database of RSS feeds and wants to
migrate that data into this application. The import may need to run more than
once as new feeds are added to the source database before the full migration is
complete. The app is single-user (owner only).

---

## Roles

- **Website Owner** — The sole administrator and user of the site. Manages
  feeds and reads content.
- **Website User** — In this app, the same person as the owner. Reads and
  browses feeds via the web interface.

---

## User Stories

---

### Story 1 — Import Feeds from SQLite (Owner)

**As the website owner,**
I want to import my existing RSS feeds from my local SQLite database into the
app,
so that I don't have to re-enter each feed manually.

#### Acceptance Criteria

- A command-line tool or script is provided that reads the source SQLite
  database file and loads the feeds into the app's database.
- The following fields are imported for each feed:
  - `id`
  - `hostname`
  - `type`
  - `title`
  - `xml_url`
  - `html_url`
  - `no_crawl`
  - `description`
  - `last_build_date`
  - `score`
- The import works against both the **development** environment (local) and
  the **production** environment (Cloudflare).
- The owner can specify which environment to target when running the import.

---

### Story 2 — Re-import Without Duplicates (Owner)

**As the website owner,**
I want to run the import script multiple times as I add feeds to my source
database,
so that I can keep the app in sync without creating duplicate entries or losing
data.

#### Acceptance Criteria

- Running the import more than once does not create duplicate feed records.
- Existing feeds (matched by `id`) are updated with any changed field values
  from the source database.
- Feeds present in the app's database but absent from the source file are
  left unchanged (no deletions).
- The script reports how many feeds were inserted, updated, and skipped.

---

### Story 3 — View Feed List (User)

**As the website user,**
I want to see a list of all my RSS feeds sorted by hostname,
so that I can browse my subscriptions in a familiar, organized way.

#### Acceptance Criteria

- The home page (`/`) displays all feeds for authenticated users.
- Feeds are sorted alphabetically by `hostname`.
- Each feed entry shows at minimum: `title`, `hostname`, and a link to
  `html_url`.
- All feeds are shown regardless of their `no_crawl` value.
- The page is only accessible when logged in (existing auth is respected).
- If no feeds have been imported yet, a clear empty-state message is shown.

---

### Story 4 — Feed List Reflects Latest Import (User)

**As the website user,**
I want the feed list to reflect the most recently imported data,
so that newly added feeds appear without requiring any action on my part.

#### Acceptance Criteria

- After a successful import run, refreshing the feed list page shows the
  updated set of feeds.
- No manual cache clearing or app restart is required to see the changes.
