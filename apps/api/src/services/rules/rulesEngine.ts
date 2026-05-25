import { ruleActionSchema, ruleConditionSchema } from "@localreader/shared";
import { prisma, upsertArticleSearch } from "../../db.js";
import { enqueueTranslationJob } from "../translation/queue.js";

interface RuleArticle {
  id: string;
  feedId: string;
  title: string;
  author: string | null;
  url: string | null;
  originalText: string;
  originalExcerpt: string | null;
  feed: { id: string; title: string; folderId: string | null };
}

export async function applyRulesToArticle(articleId: string): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { feed: true }
  });
  if (!article) return;
  const rules = await prisma.rule.findMany({
    where: { isEnabled: true },
    orderBy: { createdAt: "asc" }
  });
  for (const rule of rules) {
    const conditions = ruleConditionSchema.array().parse(JSON.parse(rule.conditionsJson));
    const actions = ruleActionSchema.array().parse(JSON.parse(rule.actionsJson));
    if (!conditions.every((condition) => matchesCondition(article, condition))) continue;
    for (const action of actions) {
      if (action.type === "mark_read") {
        await prisma.article.update({
          where: { id: articleId },
          data: { isRead: true, lastReadAt: new Date() }
        });
      } else if (action.type === "star") {
        await prisma.article.update({ where: { id: articleId }, data: { isStarred: true } });
      } else if (action.type === "archive") {
        await prisma.article.update({ where: { id: articleId }, data: { isArchived: true } });
      } else if (action.type === "read_later") {
        await prisma.article.update({ where: { id: articleId }, data: { isReadLater: true } });
      } else if (action.type === "skip_translation") {
        await prisma.article.update({
          where: { id: articleId },
          data: { translationStatus: "skipped" }
        });
      } else if (action.type === "translate_immediately") {
        await enqueueTranslationJob(articleId, {
          markPending: true,
          reason: "rule requested immediate translation"
        });
      } else if (action.type === "add_tag" && action.value) {
        const tag = await prisma.tag.upsert({
          where: { name: action.value },
          create: { name: action.value },
          update: {}
        });
        await prisma.articleTag.upsert({
          where: { articleId_tagId: { articleId, tagId: tag.id } },
          create: { articleId, tagId: tag.id },
          update: {}
        });
      }
    }
  }
  await upsertArticleSearch(articleId);
}

function matchesCondition(
  article: RuleArticle,
  condition: { field: "title" | "body" | "author" | "feed" | "url" | "category"; value: string }
): boolean {
  const value = condition.value.toLowerCase();
  const haystack =
    condition.field === "title"
      ? article.title
      : condition.field === "body"
        ? `${article.originalText} ${article.originalExcerpt ?? ""}`
        : condition.field === "author"
          ? (article.author ?? "")
          : condition.field === "feed"
            ? article.feed.title
            : condition.field === "url"
              ? (article.url ?? "")
              : (article.feed.folderId ?? "");
  return haystack.toLowerCase().includes(value);
}
