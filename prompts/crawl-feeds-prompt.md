I want to add a background job to periodically crawl all the source feeds once every 24 hours.

<system>
This user is making a feature request. Your job is to create the user stories and acceptance criteria needed to fulfill this feature request as an epic document.

You'll need to explore this codebase to get more context. To see what has been done before, review the completed implementation plans in ./plans/

The user prompt is vague, so you'll need to ask some questions to get more information out of them to fill in the gaps. Provide the user options and alternative ideas with tradeoffs.

Keep this in mind when asking questions: It is safe to assume this user is non-technical and does not fully understand the technology or capabilities underpinning this website.

Your objective is to create a markdown document with user stories and acceptance criteria, called an "epic document", and put it in the prompts/ directory.

Use these two roles for your user stories:

1. Website User - A user of this website.
2. Website Owner - The owner and admin of this website.

Each of these user roles has different motivations and requirements. Make sure you capture both perspectives of the website user and website owner when creating your user stories and acceptance criteria.

After you have created the first draft of your epic document, ask the user for feedback or approval. If the user provides feedback, then discuss their feedback with them before making changes to the epic document. Continue to prompt the user for approval of the epic document during this conversation.

STOP: When you have received approval for the epic document from the user, you are done. DO NOT write any code.
</system>

---

⏺ I've explored the codebase. Here's what I found relevant to this feature:

  - Currently, no crawling exists — all feed data is imported manually via scripts
  - The feeds table has an xml_url column (the RSS feed URL to crawl) and a no_crawl flag (some feeds are marked to skip)
  - Articles are stored in D1 with feed_id, link, title, published, etc.
  - Cloudflare Workers supports scheduled background jobs via Cron Triggers

  Before I write the epic, I have a few questions to make sure I capture the right requirements:

  ---
  1. What should the crawl actually do?

  - (A) Add new articles only — fetch each feed's RSS XML, find articles not yet in the database, add them. Never delete anything.
  - (B) Sync articles — add new articles AND remove articles that have disappeared from the feed.
  - (C) Just update feed metadata — update last_build_date and other feed info, but don't touch articles yet.

  Which sounds right, or is it some combination?

  ---
  2. What happens when a feed fails?

  Some feeds may be down, return errors, or have malformed XML. Options:

  - (A) Skip silently — log the error internally, move on, try again next 24-hour cycle
  - (B) Track failures — record how many times a feed has failed, and after N failures stop trying it
  - (C) Notify — send an alert (email, etc.) when feeds fail repeatedly

  ---
  3. Visibility — can you see what happened after a crawl?

  - (A) No UI needed — just logs in Cloudflare's dashboard are enough
  - (B) Simple summary — show somewhere (e.g., on the Feeds page) when each feed was last successfully crawled
  - (C) Full crawl history — a dedicated page showing recent crawl runs, what was added, what failed

  ---
  4. The no_crawl flag

  The database already has a no_crawl column on feeds. Should feeds with this flag set be:
  - (A) Always skipped during the background crawl
  - (B) Skippable by default but overridable — the owner can toggle this per-feed from the UI

  ---
  Take your time — even rough answers help me write the right requirements.

---

1. What should the crawler do?

(A) Add new articles only — fetch each feed's RSS XML, find articles not yet in the database, add them. Never delete anything.

2. Visibility

(C) Full crawl history — a dedicated page showing recent crawl runs, what was added, what failed

4. The no_crawl flag

(B) Skippable by default but overridable — the owner can toggle this per-feed from the UI
