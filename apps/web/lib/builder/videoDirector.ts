import { STANDARD_VIDEO_LENGTHS, videoLengthStepsForEngine, VIDEO_ENGINES, type VideoEngineId } from "./agentTypes";
import {
  HOOK_STYLES, SETTINGS, MOODS, CAMERA_STYLES, COLOR_GRADES,
  getStyle, getFragment,
} from "./videoStyles";

export interface CaptionStyleLike {
  mode: string; fontColor: string; fontSize: number; position: string; preset?: string;
  /** Editor Captions tool: ISO 639 code the speech is transcribed AS ("" = auto). */
  languageCode?: string;
  /** Editor Captions tool: ISO 639 code the burned subtitles should be in — when
   *  it differs from the spoken language, overlay-burn translates per phrase. */
  subtitleLanguageCode?: string;
}
export type VideoResolution = "720p" | "1080p";

export interface VideoConfig {
  minSeconds: number;
  maxSeconds: number;
  videosPerDay: number;
  monthlyBudget?: number;
  maxBrandsPerDay?: number;
  /** Preferred posting anchor — minutes past UTC midnight (0-1439). */
  postingTimeUtcMinutes?: number;
  /** Minimum hours between consecutive auto-posts. */
  minGapHours?: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
  resolution: VideoResolution;
  styles: string[];
  customStyles?: string[];
  hookStyles?: string[];
  settings?: string[];
  moods?: string[];
  energy?: "calm" | "balanced" | "high" | "hype";
  cameraStyle?: "ugc_handheld" | "tripod" | "cinematic" | "selfie";
  colorGrade?: "natural" | "warm" | "vibrant" | "moody" | "clean_bright";
  voiceover?: boolean;
  cta?: "follow" | "visit_link" | "comment" | "shop" | "none";
  ctaText?: string;
  customDirective?: string;
  avoid?: string;
  brandLogoUrl?: string;
  brandColor?: string;
  /** Video Call To Action app: URL of a clip appended to the end of every video. */
  ctaVideo?: string;
  /** Hook Videos app: pool of uploaded clips, one prepended to every video. */
  hookVideos?: string[];
  /** Main Content app: pool of uploaded body videos. */
  mainVideos?: string[];
  /** Image Posts app: generate a still with KIE instead of filming. */
  imagePosts?: { enabled?: boolean; imageOnly?: boolean; idea?: string; engine?: string };
  /** Main Content app's "No clip / UGC needed" switch — publish an uploaded video
   *  instead of generating one (overlays still apply). */
  mainVideosOnly?: boolean;
  hookText?: { enabled: boolean; source: "auto" | "custom"; text?: string; style: CaptionStyleLike };
  captions?: { enabled: boolean; style: CaptionStyleLike };
  /** Trending Audio app — mix a music bed under the voiceover. `volumePct` is the
   *  music loudness (0-100, default 30). `trackId` pins a track; else auto-match. */
  music?: { enabled: boolean; trackId?: string; autoMusic?: boolean; volumePct?: number; customUrl?: string };
  /** Integrations — Web Search: before writing the script for a video, fetch live
   *  grounded web results for the video's topic (Gemini Google-Search grounding,
   *  lib/server/kie-gemini.ts) and feed them into the script prompt as real,
   *  current context — regardless of style (cartoon, UGC, talking head, etc), the
   *  content the agent writes is grounded in what's actually true right now. */
  webSearchEnabled?: boolean;
  /** Integrations — Standing Promotion: a free-text value-message worked into
   *  EVERY future video regardless of format (e.g. "mention Vello, the AI
   *  agent platform this show runs on, and what it does"). Reuses the same
   *  enforced "mention the product + build to a CTA" instruction a real
   *  marketplace campaign gets (videoScript.ts's campaignBlock) — resolved
   *  via run-task's campaignContext fallback chain when no real campaign is
   *  attached. Unset = no forced product mention (unchanged default). */
  standingPromotion?: string;
  /** Generate tab · "My Images" pin: an operator-picked image every future video
   *  (manual and scheduled/autonomous alike) uses as its primary identity
   *  reference instead of the generic minted avatar still. "" = explicitly
   *  unpinned (distinct from unset, so the Generate tab can clear it via the
   *  same merge-patch persist path every other video-config field uses). */
  pinnedVideoReferenceUrl?: string;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyleLike = { mode: "word", fontColor: "#ffffff", fontSize: 42, position: "bottom" };

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  minSeconds: 16,
  maxSeconds: 32,
  videosPerDay: 1,
  maxBrandsPerDay: 1,
  aspectRatio: "9:16",
  resolution: "720p",
  styles: ["talking_head"],
  hookStyles: ["bold_claim", "question"],
  settings: ["studio"],
  moods: [],
  energy: "balanced",
  cameraStyle: "ugc_handheld",
  colorGrade: "natural",
  voiceover: true,
  cta: "follow",
  hookText: { enabled: false, source: "auto", style: DEFAULT_CAPTION_STYLE },
  captions: { enabled: false, style: DEFAULT_CAPTION_STYLE },
  music: { enabled: false, autoMusic: true, volumePct: 30 },
};

/** Deterministic 32-bit hash of a string seed. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A varied length in [min,max], snapped to the nearest supported length inside
 *  the range. `steps` is the engine's length ladder (Grok goes down to 1s;
 *  Veo/Omni start at 10s) — defaults to the standard ladder. */
export function randInRange(min: number, max: number, seed: string, steps: readonly number[] = STANDARD_VIDEO_LENGTHS): number {
  const floor = steps[0] ?? 5;
  const lo = Math.max(floor, Math.min(min, max));
  const hi = Math.min(60, Math.max(min, max));
  const inRange = steps.filter((s) => s >= lo && s <= hi);
  const pool = inRange.length ? inRange : [Math.max(floor, Math.min(60, lo))];
  return pool[hash(seed + ":len") % pool.length];
}

/** Deterministically pick from a list by seed; salt distinguishes dimensions. */
export function pickRotating<T>(list: T[], seed: string, salt: string): T | undefined {
  if (!list.length) return undefined;
  return list[hash(seed + ":" + salt) % list.length];
}

const ENERGY_NOTE: Record<NonNullable<VideoConfig["energy"]>, string> = {
  calm: "calm, slow pacing with breathing room",
  balanced: "balanced pacing",
  high: "fast, high-energy pacing with quick cuts",
  hype: "explosive hype pacing, very fast cuts, maximum energy",
};

const CTA_NOTE: Record<NonNullable<VideoConfig["cta"]>, string> = {
  follow: "end with a clear call to follow",
  visit_link: "end with a clear call to visit the link",
  comment: "end by asking viewers to comment",
  shop: "end with a clear shop-now call to action",
  none: "no explicit call to action",
};

export interface VideoDirectives {
  durationSeconds: number;
  brief: { format: string; angle: string; structureNotes: string; visualTreatment: string };
  aspectRatio: "9:16" | "1:1" | "16:9";
  overlays: {
    captions?: VideoConfig["captions"];
    // templateId + durationSeconds ride along when the hook design comes from a
    // wired AI-Clipper "Auto Hook" skill, so the UGC hook renders in the same design.
    hookText?: VideoConfig["hookText"] & { templateId?: string; durationSeconds?: number };
    brandLogoUrl?: string;
    music?: { enabled: boolean; trackId?: string; autoMusic?: boolean; volumePct?: number; customUrl?: string };
    /** Video Call To Action app: URL of a clip appended to the end of the video. */
    ctaVideo?: string;
    /** Hook Videos app: pool to draw this video's opener from. */
    hookVideos?: string[];
    /** Main Content app: pool to draw this video's body from (bypass mode). */
    mainVideos?: string[];
    /** Main Content app: skip generation and publish an uploaded video. */
    mainVideosOnly?: boolean;
    /** Image Posts app: generate a still instead of filming; imageOnly skips video. */
    imagePosts?: { enabled?: boolean; imageOnly?: boolean; idea?: string; engine?: string };
  };
}

/** One row of the agent's wired AI-Clipper apps (agentSkillFiles). Passed into
 *  resolveVideoDirectives so the clipper's Trending Audio / Auto Hook / Captions
 *  also drive generated UGC videos (configure once, applies to both). */
export interface WiredSkillFile { skillId: string; wired?: boolean; config?: Record<string, unknown> | null; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentLike = { mintAddress?: string; niche?: string; videoConfig?: VideoConfig | null; [k: string]: any };
type VideoInput = { durationSeconds?: number; format?: string; aspectRatio?: "9:16" | "1:1" | "16:9" };

/**
 * Resolve the effective per-video directives. Explicit `input` always wins;
 * otherwise roll a varied length + a rotating style/hook/setting/mood from the
 * agent's videoConfig and compose the brief the script + storyboard consume.
 * `lastFormat` (the previous video's brief.format) is used to avoid immediate repeats.
 */
export function resolveVideoDirectives(
  agent: AgentLike,
  input: VideoInput,
  seed: string,
  lastFormat?: string,
  clipSkills?: WiredSkillFile[],
): VideoDirectives {
  // An explicit size for THIS video (Explore, the Videos tab) wins over the agent's saved Director setting.
  const cfg: VideoConfig = { ...DEFAULT_VIDEO_CONFIG, ...(agent.videoConfig ?? {}), ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}) };

  // The operator's length range is authoritative: a caller-supplied duration is
  // CLAMPED into [min,max] (so a hardcoded 16s from an autonomy/task prompt can't
  // undercut a "minimum 50s" setting); with no duration we roll one in range.
  // The floor is ENGINE-AWARE: Grok's ladder starts at 1s, Veo/Omni at 10s.
  const lenSteps = videoLengthStepsForEngine((agent.videoEngine as VideoEngineId | undefined) ?? undefined);
  const hi = Math.min(60, Math.max(cfg.minSeconds, cfg.maxSeconds));
  // `hi` (the operator's own max) is the hard ceiling — it must win even when
  // the resolved engine's native floor (lenSteps[0], e.g. Veo/Omni's 10s) sits
  // ABOVE it (a 5s format saved while on Grok, then the agent's engine changed
  // or defaulted elsewhere). Without the `Math.min(hi, ...)` here, `lo` could
  // exceed `hi` and the clamp below degenerated to `lo`, silently discarding
  // the configured cap — this is the "5s setting still makes a 13s video" bug.
  const lo = Math.min(hi, Math.max(lenSteps[0] ?? 5, Math.min(cfg.minSeconds, cfg.maxSeconds)));
  const durationSeconds = typeof input.durationSeconds === "number"
    ? Math.max(lo, Math.min(hi, input.durationSeconds))
    : randInRange(cfg.minSeconds, cfg.maxSeconds, seed, lenSteps);

  const stylePool = [...(cfg.styles ?? []), ...((cfg.customStyles ?? []).map((s) => `custom:${s}`))];
  let styleId = input.format
    ? undefined
    : (pickRotating(stylePool, seed, "style") ?? "talking_head");

  const toDef = (id?: string) => {
    if (!id) return getStyle("talking_head")!;
    if (id.startsWith("custom:")) {
      const text = id.slice(7);
      return { id, label: text, icon: "✨", description: text,
        format: text, angle: "custom", structureNotes: text, visualTreatment: text };
    }
    return getStyle(id) ?? getStyle("talking_head")!;
  };
  let styleDef = toDef(styleId);

  if (!input.format && lastFormat && styleDef.format === lastFormat && stylePool.length > 1) {
    const idx = stylePool.indexOf(styleId!);
    styleId = stylePool[(idx + 1) % stylePool.length];
    styleDef = toDef(styleId);
  }

  const hook = pickRotating(cfg.hookStyles ?? [], seed, "hook");
  const setting = pickRotating(cfg.settings ?? [], seed, "setting");
  const mood = pickRotating(cfg.moods ?? [], seed, "mood");

  const hookFrag = hook ? getFragment(HOOK_STYLES, hook)?.fragment : undefined;
  const settingFrag = setting ? getFragment(SETTINGS, setting)?.fragment : undefined;
  const moodFrag = mood ? getFragment(MOODS, mood)?.fragment : undefined;
  const cameraFrag = cfg.cameraStyle ? getFragment(CAMERA_STYLES, cfg.cameraStyle)?.fragment : undefined;
  const gradeFrag = cfg.colorGrade ? getFragment(COLOR_GRADES, cfg.colorGrade)?.fragment : undefined;

  const format = input.format ?? styleDef.format;
  const angle = hookFrag ?? styleDef.angle;
  const structureNotes = [
    styleDef.structureNotes,
    cfg.energy ? ENERGY_NOTE[cfg.energy] : "",
    cfg.cta ? CTA_NOTE[cfg.cta] : "",
    cfg.ctaText ? `CTA line: "${cfg.ctaText}"` : "",
    cfg.customDirective ? `Extra direction: ${cfg.customDirective}` : "",
    cfg.avoid ? `Avoid: ${cfg.avoid}` : "",
  ].filter(Boolean).join(". ");
  const visualTreatment = [
    styleDef.visualTreatment, settingFrag, moodFrag, cameraFrag, gradeFrag,
    `${cfg.aspectRatio} aspect ratio`,
    cfg.brandColor ? `brand accent color ${cfg.brandColor}` : "",
  ].filter(Boolean).join(", ");

  // App Store apps are the on-switch: installing "Auto Hook" / "Captions" /
  // "Trending Audio" turns the overlay on even if the Director tab's explicit
  // enable flag is off. Settings (style, music loudness/track) still come from
  // videoConfig. Either source enabling it is enough.
  const installed: string[] = Array.isArray(agent.installedSkills) ? agent.installedSkills : [];
  // Bridge the AI-Clipper apps (agentSkillFiles: clip.trendingaudio / clip.hook /
  // clip.captions) into the UGC overlay switches. The clipper stores its apps here,
  // NOT in installedSkills/videoConfig — so without this bridge a video agent that
  // wired "Trending Audio"/"Auto Hook"/"Captions" for its clips got NONE of them on
  // generated UGC videos (the #1 "installed + on but not burning" report). A wired
  // clip.* skill now enables its overlay AND carries its track/design/preset config,
  // so UGC videos render like the AI Clipper's. `wired !== false` mirrors the clip
  // planner's own gate (a removed/stale row is filtered upstream).
  const wiredClip = (id: string) => (clipSkills ?? []).find((s) => s.skillId === id && s.wired !== false);
  const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const clipHook = wiredClip("clip.hook");
  const clipCaps = wiredClip("clip.captions");
  const clipAudio = wiredClip("clip.trendingaudio");
  const hookCfg = asObj(clipHook?.config);
  const capsCfg = asObj(clipCaps?.config);
  const audioCfg = asObj(clipAudio?.config);

  // Operator's explicit OFF switch from the Editor (Caption / Text Hooks
  // panel's "Turn OFF … (all videos)" button — writes `disabled: true` into
  // the clip.* skill config). A hard veto: it beats an installed app AND the
  // videoConfig toggle, because it's the most recent, most explicit intent.
  // Cleared automatically when a preset/design is saved again.
  const hookForcedOff = hookCfg.disabled === true;
  const capsForcedOff = capsCfg.disabled === true;
  const hookOn = !hookForcedOff && (!!cfg.hookText?.enabled || installed.includes("video.autohook") || !!clipHook);
  const capsOn = !capsForcedOff && (!!cfg.captions?.enabled || installed.includes("video.captions") || !!clipCaps);
  const musicOn = !!cfg.music?.enabled || installed.includes("music.trendingaudio") || !!clipAudio;
  // Video Call To Action app: append the uploaded clip only when the app is
  // installed AND a CTA video has been uploaded.
  const ctaVideo = installed.includes("video.cta") && cfg.ctaVideo ? cfg.ctaVideo : undefined;
  // Hook Videos / Main Content apps are user-selected uploads, so once they exist
  // in `videoConfig` they should always flow into the render. We no longer hide a
  // valid pool just because the app store item wasn't separately installed — that
  // was the bug that dropped hook videos in influencer mode.
  const poolFor = (urls: string[] | undefined) => {
    const cleaned = urls?.filter((u) => typeof u === "string" && u.trim());
    if (!cleaned?.length) return undefined;
    return cleaned;
  };
  // Image Posts: installed AND enabled, mirroring every other app's gate. An
  // installed-but-off app is a no-op rather than a surprise mode switch.
  const imagePosts = installed.includes("video.imageposts") && cfg.imagePosts?.enabled
    ? { ...cfg.imagePosts, enabled: true }
    : undefined;
  const hookVideos = poolFor(cfg.hookVideos);
  const mainVideos = poolFor(cfg.mainVideos);
  // "No clip / UGC needed" only takes effect with something to publish.
  const mainVideosOnly = !!cfg.mainVideosOnly && !!mainVideos?.length;

  const hookText = hookOn
    ? {
        ...(cfg.hookText ?? { source: "auto" as const, style: DEFAULT_CAPTION_STYLE }),
        enabled: true,
        // Carry the clipper hook's DESIGN + on-screen duration so the UGC hook burns
        // in the same style the operator chose (overlay-burn resolves the design id).
        ...(typeof hookCfg.hookTemplateId === "string" ? { templateId: hookCfg.hookTemplateId } : {}),
        ...(typeof hookCfg.hookDurationSec === "number" ? { durationSeconds: hookCfg.hookDurationSec } : {}),
        // The clipper hook's brief — render-step only generates a line when
        // hookText.prompt is set, so without this the typed prompt never reached UGC renders.
        ...(typeof hookCfg.hookPrompt === "string" && hookCfg.hookPrompt.trim() ? { prompt: hookCfg.hookPrompt.trim() } : {}),
        // Saved custom style (size slider + drag position) — merged into the burn
        // style so UGC hooks render at the operator's exact size/spot too.
        ...(() => {
          const cd = asObj(hookCfg.hookCustomDesign);
          const fontSize = typeof cd.fontSize === "number" ? cd.fontSize : undefined;
          const yPct = typeof cd.yPct === "number" ? cd.yPct : undefined;
          // Saved Placement dropdown (top/center/bottom, VideoEditorTab.tsx's
          // Text Hooks drawer) — was never bridged here, so a UGC render's
          // on-screen hook always landed wherever `cfg.hookText.style`'s
          // pre-existing default was, ignoring the editor's saved choice.
          const position = hookCfg.hookPosition === "bottom" || hookCfg.hookPosition === "center" || hookCfg.hookPosition === "top"
            ? hookCfg.hookPosition : undefined;
          if (fontSize === undefined && yPct === undefined && position === undefined) return {};
          return { style: {
            ...(cfg.hookText?.style ?? DEFAULT_CAPTION_STYLE),
            ...(fontSize !== undefined ? { fontSize } : {}),
            ...(yPct !== undefined ? { yPct } : {}),
            ...(position !== undefined ? { position } : {}),
          } };
        })(),
      }
    : hookForcedOff && cfg.hookText
      // The veto must also flip a videoConfig-level enabled:true to false —
      // otherwise downstream readers of hookText.enabled re-enable the burn.
      ? { ...cfg.hookText, enabled: false }
      : cfg.hookText;
  const captions = capsOn
    ? {
        ...(cfg.captions ?? { style: DEFAULT_CAPTION_STYLE }),
        enabled: true,
        // Honor the clipper's caption PRESET (OpusClip-parity template) on UGC too.
        ...(typeof capsCfg.captionPreset === "string" || typeof capsCfg.captionLanguageCode === "string" || typeof capsCfg.subtitleLanguageCode === "string"
          ? { style: {
              ...(cfg.captions?.style ?? DEFAULT_CAPTION_STYLE),
              ...(typeof capsCfg.captionPreset === "string" ? { preset: capsCfg.captionPreset } : {}),
              // Editor Captions tool's language picks ride along so every
              // auto-generated video transcribes / translates the same way.
              ...(typeof capsCfg.captionLanguageCode === "string" && capsCfg.captionLanguageCode ? { languageCode: capsCfg.captionLanguageCode } : {}),
              ...(typeof capsCfg.subtitleLanguageCode === "string" && capsCfg.subtitleLanguageCode ? { subtitleLanguageCode: capsCfg.subtitleLanguageCode } : {}),
            } }
          : {}),
      }
    : capsForcedOff && cfg.captions
      ? { ...cfg.captions, enabled: false }
      : cfg.captions;
  // When music comes from the Director app (cfg/installedSkills) its settings win;
  // when it comes from the wired clip.trendingaudio skill, read the track + autoMusic
  // from THAT config. (DEFAULT_VIDEO_CONFIG.music.autoMusic is true, so we can't just
  // `cfg.music?.autoMusic ?? clip` — the default would always shadow the clip value.)
  const musicFromApp = !!cfg.music?.enabled || installed.includes("music.trendingaudio");
  const music = musicOn
    ? {
        enabled: true,
        trackId: (musicFromApp ? cfg.music?.trackId : undefined) ?? (typeof audioCfg.musicTrackId === "string" ? audioCfg.musicTrackId : undefined),
        autoMusic: musicFromApp
          ? (cfg.music?.autoMusic ?? true)
          : (typeof audioCfg.autoMusic === "boolean" ? audioCfg.autoMusic : true),
        volumePct: typeof cfg.music?.volumePct === "number" ? cfg.music.volumePct
          : typeof audioCfg.musicVolumePct === "number" ? audioCfg.musicVolumePct : 30,
        // Operator's own uploaded MP3 — wins over trackId/autoMusic downstream
        // (overlay-burn). Same app-vs-bridged-clip-skill precedence as trackId.
        customUrl: (musicFromApp ? cfg.music?.customUrl : undefined) ?? (typeof audioCfg.customAudioUrl === "string" ? audioCfg.customAudioUrl : undefined),
      }
    : undefined;

  return {
    durationSeconds,
    brief: { format, angle, structureNotes, visualTreatment },
    aspectRatio: cfg.aspectRatio,
    overlays: {
      captions, hookText, brandLogoUrl: cfg.brandLogoUrl, music, ctaVideo,
      ...(hookVideos ? { hookVideos } : {}),
      ...(mainVideos ? { mainVideos } : {}),
      ...(mainVideosOnly ? { mainVideosOnly: true } : {}),
      ...(imagePosts ? { imagePosts } : {}),
    },
  };
}

// ─── Agentic intent parser ───────────────────────────────────────────────────
// Deterministically map a natural-language Director request to concrete config
// changes, so "make her videos commercial, on Veo, 30s, 2 a day" applies even
// when the chat model forgets to emit the action. Returns ONLY the fields it is
// confident about (merged server-side) + the human summary for the confirmation.

export interface VideoDirectorIntent {
  videoConfig?: Partial<VideoConfig>;
  videoEngine?: VideoEngineId;
  summary: string[];
}

const clampSec = (n: number) => Math.max(5, Math.min(60, Math.round(n)));

export function deriveVideoDirectorIntent(raw: string): VideoDirectorIntent {
  const t = (raw || "").toLowerCase();
  const cfg: Partial<VideoConfig> = {};
  const summary: string[] = [];

  // Styles (multi-select rotation pool)
  const STYLE_RULES: Array<[RegExp, string, string]> = [
    [/commercial|\bads?\b|advert|tv ?spot|brand film/, "commercial", "Commercial"],
    [/\bugc\b|user.?generated|unbox/, "ugc_review", "UGC"],
    [/talking[- ]?head|to[- ]?camera/, "talking_head", "Talking head"],
    [/\bvlog\b|day.?in.?(the.?)?life/, "vlog", "Vlog"],
    [/tutorial|how[- ]?to|step.?by.?step/, "tutorial", "Tutorial"],
    [/ootd|outfit|fashion|styling/, "ootd", "OOTD"],
    [/b-?roll|cinematic montage|mood piece/, "cinematic_broll", "Cinematic B-roll"],
    [/asmr/, "asmr", "ASMR"],
  ];
  const styles = STYLE_RULES.filter(([re]) => re.test(t));
  if (styles.length) { cfg.styles = Array.from(new Set(styles.map(([, id]) => id))); summary.push(`style → ${styles.map(([, , l]) => l).join(", ")}`); }

  // Camera
  if (/gimbal|dolly|crane|cinematic (camera|shot|movement)/.test(t)) { cfg.cameraStyle = "cinematic"; summary.push("camera → Cinematic"); }
  else if (/selfie|front.?facing/.test(t)) { cfg.cameraStyle = "selfie"; summary.push("camera → Selfie"); }
  else if (/tripod|locked.?off|static (cam|shot)/.test(t)) { cfg.cameraStyle = "tripod"; summary.push("camera → Tripod"); }
  else if (/handheld/.test(t)) { cfg.cameraStyle = "ugc_handheld"; summary.push("camera → Handheld"); }
  else if (/\bcinematic\b/.test(t)) { cfg.cameraStyle = "cinematic"; summary.push("camera → Cinematic"); }

  // Color grade
  if (/moody|teal.?and.?orange|film look|cinematic grade/.test(t)) { cfg.colorGrade = "moody"; summary.push("grade → Moody"); }
  else if (/vibrant|punchy|saturat/.test(t)) { cfg.colorGrade = "vibrant"; summary.push("grade → Vibrant"); }
  else if (/\bwarm\b|golden/.test(t)) { cfg.colorGrade = "warm"; summary.push("grade → Warm"); }
  else if (/clean ?bright|high.?key|bright ?clean/.test(t)) { cfg.colorGrade = "clean_bright"; summary.push("grade → Clean bright"); }
  else if (/natural|true.?to.?life/.test(t)) { cfg.colorGrade = "natural"; summary.push("grade → Natural"); }

  // Moods (multi)
  const MOOD_RULES: Array<[RegExp, string, string]> = [
    [/aspirational/, "aspirational", "Aspirational"],
    [/luxe|luxur|premium|high.?end|elegant|upscale/, "luxe", "Luxe"],
    [/upbeat|energetic|playful/, "upbeat", "Upbeat"],
    [/edgy|gritty|rebellious/, "edgy", "Edgy"],
    [/cozy|intimate/, "cozy", "Cozy"],
  ];
  const moods = MOOD_RULES.filter(([re]) => re.test(t));
  if (moods.length) { cfg.moods = Array.from(new Set(moods.map(([, id]) => id))); summary.push(`mood → ${moods.map(([, , l]) => l).join(", ")}`); }

  // Settings (multi)
  const SET_RULES: Array<[RegExp, string, string]> = [
    [/studio/, "studio", "Studio"],
    [/\bhome\b|bedroom|living room|indoors?/, "home", "Home"],
    [/outdoor|urban|street|downtown|\bcity\b/, "outdoor", "Outdoor"],
    [/nature|forest|beach|mountain|\bpark\b|landscape/, "nature", "Nature"],
    [/cafe|coffee ?shop|restaurant/, "cafe", "Cafe"],
    [/abstract|styli[sz]ed set/, "abstract", "Abstract"],
  ];
  const sets = SET_RULES.filter(([re]) => re.test(t));
  if (sets.length) { cfg.settings = Array.from(new Set(sets.map(([, id]) => id))); summary.push(`setting → ${sets.map(([, , l]) => l).join(", ")}`); }

  // Aspect ratio
  if (/9[:x ]?16|vertical|portrait|reels?|shorts?|tiktok/.test(t)) { cfg.aspectRatio = "9:16"; summary.push("aspect → 9:16"); }
  else if (/16[:x ]?9|landscape|horizontal|widescreen/.test(t)) { cfg.aspectRatio = "16:9"; summary.push("aspect → 16:9"); }
  else if (/1[:x ]?1|\bsquare\b/.test(t)) { cfg.aspectRatio = "1:1"; summary.push("aspect → 1:1"); }

  // Resolution
  if (/\b1080p\b|\b1080\b/.test(t)) { cfg.resolution = "1080p"; summary.push("resolution → 1080p"); }
  else if (/\b720p\b|\b720\b/.test(t)) { cfg.resolution = "720p"; summary.push("resolution → 720p"); }

  // Length (range or single)
  const range = t.match(/(\d{1,2})\s*(?:-|to|–|and)\s*(\d{1,2})\s*(?:s\b|sec|second)/);
  if (range) {
    const a = clampSec(+range[1]), b = clampSec(+range[2]);
    cfg.minSeconds = Math.min(a, b); cfg.maxSeconds = Math.max(a, b);
    summary.push(`length → ${cfg.minSeconds}–${cfg.maxSeconds}s`);
  } else {
    const one = t.match(/(\d{1,2})\s*(?:s\b|secs?\b|seconds?\b)/);
    if (one && /(length|long|duration|video|second|sec\b|make|set|keep)/.test(t)) {
      const v = clampSec(+one[1]); cfg.minSeconds = v; cfg.maxSeconds = v; summary.push(`length → ${v}s`);
    }
  }

  // Cadence (videos/day)
  const cad = t.match(/(\d{1,2})\s*(?:videos?|posts?|clips?)?\s*(?:a|per|\/|each)\s*day/);
  if (cad) { cfg.videosPerDay = Math.max(0, Math.min(24, +cad[1])); summary.push(`cadence → ${cfg.videosPerDay}/day`); }

  // Brand collabs/day
  const brand = t.match(/(\d{1,2})\s*(?:brand|sponsor|campaign|collab|deal)s?\b[^.]*?\bday\b/);
  if (brand) { cfg.maxBrandsPerDay = Math.max(0, Math.min(10, +brand[1])); summary.push(`brand deals → ${cfg.maxBrandsPerDay}/day`); }

  // Monthly budget
  const bud = t.match(/(?:budget|spend|cap)[^\d]{0,14}\$?\s*(\d{1,5})/) || t.match(/\$?\s*(\d{2,5})\s*(?:usdc)?\s*(?:\/|per|a)\s*(?:mo|month)/);
  if (bud) { cfg.monthlyBudget = Math.max(0, +bud[1]); summary.push(`budget → $${cfg.monthlyBudget}/mo`); }

  // Captions
  if (/(add|enable|turn on|with)\s+(captions?|subtitles?)|captions?\s+on|subtitles?\s+on/.test(t)) { cfg.captions = { enabled: true, style: DEFAULT_CAPTION_STYLE }; summary.push("captions → on"); }
  else if (/(no|disable|turn off|remove|without)\s+(captions?|subtitles?)|captions?\s+off/.test(t)) { cfg.captions = { enabled: false, style: DEFAULT_CAPTION_STYLE }; summary.push("captions → off"); }

  // Engine
  let videoEngine: VideoEngineId | undefined;
  if (/higgsfield/.test(t) && /seedance/.test(t)) videoEngine = /2\.?0\b/.test(t) ? "hf-seedance-2" : "hf-seedance-25";
  else if (/higgsfield/.test(t) && /grok/.test(t)) videoEngine = "hf-grok-video";
  else if (/\bveo\b|veo ?3/.test(t)) videoEngine = "veo3-fast";
  else if (/seedance/.test(t)) videoEngine = "seedance-v2";
  else if (/kling/.test(t)) videoEngine = "kling-v3";
  else if (/grok.*(1\.?5|imagine 1\.?5)|imagine 1\.?5/.test(t)) videoEngine = "grok-imagine-15";
  else if (/grok/.test(t)) videoEngine = "grok-imagine-15";
  else if (/gemini ?omni|\bomni\b/.test(t)) videoEngine = "gemini-omni";
  if (videoEngine) {
    const eng = VIDEO_ENGINES.find((e) => e.id === videoEngine);
    if (eng) summary.push(`engine → ${eng.label}`); else videoEngine = undefined;
  }

  return { videoConfig: Object.keys(cfg).length ? cfg : undefined, videoEngine, summary };
}
