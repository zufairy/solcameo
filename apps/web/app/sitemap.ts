import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/seo";
import { BLOG_POSTS } from "@/lib/blog-posts";

// Keep the sitemap focused on stable, public landing and editorial pages.
// Agent profiles remain discoverable through the marketplace's internal links;
// listing hundreds of near-empty profiles here diluted the useful URLs.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: canonicalUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: canonicalUrl("/pricing"), changeFrequency: "weekly", priority: 0.95 },
    { url: canonicalUrl("/about"), changeFrequency: "monthly", priority: 0.9 },
    { url: canonicalUrl("/builder"), changeFrequency: "weekly", priority: 0.9 },
    { url: canonicalUrl("/clipping"), changeFrequency: "weekly", priority: 0.9 },
    { url: canonicalUrl("/ai-influencer"), changeFrequency: "weekly", priority: 0.8 },
    { url: canonicalUrl("/vs/opusclip"), changeFrequency: "monthly", priority: 0.75 },
    { url: canonicalUrl("/vs/klap"), changeFrequency: "monthly", priority: 0.7 },
    { url: canonicalUrl("/vs/munch"), changeFrequency: "monthly", priority: 0.7 },
    { url: canonicalUrl("/vs/vizard"), changeFrequency: "monthly", priority: 0.7 },
    { url: canonicalUrl("/blog"), changeFrequency: "weekly", priority: 0.7 },
    ...BLOG_POSTS.map((post) => ({
      url: canonicalUrl(`/blog/${post.slug}`),
      lastModified: new Date(post.date),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    { url: canonicalUrl("/market"), changeFrequency: "daily", priority: 0.9 },
    { url: canonicalUrl("/agents"), changeFrequency: "daily", priority: 0.8 },
    { url: canonicalUrl("/node"), changeFrequency: "weekly", priority: 0.8 },
    { url: canonicalUrl("/hiring"), changeFrequency: "weekly", priority: 0.8 },
    { url: canonicalUrl("/stage"), changeFrequency: "daily", priority: 0.7 },
    { url: canonicalUrl("/arena"), changeFrequency: "weekly", priority: 0.65 },
    { url: canonicalUrl("/tournament"), changeFrequency: "daily", priority: 0.6 },
    { url: canonicalUrl("/docs"), changeFrequency: "weekly", priority: 0.7 },
    { url: canonicalUrl("/docs/start"), changeFrequency: "weekly", priority: 0.65 },
    { url: canonicalUrl("/docs/build"), changeFrequency: "weekly", priority: 0.65 },
    { url: canonicalUrl("/docs/sell"), changeFrequency: "weekly", priority: 0.65 },
    { url: canonicalUrl("/docs/scale"), changeFrequency: "weekly", priority: 0.65 },
  ];
}
