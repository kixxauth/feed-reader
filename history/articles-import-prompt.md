I have a SQLite database which has a table containing thousands of articles. I would like to migrate them all to this website.

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

Before I draft the epic document, I have some questions to make sure I capture your needs accurately. The current app stores and displays feed sources (like "The Verge RSS" or "Hacker
  News"), but there's no concept of articles (the actual content from those feeds) yet — so this would be a significant new feature.

  Here are my questions:

  ---
  1. What does an "article" look like in your existing database?

  Could you share (roughly) what columns the articles table has? For example:
  - Title
  - URL / link
  - Published date
  - Full text content
  - Summary/excerpt
  - Which feed it belongs to
  - Tags or categories
  - Read/unread status
  - Anything else?

  ---
  2. How do you want to browse articles?

  Pick the option that sounds most like what you're imagining, or mix and match:

  - (A) All articles in one big list — sorted by date, paginated, similar to the current feeds page
  - (B) Browse by feed source — click on a feed (e.g., "Hacker News") to see its articles
  - (C) Individual article pages — each article gets its own URL and full-content page
  - (D) Some combination of the above

  ---
  3. Do you want to be able to search or filter articles?

  For example: search by keyword, filter by date range, filter by feed source, show only unread articles, etc.

  ---
  4. Should new articles continue to be fetched automatically?

  Right now the app is read-only — it displays feeds but doesn't crawl them for new content. Do you want this migration to also set up automatic article fetching going forward, or just import
  the historical archive for now?

  ---
  5. Who should be able to see articles?

  The current app requires login (GitHub OAuth) to see anything. Should articles be:
  - (A) Private — only you (logged-in users) can read them (same as now)
  - (B) Public — anyone on the internet can browse the articles without logging in

---

1. Article Schema

```sql
CREATE TABLE articles (
    id TEXT PRIMARY KEY,
    feed_id TEXT,
    link TEXT,
    title TEXT,
    published TEXT,
    updated TEXT,
    added TEXT
);
```

2. Browsing articles

(B) Browse by feed source

Some feed sources have hundreds of articles which could require paging. I would like the page size limit to be 20

3. Search or filter articles

I'd like to be able to select all articles from a date range.

4. Automatic fetching

Crawling the feeds is not required.

5. Permissions

This entire site is private and no page should be visible to a visitor who is not logged in.
