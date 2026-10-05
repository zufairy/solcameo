import type { ClipConfig, CaptionStyle } from "@/lib/server/clipTypes";
import { DRIP_STAGGER_MS } from "@/lib/builder/dripStagger";
import { isValidTimeZone } from "@/lib/builder/timezone";
import { isTransitionId, transitionById, clampTransitionDuration } from "@/lib/server/transitionsPack";

/** Coerce a persisted transition (either { id, durationSec } or a bare id string)
 *  into the ClipConfig shape, dropping unknown ids. Duration defaults to the
 *  style's own default, then clamps to the allowed window. */
/** A stored pool of uploaded video URLs → a clean string[] (dedup, trimmed).
 *  Capped so a runaway upload list can't blow up a render plan. */
const MAX_POOL_SIZE = 30;
function coerceUrlList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const url = raw.trim();
    if (url) seen.add(url);
    if (seen.size >= MAX_POOL_SIZE) break;
  }
  return [...seen];
}

function coerceTransition(v: unknown): { id: string; durationSec: number } | undefined {
  const id = typeof v === "string" ? v : (v && typeof v === "object" ? (v as Record<string, unknown>).id : undefined);
  if (typeof id !== "string" || !isTransitionId(id)) return undefined;
  const rawDur = v && typeof v === "object" ? (v as Record<string, unknown>).durationSec : undefined;
  const dur = typeof rawDur === "number" ? rawDur : transitionById(id)?.durationSec;
  return { id, durationSec: clampTransitionDuration(dur) };
}

const PLATFORM_WHITELIST = ["tiktok", "instagram", "threads", "youtube", "facebook", "x"];

/** 15-min grid/snap size for normal post-spacing. */
const POST_INTERVAL_STEP_MS = 15 * 60 * 1000; // 900000
/** Hard floor — 1 min, so testers can set a fast drip. Sub-15-min values snap to
 *  whole minutes; >=15-min values keep the 15-min grid (default UX unchanged). */
const POST_INTERVAL_MIN_MS = 60 * 1000;
const POST_INTERVAL_MAX_MS = 24 * 60 * 60 * 1000; // 24h
/** 0 = OFF/unlimited; otherwise capped here. */
const MAX_PER_DAY_CAP = 48;

export const DEFAULT_CLIP_CONFIG: ClipConfig = {
  velloWatermark: true,
  clipLength: { min: 20, max: 45 },
  maxClipsPerSource: 3,
  captionsOn: true,
  captionStyle: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 64, position: "bottom" },
  hookStyle: "cold_open",
  platforms: ["tiktok"],
  // Auto-post OFF by default — posting is outward-facing/irreversible, so it's
  // opt-in: the operator turns it on in the Posting tab. Matches the raw-read UIs
  // (PostingTab, ClippingFlowCanvas) that already treat an unset value as OFF, and
  // the cloud gate (clipJobs.finalizeJob) which reads this via normalizeClipConfig.
  autoPost: false,
  // Work tab cadence: how many clip runs the autonomous loop may START per UTC
  // day (each run yields up to maxClipsPerSource clips). 0 = unlimited.
  clipsPerDay: 3,
  postIntervalMs: DRIP_STAGGER_MS,
  maxPerDay: 0,
  postOrder: "best",
};

/** Snap an arbitrary ms value: 15-min grid at/above 15min, whole-minute grid
 *  below it; clamped to [1min, 24h]. Default (raw<=0/undefined) → DRIP_STAGGER_MS. */
function normalizePostIntervalMs(raw: unknown): number {
  const d = DEFAULT_CLIP_CONFIG.postIntervalMs as number;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return d;
  const grid = raw < POST_INTERVAL_STEP_MS ? POST_INTERVAL_MIN_MS : POST_INTERVAL_STEP_MS;
  const snapped = Math.round(raw / grid) * grid;
  return clamp(snapped, POST_INTERVAL_MIN_MS, POST_INTERVAL_MAX_MS);
}

/** Clamp the daily cap to 0..48 (0 = OFF/unlimited); non-numbers → default (0). */
function normalizeMaxPerDay(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return DEFAULT_CLIP_CONFIG.maxPerDay as number;
  return clamp(Math.floor(raw), 0, MAX_PER_DAY_CAP);
}

/** One of the four publish-order modes, else "best". */
function normalizePostOrder(raw: unknown): "best" | "newest" | "oldest" | "random" {
  return raw === "newest" || raw === "oldest" || raw === "random" ? raw : "best";
}

/** Daily start hour 0..23, or undefined (legacy: first post one interval from now). */
function normalizeDailyStartHour(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return clamp(Math.floor(raw), 0, 23);
}

/** Daily start minute 0..59 (default 0). */
function normalizeDailyStartMinute(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return clamp(Math.floor(raw), 0, 59);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Common color words the LLM emits in a free-text caption style → hex.
const COLOR_WORDS: Record<string, string> = {
  white: "#FFFFFF", black: "#000000", yellow: "#FFEE00", gold: "#FFD700",
  lime: "#A3E635", green: "#34C759", red: "#FF3B30", blue: "#2D9CDB",
  cyan: "#22D3EE", pink: "#FF2D78", orange: "#FF9500", purple: "#A855F7",
};
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;

/**
 * Coerce whatever the builder/LLM produced for caption style into a valid
 * CaptionStyle object. The chat frequently emits a shorthand STRING
 * (e.g. "bold-white", "karaoke yellow", "minimal white bottom") instead of the
 * structured object the Convex schema requires — this maps any of those (string,
 * partial object, or junk) onto a guaranteed-valid object.
 */
function coerceCaptionStyle(raw: unknown): CaptionStyle {
  const d = DEFAULT_CLIP_CONFIG.captionStyle;
  if (isObj(raw)) {
    const mode = raw.mode === "line" ? "line" : "karaoke";
    const position = raw.position === "top" || raw.position === "center" || raw.position === "bottom" ? raw.position : d.position;
    const fontColor = typeof raw.fontColor === "string" && raw.fontColor.trim() ? raw.fontColor.trim() : d.fontColor;
    const fontSize = typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize) ? clamp(raw.fontSize, 16, 120) : d.fontSize;
    return { mode, fontColor, fontSize, position };
  }
  if (typeof raw === "string" && raw.trim()) {
    const s = raw.toLowerCase();
    const mode: CaptionStyle["mode"] = s.includes("line") || s.includes("subtitle") || s.includes("plain") ? "line" : "karaoke";
    const position: CaptionStyle["position"] = s.includes("top") ? "top" : s.includes("center") || s.includes("middle") ? "center" : "bottom";
    let fontColor = d.fontColor;
    const hex = HEX_RE.exec(raw);
    if (hex) fontColor = hex[0];
    else { for (const [word, val] of Object.entries(COLOR_WORDS)) { if (s.includes(word)) { fontColor = val; break; } } }
    const fontSize = s.includes("small") ? 36 : s.includes("large") || s.includes("big") || s.includes("bold") ? 56 : d.fontSize;
    return { mode, fontColor, fontSize, position };
  }
  return { ...d };
}

function coerceClipLength(raw: unknown): { min: number; max: number } {
  const d = DEFAULT_CLIP_CONFIG.clipLength;
  const o = isObj(raw) ? raw : {};
  const min = clamp(typeof o.min === "number" ? o.min : d.min, 5, 180);
  const max = clamp(typeof o.max === "number" ? o.max : d.max, min, 180);
  return { min, max };
}

/**
 * Merge partial/loose operator input over the defaults with safe bounds. Tolerant
 * of the messy shapes the builder chat produces (string captionStyle, missing
 * fields, non-array platforms) so a clip config NEVER violates the Convex schema.
 */
/** Render canvas dims for a clip config's output aspect (unset = 9:16 1080x1920). */
export function outputDimsFor(aspect: ClipConfig["outputAspect"]): { width: number; height: number } {
  switch (aspect) {
    case "16:9": return { width: 1920, height: 1080 };
    case "1:1": return { width: 1080, height: 1080 };
    case "4:5": return { width: 1080, height: 1350 };
    default: return { width: 1080, height: 1920 };
  }
}

export function normalizeClipConfig(input: Partial<ClipConfig> | Record<string, unknown> | null | undefined): ClipConfig {
  const d = DEFAULT_CLIP_CONFIG;
  const o = (isObj(input) ? input : {}) as Record<string, unknown>;

  // platforms is the SINGLE source of truth for which channels clips post to
  // (managed in the Posting tab; the canvas Publish node no longer sets it).
  // An EXPLICIT empty array means "post to ALL connected accounts" — so when the
  // caller provided an array we honor it verbatim (even empty); only a MISSING
  // platforms field falls back to the default. The post path treats [] as all-connected.
  const platformsProvided = Array.isArray(o.platforms);
  const platformsRaw = platformsProvided ? (o.platforms as unknown[]) : d.platforms;
  const platforms = platformsRaw
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.toLowerCase())
    .filter((p) => PLATFORM_WHITELIST.includes(p));

  const brandLogoUrl = typeof o.brandLogoUrl === "string" && o.brandLogoUrl.trim() ? o.brandLogoUrl.trim() : undefined;
  // Video Call To Action clip appended to the end of every produced clip.
  const ctaVideo = typeof o.ctaVideo === "string" && o.ctaVideo.trim() ? o.ctaVideo.trim() : undefined;
  // Transitions app: the seam transition applied at the clip's joins. Accept either
  // the lifted { id, durationSec } shape or a bare string id.
  const transition = coerceTransition(o.transition);
  // Hook Videos / Main Content pools. Stored as plain URL arrays; anything that is
  // not a non-empty string is dropped so a half-finished upload can never reach the
  // renderer as an empty input.
  const hookVideos = coerceUrlList(o.hookVideos);
  const mainVideos = coerceUrlList(o.mainVideos);
  // "No clip / UGC needed" only means anything with a main video to publish — an
  // empty pool would otherwise skip clipping AND have nothing to post.
  const mainOnly = o.mainOnly === true && mainVideos.length > 0;

  return {
    clipLength: coerceClipLength(o.clipLength),
    // Up to 60 clips per source (the operator's "Number of clips" slider). The
    // CLOUD path reaches counts above the distinct-moment pool via per-moment
    // variations (see expandMomentsToCount); the LOCAL run stays capped in
    // plan-moments so it can't 502.
    maxClipsPerSource: clamp(typeof o.maxClipsPerSource === "number" ? o.maxClipsPerSource : d.maxClipsPerSource, 1, 60),
    // "Let AI decide" lives outside the slider config; the canvas persists it onto
    // clipConfig.autoPlan (raw store). Carry it through so the cloud clip + auto-post
    // slices lift to the analyzer's natural count (up to 30) instead of capping at
    // maxClipsPerSource (=1 when autoPlan hides the slider) → only 1 clip.
    ...(o.autoPlan === true ? { autoPlan: true } : {}),
    // Free-plan autoPlan ceiling (see clipTypes.ts) — must survive normalization
    // or the free-plan gate in /api/agents/config would write it and have it
    // silently dropped here on every read, making the cap a no-op.
    ...(typeof o.autoPlanMaxClips === "number" && o.autoPlanMaxClips > 0 ? { autoPlanMaxClips: Math.round(o.autoPlanMaxClips) } : {}),
    // Output aspect (Aspect Crop node / Editor picker) — whitelisted, unset = 9:16.
    ...(o.outputAspect === "9:16" || o.outputAspect === "16:9" || o.outputAspect === "1:1" || o.outputAspect === "4:5"
      ? { outputAspect: o.outputAspect }
      : {}),
    captionsOn: typeof o.captionsOn === "boolean" ? o.captionsOn : d.captionsOn,
    velloWatermark: typeof o.velloWatermark === "boolean" ? o.velloWatermark : true,
    captionStyle: coerceCaptionStyle(o.captionStyle),
    hookStyle: o.hookStyle === "context_first" ? "context_first" : "cold_open",
    platforms: platformsProvided ? platforms : d.platforms,
    autoPost: typeof o.autoPost === "boolean" ? o.autoPost : d.autoPost,
    clipsPerDay: typeof o.clipsPerDay === "number" && Number.isFinite(o.clipsPerDay) ? Math.max(0, Math.min(MAX_PER_DAY_CAP, Math.round(o.clipsPerDay))) : d.clipsPerDay,
    postIntervalMs: normalizePostIntervalMs(o.postIntervalMs),
    maxPerDay: normalizeMaxPerDay(o.maxPerDay),
    ...(isObj(o.campaignPosting) ? { campaignPosting: {
      maxPerDay: normalizeMaxPerDay(o.campaignPosting.maxPerDay),
      postIntervalMs: normalizePostIntervalMs(o.campaignPosting.postIntervalMs),
      dailyStartHour: normalizeDailyStartHour(o.campaignPosting.dailyStartHour),
      dailyStartMinute: normalizeDailyStartMinute(o.campaignPosting.dailyStartMinute),
    } } : {}),
    postOrder: normalizePostOrder(o.postOrder),
    ...(brandLogoUrl ? { brandLogoUrl } : {}),
    ...(ctaVideo ? { ctaVideo } : {}),
    ...(transition ? { transition } : {}),
    ...(hookVideos.length ? { hookVideos } : {}),
    ...(mainVideos.length ? { mainVideos } : {}),
    ...(mainOnly ? { mainOnly: true } : {}),
    // Daily start time is OPT-IN: only included when a valid hour is set, so an
    // unset config keeps the legacy "first post one interval from now" behavior.
    ...(normalizeDailyStartHour(o.dailyStartHour) !== undefined
      ? {
          dailyStartHour: normalizeDailyStartHour(o.dailyStartHour),
          dailyStartMinute: normalizeDailyStartMinute(o.dailyStartMinute),
        }
      : {}),
    // Timezone is OPT-IN: kept only when it's a valid IANA zone. An unset/invalid
    // value is OMITTED (undefined) so the scheduler falls back to host-local.
    ...(typeof o.timezone === "string" && isValidTimeZone(o.timezone) ? { timezone: o.timezone } : {}),
  };
}
