// Prompt + reply parsing for the Render Studio agent. Pure (no I/O) so it is
// unit-testable and shared by the streaming route.
//
// Design goals: (1) tiny prompts (token cost), (2) a reply parser that never
// loses a good answer: tagged blocks are preferred, but markdown-fenced code
// and plain prose are understood too, so the user ALWAYS gets a response.

import { STUDIO_FONTS, clampComposition, type Asset, type Composition, type Engine } from "./compose";

export interface ParsedReply {
  plan?: string;
  summary?: string;
  /** Prose the model wrote outside code (used as the chat reply when it is all we got). */
  prose?: string;
  meta?: Partial<Pick<Composition, "title" | "width" | "height" | "fps" | "duration">>;
  html?: string;
  css?: string;
  js?: string;
  patches: Array<{ target: "html" | "css" | "js"; find: string; replace: string }>;
  /** True when the code came from markdown fences instead of tagged blocks. */
  fromFences?: boolean;
}

const FONT_LIST = STUDIO_FONTS.map((f) => f.family).join(", ");

export const BRAND_ASSETS = (origin: string): Asset[] => [
  { id: "logo", kind: "image", url: `${origin}/vello-logo-white.png`, title: "Vello logo (white wordmark, transparent PNG)", source: "brand" },
  { id: "mark", kind: "image", url: `${origin}/vello-mark-lime.png`, title: "Vello mark (lime, transparent PNG)", source: "brand" },
];

export function assetLines(assets: Asset[]): string {
  return assets.map((a) => `${a.id}|${a.kind}|${a.duration ? `${Math.round(a.duration * 10) / 10}s|` : ""}${a.width && a.height ? `${a.width}x${a.height}|` : ""}${a.title.slice(0, 50)}|${a.url}`).join("\n");
}

export function systemPrompt(engine: Engine, ctx?: { agentName?: string; avatarUrl?: string }): string {
  const common = `You are Vello Render Studio's motion-design agent. You build deterministic, seekable video compositions (previewed live, exported frame by frame in headless Chromium). You are agentic: you have tools the studio runs for you, so NEVER say you cannot access the internet, fetch footage, or get the logo. The studio already supplies them in the ASSETS list below the request (brand logo, the user's own clips, and stock footage it searched for you). Use those exact URLs. If something truly is not provided, build the best placeholder version, and say so in one line in <summary>.
Do not use official F1/NASCAR/brand footage, logos or sounds; evoke the genre with original motion graphics instead.

HARD RULES:
- Pure function of time. No Date.now, performance.now, requestAnimationFrame, setTimeout, setInterval, CSS transitions/animations, Math.random (use vello.rand(seed)).
- No network calls. Images/videos only from the ASSETS list (absolute https URLs). Fonts only: ${FONT_LIST} (default Manrope).
- Stage is WxH px. Keep text inside safe margins (9:16: 90px sides, 220 top, 320 bottom; else 8%). First and last frames must look finished.

CRAFT: one hero element + one supporting line + accents; headline 110-170px on 1080 wide; stagger entrances 0.08-0.15s; ease with out-cubic/outExpo/outBack, never linear for UI; always a continuous ambient motion; counters ease.outExpo; layered gradients/glows; palette default navy #0a1630/#142a5a, gold #e8c668/#c79a2e, cream #f5efe0 unless asked otherwise. Intro 0-1.5s, outro last 0.6s.

VIDEO CLIPS: put <video src="ASSET_URL" muted playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video> in the markup and, inside vello.onSeek, call vello.video(el, t - startAt + trimIn) (local seconds into the clip; the clip is hidden/ignored before startAt via opacity). Prefer cuts on beats, 1-3s per clip for fast pacing, scale 1.0 to 1.08 over the shot for life, add a dark gradient overlay so text stays readable. Never loop a clip shorter than its slot; use another clip or trim.

OUTPUT: tagged blocks only, no markdown fences, no prose outside tags. ALWAYS include <summary> (one friendly sentence to the user: what you made/changed, or your answer/question if no code change is needed).
<plan>short idea</plan><summary>...</summary><meta>{"title":"..","duration":8,"fps":30}</meta> (optional, changed fields only)
<html>..</html><css>..</css><js>..</js> (full replacement of a section)
or for edits touching <30% of the code, patches (preferred, far cheaper):
<patch target="js"><find>exact existing text</find><replace>new text</replace></patch>
Each <find> must match the current code EXACTLY once. If the request is a different video (not a tweak), replace all sections fully; the starter is a throwaway placeholder.`;

  const eng = engine === "react"
    ? `
ENGINE react (Remotion-compatible): JSX in <js> defining component Video; <html> empty; <css> is plain CSS. Globals (no imports): React, useCurrentFrame(), useVideoConfig() {fps,width,height,durationInFrames}, interpolate(frame,[in],[out],{extrapolateLeft/Right:"clamp",easing}), spring({frame,fps,delay,config}), Easing.{linear,ease,quad,cubic,bezier,in,out,inOut}, AbsoluteFill, Sequence({from,durationInFrames}), Img, Vid({src,start,style}) (frame-exact video inside a Sequence), random(seed). DOM/SVG/CSS only (no three.js here).`
    : `
ENGINE html: <html> is the markup inside #stage (WxH, position:relative); <css> styles it; <js> runs once and registers vello.onSeek((t, frame) => {...}) to draw time t (seconds).
Helpers: vello.W/H/fps/duration, clamp, lerp, seg(t,start,dur)->0..1, map(t,a,b,x,y,easeFn), rand(seed), video(el,localSec), ease.{linear,in2,out2,in3,out3,io3,out5,outExpo,outBack,outElastic}.
Libs auto-load when referenced: THREE (r150 global; one renderer on a <canvas> from the html, setSize(W,H,false), render inside onSeek), gsap (paused timelines, tl.seek(t) in onSeek). Query DOM once at top; animate transform/opacity.`;

  const who = ctx?.agentName
    ? `\nThis studio belongs to Vello agent "${ctx.agentName}".${ctx.avatarUrl ? ` Its avatar (https): ${ctx.avatarUrl}` : ""}`
    : "";
  return common + eng + who;
}

/** Strips noise from code before it goes into a prompt (tokens cost money). */
export function compactCode(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => !/^\s*\/\/(?!\/)/.test(l))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function userPrompt(
  comp: Composition | null,
  request: string,
  history: Array<{ role: "user" | "assistant"; text: string }>,
  assets: Asset[] = [],
): string {
  const hist = history.slice(-4).map((h) => `${h.role === "user" ? "U" : "A"}: ${h.text.slice(0, 220)}`).join("\n");
  const cur = comp && (comp.js || comp.html)
    ? `CURRENT (${comp.engine} ${comp.width}x${comp.height} ${comp.fps}fps ${comp.duration}s "${comp.title}")\n<html>${compactCode(comp.html)}</html>\n<css>${compactCode(comp.css)}</css>\n<js>${compactCode(comp.js)}</js>`
    : "No composition yet.";
  const a = assets.length ? `\nASSETS (id|kind|dur|size|title|url):\n${assetLines(assets)}` : "";
  return `${cur}${a}\n${hist ? `\nCHAT\n${hist}\n` : ""}\nREQUEST: ${request}`;
}

const tag = (s: string, name: string): string | undefined => {
  const m = s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : undefined;
};
const trimNl = (s: string) => s.replace(/^```[a-zA-Z]*[ \t]*\n/, "").replace(/\n?```$/, "").replace(/^\n|\n$/g, "");

const LANG: Record<string, "html" | "css" | "js"> = { html: "html", htm: "html", css: "css", js: "js", javascript: "js", jsx: "js", tsx: "js", ts: "js", typescript: "js" };

/** Pulls `<html>`, `<css>`, `<js>` out of a markdown reply that used ```lang fences. */
function fromFences(raw: string): { html?: string; css?: string; js?: string } | null {
  const out: { html?: string; css?: string; js?: string } = {};
  const re = /```([a-zA-Z]*)[ \t]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null, any = false;
  while ((m = re.exec(raw))) {
    const k = LANG[m[1].toLowerCase()];
    if (k && !out[k]) { out[k] = trimNl(m[2]); any = true; }
  }
  return any ? out : null;
}

/** The part of the reply a human should read: no code, no tags, no stray headings. */
export function proseOf(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<(html|css|js|meta|plan)>[\s\S]*?<\/\1>/gi, "")
    .replace(/<patch[\s\S]*?<\/patch>/gi, "")
    .replace(/<\/?summary>/gi, "")
    .replace(/^\s*\*{0,2}(HTML|CSS|JS|JavaScript|JSX)\*{0,2}\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drops stale "I can't access the internet / download it" boilerplate and keeps the reply short. */
function cleanProse(p: string): string {
  const keep = p.split(/\n{2,}/).map((x) => x.trim()).filter((x) => x && !/\b(can't|cannot|unable to)\b[^.]{0,60}\b(access|fetch|download|browse)\b|no internet|upload the logo|when you upload/i.test(x));
  const out = keep.join("\n\n");
  return out.length > 420 ? out.slice(0, 420).replace(/\s+\S*$/, "") + "..." : out;
}

export function parseReply(raw: string): ParsedReply {
  const out: ParsedReply = { patches: [] };
  const text = raw.replace(/```(?:html|css|js|jsx|javascript)?\n?([\s\S]*?)```/gi, (m, body) => (/<(html|css|js|patch|plan|summary)[\s>]/i.test(body) ? body : m));
  out.plan = tag(text, "plan")?.trim();
  out.summary = tag(text, "summary")?.trim();
  const meta = tag(text, "meta");
  if (meta) { try { out.meta = JSON.parse(meta.trim()); } catch { /* ignore malformed meta */ } }

  const patchRe = /<patch\s+target="(html|css|js)">\s*<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>\s*<\/patch>/gi;
  let m: RegExpExecArray | null;
  while ((m = patchRe.exec(text))) out.patches.push({ target: m[1].toLowerCase() as "html" | "css" | "js", find: trimNl(m[2]), replace: trimNl(m[3]) });
  const body = text.replace(patchRe, "");
  const html = tag(body, "html"), css = tag(body, "css"), js = tag(body, "js");
  if (html !== undefined) out.html = trimNl(html);
  if (css !== undefined) out.css = trimNl(css);
  if (js !== undefined) out.js = trimNl(js);

  if (out.html === undefined && out.css === undefined && out.js === undefined && !out.patches.length) {
    const f = fromFences(raw);
    if (f) { Object.assign(out, f); out.fromFences = true; }
  }
  out.prose = cleanProse(proseOf(raw)) || undefined;
  return out;
}

export const hasCode = (r: ParsedReply) => r.html !== undefined || r.css !== undefined || r.js !== undefined || r.patches.length > 0;

export interface ApplyResult { comp: Composition; failedPatches: string[] }

export function applyReply(base: Composition, r: ParsedReply): ApplyResult {
  const next: Composition = { ...base, ...(r.meta ?? {}) };
  if (r.html !== undefined) next.html = r.html;
  if (r.css !== undefined) next.css = r.css;
  if (r.js !== undefined) next.js = r.js;
  const failed: string[] = [];
  for (const p of r.patches) {
    const cur = next[p.target];
    const idx = cur.indexOf(p.find);
    if (!p.find || idx < 0 || cur.indexOf(p.find, idx + 1) >= 0) { failed.push(`${p.target}: ${p.find.slice(0, 60)}`); continue; }
    next[p.target] = cur.slice(0, idx) + p.replace + cur.slice(idx + p.find.length);
  }
  return { comp: clampComposition({ ...next, engine: base.engine, assets: base.assets }), failedPatches: failed };
}

/** Which tagged section the stream is currently inside (for live progress). */
export function currentSection(partial: string): string {
  if (/```/.test(partial)) return "writing code";
  const open = [...partial.matchAll(/<(plan|summary|meta|html|css|js|patch)[\s>]/gi)].pop();
  if (!open) return "thinking";
  const name = open[1].toLowerCase();
  const closed = partial.lastIndexOf(`</${name}>`) > (open.index ?? 0);
  if (closed) return "writing";
  return ({ plan: "planning", summary: "summarising", meta: "setting up", html: "writing markup", css: "styling", js: "animating", patch: "editing" } as Record<string, string>)[name] ?? "writing";
}

/** Cheap heuristic: is this a small tweak (fast model + patches) or a creative rewrite (Opus)? */
export function isSmallEdit(prompt: string, comp: Composition | null, touched: boolean): boolean {
  if (!comp || !touched || !(comp.js || comp.html)) return false;
  if (prompt.length > 260) return false;
  return !/\b(new video|from scratch|start over|redesign|rebuild|entire|whole|completely|different video|another video|f1|racing|cinematic|intro for|trailer|logo reveal)\b/i.test(prompt);
}

/** Does the brief ask for footage the studio should go find? */
export function wantsFootage(prompt: string): boolean {
  return /\b(footage|b-?roll|stock|clips?|video background|race|racing|stadium|city|ocean|nature|drone|cars?|crowd|skyline|sports?)\b/i.test(prompt);
}
