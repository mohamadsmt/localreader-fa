import { JSDOM } from "jsdom";
import { env } from "../../config/env.js";
import { fetchWithRetry } from "../http.js";
import { parseFeedDocument } from "./parseFeed.js";

const feedTypes = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/feed+json",
  "application/json",
  "text/xml",
  "application/xml"
]);

export interface DiscoveredFeed {
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  description: string | null;
}

export async function discoverFeeds(url: string): Promise<DiscoveredFeed[]> {
  const direct = await tryParseFeed(url);
  if (direct) return [direct];

  const response = await fetchWithRetry(url, { timeoutMs: env.FEED_FETCH_TIMEOUT_MS, retries: 1 });
  if (!response.ok) throw new Error(`Unable to fetch website: HTTP ${response.status}`);
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const links = [...dom.window.document.querySelectorAll("link[rel~='alternate']")];
  const candidates = links
    .map((link) => {
      const type = link.getAttribute("type")?.toLowerCase() ?? "";
      const href = link.getAttribute("href");
      if (!href || !feedTypes.has(type)) return null;
      return {
        title: link.getAttribute("title") ?? dom.window.document.title ?? "Feed",
        feedUrl: new URL(href, url).toString()
      };
    })
    .filter((candidate): candidate is { title: string; feedUrl: string } => Boolean(candidate));

  const discovered: DiscoveredFeed[] = [];
  for (const candidate of candidates) {
    const parsed = await tryParseFeed(candidate.feedUrl);
    if (parsed) discovered.push({ ...parsed, title: parsed.title || candidate.title });
  }
  if (!discovered.length) throw new Error("No RSS, Atom, or JSON Feed alternate links found");
  return discovered;
}

async function tryParseFeed(url: string): Promise<DiscoveredFeed | null> {
  try {
    const response = await fetchWithRetry(url, { timeoutMs: env.FEED_FETCH_TIMEOUT_MS, retries: 1 });
    if (!response.ok) return null;
    const body = await response.text();
    const parsed = parseFeedDocument(body, url);
    return {
      title: parsed.title,
      feedUrl: url,
      siteUrl: parsed.siteUrl,
      description: parsed.description
    };
  } catch {
    return null;
  }
}
