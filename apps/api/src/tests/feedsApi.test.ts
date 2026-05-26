import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSearchIndex, prisma } from "../db.js";
import { buildServer } from "../server.js";
import {
  fetchFeed,
  INITIAL_FEED_IMPORT_LIMIT,
  scheduleDueFeeds
} from "../services/feed/ingest.js";
import { fetchWithRetry } from "../services/http.js";

vi.mock("../services/http.js", () => ({
  fetchWithRetry: vi.fn()
}));

describe("feed organization and article pagination API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.fetchLog.deleteMany();
    await prisma.job.deleteMany();
    await prisma.article.deleteMany();
    await prisma.feed.deleteMany();
    await prisma.folder.deleteMany();
    await ensureSearchIndex();
    vi.mocked(fetchWithRetry).mockReset();
  });

  it("moves feeds into and out of folders", async () => {
    const folder = await prisma.folder.create({ data: { name: "AI" } });
    const feed = await prisma.feed.create({
      data: { title: "Strategy Feed", feedUrl: "https://example.com/rss.xml" }
    });

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/feeds/${feed.id}`,
      payload: { folderId: folder.id }
    });

    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ id: feed.id, folderId: folder.id });

    const unfiled = await app.inject({
      method: "PATCH",
      url: `/api/feeds/${feed.id}`,
      payload: { folderId: null }
    });

    expect(unfiled.statusCode).toBe(200);
    expect(unfiled.json()).toMatchObject({ id: feed.id, folderId: null });
  });

  it("paginates articles within a folder", async () => {
    const folder = await prisma.folder.create({ data: { name: "Product" } });
    const feed = await prisma.feed.create({
      data: {
        title: "Product Feed",
        feedUrl: "https://example.com/product.xml",
        folderId: folder.id
      }
    });
    const otherFeed = await prisma.feed.create({
      data: { title: "Other Feed", feedUrl: "https://example.com/other.xml" }
    });
    await Promise.all([
      createStoredArticle(feed.id, "Product 1", "2026-05-20T10:00:00.000Z"),
      createStoredArticle(feed.id, "Product 2", "2026-05-21T10:00:00.000Z"),
      createStoredArticle(feed.id, "Product 3", "2026-05-22T10:00:00.000Z"),
      createStoredArticle(otherFeed.id, "Other 1", "2026-05-23T10:00:00.000Z")
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/api/articles?folderId=${folder.id}&limit=2&offset=1`
    });

    expect(response.statusCode).toBe(200);
    const body: { items: Array<{ title: string }>; total: number } = response.json();
    expect(body.total).toBe(3);
    expect(body.items.map((item) => item.title)).toEqual(["Product 2", "Product 1"]);
  });

  it("queues scheduled and manual refresh jobs without an item limit", async () => {
    const feed = await prisma.feed.create({
      data: {
        title: "Refresh Feed",
        feedUrl: "https://example.com/refresh.xml",
        nextCheckAt: new Date("2026-05-25T10:00:00.000Z")
      }
    });

    const single = await app.inject({ method: "POST", url: `/api/feeds/${feed.id}/refresh` });
    expect(single.statusCode).toBe(200);
    await expectFetchPayloads([{ feedId: feed.id, force: true }]);

    await prisma.job.deleteMany();
    const all = await app.inject({ method: "POST", url: "/api/refresh-all" });
    expect(all.statusCode).toBe(200);
    await expectFetchPayloads([{ feedId: feed.id, force: true }]);

    await prisma.job.deleteMany();
    await scheduleDueFeeds();
    await expectFetchPayloads([{ feedId: feed.id }]);
  });

  it("imports only the latest 50 items first, then stores new posts on later refreshes", async () => {
    const feed = await prisma.feed.create({
      data: {
        title: "Windowed Feed",
        feedUrl: "https://example.com/windowed.xml",
        fetchFullContent: false
      }
    });
    vi.mocked(fetchWithRetry)
      .mockResolvedValueOnce(feedResponse(rssFeed(range(0, 59))))
      .mockResolvedValueOnce(feedResponse(rssFeed([60, ...range(11, 59).reverse()])));

    await fetchFeed(feed.id, true, { itemLimit: INITIAL_FEED_IMPORT_LIMIT });

    expect(await prisma.article.count({ where: { feedId: feed.id } })).toBe(50);
    await expect(
      prisma.article.findFirst({ where: { feedId: feed.id, title: "Item 9" } })
    ).resolves.toBeNull();

    const result = await fetchFeed(feed.id);

    expect(result.created).toBe(1);
    expect(await prisma.article.count({ where: { feedId: feed.id } })).toBe(51);
    await expect(
      prisma.article.findFirstOrThrow({ where: { feedId: feed.id, title: "Item 60" } })
    ).resolves.toBeTruthy();
    const latestLog = await prisma.fetchLog.findFirstOrThrow({
      where: { feedId: feed.id, message: "Feed fetched" },
      orderBy: { createdAt: "desc" }
    });
    expect(JSON.parse(latestLog.metadataJson ?? "{}")).toMatchObject({
      itemLimit: null,
      processed: 50
    });
  });
});

async function createStoredArticle(
  feedId: string,
  title: string,
  publishedAt: string
): Promise<void> {
  await prisma.article.create({
    data: {
      feedId,
      urlHash: `${feedId}-${title}`,
      title,
      originalTitle: title,
      originalText: `${title} body`,
      publishedAt: new Date(publishedAt)
    }
  });
}

async function expectFetchPayloads(expected: Array<Record<string, unknown>>): Promise<void> {
  const jobs = await prisma.job.findMany({ where: { type: "fetch_feed", status: "pending" } });
  expect(jobs.map((job) => parseJobPayload(job.payloadJson))).toEqual(expected);
  for (const job of jobs) {
    expect(parseJobPayload(job.payloadJson)).not.toHaveProperty("itemLimit");
  }
}

function parseJobPayload(payloadJson: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(payloadJson);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected job payload object");
  }
  return parsed as Record<string, unknown>;
}

function feedResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "application/rss+xml" } });
}

function rssFeed(ids: number[]): string {
  const items = ids
    .map(
      (id) => `<item>
        <title>Item ${id}</title>
        <link>https://example.com/items/${id}</link>
        <guid>item-${id}</guid>
        <description>Body ${id}</description>
        <pubDate>${new Date(Date.UTC(2026, 0, id + 1)).toUTCString()}</pubDate>
      </item>`
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Windowed Feed</title>${items}</channel></rss>`;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
