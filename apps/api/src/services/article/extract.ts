import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { env } from "../../config/env.js";
import { excerpt, htmlToText, sanitizeArticleHtml } from "../../utils/text.js";
import { fetchWithRetry } from "../http.js";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-"
});

export interface ExtractedArticle {
  title: string | null;
  html: string;
  text: string;
  markdown: string;
  excerpt: string;
  imageUrl: string | null;
}

export async function extractReadableArticle(url: string): Promise<ExtractedArticle> {
  const response = await fetchWithRetry(url, {
    timeoutMs: env.ARTICLE_FETCH_TIMEOUT_MS,
    retries: 1,
    headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" }
  });
  if (!response.ok) throw new Error(`Article fetch failed: HTTP ${response.status}`);
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  for (const node of [...dom.window.document.querySelectorAll("script, iframe, noscript")]) node.remove();
  const readable = new Readability(dom.window.document).parse();
  const content = sanitizeArticleHtml(readable?.content ?? dom.window.document.body.innerHTML);
  const text = readable?.textContent?.trim() || htmlToText(content);
  return {
    title: readable?.title ?? dom.window.document.title ?? null,
    html: content,
    text,
    markdown: turndown.turndown(content),
    excerpt: readable?.excerpt ?? excerpt(text),
    imageUrl: findLeadImage(dom, url)
  };
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(sanitizeArticleHtml(html));
}

function findLeadImage(dom: JSDOM, baseUrl: string): string | null {
  const selector =
    "meta[property='og:image'], meta[name='twitter:image'], article img[src], main img[src], img[src]";
  const element = dom.window.document.querySelector(selector);
  const content = element?.getAttribute("content") ?? element?.getAttribute("src");
  if (!content) return null;
  try {
    return new URL(content, baseUrl).toString();
  } catch {
    return null;
  }
}
