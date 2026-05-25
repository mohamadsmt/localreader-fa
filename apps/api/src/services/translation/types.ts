export interface TranslationRequest {
  title: string;
  bodyMarkdown: string;
  chunkIndex?: number;
  chunkCount?: number;
}

export interface TranslationResponse {
  title_fa: string;
  body_fa_markdown: string;
  summary_fa: string;
  detected_source_language: string;
}

export function parseTranslationJson(content: string): TranslationResponse {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = parseJsonWithRepair(cleaned);
  if (
    typeof parsed.title_fa !== "string" ||
    typeof parsed.body_fa_markdown !== "string" ||
    typeof parsed.summary_fa !== "string" ||
    typeof parsed.detected_source_language !== "string"
  ) {
    throw new Error("Translation response JSON is missing required string fields");
  }
  return {
    title_fa: normalizePersianTranslationText(parsed.title_fa),
    body_fa_markdown: normalizePersianTranslationText(parsed.body_fa_markdown),
    summary_fa: normalizePersianTranslationText(parsed.summary_fa),
    detected_source_language: parsed.detected_source_language
  };
}

function parseJsonWithRepair(content: string): Partial<TranslationResponse> {
  try {
    return JSON.parse(content) as Partial<TranslationResponse>;
  } catch (error) {
    const repaired = content.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    try {
      return JSON.parse(repaired) as Partial<TranslationResponse>;
    } catch {
      throw error;
    }
  }
}

function normalizePersianTranslationText(input: string): string {
  return input
    .replace(/\\./g, (match) => ("[]()".includes(match[1] ?? "") ? (match[1] ?? "") : match))
    .replace(/([\u0600-\u06FF])\s*,/g, "$1،")
    .replace(/به فردا می‌بینمت(ان)?/g, "فردا می‌بینمتان")
    .replace(/برای بهتر و بدتر/g, "چه خوب چه بد")
    .replace(/برنامه‌زمانی/g, "زمان‌بندی");
}
