// Clipping skills marketplace catalog. Each skill is an MD instruction set the
// agentic editor (clipEditPlanner) reads at Run time to compose the clip's edit
// plan. Installing a skill writes its markdownTemplate into agentSkillFiles
// (keyed by sessionId/mintAddress), the same store the influencer skills use -
// and the skill then shows up as a draggable node on the clipping canvas.

import type { EditOp, Anchor } from "../server/clipEditOps";
import type { CaptionStyle } from "../server/clipTypes";
import { gameplayUrl, RANDOM_GAMEPLAY_ID, randomGameplayId } from "../server/gameplayPack";
import { reactionSfxUrl, reactionSfxPackById, reactionBucketForEmotion, reactionSfxTargetSec } from "../server/reactionSfxPack";
import { trendingAudioUrl, isTrendingAudioId, pickTrendingTrackByMood } from "../server/trendingAudioPack";
import { HOOK_ALWAYS_ON_END_SEC, HOOK_DESIGNS, clampHookDuration, clampHookYPct, resolveHookRender, type CustomHookDesign } from "./hookDesigns";
import { clampTitleDuration, resolveTitleRender } from "./titleCardDesigns";
import { STICKER_STYLES, stickerStyleById, isStickerPosition } from "./stickerStyles";
import { FILTER_PRESET_IDS } from "./filterStyles";

/** Minimal moment shape the deterministic floor needs (subset of ClipMoment). */
export interface ClipFloorMoment {
  title: string;
  captionText: string;
  startSeconds: number;
  endSeconds: number;
  /** LLM-graded emotion (funny|shocking|…), drives context-aware effect placement
   *  (e.g. the meme-audio sting timing). Optional. */
  emotion?: string;
}
export interface ClipFloorConfig {
  captionsOn: boolean;
  captionStyle: CaptionStyle;
  // ── Inspector-set fields for the new skill nodes (all optional so the full
  //    ClipConfig, which omits them, still satisfies this floor shape). ──
  /** clip.brainrot: gameplay-bg stack layout. */
  bgLayout?: "vstack" | "hstack";
  /** clip.brainrot: chosen gameplay pack id (resolves a bundled bg video). */
  bgId?: string;
  /** clip.memeaudio: direct URL of the chosen trending sound. */
  audioUrl?: string;
  /** clip.memeaudio: id of the chosen trending sound (from the trending API). */
  audioId?: string;
  /** clip.memeaudio: overlay gain in dB relative to the source audio. */
  gainDb?: number;
  /** clip.hook: how long (seconds) the hook line stays on screen. Default 5. */
  hookDurationSec?: number;
  /** clip.hook: "Always on" — the hook stays until the end of the clip
   *  (overrides hookDurationSec). Default off. */
  hookAlwaysOn?: boolean;
  /** clip.hook: chosen text-design template id (lib/builder/hookDesigns). */
  hookTemplateId?: string;
  /** clip.hook: operator's custom hook look (overrides the template's render). */
  hookCustomDesign?: CustomHookDesign;
  /** clip.title: chosen title-card design template id (lib/builder/titleCardDesigns). */
  titleTemplateId?: string;
  /** clip.title: how long (seconds) the title slate holds. Default 1.5. */
  titleDurationSec?: number;
  /** clip.facetrack (Smart Framing): how to frame a wider/multi-person source.
   *  auto = fit the people / follow the speaker; pan = keyframe-pan between guests;
   *  zoom = punch in on the speaker; full = letterbox the whole shot. Default auto. */
  framingMode?: "auto" | "pan" | "zoom" | "full";
  /** clip.fillercut: "words" (default) cuts filler WORDS via the transcript
   *  (remove_fillers); "random" cuts a few random TIME-based micro-windows
   *  instead — the Editor's Specials · "Filler Cut · Random" toggle. */
  fillerCutMode?: "words" | "random";
  /** clip.sticker (Viral Sticker): box style id (lib/builder/stickerStyles). */
  stickerStyleId?: string;
  /** clip.sticker: vertical position (top | center | bottom). Default top. */
  stickerPosition?: string;
  /** clip.filters (Video Filters): named color-grade preset. */
  filterPreset?: "vintage" | "warm" | "cool" | "bw" | "vivid" | "cinematic" | "hd" | "superhd" | "moody" | "filmic" | "matte";
  /** clip.filters: saturation multiplier (1 = unchanged). */
  filterSaturation?: number;
  /** clip.filters: brightness add (0 = unchanged). */
  filterBrightness?: number;
  /** clip.reactionsfx (Reaction SFX): chosen sound id (lib/server/reactionSfxPack). */
  sfxId?: string;
  /** clip.memeaudio (MEME reaction SFX): chosen reaction-SFX PACK id
   *  (lib/server/reactionSfxPack REACTION_SFX_PACKS). The AI still auto-picks WHICH
   *  sting by emotion; this only swaps the pack. Unset = DEFAULT_REACTION_SFX_PACK_ID. */
  sfxPackId?: string;
  /** clip.trendingaudio (Trending Audio): chosen music track id (lib/server/trendingAudioPack). */
  musicTrackId?: string;
  /** clip.trendingaudio: auto-pick a mood-matched track (default ON when the node is wired). */
  autoMusic?: boolean;
  /** clip.trendingaudio: operator's own uploaded MP3 — when set, this plays instead
   *  of any curated track (auto-pick or manual musicTrackId are both ignored). The
   *  existing gainDb/volume slider still applies to it unchanged. */
  customAudioUrl?: string;
  /** clip.trendingaudio: the uploaded file's Convex storage id — kept alongside
   *  customAudioUrl so "remove" can delete the blob, not just clear the field. */
  customAudioStorageId?: string;
  /** clip.trendingaudio: COMPUTED by clipEditPlanner from the clip's own transcript
   *  (words-per-second in the moment's window, see isDialogueHeavy) — never set by
   *  the inspector. True = near-continuous talking; Auto Music then restricts its
   *  pick to instrumental tracks so a sung vocal never fights the speaker's voice. */
  heavyDialogue?: boolean;
  /** clip.overlayimage (Overlay Image): public URL of the user's uploaded image. */
  overlayImageUrl?: string;
  /** clip.overlayimage: how to composite — "overlay" floats the image ON the full
   *  video at `overlayPosition`; "frame" scales the video DOWN to a centered box
   *  and fills the whole canvas with the image behind it (video stays fully
   *  visible inside the image frame). */
  overlayMode?: "overlay" | "frame";
  /** clip.overlayimage: where to burn the image in overlay mode — "overlay"
   *  (centered), "top", "bottom". Ignored in frame mode. */
  overlayPosition?: "overlay" | "top" | "bottom";
  /** clip.overlayimage: blend opacity 0-1 (default 1 = opaque). */
  overlayOpacity?: number;
  /** clip.overlayimage (frame mode only): size of the video box as a fraction of
   *  the canvas (0.5-0.95, default 0.85). The image fills the rest of the frame. */
  overlayScale?: number;
}

export interface ClipSkill {
  /** Stable id, always prefixed "clip." so we can tell clipping skills apart. */
  id: string;
  name: string;
  /** Emoji shown on the node + marketplace card. */
  icon: string;
  /** Short category tag for the marketplace card. */
  tag: string;
  /** One-line marketplace blurb. */
  blurb: string;
  /** Display-only price label (install is free for now). */
  priceLabel: string;
  /** Whether a fresh agent has this without buying it. */
  defaultInstalled: boolean;
  /**
   * Work-in-progress: the skill is real but inert until its backing env is set
   * (e.g. GAMEPLAY_PACK_BASE_URL / MEME_AUDIO_API_URL). UIs that surface the
   * skill should grey it out, badge it "WIP", and block install. Single source
   * of truth, read via isWipClipSkill(id).
   */
  wip?: boolean;
  /**
   * App-store-only "app": installs as a marketplace row and unlocks a dedicated
   * BUILDER TAB (e.g. the Photo Carousel Builder) instead of a canvas node. Never
   * appears in the node palette / library as a draggable node, and is skipped by
   * the graph compile + floor passes.
   */
  appOnly?: boolean;
  /** The operator rules the LLM editor follows. Stored as the skill's MD. */
  markdownTemplate: string;
  /**
   * DETERMINISTIC floor: the op(s) this skill GUARANTEES, computed in code with
   * no LLM call. The agentic editor (clipEditPlanner) only enriches on top; if
   * the LLM is flaky / out of credits / returns prose, these still render so the
   * skill always visibly does something. Pure, must not import server runtime.
   */
  floor?: (m: ClipFloorMoment, config: ClipFloorConfig) => EditOp[];
}

// ── floor helpers ─────────────────────────────────────────────────────────────
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
/** A short curiosity hook: captionText preferred, else title, trimmed to ~6 words. */
export const hookText = (m: ClipFloorMoment): string => {
  const src = (m.captionText || m.title || "Watch this").trim();
  return words(src).slice(0, 6).join(" ");
};
/** Punchy ALL-CAPS meme phrase: 2-4 words from captionText/title. */
export const memeText = (m: ClipFloorMoment): string => {
  const src = (m.captionText || m.title || "WAIT FOR IT").trim();
  return words(src).slice(0, 4).join(" ").toUpperCase();
};

/**
 * Build the Auto Hook overlay op from a hook text + the operator's inspector
 * picks (duration + design template). Shared by the clip.hook floor AND the
 * clipEditPlanner applyHookStyle pass, so the operator's chosen design wins over
 * whatever the LLM editor emitted, exactly like the caption preset.
 */
export function hookOverlayOp(text: string, durationSec?: number, designId?: string, custom?: CustomHookDesign | null, alwaysOn = false): EditOp {
  const r = resolveHookRender(designId, custom);
  const yPct = clampHookYPct(custom?.yPct);
  return {
    op: "text_overlay",
    text: r.allCaps ? text.toUpperCase() : text,
    position: r.position,
    ...(yPct !== undefined ? { yPct } : {}),
    startSec: 0,
    // Always on: an end past any clip length, so the overlay window never closes.
    endSec: alwaysOn ? HOOK_ALWAYS_ON_END_SEC : clampHookDuration(durationSec),
    style: {
      fontColor: r.fontColor,
      fontSize: r.fontSize,
      // The template font is a real weight (Medium/SemiBold), so DON'T synthetic-bold
      // it — the drawtext path picks the bundled font file via `font` below.
      bold: false,
      outlineColor: r.outlineColor,
      outlineWidth: r.outlineWidth,
      font: r.font,
      ...(r.layout ? { hookLayout: r.layout } : {}),
      ...(r.accentColor ? { hookAccentColor: r.accentColor } : {}),
      ...(r.motion ? { hookMotion: r.motion } : {}),
      ...(r.boxColor ? { bgColor: r.boxColor } : {}),
    },
  };
}

/**
 * Build the Hook Title Card slate op from a title text + the operator's inspector
 * picks (design template + duration). Shared by the clip.title floor AND the
 * clipEditPlanner applyTitleStyle pass, so the operator's chosen design wins over
 * whatever the LLM editor emitted, exactly like the Auto Hook. The slate itself
 * is a black card (lib/server/clipFilterGraph); the template drives the text
 * colour, size, ALL-CAPS, and hold duration.
 */
export function titleCardOp(text: string, designId?: string, durationSec?: number): EditOp {
  const r = resolveTitleRender(designId);
  const clean = text.trim() || "Watch this";
  return {
    op: "title_card",
    text: r.allCaps ? clean.toUpperCase() : clean,
    durationSec: clampTitleDuration(durationSec ?? r.durationSec),
    style: {
      fontColor: r.fontColor,
      fontSize: r.fontSize,
      bold: true,
      // The slate background colour, the renderer paints the card with it (default
      // black when unset), so newspaper / breaking-news looks actually render.
      bgColor: r.bgColor,
    },
    anim: r.anim,
    // News "kicker" badge (BREAKING NEWS / LIVE / FLASH …) burned above the headline.
    // Strip non-ASCII (the ⚡●⚠ decorations the UI shows), the bundled drawtext fonts
    // can't render emoji, so they'd burn as tofu boxes; keep just the words.
    ...(r.kicker
      ? (() => {
          const k = r.kicker.replace(/[^\x20-\x7E]/g, "").trim();
          return k ? { kicker: k, kickerColor: r.kickerColor, kickerTextColor: r.kickerTextColor } : {};
        })()
      : {}),
  };
}

/** Start time of the Viral Sticker overlay, distinct from the hook (0) and the
 *  meme (1) so all three text overlays can coexist without colliding. */
export const STICKER_START_SEC = 0.3;

/**
 * Build the Viral Sticker overlay op from a (context-aware) text + the operator's
 * inspector picks (box style + position). Shared by the clip.sticker floor + the
 * clipEditPlanner applyStickerStyle pass, so the chosen design always wins.
 */
export function stickerOverlayOp(text: string, styleId?: string, position?: string): EditOp {
  const s = stickerStyleById(styleId) ?? STICKER_STYLES[0];
  const pos: Anchor = isStickerPosition(position) ? position : "top";
  return {
    op: "text_overlay",
    text: s.render.allCaps ? text.toUpperCase() : text,
    position: pos,
    startSec: STICKER_START_SEC,
    endSec: STICKER_START_SEC + 3,
    style: {
      fontColor: s.render.fontColor,
      fontSize: s.render.fontSize,
      bold: true,
      bgColor: s.render.boxColor,
      ...(s.render.outlineColor ? { outlineColor: s.render.outlineColor } : {}),
      ...(typeof s.render.outlineWidth === "number" ? { outlineWidth: s.render.outlineWidth } : {}),
    },
  };
}

export const CLIP_SKILLS: ClipSkill[] = [
  {
    id: "clip.captions",
    name: "Dynamic Captions",
    icon: "💬",
    tag: "Captions",
    blurb: "Burned in captions on the video, word synced, with a visual template.",
    priceLabel: "Free",
    defaultInstalled: true,
    markdownTemplate: [
      "# Dynamic Captions",
      "",
      "**What I do:** Burn word-by-word karaoke captions synced to the audio so the clip is watchable on mute.",
      "",
      "**Editor rules:**",
      "- ALWAYS include a `subtitles` op with mode \"karaoke\".",
      "- Use a bold, high-contrast color, bright yellow (#FFEE00), positioned at the bottom.",
      "- Keep the font large and readable.",
    ].join("\n"),
    // Captions are driven by config.captionsOn (which the wired clip.captions
    // node already turns on) + need transcript words, so the buildFloor adds the
    // subtitles op centrally. Per-skill floor stays empty to avoid a duplicate.
    floor: () => [],
  },
  {
    id: "clip.title",
    name: "Hook Title Card",
    icon: "🎬",
    tag: "Hook",
    blurb: "A short news style title card that opens the clip with a hook.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Hook Title Card",
      "",
      "**What I do:** Prepend a short title slate that creates a curiosity gap so viewers keep watching.",
      "",
      "**Editor rules:**",
      "- Add exactly ONE `title_card` op (durationSec ~1.5) at the very start.",
      "- Text: a short curiosity-gap hook (max ~6 words) drawn from the clip's most surprising point.",
      "- Style: bold, white, large.",
    ].join("\n"),
    // Honors the inspector's design template + duration (config.titleTemplateId /
    // config.titleDurationSec), threaded per-node via clipEditPlanner. Legacy nodes
    // with no config fall back to the default "Bold White" slate at 1.5s.
    // RETIRED: the slate was concatenated BEFORE the footage, so clips started
    // late. Kept in the catalog only so already-wired nodes still resolve; it is
    // hidden from the marketplace (DEPRECATED_SKILL_IDS) and emits nothing.
    floor: () => [],
  },
  {
    id: "clip.zoom",
    name: "Zoom Punch",
    icon: "🔍",
    tag: "Framing",
    blurb: "Frames the full person over a blurred glass background (no cropped faces) and punches in on the strongest beat.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Zoom Punch",
      "",
      "**What I do:** Fit the WHOLE person in the vertical frame over an Apple-style blurred glass background, so a face is never cropped in half. Pick the framing style in the node settings.",
      "",
      "**Styles:**",
      "- Blur background (full person) - static frosted-glass frame.",
      "- Blur + slow zoom in / zoom out - the same frame with gentle motion.",
      "- Punch in on face - a quick momentary zoom on the strongest beat.",
      "",
      "**Editor rules:**",
      "- Emit ONE `blur_frame` op (style \"static\") for the framed-with-blur look. Do not add extra crops.",
    ].join("\n"),
    // Config-driven floor: the inspector's `zoomStyle` chooses the op. Default is the
    // blurred full-person frame — the WHOLE person over an Apple-style frosted-glass
    // background (no half-cropped faces). It never feels static: the blurred backdrop
    // is the LIVE video, so it keeps moving. "blur_zoom_in/out" add an extra camera
    // push; "punch" = the classic momentary zoom on a beat.
    floor: (m, config) => {
      const style = (config as { zoomStyle?: string } | undefined)?.zoomStyle ?? "blur";
      const mid = Math.max(0, (m.endSeconds - m.startSeconds) * 0.5);
      if (style === "punch") {
        return [{ op: "emphasis", kind: "zoom_punch", atSec: mid, amount: 1.3 }];
      }
      const motion = style === "blur_zoom_in" ? "zoom_in" : style === "blur_zoom_out" ? "zoom_out" : "static";
      const ops: EditOp[] = [{ op: "blur_frame", style: motion }];
      // Default ("blur") lives up to the "Zoom Punch" name: the full-person blur frame
      // PLUS a visible momentary punch on the clip's strongest beat. The explicit
      // blur_zoom_in/out styles are pure framing (gentle push, no punch) for anyone who
      // wants a clean frame; "punch" is the punch alone.
      if (style === "blur") ops.push({ op: "emphasis", kind: "zoom_punch", atSec: mid, amount: 1.22 });
      return ops;
    },
  },
  {
    id: "clip.meme",
    name: "Meme Text",
    icon: "🔥",
    tag: "Overlay",
    blurb: "Bold meme style text overlays placed on the key beats of the clip.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Meme Text",
      "",
      "**What I do:** Drop bold ALL-CAPS text overlays on the funniest / most important beats.",
      "",
      "**Editor rules:**",
      "- Add 1-2 `text_overlay` ops with short punchy ALL-CAPS phrases (2-4 words), timed to key beats.",
      "- Position near the top; bold; bright color with a black outline.",
    ].join("\n"),
    floor: (m) => {
      const len = m.endSeconds - m.startSeconds;
      return [
        { op: "text_overlay", text: memeText(m), position: "top", startSec: 1, endSec: Math.max(2, Math.min(4, len - 0.5)),
          // Distinct MEME look, white on a black block with a thick outline so it
          // never blends into the yellow karaoke captions (which are also #FFEE00).
          style: { fontColor: "#FFFFFF", fontSize: 64, bold: true, outlineColor: "#000000", outlineWidth: 8, bgColor: "#000000" } },
      ];
    },
  },
  {
    id: "clip.speed",
    name: "Speed Ramp",
    icon: "⚡",
    tag: "Pacing",
    blurb: "Speeds up the slow stretches so the clip stays fast and punchy.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Speed Ramp",
      "",
      "**What I do:** Tighten pacing by speeding up slow filler.",
      "",
      "**Editor rules:**",
      "- If the clip drags, add an `emphasis` op with kind \"speed\" (amount ~1.25).",
      "- Skip it if the clip is already fast.",
    ].join("\n"),
  },
  {
    id: "clip.hook",
    name: "Auto Hook",
    icon: "🪝",
    tag: "Hook",
    blurb: "An AI written hook line overlaid on the clip's opening seconds.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Auto Hook",
      "",
      "**What I do:** Overlay ONE short, scroll-stopping hook line on the clip's opening seconds (on the video, not a separate slate).",
      "",
      "Set how long it shows + its text design in the node's inspector.",
      "",
      "**Editor rules:**",
      "- Add exactly ONE `text_overlay` op starting at startSec 0.",
      "- Text: a curiosity-gap hook (max ~7 words) for THIS clip.",
      "- The operator's chosen duration + design are applied automatically.",
    ].join("\n"),
    // Honors the inspector's duration + design template (config.hookDurationSec /
    // config.hookTemplateId, threaded per-node via clipEditPlanner.buildSkillFloor).
    // Legacy nodes with no config fall back to 5s + the default "Bold White" design.
    floor: (m, config) => [hookOverlayOp(hookText(m), config.hookDurationSec, config.hookTemplateId, config.hookCustomDesign, config.hookAlwaysOn === true)],
  },
  {
    id: "clip.cta",
    name: "Video Call To Action",
    icon: "🎬",
    tag: "CTA",
    blurb: "Appends your own clip, like an offer or logo, to every clip's end.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Video Call To Action",
      "",
      "**What I do:** Append the operator's uploaded clip to the END of every produced clip.",
      "",
      "The CTA video is scaled to fit the clip's frame (letterboxed, never cropped) and its audio plays. Upload it in the node's inspector.",
      "",
      "**Editor rules:**",
      "- This is a whole-output post-process, not an edit op, emit no ops for it.",
    ].join("\n"),
    // No floor: the CTA is concatenated onto the finished clip AFTER the render
    // (app/api/video/clip-batch-start via lib/server/ctaAppend), driven by
    // clipConfig.ctaVideo (lifted from this node by compile-graph), not an EditOp.
  },
  {
    id: "clip.hookvideos",
    name: "Hook Videos",
    icon: "🎬",
    tag: "Opener",
    blurb: "Upload a pool of hook clips; the best-matching one is played in front of every clip.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Hook Videos",
      "",
      "**What I do:** Play one of the operator's uploaded hook videos at the FRONT of every produced clip, then cut to the main content.",
      "",
      "Upload several in the node's inspector. Each upload is transcribed once, and the one whose content best matches the clip airs; when nothing matches (or nothing is transcribed yet) they rotate in upload order, so every hook eventually runs.",
      "",
      "Pairs with Auto Hook: the hook TEXT burns over the hook video.",
      "",
      "**Editor rules:**",
      "- This is a whole-output pre-process, not an edit op. Emit no ops for it.",
    ].join("\n"),
    // No floor: the hook is JOINED BEFORE the render (clip-batch-start stitches it
    // as sub-segment 0) so overlays land on top of it, driven by
    // clipConfig.hookVideos — not an EditOp.
  },
  {
    id: "clip.maincontent",
    name: "Main Content",
    icon: "📼",
    tag: "Body",
    blurb: "Upload your own body videos. Optionally skip clipping entirely and publish them as-is.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Main Content",
      "",
      "**What I do:** Use the operator's uploaded videos as the BODY of the post instead of (or alongside) footage cut from the source.",
      "",
      "Turn on **No clip / UGC needed** in the node's inspector to skip clipping and video generation entirely: each post is an uploaded video, with a Hook Video in front of it if that app is installed. Captions, filters and the CTA still apply, so the post keeps the agent's look.",
      "",
      "The run's clip count still decides how many posts are made; the pool cycles to fill it.",
      "",
      "**Editor rules:**",
      "- This selects the SOURCE footage. Emit no ops for it.",
    ].join("\n"),
  },
  {
    id: "clip.captionstyle",
    name: "Smart Captions",
    icon: "✍️",
    tag: "Post caption",
    blurb: "Writes the post caption and description from your persona instruction.",
    priceLabel: "Free",
    defaultInstalled: true,
    markdownTemplate: [
      "# Smart Captions",
      "",
      "**What I do:** Write the POST caption (the description published under the video) in your voice, following the instruction typed in the node's prompt box. This is the social post text, NOT the on-video captions (that is Dynamic Captions).",
      "",
      "Examples you can type in the prompt box:",
      "- \"Hype tone, in Malay, tag @brandname, add 3 hashtags\"",
      "- \"Professional English, mention our website, no emojis\"",
      "- \"Casual and funny, ask a question, one line only\"",
      "",
      "**Editor rules:**",
      "- This sets the POST caption at publish time. Emit no edit ops for it.",
    ].join("\n"),
    // Empty floor (like clip.captions / clip.keywords) to avoid a DUPLICATE subtitles
    // op: in the LLM-failure floor path buildFloor already pushes a config subtitles
    // op when captionsOn, so a non-empty floor here produced TWO (double-burned in the
    // complex graph). Captions are still guaranteed: applyCaptionSkillStyle appends a
    // styled subtitles op when none exists (its patch is always truthy for this skill).
    floor: () => [],
  },
  {
    id: "clip.guardrails",
    name: "Guardrails",
    icon: "🛡️",
    tag: "Pre-post QA",
    blurb: "Blocks a clip from posting if it has flagged language, is too short/corrupt/low-res, already has burned-in captions, or looks AI-generated.",
    priceLabel: "$0.015 / video",
    defaultInstalled: false,
    markdownTemplate: [
      "# Guardrails",
      "",
      "**What I do:** Run a pre-post QA pass right before the clip is uploaded. If the caption has flagged language, the video is too short/corrupt/too low-resolution, it already has burned-in captions (so Dynamic Captions wouldn't double them up), or it reads as obviously AI-generated, the post is BLOCKED — never published.",
      "",
      "**Why:** this is exactly the kind of content platforms like TikTok tend to shadow-filter (near-zero views). Catching it before posting protects the account instead of burning a slot on a video that was never going to be seen.",
      "",
      "**Editor rules:**",
      "- Runs at publish time, not in the edit graph. Emit no edit ops for it.",
    ].join("\n"),
    // No floor — this is a publish-time gate (lib/server/guardrails.ts), not an
    // edit-graph op, same pattern as clip.captionstyle just above.
  },
  {
    id: "clip.keywords",
    name: "Keyword Pop",
    icon: "💡",
    tag: "Captions",
    blurb: "Highlights the money and power words in a bright color for retention.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Keyword Pop",
      "",
      "**What I do:** Karaoke captions where key words (money, numbers, power words) pop in a highlight color.",
      "",
      "**Editor rules:**",
      "- ALWAYS include a `subtitles` op (mode karaoke); the renderer highlights keywords automatically.",
    ].join("\n"),
    floor: () => [],
  },
  {
    id: "clip.fillercut",
    name: "Filler Cut",
    icon: "✂️",
    tag: "Pacing",
    blurb: "Automatically cuts the ums, uhs, and dead air to keep the clip tight.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Filler Cut",
      "",
      "**What I do:** Cut filler words (um, uh, you know…) out of the clip automatically using the word-level transcript. In \"Random\" mode (the Editor's Specials toggle), it instead cuts a few random TIME-based micro-windows — pure pacing, no transcript needed, a fresh pattern every render.",
      "",
      "**Editor rules:**",
      "- ALWAYS include a `remove_fillers` op (default), or `random_jump_cuts` when config.fillerCutMode is \"random\".",
    ].join("\n"),
    floor: (_m, config) => [config.fillerCutMode === "random" ? { op: "random_jump_cuts" } : { op: "remove_fillers" }],
  },
  {
    id: "clip.multiscene",
    name: "Multi Clips",
    icon: "🎬",
    tag: "Pacing",
    blurb: "Cuts between a few different random crop angles across the clip instead of one fixed framing — feels like multiple scenes, more engaging.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Multi Clips",
      "",
      "**What I do:** Instead of one fixed crop/zoom for the whole clip, hard-cut between 2-4 randomly framed windows across its duration — the same footage reads as several distinct scenes/angles rather than one static framed moment. Independent of Smart Framing / face tracking; when both are on, this takes priority.",
      "",
      "**Editor rules:**",
      "- ALWAYS include a `multi_scene_crop` op.",
    ].join("\n"),
    floor: () => [{ op: "multi_scene_crop" }],
  },
  {
    id: "clip.facetrack",
    name: "Smart Framing",
    icon: "🎯",
    tag: "Reframe",
    blurb: "Keeps the speaker framed on wide or multi person podcast footage.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Smart Framing",
      "",
      "**What I do:** Detect the people in the shot and reframe the 9:16 crop around them instead of the dead-center of the frame (which crops podcast guests out).",
      "",
      "Pick a mode in the node's inspector:",
      "- **Auto**, fit both people if they fit, else follow the main speaker; when the speaker can't be confidently located (small/far/jittery), letterbox the whole shot instead of guess-cropping the table.",
      "- **Pan both**, keyframe-pan left→right so each guest is seen.",
      "- **Zoom one**, punch in on the speaker.",
      "- **Fit (safe)**, always letterbox the whole shot (nothing cropped).",
      "",
      "**Editor rules:**",
      "- ALWAYS include a `face_reframe` op.",
    ].join("\n"),
    // Honors the inspector's framing mode (config.framingMode), threaded per-node
    // via clipEditPlanner.buildSkillFloor. Undefined ⇒ auto (legacy face-follow).
    floor: (_m, config) => [{ op: "face_reframe", ...(config.framingMode ? { mode: config.framingMode } : {}) }],
  },
  {
    id: "clip.filters",
    name: "Video Filters",
    icon: "🎨",
    tag: "Look",
    blurb: "Applies a color grade like Vintage, Warm, Cool, or Vivid to the clip.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Video Filters",
      "",
      "**What I do:** Apply a color grade / look to the clip, a named preset (Vintage, Warm, Cool, B&W, Vivid, Cinematic, HD Clarity, Super HD, Moody, Filmic, Matte) and/or fine saturation + brightness, picked in the node's inspector.",
      "",
      "**Editor rules:**",
      "- Apply the look deterministically; do not add other ops on its behalf.",
    ].join("\n"),
    // Emits a single color_filter op from the inspector picks (threaded per-node
    // via buildSkillFloor). No preset + default sliders ⇒ nothing (graceful no-op).
    floor: (_m, config) => {
      const hasPreset = FILTER_PRESET_IDS.includes(config.filterPreset as (typeof FILTER_PRESET_IDS)[number]);
      const hasSat = typeof config.filterSaturation === "number" && config.filterSaturation !== 1;
      const hasBri = typeof config.filterBrightness === "number" && config.filterBrightness !== 0;
      if (!hasPreset && !hasSat && !hasBri) return [];
      return [{
        op: "color_filter",
        ...(hasPreset ? { preset: config.filterPreset } : {}),
        ...(hasSat ? { saturation: config.filterSaturation } : {}),
        ...(hasBri ? { brightness: config.filterBrightness } : {}),
      }];
    },
  },
  {
    id: "clip.sticker",
    name: "Viral Sticker",
    icon: "✨",
    tag: "Overlay",
    blurb: "Adds a punchy story style text sticker, auto written or prompt steered.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Viral Sticker",
      "",
      "**What I do:** Overlay ONE short text sticker (a line in a colored box, IG/TikTok-story style) on the clip.",
      "",
      "Pick the box style + position in the node's inspector, and optionally type a prompt to steer the text (e.g. \"announce joining the $$$ trend\"). With no prompt, the sticker is auto-written from the clip.",
      "",
      "**Editor rules:**",
      "- Add exactly ONE `text_overlay` op for a short ALL-CAPS sticker phrase.",
      "- The operator's chosen style + position are applied automatically.",
    ].join("\n"),
    // Deterministic fallback (context-aware from the caption); the operator's design
    // + optional prompt-steered text are applied in clipEditPlanner.applyStickerStyle.
    floor: (m, config) => [stickerOverlayOp(memeText(m), config.stickerStyleId, config.stickerPosition)],
  },
  {
    id: "clip.overlayimage",
    name: "Overlay Image",
    icon: "🖼️",
    tag: "Overlay",
    blurb: "Burns your uploaded image onto the clip — over the video, or as a frame around it.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Overlay Image",
      "",
      "**What I do:** Burn the image uploaded in the node's inspector ONTO the clipped video — a logo, a watermark, a sticker, a frame. Two modes: **Overlay** floats the image over the full video (centered / top / bottom, with optional transparency), **Frame** scales the video down to a centered box and fills the whole canvas with your image behind it, so the entire video stays visible inside the image border.",
      "",
      "**Editor rules:**",
      "- Add exactly ONE `image_overlay` op using the operator's uploaded image + chosen mode.",
      "- The operator's uploaded image, mode (overlay / frame), position (overlay / top / bottom) and opacity win — do not substitute a different image or reposition.",
      "- Frame mode: `frameScale` is the video-box size as a fraction of the canvas (0.5-0.95); the image fills the rest. Keep the box centered.",
    ].join("\n"),
    // Deterministic floor: the operator's uploaded image + mode + position are the
    // whole feature (there's nothing to auto-write). A node with no uploaded image
    // is INERT — never invent an image.
    floor: (m, config) => {
      const url = config.overlayImageUrl?.trim() ?? "";
      if (!url) return [];
      const mode = config.overlayMode === "frame" ? "frame" : "overlay";
      const position = mode === "frame"
        ? "center"
        : config.overlayPosition === "top" || config.overlayPosition === "bottom" ? config.overlayPosition : "center";
      const opacity = typeof config.overlayOpacity === "number"
        ? Math.min(1, Math.max(0.05, config.overlayOpacity))
        : 1;
      const frameScale = typeof config.overlayScale === "number"
        ? Math.min(0.95, Math.max(0.5, config.overlayScale))
        : 0.85;
      return [{ op: "image_overlay", imageUrl: url, mode, position, opacity, ...(mode === "frame" ? { frameScale } : {}) }];
    },
  },
  {
    id: "clip.brainrot",
    name: "Brain Rot",
    icon: "🧠",
    tag: "Background",
    blurb: "Splits the clip with looping gameplay footage for maximum watch time.",
    priceLabel: "Free",
    defaultInstalled: false,
    // Live: gameplay pack is hosted (PUBLIC Supabase "gameplay" bucket). When
    // GAMEPLAY_PACK_BASE_URL is unset the floor still degrades gracefully
    // (gameplayUrl() returns "" → no composite_bg op → render unchanged).
    markdownTemplate: [
      "# Brain Rot",
      "",
      "**What I do:** Composite the clip with a curated gameplay background (Subway Surfers / Minecraft parkour / GTA ramps / Surfing) in the classic split-screen brain-rot format.",
      "",
      "Vertical split only: clip on top, gameplay below. Pick the background in the node's inspector (default **Random**, each clip in a run gets a different loop).",
      "",
      "**Editor rules:**",
      "- This effect is applied deterministically; do not add other ops on its behalf.",
    ].join("\n"),
    // Deterministic: emit a composite_bg op ONLY when a bg video URL resolves
    // (GAMEPLAY_PACK_BASE_URL is set). With no base configured, gameplayUrl()
    // returns "" → no op → the render is unchanged (graceful degrade).
    floor: (m, config) => {
      // Vertical (vstack) only, clip on top, gameplay below. No layout choice.
      // Default = RANDOM: an unset bg (or "random") rotates the pool deterministically
      // per clip (seeded by start time) so a multi-clip run varies the gameplay bg
      // (e.g. a 1h video → 10 clips each with a different loop), no Math.random.
      const wantId = config.bgId || RANDOM_GAMEPLAY_ID;
      const bgId = wantId === RANDOM_GAMEPLAY_ID
        ? randomGameplayId(Math.round((m.startSeconds ?? 0) * 1000))
        : wantId;
      const bgUrl = gameplayUrl(bgId);
      if (!bgUrl) return [];
      return [{ op: "composite_bg", layout: "vstack", bgUrl, clipPos: "top" }];
    },
  },
  {
    id: "clip.memeaudio",
    name: "MEME reaction SFX",
    icon: "🔊",
    tag: "Audio",
    blurb: "Drops a reaction sound effect on the clip's punchiest beat automatically.",
    priceLabel: "Free",
    defaultInstalled: false,
    // Live: the curated reaction SFX pack is hosted (REACTION_SFX_BASE_URL set).
    // Fully automatic, no user config. Degrades gracefully (no SFX) on a neutral
    // moment or when the pack base URL is unset, so it's safe to surface un-greyed.
    markdownTemplate: [
      "# MEME reaction SFX",
      "",
      "**What I do:** Automatically drop a reaction sound (vine boom / fah / bruh) at the clip's key emotional beat. The AI decides WHICH sting and WHEN from the moment's content, no manual picking, no gain slider.",
      "",
      "**Editor rules:**",
      "- Applied deterministically from the moment's emotion; do not add other ops on its behalf.",
    ].join("\n"),
    // DYNAMIC / content-reactive: the AI still auto-picks WHICH bucket fires (from
    // the moment's emotion) and WHEN; the inspector's sfxPackId only swaps the pack
    // (which sound each bucket maps to). A neutral moment gets NO sting (don't force
    // one where it doesn't fit). Fixed gain (-3 dB); degrades to no-op when the pack
    // URL is unset. Unset/unknown sfxPackId ⇒ the default "Gen Z Meme" pack, so
    // legacy nodes behave EXACTLY as before. atSec is keyed by the emotion BUCKET
    // (not the sting file) so a new pack's files keep the right per-emotion timing.
    floor: (m, config) => {
      const bucket = reactionBucketForEmotion(m.emotion);
      if (!bucket) return [];
      const pack = reactionSfxPackById(config.sfxPackId);
      const url = reactionSfxUrl(pack.stings[bucket]);
      if (!url) return [];
      const len = Math.max(0, m.endSeconds - m.startSeconds);
      const atSec = Math.min(Math.max(0, len - 0.5), reactionSfxTargetSec(bucket));
      return [{ op: "audio_overlay", audioUrl: url, atSec, gainDb: -3 }];
    },
  },
  {
    id: "clip.trendingaudio",
    name: "Trending Audio",
    icon: "🎵",
    tag: "Music",
    blurb: "Adds a trending music bed under the clip, auto-matched to mood and speech density.",
    priceLabel: "$0.15",
    defaultInstalled: false,
    // Live once the curated music pack is hosted (TRENDING_AUDIO_BASE_URL set). When
    // unset, trendingAudioUrl() returns "" → no audio_overlay op → render unchanged
    // (graceful degrade), so it's safe to surface before the tracks are uploaded.
    markdownTemplate: [
      "# Trending Audio",
      "",
      "**What I do:** Mix a trending music bed UNDER the clip — your own uploaded MP3 if you set one, otherwise a built-in sound picked in the node's inspector, or **Auto-pick** to match the clip's mood automatically.",
      "",
      "**Auto-pick reads the clip's own transcript:** a dialogue-heavy clip (near-continuous talking) gets an instrumental bed so a sung vocal never fights the speaker's voice; a lighter/visual clip can still get a full vocal track when the mood calls for it.",
      "",
      "**Editor rules:**",
      "- Apply the chosen/auto music deterministically; do not add other ops on its behalf.",
    ].join("\n"),
    // Uploaded MP3 WINS over everything; else manual pick; else auto-pick by mood
    // when autoMusic === true (the default, set by the inspector + the clipJobs
    // wired-default injection). Quiet bed gain (-28 dB, ~20% on the inspector's
    // slider) so speech stays clearly dominant, no ducking in v1. Graceful no-op
    // when the pack/env is unset (url === ""), mirrors brainrot/memeaudio.
    floor: (m, config) => {
      // Default bed level ≈ 20% on the inspector's (quadratic-taper) slider — a
      // quiet bed, not the old -6dB/50% default that read as "still loud". Must
      // match DEFAULT_MUSIC_GAIN_DB in inspector-panel.tsx (display == render).
      const gainDb = typeof config.gainDb === "number" ? config.gainDb : -28;
      // Operator's own upload short-circuits the curated pack entirely.
      if (typeof config.customAudioUrl === "string" && config.customAudioUrl.trim()) {
        return [{ op: "audio_overlay", audioUrl: config.customAudioUrl.trim(), atSec: 0, gainDb }];
      }
      // Stored pick wins when it's still a valid curated track; a stale/removed id
      // falls back to mood auto-pick so config that survived a library swap never
      // goes silent. A fully bare node stays INERT (no music unless asked).
      let id = isTrendingAudioId(config.musicTrackId) ? config.musicTrackId : "";
      const stalePick = !id && typeof config.musicTrackId === "string" && config.musicTrackId.length > 0;
      if (!id && (config.autoMusic === true || stalePick)) {
        // Dialogue-heavy clip → instrumental only (no vocal song competing with
        // the speaker's own voice). config.heavyDialogue is computed upstream
        // from the clip's real transcript (clipEditPlanner.isDialogueHeavy) —
        // never set by hand, so a manual musicTrackId pick is never overridden.
        id = pickTrendingTrackByMood(m.emotion, Math.round((m.startSeconds ?? 0) * 1000), config.heavyDialogue === true);
      }
      if (!id) return [];
      const url = trendingAudioUrl(id);
      if (!url) return [];
      return [{ op: "audio_overlay", audioUrl: url, atSec: 0, gainDb }];
    },
  },
  {
    id: "clip.campaignscout",
    name: "Campaign Scout",
    icon: "🔎",
    tag: "Campaigns",
    blurb: "Scans the campaign marketplace and flags the ones this clip fits.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Campaign Scout",
      "",
      "**What I do:** On every pipeline run, match this video against active brand campaigns (niche + brief keywords) and surface the best fits in the run log.",
      "",
      "Pick which campaigns to consider in the node's inspector, none selected = all active campaigns.",
    ].join("\n"),
    floor: () => [],
  },
  {
    id: "clip.prompt",
    name: "Prompt to Clip",
    icon: "🗣️",
    tag: "Targeting",
    blurb: "Tells the clipper which moments to find inside your source video.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Prompt to Clip",
      "",
      "**What I do:** Steer moment selection with your prompt. Click the node and type what to look for.",
      "",
      "Type your prompt in the node's inspector, e.g. \"find every moment about money\".",
    ].join("\n"),
    floor: () => [],
  },
  // ── Caption style presets (OpusClip-style "Quick presets") ────────────────
  {
    id: "clip.style.beasty",
    name: "Beasty Captions",
    icon: "🅱️",
    tag: "Caption style",
    blurb: "Bold all caps white captions in the classic creator style.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: ["# Beasty Captions", "", "Style preset: karaoke, ALL CAPS, bold white, large."].join("\n"),
    floor: () => [],
  },
  {
    id: "clip.style.mozi",
    name: "Mozi Captions",
    icon: "🟢",
    tag: "Caption style",
    blurb: "All caps white captions with neon green highlighted key words.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: ["# Mozi Captions", "", "Style preset: karaoke, ALL CAPS, white + neon-green keyword highlights."].join("\n"),
    floor: () => [],
  },
  {
    id: "clip.style.podp",
    name: "Pod P Captions",
    icon: "💜",
    tag: "Caption style",
    blurb: "Punchy magenta podcast style captions for the clip.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: ["# Pod P Captions", "", "Style preset: karaoke, magenta, large."].join("\n"),
    floor: () => [],
  },
  {
    id: "clip.transitions",
    name: "Transitions",
    icon: "🎞️",
    tag: "Transitions",
    blurb: "Adds smooth cross fade transitions at the clip seams, no hard cuts.",
    priceLabel: "Free",
    defaultInstalled: false,
    markdownTemplate: [
      "# Transitions",
      "",
      "**What I do:** Add a smooth transition at the clip's seams, the title-card slate → clip body, the clip body → CTA video, and between stitched clips, so nothing hard-cuts.",
      "",
      "Pick the transition style + duration in the node's inspector.",
      "",
      "**Editor rules:**",
      "- This is a whole-output render setting, not an edit op, emit no ops for it.",
    ].join("\n"),
    // No floor: transitions are a render-level setting (like the CTA), lifted from
    // this node into clipConfig.transition by compile-graph and applied at the
    // ffmpeg seams (lib/server/clipFilterGraph title join, lib/server/ctaAppend CTA
    // join, app/api/video/concat multi-clip stitch), never as an EditOp.
  },
  {
    id: "clip.carouselbuilder",
    name: "Photo Carousel Builder",
    icon: "🎠",
    tag: "Apps",
    blurb: "Generates KIE images from a prompt and posts them as a TikTok photo carousel.",
    priceLabel: "Free",
    defaultInstalled: false,
    // APP-ONLY: this is not a clipping effect — installing it unlocks a dedicated
    // "Carousel" tab in the clipper workspace (prompt → generate → history → post),
    // NOT a node on the canvas. No floor; appOnly keeps it out of the node palette,
    // the graph compile, and the floor passes (it emits no edit ops).
    appOnly: true,
    markdownTemplate: [
      "# Photo Carousel Builder",
      "",
      "**What I do:** Generate a batch of images from a prompt with KIE (pick the model: ChatGPT Image 2 / Nano Banana 2 / Nano Banana Pro) and publish them as a TikTok photo carousel.",
      "",
      "Open the **Carousel** tab in the clipper workspace: type a prompt, pick a model + aspect ratio, generate, then select the images and post the carousel to TikTok.",
    ].join("\n"),
  },
];

/** captionStyle each caption-affecting skill implies (presets + emoji). The
 *  style skills now resolve to the OpusClip-parity preset engine
 *  (lib/builder/captionPresets.ts), legacy fields kept as the degrade path
 *  for any consumer that ignores `preset`. */
export const CAPTION_SKILL_STYLE: Record<string, Partial<ClipFloorConfig["captionStyle"]>> = {
  "clip.captions": {},
  "clip.captionstyle": {}, // Smart Captions, forces captions on; prompt added in applyCaptionSkillStyle
  "clip.keywords": { emoji: true, highlightColor: "#05F827" }, // emoji flag = keyword-highlight mode; bright-green pop (gold default was ~= the yellow base)
  "clip.style.beasty": { preset: "beasty", mode: "karaoke", fontColor: "#FFFFFF", fontSize: 70, position: "bottom", uppercase: true },
  "clip.style.mozi": { preset: "mozi", mode: "karaoke", fontColor: "#FFFFFF", fontSize: 70, position: "bottom", uppercase: true, highlightColor: "#39FF14" },
  "clip.style.podp": { preset: "podp", mode: "karaoke", fontColor: "#FF2D78", fontSize: 64, position: "bottom" },
};
export const isCaptionSkillId = (id: string): boolean => id in CAPTION_SKILL_STYLE;

export const CLIP_SKILL_BY_ID: Record<string, ClipSkill> = Object.fromEntries(
  CLIP_SKILLS.map((s) => [s.id, s]),
);

export const isClipSkillId = (id: string): boolean => id.startsWith("clip.");

/** True when a clip skill is work-in-progress (real but inert until its env is
 *  set). Single source of truth, every UI greys/badges the same set. */
export const isWipClipSkill = (id: string): boolean => Boolean(CLIP_SKILL_BY_ID[id]?.wip);

export const DEFAULT_CLIP_SKILL_IDS = CLIP_SKILLS.filter((s) => s.defaultInstalled).map((s) => s.id);

/** Marketplace categories (broad groupings over the finer per-skill tags). */
export const CLIP_SKILL_CATEGORIES = [
  "Captions",
  "Post Caption",
  "Hooks & Openers",
  "Overlays & Emphasis",
  "Image Overlay",
  "Pacing",
  "Framing",
  "Backgrounds & Audio",
  "Music",
  "Transitions",
  "Targeting & Discovery",
  "Quality & Safety",
  "Sources",
  "Apps",
] as const;
export type ClipSkillCategory = (typeof CLIP_SKILL_CATEGORIES)[number];

const CATEGORY_BY_ID: Record<string, ClipSkillCategory> = {
  "clip.captions": "Captions",
  "clip.captionstyle": "Post Caption",
  "clip.guardrails": "Quality & Safety",
  "clip.keywords": "Captions",
  "clip.title": "Hooks & Openers",
  "clip.hook": "Hooks & Openers",
  "clip.cta": "Overlays & Emphasis",
  "clip.hookvideos": "Hooks & Openers",
  "clip.maincontent": "Sources",
  "clip.meme": "Overlays & Emphasis",
  "clip.sticker": "Overlays & Emphasis",
  "clip.overlayimage": "Image Overlay",
  "clip.zoom": "Overlays & Emphasis",
  "clip.speed": "Pacing",
  "clip.fillercut": "Pacing",
  "clip.multiscene": "Pacing",
  "clip.facetrack": "Framing",
  "clip.filters": "Overlays & Emphasis",
  "clip.brainrot": "Backgrounds & Audio",
  "clip.memeaudio": "Backgrounds & Audio",
  "clip.trendingaudio": "Music",
  "clip.transitions": "Transitions",
  "clip.prompt": "Targeting & Discovery",
  "clip.campaignscout": "Targeting & Discovery",
  "clip.carouselbuilder": "Apps",
};
export const categoryForSkill = (id: string): ClipSkillCategory | undefined => CATEGORY_BY_ID[id];

/** True for app-only installs (e.g. clip.carouselbuilder) — they unlock a builder
 *  TAB, not a canvas node, so every node/floor consumer must skip them. */
export const isAppOnlySkill = (id: string): boolean => Boolean(CLIP_SKILL_BY_ID[id]?.appOnly);

/** Skills hidden from the marketplace: the standalone caption-style skills are
 *  now redundant with the Dynamic Captions node's 10-preset picker (each maps
 *  1:1 to a preset). Kept in CAPTION_SKILL_STYLE so any already-installed copy
 *  still resolves, but no longer offered as separate draggable nodes. */
const DEPRECATED_SKILL_IDS = new Set(["clip.style.beasty", "clip.style.mozi", "clip.style.podp", "clip.title"]);
export const isDeprecatedSkill = (id: string): boolean => DEPRECATED_SKILL_IDS.has(id);

/** The skills shown in the marketplace (deprecated styles excluded). */
export const MARKETPLACE_CLIP_SKILLS = CLIP_SKILLS.filter((s) => !isDeprecatedSkill(s.id));
