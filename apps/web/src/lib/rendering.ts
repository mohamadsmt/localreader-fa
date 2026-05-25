import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import { marked } from "marked";

export function renderMarkdown(markdown: string, loadImages = false): string {
  return filterRemoteImages(String(DOMPurify.sanitize(marked.parse(markdown, { async: false }), sanitizeOptions())), loadImages);
}

export function renderHtml(html: string, loadImages: boolean): string {
  const sanitized = String(DOMPurify.sanitize(html, sanitizeOptions()));
  return filterRemoteImages(sanitized, loadImages);
}

function filterRemoteImages(html: string, loadImages: boolean): string {
  if (loadImages) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const image of [...doc.querySelectorAll("img")]) {
    if (isLocalMediaUrl(image.getAttribute("src"))) continue;
    const placeholder = doc.createElement("span");
    placeholder.className = "image-placeholder";
    placeholder.textContent = image.getAttribute("alt") || "تصویر خارجی مسدود شده است";
    image.replaceWith(placeholder);
  }
  return doc.body.innerHTML;
}

function isLocalMediaUrl(value: string | null): boolean {
  return Boolean(value?.startsWith("/media/"));
}

function sanitizeOptions(): Config {
  return {
    ADD_ATTR: ["target", "rel", "dir"],
    FORBID_TAGS: ["script", "iframe", "object", "embed"],
    RETURN_TRUSTED_TYPE: false
  };
}
