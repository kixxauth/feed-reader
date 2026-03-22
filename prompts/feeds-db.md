I have an sqlite database of RSS feeds I subscribe to. I'd like to load these feeds into this app in both the development and production environment.

<system>
This user is making a feature request. Your job is to create the user stories and acceptance criteria needed to fulfill this feature request.

The user is probably being a bit vague, so you'll need to ask some questions to get more information out of them to fill in the gaps.

Keep this in mind when asking questions: It is safe to assume this user is non-technical and does not fully understand the technology or capabilities behind this website.

Your objective is to create a markdown document with user stories and acceptance criteria and put it in the prompts/ directory.

There are two roles you will need user stories for:

1. Website User - A user of this website.
2. Website Owner - The owner and admin of this website.

Each of these user roles has different motivations and requirements. Make sure you capture both perspectives of the website user and website owner when creating your user stories and acceptance criteria.

Then ask the user to provide feedback about your user stories and acceptance criteria and then provide the user options and alternative ideas with tradeoffs before making changes to your document.

When the user has approved any revisions you have collaborated on, then update the user stories and acceptance criteria document.

STOP: When you have received approval from the user and updated the user stories and acceptance criteria document, you are done. DO NOT write any code.
</system>

---

⏺ Let me take a quick look at the project structure first, then I'll ask some clarifying questions.

  Searched for 5 patterns, read 2 files (ctrl+o to expand)

⏺ Good context. Before I write the user stories, I have a few questions to make sure I capture things accurately:

  1. Your SQLite database — what information does it contain about each feed? Just the URL, or also names/categories/descriptions?
  2. "Load these feeds" — are you looking to do a one-time import (migrate the data), or do you want the app to stay in sync with your SQLite file on an ongoing basis?
  3. Who uses this app? Is it just you, or do other people log in too? If others, would they see the same feeds as you, or manage their own?
  4. Viewing feeds — once the feeds are loaded, what do you want to see? A list of feed sources? The actual articles/posts from those feeds? Both?
  5. Interacting with feeds — as a user, do you want to be able to add new feeds, remove feeds, or mark articles as read directly in the app? Or is the app primarily for reading/browsing?

---

1. Your SQLite database

The feeds table has this schema in my current database:

```sql
CREATE TABLE feeds (
    id TEXT PRIMARY KEY,
    hostname TEXT,
    type TEXT,
    title TEXT,
    xml_url TEXT,
    html_url TEXT
, no_crawl INTEGER DEFAULT 0, description TEXT, last_build_date TEXT, score INTEGER DEFAULT 0);
```

2. Feed loading

I want to migrate this feeds database to the new website, but may need to load them several times as I add new data to the existing database before fully migrating.

3. Who uses this app?

I am the only one who will use this app.

4. Viewing feeds

I want to see a list of feeds sorted by hostname

5. Interacting with feeds

Interacting with the feeds is not required yet
