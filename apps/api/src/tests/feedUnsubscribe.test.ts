import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../db.js";
import { buildServer } from "../server.js";
import { discoverFeeds } from "../services/feed/discovery.js";
import { createFeedFromUrl } from "../services/feed/ingest.js";

vi.mock("../services/feed/discovery.js", () => ({
  discoverFeeds: vi.fn()
}));

describe("feed unsubscribe API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.job.deleteMany();
    await prisma.article.deleteMany();
    await prisma.feed.deleteMany();
    vi.mocked(discoverFeeds).mockReset();
  });

  it("rejects missing or wrong feed title confirmation", async () => {
    const feed = await prisma.feed.create({
      data: { title: "Private Feed", feedUrl: "https://example.com/private.xml" }
    });

    const missing = await app.inject({
      method: "DELETE",
      url: `/api/feeds/${feed.id}`,
      payload: {}
    });
    expect(missing.statusCode).toBe(400);

    const wrong = await app.inject({
      method: "DELETE",
      url: `/api/feeds/${feed.id}`,
      payload: { confirmTitle: "Private feed" }
    });
    expect(wrong.statusCode).toBe(400);
  });

  it("unsubscribes active feeds and preserves articles and article jobs", async () => {
    const feed = await prisma.feed.create({
      data: {
        title: "Private Feed",
        feedUrl: "https://example.com/private.xml",
        nextCheckAt: new Date("2026-05-25T10:00:00.000Z"),
        lastError: "temporary outage",
        errorCount: 2
      }
    });
    const article = await prisma.article.create({
      data: {
        feedId: feed.id,
        urlHash: "private-article",
        title: "Stored Article",
        originalTitle: "Stored Article",
        originalText: "Already saved content"
      }
    });
    await prisma.job.create({
      data: {
        type: "fetch_feed",
        status: "pending",
        payloadJson: JSON.stringify({ feedId: feed.id, force: true })
      }
    });
    const translationJob = await prisma.job.create({
      data: {
        type: "translate_article",
        status: "pending",
        payloadJson: JSON.stringify({ articleId: article.id })
      }
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/feeds/${feed.id}`,
      payload: { confirmTitle: "Private Feed" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      subscriptionRemoved: true,
      articlesPreserved: 1
    });
    const unsubscribed = await prisma.feed.findUniqueOrThrow({ where: { id: feed.id } });
    expect(unsubscribed.isActive).toBe(false);
    expect(unsubscribed.nextCheckAt).toBeNull();
    expect(unsubscribed.lastError).toBeNull();
    expect(unsubscribed.errorCount).toBe(0);
    await expect(
      prisma.article.findUniqueOrThrow({ where: { id: article.id } })
    ).resolves.toBeTruthy();
    expect(
      await prisma.job.findMany({ where: { type: "fetch_feed", status: "pending" } })
    ).toHaveLength(0);
    await expect(
      prisma.job.findUniqueOrThrow({ where: { id: translationJob.id } })
    ).resolves.toBeTruthy();
  });

  it("excludes unsubscribed feeds from active list and OPML export", async () => {
    await prisma.feed.create({
      data: { title: "Active Feed", feedUrl: "https://example.com/active.xml" }
    });
    await prisma.feed.create({
      data: {
        title: "Unsubscribed Feed",
        feedUrl: "https://example.com/inactive.xml",
        isActive: false
      }
    });

    const feeds = await app.inject({ method: "GET", url: "/api/feeds" });
    expect(feeds.statusCode).toBe(200);
    const activeFeeds: Array<{ title: string }> = feeds.json();
    expect(activeFeeds.map((feed) => feed.title)).toEqual(["Active Feed"]);

    const opml = await app.inject({ method: "GET", url: "/api/export/opml" });
    expect(opml.statusCode).toBe(200);
    expect(opml.body).toContain("Active Feed");
    expect(opml.body).not.toContain("Unsubscribed Feed");
  });

  it("reactivates a previously unsubscribed feed when added again", async () => {
    vi.mocked(discoverFeeds).mockResolvedValue([
      {
        title: "Restored Feed",
        feedUrl: "https://example.com/restored.xml",
        siteUrl: "https://example.com",
        description: "Restored description"
      }
    ]);
    const feed = await prisma.feed.create({
      data: {
        title: "Old Feed",
        feedUrl: "https://example.com/restored.xml",
        isActive: false,
        nextCheckAt: null,
        lastError: "manually removed",
        errorCount: 4
      }
    });

    const id = await createFeedFromUrl({ url: "https://example.com" });

    expect(id).toBe(feed.id);
    const restored = await prisma.feed.findUniqueOrThrow({ where: { id: feed.id } });
    expect(restored.isActive).toBe(true);
    expect(restored.title).toBe("Restored Feed");
    expect(restored.lastError).toBeNull();
    expect(restored.errorCount).toBe(0);
    expect(restored.nextCheckAt).toBeInstanceOf(Date);
    expect(await prisma.job.count({ where: { type: "fetch_feed", status: "pending" } })).toBe(1);
  });
});
