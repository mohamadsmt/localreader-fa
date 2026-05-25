-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Feed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "siteUrl" TEXT,
    "feedUrl" TEXT NOT NULL,
    "faviconUrl" TEXT,
    "description" TEXT,
    "refreshIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "fetchFullContent" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" DATETIME,
    "nextCheckAt" DATETIME,
    "lastError" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "etag" TEXT,
    "lastModified" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Feed_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT NOT NULL,
    "guid" TEXT,
    "url" TEXT,
    "canonicalUrl" TEXT,
    "urlHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "originalHtml" TEXT,
    "originalText" TEXT NOT NULL,
    "originalExcerpt" TEXT,
    "originalImageUrl" TEXT,
    "rawFeedItemJson" TEXT,
    "translatedTitleFa" TEXT,
    "translatedBodyFaMarkdown" TEXT,
    "translatedSummaryFa" TEXT,
    "sourceLanguage" TEXT,
    "targetLanguage" TEXT NOT NULL DEFAULT 'fa',
    "translationStatus" TEXT NOT NULL DEFAULT 'pending',
    "translationError" TEXT,
    "translatedAt" DATETIME,
    "translationModel" TEXT,
    "translationProgressJson" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isReadLater" BOOLEAN NOT NULL DEFAULT false,
    "readingProgress" REAL NOT NULL DEFAULT 0,
    "lastReadAt" DATETIME,
    CONSTRAINT "Article_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ArticleTag" (
    "articleId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("articleId", "tagId"),
    CONSTRAINT "ArticleTag_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Highlight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Highlight_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "highlightId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Note_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Note_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "Highlight" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "queryJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "conditionsJson" TEXT NOT NULL,
    "actionsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadJson" TEXT NOT NULL,
    "lastError" TEXT,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "valueJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FetchLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FetchLog_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Folder_name_key" ON "Folder"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Feed_feedUrl_key" ON "Feed"("feedUrl");

-- CreateIndex
CREATE INDEX "Feed_folderId_idx" ON "Feed"("folderId");

-- CreateIndex
CREATE INDEX "Feed_nextCheckAt_idx" ON "Feed"("nextCheckAt");

-- CreateIndex
CREATE INDEX "Article_feedId_idx" ON "Article"("feedId");

-- CreateIndex
CREATE INDEX "Article_publishedAt_idx" ON "Article"("publishedAt");

-- CreateIndex
CREATE INDEX "Article_translationStatus_idx" ON "Article"("translationStatus");

-- CreateIndex
CREATE INDEX "Article_isRead_isStarred_isArchived_isReadLater_idx" ON "Article"("isRead", "isStarred", "isArchived", "isReadLater");

-- CreateIndex
CREATE UNIQUE INDEX "Article_feedId_urlHash_key" ON "Article"("feedId", "urlHash");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Highlight_articleId_idx" ON "Highlight"("articleId");

-- CreateIndex
CREATE INDEX "Note_articleId_idx" ON "Note"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_name_key" ON "SavedSearch"("name");

-- CreateIndex
CREATE INDEX "Job_type_status_runAfter_idx" ON "Job"("type", "status", "runAfter");

-- CreateIndex
CREATE INDEX "FetchLog_feedId_idx" ON "FetchLog"("feedId");

-- CreateIndex
CREATE INDEX "FetchLog_createdAt_idx" ON "FetchLog"("createdAt");
