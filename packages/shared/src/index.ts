import { z } from "zod";

export const translationStatuses = ["pending", "processing", "completed", "failed", "skipped"] as const;
export const jobStatuses = ["pending", "running", "completed", "failed"] as const;
export const jobTypes = ["fetch_feed", "extract_article", "cache_images", "translate_article", "rebuild_search"] as const;
export const articleViewModes = ["english", "persian", "split"] as const;
export const themes = ["light", "dark", "sepia"] as const;
export const translationProviders = ["metis", "ollama"] as const;

export type TranslationStatus = (typeof translationStatuses)[number];
export type JobStatus = (typeof jobStatuses)[number];
export type JobType = (typeof jobTypes)[number];
export type ArticleViewMode = (typeof articleViewModes)[number];
export type ThemeName = (typeof themes)[number];
export type TranslationProvider = (typeof translationProviders)[number];

export const feedCreateSchema = z.object({
  url: z.string().url(),
  folderId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  refreshIntervalMinutes: z.number().int().min(5).max(10080).optional(),
  fetchFullContent: z.boolean().optional()
});

export const feedPatchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  folderId: z.string().nullable().optional(),
  refreshIntervalMinutes: z.number().int().min(5).max(10080).optional(),
  fetchFullContent: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export const articlePatchSchema = z.object({
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isReadLater: z.boolean().optional(),
  readingProgress: z.number().min(0).max(1).optional(),
  lastReadAt: z.string().datetime().nullable().optional()
});

export const articleQuerySchema = z.object({
  q: z.string().optional(),
  unread: z.coerce.boolean().optional(),
  starred: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  readLater: z.coerce.boolean().optional(),
  failedTranslation: z.coerce.boolean().optional(),
  untranslated: z.coerce.boolean().optional(),
  feedId: z.string().optional(),
  folderId: z.string().optional(),
  tag: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(["newest", "oldest", "feed", "unread_first"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().max(32).nullable().optional()
});

export const ruleConditionSchema = z.object({
  field: z.enum(["title", "body", "author", "feed", "url", "category"]),
  operator: z.literal("contains"),
  value: z.string().trim().min(1)
});

export const ruleActionSchema = z.object({
  type: z.enum([
    "mark_read",
    "star",
    "archive",
    "add_tag",
    "skip_translation",
    "translate_immediately",
    "read_later"
  ]),
  value: z.string().trim().optional()
});

export const ruleCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  isEnabled: z.boolean().default(true),
  conditions: z.array(ruleConditionSchema).min(1),
  actions: z.array(ruleActionSchema).min(1)
});

export const rulePatchSchema = ruleCreateSchema.partial();

export const highlightCreateSchema = z.object({
  articleId: z.string(),
  quote: z.string().trim().min(1),
  language: z.enum(["en", "fa"]),
  note: z.string().trim().nullable().optional()
});

export const noteCreateSchema = z.object({
  articleId: z.string(),
  highlightId: z.string().nullable().optional(),
  body: z.string().trim().min(1)
});

export const savedSearchCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  queryJson: z.record(z.string(), z.unknown())
});

export const settingsPatchSchema = z.object({
  translationEnabled: z.boolean().optional(),
  autoTranslateNewArticles: z.boolean().optional(),
  backgroundPrepEnabled: z.boolean().optional(),
  autoRetryFailedTranslations: z.boolean().optional(),
  translationConcurrency: z.number().int().min(1).max(4).optional(),
  defaultRefreshIntervalMinutes: z.number().int().min(5).max(10080).optional(),
  fullTextExtractionEnabled: z.boolean().optional(),
  loadRemoteImages: z.boolean().optional(),
  theme: z.enum(themes).optional(),
  fontSize: z.number().int().min(15).max(24).optional(),
  readerWidth: z.number().int().min(640).max(980).optional(),
  markReadDelaySeconds: z.number().int().min(0).max(120).optional(),
  markReadScrollThreshold: z.number().min(0).max(1).optional(),
  translationProvider: z.enum(translationProviders).optional(),
  ollamaModel: z.string().trim().min(1).max(120).optional(),
  deepseekModel: z.string().trim().min(1).max(120).optional()
});

export type FeedCreateInput = z.infer<typeof feedCreateSchema>;
export type ArticlePatchInput = z.infer<typeof articlePatchSchema>;
export type ArticleQuery = z.infer<typeof articleQuerySchema>;
export type RuleCreateInput = z.infer<typeof ruleCreateSchema>;
export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;

export interface ApiSettings {
  translationEnabled: boolean;
  autoTranslateNewArticles: boolean;
  backgroundPrepEnabled: boolean;
  autoRetryFailedTranslations: boolean;
  translationConcurrency: number;
  defaultRefreshIntervalMinutes: number;
  fullTextExtractionEnabled: boolean;
  loadRemoteImages: boolean;
  theme: ThemeName;
  fontSize: number;
  readerWidth: number;
  markReadDelaySeconds: number;
  markReadScrollThreshold: number;
  translationProvider: TranslationProvider;
  ollamaModel: string;
  deepseekModel: string;
  translationConfigured: boolean;
  databasePath: string;
}

export function isLikelyPersian(input: string): boolean {
  const persianMatches = input.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const latinMatches = input.match(/[A-Za-z]/g)?.length ?? 0;
  return persianMatches >= 8 && persianMatches > latinMatches * 0.35;
}

export function languageDirection(language: string | null | undefined): "rtl" | "ltr" {
  return language === "fa" || language === "fa-IR" ? "rtl" : "ltr";
}

export function nextLanguageMode(mode: ArticleViewMode): ArticleViewMode {
  if (mode === "persian") return "english";
  if (mode === "english") return "persian";
  return "persian";
}
