import { prisma, rebuildArticleSearch } from "./db.js";
import { paths } from "./config/env.js";

async function main(): Promise<void> {
  const folder = await prisma.folder.upsert({
    where: { name: "نمونه‌ها" },
    create: { name: "نمونه‌ها" },
    update: {}
  });
  const feed = await prisma.feed.upsert({
    where: { feedUrl: "https://example.com/localreader-fa/sample.json" },
    create: {
      title: "LocalReader Sample",
      feedUrl: "https://example.com/localreader-fa/sample.json",
      siteUrl: "https://example.com",
      description: "A local seeded feed for testing the reader.",
      folderId: folder.id,
      lastCheckedAt: new Date(),
      nextCheckAt: new Date(Date.now() + 60 * 60 * 1000)
    },
    update: { folderId: folder.id }
  });
  const tag = await prisma.tag.upsert({ where: { name: "sample" }, create: { name: "sample" }, update: {} });
  const article = await prisma.article.upsert({
    where: { feedId_urlHash: { feedId: feed.id, urlHash: "seed-localreader-fa" } },
    create: {
      feedId: feed.id,
      guid: "seed-1",
      urlHash: "seed-localreader-fa",
      url: "https://example.com/localreader-fa/article",
      canonicalUrl: "https://example.com/localreader-fa/article",
      title: "Designing quiet software for long-form reading",
      originalTitle: "Designing quiet software for long-form reading",
      author: "LocalReader Team",
      publishedAt: new Date(),
      originalHtml:
        "<h2>A calm reader</h2><p>LocalReader FA keeps feed reading private, searchable, and comfortable for long sessions.</p><pre><code>const mode = 'local-first'</code></pre>",
      originalText:
        "A calm reader. LocalReader FA keeps feed reading private, searchable, and comfortable for long sessions.",
      originalExcerpt: "LocalReader FA keeps feed reading private, searchable, and comfortable.",
      translatedTitleFa: "طراحی نرم‌افزار آرام برای خواندن طولانی",
      translatedBodyFaMarkdown:
        "## یک خواننده آرام\n\nLocalReader FA خواندن فید را خصوصی، قابل جستجو و برای نشست‌های طولانی راحت نگه می‌دارد.\n\n```ts\nconst mode = 'local-first'\n```",
      translatedSummaryFa: "LocalReader FA خواندن فید را خصوصی و راحت نگه می‌دارد.",
      sourceLanguage: "en",
      targetLanguage: "fa",
      translationStatus: "completed",
      translatedAt: new Date(),
      translationModel: "mock-seed"
    },
    update: {}
  });
  await prisma.articleTag.upsert({
    where: { articleId_tagId: { articleId: article.id, tagId: tag.id } },
    create: { articleId: article.id, tagId: tag.id },
    update: {}
  });
  await rebuildArticleSearch();
  console.log(`Seeded LocalReader FA at ${paths.databasePath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
