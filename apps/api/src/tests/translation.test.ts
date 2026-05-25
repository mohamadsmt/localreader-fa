import { describe, expect, it } from "vitest";
import { parseTranslationJson } from "../services/translation/metisDeepseekClient.js";
import { chunkMarkdown } from "../services/translation/translateArticle.js";
import { sanitizeArticleHtml } from "../utils/text.js";

describe("translation helpers", () => {
  it("parses strict JSON responses", () => {
    const parsed = parseTranslationJson(
      '{"title_fa":"عنوان","body_fa_markdown":"متن","summary_fa":"خلاصه","detected_source_language":"en"}'
    );
    expect(parsed.title_fa).toBe("عنوان");
  });

  it("rejects incomplete JSON", () => {
    expect(() => parseTranslationJson('{"title_fa":"عنوان"}')).toThrow(/missing/);
  });

  it("repairs invalid markdown escapes inside otherwise strict JSON", () => {
    const parsed = parseTranslationJson(
      '{"title_fa":"عنوان","body_fa_markdown":"این تغییر \\[از آموزش به استنتاج\\] مهم است.","summary_fa":"خلاصه","detected_source_language":"en"}'
    );
    expect(parsed.body_fa_markdown).toContain("[از آموزش به استنتاج]");
  });

  it("still rejects unrecoverable malformed JSON", () => {
    expect(() =>
      parseTranslationJson(
        '{"title_fa":"عنوان","body_fa_markdown":"متن","summary_fa":"خلاصه","detected_source_language":'
      )
    ).toThrow();
  });

  it("normalizes common Persian typography and literal phrasing issues", () => {
    const parsed = parseTranslationJson(
      '{"title_fa":"عنوان","body_fa_markdown":"صبح بخیر,\\\\n\\\\nبه فردا می‌بینمت.","summary_fa":"برای بهتر و بدتر","detected_source_language":"en"}'
    );
    expect(parsed.body_fa_markdown).toContain("صبح بخیر،");
    expect(parsed.body_fa_markdown).toContain("فردا می‌بینمتان.");
    expect(parsed.summary_fa).toBe("چه خوب چه بد");
  });

  it("chunks long markdown by paragraphs", () => {
    const chunks = chunkMarkdown(
      ["# H", "a".repeat(40), "b".repeat(40), "c".repeat(40)].join("\n\n"),
      60
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n")).toContain("# H");
  });

  it("strips malformed source links before markdown translation", () => {
    const sanitized = sanitizeArticleHtml(
      '<p>On <a href="http://Scheduled 4/30 4AM Central">today’s episode</a> we discuss markets.</p>'
    );
    expect(sanitized).toContain("today’s episode");
    expect(sanitized).not.toContain("href=");
    expect(sanitized).not.toContain("Scheduled 4/30");
  });
});
