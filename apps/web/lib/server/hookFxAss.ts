import { HOOK_FONT_FAMILY, libassFontSize } from "@/lib/builder/burnFonts";
import { toAssTime } from "./assUtils";
import type { HookFxLayout, HookMotion, HookRect } from "@/lib/builder/hookDesigns";

/**
 * libass renderer for the premium hook motion — everything drawbox can't do:
 *  - the "fx" templates (Side/Flash Banner, Cinematic Rise, Poster Type): vector
 *    bars, a stepped vertical gradient, per-word fonts/colours/sizes, eased
 *    clip-wipes and focus-in blur;
 *  - the diagonal, blurred light streak ("shine") every hook design sweeps across
 *    its boxes / text.
 * Geometry always comes from lib/builder/hookDesigns (hookFxLayout /
 * hookBlockLayout) — the same numbers the editor preview draws with.
 *
 * All times are ABSOLUTE clip seconds (the subtitles filter runs on the clip's
 * own timeline, like drawtext's `t`). Bundled families only (HOOK_FONT_FAMILY),
 * matched through `subtitles=…:fontsdir=` in clipFilterGraph.
 */

/** Hard cap on repeat events so an "Always on" hook can't bloat the script. */
const MAX_SHINE_EVENTS = 480;
const SWEEP_MS = 850;

const clean = (t: string) => t.replace(/[{}\\]/g, "").replace(/[\r\n]+/g, " ");
const hex6 = (hex: string, fb = "FFFFFF") => {
  const h = (hex ?? "").replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(h)) return h.toUpperCase();
  if (/^[0-9a-fA-F]{3}$/.test(h)) return (h[0] + h[0] + h[1] + h[1] + h[2] + h[2]).toUpperCase();
  return fb;
};
/** `\c` value (&HBBGGRR&). */
const col = (hex: string) => { const h = hex6(hex); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`; };
/** `\alpha` value from an opacity 0..1 (ASS alpha is inverted transparency). */
const alp = (opacity: number) => `&H${Math.round(255 * (1 - Math.min(1, Math.max(0, opacity)))).toString(16).padStart(2, "0").toUpperCase()}&`;
const r = (n: number) => Math.round(n);
const rectPath = (x: number, y: number, w: number, h: number) => `m ${r(x)} ${r(y)} l ${r(x + w)} ${r(y)} l ${r(x + w)} ${r(y + h)} l ${r(x)} ${r(y + h)}`;
const fam = (token: string) => HOOK_FONT_FAMILY[token] ?? "Montserrat SemiBold";
/** Font override for a token: family + the libass size that matches `px` em. */
const face = (token: string, px: number) => `\\fn${fam(token)}\\fs${libassFontSize(fam(token), px)}`;

export function assDoc(width: number, height: number, events: string[]): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Fx,Montserrat SemiBold,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

const ev = (layer: number, start: number, end: number, text: string) =>
  `Dialogue: ${layer},${toAssTime(start)},${toAssTime(Math.max(start + 0.01, end))},Fx,,0,0,0,,${text}`;

/** Diagonal blurred light streak sweeping across `box`, once every period while
 *  the hook shows. Two passes: a wide soft glow and a thin bright core. */
export function shineEvents(
  box: HookRect, motion: HookMotion, fromSec: number, endSec: number, size: number, layer = 3, budget = MAX_SHINE_EVENTS,
): string[] {
  const { color, alpha, periodSec } = motion.shine;
  if (box.w < size * 0.6 || fromSec >= endSec) return [];
  const band = Math.max(10, size * 0.7);
  const skew = box.h * 0.45;
  const clip = `\\clip(${r(box.x)},${r(box.y)},${r(box.x + box.w)},${r(box.y + box.h)})`;
  const x0 = box.x - band - skew;
  const dx = r(box.w + band + skew * 2);
  const para = (bw: number, off: number) =>
    `m ${r(x0 + off)} ${r(box.y + box.h)} l ${r(x0 + off + skew)} ${r(box.y)} l ${r(x0 + off + skew + bw)} ${r(box.y)} l ${r(x0 + off + bw)} ${r(box.y + box.h)}`;
  const soft = `{\\an7\\move(0,0,${dx},0,0,${SWEEP_MS})${clip}\\bord0\\shad0\\blur${r(band * 0.35)}\\1c${col(color)}\\1a${alp(alpha)}\\p1}${para(band, 0)}`;
  const coreW = Math.max(3, band * 0.16);
  const core = `{\\an7\\move(0,0,${dx},0,0,${SWEEP_MS})${clip}\\bord0\\shad0\\blur${Math.max(1, r(coreW * 0.4))}\\1c${col(color)}\\1a${alp(Math.min(0.92, alpha * 2.1))}\\p1}${para(coreW, (band - coreW) / 2)}`;
  const out: string[] = [];
  for (let t = fromSec; t < endSec && out.length + 2 <= budget; t += periodSec) {
    const e = Math.min(endSec, t + SWEEP_MS / 1000);
    out.push(ev(layer, t, e, soft), ev(layer + 1, t, e, core));
  }
  return out;
}

/** Full event list for an fx template (bars/gradient/text/shine). */
export function hookFxEvents(geo: HookFxLayout, opts: {
  width: number; height: number; startSec: number; endSec: number; motion?: HookMotion;
}): string[] {
  const { width, height, startSec: s0 } = opts;
  const e0 = Math.min(opts.endSec, s0 + 3600);
  const out: string[] = [];
  const FADE_OUT = 280;
  const fadeOut = `\\fad(0,${FADE_OUT})`;
  const ms = (sec: number) => r(sec * 1000);

  if (geo.kind === "banner-left" || geo.kind === "banner-right") {
    const bar = geo.bar!;
    const left = geo.kind === "banner-left";
    // Bar: eased clip-wipe out of its screen edge (accel<1 = ease-out).
    const edge = left ? bar.x : bar.x + bar.w;
    const clip0 = `\\clip(${r(edge)},${r(bar.y)},${r(edge)},${r(bar.y + bar.h)})`;
    const clip1 = `\\clip(${r(bar.x)},${r(bar.y)},${r(bar.x + bar.w)},${r(bar.y + bar.h)})`;
    out.push(ev(0, s0, e0, `{\\an7\\pos(0,0)${fadeOut}\\bord0\\shad0\\1c${col(bar.color)}${clip0}\\t(0,420,0.45,${clip1})\\p1}${rectPath(bar.x, bar.y, bar.w, bar.h)}`));
    // Soft drop shadow under the bar for depth.
    out.push(ev(0, s0, e0, `{\\an7\\pos(0,0)${fadeOut}\\bord0\\shad0\\blur${r(geo.size * 0.25)}\\1c&H000000&\\1a${alp(0.35)}${clip0.replace(`${r(bar.y + bar.h)})`, `${r(bar.y + bar.h + geo.size * 0.4)})`)}\\t(0,420,0.45,\\clip(${r(bar.x)},${r(bar.y)},${r(bar.x + bar.w)},${r(bar.y + bar.h + geo.size * 0.4)}))\\p1}${rectPath(bar.x, bar.y + geo.size * 0.12, bar.w, bar.h)}`));
    // Accent stripe on the leading edge, snapping in as the bar lands.
    const st = bar.stripe;
    const sEdge = left ? st.x : st.x + st.w;
    out.push(ev(2, s0, e0, `{\\an7\\pos(0,0)${fadeOut}\\bord0\\shad0\\1c${col(st.color)}\\clip(${r(sEdge)},${r(st.y)},${r(sEdge)},${r(st.y + st.h)})\\t(300,480,0.5,\\clip(${r(st.x)},${r(st.y)},${r(st.x + st.w)},${r(st.y + st.h)}))\\p1}${rectPath(st.x, st.y, st.w, st.h)}`));
    // Headline: slides in from the bar's edge, clipped inside the bar.
    const tx = left ? geo.textInset : width - geo.textInset;
    const an = left ? 4 : 6;
    const dir = left ? -1 : 1;
    geo.lines.forEach((line, i) => {
      const cy = r(line.y + line.h / 2);
      const d = 240 + i * 90;
      const tk = line.tokens[0];
      out.push(ev(3, s0, e0, `{\\an${an}\\move(${r(tx + dir * geo.size * 0.9)},${cy},${r(tx)},${cy},${d},${d + 380})${clip1}${fadeOut}\\bord0\\shad0${face(tk.font, tk.size)}\\1c${col(tk.color)}\\alpha&HFF&\\t(${d},${d + 220},\\alpha&H00&)}${clean(tk.text)}`));
    });
    if (opts.motion) out.push(...shineEvents({ x: bar.x, y: bar.y, w: bar.w - bar.stripe.w, h: bar.h, color: "" }, opts.motion, s0 + 0.9, e0, geo.size, 2));
    return out;
  }

  if (geo.kind === "cinematic" || geo.kind === "modern-gradient") {
    const g = geo.gradient!;
    const N = 44;
    const stripH = g.h / N;
    const dy = r(height * 0.05) * (g.dark === "bottom" ? 1 : -1);
    for (let i = 0; i < N; i++) {
      // i = 0 at the dark edge; ease the falloff so the top of the band melts away.
      const op = g.maxAlpha * Math.pow(1 - i / N, 1.7);
      if (op < 0.01) continue;
      const y = g.dark === "bottom" ? g.y + g.h - (i + 1) * stripH : g.y + i * stripH;
      out.push(ev(0, s0, e0, `{\\an7\\move(0,${dy},0,0,0,700)\\fad(520,${FADE_OUT})\\bord0\\shad0\\1c${col(g.color)}\\1a${alp(op)}\\p1}${rectPath(0, y, width, stripH + 1)}`));
    }
    const cx = r(width / 2);
    if (geo.kind === "modern-gradient") {
      // Clean modern entrance: a quiet fade + rise into place, no blur-focus and
      // no underline — just the type sitting in the scrim, legible over any footage.
      geo.lines.forEach((line, i) => {
        const tk = line.tokens[0];
        const d = 260 + i * 110;
        const y = r(line.y);
        out.push(ev(2, s0, e0, `{\\an8\\move(${cx},${r(y + geo.size * 0.22)},${cx},${y},${d},${d + 380})${fadeOut}\\bord0\\shad2\\4c&H000000&\\4a${alp(0.4)}${face(tk.font, tk.size)}\\1c${col(tk.color)}\\alpha&HFF&\\t(${d},${d + 320},\\alpha&H00&)}${clean(tk.text)}`));
      });
      return out;
    }
    geo.lines.forEach((line, i) => {
      const tk = line.tokens[0];
      const d = 280 + i * 120;
      const y = r(line.y);
      out.push(ev(2, s0, e0, `{\\an8\\move(${cx},${r(y + geo.size * 0.32)},${cx},${y},${d},${d + 520})${fadeOut}\\bord0\\shad2\\4c&H000000&\\4a${alp(0.45)}${face(tk.font, tk.size)}\\1c${col(tk.color)}\\alpha&HFF&\\blur7\\t(${d},${d + 460},0.6,\\alpha&H00&\\blur0)}${clean(tk.text)}`));
    });
    const u = geo.underline!;
    const dU = 280 + geo.lines.length * 120 + 180;
    const uPos = `\\an5\\pos(${r(u.x + u.w / 2)},${r(u.y + u.h / 2)})`;
    out.push(ev(1, s0, e0, `{${uPos}${fadeOut}\\bord0\\shad0\\blur${r(geo.size * 0.18)}\\1c${col(u.color)}\\1a${alp(0.55)}\\fscx0\\t(${dU},${dU + 480},0.5,\\fscx100)\\p1}${rectPath(0, 0, u.w, u.h)}`));
    out.push(ev(3, s0, e0, `{${uPos}${fadeOut}\\bord0\\shad0\\1c${col(u.color)}\\fscx0\\t(${dU},${dU + 480},0.5,\\fscx100)\\p1}${rectPath(0, 0, u.w, u.h)}`));
    return out;
  }

  // Poster: every word lands one after another (fade + vertical settle + focus).
  const cx = r(width / 2);
  const STAGGER = 110;
  let k = 0;
  const lineText = (line: HookFxLayout["lines"][number], gloss?: { color: string }) =>
    line.tokens.map((tk, j) => {
      const d = 200 + (k++) * STAGGER;
      const f = `${face(tk.font, tk.size)}\\i${tk.small ? 0 : 1}`;
      const text = clean(tk.text) + (j < line.tokens.length - 1 ? " " : "");
      if (gloss) return `{${f}\\1c${col(gloss.color)}}${text}`;
      return `{${f}\\1c${col(tk.color)}\\alpha&HFF&\\fscy72\\blur5\\t(${d},${d + 260},0.55,\\alpha&H00&\\fscy100\\blur0)}${text}`;
    }).join("");
  for (const line of geo.lines) {
    const pos = `\\an5\\pos(${cx},${r(line.y + line.h / 2)})`;
    out.push(ev(2, s0, e0, `{${pos}${fadeOut}\\bord0\\shad${Math.max(2, r(geo.size * 0.03))}\\4c&H000000&\\4a${alp(0.55)}}${lineText(line)}`));
  }
  // Gloss: a bright band sweeps through the letters (duplicate text, moving clip).
  if (opts.motion) {
    const landed = s0 + (200 + k * STAGGER + 300) / 1000;
    const band = geo.size * 0.55;
    const x0 = geo.x - band;
    const x1 = geo.x + geo.w;
    const { color, alpha, periodSec } = opts.motion.shine;
    let budget = MAX_SHINE_EVENTS;
    for (let t = landed; t < e0 && budget >= geo.lines.length; t += periodSec) {
      const e = Math.min(e0, t + SWEEP_MS / 1000);
      for (const line of geo.lines) {
        const y0 = r(line.y), y1 = r(line.y + line.h);
        const pos = `\\an5\\pos(${cx},${r(line.y + line.h / 2)})`;
        out.push(ev(4, t, e, `{${pos}\\bord0\\shad0\\blur2\\alpha${alp(alpha)}\\clip(${r(x0)},${y0},${r(x0 + band)},${y1})\\t(0,${ms(SWEEP_MS / 1000)},\\clip(${r(x1)},${y0},${r(x1 + band)},${y1}))}${lineText(line, { color })}`));
        budget--;
      }
    }
  }
  return out;
}
