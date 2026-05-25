import type { JobType } from "@localreader/shared";
import { prisma } from "../../db.js";

export interface JobPayload {
  feedId?: string;
  articleId?: string;
  force?: boolean;
  itemLimit?: number;
}

export async function enqueueJob(
  type: JobType,
  payload: JobPayload,
  options: { runAfter?: Date; maxAttempts?: number } = {}
): Promise<string> {
  if (
    (type === "translate_article" || type === "cache_images" || type === "extract_article") &&
    payload.articleId
  ) {
    const existing = await prisma.job.findMany({
      where: { type, status: { in: ["pending", "running"] } },
      select: { id: true, payloadJson: true }
    });
    const duplicate = existing.find(
      (job) => safeParsePayload(job.payloadJson).articleId === payload.articleId
    );
    if (duplicate) return duplicate.id;
  }

  if (type === "fetch_feed" && payload.feedId) {
    const existing = await prisma.job.findMany({
      where: { type, status: { in: ["pending", "running"] } },
      select: { id: true, payloadJson: true }
    });
    const duplicate = existing.find(
      (job) => safeParsePayload(job.payloadJson).feedId === payload.feedId
    );
    if (duplicate) return duplicate.id;
  }

  const job = await prisma.job.create({
    data: {
      type,
      status: "pending",
      maxAttempts: options.maxAttempts ?? 5,
      runAfter: options.runAfter ?? new Date(),
      payloadJson: JSON.stringify(payload)
    }
  });
  return job.id;
}

export async function claimNextJob(): Promise<{
  id: string;
  type: JobType;
  attempts: number;
  maxAttempts: number;
  payload: JobPayload;
} | null> {
  const job = await prisma.job.findFirst({
    where: {
      status: "pending",
      runAfter: { lte: new Date() }
    },
    orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }]
  });
  if (!job) return null;
  const updated = await prisma.job.updateMany({
    where: { id: job.id, status: "pending" },
    data: { status: "running", lockedAt: new Date(), attempts: { increment: 1 } }
  });
  if (updated.count !== 1) return null;
  return {
    id: job.id,
    type: job.type as JobType,
    attempts: job.attempts + 1,
    maxAttempts: job.maxAttempts,
    payload: safeParsePayload(job.payloadJson)
  };
}

export async function recoverStaleJobs(timeoutMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);
  const staleJobs = await prisma.job.findMany({
    where: {
      status: "running",
      OR: [{ lockedAt: null }, { lockedAt: { lt: cutoff } }]
    },
    select: { id: true, type: true, payloadJson: true }
  });
  for (const job of staleJobs) {
    const payload = safeParsePayload(job.payloadJson);
    if (payload.articleId && job.type === "translate_article") {
      await prisma.article.updateMany({
        where: { id: payload.articleId, translationStatus: "processing" },
        data: {
          translationStatus: "pending",
          translationError: null,
          translationProgressJson: JSON.stringify({
            state: "recovered",
            reason: "stale translation job recovered",
            recoveredAt: new Date().toISOString()
          })
        }
      });
    }
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "pending", lockedAt: null, lastError: null }
    });
  }
  return staleJobs.length;
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "completed", completedAt: new Date(), lockedAt: null, lastError: null }
  });
}

export async function failJob(
  jobId: string,
  error: unknown,
  attempts: number,
  maxAttempts: number
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const terminal = attempts >= maxAttempts;
  const nextRunAfter = terminal ? new Date() : new Date(Date.now() + retryDelayMs(attempts));
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { type: true, payloadJson: true }
  });
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: terminal ? "failed" : "pending",
      runAfter: nextRunAfter,
      lockedAt: null,
      lastError: message
    }
  });

  if (job?.type === "translate_article") {
    const payload = safeParsePayload(job.payloadJson);
    if (payload.articleId) {
      await prisma.article.updateMany({
        where: {
          id: payload.articleId,
          translationStatus: { in: ["processing", "failed", "pending"] }
        },
        data: {
          translationStatus: terminal ? "failed" : "pending",
          translationError: message,
          translationProgressJson: JSON.stringify({
            state: terminal ? "failed" : "retry_scheduled",
            attempts,
            maxAttempts,
            nextRetryAt: terminal ? null : nextRunAfter.toISOString(),
            lastError: message
          })
        }
      });
    }
  }
}

export function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 1000 * 2 ** Math.max(0, attempts - 1));
}

function safeParsePayload(value: string): JobPayload {
  try {
    const parsed = JSON.parse(value) as JobPayload;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
