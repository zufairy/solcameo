"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { HookShine } from "@/components/builder/hook-shine";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { VelloWatermark } from "./VelloWatermark";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { LazyVideo } from "@/components/ui/lazy-video";
import { ConfirmDeleteDialog, postDelete } from "@/components/ui/confirm-delete-dialog";
import {
  Sparkles, Captions, Upload as UploadIcon, Palette,
  Music, Volume2, Trash2, Play, Pause, Download, Loader2, CheckCircle2, AlertCircle,
  X, Check, ExternalLink, Scissors, Zap, ImagePlus, Focus, Clapperboard, Search, Maximize2, Wand2, Film, Send, MoreHorizontal, ArrowUpRight,
} from "lucide-react";
import { CAPTION_PRESETS, CAPTION_PRESET_BY_ID, captionPillPadding, type CaptionPresetRender } from "@/lib/builder/captionPresets";
import { HOOK_FONT_FAMILY, burnFontStack } from "@/lib/builder/burnFonts";
import { CLIP_GENRES } from "@/lib/builder/clipGenres";
import { HookFxCanvas, HookFxMini } from "@/components/builder/hook-fx-preview";
import { HOOK_DESIGNS, HOOK_DESIGN_BY_ID, hookBlockLayout, hookFxLayout, isHookFxLayout, hookHeadlineLines, DEFAULT_HOOK_DURATION_SEC, HOOK_DURATION_MIN, HOOK_DURATION_MAX } from "@/lib/builder/hookDesigns";
import type { TrendingAudioEntry } from "@/lib/server/trendingAudioPack";
import type { ReactionSfxEntry, ReactionSfxPack } from "@/lib/server/reactionSfxPack";
import { useClippingStore } from "@/components/builder/clipping-flow/store/clipping-store";
import { VideoSourceThumbnail } from "@/components/builder/clipping-flow/source-preview";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { driveFileIdentity, looksLikeDriveFolder, looksLikeGoogleDrive } from "@/lib/client/driveFolder";
import { composePostCaptionInstruction, readPostCaptionSettings, POST_CAPTION_CONFIG_KEYS } from "@/lib/builder/postCaptionInstruction";
import { CLIP_COVER_SKILL_ID, readCoverImageUrl, withCoverImageUrl } from "@/lib/builder/coverImageConfig";
import { FILTER_CHIPS, FILTER_PRESET_IDS } from "@/lib/builder/filterStyles";
import { buildCameraPlan, buildDualShotPlan, shotAt, cropAt, computeFramedGeometry, computeTrackedFaceGeometry, sanitizeShots, MODE_TARGET_ZOOM, MODE_MAX_ZOOM, FACE_CROP_MIN_ZOOM, FACE_CROP_MAX_ZOOM, FRAMING_DEBOUNCE_MS, FACE_SCAN_MAX_S, type FaceShot, type SamplePoint, type CameraGeometry, type DualShotPlan } from "@/lib/builder/faceShots";
import { buildClipRunProgress, findEditorClipRun, type ClipRunJob } from "@/lib/builder/clip-run-progress";
import { explainClipFailure } from "@/lib/clip/failure";
import { uploadMediaFile } from "@/lib/client/uploadMedia";
import { estimateClipRunCredits, perClipCredits } from "@/lib/economy/clipCreditPricing";

const HOOK_LANGUAGES = ["English", "Spanish", "Portuguese", "Indonesian", "Malay", "Chinese", "French", "German", "Hindi"];
// Same code+label table transcribe-clip/route.ts's `languageName()` uses —
// keep in sync so a code picked here is guaranteed recognized server-side.
// "" = auto-detect (ElevenLabs picks, with a low-confidence re-run pinned to
// whatever it detected — see transcribe-clip/route.ts's LANG_CONFIDENCE_FLOOR).
const CAPTION_LANGUAGES: { code: string; label: string }[] = [
  { code: "", label: "Auto detect" },
  { code: "en", label: "English" },
  { code: "ms", label: "Malay / Bahasa Melayu" },
  { code: "id", label: "Indonesian / Bahasa Indonesia" },
  { code: "zh", label: "Chinese" },
  { code: "ta", label: "Tamil" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
];

// Subtitle language for the BURNED captions — same codes as CAPTION_LANGUAGES
// (burn route → lib/server/captionTranslate uses them as the translation target),
// with "" meaning "same as spoken" (no translation) instead of auto-detect.
const SUBTITLE_LANGUAGES: { code: string; label: string }[] = [
  { code: "", label: "Same as spoken (no translation)" },
  ...CAPTION_LANGUAGES.filter((l) => l.code !== ""),
];

// Post Captions tool (the social-post caption, not the burned-in video captions) —
// no canonical mood list exists elsewhere in the codebase, so this is a small,
// deliberately generic set that maps cleanly onto how operators actually talk
// about caption tone; forwarded verbatim into the instruction sent to
// generatePostCaption (lib/server/captionTransform.ts) via /api/agents/post-caption/generate.
const POST_CAPTION_MOODS = ["Hype", "Casual", "Professional", "Funny", "Emotional", "Chill"];

// HOOK_DESIGNS' `preview` CSSProperties never carried fontSize/fontFamily (only
// color/weight/shadow) — the browser preview rendered at browser-default size
// in a generic font, nothing like the actual burned line. `render.font` is a
// bundled fontconfig TOKEN (lib/server/hookFonts), not a CSS name, and
// `render.fontSize` is authored at a 1080px-wide reference canvas — this maps
// both to real CSS so "sizing is real" (scaled to the ACTUAL preview width).
// Exact bundled family per token (burnFonts), loaded via @font-face from the
// same .ttf the libass hook burn uses — so the preview glyphs ARE the burn's.
const HOOK_FONT_STACK: Record<string, string> = Object.fromEntries(
  Object.entries(HOOK_FONT_FAMILY).map(([token, family]) => [token, burnFontStack(family)]),
);
function hookTextStyle(design: import("@/lib/builder/hookDesigns").HookDesign, fontPx: number): CSSProperties {
  return {
    color: design.render.fontColor,
    fontFamily: HOOK_FONT_STACK[design.render.font] ?? "system-ui, sans-serif",
    // The bundled file already contains its intended weight/style. Asking the
    // browser to synthesize bold or italic made preview glyphs differ from ffmpeg.
    fontWeight: 400,
    fontStyle: "normal",
    letterSpacing: 0,
    fontSize: fontPx,
  };
}

function HookHeadlinePreview({ design, text, fontPx, compact = false }: {
  design: import("@/lib/builder/hookDesigns").HookDesign;
  text: string;
  fontPx: number;
  compact?: boolean;
}) {
  const render = design.render;
  // Animated entrance templates: live mini of the real burn geometry + motion.
  if (isHookFxLayout(render.layout)) {
    return <HookFxMini design={design} text={text} widthPx={Math.round(fontPx * 1080 / Math.max(1, render.fontSize))} replayKey={`${design.id}:${text}`} />;
  }
  const lines = hookHeadlineLines(render.allCaps ? text.toUpperCase() : text, render.fontSize, 1080 * 0.76,
    render.layout === "news-card" ? 3 : 4);
  const pad = compact ? 5 : Math.max(5, fontPx * 0.25);
  const card = render.layout === "news-card";
  return (
    <div className="relative mx-auto flex max-w-[92%] flex-col items-center overflow-hidden text-center"
      style={card ? { width: "84%", padding: `${pad}px ${pad * 1.5}px`, borderRadius: Math.max(8, fontPx * 0.5), backgroundColor: render.boxColor } : undefined}>
      {lines.map((line, index) => (
        <span key={`${index}-${line}`} className="block max-w-full whitespace-nowrap leading-[1.16]"
          style={{
            ...hookTextStyle(design, fontPx),
            color: card && index === lines.length - 1 ? render.accentColor ?? render.fontColor : render.fontColor,
            backgroundColor: card ? undefined : render.layout === "stacked" && index % 2 ? render.accentColor : render.boxColor,
            paddingInline: card ? 0 : pad,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
          {line}
        </span>
      ))}
      <HookShine motion={render.motion} />
    </div>
  );
}

/** The hook EXACTLY as it will burn: every card/line rect and text line comes
 *  from hookBlockLayout — the same function lib/server/clipFilterGraph burns
 *  with — computed on the real burn canvas (BURN_CANVAS) and scaled down to the
 *  preview box. What the operator drags here is pixel-for-pixel what renders.
 *  `children` go inside the block's exact bounds (drag/delete/resize handles). */
function HookBurnPreview({ design, text, fontScale, yPct, aspect, canvasWidthPx, onPointerDown, children }: {
  design: import("@/lib/builder/hookDesigns").HookDesign;
  text: string;
  fontScale: number;
  yPct: number;
  aspect: AspectRatio;
  canvasWidthPx: number;
  onPointerDown?: (e: React.PointerEvent) => void;
  children?: React.ReactNode;
}) {
  const r = design.render;
  const c = BURN_CANVAS[aspect];
  const k = canvasWidthPx / c.w;
  if (isHookFxLayout(r.layout)) {
    const fx = hookFxLayout({
      text: r.allCaps ? text.toUpperCase() : text, kind: r.layout, fontSize: Math.round(r.fontSize * fontScale),
      font: r.font, fontColor: r.fontColor, boxColor: r.boxColor, accentColor: r.accentColor,
      position: r.position, yPct, width: c.w, height: c.h,
    });
    if (!fx) return null;
    return (
      <HookFxCanvas key={`${design.id}:${text}`} geo={fx} k={k} motion={r.motion} width={c.w} height={c.h}>
        <div onPointerDown={onPointerDown} className="absolute inset-0">{children}</div>
      </HookFxCanvas>
    );
  }
  const geo = r.layout && r.layout !== "plain"
    ? hookBlockLayout({
      text: r.allCaps ? text.toUpperCase() : text,
      fontSize: Math.round(r.fontSize * fontScale),
      layout: r.layout, font: r.font, fontColor: r.fontColor, boxColor: r.boxColor, accentColor: r.accentColor,
      position: r.position, yPct, width: c.w, height: c.h,
    })
    : null;
  if (!geo) return null;
  const px = (n: number) => `${n * k}px`;
  const textStyle = hookTextStyle(design, geo.size * k);
  // The drag/handle hit area = the block's burned bounds (card, or widest line box).
  const hitX = geo.card ? geo.card.x : Math.min(...geo.lines.map((l) => l.box?.x ?? c.w * 0.08));
  const hitW = geo.card ? geo.card.w : Math.max(...geo.lines.map((l) => l.box?.w ?? c.w * 0.84));
  return (
    <div className="pointer-events-none absolute inset-0">
      {geo.card && (
        <div className="absolute overflow-hidden"
          style={{ left: px(geo.card.x), top: px(geo.card.y), width: px(geo.card.w), height: px(geo.card.h), borderRadius: px(geo.card.radius), background: geo.card.color }}>
          <HookShine motion={r.motion} />
        </div>
      )}
      {geo.lines.map((l, i) => l.box && (
        <div key={`b${i}`} className="absolute overflow-hidden"
          style={{ left: px(l.box.x), top: px(l.box.y), width: px(l.box.w), height: px(l.box.h), background: l.box.color }}>
          <HookShine motion={r.motion} />
        </div>
      ))}
      {geo.lines.map((l, i) => (
        // drawtext draws the line's text box (font ascent→descent) starting at y,
        // horizontally centred on the frame — line-height:normal is that same box.
        <div key={`t${i}`} className="absolute inset-x-0 whitespace-nowrap text-center"
          style={{ ...textStyle, top: px(l.y), lineHeight: "normal", color: l.color }}>
          {l.text}
        </div>
      ))}
      <div onPointerDown={onPointerDown}
        className="group pointer-events-auto absolute cursor-move touch-none select-none"
        style={{ left: px(hitX), top: px(geo.top), width: px(hitW), height: px(geo.totalH) }}>
        {children}
      </div>
    </div>
  );
}

// Common short words that make a bad stock-search query on their own — filtered
// out when guessing a B-Roll query from a clip's transcript/title so "the video
// is about how to fix your car" searches "fix car", not "the video about how".
const BROLL_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "at", "for", "with", "this", "that", "these", "those",
  "it", "its", "you", "your", "i", "we", "they", "he", "she", "his", "her",
  "how", "what", "why", "when", "where", "just", "so", "very", "really", "about",
  "video", "clip", "watch", "https", "http", "com", "www", "today", "here", "now",
]);
/** Guess a short stock-search query from a clip's transcript/title — takes the
 *  first 3-4 "content words" (>2 chars, not a stopword, not pure digits/URL
 *  junk). Pure, no I/O — the B-Roll drawer's auto-search effect calls this on
 *  the SAME `selectedContent` signal the AI Hook feature already grounds its
 *  hooks in. Returns "" when nothing usable is found (drawer falls back to the
 *  empty "type to search" state instead of guessing garbage). */
export function extractBrollQuery(text: string): string {
  const words = text
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !BROLL_STOPWORDS.has(w) && !/^\d+$/.test(w));
  return words.slice(0, 4).join(" ");
}

// Groups a resolved track list the SAME way the Clipping tab's node-inspector
// picker does (inspector-panel.tsx TrendingAudioPicker) — folder tracks first
// (label = capitalized folder name), then one trailing "More sounds" group for
// the root (unfoldered) tracks, so this drawer looks/organizes identically.
function groupTrendingAudio(tracks: TrendingAudioEntry[]) {
  const byFolder = new Map<string, TrendingAudioEntry[]>();
  const root: TrendingAudioEntry[] = [];
  for (const t of tracks) {
    if (t.folder) {
      const arr = byFolder.get(t.folder) ?? [];
      arr.push(t);
      byFolder.set(t.folder, arr);
    } else root.push(t);
  }
  const groups: { label: string | null; tracks: TrendingAudioEntry[] }[] = [...byFolder.entries()].map(([folder, folderTracks]) => ({
    label: folder.charAt(0).toUpperCase() + folder.slice(1),
    tracks: folderTracks,
  }));
  if (root.length) groups.push({ label: groups.length ? "More sounds" : null, tracks: root });
  return groups;
}

function fmtDownloadDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// A long lorem-ipsum demo line, chunked into pages of 4 — long enough to keep
// paging (and re-playing the entrance animation) for the WHOLE clip instead of
// running out after a couple of seconds; it loops (modulo) once it runs out.
const CAPTION_DEMO_TEXT =
  "nobody tells you this but the first year is the hardest part and if you can just push through it everything after that gets so much easier trust me on this one thing";
const CAPTION_DEMO_PAGES = (() => {
  const words = CAPTION_DEMO_TEXT.split(" ");
  const per = 4;
  const pages: string[][] = [];
  for (let i = 0; i < words.length; i += per) pages.push(words.slice(i, i + per));
  return pages;
})();
// Natural on-screen time per page before the next one pops in (seconds) — the
// canvas loops through CAPTION_DEMO_PAGES at this cadence for as long as the
// caption overlay's window lasts, instead of dividing the window into exactly
// 3 slices (which would make each page crawl by on a long clip).
const CAPTION_PAGE_SECONDS = 1.4;

/** Burn canvas per aspect — mirrors overlay-burn's ASPECTS, i.e. the ASS
 *  PlayResX/Y the caption fontSize/outline/shadow are expressed in. */
const BURN_CANVAS: Record<"9:16" | "16:9" | "1:1", { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
};

/** Preview font size (CSS px) for a preset on a canvas `canvasWidthPx` wide —
 *  the SAME size math as captionRenderer (preset fontSize at burn res, capped to
 *  7.5% of height on landscape), scaled down to the preview box. */
function captionPreviewFontPx(r: CaptionPresetRender, aspect: "9:16" | "16:9" | "1:1", canvasWidthPx: number): number {
  const c = BURN_CANVAS[aspect];
  const fs = c.w > c.h ? Math.min(r.fontSize, Math.round(c.h * 0.075)) : r.fontSize;
  return Math.max(8, fs * (canvasWidthPx / c.w));
}

/** Renders one caption "page" straight off the preset's BURN spec (render), not
 *  a hand-tuned CSS swatch: the same bundled .ttf (burnFonts @font-face, native
 *  weight — Bold=0 in the ASS), outline as a stroke of the same width, the ASS
 *  drop shadow (BackColour &H64000000 ≈ 61% black), pill box, active-word
 *  color/scale/underline, keyword font swap, stacked lines and cumulative reveal.
 *  All lengths are in `em` of the burn fontSize, so the container's font-size
 *  alone scales it (canvas: captionPreviewFontPx; drawer card: fixed px).
 *  `activeWordIdx` is the word currently "spoken". */
function CaptionPageWords({ preset, page, activeWordIdx }: { preset: import("@/lib/builder/captionPresets").CaptionPreset; page: string[]; activeWordIdx: number }) {
  const r = preset.render;
  const em = (px: number) => `${px / r.fontSize}em`;
  const text = (w: string) => (r.allCaps ? w.toUpperCase() : w);
  const pick = <T,>(arr: readonly T[] | undefined, i: number): T | undefined => (arr && arr.length ? arr[i % arr.length] : undefined);
  const pad = r.pillBg ? captionPillPadding(r) : 0;
  const lineOf = (i: number) => (r.stackAfter && i >= r.stackAfter ? 1 : 0);
  const wordStyle = (i: number): CSSProperties => {
    const active = i === activeWordIdx;
    const line = lineOf(i);
    // Keyword presets: the preview has no transcript keywords, so the active
    // word stands in for "the highlighted word" (same as the old swatch).
    const kw = active && !!(r.keywordFont || r.keywordColor || r.keywordScale);
    const family = (kw && r.keywordFont) || pick(r.lineFonts, line) || pick(r.wordFonts, i) || r.font;
    let color = pick(r.lineColors, line) ?? pick(r.wordColors, i) ?? r.fontColor;
    if (r.spokenColor && i <= activeWordIdx) color = r.spokenColor;
    if (active && r.activeColor) color = r.activeColor;
    if (kw && r.keywordColor) color = r.keywordColor;
    let scale = (pick(r.lineScales, line) ?? 1) * (pick(r.wordScales, i) ?? 1);
    if (kw && r.keywordScale) scale *= r.keywordScale;
    if (active && r.activeScale) scale *= r.activeScale / 100;
    const shadows: string[] = [];
    if (pick(r.lineGlow, line)) shadows.push(`0 0 ${em(24)} ${color}`, `0 0 ${em(56)} ${color}`);
    if (!r.pillBg && (r.shadow ?? 0) > 0) shadows.push(`${em(r.shadow!)} ${em(r.shadow!)} 0 rgba(0,0,0,0.61)`);
    return {
      fontFamily: burnFontStack(family),
      fontWeight: 400,
      fontStyle: r.italic || (kw && r.keywordItalic) ? "italic" : "normal",
      color,
      display: "inline-block",
      transform: scale !== 1 ? `scale(${scale})` : undefined,
      transformOrigin: "center bottom",
      margin: scale > 1 ? `0 ${((scale - 1) * 0.3).toFixed(2)}em` : undefined,
      textDecoration: active && r.activeUnderline ? "underline" : undefined,
      textDecorationThickness: active && r.activeUnderline ? em(Math.max(3, r.outline)) : undefined,
      WebkitTextStroke: !r.pillBg && r.outline > 0 ? `${em(r.outline * 2)} ${r.outlineColor ?? "#000"}` : undefined,
      paintOrder: "stroke fill",
      textShadow: shadows.length ? shadows.join(", ") : undefined,
      visibility: r.reveal === "cumulative" && i > activeWordIdx ? "hidden" : undefined,
      transition: "transform 120ms ease-out, color 80ms linear",
    };
  };
  return (
    <span
      style={{
        display: "inline",
        lineHeight: 1.2,
        mixBlendMode: r.blendInvert ? "difference" : undefined,
        ...(r.pillBg ? {
          background: r.pillBg,
          padding: `${em(pad * 0.4)} ${em(pad)}`,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        } : {}),
      }}>
      {page.map((w, i) => (
        <span key={i}>
          <span style={wordStyle(i)}>{text(w)}</span>
          {r.stackAfter && i === r.stackAfter - 1 && i < page.length - 1 ? <br /> : i < page.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}


/** Auto-looping demo used by the drawer's card list (not tied to any video —
 *  just sells the animation + word-highlight while browsing styles). */
function CaptionCardPreview({ preset }: { preset: import("@/lib/builder/captionPresets").CaptionPreset }) {
  const [pageIdx, setPageIdx] = useState(0);
  const [wordIdx, setWordIdx] = useState(0);
  useEffect(() => {
    const page = CAPTION_DEMO_PAGES[pageIdx];
    const t = window.setTimeout(() => {
      if (wordIdx < page.length - 1) setWordIdx((w) => w + 1);
      else { setPageIdx((p) => (p + 1) % CAPTION_DEMO_PAGES.length); setWordIdx(0); }
    }, 450);
    return () => window.clearTimeout(t);
  }, [pageIdx, wordIdx]);
  const entrance = preset.render.entrance ?? "fade";
  const variants = {
    pop: { initial: { opacity: 0, scale: 0.5 }, animate: { opacity: 1, scale: 1 }, transition: { type: "spring" as const, stiffness: 420, damping: 18 } },
    float: { initial: { opacity: 0, y: 10, scale: 0.94 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const } },
    fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25 } },
  }[entrance];
  return (
    <AnimatePresence mode="wait">
      <motion.span key={pageIdx} initial={variants.initial} animate={variants.animate} exit={{ opacity: 0 }} transition={variants.transition}
        className="block text-center text-[17px] leading-snug">
        <CaptionPageWords preset={preset} page={CAPTION_DEMO_PAGES[pageIdx]} activeWordIdx={wordIdx} />
      </motion.span>
    </AnimatePresence>
  );
}
// "Get Clips" pulls just this many seconds up front (fast card + canvas
// preview) instead of the whole source — see submitGetClips below.
const PREVIEW_SECONDS = 10;

/** The canvas preview only ever plays (and streams) the first PREVIEW_SECONDS
 *  of a clip — a full-length source (Drive "full" download, pipeline render, or
 *  an old saved project) would otherwise buffer/decode the whole file, twice
 *  with Glass BG on. Exported for tests. */
export function capPreviewWindow<T extends { duration: number; trimIn: number; trimOut: number }>(item: T): T {
  if (!(item.duration > 0) && !(item.trimOut > 0)) return item;
  const end = item.trimIn + PREVIEW_SECONDS;
  const trimOut = Math.min(item.trimOut > item.trimIn ? item.trimOut : end, end, item.duration > 0 ? item.duration : end);
  return trimOut === item.trimOut ? item : { ...item, trimOut };
}

/** Media-fragment src so the browser only range-requests the preview window
 *  instead of buffering the full file. */
export function previewSrc(url: string, trimIn = 0): string {
  // A 0-10s MP4 is already short. Appending #t=0,10 makes Safari/Chromium
  // initiate a needless seek, which can leave cloud-hosted previews at 0:00.
  if (url.includes("#") || trimIn <= 0) return url;
  return `${url}#t=${Math.max(0, trimIn)},${Math.max(0, trimIn) + PREVIEW_SECONDS}`;
}

/**
 * A clip cut server-side without `-movflags faststart` (our download/segment
 * pipeline) has no duration in its moov atom — Chrome/Safari report
 * `video.duration === Infinity` on loadedmetadata until something forces a
 * real seek. Left alone, the editor's duration/trim never populates: the
 * preview sticks at "0:00 / 0:00" and never advances, which reads as "the
 * video isn't changing" even though a different file did load. This is the
 * standard fix (also used by video.js/mediaelement): seek far past the end,
 * which clamps to the real end and fires `timeupdate` with a finite
 * `duration`, then seek back to where playback should actually start.
 */
export function resolveVideoDuration(video: HTMLVideoElement, seekBackTo: number, onKnown: (duration: number) => void) {
  if (Number.isFinite(video.duration) && video.duration > 0) { onKnown(video.duration); return; }
  const fix = () => {
    video.removeEventListener("timeupdate", fix);
    if (Number.isFinite(video.duration) && video.duration > 0) onKnown(video.duration);
    video.currentTime = seekBackTo;
  };
  video.addEventListener("timeupdate", fix, { once: true });
  try { video.currentTime = 1e101; } catch { video.removeEventListener("timeupdate", fix); }
}

/** Every pasted source opens as a small, browser-safe first-ten-second preview.
 *  The clipping pipeline fetches the full source only when a run actually needs
 *  it; a previously stored full Drive copy is reused by the server first. */
export function buildEditorVideoDownloadRequest(sourceUrl: string, mintAddress?: string) {
  return { sourceUrl, mode: "segment" as const, section: { start: 0, end: PREVIEW_SECONDS }, mintAddress, editorPreview: true };
}

function fmtDur(sec?: number): string {
  if (!sec || sec <= 0) return "-";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** UI timeout for a job with no heartbeat. The server cron keeps a longer
 * cleanup window; the editor fails sooner so users receive a recovery action. */
const DOWNLOAD_STALE_MS = 12 * 60_000;

/** YouTube video id from watch / youtu.be / shorts / embed URLs (client copy of
 *  lib/server/sourceKey.youtubeId, which pulls node:crypto). */
function ytVideoId(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    const id = host === "youtu.be" ? u.pathname.slice(1)
      : host.endsWith("youtube.com") ? (u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|embed|v|live)\/([^/?]+)/)?.[1] ?? "")
      : "";
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

/** Human label while async source metadata loads; never show a raw share URL as
 * the visible video title. */
export function sourceDisplayName(url: string, knownTitle?: string): string {
  if (knownTitle?.trim()) return knownTitle.trim();
  if (driveFileIdentity(url)) return "Google Drive video";
  if (ytVideoId(url)) return "YouTube video";
  try {
    const path = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    if (path && /\.(mp4|mov|m4v|webm|mkv)$/i.test(path)) return decodeURIComponent(path);
  } catch { /* A local title may not be a URL. */ }
  return "Source video";
}

/** Downloaded-video tile thumbnail: YouTube's own thumbnail when the source is a
 *  YouTube link (instant, no media fetch), else the file's first frame. Falls back
 *  to the first frame if the ytimg request fails. */
function DownloadThumb({ url, sourceUrl, accessToken }: { url: string; sourceUrl?: string; accessToken?: string | null }) {
  const ytId = ytVideoId(sourceUrl);
  const driveId = driveFileIdentity(sourceUrl ?? "");
  const [drivePoster, setDrivePoster] = useState<string | null>(null);
  const [ytFailed, setYtFailed] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  // A tile reopened later often never fires loadeddata/seeked (metadata-only
  // preload, throttled/aborted range fetch) and sat blank forever. Watchdog: if
  // no frame paints in 7s, remount the <video> with a fresh request (max 4
  // tries) — 7s (not 5) because with a dozen tiles mounting at once, metadata
  // fetches genuinely queue behind the browser's per-host connection cap.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!driveId || !sourceUrl || !accessToken) return;
    let active = true;
    let objectUrl: string | undefined;
    void fetch(`/api/video/thumbnail?url=${encodeURIComponent(sourceUrl)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setDrivePoster(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [driveId, sourceUrl, accessToken]);
  useEffect(() => {
    if (frameReady || videoFailed) return;
    const t = window.setTimeout(() => {
      if (attempt < 4) setAttempt((a) => a + 1); else setVideoFailed(true);
    }, 7000);
    return () => window.clearTimeout(t);
  }, [frameReady, videoFailed, attempt]);
  if (ytId && !ytFailed) {
    return <img src={`https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`} alt="" loading="lazy"
      onError={() => setYtFailed(true)} className="w-full h-full object-cover" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- authenticated Drive thumbnail is a short-lived Blob URL.
  if (drivePoster) return <img src={drivePoster} alt="Google Drive video thumbnail" className="h-full w-full object-cover" />;
  const ready = () => setFrameReady(true);
  return (
    <div className="relative h-full w-full bg-zinc-950">
      {!frameReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-900 to-black">
          {videoFailed ? <Film className="size-5 text-zinc-500" /> : <Loader2 className="size-4 animate-spin text-lime-400" />}
        </div>
      )}
      {/* Let the browser decode frame zero before asking for a later frame.
          A #t fragment on a cloud URL can leave the tile stalled at 0:00. */}
      <LazyVideo
        key={attempt}
        src={url}
        muted
        playsInline
        preload="metadata"
        aria-label={looksLikeGoogleDrive(sourceUrl ?? "") ? "Google Drive video thumbnail" : "Video thumbnail"}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (Number.isFinite(video.duration) && video.duration > 0.1) video.currentTime = 0.1;
        }}
        // A decoded first frame is already a valid thumbnail. If the optional
        // 0.1s seek succeeds, onSeeked refreshes it without blocking the tile.
        onLoadedData={ready}
        onSeeked={ready}
        onError={() => { if (attempt < 4) setAttempt((a) => a + 1); else setVideoFailed(true); }}
        className={`h-full w-full object-cover transition-opacity duration-300 ${frameReady ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

/** ⋯ dropdown on a Videos-tab tile → animated menu → Delete (with confirm). Removes
 *  the downloaded source from this agent's list. */
function VideoTileMenu({ sourceUrl, mintAddress }: { sourceUrl: string; mintAddress: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={wrapRef} className="absolute left-1 top-1 z-10" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Video options" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`grid size-6 place-items-center rounded-md bg-black/70 text-zinc-200 backdrop-blur-sm transition-opacity hover:text-lime-400 ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}>
        <MoreHorizontal className="size-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -4, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }} style={{ transformOrigin: "top left" }}
            className="absolute left-0 top-7 min-w-[140px] overflow-hidden rounded-lg border border-white/10 bg-zinc-900/95 p-1 shadow-2xl backdrop-blur-md">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setErr(null); setConfirm(true); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11.5px] text-rose-300 transition-colors hover:bg-rose-500/15">
              <Trash2 className="size-3.5" /> Delete video
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDeleteDialog open={confirm} title="Delete this video?"
        description="This removes the downloaded video from this agent's Videos list. You can always paste the link again to re-download it." busy={busy} error={err}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          const e = await postDelete("/api/downloads/delete", { sourceUrl, mintAddress });
          setBusy(false);
          if (e) setErr(e); else setConfirm(false);
        }} />
    </div>
  );
}

/** One in-flight (or just-settled) source-video download, backed by the
 *  reactive downloadJobs row — the SAME live-progress infra the Source node
 *  uses (lib/server/ytDownload.ts stashes {pct,downloadedBytes,totalBytes}
 *  JSON in the row's `error` slot while status is "downloading").
 *  Auto-removes itself (via onSettled) once done/error — the finished video
 *  then lives permanently in downloadCache and shows up in the list below. */
type SettledDownloadJob = { status: string; url?: string; sourceUrl?: string; error?: string; durationSeconds?: number; at?: number };

/** Estimated time remaining from a rolling window of (time, pct) samples — the
 *  same approach browsers use for their own download progress. A single
 *  start→now average is too jumpy on a bursty connection; this instead
 *  regresses over the last few seconds of samples for a steadier ETA, and
 *  requires real forward progress (not just a fresh sample) before it will
 *  commit to a number, so a stalled-but-still-"downloading" job correctly
 *  shows no ETA rather than a confidently wrong one. */
function useDownloadEta(jobId: string, pct: number, active: boolean): number | null {
  const samples = useRef<{ t: number; pct: number }[]>([]);
  const lastJobId = useRef(jobId);
  if (lastJobId.current !== jobId) { lastJobId.current = jobId; samples.current = []; }
  if (active && pct > 0) {
    const now = Date.now();
    const last = samples.current[samples.current.length - 1];
    if (!last || pct > last.pct) samples.current.push({ t: now, pct });
    // Keep ~15s of history — enough to smooth speed jitter without going stale.
    const cutoff = now - 15_000;
    while (samples.current.length > 2 && samples.current[0].t < cutoff) samples.current.shift();
  }
  const window = samples.current;
  if (!active || window.length < 2) return null;
  const first = window[0];
  const lastSample = window[window.length - 1];
  const dt = (lastSample.t - first.t) / 1000;
  const dPct = lastSample.pct - first.pct;
  if (dt < 1.5 || dPct <= 0.5) return null; // not enough signal yet
  const ratePerSec = dPct / dt;
  const remaining = Math.max(0, 100 - lastSample.pct);
  return Math.round(remaining / ratePerSec);
}

export function fmtEta(seconds: number): string {
  if (seconds < 5) return "finishing…";
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m < 60 ? `${m}m ${s.toString().padStart(2, "0")}s left` : `${Math.floor(m / 60)}h ${(m % 60)}m left`;
}

function DownloadJobCard({ jobId, onSettled }: { jobId: string; onSettled: (jobId: string, job?: SettledDownloadJob) => void }) {
  const job = useQuery(api.downloadJobs.get, { id: jobId as unknown as Id<"downloadJobs"> }) as
    SettledDownloadJob | null | undefined;
  // The job id is persisted in the editor draft, so a pull orphaned by a server
  // restart would spin here forever — treat a heartbeat-less row as dead (same
  // window as the downloadJobs.reapStaleDownloads cron).
  const stalled = job?.status === "downloading" && typeof job.at === "number" && Date.now() - job.at > DOWNLOAD_STALE_MS;
  const gone = job === null;

  useEffect(() => {
    if (gone) { onSettled(jobId, { status: "error", error: "The download job disappeared after a server restart. Please paste the link again." }); return; }
    if (stalled) { onSettled(jobId, { status: "error", sourceUrl: job?.sourceUrl, error: "The download stopped reporting progress for 12 minutes. Please retry, or upload the file directly." }); return; }
    if (!job) return;
    if (job.status === "done" || job.status === "error") {
      const t = window.setTimeout(() => onSettled(jobId, job), job.status === "done" ? 900 : 4500);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only status flips matter; `job` itself churns every poll tick
  }, [gone, job?.status, stalled, jobId, onSettled]);

  let pct = 0;
  let speed: string | undefined;
  let stage: string | undefined;
  let downloadedBytes = 0;
  let totalBytes = 0;
  if (job?.status === "downloading" && job.error) {
    try {
      const p = JSON.parse(job.error) as { pct?: number; speed?: string; stage?: string; downloadedBytes?: number; totalBytes?: number };
      pct = p.pct ?? 0;
      speed = p.speed;
      stage = p.stage;
      downloadedBytes = p.downloadedBytes ?? 0;
      totalBytes = p.totalBytes ?? 0;
    } catch { /* not progress JSON yet */ }
  }
  const isDownloading = job?.status === "downloading";
  // Hooks must run unconditionally on every render — this one used to sit
  // after the `if (!job) return null` below, so it was skipped entirely while
  // the query was still loading and only started firing once `job` resolved.
  // React detects that hook-count mismatch between renders and throws
  // ("Rendered more hooks than during the previous render"), which crashed
  // this component the instant a download's first job row loaded — the whole
  // Videos panel would then render blank, reading as "nothing happens" after
  // clicking Download.
  const etaSeconds = useDownloadEta(jobId, pct, isDownloading === true);

  if (!job || stalled) return null;
  const isError = job.status === "error";
  const isDone = job.status === "done";
  const isDrive = looksLikeGoogleDrive(job.sourceUrl ?? "");
  const failure = isError ? explainClipFailure(job.error) : null;
  const fmtBytes = (bytes: number) => bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  const byteLabel = downloadedBytes > 0
    ? `${fmtBytes(downloadedBytes)}${totalBytes > 0 ? ` of ${fmtBytes(totalBytes)}` : ""}`
    : undefined;

  return (
    <motion.div layout initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-xl border p-3 ${isError ? "border-red-500/40 bg-red-500/[0.07]" : isDone ? "border-lime-400/30 bg-lime-400/[0.06]" : "border-white/12 bg-gradient-to-br from-white/[0.08] to-white/[0.03]"}`}>
      {!isError && !isDone && <motion.div aria-hidden className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" animate={{ x: ["-150%", "500%"] }} transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }} />}
      <div className="flex items-center gap-2 mb-1.5">
        {isError ? <AlertCircle className="size-3.5 text-red-400 shrink-0" />
          : isDone ? <CheckCircle2 className="size-3.5 text-lime-400 shrink-0" />
          : <Loader2 className="size-3.5 text-lime-400 shrink-0 animate-spin" />}
        <p className="text-[11px] text-zinc-300 truncate flex-1">
          {isError ? failure?.message
            : isDone ? "Video ready" : (stage || (isDrive ? "Connecting securely to Google Drive" : "Preparing the download"))}
        </p>
        {/* Big, unambiguous percent readout — the one number a stalled-looking
            transfer needs to prove it's actually still moving. */}
        {isDownloading && <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-lime-300">{Math.round(pct)}%</span>}
      </div>
      {!isError && (
        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-lime-500 via-lime-300 to-emerald-300 shadow-[0_0_12px_rgba(163,230,53,0.45)]"
            initial={{ width: 0 }} animate={{ width: `${isDone ? 100 : pct > 0 ? Math.max(3, pct) : 3}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }} />
        </div>
      )}
      {/* Byte count on the left, speed + ETA on the right — same layout every
          browser's own download tray uses, so it reads as familiar rather than
          bespoke. Falls back to an honest "estimating…" instead of guessing
          before there's enough signal, and to the old generic hint once a
          transfer genuinely has no bytes/speed to report yet (e.g. still
          resolving the source). */}
      {isDownloading && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[9.5px] text-zinc-500">
          <span className="truncate">{byteLabel ?? (isDrive ? "Checking private access and file size…" : "Resolving video source…")}</span>
          <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
            {speed && <span>{speed}</span>}
            <span className={etaSeconds != null ? "text-zinc-400" : "text-zinc-600"}>
              {etaSeconds != null ? fmtEta(etaSeconds) : byteLabel ? "estimating…" : "this can take a few minutes"}
            </span>
          </span>
        </div>
      )}
      {failure?.hint && <p className="mt-2 text-[10px] leading-relaxed text-red-200/80">{failure.hint}</p>}
    </motion.div>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────
type Asset = { id: string; url: string; name: string; kind: "video" | "image" };
type TimelineItem = {
  id: string;
  url: string;
  title: string;
  /** Source agentTasks row this clip came from (a real Videos-tab generation) —
   *  when set, Apply patches that task's output.videoUrl with the burned
   *  result so the Marketplace/profile page actually serves what got burned. */
  taskId?: string;
  /** Social-post caption (Post Captions tool) — separate from the burned-in
   *  video captions; this is what the Apply modal's Post flow sends as the
   *  post text. Persists on the clip so reopening it doesn't lose the work. */
  postCaption?: string;
  duration: number;   // full source duration once known (seconds)
  trimIn: number;
  trimOut: number;
  /** TRENDING_AUDIO id (lib/server/trendingAudioPack) — background music for this clip. */
  musicTrackId?: string;
  /** "Auto-select best song" checkbox — mutually exclusive with musicTrackId
   *  (picking a track turns this off, same as the Clipping canvas's Trending
   *  Audio node). No track id reaches the burn; the server's existing
   *  mood-matched fallback (pickTrendingTrackByMood) picks one. */
  autoMusic?: boolean;
  /** Operator's OWN uploaded track (R2 url via /api/media/upload) — wins over
   *  musicTrackId/autoMusic at burn time (overlay-burn `music.customUrl`).
   *  Mutually exclusive with the two above, same as picking a pack track. */
  musicCustomUrl?: string;
  musicCustomLabel?: string;
  /** Music loudness, 0-100 (quadratic-taper %, matches the Clipping canvas's
   *  Trending Audio slider). Default 20 (a quiet bed) when unset. */
  musicVolumePct?: number;
  /** Sound Effect pack id (lib/server/reactionSfxPack REACTION_SFX_PACKS) — the AI
   *  auto-picks WHICH sting fires (and whether one fires at all) from a keyword in
   *  this clip's own transcript; this only chooses which pack supplies the sound. */
  sfxPackId?: string;
  /** Specials · Zoom Punch — punches in on keyword/emphasis beats found in
   *  this clip's own transcript (server-side pickZoomPunchTimes), the SAME
   *  keyword signal captions' Keyword Pop + the Sound Effect tool already
   *  use. Independent of Camera Settings' framingMode="zoom" (a single
   *  midpoint punch) — this can fire several times, wherever a keyword lands. */
  zoomPunchOn?: boolean;
  /** Specials · Filler Cut (random mode) — a few random TIME-based micro-cuts,
   *  NOT filler-word or script driven. A fresh pattern every burn (server
   *  reseeds on each Apply), so re-applying the same clip yields a genuinely
   *  different edit — the point being MORE variation, not a fixed trim. */
  jumpCutsOn?: boolean;
  /** Specials · Multi Clips — hard-cuts between 2-4 randomly framed crop
   *  windows across the clip instead of one fixed framing (or the tracked
   *  speaker), so the same footage reads as several distinct scenes. Applied
   *  on the NEXT clipping run (canvas skill node), not a re-burn of THIS
   *  already-cut clip — see clipRender.ts's "Multi Clips" pre-pass. */
  multiSceneOn?: boolean;
  /** Editor Filters tool. The named grade and adjustments are previewed with
   *  CSS and burned with the corresponding FFmpeg color_filter chain. */
  filterPreset?: (typeof FILTER_PRESET_IDS)[number];
  filterSaturation?: number;
  filterBrightness?: number;
  /** Specials · Reference Image — a real photo (news screenshot, product
   *  shot, whatever the operator captured/uploaded) burned as a small
   *  bordered card inset for the clip's full length, server-side (same
   *  overlay-burn `imageOverlay` param a news-sourced idea's own research
   *  photo uses automatically). Purely visual — never touches identity. */
  referenceImageUrl?: string;
  /** Camera Settings — same modes as the real Smart Framing skill (clip.facetrack):
   *  "auto" fit-both-or-follow-speaker, "pan" keyframe pan across guests, "zoom"
   *  punch in on the speaker, "dual" two simultaneous top/bottom face crops,
   *  "full" always letterbox (safe, nothing cropped). */
  framingMode?: "auto" | "pan" | "zoom" | "dual" | "full";
  /** REAL detected face center (0..1 of frame), from /api/video/detect-face — the
   *  same Gemini-vision algorithm the actual clip pipeline uses. Set once face
   *  detection finishes for Auto/Zoom/Pan; frames the crop on it instead of a
   *  generic mid-frame or fixed-direction guess. */
  faceCx?: number;
  faceCy?: number;
  /** Multi-person bounds (2+ separated faces — a podcast/interview), set only
   *  when detectFaceCenter found more than one speaker. Drives "Pan both". */
  faceXMin?: number;
  faceXMax?: number;
  /** Face-tracked SHOT timeline from the dense /api/video/detect-face-track
   *  scan (CenterFace @10fps) segmented by lib/builder/faceShots — the exact
   *  /dev/face-detect algorithm. Drives the canvas preview AND is sent verbatim
   *  to the burn (framing.shots) so the export crops what the preview showed.
   *  Empty array = scanned, nothing confident found. */
  faceShots?: FaceShot[];
  /** Two-face timelines for Dual mode. The left detected face occupies the top
   *  pane and the right face the bottom pane while both remain visible. */
  dualFaceShots?: DualShotPlan;
  /** How many faces the scan saw at most in one frame (status line). */
  faceMaxCount?: number;
  /** Duration-weighted subject motion from the scan (faceShots.buildShotPlan).
   *  Auto/Pan derive their zoom from it: busy footage frames wider so the crop
   *  isn't chasing the subject. Zoom mode keeps its own slider. */
  faceMotionScore?: number;
  /** The raw dense scan (CenterFace @10fps) the shots were built from. Kept so
   *  switching camera mode / aspect re-plans the camera locally (buildCameraPlan)
   *  without another scan. */
  faceSamples?: SamplePoint[];
  /** Zoom the camera plan settled on for Auto (lowered so two heads both fit);
   *  the burn uses the same value so export = preview. */
  faceZoomHint?: number;
  /** Face Crop zoom — how tight the crop on the face is. 1 = no zoom, 2 = 2x. */
  zoomAmount?: number;
  /** Intro & CTA — uploaded clips to burn onto the front/end of this clip via
   *  the SAME ffmpeg backend the App Store's Hook Videos / Video CTA skills use
   *  (lib/server/ctaAppend.ts + /api/video/concat), reused here for the Editor. */
  introUrl?: string;
  ctaUrl?: string;
  /** The clip's URL before intro/CTA burn-in — kept so re-burning (after
   *  swapping the intro/CTA upload) always re-stitches from the ORIGINAL clip
   *  instead of chaining onto an already-stitched result. */
  sourceUrl?: string;
  /** True only after this editor successfully burns a text hook into `url`'s
   *  pixels via Apply. A taskId alone is not evidence of a burn. Gates the
   *  live canvas hook overlay (see
   *  `selectedOverlays` render below): without this, the same hook the video
   *  already shows got drawn AGAIN on top in the preview, so it looked
   *  duplicated/overlapping. Cleared only by `hookEditOverrideIds` (the
   *  operator explicitly asking to change the hook text). */
  hookBurned?: boolean;
};
/** Where the preview draws a hook / caption overlay, as a % of canvas height
 *  from the top — the text block's CENTER (preview uses translateY(-50%)).
 *  An undragged overlay sits on its position band (these fractions MUST match the
 *  preview's defaults below). Always sent to the burn so the burned text lands on
 *  the same spot instead of the server's own band (hook top = 30% down, not 12%). */
const OVERLAY_BAND_OY = { top: 0.12, center: 0.5, bottom: 0.86 } as const;
function overlayYPct(o: { oy?: number; position: "top" | "center" | "bottom" }): number {
  return Math.round((typeof o.oy === "number" ? o.oy : OVERLAY_BAND_OY[o.position]) * 1000) / 10;
}

type Overlay = {
  id: string;
  itemId: string;      // anchors this overlay to a timeline item, travels with it on reorder
  text: string;
  startSec: number;    // item-relative
  endSec: number;      // item-relative
  position: "top" | "center" | "bottom";
  /** CAPTION_PRESETS id (lib/builder/captionPresets) — set only for caption-style
   *  overlays created via the caption-style drawer; absent = plain text overlay. */
  presetId?: string;
  /** HOOK_DESIGNS id (lib/builder/hookDesigns) — set only for a Text Hooks overlay. */
  hookDesignId?: string;
  /** Uploaded image URL — set only for an image Overlay (logo/graphic on the canvas). */
  imageUrl?: string;
  /** Uploaded video URL — set only for a video Overlay (picture-in-picture clip). */
  videoUrl?: string;
  /** Media overlay center, fraction of canvas [0..1] — draggable. Defaults to a
   *  position derived from `position` the first time it's dragged/resized.
   *  For a hook-text overlay (hookDesignId set), only `oy` is used — vertical
   *  drag-to-position in the preview; horizontal stays centered/full-width. */
  ox?: number;
  oy?: number;
  /** Media overlay size multiplier (drag-resize handle), floor-only clamp (min 0.1, no cap). */
  scale?: number;
  /** Hook-text font size multiplier around the design's base size (1 = design
   *  default) — the Text Hooks drawer's live font-size slider. */
  hookFontScale?: number;
  /** Caption transcription language — an ISO 639 code (see CAPTION_LANGUAGES)
   *  pinned to ElevenLabs Scribe's decoder for this clip's own voice, or ""/
   *  unset for auto-detect. Set only on a caption-preset overlay. This does
   *  NOT translate — it picks which language the real spoken audio gets
   *  transcribed AS (fixes the classic near-neighbor mix-up, e.g. Malay
   *  decoded as Indonesian, the same way Text Hooks' language picker exists
   *  for the hook line, but for the actual burned captions). */
  captionLanguageCode?: string;
  /** Subtitle (burned caption) language — ISO 639 code, or ""/unset for "same
   *  as spoken". When it differs from the spoken language the burn route
   *  translates the transcript phrase-by-phrase (lib/server/captionTranslate)
   *  so e.g. English speech burns Malay captions, still word-synced. */
  captionSubtitleLanguageCode?: string;
};
type AspectRatio = "9:16" | "16:9" | "1:1";

type EditorToolbarDraft = {
  velloWatermark?: boolean;
  hookDuration?: number;
  /** Text hook "Always on": the hook stays until the end of the clip. */
  hookAlwaysOn?: boolean;
  hookPosition?: Overlay["position"];
  hookPrompt?: string;
  hookLanguage?: string;
  postCaptionPrompt?: string;
  postCaptionMood?: string;
  postCaptionLanguage?: string;
};
export type EditorDraft = { timeline?: TimelineItem[]; overlays?: Overlay[]; uploads?: Asset[]; aspectRatio?: AspectRatio; downloadJobIds?: string[]; glassBgOn?: boolean; toolbar?: EditorToolbarDraft };
function loadEditorDraft(storageKey: string): EditorDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? repairEditorDraft(JSON.parse(raw) as EditorDraft) : {};
  } catch {
    return {}; // corrupt draft, start fresh
  }
}

/** Overlay "kind" for dedupe: a clip carries at most ONE hook and ONE caption
 *  overlay (media overlays stack freely). */
const overlayKind = (o: Overlay): "hook" | "caption" | null => (o.hookDesignId ? "hook" : o.presetId ? "caption" : null);

/** Heal a persisted draft. Older builds re-seeded the agent's saved hook +
 *  caption overlays on EVERY reload (the "seeded" guard was an in-memory ref,
 *  empty after a refresh) and re-added the auto-opened clip on every visit —
 *  so a long-lived agent's draft accumulated stacked hook texts and duplicate
 *  clips, and the whole tab got slower with each open. Collapse both here
 *  (keep the LAST hook/caption per clip — the most recently edited one) and
 *  drop overlays whose clip is gone. */
export function repairEditorDraft(d: EditorDraft): EditorDraft {
  const timeline = Array.isArray(d.timeline) ? d.timeline : [];
  // Duplicate clips (same url + taskId) → keep the first, remap overlays onto it.
  const keyOf = (t: TimelineItem) => `${t.taskId ?? ""}|${t.url}`;
  const canonical = new Map<string, string>();
  const remap = new Map<string, string>();
  const dedupedTimeline: TimelineItem[] = [];
  for (const t of timeline) {
    const k = keyOf(t);
    const keep = canonical.get(k);
    if (keep) { remap.set(t.id, keep); continue; }
    canonical.set(k, t.id);
    dedupedTimeline.push(t);
  }
  const alive = new Set(dedupedTimeline.map((t) => t.id));
  const overlays = (Array.isArray(d.overlays) ? d.overlays : []).map((o) => (remap.has(o.itemId) ? { ...o, itemId: remap.get(o.itemId)! } : o)).filter((o) => alive.has(o.itemId));
  const lastOfKind = new Map<string, string>(); // `${itemId}:${kind}` → overlay id to keep
  for (const o of overlays) { const k = overlayKind(o); if (k) lastOfKind.set(`${o.itemId}:${k}`, o.id); }
  const dedupedOverlays = overlays.filter((o) => { const k = overlayKind(o); return !k || lastOfKind.get(`${o.itemId}:${k}`) === o.id; });
  return { ...d, timeline: dedupedTimeline, overlays: dedupedOverlays };
}

const uid = () => Math.random().toString(36).slice(2, 10);
export function buildInitialTimelineItem(url: string, title: string, taskId?: string, sourceUrl?: string, id = uid()): TimelineItem {
  return { id, url, title, taskId, ...(sourceUrl ? { sourceUrl } : {}), duration: 0, trimIn: 0, trimOut: 0, hookBurned: false };
}
/** Clone an overlay onto another timeline item — used by both applyToAllClips
 *  (the local-state copy) and applyAllClips (the burn loop's own copy, needed
 *  because it can't wait for the former's setState to commit). */
const cloneOverlayForItem = (src: Overlay, item: TimelineItem): Overlay => ({
  ...src, id: uid(), itemId: item.id, endSec: Math.min(src.endSec, Math.max(0.1, item.trimOut - item.trimIn)),
});
const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

// Right-rail actions not yet wired to a real pipeline in v1 — shown for visual
// parity with the reference design, but honestly labeled instead of dead.
const COMING_SOON = new Set<string>();

// ── Style presets — a one-click bundle of a caption look (real CAPTION_PRESETS
//    entry) + a camera framing mode (real Camera Settings mode). Applying one
//    swaps the clip's caption AND framing in one tap instead of two drawers.
// PRESETS — one-tap bundles of a real caption preset + a real camera framing
// mode (was labeled "Styles"; renamed to match how the rest of the product
// talks about these: a preset is a named look, like the App Store's Podcast
// Clean / Gen Z / Ali Abdaal Intro presets on /admin/samples). `accent` is a
// diagonal gradient tint for the card, same visual language as that page.
const STYLE_PRESETS: { id: string; name: string; blurb: string; captionPresetId: string; cameraMode: NonNullable<TimelineItem["framingMode"]>; accent: string }[] = [
  { id: "podcast", name: "Podcast", blurb: "Split-screen two-speaker energy, hot pink caps, safe full-frame fit.", captionPresetId: "podp", cameraMode: "full", accent: "from-sky-500/20 to-sky-500/0" },
  { id: "genz", name: "Gen Z Style", blurb: "Word-pop karaoke caption, punchy zoom on the speaker.", captionPresetId: "karaoke", cameraMode: "zoom", accent: "from-amber-400/20 to-amber-400/0" },
  { id: "aesthetic-anime", name: "Aesthetic Text + Anime", blurb: "Soft glowing gold serif, slow cinematic pan.", captionPresetId: "gold", cameraMode: "pan", accent: "from-fuchsia-500/20 to-fuchsia-500/0" },
  { id: "brainrot", name: "Brainrot videos", blurb: "Chunky italic MrBeast-style caps, hard zoom punch.", captionPresetId: "beasty", cameraMode: "zoom", accent: "from-rose-500/20 to-rose-500/0" },
  { id: "ali-abdaal", name: "Ali Abdaal gradient", blurb: "Clean minimal white caps, calm auto-follow framing.", captionPresetId: "mono", cameraMode: "auto", accent: "from-violet-500/20 to-violet-500/0" },
];

const FILTER_DESCRIPTIONS: Record<string, string> = {
  "": "Original color, no enhancement",
  vintage: "Faded film curve, grain and vignette",
  warm: "Warm skin tones with gentle clarity",
  cool: "Clean blue balance with crisp detail",
  bw: "High-contrast monochrome film",
  vivid: "Vibrance, contrast and sharp detail",
  cinematic: "Teal shadows, warm highlights and grain",
  hd: "Clean contrast plus high-quality sharpening",
  superhd: "Denoise, two-pass detail recovery and vibrance",
  moody: "Deep shadows and restrained color",
  filmic: "Medium contrast with subtle grain",
  matte: "Lifted blacks and soft color",
};

type ConnectedPlatform = { id: string; displayName?: string };

/**
 * Apply's real-time result modal: opens the instant "Apply" is clicked, shows
 * a burning spinner while /api/video/overlay-burn is in flight, then the final
 * composited video (hooks/captions/music already baked in) with an editable,
 * dynamically-prefilled caption and one-click Post to whichever platforms this
 * agent has actually connected (GET /api/social/status) — same POST /api/social/post
 * shape used elsewhere in the builder (inspector-panel.tsx's Post Now).
 */
function ApplyPostModal({
  open, phase, videoUrl, error, warning, mintAddress, initialCaption, onClose,
}: {
  open: boolean;
  phase: "burning" | "ready" | "error";
  videoUrl?: string;
  error?: string;
  /** Non-fatal: the burn succeeded but something requested (usually a music
   *  track) couldn't be resolved — e.g. TRENDING_AUDIO_BASE_URL unset on the
   *  server, or the track URL 404'd. Shown as an amber banner, not an error. */
  warning?: string;
  mintAddress?: string;
  initialCaption: string;
  onClose: () => void;
}) {
  const [caption, setCaption] = useState(initialCaption);
  useEffect(() => { if (open) setCaption(initialCaption); }, [open, initialCaption]);

  const [connected, setConnected] = useState<Record<string, { displayName?: string } | null> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || phase !== "ready" || !mintAddress) return;
    let alive = true;
    setPostMsg(null);
    fetch(`/api/social/status?username=${encodeURIComponent(mintAddress)}`)
      .then((r) => r.json())
      .then((j: { connected?: Record<string, { displayName?: string } | null> }) => {
        if (!alive) return;
        const conn = j.connected ?? {};
        setConnected(conn);
        setSelected(new Set(Object.entries(conn).filter(([, v]) => v).map(([id]) => id)));
      })
      .catch(() => { if (alive) setConnected({}); });
    return () => { alive = false; };
  }, [open, phase, mintAddress]);

  const platforms: ConnectedPlatform[] = Object.entries(connected ?? {})
    .filter((entry): entry is [string, { displayName?: string }] => !!entry[1])
    .map(([id, v]) => ({ id, displayName: v.displayName }));

  const togglePlatform = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const post = async () => {
    if (!videoUrl || !mintAddress || selected.size === 0) return;
    setPosting(true);
    setPostMsg(null);
    try {
      const res = await fetch("/api/social/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: mintAddress, platforms: Array.from(selected), type: "video",
          title: caption, mediaUrls: [videoUrl],
          // The operator wrote/approved this caption in the editor — the post
          // route must publish it verbatim, not regenerate from the persona.
          captionLocked: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "Post failed");
      setPostMsg(`Posted to ${Array.from(selected).join(", ")}.`);
    } catch (e) {
      setPostMsg(e instanceof Error ? e.message : "Post failed");
    } finally {
      setPosting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={phase === "burning" ? undefined : onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="relative w-full max-w-[440px] rounded-2xl border border-white/10 bg-[#141310] p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
            onClick={(e) => e.stopPropagation()}
          >
            {phase !== "burning" && (
              <button type="button" onClick={onClose} aria-label="Close"
                className="absolute right-3 top-3 grid size-7 place-items-center rounded-lg border border-white/15 bg-white/[0.06] text-zinc-400 hover:bg-white/[0.12] hover:text-white">
                <X className="size-3.5" />
              </button>
            )}

            {phase === "burning" && (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <Loader2 className="size-6 animate-spin text-lime-400" />
                <p className="text-[13px] text-zinc-300">Burning your video…</p>
                <p className="text-[11px] text-zinc-500">Hooks, captions, and music are being composited in.</p>
              </div>
            )}

            {phase === "error" && (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
                <AlertCircle className="size-6 text-rose-400" />
                <p className="text-[13px] text-rose-300">{error ?? "Apply failed"}</p>
              </div>
            )}

            {phase === "ready" && videoUrl && (
              <div className="space-y-3 pt-1">
                <video src={videoUrl} controls autoPlay playsInline
                  className="max-h-[46vh] w-full rounded-lg bg-black object-contain ring-1 ring-white/10" />
                {warning && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-[11px] text-amber-300">
                    <AlertCircle className="mt-px size-3.5 shrink-0" />
                    <span>{warning}</span>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-zinc-400">Caption</label>
                  <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
                    placeholder="Dynamically generated from this video, edit as you like…"
                    className="w-full resize-none rounded-md border border-white/15 bg-white/5 px-2.5 py-2 text-[13px] text-zinc-200 placeholder:text-zinc-600" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-zinc-400">Post to</label>
                  {connected === null ? (
                    <p className="text-[11px] text-zinc-500">Loading connected accounts…</p>
                  ) : platforms.length === 0 ? (
                    <p className="text-[11px] text-zinc-500">No social accounts connected yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {platforms.map((p) => (
                        <button key={p.id} type="button" onClick={() => togglePlatform(p.id)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors ${
                            selected.has(p.id) ? "border-lime-400 bg-lime-400/15 text-lime-300" : "border-white/15 text-zinc-400 hover:text-zinc-200"
                          }`}>
                          {p.displayName || p.id}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {postMsg && (
                  <p className={`text-[11.5px] ${postMsg.startsWith("Posted") ? "text-lime-400" : "text-rose-400"}`}>{postMsg}</p>
                )}
                <button type="button" onClick={post} disabled={posting || selected.size === 0}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-bold uppercase tracking-wide transition-opacity disabled:opacity-40"
                  style={{ background: "#65c000", color: "#0b0906" }}>
                  {posting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {posting ? "Posting…" : "Post now"}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * "Clip" button progress modal — opens the instant a real Clipping run is
 * queued, shows a live spinner + progress bar as each clip settles (ready/
 * failed), and a "View in Generations" hand-off once every clip in this run
 * has settled. Stays open until the operator closes it (or navigates) so a
 * long multi-clip run never leaves them wondering whether anything happened.
 */
/* ─────────────────────────────────────────────────────────
 * ANIMATION STORYBOARD — Clip run monitor
 *
 *    0ms   backdrop dims and monitor panel springs in
 *   80ms   run summary becomes visible
 *  120ms   clip rows enter as the server discovers moments
 * updates  progress fill and row state cross-fade from live Convex data
 * ───────────────────────────────────────────────────────── */
const CLIP_RUN_MOTION = {
  backdrop: { enter: 0.2, exit: 0.15 },
  panel: { type: "spring" as const, stiffness: 320, damping: 30 },
  row: { type: "spring" as const, stiffness: 360, damping: 32 },
};

function formatRunTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

function stageLabel(job: ClipRunJob | null): string {
  if (!job) return "Creating your clipping job…";
  const labels: Record<string, string> = {
    queued: "Queued — reserving the clipping worker…",
    downloading: "Downloading the source video…",
    transcribing: "Transcribing the source…",
    analyzing: "Finding high-retention moments…",
    clipping: "Rendering each selected clip…",
    posting: "Preparing finished clips…",
    completed: "All available clips are ready.",
    error: "This run needs attention.",
  };
  return labels[job.status] ?? "Preparing your clip run…";
}

function ClipRunModal({
  open, progress, job, onViewResults, onClose, totalCredits,
}: {
  open: boolean;
  progress: ReturnType<typeof buildClipRunProgress>;
  job: ClipRunJob | null;
  onViewResults?: () => void;
  onClose: () => void;
  /** Whole-run cost in credits (source-length priced, OpusClip-style — see
   *  lib/economy/clipCreditPricing.ts). undefined while the source's duration
   *  isn't known yet. Split evenly across `progress.total` for display —
   *  recomputes live as clips are discovered/dropped, same as every other
   *  number in this modal. */
  totalCredits?: number;
}) {
  const reduceMotion = useReducedMotion();
  const hasError = job?.status === "error";
  const complete = progress.isComplete && !hasError;
  const hasLiveJob = !!job;

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-5">
          <motion.button
            type="button"
            aria-label="Close clip progress"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : CLIP_RUN_MOTION.backdrop.enter }}
            className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clip-run-title"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={reduceMotion ? { duration: 0 } : CLIP_RUN_MOTION.panel}
            className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141310] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
          >
            <button type="button" onClick={onClose} aria-label="Close"
              className="absolute right-3 top-3 z-10 grid size-10 place-items-center rounded-lg border border-white/15 bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141310]">
              <X className="size-3.5" />
            </button>

            <div className="border-b border-white/10 px-5 pb-4 pt-5 sm:px-6">
              <div className="flex items-start gap-3 pr-10">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${hasError ? "bg-rose-500/15 text-rose-300" : complete ? "bg-lime-400/15 text-lime-300" : "bg-lime-400/15 text-lime-300"}`}>
                  {hasError ? <AlertCircle className="size-5" /> : complete ? <Check className="size-5" /> : <Scissors className="size-5" />}
                </span>
                <div className="min-w-0">
                  <p id="clip-run-title" className="text-[15px] font-semibold text-zinc-100">
                    {hasError ? "Clip run stopped" : complete ? "Clips are ready" : "Clipping in progress"}
                  </p>
                  <p className="mt-0.5 text-[12px] text-zinc-400">{job?.progressNote || stageLabel(job)}</p>
                </div>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.08]" aria-label={`${progress.progressPct}% complete`}>
                <motion.div
                  className={`h-full origin-left rounded-full ${hasError ? "bg-rose-400" : "bg-lime-400"}`}
                  initial={false}
                  animate={{ scaleX: progress.progressPct / 100 }}
                  transition={reduceMotion ? { duration: 0 } : CLIP_RUN_MOTION.row}
                />
              </div>
              <div className={`mt-2.5 grid gap-2 text-[10.5px] tabular-nums text-zinc-500 ${totalCredits != null ? "grid-cols-4" : "grid-cols-3"}`}>
                <span><b className="font-semibold text-zinc-200">{progress.ready}/{progress.total}</b> ready</span>
                <span className="text-center"><b className="font-semibold text-zinc-200">{formatRunTime(progress.elapsedSeconds)}</b> elapsed</span>
                <span className={totalCredits != null ? "text-center" : "text-right"}><b className="font-semibold text-zinc-200">{complete || hasError ? "—" : `~${formatRunTime(progress.etaSeconds)}`}</b> left</span>
                {totalCredits != null && (
                  <span className="text-right" title="Priced by source length, not clip count — see how it's split below">
                    <b className="font-semibold text-lime-300">~{totalCredits}</b> credits
                  </span>
                )}
              </div>
            </div>

            {hasError ? (
              <div className="mx-5 mt-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] p-3 sm:mx-6">
                <p className="text-[12px] font-medium text-rose-200">{job?.error || "The clip worker stopped before it could finish."}</p>
                <p className="mt-1 text-[11px] text-rose-200/70">Correct the source or wait for the worker to recover, then run the clip again.</p>
              </div>
            ) : progress.isStale ? (
              <div className="mx-5 mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-3 text-[11px] text-amber-100 sm:mx-6">
                We haven&apos;t received an update for two minutes. The server watchdog will mark a genuinely stalled run with an actionable error instead of leaving it silent.
              </div>
            ) : !hasLiveJob ? (
              <div className="mx-5 mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-[11px] text-zinc-400 sm:mx-6">
                <Loader2 className="size-3.5 animate-spin text-lime-300" /> Creating the job and connecting its live progress…
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Individual clips</p>
                <p className="text-[10px] text-zinc-600">Live from the render queue</p>
              </div>
              <div className="space-y-1.5">
                {progress.items.map((item, index) => {
                  const failed = item.state === "failed";
                  const ready = item.state === "ready";
                  const rendering = item.state === "rendering";
                  return (
                    <motion.div
                      key={item.id}
                      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={reduceMotion ? { duration: 0 } : { ...CLIP_RUN_MOTION.row, delay: Math.min(index, 8) * 0.025 }}
                      className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 ${failed ? "border-rose-500/25 bg-rose-500/[0.06]" : ready ? "border-lime-400/20 bg-lime-400/[0.05]" : "border-white/[0.08] bg-white/[0.025]"}`}
                    >
                      <span className={`grid size-5 shrink-0 place-items-center rounded-full ${failed ? "bg-rose-400/15 text-rose-300" : ready ? "bg-lime-400 text-lime-950" : "bg-lime-400/15 text-lime-300"}`}>
                        {failed ? <AlertCircle className="size-3" /> : ready ? <Check className="size-3" /> : rendering ? <Loader2 className="size-3 motion-safe:animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] font-medium text-zinc-200">{item.label}</p>
                        <p className={`truncate text-[10px] ${failed ? "text-rose-200/75" : "text-zinc-500"}`}>{item.detail || (ready ? "Ready to review" : rendering ? "Rendering now" : "Waiting for moment selection")}</p>
                      </div>
                      {/* Even share of the whole run's cost — recomputed on every
                          render off progress.total, so it drops live if a slot
                          later fails and the split narrows across fewer clips. */}
                      {!failed && totalCredits != null && (
                        <span className="shrink-0 text-[9.5px] font-medium tabular-nums text-zinc-500" title="This clip's even share of the run's total cost">
                          ~{perClipCredits(totalCredits, progress.total)}cr
                        </span>
                      )}
                      <span className={`shrink-0 text-[9.5px] font-semibold uppercase tracking-wide ${failed ? "text-rose-300" : ready ? "text-lime-300" : "text-zinc-500"}`}>{item.state}</span>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 border-t border-white/10 px-5 py-4 sm:px-6">
              {complete && onViewResults ? (
                <button type="button" onClick={() => { onViewResults(); onClose(); }}
                  className="min-h-10 flex-1 rounded-lg bg-lime-400 px-3 py-2 text-[12px] font-bold text-[#0b0906] transition-colors hover:bg-lime-300 focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141310]">
                  View in Generations
                </button>
              ) : (
                <button type="button" onClick={onClose}
                  className="min-h-10 flex-1 rounded-lg border border-white/15 px-3 py-2 text-[12px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141310]">
                  {hasError ? "Close" : "Run in background"}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function VideoEditorTab({ mintAddress, sessionId, onRunClipping, onViewResults, externalClip, extraVideos, clipLabel }: {
  mintAddress?: string; sessionId?: string;
  /** Header "Clip" button: fires the real Clipping pipeline (moment selection
   *  + render, unchanged algo) — mounts the Clipping canvas hidden so its
   *  queued ops actually drain, WITHOUT navigating away (see the in-place
   *  progress modal below). */
  onRunClipping?: () => void;
  /** "View in Generations" button on the progress modal, once clips are done —
   *  switches the parent's active tab (VideoEditorTab has no tab control of
   *  its own). Omitted in contexts with no Generations tab to jump to. */
  onViewResults?: () => void;
  /** Load a clip pushed from OUTSIDE the editor (the influencer Editor's
   *  sidebar — example video / recent generations). `nonce` re-fires the add
   *  even when the same url is clicked twice. */
  externalClip?: { url: string; title: string; nonce: number; taskId?: string; sourceUrl?: string };
  /** Extra playable videos for the "Videos" asset tab (e.g. the influencer's
   *  generated videos) — shown above the downloaded list, click = add to canvas.
   *  `taskId` (the source agentTasks row) lets Apply write the burned result
   *  back so the Marketplace/profile actually serves it. */
  extraVideos?: { url: string; title: string; taskId?: string }[];
  /** Override for the top-bar run button's text (influencer editor shows
   *  "Apply"); default is the clipper's "Clip (N clips)" with the live count. */
  clipLabel?: string;
}) {
  const { accessToken } = useSupabaseAuth();
  // "Save as agent style": persist the hook's design + size + dragged position into
  // the agent's clip.hook skill config — the same store the AI Clipper reads and
  // resolveVideoDirectives bridges into generated UGC videos, so ONE saved style
  // drives every future video in both apps.
  const upsertSkillFile = useMutation(api.agentSkillFiles.upsert);
  const setSkillConfig = useMutation(api.agentSkillFiles.setConfig);
  type AgentSkillRow = Doc<"agentSkillFiles">;
  const mintSkillRows = useQuery(api.agentSkillFiles.listByMint, mintAddress ? { mintAddress } : "skip") as AgentSkillRow[] | undefined;
  const sessionSkillRows = useQuery(
    api.agentSkillFiles.listBySession,
    !mintAddress && sessionId ? { sessionId } : "skip",
  ) as AgentSkillRow[] | undefined;
  const skillRows = mintAddress ? mintSkillRows : sessionSkillRows;
  const skillRowById = useMemo(() => {
    if (skillRows === undefined) return undefined;
    return new Map(skillRows.map((row) => [row.skillId, row]));
  }, [skillRows]);
  const hookSkillRow = skillRowById?.get("clip.hook") ?? (skillRowById ? null : undefined);
  // Cover Image tool (Clipping drawer) — one operator-uploaded image applied as
  // the thumbnail/cover for every clip this project posts (lib/builder/coverImageConfig.ts).
  const coverSkillRow = skillRowById?.get(CLIP_COVER_SKILL_ID) ?? (skillRowById ? null : undefined);
  // Same store, for the caption PRESET — bridged into UGC renders by
  // resolveVideoDirectives (capsCfg.captionPreset). Kept alongside hookSkillRow
  // so Apply can persist both automatically, not just on a separate manual click.
  const capsSkillRow = skillRowById?.get("clip.captions") ?? (skillRowById ? null : undefined);
  // Same store, for background MUSIC — bridged into UGC renders by
  // resolveVideoDirectives (audioCfg.musicTrackId/autoMusic in
  // lib/builder/videoDirector.ts). Was missing here: the editor's music
  // picker only wrote to local timeline/localStorage state, so a chosen
  // track never carried forward to the NEXT generated video. Read here,
  // written by persistAgentDefaults below, same pattern as hook/captions.
  // Caption LANGUAGE picks (transcription + subtitle) — agent-level defaults
  // restored from the clip.captions config, applied to every caption overlay
  // created here (a preset swap must not reset them), persisted by
  // persistAgentDefaults, and bridged into auto-generated videos by
  // resolveVideoDirectives (lib/builder/videoDirector.ts).
  // Derived, not restored-by-effect: the server row is the default until the
  // operator picks locally (the local pick is also persisted, so the two
  // converge). No setState-in-effect, no "restored once" ref.
  type CaptionLangDefaults = { languageCode: string; subtitleLanguageCode: string };
  const captionLangServerDefaults = useMemo<CaptionLangDefaults>(() => {
    const cfg = (capsSkillRow?.config && typeof capsSkillRow.config === "object" ? capsSkillRow.config : {}) as Record<string, unknown>;
    return {
      languageCode: typeof cfg.captionLanguageCode === "string" ? cfg.captionLanguageCode : "",
      subtitleLanguageCode: typeof cfg.subtitleLanguageCode === "string" ? cfg.subtitleLanguageCode : "",
    };
  }, [capsSkillRow]);
  const [captionLangOverride, setCaptionLangOverride] = useState<CaptionLangDefaults | null>(null);
  const captionLangDefaults = captionLangOverride ?? captionLangServerDefaults;
  const captionLangDefaultsRef = useRef(captionLangDefaults);
  const setCaptionLangDefaults = useCallback((upd: CaptionLangDefaults | ((prev: CaptionLangDefaults) => CaptionLangDefaults)) => {
    setCaptionLangOverride((prevOverride) => {
      const prev = prevOverride ?? captionLangDefaultsRef.current;
      return typeof upd === "function" ? upd(prev) : upd;
    });
  }, []);
  useEffect(() => { captionLangDefaultsRef.current = captionLangDefaults; }, [captionLangDefaults]);

  // Same store, for the Post Captions tool's settings (prompt / mood /
  // language) → clip.captionstyle (Smart Captions). Its composed
  // `descriptionPrompt` is what /api/social/post and the auto-post pipeline
  // read, so saving here is what makes the tool "apply" to every post.
  const captionStyleSkillRow = skillRowById?.get("clip.captionstyle") ?? (skillRowById ? null : undefined);
  const musicSkillRow = skillRowById?.get("clip.trendingaudio") ?? (skillRowById ? null : undefined);
  const filterSkillRow = skillRowById?.get("clip.filters") ?? (skillRowById ? null : undefined);
  const [hookStyleSaved, setHookStyleSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Patches a burned clip's SOURCE task (agentTasks.output.videoUrl) so the
  // Marketplace/profile actually serves the burned result, not the original.
  const updateTaskVideoUrl = useMutation(api.agentTasks.updateVideoUrl);

  // Downloaded source videos — the EXACT same query + rows the Downloads tab
  // reads (components/builder/clipping-flow/library/downloads-tab.tsx), so
  // whatever shows there shows here too. No mode filter: "audio" rows render
  // as a non-clickable placeholder (nothing to preview), "full"/"segment"
  // rows are real playable video and can be added to the timeline.
  const videoAssets = useQuery(
    api.downloadCache.listByMint,
    mintAddress ? { mintAddress } : "skip",
  ) as Doc<"downloadCache">[] | undefined;

  // Agent-level default for the news-idea auto-attach (Specials · Reference
  // Image) — read here so the Specials drawer can show/toggle it without a
  // separate settings screen. undefined (not yet loaded) and true both read
  // as "on"; only an explicit `false` shows the switch off.
  const agentForOverlayToggle = useQuery(
    api.influencers.getByMint,
    mintAddress ? { mintAddress } : "skip",
  ) as { videoConfig?: { newsImageOverlayEnabled?: boolean }; clipConfig?: Record<string, unknown> & { velloWatermark?: boolean } } | null | undefined;
  const newsImageOverlayEnabled = agentForOverlayToggle?.videoConfig?.newsImageOverlayEnabled !== false;
  const [savingOverlayToggle, setSavingOverlayToggle] = useState(false);
  const setNewsImageOverlayEnabled = useCallback(async (on: boolean) => {
    if (!mintAddress) return;
    setSavingOverlayToggle(true);
    try {
      await fetch("/api/agents/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ mintAddress, kind: "video", payload: { newsImageOverlayEnabled: on } }),
      });
    } finally {
      setSavingOverlayToggle(false);
    }
  }, [mintAddress, accessToken]);

  // Resolve YouTube and Drive names once per source. Drive's metadata call is
  // small (no media bytes); folder-picked names are populated immediately.
  const [videoTitles, setVideoTitles] = useState<Record<string, string>>({});
  const videoTitleRequested = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const d of videoAssets ?? []) {
      const url = d.sourceUrl;
      if (videoTitleRequested.current.has(url)) continue;
      const isYoutube = !!ytVideoId(url);
      if (!isYoutube && !driveFileIdentity(url)) continue;
      if (!isYoutube && !accessToken) continue;
      videoTitleRequested.current.add(url); // mark in-flight (a ref, not state, no render needed for this)
      fetch(`${isYoutube ? "/api/media/youtube-title" : "/api/video/info"}?url=${encodeURIComponent(url)}`, {
        headers: !isYoutube && accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      })
        .then((r) => r.json())
        .then((j: { ok?: boolean; title?: string }) => {
          if (j.ok && j.title) setVideoTitles((prev) => ({ ...prev, [url]: j.title! }));
        })
        .catch(() => {});
    }
  }, [videoAssets, accessToken]);

  // ── Persisted project state (survives a refresh, same pattern as the
  //    Carousel builder's localStorage draft). Loaded once via lazy useState
  //    initializers (not an effect) so the first render is already hydrated. ─
  const storageKey = useMemo(() => `vello.editor.${mintAddress || sessionId || "draft"}`, [mintAddress, sessionId]);
  const draft = useMemo(() => loadEditorDraft(storageKey), [storageKey]);
  const [watermarkOverride, setWatermarkOverride] = useState<boolean | undefined>(() => mintAddress ? undefined : draft.toolbar?.velloWatermark);
  const velloWatermark = watermarkOverride ?? agentForOverlayToggle?.clipConfig?.velloWatermark ?? true;
  const [watermarkSaving, setWatermarkSaving] = useState(false);
  const [watermarkError, setWatermarkError] = useState<string | null>(null);
  const toggleWatermark = async (enabled: boolean) => {
    const previous = velloWatermark;
    setWatermarkOverride(enabled);
    setWatermarkError(null);
    if (!mintAddress) {
      useClippingStore.getState().queueChatOps([{ op: "set_watermark", enabled }]);
      return;
    }
    setWatermarkSaving(true);
    try {
      const response = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ mintAddress, kind: "clip", payload: { velloWatermark: enabled } }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; forcedFreePlan?: boolean; velloWatermark?: boolean };
      if (!response.ok || result.ok === false) throw new Error(result.error || "Could not save watermark setting");
      // The server, not this toggle, has the final say: a free-plan agent can
      // never actually turn the watermark off, so an "off" attempt here comes
      // back forced on. Reflect what actually got saved, not what was clicked.
      if (result.forcedFreePlan) {
        setWatermarkOverride(true);
        setWatermarkError("The Vello watermark is required on the free plan — upgrade to remove it.");
        useClippingStore.getState().queueChatOps([{ op: "set_watermark", enabled: true }]);
        return;
      }
      useClippingStore.getState().queueChatOps([{ op: "set_watermark", enabled }]);
    } catch (error) {
      setWatermarkOverride(previous);
      setWatermarkError(error instanceof Error ? error.message : "Could not save watermark setting");
    } finally { setWatermarkSaving(false); }
  };
  const [timeline, setTimeline] = useState<TimelineItem[]>(() => (draft.timeline ?? []).map(capPreviewWindow));
  const [overlays, setOverlays] = useState<Overlay[]>(() => draft.overlays ?? []);
  const [uploads, setUploads] = useState<Asset[]>(() => draft.uploads ?? []);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(() => draft.aspectRatio ?? "9:16");
  // Glass BG: fills the letterbox gaps (visible whenever the video doesn't
  // natively fill the chosen aspect box) with a blurred, cover-scaled copy of
  // the SAME video — the "Apple frosted glass" look — instead of plain black
  // bars. Lives in both the live preview (CSS, below) and the real burn
  // (/api/video/overlay-burn's `background` param, reusing the exact
  // blur_frame ffmpeg composite the clipper's Zoom Punch skill renders).
  const [glassBgOn, setGlassBgOn] = useState(() => draft.glassBgOn ?? false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Latest timeline for callbacks that must not re-create on every edit.
  const timelineRef = useRef(timeline);
  useEffect(() => { timelineRef.current = timeline; }, [timeline]);
  const [downloadJobIds, setDownloadJobIds] = useState<string[]>(() => draft.downloadJobIds ?? []);
  // Debounced (a burst of edits = one write) and slimmed: the raw face scan
  // (faceSamples, ~1k points per clip) stays in memory only — it is re-fetched
  // on the next camera-mode change if missing — and overlays whose clip is gone
  // are dropped. Writing the full state synchronously on every keystroke was a
  // visible stall once an agent had dozens of clips in the draft.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const alive = new Set(timeline.map((t) => t.id));
      const slimTimeline = timeline.map((t) => { const slim = { ...t }; delete slim.faceSamples; return slim; });
      const liveOverlays = overlays.filter((o) => alive.has(o.itemId));
      try {
        const current = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as EditorDraft;
        window.localStorage.setItem(storageKey, JSON.stringify({ ...current, timeline: slimTimeline, overlays: liveOverlays, uploads, aspectRatio, downloadJobIds, glassBgOn }));
      } catch { /* quota / corrupt legacy state */ }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [timeline, overlays, uploads, aspectRatio, downloadJobIds, glassBgOn, storageKey]);

  // ── Left panel ──────────────────────────────────────────────────────────
  const [leftTab, setLeftTab] = useState<"videos" | "uploads">("videos");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // addClipToTimeline is declared below — reach it through a ref so this
  // callback's deps never touch it before initialization.
  const addClipToTimelineRef = useRef<(url: string, title: string, taskId?: string, sourceUrl?: string) => void>(() => {});
  // Live per-file upload progress (name → %), rendered as cards in the panel.
  const [uploadProgress, setUploadProgress] = useState<{ id: string; name: string; pct: number; error?: string }[]>([]);
  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/") || /\.(mp4|mov|webm|mkv|m4v|png|jpe?g|webp|gif)$/i.test(f.name));
    if (picked.length === 0) return;
    setUploading(true);
    setLeftTab("uploads");
    const rows = picked.map((f) => ({ id: uid(), name: f.name, pct: 0 }));
    setUploadProgress((prev) => [...rows, ...prev]);
    let openedVideo = false;
    try {
      // R2 only — streamed through /api/media/upload-stream (no Convex storage,
      // no 200 MB cap, no 10 MB proxy truncation). Sequential so a big source
      // gets the whole uplink and its progress bar actually moves.
      for (const [i, file] of picked.entries()) {
        const row = rows[i];
        try {
          const up = await uploadMediaFile(file, {
            accessToken,
            onProgress: (pct) => setUploadProgress((prev) => prev.map((r) => (r.id === row.id ? { ...r, pct } : r))),
          });
          const kind: Asset["kind"] = up.kind === "video" ? "video" : "image";
          setUploads((prev) => [{ id: uid(), url: up.url, name: file.name, kind }, ...prev]);
          setUploadProgress((prev) => prev.filter((r) => r.id !== row.id));
          // Own-video upload = the easy path to clipping: open the first video
          // straight onto the timeline, carrying its R2 URL as the clip SOURCE
          // (the Clip button reads sourceUrl) — no YouTube download involved.
          if (kind === "video" && !openedVideo) {
            openedVideo = true;
            addClipToTimelineRef.current(up.url, file.name, undefined, up.url);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Upload failed";
          setUploadProgress((prev) => prev.map((r) => (r.id === row.id ? { ...r, error: msg } : r)));
          window.setTimeout(() => setUploadProgress((prev) => prev.filter((r) => r.id !== row.id)), 8000);
        }
      }
    } finally {
      setUploading(false);
    }
  }, [accessToken]);

  // ── Timeline ops ────────────────────────────────────────────────────────
  const addClipToTimeline = useCallback((url: string, title: string, taskId?: string, sourceUrl?: string) => {
    const id = uid();
    // A task id proves only where a video came from; it does NOT prove that its
    // pixels contain a text hook. Treating every generated task as pre-burned
    // hid a newly selected Text Hook from the preview. Only a successful Apply
    // below may set hookBurned=true.
    // `sourceUrl` (when the generation carried a rawVideoUrl) is the
    // PRE-overlay original — the "Original" download and every re-burn
    // start from it, so removing a hook/caption actually removes it from
    // the pixels instead of burning on top of the baked-in one.
    // Already on the timeline (the sidebar auto-opens the latest generation on
    // EVERY visit, and the same download can be clicked twice) → just select it.
    const existing = timelineRef.current.find((t) => t.url === url || (!!taskId && t.taskId === taskId));
    if (existing) { setSelectedId(existing.id); return; }
    setTimeline((prev) => [...prev, buildInitialTimelineItem(url, title, taskId, sourceUrl, id)]);
    setSelectedId(id); // selecting it immediately previews it in the canvas
  }, []);
  addClipToTimelineRef.current = addClipToTimeline;
  // Sidebar-pushed clip (influencer Editor) → straight onto the timeline.
  useEffect(() => {
    if (externalClip?.url) addClipToTimeline(externalClip.url, externalClip.title, externalClip.taskId, externalClip.sourceUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalClip?.nonce]);

  // Every NEW clip starts pre-configured with the agent's saved hook/caption/
  // filter style (the SAME skill-config store persistAgentDefaults writes
  // to) instead of blank — the operator only retypes the hook's wording per
  // video, not the whole look every single time. Seeded once per item (a ref,
  // not state, so a later Apply/re-render never re-seeds and clobbers an edit)
  // and only once real duration is known so endSec spans the whole clip.
  const seededItemIds = useRef<Set<string>>(new Set());
  const seedSavedOverlaysForItem = useCallback((itemId: string, duration: number) => {
    if (hookSkillRow === undefined || capsSkillRow === undefined || filterSkillRow === undefined) return;
    if (seededItemIds.current.has(itemId)) return;
    seededItemIds.current.add(itemId);
    const hookCfg = (hookSkillRow?.config && typeof hookSkillRow.config === "object" ? hookSkillRow.config : {}) as Record<string, unknown>;
    const capsCfg = (capsSkillRow?.config && typeof capsSkillRow.config === "object" ? capsSkillRow.config : {}) as Record<string, unknown>;
    const filterCfg = (filterSkillRow?.config && typeof filterSkillRow.config === "object" ? filterSkillRow.config : {}) as Record<string, unknown>;
    const savedFilter = FILTER_PRESET_IDS.includes(filterCfg.filterPreset as (typeof FILTER_PRESET_IDS)[number])
      ? filterCfg.filterPreset as (typeof FILTER_PRESET_IDS)[number]
      : undefined;
    const savedSat = typeof filterCfg.filterSaturation === "number" ? Math.min(2, Math.max(0, filterCfg.filterSaturation)) : undefined;
    const savedBri = typeof filterCfg.filterBrightness === "number" ? Math.min(0.5, Math.max(-0.5, filterCfg.filterBrightness)) : undefined;
    if (savedFilter || savedSat !== undefined || savedBri !== undefined) {
      setTimeline((prev) => prev.map((t) => t.id === itemId ? {
        ...t,
        filterPreset: t.filterPreset ?? savedFilter,
        filterSaturation: t.filterSaturation ?? savedSat,
        filterBrightness: t.filterBrightness ?? savedBri,
      } : t));
    }
    const seeds: Overlay[] = [];
    const templateId = typeof hookCfg.hookTemplateId === "string" ? hookCfg.hookTemplateId : undefined;
    const design = templateId ? HOOK_DESIGN_BY_ID[templateId] : undefined;
    if (templateId && design) {
      const custom = (hookCfg.hookCustomDesign && typeof hookCfg.hookCustomDesign === "object" ? hookCfg.hookCustomDesign : {}) as Record<string, unknown>;
      const fontSize = typeof custom.fontSize === "number" ? custom.fontSize : design.render.fontSize;
      const yPct = typeof custom.yPct === "number" ? custom.yPct : undefined;
      const lastHookText = typeof hookCfg.lastHookText === "string" ? hookCfg.lastHookText : "";
      const hookDurationSec = typeof hookCfg.hookDurationSec === "number" ? hookCfg.hookDurationSec : DEFAULT_HOOK_DURATION_SEC;
      // Saved placement (Text Hooks drawer's "Placement" dropdown) — was
      // hardcoded to "top" here regardless of what was saved, so a chosen
      // bottom/center placement never carried over to a new clip.
      const savedPosition = hookCfg.hookPosition === "bottom" || hookCfg.hookPosition === "center" ? hookCfg.hookPosition : "top";
      seeds.push({
        id: uid(), itemId, text: lastHookText, startSec: 0,
        endSec: Math.min(hookDurationSec, Math.max(0.1, duration)),
        position: savedPosition, hookDesignId: templateId,
        hookFontScale: fontSize / (design.render.fontSize || 1),
        ...(yPct !== undefined ? { oy: yPct / 100 } : {}),
      });
    }
    const presetId = typeof capsCfg.captionPreset === "string" ? capsCfg.captionPreset : undefined;
    if (presetId && CAPTION_PRESET_BY_ID[presetId]) {
      const lang = typeof capsCfg.captionLanguageCode === "string" ? capsCfg.captionLanguageCode : "";
      const sub = typeof capsCfg.subtitleLanguageCode === "string" ? capsCfg.subtitleLanguageCode : "";
      seeds.push({
        id: uid(), itemId, text: CAPTION_DEMO_TEXT, startSec: 0,
        endSec: Math.max(0.1, duration), position: "bottom", presetId,
        ...(lang ? { captionLanguageCode: lang } : {}),
        ...(sub ? { captionSubtitleLanguageCode: sub } : {}),
      });
    }
    if (seeds.length) setOverlays((prev) => {
      // A restored draft already carries this clip's hook/caption — seeding
      // again (the ref above is empty after a refresh) would stack a second
      // hook text on top of the first. Add only the kinds the clip lacks.
      const has = new Set(prev.filter((o) => o.itemId === itemId).map(overlayKind).filter(Boolean));
      const missing = seeds.filter((o) => !has.has(overlayKind(o)));
      return missing.length ? [...prev, ...missing] : prev;
    });
  }, [hookSkillRow, capsSkillRow, filterSkillRow]);

  const onDurationKnown = useCallback((id: string, duration: number) => {
    setTimeline((prev) => prev.map((t) => (t.id === id && t.duration === 0)
      ? capPreviewWindow({ ...t, duration, trimOut: duration })
      : t));
    seedSavedOverlaysForItem(id, Math.min(duration, PREVIEW_SECONDS));
  }, [seedSavedOverlaysForItem]);

  // ── "Get Clips" — fetch a new source video, tracked live via DownloadJobCard.
  const [sourceUrlInput, setSourceUrlInput] = useState("");
  const [getClipsLoading, setGetClipsLoading] = useState(false);
  const [getClipsError, setGetClipsError] = useState<string | null>(null);
  const [downloadCheck, setDownloadCheck] = useState<string | null>(null);
  const [creditNotice, setCreditNotice] = useState<{ title: string; detail: string; required?: number; available?: number } | null>(null);
  const availableCredits = useQuery(api.userCredits.balanceForMint, mintAddress ? { mintAddress } : "skip") as number | undefined;
  // A pasted Google Drive FOLDER (or YouTube channel/playlist) link resolves to
  // several member videos instead of one — same /api/clip/resolve-source-url the
  // clipper's Source-node "Paste URL" pill already uses. When it comes back with
  // more than one video this holds the picker list; picking one downloads THAT
  // file via the normal single-source path below.
  const [folderPick, setFolderPick] = useState<{ url: string; videos: { url: string; name: string }[] } | null>(null);
  // One credit gate for BOTH the download and the Clip run: prices the source
  // by length (estimateClipRunCredits — same formula convex/clipJobs bills),
  // then asks the server precheck, which reconciles the agent's on-chain USDC
  // and adds the owner's credits (the local balance alone can under-count).
  // Returns null when the run is affordable, else the notice to show.
  type CreditNotice = NonNullable<typeof creditNotice>;
  const checkCreditsFor = useCallback(async (durationSeconds: number, action: "download" | "clip"): Promise<CreditNotice | null> => {
    if (!mintAddress) return null; // draft agents run on the free tier
    const required = estimateClipRunCredits(durationSeconds);
    const available = availableCredits ?? 0;
    const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
    const length = `${minutes} minute${minutes === 1 ? "" : "s"}`;
    let reason = "";
    try {
      const res = await fetch("/api/economy/clip-precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ mintAddress, skillIds: [], estimatedDurationSeconds: durationSeconds }),
        signal: AbortSignal.timeout(30_000),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && j.ok === true) return null;
      reason = j.reason ?? (res.ok ? "needs_funding" : "precheck_unavailable");
    } catch {
      reason = "precheck_unavailable";
    }
    const verb = action === "download" ? "downloading" : "clipping";
    if (reason === "daily_cap") {
      return { title: "Daily spending cap reached", detail: `This ${length} source needs ${required.toLocaleString()} credits, which is over today's remaining cap. Raise this agent's daily cap in Budget, or try again tomorrow.` };
    }
    if (reason === "suspended") return { title: "Agent suspended", detail: "Runs are blocked for this agent, so nothing was downloaded or charged." };
    if (reason === "precheck_unavailable" || reason === "no_account") {
      return { title: "Couldn't verify your credits", detail: "The billing check didn't respond, so nothing was started or charged. Try again in a moment." };
    }
    return {
      title: `Not enough credits for ${verb}`,
      detail: `This source is ${length} long and needs ${required.toLocaleString()} credits. You have ${available.toLocaleString()}, so add ${Math.max(1, required - available).toLocaleString()} more to continue. Nothing was charged.`,
      required, available,
    };
  }, [mintAddress, availableCredits, accessToken]);
  // Seeded from the persisted downloadJobIds (not a fresh empty Set): a job
  // that was already in flight before a page refresh must still auto-open its
  // video once it finishes. Without this, a refresh mid-download (easy to do
  // when the progress bar looked stalled) silently dropped the "auto-open on
  // completion" marker — the job kept running server-side and landed safely in
  // the Videos list, but never opened in the middle preview, reading as "the
  // download disappeared" even though nothing was actually lost.
  const autoOpenJobIds = useRef<Set<string>>(new Set(draft.downloadJobIds ?? []));
  const previewJobBySource = useRef<Map<string, string>>(new Map());
  const repairJobTargets = useRef<Map<string, string>>(new Map());
  const startStoredPreview = useCallback(async (sourceUrl: string, force = false, targetItemId?: string) => {
    const sourceKey = driveFileIdentity(sourceUrl) ?? sourceUrl;
    const pending = previewJobBySource.current.get(sourceKey);
    if (pending) return pending;
    setGetClipsLoading(true);
    setGetClipsError(null);
    setDownloadCheck("Preparing a playable 10-second preview from your saved video…");
    try {
      const res = await fetch("/api/video/download-start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ sourceUrl, mintAddress, previewOnly: true, forcePreview: force }),
      });
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean; jobId?: string; error?: string };
      if (!res.ok || !result.ok || !result.jobId) throw new Error(result.error ?? `Preview request failed (HTTP ${res.status})`);
      previewJobBySource.current.set(sourceKey, result.jobId);
      if (targetItemId) repairJobTargets.current.set(result.jobId, targetItemId);
      autoOpenJobIds.current.add(result.jobId);
      setDownloadJobIds((prev) => [result.jobId!, ...prev]);
      setSourceUrlInput("");
      return result.jobId;
    } catch (e) {
      setGetClipsError(e instanceof Error ? e.message : "Could not prepare the video preview");
      return undefined;
    } finally {
      setGetClipsLoading(false);
      setDownloadCheck(null);
    }
  }, [accessToken, mintAddress]);
  const startDownload = useCallback(async (url: string) => {
    const isDrive = looksLikeGoogleDrive(url);
    const driveId = driveFileIdentity(url);
    const existing = (videoAssets ?? []).find((d) =>
      (d.sourceUrl === url || (driveId && driveFileIdentity(d.sourceUrl) === driveId))
      && ((d.mode ?? "full") === "full" || (d.mode === "segment" && d.sectionKey?.startsWith("editor-h264-") === true) || (!isDrive && d.mode === "segment" && (d.durationSeconds ?? 0) <= PREVIEW_SECONDS + 2)));
    if (existing) {
      if ((existing.mode ?? "full") === "full") return startStoredPreview(existing.sourceUrl);
      addClipToTimeline(existing.url, existing.sourceUrl);
      setSourceUrlInput("");
      return;
    }
    if (mintAddress && availableCredits === undefined) {
      setCreditNotice({ title: "Checking your credits", detail: "Your balance is still loading. Wait a moment, then try again." });
      return;
    }
    setGetClipsLoading(true);
    setGetClipsError(null);
    setCreditNotice(null);
    try {
      // A preview only fetches ten seconds, so slow/missing source metadata
      // must not block it. Price the minimum now; the clip run checks the full
      // source's real duration again before billing or rendering.
      setDownloadCheck("Checking video length…");
      let duration = NaN;
      try {
        const infoRes = await fetch(`/api/video/info?url=${encodeURIComponent(url)}`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        const info = (await infoRes.json().catch(() => ({}))) as { ok?: boolean; durationSeconds?: number };
        duration = info.ok ? Number(info.durationSeconds) : NaN;
      } catch { /* timeout / network — handled as "unknown length" below */ }
      const lengthKnown = Number.isFinite(duration) && duration > 0;
      const pricedSeconds = lengthKnown ? duration : 60;
      const required = estimateClipRunCredits(pricedSeconds);
      setDownloadCheck(`Checking credits · ${required.toLocaleString()} needed…`);
      const blocked = await checkCreditsFor(pricedSeconds, "download");
      if (blocked) {
        setDownloadCheck(null);
        setCreditNotice(blocked);
        return;
      }
      setDownloadCheck(lengthKnown
        ? `Length verified · ${Math.max(1, Math.ceil(duration / 60))} min · ${required.toLocaleString()} credits`
        : `Downloading · length is confirmed after download, credits re-checked before clipping`);
      const res = await fetch("/api/video/download-start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(buildEditorVideoDownloadRequest(url, mintAddress)),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; jobId?: string; error?: string };
      if (!res.ok || !j.ok || !j.jobId) throw new Error(j.error ?? `Request failed (HTTP ${res.status})`);
      autoOpenJobIds.current.add(j.jobId);
      setDownloadJobIds((prev) => [j.jobId!, ...prev]);
      setSourceUrlInput("");
      setFolderPick(null);
      window.setTimeout(() => setDownloadCheck(null), 2500);
      return j.jobId;
    } catch (e) {
      setDownloadCheck(null);
      setGetClipsError(e instanceof Error ? e.message : "Failed to start download");
    } finally {
      setGetClipsLoading(false);
    }
    return undefined;
  }, [accessToken, mintAddress, videoAssets, addClipToTimeline, availableCredits, checkCreditsFor, startStoredPreview]);
  const submitGetClips = useCallback(async () => {
    const url = sourceUrlInput.trim();
    if (!url) return;
    const driveId = driveFileIdentity(url);
    // Already have a preview (or the full video) for this source — reuse it
    // instead of re-fetching (downloadCache dedupes server-side too, but this
    // skips the round-trip). Excludes a pipeline-rendered "clip segment" for
    // the same source — that's a specific clip, not a fresh full-source preview.
    const existing = (videoAssets ?? []).find((d) =>
      (d.sourceUrl === url || (driveId && driveFileIdentity(d.sourceUrl) === driveId))
      && ((d.mode ?? "full") === "full" || (d.mode === "segment" && d.sectionKey?.startsWith("editor-h264-") === true) || (!driveId && d.mode === "segment" && (d.durationSeconds ?? 0) <= PREVIEW_SECONDS + 2)));
    if (existing) {
      if ((existing.mode ?? "full") === "full") { void startStoredPreview(existing.sourceUrl); return; }
      addClipToTimeline(existing.url, existing.sourceUrl);
      setSourceUrlInput("");
      return;
    }
    // Resolve every Drive URL through the same server path as the Clipping tab:
    // folders become a picker; single files become one canonical downloadable
    // URL. This also handles `/open?id=` and sharing URLs consistently.
    if (looksLikeGoogleDrive(url)) {
      setGetClipsLoading(true);
      setGetClipsError(null);
      try {
        const res = await fetch(`/api/clip/resolve-source-url?url=${encodeURIComponent(url)}`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        const j = (await res.json().catch(() => ({}))) as { videos?: { url: string; name: string }[]; isFolder?: boolean };
        const videos = j.videos ?? [];
        if (videos.length > 1) {
          setFolderPick({ url, videos });
          setGetClipsLoading(false);
          return;
        }
        if (videos.length === 1) {
          setVideoTitles((prev) => ({ ...prev, [videos[0].url]: videos[0].name }));
          void startDownload(videos[0].url);
          return;
        }
        setGetClipsError(looksLikeDriveFolder(url)
          ? "No videos found in that Drive folder. Make sure it is shared with anyone who has the link."
          : "That Drive file could not be opened as a video. Make sure it is a video shared with anyone who has the link.");
        setGetClipsLoading(false);
      } catch {
        setGetClipsError("Could not read that Google Drive link.");
        setGetClipsLoading(false);
      }
      return;
    }
    void startDownload(url);
  }, [sourceUrlInput, videoAssets, addClipToTimeline, startDownload, startStoredPreview, accessToken]);
  // Downloads the chat copilot started (editorIntake) open straight onto the
  // timeline when they land, so the operator is one "Clip" click away.
  const onJobSettled = useCallback((jobId: string, job?: SettledDownloadJob) => {
    setDownloadJobIds((prev) => prev.filter((id) => id !== jobId));
    for (const [source, pendingId] of previewJobBySource.current) {
      if (pendingId === jobId) previewJobBySource.current.delete(source);
    }
    const shouldAutoOpen = autoOpenJobIds.current.delete(jobId);
    const repairTarget = repairJobTargets.current.get(jobId);
    repairJobTargets.current.delete(jobId);
    if (!job) return;
    if (repairTarget && job.status === "done" && job.url) {
      setTimeline((prev) => prev.map((item) => item.id === repairTarget ? { ...item, url: job.url!, duration: 0, trimIn: 0, trimOut: 0 } : item));
      setSelectedId(repairTarget);
      setPlaybackError(null);
    } else if (shouldAutoOpen && job.status === "done" && job.url) addClipToTimeline(job.url, job.sourceUrl ?? job.url);
    else if (job.status === "error") {
      const failure = explainClipFailure(job.error);
      setGetClipsError([failure.message, failure.hint].filter(Boolean).join(" "));
    }
  }, [addClipToTimeline]);

  // ── Chat copilot handoff: "clip this <url>" / "I want to upload my video" ──
  const editorIntake = useClippingStore((st) => st.editorIntake);
  // Pulses the "Upload your own video" button — a file picker opened from an
  // async chat reply is usually blocked (no fresh user gesture), so point at it.
  const [uploadNudge, setUploadNudge] = useState(false);
  useEffect(() => {
    if (!uploadNudge) return;
    const t = window.setTimeout(() => setUploadNudge(false), 6000);
    return () => window.clearTimeout(t);
  }, [uploadNudge]);
  useEffect(() => {
    if (!editorIntake) return;
    useClippingStore.getState().setEditorIntake(null);
    setLeftTab("videos");
    if (editorIntake.asset) {
      // Uploaded from the chat composer (already on R2) → Uploads + timeline.
      const a = editorIntake.asset;
      const kind: Asset["kind"] = a.kind === "video" ? "video" : "image";
      setUploads((prev) => (prev.some((u) => u.url === a.url) ? prev : [{ id: uid(), url: a.url, name: a.name, kind }, ...prev]));
      setLeftTab("uploads");
      if (kind === "video") addClipToTimeline(a.url, a.name, undefined, a.url);
      return;
    }
    if (editorIntake.upload || !editorIntake.sourceUrl) { setUploadNudge(true); if (editorIntake.upload) fileInputRef.current?.click(); return; }
    const url = editorIntake.sourceUrl?.trim();
    if (!url) return;
    setSourceUrlInput(url);
    // Drive links resolve (folder picker) through submitGetClips' own path —
    // just prefill; everything else downloads straight away.
    if (looksLikeGoogleDrive(url)) return;
    void startDownload(url).then((jobId) => { if (jobId) autoOpenJobIds.current.add(jobId); });
  }, [editorIntake, startDownload, addClipToTimeline]);


  // ── Selection + preview playback (plays the SELECTED clip's trim window —
  //    a real per-clip preview; full-timeline continuous playback is a v2).
  //    selectedId defaults to the first timeline item until explicitly chosen. ─
  const selected = timeline.find((t) => t.id === selectedId) ?? timeline[0] ?? null;

  const videoRef = useRef<HTMLVideoElement>(null);
  // Glass BG's blurred backdrop copy — a second <video> playing the SAME
  // source behind the main one (see the preview canvas below). Kept in sync
  // play/pause + seek with the main video by the effects that already do
  // this for videoRef (togglePlay, onTimeUpdate's loop-back, the clip-switch
  // reset) — each just also touches bgVideoRef when it's mounted.
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [trackOn, setTrackOn] = useState(true);
  const [playheadSec, setPlayheadSec] = useState(0);

  // Real canvas pixel width. Preview typography is projected from the exact
  // burn canvas for the selected aspect ratio.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidthPx, setCanvasWidthPx] = useState(320);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setCanvasWidthPx(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Background-music preview — plays in lockstep with the video whenever the
  // selected clip has a musicTrackId (approximate sync: play/pause together,
  // not frame-accurate scrubbing — good enough for an editor preview).
  const musicRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !selected) return;
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA && selected.trimIn > 0) v.currentTime = selected.trimIn;
    setPlayheadSec(selected.trimIn);
    const bg = bgVideoRef.current;
    if (bg && bg.readyState >= HTMLMediaElement.HAVE_METADATA && selected.trimIn > 0) bg.currentTime = selected.trimIn;
    const m = musicRef.current;
    if (m) { m.currentTime = 0; m.pause(); }
    setPlaying(false);
    setPlaybackError(null);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A stale/undecodable media URL can never fire onError in some browsers; it
  // just sits at 0:00. Show a repair action instead of spinning forever.
  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => {
      const video = videoRef.current;
      if (video && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        setPlaybackError("Preview is not loading. Repair its playable copy and try again.");
      }
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [selected?.id, selected?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Text Hooks panel state — declared here (above the per-clip rehydrate
  // effect below) so nothing reads a setter before its declaration.
  const [hookDuration, setHookDuration] = useState(() => draft.toolbar?.hookDuration ?? DEFAULT_HOOK_DURATION_SEC);
  // Default OFF: the hook shows for `hookDuration`; ticked, it holds to the end.
  const [hookAlwaysOn, setHookAlwaysOn] = useState(() => draft.toolbar?.hookAlwaysOn === true);
  const [hookPosition, setHookPosition] = useState<Overlay["position"]>(() => draft.toolbar?.hookPosition ?? "top");
  const [hookPrompt, setHookPrompt] = useState(() => draft.toolbar?.hookPrompt ?? "");
  const [generatedHook, setGeneratedHook] = useState("");
  const [hookGenError, setHookGenError] = useState<string | null>(null);

  // Text Hooks panel had its own free-form fields (hookPrompt/generatedHook/
  // hookDuration/hookPosition) that were plain useState with NO reset on clip
  // switch — so picking a different clip left the panel showing whatever was
  // last typed/generated for the PREVIOUS clip, even though the underlying
  // overlay data (per-clip, via itemId) was always correct. Rehydrate from the
  // newly-selected clip's own hook overlay (if it has one) or blank defaults.
  useEffect(() => {
    if (!selected) return;
    const hookOv = overlays.find((o) => o.itemId === selected.id && o.hookDesignId);
    setGeneratedHook(hookOv?.text ?? "");
    setHookPosition(hookOv?.position ?? "top");
    // Clamped to the slider range: an "Always on" hook spans the whole clip, which
    // must not leak into the 3–6s duration slider.
    setHookDuration(hookOv ? Math.max(HOOK_DURATION_MIN, Math.min(HOOK_DURATION_MAX, hookOv.endSec - hookOv.startSec)) : DEFAULT_HOOK_DURATION_SEC);
    setHookPrompt("");
    setHookGenError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const bg = bgVideoRef.current;
    const m = musicRef.current;
    if (playing) {
      v.pause(); setPlaying(false);
      bg?.pause();
      m?.pause();
    } else {
      setPlaybackError(null);
      void v.play().then(() => setPlaying(true)).catch((e) => {
        // Switching clips right after pressing play aborts THIS element's
        // pending play() (browsers reject it with "interrupted by a new load
        // request"/AbortError) — that's the video element doing exactly what
        // it should, not a real playback failure. Surfacing it as an error
        // banner scared users into thinking the preview was broken every time
        // they clicked play then picked a different clip. Only report it when
        // this is still the live element (videoRef wasn't swapped to a new
        // clip's <video> underneath us) and it isn't one of these benign aborts.
        if (videoRef.current !== v) return;
        setPlaying(false);
        const name = e instanceof DOMException ? e.name : "";
        const message = e instanceof Error ? e.message : "";
        if (name === "AbortError" || /interrupted by a new load request/i.test(message)) return;
        setPlaybackError(message || "This video cannot play in the browser.");
      });
      if (bg) { bg.currentTime = v.currentTime; bg.play().catch(() => {}); }
      if (m && selected?.musicTrackId) m.play().catch(() => {});
    }
  }, [playing, selected?.musicTrackId]);

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !selected) return;
    setPlayheadSec(v.currentTime);
    if (selected.trimOut > selected.trimIn && v.currentTime >= selected.trimOut) {
      v.pause();
      v.currentTime = selected.trimIn;
      setPlaying(false);
      const bg = bgVideoRef.current;
      if (bg) { bg.pause(); bg.currentTime = selected.trimIn; }
      musicRef.current?.pause();
    }
  }, [selected]);

  // ── Text / caption overlays (anchored to the selected item) ────────────
  const addTextOverlay = useCallback((seedText: string, opts?: { presetId?: string; hookDesignId?: string; endSec?: number; position?: Overlay["position"]; captionLang?: Partial<CaptionLangDefaults> }) => {
    if (!selected) return;
    const dur = Math.max(0.1, selected.trimOut - selected.trimIn);
    // A language pick made in the same click (no caption on the clip yet) wins
    // over the agent default, which hasn't re-rendered into the ref yet.
    const langCode = opts?.captionLang?.languageCode ?? captionLangDefaultsRef.current.languageCode;
    const subCode = opts?.captionLang?.subtitleLanguageCode ?? captionLangDefaultsRef.current.subtitleLanguageCode;
    setOverlays((prev) => [...prev, {
      id: uid(), itemId: selected.id, text: seedText,
      startSec: 0, endSec: opts?.endSec ?? Math.min(3, dur), position: opts?.position ?? "bottom",
      ...(opts?.presetId ? {
        presetId: opts.presetId,
        ...(langCode ? { captionLanguageCode: langCode } : {}),
        ...(subCode ? { captionSubtitleLanguageCode: subCode } : {}),
      } : {}),
      ...(opts?.hookDesignId ? { hookDesignId: opts.hookDesignId } : {}),
    }]);
  }, [selected]);
  const removeOverlay = useCallback((id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  }, []);
  const selectedOverlays = overlays.filter((o) => o.itemId === selected?.id);
  // Item ids where the operator explicitly asked to change an already-burned
  // hook — brings the live canvas overlay back so they can retype/reposition
  // it, until the next successful Apply re-burns it (which clears this).
  const [hookEditOverrideIds, setHookEditOverrideIds] = useState<Set<string>>(new Set());

  // ── Caption-style drawer (right-side panel, opened by the rail's Caption
  //    button) — picks one of the shared CAPTION_PRESETS (same catalog the App
  //    Store's caption-template picker uses), applied as a styled overlay.
  //    Only ONE caption layer at a time — picking a style REPLACES whichever
  //    preset overlay is already on the selected clip (plain Text overlays,
  //    with no presetId, are untouched). ──────────────────────────────────
  const [captionPanelOpen, setCaptionPanelOpen] = useState(false);
  const applyCaptionPreset = useCallback((presetId: string, captionLang?: Partial<CaptionLangDefaults>) => {
    if (!selected) return;
    setOverlays((prev) => prev.filter((o) => !(o.itemId === selected.id && o.presetId)));
    // Window spans the WHOLE clip (not a short 3s sample) — the canvas loops
    // CAPTION_DEMO_PAGES across it, so the caption repeats for the entire
    // duration instead of vanishing after a couple of seconds.
    addTextOverlay(CAPTION_DEMO_TEXT, { presetId, endSec: Math.max(0.1, selected.trimOut - selected.trimIn), ...(captionLang ? { captionLang } : {}) });
  }, [selected, addTextOverlay]);

  // Operator picked a transcription/subtitle language. Updates the agent
  // default, patches the clip's caption overlay when it has one, otherwise
  // drops the default preset on (carrying the pick explicitly, since the
  // state update hasn't landed yet) so the pick is visible in preview + burn.
  const pickCaptionLanguage = useCallback((patch: { captionLanguageCode?: string; captionSubtitleLanguageCode?: string }, captionOverlayId?: string) => {
    setCaptionLangDefaults((prev) => ({
      languageCode: patch.captionLanguageCode ?? prev.languageCode,
      subtitleLanguageCode: patch.captionSubtitleLanguageCode ?? prev.subtitleLanguageCode,
    }));
    if (captionOverlayId) {
      setOverlays((prev) => prev.map((o) => (o.id === captionOverlayId ? { ...o, ...patch } : o)));
      return;
    }
    applyCaptionPreset("karaoke", {
      ...(patch.captionLanguageCode !== undefined ? { languageCode: patch.captionLanguageCode } : {}),
      ...(patch.captionSubtitleLanguageCode !== undefined ? { subtitleLanguageCode: patch.captionSubtitleLanguageCode } : {}),
    });
  }, [applyCaptionPreset, setCaptionLangDefaults]);
  const clearCaptionPreset = useCallback(() => {
    if (!selected) return;
    setOverlays((prev) => prev.filter((o) => !(o.itemId === selected.id && o.presetId)));
  }, [selected]);

  // ── Persistent OFF switches — "this agent's videos need NO captions / NO
  //    text hook, this one AND every future one". Saves `disabled: true` into
  //    the clip.captions / clip.hook skill config (the same store
  //    resolveVideoDirectives bridges into every generated video), which
  //    force-gates the overlay off downstream regardless of what else is
  //    installed. Re-picking a preset/design clears it (persistAgentDefaults
  //    writes disabled: false). Also strips the overlay from the selected
  //    clip so the preview matches immediately.
  const [captionsOffState, setCaptionsOffState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [hooksOffState, setHooksOffState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const persistOverlayOff = useCallback(async (
    skillId: "clip.captions" | "clip.hook",
    row: { config?: unknown } | null | undefined,
    title: string,
    setState: (s: "idle" | "saving" | "saved" | "error") => void,
  ) => {
    if (!sessionId) return;
    setState("saving");
    try {
      if (!row) {
        await upsertSkillFile({
          sessionId, ...(mintAddress ? { mintAddress } : {}), skillId,
          title, markdown: `# ${title}\n\nDisabled from the video editor.`,
        });
      }
      const prev = (row?.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>;
      await setSkillConfig({
        sessionId, ...(mintAddress ? { mintAddress } : {}), skillId,
        config: { ...prev, disabled: true },
      });
      setState("saved");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
    }
  }, [sessionId, mintAddress, upsertSkillFile, setSkillConfig]);

  // ── Styles drawer — one-tap bundles (caption preset + camera framing mode).
  const [stylesPanelOpen, setStylesPanelOpen] = useState(false);

  // ── Filters drawer — uses the same preset ids and real FFmpeg chains as the
  // clipping-flow Video Filters skill, with a lightweight CSS live preview.
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const setVideoFilter = useCallback((patch: Partial<Pick<TimelineItem, "filterPreset" | "filterSaturation" | "filterBrightness">>) => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, ...patch } : t)));
  }, [selected]);
  const clearVideoFilter = useCallback(() => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? {
      ...t, filterPreset: undefined, filterSaturation: undefined, filterBrightness: undefined,
    } : t)));
  }, [selected]);

  // ── Text Hooks drawer (right-side panel) — one styled hook line, single
  //    layer like captions (picking a design replaces the current one). ────
  const [hookPanelOpen, setHookPanelOpen] = useState(false);
  const [hookLanguage, setHookLanguage] = useState(() => draft.toolbar?.hookLanguage ?? "English");
  // Restore the saved brief/language/placement ONCE the agent's clip.hook
  // config actually loads (it starts undefined, then resolves async) —
  // these three were local-state-only before and reset to blank every
  // remount despite being saved via persistAgentDefaults above. Guarded to
  // fire once so it never clobbers an in-progress edit on a later refetch.
  const hookDefaultsRestoredRef = useRef(false);
  useEffect(() => {
    if (hookDefaultsRestoredRef.current || !hookSkillRow) return;
    hookDefaultsRestoredRef.current = true;
    const cfg = (hookSkillRow.config && typeof hookSkillRow.config === "object" ? hookSkillRow.config : {}) as Record<string, unknown>;
    if (draft.toolbar?.hookPrompt === undefined && typeof cfg.hookPrompt === "string" && cfg.hookPrompt.trim()) setHookPrompt(cfg.hookPrompt);
    if (draft.toolbar?.hookLanguage === undefined && typeof cfg.hookLanguage === "string" && cfg.hookLanguage.trim()) setHookLanguage(cfg.hookLanguage);
    if (draft.toolbar?.hookPosition === undefined && (cfg.hookPosition === "bottom" || cfg.hookPosition === "center" || cfg.hookPosition === "top")) setHookPosition(cfg.hookPosition);
  }, [hookSkillRow, draft.toolbar]);
  const [hookGenerating, setHookGenerating] = useState(false);

  // ── Post Captions drawer (right-side panel, below Caption in the rail) —
  //    the SOCIAL-POST caption (what gets sent when Posting from the Apply
  //    modal), not the burned-in video captions. Same brief-in/line-out flow
  //    as Text Hooks, via /api/agents/post-caption/generate → generatePostCaption
  //    (Smart Captions' own generator, lib/server/captionTransform.ts) — so
  //    it's grounded in the same persona-caption engine the App Store uses.
  const [postCaptionPanelOpen, setPostCaptionPanelOpen] = useState(false);
  const [postCaptionLanguage, setPostCaptionLanguage] = useState(() => draft.toolbar?.postCaptionLanguage ?? "English");
  const [postCaptionMood, setPostCaptionMood] = useState(() => draft.toolbar?.postCaptionMood ?? POST_CAPTION_MOODS[0]);
  const [postCaptionPrompt, setPostCaptionPrompt] = useState(() => draft.toolbar?.postCaptionPrompt ?? "");
  const [postCaptionGenerating, setPostCaptionGenerating] = useState(false);
  const [postCaptionGenError, setPostCaptionGenError] = useState<string | null>(null);
  // Restore saved settings ONCE the clip.captionstyle row loads (same guard as
  // the Text Hooks restore above) — these were local-only before and reset to
  // defaults on every remount, so "I already set it" never stuck.
  const postCaptionRestoredRef = useRef(false);
  useEffect(() => {
    if (postCaptionRestoredRef.current || captionStyleSkillRow === undefined) return;
    postCaptionRestoredRef.current = true;
    const saved = readPostCaptionSettings(captionStyleSkillRow?.config);
    if (draft.toolbar?.postCaptionPrompt === undefined && saved.prompt?.trim()) setPostCaptionPrompt(saved.prompt);
    if (draft.toolbar?.postCaptionMood === undefined && saved.mood && POST_CAPTION_MOODS.includes(saved.mood)) setPostCaptionMood(saved.mood);
    if (draft.toolbar?.postCaptionLanguage === undefined && saved.language && HOOK_LANGUAGES.includes(saved.language)) setPostCaptionLanguage(saved.language);
  }, [captionStyleSkillRow, draft.toolbar]);
  // AUTO-SAVE (debounced): every change to prompt / mood / language lands in the
  // clip.captionstyle config as both the raw fields (for restore) and the composed
  // `descriptionPrompt` (what the publish paths actually read). Skipped until the
  // restore above ran so a blank initial state can't wipe a saved config.
  const captionStyleSkillRowRef = useRef(captionStyleSkillRow);
  useEffect(() => { captionStyleSkillRowRef.current = captionStyleSkillRow; }, [captionStyleSkillRow]);
  // Only the operator's own edits save — never the initial defaults (which would
  // overwrite a persona instruction typed in the clipping-flow inspector).
  const postCaptionDirtyRef = useRef(false);
  useEffect(() => {
    if (!postCaptionRestoredRef.current || !postCaptionDirtyRef.current || !sessionId) return;
    const prompt = postCaptionPrompt.trim();
    const row = captionStyleSkillRowRef.current;
    const saved = readPostCaptionSettings(row?.config);
    if ((saved.prompt ?? "") === prompt && saved.mood === postCaptionMood && saved.language === postCaptionLanguage) return;
    const t = setTimeout(async () => {
      try {
        if (!row) {
          await upsertSkillFile({
            sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.captionstyle",
            title: "Smart Captions", markdown: "# Smart Captions\n\nPost caption settings saved from the video editor.",
          });
        }
        const prevCfg = (row?.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>;
        const descriptionPrompt = composePostCaptionInstruction({ prompt, mood: postCaptionMood, language: postCaptionLanguage });
        await setSkillConfig({
          sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.captionstyle",
          config: {
            ...prevCfg,
            [POST_CAPTION_CONFIG_KEYS.prompt]: prompt,
            [POST_CAPTION_CONFIG_KEYS.mood]: postCaptionMood,
            [POST_CAPTION_CONFIG_KEYS.language]: postCaptionLanguage,
            // Publish instruction (what /api/social/post + run-task read). Written
            // whenever the operator has a brief; with an empty brief the previous
            // persona instruction is left untouched.
            ...(prompt ? { descriptionPrompt } : {}),
          },
        });
      } catch (e) {
        console.warn("[editor] post-caption settings save failed:", e instanceof Error ? e.message : e);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [postCaptionPrompt, postCaptionMood, postCaptionLanguage, sessionId, mintAddress, upsertSkillFile, setSkillConfig]);

  // Persist toolbar controls even before Apply. Per-clip choices already live
  // in timeline/overlays; these global prompt/language/duration controls need
  // their own draft payload so closing or refreshing the Editor loses nothing.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        const current = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as EditorDraft;
        const toolbar: EditorToolbarDraft = {
          velloWatermark,
          hookDuration, hookAlwaysOn, hookPosition, hookPrompt, hookLanguage,
          postCaptionPrompt, postCaptionMood, postCaptionLanguage,
        };
        window.localStorage.setItem(storageKey, JSON.stringify({ ...current, toolbar }));
      } catch { /* quota / corrupt legacy state */ }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [storageKey, hookDuration, hookAlwaysOn, hookPosition, hookPrompt, hookLanguage, postCaptionPrompt, postCaptionMood, postCaptionLanguage, velloWatermark]);

  // Real transcript for the selected source (when it went through the clip
  // pipeline, joined by sourceUrl — the SAME join the Downloads tab uses) —
  // fed to the hook generator as `content` so the line actually matches what
  // the video is about, not a generic guess.
  const clipJobsForMint = useQuery(api.clipJobs.listJobsByMint, mintAddress ? { mintAddress } : "skip") as
    Doc<"clipJobs">[] | undefined;
  const selectedTranscript = useMemo(() => {
    if (!selected || !/^https?:\/\//i.test(selected.title)) return "";
    return (clipJobsForMint ?? []).find((j) => j.sourceUrl === selected.title)?.transcript ?? "";
  }, [clipJobsForMint, selected]);
  // Content grounding for an item that ISN'T a raw downloaded source (the
  // common case: a real rendered CLIP, a Videos-tab generation, a clip pushed
  // in from the influencer sidebar) — the transcript join above only matches
  // when `selected.title` IS the source URL, which is true for a downloaded
  // source but NOT for an actual clip. A clip's `title` is its own generated
  // caption/topic though (e.g. "How to Sue Anyone for…"), so it's a real
  // content signal in its own right — use it whenever it isn't itself a URL.
  const selectedContent = useMemo(() => {
    if (selectedTranscript) return selectedTranscript;
    if (selected?.title && !/^https?:\/\//i.test(selected.title)) return selected.title;
    return "";
  }, [selected, selectedTranscript]);

  // Silent fetch (no component state touched) — reused by requestHook (the
  // Text Hooks panel's UI-facing generator). Returns the hook string, or
  // null on any failure.
  const fetchHookText = useCallback(async (promptText: string, content: string): Promise<{ hook: string | null; error?: string }> => {
    try {
      const res = await fetch("/api/agents/hook/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ prompt: promptText, content, language: hookLanguage }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; hook?: string; error?: string };
      if (!res.ok || !j.ok || !j.hook) {
        const raw = j.error ?? `Request failed (HTTP ${res.status})`;
        const providerError = /\b(?:kie|gemini|claude)\b|channel is not supported|api[_ ]?key|HTTP\s*\d{3}/i.test(raw);
        return { hook: null, error: providerError ? "Hook generation is temporarily unavailable. Please try again." : raw };
      }
      return { hook: j.hook };
    } catch (e) {
      return { hook: null, error: e instanceof Error ? e.message : "Failed to generate a hook" };
    }
  }, [hookLanguage, accessToken]);

  // Shared by the explicit "Generate hook line" button AND applyHookDesign's
  // auto-generate-on-first-apply path — one place sends language + content,
  // so both call sites stay in sync (a prior version duplicated this fetch
  // and only ONE branch would have gotten a fix). Returns the hook string, or
  // null on failure (error already written to hookGenError).
  const requestHook = useCallback(async (promptText: string): Promise<string | null> => {
    setHookGenerating(true);
    setHookGenError(null);
    const { hook, error } = await fetchHookText(promptText, selectedContent);
    setHookGenerating(false);
    if (!hook) {
      setHookGenError(error ?? "Failed to generate a hook");
      return null;
    }
    setGeneratedHook(hook);
    return hook;
  }, [fetchHookText, selectedContent]);

  const generateHook = useCallback(async () => {
    const prompt = hookPrompt.trim();
    if (!prompt) return;
    await requestHook(prompt);
  }, [hookPrompt, requestHook]);

  const saveHookAgentStyle = useCallback(async ({
    designId,
    text,
    position,
    durationSec,
    fontScale = 1,
    yPct,
    alwaysOn,
  }: {
    designId: string;
    text?: string;
    position: Overlay["position"];
    durationSec: number;
    fontScale?: number;
    yPct?: number;
    alwaysOn?: boolean;
  }) => {
    if (!sessionId) return;
    setHookStyleSaved("saving");
    try {
      const design = HOOK_DESIGN_BY_ID[designId];
      const fontSize = Math.round((design?.render.fontSize ?? 64) * fontScale);
      if (!hookSkillRow) {
        await upsertSkillFile({
          sessionId,
          ...(mintAddress ? { mintAddress } : {}),
          skillId: "clip.hook",
          title: "Auto Hook",
          markdown: "# Auto Hook\n\nSaved hook style from the video editor.",
        });
      }
      const prevCfg = (hookSkillRow?.config && typeof hookSkillRow.config === "object" ? hookSkillRow.config : {}) as Record<string, unknown>;
      const prevCustom = (prevCfg.hookCustomDesign && typeof prevCfg.hookCustomDesign === "object" ? prevCfg.hookCustomDesign : {}) as Record<string, unknown>;
      await setSkillConfig({
        sessionId,
        ...(mintAddress ? { mintAddress } : {}),
        skillId: "clip.hook",
        config: {
          ...prevCfg,
          hookTemplateId: designId,
          hookCustomDesign: { ...prevCustom, fontSize, ...(typeof yPct === "number" ? { yPct } : {}) },
          hookPosition: position,
          hookDurationSec: Math.max(HOOK_DURATION_MIN, Math.min(HOOK_DURATION_MAX, durationSec)),
          ...(typeof alwaysOn === "boolean" ? { hookAlwaysOn: alwaysOn } : {}),
          ...(text?.trim() ? { lastHookText: text.trim() } : {}),
          ...(hookPrompt.trim() ? { hookPrompt: hookPrompt.trim() } : {}),
          hookLanguage,
          disabled: false,
        },
      });
      setHookStyleSaved("saved");
      setTimeout(() => setHookStyleSaved("idle"), 2500);
    } catch {
      setHookStyleSaved("error");
      setTimeout(() => setHookStyleSaved("idle"), 2500);
    }
  }, [sessionId, mintAddress, hookSkillRow, upsertSkillFile, setSkillConfig, hookPrompt, hookLanguage]);

  // Dragging or resizing is itself the user's explicit choice. Persist it after
  // a short quiet period so the next generated clip inherits exactly what the
  // preview shows without requiring a separate "save style" click.
  const selectedHookForPersistence = selectedOverlays.find((o) => o.hookDesignId);
  const autoSavedHookSignatureRef = useRef("");
  useEffect(() => {
    const hook = selectedHookForPersistence;
    if (!hook?.hookDesignId || !sessionId) return;
    const signature = JSON.stringify([
      hook.itemId, hook.hookDesignId, hook.text, hook.position, hook.startSec,
      hook.endSec, hook.hookFontScale ?? 1, overlayYPct(hook),
    ]);
    if (autoSavedHookSignatureRef.current === signature) return;
    const timer = window.setTimeout(() => {
      autoSavedHookSignatureRef.current = signature;
      void saveHookAgentStyle({
        designId: hook.hookDesignId!,
        text: hook.text,
        position: hook.position,
        durationSec: hook.endSec - hook.startSec,
        fontScale: hook.hookFontScale ?? 1,
        yPct: overlayYPct(hook),
        alwaysOn: hookAlwaysOn,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    selectedHookForPersistence,
    sessionId,
    saveHookAgentStyle,
    hookAlwaysOn,
  ]);

  /** Generates a social-post caption and writes it straight onto the selected
   *  clip's `postCaption` field — same "generate → persists onto the clip"
   *  shape as the hook/caption tools, so it's picked up automatically the next
   *  time Apply opens the Post modal for this clip. */
  const generatePostCaptionForSelected = useCallback(async () => {
    const prompt = postCaptionPrompt.trim();
    if (!prompt || !selected) return;
    setPostCaptionGenerating(true);
    setPostCaptionGenError(null);
    try {
      const res = await fetch("/api/agents/post-caption/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ prompt, mood: postCaptionMood, language: postCaptionLanguage, basis: selectedContent }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; caption?: string; error?: string };
      if (!res.ok || !j.ok || !j.caption) {
        const raw = j.error ?? `Request failed (HTTP ${res.status})`;
        const providerError = /\b(?:kie|gemini|claude)\b|channel is not supported|api[_ ]?key|HTTP\s*\d{3}/i.test(raw);
        throw new Error(providerError ? "Caption generation is temporarily unavailable. Please try again." : raw);
      }
      setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, postCaption: j.caption } : t)));
    } catch (e) {
      setPostCaptionGenError(e instanceof Error ? e.message : "Failed to generate a caption");
    } finally {
      setPostCaptionGenerating(false);
    }
  }, [postCaptionPrompt, postCaptionMood, postCaptionLanguage, selected, selectedContent, accessToken]);

  const applyHookDesign = useCallback(async (designId: string) => {
    if (!selected) return;
    // No pinned line yet but the operator typed a brief → auto-generate the
    // hook first so the burn is always a REAL hook line, never the raw brief
    // (the brief is an instruction — "make it sarcastic, add emoji" — and used
    // to be shown/burned literally when Generate wasn't clicked first).
    let text = generatedHook.trim();
    if (!text && hookPrompt.trim()) {
      text = (await requestHook(hookPrompt.trim())) ?? "";
    }
    setOverlays((prev) => prev.filter((o) => !(o.itemId === selected.id && o.hookDesignId)));
    const clipLen = Math.max(0.1, selected.trimOut - selected.trimIn);
    addTextOverlay(text || "WAIT FOR IT", {
      hookDesignId: designId,
      endSec: hookAlwaysOn ? clipLen : Math.min(hookDuration, clipLen),
      position: hookPosition,
    });
    void saveHookAgentStyle({
      designId,
      text: text || "WAIT FOR IT",
      position: hookPosition,
      durationSec: Math.min(hookDuration, clipLen),
      alwaysOn: hookAlwaysOn,
    });
  }, [selected, addTextOverlay, hookDuration, hookAlwaysOn, hookPosition, generatedHook, hookPrompt, requestHook, saveHookAgentStyle]);
  const clearHookDesign = useCallback(() => {
    if (!selected) return;
    setOverlays((prev) => prev.filter((o) => !(o.itemId === selected.id && o.hookDesignId)));
  }, [selected]);
  const changeHookDuration = useCallback((seconds: number) => {
    setHookDuration(seconds);
    if (!selected || hookAlwaysOn) return;
    const maxDuration = Math.max(0.1, selected.trimOut - selected.trimIn);
    setOverlays((prev) => prev.map((o) => o.itemId === selected.id && o.hookDesignId
      ? { ...o, endSec: Math.min(seconds, maxDuration) }
      : o));
  }, [selected, hookAlwaysOn]);
  /** "Always on" toggle: stretch the clip's hook overlay to the whole clip, or
   *  snap it back to the chosen duration. */
  const changeHookAlwaysOn = useCallback((on: boolean) => {
    setHookAlwaysOn(on);
    if (!selected) return;
    const maxDuration = Math.max(0.1, selected.trimOut - selected.trimIn);
    setOverlays((prev) => prev.map((o) => o.itemId === selected.id && o.hookDesignId
      ? { ...o, startSec: 0, endSec: on ? maxDuration : Math.min(hookDuration, maxDuration) }
      : o));
  }, [selected, hookDuration]);
  const changeHookPosition = useCallback((position: Overlay["position"]) => {
    setHookPosition(position);
    if (!selected) return;
    setOverlays((prev) => prev.map((o) => o.itemId === selected.id && o.hookDesignId
      ? { ...o, position, oy: undefined }
      : o));
  }, [selected]);

  // ── Music drawer (right-side panel) — the SAME track catalog + folder
  //    grouping as the Clipping tab's Trending Audio node-inspector picker.
  //    One track per clip (replaces); a shared preview <audio> lets you
  //    audition a track before applying it. ─────────────────────────────
  const [musicPanelOpen, setMusicPanelOpen] = useState(false);
  // Fetched from the server (not imported directly) — trendingAudioPack.ts
  // resolves each track's URL via process.env, which is only reliable in a
  // Node runtime. A "use client" component importing it directly gets "" for
  // every url (no real `process` global in the browser), which is why music
  // wasn't playing. /api/media/trending-audio resolves server-side instead.
  const [audioTracks, setAudioTracks] = useState<TrendingAudioEntry[]>([]);
  useEffect(() => {
    fetch("/api/media/trending-audio")
      .then((r) => r.json())
      .then((j: { ok?: boolean; tracks?: TrendingAudioEntry[] }) => { if (j.ok && j.tracks) setAudioTracks(j.tracks); })
      .catch(() => {});
  }, []);
  const audioGroups = useMemo(() => groupTrendingAudio(audioTracks), [audioTracks]);
  const [musicPreviewId, setMusicPreviewId] = useState<string | null>(null);
  const musicPreviewRef = useRef<HTMLAudioElement>(null);
  const toggleMusicPreview = useCallback((id: string, url: string) => {
    const a = musicPreviewRef.current;
    if (!a) return;
    if (musicPreviewId === id) { a.pause(); setMusicPreviewId(null); return; }
    a.src = url;
    a.play().catch(() => {});
    setMusicPreviewId(id);
  }, [musicPreviewId]);
  const applyMusicTrack = useCallback((trackId: string) => {
    if (!selected) return;
    musicPreviewRef.current?.pause();
    setMusicPreviewId(null);
    // Picking a track explicitly is the opposite intent of "auto-select" —
    // turn it off so the operator's manual pick actually wins at burn time.
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, musicTrackId: trackId, autoMusic: false, musicCustomUrl: undefined, musicCustomLabel: undefined } : t)));
  }, [selected]);
  const clearMusicTrack = useCallback(() => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, musicTrackId: undefined, musicCustomUrl: undefined, musicCustomLabel: undefined } : t)));
  }, [selected]);
  const toggleAutoMusic = useCallback((on: boolean) => {
    if (!selected) return;
    // Same mutual-exclusivity as the track picker, mirrored: turning auto ON
    // clears any explicit pick (they'd otherwise silently fight — the burn
    // route's fallback only auto-picks when NO trackId is present at all).
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, autoMusic: on, ...(on ? { musicTrackId: undefined, musicCustomUrl: undefined, musicCustomLabel: undefined } : {}) } : t)));
  }, [selected]);
  const setMusicVolume = useCallback((pct: number) => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, musicVolumePct: pct } : t)));
  }, [selected]);
  // Operator's OWN tracks — uploaded to R2 via /api/media/upload, remembered
  // per agent in the clip.trendingaudio config (`customTracks`) so the list
  // survives reloads and shows on every clip. Selecting one sets
  // musicCustomUrl on the clip (burn: music.customUrl wins over the pack).
  type CustomTrack = { id: string; label: string; url: string };
  // Server list is the default; a local edit (upload/remove) overrides until
  // the persisted row catches up. Derived — no restore effect.
  const customTracksServer = useMemo<CustomTrack[]>(() => {
    const cfg = (musicSkillRow?.config && typeof musicSkillRow.config === "object" ? musicSkillRow.config : {}) as Record<string, unknown>;
    const raw = Array.isArray(cfg.customTracks) ? cfg.customTracks : [];
    return raw.filter((t): t is CustomTrack => !!t && typeof t === "object" && typeof (t as CustomTrack).url === "string" && typeof (t as CustomTrack).id === "string")
      .map((t) => ({ id: t.id, url: t.url, label: typeof t.label === "string" && t.label ? t.label : "My track" }));
  }, [musicSkillRow]);
  const [customTracksOverride, setCustomTracks] = useState<CustomTrack[] | null>(null);
  const customTracks = customTracksOverride ?? customTracksServer;
  const [musicUploading, setMusicUploading] = useState(false);
  const [musicUploadError, setMusicUploadError] = useState<string | null>(null);
  const musicFileInputRef = useRef<HTMLInputElement>(null);
  const saveCustomTracks = useCallback(async (list: CustomTrack[]) => {
    if (!sessionId) return;
    try {
      if (!musicSkillRow) {
        await upsertSkillFile({
          sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.trendingaudio",
          title: "Trending Audio", markdown: "# Trending Audio\n\nSaved music choice from the video editor.",
        });
      }
      const prev = (musicSkillRow?.config && typeof musicSkillRow.config === "object" ? musicSkillRow.config : {}) as Record<string, unknown>;
      await setSkillConfig({ sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.trendingaudio", config: { ...prev, customTracks: list } });
    } catch (e) {
      console.warn("[editor] custom tracks save failed:", e instanceof Error ? e.message : e);
    }
  }, [sessionId, mintAddress, musicSkillRow, upsertSkillFile, setSkillConfig]);
  const applyCustomTrack = useCallback((track: CustomTrack) => {
    if (!selected) return;
    musicPreviewRef.current?.pause();
    setMusicPreviewId(null);
    setTimeline((prev) => prev.map((t) => (t.id === selected.id
      ? { ...t, musicCustomUrl: track.url, musicCustomLabel: track.label, musicTrackId: undefined, autoMusic: false }
      : t)));
  }, [selected]);
  const handleMusicUpload = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setMusicUploading(true);
    setMusicUploadError(null);
    try {
      const j = await uploadMediaFile(file, { accessToken });
      const track: CustomTrack = { id: uid(), label: file.name.replace(/\.[a-z0-9]+$/i, ""), url: j.url };
      const next = [track, ...customTracks].slice(0, 40);
      setCustomTracks(next);
      void saveCustomTracks(next);
      applyCustomTrack(track);
    } catch (e) {
      setMusicUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setMusicUploading(false);
      if (musicFileInputRef.current) musicFileInputRef.current.value = "";
    }
  }, [accessToken, customTracks, saveCustomTracks, applyCustomTrack]);
  const removeCustomTrack = useCallback((id: string) => {
    const next = customTracks.filter((t) => t.id !== id);
    setCustomTracks(next);
    void saveCustomTracks(next);
  }, [customTracks, saveCustomTracks]);
  const selectedMusicTrack = selected?.musicCustomUrl
    ? { id: "custom", label: selected.musicCustomLabel ?? "My track", url: selected.musicCustomUrl }
    : selected?.musicTrackId ? audioTracks.find((t) => t.id === selected.musicTrackId) : undefined;

  // ── Sound Effect drawer — pick a PACK (Gen Z Meme / Cinematic Impact /
  //    Cartoon Comedy); the AI auto-decides WHETHER a sting fires and WHICH
  //    one (shock/funny/hype) from a keyword in the clip's own transcript
  //    (see lib/server/reactionSfxPack pickSfxFromKeywords) — same "AI
  //    decides when, operator picks the sound" split the Music drawer's
  //    Auto-pick / Trending Audio picker uses. Same server-resolved-URL
  //    reasoning as audioTracks above (client can't resolve process.env). ──
  const [sfxPanelOpen, setSfxPanelOpen] = useState(false);
  const [sfxSounds, setSfxSounds] = useState<ReactionSfxEntry[]>([]);
  const [sfxPacks, setSfxPacks] = useState<ReactionSfxPack[]>([]);
  useEffect(() => {
    fetch("/api/media/reaction-sfx")
      .then((r) => r.json())
      .then((j: { ok?: boolean; sounds?: ReactionSfxEntry[]; packs?: ReactionSfxPack[] }) => {
        if (j.ok) { setSfxSounds(j.sounds ?? []); setSfxPacks(j.packs ?? []); }
      })
      .catch(() => {});
  }, []);
  const sfxUrlById = useMemo(() => new Map(sfxSounds.map((s) => [s.id, s.url])), [sfxSounds]);
  const [sfxPreviewId, setSfxPreviewId] = useState<string | null>(null);
  const sfxPreviewRef = useRef<HTMLAudioElement>(null);
  const toggleSfxPreview = useCallback((id: string, url: string) => {
    const a = sfxPreviewRef.current;
    if (!a || !url) return;
    if (sfxPreviewId === id) { a.pause(); setSfxPreviewId(null); return; }
    a.src = url;
    a.play().catch(() => {});
    setSfxPreviewId(id);
  }, [sfxPreviewId]);
  const applySfxPack = useCallback((packId: string) => {
    if (!selected) return;
    sfxPreviewRef.current?.pause();
    setSfxPreviewId(null);
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, sfxPackId: packId } : t)));
  }, [selected]);
  const clearSfxPack = useCallback(() => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, sfxPackId: undefined } : t)));
  }, [selected]);
  const selectedSfxPack = selected?.sfxPackId ? sfxPacks.find((p) => p.id === selected.sfxPackId) : undefined;

  // ── Specials drawer — two independent toggles, both keyed off the clip's
  //    OWN transcript at burn time (server-side, /api/video/overlay-burn):
  //    Zoom Punch (pickZoomPunchTimes, lib/server/captionRenderer.ts) punches
  //    in wherever a keyword/emphasis word lands, reusing the SAME keyword
  //    signal captions' Keyword Pop + the Sound Effect tool already trigger
  //    on; Filler Cut's random mode (computeRandomJumpCuts,
  //    lib/server/jumpCuts.ts) removes a few random TIME-based micro-windows
  //    — no transcript needed, a fresh pattern every burn so re-applying the
  //    same clip looks genuinely different instead of identical. ───────────
  const [specialsPanelOpen, setSpecialsPanelOpen] = useState(false);
  const toggleZoomPunch = useCallback((on: boolean) => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, zoomPunchOn: on } : t)));
  }, [selected]);
  const toggleJumpCuts = useCallback((on: boolean) => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, jumpCutsOn: on } : t)));
  }, [selected]);
  const toggleMultiScene = useCallback((on: boolean) => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, multiSceneOn: on } : t)));
  }, [selected]);
  const setReferenceImage = useCallback((url: string | undefined) => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, referenceImageUrl: url } : t)));
  }, [selected]);

  // ── Intro & CTA drawer — these selections are forwarded to the current
  //    clipping pipeline as Hook Videos (prepend) + Video CTA (append). They are
  //    intentionally configuration-only here: the next Clip run applies them to
  //    every output instead of running a separate one-clip burn workflow.
  const [introCtaPanelOpen, setIntroCtaPanelOpen] = useState(false);
  const [introUploading, setIntroUploading] = useState(false);
  const [ctaUploading, setCtaUploading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  // Real-time Apply result modal (single-clip "Apply" only — "Apply to all"
  // persists settings for every future clip silently, no per-clip popup).
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyModalPhase, setApplyModalPhase] = useState<"burning" | "ready" | "error">("burning");
  const [applyModalVideoUrl, setApplyModalVideoUrl] = useState<string | undefined>();
  const [applyModalError, setApplyModalError] = useState<string | undefined>();
  const [applyModalWarning, setApplyModalWarning] = useState<string | undefined>();
  const [applyModalCaption, setApplyModalCaption] = useState("");

  // Intro / CTA / stitched videos → R2 (streamed), never Convex storage.
  const uploadSingleVideo = useCallback(async (file: File): Promise<string | null> => {
    try { return (await uploadMediaFile(file, { accessToken })).url; } catch { return null; }
  }, [accessToken]);

  const setIntroVideo = useCallback(async (file: File) => {
    if (!selected) return;
    setIntroUploading(true);
    try {
      const url = await uploadSingleVideo(file);
      if (url) setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, introUrl: url } : t)));
    } finally {
      setIntroUploading(false);
    }
  }, [selected, uploadSingleVideo]);

  const setCtaVideo = useCallback(async (file: File) => {
    if (!selected) return;
    setCtaUploading(true);
    try {
      const url = await uploadSingleVideo(file);
      if (url) setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, ctaUrl: url } : t)));
    } finally {
      setCtaUploading(false);
    }
  }, [selected, uploadSingleVideo]);

  const clearIntroVideo = useCallback(() => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, introUrl: undefined } : t)));
  }, [selected]);
  const clearCtaVideo = useCallback(() => {
    if (!selected) return;
    setTimeline((prev) => prev.map((t) => (t.id === selected.id ? { ...t, ctaUrl: undefined } : t)));
  }, [selected]);

  // ── Real Apply / Apply to all clips (AI-influencer editor) ──────────────────
  // Burns whatever's actually configured for a clip — caption preset, hook
  // design (text/position/font-size, including any drag/slider adjustment),
  // and music track — into the video for real, via the SAME ffmpeg endpoint
  // (/api/video/overlay-burn) the generation-time pipeline uses. Always
  // re-burns from `sourceUrl` (the pre-burn original), same convention as
  // the editor's original source convention, so re-applying after a tweak never
  // chains onto an already-rendered result.
  const applyClipOverlays = useCallback(async (
    itemId: string,
    // Explicit override for "Apply to all clips": the copy step's new state
    // hasn't committed/re-rendered yet when the burn loop runs immediately
    // after, so it passes the freshly-cloned overlays/music directly instead
    // of relying on this callback's (stale, pre-copy) closed-over state.
    override?: { overlaysForItem: Overlay[]; musicTrackId?: string; musicCustomUrl?: string; autoMusic?: boolean; musicVolumePct?: number; sfxPackId?: string; zoomPunchOn?: boolean; jumpCutsOn?: boolean },
  ): Promise<{ ok: boolean; url?: string; error?: string; warning?: string }> => {
    const item = timeline.find((t) => t.id === itemId);
    if (!item) return { ok: false, error: "Clip not found" };
    const base = item.sourceUrl ?? item.url;
    if (!base) return { ok: false, error: "Clip has no source video" };
    const itemOverlays = override?.overlaysForItem ?? overlays.filter((o) => o.itemId === itemId);
    const musicTrackId = override ? override.musicTrackId : item.musicTrackId;
    const musicCustomUrl = override ? override.musicCustomUrl : item.musicCustomUrl;
    const autoMusicOn = override ? override.autoMusic : item.autoMusic;
    const musicVolumePct = override ? override.musicVolumePct : item.musicVolumePct;
    const sfxPackId = override ? override.sfxPackId : item.sfxPackId;
    const zoomPunchOn = override ? override.zoomPunchOn : item.zoomPunchOn;
    const jumpCutsOn = override ? override.jumpCutsOn : item.jumpCutsOn;
    const hookOv = itemOverlays.find((o) => o.hookDesignId);
    const hookDesign = hookOv?.hookDesignId ? HOOK_DESIGN_BY_ID[hookOv.hookDesignId] : undefined;
    const captionOv = itemOverlays.find((o) => o.presetId);

    const hookText = hookOv && hookDesign ? {
      text: hookDesign.render.allCaps ? hookOv.text.toUpperCase() : hookOv.text,
      position: hookOv.position,
      yPct: overlayYPct(hookOv),
      fontColor: hookDesign.render.fontColor,
      fontSize: Math.round(hookDesign.render.fontSize * (hookOv.hookFontScale ?? 1)),
      font: hookDesign.render.font,
      outlineColor: hookDesign.render.outlineColor,
      outlineWidth: hookDesign.render.outlineWidth,
      boxColor: hookDesign.render.boxColor,
      hookLayout: hookDesign.render.layout,
      hookAccentColor: hookDesign.render.accentColor,
      ...(hookDesign.render.motion ? { hookMotion: hookDesign.render.motion } : {}),
      durationSeconds: Math.max(1, Math.min(15, hookOv.endSec - hookOv.startSec)),
      // Always on → overlay-burn holds the hook to the end of the video.
      ...(hookAlwaysOn ? { alwaysOn: true } : {}),
    } : undefined;
    const captions = captionOv ? {
      preset: captionOv.presetId,
      position: captionOv.position,
      yPct: overlayYPct(captionOv),
      languageCode: captionOv.captionLanguageCode || undefined,
      subtitleLanguageCode: captionOv.captionSubtitleLanguageCode || undefined,
    } : undefined;
    // A track id ALWAYS wins; with none but Auto-select checked, still send a
    // `music` object with just volumePct (no trackId) — the burn route's
    // existing fallback (pickTrendingTrackByMood) auto-picks a mood-matched
    // track whenever trackId is absent, so this is the whole "auto" wiring.
    const music = musicCustomUrl ? { customUrl: musicCustomUrl, volumePct: musicVolumePct }
      : musicTrackId ? { trackId: musicTrackId, volumePct: musicVolumePct }
      : autoMusicOn ? { volumePct: musicVolumePct }
      : undefined;
    // Overlay drawer media (images / videos) → burned exactly where the preview
    // shows them. The preview renders each at 1/3 of the box width (capped at
    // 160px) × its drag-resize scale, so convert that to a % of the canvas.
    const boxW = canvasRef.current?.clientWidth || 315;
    const baseFrac = Math.min(boxW / 3, 160) / boxW;
    const imageOverlays = itemOverlays
      .filter((o) => o.imageUrl || o.videoUrl)
      .map((o) => ({
        url: (o.imageUrl ?? o.videoUrl) as string,
        kind: o.videoUrl ? "video" as const : "image" as const,
        xPct: (o.ox ?? 0.5) * 100,
        yPct: (o.oy ?? (o.position === "top" ? 0.18 : o.position === "bottom" ? 0.82 : 0.5)) * 100,
        widthPct: baseFrac * (o.scale ?? 1) * 100,
        startSec: o.startSec,
        endSec: o.endSec,
      }));
    const sfx = sfxPackId ? { packId: sfxPackId } : undefined;
    // Glass BG travels with the burn too (same toggle the top bar shows in
    // preview) — reuses the exact blur_frame ffmpeg composite server-side.
    const background = glassBgOn ? { style: "blur" as const, aspectRatio } : undefined;
    // Camera tool → the burn crops the SAME shots the preview drew (or
    // letterboxes for Fit). Only when the operator actually picked a mode.
    const framing = item.framingMode
      ? {
          mode: item.framingMode,
          aspectRatio,
          shots: item.framingMode === "full" ? [] : sanitizeShots(item.faceShots ?? []),
          ...(item.framingMode === "dual" && item.dualFaceShots
            ? { dualShots: { top: sanitizeShots(item.dualFaceShots.top), bottom: sanitizeShots(item.dualFaceShots.bottom) } }
            : {}),
          ...(item.framingMode === "zoom"
            ? { zoomAmount: item.zoomAmount ?? FACE_CROP_MIN_ZOOM }
            : item.framingMode !== "full"
              ? { zoomAmount: item.faceZoomHint ?? MODE_TARGET_ZOOM[item.framingMode] }
              : {}),
        }
      : undefined;
    const specials = { velloWatermark, ...(zoomPunchOn ? { zoomPunch: true } : {}), ...(jumpCutsOn ? { jumpCuts: true } : {}) };
    const imageOverlay = item.referenceImageUrl ? { url: item.referenceImageUrl } : undefined;
    const filter = item.filterPreset || item.filterSaturation !== undefined || item.filterBrightness !== undefined
      ? {
          ...(item.filterPreset ? { preset: item.filterPreset } : {}),
          saturation: item.filterSaturation ?? 1,
          brightness: item.filterBrightness ?? 0,
        }
      : undefined;

    if (!hookText && !captions && !music && !sfx && !background && !specials && !imageOverlay && imageOverlays.length === 0 && !framing && !filter) {
      return { ok: false, error: "Nothing to burn — pick a caption, text hook, filter, camera mode, or audio setting first." };
    }

    setApplyingId(itemId);
    setApplyError(null);
    try {
      const res = await fetch("/api/video/overlay-burn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // aspectRatio always rides along: without Glass BG / Camera the burn used to
        // keep the source's own shape, not the aspect the preview shows.
        body: JSON.stringify({ videoUrl: base, hookText, captions, music, filter, sfx, background, specials, imageOverlay, framing, imageOverlays, aspectRatio }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; videoUrl?: string; error?: string; warning?: string };
      if (!res.ok || !data.ok || !data.videoUrl) throw new Error(data.error ?? "Apply failed");
      setTimeline((prev) => prev.map((t) => (t.id === itemId
        ? { ...t, url: data.videoUrl!, sourceUrl: base, ...(hookText ? { hookBurned: true } : {}) }
        : t)));
      // The hook is now baked into the new pixels — drop any "let me edit it
      // again" override so the canvas preview stops double-drawing it.
      if (hookText) setHookEditOverrideIds((prev) => { if (!prev.has(itemId)) return prev; const next = new Set(prev); next.delete(itemId); return next; });
      // This clip came from a real Videos-tab generation (agentTasks row) —
      // patch its stored videoUrl so the Marketplace/profile page actually
      // serves the burned result instead of the pre-burn original. Best-effort:
      // the burn itself already succeeded, so a write-back failure here
      // shouldn't be reported as an Apply failure.
      if (item.taskId) {
        void updateTaskVideoUrl({ id: item.taskId as Id<"agentTasks">, videoUrl: data.videoUrl }).catch(() => {});
      }
      // A requested-but-unresolved music track (env misconfig, dead track URL) is
      // a soft failure — the burn still succeeded, so surface it as a warning the
      // operator can actually see instead of a video that's quietly missing audio.
      if (data.warning) setApplyError(data.warning);
      return { ok: true, url: data.videoUrl, warning: data.warning };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to apply, the render service didn't respond";
      setApplyError(msg);
      return { ok: false, error: msg };
    } finally {
      setApplyingId((cur) => (cur === itemId ? null : cur));
    }
  }, [timeline, overlays, glassBgOn, aspectRatio, updateTaskVideoUrl, velloWatermark]);

  // Persists whatever hook/caption style is on the SELECTED clip as the
  // agent's ongoing default (clip.hook / clip.captions skill config —
  // resolveVideoDirectives bridges these into every future generated video).
  // Fired automatically from Apply/Apply-to-all so "click apply" really does
  // mean "use these settings on every video from now on", not just this one.
  // Best-effort: the burn itself already succeeded by the time this runs, so
  // a save failure here is swallowed rather than surfaced as an Apply error.
  const persistAgentDefaults = useCallback(async () => {
    if (!sessionId) return;
    const hookOv = selectedOverlays.find((o) => o.hookDesignId);
    const captionOv = selectedOverlays.find((o) => o.presetId);
    try {
      if (hookOv?.hookDesignId) {
        const design = HOOK_DESIGN_BY_ID[hookOv.hookDesignId];
        const fontSize = Math.round((design?.render.fontSize ?? 64) * (hookOv.hookFontScale ?? 1));
        const yPct = overlayYPct(hookOv);
        if (!hookSkillRow) {
          await upsertSkillFile({
            sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.hook",
            title: "Auto Hook", markdown: "# Auto Hook\n\nSaved hook style from the video editor.",
          });
        }
        const prevCfg = (hookSkillRow?.config && typeof hookSkillRow.config === "object" ? hookSkillRow.config : {}) as Record<string, unknown>;
        const prevCustom = (prevCfg.hookCustomDesign && typeof prevCfg.hookCustomDesign === "object" ? prevCfg.hookCustomDesign : {}) as Record<string, unknown>;
        await setSkillConfig({
          sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.hook",
          config: {
            ...prevCfg,
            hookTemplateId: hookOv.hookDesignId,
            hookCustomDesign: { ...prevCustom, fontSize, yPct },
            // The literal wording, not just the look — so opening the NEXT clip
            // in the editor starts with something typed already (editable, not
            // forced) instead of an empty hook field every single time.
            ...(hookOv.text.trim() ? { lastHookText: hookOv.text } : {}),
            hookPosition: hookOv.position,
            hookDurationSec: Math.max(HOOK_DURATION_MIN, Math.min(HOOK_DURATION_MAX, hookOv.endSec - hookOv.startSec)),
            hookAlwaysOn,
            // The "What kind of hook?" brief + Language dropdown were LOCAL
            // state only — lost on every remount and never reached
            // resolveVideoDirectives, so auto-generated videos' hooks never
            // used the operator's saved brief/language. Persisted here (and
            // resolveVideoDirectives now reads them — see videoDirector.ts)
            // so "click apply once" really does apply to every future video.
            ...(hookPrompt.trim() ? { hookPrompt: hookPrompt.trim() } : {}),
            hookLanguage,
            // Re-picking a design lifts a previous "no text hooks" off-switch.
            disabled: false,
          },
        });
      }
      if (captionOv?.presetId) {
        if (!capsSkillRow) {
          await upsertSkillFile({
            sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.captions",
            title: "Captions", markdown: "# Captions\n\nSaved caption style from the video editor.",
          });
        }
        const prevCapsCfg = (capsSkillRow?.config && typeof capsSkillRow.config === "object" ? capsSkillRow.config : {}) as Record<string, unknown>;
        await setSkillConfig({
          sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.captions",
          config: {
            ...prevCapsCfg, captionPreset: captionOv.presetId, disabled: false,
            captionAlign: captionOv.position, captionYPct: overlayYPct(captionOv),
            captionLanguageCode: captionOv.captionLanguageCode ?? "",
            subtitleLanguageCode: captionOv.captionSubtitleLanguageCode ?? "",
          },
        });
      }
      // Background music — a track pick OR the "Auto-select best song" toggle
      // both count as an explicit choice worth carrying forward; an untouched
      // clip (neither set) leaves the agent's existing default alone.
      if (selected?.musicTrackId || selected?.autoMusic || selected?.musicCustomUrl) {
        if (!musicSkillRow) {
          await upsertSkillFile({
            sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.trendingaudio",
            title: "Trending Audio", markdown: "# Trending Audio\n\nSaved music choice from the video editor.",
          });
        }
        const prevAudioCfg = (musicSkillRow?.config && typeof musicSkillRow.config === "object" ? musicSkillRow.config : {}) as Record<string, unknown>;
        // A track id always wins and clears autoMusic (mutually exclusive in
        // the UI too, see the musicTrackId field comment). Convex mutation
        // args reject an explicit `undefined` value, so the stale key is
        // OMITTED (not set to undefined) when the pick is now Auto-select —
        // otherwise a previously-saved track id would silently outlive the
        // toggle and keep winning downstream in resolveVideoDirectives.
        const { musicTrackId: _staleTrackId, customAudioUrl: _staleCustom, ...prevAudioCfgWithoutTrack } = prevAudioCfg;
        await setSkillConfig({
          sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.trendingaudio",
          config: {
            ...prevAudioCfgWithoutTrack,
            ...(selected.musicTrackId ? { musicTrackId: selected.musicTrackId } : {}),
            // resolveVideoDirectives reads `customAudioUrl` → overlay-burn music.customUrl.
            ...(selected.musicCustomUrl ? { customAudioUrl: selected.musicCustomUrl } : {}),
            autoMusic: !selected.musicTrackId && !selected.musicCustomUrl && !!selected.autoMusic,
            ...(typeof selected.musicVolumePct === "number" ? { musicVolumePct: selected.musicVolumePct } : {}),
          },
        });
      }
      if (filterSkillRow || selected?.filterPreset || selected?.filterSaturation !== undefined || selected?.filterBrightness !== undefined) {
        if (!filterSkillRow) {
          await upsertSkillFile({
            sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.filters",
            title: "Video Filters", markdown: "# Video Filters\n\nSaved enhancement settings from the video editor.",
          });
        }
        const prevFilterCfg = (filterSkillRow?.config && typeof filterSkillRow.config === "object" ? filterSkillRow.config : {}) as Record<string, unknown>;
        const { filterPreset: _oldPreset, filterSaturation: _oldSat, filterBrightness: _oldBri, ...filterCfgWithoutOldLook } = prevFilterCfg;
        await setSkillConfig({
          sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: "clip.filters",
          config: {
            ...filterCfgWithoutOldLook,
            ...(selected.filterPreset ? { filterPreset: selected.filterPreset } : {}),
            filterSaturation: selected.filterSaturation ?? 1,
            filterBrightness: selected.filterBrightness ?? 0,
          },
        });
      }
    } catch {
      // best-effort, see comment above
    }
  }, [sessionId, mintAddress, selected, selectedOverlays, hookSkillRow, capsSkillRow, musicSkillRow, filterSkillRow, upsertSkillFile, setSkillConfig, hookPrompt, hookLanguage]);

  /** "Apply" for the currently selected clip only. */
  const applySelectedClip = useCallback(async () => {
    if (!selectedId) return;
    const item = timeline.find((t) => t.id === selectedId);
    // Dynamic caption prefill: whatever this clip is already titled/captioned
    // as (a real generation's script.caption/topic, or the clip's own name) —
    // the operator can freely edit it before posting.
    setApplyModalCaption(item?.postCaption?.trim() || item?.title || "");
    setApplyModalVideoUrl(undefined);
    setApplyModalError(undefined);
    setApplyModalWarning(undefined);
    setApplyModalPhase("burning");
    setApplyModalOpen(true);
    const result = await applyClipOverlays(selectedId);
    if (result.ok && result.url) {
      void persistAgentDefaults();
      setApplyModalVideoUrl(result.url);
      setApplyModalWarning(result.warning);
      setApplyModalPhase("ready");
    } else {
      setApplyModalError(result.error ?? "Apply failed");
      setApplyModalPhase("error");
    }
  }, [selectedId, timeline, applyClipOverlays, persistAgentDefaults]);

  // ── Overlay drawer (right-side panel, renamed from "Upload") — a gallery of
  //    previously uploaded IMAGES + upload-new, staying open so several can be
  //    added in a row. Selecting one drops it as an image overlay on the canvas
  //    (additive — logos/stickers commonly stack, unlike captions/hooks). ────
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false);
  const addMediaOverlay = useCallback((url: string, kind: "image" | "video") => {
    if (!selected) return;
    const dur = Math.max(0.1, selected.trimOut - selected.trimIn);
    setOverlays((prev) => [...prev, {
      id: uid(), itemId: selected.id, text: "", startSec: 0, endSec: dur, position: "center",
      ox: 0.5, oy: 0.5, scale: 1,
      ...(kind === "image" ? { imageUrl: url } : { videoUrl: url }),
    }]);
  }, [selected]);
  const updateOverlayGeometry = useCallback((id: string, patch: { ox?: number; oy?: number; scale?: number; hookFontScale?: number }) => {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  // ── Apply to all clips — pushes the SELECTED clip's caption preset, hook
  //    design, media overlays, and music track onto every OTHER clip in the
  //    timeline. Each target clip's existing overlay of the same kind (caption
  //    preset / hook design / media) is replaced wholesale, same as picking
  //    that style directly on that clip — this is not additive stacking.
  //    Nothing here reaches outside the editor's own timeline: clips not yet
  //    dragged in from the left rail are untouched until added.
  const applyToAllClips = useCallback(() => {
    if (!selected || timeline.length <= 1) return;
    const sourceId = selected.id;
    const sourceOverlays = overlays.filter((o) => o.itemId === sourceId);
    const sourceMusicTrackId = selected.musicTrackId;
    const sourceMusicCustomUrl = selected.musicCustomUrl;
    const sourceMusicCustomLabel = selected.musicCustomLabel;
    const sourceAutoMusic = selected.autoMusic;
    const sourceMusicVolumePct = selected.musicVolumePct;
    const sourceSfxPackId = selected.sfxPackId;
    const sourceIntroUrl = selected.introUrl;
    const sourceCtaUrl = selected.ctaUrl;
    const sourceZoomPunchOn = selected.zoomPunchOn;
    const sourceJumpCutsOn = selected.jumpCutsOn;
    const sourceMultiSceneOn = selected.multiSceneOn;
    const sourceFilterPreset = selected.filterPreset;
    const sourceFilterSaturation = selected.filterSaturation;
    const sourceFilterBrightness = selected.filterBrightness;
    setOverlays((prev) => {
      const kept = prev.filter((o) => o.itemId === sourceId || !sourceOverlays.some((s) =>
        (s.presetId && o.presetId) || (s.hookDesignId && o.hookDesignId) || ((s.imageUrl || s.videoUrl) && (o.imageUrl || o.videoUrl))
      ));
      const cloned: Overlay[] = [];
      for (const item of timeline) {
        if (item.id === sourceId) continue;
        for (const src of sourceOverlays) {
          cloned.push(cloneOverlayForItem(src, item));
        }
      }
      return [...kept, ...cloned];
    });
    // Intro/CTA config copies with the other visual choices. A later clipping
    // run forwards the selected values to every newly generated clip.
    setTimeline((prev) => prev.map((t) => (t.id === sourceId ? t : {
      ...t, musicTrackId: sourceMusicTrackId, musicCustomUrl: sourceMusicCustomUrl, musicCustomLabel: sourceMusicCustomLabel, autoMusic: sourceAutoMusic, musicVolumePct: sourceMusicVolumePct,
      sfxPackId: sourceSfxPackId, introUrl: sourceIntroUrl, ctaUrl: sourceCtaUrl,
      zoomPunchOn: sourceZoomPunchOn, jumpCutsOn: sourceJumpCutsOn, multiSceneOn: sourceMultiSceneOn,
      filterPreset: sourceFilterPreset, filterSaturation: sourceFilterSaturation, filterBrightness: sourceFilterBrightness,
    })));
  }, [selected, overlays, timeline]);

  /** "Apply to all clips" (AI-influencer Editor, clipLabel="Apply"): burns
   *  ONLY the currently selected clip, then persists its caption/hook/music
   *  config as the agent's STANDING DEFAULT so every FUTURE generated video
   *  picks it up automatically (persistAgentDefaults — the same clip.hook /
   *  clip.captions / clip.trendingaudio bridge resolveVideoDirectives reads).
   *
   *  Previously this looped over every OTHER clip already in the timeline
   *  and re-burned each one with the source clip's settings — including
   *  clips that are PAST, already-posted videos pulled in from the Videos
   *  tab sidebar for reference/editing. That silently rewrote (and
   *  overwrote the stored URL of, via applyClipOverlays' updateTaskVideoUrl
   *  patch) content that had nothing to do with what the operator was
   *  currently working on. "Apply to all" now means "apply to this video,
   *  and to all FUTURE ones" — it never touches a clip other than the one
   *  selected. */
  const applyAllClips = useCallback(async () => {
    if (!selected) return;
    setApplyingAll(true);
    setApplyError(null);
    try {
      await applyClipOverlays(selected.id);
      void persistAgentDefaults();
    } finally {
      setApplyingAll(false);
    }
  }, [selected, applyClipOverlays, persistAgentDefaults]);
  // Drag-to-move / drag-to-resize for image/video overlays — plain pointer-event
  // dragging against the canvas's own bounding rect (fractional 0..1 coords, so
  // it stays correct across aspect ratios and resizes).
  const startMediaDrag = useCallback((e: React.PointerEvent, o: Overlay) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX, startY = e.clientY;
    const startOx = o.ox ?? 0.5, startOy = o.oy ?? 0.5;
    const onMove = (ev: PointerEvent) => {
      updateOverlayGeometry(o.id, {
        ox: Math.min(1, Math.max(0, startOx + (ev.clientX - startX) / rect.width)),
        oy: Math.min(1, Math.max(0, startOy + (ev.clientY - startY) / rect.height)),
      });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [updateOverlayGeometry]);
  // Vertical-only drag for a hook-text overlay — full-width text, so only `oy`
  // (drag-to-position in the preview) is meaningful; x stays centered.
  const startHookDrag = useCallback((e: React.PointerEvent, o: Overlay) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startY = e.clientY;
    const startOy = o.oy ?? (o.position === "top" ? 0.12 : o.position === "bottom" ? 0.86 : 0.5);
    const onMove = (ev: PointerEvent) => {
      updateOverlayGeometry(o.id, { oy: Math.min(0.95, Math.max(0.05, startOy + (ev.clientY - startY) / rect.height)) });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [updateOverlayGeometry]);
  const startMediaResize = useCallback((e: React.PointerEvent, o: Overlay) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startScale = o.scale ?? 1;
    const onMove = (ev: PointerEvent) => {
      updateOverlayGeometry(o.id, { scale: Math.max(0.1, startScale + ((ev.clientX - startX) / rect.width) * 2.2) });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [updateOverlayGeometry]);
  // Drag-to-resize the HOOK TEXT itself — same bottom-right-handle convention
  // as the media overlay's resize handle above, but scales `hookFontScale`
  // (the burned text's actual font size, see the Text Hooks drawer's own
  // font-size slider) instead of an image's `scale`. Live in the preview via
  // the same `updateOverlayGeometry` state update the drag-to-move handler
  // uses, so it reads as one smooth, real-time, dynamic control — no "commit"
  // step, the burned size on Apply is exactly whatever's shown while dragging.
  const startHookResize = useCallback((e: React.PointerEvent, o: Overlay) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startScale = o.hookFontScale ?? 1;
    const onMove = (ev: PointerEvent) => {
      // Same 0.5-2.2x band the drawer's own font-size slider (50-220%) allows.
      const next = Math.max(0.5, Math.min(2.2, startScale + ((ev.clientX - startX) / rect.width) * 2.2));
      updateOverlayGeometry(o.id, { hookFontScale: next });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [updateOverlayGeometry]);

  // ── Camera Settings drawer — the SAME framing modes the real Smart Framing
  //    skill (clip.facetrack) offers. Face detection itself runs server-side
  //    (Gemini vision) in the actual clip render, so it can't run live in a
  //    browser preview — but "Zoom" and "Fit (safe)" ARE real, reproducible
  //    visual effects, applied here as honest CSS, not a fake claim. ────────
  const [cameraPanelOpen, setCameraPanelOpen] = useState(false);
  const CAMERA_MODES: { id: NonNullable<TimelineItem["framingMode"]>; name: string; blurb: string }[] = [
    { id: "auto", name: "Auto", blurb: "Decides per shot: one face → face crop, two that fit → frame both, too far apart → pan between them. Eased cuts." },
    { id: "zoom", name: "Face Crop", blurb: "Track the main face with adjustable tightness. If tracking is lost, show the whole frame." },
    { id: "pan", name: "Pan both", blurb: "Two people: a slow eased camera move from one head to the other and back." },
    { id: "dual", name: "Dual (top / bottom)", blurb: "Two people: crop both faces at once, one above the other. Collapses to one pane when only one face is visible." },
    { id: "full", name: "No Crop (Fit)", blurb: "Shows the whole shot, nothing is ever cut off — the frame is fit into the canvas instead of cropped." },
  ];
  const [faceDetecting, setFaceDetecting] = useState(false);
  const [faceDetectError, setFaceDetectError] = useState<string | null>(null);
  // Camera geometry the planner frames for: the clip's real pixel size and the
  // output aspect (Auto's "do both heads fit in one pane" depends on it).
  const cameraGeometry = useCallback((aspect: AspectRatio = aspectRatio): CameraGeometry => {
    const v = videoRef.current;
    const [aw, ah] = aspect.split(":").map(Number);
    return { srcW: v?.videoWidth || 1920, srcH: v?.videoHeight || 1080, outW: aw * 120, outH: ah * 120 };
  }, [aspectRatio]);

  /** Re-plan one item's camera from its stored scan — the /dev/face-detect
   *  algorithm (lib/builder/faceShots.buildCameraPlan). Cheap (no network), so
   *  a mode/aspect change applies to the preview immediately. */
  const replanCamera = useCallback((t: TimelineItem, mode: NonNullable<TimelineItem["framingMode"]>, samples: SamplePoint[], geom: CameraGeometry = cameraGeometry()): TimelineItem => {
    if (mode === "full") return { ...t, framingMode: mode };
    const plan = buildCameraPlan(samples, mode, geom, mode === "zoom" ? (t.zoomAmount ?? FACE_CROP_MIN_ZOOM) : undefined);
    const dualFaceShots = mode === "dual" ? buildDualShotPlan(samples) : t.dualFaceShots;
    const primary = plan.shots.find((sh) => sh.confident);
    return { ...t, framingMode: mode, faceSamples: samples, faceShots: plan.shots, dualFaceShots, faceZoomHint: plan.zoomHint, faceMotionScore: plan.motionScore, faceCx: primary?.cx, faceCy: primary?.cy };
  }, [cameraGeometry]);

  const setZoomAmount = useCallback((amount: number) => {
    if (!selected) return;
    const itemId = selected.id;
    setTimeline((prev) => prev.map((t) => {
      if (t.id !== itemId) return t;
      const next = { ...t, zoomAmount: amount };
      return next.faceSamples ? replanCamera(next, "zoom", next.faceSamples) : next;
    }));
  }, [selected, replanCamera]);

  const setFramingMode = useCallback(async (mode: TimelineItem["framingMode"]) => {
    if (!selected || !mode) return;
    const itemId = selected.id;
    // Already scanned → re-plan locally and apply straight away.
    if (mode === "full" || selected.faceSamples) {
      const samples = selected.faceSamples ?? [];
      setTimeline((prev) => prev.map((t) => (t.id === itemId ? replanCamera(t, mode, samples) : t)));
      return;
    }
    setTimeline((prev) => prev.map((t) => (t.id === itemId ? { ...t, framingMode: mode } : t)));
    setFaceDetecting(true);
    setFaceDetectError(null);
    try {
      const durationS = Math.max(0.5, Math.min(FACE_SCAN_MAX_S, selected.duration > 0 ? selected.duration : 20));
      const res = await fetch("/api/video/detect-face-track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        // Scan the downloaded asset the operator is actually previewing. The
        // sourceUrl can be the original YouTube/Drive page, not a video file.
        body: JSON.stringify({ videoUrl: selected.url, durationS }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; points?: SamplePoint[] };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `Detection failed (HTTP ${res.status})`);
      const points = Array.isArray(j.points) ? j.points : [];
      const faceMaxCount = points.reduce((m, p) => Math.max(m, p.faceCount ?? 0), 0);
      let anyConfident = false;
      setTimeline((prev) => prev.map((t) => {
        if (t.id !== itemId) return t;
        // Plan for whatever mode the operator is on NOW (they may have switched
        // while the scan ran), not the one that started it.
        const planned = replanCamera({ ...t, faceMaxCount }, t.framingMode ?? mode, points);
        anyConfident = (planned.faceShots ?? []).some((sh) => sh.confident);
        return planned;
      }));
      if (!anyConfident && points.some((p) => p.found) === false) setFaceDetectError("No face found, showing the full frame instead.");
    } catch (e) {
      // An unavailable tracker must never silently revert to the legacy
      // centre crop, which can render an empty 9:16 frame from a 16:9 source.
      setTimeline((prev) => prev.map((t) => t.id === itemId ? {
        ...t,
        faceShots: [{ startT: 0, endT: Math.max(1, t.duration || 20), cx: 0.5, cy: 0.5, confident: false }],
      } : t));
      setFaceDetectError(`${e instanceof Error ? e.message : "Face detection failed"}. Showing the full frame instead.`);
    } finally {
      setFaceDetecting(false);
    }
  }, [selected, accessToken, replanCamera]);

  // Auto camera by default. "Auto" is what the drawer shows as selected, but the
  // face scan used to run only when a mode button was CLICKED — so a clip nobody
  // touched had no faceShots and stayed on a dead-centre CSS crop (preview) and
  // an un-framed burn (export): a left/right 2-guest podcast lost both faces.
  // Now, once a clip's metadata is known, the Auto scan runs for portrait
  // sources too: a same-aspect video may have its speaker at the edge. Once
  // per clip (tracked in a ref) so a failed/no-face scan can't loop.
  const [metaReadyId, setMetaReadyId] = useState<string | null>(null);
  const autoScannedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selected || metaReadyId !== selected.id || faceDetecting || glassBgOn) return;
    if (selected.faceSamples || selected.framingMode === "full" || autoScannedRef.current.has(selected.id)) return;
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    autoScannedRef.current.add(selected.id);
    void setFramingMode(selected.framingMode ?? "auto");
  }, [selected, metaReadyId, faceDetecting, glassBgOn, setFramingMode]);

  // Output aspect changed → Auto's frame-both decision changes → re-plan every
  // scanned clip so preview and export stay in step.
  const changeAspectRatio = useCallback((a: AspectRatio) => {
    setAspectRatio(a);
    const geom = cameraGeometry(a);
    setTimeline((prev) => prev.map((t) => (t.faceSamples && t.framingMode && t.framingMode !== "full" ? replanCamera(t, t.framingMode, t.faceSamples, geom) : t)));
  }, [cameraGeometry, replanCamera]);

  const applyStyle = useCallback((style: (typeof STYLE_PRESETS)[number]) => {
    if (!selected) return;
    applyCaptionPreset(style.captionPresetId);
    void setFramingMode(style.cameraMode);
  }, [selected, applyCaptionPreset, setFramingMode]);

  // ── Shot-tracked preview (same renderer as /dev/face-detect): a <canvas>
  //    over the <video>, redrawn every animation frame via drawImage() with the
  //    current shot's crop — NOT a CSS transform on the <video> (Chromium's
  //    video compositor was observed painting black frames when a <video> is
  //    transformed/resized; drawImage reads straight from the decoder). Active
  //    only once a scan exists and the mode crops; Fit / Glass BG keep the
  //    plain <video>. ─────────────────────────────────────────────────────
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const shotFramingActive = !!selected && !!selected.faceShots && selected.faceShots.length > 0
    && (selected.framingMode ?? "auto") !== "full" && !glassBgOn;
  const shotFitActiveRef = useRef(false);
  const shotFitPendingWantRef = useRef(false);
  const shotFitPendingSinceRef = useRef(0);
  useEffect(() => {
    const canvas = frameCanvasRef.current;
    if (!shotFramingActive || !canvas || !selected) return;
    const shots = selected.faceShots ?? [];
    const mode = selected.framingMode ?? "auto";
    const targetZoom = mode === "zoom"
      ? (selected.zoomAmount ?? FACE_CROP_MIN_ZOOM)
      : (selected.faceZoomHint ?? MODE_TARGET_ZOOM[mode]);
    const maxZoom = Math.max(MODE_MAX_ZOOM[mode], targetZoom);
    let raf = 0;
    const drawSoftFill = (ctx: CanvasRenderingContext2D, v: HTMLVideoElement, sourceW: number, sourceH: number, width: number, height: number) => {
      const scale = Math.max(width / sourceW, height / sourceH);
      const drawnW = sourceW * scale, drawnH = sourceH * scale;
      ctx.save();
      ctx.filter = "blur(28px) brightness(0.72)";
      ctx.drawImage(v, 0, 0, sourceW, sourceH, (width - drawnW) / 2 - 24, (height - drawnH) / 2 - 24, drawnW + 48, drawnH + 48);
      ctx.restore();
    };
    const tick = () => {
      const v = videoRef.current;
      const box = canvasRef.current;
      if (v && box) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const boxW = box.clientWidth, boxH = box.clientHeight;
        const destW = Math.round(boxW * dpr), destH = Math.round(boxH * dpr);
        if (canvas.width !== destW) canvas.width = destW;
        if (canvas.height !== destH) canvas.height = destH;
        const naturalW = v.videoWidth, naturalH = v.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx && naturalW > 0 && naturalH > 0 && v.readyState >= 2 && destW > 0 && destH > 0) {
          const shot = shotAt(shots, v.currentTime);
          const confident = !!shot?.confident;
          // Lost tracking must fit immediately: even 350 ms of a blind crop is
          // enough to show an empty frame. Debounce only the return to crop.
          const now = performance.now();
          const wantFit = !confident;
          if (wantFit !== shotFitPendingWantRef.current) { shotFitPendingWantRef.current = wantFit; shotFitPendingSinceRef.current = now; }
          if (wantFit || mode === "zoom") shotFitActiveRef.current = wantFit;
          else if (shotFitActiveRef.current && now - shotFitPendingSinceRef.current >= FRAMING_DEBOUNCE_MS) shotFitActiveRef.current = false;
          const dual = selected.dualFaceShots;
          const topShot = mode === "dual" && dual ? shotAt(dual.top, v.currentTime) : undefined;
          const bottomShot = mode === "dual" && dual ? shotAt(dual.bottom, v.currentTime) : undefined;
          const splitActive = !!topShot?.confident && !!bottomShot?.confident;
          if (mode === "dual" && splitActive && topShot && bottomShot) {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, destW, destH);
            const paneH = Math.floor(destH / 2);
            const drawPane = (face: FaceShot, y: number, h: number) => {
              const g = computeFramedGeometry(face.cx, face.cy, naturalW, naturalH, destW, h, MODE_TARGET_ZOOM.dual, MODE_MAX_ZOOM.dual);
              const scale = g.width / naturalW;
              ctx.drawImage(v, -g.left / scale, -g.top / scale, destW / scale, h / scale, 0, y, destW, h);
            };
            drawPane(topShot, 0, paneH);
            drawPane(bottomShot, paneH, destH - paneH);
          } else if (shotFitActiveRef.current) {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, destW, destH);
            if (mode === "zoom") {
              drawSoftFill(ctx, v, naturalW, naturalH, destW, destH);
            }
            const scale = Math.min(destW / naturalW, destH / naturalH);
            const w = naturalW * scale, h = naturalH * scale;
            ctx.drawImage(v, 0, 0, naturalW, naturalH, (destW - w) / 2, (destH - h) / 2, w, h);
          } else {
            // cropAt = eased pans + follow paths, the same math the burn's
            // ffmpeg expression evaluates (faceShots.shotCropExpr).
            const pos = confident && shot ? cropAt(shots, v.currentTime) : { cx: 0.5, cy: 0.5 };
            if (mode === "zoom") {
              const g = computeTrackedFaceGeometry(pos.cx, pos.cy, naturalW, naturalH, destW, destH, targetZoom);
              // The soft extension fills only the area revealed by moving an
              // edge-positioned face to centre; the sharp source is never
              // enlarged beyond the operator's crop-tightness choice.
              drawSoftFill(ctx, v, naturalW, naturalH, destW, destH);
              ctx.drawImage(v, 0, 0, naturalW, naturalH, g.left, g.top, g.width, g.height);
            } else {
              const g = computeFramedGeometry(pos.cx, pos.cy, naturalW, naturalH, destW, destH, targetZoom, maxZoom);
              const scale = g.width / naturalW;
              ctx.drawImage(v, -g.left / scale, -g.top / scale, destW / scale, destH / scale, 0, 0, destW, destH);
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shotFramingActive, selected]);

  // ── B-Roll drawer — stock PHOTO + VIDEO search (Pexels when PEXELS_API_KEY
  //    is set, else Openverse for photos only — see /api/media/stock-photos)
  //    + your own uploaded library. All drop onto the canvas via the SAME
  //    media-overlay mechanism the Overlay drawer uses. Defaults to VIDEO
  //    results, auto-searched from the selected clip's own content, so
  //    opening the drawer shows relevant b-roll immediately instead of an
  //    empty box waiting for a typed query. ─────────────────────────────
  const [brollPanelOpen, setBrollPanelOpen] = useState(false);
  const [brollTab, setBrollTab] = useState<"stock" | "uploads">("stock");
  const [stockKind, setStockKind] = useState<"video" | "photo">("video");
  const [stockQuery, setStockQuery] = useState("");
  const [stockResults, setStockResults] = useState<{ id: string; url: string; thumbnail: string; title: string; kind: "photo" | "video" }[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const searchStock = useCallback(async (queryOverride?: string, kindOverride?: "video" | "photo") => {
    // Accepts an explicit query/kind so the auto-search effect below can
    // pass its guessed query directly instead of relying on stockQuery
    // state (which hasn't committed yet in the same tick) — and syncs the
    // input box to match (queryOverride branch) without setState living
    // inside the effect body itself.
    const q = (queryOverride ?? stockQuery).trim();
    if (!q) return;
    if (queryOverride !== undefined) setStockQuery(queryOverride);
    const kind = kindOverride ?? stockKind;
    setStockLoading(true);
    setStockError(null);
    setStockNotice(null);
    try {
      const res = await fetch(`/api/media/stock-photos?q=${encodeURIComponent(q)}&type=${kind}`);
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; results?: typeof stockResults; error?: string; notice?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `Search failed (HTTP ${res.status})`);
      setStockResults(j.results ?? []);
      if (j.notice) setStockNotice(j.notice);
    } catch (e) {
      setStockError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setStockLoading(false);
    }
  }, [stockQuery, stockKind]);
  // Auto-populate + auto-search from the CLIP's own content the moment the
  // drawer opens (or the selected clip changes) — "by default show stock
  // b-roll related to the video" instead of requiring the operator to type
  // first. Only fires when the operator hasn't already typed something of
  // their own (never stomps a manual query), and only once per clip (the
  // ref guards against re-firing on every keystroke/kind toggle).
  const brollAutoQueriedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!brollPanelOpen || !selected || brollTab !== "stock") return;
    if (brollAutoQueriedFor.current === selected.id) return;
    brollAutoQueriedFor.current = selected.id;
    if (stockQuery.trim()) return; // operator already has their own query — don't override it
    const guess = extractBrollQuery(selectedContent || selected.title);
    if (!guess) return;
    // Deferred a tick so the kickoff isn't a same-frame setState-in-effect
    // (the guess itself is derived synchronously above; only the resulting
    // fetch + its state updates are pushed to the next microtask).
    queueMicrotask(() => { void searchStock(guess, stockKind); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brollPanelOpen, selected?.id, brollTab]);

  // ── Clipping drawer (right-side panel) — configures a REAL run on the
  //    Clipping canvas: source + clip count + genre queue as canvas ops (the
  //    same mechanism the chat copilot uses, `useClippingStore.queueChatOps`),
  //    then `{op:"run"}` auto-starts the pipeline once the Clipping tab mounts
  //    and drains the queue. Only a downloaded VIDEO (Videos tab) can seed a
  //    source — a rendered clip or an uploaded asset has no long-form source
  //    to select moments from.
  const [clippingPanelOpen, setClippingPanelOpen] = useState(false);
  const [clipCount, setClipCount] = useState(5);
  const [clipPrompt, setClipPrompt] = useState("");
  const [clipGenre, setClipGenre] = useState("auto");
  const [clipLengthMin, setClipLengthMin] = useState(20);
  const [clipLengthMax, setClipLengthMax] = useState(45);
  // A downloaded long-form video's title IS its url (Videos tab convention);
  // a produced CLIP's title is a real title, but it still carries its own
  // long-form origin via `sourceUrl` — fall back to that so selecting an
  // already-clipped, already-styled timeline item still resolves back to the
  // real source the header "Clip" button re-clips from.
  const selectedSourceUrl = selected
    ? (/^https?:\/\//i.test(selected.title) ? selected.title : selected.sourceUrl ?? null)
    : null;
  // Known duration for the selected source, when it's been downloaded before
  // (the overwhelming case — a source picked from the Videos tab) — drives
  // the pre-run cost estimate in the Clipping drawer below.
  const selectedSourceDurationSeconds = useMemo(
    () => (videoAssets ?? []).find((d) => d.sourceUrl === selectedSourceUrl)?.durationSeconds,
    [videoAssets, selectedSourceUrl],
  );
  // SAVE, not run: queues the config onto the Clipping canvas (applied the next
  // time it mounts and drains its op queue — see ClippingFlowCanvas's
  // pendingChatOps effect) without navigating away or starting a render. The
  // top-bar "Clip (N clips)" button is the actual run trigger (runClipFromEditor
  // below): it queues just `{op:"run"}`, which drains AFTER these config ops
  // since the queue is FIFO, so the run always sees the saved settings.
  // draftMaxClips updates the top button's count immediately, before the
  // Clipping canvas has necessarily ever mounted to apply set_max_clips for real.
  const saveClipSettings = useCallback(() => {
    if (!selectedSourceUrl) return;
    const prompt = clipPrompt.trim();
    const count = Math.max(1, Math.min(30, clipCount));
    useClippingStore.getState().queueChatOps([
      { op: "set_source", sourceUrl: selectedSourceUrl },
      { op: "set_watermark", enabled: velloWatermark },
      { op: "set_max_clips", count },
      { op: "set_clip_length", min: clipLengthMin, max: clipLengthMax },
      { op: "set_auto_plan", enabled: false },
      { op: "set_genre", genre: clipGenre },
      // Prompt-to-Clip: wires into the clip.prompt skill (adds it if missing) so
      // moment selection is actually steered by the brief, not just count/genre.
      ...(prompt ? [{ op: "set_prompt_to_clip" as const, prompt }] : []),
    ]);
    useClippingStore.getState().setDraftMaxClips(count);
    setClippingPanelOpen(false);
  }, [selectedSourceUrl, clipCount, clipGenre, clipPrompt, clipLengthMin, clipLengthMax, velloWatermark]);

  // ── Cover Image tool (Clipping drawer) — one operator-uploaded image, applied
  //    as the thumbnail/cover for EVERY clip this project posts. Instagram/YouTube
  //    take it as a real custom cover (lib/server/uploadPost.ts cover_url /
  //    thumbnail_url); TikTok has no such field, so its delivered file instead
  //    gets the image burned in as a literal first frame (lib/server/tiktokCoverBurn.ts)
  //    — TikTok's own frame-based cover then lands on it automatically. Persisted
  //    on the `clip.cover` agentSkillFiles row so it auto-saves for every future
  //    clip and run, not just this session (lib/builder/coverImageConfig.ts).
  const [coverImageUrl, setCoverImageUrlState] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const coverRestoredRef = useRef(false);
  useEffect(() => {
    if (coverRestoredRef.current || coverSkillRow === undefined) return;
    coverRestoredRef.current = true;
    const saved = readCoverImageUrl(coverSkillRow?.config);
    if (saved) setCoverImageUrlState(saved);
  }, [coverSkillRow]);
  const coverSkillRowRef = useRef(coverSkillRow);
  useEffect(() => { coverSkillRowRef.current = coverSkillRow; }, [coverSkillRow]);
  const persistCoverImage = useCallback(async (url: string | null) => {
    if (!sessionId) return;
    const row = coverSkillRowRef.current;
    try {
      if (!row) {
        await upsertSkillFile({
          sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: CLIP_COVER_SKILL_ID,
          title: "Cover Image", markdown: "# Cover Image\n\nThumbnail/cover image saved from the video editor.",
        });
      }
      await setSkillConfig({
        sessionId, ...(mintAddress ? { mintAddress } : {}), skillId: CLIP_COVER_SKILL_ID,
        config: withCoverImageUrl(row?.config, url),
      });
    } catch (e) {
      console.warn("[editor] cover image save failed:", e instanceof Error ? e.message : e);
      throw e;
    }
  }, [sessionId, mintAddress, upsertSkillFile, setSkillConfig]);
  const setCoverImage = useCallback(async (file: File) => {
    setCoverUploading(true);
    setCoverError(null);
    try {
      const url = await uploadSingleVideo(file);
      if (!url) throw new Error("Upload failed");
      setCoverImageUrlState(url);
      await persistCoverImage(url);
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setCoverUploading(false);
    }
  }, [uploadSingleVideo, persistCoverImage]);
  const clearCoverImage = useCallback(() => {
    setCoverImageUrlState(null);
    setCoverError(null);
    void persistCoverImage(null);
  }, [persistCoverImage]);

  // ── Right rail ───────────────────────────────────────────────────────────
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  const flashComingSoon = useCallback((label: string) => {
    setComingSoon(label);
    window.setTimeout(() => setComingSoon((cur) => (cur === label ? null : cur)), 1800);
  }, []);
  const triggerUpload = useCallback(() => { fileInputRef.current?.click(); }, []);
  // "AI hook" used to be a separate (coming-soon, disabled) rail entry — removed:
  // Text Hooks IS the AI hook feature (official Gemini first, Kie fallback),
  // a second dead button for the same thing only confused which one actually works.
  const railLabels = ["Clipping", "Caption", "Post Captions", "Text Hooks", "Overlay", "Filters", "Camera", "Presets", "B-Roll", "Music", "Sound Effect", "Specials", "Intro & CTA"] as const;
  const railIcons: Record<(typeof railLabels)[number], typeof Sparkles> = {
    Clipping: Scissors, Caption: Captions, "Post Captions": Send, "Text Hooks": Zap, Overlay: ImagePlus, Filters: Palette, Camera: Focus,
    Presets: Palette, "B-Roll": Clapperboard, Music: Music, "Sound Effect": Volume2, Specials: Sparkles, "Intro & CTA": Film,
  };
  // Only one right-side drawer open at a time — picking a new rail item closes
  // whatever was open first (AnimatePresence exit) before the new one slides in,
  // instead of stacking panels on top of each other.
  const onRailClick = useCallback((label: (typeof railLabels)[number]) => {
    if (COMING_SOON.has(label)) return flashComingSoon(label);
    const openState: Partial<Record<(typeof railLabels)[number], boolean>> = {
      Clipping: clippingPanelOpen, Caption: captionPanelOpen, "Post Captions": postCaptionPanelOpen, "Text Hooks": hookPanelOpen,
      Overlay: overlayPanelOpen, Filters: filterPanelOpen, Presets: stylesPanelOpen, Camera: cameraPanelOpen,
      "B-Roll": brollPanelOpen, Music: musicPanelOpen, "Sound Effect": sfxPanelOpen, Specials: specialsPanelOpen, "Intro & CTA": introCtaPanelOpen,
    };
    const wasOpen = !!openState[label];
    setClippingPanelOpen(false);
    setCaptionPanelOpen(false);
    setPostCaptionPanelOpen(false);
    setHookPanelOpen(false);
    setOverlayPanelOpen(false);
    setFilterPanelOpen(false);
    setStylesPanelOpen(false);
    setCameraPanelOpen(false);
    setBrollPanelOpen(false);
    setMusicPanelOpen(false);
    setSfxPanelOpen(false);
    setSpecialsPanelOpen(false);
    setIntroCtaPanelOpen(false);
    if (wasOpen) return; // it was the one already open, just close it
    if (label === "Clipping") setClippingPanelOpen(true);
    else if (label === "Caption") setCaptionPanelOpen(true);
    else if (label === "Post Captions") setPostCaptionPanelOpen(true);
    else if (label === "Text Hooks") setHookPanelOpen(true);
    else if (label === "Overlay") setOverlayPanelOpen(true);
    else if (label === "Filters") setFilterPanelOpen(true);
    else if (label === "Presets") setStylesPanelOpen(true);
    else if (label === "Camera") setCameraPanelOpen(true);
    else if (label === "B-Roll") setBrollPanelOpen(true);
    else if (label === "Music") setMusicPanelOpen(true);
    else if (label === "Sound Effect") setSfxPanelOpen(true);
    else if (label === "Specials") setSpecialsPanelOpen(true);
    else if (label === "Intro & CTA") setIntroCtaPanelOpen(true);
  }, [flashComingSoon, clippingPanelOpen, captionPanelOpen, postCaptionPanelOpen, hookPanelOpen, overlayPanelOpen, filterPanelOpen, stylesPanelOpen, cameraPanelOpen, brollPanelOpen, musicPanelOpen, sfxPanelOpen, specialsPanelOpen, introCtaPanelOpen]);

  // ── Top-bar "Clip" action — runs the REAL Clipping pipeline using whatever
  //    source/persona/moments are already configured on the Clipping tab's
  //    canvas (the source node's own maxClips), instead of a flat local
  //    concat export. Live-subscribed so the button's count always matches
  //    what's actually set up over there. ───────────────────────────────────
  const clippingSourceNode = useClippingStore((s) => s.nodes.find((n) => n.data.kind === "source"));
  // draftMaxClips (set by saveClipSettings above) wins while it's set — the
  // Clipping canvas may not have mounted yet this session to apply the queued
  // set_source/set_max_clips ops onto a real node, so falling back to the
  // node's config alone would show a stale "Clip (1 clip)" right after Save.
  // It's set alongside set_source in every call site, so its presence also
  // stands in for "a source was just saved" until the canvas catches up.
  const clippingDraftMaxClips = useClippingStore((s) => s.draftMaxClips);
  // Falls back to the Editor's OWN clip-count setting (clipCount, the
  // Clipping drawer's slider — default 5) instead of a hardcoded 1, so a
  // session that never touched the Clipping canvas still shows a sane count.
  const clippingMaxClips = clippingDraftMaxClips ?? (clippingSourceNode?.data.config as { maxClips?: number } | undefined)?.maxClips ?? clipCount;
  // Gated on the Editor's OWN selection (real-time), not stale canvas state —
  // the header button clips whatever's selected right now.
  const clippingHasSource = !!selectedSourceUrl;
  // Runs the REAL Clipping pipeline (same moment-selection algo the Clipping
  // canvas itself uses — this queues onto the exact same store, no
  // duplicated logic) against whatever's selected in the Editor RIGHT NOW,
  // not a stale source saved on a previous canvas visit. The selected clip's
  // own caption style (exactly what's burned in the preview / "Apply") rides
  // along via set_caption_preset, so freshly-clipped output matches instead
  // of coming back in the canvas's last-configured look.
  // "Clip" run progress state (read by the modal below; set by the run callback).
  const [clipRunOpen, setClipRunOpen] = useState(false);
  const [clipRunStartedAt, setClipRunStartedAt] = useState(0);
  const [clipRunTarget, setClipRunTarget] = useState(0);
  const [clipRunSourceUrl, setClipRunSourceUrl] = useState<string | null>(null);
  const [clipRunNow, setClipRunNow] = useState(0);
  const runnerStatus = useClippingStore((s) => s.runStatus);
  const runnerProgress = useClippingStore((s) => s.runProgress);
  const runnerError = useClippingStore((s) => s.runError);
  const runnerJobId = useClippingStore((s) => s.runJobId);
  const runnerMode = useClippingStore((s) => s.runMode);
  const runnerClips = useClippingStore((s) => s.runClips);
  const [clipCreditChecking, setClipCreditChecking] = useState(false);
  const runClipFromEditor = useCallback(async () => {
    if (!selectedSourceUrl || clipCreditChecking) return;
    // Reopen the current monitor, don't leave a second paid run in the FIFO.
    if (useClippingStore.getState().runStatus === "running" && clipRunStartedAt) {
      setClipRunOpen(true);
      return;
    }
    // Credit gate BEFORE queuing any work: a run is priced by the source's
    // length, so an under-funded agent sees exactly what's missing here instead
    // of a monitor full of failed clips. Unknown length (rare — downloads carry
    // it) falls through to the canvas precheck, which still blocks unfunded runs.
    if (mintAddress && selectedSourceDurationSeconds != null && selectedSourceDurationSeconds > 0) {
      setCreditNotice(null);
      setClipCreditChecking(true);
      const blocked = await checkCreditsFor(selectedSourceDurationSeconds, "clip").finally(() => setClipCreditChecking(false));
      if (blocked) { setCreditNotice(blocked); return; }
    }
    useClippingStore.setState({ runError: null, runJobId: null, runMode: null, runClips: [], runProgress: null });
    // Same value the button label shows (draft → canvas source node → local slider).
    // This used to skip the node's maxClips, so after a remount the local default
    // (5) overwrote a 15 set on the canvas: "Clip (15 clips)" produced 5.
    const count = Math.max(1, Math.min(30, clippingMaxClips));
    const captionOv = selectedOverlays.find((o) => o.presetId);
    const hookOv = selectedOverlays.find((o) => o.hookDesignId);
    const hookDesign = hookOv?.hookDesignId ? HOOK_DESIGN_BY_ID[hookOv.hookDesignId] : undefined;
    const prompt = clipPrompt.trim();
    // The Editor is the single source of truth for what gets burned into the
    // clipped output. Every effect it owns is either set explicitly from the
    // selected clip's tool state or REMOVED from the Clipping graph — a Zoom
    // Punch / Keyword Pop / Meme node left over from a template or an earlier
    // canvas session used to keep firing even with the matching Editor toggle
    // off. `set_editor_skill` force-adds past the canvas's one-skill-per-category
    // rule (Zoom Punch + a Filter share a category), so a switched-ON toggle can
    // never be silently rejected either.
    type EditorSkillOp =
      | { op: "set_editor_skill"; skillId: string; config: Record<string, unknown> }
      | { op: "remove_skill"; skillId: string };
    const editorSkill = (skillId: string, config: Record<string, unknown> | null): EditorSkillOp =>
      config ? { op: "set_editor_skill", skillId, config } : { op: "remove_skill", skillId };
    const musicOn = !!(selected?.musicCustomUrl || selected?.musicTrackId || selected?.autoMusic);
    const volumePct = Math.max(1, Math.min(100, Math.round(selected?.musicVolumePct ?? 20)));
    const hasFilter = !!selected && (!!selected.filterPreset || selected.filterSaturation !== undefined || selected.filterBrightness !== undefined);
    const editorSkillOps: EditorSkillOp[] = [
      // Effects the Editor has no control for — never let the canvas sneak them in.
      ...["clip.keywords", "clip.meme", "clip.sticker", "clip.title", "clip.brainrot", "clip.speed", "clip.style.*"]
        .map((skillId) => editorSkill(skillId, null)),
      // Specials · Zoom Punch — ON only when switched on for this clip.
      editorSkill("clip.zoom", selected?.zoomPunchOn === true ? { zoomStyle: "punch" } : null),
      // Specials · Filler Cut · Random — force-set clip.fillercut in "random"
      // mode (pure TIME-based micro-cuts) when the toggle is on, and force-
      // REMOVE it when off. (Previously this only ever handled the OFF case —
      // `[]` on true meant switching the toggle ON did nothing at all, so no
      // clip ever actually got the random cuts.)
      editorSkill("clip.fillercut", selected?.jumpCutsOn === true ? { fillerCutMode: "random" } : null),
      // Specials · Multi Clips — force a few randomly-framed crop windows
      // across the clip (see clipRender.ts) instead of one fixed framing.
      editorSkill("clip.multiscene", selected?.multiSceneOn === true ? {} : null),
      editorSkill("clip.facetrack", selected?.framingMode ? { framingMode: selected.framingMode } : null),
      editorSkill("clip.hook", hookOv && hookDesign ? {
        hookTemplateId: hookOv.hookDesignId,
        hookDurationSec: Math.max(HOOK_DURATION_MIN, Math.min(HOOK_DURATION_MAX, hookOv.endSec - hookOv.startSec)),
        ...(hookAlwaysOn ? { hookAlwaysOn: true } : {}),
        hookPosition: hookOv.position,
        hookPrompt: hookPrompt.trim(),
        hookCustomDesign: {
          ...hookDesign.render,
          fontSize: Math.round(hookDesign.render.fontSize * (hookOv.hookFontScale ?? 1)),
          // Exact spot the hook sits on in the preview (center, % from top).
          yPct: overlayYPct(hookOv),
        },
      } : null),
      // Exact spot the caption sits on in the preview (block centre, % from top) —
      // always sent, so an undragged caption also burns on the band it's shown on.
      editorSkill("clip.captions", captionOv?.presetId ? { captionPreset: captionOv.presetId, captionAlign: captionOv.position, captionYPct: overlayYPct(captionOv) } : null),
      editorSkill("clip.filters", hasFilter ? {
        ...(selected?.filterPreset ? { filterPreset: selected.filterPreset } : {}),
        filterSaturation: selected?.filterSaturation ?? 1,
        filterBrightness: selected?.filterBrightness ?? 0,
      } : null),
      editorSkill("clip.trendingaudio", musicOn ? {
        ...(selected?.musicCustomUrl ? { customAudioUrl: selected.musicCustomUrl } : {}),
        ...(selected?.musicTrackId && !selected.musicCustomUrl ? { musicTrackId: selected.musicTrackId } : {}),
        autoMusic: !selected?.musicCustomUrl && !selected?.musicTrackId,
        // Same quadratic taper overlay-burn uses for the Editor's volume slider.
        gainDb: Math.round(20 * Math.log10((volumePct * volumePct) / 100 / 100) * 10) / 10,
      } : null),
      editorSkill("clip.memeaudio", selected?.sfxPackId ? { sfxPackId: selected.sfxPackId } : null),
      editorSkill("clip.overlayimage", selected?.referenceImageUrl
        ? { overlayImageUrl: selected.referenceImageUrl, overlayMode: "overlay", overlayPosition: "bottom" }
        : null),
      // Intro & CTA use the exact same apps and renderer as the Clipping canvas.
      // A single selected upload becomes a one-item pool, so every clip in this
      // run receives the same intro and the same ending without a second burn.
      editorSkill("clip.hookvideos", selected?.introUrl ? { videoUrls: [selected.introUrl] } : null),
      editorSkill("clip.cta", selected?.ctaUrl ? { ctaUrl: selected.ctaUrl } : null),
    ];
    useClippingStore.getState().queueChatOps([
      { op: "set_source", sourceUrl: selectedSourceUrl },
      { op: "set_watermark", enabled: velloWatermark },
      { op: "set_max_clips", count },
      { op: "set_clip_length", min: clipLengthMin, max: clipLengthMax },
      { op: "set_auto_plan", enabled: false },
      // The Editor's aspect picker drives the output canvas — the run used to
      // follow the canvas Aspect Crop node (default 9:16) whatever was picked here.
      { op: "set_aspect", ratio: aspectRatio },
      ...editorSkillOps,
      // Genre + Prompt-to-Clip travel with the run too — whatever's set in the
      // Clipping drawer right now (no separate Save click required), so "best
      // moments" is actually steered by the operator's own brief/genre instead
      // of the canvas's generic default every time the header button is used.
      { op: "set_genre", genre: clipGenre },
      ...(prompt ? [{ op: "set_prompt_to_clip" as const, prompt }] : []),
      { op: "run" },
    ]);
    useClippingStore.getState().setDraftMaxClips(count);
    onRunClipping?.();
    const startedAt = Date.now();
    setClipRunStartedAt(startedAt);
    setClipRunTarget(count);
    setClipRunSourceUrl(selectedSourceUrl);
    setClipRunNow(startedAt);
    setClipRunOpen(true);
  }, [
    selectedSourceUrl,
    clipCreditChecking,
    mintAddress,
    selectedSourceDurationSeconds,
    checkCreditsFor,
    velloWatermark,
    clippingMaxClips,
    clipLengthMin,
    clipLengthMax,
    clipRunStartedAt,
    aspectRatio,
    clipGenre,
    clipPrompt,
    selectedOverlays,
    selected,
    hookPrompt,
    onRunClipping,
    setClipRunNow,
    setClipRunOpen,
    setClipRunSourceUrl,
    setClipRunStartedAt,
    setClipRunTarget,
  ]);

  // ── "Clip" button live monitor — bind to the actual job created after this
  // click, then to its real clip rows. Before the server has selected moments,
  // the model still renders every requested slot as "planning" so 15 requested
  // clips never look like an empty, stuck popup.
  const clipsForMint = useQuery(api.clipJobs.listClipsByMint, mintAddress ? { mintAddress } : "skip") as
    Doc<"clips">[] | undefined;
  const cloudClipJob = useMemo(
    () => runnerMode === "local" ? null : findEditorClipRun((clipJobsForMint ?? []) as unknown as ClipRunJob[], clipRunStartedAt, clipRunSourceUrl, runnerJobId),
    [clipJobsForMint, clipRunStartedAt, clipRunSourceUrl, runnerJobId, runnerMode],
  );
  const kickoffTimedOut = !cloudClipJob && !runnerProgress && clipRunNow - clipRunStartedAt > 60_000;
  const monitorError = runnerError || (kickoffTimedOut ? "The clipping runner did not start. Close this panel and try again." : null);
  // Whole-run cost estimate for the modal — priced by SOURCE LENGTH, not clip
  // count (OpusClip-style; the real charge is convex/clipJobs.ts's identical
  // formula, applied once the source is actually downloaded). `videoAssets`
  // (downloadCache) already carries durationSeconds for any source the
  // operator has previously downloaded/previewed here, which covers the
  // overwhelming case — a source just picked from the Videos tab. undefined
  // (not 0) when unknown so the UI omits the estimate rather than showing a
  // misleading "~2 credits" for an unmeasured source.
  const clipRunSourceDurationSeconds = useMemo(
    () => (videoAssets ?? []).find((d) => d.sourceUrl === clipRunSourceUrl)?.durationSeconds,
    [videoAssets, clipRunSourceUrl],
  );
  const clipRunTotalCredits = clipRunSourceDurationSeconds != null
    ? estimateClipRunCredits(clipRunSourceDurationSeconds)
    : undefined;
  // Local runs create persisted job rows after rendering. Show their live
  // runner state now, including preflight failures, instead of waiting for rows.
  const editorClipJob = useMemo<ClipRunJob | null>(() => cloudClipJob ?? (clipRunStartedAt ? {
    _id: "editor-local", sourceUrl: clipRunSourceUrl || "", createdAt: clipRunStartedAt, updatedAt: clipRunNow,
    status: monitorError ? "error" : runnerStatus === "done" ? "completed" : runnerClips.length ? "clipping" : "queued",
    progressNote: monitorError || runnerProgress?.label || "Opening the clipping runner…",
    ...(monitorError ? { error: monitorError } : {}),
  } : null), [cloudClipJob, clipRunStartedAt, clipRunSourceUrl, clipRunNow, monitorError, runnerStatus, runnerClips.length, runnerProgress]);
  const clipRunProgress = useMemo(
    () => {
      const progress = buildClipRunProgress({
      startedAt: clipRunStartedAt,
      now: clipRunNow,
      target: clipRunTarget,
      job: editorClipJob,
      clips: cloudClipJob ? (clipsForMint ?? []) : runnerClips.map((clip, index) => ({
        _id: clip.id, jobId: "editor-local", title: clip.title, status: clip.status, failReason: clip.failReason, createdAt: index,
      })),
      });
      return !cloudClipJob && runnerProgress && !progress.isComplete
        ? { ...progress, progressPct: Math.min(99, Math.max(1, runnerProgress.pct)) }
        : progress;
    },
    [clipRunStartedAt, clipRunNow, clipRunTarget, editorClipJob, clipsForMint, cloudClipJob, runnerClips, runnerProgress],
  );
  const selectedFilterChip = FILTER_CHIPS.find((chip) => chip.id === (selected?.filterPreset ?? ""));
  const selectedVideoFilter = [
    selectedFilterChip?.css.filter && selectedFilterChip.css.filter !== "none" ? String(selectedFilterChip.css.filter) : "",
    selected?.filterSaturation !== undefined ? `saturate(${selected.filterSaturation})` : "",
    selected?.filterBrightness !== undefined ? `brightness(${Math.max(0.5, 1 + selected.filterBrightness)})` : "",
  ].filter(Boolean).join(" ") || "none";
  useEffect(() => {
    if (!clipRunOpen || clipRunProgress.isComplete) return;
    const timer = window.setInterval(() => setClipRunNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [clipRunOpen, clipRunProgress.isComplete]);

  // Any right-side tool drawer open — a portrait (9:16) preview sits centered
  // and narrow, so a w-80/w-[26rem] drawer sliding in from the right can cover
  // part of it; nudging the canvas left while a drawer is open (and springing
  // it back on close) keeps the preview visible without the operator having to
  // close the panel just to see the frame.
  const anyPanelOpen = captionPanelOpen || postCaptionPanelOpen || hookPanelOpen || overlayPanelOpen
    || stylesPanelOpen || filterPanelOpen || cameraPanelOpen || brollPanelOpen || musicPanelOpen || sfxPanelOpen
    || specialsPanelOpen || introCtaPanelOpen || clippingPanelOpen;

  if (!mintAddress && !sessionId) return null;

  return (
    <div className="absolute inset-0 flex text-zinc-100" style={{
      fontFamily: "var(--font-geist-sans, system-ui)",
      background:
        "radial-gradient(120% 90% at 12% -10%, rgba(255,255,255,0.05), transparent 55%), " +
        "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.035), transparent 55%), " +
        "#050506",
    }}>
      <input ref={fileInputRef} type="file" accept="video/*,image/*" multiple hidden
        onChange={(e) => handleUpload(e.target.files)} />

      {/* Credit notification — floats over the whole editor so a blocked
          download OR a blocked Clip run is seen whatever panel is open. */}
      <AnimatePresence>
        {creditNotice && (
          <motion.div key="credit-notice" role="alert" aria-live="assertive"
            initial={{ opacity: 0, y: -12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="absolute right-4 top-4 z-[80] w-[min(360px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-white/30 bg-white/[0.14] p-4 text-white shadow-[0_20px_60px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl backdrop-saturate-150">
            {/* Frosted sheen: a soft top-left glow + a thin specular edge. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/25 via-white/[0.06] to-transparent" />
            <div aria-hidden className="pointer-events-none absolute -left-10 -top-12 size-32 rounded-full bg-white/25 blur-3xl" />
            <div className="relative flex items-start gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-full border border-white/40 bg-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><AlertCircle className="size-4 text-white" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-white">{creditNotice.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/75">{creditNotice.detail}</p>
                {creditNotice.required !== undefined && creditNotice.available !== undefined && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-white/60">
                      <span>Balance</span>
                      <span><span className="text-white">{creditNotice.available.toLocaleString()}</span> / {creditNotice.required.toLocaleString()} credits</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15 shadow-[inset_0_1px_1px_rgba(0,0,0,0.2)]">
                      <div className="h-full rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.6)]" style={{ width: `${Math.min(100, Math.max(2, (creditNotice.available / Math.max(1, creditNotice.required)) * 100))}%` }} />
                    </div>
                  </div>
                )}
                {creditNotice.required !== undefined && (
                  <a href="/pricing" className="mt-3 inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-zinc-950 shadow-[0_4px_14px_rgba(255,255,255,0.25)] transition hover:bg-white/90">Add credits <ArrowUpRight className="size-3" /></a>
                )}
              </div>
              <button type="button" onClick={() => setCreditNotice(null)} aria-label="Dismiss" className="rounded-md p-0.5 text-white/60 transition hover:bg-white/15 hover:text-white"><X className="size-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Left: asset panel — full height, beside the header/toolbar and the
          bottom elements bar, never below either. */}
      <div className="w-64 h-full shrink-0 border-r border-white/10 bg-black/20 backdrop-blur-xl flex flex-col overflow-hidden">
          <div className="flex shrink-0 border-b border-white/10">
            {(["videos", "uploads"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setLeftTab(t)}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide ${leftTab === t ? "text-lime-400 border-b-2 border-lime-400" : "text-zinc-500"}`}>
                {t === "videos" ? "Videos" : "Uploads"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto editor-scroll p-3 space-y-2">
            {leftTab === "videos" ? (
              <>
                <form onSubmit={(e) => { e.preventDefault(); void submitGetClips(); }} className="space-y-1.5 mb-1">
                  <input value={sourceUrlInput} onChange={(e) => setSourceUrlInput(e.target.value)}
                    placeholder="Paste a video URL or Google Drive file/folder link…"
                    className="w-full bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-lime-400/60" />
                  <button type="submit" disabled={getClipsLoading || !sourceUrlInput.trim() || (!!mintAddress && availableCredits === undefined)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-md border border-white/25 bg-white/[0.12] py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-xl transition-colors hover:bg-white/[0.2] disabled:opacity-40">
                    {getClipsLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    {getClipsLoading ? (downloadCheck || "Preparing download…") : (!!mintAddress && availableCredits === undefined) ? "Loading credit balance…" : "Download video"}
                  </button>
                  {downloadCheck && !getClipsLoading && !creditNotice && <p className="text-[10px] text-lime-300">{downloadCheck}</p>}
                  {getClipsError && <p className="text-[10px] text-red-400">{getClipsError}</p>}
                  <div className="rounded-md border border-white/[0.08] bg-white/[0.035] px-2.5 py-2 text-[9.5px] leading-relaxed text-zinc-500">
                    <span className="font-semibold text-zinc-400">YouTube blocked?</span> Upload the file or use Google Drive. Private Drive files work when shared with Vello&apos;s configured service account; otherwise use “Anyone with the link.”
                  </div>
                  <button type="button" onClick={() => { setUploadNudge(false); fileInputRef.current?.click(); }} disabled={uploading}
                    className={`w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-[11px] font-semibold transition-colors hover:border-lime-400/60 hover:text-white disabled:opacity-40 ${
                      uploadNudge ? "border-lime-400 text-lime-300 ring-2 ring-lime-400/40 animate-pulse" : "border-white/20 text-zinc-300"
                    }`}>
                    {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
                    {uploading ? "Uploading…" : "Upload your own video"}
                  </button>
                </form>

                {/* Google Drive folder resolved to multiple videos, pick which
                    file to pull, same list the clipper's Source node shows. */}
                {folderPick && (
                  <div className="mb-1 rounded-md border border-white/15 bg-white/5 p-2 space-y-1.5">
                    <div className="flex items-center justify-between px-0.5">
                      <p className="text-[10px] font-semibold text-zinc-400">{folderPick.videos.length} video{folderPick.videos.length === 1 ? "" : "s"} in this folder</p>
                      <button type="button" onClick={() => setFolderPick(null)} className="text-zinc-500 hover:text-zinc-200">
                        <X className="size-3" />
                      </button>
                    </div>
                    <div className="max-h-40 overflow-y-auto editor-scroll space-y-1">
                      {folderPick.videos.map((v) => (
                        <button key={v.url} type="button" onClick={() => { setVideoTitles((prev) => ({ ...prev, [v.url]: v.name })); void startDownload(v.url); }} disabled={getClipsLoading}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] text-zinc-300 hover:bg-white/10 disabled:opacity-40">
                          <VideoSourceThumbnail sourceUrl={v.url} accessToken={accessToken} className="h-10 w-14 rounded" />
                          <span className="min-w-0 flex-1 truncate">{v.name}</span>
                          <Play className="size-3 shrink-0 text-lime-400" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {downloadJobIds.map((jobId) => (
                    <DownloadJobCard key={jobId} jobId={jobId} onSettled={onJobSettled} />
                  ))}
                </AnimatePresence>

                {/* Generated videos (influencer mode), click adds to the canvas */}
                {(extraVideos ?? []).map((v) => (
                  <motion.div key={v.url} layout
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
                    role="button" tabIndex={0}
                    onClick={() => addClipToTimeline(v.url, v.title, v.taskId)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addClipToTimeline(v.url, v.title, v.taskId); } }}
                    className={`group w-full cursor-pointer rounded-lg border p-2 text-left transition-colors ${selected?.url === v.url ? "border-lime-400 bg-lime-400/10" : "border-white/10 hover:border-lime-400/60 bg-white/5"}`}>
                    <div className="relative aspect-video w-full rounded overflow-hidden bg-black mb-1.5">
                      <LazyVideo src={`${v.url}#t=0.001`} muted preload="metadata" className="w-full h-full object-cover" />
                    </div>
                    <p className="truncate text-[10.5px] text-zinc-300" title={v.title}>{v.title}</p>
                  </motion.div>
                ))}

                {(videoAssets ?? []).length === 0 && downloadJobIds.length === 0 && (extraVideos ?? []).length === 0 ? (
                  <p className="text-xs text-zinc-500 px-1 py-4">
                    {videoAssets === undefined ? "Loading…" : "No downloaded videos yet, paste a link above."}
                  </p>
                ) : (videoAssets ?? []).map((d) => {
                  const isAudio = (d.mode ?? "full") === "audio";
                  return (
                    <motion.div key={d._id} layout
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
                      role={isAudio ? undefined : "button"} tabIndex={isAudio ? undefined : 0}
                      onClick={() => { if (isAudio) return; if ((d.mode ?? "full") === "full") void startStoredPreview(d.sourceUrl); else addClipToTimeline(d.url, d.sourceUrl); }}
                      onKeyDown={(e) => { if (!isAudio && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); if ((d.mode ?? "full") === "full") void startStoredPreview(d.sourceUrl); else addClipToTimeline(d.url, d.sourceUrl); } }}
                      className={`group w-full text-left rounded-lg border p-2 transition-colors ${
                        isAudio ? "border-white/10 bg-white/[0.02] opacity-60"
                          : `cursor-pointer ${selected?.url === d.url ? "border-lime-400 bg-lime-400/10" : "border-white/10 hover:border-lime-400/60 bg-white/5"}`
                      }`}>
                      <div className="relative aspect-video w-full rounded overflow-hidden bg-black mb-1.5">
                        {isAudio ? (
                          <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                            <Music className="size-4 text-zinc-500" />
                          </div>
                        ) : (
                          (d.mode ?? "full") === "full"
                            ? <div className="relative h-full w-full"><VideoSourceThumbnail sourceUrl={d.sourceUrl} accessToken={accessToken} className="h-full w-full" /><span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/70 py-1 text-[10px] text-white"><Play className="size-3 text-lime-400" /> Preview first 10s</span></div>
                            : <DownloadThumb url={d.url} sourceUrl={d.sourceUrl} accessToken={accessToken} />
                        )}
                        {mintAddress && <VideoTileMenu sourceUrl={d.sourceUrl} mintAddress={mintAddress} />}
                        <a href={d.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          title="Download this file"
                          className="absolute right-1 top-1 rounded-md bg-black/70 p-1 text-zinc-200 opacity-0 backdrop-blur-sm transition-opacity hover:text-lime-400 group-hover:opacity-100">
                          <ExternalLink className="size-3" />
                        </a>
                      </div>
                      <p className="text-[11px] leading-tight text-zinc-200 truncate" title={sourceDisplayName(d.sourceUrl, videoTitles[d.sourceUrl])}>
                        {sourceDisplayName(d.sourceUrl, videoTitles[d.sourceUrl])}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {fmtDur(d.durationSeconds)} · {fmtDownloadDate(d.createdAt)}
                      </p>
                    </motion.div>
                  );
                })}
              </>
            ) : (
              <>
                <button type="button" onClick={triggerUpload} disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 py-3 text-xs text-zinc-300 hover:border-lime-400/60">
                  {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
                  {uploading ? "Uploading…" : "Upload video or image"}
                </button>
                <AnimatePresence initial={false}>
                  {uploadProgress.map((r) => (
                    <motion.div key={r.id} layout
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className={`rounded-lg border p-2.5 ${r.error ? "border-red-500/40 bg-red-500/5" : "border-white/10 bg-white/5"}`}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="truncate text-[11px] text-zinc-200">{r.name}</p>
                        <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">{r.error ? "failed" : `${r.pct}%`}</span>
                      </div>
                      {r.error ? (
                        <p className="text-[10px] text-red-400">{r.error}</p>
                      ) : (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <motion.div className="h-full rounded-full bg-lime-400"
                            initial={{ width: 0 }} animate={{ width: `${r.pct}%` }} transition={{ duration: 0.3, ease: "easeOut" }} />
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
                {uploads.map((a) => (
                  <button key={a.id} type="button"
                    onClick={() => a.kind === "video" && addClipToTimeline(a.url, a.name, undefined, a.url)}
                    className="w-full text-left rounded-lg border border-white/10 hover:border-lime-400/60 bg-white/5 p-2 transition-colors">
                    <div className="aspect-video w-full rounded overflow-hidden bg-black mb-1.5">
                      {a.kind === "video"
                        ? <LazyVideo src={a.url} muted preload="metadata" className="w-full h-full object-cover" />
                        : <img src={a.url} alt={a.name} className="w-full h-full object-cover" />}
                    </div>
                    <p className="text-[11px] leading-tight text-zinc-200 truncate">{a.name}</p>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

      {/* Right: header toolbar + preview + bottom bar — everything beside the
          left Videos/Uploads sidebar (which now spans the full height to its
          left), never below or overlaying it. */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* Top bar — shorter (py-2, was py-3) and every left-group control shares
          the same h-7 so they read as one aligned row instead of drifting
          baselines (the plain <select> sat visibly lower than the text/button
          next to it). */}
      <div className="shrink-0 relative flex items-center px-6 py-2 border-b border-white/10 bg-black/20 backdrop-blur-xl">
        <div className="flex h-7 shrink-0 flex-nowrap items-center gap-4 text-sm text-zinc-300">
          {/* Rounded glass pill, not a bare bordered box — matches the rest of
              the editor's dark-glass control language (drawers, buttons).
              Explicit lineHeight (not just h-7) so the native <select>'s own
              text baseline centers exactly — browsers don't reliably center a
              select's value via flexbox alone, which is why this one sat
              visibly lower than its neighbors even at matching heights. */}
          <select value={aspectRatio} onChange={(e) => changeAspectRatio(e.target.value as AspectRatio)}
            className="box-border h-7 shrink-0 cursor-pointer appearance-none self-center rounded-full border border-white/15 bg-white/[0.06] py-0 pl-3 pr-6 text-xs font-medium leading-[1.75rem] text-zinc-200 outline-none transition-colors hover:border-white/25 focus-visible:border-lime-400/50 focus-visible:ring-2 focus-visible:ring-lime-400/30"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23a3a3a3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 8px center",
            }}>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
            <option value="1:1">1:1</option>
          </select>
          <span className="flex h-7 shrink-0 items-center text-xs leading-none text-zinc-400">Layout: Fill</span>
          <button type="button" onClick={() => setTrackOn((v) => !v)}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-1 text-xs leading-none outline-none transition-colors hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-lime-400/40">
            Track: <span className={trackOn ? "text-lime-400" : "text-zinc-500"}>{trackOn ? "ON" : "OFF"}</span>
          </button>
          {/* Glass BG — fills letterbox gaps with a blurred copy of this same
              video (the "Apple frosted glass" look) instead of plain black
              bars, live in the preview below AND burned into the real export. */}
          <label className="flex h-7 shrink-0 items-center gap-2 text-xs leading-none text-zinc-300">
            <Switch size="sm" checked={glassBgOn} onCheckedChange={setGlassBgOn} />
            <span className={glassBgOn ? "text-lime-400" : "text-zinc-400"}>Glass BG</span>
          </label>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {applyError && <span className="max-w-[220px] truncate text-[11px] text-red-400" title={applyError}>{applyError}</span>}
          {/* Download ORIGINAL — the pre-burn source (item.sourceUrl), never
              the current preview URL which may already have hooks/captions/
              music/intro-CTA baked in. Falls back to `.url` for a clip that
              was never burned (sourceUrl unset), which is the same file
              either way at that point. There was previously NO way at all
              to get a clip's unedited original out of the Editor. */}
          {selected && (
            <a
              href={selected.sourceUrl ?? selected.url}
              download
              target="_blank"
              rel="noopener noreferrer"
              title="Download the original, unedited video (no hooks, captions, music, or intro/CTA burned in)"
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-zinc-300 backdrop-blur-xl transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              <Download className="size-3.5" />
              Original
            </a>
          )}
          {/* clipLabel (AI-influencer Editor): useful with just one clip open —
              it burns + saves the default, no other clip involved. The
              clipper's local-copy variant still needs 2+ clips to mean
              anything. */}
          {(clipLabel || timeline.length > 1) && (
            <button type="button" onClick={clipLabel ? applyAllClips : applyToAllClips} disabled={!selected || applyingAll || applyingId !== null}
              title={clipLabel
                ? "Burns this clip for real, and saves its caption style, hook design, and music track as the default for every FUTURE video — other clips already in the timeline are left untouched"
                : "Push this clip's caption style, hook design, media overlays, and music track onto every other clip in the timeline"}
              className="flex items-center gap-2 rounded-lg border border-lime-400/30 bg-lime-400/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-lime-300 backdrop-blur-xl transition-colors hover:bg-lime-400/20 disabled:opacity-50">
              {applyingAll ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
              {applyingAll ? "Applying…" : clipLabel ? "Apply & save as default" : "Save"}
            </button>
          )}
          {clipLabel ? (
            <button type="button" onClick={applySelectedClip} disabled={!selected || applyingId === selected?.id || applyingAll}
              title="Burns the configured captions, hook text, and music into this clip's video for real"
              className="flex items-center gap-2 rounded-lg border border-white/25 bg-white/[0.12] px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-xl transition-colors hover:bg-white/[0.2] disabled:opacity-40">
              {applyingId === selected?.id ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />}
              {applyingId === selected?.id ? "Applying…" : clipLabel}
            </button>
          ) : (
            <button type="button" onClick={() => { void runClipFromEditor(); }} disabled={!clippingHasSource || clipCreditChecking}
              title={clippingHasSource ? "Clips the best moments from this video with your applied caption style, then opens Generations to watch them render" : "Select a downloaded video or a clip from its source first"}
              className="flex items-center gap-2 rounded-lg border border-white/25 bg-white/[0.12] px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-xl transition-colors hover:bg-white/[0.2] disabled:opacity-40">
              {clipCreditChecking ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />}
              {clipCreditChecking ? "Checking credits…" : `Clip (${clippingMaxClips} clip${clippingMaxClips === 1 ? "" : "s"})`}
            </button>
          )}
        </div>
      </div>

        {/* Middle: preview / right rail — the Videos/Uploads sidebar now lives
            in its own full-height column to the left of this whole group. */}
        <div className="relative flex-1 min-h-0 flex overflow-hidden">
        {/* Center: preview */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-3 px-6 pb-6 pt-3 overflow-y-auto editor-scroll">
          <motion.div ref={canvasRef}
            animate={{ x: anyPanelOpen && aspectRatio === "9:16" ? -110 : 0 }}
            transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
            className="relative h-full max-h-[560px] shrink-0 rounded-xl overflow-hidden bg-black border border-white/10"
            style={{ aspectRatio: aspectRatio === "9:16" ? "9/16" : aspectRatio === "16:9" ? "16/9" : "1/1" }}>
            {selected && velloWatermark && <VelloWatermark />}
            {/* Glass BG — the SAME source, cover-scaled + blurred + slightly
                darkened, filling the box behind the main video. Matches the
                backend's blur_frame composite (gblur sigma 28, eq brightness
                -0.06/saturation 1.05) so the preview and the real export read
                as the same shot. Sits BEHIND the main video (z-index via DOM
                order) — invisible wherever the foreground already covers the
                frame, visible only in the letterbox gaps a mismatched aspect
                ratio or "Fit" framing leaves as plain black otherwise. */}
            <AnimatePresence>
              {selected && glassBgOn && (
                <motion.div key="glass-bg" aria-hidden
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="pointer-events-none absolute inset-0 overflow-hidden">
                  {/* selectedVideoFilter is "none" when no filter is picked — never
                      append it to the blur chain ("blur(..) none" is invalid CSS
                      and the browser drops the WHOLE filter, showing the sharp
                      video instead of glass). */}
                  <video ref={bgVideoRef} src={previewSrc(selected.url, selected.trimIn)} muted loop playsInline preload="auto"
                    className="absolute inset-0 size-full scale-[1.25] object-cover [transform:translateZ(0)] will-change-transform"
                    style={{ filter: `blur(36px) saturate(1.7) brightness(0.82)${selectedVideoFilter !== "none" ? ` ${selectedVideoFilter}` : ""}` }}
                  />
                  {/* iOS-style frosted sheet: milky tint + top sheen + fine grain + inner hairline. */}
                  <div className="absolute inset-0 bg-white/[0.07]" />
                  <div className="absolute inset-0 bg-gradient-to-b from-white/[0.14] via-transparent to-black/25" />
                  <div className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
                    style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")" }} />
                  <div className="absolute inset-0 rounded-xl shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
                </motion.div>
              )}
            </AnimatePresence>
            {selected ? (
              <motion.video key={`${selected.id}:${selected.url}`} ref={videoRef} src={previewSrc(selected.url, selected.trimIn)} muted={!trackOn} playsInline preload="auto"
                onLoadedMetadata={(e) => {
                  const video = e.currentTarget;
                  const itemId = selected.id;
                  const trimIn = selected.trimIn;
                  if (trimIn > 0) video.currentTime = trimIn;
                  resolveVideoDuration(video, trimIn, (duration) => onDurationKnown(itemId, duration));
                  setMetaReadyId(itemId);
                }}
                // Backstop for the (rarer) case where duration is only known once
                // more of the file has streamed in, after loadedmetadata already
                // fired with Infinity and the far-seek trick above didn't resolve it.
                onDurationChange={(e) => {
                  const video = e.currentTarget;
                  if (Number.isFinite(video.duration) && video.duration > 0) onDurationKnown(selected.id, video.duration);
                }}
                onCanPlay={() => setPlaybackError(null)}
                onError={() => { setPlaying(false); setPlaybackError("This downloaded preview could not play in the browser. Repair its playable copy."); }}
                onTimeUpdate={onTimeUpdate}
                style={{ opacity: shotFramingActive ? 0 : 1, filter: selectedVideoFilter }}
                animate={(() => {
                  // Shot-tracked framing draws on the canvas below — the <video> is
                  // just the decode source then, untransformed.
                  if (shotFramingActive) return { scale: 1, x: 0, y: 0 };
                  const mode = selected.framingMode;
                  const hasFace = selected.faceCx !== undefined;
                  const hasBounds = selected.faceXMin !== undefined && selected.faceXMax !== undefined
                    && (selected.faceXMax! - selected.faceXMin!) > 0.08;
                  // Recenter-on-point trick: translate the detected point to the
                  // middle of the frame (x/y as % of the element's own size, applied
                  // BEFORE scale), then scale. A transform-origin-only zoom (the old
                  // approach) keeps the point pinned at its ORIGINAL screen position
                  // instead of centering it — wrong/cropped-looking off-center.
                  const recenterTo = (cx: number, cy: number, scale: number) => ({
                    scale, x: `${(0.5 - cx) * 100}%`, y: `${(0.5 - cy) * 100}%`,
                  });
                  if (mode === "zoom" && playing) {
                    return recenterTo(selected.faceCx ?? 0.5, selected.faceCy ?? 0.5, selected.zoomAmount ?? FACE_CROP_MIN_ZOOM);
                  }
                  if (mode === "auto" && hasFace) {
                    // A gentle recenter (small crop-in, not a punch) toward whoever
                    // was detected — real position, not a guess.
                    return recenterTo(selected.faceCx!, selected.faceCy!, 1.08);
                  }
                  if (mode === "pan" && playing && hasBounds) {
                    // REAL multi-guest bounds — pan settles on speaker A, crosses to
                    // speaker B, holds, and back. Previously this was a blind ±4%
                    // sweep with no relation to where anyone actually was.
                    const left = recenterTo(selected.faceXMin!, selected.faceCy ?? 0.5, 1.1);
                    const right = recenterTo(selected.faceXMax!, selected.faceCy ?? 0.5, 1.1);
                    return { scale: [left.scale, left.scale, right.scale, right.scale], x: [left.x, left.x, right.x, right.x], y: left.y };
                  }
                  if (mode === "pan" && hasFace) {
                    // Only one speaker found — nothing to pan BETWEEN, so hold a
                    // gentle recenter instead of sweeping in a direction that has
                    // nothing to do with the actual shot.
                    return recenterTo(selected.faceCx!, selected.faceCy!, 1.08);
                  }
                  return { scale: 1, x: 0, y: 0 };
                })()}
                transition={
                  selected.framingMode === "zoom" ? { duration: Math.max(1, selected.trimOut - selected.trimIn), ease: "easeOut" }
                    : selected.framingMode === "pan" ? { duration: Math.max(3, (selected.trimOut - selected.trimIn) * 1.5), repeat: Infinity, ease: "easeInOut" }
                    : { duration: 0.3 }
                }
                // Glass BG only means something with the whole frame visible —
                // force contain-fit while it's on (same as Camera "Fit (safe)")
                // so the blurred backdrop actually shows in the gaps, instead of
                // the sharp foreground covering edge-to-edge and hiding it.
                className={`relative w-full h-full ${(glassBgOn || selected.framingMode === "full") ? "object-contain" : "object-cover"}`} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm px-6 text-center">
                Add a clip from the left panel to preview it here
              </div>
            )}
            {selected && shotFramingActive && (
              <canvas ref={frameCanvasRef} aria-hidden className="absolute inset-0 size-full pointer-events-none" style={{ filter: selectedVideoFilter }} />
            )}
            {selectedMusicTrack?.url && <audio ref={musicRef} src={selectedMusicTrack.url} loop />}
            <AnimatePresence>
              {selectedOverlays
                .filter((o) => playheadSec - (selected?.trimIn ?? 0) >= o.startSec && playheadSec - (selected?.trimIn ?? 0) <= o.endSec)
                .map((o) => {
                  const preset = o.presetId ? CAPTION_PRESET_BY_ID[o.presetId] : undefined;
                  const hookDesign = o.hookDesignId ? HOOK_DESIGN_BY_ID[o.hookDesignId] : undefined;
                  const elapsed = playheadSec - (selected?.trimIn ?? 0) - o.startSec;
                  // Pages advance at a fixed natural cadence (CAPTION_PAGE_SECONDS) and
                  // LOOP (modulo) for as long as the window lasts — driven by the REAL
                  // playhead, so playing the clip keeps paging + re-playing the entrance
                  // animation across the WHOLE video instead of stopping after 3 chunks.
                  const pageSlot = preset ? Math.max(0, Math.floor(elapsed / CAPTION_PAGE_SECONDS)) : 0;
                  const pageIdx = pageSlot % CAPTION_DEMO_PAGES.length;
                  const page = preset ? CAPTION_DEMO_PAGES[pageIdx] : null;
                  const pageStart = pageSlot * CAPTION_PAGE_SECONDS;
                  const wordIdx = page ? Math.min(page.length - 1, Math.max(0, Math.floor(((elapsed - pageStart) / CAPTION_PAGE_SECONDS) * page.length))) : 0;
                  // Animate the SAME entrance the real preset uses (pop/fade/float) so
                  // the canvas preview reads as a live preview, not a static swatch —
                  // replays on every page change AND every re-entry into the window.
                  const entrance = preset?.render.entrance ?? (
                    hookDesign?.render.animation === "pop-overshoot" ? "pop"
                      : hookDesign?.render.animation === "slide-down" ? "float"
                      : hookDesign?.render.animation ?? "fade"
                  );
                  const variants = {
                    pop: { initial: { opacity: 0, scale: 0.5 }, animate: { opacity: 1, scale: 1 }, transition: { type: "spring" as const, stiffness: 420, damping: 18 } },
                    float: { initial: { opacity: 0, y: 14, scale: 0.92 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } },
                    fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25 } },
                  }[entrance as "pop" | "float" | "fade"] ?? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25 } };
                  if (o.imageUrl || o.videoUrl) {
                    const ox = o.ox ?? 0.5;
                    const oy = o.oy ?? (o.position === "top" ? 0.18 : o.position === "bottom" ? 0.82 : 0.5);
                    const mediaScale = o.scale ?? 1;
                    return (
                      <motion.div key={o.id}
                        initial={{ opacity: 0, scale: mediaScale * 0.9 }} animate={{ opacity: 1, scale: mediaScale }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        onPointerDown={(e) => startMediaDrag(e, o)}
                        className="group absolute w-1/3 max-w-[160px] cursor-move touch-none select-none"
                        style={{ left: `${ox * 100}%`, top: `${oy * 100}%`, transform: `translate(-50%, -50%) scale(${mediaScale})` }}>
                        {o.videoUrl
                          ? <video src={o.videoUrl} autoPlay={playing} loop muted playsInline className="w-full h-auto rounded-md object-contain drop-shadow-lg pointer-events-none" />
                          /* eslint-disable-next-line @next/next/no-img-element */
                          : <img src={o.imageUrl} alt="" className="w-full h-auto object-contain drop-shadow-lg pointer-events-none" />}
                        {/* Resize handle, visible on hover, drag to scale. Black icon on a
                            small lime dot (was a blank circle). */}
                        <div onPointerDown={(e) => startMediaResize(e, o)}
                          className="absolute -right-1 -bottom-1 grid size-3 place-items-center rounded-full border border-[#0b0906] bg-lime-400 opacity-0 group-hover:opacity-100 cursor-nwse-resize transition-opacity">
                          <Maximize2 className="size-1.5 text-black" />
                        </div>
                        {/* Delete, visible on hover, removes this overlay from the preview. */}
                        <button type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); removeOverlay(o.id); }}
                          aria-label="Delete overlay"
                          className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full border border-[#0b0906] bg-red-500 text-white opacity-0 group-hover:opacity-100 hover:bg-red-400 transition-opacity">
                          <Trash2 className="size-2" />
                        </button>
                      </motion.div>
                    );
                  }
                  if (hookDesign) {
                    // Already burned into this clip's pixels (server-side at
                    // generation, or a prior Apply in this editor) and the
                    // operator hasn't asked to change it — skip the live
                    // layer instead of drawing the same hook a second time
                    // on top of the video that already shows it.
                    if (selected?.hookBurned && !hookEditOverrideIds.has(selected.id)) return null;
                    // Draggable vertical placement — `oy` (set by startHookDrag)
                    // overrides the top/center/bottom band entirely, mirroring the
                    // exact yPct the burn pipeline will use (see applyHookOverlayBurn).
                    // Drawn by HookBurnPreview from the exact burn geometry
                    // (hookBlockLayout): same yPct (block centre), same wrap, same
                    // boxes, same on-frame clamp as the ffmpeg render.
                    return (
                      <motion.div key={o.id}
                        initial={variants.initial} animate={variants.animate} exit={{ opacity: 0 }} transition={variants.transition}
                        className="pointer-events-none absolute inset-0">
                        <HookBurnPreview design={hookDesign} text={o.text} fontScale={o.hookFontScale ?? 1}
                          yPct={overlayYPct(o)} aspect={aspectRatio} canvasWidthPx={canvasWidthPx}
                          onPointerDown={(e) => startHookDrag(e, o)}>
                        <button type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); removeOverlay(o.id); }}
                          aria-label="Delete hook"
                          className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full border border-[#0b0906] bg-red-500 text-white opacity-0 group-hover:opacity-100 hover:bg-red-400 transition-opacity">
                          <Trash2 className="size-2" />
                        </button>
                        {/* Drag to resize the hook's text size, live — same handle
                            convention/position as the media overlay's resize
                            handle, placed just below the delete button. */}
                        <div
                          onPointerDown={(e) => startHookResize(e, o)}
                          role="slider"
                          aria-label="Resize hook text"
                          aria-valuenow={Math.round((o.hookFontScale ?? 1) * 100)}
                          className="absolute -right-1 top-4 grid size-3.5 place-items-center rounded-full border border-[#0b0906] bg-lime-400 text-black opacity-0 group-hover:opacity-100 cursor-nwse-resize touch-none transition-opacity">
                          <Maximize2 className="size-2" />
                        </div>
                        </HookBurnPreview>
                      </motion.div>
                    );
                  }
                  // Draggable vertical placement, same convention as the hook overlay
                  // above: `oy` (set by startHookDrag) overrides the top/center/bottom
                  // band entirely and mirrors the exact yPct the burn pipeline uses (see
                  // applyClipOverlays's `captions.yPct`) — so wherever it's dropped in
                  // the preview is exactly where it burns into the video.
                  const captionOy = o.oy ?? (o.position === "top" ? 0.12 : o.position === "bottom" ? 0.86 : 0.5);
                  return (
                    <motion.div key={preset ? `${o.id}-${pageIdx}` : o.id}
                      initial={variants.initial} animate={variants.animate} exit={{ opacity: 0 }} transition={variants.transition}
                      onPointerDown={(e) => startHookDrag(e, o)}
                      className={`absolute inset-x-0 cursor-move touch-none select-none ${
                        preset ? "" : "px-4 text-center text-lg font-extrabold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                      }`}
                      style={{
                        top: `${captionOy * 100}%`,
                        transform: "translateY(-50%)",
                        // Burn: MarginL/R 40px at burn res, centered (left for align:"left").
                        ...(preset ? {
                          fontSize: captionPreviewFontPx(preset.render, aspectRatio, canvasWidthPx),
                          paddingInline: `${(40 / BURN_CANVAS[aspectRatio].w) * 100}%`,
                          textAlign: preset.render.align === "left" ? "left" : "center",
                        } : {}),
                      }}>
                      {preset && page ? <CaptionPageWords preset={preset} page={page} activeWordIdx={wordIdx} /> : o.text}
                    </motion.div>
                  );
                })}
            </AnimatePresence>
          </motion.div>
          {selected && (
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <button type="button" onClick={togglePlay} className="p-1.5 rounded-full bg-white/10 hover:bg-white/20">
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </button>
              <span>{fmt(playheadSec - selected.trimIn)} / {fmt(selected.trimOut - selected.trimIn)}</span>
            </div>
          )}
          {selected && playbackError && (
            <div className="max-w-sm text-center text-xs text-amber-200" role="alert">
              {playbackError}
              {selectedSourceUrl && (
                <button type="button" className="ml-2 font-semibold text-lime-300 underline hover:text-lime-200" onClick={() => void startStoredPreview(selectedSourceUrl, true, selected.id)}>
                  Repair preview
                </button>
              )}
            </div>
          )}
        </div>

        {/* Clipping drawer, configure + launch a REAL clip run (seeds the
            Clipping canvas's source/count/genre and auto-runs it there). */}
        <AnimatePresence>
          {clippingPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <p className="text-sm font-semibold text-zinc-100">Clipping</p>
                <button type="button" onClick={() => setClippingPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                {!selectedSourceUrl ? (
                  <p className="text-xs text-zinc-500">
                    Select a downloaded video from the Videos tab on the left (not an upload or a rendered clip), clips get cut from that source.
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] text-zinc-500 truncate" title={selectedSourceUrl}>
                      Source: <span className="text-zinc-300">{sourceDisplayName(selectedSourceUrl, videoTitles[selectedSourceUrl])}</span>
                    </p>
                    {/* Cost estimate — priced by SOURCE LENGTH (OpusClip-style),
                        not by clip count, so this is the SAME number whether
                        clipCount below is 5 or 30; only the per-clip split
                        moves as the slider changes. Hidden until the source's
                        duration is known (it always is once downloaded). */}
                    {selectedSourceDurationSeconds != null && (
                      <p className="text-[11px] text-zinc-500">
                        <span className="font-semibold text-lime-300">~{estimateClipRunCredits(selectedSourceDurationSeconds)} credits</span> for this run
                        <span className="text-zinc-600"> · ~{perClipCredits(estimateClipRunCredits(selectedSourceDurationSeconds), clipCount)}cr/clip at {clipCount} clips</span>
                      </p>
                    )}
                  </>
                )}

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-zinc-400">How many clips</label>
                    <span className="text-xs font-bold text-lime-400">{clipCount}</span>
                  </div>
                  <Slider
                    value={clipCount}
                    min={1}
                    max={30}
                    step={1}
                    onValueChange={(v) => setClipCount(Math.max(1, Math.min(30, (Array.isArray(v) ? v[0] : v) as number)))}
                    // The shared Slider's fill/thumb ride the theme's --primary
                    // token (purple in this app) — override just this instance
                    // to lime green, matching the editor's accent everywhere else.
                    className="[&_[data-slot=slider-range]]:bg-lime-400 [&_[data-slot=slider-thumb]]:border-lime-400"
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
                    <span>1</span>
                    <span>30</span>
                  </div>
                </div>

                <fieldset className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                  <legend className="px-1 text-[11px] font-semibold text-zinc-300">Clip duration range</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-[10px] text-zinc-500">Minimum seconds
                      <input type="number" min={5} max={clipLengthMax} step={1} value={clipLengthMin}
                        onChange={(e) => setClipLengthMin(Math.max(5, Math.min(clipLengthMax, Number(e.target.value) || 5)))}
                        className="mt-1 min-h-10 w-full rounded-lg border border-white/15 bg-black/20 px-3 text-sm tabular-nums text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400" />
                    </label>
                    <label className="text-[10px] text-zinc-500">Maximum seconds
                      <input type="number" min={clipLengthMin} max={90} step={1} value={clipLengthMax}
                        onChange={(e) => setClipLengthMax(Math.min(90, Math.max(clipLengthMin, Number(e.target.value) || clipLengthMin)))}
                        className="mt-1 min-h-10 w-full rounded-lg border border-white/15 bg-black/20 px-3 text-sm tabular-nums text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400" />
                    </label>
                  </div>
                  <p className="mt-2 text-[10px] text-zinc-500">Select moments lasting {clipLengthMin}–{clipLengthMax} seconds each. Short sources can produce shorter clips.</p>
                </fieldset>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">Genre</label>
                  <div className="flex flex-wrap gap-1.5">
                    {CLIP_GENRES.map((g) => {
                      const isSel = (clipGenre || "auto") === g.id;
                      return (
                        <button key={g.id} type="button" onClick={() => setClipGenre(g.id)}
                          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            isSel ? "border-transparent bg-lime-400 text-[#0b0906]" : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                          }`}
                        >
                          <span className="leading-none">{g.emoji}</span>
                          {g.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">Prompt to clip (optional)</label>
                  <textarea value={clipPrompt} onChange={(e) => setClipPrompt(e.target.value)} rows={3}
                    placeholder="e.g. only the moments about pricing"
                    className="w-full bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none" />
                  <p className="mt-1 text-[10px] text-zinc-600">
                    Steers WHICH moments get picked, count and genre still bound how many and what feel.
                  </p>
                </div>

                <fieldset className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                  <legend className="px-1 text-[11px] font-semibold text-zinc-300">Cover image (optional)</legend>
                  <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                    Applies to every clip this project posts — the real thumbnail on Instagram &amp; YouTube; on TikTok it becomes the video&apos;s own opening frame, since TikTok has no custom-cover field.
                  </p>
                  {coverImageUrl ? (
                    <div className="flex items-center gap-2 rounded-lg border border-lime-400/30 bg-lime-400/10 p-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={coverImageUrl} alt="Cover" className="size-10 shrink-0 rounded object-cover" />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-lime-200">Cover image set — auto-saved for this project</span>
                      <button type="button" onClick={clearCoverImage} title="Remove cover image"
                        className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-red-400">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 py-3 text-[11px] font-semibold text-zinc-400 hover:border-lime-400/50 hover:text-lime-300 transition-colors">
                      {coverUploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                      {coverUploading ? "Uploading…" : "Upload cover image"}
                      <input type="file" accept="image/*" hidden disabled={coverUploading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void setCoverImage(f); e.target.value = ""; }} />
                    </label>
                  )}
                  {coverError && <p className="mt-1.5 text-[10px] text-red-400">{coverError}</p>}
                </fieldset>

                <button type="button" onClick={saveClipSettings} disabled={!selectedSourceUrl}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/60 bg-white/90 py-2.5 text-xs font-bold uppercase tracking-wide text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_8px_20px_-8px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">
                  <Check className="size-3.5" />
                  Save {clipCount} clip{clipCount === 1 ? "" : "s"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Caption-style drawer, slides in from the right, over the preview,
            same card language as the App Store's caption-template picker. */}
        <AnimatePresence>
          {captionPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Caption styles</p>
                  <p className="text-[10.5px] text-zinc-500">One caption at a time, picking a style swaps it in.</p>
                </div>
                <button type="button" onClick={() => setCaptionPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-[11px] text-zinc-500">
                  {selected
                    ? <>Tap a style to preview it on <span className="text-zinc-300">{selected.title}</span>.</>
                    : "Select a clip on the timeline first, then pick a style below."}
                </p>
                {/* Persistent OFF — no captions on this video OR any future one.
                    Always visible (works even with no preset applied yet). */}
                <button type="button"
                  disabled={captionsOffState === "saving"}
                  onClick={() => { clearCaptionPreset(); void persistOverlayOff("clip.captions", capsSkillRow, "Captions", setCaptionsOffState); }}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[10.5px] font-bold uppercase tracking-wide transition-colors disabled:opacity-50 ${
                    captionsOffState === "saved" ? "border-lime-400/60 text-lime-300" : "border-red-400/40 text-red-300 hover:border-red-400 hover:bg-red-400/10"
                  }`}>
                  {captionsOffState === "saving" ? "Saving…"
                    : captionsOffState === "saved" ? "✓ Captions off for all videos"
                    : captionsOffState === "error" ? "Save failed — tap to retry"
                    : "Turn OFF captions (all videos)"}
                </button>
                {selectedOverlays.some((o) => o.presetId) && (
                  <button type="button" onClick={clearCaptionPreset}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 py-1.5 text-[10.5px] font-semibold text-zinc-400 hover:border-red-400/50 hover:text-red-400 transition-colors">
                    <X className="size-3" /> Remove caption
                  </button>
                )}
                {/* Language pickers — ALWAYS visible once a clip is selected (they used
                    to hide until a style was applied, which read as "no dropdown").
                    Changing one with no caption yet auto-applies the default style so
                    the pick is immediately real; the values are agent-level defaults
                    every caption overlay inherits (preset swaps keep them). */}
                {selected && (() => {
                  const capOv = selectedOverlays.find((o) => o.presetId);
                  const lang = capOv?.captionLanguageCode ?? captionLangDefaults.languageCode;
                  const sub = capOv?.captionSubtitleLanguageCode ?? captionLangDefaults.subtitleLanguageCode;
                  const apply = (patch: { captionLanguageCode?: string; captionSubtitleLanguageCode?: string }) => pickCaptionLanguage(patch, capOv?.id);
                  const subLabel = CAPTION_LANGUAGES.find((l) => l.code === sub)?.label ?? sub;
                  const spokenLabel = lang ? (CAPTION_LANGUAGES.find((l) => l.code === lang)?.label ?? lang) : "the detected language";
                  return (
                    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="space-y-1">
                        <p className="text-[10.5px] font-semibold text-zinc-400">Transcription language <span className="font-normal text-zinc-600">(what is spoken)</span></p>
                        <select
                          value={lang}
                          onChange={(e) => apply({ captionLanguageCode: e.target.value })}
                          className="w-full rounded-md border border-white/15 bg-white/[0.05] px-2 py-1.5 text-[11px] text-zinc-200 focus:border-lime-400/50 focus:outline-none"
                        >
                          {CAPTION_LANGUAGES.map((l) => (
                            <option key={l.code} value={l.code} className="bg-[#141210]">{l.label}</option>
                          ))}
                        </select>
                        <p className="text-[10px] text-zinc-500">Auto-detect works for most clips; pin it for Malay/Indonesian mix-ups.</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10.5px] font-semibold text-zinc-400">Caption output language <span className="font-normal text-zinc-600">(what gets burned)</span></p>
                        <select
                          value={sub}
                          onChange={(e) => apply({ captionSubtitleLanguageCode: e.target.value })}
                          className="w-full rounded-md border border-white/15 bg-white/[0.05] px-2 py-1.5 text-[11px] text-zinc-200 focus:border-lime-400/50 focus:outline-none"
                        >
                          {SUBTITLE_LANGUAGES.map((l) => (
                            <option key={l.code} value={l.code} className="bg-[#141210]">{l.label}</option>
                          ))}
                        </select>
                        {!sub
                          ? <p className="text-[10px] text-zinc-500">Captions burn in the language spoken. Pick another to auto-translate.</p>
                          : lang && lang === sub
                            ? <p className="text-[10px] text-zinc-500">Same as spoken, no translation needed.</p>
                            : <p className="text-[10px] text-lime-300/80">Speech in {spokenLabel} → captions translated to {subLabel} at burn time, synced per phrase.</p>}
                        {!capOv && <p className="text-[10px] text-zinc-600">No caption style on this clip yet — picking a language adds the default style.</p>}
                      </div>
                    </div>
                  );
                })()}
                {/* All 12 presets always render, one per row, a bigger "screen mock"
                    block (the preset's real chip background) with a full-length
                    sample line so the entrance animation is actually visible, name +
                    blurb below, and a clear "in use" state (only one can be active). */}
                <div className="space-y-2.5">
                  {CAPTION_PRESETS.map((p) => {
                    const active = selectedOverlays.some((o) => o.presetId === p.id);
                    return (
                      <motion.button key={p.id} type="button" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                        onClick={() => applyCaptionPreset(p.id)} disabled={!selected}
                        className={`relative w-full overflow-hidden rounded-xl border-2 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          active ? "border-lime-400 bg-lime-400/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                        }`}
                      >
                        <div className="flex items-center justify-center px-4 py-6" style={{ background: p.preview.chipBg ?? "#0A0A0A" }}>
                          <div className="max-w-[85%]">
                            <CaptionCardPreview preset={p} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-zinc-100">{p.name}</p>
                            <p className="text-[10.5px] text-zinc-500 truncate">{p.blurb}</p>
                          </div>
                          {active && (
                            <span className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-lime-400 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#0b0906]">
                              <Check className="size-2.5" /> In use
                            </span>
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Post Captions drawer — the SOCIAL-POST caption (what the Apply
            modal's Post flow sends), not the burned-in video captions above.
            Same brief-in/line-out shape as Smart Captions in the App Store,
            reachable here as a client "Generate" button. */}
        <AnimatePresence>
          {postCaptionPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-[26rem] overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Post Captions</p>
                  <p className="text-[10.5px] text-zinc-500">The social caption sent when you post — separate from burned-in captions. Settings auto-save and apply to every post.</p>
                </div>
                <button type="button" onClick={() => setPostCaptionPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-[11px] text-zinc-500">
                  {selected
                    ? <>Generate a post caption for <span className="text-zinc-300">{selected.title}</span>.</>
                    : "Select a clip on the timeline first, then generate a caption below."}
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">Language</label>
                    <select value={postCaptionLanguage} onChange={(e) => { postCaptionDirtyRef.current = true; setPostCaptionLanguage(e.target.value); }}
                      className="w-full bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-sm text-zinc-200">
                      {HOOK_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">Mood</label>
                    <select value={postCaptionMood} onChange={(e) => { postCaptionDirtyRef.current = true; setPostCaptionMood(e.target.value); }}
                      className="w-full bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-sm text-zinc-200">
                      {POST_CAPTION_MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">
                    What&apos;s this post about? <span className="font-normal text-zinc-600">(context — hashtags, mentions, angle, whatever you want in it)</span>
                  </label>
                  <textarea value={postCaptionPrompt} onChange={(e) => { postCaptionDirtyRef.current = true; setPostCaptionPrompt(e.target.value); }} rows={3}
                    placeholder="e.g. it's a mukbang reaction, tag @vellogg, add 3 relevant hashtags"
                    className="w-full bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none" />
                  <button type="button" onClick={generatePostCaptionForSelected}
                    disabled={postCaptionGenerating || !postCaptionPrompt.trim() || !selected}
                    className="mt-1.5 w-full flex items-center justify-center gap-1.5 rounded-md py-2 text-[11px] font-bold uppercase tracking-wide disabled:opacity-40 transition-opacity"
                    style={{ background: "#65c000", color: "#0b0906" }}>
                    {postCaptionGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    {postCaptionGenerating ? "Writing…" : "Generate caption"}
                  </button>
                  {postCaptionGenError && <p className="mt-1 text-[10px] text-red-400">{postCaptionGenError}</p>}
                  {!selectedContent && selected && (
                    <p className="mt-1 text-[10px] text-zinc-600">No transcript or caption found for this clip, the caption will be based on your prompt alone.</p>
                  )}
                </div>

                {selected && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="block text-[11px] font-semibold text-zinc-400">
                        Caption <span className="font-normal text-zinc-600">(edit freely, this is what gets posted)</span>
                      </label>
                      {/* Already set — same "X clears it" affordance the Caption
                          drawer's "Remove caption" gives a picked style. */}
                      {selected.postCaption?.trim() && (
                        <button type="button" title="Clear caption"
                          onClick={() => {
                            const id = selected.id;
                            setTimeline((prev) => prev.map((t) => (t.id === id ? { ...t, postCaption: "" } : t)));
                          }}
                          className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-red-400">
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                    <textarea
                      value={selected.postCaption ?? ""}
                      onChange={(e) => {
                        const id = selected.id;
                        setTimeline((prev) => prev.map((t) => (t.id === id ? { ...t, postCaption: e.target.value } : t)));
                      }}
                      rows={4}
                      placeholder="Generated caption appears here, editable."
                      className="w-full bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none"
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Presets drawer, one-tap bundles of a real caption preset + a real
            camera framing mode, applied together to the selected clip. Card
            language matches /admin/samples' preset picker: flat dark card,
            a diagonal accent-gradient tint, name + blurb, no big thumbnail -
            compact and scannable instead of one tall preview block per row. */}
        <AnimatePresence>
          {stylesPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Presets</p>
                  <p className="text-[10.5px] text-zinc-500">Caption + camera bundle, one tap sets both.</p>
                </div>
                <button type="button" onClick={() => setStylesPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-[11px] text-zinc-500">
                  {selected
                    ? <>Tap a preset to apply it to <span className="text-zinc-300">{selected.title}</span>.</>
                    : "Select a clip on the timeline first, then pick a preset below."}
                </p>
                <div className="space-y-2">
                  {STYLE_PRESETS.map((s) => {
                    const active = selectedOverlays.some((o) => o.presetId === s.captionPresetId) && (selected?.framingMode ?? "auto") === s.cameraMode;
                    return (
                      <motion.button key={s.id} type="button" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                        onClick={() => applyStyle(s)} disabled={!selected}
                        className={`relative w-full overflow-hidden rounded-xl border p-3.5 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          active ? "border-lime-400/60 bg-lime-400/[0.06]" : "border-white/10 bg-[#0a0a0c] hover:border-white/25"
                        }`}
                      >
                        <div className={`absolute inset-0 bg-gradient-to-br ${s.accent} pointer-events-none`} />
                        <div className="relative flex items-center justify-between gap-2">
                          <p className="text-[13px] font-semibold text-zinc-100">{s.name}</p>
                          {active ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-lime-400 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#0b0906]">
                              <Check className="size-2.5" /> In use
                            </span>
                          ) : (
                            <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-white/15" />
                          )}
                        </div>
                        <p className="relative mt-1 text-[11px] leading-snug text-zinc-500">{s.blurb}</p>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Text Hooks drawer, the opening-line hook overlay: pick a design
            (real HOOK_DESIGNS catalog, same one the Auto Hook app uses), a
            duration, and a language. Single layer, picking a design swaps it. */}
        <AnimatePresence>
          {hookPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-[26rem] overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Text Hooks</p>
                  <p className="text-[10.5px] text-zinc-500">The opening line, one design at a time.</p>
                </div>
                <button type="button" onClick={() => setHookPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-[11px] text-zinc-500">
                  {selected
                    ? <>Tap a design to preview it on <span className="text-zinc-300">{selected.title}</span>.</>
                    : "Select a clip on the timeline first, then pick a design below."}
                </p>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-semibold text-zinc-400">Duration</label>
                    <span className="text-[11px] text-zinc-300 tabular-nums">{hookAlwaysOn ? "Whole video" : `${hookDuration}s`}</span>
                  </div>
                  <input type="range" min={HOOK_DURATION_MIN} max={HOOK_DURATION_MAX} step={1} value={hookDuration}
                    onChange={(e) => changeHookDuration(Number(e.target.value))}
                    disabled={hookAlwaysOn}
                    className="w-full accent-lime-400 disabled:opacity-40" />
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px] text-zinc-200">
                    <input type="checkbox" checked={hookAlwaysOn} onChange={(e) => changeHookAlwaysOn(e.target.checked)}
                      className="mt-0.5 size-3.5 accent-lime-400" />
                    <span>
                      Always on
                      <span className="block text-[11px] text-zinc-500">Keep the hook on screen until the end of the video.</span>
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">Language</label>
                    <select value={hookLanguage} onChange={(e) => setHookLanguage(e.target.value)}
                      className="w-full bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-sm text-zinc-200">
                      {HOOK_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">Placement</label>
                    <select value={hookPosition} onChange={(e) => changeHookPosition(e.target.value as Overlay["position"])}
                      className="w-full bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-sm text-zinc-200">
                      <option value="top">Top</option>
                      <option value="center">Center</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </div>
                </div>

                {/* Prompt, same brief-in / one-line-out flow as the App Store's Auto
                    Hook picker (/api/agents/hook/generate). Pulls this clip's real
                    transcript (when it went through the clip pipeline) or its own
                    generated title/caption as `content`, so the line actually
                    matches what THIS clip is about — and the Language dropdown +
                    whatever style the prompt asks for (emoji, slang, casing…) both
                    ride the request, not just decoration on the panel. */}
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">
                    What kind of hook? <span className="font-normal text-zinc-600">(guides tone/style/language — sent with this clip&apos;s content)</span>
                  </label>
                  <textarea value={hookPrompt} onChange={(e) => setHookPrompt(e.target.value)} rows={2}
                    placeholder="e.g. curiosity-gap question, casual Malay, add an emoji"
                    className="w-full bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none" />
                  <button type="button" onClick={generateHook} disabled={hookGenerating || !hookPrompt.trim()}
                    className="mt-1.5 w-full flex items-center justify-center gap-1.5 rounded-md py-2 text-[11px] font-bold uppercase tracking-wide disabled:opacity-40 transition-opacity"
                    style={{ background: "#65c000", color: "#0b0906" }}>
                    {hookGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                    {hookGenerating ? "Writing…" : "Generate hook line"}
                  </button>
                  {hookGenError && <p className="mt-1 text-[10px] text-red-400">{hookGenError}</p>}
                  <label className="mt-3 block text-[11px] font-semibold text-zinc-400" htmlFor="exact-hook-headline">Headline on video</label>
                  <textarea id="exact-hook-headline" value={generatedHook}
                    onChange={(e) => {
                      const value = e.target.value;
                      setGeneratedHook(value);
                      if (selected) setOverlays((prev) => prev.map((overlay) =>
                        overlay.itemId === selected.id && overlay.hookDesignId ? { ...overlay, text: value } : overlay));
                    }}
                    rows={3} maxLength={100}
                    placeholder={'POV: THE STORY BEHIND THIS\nOr write a quote across lines'}
                    className="mt-1 w-full resize-none rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-[12px] text-white placeholder:text-zinc-600 focus:border-lime-400/50 focus:outline-none" />
                  <p className="mt-1 text-[10px] text-zinc-500">Enter creates a separate headline line.</p>
                  {!selectedContent && selected && (
                    <p className="mt-1 text-[10px] text-zinc-600">No transcript or caption found for this clip, the hook will be based on your prompt alone.</p>
                  )}
                </div>

                {(() => {
                  const hookOverlay = selectedOverlays.find((o) => o.hookDesignId);
                  if (!hookOverlay) return null;
                  const isBurned = !!selected?.hookBurned && !hookEditOverrideIds.has(selected.id);
                  if (isBurned) {
                    return (
                      <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-[11px] text-zinc-400">
                          This hook is already burned into the video, the preview no longer draws it on top.
                        </p>
                        <button type="button"
                          onClick={() => setHookEditOverrideIds((prev) => new Set(prev).add(selected!.id))}
                          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 py-1.5 text-[10.5px] font-semibold text-zinc-300 hover:border-lime-400/50 hover:text-lime-300 transition-colors">
                          Change hook text
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-zinc-400">
                          <span>Font size</span>
                          <span className="tabular-nums text-zinc-300">{Math.round((hookOverlay.hookFontScale ?? 1) * 100)}%</span>
                        </div>
                        <input type="range" min={50} max={220} step={2}
                          value={Math.round((hookOverlay.hookFontScale ?? 1) * 100)}
                          onChange={(e) => {
                            const scale = Number(e.target.value) / 100;
                            setOverlays((prev) => prev.map((o) => o.id === hookOverlay.id ? { ...o, hookFontScale: scale } : o));
                          }}
                          className="w-full accent-lime-400" />
                        <p className="mt-1 text-[10px] text-zinc-600">Changes live in the preview, Apply burns it into the video at this size.</p>
                      </div>
                      <button type="button"
                        onClick={() => setOverlays((prev) => prev.map((o) => o.id === hookOverlay.id ? { ...o, oy: undefined } : o))}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 py-1.5 text-[10.5px] font-semibold text-zinc-400 hover:border-white/30 hover:text-zinc-200 transition-colors">
                        Reset position (drag the hook in the preview to move it)
                      </button>
                      <button type="button"
                        disabled={hookStyleSaved === "saving" || !sessionId}
                        onClick={async () => {
                          if (!sessionId || !hookOverlay.hookDesignId) return;
                          await saveHookAgentStyle({
                            designId: hookOverlay.hookDesignId,
                            text: hookOverlay.text,
                            position: hookOverlay.position,
                            durationSec: hookOverlay.endSec - hookOverlay.startSec,
                            fontScale: hookOverlay.hookFontScale ?? 1,
                            yPct: overlayYPct(hookOverlay),
                            alwaysOn: hookAlwaysOn,
                          });
                        }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[10.5px] font-bold uppercase tracking-wide transition-opacity disabled:opacity-40"
                        style={{ background: hookStyleSaved === "saved" ? "#22c55e" : "#65c000", color: "#0b0906" }}>
                        {hookStyleSaved === "saving" ? "Saving…" : hookStyleSaved === "saved" ? "Style saved, applies to all videos" : hookStyleSaved === "error" ? "Save failed, retry" : "Save as agent style"}
                      </button>
                      <button type="button" onClick={clearHookDesign}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 py-1.5 text-[10.5px] font-semibold text-zinc-400 hover:border-red-400/50 hover:text-red-400 transition-colors">
                        <X className="size-3" /> Remove hook text
                      </button>
                    </div>
                  );
                })()}

                {/* Persistent OFF — no text hook on this video OR any future one.
                    Always visible (works even with no design applied yet). */}
                <button type="button"
                  disabled={hooksOffState === "saving"}
                  onClick={() => { clearHookDesign(); void persistOverlayOff("clip.hook", hookSkillRow, "Auto Hook", setHooksOffState); }}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[10.5px] font-bold uppercase tracking-wide transition-colors disabled:opacity-50 ${
                    hooksOffState === "saved" ? "border-lime-400/60 text-lime-300" : "border-red-400/40 text-red-300 hover:border-red-400 hover:bg-red-400/10"
                  }`}>
                  {hooksOffState === "saving" ? "Saving…"
                    : hooksOffState === "saved" ? "✓ Text hooks off for all videos"
                    : hooksOffState === "error" ? "Save failed — tap to retry"
                    : "Turn OFF text hooks (all videos)"}
                </button>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">Type of text</label>
                  <div className="space-y-2.5">
                    {HOOK_DESIGNS.map((d) => {
                      const active = selectedOverlays.some((o) => o.hookDesignId === d.id);
                      return (
                        <motion.button key={d.id} type="button" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                          onClick={() => void applyHookDesign(d.id)} disabled={!selected || hookGenerating}
                          className={`relative w-full overflow-hidden rounded-xl border-2 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            active ? "border-lime-400 bg-lime-400/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                          }`}
                        >
                          <div className="flex items-center justify-center px-4 py-6 bg-black">
                            {/* Fixed reference scale (~320px card width vs. the design's
                                1080px authoring canvas), same real-size mapping the
                                canvas preview uses, just not ResizeObserver-driven here
                                since the drawer card's box is a fixed layout. */}
                            <HookHeadlinePreview design={d} text={generatedHook.trim() ? generatedHook.trim().slice(0, 60) : "THE STORY BEHIND THIS"}
                              fontPx={d.render.fontSize * 0.25} compact />
                          </div>
                          <div className="flex items-center justify-between px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-[12px] font-semibold text-zinc-100">{d.name} <span className="text-zinc-500 font-normal">· {d.theme}</span></p>
                              <p className="text-[10.5px] text-zinc-500 truncate">{d.blurb}</p>
                            </div>
                            {active && (
                              <span className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-lime-400 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#0b0906]">
                                <Check className="size-2.5" /> In use
                              </span>
                            )}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Music drawer, same track catalog + folder grouping as the Clipping
            tab's Trending Audio node-inspector picker. */}
        <AnimatePresence>
          {musicPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <audio ref={musicPreviewRef} onEnded={() => setMusicPreviewId(null)} hidden />
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Music</p>
                  <p className="text-[10.5px] text-zinc-500">Background track, one per clip.</p>
                </div>
                <button type="button" onClick={() => setMusicPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                {!selected ? (
                  <p className="text-xs text-zinc-500">Select a clip on the timeline first, then pick a track below.</p>
                ) : (
                  <>
                    {/* Auto-select best song — same "AI decides, operator can
                        still override" split as Sound Effect/Trending Audio
                        on the Clipping canvas. Checking this picks NO explicit
                        track; the burn route's existing mood-matched fallback
                        (pickTrendingTrackByMood) auto-picks one at render time. */}
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                      <span className="text-[11.5px] font-medium text-zinc-200">Auto-select best song</span>
                      <Switch size="sm" checked={selected.autoMusic === true} onCheckedChange={toggleAutoMusic} />
                    </label>
                    {selected.autoMusic && (
                      <p className="text-[10.5px] leading-relaxed text-zinc-500">
                        A mood-matched track is picked automatically when you Apply — no need to browse the list below.
                      </p>
                    )}

                    {/* Loudness — always visible, always sent (server default is
                        20% when unset). Same quadratic-taper 0-100 scale the
                        Clipping canvas's Trending Audio node uses, so a given
                        % reads the same loudness in both places. */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-zinc-400">Music volume</label>
                        <span className="text-xs font-bold text-lime-400">{selected.musicVolumePct ?? 20}%</span>
                      </div>
                      <Slider
                        value={selected.musicVolumePct ?? 20}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={(v) => setMusicVolume(Math.max(0, Math.min(100, (Array.isArray(v) ? v[0] : v) as number)))}
                        className="[&_[data-slot=slider-range]]:bg-lime-400 [&_[data-slot=slider-thumb]]:border-lime-400"
                      />
                      <p className="mt-1 text-[10px] text-zinc-600">Music plays UNDER the clip — low keeps speech clear.</p>
                    </div>

                    {/* Your own tracks — uploaded to R2, remembered per agent. */}
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Your tracks</p>
                        <button type="button" onClick={() => musicFileInputRef.current?.click()} disabled={musicUploading}
                          className="flex items-center gap-1 rounded-md border border-lime-400/50 px-2 py-1 text-[10.5px] font-semibold text-lime-300 hover:bg-lime-400/10 disabled:opacity-50">
                          {musicUploading ? <Loader2 className="size-3 animate-spin" /> : <UploadIcon className="size-3" />}
                          {musicUploading ? "Uploading…" : "Upload track"}
                        </button>
                        <input ref={musicFileInputRef} type="file" accept="audio/*,.mp3,.m4a,.wav" hidden onChange={(e) => void handleMusicUpload(e.target.files)} />
                      </div>
                      {musicUploadError && <p className="text-[10px] text-red-400">{musicUploadError}</p>}
                      {customTracks.length === 0
                        ? <p className="text-[10px] text-zinc-600">MP3 / M4A / WAV, up to 200 MB. Stored on your media bucket and usable on every clip.</p>
                        : (
                          <div className="grid grid-cols-2 gap-1.5">
                            {customTracks.map((t) => {
                              const active = selected?.musicCustomUrl === t.url;
                              const previewing = musicPreviewId === t.id;
                              return (
                                <div key={t.id}
                                  className={`group flex items-center gap-1.5 rounded-full border px-1.5 py-1 text-[11px] transition-colors ${
                                    active ? "border-lime-400 bg-lime-400/15 text-lime-200" : "border-white/10 bg-white/5 text-zinc-300"
                                  }`}>
                                  <button type="button" onClick={() => toggleMusicPreview(t.id, t.url)}
                                    className="grid size-5 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20">
                                    {previewing ? <Pause className="size-2.5" /> : <Play className="size-2.5 translate-x-px" />}
                                  </button>
                                  <button type="button" onClick={() => applyCustomTrack(t)} className="flex-1 truncate text-left" title={t.label}>{t.label}</button>
                                  <button type="button" onClick={() => removeCustomTrack(t.id)} aria-label="Remove track"
                                    className="grid size-4 shrink-0 place-items-center rounded-full text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-red-400">
                                    <X className="size-2.5" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                    </div>

                    {selectedMusicTrack && (
                      <button type="button" onClick={clearMusicTrack}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 py-1.5 text-[10.5px] font-semibold text-zinc-400 hover:border-red-400/50 hover:text-red-400 transition-colors">
                        <X className="size-3" /> Remove music ({selectedMusicTrack.label})
                      </button>
                    )}
                    {/* Every track used to render as a greyed-out, disabled chip
                        when the pack's base URL wasn't configured (the Supabase
                        bucket died) — "I cannot select the music". Say so instead. */}
                    {audioTracks.length > 0 && audioTracks.every((t) => !t.url) && (
                      <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[10.5px] leading-relaxed text-amber-200">
                        Music pack isn&apos;t configured on this server (TRENDING_AUDIO_BASE_URL unset), so tracks can&apos;t be picked or burned yet. Check /api/health/config.
                      </p>
                    )}
                    {audioGroups.map((group, gi) => (
                      <div key={gi}>
                        {group.label && <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">{group.label}</p>}
                        <div className="grid grid-cols-2 gap-1.5">
                          {group.tracks.map((t) => {
                            const active = selected?.musicTrackId === t.id;
                            const previewing = musicPreviewId === t.id;
                            return (
                              <div key={t.id}
                                className={`flex items-center gap-1.5 rounded-full border px-1.5 py-1 text-[11px] transition-colors ${
                                  active ? "border-lime-400 bg-lime-400/15 text-lime-200" : "border-white/10 bg-white/5 text-zinc-300"
                                }`}>
                                <button type="button" onClick={() => toggleMusicPreview(t.id, t.url)} disabled={!t.url}
                                  className="grid size-5 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30">
                                  {previewing ? <Pause className="size-2.5" /> : <Play className="size-2.5 translate-x-px" />}
                                </button>
                                <button type="button" onClick={() => applyMusicTrack(t.id)} disabled={!t.url}
                                  className="flex-1 truncate text-left disabled:opacity-30">
                                  {t.label}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sound Effect drawer — the Editor tab's clip.memeaudio equivalent:
            pick a PACK (which sound plays), the AI decides IF and WHICH
            bucket fires from a keyword the clip's own transcript actually
            says (see pickSfxFromKeywords). One pack per clip, same
            replace-not-stack model as Music. */}
        <AnimatePresence>
          {sfxPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <audio ref={sfxPreviewRef} onEnded={() => setSfxPreviewId(null)} hidden />
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Sound Effect</p>
                  <p className="text-[10.5px] text-zinc-500">Auto reaction sting, triggered by a keyword in the clip.</p>
                </div>
                <button type="button" onClick={() => setSfxPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                {!selected ? (
                  <p className="text-xs text-zinc-500">Select a clip on the timeline first, then pick a pack below.</p>
                ) : (
                  <>
                    {selectedSfxPack && (
                      <button type="button" onClick={clearSfxPack}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 py-1.5 text-[10.5px] font-semibold text-zinc-400 hover:border-red-400/50 hover:text-red-400 transition-colors">
                        <X className="size-3" /> Remove sound effect ({selectedSfxPack.label})
                      </button>
                    )}
                    <p className="text-[10.5px] leading-relaxed text-zinc-500">
                      The AI reads this clip&apos;s transcript for a trigger word (&ldquo;wait&rdquo;, &ldquo;lol&rdquo;, &ldquo;amazing&rdquo;…) and drops ONE matching sting at that exact moment — never forced onto a clip with nothing to react to. Pick which sound plays:
                    </p>
                    <div className="space-y-2">
                      {sfxPacks.map((pack) => {
                        const active = selected?.sfxPackId === pack.id;
                        return (
                          <button key={pack.id} type="button" onClick={() => applySfxPack(pack.id)}
                            className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                              active ? "border-lime-400 bg-lime-400/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                            }`}>
                            <div className="flex items-center justify-between">
                              <span className={`text-[12px] font-semibold ${active ? "text-lime-200" : "text-zinc-100"}`}>{pack.label}</span>
                              {active && (
                                <span className="flex items-center gap-1 rounded-full bg-lime-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#0b0906]">
                                  <Check className="size-2.5" /> In use
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {(["shock", "funny", "hype"] as const).map((bucket) => {
                                const sfxId = pack.stings[bucket];
                                const url = sfxUrlById.get(sfxId) ?? "";
                                const previewKey = `${pack.id}:${bucket}`;
                                const previewing = sfxPreviewId === previewKey;
                                return (
                                  <div key={bucket}
                                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleSfxPreview(previewKey, url); }} disabled={!url}
                                      className="grid size-4 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30">
                                      {previewing ? <Pause className="size-2" /> : <Play className="size-2 translate-x-px" />}
                                    </button>
                                    <span className="capitalize">{bucket}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Specials drawer — two independent, keyword/random-driven extras that
            don't fit the other tools: Zoom Punch (keyword-triggered, several
            punches per clip) and Filler Cut's random jump-cut mode (pure
            time-based, no transcript, a fresh pattern every burn). */}
        <AnimatePresence>
          {specialsPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Specials</p>
                  <p className="text-[10.5px] text-zinc-500">Keyword-triggered punches, random jump cuts, reference image.</p>
                </div>
                <button type="button" onClick={() => setSpecialsPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-5">
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-zinc-100">Vello Watermark</span>
                    <Switch size="sm" checked={velloWatermark} disabled={watermarkSaving || (!!mintAddress && agentForOverlayToggle === undefined)} onCheckedChange={toggleWatermark} />
                  </label>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-zinc-500">Adds the Made by Vello logo to every generated clip. Required on the free plan; paid plans can turn it off.</p>
                  {watermarkSaving && <p className="mt-1 text-[10px] text-zinc-400">Saving…</p>}
                  {watermarkError && <p role="alert" className="mt-1 text-[10px] text-red-400">{watermarkError}</p>}
                </div>
                {!selected ? (
                  <p className="text-xs text-zinc-500">Select a clip on the timeline first.</p>
                ) : (
                  <>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-zinc-100">Zoom Punch</span>
                        <Switch size="sm" checked={selected.zoomPunchOn === true} onCheckedChange={toggleZoomPunch} />
                      </label>
                      <p className="mt-1.5 text-[10.5px] leading-relaxed text-zinc-500">
                        Punches in wherever this clip&apos;s own transcript hits a keyword or emphasis word (same signal as Keyword Pop captions + the Sound Effect tool) — up to 4 beats, spaced apart. Never forced on a clip with nothing to punch on.
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-zinc-100">Filler Cut · Random</span>
                        <Switch size="sm" checked={selected.jumpCutsOn === true} onCheckedChange={toggleJumpCuts} />
                      </label>
                      <p className="mt-1.5 text-[10.5px] leading-relaxed text-zinc-500">
                        Removes a few random micro-windows — pure timing, not tied to filler words or a script. A fresh pattern every time you Apply, so re-running the same clip comes out looking genuinely different, not identical.
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-zinc-100">Multi Clips</span>
                        <Switch size="sm" checked={selected.multiSceneOn === true} onCheckedChange={toggleMultiScene} />
                      </label>
                      <p className="mt-1.5 text-[10.5px] leading-relaxed text-zinc-500">
                        Instead of one fixed crop for the whole clip, hard-cuts between a few randomly framed angles across it — the same footage reads as multiple scenes, more engaging than one static moment. Applies on your next clipping run.
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[12px] font-semibold text-zinc-100">Reference Image</p>
                      <p className="mt-1.5 text-[10.5px] leading-relaxed text-zinc-500">
                        Burns a small bordered card in the corner of this clip — a real photo of what you&apos;re talking about, so viewers SEE the story, not just hear it. Upload any screenshot or photo below to attach it manually.
                      </p>
                      <p className="mt-1.5 text-[10.5px] leading-relaxed text-zinc-500">
                        For a news-commentary idea (Ideas tab), this attaches automatically: the render step screenshots the actual source article and crops it tight to the real headline — the same page you&apos;d screenshot yourself to show &quot;here&apos;s the story&quot;. That algo, in order: (1) screenshot the article, (2) find its real headline vs. the site&apos;s logo/masthead by picking the longest heading on the page, (3) crop + pad it into a clean card, (4) burn it in this corner for the whole clip. A dead or moved source link is detected and skipped rather than showing an error page as if it were the headline.
                      </p>
                      <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2">
                        <span className="text-[11px] text-zinc-300">Auto-attach for news ideas</span>
                        <Switch size="sm" checked={newsImageOverlayEnabled} disabled={savingOverlayToggle} onCheckedChange={setNewsImageOverlayEnabled} />
                      </div>
                      {selected.referenceImageUrl ? (
                        <div className="mt-2.5 flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={selected.referenceImageUrl} alt="" className="size-12 shrink-0 rounded border border-white/10 object-cover" />
                          <button type="button" onClick={() => setReferenceImage(undefined)}
                            className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/10">
                            Remove
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={triggerUpload} disabled={uploading}
                          className="mt-2.5 w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 py-2.5 text-xs text-zinc-300 hover:border-lime-400/60">
                          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                          {uploading ? "Uploading…" : "Capture / upload image"}
                        </button>
                      )}
                      {uploads.filter((a) => a.kind === "image").length > 0 && (
                        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                          {uploads.filter((a) => a.kind === "image").slice(0, 8).map((a) => (
                            <button key={a.id} type="button" onClick={() => setReferenceImage(a.url)}
                              className="aspect-square overflow-hidden rounded border border-white/10 hover:border-lime-400/60">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={a.url} alt={a.name} className="size-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Intro & CTA drawer. Uploads are passed to the current clipping pipeline
            and applied to every generated clip when the operator runs Clip. */}
        <AnimatePresence>
          {introCtaPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Intro & CTA</p>
                  <p className="text-[10.5px] text-zinc-500">Applied to every video in your next clipping run.</p>
                </div>
                <button type="button" onClick={() => setIntroCtaPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-5">
                {!selected ? (
                  <p className="text-xs text-zinc-500">Select a clip on the timeline first.</p>
                ) : (
                  <>
                    {/* Intro */}
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Intro (plays first)</p>
                      {selected.introUrl ? (
                        <div className="flex items-center gap-2 rounded-lg border border-lime-400/30 bg-lime-400/10 px-2.5 py-2">
                          <Film className="size-3.5 shrink-0 text-lime-300" />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-lime-200">Intro clip attached</span>
                          <button type="button" onClick={clearIntroVideo} className="shrink-0 text-zinc-400 hover:text-red-400"><X className="size-3.5" /></button>
                        </div>
                      ) : (
                        <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 py-3 text-[11px] font-semibold text-zinc-400 hover:border-lime-400/50 hover:text-lime-300 transition-colors">
                          {introUploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
                          {introUploading ? "Uploading…" : "Upload intro video"}
                          <input type="file" accept="video/*" hidden disabled={introUploading}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void setIntroVideo(f); e.target.value = ""; }} />
                        </label>
                      )}
                    </div>
                    {/* CTA */}
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">CTA (plays last)</p>
                      {selected.ctaUrl ? (
                        <div className="flex items-center gap-2 rounded-lg border border-lime-400/30 bg-lime-400/10 px-2.5 py-2">
                          <Film className="size-3.5 shrink-0 text-lime-300" />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-lime-200">CTA clip attached</span>
                          <button type="button" onClick={clearCtaVideo} className="shrink-0 text-zinc-400 hover:text-red-400"><X className="size-3.5" /></button>
                        </div>
                      ) : (
                        <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 py-3 text-[11px] font-semibold text-zinc-400 hover:border-lime-400/50 hover:text-lime-300 transition-colors">
                          {ctaUploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
                          {ctaUploading ? "Uploading…" : "Upload CTA video"}
                          <input type="file" accept="video/*" hidden disabled={ctaUploading}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void setCtaVideo(f); e.target.value = ""; }} />
                        </label>
                      )}
                    </div>

                    {(selected.introUrl || selected.ctaUrl) && (
                      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[10.5px] leading-relaxed text-zinc-400">
                        <Check className="size-3.5 shrink-0 text-lime-300" />
                        Saved for all clips in the next run. Press Clip when you are ready.
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Overlay drawer (renamed from "Upload"), a gallery of previously
            uploaded images + upload-new, stays open so you can drop several
            onto the canvas in a row. */}
        <AnimatePresence>
          {overlayPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Overlay</p>
                  <p className="text-[10.5px] text-zinc-500">Images or video on top of the video, logos, stickers, PiP.</p>
                </div>
                <button type="button" onClick={() => setOverlayPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-[11px] text-zinc-500">
                  {selected ? <>Tap one to drop it onto <span className="text-zinc-300">{selected.title}</span>, then drag to move, drag the corner to resize.</>
                    : "Select a clip on the timeline first."}
                </p>
                <button type="button" onClick={triggerUpload} disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 py-3 text-xs text-zinc-300 hover:border-lime-400/60">
                  {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                  {uploading ? "Uploading…" : "Upload image or video"}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {uploads.map((a) => (
                    <button key={a.id} type="button" onClick={() => addMediaOverlay(a.url, a.kind)} disabled={!selected}
                      className="rounded-lg border border-white/10 hover:border-lime-400/60 bg-white/5 p-1.5 transition-colors disabled:opacity-40">
                      <div className="relative aspect-square w-full rounded overflow-hidden bg-black">
                        {a.kind === "video"
                          ? <LazyVideo src={a.url} muted preload="metadata" className="w-full h-full object-cover" />
                          /* eslint-disable-next-line @next/next/no-img-element */
                          : <img src={a.url} alt={a.name} className="w-full h-full object-cover" />}
                        {a.kind === "video" && (
                          <span className="absolute right-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[8px] font-bold uppercase text-zinc-300">PiP</span>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] text-zinc-400 truncate">{a.name}</p>
                    </button>
                  ))}
                </div>
                {uploads.length === 0 && (
                  <p className="text-xs text-zinc-500 px-1 py-4 text-center">Nothing uploaded yet.</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filters drawer — live CSS preview backed by the same named FFmpeg
            chains used by the clipping-flow Video Filters skill. */}
        <AnimatePresence>
          {filterPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-[26rem] overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Filters</p>
                  <p className="text-[10.5px] text-zinc-500">Premium grades and real HD detail enhancement.</p>
                </div>
                <button type="button" onClick={() => setFilterPanelOpen(false)} className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="space-y-4 p-4">
                {!selected ? (
                  <p className="text-xs text-zinc-500">Select a clip on the timeline first.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {FILTER_CHIPS.map((chip) => {
                        const active = (selected.filterPreset ?? "") === chip.id;
                        return (
                          <motion.button key={chip.id || "none"} type="button" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                            onClick={() => setVideoFilter({ filterPreset: chip.id || undefined })}
                            className={`overflow-hidden rounded-xl border-2 text-left transition-colors ${active ? "border-lime-400 bg-lime-400/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}>
                            <div className="h-20" style={{
                              background: "linear-gradient(115deg, #f7c798 0%, #e87965 28%, #cb3f72 48%, #3f83e8 72%, #28bf82 100%)",
                              ...chip.css,
                            }} />
                            <div className="space-y-0.5 p-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11.5px] font-semibold text-zinc-100">{chip.label}</span>
                                {active && <Check className="size-3.5 text-lime-400" />}
                              </div>
                              <p className="text-[9.5px] leading-snug text-zinc-500">{FILTER_DESCRIPTIONS[chip.id]}</p>
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-zinc-400">
                          <span>Saturation</span><span className="tabular-nums text-zinc-300">{(selected.filterSaturation ?? 1).toFixed(2)}×</span>
                        </div>
                        <input type="range" min={0} max={2} step={0.05} value={selected.filterSaturation ?? 1}
                          onChange={(e) => setVideoFilter({ filterSaturation: Number(e.target.value) })} className="w-full accent-lime-400" />
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-zinc-400">
                          <span>Brightness</span><span className="tabular-nums text-zinc-300">{(selected.filterBrightness ?? 0) >= 0 ? "+" : ""}{(selected.filterBrightness ?? 0).toFixed(2)}</span>
                        </div>
                        <input type="range" min={-0.5} max={0.5} step={0.02} value={selected.filterBrightness ?? 0}
                          onChange={(e) => setVideoFilter({ filterBrightness: Number(e.target.value) })} className="w-full accent-lime-400" />
                      </div>
                    </div>
                    <div className="rounded-xl border border-lime-400/20 bg-lime-400/[0.05] p-3 text-[10.5px] leading-relaxed text-zinc-400">
                      <span className="font-semibold text-lime-300">HD Clarity</span> sharpens clean footage. <span className="font-semibold text-lime-300">Super HD</span> first reduces compression noise, then restores fine and local detail before adding controlled vibrance. Apply burns the look into every frame.
                    </div>
                    <button type="button" onClick={clearVideoFilter}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 py-2 text-[10.5px] font-semibold text-zinc-400 hover:border-red-400/50 hover:text-red-300">
                      <X className="size-3" /> Reset filter
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Camera Settings drawer. Every tracked mode uses the detector's real
            timeline in both the canvas preview and the FFmpeg export. */}
        <AnimatePresence>
          {cameraPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 backdrop-blur-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Camera Settings</p>
                  <p className="text-[10.5px] text-zinc-500">How the frame follows the shot.</p>
                </div>
                <button type="button" onClick={() => setCameraPanelOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 space-y-2.5">
                {!selected ? (
                  <p className="text-xs text-zinc-500">Select a clip on the timeline first.</p>
                ) : (
                  <>
                    {CAMERA_MODES.map((m) => {
                      const active = (selected.framingMode ?? "auto") === m.id;
                      const detecting = active && m.id !== "full" && faceDetecting;
                      return (
                        <motion.button key={m.id} type="button" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                          onClick={() => void setFramingMode(m.id)}
                          className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors ${
                            active ? "border-lime-400 bg-lime-400/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                          }`}>
                          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? "bg-lime-400 text-[#0b0906]" : "bg-white/10 text-zinc-300"}`}>
                            {detecting ? <Loader2 className="size-4 animate-spin" /> : <Focus className="size-4" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-semibold text-zinc-100">{m.name}</span>
                            <span className="block text-[10.5px] text-zinc-500">
                              {detecting ? "Scanning faces across the clip (10 fps)…" : m.blurb}
                            </span>
                          </span>
                          {active && !detecting && <Check className="ml-auto size-4 shrink-0 text-lime-400" />}
                        </motion.button>
                      );
                    })}
                    {selected.framingMode === "zoom" && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-[11px] font-semibold text-zinc-400">Crop tightness</label>
                          <span className="text-[11px] text-zinc-300 tabular-nums">{Math.round((((selected.zoomAmount ?? FACE_CROP_MIN_ZOOM) - FACE_CROP_MIN_ZOOM) / (FACE_CROP_MAX_ZOOM - FACE_CROP_MIN_ZOOM)) * 100)}% tightness</span>
                        </div>
                        <input type="range" min={0} max={100} step={5} value={Math.round((((selected.zoomAmount ?? FACE_CROP_MIN_ZOOM) - FACE_CROP_MIN_ZOOM) / (FACE_CROP_MAX_ZOOM - FACE_CROP_MIN_ZOOM)) * 100)}
                          onChange={(e) => setZoomAmount(FACE_CROP_MIN_ZOOM + (Number(e.target.value) / 100) * (FACE_CROP_MAX_ZOOM - FACE_CROP_MIN_ZOOM))}
                          className="w-full accent-lime-400" />
                        <p className="mt-1.5 text-[10px] text-zinc-500">0% gives a little breathing room (90% of cover size). Soft fill protects the edges while the face stays centred.</p>
                      </div>
                    )}
                    {selected.framingMode !== "full" && !faceDetecting && selected.faceShots && selected.faceShots.some((sh) => sh.confident) && (
                      <p className={`text-[10.5px] px-1 ${selected.framingMode === "dual" && (selected.faceMaxCount ?? 0) < 2 ? "text-amber-400" : "text-lime-400"}`}>
                        {(() => {
                          const n = selected.faceShots.filter((sh) => sh.confident).length;
                          const people = selected.faceMaxCount ?? 1;
                          if (selected.framingMode === "dual") {
                            return people >= 2
                              ? "✓ Two faces tracked — left face on top, right face below. The preview and export use the same live crop path."
                              : "Only one face is visible right now — Dual automatically uses the single-person crop until both faces appear.";
                          }
                          return `✓ ${people >= 2 ? `${people} people` : "Speaker"} tracked, ${n} shot${n === 1 ? "" : "s"} — eased cuts, smooth follow. Same algorithm as the lab; the export crops exactly this.`;
                        })()}
                      </p>
                    )}
                    {faceDetectError && <p className="text-[10.5px] text-amber-400 px-1">{faceDetectError}</p>}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* B-Roll drawer — stock PHOTO + VIDEO search (Pexels / Openverse) or
            your own uploaded library; all drop onto the canvas the same way
            the Overlay drawer's images do. Defaults to video, auto-searched
            from the clip's own content the moment the drawer opens. */}
        <AnimatePresence>
          {brollPanelOpen && (
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.9 }}
              className="absolute inset-y-0 right-24 z-30 w-80 overflow-y-auto editor-scroll border-l border-white/10 bg-[#141210]/85 backdrop-blur-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 bg-[#141210]/85 backdrop-blur-2xl">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">B-Roll</p>
                    <p className="text-[10.5px] text-zinc-500">Cutaway photos or video, stock or your own.</p>
                  </div>
                  <button type="button" onClick={() => setBrollPanelOpen(false)}
                    className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="flex border-b border-white/10">
                  {(["stock", "uploads"] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setBrollTab(t)}
                      className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide ${brollTab === t ? "text-lime-400 border-b-2 border-lime-400" : "text-zinc-500"}`}>
                      {t === "stock" ? "Stock" : "My uploads"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-[11px] text-zinc-500">
                  {selected ? <>Tap one to drop it onto <span className="text-zinc-300">{selected.title}</span>.</>
                    : "Select a clip on the timeline first."}
                </p>
                {brollTab === "stock" ? (
                  <>
                    {/* Video first (default) — matches the drawer's default
                        auto-search kind below. */}
                    <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                      {(["video", "photo"] as const).map((k) => (
                        <button key={k} type="button"
                          onClick={() => { setStockKind(k); if (stockQuery.trim()) void searchStock(stockQuery, k); }}
                          className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold capitalize transition-colors ${
                            stockKind === k ? "bg-lime-400 text-[#0b0906]" : "text-zinc-400 hover:text-zinc-200"
                          }`}>
                          {k}s
                        </button>
                      ))}
                    </div>
                    <form onSubmit={(e) => { e.preventDefault(); void searchStock(); }} className="flex gap-1.5">
                      <input value={stockQuery} onChange={(e) => setStockQuery(e.target.value)}
                        placeholder={`Search stock ${stockKind}s…`}
                        className="flex-1 bg-white/5 border border-white/15 rounded-md px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600" />
                      <button type="submit" disabled={stockLoading || !stockQuery.trim()}
                        className="rounded-md px-3 disabled:opacity-40" style={{ background: "#65c000", color: "#0b0906" }}>
                        {stockLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                      </button>
                    </form>
                    {stockError && <p className="text-[10px] text-red-400">{stockError}</p>}
                    {stockNotice && <p className="text-[10px] leading-relaxed text-amber-400/90">{stockNotice}</p>}
                    <div className="grid grid-cols-3 gap-1.5">
                      {stockResults.map((r) => (
                        <button key={r.id} type="button" onClick={() => addMediaOverlay(r.url, r.kind === "video" ? "video" : "image")} disabled={!selected}
                          title={r.title}
                          className="relative aspect-square rounded-md overflow-hidden border border-white/10 hover:border-lime-400/60 bg-black disabled:opacity-40">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.thumbnail} alt={r.title} className="w-full h-full object-cover" />
                          {r.kind === "video" && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <Play className="size-5 text-white drop-shadow" />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    {stockResults.length === 0 && !stockLoading && !stockNotice && (
                      <p className="text-xs text-zinc-500 px-1 py-4 text-center">Search for free stock {stockKind}s.</p>
                    )}
                  </>
                ) : (
                  <>
                    <button type="button" onClick={triggerUpload} disabled={uploading}
                      className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 py-3 text-xs text-zinc-300 hover:border-lime-400/60">
                      {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                      {uploading ? "Uploading…" : "Upload image"}
                    </button>
                    <div className="grid grid-cols-3 gap-1.5">
                      {uploads.filter((a) => a.kind === "image").map((a) => (
                        <button key={a.id} type="button" onClick={() => addMediaOverlay(a.url, "image")} disabled={!selected}
                          className="aspect-square rounded-md overflow-hidden border border-white/10 hover:border-lime-400/60 bg-black disabled:opacity-40">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                    {uploads.filter((a) => a.kind === "image").length === 0 && (
                      <p className="text-xs text-zinc-500 px-1 py-4 text-center">No images uploaded yet.</p>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Right rail */}
        <div className="w-24 shrink-0 border-l border-white/10 bg-black/20 backdrop-blur-xl flex flex-col items-center gap-5 py-6 overflow-y-auto editor-scroll">
          {railLabels.map((label) => {
            const Icon = railIcons[label];
            // Caption and Text Hooks are single-layer, replace-on-pick overlays —
            // give them a live on/off dot right on the rail (same idea as a mute
            // switch) so turning one off doesn't require opening its drawer and
            // finding the "Remove" button first.
            const isCaption = label === "Caption";
            const isHook = label === "Text Hooks";
            const isPostCaption = label === "Post Captions";
            const active = isCaption
              ? selectedOverlays.some((o) => o.presetId)
              : isHook
              ? selectedOverlays.some((o) => o.hookDesignId)
              : isPostCaption
              ? !!selected?.postCaption?.trim()
              : false;
            const turnOff = isCaption ? clearCaptionPreset : isHook ? clearHookDesign
              : isPostCaption ? () => { const id = selected?.id; if (id) setTimeline((prev) => prev.map((t) => (t.id === id ? { ...t, postCaption: "" } : t))); }
              : undefined;
            return (
              <button key={label} type="button" onClick={() => onRailClick(label)}
                className="relative flex flex-col items-center gap-1.5 text-[10px] text-zinc-300 hover:text-lime-400">
                <Icon className="size-5" />
                {label}
                {turnOff && active && (
                  <span
                    role="button"
                    tabIndex={0}
                    title={`Turn off ${label.toLowerCase()}`}
                    onClick={(e) => { e.stopPropagation(); turnOff(); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); turnOff(); } }}
                    className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-lime-400 text-black hover:bg-red-400"
                  >
                    <X className="size-2.5" strokeWidth={3} />
                  </span>
                )}
                {COMING_SOON.has(label) && comingSoon === label && (
                  <span className="absolute -top-1 right-0 translate-x-full whitespace-nowrap bg-zinc-800 text-white text-[9px] px-1.5 py-0.5 rounded">
                    Coming soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
        </div>

      {/* Bottom: elements only (timeline clip strip removed per request) */}
      <div className="shrink-0 border-t border-white/10 max-h-56 overflow-y-auto editor-scroll">
        {selectedOverlays.length > 0 && (
          <div className="px-6 pb-4 flex flex-wrap gap-1.5">
            {/* Just the element's NAME as a chip, no full text/position editor
                here; captions/hooks/overlays are configured in their own drawers. */}
            {selectedOverlays.map((o) => {
              const label = o.presetId ? `Caption · ${CAPTION_PRESET_BY_ID[o.presetId]?.name ?? "Style"}`
                : o.hookDesignId ? `Hook · ${HOOK_DESIGN_BY_ID[o.hookDesignId]?.name ?? "Design"}`
                : (o.imageUrl || o.videoUrl) ? `Overlay · ${o.videoUrl ? "Video" : "Image"}`
                : `Text · ${o.text.slice(0, 18)}${o.text.length > 18 ? "…" : ""}`;
              return (
                <span key={o.id} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 pl-2.5 pr-1.5 py-1 text-[10.5px] text-zinc-300">
                  {label}
                  <button type="button" onClick={() => removeOverlay(o.id)} className="rounded-full p-0.5 text-zinc-500 hover:bg-white/10 hover:text-red-400">
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>
      </div>

      <ApplyPostModal
        open={applyModalOpen}
        phase={applyModalPhase}
        videoUrl={applyModalVideoUrl}
        error={applyModalError}
        warning={applyModalWarning}
        mintAddress={mintAddress}
        initialCaption={applyModalCaption}
        onClose={() => setApplyModalOpen(false)}
      />

      <ClipRunModal
        open={clipRunOpen}
        progress={clipRunProgress}
        job={editorClipJob}
        onViewResults={onViewResults}
        onClose={() => setClipRunOpen(false)}
        totalCredits={clipRunTotalCredits}
      />
    </div>
  );
}
