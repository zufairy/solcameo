import type { MetadataRoute } from "next";
import { CANONICAL_SITE_URL, canonicalUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private/operational surfaces — crawling them wastes budget and
        // they require auth anyway.
        disallow: ["/admin", "/api/", "/studio", "/wallet", "/profile", "/workers/dashboard"],
      },
    ],
    sitemap: canonicalUrl("/sitemap.xml"),
    host: CANONICAL_SITE_URL,
  };
}
