import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { rebuildArticleSearch } from "../../db.js";
import { cacheArticleImages } from "../article/imageCache.js";
import { runBackgroundPrep } from "../automation/backgroundPrep.js";
import { extractArticle, fetchFeed } from "../feed/ingest.js";
import { translateArticle } from "../translation/translateArticle.js";
import { claimNextJob, completeJob, failJob } from "./jobs.js";

export class WorkerLoop {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;
  private lastPrepAt = 0;

  start(): void {
    this.stopped = false;
    this.tick().catch((error) => logger.error({ error }, "worker tick failed"));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return this.schedule();
    this.running = true;
    let job: Awaited<ReturnType<typeof claimNextJob>> = null;
    try {
      await this.runPrepIfDue();
      job = await claimNextJob();
      if (!job) return;
      if (job.type === "fetch_feed") {
        if (!job.payload.feedId) throw new Error("fetch_feed job missing feedId");
        await fetchFeed(job.payload.feedId, Boolean(job.payload.force), {
          itemLimit: job.payload.itemLimit
        });
      } else if (job.type === "extract_article") {
        if (!job.payload.articleId) throw new Error("extract_article job missing articleId");
        await extractArticle(job.payload.articleId);
      } else if (job.type === "cache_images") {
        if (!job.payload.articleId) throw new Error("cache_images job missing articleId");
        await cacheArticleImages(job.payload.articleId);
      } else if (job.type === "translate_article") {
        if (!job.payload.articleId) throw new Error("translate_article job missing articleId");
        await translateArticle(job.payload.articleId);
      } else if (job.type === "rebuild_search") {
        await rebuildArticleSearch();
      }
      await completeJob(job.id);
    } catch (error) {
      if (job) {
        await failJob(job.id, error, job.type === "fetch_feed" ? job.maxAttempts : job.attempts, job.maxAttempts);
      }
      logger.error({ error }, "job failed");
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.tick().catch((error) => logger.error({ error }, "worker tick failed"));
    }, env.WORKER_POLL_INTERVAL_MS);
  }

  private async runPrepIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPrepAt < env.BACKGROUND_PREP_INTERVAL_MS) return;
    this.lastPrepAt = now;
    const summary = await runBackgroundPrep();
    const changed = Object.values(summary).some((value) => value > 0);
    if (changed) logger.info(summary, "background prep queued work");
  }
}
