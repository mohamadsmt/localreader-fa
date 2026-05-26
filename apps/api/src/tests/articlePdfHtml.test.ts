import { describe, expect, it } from "vitest";
import {
  buildArticlesPdfHtml,
  findChromeExecutablePath,
  type ArticlePdfRecord
} from "../services/export/articlePdf.js";

describe("article PDF HTML rendering", () => {
  it("keeps articles in the requested order", () => {
    const html = buildArticlesPdfHtml(
      [
        pdfArticle({ id: "a2", title: "Second", translatedTitleFa: "دوم" }),
        pdfArticle({ id: "a1", title: "First", translatedTitleFa: "اول" })
      ],
      "persian"
    );

    expect(html.indexOf("دوم")).toBeLessThan(html.indexOf("اول"));
  });

  it("renders Persian, English, and split modes with the expected body content", () => {
    const translated = pdfArticle({
      translatedBodyFaMarkdown: "## تیتر فارسی\n\nمتن فارسی",
      originalHtml: "<p>English body</p>"
    });

    const persian = buildArticlesPdfHtml([translated], "persian");
    expect(persian).toContain("تیتر فارسی");
    expect(persian).toContain("متن فارسی");
    expect(persian).not.toContain("English body");

    const english = buildArticlesPdfHtml([translated], "english");
    expect(english).toContain("English body");
    expect(english).not.toContain("متن فارسی");

    const split = buildArticlesPdfHtml([translated], "split");
    expect(split).toContain("متن فارسی");
    expect(split).toContain("English body");
  });

  it("falls back to original content when Persian translation is not ready", () => {
    const html = buildArticlesPdfHtml(
      [
        pdfArticle({
          translatedBodyFaMarkdown: null,
          originalHtml: "<p>Original fallback</p>"
        })
      ],
      "persian"
    );

    expect(html).toContain("ترجمه آماده نیست");
    expect(html).toContain("Original fallback");
  });

  it("drops remote images from printable article HTML", () => {
    const html = buildArticlesPdfHtml(
      [
        pdfArticle({
          originalHtml:
            '<p>Body</p><img src="https://example.com/remote.jpg" alt="Remote image"><script>alert(1)</script>'
        })
      ],
      "english"
    );

    expect(html).not.toContain("https://example.com/remote.jpg");
    expect(html).not.toContain("<script");
    expect(html).toContain("Remote image");
  });

  it("returns null when no Chrome executable candidate exists", () => {
    expect(findChromeExecutablePath("/definitely/missing/chrome", [])).toBeNull();
  });
});

function pdfArticle(overrides: Partial<ArticlePdfRecord> = {}): ArticlePdfRecord {
  const now = new Date("2026-05-26T10:00:00.000Z");
  const feed: ArticlePdfRecord["feed"] = {
    id: "f1",
    folderId: null,
    title: "Feed",
    siteUrl: "https://example.com",
    feedUrl: "https://example.com/rss.xml",
    faviconUrl: null,
    description: null,
    refreshIntervalMinutes: 60,
    fetchFullContent: true,
    isActive: true,
    lastCheckedAt: null,
    nextCheckAt: null,
    lastError: null,
    errorCount: 0,
    etag: null,
    lastModified: null,
    createdAt: now,
    updatedAt: now
  };
  return {
    id: "a1",
    feedId: feed.id,
    feed,
    guid: null,
    url: "https://example.com/article",
    canonicalUrl: null,
    urlHash: "hash",
    title: "Original title",
    originalTitle: "Original title",
    author: null,
    publishedAt: now,
    fetchedAt: now,
    updatedAt: now,
    originalHtml: "<p>Original body</p>",
    originalText: "Original body",
    originalExcerpt: "Original excerpt",
    originalImageUrl: null,
    originalImageLocalUrl: null,
    imageCacheStatus: "skipped",
    imageCacheError: null,
    imageCachedAt: null,
    rawFeedItemJson: null,
    translatedTitleFa: "عنوان فارسی",
    translatedBodyFaMarkdown: "متن فارسی",
    translatedSummaryFa: "خلاصه فارسی",
    sourceLanguage: "en",
    targetLanguage: "fa",
    translationStatus: "completed",
    translationError: null,
    translatedAt: now,
    translationModel: "test",
    translationProgressJson: null,
    isRead: false,
    isStarred: false,
    isArchived: false,
    isReadLater: false,
    readingProgress: 0,
    lastReadAt: null,
    tags: [],
    highlights: [],
    notes: [],
    ...overrides
  };
}
