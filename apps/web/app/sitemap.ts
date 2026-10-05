import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/seo";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/market", "/explore", "/create", "/agents", "/builder"].map(path => ({ url: canonicalUrl(path), changeFrequency: "daily", priority: path === "/" ? 1 : 0.8 }));
}
