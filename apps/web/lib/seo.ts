export const CANONICAL_SITE_URL = "https://velloagents.com";
// "Vello Agents" (matches the velloagents.com domain) is the primary brand
// name. Plain "Vello" / "Vello AI" collide with an unrelated, older company
// (vello.ai), so leading with those made Google fold us into their entity.
export const SITE_NAME = "Vello Agents";
// Alternate brand spellings people actually type into Google. Feeds the
// Organization/WebSite structured data so Google ties them to this domain.
export const SITE_ALTERNATE_NAMES = ["Vello", "VelloAgents", "Vello Agents AI", "vello.gg"];
// Official social profiles + the legacy domain — schema.org `sameAs` entity
// signals. vello.gg 301s here; listing it tells Google both are one brand.
export const SOCIAL_LINKS = [
  "https://x.com/velloagents",
  "https://www.linkedin.com/company/velloagents",
  "https://vello.gg",
];

// Google Search Console ownership token — public by design (it's rendered into
// the page HTML), so hardcoding is safe. Env var wins if set.
export const GOOGLE_SITE_VERIFICATION =
  process.env.GOOGLE_SITE_VERIFICATION ?? "7XuXm_1IhdvfewYl5xbLpNIIatiRFVFk2rCTCGb1Ry4";

// Lead with the distinct brand, then state the product category and outcome.
// Google can rewrite title links; this is a clear on-page signal, not a rank guarantee.
export const HOME_TITLE = "Vello Agents: AI Video Clipper That Posts for You";
// Brand + action + outcome + CTA, written for a human search result.
export const HOME_DESCRIPTION =
  "Vello Agents turns long videos into captioned shorts and posts them to TikTok, Reels and YouTube Shorts. Paste a link and try your first 3 videos free.";

// Per-product copy — reused by section pages, OG cards, and structured data so
// the story stays identical everywhere Google reads it.
export const PRODUCT_INFLUENCER = {
  name: "Vello Creator Agents",
  // Kept under ~45 chars so " | Vello Agents" still fits Google's ~60-char title.
  title: "Creator Agents: Faceless Channels on Autopilot",
  description:
    "Describe a creator and Vello Agents builds the persona, face, and voice, then films and posts short videos to TikTok, Reels, and Shorts every day.",
  path: "/ai-influencer",
} as const;

export const PRODUCT_CLIPPING = {
  name: "Vello Shorts Agent",
  title: "Long Video to Shorts, Captioned and Posted",
  description:
    "Drop in any long video. Vello Agents finds the best moments, cuts vertical shorts with captions, hooks, and music, and posts them everywhere. An OpusClip alternative that never stops posting.",
  path: "/clipping",
} as const;

export const HOME_KEYWORDS = [
  "Vello",
  "Vello Agents",
  "VelloAgents",
  "Vello AI video clipper",
  "vello.gg",
  "long video to shorts",
  "YouTube to Shorts",
  "podcast to shorts",
  "video repurposing",
  "viral shorts maker",
  "auto post shorts",
  "TikTok Reels Shorts automation",
  "OpusClip alternative",
];

// Primary public pages — mirrors the landing <nav> labels/URLs exactly and
// feeds the SiteNavigationElement structured data. Consistent nav text + URLs
// across the HTML menu, footer, and this list is what Google uses to pick the
// sitelinks ("menu") shown under the brand result.
export const SITE_NAV = [
  { name: "Shorts Agent", path: "/clipping" },
  { name: "Creator Agents", path: "/ai-influencer" },
  { name: "Pricing", path: "/pricing" },
  { name: "Marketplace", path: "/agents" },
  { name: "Agencies", path: "/docs/scale" },
  { name: "Blog", path: "/blog" },
  { name: "Docs", path: "/docs" },
] as const;

export function canonicalUrl(path = "/"): string {
  return new URL(path, CANONICAL_SITE_URL).toString();
}
