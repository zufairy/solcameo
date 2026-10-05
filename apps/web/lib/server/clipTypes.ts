export interface TranscriptWord { word: string; start: number; end: number; }
export interface TranscriptSegment { start: number; end: number; text: string; }
export interface Transcript { segments: TranscriptSegment[]; words: TranscriptWord[]; durationSeconds: number; }

export interface ClipMoment {
  startSeconds: number; endSeconds: number;
  title: string; reason: string; viralScore: number; captionText: string;
  /** LLM-graded emotion of the moment (funny|shocking|inspiring|informative|
   *  emotional|controversial), from clipAnalysis. Drives context-aware effect
   *  placement (e.g. when the meme-audio sting lands). Optional — the live
   *  selectClipMoments path may not set it (defaults apply). */
  emotion?: string;
}

export interface CaptionStyle {
  mode: "karaoke" | "line";
  fontColor: string;
  fontSize: number;
  position: "top" | "center" | "bottom";
  /** Exact vertical placement (0-100, % from the top) from the Editor tab's
   *  drag-to-position control — overrides `position`'s fixed band when set.
   *  Mirrors TextStyle/text_overlay's yPct so captions can be dragged in the
   *  preview exactly like the hook text can. */
  yPct?: number;
  /** Render caption text in ALL CAPS (preset styles like Beasty/Mozi). */
  uppercase?: boolean;
  /** Secondary color for emphasized words (two-tone presets). */
  highlightColor?: string;
  /** Append keyword emoji + color-emphasize key words (Emoji Captions skill). */
  emoji?: boolean;
  /** OpusClip-parity preset id (lib/builder/captionPresets.ts). When set, the
   *  renderer uses the chunked word-sync engine with that preset's full spec —
   *  the fields above only apply to the legacy single-word/line modes. */
  preset?: string;
  /** Smart Captions (clip.captionstyle): the operator's freeform instruction for
   *  the caption TEXT — translate / change casing / add emojis / rephrase. The
   *  clip route rewrites the in-window words per this prompt before rendering. */
  prompt?: string;
}
export interface TextStyle {
  fontColor: string;
  /** Solid box drawn behind the text (drawtext box=1:boxcolor). */
  bgColor?: string;
  /** Editorial hook treatment draws a separate background behind complete lines. */
  hookLayout?: import("@/lib/builder/hookDesigns").HookLayout;
  hookAccentColor?: string;
  /** Editorial hook entrance + shine sweep (lib/builder/hookDesigns HookMotion). */
  hookMotion?: import("@/lib/builder/hookDesigns").HookMotion;
  fontSize: number;
  bold: boolean;
  /** drawtext bordercolor (text outline). Defaults to black when unset. */
  outlineColor?: string;
  /** drawtext borderw px. Defaults to 3 when unset (the legacy outline). */
  outlineWidth?: number;
  /** Hook-design font TOKEN (see lib/server/hookFonts HOOK_FONT_FILE). When set, the
   *  drawtext path burns THIS overlay in the template's bundled font instead of the
   *  generic global clip font — so an Auto Hook renders in Manrope/Montserrat/etc. */
  font?: string;
  /** Max wrapped lines for this overlay (wrapDrawtext). Defaults to 2 (hook-sized).
   *  Long text-story overlays (the TikTok "read the whole block" format) pass a
   *  bigger cap so the story wraps into a tall centered stack instead of being
   *  shrunk + ellipsis-truncated at two lines. */
  maxLines?: number;
}

export interface ClipConfig {
  velloWatermark?: boolean;
  clipLength: { min: number; max: number };
  maxClipsPerSource: number;
  /** "Let AI decide" — when true the cloud/local paths use the analyzer's natural
   *  moment count (capped at 30) instead of the manual maxClipsPerSource slider.
   *  Persisted on influencers.clipConfig (raw v.any) by the canvas. */
  autoPlan?: boolean;
  /** Ceiling on the autoPlan branch's clip count, in place of the hardcoded 30 —
   *  set by /api/agents/config for free-plan accounts (10) so "let AI decide"
   *  can't out-produce a free account's trial credits; absent (→ default 30)
   *  for paid accounts. See convex/clipJobs.ts's requestedCount. */
  autoPlanMaxClips?: number;
  /** Output canvas aspect from the Aspect Crop node / Editor aspect picker.
   *  Unset = 9:16 (the historical default). */
  outputAspect?: "9:16" | "16:9" | "1:1" | "4:5";
  captionsOn: boolean;
  captionStyle: CaptionStyle;
  hookStyle: "cold_open" | "context_first";
  platforms: string[];
  autoPost: boolean;
  /** Work tab cadence: clip runs the autonomous loop may start per UTC day (0 = unlimited). */
  clipsPerDay?: number;
  /** Independent campaign distribution cadence; own content keeps the base schedule. */
  campaignPosting?: { maxPerDay: number; postIntervalMs: number; dailyStartHour?: number; dailyStartMinute: number };
  brandLogoUrl?: string;
  /** Video Call To Action app (clip.cta): URL of an operator-uploaded clip appended
   *  to the END of every produced clip (aspect-normalized concat post-render). */
  ctaVideo?: string;
  /** Hook Videos app (clip.hookvideos): pool of operator-uploaded videos, one of
   *  which is PREPENDED to every produced clip. The pick is contextual (best
   *  transcript match, see lib/server/videoPool). Joined before the overlay stage
   *  so an Auto Hook text line burns OVER the hook video. */
  hookVideos?: string[];
  /** Main Content app (clip.maincontent): pool of operator-uploaded body videos. */
  mainVideos?: string[];
  /** Main Content app's "No clip / UGC needed" switch. When true the run skips
   *  moment selection and rendering-from-source entirely and publishes an uploaded
   *  main video (hook prepended, captions/filters/CTA still applied). */
  mainOnly?: boolean;
  /** Transitions app (clip.transitions): the seam transition applied at the clip's
   *  joins — title-slate→body, body→CTA, and between stitched clips. Lifted from the
   *  clip.transitions node by compile-graph; applied by the ffmpeg seams. */
  transition?: { id: string; durationSec: number };
  /** Spacing between consecutive auto-posts, in ms. Snapped to a 15-min grid at
   *  normal sizes; sub-15-min values snap to whole minutes (min 1min for testing),
   *  max 24h. Defaults to DRIP_STAGGER_MS. */
  postIntervalMs?: number;
  /** Max auto-posts scheduled per calendar day. 0 = OFF/unlimited. Clamped 0..48. */
  maxPerDay?: number;
  /** Order clips are published in: "best" (viralScore desc, default), "newest"
   *  (createdAt desc), "oldest" (createdAt asc), or "random" (shuffle). */
  postOrder?: "best" | "newest" | "oldest" | "random";
  /** Local hour 0..23 each day's drip should START at. undefined = legacy
   *  (first post one interval from now). When set, the first slot each day is
   *  anchored to this clock time. */
  dailyStartHour?: number;
  /** Local minute 0..59 paired with dailyStartHour. Defaults 0 when hour set. */
  dailyStartMinute?: number;
  /** IANA zone the schedule + calendar should follow (DST-correct). undefined =
   *  host-local default. Day-bucketing + the daily-start clock time resolve in
   *  this zone; the stored scheduledFor stays an absolute epoch instant. */
  timezone?: string;
}
