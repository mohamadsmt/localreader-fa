import { Prisma } from "@prisma/client";
import type { ArticleQuery } from "@localreader/shared";
import { prisma } from "../../db.js";

export async function searchArticleIds(query: string, limit: number, offset: number): Promise<string[]> {
  const ftsQuery = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `${term.replace(/["']/g, "")}*`)
    .join(" OR ");
  if (!ftsQuery) return [];
  const rows = await prisma.$queryRaw<Array<{ article_id: string }>>(
    Prisma.sql`SELECT article_id FROM article_search WHERE article_search MATCH ${ftsQuery} LIMIT ${limit} OFFSET ${offset}`
  );
  return rows.map((row) => row.article_id);
}

export function buildArticleWhere(query: ArticleQuery): Prisma.ArticleWhereInput {
  const where: Prisma.ArticleWhereInput = {};
  if (query.unread) where.isRead = false;
  if (query.starred) where.isStarred = true;
  if (query.archived !== undefined) where.isArchived = query.archived;
  else where.isArchived = false;
  if (query.readLater) where.isReadLater = true;
  if (query.failedTranslation) where.translationStatus = "failed";
  if (query.untranslated) where.translationStatus = { in: ["pending", "processing", "failed"] };
  if (query.feedId) where.feedId = query.feedId;
  if (query.folderId) where.feed = { folderId: query.folderId };
  if (query.tag) where.tags = { some: { tag: { name: query.tag } } };
  if (query.from || query.to) {
    where.publishedAt = {
      gte: query.from ? new Date(query.from) : undefined,
      lte: query.to ? new Date(query.to) : undefined
    };
  }
  return where;
}

export function buildArticleOrderBy(sort: ArticleQuery["sort"]): Prisma.ArticleOrderByWithRelationInput[] {
  if (sort === "oldest") return [{ publishedAt: "asc" }, { fetchedAt: "asc" }];
  if (sort === "feed") return [{ feed: { title: "asc" } }, { publishedAt: "desc" }];
  if (sort === "unread_first") return [{ isRead: "asc" }, { publishedAt: "desc" }];
  return [{ publishedAt: "desc" }, { fetchedAt: "desc" }];
}
