import { describe, it, expect } from 'vitest';
import { parseFeedXml } from '../src/parser.js';

// ---------------------------------------------------------------------------
// RSS fixtures
// ---------------------------------------------------------------------------

const RSS_BASIC = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/one</link>
      <guid>guid-001</guid>
      <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const RSS_NO_GUID = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>No GUID</title>
      <link>https://example.com/no-guid</link>
      <pubDate>Tue, 02 Jan 2024 12:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const RSS_NO_GUID_NO_LINK = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>No ID Sources</title>
    </item>
  </channel>
</rss>`;

const RSS_GUID_WITH_ATTRS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Guid With Attrs</title>
      <link>https://example.com/attrs</link>
      <guid isPermaLink="false">urn:uuid:12345</guid>
    </item>
  </channel>
</rss>`;

const RSS_WHITESPACE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>  Title  With  Spaces  </title>
      <link>  https://example.com/ws  </link>
      <guid>guid-ws</guid>
    </item>
  </channel>
</rss>`;

const RSS_VALID_DATE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Date Test</title>
      <link>https://example.com/date</link>
      <guid>guid-date</guid>
      <pubDate>Wed, 03 Jan 2024 09:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const RSS_INVALID_DATE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Bad Date</title>
      <link>https://example.com/baddate</link>
      <guid>guid-baddate</guid>
      <pubDate>not-a-date</pubDate>
    </item>
  </channel>
</rss>`;

const RSS_MULTIPLE_ITEMS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Item One</title>
      <link>https://example.com/1</link>
      <guid>g1</guid>
    </item>
    <item>
      <title>Item Two</title>
      <link>https://example.com/2</link>
      <guid>g2</guid>
    </item>
    <item>
      <title>Item Three</title>
      <link>https://example.com/3</link>
      <guid>g3</guid>
    </item>
  </channel>
</rss>`;

// Intentionally large content:encoded — the parser must not buffer or fail on it.
const RSS_LARGE_CONTENT_ENCODED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <item>
      <title>Large Content</title>
      <link>https://example.com/large</link>
      <guid>guid-large</guid>
      <content:encoded>${'<p>body paragraph</p>'.repeat(5000)}</content:encoded>
    </item>
  </channel>
</rss>`;

// Entity-heavy content in ignored fields — must not cause parser failure.
const RSS_ENTITY_HEAVY_IGNORED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Entity Test</title>
      <link>https://example.com/entities</link>
      <guid>guid-entities</guid>
      <description>Rock &amp; Roll &lt;b&gt;bold&lt;/b&gt; &gt; stuff &amp;amp; more &amp;lt;entities&amp;gt;</description>
    </item>
  </channel>
</rss>`;

const RSS_EMPTY_CHANNEL = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
  </channel>
</rss>`;

const RSS_MALFORMED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Unclosed`;

// ---------------------------------------------------------------------------
// Atom fixtures
// ---------------------------------------------------------------------------

const ATOM_BASIC = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom Feed</title>
  <entry>
    <id>https://example.com/atom/1</id>
    <title>Atom Entry One</title>
    <link href="https://example.com/atom/1" rel="alternate"/>
    <published>2024-01-01T12:00:00Z</published>
    <updated>2024-01-02T12:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_ID_DERIVATION = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:uuid:atom-id-1</id>
    <title>ID Test</title>
    <link href="https://example.com/id-test"/>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_LINK_REL_ALTERNATE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:1</id>
    <title>Link Rel Test</title>
    <link href="https://example.com/self" rel="self"/>
    <link href="https://example.com/alternate" rel="alternate"/>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_LINK_NO_REL = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:2</id>
    <title>No Rel Link</title>
    <link href="https://example.com/no-rel"/>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_LINK_FALLBACK = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:3</id>
    <title>Fallback Link</title>
    <link href="https://example.com/self-only" rel="self"/>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_TEXT_LINK = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:4</id>
    <title>Text Link</title>
    <link>https://example.com/text-link</link>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_PUBLISHED_FALLBACK = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:5</id>
    <title>No Published</title>
    <link href="https://example.com/no-published"/>
    <updated>2024-06-15T08:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_NO_DATES = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:6</id>
    <title>No Dates</title>
    <link href="https://example.com/no-dates"/>
  </entry>
</feed>`;

const ATOM_WHITESPACE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>  urn:ws-id  </id>
    <title>  Whitespace  Title  </title>
    <link href="https://example.com/ws"/>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_MULTIPLE_ENTRIES = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:e1</id>
    <title>Entry One</title>
    <link href="https://example.com/e1"/>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
  <entry>
    <id>urn:e2</id>
    <title>Entry Two</title>
    <link href="https://example.com/e2"/>
    <updated>2024-01-02T00:00:00Z</updated>
  </entry>
  <entry>
    <id>urn:e3</id>
    <title>Entry Three</title>
    <link href="https://example.com/e3"/>
    <updated>2024-01-03T00:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_LARGE_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:large</id>
    <title>Large Content Entry</title>
    <link href="https://example.com/large-atom"/>
    <updated>2024-01-01T00:00:00Z</updated>
    <content type="html">${'<p>paragraph content</p>'.repeat(5000)}</content>
    <summary>${'Summary text repeated. '.repeat(2000)}</summary>
  </entry>
</feed>`;

const ATOM_MALFORMED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Unclosed Entry`;

// ---------------------------------------------------------------------------
// Format detection fixtures
// ---------------------------------------------------------------------------

// RSS without XML declaration
const RSS_NO_DECL = `<rss version="2.0">
  <channel>
    <item>
      <title>No Decl</title>
      <link>https://example.com/nodecl</link>
      <guid>guid-nodecl</guid>
    </item>
  </channel>
</rss>`;

// Atom without XML declaration
const ATOM_NO_DECL = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:nodecl</id>
    <title>No Decl Atom</title>
    <link href="https://example.com/nodecl-atom"/>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

// RSS with XML declaration and comments before the root
const RSS_WITH_COMMENT = `<?xml version="1.0" encoding="UTF-8"?>
<!-- This is a comment before the root -->
<rss version="2.0">
  <channel>
    <item>
      <title>After Comment</title>
      <link>https://example.com/comment</link>
      <guid>guid-comment</guid>
    </item>
  </channel>
</rss>`;

// Namespace-prefixed rss root
const RSS_NAMESPACED_ROOT = `<?xml version="1.0" encoding="UTF-8"?>
<rss:rss xmlns:rss="http://purl.org/rss/1.0/" version="2.0">
  <rss:channel>
    <rss:item>
      <rss:title>Namespaced RSS</rss:title>
      <rss:link>https://example.com/ns-rss</rss:link>
      <rss:guid>guid-ns-rss</rss:guid>
    </rss:item>
  </rss:channel>
</rss:rss>`;

// Namespace-prefixed atom:feed root
const ATOM_NAMESPACED_ROOT = `<?xml version="1.0" encoding="UTF-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:entry>
    <atom:id>urn:ns-atom</atom:id>
    <atom:title>Namespaced Atom</atom:title>
    <atom:link href="https://example.com/ns-atom"/>
    <atom:updated>2024-01-01T00:00:00Z</atom:updated>
  </atom:entry>
</atom:feed>`;

const UNRECOGNIZED_ROOT = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>OPML</title></head>
</opml>`;

const NON_XML = `This is not XML at all. Just plain text.`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FEED_ID = 'test-feed-id';

describe('RSS parsing', () => {
	it('parses basic RSS items', () => {
		const articles = parseFeedXml(RSS_BASIC, FEED_ID);
		expect(articles).toHaveLength(1);
		const a = articles[0];
		expect(a.title).toBe('Article One');
		expect(a.link).toBe('https://example.com/one');
		expect(a.id).toBe(`${FEED_ID}:guid-001`);
		expect(a.updated).toBeNull();
		expect(typeof a.published).toBe('string'); // ISO date
	});

	it('derives id from guid', () => {
		const articles = parseFeedXml(RSS_BASIC, FEED_ID);
		expect(articles[0].id).toBe(`${FEED_ID}:guid-001`);
	});

	it('falls back to link when guid is missing', () => {
		const articles = parseFeedXml(RSS_NO_GUID, FEED_ID);
		expect(articles).toHaveLength(1);
		expect(articles[0].id).toBe(`${FEED_ID}:https://example.com/no-guid`);
	});

	it('returns id: null when both guid and link are missing', () => {
		const articles = parseFeedXml(RSS_NO_GUID_NO_LINK, FEED_ID);
		expect(articles).toHaveLength(1);
		expect(articles[0].id).toBeNull();
	});

	it('handles guid attributes such as isPermaLink (ignored, text content used)', () => {
		const articles = parseFeedXml(RSS_GUID_WITH_ATTRS, FEED_ID);
		expect(articles).toHaveLength(1);
		expect(articles[0].id).toBe(`${FEED_ID}:urn:uuid:12345`);
	});

	it('normalizes whitespace in title and link', () => {
		const articles = parseFeedXml(RSS_WHITESPACE, FEED_ID);
		expect(articles[0].title).toBe('Title With Spaces');
		expect(articles[0].link).toBe('https://example.com/ws');
	});

	it('parses valid pubDate values to ISO string', () => {
		const articles = parseFeedXml(RSS_VALID_DATE, FEED_ID);
		expect(articles[0].published).toBe('2024-01-03T09:30:00.000Z');
	});

	it('returns null for invalid pubDate values', () => {
		const articles = parseFeedXml(RSS_INVALID_DATE, FEED_ID);
		expect(articles[0].published).toBeNull();
	});

	it('handles multiple items', () => {
		const articles = parseFeedXml(RSS_MULTIPLE_ITEMS, FEED_ID);
		expect(articles).toHaveLength(3);
		expect(articles[0].title).toBe('Item One');
		expect(articles[1].title).toBe('Item Two');
		expect(articles[2].title).toBe('Item Three');
	});

	it('ignores large content:encoded sections (does not buffer or fail on them)', () => {
		const articles = parseFeedXml(RSS_LARGE_CONTENT_ENCODED, FEED_ID);
		expect(articles).toHaveLength(1);
		expect(articles[0].title).toBe('Large Content');
		expect(articles[0].link).toBe('https://example.com/large');
	});

	it('succeeds on entity-heavy content in ignored fields', () => {
		const articles = parseFeedXml(RSS_ENTITY_HEAVY_IGNORED, FEED_ID);
		expect(articles).toHaveLength(1);
		expect(articles[0].title).toBe('Entity Test');
	});

	it('returns [] for an RSS feed with an empty channel', () => {
		const articles = parseFeedXml(RSS_EMPTY_CHANNEL, FEED_ID);
		expect(articles).toEqual([]);
	});

	it('throws "Invalid XML: ..." on malformed RSS', () => {
		expect(() => parseFeedXml(RSS_MALFORMED, FEED_ID)).toThrow(/^Invalid XML:/);
	});
});

describe('Atom parsing', () => {
	it('parses basic Atom entries', () => {
		const articles = parseFeedXml(ATOM_BASIC, FEED_ID);
		expect(articles).toHaveLength(1);
		const a = articles[0];
		expect(a.title).toBe('Atom Entry One');
		expect(a.link).toBe('https://example.com/atom/1');
		expect(a.id).toBe(`${FEED_ID}:https://example.com/atom/1`);
		expect(typeof a.published).toBe('string');
		expect(typeof a.updated).toBe('string');
	});

	it('derives id from atom:id text content', () => {
		const articles = parseFeedXml(ATOM_ID_DERIVATION, FEED_ID);
		expect(articles[0].id).toBe(`${FEED_ID}:urn:uuid:atom-id-1`);
	});

	it('prefers link with rel="alternate"', () => {
		const articles = parseFeedXml(ATOM_LINK_REL_ALTERNATE, FEED_ID);
		expect(articles[0].link).toBe('https://example.com/alternate');
	});

	it('treats link with no rel attribute as alternate', () => {
		const articles = parseFeedXml(ATOM_LINK_NO_REL, FEED_ID);
		expect(articles[0].link).toBe('https://example.com/no-rel');
	});

	it('falls back to first candidate URL when no alternate exists', () => {
		const articles = parseFeedXml(ATOM_LINK_FALLBACK, FEED_ID);
		expect(articles[0].link).toBe('https://example.com/self-only');
	});

	it('supports text-only link content (no href attribute)', () => {
		const articles = parseFeedXml(ATOM_TEXT_LINK, FEED_ID);
		expect(articles[0].link).toBe('https://example.com/text-link');
	});

	it('falls back to updated when published is missing', () => {
		const articles = parseFeedXml(ATOM_PUBLISHED_FALLBACK, FEED_ID);
		expect(articles[0].published).toBe('2024-06-15T08:00:00.000Z');
		expect(articles[0].updated).toBe('2024-06-15T08:00:00.000Z');
	});

	it('returns updated: null when updated is also missing', () => {
		const articles = parseFeedXml(ATOM_NO_DATES, FEED_ID);
		expect(articles[0].published).toBeNull();
		expect(articles[0].updated).toBeNull();
	});

	it('normalizes whitespace in title and id', () => {
		const articles = parseFeedXml(ATOM_WHITESPACE, FEED_ID);
		expect(articles[0].title).toBe('Whitespace Title');
		// id is derived from normalized atomId
		expect(articles[0].id).toBe(`${FEED_ID}:urn:ws-id`);
	});

	it('handles multiple entries', () => {
		const articles = parseFeedXml(ATOM_MULTIPLE_ENTRIES, FEED_ID);
		expect(articles).toHaveLength(3);
		expect(articles[0].title).toBe('Entry One');
		expect(articles[1].title).toBe('Entry Two');
		expect(articles[2].title).toBe('Entry Three');
	});

	it('ignores large content and summary sections', () => {
		const articles = parseFeedXml(ATOM_LARGE_CONTENT, FEED_ID);
		expect(articles).toHaveLength(1);
		expect(articles[0].title).toBe('Large Content Entry');
	});

	it('throws "Invalid XML: ..." on malformed Atom', () => {
		expect(() => parseFeedXml(ATOM_MALFORMED, FEED_ID)).toThrow(/^Invalid XML:/);
	});
});

describe('format detection', () => {
	it('detects RSS root and returns RSS articles', () => {
		const articles = parseFeedXml(RSS_NO_DECL, FEED_ID);
		expect(articles).toHaveLength(1);
		expect(articles[0].title).toBe('No Decl');
		expect(articles[0].updated).toBeNull(); // RSS always has updated: null
	});

	it('detects Atom root and returns Atom entries', () => {
		const articles = parseFeedXml(ATOM_NO_DECL, FEED_ID);
		expect(articles).toHaveLength(1);
		expect(articles[0].title).toBe('No Decl Atom');
	});

	it('handles XML declaration before the root', () => {
		const articles = parseFeedXml(RSS_BASIC, FEED_ID);
		expect(articles).toHaveLength(1);
	});

	it('handles comments before the root', () => {
		const articles = parseFeedXml(RSS_WITH_COMMENT, FEED_ID);
		expect(articles).toHaveLength(1);
		expect(articles[0].title).toBe('After Comment');
	});

	it('handles namespace-prefixed roots (atom:feed, rss:rss)', () => {
		const rssArticles = parseFeedXml(RSS_NAMESPACED_ROOT, FEED_ID);
		expect(rssArticles).toHaveLength(1);
		expect(rssArticles[0].title).toBe('Namespaced RSS');

		const atomArticles = parseFeedXml(ATOM_NAMESPACED_ROOT, FEED_ID);
		expect(atomArticles).toHaveLength(1);
		expect(atomArticles[0].title).toBe('Namespaced Atom');
	});

	it('returns [] for an unrecognized root element', () => {
		const articles = parseFeedXml(UNRECOGNIZED_ROOT, FEED_ID);
		expect(articles).toEqual([]);
	});

	it('returns [] for non-XML input', () => {
		const articles = parseFeedXml(NON_XML, FEED_ID);
		expect(articles).toEqual([]);
	});
});
