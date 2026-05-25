import { env } from "../../config/env.js";
import { prisma } from "../../db.js";
import { enqueueJob } from "../jobs/jobs.js";

export interface EnqueueTranslationOptions {
  runAfter?: Date;
  markPending?: boolean;
  reason?: string;
}

export async function enqueueTranslationJob(
  articleId: string,
  options: EnqueueTranslationOptions = {}
): Promise<string> {
  if (options.markPending) {
    await prisma.article.updateMany({
      where: { id: articleId, translationStatus: { not: "skipped" } },
      data: {
        translationStatus: "pending",
        translationError: null,
        translationProgressJson: JSON.stringify({
          state: "queued",
          reason: options.reason ?? "translation queued",
          queuedAt: new Date().toISOString()
        })
      }
    });
  }

  return enqueueJob(
    "translate_article",
    { articleId },
    {
      runAfter: options.runAfter,
      maxAttempts: env.TRANSLATION_MAX_RETRIES
    }
  );
}
