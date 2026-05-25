import { XMLParser } from "fast-xml-parser";
import { excerpt, htmlToText, sanitizeArticleHtml } from "../../utils/text.js";
import { safeUrl } from "../../utils/url.js";

export interface NormalizedFeedItem {
  guid: string | null;
  url: string | null;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  html: string | null;
  text: string;
  summary: string | null;
  imageUrl: string | null;
  categories: string[];
  raw: unknown;
}

export interface NormalizedFeed {
  title: string;
  siteUrl: string | null;
  description: string | null;
  items: NormalizedFeedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  parseTagValue: false,
  trimValues: true
});

export function parseFeedDocument(source: string, feedUrl: string): NormalizedFeed {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("Feed is empty");
  if (trimmed.startsWith("{")) return parseJsonFeed(JSON.parse(trimmed), feedUrl);
  return parseXmlFeed(parser.parse(trimmed), feedUrl);
}

function parseJsonFeed(doc: unknown, feedUrl: string): NormalizedFeed {
  const record = asRecord(doc);
  const items = asArray(record.items).map((item) => normalizeJsonFeedItem(asRecord(item), feedUrl));
  if (!items.length && !record.version) throw new Error("Invalid JSON Feed");
  return {
    title: stringValue(record.title) || new URL(feedUrl).hostname,
    siteUrl: safeUrl(stringValue(record.home_page_url), feedUrl),
    description: stringValue(record.description),
    items
  };
}

function normalizeJsonFeedItem(item: Record<string, unknown>, feedUrl: string): NormalizedFeedItem {
  const html = stringValue(item.content_html) ? sanitizeArticleHtml(stringValue(item.content_html) ?? "") : null;
  const text = stringValue(item.content_text) ?? (html ? htmlToText(html) : "");
  const title = stringValue(item.title) ?? excerpt(text, 100) ?? "Untitled";
  return {
    guid: stringValue(item.id),
    url: safeUrl(stringValue(item.url) ?? stringValue(item.external_url), feedUrl),
    title,
    author: authorFromJson(item),
    publishedAt: dateValue(stringValue(item.date_published) ?? stringValue(item.date_modified)),
    html,
    text,
    summary: stringValue(item.summary) ?? excerpt(text),
    imageUrl: safeUrl(stringValue(item.image) ?? stringValue(item.banner_image), feedUrl),
    categories: asArray(item.tags).flatMap((tag) => (typeof tag === "string" ? [tag] : [])),
    raw: item
  };
}

function parseXmlFeed(doc: unknown, feedUrl: string): NormalizedFeed {
  const root = asRecord(doc);
  if (root.rss) return parseRss(asRecord(root.rss), feedUrl);
  if (root.feed) return parseAtom(asRecord(root.feed), feedUrl);
  throw new Error("Unsupported feed format");
}

function parseRss(rss: Record<string, unknown>, feedUrl: string): NormalizedFeed {
  const channel = asRecord(rss.channel);
  const items = asArray(channel.item).map((item) => normalizeRssItem(asRecord(item), feedUrl));
  return {
    title: textValue(channel.title) || new URL(feedUrl).hostname,
    siteUrl: safeUrl(textValue(channel.link), feedUrl),
    description: textValue(channel.description),
    items
  };
}

function normalizeRssItem(item: Record<string, unknown>, feedUrl: string): NormalizedFeedItem {
  const rawHtml =
    textValue(item["content:encoded"]) ??
    textValue(item.encoded) ??
    textValue(item.description) ??
    textValue(item.summary);
  const html = rawHtml ? sanitizeArticleHtml(rawHtml) : null;
  const text = html ? htmlToText(html) : textValue(item.description) ?? "";
  const enclosure = asRecord(item.enclosure);
  return {
    guid: textValue(item.guid) ?? textValue(item.id) ?? textValue(item.link),
    url: safeUrl(textValue(item.link), feedUrl),
    title: textValue(item.title) || excerpt(text, 100) || "Untitled",
    author: textValue(item.author) ?? textValue(item["dc:creator"]),
    publishedAt: dateValue(textValue(item.pubDate) ?? textValue(item.published) ?? textValue(item.updated)),
    html,
    text,
    summary: textValue(item.description) ?? excerpt(text),
    imageUrl: safeUrl(textValue(enclosure["@url"]) ?? mediaThumbnail(item), feedUrl),
    categories: asArray(item.category).flatMap((category) => {
      const value = textValue(category);
      return value ? [value] : [];
    }),
    raw: item
  };
}

function parseAtom(feed: Record<string, unknown>, feedUrl: string): NormalizedFeed {
  const entries = asArray(feed.entry).map((entry) => normalizeAtomItem(asRecord(entry), feedUrl));
  return {
    title: textValue(feed.title) || new URL(feedUrl).hostname,
    siteUrl: safeUrl(atomLink(feed.link, "alternate") ?? atomLink(feed.link), feedUrl),
    description: textValue(feed.subtitle),
    items: entries
  };
}

function normalizeAtomItem(item: Record<string, unknown>, feedUrl: string): NormalizedFeedItem {
  const rawHtml = textValue(item.content) ?? textValue(item.summary);
  const html = rawHtml ? sanitizeArticleHtml(rawHtml) : null;
  const text = html ? htmlToText(html) : textValue(item.summary) ?? "";
  return {
    guid: textValue(item.id) ?? atomLink(item.link, "alternate"),
    url: safeUrl(atomLink(item.link, "alternate") ?? atomLink(item.link), feedUrl),
    title: textValue(item.title) || excerpt(text, 100) || "Untitled",
    author: atomAuthor(item.author),
    publishedAt: dateValue(textValue(item.published) ?? textValue(item.updated)),
    html,
    text,
    summary: textValue(item.summary) ?? excerpt(text),
    imageUrl: null,
    categories: asArray(item.category).flatMap((category) => {
      const record = asRecord(category);
      const value = textValue(record["@term"]) ?? textValue(category);
      return value ? [value] : [];
    }),
    raw: item
  };
}

function atomLink(value: unknown, rel?: string): string | null {
  const links = asArray(value);
  for (const link of links) {
    const record = asRecord(link);
    const href = textValue(record["@href"]) ?? textValue(record.href) ?? textValue(link);
    const linkRel = textValue(record["@rel"]) ?? "alternate";
    if (href && (!rel || linkRel === rel)) return href;
  }
  return null;
}

function atomAuthor(value: unknown): string | null {
  const record = asRecord(Array.isArray(value) ? value[0] : value);
  return textValue(record.name) ?? textValue(record.email) ?? textValue(value);
}

function authorFromJson(item: Record<string, unknown>): string | null {
  const author = asRecord(item.author);
  return stringValue(author.name) ?? stringValue(author.url);
}

function mediaThumbnail(item: Record<string, unknown>): string | null {
  const media = asRecord(item["media:thumbnail"] ?? item.thumbnail);
  return textValue(media["@url"]);
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") return decodeText(value);
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textValue(record["#cdata"] ?? record["#text"] ?? record["@href"] ?? record["@url"]);
  }
  return null;
}

function decodeText(value: string): string | null {
  const decoded = htmlToText(value);
  return decoded.trim() || null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
