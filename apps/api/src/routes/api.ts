import { XMLParser } from "fast-xml-parser";
import type { FastifyInstance } from "fastify";
import {
  articlePatchSchema,
  articleQuerySchema,
  feedCreateSchema,
  feedPatchSchema,
  highlightCreateSchema,
  noteCreateSchema,
  ruleCreateSchema,
  rulePatchSchema,
  savedSearchCreateSchema,
  settingsPatchSchema,
  tagCreateSchema
} from "@localreader/shared";
import { isTranslationProviderConfigured } from "../config/env.js";
import { prisma, rebuildArticleSearch, upsertArticleSearch } from "../db.js";
import { createFeedFromUrl, fetchFeed } from "../services/feed/ingest.js";
import { discoverFeeds } from "../services/feed/discovery.js";
import { enqueueJob } from "../services/jobs/jobs.js";
import { getSettings, patchSettings } from "../services/settings.js";
import {
  buildArticleOrderBy,
  buildArticleWhere,
  searchArticleIds
} from "../services/search/search.js";
import { getReadinessStatus, runBackgroundPrep } from "../services/automation/backgroundPrep.js";
import { enqueueTranslationJob } from "../services/translation/queue.js";

interface IdParams {
  id: string;
}

interface FeedDiscoverBody {
  url?: string;
}

interface OpmlBody {
  opml?: string;
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({
    ok: true,
    name: "LocalReader FA",
    translationConfigured: isTranslationProviderConfigured(),
    time: new Date().toISOString()
  }));

  app.get("/api/folders", async () =>
    prisma.folder.findMany({ include: { feeds: true }, orderBy: { name: "asc" } })
  );

  app.post("/api/folders", async (request) => {
    const body = request.body as { name?: string };
    return prisma.folder.create({ data: { name: String(body.name ?? "").trim() } });
  });

  app.delete<{ Params: IdParams }>("/api/folders/:id", async (request) => {
    await prisma.folder.delete({ where: { id: request.params.id } });
    return { ok: true };
  });

  app.get("/api/feeds", async () =>
    prisma.feed.findMany({
      include: {
        folder: true,
        _count: { select: { articles: true } }
      },
      orderBy: [{ folder: { name: "asc" } }, { title: "asc" }]
    })
  );

  app.post("/api/feeds/discover", async (request) => {
    const body = request.body as FeedDiscoverBody;
    if (!body.url) throw new Error("url is required");
    return discoverFeeds(body.url);
  });

  app.post("/api/feeds", async (request) => {
    const input = feedCreateSchema.parse(request.body);
    const id = await createFeedFromUrl(input);
    return prisma.feed.findUniqueOrThrow({ where: { id } });
  });

  app.patch<{ Params: IdParams }>("/api/feeds/:id", async (request) => {
    const input = feedPatchSchema.parse(request.body);
    return prisma.feed.update({ where: { id: request.params.id }, data: input });
  });

  app.delete<{ Params: IdParams }>("/api/feeds/:id", async (request) => {
    await prisma.feed.delete({ where: { id: request.params.id } });
    return { ok: true };
  });

  app.post<{ Params: IdParams }>("/api/feeds/:id/refresh", async (request) => {
    const jobId = await enqueueJob("fetch_feed", { feedId: request.params.id, force: true });
    return { ok: true, jobId };
  });

  app.post("/api/refresh-all", async () => {
    const feeds = await prisma.feed.findMany({ where: { isActive: true }, select: { id: true } });
    const jobIds = [];
    for (const feed of feeds)
      jobIds.push(await enqueueJob("fetch_feed", { feedId: feed.id, force: true }));
    return { ok: true, enqueued: jobIds.length, jobIds };
  });

  app.get("/api/readiness", async () => getReadinessStatus());

  app.post("/api/prepare-now", async () => {
    const summary = await runBackgroundPrep();
    return { ok: true, summary, readiness: await getReadinessStatus() };
  });

  app.get("/api/articles", async (request) => {
    const query = articleQuerySchema.parse(request.query);
    const where = buildArticleWhere(query);
    if (query.q) {
      const ids = await searchArticleIds(query.q, query.limit, query.offset);
      where.id = { in: ids.length ? ids : ["__none__"] };
    }
    const [items, total] = await Promise.all([
      prisma.article.findMany({
        where,
        include: { feed: true, tags: { include: { tag: true } } },
        orderBy: buildArticleOrderBy(query.sort),
        take: query.limit,
        skip: query.q ? 0 : query.offset
      }),
      prisma.article.count({ where })
    ]);
    return { items, total };
  });

  app.get<{ Params: IdParams }>("/api/articles/:id", async (request) =>
    prisma.article.findUniqueOrThrow({
      where: { id: request.params.id },
      include: {
        feed: true,
        tags: { include: { tag: true } },
        highlights: { orderBy: { createdAt: "desc" } },
        notes: { orderBy: { createdAt: "desc" } }
      }
    })
  );

  app.patch<{ Params: IdParams }>("/api/articles/:id", async (request) => {
    const input = articlePatchSchema.parse(request.body);
    const article = await prisma.article.update({
      where: { id: request.params.id },
      data: {
        ...input,
        lastReadAt:
          input.lastReadAt === undefined
            ? undefined
            : input.lastReadAt
              ? new Date(input.lastReadAt)
              : null
      }
    });
    await upsertArticleSearch(article.id);
    return article;
  });

  app.post<{ Params: IdParams }>("/api/articles/:id/translate", async (request) => {
    await prisma.article.update({
      where: { id: request.params.id },
      data: { translationStatus: "pending", translationError: null }
    });
    const jobId = await enqueueTranslationJob(request.params.id);
    return { ok: true, jobId };
  });

  app.post<{ Params: IdParams }>("/api/articles/:id/retry-translation", async (request) => {
    await prisma.article.update({
      where: { id: request.params.id },
      data: { translationStatus: "pending", translationError: null }
    });
    const jobId = await enqueueTranslationJob(request.params.id);
    return { ok: true, jobId };
  });

  app.get("/api/tags", async () => prisma.tag.findMany({ orderBy: { name: "asc" } }));

  app.post("/api/tags", async (request) => {
    const input = tagCreateSchema.parse(request.body);
    return prisma.tag.upsert({ where: { name: input.name }, create: input, update: input });
  });

  app.delete<{ Params: IdParams }>("/api/tags/:id", async (request) => {
    await prisma.tag.delete({ where: { id: request.params.id } });
    return { ok: true };
  });

  app.get("/api/rules", async () => prisma.rule.findMany({ orderBy: { createdAt: "desc" } }));

  app.post("/api/rules", async (request) => {
    const input = ruleCreateSchema.parse(request.body);
    return prisma.rule.create({
      data: {
        name: input.name,
        isEnabled: input.isEnabled,
        conditionsJson: JSON.stringify(input.conditions),
        actionsJson: JSON.stringify(input.actions)
      }
    });
  });

  app.patch<{ Params: IdParams }>("/api/rules/:id", async (request) => {
    const input = rulePatchSchema.parse(request.body);
    return prisma.rule.update({
      where: { id: request.params.id },
      data: {
        name: input.name,
        isEnabled: input.isEnabled,
        conditionsJson: input.conditions ? JSON.stringify(input.conditions) : undefined,
        actionsJson: input.actions ? JSON.stringify(input.actions) : undefined
      }
    });
  });

  app.delete<{ Params: IdParams }>("/api/rules/:id", async (request) => {
    await prisma.rule.delete({ where: { id: request.params.id } });
    return { ok: true };
  });

  app.get("/api/highlights", async () =>
    prisma.highlight.findMany({
      include: { article: { include: { feed: true } } },
      orderBy: { createdAt: "desc" }
    })
  );

  app.post("/api/highlights", async (request) => {
    const input = highlightCreateSchema.parse(request.body);
    return prisma.highlight.create({ data: input });
  });

  app.patch<{ Params: IdParams }>("/api/highlights/:id", async (request) => {
    const body = request.body as { note?: string | null };
    return prisma.highlight.update({
      where: { id: request.params.id },
      data: { note: body.note ?? null }
    });
  });

  app.delete<{ Params: IdParams }>("/api/highlights/:id", async (request) => {
    await prisma.highlight.delete({ where: { id: request.params.id } });
    return { ok: true };
  });

  app.get("/api/notes", async () =>
    prisma.note.findMany({
      include: { article: { include: { feed: true } } },
      orderBy: { createdAt: "desc" }
    })
  );

  app.post("/api/notes", async (request) => {
    const input = noteCreateSchema.parse(request.body);
    return prisma.note.create({ data: input });
  });

  app.patch<{ Params: IdParams }>("/api/notes/:id", async (request) => {
    const body = request.body as { body?: string };
    return prisma.note.update({
      where: { id: request.params.id },
      data: { body: String(body.body ?? "") }
    });
  });

  app.delete<{ Params: IdParams }>("/api/notes/:id", async (request) => {
    await prisma.note.delete({ where: { id: request.params.id } });
    return { ok: true };
  });

  app.get("/api/saved-searches", async () =>
    prisma.savedSearch.findMany({ orderBy: { name: "asc" } })
  );

  app.post("/api/saved-searches", async (request) => {
    const input = savedSearchCreateSchema.parse(request.body);
    return prisma.savedSearch.create({
      data: { name: input.name, queryJson: JSON.stringify(input.queryJson) }
    });
  });

  app.delete<{ Params: IdParams }>("/api/saved-searches/:id", async (request) => {
    await prisma.savedSearch.delete({ where: { id: request.params.id } });
    return { ok: true };
  });

  app.get("/api/settings", async () => getSettings());

  app.patch("/api/settings", async (request) =>
    patchSettings(settingsPatchSchema.parse(request.body))
  );

  app.post("/api/import/opml", async (request) => {
    const body = request.body as OpmlBody | string;
    const opml = typeof body === "string" ? body : body.opml;
    if (!opml) throw new Error("opml is required");
    const urls = extractOpmlFeedUrls(opml);
    const imported: string[] = [];
    const failed: Array<{ url: string; error: string }> = [];
    for (const url of urls) {
      try {
        imported.push(await createFeedFromUrl({ url }));
      } catch (error) {
        failed.push({ url, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { imported: imported.length, failed };
  });

  app.get("/api/export/opml", async (_request, reply) => {
    const feeds = await prisma.feed.findMany({
      include: { folder: true },
      orderBy: { title: "asc" }
    });
    reply.header("content-type", "application/xml; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=localreader-fa.opml");
    return renderOpml(feeds);
  });

  app.get("/api/export/json", async (_request, reply) => {
    const backup = {
      exportedAt: new Date().toISOString(),
      feeds: await prisma.feed.findMany({ include: { folder: true } }),
      articles: await prisma.article.findMany({
        include: { tags: { include: { tag: true } }, highlights: true, notes: true }
      }),
      rules: await prisma.rule.findMany(),
      savedSearches: await prisma.savedSearch.findMany(),
      settings: await prisma.setting.findMany()
    };
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=localreader-fa-backup.json");
    return backup;
  });

  app.get("/api/jobs", async () =>
    prisma.job.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 })
  );

  app.post<{ Params: IdParams }>("/api/jobs/:id/retry", async (request) => {
    const job = await prisma.job.update({
      where: { id: request.params.id },
      data: {
        status: "pending",
        runAfter: new Date(),
        lastError: null,
        completedAt: null,
        lockedAt: null
      }
    });
    return job;
  });

  app.post("/api/search/rebuild", async () => {
    const jobId = await enqueueJob("rebuild_search", {});
    return { ok: true, jobId };
  });

  app.post("/api/search/rebuild-now", async () => {
    const count = await rebuildArticleSearch();
    return { ok: true, count };
  });

  app.post<{ Params: IdParams }>("/api/feeds/:id/refresh-now", async (request) =>
    fetchFeed(request.params.id, true)
  );
}

function extractOpmlFeedUrls(opml: string): string[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
  const doc = parser.parse(opml) as Record<string, unknown>;
  const urls = new Set<string>();
  walk(doc, (value) => {
    if (value["@xmlUrl"] && typeof value["@xmlUrl"] === "string") urls.add(value["@xmlUrl"]);
  });
  return [...urls];
}

function walk(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  const record = value as Record<string, unknown>;
  visitor(record);
  for (const child of Object.values(record)) walk(child, visitor);
}

function renderOpml(
  feeds: Array<{
    title: string;
    feedUrl: string;
    siteUrl: string | null;
    folder: { name: string } | null;
  }>
): string {
  const outlines = feeds
    .map(
      (feed) =>
        `    <outline text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" type="rss" xmlUrl="${escapeXml(feed.feedUrl)}"${
          feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ""
        }${feed.folder ? ` category="${escapeXml(feed.folder.name)}"` : ""} />`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>LocalReader FA subscriptions</title>
  </head>
  <body>
${outlines}
  </body>
</opml>`;
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
