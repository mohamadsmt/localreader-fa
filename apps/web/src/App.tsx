import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, JSX, SetStateAction } from "react";
import {
  AlertCircle,
  Archive,
  BookOpen,
  Briefcase,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock3,
  Download,
  FileDown,
  FileText,
  Folder,
  Globe2,
  Highlighter,
  Inbox,
  Languages,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Upload,
  Zap
} from "lucide-react";
import type {
  ApiSettings,
  ArticleViewMode,
  SettingsPatchInput,
  ThemeName,
  TranslationProvider
} from "@localreader/shared";
import { nextLanguageMode } from "@localreader/shared";
import { api, downloadBlob, downloadUrl } from "./lib/api.js";
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

export interface ReadinessStatus {
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

export interface QueueProgress {
  total: number;
  ready: number;
  percent: number;
  activeWork: number;
}

type HighlightLanguage = "en" | "fa";

export interface ReaderSelectionState {
  articleId: string;
  quote: string;
  language: HighlightLanguage;
  top: number;
  left: number;
}

interface SelectionToolbarPositionSource {
  scrollTop: number;
  scrollLeft: number;
  clientWidth: number;
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

const ARTICLE_PAGE_SIZE = 50;

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
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const [articlePage, setArticlePage] = useState(1);
  const [articleTotal, setArticleTotal] = useState(0);
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("در حال بارگذاری…");
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparingNow, setIsPreparingNow] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
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
    if (!feedFilter && folderFilter) params.set("folderId", folderFilter);
    if (tagFilter) params.set("tag", tagFilter);
    params.set("sort", "newest");
    params.set("limit", String(ARTICLE_PAGE_SIZE));
    params.set("offset", String((articlePage - 1) * ARTICLE_PAGE_SIZE));
    const result = await api<ArticleResponse>(`/api/articles?${params.toString()}`);
    const maxPage = Math.max(1, Math.ceil(result.total / ARTICLE_PAGE_SIZE));
    if (articlePage > maxPage) {
      setArticlePage(maxPage);
      return;
    }
    setArticles(result.items);
    setArticleTotal(result.total);
    setSelectedId((current) => current ?? result.items[0]?.id ?? null);
    setStatus(`${result.total.toLocaleString("fa-IR")} مقاله`);
  }, [articlePage, feedFilter, filter, folderFilter, query, tagFilter]);

  const loadArticle = useCallback(async (id: string) => {
    const detail = await api<ArticleDetail>(`/api/articles/${id}`);
    setArticle(detail);
  }, []);

  const loadReadiness = useCallback(async () => {
    const result = await api<ReadinessStatus>("/api/readiness");
    setReadiness(result);
  }, []);

  const updateSettings = useCallback(async (patch: SettingsPatchInput): Promise<ApiSettings> => {
    const next = await api<ApiSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    setSettings(next);
    return next;
  }, []);

  const clearArticleSelection = useCallback((): void => {
    setSelectedArticleIds(new Set());
  }, []);

  const selectPrimaryFilter = useCallback((value: FilterKey): void => {
    setFilter(value);
    setFeedFilter(null);
    setFolderFilter(null);
    setTagFilter(null);
    setSelectedId(null);
    clearArticleSelection();
    setArticlePage(1);
    setPage("reader");
  }, [clearArticleSelection]);

  const selectFolder = useCallback((folderId: string): void => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      next.add(folderId);
      return next;
    });
    setFilter("all");
    setQuery("");
    setFeedFilter(null);
    setFolderFilter(folderId);
    setTagFilter(null);
    setSelectedId(null);
    clearArticleSelection();
    setArticlePage(1);
    setPage("reader");
  }, [clearArticleSelection]);

  const selectFeed = useCallback((feed: Feed): void => {
    const parentFolderId = feed.folderId;
    if (parentFolderId) {
      setExpandedFolderIds((current) => {
        const next = new Set(current);
        next.add(parentFolderId);
        return next;
      });
    }
    setFilter("all");
    setQuery("");
    setFeedFilter(feed.id);
    setFolderFilter(null);
    setTagFilter(null);
    setSelectedId(null);
    clearArticleSelection();
    setArticlePage(1);
    setPage("reader");
  }, [clearArticleSelection]);

  const selectTag = useCallback((name: string): void => {
    setFilter("all");
    setFeedFilter(null);
    setFolderFilter(null);
    setTagFilter(name);
    setSelectedId(null);
    clearArticleSelection();
    setArticlePage(1);
    setPage("reader");
  }, [clearArticleSelection]);

  const changeArticlePage = useCallback((nextPage: number): void => {
    setSelectedId(null);
    clearArticleSelection();
    setArticlePage(nextPage);
  }, [clearArticleSelection]);

  const toggleArticleSelection = useCallback((id: string, checked: boolean): void => {
    setSelectedArticleIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectPageArticles = useCallback((): void => {
    setSelectedArticleIds(new Set(articles.map((item) => item.id)));
  }, [articles]);

  const selectedArticleIdsInPageOrder = useMemo(
    () => articles.filter((item) => selectedArticleIds.has(item.id)).map((item) => item.id),
    [articles, selectedArticleIds]
  );

  const exportSelectedArticlesPdf = useCallback(async (): Promise<void> => {
    if (!selectedArticleIdsInPageOrder.length) return;
    setIsExportingPdf(true);
    setError(null);
    try {
      await downloadBlob(
        "/api/export/articles/pdf",
        {
          method: "POST",
          body: JSON.stringify({
            articleIds: selectedArticleIdsInPageOrder,
            viewMode
          })
        },
        "localreader-fa-articles.pdf"
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExportingPdf(false);
    }
  }, [selectedArticleIdsInPageOrder, viewMode]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    setStatus("درخواست تازه‌سازی ثبت شد");
    try {
      await api<{ ok: boolean }>("/api/refresh-all", { method: "POST", body: "{}" });
      await loadReadiness();
    } finally {
      setIsRefreshing(false);
    }
  }, [loadReadiness]);

  const prepareNow = useCallback(async () => {
    setIsPreparingNow(true);
    setStatus("آماده‌سازی پشت‌صحنه شروع شد");
    try {
      const result = await api<{ readiness: ReadinessStatus }>("/api/prepare-now", {
        method: "POST",
        body: "{}"
      });
      setReadiness(result.readiness);
      await Promise.all([loadMeta(), loadArticles()]);
    } finally {
      setIsPreparingNow(false);
    }
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

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [settings.theme]);

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

  const openArticleFromHighlight = useCallback((articleId: string): void => {
    setFilter("all");
    setFeedFilter(null);
    setFolderFilter(null);
    setTagFilter(null);
    setQuery("");
    setArticlePage(1);
    clearArticleSelection();
    setSelectedId(articleId);
    setPage("reader");
  }, [clearArticleSelection]);

  useEffect(() => {
    setSelectedArticleIds((current) => {
      if (!current.size) return current;
      const visibleIds = new Set(articles.map((item) => item.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [articles]);

  const refreshSelectedArticleHighlights = useCallback(
    (articleId: string): void => {
      if (article?.id === articleId) void loadArticle(articleId);
    },
    [article?.id, loadArticle]
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
        setFilter={selectPrimaryFilter}
        feeds={feeds}
        folders={folders}
        tags={tags}
        feedFilter={feedFilter}
        folderFilter={folderFilter}
        tagFilter={tagFilter}
        expandedFolderIds={expandedFolderIds}
        onFolderSelect={selectFolder}
        onFeedSelect={selectFeed}
        onTagSelect={selectTag}
        refreshAll={refreshAll}
        isRefreshing={isRefreshing}
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
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId(null);
                  clearArticleSelection();
                  setArticlePage(1);
                  setPage("reader");
                }}
                placeholder="جستجو در انگلیسی و فارسی"
                aria-label="جستجو"
              />
            </label>
            <button className="primary-action" onClick={() => setPage("feeds")}>
              <Plus size={16} />
              افزودن فید
            </button>
            <ThemeQuickToggle
              theme={settings.theme}
              onToggle={() => void updateSettings({ theme: nextQuickTheme(settings.theme) })}
            />
            <button
              className="quiet-action"
              onClick={() => void prepareNow()}
              disabled={isPreparingNow}
              aria-busy={isPreparingNow}
            >
              <RefreshCw className={isPreparingNow ? "spin" : ""} size={16} />
              {isPreparingNow ? "در حال آماده‌سازی" : "آماده‌سازی"}
            </button>
          </div>
        </header>

        <SystemStatusStrip
          error={error}
          readiness={readiness}
          failedFeeds={failedFeeds}
          onPrepare={prepareNow}
          isPreparingNow={isPreparingNow}
          onOpenFeeds={() => setPage("feeds")}
        />

        {page === "reader" || page === "search" ? (
          <div className="reader-layout">
            <ArticleList
              articles={articles}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              isLoading={isLoading}
              viewMode={viewMode}
              page={articlePage}
              pageSize={ARTICLE_PAGE_SIZE}
              total={articleTotal}
              onPageChange={changeArticlePage}
              selectedArticleIds={selectedArticleIds}
              onToggleArticleSelection={toggleArticleSelection}
              onSelectPageArticles={selectPageArticles}
              onClearSelection={clearArticleSelection}
              onExportPdf={exportSelectedArticlesPdf}
              isExportingPdf={isExportingPdf}
            />
            <ReaderPane
              article={article}
              settings={settings}
              viewMode={viewMode}
              setViewMode={setViewMode}
              updateArticle={updateArticle}
              reloadArticle={() => {
                if (!selectedId) return;
                return loadArticle(selectedId);
              }}
            />
          </div>
        ) : null}

        {page === "feeds" ? (
          <FeedsPanel
            feeds={feeds}
            folders={folders}
            reload={() => Promise.all([loadMeta(), loadArticles()])}
            onFeedUnsubscribed={async (feedId) => {
              const wasFiltered = feedFilter === feedId;
              if (wasFiltered) {
                setFeedFilter(null);
                setSelectedId(null);
                setArticlePage(1);
              }
              await Promise.all([loadMeta(), loadReadiness()]);
              if (!wasFiltered) await loadArticles();
            }}
          />
        ) : null}
        {page === "rules" ? <RulesPanel /> : null}
        {page === "highlights" ? (
          <HighlightsPanel
            onOpenArticle={openArticleFromHighlight}
            onHighlightDeleted={refreshSelectedArticleHighlights}
          />
        ) : null}
        {page === "jobs" ? <JobsPanel /> : null}
        {page === "settings" ? (
          <SettingsPanel settings={settings} updateSettings={updateSettings} reload={loadMeta} />
        ) : null}
      </main>
    </div>
  );
}

function ThemeQuickToggle(props: { theme: ThemeName; onToggle: () => void }): JSX.Element {
  const isDark = props.theme === "dark";
  const label = isDark ? "تم روشن" : "تم تاریک";
  const Icon = isDark ? Sun : Moon;
  return (
    <button className="quiet-action theme-toggle" onClick={props.onToggle} aria-label={label}>
      <Icon size={16} />
      {isDark ? "روشن" : "تاریک"}
    </button>
  );
}

function nextQuickTheme(theme: ThemeName): ThemeName {
  return theme === "dark" ? "light" : "dark";
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
  folderFilter: string | null;
  tagFilter: string | null;
  expandedFolderIds: Set<string>;
  onFolderSelect: (id: string) => void;
  onFeedSelect: (feed: Feed) => void;
  onTagSelect: (name: string) => void;
  refreshAll: () => Promise<void>;
  isRefreshing: boolean;
}): JSX.Element {
  const feedsByFolder = useMemo(() => {
    const grouped = new Map<string, Feed[]>();
    for (const feed of props.feeds) {
      if (!feed.folderId) continue;
      const folderFeeds = grouped.get(feed.folderId) ?? [];
      folderFeeds.push(feed);
      grouped.set(feed.folderId, folderFeeds);
    }
    return grouped;
  }, [props.feeds]);
  const unfiledFeeds = useMemo(() => props.feeds.filter((feed) => !feed.folderId), [props.feeds]);
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
            className={
              props.filter === key &&
              props.page === "reader" &&
              !props.feedFilter &&
              !props.folderFilter &&
              !props.tagFilter
                ? "active"
                : ""
            }
            aria-pressed={
              props.filter === key &&
              props.page === "reader" &&
              !props.feedFilter &&
              !props.folderFilter &&
              !props.tagFilter
            }
            onClick={() => props.setFilter(key)}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
      <section className="sidebar-section">
        <h2>پوشه‌ها</h2>
        {props.folders.map((folder) => {
          const folderFeeds = feedsByFolder.get(folder.id) ?? [];
          const isExpanded = props.expandedFolderIds.has(folder.id);
          return (
            <div className="folder-nav-group" key={folder.id}>
              <button
                className={props.folderFilter === folder.id ? "active" : ""}
                aria-pressed={props.folderFilter === folder.id}
                aria-expanded={isExpanded}
                aria-label={`پوشه ${folder.name}`}
                onClick={() => props.onFolderSelect(folder.id)}
              >
                <ChevronDown
                  className={isExpanded ? "folder-chevron expanded" : "folder-chevron"}
                  size={14}
                />
                <Folder size={15} />
                <span>{folder.name}</span>
              </button>
              {isExpanded ? (
                <div className="folder-feed-list">
                  {folderFeeds.length ? (
                    folderFeeds.map((feed) => (
                      <button
                        key={feed.id}
                        className={props.feedFilter === feed.id ? "active nested" : "nested"}
                        aria-pressed={props.feedFilter === feed.id}
                        aria-label={`فید ${feed.title}`}
                        onClick={() => props.onFeedSelect(feed)}
                      >
                        <Globe2 size={14} />
                        <span>{feed.title}</span>
                      </button>
                    ))
                  ) : (
                    <small>فیدی در این پوشه نیست</small>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </section>
      <section className="sidebar-section">
        <h2>بدون پوشه</h2>
        {unfiledFeeds.map((feed) => (
          <button
            key={feed.id}
            className={props.feedFilter === feed.id ? "active" : ""}
            aria-pressed={props.feedFilter === feed.id}
            aria-label={`فید ${feed.title}`}
            onClick={() => props.onFeedSelect(feed)}
          >
            <Globe2 size={15} />
            <span>{feed.title}</span>
          </button>
        ))}
        {!unfiledFeeds.length ? <small>همه فیدها داخل پوشه هستند</small> : null}
      </section>
      <section className="sidebar-section tags">
        <h2>تگ‌ها</h2>
        {props.tags.slice(0, 12).map((tag) => (
          <button
            key={tag.id}
            className={props.tagFilter === tag.name ? "active" : ""}
            aria-pressed={props.tagFilter === tag.name}
            onClick={() => props.onTagSelect(tag.name)}
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
            aria-pressed={props.page === key}
            onClick={() => props.setPage(key)}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
      <button
        className="refresh-button"
        onClick={() => void props.refreshAll()}
        disabled={props.isRefreshing}
        aria-busy={props.isRefreshing}
      >
        <RefreshCw className={props.isRefreshing ? "spin" : ""} size={16} />
        {props.isRefreshing ? "در حال تازه‌سازی" : "تازه‌سازی همه"}
      </button>
    </aside>
  );
}

function SystemStatusStrip(props: {
  error: string | null;
  readiness: ReadinessStatus | null;
  failedFeeds: Feed[];
  onPrepare: () => Promise<void>;
  isPreparingNow: boolean;
  onOpenFeeds: () => void;
}): JSX.Element {
  const showReadiness = props.readiness ? shouldShowReadinessStatus(props.readiness) : false;
  if (!props.error && !showReadiness && !props.failedFeeds.length) return <></>;
  return (
    <section className="system-status-strip" aria-label="وضعیت سیستم">
      {props.error ? <ErrorStatusItem message={props.error} /> : null}
      {props.readiness && showReadiness ? (
        <ReadinessStatusItem
          readiness={props.readiness}
          onPrepare={props.onPrepare}
          isPreparingNow={props.isPreparingNow}
        />
      ) : null}
      {props.failedFeeds.length ? (
        <FeedIssueStatusItem feeds={props.failedFeeds} onOpenFeeds={props.onOpenFeeds} />
      ) : null}
    </section>
  );
}

function ErrorStatusItem(props: { message: string }): JSX.Element {
  return (
    <div className="status-item status-error" role="alert">
      <AlertCircle size={16} />
      <div className="status-copy">
        <strong>خطای برنامه</strong>
        <span title={props.message}>{props.message}</span>
      </div>
    </div>
  );
}

function FeedIssueStatusItem(props: { feeds: Feed[]; onOpenFeeds: () => void }): JSX.Element {
  const first = props.feeds[0];
  return (
    <div className="status-item status-error" role="status">
      <AlertCircle size={16} />
      <div className="status-copy">
        <strong>{props.feeds.length.toLocaleString("fa-IR")} فید خطای دریافت دارد</strong>
        {first ? (
          <span title={`${first.title}: ${first.lastError ?? ""}`}>
            {first.title}: {first.lastError}
            {first.nextCheckAt ? ` · تلاش بعدی ${absoluteTime(first.nextCheckAt)}` : ""}
          </span>
        ) : null}
      </div>
      <button onClick={props.onOpenFeeds}>جزئیات</button>
    </div>
  );
}

function ReadinessStatusItem(props: {
  readiness: ReadinessStatus;
  onPrepare: () => Promise<void>;
  isPreparingNow: boolean;
}): JSX.Element {
  const r = props.readiness;
  const progress = calculateReadinessProgress(r);
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
  const title =
    progress.percent === 100 && !r.isPreparing
      ? "همه مقاله‌ها آماده خواندن"
      : r.isPreparing
        ? "در حال آماده‌سازی برای خواندن"
        : "بخشی از صف آماده است";
  const tone =
    r.failedJobs || r.failedTranslations || r.feedsWithErrors
      ? "status-attention"
      : r.isPreparing || progress.activeWork
        ? "status-busy"
        : "status-complete";
  return (
    <div className={`status-item ${tone}`} role="status">
      <RefreshCw className={r.isPreparing || progress.activeWork ? "spin" : ""} size={16} />
      <div className="status-copy readiness-status-copy">
        <div className="status-heading">
          <strong>{title}</strong>
          <b>{progress.percent.toLocaleString("fa-IR")}٪</b>
        </div>
        <span title={parts.length ? parts.join(" · ") : "صف فعالی وجود ندارد"}>
          {progress.ready.toLocaleString("fa-IR")} از {progress.total.toLocaleString("fa-IR")} آماده
          {progress.activeWork
            ? ` · ${progress.activeWork.toLocaleString("fa-IR")} کار پس‌زمینه`
            : ""}
          {parts.length ? ` · ${parts.join(" · ")}` : ""}
        </span>
        <div
          className="queue-progress"
          role="progressbar"
          aria-label="پیشرفت آماده‌سازی صف"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <span style={{ width: `${progress.percent}%` }} />
        </div>
      </div>
      <button
        onClick={() => void props.onPrepare()}
        disabled={props.isPreparingNow}
        aria-busy={props.isPreparingNow}
      >
        <RefreshCw className={props.isPreparingNow ? "spin" : ""} size={15} />
        {props.isPreparingNow ? "در حال آماده‌سازی" : "الان آماده کن"}
      </button>
    </div>
  );
}

function shouldShowReadinessStatus(readiness: ReadinessStatus): boolean {
  const progress = calculateReadinessProgress(readiness);
  return (
    readiness.isPreparing ||
    progress.activeWork > 0 ||
    Boolean(readiness.failedJobs || readiness.feedsWithErrors || readiness.failedTranslations)
  );
}

function ArticleList(props: {
  articles: ArticleListItem[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  isLoading: boolean;
  viewMode: ArticleViewMode;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  selectedArticleIds: Set<string>;
  onToggleArticleSelection: (id: string, checked: boolean) => void;
  onSelectPageArticles: () => void;
  onClearSelection: () => void;
  onExportPdf: () => Promise<void>;
  isExportingPdf: boolean;
}): JSX.Element {
  if (props.isLoading) {
    return (
      <section className="article-list">
        <div className="article-list-items">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="skeleton-row" key={index} />
          ))}
        </div>
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
  const selectedCount = props.articles.filter((article) =>
    props.selectedArticleIds.has(article.id)
  ).length;
  const allPageSelected = selectedCount === props.articles.length;
  return (
    <section className="article-list" aria-label="فهرست مقاله‌ها">
      <div className="article-selection-bar">
        <span>{selectedCount.toLocaleString("fa-IR")} مقاله انتخاب شده</span>
        <div>
          <button onClick={props.onSelectPageArticles} disabled={allPageSelected}>
            <Check size={15} />
            انتخاب همه صفحه
          </button>
          <button onClick={props.onClearSelection} disabled={!selectedCount}>
            لغو انتخاب
          </button>
          <button
            className="pdf-export-button"
            onClick={() => void props.onExportPdf()}
            disabled={!selectedCount || props.isExportingPdf}
            aria-busy={props.isExportingPdf}
          >
            {props.isExportingPdf ? <Loader2 className="spin" size={15} /> : <FileDown size={15} />}
            {props.isExportingPdf ? "در حال ساخت PDF" : "خروجی PDF"}
          </button>
        </div>
      </div>
      <div className="article-list-items">
        {props.articles.map((article) => (
          <div
            key={article.id}
            className={`article-row ${props.selectedId === article.id ? "selected" : ""} ${props.selectedArticleIds.has(article.id) ? "checked" : ""} ${article.isRead ? "read" : ""}`}
          >
            <label className="article-select" onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={props.selectedArticleIds.has(article.id)}
                onChange={(event) =>
                  props.onToggleArticleSelection(article.id, event.target.checked)
                }
                aria-label={`انتخاب مقاله ${displayTitle(article, props.viewMode)}`}
              />
            </label>
            <button
              className="article-open"
              aria-pressed={props.selectedId === article.id}
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
          </div>
        ))}
      </div>
      <ArticlePagination
        page={props.page}
        pageSize={props.pageSize}
        total={props.total}
        onPageChange={props.onPageChange}
      />
    </section>
  );
}

function ArticlePagination(props: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}): JSX.Element {
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize));
  const from = props.total ? (props.page - 1) * props.pageSize + 1 : 0;
  const to = Math.min(props.page * props.pageSize, props.total);
  const pages = visiblePageNumbers(props.page, totalPages);
  return (
    <nav className="article-pagination" aria-label="صفحه‌بندی مقاله‌ها">
      <span>
        صفحه {props.page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")} ·{" "}
        {from.toLocaleString("fa-IR")} تا {to.toLocaleString("fa-IR")} از{" "}
        {props.total.toLocaleString("fa-IR")}
      </span>
      <div>
        <button
          onClick={() => props.onPageChange(props.page - 1)}
          disabled={props.page <= 1}
          aria-label="صفحه قبلی"
        >
          <ChevronRight size={15} />
          قبلی
        </button>
        {pages.map((page) => (
          <button
            key={page}
            className={page === props.page ? "active" : ""}
            aria-current={page === props.page ? "page" : undefined}
            onClick={() => props.onPageChange(page)}
          >
            {page.toLocaleString("fa-IR")}
          </button>
        ))}
        <button
          onClick={() => props.onPageChange(props.page + 1)}
          disabled={props.page >= totalPages}
          aria-label="صفحه بعدی"
        >
          بعدی
          <ChevronLeft size={15} />
        </button>
      </div>
    </nav>
  );
}

function visiblePageNumbers(page: number, totalPages: number): number[] {
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  return Array.from(pages)
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((left, right) => left - right);
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
  reloadArticle: () => Promise<void> | void;
}): JSX.Element {
  const [imagesAllowed, setImagesAllowed] = useState(false);
  const [selectionToolbar, setSelectionToolbar] = useState<ReaderSelectionState | null>(null);
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [deletingHighlightId, setDeletingHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const article = props.article;

  useEffect(() => {
    setImagesAllowed(false);
  }, [article?.id]);

  useEffect(() => {
    setSelectionToolbar(null);
    window.getSelection()?.removeAllRanges();
  }, [article?.id, props.viewMode]);

  useEffect(() => {
    const clearOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSelectionToolbar(null);
    };
    window.addEventListener("keydown", clearOnEscape);
    return () => window.removeEventListener("keydown", clearOnEscape);
  }, []);

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

  const captureSelection = useCallback((): void => {
    const pane = scrollRef.current;
    if (!article || !pane) return;
    const schedule =
      window.requestAnimationFrame ??
      ((callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0));
    schedule(() => {
      setSelectionToolbar(buildReaderSelectionState(window.getSelection(), pane, article.id));
    });
  }, [article?.id]);

  const createHighlight = async (): Promise<void> => {
    if (!article || !selectionToolbar || selectionToolbar.articleId !== article.id) return;
    const scrollTop = scrollRef.current?.scrollTop ?? null;
    setIsHighlighting(true);
    try {
      await api<Highlight>("/api/highlights", {
        method: "POST",
        body: JSON.stringify({
          articleId: article.id,
          quote: selectionToolbar.quote,
          language: selectionToolbar.language
        })
      });
      setSelectionToolbar(null);
      window.getSelection()?.removeAllRanges();
      await props.reloadArticle();
      if (scrollTop !== null) {
        const schedule =
          window.requestAnimationFrame ??
          ((callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0));
        schedule(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
        });
      }
    } finally {
      setIsHighlighting(false);
    }
  };

  const retryTranslation = async (): Promise<void> => {
    if (!article) return;
    await api<{ ok: boolean }>(`/api/articles/${article.id}/retry-translation`, {
      method: "POST",
      body: "{}"
    });
    await props.reloadArticle();
  };

  const deleteHighlight = async (highlight: Highlight): Promise<void> => {
    if (!article) return;
    setDeletingHighlightId(highlight.id);
    try {
      await api<{ ok: boolean }>(`/api/highlights/${highlight.id}`, {
        method: "DELETE",
        body: "{}"
      });
      await props.reloadArticle();
    } finally {
      setDeletingHighlightId(null);
    }
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
      onMouseUp={captureSelection}
      onKeyUp={(event) => {
        if (event.key === "Escape") {
          setSelectionToolbar(null);
          return;
        }
        captureSelection();
      }}
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
              aria-label="تغییر زبان"
              onClick={() => props.setViewMode((mode) => nextLanguageMode(mode))}
            >
              <Languages size={17} />
              {props.viewMode === "persian" ? "English" : "فارسی"}
            </button>
            <button
              className={props.viewMode === "split" ? "active" : ""}
              aria-pressed={props.viewMode === "split"}
              onClick={() => props.setViewMode("split")}
            >
              دو ستونه
            </button>
            <button
              className={article.isStarred ? "active" : ""}
              aria-pressed={article.isStarred}
              aria-label={article.isStarred ? "حذف ستاره" : "ستاره‌دار کردن"}
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

        {selectionToolbar ? (
          <div
            className="selection-toolbar"
            role="toolbar"
            aria-label="ابزار هایلایت متن انتخاب‌شده"
            style={{ top: selectionToolbar.top, left: selectionToolbar.left }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              onClick={() => void createHighlight()}
              disabled={isHighlighting}
              aria-busy={isHighlighting}
            >
              <Highlighter size={15} />
              {isHighlighting ? "در حال ذخیره" : "هایلایت"}
            </button>
          </div>
        ) : null}

        {article.highlights.length ? (
          <aside className="reader-notes">
            <h3>هایلایت‌ها</h3>
            {article.highlights.map((highlight) => (
              <div className="highlight-card" key={highlight.id}>
                <blockquote dir={highlight.language === "fa" ? "rtl" : "ltr"}>
                  {highlight.quote}
                </blockquote>
                <div className="highlight-actions">
                  <button
                    className="danger-icon-button"
                    onClick={() => void deleteHighlight(highlight)}
                    disabled={deletingHighlightId === highlight.id}
                    aria-busy={deletingHighlightId === highlight.id}
                  >
                    <Trash2 size={15} />
                    حذف هایلایت
                  </button>
                </div>
              </div>
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
  onFeedUnsubscribed: (feedId: string) => Promise<void>;
}): JSX.Element {
  const [url, setUrl] = useState("");
  const [folderName, setFolderName] = useState("");
  const [message, setMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [movingFeedId, setMovingFeedId] = useState<string | null>(null);

  const addFeed = async (): Promise<void> => {
    setMessage("در حال بررسی فید…");
    await api<Feed>("/api/feeds", { method: "POST", body: JSON.stringify({ url }) });
    setUrl("");
    setMessage("فید اضافه شد و Job دریافت ۵۰ محتوای آخر ثبت شد.");
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

  const moveFeedToFolder = async (feed: Feed, folderId: string): Promise<void> => {
    const nextFolderId = folderId || null;
    if ((feed.folderId ?? null) === nextFolderId) return;
    setMovingFeedId(feed.id);
    try {
      await api<Feed>(`/api/feeds/${feed.id}`, {
        method: "PATCH",
        body: JSON.stringify({ folderId: nextFolderId })
      });
      const folderName =
        props.folders.find((folder) => folder.id === nextFolderId)?.name ?? "بدون پوشه";
      setMessage(`فید «${feed.title}» به «${folderName}» منتقل شد.`);
      await props.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setMovingFeedId(null);
    }
  };

  const openDeleteDialog = (feed: Feed): void => {
    setDeleteTarget(feed);
    setConfirmTitle("");
    setDeleteError(null);
  };

  const closeDeleteDialog = (): void => {
    if (isDeleting) return;
    setDeleteTarget(null);
    setConfirmTitle("");
    setDeleteError(null);
  };

  const unsubscribeFeed = async (): Promise<void> => {
    if (!deleteTarget || confirmTitle !== deleteTarget.title) return;
    const feed = deleteTarget;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api(`/api/feeds/${feed.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmTitle })
      });
      setMessage(
        `اشتراک «${feed.title}» حذف شد؛ ${(feed._count?.articles ?? 0).toLocaleString("fa-IR")} مقاله قبلی باقی ماند.`
      );
      setDeleteTarget(null);
      setConfirmTitle("");
      await props.onFeedUnsubscribed(feed.id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeleting(false);
    }
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
          <div key={feed.id} className="table-row feed-row">
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
            <label className="feed-folder-select">
              <span>پوشه</span>
              <select
                value={feed.folderId ?? ""}
                onChange={(event) => void moveFeedToFolder(feed, event.target.value)}
                disabled={movingFeedId === feed.id}
                aria-label={`پوشه ${feed.title}`}
              >
                <option value="">بدون پوشه</option>
                {props.folders.map((folder) => (
                  <option value={folder.id} key={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="feed-row-actions">
              <button
                aria-label={`تازه‌سازی ${feed.title}`}
                onClick={async () => {
                  await api(`/api/feeds/${feed.id}/refresh`, { method: "POST", body: "{}" });
                  setMessage("Refresh job ثبت شد.");
                }}
              >
                <RefreshCw size={15} />
              </button>
              <button
                className="danger-icon-button"
                aria-label={`حذف فید ${feed.title}`}
                onClick={() => openDeleteDialog(feed)}
              >
                <Trash2 size={15} />
              </button>
            </div>
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
      {deleteTarget ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeleteDialog();
          }}
        >
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feed-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <Trash2 size={18} />
              <h3 id="feed-delete-title">حذف فید</h3>
            </div>
            <p>
              اشتراک «{deleteTarget.title}» حذف می‌شود و دریافت‌های بعدی متوقف خواهد شد. مقاله‌های
              قبلی، ترجمه‌ها، یادداشت‌ها و هایلایت‌ها باقی می‌مانند.
            </p>
            <dl className="feed-delete-summary">
              <div>
                <dt>URL</dt>
                <dd>{deleteTarget.feedUrl}</dd>
              </div>
              <div>
                <dt>مقاله‌های ذخیره‌شده</dt>
                <dd>{(deleteTarget._count?.articles ?? 0).toLocaleString("fa-IR")}</dd>
              </div>
            </dl>
            <label className="danger-confirm">
              <span>برای تایید، عنوان فید را دقیق وارد کنید:</span>
              <input
                autoFocus
                value={confirmTitle}
                onChange={(event) => setConfirmTitle(event.target.value)}
                placeholder={deleteTarget.title}
                disabled={isDeleting}
              />
            </label>
            {deleteError ? <p className="dialog-error">{deleteError}</p> : null}
            <div className="dialog-actions">
              <button className="quiet-action" onClick={closeDeleteDialog} disabled={isDeleting}>
                انصراف
              </button>
              <button
                className="danger-action"
                onClick={() => void unsubscribeFeed()}
                disabled={confirmTitle !== deleteTarget.title || isDeleting}
                aria-busy={isDeleting}
              >
                {isDeleting ? "در حال حذف" : "حذف اشتراک"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

function HighlightsPanel(props: {
  onOpenArticle: (articleId: string) => void;
  onHighlightDeleted: (articleId: string) => void;
}): JSX.Element {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [deletingHighlightId, setDeletingHighlightId] = useState<string | null>(null);
  useEffect(() => {
    void api<Highlight[]>("/api/highlights").then(setHighlights);
  }, []);
  const deleteHighlight = async (highlight: Highlight): Promise<void> => {
    setDeletingHighlightId(highlight.id);
    try {
      await api<{ ok: boolean }>(`/api/highlights/${highlight.id}`, {
        method: "DELETE",
        body: "{}"
      });
      setHighlights((items) => items.filter((item) => item.id !== highlight.id));
      props.onHighlightDeleted(highlight.articleId);
    } finally {
      setDeletingHighlightId(null);
    }
  };
  return (
    <section className="panel-page">
      <div className="panel-heading">
        <h2>هایلایت‌ها و یادداشت‌ها</h2>
        <p>هایلایت‌ها برای متن اصلی و ترجمه جدا ذخیره می‌شوند.</p>
      </div>
      <div className="highlight-list">
        {highlights.map((highlight) => {
          const articleTitle =
            highlight.article?.originalTitle ?? highlight.article?.title ?? "مقاله";
          return (
            <article className="highlight-card" key={highlight.id}>
              <blockquote dir={highlight.language === "fa" ? "rtl" : "ltr"}>
                {highlight.quote}
              </blockquote>
              <footer className="highlight-source">
                <span>{articleTitle}</span>
                <button
                  onClick={() => props.onOpenArticle(highlight.articleId)}
                  aria-label={`باز کردن مقاله ${articleTitle}`}
                >
                  <FileText size={15} />
                  باز کردن مقاله
                </button>
                <button
                  className="danger-icon-button"
                  onClick={() => void deleteHighlight(highlight)}
                  disabled={deletingHighlightId === highlight.id}
                  aria-busy={deletingHighlightId === highlight.id}
                >
                  <Trash2 size={15} />
                  حذف هایلایت
                </button>
              </footer>
            </article>
          );
        })}
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
  updateSettings: (patch: SettingsPatchInput) => Promise<ApiSettings>;
  reload: () => Promise<void>;
}): JSX.Element {
  const update = async (patch: SettingsPatchInput): Promise<void> => {
    await props.updateSettings(patch);
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
      <button
        className={props.value ? "on" : ""}
        aria-pressed={props.value}
        onClick={() => props.onChange(!props.value)}
      >
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

export function calculateReadinessProgress(readiness: ReadinessStatus): QueueProgress {
  const total = readiness.unreadCount;
  const ready = Math.min(readiness.readyUnreadCount, total);
  const percent = total ? Math.round((ready / total) * 100) : 100;
  const activeWork =
    readiness.pendingJobs +
    readiness.runningJobs +
    readiness.pendingTranslations +
    readiness.processingTranslations +
    readiness.pendingImageCaches;
  return { total, ready, percent, activeWork };
}

export function readinessText(readiness: ReadinessStatus, fallback: string): string {
  const progress = calculateReadinessProgress(readiness);
  if (readiness.isPreparing) {
    return `${progress.ready.toLocaleString("fa-IR")} از ${progress.total.toLocaleString("fa-IR")} آماده · ${progress.percent.toLocaleString("fa-IR")}٪ · ${progress.activeWork.toLocaleString("fa-IR")} کار پس‌زمینه`;
  }
  if (progress.total)
    return `${progress.ready.toLocaleString("fa-IR")} از ${progress.total.toLocaleString("fa-IR")} آماده · ${progress.percent.toLocaleString("fa-IR")}٪`;
  if (progress.activeWork)
    return `صف آماده‌سازی فعال · ${progress.activeWork.toLocaleString("fa-IR")} کار پس‌زمینه`;
  return fallback;
}

export function calculateSelectionToolbarPosition(
  rangeRect: Pick<DOMRect, "left" | "right" | "top" | "width" | "height">,
  paneRect: Pick<DOMRect, "left" | "top">,
  pane: SelectionToolbarPositionSource,
  toolbarWidth = 132
): Pick<ReaderSelectionState, "top" | "left"> {
  const rectWidth = rangeRect.width || Math.max(0, rangeRect.right - rangeRect.left);
  const centerLeft = rangeRect.left - paneRect.left + pane.scrollLeft + rectWidth / 2;
  const halfToolbar = toolbarWidth / 2;
  const minLeft = halfToolbar + 8;
  const maxLeft = Math.max(minLeft, pane.clientWidth - halfToolbar - 8);
  return {
    top: Math.max(48, rangeRect.top - paneRect.top + pane.scrollTop - 10),
    left: Math.min(maxLeft, Math.max(minLeft, centerLeft))
  };
}

export function detectSelectionLanguage(prose: Element): HighlightLanguage {
  const dir = prose.getAttribute("dir");
  if (prose.classList.contains("article-prose-fa") || dir === "rtl") return "fa";
  return "en";
}

export function buildReaderSelectionState(
  selection: Selection | null,
  pane: HTMLElement,
  articleId: string
): ReaderSelectionState | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const quote = selection.toString().trim();
  if (!quote) return null;

  const range = selection.getRangeAt(0);
  const anchorProse = closestProse(selection.anchorNode ?? range.commonAncestorContainer);
  const focusProse = closestProse(selection.focusNode ?? range.commonAncestorContainer);
  if (!anchorProse || !focusProse || anchorProse !== focusProse || !pane.contains(anchorProse)) {
    return null;
  }

  const rangeRect = usefulRangeRect(range);
  if (!rangeRect) return null;
  const paneRect = pane.getBoundingClientRect();
  const position = calculateSelectionToolbarPosition(rangeRect, paneRect, {
    scrollTop: pane.scrollTop,
    scrollLeft: pane.scrollLeft,
    clientWidth: pane.clientWidth
  });
  return {
    articleId,
    quote,
    language: detectSelectionLanguage(anchorProse),
    ...position
  };
}

function closestProse(node: Node | null): Element | null {
  const element = elementFromNode(node);
  return element?.closest(".article-prose") ?? null;
}

function elementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

function usefulRangeRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  const rect = rects[0] ?? range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
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
