import { isLikelyPersian } from "@localreader/shared";
import { env } from "../../config/env.js";
import { prisma, upsertArticleSearch } from "../../db.js";
import { excerpt } from "../../utils/text.js";
import { hashUrl, normalizeUrl } from "../../utils/url.js";
import { extractReadableArticle } from "../article/extract.js";
import { cacheArticleImages } from "../article/imageCache.js";
import { fetchWithRetry } from "../http.js";
import { enqueueJob } from "../jobs/jobs.js";
import { applyRulesToArticle } from "../rules/rulesEngine.js";
import { getSettings } from "../settings.js";
import { enqueueTranslationJob } from "../translation/queue.js";
import { discoverFeeds } from "./discovery.js";
import { parseFeedDocument, type NormalizedFeedItem } from "./parseFeed.js";

export async function createFeedFromUrl(input: {
  url: string;
  folderId?: string | null;
  title?: string;
  refreshIntervalMinutes?: number;
  fetchFullContent?: boolean;
}): Promise<string> {
  const discovered = await discoverFeeds(input.url);
  const selected = discovered[0];
  if (!selected) throw new Error("No valid feed found");
  const settings = await getSettings();
  const feed = await prisma.feed.upsert({
    where: { feedUrl: selected.feedUrl },
    create: {
      title: input.title ?? selected.title,
      feedUrl: selected.feedUrl,
      siteUrl: selected.siteUrl,
      description: selected.description,
      folderId: input.folderId ?? null,
      refreshIntervalMinutes:
        input.refreshIntervalMinutes ?? settings.defaultRefreshIntervalMinutes,
      fetchFullContent: input.fetchFullContent ?? true,
      nextCheckAt: new Date()
    },
    update: {
      title: input.title ?? selected.title,
      siteUrl: selected.siteUrl,
      description: selected.description,
      folderId: input.folderId ?? undefined,
      refreshIntervalMinutes: input.refreshIntervalMinutes ?? undefined,
      fetchFullContent: input.fetchFullContent ?? undefined,
      isActive: true,
      nextCheckAt: new Date(),
      lastError: null,
      errorCount: 0
    }
  });
  await enqueueJob("fetch_feed", { feedId: feed.id, force: true });
  return feed.id;
}

export async function fetchFeed(
  feedId: string,
  force = false
): Promise<{ created: number; updated: number }> {
  const feed = await prisma.feed.findUnique({ where: { id: feedId } });
  if (!feed) throw new Error("Feed not found");
  if (!feed.isActive) {
    await prisma.fetchLog.create({
      data: {
        feedId: feed.id,
        level: "info",
        message: "Inactive feed fetch skipped",
        metadataJson: JSON.stringify({ skippedAt: new Date().toISOString() })
      }
    });
    return { created: 0, updated: 0 };
  }
  const headers: Record<string, string> = {};
  if (!force && feed.etag) headers["if-none-match"] = feed.etag;
  if (!force && feed.lastModified) headers["if-modified-since"] = feed.lastModified;

  try {
    const response = await fetchWithRetry(feed.feedUrl, {
      timeoutMs: env.FEED_FETCH_TIMEOUT_MS,
      retries: 2,
      headers
    });
    if (response.status === 304) {
      await markFeedChecked(feed.id, null);
      return { created: 0, updated: 0 };
    }
    if (!response.ok) {
      throw new Error(`Feed fetch failed: HTTP ${response.status}`);
    }
    const body = await response.text();
    const parsed = parseFeedDocument(body, feed.feedUrl);
    await prisma.feed.update({
      where: { id: feed.id },
      data: {
        title: parsed.title || feed.title,
        siteUrl: parsed.siteUrl,
        description: parsed.description,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        lastCheckedAt: new Date(),
        nextCheckAt: nextCheckDate(feed.refreshIntervalMinutes),
        lastError: null,
        errorCount: 0
      }
    });

    let created = 0;
    let updated = 0;
    for (const item of parsed.items) {
      const result = await upsertArticleFromFeedItem(feed.id, item, feed.fetchFullContent);
      if (result === "created") created += 1;
      else updated += 1;
    }
    await prisma.fetchLog.create({
      data: {
        feedId: feed.id,
        level: "info",
        message: "Feed fetched",
        metadataJson: JSON.stringify({ created, updated })
      }
    });
    return { created, updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFeedChecked(feed.id, message);
    throw error;
  }
}

export async function extractArticle(articleId: string): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { feed: true }
  });
  if (!article?.url) return;
  const settings = await getSettings();
  if (!settings.fullTextExtractionEnabled) return;
  const extracted = await extractReadableArticle(article.url);
  const updated = await prisma.article.update({
    where: { id: articleId },
    data: {
      title: extracted.title ?? article.title,
      originalTitle: extracted.title ?? article.originalTitle,
      originalHtml: extracted.html,
      originalText: extracted.text || article.originalText,
      originalExcerpt: extracted.excerpt || article.originalExcerpt,
      originalImageUrl: extracted.imageUrl ?? article.originalImageUrl
    }
  });
  await cacheArticleImages(updated.id);
  await upsertArticleSearch(updated.id);
  if (
    settings.translationEnabled &&
    settings.autoTranslateNewArticles &&
    settings.translationConfigured &&
    updated.translationStatus === "pending"
  ) {
    await enqueueTranslationJob(updated.id);
  }
}

export async function scheduleDueFeeds(): Promise<number> {
  const feeds = await prisma.feed.findMany({
    where: {
      isActive: true,
      OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: new Date() } }]
    },
    take: 20
  });
  for (const feed of feeds) {
    await enqueueJob("fetch_feed", { feedId: feed.id });
    await prisma.feed.update({
      where: { id: feed.id },
      data: { nextCheckAt: nextCheckDate(feed.refreshIntervalMinutes) }
    });
  }
  return feeds.length;
}

async function upsertArticleFromFeedItem(
  feedId: string,
  item: NormalizedFeedItem,
  fetchFullContent: boolean
): Promise<"created" | "updated"> {
  const canonicalUrl = item.url ? normalizeUrl(item.url) : null;
  const urlHash = hashUrl(
    canonicalUrl ?? item.guid ?? `${feedId}:${item.title}:${item.publishedAt?.toISOString()}`
  );
  const originalText = item.text || item.summary || item.title;
  const sourceLanguage = isLikelyPersian(`${item.title}\n${originalText}`) ? "fa" : "en";
  const translationStatus = sourceLanguage === "fa" ? "skipped" : "pending";
  const data = {
    guid: item.guid,
    url: item.url,
    canonicalUrl,
    urlHash,
    title: item.title,
    originalTitle: item.title,
    author: item.author,
    publishedAt: item.publishedAt,
    originalHtml: item.html,
    originalText,
    originalExcerpt: item.summary ?? excerpt(originalText),
    originalImageUrl: item.imageUrl,
    rawFeedItemJson: JSON.stringify(item.raw),
    sourceLanguage,
    translationStatus
  };

  const existing = await prisma.article.findUnique({
    where: { feedId_urlHash: { feedId, urlHash } }
  });
  const article = existing
    ? await prisma.article.update({
        where: { id: existing.id },
        data: {
          ...data,
          translationStatus:
            existing.translationStatus === "completed"
              ? existing.translationStatus
              : data.translationStatus
        }
      })
    : await prisma.article.create({ data: { ...data, feedId } });

  await applyRulesToArticle(article.id);
  await upsertArticleSearch(article.id);

  const settings = await getSettings();
  const hasFeedImage = Boolean(item.imageUrl || /<img\s/i.test(item.html ?? ""));
  const shouldExtractFullContent =
    fetchFullContent && Boolean(item.url) && (!existing || !article.originalHtml);
  if (shouldExtractFullContent) {
    await enqueueJob("extract_article", { articleId: article.id });
  } else {
    if (!existing && hasFeedImage) await enqueueJob("cache_images", { articleId: article.id });
    if (
      settings.translationEnabled &&
      settings.autoTranslateNewArticles &&
      settings.translationConfigured &&
      article.translationStatus === "pending"
    ) {
      await enqueueTranslationJob(article.id);
    }
  }

  if (item.categories.length) {
    for (const category of item.categories) {
      const tag = await prisma.tag.upsert({
        where: { name: category },
        create: { name: category },
        update: {}
      });
      await prisma.articleTag.upsert({
        where: { articleId_tagId: { articleId: article.id, tagId: tag.id } },
        create: { articleId: article.id, tagId: tag.id },
        update: {}
      });
    }
    await upsertArticleSearch(article.id);
  }

  return existing ? "updated" : "created";
}

function nextCheckDate(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function markFeedChecked(feedId: string, error: string | null): Promise<void> {
  const feed = await prisma.feed.findUnique({ where: { id: feedId } });
  const nextErrorCount = error ? (feed?.errorCount ?? 0) + 1 : 0;
  const nextCheckAt = error
    ? nextFeedRetryDate(nextErrorCount)
    : nextCheckDate(feed?.refreshIntervalMinutes ?? 60);
  await prisma.feed.update({
    where: { id: feedId },
    data: {
      lastCheckedAt: new Date(),
      nextCheckAt,
      lastError: error,
      errorCount: nextErrorCount
    }
  });
  if (error) {
    await prisma.fetchLog.create({
      data: {
        feedId,
        level: "error",
        message: "Feed fetch failed",
        metadataJson: JSON.stringify({
          error,
          nextRetryAt: nextCheckAt.toISOString(),
          errorCount: nextErrorCount
        })
      }
    });
  }
}

export function nextFeedRetryDate(errorCount: number, from = new Date()): Date {
  const retryMinutes = [5, 15, 30, 60, 180, 360];
  const minutes =
    retryMinutes[Math.min(Math.max(errorCount - 1, 0), retryMinutes.length - 1)] ?? 360;
  return new Date(from.getTime() + minutes * 60 * 1000);
}
