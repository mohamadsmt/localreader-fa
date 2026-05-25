import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  App,
  buildReaderSelectionState,
  calculateReadinessProgress,
  calculateSelectionToolbarPosition,
  detectSelectionLanguage,
  readinessText,
  type ReadinessStatus
} from "./App.js";

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

const baseSettings = {
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

  it("builds reader selection state only for text inside article prose", () => {
    const pane = document.createElement("section");
    Object.defineProperty(pane, "clientWidth", { configurable: true, value: 420 });
    Object.defineProperty(pane, "scrollTop", { configurable: true, value: 20 });
    Object.defineProperty(pane, "scrollLeft", { configurable: true, value: 0 });
    pane.getBoundingClientRect = () => rect({ left: 10, top: 20, width: 420, height: 600 });
    const proseFa = document.createElement("div");
    proseFa.className = "article-prose article-prose-fa";
    proseFa.dir = "rtl";
    proseFa.textContent = "متن فارسی برای تست";
    pane.append(proseFa);
    document.body.append(pane);
    const range = fakeRange(proseFa, rect({ left: 90, top: 120, width: 80, height: 20 }));

    expect(
      buildReaderSelectionState(
        fakeSelection({ quote: "متن فارسی", range, node: proseFa }),
        pane,
        "a1"
      )
    ).toMatchObject({
      articleId: "a1",
      quote: "متن فارسی",
      language: "fa"
    });
    expect(
      buildReaderSelectionState(
        fakeSelection({ quote: "", range, node: proseFa, isCollapsed: true }),
        pane,
        "a1"
      )
    ).toBeNull();

    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.append(outside);
    expect(
      buildReaderSelectionState(
        fakeSelection({
          quote: "outside",
          range: fakeRange(outside, rect({ left: 0, top: 0 })),
          node: outside
        }),
        pane,
        "a1"
      )
    ).toBeNull();
    expect(detectSelectionLanguage(proseFa)).toBe("fa");
    const proseEn = document.createElement("div");
    proseEn.className = "article-prose ltr-content";
    proseEn.dir = "ltr";
    expect(detectSelectionLanguage(proseEn)).toBe("en");
    expect(
      calculateSelectionToolbarPosition(
        rect({ left: 0, top: 5, width: 10, height: 10 }),
        rect({ left: 0, top: 0 }),
        { scrollTop: 0, scrollLeft: 0, clientWidth: 120 }
      )
    ).toEqual({ top: 48, left: 74 });
    pane.remove();
    outside.remove();
  });

  it("renders Persian by default and toggles to English", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith("/api/settings")) return json(baseSettings);
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

  it("applies the persisted dark theme from settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith("/api/settings")) return json({ ...baseSettings, theme: "dark" });
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
    expect(await screen.findByTestId("app-shell")).toHaveClass("theme-dark");
  });

  it("persists quick dark theme changes from the topbar", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("/api/settings") && init?.method === "PATCH") {
        const patch = JSON.parse(requestBodyText(init.body)) as Record<string, unknown>;
        return json({ ...baseSettings, ...patch });
      }
      if (url.startsWith("/api/settings")) return json(baseSettings);
      if (url.startsWith("/api/readiness")) return json(readyReadiness);
      if (url.startsWith("/api/feeds")) return json([]);
      if (url.startsWith("/api/folders")) return json([]);
      if (url.startsWith("/api/tags")) return json([]);
      if (url.startsWith("/api/articles/a1")) return json(article);
      if (url.startsWith("/api/articles")) return json({ items: [article], total: 1 });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "تم تاریک" }));
    await waitFor(() => expect(screen.getByTestId("app-shell")).toHaveClass("theme-dark"));
    const settingsPatch = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/settings" && init?.method === "PATCH"
    );
    expect(settingsPatch).toBeDefined();
    if (!settingsPatch) throw new Error("settings PATCH was not called");
    expect(JSON.parse(requestBodyText(settingsPatch[1]?.body))).toEqual({ theme: "dark" });
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
        if (url.startsWith("/api/settings")) return json(baseSettings);
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

  it("saves highlights from the floating toolbar using the captured quote", async () => {
    const removeAllRanges = vi.fn();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("/api/highlights") && init?.method === "POST") {
        return json({
          id: "h1",
          articleId: "a1",
          quote: "متن فارسی",
          language: "fa",
          note: null,
          createdAt: new Date().toISOString()
        });
      }
      if (url.startsWith("/api/settings")) return json(baseSettings);
      if (url.startsWith("/api/readiness")) return json(readyReadiness);
      if (url.startsWith("/api/feeds")) return json([]);
      if (url.startsWith("/api/folders")) return json([]);
      if (url.startsWith("/api/tags")) return json([]);
      if (url.startsWith("/api/articles/a1")) return json(article);
      if (url.startsWith("/api/articles")) return json({ items: [article], total: 1 });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    render(<App />);
    await screen.findByText("عنوان فارسی");
    await screen.findByText("متن فارسی");
    const readerPane = document.querySelector<HTMLElement>(".reader-pane");
    const prose = readerPane?.querySelector<HTMLElement>(".article-prose-fa") ?? null;
    if (!prose || !readerPane) throw new Error("reader prose was not rendered");
    Object.defineProperty(readerPane, "clientWidth", { configurable: true, value: 780 });
    readerPane.getBoundingClientRect = () => rect({ left: 0, top: 0, width: 780, height: 700 });
    const selection = fakeSelection({
      quote: "متن فارسی",
      range: fakeRange(prose, rect({ left: 180, top: 240, width: 120, height: 22 })),
      node: prose,
      removeAllRanges
    });
    vi.spyOn(window, "getSelection").mockReturnValue(selection);

    fireEvent.mouseUp(readerPane);

    const toolbarButton = await screen.findByRole("button", { name: "هایلایت" });
    expect(screen.getByRole("toolbar", { name: "ابزار هایلایت متن انتخاب‌شده" })).toBeVisible();
    vi.spyOn(window, "getSelection").mockReturnValue(
      fakeSelection({
        quote: "",
        range: fakeRange(prose, rect({ left: 0, top: 0 })),
        node: prose,
        isCollapsed: true,
        removeAllRanges
      })
    );
    fireEvent.mouseDown(toolbarButton);
    fireEvent.click(toolbarButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/highlights",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ articleId: "a1", quote: "متن فارسی", language: "fa" })
        })
      )
    );
    expect(removeAllRanges).toHaveBeenCalled();
  });

  it("requires exact feed title before unsubscribing and shows busy state", async () => {
    let deleted = false;
    let resolveDelete: (response: Response) => void = () => {};
    const feed = { ...article.feed, _count: { articles: 3 } };
    const deletePromise = new Promise<Response>((resolve) => {
      resolveDelete = (response) => {
        deleted = true;
        resolve(response);
      };
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("/api/feeds/f1") && init?.method === "DELETE") return deletePromise;
      if (url.startsWith("/api/settings")) return json(baseSettings);
      if (url.startsWith("/api/readiness")) return json(readyReadiness);
      if (url.startsWith("/api/feeds")) return json(deleted ? [] : [feed]);
      if (url.startsWith("/api/folders")) return json([]);
      if (url.startsWith("/api/tags")) return json([]);
      if (url.startsWith("/api/articles/a1")) return json(article);
      if (url.startsWith("/api/articles")) return json({ items: [article], total: 1 });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "فیدها" }));
    expect(await screen.findByText("مدیریت فیدها")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "حذف فید Feed" }));

    const confirmButton = await screen.findByRole("button", { name: "حذف اشتراک" });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Feed"), { target: { value: "feed" } });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Feed"), { target: { value: "Feed" } });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(confirmButton).toHaveAttribute("aria-busy", "true");
    resolveDelete(json({ ok: true, subscriptionRemoved: true, articlesPreserved: 3 }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "حذف فید" })).not.toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/feeds/f1",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirmTitle: "Feed" })
      })
    );
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function requestBodyText(body: BodyInit | null | undefined): string {
  if (typeof body === "string") return body;
  throw new Error("expected request body to be a string");
}

function rect(overrides: Partial<DOMRect> = {}): DOMRect {
  const left = overrides.left ?? 0;
  const top = overrides.top ?? 0;
  const width = overrides.width ?? 20;
  const height = overrides.height ?? 20;
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: overrides.right ?? left + width,
    bottom: overrides.bottom ?? top + height,
    toJSON: () => ({})
  };
}

function fakeRange(node: Node, rangeRect: DOMRect): Range {
  return {
    commonAncestorContainer: node,
    getClientRects: () => [rangeRect] as unknown as DOMRectList,
    getBoundingClientRect: () => rangeRect
  } as Range;
}

function fakeSelection(input: {
  quote: string;
  range: Range;
  node: Node;
  isCollapsed?: boolean;
  removeAllRanges?: () => void;
}): Selection {
  return {
    anchorNode: input.node,
    focusNode: input.node,
    rangeCount: 1,
    isCollapsed: input.isCollapsed ?? false,
    toString: () => input.quote,
    getRangeAt: () => input.range,
    removeAllRanges: input.removeAllRanges ?? vi.fn()
  } as unknown as Selection;
}
