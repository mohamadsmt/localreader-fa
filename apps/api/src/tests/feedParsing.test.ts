import { describe, expect, it } from "vitest";
import { parseFeedDocument } from "../services/feed/parseFeed.js";
import { hashUrl, normalizeUrl } from "../utils/url.js";

describe("feed parsing and URL normalization", () => {
  it("normalizes RSS items", () => {
    const feed = parseFeedDocument(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Example RSS</title><link>https://example.com</link><item><title>Hello</title><link>https://example.com/a?utm_source=x</link><guid>1</guid><description><![CDATA[<p>Hello body</p>]]></description><pubDate>Wed, 01 May 2024 00:00:00 GMT</pubDate></item></channel></rss>`,
      "https://example.com/feed.xml"
    );
    expect(feed.title).toBe("Example RSS");
    expect(feed.items[0]?.title).toBe("Hello");
    expect(feed.items[0]?.text).toContain("Hello body");
  });

  it("normalizes Atom items", () => {
    const feed = parseFeedDocument(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>a1</id><title>Atom item</title><link href="https://example.com/atom"/><summary>Summary</summary></entry></feed>`,
      "https://example.com/atom.xml"
    );
    expect(feed.items[0]?.url).toBe("https://example.com/atom");
  });

  it("normalizes JSON Feed items", () => {
    const feed = parseFeedDocument(
      JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: "JSON Feed",
        items: [{ id: "1", title: "JSON item", url: "https://example.com/json", content_text: "Body" }]
      }),
      "https://example.com/feed.json"
    );
    expect(feed.items[0]?.text).toBe("Body");
  });

  it("strips trackers and hashes canonical URLs", () => {
    const url = normalizeUrl("https://Example.com/a/?utm_source=x&b=1#section");
    expect(url).toBe("https://example.com/a?b=1");
    expect(hashUrl(url)).toHaveLength(64);
  });
});
