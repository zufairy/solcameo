/* ════════ Share on X — card themes + post copy (pure) ════════
   Everything that decides WHAT a share card looks like and says lives here, free
   of React / Node, so the renderer (lib/server/xShareCardRender.tsx), the API
   routes, the /dev/x-cards gallery and the tests all agree.

   Design language: VELLO MEMBERSHIP — a premium, minimal card system in the
   spirit of a charge-card family. Each reach tier is its own MATERIAL, not a
   colour swap: matte graphite, brushed silver, gold, iridescent platinum, and
   the invite-only VELLO BLACK (1B+ tracked views). The "digital" signature is
   the custom pixel V mark and a 5×7 pixel-matrix view counter.

   A card is seeded by (agent mint, views, identity, shuffle nonce): the same
   inputs always redraw the same card; a new nonce reshuffles the composition. */

export interface ShareStats {
  name: string;
  handle?: string | null;
  views: number;
  videos: number;
  posted: number;
  bestViews: number;
  platforms: string[];
}

/** Where the card sits in the 1200×675 frame. */
export type ShareLayout = "panelRight" | "panelLeft" | "centered";
export type ShareMaterial = "graphite" | "silver" | "gold" | "platinum" | "black";
/** Baked texture on the card face. */
export type SharePattern = "dots" | "brushed" | "lines" | "rosette";

export interface ShareCardFace {
  /** Diagonal gradient stops for the card body. */
  stops: string[];
  /** Text on the card. */
  ink: string;
  inkMuted: string;
  /** Pixel V emblem colour. */
  emblem: string;
  /** Hairline edge stroke. */
  edge: string;
  /** Chip gradient. */
  chip: [string, string];
  pattern: SharePattern;
  patternColor: string;
  /** feTurbulence baseFrequency ("x y") + alpha — the material grain. */
  noise: string;
  noiseAlpha: number;
  /** Peak opacity of the light sweep. */
  sheen: number;
}

export interface ShareTier {
  min: number;
  label: string;
  zone: string;
  /** Aspirational sign-off — pull toward the next tier, no invented stats. */
  tagline: string;
  material: ShareMaterial;
  /** Frame accent: pixel counter, tier line. */
  accent: string;
  /** Frame background + the soft light behind the card. */
  bg: string;
  glow: string;
  card: ShareCardFace;
}

export interface ShareSparkle { x: number; y: number; phase: number; size: number }

export interface ShareVariant {
  seed: number;
  layout: ShareLayout;
  tier: ShareTier;
  /** Card tilt in degrees (0 when centered). */
  angle: number;
  /** Deterministic 6-digit member number. */
  memberId: string;
  /** Twinkle points on the card face (gold uses them; others ignore). */
  sparkles: ShareSparkle[];
}

/** Membership tiers, lowest first. 1B+ tracked views earns VELLO BLACK. */
export const SHARE_TIERS: ShareTier[] = [
  {
    min: 0, label: "MEMBER", zone: "Vello Access", tagline: "The count has started.", material: "graphite",
    accent: "#EDEDEA", bg: "#07070A", glow: "rgba(255,255,255,0.07)",
    card: {
      stops: ["#2c2d31", "#1b1c1f", "#111214", "#1d1e21"], ink: "#F1F1EF", inkMuted: "rgba(241,241,239,0.45)",
      emblem: "#F1F1EF", edge: "rgba(255,255,255,0.16)", chip: ["#8e8e8e", "#e2e2e2"],
      pattern: "dots", patternColor: "rgba(255,255,255,0.09)", noise: "0.8 0.8", noiseAlpha: 0.07, sheen: 0.14,
    },
  },
  {
    min: 100_000, label: "SILVER", zone: "Verified Reach", tagline: "Verified. Now keep climbing.", material: "silver",
    accent: "#D8DCE2", bg: "#060709", glow: "rgba(190,205,225,0.11)",
    card: {
      stops: ["#a6aab0", "#e8eaed", "#c0c4c9", "#f5f6f8", "#aaaeb4"], ink: "#16181b", inkMuted: "rgba(22,24,27,0.52)",
      emblem: "#16181b", edge: "rgba(255,255,255,0.55)", chip: ["#a9884a", "#f1dca6"],
      pattern: "brushed", patternColor: "rgba(0,0,0,0)", noise: "0.002 0.75", noiseAlpha: 0.22, sheen: 0.6,
    },
  },
  {
    min: 1_000_000, label: "GOLD", zone: "Certified Creator", tagline: "Certified. Not everyone gets here.", material: "gold",
    accent: "#E4C47E", bg: "#080705", glow: "rgba(226,180,90,0.14)",
    card: {
      stops: ["#a47829", "#e5c378", "#c59846", "#f3dda6", "#b1823a"], ink: "#2a1a05", inkMuted: "rgba(42,26,5,0.58)",
      emblem: "#2a1a05", edge: "rgba(255,240,200,0.55)", chip: ["#6f521c", "#d7b267"],
      pattern: "lines", patternColor: "rgba(255,245,215,0.16)", noise: "0.9 0.9", noiseAlpha: 0.08, sheen: 0.5,
    },
  },
  {
    min: 10_000_000, label: "PLATINUM", zone: "Elite Circle", tagline: "One step from Black.", material: "platinum",
    accent: "#D2CBF7", bg: "#06060A", glow: "rgba(170,160,255,0.12)",
    card: {
      stops: ["#dde2ea", "#f4f1f9", "#e1eeed", "#f2ece0", "#dbe0ea"], ink: "#14161a", inkMuted: "rgba(20,22,26,0.5)",
      emblem: "#14161a", edge: "rgba(255,255,255,0.7)", chip: ["#a9884a", "#f1dca6"],
      pattern: "rosette", patternColor: "rgba(40,45,70,0.10)", noise: "0.7 0.7", noiseAlpha: 0.05, sheen: 0.55,
    },
  },
  {
    min: 1_000_000_000, label: "VELLO BLACK", zone: "Invite Only", tagline: "By invitation only.", material: "black",
    accent: "#CDAE6E", bg: "#030303", glow: "rgba(205,174,110,0.09)",
    card: {
      stops: ["#151517", "#08080a", "#0e0e10", "#050506"], ink: "#ECE6D8", inkMuted: "rgba(236,230,216,0.42)",
      emblem: "#CDAE6E", edge: "rgba(205,174,110,0.55)", chip: ["#86692f", "#e8cf95"],
      pattern: "rosette", patternColor: "rgba(205,174,110,0.13)", noise: "0.9 0.9", noiseAlpha: 0.06, sheen: 0.12,
    },
  },
];

export function tierFor(views: number): ShareTier {
  let tier = SHARE_TIERS[0];
  for (const t of SHARE_TIERS) if (views >= t.min) tier = t;
  return tier;
}

/** The honest FOMO line: the next tier and how far along this agent really is.
 *  `progress` is views-in-band / band-width, 0..1. Null at the top tier. */
export function nextTierFor(views: number): { tier: ShareTier; progress: number } | null {
  const current = tierFor(views);
  const next = SHARE_TIERS.find((t) => t.min > current.min);
  if (!next) return null;
  const progress = Math.max(0, Math.min(1, (views - current.min) / (next.min - current.min)));
  return { tier: next, progress };
}

/** FNV-1a — tiny, stable across runtimes. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — deterministic PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CARD_W = 1200;
export const CARD_H = 675;
/** The physical card inside the frame — ISO/IEC 7810 ID-1 proportions (1.586). */
export const FACE_W = 500;
export const FACE_H = 316;

/** Animated export: frame count × per-frame delay = one loop. */
export const SHARE_FRAMES = 36;
export const SHARE_FRAME_MS = 100;

/** Deterministic 6-digit member number — stable per agent, not per nonce. */
export function memberIdFor(mint: string): string {
  return String(hashSeed(mint, "member") % 1_000_000).padStart(6, "0");
}

export function pickVariant(mint: string, views: number, nonce: string | number = 0, identity = ""): ShareVariant {
  const seed = hashSeed(mint, views, identity, nonce);
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[], salt: string): T => xs[hashSeed(seed, salt) % xs.length];
  const layout = pick<ShareLayout>(["panelRight", "panelLeft", "centered"], "layout");
  const tilt = 2 + Math.round(r() * 3);
  const angle = layout === "centered" ? 0 : layout === "panelLeft" ? tilt : -tilt;
  const sparkles: ShareSparkle[] = Array.from({ length: 7 }, () => ({
    x: Math.round(40 + r() * (FACE_W - 80)),
    y: Math.round(30 + r() * (FACE_H - 60)),
    phase: r(),
    size: 3 + Math.round(r() * 2),
  }));
  return { seed, layout, tier: tierFor(views), angle, memberId: memberIdFor(mint), sparkles };
}

/** 1234 → "1.2K", 1_250_000 → "1.3M". Keeps small numbers exact. */
export function compactNumber(n: number): string {
  const v = Math.max(0, Math.round(n || 0));
  if (v < 1000) return String(v);
  const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) {
    if (v >= size) {
      const scaled = v / size;
      const text = scaled >= 100 ? Math.round(scaled).toString() : scaled.toFixed(1).replace(/\.0$/, "");
      return `${text}${suffix}`;
    }
  }
  return String(v);
}

export const PLATFORM_NAMES: Record<string, string> = {
  tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram", threads: "Threads", x: "X", twitter: "X",
  facebook: "Facebook", linkedin: "LinkedIn", pinterest: "Pinterest", bluesky: "Bluesky", reddit: "Reddit",
};

export function platformName(id: string): string {
  return PLATFORM_NAMES[id.toLowerCase()] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Unique, display-ready platform names ("twitter" and "x" collapse to one X). */
export function platformNames(ids: string[]): string[] {
  return [...new Set(ids.map(platformName))];
}

/* ── Post copy ──────────────────────────────────────────────────────────────── */

// Leave room for X's t.co link accounting and Upload-Post's 275-char x_title cap.
export const X_POST_LIMIT = 270;
export const SHARE_LINK = "https://velloagents.com/market";

export function marketLinkFor(mint: string): string {
  return `${SHARE_LINK}/${encodeURIComponent(mint)}`;
}

/** No em/en dashes, ever (house style), no smart-quote junk, tidy spacing. */
export function sanitizePostText(raw: string): string {
  return raw
    .replace(/\s*[—–―‒]\s*/g, ", ")
    .replace(/\s+--\s+/g, ", ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*,/g, ",")
    .replace(/ +\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

/** Sanitize + guarantee the correct agent marketplace link is the final line. */
export function finalizePostText(raw: string, mint: string): string {
  const link = marketLinkFor(mint);
  let body = sanitizePostText(raw)
    .replace(/(?:https?:\/\/)?(?:www\.)?velloagents\.com(?:\/[^\s]*)?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const room = X_POST_LIMIT - link.length - 2;
  if (body.length > room) {
    const cut = body.slice(0, room);
    body = cut.slice(0, cut.lastIndexOf(" ") > room * 0.6 ? cut.lastIndexOf(" ") : room).replace(/[\s,.;:]+$/, "");
  }
  return body ? `${body}\n\n${link}` : link;
}

/** Browser-account sharing is a user-reviewed X composer, never an API post. */
export function browserXIntentFor(raw: string, mint: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(finalizePostText(raw, mint))}`;
}

/** Deterministic, human-sounding fallback when the LLM is unavailable. */
export function fallbackPostText(stats: ShareStats, seed: number, mint: string): string {
  const views = compactNumber(stats.views);
  const plats = platformNames(stats.platforms);
  const where = plats.length ? ` across ${plats.slice(0, 3).join(", ")}` : "";
  const name = stats.name;
  const templates = stats.views > 0
    ? [
        `${name} is at ${views} tracked views${where}.\n\nThis is what building an AI creator in public looks like. Come meet it and tell me what it should make next.`,
        `${views} views for ${name}${where}.\n\nOne agent, a growing feed, and a lot more to test. Want to see what it makes next?`,
        `Quiet update: ${name} has ${stats.videos} videos in its feed and ${views} tracked views${where}.\n\nCome follow the experiment. Which niche should it try?`,
        `${stats.posted} posted clips, ${views} tracked views${where}.\n\nBuilding ${name} one experiment at a time. Come meet the agent and suggest its next move.`,
      ]
    : [
        `0 tracked views so far for ${name}.\n\nEvery creator starts somewhere. Come meet the agent and pick its ${stats.videos ? "next" : "first"} video idea.`,
        `Meet ${name}. The scoreboard starts at 0 views.\n\nI am building this AI creator in public. Join the experiment and tell me what it should try.`,
      ];
  return finalizePostText(templates[seed % templates.length], mint);
}

export function postPrompt(stats: ShareStats): { system: string; user: string } {
  const plats = platformNames(stats.platforms);
  const system =
    "You write one organic X (Twitter) post for a creator sharing a milestone card of their AI content agent. " +
    "Goal: real organic growth, so it must read like a genuine person, not an ad. " +
    "Rules: first line is a scroll-stopping hook built on a concrete number; short lines with line breaks; " +
    "casual, confident, a little proud, curious; no em dashes or en dashes at all (use commas or periods); " +
    "no emoji and no hashtags; never say 'excited to announce'; " +
    "do not invent numbers, publishing claims or milestones beyond the ones given; describe views as tracked views; " +
    "if there are zero views or zero posts, be honest about the fresh start; invite readers to meet this agent and suggest its next creative move; " +
    "build curiosity and a sense of joining a real experiment, never fake urgency or overpromise; end with a soft question or open loop that invites replies; " +
    "do NOT include any link (the agent marketplace URL is appended automatically). Stay under 175 characters. " +
    'Return ONLY JSON { "post": "..." }.';
  const user =
    `Agent name: ${stats.name}${stats.handle ? ` (@${stats.handle})` : ""}\n` +
    `Total views: ${stats.views.toLocaleString("en-US")} (${compactNumber(stats.views)})\n` +
    `Videos made: ${stats.videos}\nVideos posted: ${stats.posted}\n` +
    `Best single video: ${stats.bestViews.toLocaleString("en-US")} views\n` +
    `Posting to: ${plats.length ? plats.join(", ") : "not connected yet"}\n` +
    `Membership tier: ${tierFor(stats.views).label}\n` +
    'Return ONLY JSON { "post": "..." }';
  return { system, user };
}
