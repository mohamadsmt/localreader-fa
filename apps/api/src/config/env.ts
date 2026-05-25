import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

function findWorkspaceRoot(start: string): string {
  let current = start;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return resolve(start, "../..");
}

const workspaceRoot = findWorkspaceRoot(process.cwd());
loadDotenv({ path: resolve(workspaceRoot, ".env") });
loadDotenv({ path: resolve(process.cwd(), ".env"), override: false });

function normalizeSqliteUrl(value: string | undefined): { databaseUrl: string; databasePath: string } {
  const fallbackPath = resolve(workspaceRoot, "data/localreader.sqlite");
  if (!value) return { databaseUrl: `file:${fallbackPath}`, databasePath: fallbackPath };
  if (!value.startsWith("file:")) return { databaseUrl: value, databasePath: value };

  const filePath = value.slice("file:".length);
  if (filePath.startsWith("./data/")) {
    const absolute = resolve(workspaceRoot, filePath.slice(2));
    return { databaseUrl: `file:${absolute}`, databasePath: absolute };
  }
  if (isAbsolute(filePath)) return { databaseUrl: value, databasePath: filePath };
  const absolute = resolve(process.cwd(), filePath);
  return { databaseUrl: `file:${absolute}`, databasePath: absolute };
}

const database = normalizeSqliteUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = database.databaseUrl;
mkdirSync(dirname(database.databasePath), { recursive: true });

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z.string().min(1),
  LOCALREADER_DATA_DIR: z.string().default(resolve(workspaceRoot, "data")),
  METIS_API_KEY: z.string().optional(),
  METIS_DEEPSEEK_BASE_URL: z
    .string()
    .url()
    .default("https://api.metisai.ir/api/v1/wrapper/deepseek"),
  METIS_DEEPSEEK_MODEL: z.string().default("deepseek-v4-pro"),
  TRANSLATION_PROVIDER: z.enum(["metis", "ollama"]).default("metis"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("gpt-oss:20b"),
  OLLAMA_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(240000),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).max(131072).default(8192),
  TRANSLATION_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  TRANSLATION_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(5),
  FEED_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  ARTICLE_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(18000),
  ARTICLE_IMAGE_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  ARTICLE_IMAGE_MAX_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(8 * 1024 * 1024),
  ARTICLE_IMAGE_MAX_COUNT: z.coerce.number().int().min(1).max(60).default(20),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(30000).default(2000),
  BACKGROUND_PREP_INTERVAL_MS: z.coerce.number().int().min(5000).max(10 * 60 * 1000).default(30000),
  STALE_JOB_TIMEOUT_MS: z.coerce.number().int().min(60000).max(24 * 60 * 60 * 1000).default(30 * 60 * 1000),
  LOCALREADER_USER_AGENT: z
    .string()
    .default("LocalReader FA/1.0 (+https://localreader.fa; local-first RSS reader)")
});

export const env = envSchema.parse(process.env);
const dataDir = isAbsolute(env.LOCALREADER_DATA_DIR)
  ? env.LOCALREADER_DATA_DIR
  : resolve(workspaceRoot, env.LOCALREADER_DATA_DIR);
mkdirSync(dataDir, { recursive: true });
export const paths = {
  workspaceRoot,
  dataDir,
  databasePath: database.databasePath,
  mediaRoot: resolve(dataDir, "media"),
  webDist: resolve(workspaceRoot, "apps/web/dist")
};
mkdirSync(paths.mediaRoot, { recursive: true });

export function redactedEnvSummary(): Record<string, string | number | boolean> {
  return {
    nodeEnv: env.NODE_ENV,
    appPort: env.APP_PORT,
    databasePath: database.databasePath,
    translationProvider: env.TRANSLATION_PROVIDER,
    metisConfigured: Boolean(env.METIS_API_KEY),
    metisBaseUrl: env.METIS_DEEPSEEK_BASE_URL,
    metisModel: env.METIS_DEEPSEEK_MODEL,
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
    ollamaModel: env.OLLAMA_MODEL
  };
}

export function isTranslationProviderConfigured(provider = env.TRANSLATION_PROVIDER): boolean {
  if (provider === "metis") return Boolean(env.METIS_API_KEY);
  return Boolean(env.OLLAMA_BASE_URL && env.OLLAMA_MODEL);
}
