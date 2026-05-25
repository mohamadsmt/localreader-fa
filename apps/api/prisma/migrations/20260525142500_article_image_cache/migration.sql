ALTER TABLE "Article" ADD COLUMN "originalImageLocalUrl" TEXT;
ALTER TABLE "Article" ADD COLUMN "imageCacheStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Article" ADD COLUMN "imageCacheError" TEXT;
ALTER TABLE "Article" ADD COLUMN "imageCachedAt" DATETIME;
