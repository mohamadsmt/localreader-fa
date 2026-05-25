# LocalReader FA

LocalReader FA is a local-first bilingual RSS/Atom/JSON Feed reader for long-form reading. It stores original English content and Persian translations in a local SQLite database, supports RTL Persian rendering with self-hosted Vazirmatn, and uses a durable SQLite-backed worker queue for feed refresh, article extraction, translation, and search indexing.

## Features

- Add feeds by direct feed URL or website URL with RSS/Atom/JSON Feed discovery.
- Fetch and deduplicate articles using GUID, canonical URL, and normalized URL hashes.
- Conditional feed fetches with `ETag` and `Last-Modified`.
- Full-text extraction with Mozilla Readability and jsdom, with graceful feed-content fallback.
- Article images are downloaded into the local data directory and served back from `/media/` when possible.
- Background preparation is automatic while the backend is running: due feeds are refreshed, stale jobs are recovered, readable article text is extracted, images are cached locally, pending articles are translated, interrupted translations are requeued, and failed translations are retried after a delay.
- Translation through either Metis DeepSeek or local Ollama, selected with `TRANSLATION_PROVIDER`.
- Stores original title/body and Persian title/body/summary separately.
- Persian/English toggle in the reader, plus side-by-side mode.
- Light, dark, and sepia reading themes with a quick theme toggle.
- SQLite FTS5 search across English and Persian content, author, feed title, and tags.
- Local rules for read/star/archive/tag/skip-translation/translate-now/read-later actions.
- Highlights and notes for original and translated content.
- OPML import/export and full JSON backup export.
- Job dashboard for failed jobs and retries.
- No accounts, telemetry, or external analytics.

## Requirements

- Node.js 22 or newer
- pnpm 10 or newer

This repo was built and verified locally with Node `v24.11.0` and pnpm `10.33.3`.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm prisma:migrate
pnpm seed
pnpm dev
```

Then open:

- Frontend dev app: `http://localhost:5173`
- Backend API: `http://localhost:3333/api/health`

For production-style local serving:

```bash
pnpm build
pnpm start
```

The backend serves the built frontend from `apps/web/dist` on `APP_PORT`.

Leave `pnpm start` running if you want LocalReader FA to keep preparing articles in the background before you open the browser.

## Environment

`.env.example` documents all supported variables:

```bash
APP_PORT=3333
DATABASE_URL=file:./data/localreader.sqlite
METIS_API_KEY=
METIS_DEEPSEEK_BASE_URL=https://api.metisai.ir/api/v1/wrapper/deepseek
METIS_DEEPSEEK_MODEL=deepseek-v4-pro
TRANSLATION_PROVIDER=metis
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gpt-oss:20b
OLLAMA_REQUEST_TIMEOUT_MS=240000
OLLAMA_NUM_CTX=8192
TRANSLATION_CONCURRENCY=1
TRANSLATION_MAX_RETRIES=5
BACKGROUND_PREP_INTERVAL_MS=30000
STALE_JOB_TIMEOUT_MS=1800000
```

Put your real Metis key only in local `.env`. `.env` is ignored by git. The API key is never returned to the frontend; the UI only receives a boolean configured/not configured status.

For fully local translation, run Ollama and set:

```bash
TRANSLATION_PROVIDER=ollama
OLLAMA_MODEL=gpt-oss:20b
```

The recommended hosted Metis/DeepSeek model for Persian long-form translation is `deepseek-v4-pro`.

## Privacy

Everything is stored locally by default in SQLite under `./data`. The app has no telemetry and no analytics. Feed/article HTTP requests go to the feed/article sites you add. If `TRANSLATION_PROVIDER=metis`, translation requests send article title and body text to Metis/DeepSeek. If `TRANSLATION_PROVIDER=ollama`, translation runs against the local Ollama server configured in `.env`.

Remote images are blocked by default in the reader. You can enable them globally in settings or load them per article.
Images already cached locally are displayed even when remote images are blocked.

## Scripts

```bash
pnpm dev              # API + Vite frontend
pnpm build            # shared + api + web builds
pnpm start            # run built API and serve built frontend
pnpm test             # backend, frontend, shared tests
pnpm lint             # ESLint
pnpm typecheck        # strict TypeScript checks
pnpm prisma:migrate   # Prisma SQLite migration
pnpm seed             # seed sample local content
```

## Troubleshooting

- Missing `METIS_API_KEY`: Metis translation jobs fail with a clear error and can be retried after updating `.env`.
- Ollama not running: start Ollama, confirm `curl http://127.0.0.1:11434/api/tags`, then retry failed translation jobs.
- Translation failed: non-final translation errors retry automatically with exponential backoff up to `TRANSLATION_MAX_RETRIES`. After that, background preparation requeues failed article translations after a delay when auto-retry is enabled. You can also open Jobs and retry manually.
- Feed not valid: try the website URL instead of the feed URL so discovery can find alternate feeds. Failed feeds are shown in the app with the next retry time; retries use 5, 15, 30, 60, 180, then 360 minute intervals.
- Full-text extraction failed: the app keeps feed-provided summary/content and records the failed extraction job.
- Image caching failed: the article remains readable with remote images blocked by default; inspect the article `imageCacheError` field in the JSON backup or retry extraction/cache jobs.
- Background preparation seems idle: confirm `pnpm start` is running, check `/api/readiness`, and use the in-app `آماده‌سازی` button to queue missing work immediately.
- Reset database: stop the app, delete `./data/localreader.sqlite*`, then run `pnpm prisma:migrate && pnpm seed`.
- Search looks stale: use Settings -> rebuild search index.

## Backup And Restore

OPML import/export is implemented for subscriptions. JSON backup export includes feeds, folders, articles, translations, tags, notes, highlights, rules, saved searches, and settings. Full JSON restore is intentionally left as future work so merge/conflict behavior can be designed carefully.

## License

MIT License. See [LICENSE](./LICENSE).
