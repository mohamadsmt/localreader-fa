import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, calculateReadinessProgress, readinessText, type ReadinessStatus } from "./App.js";

const article = {
  id: "a1",
  feedId: "f1",
  feed: {
    id: "f1",
    title: "Feed",
    feedUrl: "https://example.com/feed",
    siteUrl: null,
    description: null,
    folderId: null,
    lastError: null,
    errorCount: 0,
    lastCheckedAt: null,
    nextCheckAt: null,
    refreshIntervalMinutes: 60,
    fetchFullContent: true,
    isActive: true
  },
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

const readyReadiness: ReadinessStatus = {
  isPreparing: false,
  readyUnreadCount: 1,
  unreadCount: 1,
  pendingJobs: 0,
  runningJobs: 0,
  failedJobs: 0,
  pendingTranslations: 0,
  processingTranslations: 0,
  failedTranslations: 0,
  pendingImageCaches: 0,
  feedsWithErrors: 0,
  nextFeedCheckAt: null,
  lastError: null
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App reader", () => {
  it("calculates queue progress for empty, partial, and active queues", () => {
    expect(
      calculateReadinessProgress({ ...readyReadiness, readyUnreadCount: 0, unreadCount: 0 })
    ).toEqual({
      total: 0,
      ready: 0,
      percent: 100,
      activeWork: 0
    });
    expect(
      calculateReadinessProgress({
        ...readyReadiness,
        readyUnreadCount: 5,
        unreadCount: 51,
        pendingJobs: 10,
        runningJobs: 1,
        pendingTranslations: 45,
        processingTranslations: 1,
        pendingImageCaches: 4
      })
    ).toEqual({ total: 51, ready: 5, percent: 10, activeWork: 61 });
    expect(
      readinessText(
        {
          ...readyReadiness,
          isPreparing: true,
          readyUnreadCount: 5,
          unreadCount: 51,
          pendingJobs: 10,
          runningJobs: 1,
          pendingTranslations: 45,
          processingTranslations: 1,
          pendingImageCaches: 4
        },
        "fallback"
      )
    ).toContain("۱۰٪");
  });

  it("renders Persian by default and toggles to English", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith("/api/settings"))
          return json({
            translationConfigured: true,
            databasePath: "db",
            translationEnabled: true,
            autoTranslateNewArticles: true,
            backgroundPrepEnabled: true,
            autoRetryFailedTranslations: true,
            translationConcurrency: 1,
            defaultRefreshIntervalMinutes: 60,
            fullTextExtractionEnabled: true,
            loadRemoteImages: false,
            theme: "light",
            fontSize: 18,
            readerWidth: 780,
            markReadDelaySeconds: 0,
            markReadScrollThreshold: 0.75,
            translationProvider: "ollama",
            ollamaModel: "gpt-oss:20b",
            deepseekModel: "deepseek-v4-pro"
          });
        if (url.startsWith("/api/readiness")) return json(readyReadiness);
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
    expect(
      await screen.findByRole("progressbar", { name: "پیشرفت آماده‌سازی صف" })
    ).toHaveAttribute("aria-valuenow", "100");
    fireEvent.click(await screen.findByTestId("language-toggle"));
    await waitFor(() => expect(screen.getAllByText("Original title").length).toBeGreaterThan(0));
  });

  it("shows prepare-now busy state while the request is running", async () => {
    let resolvePrepare: (response: Response) => void = () => {};
    const preparePromise = new Promise<Response>((resolve) => {
      resolvePrepare = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith("/api/settings"))
          return json({
            translationConfigured: true,
            databasePath: "db",
            translationEnabled: true,
            autoTranslateNewArticles: true,
            backgroundPrepEnabled: true,
            autoRetryFailedTranslations: true,
            translationConcurrency: 1,
            defaultRefreshIntervalMinutes: 60,
            fullTextExtractionEnabled: true,
            loadRemoteImages: false,
            theme: "light",
            fontSize: 18,
            readerWidth: 780,
            markReadDelaySeconds: 0,
            markReadScrollThreshold: 0.75,
            translationProvider: "ollama",
            ollamaModel: "gpt-oss:20b",
            deepseekModel: "deepseek-v4-pro"
          });
        if (url.startsWith("/api/readiness"))
          return json({
            ...readyReadiness,
            isPreparing: true,
            readyUnreadCount: 5,
            unreadCount: 51,
            pendingJobs: 10,
            runningJobs: 1,
            pendingTranslations: 45,
            processingTranslations: 1,
            pendingImageCaches: 4
          });
        if (url.startsWith("/api/prepare-now")) return preparePromise;
        if (url.startsWith("/api/feeds")) return json([]);
        if (url.startsWith("/api/folders")) return json([]);
        if (url.startsWith("/api/tags")) return json([]);
        if (url.startsWith("/api/articles/a1")) return json(article);
        if (url.startsWith("/api/articles")) return json({ items: [article], total: 1 });
        return json({});
      })
    );
    render(<App />);
    const prepareButton = await screen.findByRole("button", { name: "آماده‌سازی" });
    fireEvent.click(prepareButton);
    await waitFor(() => expect(prepareButton).toBeDisabled());
    expect(prepareButton).toHaveAttribute("aria-busy", "true");
    resolvePrepare(json({ readiness: readyReadiness }));
    await waitFor(() => expect(prepareButton).not.toBeDisabled());
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
