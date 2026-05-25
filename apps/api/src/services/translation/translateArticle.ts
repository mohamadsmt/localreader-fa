import { isLikelyPersian } from "@localreader/shared";
import { prisma, upsertArticleSearch } from "../../db.js";
import { htmlToMarkdown } from "../article/extract.js";
import { getSettings } from "../settings.js";
import { isTranslationProviderConfigured } from "../../config/env.js";
import { translateWithMetisDeepSeek } from "./metisDeepseekClient.js";
import { translateWithOllama } from "./ollamaClient.js";
import type { TranslationRequest, TranslationResponse } from "./types.js";

const maxChunkChars = 3000;

export async function translateArticle(articleId: string): Promise<void> {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw new Error("Article not found");
  if (
    article.translationStatus === "completed" &&
    article.translatedTitleFa &&
    article.translatedBodyFaMarkdown
  ) {
    return;
  }
  const content = article.originalHtml ? htmlToMarkdown(article.originalHtml) : article.originalText;
  const sourceText = `${article.originalTitle}\n\n${article.originalText}`;

  if (isLikelyPersian(sourceText)) {
    await prisma.article.update({
      where: { id: articleId },
      data: {
        translationStatus: "skipped",
        sourceLanguage: "fa",
        translatedTitleFa: article.originalTitle,
        translatedBodyFaMarkdown: content,
        translatedSummaryFa: article.originalExcerpt,
        translatedAt: new Date(),
        translationError: null
      }
    });
    await upsertArticleSearch(articleId);
    return;
  }

  const settings = await getSettings();
  if (!isTranslationProviderConfigured(settings.translationProvider)) {
    const message =
      settings.translationProvider === "metis"
        ? "METIS_API_KEY is not configured"
        : "Ollama translation provider is not configured";
    await prisma.article.update({
      where: { id: articleId },
      data: {
        translationStatus: "failed",
        translationError: message
      }
    });
    throw new Error(message);
  }

  await prisma.article.update({
    where: { id: articleId },
    data: {
      translationStatus: "processing",
      translationError: null,
      sourceLanguage: "en",
      targetLanguage: "fa"
    }
  });

  try {
    const chunks = chunkMarkdown(content);
    const translatedChunks: TranslationResponse[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      await prisma.article.update({
        where: { id: articleId },
        data: {
          translationProgressJson: JSON.stringify({
            chunk: index + 1,
            total: chunks.length,
            completed: translatedChunks.length
          })
        }
      });
      translatedChunks.push(
        await translateChunk(settings, {
          title: article.originalTitle,
          bodyMarkdown: chunks[index] ?? "",
          chunkIndex: chunks.length > 1 ? index : undefined,
          chunkCount: chunks.length > 1 ? chunks.length : undefined
        })
      );
    }
    const first = translatedChunks[0];
    if (!first) throw new Error("No translation chunks were produced");
    await prisma.article.update({
      where: { id: articleId },
      data: {
        translatedTitleFa: first.title_fa,
        translatedBodyFaMarkdown: translatedChunks.map((chunk) => chunk.body_fa_markdown).join("\n\n"),
        translatedSummaryFa: first.summary_fa,
        sourceLanguage: first.detected_source_language || "en",
        targetLanguage: "fa",
        translationStatus: "completed",
        translationError: null,
        translatedAt: new Date(),
        translationModel:
          settings.translationProvider === "ollama"
            ? `ollama:${settings.ollamaModel}`
            : `metis:${settings.deepseekModel}`,
        translationProgressJson: JSON.stringify({ completed: translatedChunks.length, total: chunks.length })
      }
    });
    await upsertArticleSearch(articleId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.article.update({
      where: { id: articleId },
      data: { translationStatus: "failed", translationError: message }
    });
    throw error;
  }
}

async function translateChunk(
  settings: Awaited<ReturnType<typeof getSettings>>,
  input: TranslationRequest
): Promise<TranslationResponse> {
  if (settings.translationProvider === "ollama") return translateWithOllama(input, { model: settings.ollamaModel });
  return translateWithMetisDeepSeek(input, { model: settings.deepseekModel });
}

export function chunkMarkdown(input: string, maxChars = maxChunkChars): string[] {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) return [normalized];
  const blocks = normalized.split(/\n(?=#{1,6}\s)|\n{2,}/g);
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (!block.trim()) continue;
    if (`${current}\n\n${block}`.length > maxChars && current) {
      chunks.push(current.trim());
      current = "";
    }
    if (block.length > maxChars) {
      const sentences = block.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) ?? [block];
      for (const sentence of sentences) {
        if (`${current} ${sentence}`.length > maxChars && current) {
          chunks.push(current.trim());
          current = "";
        }
        current += `${current ? " " : ""}${sentence.trim()}`;
      }
    } else {
      current += `${current ? "\n\n" : ""}${block.trim()}`;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
