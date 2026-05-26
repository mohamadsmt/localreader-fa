import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Prisma } from "@prisma/client";
import type { ArticlePdfExportInput, ArticleViewMode } from "@localreader/shared";
import { marked } from "marked";
import { chromium } from "playwright-core";
import sanitizeHtml from "sanitize-html";
import { JSDOM } from "jsdom";
import { env, paths } from "../../config/env.js";
import { prisma } from "../../db.js";

const require = createRequire(import.meta.url);

const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium"
] as const;

const pdfMargin = {
  top: "18mm",
  right: "16mm",
  bottom: "18mm",
  left: "16mm"
} as const;

export class PdfBrowserUnavailableError extends Error {
  statusCode = 503;

  constructor() {
    super(
      "Chrome/Chromium برای ساخت PDF پیدا نشد. مسیر را با PDF_CHROME_EXECUTABLE_PATH تنظیم کنید."
    );
  }
}

export type ArticlePdfRecord = Prisma.ArticleGetPayload<{
  include: {
    feed: true;
    tags: { include: { tag: true } };
    highlights: true;
    notes: true;
  };
}>;

export async function createArticlesPdf(input: ArticlePdfExportInput): Promise<Buffer> {
  const articles = await prisma.article.findMany({
    where: { id: { in: input.articleIds } },
    include: {
      feed: true,
      tags: { include: { tag: true } },
      highlights: true,
      notes: true
    }
  });
  const byId = new Map(articles.map((article) => [article.id, article]));
  const orderedArticles = input.articleIds.map((id) => byId.get(id));
  if (orderedArticles.some((article) => !article)) {
    const error = new Error("Article not found") as Error & { statusCode: number };
    error.statusCode = 404;
    throw error;
  }
  return renderArticlesPdfHtml(
    buildArticlesPdfHtml(orderedArticles as ArticlePdfRecord[], input.viewMode)
  );
}

export async function renderArticlesPdfHtml(html: string): Promise<Buffer> {
  const executablePath = findChromeExecutablePath();
  if (!executablePath) throw new PdfBrowserUnavailableError();

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"]
  });
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ media: "print" });
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: pdfMargin
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export function findChromeExecutablePath(
  explicitPath = env.PDF_CHROME_EXECUTABLE_PATH,
  candidates: readonly string[] = chromeCandidates
): string | null {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function buildArticlesPdfHtml(
  articles: readonly ArticlePdfRecord[],
  viewMode: ArticleViewMode
): string {
  const fontFace = vazirmatnFontFace();
  const direction = viewMode === "english" ? "ltr" : "rtl";
  const lang = viewMode === "english" ? "en" : "fa";
  return `<!doctype html>
<html lang="${lang}" dir="${direction}">
<head>
  <meta charset="utf-8" />
  <title>LocalReader FA Articles</title>
  <style>
    ${fontFace}
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #181512;
      background: #fff;
      font-family: Vazirmatn, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.85;
    }
    a { color: #6c4a1f; text-decoration: none; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    h1, h2, h3 { line-height: 1.45; page-break-after: avoid; }
    h1 { margin: 0 0 10px; font-size: 26px; }
    h2 { margin: 24px 0 10px; font-size: 18px; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 12px; }
    blockquote { padding: 0 14px; border-inline-start: 3px solid #c59a57; color: #4c453d; }
    pre { white-space: pre-wrap; direction: ltr; background: #f5f2eb; padding: 12px; border-radius: 6px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd6cc; padding: 6px 8px; vertical-align: top; }
    .article { page-break-after: always; break-after: page; }
    .article:last-child { page-break-after: auto; break-after: auto; }
    .kicker { margin-bottom: 18px; color: #6f675e; font-size: 11px; }
    .source { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .source span:not(:last-child)::after { content: "·"; margin-inline-start: 8px; color: #a79b8d; }
    .lead-image { margin: 16px 0 18px; }
    .section-label { color: #8a672f; font-size: 12px; font-weight: 700; }
    .fallback { padding: 9px 12px; margin: 0 0 14px; border: 1px solid #e2d3bd; border-radius: 6px; background: #fbf6ed; color: #6b5636; }
    .split-divider { margin: 26px 0 20px; border: 0; border-top: 1px solid #ddd6cc; }
    .ltr { direction: ltr; text-align: left; font-family: Georgia, "Times New Roman", serif; }
    .rtl { direction: rtl; text-align: right; }
    .image-placeholder { display: inline-block; padding: 6px 8px; border: 1px solid #ddd6cc; border-radius: 6px; color: #6f675e; }
  </style>
</head>
<body>
  ${articles.map((article) => renderArticle(article, viewMode)).join("\n")}
</body>
</html>`;
}

function renderArticle(article: ArticlePdfRecord, viewMode: ArticleViewMode): string {
  const title = escapeHtml(displayPdfTitle(article, viewMode));
  const originalUrl = article.canonicalUrl ?? article.url;
  const leadImage = renderLeadImage(article.originalImageLocalUrl);
  return `<article class="article">
  <header>
    <h1 dir="${viewMode === "english" ? "ltr" : "rtl"}">${title}</h1>
    <div class="kicker">
      <div class="source">
        <span>${escapeHtml(article.feed.title)}</span>
        <span>${formatArticleDate(article.publishedAt ?? article.fetchedAt, viewMode)}</span>
        ${originalUrl ? `<span><a href="${escapeAttribute(originalUrl)}">${escapeHtml(originalUrl)}</a></span>` : ""}
      </div>
    </div>
  </header>
  ${leadImage}
  ${renderArticleContent(article, viewMode)}
</article>`;
}

function renderArticleContent(article: ArticlePdfRecord, viewMode: ArticleViewMode): string {
  if (viewMode === "persian") return renderPersianContent(article);
  if (viewMode === "english") return renderEnglishContent(article);
  return `${renderPersianContent(article)}
  <hr class="split-divider" />
  ${renderEnglishContent(article)}`;
}

function renderPersianContent(article: ArticlePdfRecord): string {
  if (article.translatedBodyFaMarkdown?.trim()) {
    return `<section class="rtl" dir="rtl">
      <div class="section-label">فارسی</div>
      ${sanitizeRichHtml(markdownToHtml(article.translatedBodyFaMarkdown))}
    </section>`;
  }
  return `<section class="rtl" dir="rtl">
    <p class="fallback">ترجمه آماده نیست؛ متن اصلی صادر شد.</p>
    ${renderEnglishBody(article)}
  </section>`;
}

function renderEnglishContent(article: ArticlePdfRecord): string {
  return `<section class="ltr" dir="ltr">
    <div class="section-label">English</div>
    ${renderEnglishBody(article)}
  </section>`;
}

function renderEnglishBody(article: ArticlePdfRecord): string {
  if (article.originalHtml?.trim()) return sanitizeRichHtml(article.originalHtml);
  return plainTextToHtml(article.originalText);
}

function markdownToHtml(markdown: string): string {
  return String(marked.parse(markdown, { async: false }));
}

function plainTextToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`).join("");
}

function sanitizeRichHtml(html: string): string {
  const sanitized = sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "blockquote",
      "pre",
      "code",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr"
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
      "*": ["dir"]
    },
    allowedSchemes: ["http", "https", "file", "data"],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          href: attribs.href ?? "#"
        }
      })
    }
  });
  return rewriteLocalImages(sanitized);
}

function rewriteLocalImages(html: string): string {
  const dom = new JSDOM(`<body>${html}</body>`);
  const document = dom.window.document;
  for (const image of [...document.querySelectorAll("img")]) {
    const src = image.getAttribute("src");
    const localPath = localMediaPath(src);
    if (!localPath) {
      const placeholder = document.createElement("span");
      placeholder.className = "image-placeholder";
      placeholder.textContent = image.getAttribute("alt") || "تصویر غیرمحلی در PDF وارد نشد.";
      image.replaceWith(placeholder);
      continue;
    }
    image.setAttribute("src", pathToFileURL(localPath).toString());
  }
  const output = document.body.innerHTML;
  dom.window.close();
  return output;
}

function renderLeadImage(src: string | null): string {
  const localPath = localMediaPath(src);
  if (!localPath) return "";
  const filename = basename(localPath);
  return `<div class="lead-image"><img src="${escapeAttribute(pathToFileURL(localPath).toString())}" alt="${escapeAttribute(filename)}" /></div>`;
}

function localMediaPath(src: string | null): string | null {
  if (!src?.startsWith("/media/")) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(src, "http://localreader.local").pathname);
  } catch {
    return null;
  }
  const relative = pathname.slice("/media/".length);
  const absolute = resolve(paths.mediaRoot, relative);
  if (absolute !== paths.mediaRoot && !absolute.startsWith(`${paths.mediaRoot}${sep}`)) return null;
  return existsSync(absolute) ? absolute : null;
}

function displayPdfTitle(article: ArticlePdfRecord, viewMode: ArticleViewMode): string {
  if (viewMode === "english") return article.originalTitle || article.title;
  return article.translatedTitleFa?.trim() || article.originalTitle || article.title;
}

function formatArticleDate(date: Date, viewMode: ArticleViewMode): string {
  const locale = viewMode === "english" ? "en-US" : "fa-IR";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function vazirmatnFontFace(): string {
  try {
    const fontPath = require.resolve(
      "@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2"
    );
    const font = readFileSync(fontPath).toString("base64");
    return `@font-face { font-family: Vazirmatn; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; font-style: normal; font-display: swap; }`;
  } catch {
    return "";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
