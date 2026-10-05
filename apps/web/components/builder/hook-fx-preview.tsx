"use client";

import type { CSSProperties, ReactNode } from "react";
import { HOOK_FONT_FAMILY, burnFontStack } from "@/lib/builder/burnFonts";
import { hookFxLayout, isHookFxLayout, type HookDesign, type HookFxLayout, type HookMotion } from "@/lib/builder/hookDesigns";

/**
 * Browser mirror of the libass "fx" hook templates (lib/server/hookFxAss). Every
 * shape and line position comes from hookFxLayout — the geometry the burn uses —
 * scaled by `k` (preview px per burn px); the CSS keyframes copy the ASS timings
 * (clip-wipes, slide/rise, focus-in blur, per-word stagger, gloss sweep) so the
 * picker and the editor canvas show the same entrance the video gets.
 */

const KEYFRAMES = `
@keyframes hfxWipeL { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes hfxWipeR { from { clip-path: inset(0 0 0 100%); } to { clip-path: inset(0 0 0 0); } }
@keyframes hfxSlide { from { opacity: 0; transform: translateX(var(--hfx-dx)); } 58% { opacity: 1; } to { opacity: 1; transform: none; } }
@keyframes hfxRiseIn { from { opacity: 0; transform: translateY(var(--hfx-dy)); } to { opacity: 1; transform: none; } }
@keyframes hfxFocus { from { opacity: 0; transform: translateY(var(--hfx-dy)); filter: blur(var(--hfx-blur)); } to { opacity: 1; transform: none; filter: blur(0); } }
@keyframes hfxGrowX { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes hfxWord { from { opacity: 0; transform: scaleY(.72); filter: blur(var(--hfx-blur)); } to { opacity: 1; transform: none; filter: blur(0); } }
@keyframes hfxGloss { 0% { background-position: 130% 0; } 25%, 100% { background-position: -30% 0; } }
@keyframes hfxStreak { 0% { transform: translateX(-140%) skewX(-24deg); } 22%, 100% { transform: translateX(var(--hfx-sweep)) skewX(-24deg); } }
@media (prefers-reduced-motion: reduce) { .hfx-anim, .hfx-anim * { animation: none !important; } }
`;

const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
const fontOf = (token: string) => burnFontStack(HOOK_FONT_FAMILY[token]);
/** 2-decimal px so server and client print identical style strings (hydration). */
const r2 = (n: number) => Math.round(n * 100) / 100;

function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Diagonal blurred light streak (the premium "shine"), mirrored from shineEvents:
 *  sweeps across its `relative overflow-hidden` parent, first after `delaySec`,
 *  then every period. */
export function HookStreak({ motion, delaySec = 0.6, heightPx }: { motion?: HookMotion; delaySec?: number; heightPx?: number }) {
  // Band width: ~0.9× the box height when known (as burned), else a share of the box.
  if (!motion) return null;
  const { color, alpha, periodSec } = motion.shine;
  const sweepPct = Math.min(60, Math.round((0.85 / periodSec) * 100));
  const name = `hfxStreak${sweepPct}`;
  const band = heightPx ? `${r2(Math.max(8, heightPx * 0.9))}px` : "clamp(8px, 16%, 70px)";
  const blurPx = heightPx ? r2(Math.max(1, heightPx * 0.06)) : 1.5;
  return (
    <>
      <style>{`@keyframes ${name} { 0% { transform: translateX(-140%) skewX(-24deg); } ${sweepPct}%, 100% { transform: translateX(var(--hfx-sweep)) skewX(-24deg); } } @media (prefers-reduced-motion: reduce) { .hfx-streak { animation: none !important; opacity: 0; } }`}</style>
      <span aria-hidden className="hfx-streak pointer-events-none absolute inset-y-0 left-0"
        style={{
          width: band,
          ["--hfx-sweep" as string]: heightPx ? "1400%" : "800%",
          background: `linear-gradient(90deg, transparent, ${rgba(color, alpha)} 35%, ${rgba(color, Math.min(0.92, alpha * 2.1))} 50%, ${rgba(color, alpha)} 65%, transparent)`,
          filter: `blur(${blurPx}px)`,
          animation: `${name} ${periodSec}s linear ${delaySec}s infinite both`,
        } as CSSProperties} />
    </>
  );
}

/** The fx block on a burn-sized canvas scaled by k. `children` = drag handles,
 *  placed over the block's exact bounds. */
export function HookFxCanvas({ geo, k, motion, height, width, children }: {
  geo: HookFxLayout; k: number; motion?: HookMotion; width: number; height: number; children?: ReactNode;
}) {
  const px = (n: number) => r2(n * k);
  const blocks: ReactNode[] = [];

  if (geo.bar) {
    const bar = geo.bar;
    const left = geo.kind === "banner-left";
    const wipe = `${left ? "hfxWipeL" : "hfxWipeR"} 420ms ${EASE_OUT} both`;
    blocks.push(
      <div key="shadow" className="absolute" style={{ left: px(bar.x), top: px(bar.y + geo.size * 0.12), width: px(bar.w), height: px(bar.h), background: "rgba(0,0,0,.35)", filter: `blur(${px(geo.size * 0.25)}px)`, animation: wipe }} />,
      <div key="bar" className="absolute overflow-hidden" style={{ left: px(bar.x), top: px(bar.y), width: px(bar.w), height: px(bar.h), background: bar.color, animation: wipe }}>
        {geo.lines.map((line, i) => {
          const tk = line.tokens[0];
          return (
            <div key={i} className="absolute flex items-center whitespace-nowrap"
              style={{
                top: px(line.y - bar.y), height: px(line.h),
                ...(left ? { left: px(geo.textInset) } : { right: px(geo.textInset) }),
                fontFamily: fontOf(tk.font), fontSize: px(tk.size), lineHeight: 1, color: tk.color,
                ["--hfx-dx" as string]: `${(left ? -1 : 1) * px(geo.size * 0.9)}px`,
                animation: `hfxSlide 380ms linear ${240 + i * 90}ms both`,
              } as CSSProperties}>
              {tk.text}
            </div>
          );
        })}
        <div className="absolute inset-y-0 overflow-hidden" style={{ left: left ? 0 : px(bar.stripe.w), right: left ? px(bar.stripe.w) : 0 }}>
          <HookStreak motion={motion} delaySec={0.9} heightPx={px(bar.h)} />
        </div>
      </div>,
      <div key="stripe" className="absolute" style={{ left: px(bar.stripe.x), top: px(bar.stripe.y), width: px(bar.stripe.w), height: px(bar.stripe.h), background: bar.stripe.color, animation: `${left ? "hfxWipeL" : "hfxWipeR"} 180ms ${EASE_OUT} 300ms both` }} />,
    );
  }

  if (geo.gradient) {
    const g = geo.gradient;
    const stops = Array.from({ length: 9 }, (_, i) => `${rgba(g.color, r2(g.maxAlpha * Math.pow(1 - i / 8, 1.7)))} ${r2((i / 8) * 100)}%`).join(", ");
    blocks.push(
      <div key="grad" className="absolute inset-x-0" style={{
        top: px(g.y), height: px(g.h),
        background: `linear-gradient(${g.dark === "bottom" ? "to top" : "to bottom"}, ${stops})`,
        ["--hfx-dy" as string]: `${px(height * 0.05) * (g.dark === "bottom" ? 1 : -1)}px`,
        animation: `hfxRiseIn 700ms ${EASE_OUT} both`,
      } as CSSProperties} />,
    );
    geo.lines.forEach((line, i) => {
      const tk = line.tokens[0];
      blocks.push(
        <div key={`c${i}`} className="absolute inset-x-0 whitespace-nowrap text-center"
          style={{
            top: px(line.y), fontFamily: fontOf(tk.font), fontSize: px(tk.size), lineHeight: "normal", color: tk.color,
            textShadow: `0 ${px(2)}px ${px(2)}px rgba(0,0,0,.55)`,
            ["--hfx-dy" as string]: `${px(geo.size * 0.32)}px`, ["--hfx-blur" as string]: `${px(7)}px`,
            animation: `hfxFocus 520ms ${EASE_OUT} ${280 + i * 120}ms both`,
          } as CSSProperties}>
          {tk.text}
        </div>,
      );
    });
    if (geo.underline) {
      const u = geo.underline;
      const dU = 280 + geo.lines.length * 120 + 180;
      blocks.push(
        <div key="ul" className="absolute" style={{
          left: px(u.x), top: px(u.y), width: px(u.w), height: Math.max(1, px(u.h)), background: u.color,
          boxShadow: `0 0 ${px(geo.size * 0.3)}px ${rgba(u.color, 0.55)}`, animation: `hfxGrowX 480ms ${EASE_OUT} ${dU}ms both`,
        }} />,
      );
    }
  }

  if (geo.kind === "poster") {
    let idx = 0;
    const words = geo.lines.reduce((n, l) => n + l.tokens.length, 0);
    const glossDelay = (200 + words * 110 + 300) / 1000;
    geo.lines.forEach((line, i) => {
      blocks.push(
        <div key={`p${i}`} className="absolute inset-x-0 flex items-center justify-center" style={{ top: px(line.y), height: px(line.h) }}>
          <div className="flex items-baseline whitespace-pre" style={{ filter: `drop-shadow(0 ${px(geo.size * 0.03)}px 0 rgba(0,0,0,.45))` }}>
            {line.tokens.map((tk, j) => {
              const d = 200 + (idx++) * 110;
              const period = motion?.shine.periodSec ?? 3.4;
              const gloss = motion ? rgba(motion.shine.color, Math.min(1, motion.shine.alpha + 0.2)) : null;
              return (
                <span key={j} className="inline-block origin-bottom"
                  style={{
                    fontFamily: fontOf(tk.font), fontSize: px(tk.size), lineHeight: 1,
                    ...(gloss ? {
                      color: "transparent",
                      backgroundImage: `linear-gradient(100deg, ${tk.color} 42%, ${gloss} 50%, ${tk.color} 58%)`,
                      backgroundSize: "300% 100%", backgroundPosition: "130% 0",
                      WebkitBackgroundClip: "text", backgroundClip: "text",
                    } : { color: tk.color }),
                    ["--hfx-blur" as string]: `${px(5)}px`,
                    animation: `hfxWord 260ms ${EASE_OUT} ${d}ms both${gloss ? `, hfxGloss ${period}s linear ${glossDelay}s infinite` : ""}`,
                  } as CSSProperties}>
                  {tk.text}{j < line.tokens.length - 1 ? " " : ""}
                </span>
              );
            })}
          </div>
        </div>,
      );
    });
  }

  return (
    <div className="hfx-anim pointer-events-none absolute inset-0 overflow-hidden" style={{ width: px(width), height: px(height) }}>
      <style>{KEYFRAMES}</style>
      {blocks}
      {children && (
        <div className="group pointer-events-auto absolute cursor-move touch-none select-none"
          style={{ left: px(geo.bar ? geo.bar.x : geo.x), top: px(geo.top), width: px(geo.bar ? geo.bar.w : geo.w), height: px(geo.totalH) }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Compact live preview of an fx design for picker cards: the block rendered on a
 *  1080-wide reference, cropped to its own bounds (a little context around it). */
export function HookFxMini({ design, text, widthPx, replayKey }: { design: HookDesign; text: string; widthPx: number; replayKey?: string }) {
  const r = design.render;
  if (!isHookFxLayout(r.layout)) return null;
  const W = 1080, H = 1920;
  const geo = hookFxLayout({
    text: r.allCaps ? text.toUpperCase() : text, kind: r.layout, fontSize: r.fontSize, font: r.font,
    fontColor: r.fontColor, boxColor: r.boxColor, accentColor: r.accentColor, position: "center", width: W, height: H,
  });
  if (!geo) return null;
  const k = widthPx / W;
  const pad = geo.kind === "modern-gradient" ? geo.size * 2.6 : geo.kind === "cinematic" ? geo.size * 1.2 : geo.size * 0.35;
  const cropTop = Math.max(0, geo.top - pad);
  const cropH = Math.min(H - cropTop, geo.totalH + pad * 2);
  return (
    <div key={replayKey} className="relative overflow-hidden" style={{ width: widthPx, height: r2(cropH * k) }}>
      <div className="absolute left-0" style={{ top: r2(-cropTop * k), width: widthPx, height: r2(H * k) }}>
        <HookFxCanvas geo={geo} k={k} motion={r.motion} width={W} height={H} />
      </div>
    </div>
  );
}
