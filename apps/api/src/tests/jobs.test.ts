import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import { nextFeedRetryDate } from "../services/feed/ingest.js";
import { enqueueJob, failJob, retryDelayMs } from "../services/jobs/jobs.js";

describe("job retry backoff", () => {
  beforeEach(async () => {
    await prisma.job.deleteMany();
    await prisma.article.deleteMany();
    await prisma.feed.deleteMany();
  });

  it("uses exponential backoff with a cap", () => {
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(3)).toBe(4000);
    expect(retryDelayMs(99)).toBe(60 * 60 * 1000);
  });

  it("schedules feed retries with readable intervals", () => {
    const base = new Date("2026-05-25T10:00:00.000Z");
    expect(nextFeedRetryDate(1, base).toISOString()).toBe("2026-05-25T10:05:00.000Z");
    expect(nextFeedRetryDate(3, base).toISOString()).toBe("2026-05-25T10:30:00.000Z");
    expect(nextFeedRetryDate(99, base).toISOString()).toBe("2026-05-25T16:00:00.000Z");
  });

  it("keeps failed translation jobs moving until terminal failure", async () => {
    const feed = await prisma.feed.create({
      data: { title: "Feed", feedUrl: "https://example.com/rss" }
    });
    const article = await prisma.article.create({
      data: {
        feedId: feed.id,
        urlHash: "retry-article",
        title: "Retry me",
        originalTitle: "Retry me",
        originalText: "Long English text",
        translationStatus: "processing"
      }
    });
    const jobId = await enqueueJob(
      "translate_article",
      { articleId: article.id },
      { maxAttempts: 3 }
    );

    await failJob(jobId, new Error("temporary model outage"), 1, 3);

    const retryJob = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const retryArticle = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(retryJob.status).toBe("pending");
    expect(retryArticle.translationStatus).toBe("pending");
    expect(retryArticle.translationError).toBe("temporary model outage");
    expect(retryArticle.translationProgressJson).toContain("retry_scheduled");

    await failJob(jobId, new Error("terminal model outage"), 3, 3);

    const failedJob = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const failedArticle = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(failedJob.status).toBe("failed");
    expect(failedArticle.translationStatus).toBe("failed");
    expect(failedArticle.translationProgressJson).toContain("failed");
  });
});
