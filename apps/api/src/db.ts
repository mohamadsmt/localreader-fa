import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

export const prisma = new PrismaClient({
  log: env.NODE_ENV === "test" ? [] : ["warn", "error"]
});

export async function ensureSearchIndex(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
      article_id UNINDEXED,
      title,
      body,
      title_fa,
      body_fa,
      author,
      feed_title,
      tags,
      tokenize = 'unicode61'
    )
  `);
}

export async function upsertArticleSearch(articleId: string): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { feed: true, tags: { include: { tag: true } } }
  });
  if (!article) return;
  await prisma.$executeRaw(Prisma.sql`DELETE FROM article_search WHERE article_id = ${articleId}`);
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO article_search (
      article_id, title, body, title_fa, body_fa, author, feed_title, tags
    ) VALUES (
      ${article.id},
      ${article.originalTitle},
      ${article.originalText},
      ${article.translatedTitleFa ?? ""},
      ${article.translatedBodyFaMarkdown ?? article.translatedSummaryFa ?? ""},
      ${article.author ?? ""},
      ${article.feed.title},
      ${article.tags.map((entry) => entry.tag.name).join(" ")}
    )`
  );
}

export async function rebuildArticleSearch(): Promise<number> {
  await ensureSearchIndex();
  await prisma.$executeRawUnsafe("DELETE FROM article_search");
  const articles = await prisma.article.findMany({ select: { id: true } });
  for (const article of articles) {
    await upsertArticleSearch(article.id);
  }
  return articles.length;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  await ensureSearchIndex();
  logger.info("database connected");
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
