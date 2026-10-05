"use client";

/* ════════ /dev/captions-lab — caption template gallery ════════
   Phone-frame (9:16) preview per template, animated with the REAL burn spec —
   font size, outline width/color, shadow, pill background, vertical position
   all computed the same way lib/server/captionRenderer.ts computes them for
   the actual ffmpeg burn, not an approximated CSS swatch. No editor here —
   new templates go straight into lib/builder/captionPresets.ts. */

import { useEffect, useMemo, useState } from "react";
import { LabTabs } from "@/components/dev-lab/lab-tabs";
import { CAPTION_PRESETS, type CaptionPresetRender } from "@/lib/builder/captionPresets";
import { computePreviewFrame, computeCollageFrame, PREVIEW_LOOP_SEC, type PreviewFrame } from "@/lib/builder/captionPreview";

/** Ticks each card's own clock. Throttled to ~12fps (not rAF) — with every
 *  preset animating at once, a plain interval keeps ~20 concurrent loops
 *  cheap; word-level caption timing reads just as smooth at 12fps as 60fps. */
function useLoopClock(loopSec: number): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = setInterval(() => setT(((performance.now() - start) / 1000) % loopSec), 80);
    return () => clearInterval(id);
  }, [loopSec]);
  return t;
}

/* Fonts the real burn uses: ffmpeg/libass is pointed at assets/fonts
   (subtitlesFilter → fontsdir), so the preview loads those SAME .ttf files
   (copied to /public/fonts/captions) under the exact ASS family names. */
const BURN_FONTS: Array<[family: string, file: string]> = [
  ["Manrope Medium", "Manrope-Medium.ttf"], ["Manrope", "Manrope-Medium.ttf"],
  ["Montserrat SemiBold", "Montserrat-SemiBold.ttf"], ["Montserrat", "Montserrat-SemiBold.ttf"],
  ["Space Grotesk Medium", "SpaceGrotesk-Medium.ttf"], ["Space Grotesk", "SpaceGrotesk-Medium.ttf"],
  ["Plus Jakarta Sans SemiBold", "PlusJakartaSans-SemiBold.ttf"], ["Plus Jakarta Sans", "PlusJakartaSans-SemiBold.ttf"],
  ["Fraunces 144pt SemiBold", "Fraunces-SemiBold.ttf"], ["Fraunces", "Fraunces-SemiBold.ttf"],
  ["Anton", "Anton-Regular.ttf"], ["Bebas Neue", "BebasNeue-Regular.ttf"],
  ["Barlow", "Barlow-SemiBold.ttf"], ["Archivo Black", "ArchivoBlack-Regular.ttf"],
  ["Poppins SemiBold", "Poppins-SemiBold.ttf"], ["Poppins", "Poppins-SemiBold.ttf"],
  ["Satisfy", "Satisfy-Regular.ttf"],
];
const BURN_FAMILIES = new Set(BURN_FONTS.map(([f]) => f));
const BURN_FONT_CSS = BURN_FONTS.map(([f, file]) =>
  `@font-face{font-family:"lab ${f}";src:url("/fonts/captions/${file}") format("truetype");font-weight:100 900;font-display:block}`).join("");
/** Bundled family → its loaded face. Anything NOT bundled (Arial, Georgia,
 *  Nunito…) is what libass can't find in fontsdir, so the burn falls back to the
 *  container default — mirror that instead of showing a font the burn won't use. */
const burnFont = (name?: string | null): string | undefined => {
  if (!name) return undefined;
  const bare = name.replace(/^['"]|['"]$/g, "").split(",")[0].trim().replace(/^['"]|['"]$/g, "");
  return BURN_FAMILIES.has(bare) ? `"lab ${bare}"` : `"DejaVu Sans", Verdana, sans-serif`;
};

const outlineShadow = (px: number, color: string): string | undefined => {
  if (px <= 0) return undefined;
  return [
    `-${px}px -${px}px 0 ${color}`, `${px}px -${px}px 0 ${color}`,
    `-${px}px ${px}px 0 ${color}`, `${px}px ${px}px 0 ${color}`,
  ].join(", ");
};

/** One phone-frame caption stage, styled straight off the render spec (the
 *  same numbers lib/server/captionRenderer.ts feeds into the ASS burn):
 *  fontSize/outline/shadow are the preset's raw values scaled from the
 *  1080-wide burn canvas down to `framePx`; vertical position mirrors the
 *  renderer's fixed ~19%-from-bottom (portrait) baseMarginV, unconditional on
 *  the preset; pillBg/outlineColor/borderStyle-3 box behavior matches 1:1. */
function CaptionStage({ render, t, framePx }: { render: CaptionPresetRender; t: number; framePx: number }) {
  const frame: PreviewFrame = useMemo(() => computePreviewFrame(render, t), [render, t]);
  const scale = framePx / 1080;
  const fontSizePx = render.fontSize * scale;
  const outlinePx = render.outline * scale;
  const outlineColor = render.outlineColor ?? "#000000";
  // ASS `Shadow` is a hard OFFSET duplicate of the glyph (not a gaussian
  // blur) — a flat, unblurred drop-shadow is the closer CSS analogue.
  const shadowPx = (render.shadow ?? 0) * scale;

  let lineCount = 0;
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-white/10 bg-[#0a0b0d]">
      <video
        src="/captions-lab-sample.mp4"
        className="absolute inset-0 size-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
      {/* Slightly stronger + rebalanced than a flat vignette — the bottom band
          (where every caption AND the Made by Vello mark live) stays reliably
          dark against any footage, so white type never gets caught on a bright
          frame; the top keeps a light touch so the shot itself still reads. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/25" />

      {render.layout === "collage" ? (
        <CollageLayer render={render} t={t} scale={scale} />
      ) : (
      /* renderCaptionsAss's baseMarginV: preset captions sit ~19% up from
         the bottom in portrait by default — UNLESS the preset opts into
         align:"left" (posOverride in presetEvents()), which pins the block
         to the top-left or bottom-left corner instead, alternating by page
         when spawnCorner:"alternate": an1 (bottom-left anchor) at y=64%/82%
         of the 1080x1920 canvas, both times — two nearby spots in the LOWER
         half, not one near the top of frame. */
      <div
        className={frame.leftAnchor ? "absolute left-[7%] flex" : "absolute inset-x-0 flex justify-center px-[6%]"}
        style={frame.leftAnchor ? { bottom: frame.leftAnchor.top ? "36%" : "18%" } : { bottom: "19%" }}
      >
        {frame.empty ? null : (
          <div
            className={frame.leftAnchor ? "text-left leading-tight" : "text-center leading-tight"}
            style={{
              opacity: frame.entranceOpacity,
              transform: `scale(${frame.entranceScalePercent / 100})`,
              transformOrigin: frame.leftAnchor ? "left" : "center",
              background: render.pillBg,
              padding: render.pillBg ? `${2 * scale}px ${8 * scale}px` : undefined,
              borderRadius: render.pillBg ? 4 * scale : undefined,
              fontFamily: burnFont(render.font ?? "Arial"),
              fontStyle: render.italic ? "italic" : undefined,
              fontWeight: 800,
              fontSize: fontSizePx,
              // Photoshop-"Invert" knockout: pure white text + a difference
              // blend against everything painted behind it (the video, the
              // vignette) is a TRUE per-pixel inverse — difference(white, X)
              // = 255-X exactly, no approximation. Real-time, live, because
              // it's the browser compositing every frame, not a baked effect.
              mixBlendMode: render.blendInvert ? "difference" : undefined,
            }}
          >
            {frame.words.map((w, i) => {
              lineCount++;
              const breakHere = frame.stackAfter != null && lineCount > frame.stackAfter && (lineCount - 1) % frame.stackAfter === 0 && i > 0;
              return (
                <span key={w.key}>
                  {breakHere && <br />}
                  {/* Mirrors captionRenderer.ts's wordGap fix: a word that
                     pops to e.g. 130% grows past its normal advance width and
                     can visually crowd its neighbor across a single space —
                     both the real ASS burn (doubled literal space) and this
                     CSS preview (wider fixed spacer, since transform scale()
                     doesn't reflow layout the way a wider ASS glyph does)
                     widen the gap for every pair, only for scaling presets. */}
                  {i > 0 && !breakHere && (
                    (render.activeScale != null && render.activeScale !== 100)
                      || (render.wordScales?.length ?? 0) > 0
                      || (render.keywordScale != null && render.keywordScale !== 1)
                      ? <span style={{ display: "inline-block", width: fontSizePx * 0.45 }} />
                      : " "
                  )}
                  <span
                    style={{
                      display: "inline-block",
                      color: w.color ?? render.fontColor,
                      transform: `scale(${w.scalePercent / 100})`,
                      filter: w.blurPx > 0 ? `blur(${w.blurPx * scale}px)` : undefined,
                      textDecoration: w.underline ? "underline" : undefined,
                      textDecorationThickness: w.underline ? `${3 * scale}px` : undefined,
                      fontFamily: burnFont(w.keywordFont ?? w.ownFont),
                      fontStyle: w.keywordItalic ? "italic" : undefined,
                      textShadow: render.pillBg
                        ? undefined
                        : [
                          outlineShadow(outlinePx, outlineColor),
                          shadowPx > 0 ? `${shadowPx}px ${shadowPx}px 0 rgba(0,0,0,0.7)` : null,
                          // Glow halo — layered soft glows behind still-crisp
                          // text (mirrors the real dual-layer ASS technique:
                          // a bigger, more-blurred copy on a layer behind the
                          // sharp one), not a filter:blur on the glyph itself.
                          w.glow ? `0 0 ${fontSizePx * 0.12}px ${w.color ?? render.fontColor}` : null,
                          w.glow ? `0 0 ${fontSizePx * 0.3}px ${w.color ?? render.fontColor}` : null,
                          w.glow ? `0 0 ${fontSizePx * 0.6}px ${w.color ?? render.fontColor}` : null,
                        ].filter(Boolean).join(", ") || undefined,
                    }}
                  >
                    {w.text}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </div>
      )}
      <MadeByVello />
    </div>
  );
}

/** "MADE BY VELLO" mark — "MADE BY" on top, the real brand lockup PNG (exact
 *  logo file, not a CSS recreation) underneath, tight together. No chip, no
 *  tilt, no background: straight, quiet white type + mark on the footage —
 *  the Higgsfield-style minimal watermark, not a sticker. Legibility on any
 *  footage comes from a tight contact-shadow plus a soft ambient one. */
function MadeByVello() {
  return (
    <div
      className="pointer-events-none absolute bottom-[4%] left-[5%] z-20 flex select-none flex-col items-start gap-[3px]"
      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.55)) drop-shadow(0 2px 10px rgba(0,0,0,0.3))" }}
    >
      <span
        className="text-[6px] font-medium uppercase leading-none tracking-[0.32em] text-white/65"
        style={{ fontFamily: '"lab Manrope Medium", sans-serif' }}
      >
        Made by
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vello-logo-white.png" alt="Vello" className="h-[15px] w-auto object-contain" />
    </div>
  );
}

/** Collage layout renderer — every word absolutely positioned per
 *  computeCollageFrame (mirrors collageLayout()/collageEvents() in
 *  lib/server/captionRenderer.ts). `scale` converts the 1080-canvas
 *  coordinates computeCollageFrame works in down to this stage's framePx,
 *  same conversion CaptionStage already uses for fontSize/outline. */
function CollageLayer({ render, t, scale }: { render: CaptionPresetRender; t: number; scale: number }) {
  const frame = useMemo(() => computeCollageFrame(render, t), [render, t]);
  if (frame.empty) return null;
  return (
    <>
      {frame.slots.map((s) => (
        <span
          key={s.key}
          className="absolute"
          style={{
            left: s.xCenter * scale,
            top: s.y * scale,
            transform: `translate(-50%, -50%) rotate(${s.rotDeg}deg)`,
            fontSize: s.fontPx * scale,
            fontFamily: burnFont(s.fontFamily),
            fontStyle: s.italic ? "italic" : undefined,
            fontWeight: 800,
            color: s.color ?? render.fontColor,
            opacity: s.opacity,
            whiteSpace: "nowrap",
            textShadow: (render.shadow ?? 0) > 0 ? `${(render.shadow ?? 0) * scale}px ${(render.shadow ?? 0) * scale}px 0 rgba(0,0,0,0.7)` : undefined,
          }}
        >
          {s.text}
        </span>
      ))}
    </>
  );
}

function PresetCard({ name, blurb, render }: { name: string; blurb: string; render: CaptionPresetRender }) {
  const t = useLoopClock(PREVIEW_LOOP_SEC);
  return (
    <div>
      <CaptionStage render={render} t={t} framePx={220} />
      <p className="mt-2 text-[12.5px] font-semibold text-white">{name}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-white/40">{blurb}</p>
    </div>
  );
}

// Dropped from the lab showcase per operator request — Popline (dated purple-
// underline pop) and Beasty (MrBeast style). Still real rows in
// captionPresets.ts; only hidden from this gallery.
const HIDDEN_PRESET_IDS = new Set(["popline", "beasty"]);
const SHOWN_PRESETS = CAPTION_PRESETS.filter((p) => !HIDDEN_PRESET_IDS.has(p.id));

export default function CaptionsLabPage() {
  return (
    <div className="min-h-screen bg-[#08080a] px-6 py-6 text-white">
      <style dangerouslySetInnerHTML={{ __html: BURN_FONT_CSS }} />
      <LabTabs active="captions" />
      <div className="mx-auto max-w-6xl">
        <p className="mb-5 text-[11px] text-white/40">
          {SHOWN_PRESETS.length} looks, every one live in the product&apos;s Caption picker.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {SHOWN_PRESETS.map((p) => <PresetCard key={p.id} name={p.name} blurb={p.blurb} render={p.render} />)}
        </div>
      </div>
    </div>
  );
}
