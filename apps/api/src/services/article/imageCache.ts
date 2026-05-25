import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { JSDOM } from "jsdom";
import { env, paths } from "../../config/env.js";
import { prisma } from "../../db.js";
import { sanitizeArticleHtml } from "../../utils/text.js";
import { fetchWithRetry } from "../http.js";

interface CacheResult {
  status: "completed" | "partial" | "failed" | "skipped";
  downloaded: number;
  failed: number;
  errors: string[];
}

interface ImageCandidate {
  url: string;
  node?: HTMLImageElement;
}

const imageExtensionsByType: Record<string, string> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp"
};

export async function cacheArticleImages(articleId: string): Promise<CacheResult> {
  const article = await prisma.article.findUnique({ where: { id: articleId }, include: { feed: true } });
  if (!article) throw new Error("Article not found");

  const baseUrl = article.url ?? article.canonicalUrl ?? article.feed.siteUrl ?? article.feed.feedUrl;
  const dom = article.originalHtml ? new JSDOM(article.originalHtml, { url: baseUrl }) : null;
  const candidates = collectImageCandidates(dom, article.originalImageUrl, baseUrl);
  const remoteCandidates = candidates.filter((candidate) => isRemoteImage(candidate.url));

  if (!candidates.length) {
    await markImageCache(articleId, "skipped", null, article.originalHtml, article.originalImageLocalUrl);
    return { status: "skipped", downloaded: 0, failed: 0, errors: [] };
  }
  if (!remoteCandidates.length && article.originalImageLocalUrl) {
    await markImageCache(articleId, "completed", null, article.originalHtml, article.originalImageLocalUrl);
    return { status: "completed", downloaded: 0, failed: 0, errors: [] };
  }

  const replacements = new Map<string, string>();
  const errors: string[] = [];
  for (const candidate of remoteCandidates.slice(0, env.ARTICLE_IMAGE_MAX_COUNT)) {
    if (replacements.has(candidate.url)) continue;
    try {
      replacements.set(candidate.url, await downloadImage(articleId, candidate.url));
    } catch (error) {
      errors.push(`${candidate.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (dom) {
    for (const candidate of candidates) {
      if (!candidate.node) continue;
      const localUrl = replacements.get(candidate.url);
      if (!localUrl) continue;
      candidate.node.setAttribute("src", localUrl);
      candidate.node.removeAttribute("srcset");
      candidate.node.removeAttribute("data-src");
      candidate.node.removeAttribute("data-original");
      candidate.node.removeAttribute("data-lazy-src");
      candidate.node.setAttribute("loading", "lazy");
    }
  }

  const leadLocalUrl =
    (article.originalImageUrl ? replacements.get(article.originalImageUrl) : undefined) ??
    [...replacements.values()][0] ??
    article.originalImageLocalUrl;
  const rewrittenHtml = dom ? sanitizeArticleHtml(dom.window.document.body.innerHTML) : article.originalHtml;
  const downloaded = replacements.size;
  const failed = errors.length;
  const status = downloaded > 0 ? (failed > 0 ? "partial" : "completed") : failed > 0 ? "failed" : "skipped";
  await markImageCache(articleId, status, errors.join("\n") || null, rewrittenHtml, leadLocalUrl ?? null);
  return { status, downloaded, failed, errors };
}

function collectImageCandidates(dom: JSDOM | null, leadImageUrl: string | null, baseUrl: string): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  if (leadImageUrl) pushResolvedCandidate(candidates, leadImageUrl, baseUrl);
  if (!dom) return candidates;

  for (const node of [...dom.window.document.querySelectorAll("img")]) {
    if (isLikelyTrackingPixel(node)) continue;
    const raw =
      node.getAttribute("src") ??
      node.getAttribute("data-src") ??
      node.getAttribute("data-original") ??
      node.getAttribute("data-lazy-src") ??
      firstSrcsetUrl(node.getAttribute("srcset") ?? node.getAttribute("data-srcset"));
    if (raw) pushResolvedCandidate(candidates, raw, baseUrl, node);
  }
  return dedupeCandidates(candidates);
}

function pushResolvedCandidate(
  candidates: ImageCandidate[],
  value: string,
  baseUrl: string,
  node?: HTMLImageElement
): void {
  try {
    if (value.startsWith("/media/")) {
      candidates.push({ url: value, node });
      return;
    }
    candidates.push({ url: new URL(value, baseUrl).toString(), node });
  } catch {
    // Ignore invalid image URLs from remote feeds.
  }
}

function dedupeCandidates(candidates: ImageCandidate[]): ImageCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

function isRemoteImage(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function firstSrcsetUrl(srcset: string | null): string | null {
  return srcset?.split(",")[0]?.trim().split(/\s+/)[0] ?? null;
}

function isLikelyTrackingPixel(node: HTMLImageElement): boolean {
  const width = Number(node.getAttribute("width") ?? 0);
  const height = Number(node.getAttribute("height") ?? 0);
  const src = node.getAttribute("src") ?? "";
  return (width > 0 && width <= 2 && height > 0 && height <= 2) || /tracking|pixel|beacon|analytics/i.test(src);
}

async function downloadImage(articleId: string, url: string): Promise<string> {
  const response = await fetchWithRetry(url, {
    timeoutMs: env.ARTICLE_IMAGE_FETCH_TIMEOUT_MS,
    retries: 1,
    headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/*;q=0.8,*/*;q=0.5" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) throw new Error(`not an image (${contentType || "unknown content-type"})`);

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > env.ARTICLE_IMAGE_MAX_BYTES) throw new Error("image is larger than configured max size");

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > env.ARTICLE_IMAGE_MAX_BYTES) throw new Error("image is larger than configured max size");

  const extension = imageExtensionsByType[contentType] ?? safeExtension(url) ?? ".img";
  const name = `${createHash("sha256").update(url).digest("hex").slice(0, 32)}${extension}`;
  const directory = join(paths.mediaRoot, "articles", articleId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), buffer);
  return `/media/articles/${articleId}/${name}`;
}

function safeExtension(url: string): string | null {
  const extension = extname(new URL(url).pathname).toLowerCase();
  return /^\.(avif|gif|jpe?g|png|svg|webp)$/.test(extension) ? extension : null;
}

async function markImageCache(
  articleId: string,
  status: CacheResult["status"],
  error: string | null,
  html: string | null,
  leadImageUrl: string | null
): Promise<void> {
  await prisma.article.update({
    where: { id: articleId },
    data: {
      originalHtml: html ?? undefined,
      originalImageLocalUrl: leadImageUrl,
      imageCacheStatus: status,
      imageCacheError: error,
      imageCachedAt: new Date()
    }
  });
}
