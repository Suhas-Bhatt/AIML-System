import { categories, getCategoryArticles } from '../content/docs/index.js';

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aural-ai.com";

export default function sitemap() {
  const staticPages = [
    { url: siteUrl, changeFrequency: "weekly", priority: 1.0 },
    { url: `${siteUrl}/docs`, changeFrequency: "weekly", priority: 0.8 },
  ];

  const docsPages = categories.flatMap((category) => {
    const categoryEntry = {
      url: `${siteUrl}/docs/${category.slug}`,
      changeFrequency: "weekly",
      priority: 0.6,
    };

    const articleEntries = getCategoryArticles(category.slug).map(
      (article) => ({
        url: `${siteUrl}/docs/${category.slug}/${article.slug}`,
        changeFrequency: "weekly",
        priority: 0.5,
      })
    );

    return [categoryEntry, ...articleEntries];
  });

  return [...staticPages, ...docsPages];
}
