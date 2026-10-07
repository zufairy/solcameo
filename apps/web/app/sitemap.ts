import type { MetadataRoute } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { BLOG_POSTS, blogCoverPath } from "@/lib/blog-posts";
import { canonicalUrl } from "@/lib/seo";

export const revalidate = 3600;

const PAGES: Array<[string, number]> = [
  ["/", 1], ["/market", 0.9], ["/explore", 0.9], ["/create", 0.9], ["/how-it-works", 0.9], ["/clipping", 0.6], ["/agents", 0.8],
  ["/about", 0.6], ["/docs", 0.6], ["/tokenomics", 0.6], ["/blog", 0.8], ["/vs/opusclip", 0.5], ["/vs/klap", 0.5], ["/vs/munch", 0.5], ["/vs/vizard", 0.5],
];

/** Confirmed live characters get their own indexable market URL. */
async function liveCharacters(): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return [];
  const convex = new ConvexHttpClient(url);
  const results = await Promise.all(((process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "").toLowerCase().startsWith("mainnet") ? ["mainnet"] as const : ["mainnet", "devnet"] as const).map(network =>
    convex.query(api.solstarMarket.listMarket, { sort: "new", network, liveOnly: true }).catch(() => [])));
  return results.flat().map(r => `/market/${r.characterId}`);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const characters = await liveCharacters();
  return [
    ...PAGES.map(([path, priority]) => ({ url: canonicalUrl(path), lastModified: now, changeFrequency: "daily" as const, priority, images: [canonicalUrl("/og-solcameo.jpg"), ...(path === "/" ? [canonicalUrl("/logo.png")] : [])] })),
    ...BLOG_POSTS.map(p => ({ url: canonicalUrl(`/blog/${p.slug}`), lastModified: new Date(p.updated ?? p.date), changeFrequency: "monthly" as const, priority: 0.7, images: [canonicalUrl(blogCoverPath(p.slug))] })),
    ...characters.map(path => ({ url: canonicalUrl(path), lastModified: now, changeFrequency: "daily" as const, priority: 0.7 })),
  ];
}
