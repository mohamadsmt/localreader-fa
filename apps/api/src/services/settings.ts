import type { ApiSettings, SettingsPatchInput } from "@localreader/shared";
import { env, isTranslationProviderConfigured, paths } from "../config/env.js";
import { prisma } from "../db.js";

const defaults: Omit<ApiSettings, "translationConfigured" | "databasePath"> = {
  translationEnabled: true,
  autoTranslateNewArticles: true,
  backgroundPrepEnabled: true,
  autoRetryFailedTranslations: true,
  translationConcurrency: env.TRANSLATION_CONCURRENCY,
  defaultRefreshIntervalMinutes: 60,
  fullTextExtractionEnabled: true,
  loadRemoteImages: false,
  theme: "light",
  fontSize: 18,
  readerWidth: 780,
  markReadDelaySeconds: 8,
  markReadScrollThreshold: 0.75,
  translationProvider: env.TRANSLATION_PROVIDER,
  ollamaModel: env.OLLAMA_MODEL,
  deepseekModel: env.METIS_DEEPSEEK_MODEL
};

export async function getSettings(): Promise<ApiSettings> {
  const rows = await prisma.setting.findMany();
  const values = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.valueJson)]));
  const merged = {
    ...defaults,
    ...values
  };
  return {
    ...merged,
    translationConfigured: isTranslationProviderConfigured(merged.translationProvider),
    databasePath: paths.databasePath
  };
}

export async function patchSettings(input: SettingsPatchInput): Promise<ApiSettings> {
  for (const [key, value] of Object.entries(input)) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, valueJson: JSON.stringify(value) },
      update: { valueJson: JSON.stringify(value) }
    });
  }
  return getSettings();
}
