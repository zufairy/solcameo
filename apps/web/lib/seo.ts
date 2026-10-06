export const CANONICAL_SITE_URL = "https://solcameo.com";
// "Solcameo" (matches the velloagents.com domain) is the primary brand
// name. Plain "Vello" / "Vello AI" collide with an unrelated, older company
// (vello.ai), so leading with those made Google fold us into their entity.
export const SITE_NAME = "Solcameo";
// Alternate brand spellings people actually type into Google. Feeds the
// Organization/WebSite structured data so Google ties them to this domain.
// Must differ from SITE_NAME: Google ignores an alternate name that repeats the main one.
export const SITE_ALTERNATE_NAMES = ["Sol Cameo"];
export const SOCIAL_LINKS: string[] = [];

// Google Search Console ownership token — public by design (it's rendered into
// the page HTML), so hardcoding is safe. Env var wins if set.
export const GOOGLE_SITE_VERIFICATION =
  process.env.GOOGLE_SITE_VERIFICATION;

// Lead with the distinct brand, then state the product category and outcome.
// Google can rewrite title links; this is a clear on-page signal, not a rank guarantee.
export const HOME_TITLE = "Solcameo | AI Influencers and Token Launchpad on Solana";
export const HOME_DESCRIPTION = "Create AI influencers, generate character videos, and launch tokens on Solana. Discover creators, explore their content, and follow the Solcameo market.";

// Per-product copy — reused by section pages, OG cards, and structured data so
// the story stays identical everywhere Google reads it.
export const PRODUCT_INFLUENCER = {
  name: "Solcameo AI Influencers",
  // Kept under ~45 chars so " | Solcameo" still fits Google's ~60-char title.
  title: "AI Influencer Builder",
  description:
    "Describe a creator and Solcameo builds the persona, face, and voice, then films and posts short videos to TikTok, Reels, and Shorts every day.",
  path: "/create",
} as const;

export const PRODUCT_CLIPPING = {
  name: "Solcameo Video Studio",
  title: "Long Video to Shorts, Captioned and Posted",
  description:
    "Drop in any long video. Solcameo finds the best moments, cuts vertical shorts with captions, hooks, and music, and posts them everywhere. An OpusClip alternative that never stops posting.",
  path: "/clipping",
} as const;

export const HOME_KEYWORDS = ["Solcameo", "AI influencers", "Solana token launchpad", "AI character videos", "AI agents", "Meteora DBC"];
export const SITE_NAV = [
  { name: "Feed", path: "/" }, { name: "Market", path: "/market" },
  { name: "Explore", path: "/explore" }, { name: "Create AI Influencer", path: "/create" },
  { name: "Agents", path: "/agents" },
] as const;

/** Metadata text never carries em or en dashes; swap them for plain punctuation. */
export function cleanText(text: string): string {
  return text.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s{2,}/g, " ").trim();
}

export function canonicalUrl(path = "/"): string {
  return new URL(path, CANONICAL_SITE_URL).toString();
}
