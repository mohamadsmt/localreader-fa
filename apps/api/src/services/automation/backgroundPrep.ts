import { env } from "../../config/env.js";
import { prisma } from "../../db.js";
import { getSettings } from "../settings.js";
import { enqueueJob, recoverStaleJobs } from "../jobs/jobs.js";
import { scheduleDueFeeds } from "../feed/ingest.js";
import { enqueueTranslationJob } from "../translation/queue.js";

export interface PrepSummary {
  recoveredJobs: number;
  feedJobs: number;
  extractionJobs: number;
  imageJobs: number;
  recoveredTranslations: number;
  translationJobs: number;
  retriedTranslationJobs: number;
}

const prepBatchSize = 50;
const failedTranslationRetryDelayMs = 30 * 60 * 1000;

export async function runBackgroundPrep(): Promise<PrepSummary> {
  const settings = await getSettings();
  if (!settings.backgroundPrepEnabled) {
    return {
      recoveredJobs: 0,
      feedJobs: 0,
      extractionJobs: 0,
      imageJobs: 0,
      recoveredTranslations: 0,
      translationJobs: 0,
      retriedTranslationJobs: 0
    };
  }

  const recoveredJobs = await recoverStaleJobs(env.STALE_JOB_TIMEOUT_MS);
  const canTranslate =
    settings.translationEnabled &&
    settings.autoTranslateNewArticles &&
    settings.translationConfigured;
  const recoveredTranslations = canTranslate ? await recoverInterruptedTranslations() : 0;
  const feedJobs = await scheduleDueFeeds();
  const extractionJobs = settings.fullTextExtractionEnabled
    ? await enqueueMissingExtractionJobs()
    : 0;
  const imageJobs = await enqueueMissingImageJobs();
  const translationJobs = canTranslate ? await enqueuePendingTranslationJobs("pending") : 0;
  const retriedTranslationJobs =
    canTranslate && settings.autoRetryFailedTranslations
      ? await enqueuePendingTranslationJobs("failed")
      : 0;

  return {
    recoveredJobs,
    feedJobs,
    extractionJobs,
    imageJobs,
    recoveredTranslations,
    translationJobs,
    retriedTranslationJobs
  };
}

async function enqueueMissingExtractionJobs(): Promise<number> {
  const articles = await prisma.article.findMany({
    where: {
      url: { not: null },
      originalHtml: null
    },
    select: { id: true },
    take: prepBatchSize,
    orderBy: { fetchedAt: "desc" }
  });
  let count = 0;
  for (const article of articles) {
    await enqueueJob("extract_article", { articleId: article.id });
    count += 1;
  }
  return count;
}

async function enqueueMissingImageJobs(): Promise<number> {
  const articles = await prisma.article.findMany({
    where: {
      imageCacheStatus: "pending",
      OR: [{ originalImageUrl: { not: null } }, { originalHtml: { contains: "<img" } }]
    },
    select: { id: true },
    take: prepBatchSize,
    orderBy: { fetchedAt: "desc" }
  });
  let count = 0;
  for (const article of articles) {
    await enqueueJob("cache_images", { articleId: article.id });
    count += 1;
  }
  return count;
}

async function enqueuePendingTranslationJobs(status: "pending" | "failed"): Promise<number> {
  const where =
    status === "failed"
      ? {
          translationStatus: "failed",
          updatedAt: { lt: new Date(Date.now() - failedTranslationRetryDelayMs) }
        }
      : { translationStatus: "pending" };
  const articles = await prisma.article.findMany({
    where,
    select: { id: true },
    take: status === "failed" ? 10 : prepBatchSize,
    orderBy: { fetchedAt: "desc" }
  });
  let count = 0;
  for (const article of articles) {
    await enqueueTranslationJob(article.id, {
      markPending: status === "failed",
      reason:
        status === "failed" ? "automatic retry after failed translation" : "pending article queued"
    });
    count += 1;
  }
  return count;
}

async function recoverInterruptedTranslations(): Promise<number> {
  const cutoff = new Date(Date.now() - env.STALE_JOB_TIMEOUT_MS);
  const articles = await prisma.article.findMany({
    where: {
      translationStatus: "processing",
      updatedAt: { lt: cutoff }
    },
    select: { id: true },
    take: 10,
    orderBy: { updatedAt: "asc" }
  });
  let count = 0;
  for (const article of articles) {
    await enqueueTranslationJob(article.id, {
      markPending: true,
      reason: "interrupted translation recovered"
    });
    count += 1;
  }
  return count;
}

export interface ReadinessStatus {
  isPreparing: boolean;
  readyUnreadCount: number;
  unreadCount: number;
  pendingJobs: number;
  runningJobs: number;
  failedJobs: number;
  pendingTranslations: number;
  processingTranslations: number;
  failedTranslations: number;
  pendingImageCaches: number;
  feedsWithErrors: number;
  nextFeedCheckAt: string | null;
  lastError: string | null;
}

export async function getReadinessStatus(): Promise<ReadinessStatus> {
  const [
    pendingJobs,
    runningJobs,
    failedJobs,
    unreadCount,
    readyUnreadCount,
    pendingTranslations,
    processingTranslations,
    failedTranslations,
    pendingImageCaches,
    feedsWithErrors,
    nextFeed,
    latestError
  ] = await Promise.all([
    prisma.job.count({ where: { status: "pending" } }),
    prisma.job.count({ where: { status: "running" } }),
    prisma.job.count({ where: { status: "failed" } }),
    prisma.article.count({ where: { isRead: false, isArchived: false } }),
    prisma.article.count({
      where: {
        isRead: false,
        isArchived: false,
        translationStatus: { in: ["completed", "skipped"] }
      }
    }),
    prisma.article.count({ where: { translationStatus: "pending" } }),
    prisma.article.count({ where: { translationStatus: "processing" } }),
    prisma.article.count({ where: { translationStatus: "failed" } }),
    prisma.article.count({
      where: {
        imageCacheStatus: "pending",
        OR: [{ originalImageUrl: { not: null } }, { originalHtml: { contains: "<img" } }]
      }
    }),
    prisma.feed.count({ where: { lastError: { not: null } } }),
    prisma.feed.findFirst({
      where: { isActive: true, nextCheckAt: { not: null } },
      orderBy: { nextCheckAt: "asc" },
      select: { nextCheckAt: true }
    }),
    prisma.fetchLog.findFirst({
      where: { level: "error" },
      orderBy: { createdAt: "desc" },
      select: { message: true, metadataJson: true }
    })
  ]);

  return {
    isPreparing:
      pendingJobs > 0 ||
      runningJobs > 0 ||
      pendingTranslations > 0 ||
      processingTranslations > 0 ||
      pendingImageCaches > 0,
    readyUnreadCount,
    unreadCount,
    pendingJobs,
    runningJobs,
    failedJobs,
    pendingTranslations,
    processingTranslations,
    failedTranslations,
    pendingImageCaches,
    feedsWithErrors,
    nextFeedCheckAt: nextFeed?.nextCheckAt?.toISOString() ?? null,
    lastError:
      feedsWithErrors && latestError
        ? summarizeFetchError(latestError.message, latestError.metadataJson)
        : null
  };
}

function summarizeFetchError(message: string, metadataJson: string | null): string {
  if (!metadataJson) return message;
  try {
    const metadata = JSON.parse(metadataJson) as { error?: unknown };
    return typeof metadata.error === "string" ? metadata.error : message;
  } catch {
    return message;
  }
}
