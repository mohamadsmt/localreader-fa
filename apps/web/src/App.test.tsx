import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const article = {
  id: "a1",
  feedId: "f1",
  feed: { id: "f1", title: "Feed", feedUrl: "https://example.com/feed", siteUrl: null, description: null, folderId: null, lastError: null, errorCount: 0, lastCheckedAt: null, nextCheckAt: null, refreshIntervalMinutes: 60, fetchFullContent: true, isActive: true },
  title: "Original title",
  originalTitle: "Original title",
  author: null,
  publishedAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(),
  originalExcerpt: "Original excerpt",
  originalImageUrl: null,
  originalImageLocalUrl: null,
  imageCacheStatus: "skipped",
  imageCacheError: null,
  translatedTitleFa: "عنوان فارسی",
  translatedSummaryFa: "خلاصه فارسی",
  sourceLanguage: "en",
  isRead: false,
  isStarred: false,
  isArchived: false,
  isReadLater: false,
  readingProgress: 0,
  translationStatus: "completed",
  translationError: null,
  tags: [],
  url: null,
  canonicalUrl: null,
  originalHtml: "<p>Original body</p>",
  originalText: "Original body",
  translatedBodyFaMarkdown: "متن فارسی",
  translatedAt: null,
  translationModel: null,
  highlights: [],
  notes: []
};

describe("App reader", () => {
  it("renders Persian by default and toggles to English", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith("/api/settings")) return json({ translationConfigured: true, databasePath: "db", translationEnabled: true, autoTranslateNewArticles: true, backgroundPrepEnabled: true, autoRetryFailedTranslations: true, translationConcurrency: 1, defaultRefreshIntervalMinutes: 60, fullTextExtractionEnabled: true, loadRemoteImages: false, theme: "light", fontSize: 18, readerWidth: 780, markReadDelaySeconds: 0, markReadScrollThreshold: 0.75, translationProvider: "ollama", ollamaModel: "gpt-oss:20b", deepseekModel: "deepseek-v4-pro" });
        if (url.startsWith("/api/readiness")) return json({ isPreparing: false, readyUnreadCount: 1, unreadCount: 1, pendingJobs: 0, runningJobs: 0, failedJobs: 0, pendingTranslations: 0, processingTranslations: 0, failedTranslations: 0, pendingImageCaches: 0, feedsWithErrors: 0, nextFeedCheckAt: null, lastError: null });
        if (url.startsWith("/api/feeds")) return json([]);
        if (url.startsWith("/api/folders")) return json([]);
        if (url.startsWith("/api/tags")) return json([]);
        if (url.startsWith("/api/articles/a1")) return json(article);
        if (url.startsWith("/api/articles")) return json({ items: [article], total: 1 });
        return json({});
      })
    );
    render(<App />);
    expect(await screen.findByText("عنوان فارسی")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("language-toggle"));
    await waitFor(() => expect(screen.getAllByText("Original title").length).toBeGreaterThan(0));
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
