import { describe, expect, it } from "vitest";
import { isLikelyPersian, languageDirection, nextLanguageMode } from "./index.js";

describe("language helpers", () => {
  it("detects Persian content and direction", () => {
    expect(isLikelyPersian("این یک متن فارسی برای خواندن است")).toBe(true);
    expect(languageDirection("fa")).toBe("rtl");
    expect(languageDirection("en")).toBe("ltr");
  });

  it("toggles between Persian and English reader modes", () => {
    expect(nextLanguageMode("persian")).toBe("english");
    expect(nextLanguageMode("english")).toBe("persian");
    expect(nextLanguageMode("split")).toBe("persian");
  });
});
