import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, JSX, SetStateAction } from "react";
import {
  Archive,
  BookOpen,
  Briefcase,
  Check,
  Clock3,
  Download,
  FileText,
  Folder,
  Globe2,
  Highlighter,
  Inbox,
  Languages,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Star,
  Upload,
  Zap
} from "lucide-react";
import type {
  ApiSettings,
  ArticleViewMode,
  ThemeName,
  TranslationProvider
} from "@localreader/shared";
import { nextLanguageMode } from "@localreader/shared";
import { api, downloadUrl } from "./lib/api.js";
import { renderHtml, renderMarkdown } from "./lib/rendering.js";

type Page = "reader" | "feeds" | "rules" | "search" | "highlights" | "jobs" | "settings";
type FilterKey =
  | "all"
  | "unread"
  | "starred"
  | "readLater"
  | "archived"
  | "failed"
  | "untranslated";

interface FolderRecord {
  id: string;
  name: string;
  feeds?: Feed[];
}

interface Feed {
  id: string;
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  description: string | null;
  folderId: string | null;
  folder?: FolderRecord | null;
  lastError: string | null;
  errorCount: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  refreshIntervalMinutes: number;
  fetchFullContent: boolean;
  isActive: boolean;
  _count?: { articles: number };
}

interface Tag {
  id: string;
  name: string;
  color: string | null;
}

interface ArticleListItem {
  id: string;
  feedId: string;
  feed: Feed;
  title: string;
  originalTitle: string;
  author: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  originalExcerpt: string | null;
  originalImageUrl: string | null;
  originalImageLocalUrl: string | null;
  imageCacheStatus: string;
  imageCacheError: string | null;
  translatedTitleFa: string | null;
  translatedSummaryFa: string | null;
  sourceLanguage: string | null;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isReadLater: boolean;
  readingProgress: number;
  translationStatus: string;
  translationError: string | null;
  tags: Array<{ tag: Tag }>;
}

interface Highlight {
  id: string;
  articleId: string;
  quote: string;
  language: "en" | "fa";
  note: string | null;
  createdAt: string;
  article?: ArticleListItem;
}

interface Note {
  id: string;
  articleId: string;
  highlightId: string | null;
  body: string;
  createdAt: string;
}

interface ArticleDetail extends ArticleListItem {
  url: string | null;
  canonicalUrl: string | null;
  originalHtml: string | null;
  originalText: string;
  translatedBodyFaMarkdown: string | null;
  translatedAt: string | null;
  translationModel: string | null;
  highlights: Highlight[];
  notes: Note[];
}

interface ArticleResponse {
  items: ArticleListItem[];
  total: number;
}

interface Job {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  payloadJson: string;
  lastError: string | null;
  createdAt: string;
  runAfter: string;
}

interface RuleRecord {
  id: string;
  name: string;
  isEnabled: boolean;
  conditionsJson: string;
  actionsJson: string;
}

interface ReadinessStatus {
  isPreparing: boolean;
  readyUnreadCount: number;
  unreadCount: number;
  pendingJobs: number;
  runningJobs: number;
  failedJobs: number;
  pendingTranslations: number;
  processingTranslations: number;
  failedTranslations: number;
  pendingImageCaches: number;
  feedsWithErrors: number;
  nextFeedCheckAt: string | null;
  lastError: string | null;
}

const defaultSettings: ApiSettings = {
  translationEnabled: true,
  autoTranslateNewArticles: true,
  backgroundPrepEnabled: true,
  autoRetryFailedTranslations: true,
  translationConcurrency: 1,
  defaultRefreshIntervalMinutes: 60,
  fullTextExtractionEnabled: true,
  loadRemoteImages: false,
  theme: "light",
  fontSize: 18,
  readerWidth: 780,
  markReadDelaySeconds: 8,
  markReadScrollThreshold: 0.75,
  translationProvider: "metis",
  ollamaModel: "gpt-oss:20b",
  deepseekModel: "deepseek-v4-pro",
  translationConfigured: false,
  databasePath: ""
};

export function App(): JSX.Element {
  const [page, setPage] = useState<Page>("reader");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ApiSettings>(defaultSettings);
  const [viewMode, setViewMode] = useState<ArticleViewMode>("persian");
  const [query, setQuery] = useState("");
  const [feedFilter, setFeedFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [status, setStatus] = useState("در حال بارگذاری…");
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadMeta = useCallback(async () => {
    const [settingsResult, feedsResult, foldersResult, tagsResult] = await Promise.all([
      api<ApiSettings>("/api/settings"),
      api<Feed[]>("/api/feeds"),
      api<FolderRecord[]>("/api/folders"),
      api<Tag[]>("/api/tags")
    ]);
    setSettings(settingsResult);
    setFeeds(feedsResult);
    setFolders(foldersResult);
    setTags(tagsResult);
  }, []);

  const loadArticles = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (filter === "unread") params.set("unread", "true");
    if (filter === "starred") params.set("starred", "true");
    if (filter === "readLater") params.set("readLater", "true");
    if (filter === "archived") params.set("archived", "true");
    if (filter === "failed") params.set("failedTranslation", "true");
    if (filter === "untranslated") params.set("untranslated", "true");
    if (feedFilter) params.set("feedId", feedFilter);
    if (tagFilter) params.set("tag", tagFilter);
    params.set("sort", "newest");
    const result = await api<ArticleResponse>(`/api/articles?${params.toString()}`);
    setArticles(result.items);
    setSelectedId((current) => current ?? result.items[0]?.id ?? null);
    setStatus(`${result.total.toLocaleString("fa-IR")} مقاله`);
  }, [feedFilter, filter, query, tagFilter]);

  const loadArticle = useCallback(async (id: string) => {
    const detail = await api<ArticleDetail>(`/api/articles/${id}`);
    setArticle(detail);
  }, []);

  const refreshAll = useCallback(async () => {
    setStatus("درخواست تازه‌سازی ثبت شد");
    await api<{ ok: boolean }>("/api/refresh-all", { method: "POST", body: "{}" });
  }, []);

  const loadReadiness = useCallback(async () => {
    const result = await api<ReadinessStatus>("/api/readiness");
    setReadiness(result);
  }, []);

  const prepareNow = useCallback(async () => {
    setStatus("آماده‌سازی پشت‌صحنه شروع شد");
    const result = await api<{ readiness: ReadinessStatus }>("/api/prepare-now", {
      method: "POST",
      body: "{}"
    });
    setReadiness(result.readiness);
    await Promise.all([loadMeta(), loadArticles()]);
  }, [loadArticles, loadMeta]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    Promise.all([loadMeta(), loadArticles(), loadReadiness()])
      .then(() => {
        if (!cancelled) {
          setError(null);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadArticles, loadMeta, loadReadiness]);

  useEffect(() => {
    const interval = window.setInterval(
      () => {
        void Promise.all([loadReadiness(), loadMeta(), loadArticles()]);
        if (selectedId) void loadArticle(selectedId);
      },
      readiness?.isPreparing ? 15000 : 45000
    );
    return () => window.clearInterval(interval);
  }, [loadArticle, loadArticles, loadMeta, loadReadiness, readiness?.isPreparing, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setArticle(null);
      return;
    }
    loadArticle(selectedId).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, [loadArticle, selectedId]);

  const updateArticle = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ArticleListItem, "isRead" | "isStarred" | "isArchived" | "isReadLater">>
    ) => {
      await api<ArticleListItem>(`/api/articles/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      setArticles((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
      if (article?.id === id) setArticle({ ...article, ...patch });
    },
    [article]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
        setPage("reader");
        return;
      }
      if (isTyping) return;
      if (event.key.toLowerCase() === "t") setViewMode((mode) => nextLanguageMode(mode));
      if (event.key.toLowerCase() === "r") void refreshAll();
      if (event.key.toLowerCase() === "j") selectRelative(1);
      if (event.key.toLowerCase() === "k") selectRelative(-1);
      if (event.key.toLowerCase() === "m" && selectedId) {
        const current = articles.find((item) => item.id === selectedId);
        if (current) void updateArticle(selectedId, { isRead: !current.isRead });
      }
      if (event.key.toLowerCase() === "s" && selectedId) {
        const current = articles.find((item) => item.id === selectedId);
        if (current) void updateArticle(selectedId, { isStarred: !current.isStarred });
      }
      if (event.key.toLowerCase() === "a" && selectedId)
        void updateArticle(selectedId, { isArchived: true });
      if (event.key.toLowerCase() === "f")
        document.querySelector<HTMLElement>(".reader-pane")?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [articles, refreshAll, selectedId, updateArticle]);

  function selectRelative(delta: number): void {
    if (!articles.length) return;
    const index = Math.max(
      0,
      articles.findIndex((item) => item.id === selectedId)
    );
    const next = articles[Math.min(articles.length - 1, Math.max(0, index + delta))];
    if (next) setSelectedId(next.id);
  }

  const themeClass = `theme-${settings.theme}`;
  const failedFeeds = feeds.filter((feed) => feed.lastError);

  return (
    <div className={`app-shell ${themeClass}`} data-testid="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
        filter={filter}
        setFilter={(value) => {
          setFilter(value);
          setFeedFilter(null);
          setTagFilter(null);
          setPage("reader");
        }}
        feeds={feeds}
        folders={folders}
        tags={tags}
        feedFilter={feedFilter}
        tagFilter={tagFilter}
        setFeedFilter={setFeedFilter}
        setTagFilter={setTagFilter}
        refreshAll={refreshAll}
      />

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>LocalReader FA</h1>
            <p>{readiness ? readinessText(readiness, status) : status}</p>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={16} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجو در انگلیسی و فارسی"
                aria-label="جستجو"
              />
            </label>
            <button className="primary-action" onClick={() => setPage("feeds")}>
              <Plus size={16} />
              افزودن فید
            </button>
            <button className="quiet-action" onClick={() => void prepareNow()}>
              <RefreshCw size={16} />
              آماده‌سازی
            </button>
          </div>
        </header>

        {error ? <div className="error-state">{error}</div> : null}
        {readiness ? <ReadinessBanner readiness={readiness} onPrepare={prepareNow} /> : null}
        {failedFeeds.length ? (
          <FeedIssueBanner feeds={failedFeeds} onOpenFeeds={() => setPage("feeds")} />
        ) : null}

        {page === "reader" || page === "search" ? (
          <div className="reader-layout">
            <ArticleList
              articles={articles}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              isLoading={isLoading}
              viewMode={viewMode}
            />
            <ReaderPane
              article={article}
              settings={settings}
              viewMode={viewMode}
              setViewMode={setViewMode}
              updateArticle={updateArticle}
              reloadArticle={() => selectedId && loadArticle(selectedId)}
            />
          </div>
        ) : null}

        {page === "feeds" ? (
          <FeedsPanel
            feeds={feeds}
            folders={folders}
            reload={() => Promise.all([loadMeta(), loadArticles()])}
          />
        ) : null}
        {page === "rules" ? <RulesPanel /> : null}
        {page === "highlights" ? <HighlightsPanel /> : null}
        {page === "jobs" ? <JobsPanel /> : null}
        {page === "settings" ? (
          <SettingsPanel settings={settings} setSettings={setSettings} reload={loadMeta} />
        ) : null}
      </main>
    </div>
  );
}

function Sidebar(props: {
  page: Page;
  setPage: (page: Page) => void;
  filter: FilterKey;
  setFilter: (filter: FilterKey) => void;
  feeds: Feed[];
  folders: FolderRecord[];
  tags: Tag[];
  feedFilter: string | null;
  tagFilter: string | null;
  setFeedFilter: (id: string | null) => void;
  setTagFilter: (name: string | null) => void;
  refreshAll: () => Promise<void>;
}): JSX.Element {
  const filters: Array<[FilterKey, string, JSX.Element]> = [
    ["all", "همه", <Inbox size={17} key="all" />],
    ["unread", "خوانده‌نشده", <BookOpen size={17} key="unread" />],
    ["starred", "ستاره‌دار", <Star size={17} key="starred" />],
    ["readLater", "بعداً بخوان", <Clock3 size={17} key="later" />],
    ["archived", "آرشیو", <Archive size={17} key="archive" />],
    ["failed", "ترجمه ناموفق", <Zap size={17} key="failed" />],
    ["untranslated", "ترجمه‌نشده", <Languages size={17} key="untranslated" />]
  ];
  const pages: Array<[Page, string, JSX.Element]> = [
    ["feeds", "فیدها", <Globe2 size={17} key="feeds" />],
    ["rules", "قوانین", <Sparkles size={17} key="rules" />],
    ["highlights", "هایلایت‌ها", <Highlighter size={17} key="highlights" />],
    ["jobs", "کارها", <Briefcase size={17} key="jobs" />],
    ["settings", "تنظیمات", <Settings size={17} key="settings" />]
  ];
  return (
    <aside className="sidebar">
      <div className="brand-mark">
        <span>LR</span>
        <div>
          <strong>LocalReader FA</strong>
          <small>RSS محلی و دو زبانه</small>
        </div>
      </div>
      <nav className="nav-list">
        {filters.map(([key, label, icon]) => (
          <button
            key={key}
            className={props.filter === key && props.page === "reader" ? "active" : ""}
            onClick={() => props.setFilter(key)}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
      <section className="sidebar-section">
        <h2>پوشه‌ها</h2>
        {props.folders.map((folder) => (
          <button key={folder.id} onClick={() => props.setPage("feeds")}>
            <Folder size={15} />
            {folder.name}
          </button>
        ))}
      </section>
      <section className="sidebar-section">
        <h2>فیدها</h2>
        {props.feeds.slice(0, 12).map((feed) => (
          <button
            key={feed.id}
            className={props.feedFilter === feed.id ? "active" : ""}
            onClick={() => {
              props.setFeedFilter(feed.id);
              props.setTagFilter(null);
              props.setPage("reader");
            }}
          >
            <Globe2 size={15} />
            <span>{feed.title}</span>
          </button>
        ))}
      </section>
      <section className="sidebar-section tags">
        <h2>تگ‌ها</h2>
        {props.tags.slice(0, 12).map((tag) => (
          <button
            key={tag.id}
            className={props.tagFilter === tag.name ? "active" : ""}
            onClick={() => {
              props.setTagFilter(tag.name);
              props.setFeedFilter(null);
              props.setPage("reader");
            }}
          >
            #{tag.name}
          </button>
        ))}
      </section>
      <nav className="nav-list utility">
        {pages.map(([key, label, icon]) => (
          <button
            key={key}
            className={props.page === key ? "active" : ""}
            onClick={() => props.setPage(key)}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
      <button className="refresh-button" onClick={() => void props.refreshAll()}>
        <RefreshCw size={16} />
        تازه‌سازی همه
      </button>
    </aside>
  );
}

function FeedIssueBanner(props: { feeds: Feed[]; onOpenFeeds: () => void }): JSX.Element {
  const first = props.feeds[0];
  return (
    <div className="feed-alert" role="status">
      <div>
        <strong>{props.feeds.length.toLocaleString("fa-IR")} فید خطای دریافت دارد</strong>
        {first ? (
          <span>
            {first.title}: {first.lastError}
            {first.nextCheckAt ? ` · تلاش بعدی ${absoluteTime(first.nextCheckAt)}` : ""}
          </span>
        ) : null}
      </div>
      <button onClick={props.onOpenFeeds}>جزئیات</button>
    </div>
  );
}

function ReadinessBanner(props: {
  readiness: ReadinessStatus;
  onPrepare: () => Promise<void>;
}): JSX.Element {
  const r = props.readiness;
  if (!r.isPreparing && !r.failedJobs && !r.feedsWithErrors && !r.failedTranslations) return <></>;
  const parts = [
    r.pendingTranslations || r.processingTranslations
      ? `${(r.pendingTranslations + r.processingTranslations).toLocaleString("fa-IR")} ترجمه`
      : null,
    r.pendingImageCaches ? `${r.pendingImageCaches.toLocaleString("fa-IR")} تصویر` : null,
    r.pendingJobs || r.runningJobs
      ? `${(r.pendingJobs + r.runningJobs).toLocaleString("fa-IR")} کار پس‌زمینه`
      : null,
    r.failedTranslations
      ? `${r.failedTranslations.toLocaleString("fa-IR")} ترجمه در انتظار تلاش دوباره`
      : null,
    r.feedsWithErrors ? `${r.feedsWithErrors.toLocaleString("fa-IR")} فید مشکل‌دار` : null
  ].filter(Boolean);
  return (
    <div className={`readiness-banner ${r.isPreparing ? "busy" : "attention"}`} role="status">
      <div>
        <strong>{r.isPreparing ? "در حال آماده‌سازی برای خواندن" : "نیاز به توجه"}</strong>
        <span>{parts.length ? parts.join(" · ") : "همه چیز آماده است"}</span>
      </div>
      <button onClick={() => void props.onPrepare()}>الان آماده کن</button>
    </div>
  );
}

function ArticleList(props: {
  articles: ArticleListItem[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  isLoading: boolean;
  viewMode: ArticleViewMode;
}): JSX.Element {
  if (props.isLoading) {
    return (
      <section className="article-list">
        {Array.from({ length: 8 }).map((_, index) => (
          <div className="skeleton-row" key={index} />
        ))}
      </section>
    );
  }
  if (!props.articles.length) {
    return (
      <section className="article-list empty">
        <FileText size={28} />
        <h2>هنوز مقاله‌ای نیست</h2>
        <p>یک فید اضافه کنید یا Refresh all را بزنید.</p>
      </section>
    );
  }
  return (
    <section className="article-list" aria-label="فهرست مقاله‌ها">
      {props.articles.map((article) => (
        <button
          key={article.id}
          className={`article-row ${props.selectedId === article.id ? "selected" : ""} ${article.isRead ? "read" : ""}`}
          onClick={() => props.setSelectedId(article.id)}
        >
          <span className={`status-dot ${article.translationStatus}`} />
          {article.originalImageLocalUrl ? (
            <img
              className="article-thumb"
              src={article.originalImageLocalUrl}
              alt=""
              loading="lazy"
            />
          ) : null}
          <strong>{displayTitle(article, props.viewMode)}</strong>
          <small>
            {article.feed.title} · {relativeTime(article.publishedAt ?? article.fetchedAt)}
          </small>
          <p>{displayExcerpt(article, props.viewMode)}</p>
          <span className="article-row-meta">
            {article.isStarred ? "★" : ""}
            {translationStatusLabel(article.translationStatus)}
          </span>
        </button>
      ))}
    </section>
  );
}

function ReaderPane(props: {
  article: ArticleDetail | null;
  settings: ApiSettings;
  viewMode: ArticleViewMode;
  setViewMode: Dispatch<SetStateAction<ArticleViewMode>>;
  updateArticle: (
    id: string,
    patch: Partial<Pick<ArticleListItem, "isRead" | "isStarred" | "isArchived" | "isReadLater">>
  ) => Promise<void>;
  reloadArticle: () => void;
}): JSX.Element {
  const [imagesAllowed, setImagesAllowed] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState("");
  const scrollRef = useRef<HTMLElement>(null);
  const article = props.article;

  useEffect(() => {
    setImagesAllowed(false);
    setSelectedQuote("");
  }, [article?.id]);

  useEffect(() => {
    if (!article || article.isRead || props.settings.markReadDelaySeconds === 0) return;
    const timeout = window.setTimeout(() => {
      void props.updateArticle(article.id, { isRead: true });
    }, props.settings.markReadDelaySeconds * 1000);
    return () => window.clearTimeout(timeout);
  }, [article, props]);

  const content = useMemo(() => {
    if (!article) return null;
    const canShowPersian =
      article.translationStatus === "completed" ||
      article.translationStatus === "skipped" ||
      article.translatedBodyFaMarkdown;
    const englishHtml = renderHtml(
      article.originalHtml ?? `<p>${escapeHtml(article.originalText)}</p>`,
      props.settings.loadRemoteImages || imagesAllowed
    );
    const persianHtml = article.translatedBodyFaMarkdown
      ? renderMarkdown(
          article.translatedBodyFaMarkdown,
          props.settings.loadRemoteImages || imagesAllowed
        )
      : article.translationStatus === "skipped"
        ? englishHtml
        : "";
    return { canShowPersian, englishHtml, persianHtml };
  }, [article, imagesAllowed, props.settings.loadRemoteImages]);

  const createHighlight = async (): Promise<void> => {
    if (!article || !selectedQuote.trim()) return;
    await api<Highlight>("/api/highlights", {
      method: "POST",
      body: JSON.stringify({
        articleId: article.id,
        quote: selectedQuote.trim(),
        language: props.viewMode === "english" ? "en" : "fa"
      })
    });
    setSelectedQuote("");
    props.reloadArticle();
  };

  const retryTranslation = async (): Promise<void> => {
    if (!article) return;
    await api<{ ok: boolean }>(`/api/articles/${article.id}/retry-translation`, {
      method: "POST",
      body: "{}"
    });
    props.reloadArticle();
  };

  if (!article) {
    return (
      <section className="reader-pane empty" tabIndex={-1}>
        <BookOpen size={34} />
        <h2>یک مقاله را انتخاب کنید</h2>
        <p>خواندن طولانی با فارسی/English toggle اینجا انجام می‌شود.</p>
      </section>
    );
  }

  return (
    <section
      className="reader-pane"
      ref={scrollRef}
      tabIndex={-1}
      style={
        {
          "--reader-width": `${props.settings.readerWidth}px`,
          "--reader-font-size": `${props.settings.fontSize}px`
        } as CSSProperties
      }
      onMouseUp={() => setSelectedQuote(window.getSelection()?.toString() ?? "")}
      onScroll={(event) => {
        const el = event.currentTarget;
        const progress = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
        if (progress >= props.settings.markReadScrollThreshold && !article.isRead) {
          void props.updateArticle(article.id, { isRead: true });
        }
      }}
    >
      <article className="reader-card">
        <header className="reader-header">
          <div>
            <span className="source-line">{article.feed.title}</span>
            <h2 dir={props.viewMode === "english" ? "ltr" : "rtl"}>
              {displayTitle(article, props.viewMode)}
            </h2>
            <p>
              {article.author ? `${article.author} · ` : ""}
              {relativeTime(article.publishedAt ?? article.fetchedAt)}
            </p>
          </div>
          <div className="reader-actions">
            <button
              className="toggle-language"
              data-testid="language-toggle"
              onClick={() => props.setViewMode((mode) => nextLanguageMode(mode))}
            >
              <Languages size={17} />
              {props.viewMode === "persian" ? "English" : "فارسی"}
            </button>
            <button onClick={() => props.setViewMode("split")}>دو ستونه</button>
            <button
              onClick={() =>
                void props.updateArticle(article.id, { isStarred: !article.isStarred })
              }
            >
              <Star size={16} fill={article.isStarred ? "currentColor" : "none"} />
            </button>
            <button onClick={() => void props.updateArticle(article.id, { isArchived: true })}>
              <Archive size={16} />
            </button>
          </div>
        </header>

        <div className="progress-track">
          <span style={{ width: `${Math.round(article.readingProgress * 100)}%` }} />
        </div>

        {article.originalImageLocalUrl ? (
          <img
            className="reader-lead-image"
            src={article.originalImageLocalUrl}
            alt=""
            loading="lazy"
          />
        ) : null}

        {!props.settings.loadRemoteImages && !imagesAllowed ? (
          <button className="image-load-button" onClick={() => setImagesAllowed(true)}>
            بارگذاری تصاویر خارجی برای این مقاله
          </button>
        ) : null}

        {selectedQuote ? (
          <button className="highlight-action" onClick={() => void createHighlight()}>
            <Highlighter size={16} />
            هایلایت انتخاب
          </button>
        ) : null}

        {content?.canShowPersian && (props.viewMode === "persian" || props.viewMode === "split") ? (
          <div
            className="article-prose article-prose-fa rtl-content"
            dir="rtl"
            dangerouslySetInnerHTML={{ __html: content.persianHtml }}
          />
        ) : props.viewMode === "persian" ? (
          <TranslationState article={article} retryTranslation={retryTranslation} />
        ) : null}

        {props.viewMode === "split" ? <hr className="split-divider" /> : null}

        {props.viewMode === "english" || props.viewMode === "split" ? (
          <div
            className="article-prose ltr-content"
            dir="ltr"
            dangerouslySetInnerHTML={{ __html: content?.englishHtml ?? "" }}
          />
        ) : null}

        {article.highlights.length ? (
          <aside className="reader-notes">
            <h3>هایلایت‌ها</h3>
            {article.highlights.map((highlight) => (
              <blockquote key={highlight.id} dir={highlight.language === "fa" ? "rtl" : "ltr"}>
                {highlight.quote}
              </blockquote>
            ))}
          </aside>
        ) : null}
      </article>
    </section>
  );
}

function TranslationState(props: {
  article: ArticleDetail;
  retryTranslation: () => Promise<void>;
}): JSX.Element {
  const status = props.article.translationStatus;
  return (
    <div className="translation-state">
      {status === "processing" ? <Loader2 className="spin" size={22} /> : <Languages size={22} />}
      <h3>{translationStatusLabel(status)}</h3>
      {props.article.translationError ? (
        <p>{props.article.translationError}</p>
      ) : (
        <p>متن فارسی هنوز آماده نیست.</p>
      )}
      {status === "failed" ? (
        <button onClick={() => void props.retryTranslation()}>تلاش دوباره ترجمه</button>
      ) : null}
    </div>
  );
}

function FeedsPanel(props: {
  feeds: Feed[];
  folders: FolderRecord[];
  reload: () => Promise<unknown>;
}): JSX.Element {
  const [url, setUrl] = useState("");
  const [folderName, setFolderName] = useState("");
  const [message, setMessage] = useState("");

  const addFeed = async (): Promise<void> => {
    setMessage("در حال بررسی فید…");
    await api<Feed>("/api/feeds", { method: "POST", body: JSON.stringify({ url }) });
    setUrl("");
    setMessage("فید اضافه شد و Job دریافت مقاله‌ها ثبت شد.");
    await props.reload();
  };

  const addFolder = async (): Promise<void> => {
    if (!folderName.trim()) return;
    await api<FolderRecord>("/api/folders", {
      method: "POST",
      body: JSON.stringify({ name: folderName.trim() })
    });
    setFolderName("");
    await props.reload();
  };

  return (
    <section className="panel-page">
      <div className="panel-heading">
        <h2>مدیریت فیدها</h2>
        <p>RSS، Atom، JSON Feed یا URL سایت را وارد کنید؛ discovery خودکار انجام می‌شود.</p>
      </div>
      <div className="form-line">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/feed.xml"
        />
        <button className="primary-action" onClick={() => void addFeed()}>
          <Plus size={16} />
          افزودن
        </button>
      </div>
      <div className="form-line">
        <input
          value={folderName}
          onChange={(event) => setFolderName(event.target.value)}
          placeholder="نام پوشه"
        />
        <button onClick={() => void addFolder()}>ایجاد پوشه</button>
      </div>
      {message ? <p className="inline-message">{message}</p> : null}
      <div className="table-list">
        {props.feeds.map((feed) => (
          <div key={feed.id} className="table-row">
            <div>
              <strong>{feed.title}</strong>
              <small>{feed.feedUrl}</small>
              {feed.lastError ? (
                <em>
                  {feed.lastError}
                  {feed.nextCheckAt ? ` · تلاش بعدی ${absoluteTime(feed.nextCheckAt)}` : ""}
                  {feed.errorCount ? ` · ${feed.errorCount.toLocaleString("fa-IR")} خطا` : ""}
                </em>
              ) : null}
            </div>
            <div>{feed._count?.articles ?? 0} مقاله</div>
            <button
              onClick={async () => {
                await api(`/api/feeds/${feed.id}/refresh`, { method: "POST", body: "{}" });
                setMessage("Refresh job ثبت شد.");
              }}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="export-actions">
        <button onClick={() => downloadUrl("/api/export/opml")}>
          <Download size={16} />
          خروجی OPML
        </button>
        <label className="upload-button">
          <Upload size={16} />
          ورود OPML
          <input
            type="file"
            accept=".opml,.xml,text/xml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then(async (opml) => {
                await api("/api/import/opml", { method: "POST", body: JSON.stringify({ opml }) });
                await props.reload();
              });
            }}
          />
        </label>
      </div>
    </section>
  );
}

function RulesPanel(): JSX.Element {
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [name, setName] = useState("");
  const [contains, setContains] = useState("");
  const [tag, setTag] = useState("");
  const load = useCallback(async () => setRules(await api<RuleRecord[]>("/api/rules")), []);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async (): Promise<void> => {
    await api("/api/rules", {
      method: "POST",
      body: JSON.stringify({
        name,
        isEnabled: true,
        conditions: [{ field: "title", operator: "contains", value: contains }],
        actions: tag ? [{ type: "add_tag", value: tag }] : [{ type: "translate_immediately" }]
      })
    });
    setName("");
    setContains("");
    setTag("");
    await load();
  };
  return (
    <section className="panel-page">
      <div className="panel-heading">
        <h2>قوانین محلی</h2>
        <p>
          روی مقاله‌های تازه اجرا می‌شود: خوانده‌شده، ستاره، آرشیو، تگ، ترجمه فوری یا skip
          translation.
        </p>
      </div>
      <div className="form-grid">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="نام قانون"
        />
        <input
          value={contains}
          onChange={(event) => setContains(event.target.value)}
          placeholder="عنوان شامل…"
        />
        <input
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          placeholder="تگ اختیاری"
        />
        <button className="primary-action" onClick={() => void create()}>
          ایجاد قانون
        </button>
      </div>
      <div className="table-list">
        {rules.map((rule) => (
          <div className="table-row" key={rule.id}>
            <div>
              <strong>{rule.name}</strong>
              <small>{rule.conditionsJson}</small>
            </div>
            <span>{rule.isEnabled ? "فعال" : "غیرفعال"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function HighlightsPanel(): JSX.Element {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  useEffect(() => {
    void api<Highlight[]>("/api/highlights").then(setHighlights);
  }, []);
  return (
    <section className="panel-page">
      <div className="panel-heading">
        <h2>هایلایت‌ها و یادداشت‌ها</h2>
        <p>هایلایت‌ها برای متن اصلی و ترجمه جدا ذخیره می‌شوند.</p>
      </div>
      <div className="highlight-list">
        {highlights.map((highlight) => (
          <blockquote key={highlight.id} dir={highlight.language === "fa" ? "rtl" : "ltr"}>
            {highlight.quote}
            <footer>{highlight.article?.originalTitle}</footer>
          </blockquote>
        ))}
      </div>
    </section>
  );
}

function JobsPanel(): JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([]);
  const load = useCallback(async () => setJobs(await api<Job[]>("/api/jobs")), []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);
  return (
    <section className="panel-page">
      <div className="panel-heading">
        <h2>Job Dashboard</h2>
        <p>صف ترجمه، دریافت فید، extraction و بازسازی search index.</p>
      </div>
      <div className="table-list">
        {jobs.map((job) => (
          <div className="table-row" key={job.id}>
            <div>
              <strong>{job.type}</strong>
              <small>{job.payloadJson}</small>
              {job.lastError ? <em>{job.lastError}</em> : null}
            </div>
            <span className={`job-status ${job.status}`}>{job.status}</span>
            {job.status === "failed" ? (
              <button
                onClick={async () => {
                  await api(`/api/jobs/${job.id}/retry`, { method: "POST", body: "{}" });
                  await load();
                }}
              >
                Retry
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPanel(props: {
  settings: ApiSettings;
  setSettings: (settings: ApiSettings) => void;
  reload: () => Promise<void>;
}): JSX.Element {
  const update = async (patch: Partial<ApiSettings>): Promise<void> => {
    const next = await api<ApiSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    props.setSettings(next);
  };
  return (
    <section className="panel-page">
      <div className="panel-heading">
        <h2>تنظیمات و حریم خصوصی</h2>
        <p>
          همه‌چیز محلی است. اگر provider روی Ollama باشد ترجمه روی همین دستگاه انجام می‌شود؛ اگر
          Metis باشد متن مقاله برای ترجمه ارسال می‌شود.
        </p>
      </div>
      <div className="settings-grid">
        <SettingToggle
          label="ترجمه فعال"
          value={props.settings.translationEnabled}
          onChange={(value) => void update({ translationEnabled: value })}
        />
        <SettingToggle
          label="ترجمه خودکار مقاله‌های تازه"
          value={props.settings.autoTranslateNewArticles}
          onChange={(value) => void update({ autoTranslateNewArticles: value })}
        />
        <SettingToggle
          label="آماده‌سازی خودکار پشت‌صحنه"
          value={props.settings.backgroundPrepEnabled}
          onChange={(value) => void update({ backgroundPrepEnabled: value })}
        />
        <SettingToggle
          label="تلاش دوباره خودکار ترجمه‌های ناموفق"
          value={props.settings.autoRetryFailedTranslations}
          onChange={(value) => void update({ autoRetryFailedTranslations: value })}
        />
        <SettingToggle
          label="بارگذاری خودکار تصاویر خارجی"
          value={props.settings.loadRemoteImages}
          onChange={(value) => void update({ loadRemoteImages: value })}
        />
        <SettingToggle
          label="استخراج full-text"
          value={props.settings.fullTextExtractionEnabled}
          onChange={(value) => void update({ fullTextExtractionEnabled: value })}
        />
        <label>
          موتور ترجمه
          <select
            value={props.settings.translationProvider}
            onChange={(event) =>
              void update({ translationProvider: event.target.value as TranslationProvider })
            }
          >
            <option value="ollama">Ollama محلی</option>
            <option value="metis">Metis / DeepSeek</option>
          </select>
        </label>
        <label>
          تم
          <select
            value={props.settings.theme}
            onChange={(event) => void update({ theme: event.target.value as ThemeName })}
          >
            <option value="light">روشن</option>
            <option value="dark">تاریک</option>
            <option value="sepia">سپیا</option>
          </select>
        </label>
        <label>
          اندازه متن
          <input
            type="range"
            min="15"
            max="24"
            value={props.settings.fontSize}
            onChange={(event) => void update({ fontSize: Number(event.target.value) })}
          />
        </label>
        <label>
          عرض reader
          <input
            type="range"
            min="640"
            max="980"
            value={props.settings.readerWidth}
            onChange={(event) => void update({ readerWidth: Number(event.target.value) })}
          />
        </label>
        <label>
          مدل Metis/DeepSeek
          <input
            value={props.settings.deepseekModel}
            onChange={(event) => void update({ deepseekModel: event.target.value })}
          />
        </label>
        <label>
          مدل Ollama
          <input
            value={props.settings.ollamaModel}
            onChange={(event) => void update({ ollamaModel: event.target.value })}
          />
        </label>
      </div>
      <div className="privacy-box">
        <p>
          provider ترجمه:{" "}
          <strong>
            {props.settings.translationProvider === "ollama" ? "Ollama محلی" : "Metis"}
          </strong>
        </p>
        <p>
          وضعیت ترجمه:{" "}
          <strong>{props.settings.translationConfigured ? "تنظیم شده" : "تنظیم نشده"}</strong>
        </p>
        <p>مسیر دیتابیس: {props.settings.databasePath}</p>
        <p>
          کلید API در frontend نمایش داده نمی‌شود. برای Metis آن را فقط در فایل محلی `.env` قرار
          دهید.
        </p>
      </div>
      <div className="export-actions">
        <button onClick={() => downloadUrl("/api/export/json")}>
          <Download size={16} />
          خروجی کامل JSON
        </button>
        <button
          onClick={async () => {
            await api("/api/search/rebuild", { method: "POST", body: "{}" });
            await props.reload();
          }}
        >
          <RefreshCw size={16} />
          بازسازی Search Index
        </button>
      </div>
    </section>
  );
}

function SettingToggle(props: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <label className="setting-toggle">
      <span>{props.label}</span>
      <button className={props.value ? "on" : ""} onClick={() => props.onChange(!props.value)}>
        {props.value ? <Check size={15} /> : null}
      </button>
    </label>
  );
}

function displayTitle(article: ArticleListItem, mode: ArticleViewMode): string {
  if (mode !== "english" && article.translatedTitleFa) return article.translatedTitleFa;
  return article.originalTitle || article.title;
}

function displayExcerpt(article: ArticleListItem, mode: ArticleViewMode): string {
  if (mode !== "english" && article.translatedSummaryFa) return article.translatedSummaryFa;
  return article.originalExcerpt ?? "";
}

function translationStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "در صف ترجمه",
    processing: "در حال ترجمه",
    completed: "ترجمه‌شده",
    failed: "ترجمه ناموفق",
    skipped: "بدون ترجمه"
  };
  return labels[status] ?? status;
}

function readinessText(readiness: ReadinessStatus, fallback: string): string {
  if (readiness.isPreparing) {
    const active = readiness.pendingJobs + readiness.runningJobs;
    return `${readiness.readyUnreadCount.toLocaleString("fa-IR")} آماده خواندن · ${active.toLocaleString("fa-IR")} کار در پس‌زمینه`;
  }
  if (readiness.readyUnreadCount)
    return `${readiness.readyUnreadCount.toLocaleString("fa-IR")} مقاله آماده خواندن`;
  return fallback;
}

function relativeTime(value: string | null): string {
  if (!value) return "بدون تاریخ";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes.toLocaleString("fa-IR")} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours.toLocaleString("fa-IR")} ساعت پیش`;
  return `${Math.round(hours / 24).toLocaleString("fa-IR")} روز پیش`;
}

function absoluteTime(value: string): string {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
