import sanitizeHtml from "sanitize-html";

export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "figure",
      "figcaption",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "pre",
      "code",
      "blockquote"
    ]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      code: ["class"],
      pre: ["class"],
      "*": ["dir"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attribs) => {
        const href = safeHref(attribs.href);
        return {
          tagName: "a",
          attribs: href
            ? {
                ...attribs,
                href,
                target: "_blank",
                rel: "noopener noreferrer"
              }
            : {}
        };
      },
      script: () => ({ tagName: "span", attribs: {}, text: "" }),
      iframe: () => ({ tagName: "span", attribs: {}, text: "" })
    }
  }).trim();
}

function safeHref(value: string | undefined): string | null {
  const href = value?.trim();
  if (!href || /\s/.test(href)) return null;
  try {
    const parsed = new URL(href, "https://localreader.invalid");
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? href : null;
  } catch {
    return null;
  }
}

export function excerpt(text: string, maxLength = 260): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

export function normalizeMarkdown(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
