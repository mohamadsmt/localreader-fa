import type { TranslationRequest } from "./types.js";

export function buildTranslationMessages(input: TranslationRequest): Array<{ role: "system" | "user"; content: string }> {
  const system = [
    "You are a careful English-to-Persian translator for a local RSS reader.",
    "Return valid json only. Do not include markdown fences outside json.",
    "Translate to natural, fluent, idiomatic Persian. Avoid literal English calques and awkward word-for-word phrasing.",
    "Preserve facts, names, companies, products, APIs, code identifiers, URLs, tickers, dates, numbers, and units.",
    "Preserve headings, lists, code blocks, blockquotes, links, and tables as much as possible.",
    "For technical/product/finance terms, keep common English terms in parentheses where useful in Persian tech writing.",
    "Do not invent facts, explanations, or context.",
    "Style examples: translate 'Good morning,' as 'صبح بخیر،'; translate 'See you tomorrow.' as 'فردا می‌بینمتان.'; translate 'for better and for worse' as 'چه خوب چه بد'.",
    "Example json: {\"title_fa\":\"عنوان فارسی\",\"body_fa_markdown\":\"متن فارسی\",\"summary_fa\":\"خلاصه فارسی\",\"detected_source_language\":\"en\"}"
  ].join("\n");
  const chunkLabel =
    input.chunkIndex !== undefined && input.chunkCount
      ? `Chunk ${input.chunkIndex + 1} of ${input.chunkCount}. Translate only this chunk but keep json output.`
      : "Translate the article.";
  const user = [
    `${chunkLabel} Output valid json only using these exact keys: title_fa, body_fa_markdown, summary_fa, detected_source_language.`,
    "Use polished Persian suitable for long-form reading. Prefer clear Persian phrasing over literal translation.",
    "Do not invent facts.",
    "",
    `Title: ${input.title}`,
    "",
    "Markdown body:",
    input.bodyMarkdown
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}
