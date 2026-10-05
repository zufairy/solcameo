# Clipping Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a distinct `clipping` agent type that ingests a long-form source video, finds the best moments, cuts them into vertical 9:16 short-form clips decorated by a skill-driven edit plan, auto-posts the top N with a review queue, and submits the links to campaigns — all as real cut segments (never AI-synthesised video).

**Architecture:** A Convex background job (`clipJobs.process`) mirrors the existing UGC `videoJobs.generate`: it advances a `clipJobs` row through download → transcribe → moment-select → edit-plan → cut → post → submit, calling thin Next routes for the IO/ffmpeg work (Convex has no filesystem). Pure, network-free modules (`clipEditOps`, `captionRenderer`, `clipMomentSelector`, `clipEditPlanner`, `downloader`) hold the logic and are unit-tested. Reactive `clipJobs`/`clips` Convex queries drive a live Clips queue in the builder.

**Tech Stack:** Next.js 16 (App Router, Node runtime), Convex, `ffmpeg-static` + `node:child_process` spawn, OpenAI Whisper (`whisper-1` verbose_json — `OPENAI_API_KEY` already configured), Claude Haiku via `lib/server/kie-claude` (`callClaudeJSON`), Vitest (edge-runtime).

**Spec:** `docs/superpowers/specs/2026-06-02-clipping-agent-design.md`

**Key existing patterns to mirror (read these first):**
- `app/api/video/concat/route.ts` — the ffmpeg `spawn` + `ffmpeg-static` + tmpdir + `runFfmpeg` pattern for the new ffmpeg routes.
- `convex/videoJobs.ts` — the `enqueue` mutation + background `process` action shape (credentials forwarded, ffmpeg done in Next routes, status driven via mutations).
- `app/api/agents/run-task/route.ts` — the executor + `ctx.skills` (custom-first) loading; the `create_video` → `deferVideo` enqueue.
- `lib/server/kie-claude.ts` — `callClaudeJSON({ system, user, apiKey })`.
- `lib/server/characterRefs.test.ts` / `creativeDirector.test.ts` — the Vitest unit-test style.

---

## Shared types (defined in Task 1 & 2; referenced everywhere)

```ts
// lib/server/clipTypes.ts  (Task 1)
export interface TranscriptWord { word: string; start: number; end: number; }
export interface TranscriptSegment { start: number; end: number; text: string; }
export interface Transcript { segments: TranscriptSegment[]; words: TranscriptWord[]; durationSeconds: number; }

export interface ClipMoment {
  startSeconds: number; endSeconds: number;
  title: string; reason: string; viralScore: number; captionText: string;
}

export interface CaptionStyle { mode: "karaoke" | "line"; fontColor: string; fontSize: number; position: "top" | "center" | "bottom"; }
export interface TextStyle { fontColor: string; bgColor?: string; fontSize: number; bold: boolean; }

export interface ClipConfig {
  clipLength: { min: number; max: number };  // seconds
  maxClipsPerSource: number;
  captionsOn: boolean;
  captionStyle: CaptionStyle;
  hookStyle: "cold_open" | "context_first";
  platforms: string[];
  autoPost: boolean;
  brandLogoUrl?: string;
}
```

---

### Task 1: Shared types + EditOp schema + validateEditPlan

**Files:**
- Create: `lib/server/clipTypes.ts`
- Create: `lib/server/clipEditOps.ts`
- Test: `lib/server/clipEditOps.test.ts`

- [ ] **Step 1: Write `clipTypes.ts`** (exact content from "Shared types" block above). No tests — pure type declarations.

- [ ] **Step 2: Write the failing test** `lib/server/clipEditOps.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateEditPlan, type EditOp } from "./clipEditOps";

describe("validateEditPlan", () => {
  it("keeps well-formed ops and forces reframe first", () => {
    const raw: EditOp[] = [
      { op: "subtitles", style: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" } },
      { op: "reframe", mode: "crop" },
    ];
    const out = validateEditPlan(raw);
    expect(out[0]).toEqual({ op: "reframe", mode: "crop" });
    expect(out.some((o) => o.op === "subtitles")).toBe(true);
  });

  it("prepends a default reframe when none is present", () => {
    const out = validateEditPlan([{ op: "subtitles", style: { mode: "line", fontColor: "#fff", fontSize: 40, position: "bottom" } }]);
    expect(out[0]).toEqual({ op: "reframe", mode: "crop" });
  });

  it("drops unknown / malformed ops", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "explode_video" } as unknown as EditOp,
      { op: "text_overlay", text: "", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 40, bold: true } },
      { op: "text_overlay", text: "POV", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 40, bold: true } },
    ]);
    expect(out.find((o) => (o as { op: string }).op === "explode_video")).toBeUndefined();
    // empty-text overlay dropped, valid one kept
    expect(out.filter((o) => o.op === "text_overlay")).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — `npx vitest run lib/server/clipEditOps.test.ts` → FAIL ("Cannot find module './clipEditOps'").

- [ ] **Step 4: Write `lib/server/clipEditOps.ts`**

```ts
import type { CaptionStyle, TextStyle } from "./clipTypes";

export type Anchor =
  | "top" | "center" | "bottom"
  | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type Corner = "tl" | "tr" | "bl" | "br";

export type EditOp =
  | { op: "reframe"; mode: "crop" | "pad" }
  | { op: "subtitles"; style: CaptionStyle }
  | { op: "text_overlay"; text: string; position: Anchor; startSec: number; endSec: number; style: TextStyle }
  | { op: "title_card"; text: string; durationSec: number; style: TextStyle }
  | { op: "logo_overlay"; imageUrl: string; corner: Corner; opacity: number }
  | { op: "emphasis"; kind: "zoom_punch" | "speed" | "freeze"; atSec: number; amount?: number };

const ANCHORS: Anchor[] = ["top", "center", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"];
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Validate one raw op; return the normalized EditOp or null to drop it. */
function coerceOp(raw: unknown): EditOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  switch (o.op) {
    case "reframe":
      return { op: "reframe", mode: o.mode === "pad" ? "pad" : "crop" };
    case "subtitles":
      return o.style && typeof o.style === "object" ? { op: "subtitles", style: o.style as CaptionStyle } : null;
    case "text_overlay":
      if (!str(o.text) || !ANCHORS.includes(o.position as Anchor) || !num(o.startSec) || !num(o.endSec)) return null;
      return { op: "text_overlay", text: String(o.text).slice(0, 120), position: o.position as Anchor,
        startSec: Math.max(0, o.startSec as number), endSec: o.endSec as number, style: (o.style ?? { fontColor: "#fff", fontSize: 48, bold: true }) as TextStyle };
    case "title_card":
      if (!str(o.text) || !num(o.durationSec)) return null;
      return { op: "title_card", text: String(o.text).slice(0, 120), durationSec: Math.min(5, Math.max(1, o.durationSec as number)),
        style: (o.style ?? { fontColor: "#fff", fontSize: 64, bold: true }) as TextStyle };
    case "logo_overlay":
      if (!str(o.imageUrl) || !CORNERS.includes(o.corner as Corner)) return null;
      return { op: "logo_overlay", imageUrl: o.imageUrl as string, corner: o.corner as Corner,
        opacity: num(o.opacity) ? Math.min(1, Math.max(0, o.opacity as number)) : 0.85 };
    case "emphasis":
      if (!["zoom_punch", "speed", "freeze"].includes(o.kind as string) || !num(o.atSec)) return null;
      return { op: "emphasis", kind: o.kind as "zoom_punch" | "speed" | "freeze", atSec: o.atSec as number, amount: num(o.amount) ? (o.amount as number) : undefined };
    default:
      return null;
  }
}

/**
 * Validate an LLM-proposed edit plan: drop unknown/malformed ops, and guarantee
 * exactly one `reframe` that runs first (so the clip is always 9:16).
 */
export function validateEditPlan(raw: unknown): EditOp[] {
  const arr = Array.isArray(raw) ? raw : [];
  const coerced = arr.map(coerceOp).filter((o): o is EditOp => o !== null);
  const reframe = coerced.find((o) => o.op === "reframe") ?? { op: "reframe" as const, mode: "crop" as const };
  const rest = coerced.filter((o) => o.op !== "reframe");
  return [reframe, ...rest];
}
```

- [ ] **Step 5: Run test to verify it passes** — `npx vitest run lib/server/clipEditOps.test.ts` → PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/server/clipTypes.ts lib/server/clipEditOps.ts lib/server/clipEditOps.test.ts
git commit -m "feat(clipping): EditOp schema + validateEditPlan + shared clip types"
```

---

### Task 2: captionRenderer — transcript window → ASS subtitle spec

**Files:**
- Create: `lib/server/captionRenderer.ts`
- Test: `lib/server/captionRenderer.test.ts`

ASS (Advanced SubStation) is chosen over SRT because ffmpeg's `subtitles` filter can burn ASS with full styling (color/size/position) and per-word karaoke timing. Times in the window are **relative to the clip start** (the caller passes `clipStartSec` to subtract).

- [ ] **Step 1: Write the failing test** `lib/server/captionRenderer.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { renderCaptionsAss } from "./captionRenderer";
import type { TranscriptWord, CaptionStyle } from "./clipTypes";

const words: TranscriptWord[] = [
  { word: "Hello", start: 10.0, end: 10.4 },
  { word: "world", start: 10.5, end: 11.0 },
  { word: "again", start: 30.0, end: 30.5 }, // outside the window
];
const style: CaptionStyle = { mode: "line", fontColor: "#FFEE00", fontSize: 48, position: "bottom" };

describe("renderCaptionsAss", () => {
  it("emits an ASS header + only words inside the window, rebased to clip start", () => {
    const ass = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style });
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[Events]");
    expect(ass).toContain("Hello world");      // window words, line mode
    expect(ass).not.toContain("again");         // out-of-window word excluded
    expect(ass).toContain("0:00:00.00");        // 10.0 - 10 = 0 → rebased
  });

  it("emits one Dialogue per word in karaoke mode", () => {
    const ass = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style: { ...style, mode: "karaoke" } });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBe(2); // two in-window words
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run lib/server/captionRenderer.test.ts` → FAIL.

- [ ] **Step 3: Write `lib/server/captionRenderer.ts`**

```ts
import type { TranscriptWord, CaptionStyle } from "./clipTypes";

function toAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secs = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${secs}`;
}

// "#RRGGBB" → ASS "&HBBGGRR&" (ASS is BGR, alpha-prefixed).
function toAssColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

const ALIGN: Record<CaptionStyle["position"], number> = { bottom: 2, center: 5, top: 8 };

export interface RenderCaptionsOpts { clipStartSec: number; clipEndSec: number; style: CaptionStyle; }

/**
 * Build an ASS subtitle file for ONE clip from the source word timings. Word
 * times are rebased to the clip start. `line` mode groups in-window words into a
 * single Dialogue; `karaoke` mode emits one Dialogue per word (pop-on effect).
 */
export function renderCaptionsAss(words: TranscriptWord[], opts: RenderCaptionsOpts): string {
  const { clipStartSec, clipEndSec, style } = opts;
  const inWin = words.filter((w) => w.end > clipStartSec && w.start < clipEndSec);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080", "PlayResY: 1920",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Alignment, MarginV",
    `Style: Def, Arial, ${style.fontSize}, ${toAssColor(style.fontColor)}, &H00000000, &H64000000, 1, ${ALIGN[style.position]}, 120`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
  ];

  const events: string[] = [];
  if (style.mode === "karaoke") {
    for (const w of inWin) {
      events.push(`Dialogue: 0,${toAssTime(w.start - clipStartSec)},${toAssTime(w.end - clipStartSec)},Def,${w.word.replace(/\n/g, " ")}`);
    }
  } else {
    const text = inWin.map((w) => w.word).join(" ").replace(/\n/g, " ");
    const start = inWin.length ? inWin[0].start - clipStartSec : 0;
    const end = inWin.length ? inWin[inWin.length - 1].end - clipStartSec : clipEndSec - clipStartSec;
    if (text) events.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Def,${text}`);
  }

  return [...header, ...events].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run lib/server/captionRenderer.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/captionRenderer.ts lib/server/captionRenderer.test.ts
git commit -m "feat(clipping): captionRenderer — word timings to burnable ASS"
```

---

### Task 3: clipMomentSelector — transcript + config → moments (Claude, degrade path)

**Files:**
- Create: `lib/server/clipMomentSelector.ts`
- Test: `lib/server/clipMomentSelector.test.ts`

The function accepts an injectable `callJSON` so tests run with no network. On failure (throws or invalid shape) it retries once, then **degrades** to evenly-spaced clips of `clipLength.min` length covering the source.

- [ ] **Step 1: Write the failing test** `lib/server/clipMomentSelector.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { selectClipMoments } from "./clipMomentSelector";
import type { Transcript, ClipConfig } from "./clipTypes";

const transcript: Transcript = {
  durationSeconds: 120,
  segments: [{ start: 0, end: 120, text: "a long talk about shipping startups fast" }],
  words: [],
};
const config: ClipConfig = {
  clipLength: { min: 20, max: 40 }, maxClipsPerSource: 2, captionsOn: true,
  captionStyle: { mode: "karaoke", fontColor: "#fff", fontSize: 48, position: "bottom" },
  hookStyle: "cold_open", platforms: ["tiktok"], autoPost: true,
};

describe("selectClipMoments", () => {
  it("returns the LLM moments, clamped to maxClipsPerSource", async () => {
    const callJSON = vi.fn().mockResolvedValue({ moments: [
      { startSeconds: 5, endSeconds: 30, title: "Hook", reason: "strong open", viralScore: 90, captionText: "Ship fast" },
      { startSeconds: 60, endSeconds: 88, title: "Lesson", reason: "insight", viralScore: 80, captionText: "Do less" },
      { startSeconds: 95, endSeconds: 119, title: "Extra", reason: "ok", viralScore: 50, captionText: "Bonus" },
    ] });
    const out = await selectClipMoments(transcript, config, { callJSON });
    expect(out).toHaveLength(2);            // clamped to maxClipsPerSource
    expect(out[0].title).toBe("Hook");
    expect(out[0].viralScore).toBeGreaterThanOrEqual(out[1].viralScore); // sorted desc
  });

  it("degrades to evenly-spaced clips when the LLM fails twice", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("503"));
    const out = await selectClipMoments(transcript, config, { callJSON });
    expect(callJSON).toHaveBeenCalledTimes(2);   // retried once
    expect(out).toHaveLength(2);
    expect(out[0].endSeconds - out[0].startSeconds).toBe(20); // clipLength.min
    out.forEach((m) => { expect(m.startSeconds).toBeGreaterThanOrEqual(0); expect(m.endSeconds).toBeLessThanOrEqual(120); });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run lib/server/clipMomentSelector.test.ts` → FAIL.

- [ ] **Step 3: Write `lib/server/clipMomentSelector.ts`**

```ts
import { callClaudeJSON } from "./kie-claude";
import type { Transcript, ClipConfig, ClipMoment } from "./clipTypes";

type CallJSON = (args: { system: string; user: string; apiKey?: string }) => Promise<unknown>;

export interface SelectDeps { callJSON?: CallJSON; apiKey?: string; }

function evenlySpaced(transcript: Transcript, config: ClipConfig): ClipMoment[] {
  const len = config.clipLength.min;
  const n = Math.max(1, Math.min(config.maxClipsPerSource, Math.floor(transcript.durationSeconds / len)));
  const stride = transcript.durationSeconds / n;
  return Array.from({ length: n }, (_, i) => {
    const start = Math.round(i * stride);
    const end = Math.min(transcript.durationSeconds, start + len);
    return { startSeconds: start, endSeconds: end, title: `Clip ${i + 1}`, reason: "auto-segmented (LLM unavailable)", viralScore: 50, captionText: "" };
  });
}

function parseMoments(raw: unknown, config: ClipConfig): ClipMoment[] | null {
  const arr = (raw as { moments?: unknown })?.moments;
  if (!Array.isArray(arr)) return null;
  const moments = arr
    .map((m): ClipMoment | null => {
      const o = m as Record<string, unknown>;
      if (typeof o.startSeconds !== "number" || typeof o.endSeconds !== "number" || o.endSeconds <= o.startSeconds) return null;
      return {
        startSeconds: Math.max(0, o.startSeconds), endSeconds: o.endSeconds,
        title: String(o.title ?? "Clip").slice(0, 80), reason: String(o.reason ?? "").slice(0, 200),
        viralScore: Math.max(0, Math.min(100, Number(o.viralScore ?? 50))),
        captionText: String(o.captionText ?? "").slice(0, 200),
      };
    })
    .filter((m): m is ClipMoment => m !== null);
  if (moments.length === 0) return null;
  return moments.sort((a, b) => b.viralScore - a.viralScore).slice(0, config.maxClipsPerSource);
}

/**
 * Pick the most viral moments from a transcript. Retries the LLM once, then
 * degrades to evenly-spaced clips so a clip job never yields zero clips.
 */
export async function selectClipMoments(transcript: Transcript, config: ClipConfig, deps: SelectDeps = {}): Promise<ClipMoment[]> {
  const callJSON: CallJSON = deps.callJSON ?? (callClaudeJSON as unknown as CallJSON);
  const system = `You are a short-form clip producer. From a transcript, pick the ${config.maxClipsPerSource} MOST viral standalone moments.
Rules: each clip ${config.clipLength.min}-${config.clipLength.max}s long; must be self-contained; ${config.hookStyle === "cold_open" ? "start ON the most gripping line (cold open)" : "include one line of setup then the payoff"}.
Return ONLY JSON: {"moments":[{"startSeconds":number,"endSeconds":number,"title":string,"reason":string,"viralScore":0-100,"captionText":string}]}.`;
  const user = `SOURCE DURATION: ${transcript.durationSeconds}s\n\nTRANSCRIPT (timed segments):\n${transcript.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n").slice(0, 7000)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callJSON({ system, user, apiKey: deps.apiKey });
      const parsed = parseMoments(raw, config);
      if (parsed) return parsed;
    } catch { /* retry, then degrade */ }
  }
  return evenlySpaced(transcript, config);
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run lib/server/clipMomentSelector.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/clipMomentSelector.ts lib/server/clipMomentSelector.test.ts
git commit -m "feat(clipping): clipMomentSelector with retry + evenly-spaced degrade"
```

---

### Task 4: clipEditPlanner — skills + moment → EditOp[]

**Files:**
- Create: `lib/server/clipEditPlanner.ts`
- Test: `lib/server/clipEditPlanner.test.ts`

Grounds the edit plan in the operator's authored skills. Injectable `callJSON`. Output is always run through `validateEditPlan` (Task 1), so a hallucinated op never escapes. Degrade path = `[reframe]` + (`subtitles` when `captionsOn`).

- [ ] **Step 1: Write the failing test** `lib/server/clipEditPlanner.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { planClipEdits } from "./clipEditPlanner";
import type { ClipConfig, ClipMoment, TranscriptSegment } from "./clipTypes";

const config: ClipConfig = {
  clipLength: { min: 20, max: 40 }, maxClipsPerSource: 3, captionsOn: true,
  captionStyle: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" },
  hookStyle: "cold_open", platforms: ["tiktok"], autoPost: true,
};
const moment: ClipMoment = { startSeconds: 5, endSeconds: 30, title: "Hook", reason: "x", viralScore: 90, captionText: "Ship fast" };
const window: TranscriptSegment[] = [{ start: 5, end: 30, text: "ship fast and learn" }];
const skills = [{ name: "Hook captions", instructions: "Always burn karaoke subs and a bold hook caption in the first 2 seconds." }];

describe("planClipEdits", () => {
  it("returns a validated plan honoring the skill (subtitles + hook text_overlay), reframe first", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "subtitles", style: config.captionStyle },
      { op: "text_overlay", text: "POV: you ship fast", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 56, bold: true } },
    ] });
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    expect(out[0].op).toBe("reframe");
    expect(out.some((o) => o.op === "subtitles")).toBe(true);
    expect(out.some((o) => o.op === "text_overlay")).toBe(true);
  });

  it("degrades to reframe + subtitles when the LLM fails", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("boom"));
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    expect(out[0].op).toBe("reframe");
    expect(out.some((o) => o.op === "subtitles")).toBe(true); // captionsOn
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run lib/server/clipEditPlanner.test.ts` → FAIL.

- [ ] **Step 3: Write `lib/server/clipEditPlanner.ts`**

```ts
import { callClaudeJSON } from "./kie-claude";
import { validateEditPlan, type EditOp } from "./clipEditOps";
import type { ClipConfig, ClipMoment, TranscriptSegment } from "./clipTypes";

type CallJSON = (args: { system: string; user: string; apiKey?: string }) => Promise<unknown>;

export interface PlanArgs {
  skills: Array<{ name: string; instructions: string }>;
  config: ClipConfig;
  window: TranscriptSegment[];
  moment: ClipMoment;
}
export interface PlanDeps { callJSON?: CallJSON; apiKey?: string; }

function degrade(config: ClipConfig): EditOp[] {
  const ops: EditOp[] = [{ op: "reframe", mode: "crop" }];
  if (config.captionsOn) ops.push({ op: "subtitles", style: config.captionStyle });
  if (config.brandLogoUrl) ops.push({ op: "logo_overlay", imageUrl: config.brandLogoUrl, corner: "br", opacity: 0.85 });
  return ops;
}

/**
 * Compose the per-clip edit plan, grounded in the operator's authored SKILLS.
 * Always validated (reframe forced first; unknown ops dropped). Falls back to a
 * safe default plan if the LLM is unavailable.
 */
export async function planClipEdits(args: PlanArgs, deps: PlanDeps = {}): Promise<EditOp[]> {
  const callJSON: CallJSON = deps.callJSON ?? (callClaudeJSON as unknown as CallJSON);
  const skillsBlock = args.skills.slice(0, 6).map((s) => `- ${s.name}: ${s.instructions.slice(0, 300).replace(/\s+/g, " ").trim()}`).join("\n");
  const system = `You are a short-form video editor. Output an ORDERED edit plan for ONE 9:16 clip as JSON.
Allowed ops (compose freely; obey the SKILLS):
- {"op":"reframe","mode":"crop"|"pad"}            (always include; runs first)
- {"op":"subtitles","style":{"mode":"karaoke"|"line","fontColor":"#hex","fontSize":num,"position":"top"|"center"|"bottom"}}
- {"op":"text_overlay","text":str,"position":"top"|"center"|"bottom"|"top-left"|"top-right"|"bottom-left"|"bottom-right","startSec":num,"endSec":num,"style":{"fontColor":"#hex","fontSize":num,"bold":bool}}
- {"op":"title_card","text":str,"durationSec":1-5,"style":{...}}
- {"op":"logo_overlay","imageUrl":str,"corner":"tl"|"tr"|"bl"|"br","opacity":0-1}
- {"op":"emphasis","kind":"zoom_punch"|"speed"|"freeze","atSec":num}
The SKILLS are the operator's rules — follow them exactly. Return ONLY {"ops":[...]}.`;
  const clipLen = (args.moment.endSeconds - args.moment.startSeconds).toFixed(1);
  const user = `OPERATOR SKILLS (obey):\n${skillsBlock || "(none — use sensible defaults)"}\n
CAPTIONS DEFAULT: ${args.config.captionsOn ? `ON (${args.config.captionStyle.mode}, ${args.config.captionStyle.fontColor})` : "OFF"}
${args.config.brandLogoUrl ? `BRAND LOGO available: ${args.config.brandLogoUrl}` : ""}
CLIP: "${args.moment.title}" — ${clipLen}s. Hook caption text idea: "${args.moment.captionText}".
TRANSCRIPT (clip window):\n${args.window.map((s) => s.text).join(" ").slice(0, 1500)}`;

  try {
    const raw = await callJSON({ system, user, apiKey: deps.apiKey });
    const ops = (raw as { ops?: unknown })?.ops;
    const plan = validateEditPlan(ops);
    // Guarantee captions when the operator turned them on but the LLM omitted them.
    if (args.config.captionsOn && !plan.some((o) => o.op === "subtitles")) {
      plan.push({ op: "subtitles", style: args.config.captionStyle });
    }
    return plan;
  } catch {
    return degrade(args.config);
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run lib/server/clipEditPlanner.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/clipEditPlanner.ts lib/server/clipEditPlanner.test.ts
git commit -m "feat(clipping): clipEditPlanner — skill-driven EditOp plan"
```

---

### Task 5: downloader — interface + directFetch + social stub

**Files:**
- Create: `lib/server/downloader.ts`
- Test: `lib/server/downloader.test.ts`

`resolveDownloader(url)` returns `directFetch` for direct video/file URLs, and the `socialStub` (which throws a friendly error) for youtube/tiktok/instagram/x hosts. v1 does not download social URLs.

- [ ] **Step 1: Write the failing test** `lib/server/downloader.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolveDownloader, SOCIAL_UNSUPPORTED_MSG } from "./downloader";

describe("resolveDownloader", () => {
  it("uses directFetch for direct video URLs", () => {
    expect(resolveDownloader("https://cdn.brand.com/asset/video.mp4").kind).toBe("direct");
    expect(resolveDownloader("https://x.supabase.co/storage/v1/object/public/v/a.mov").kind).toBe("direct");
  });

  it("returns the social stub for youtube/tiktok and it throws the friendly message", async () => {
    const d = resolveDownloader("https://www.youtube.com/watch?v=abc12345678");
    expect(d.kind).toBe("social");
    await expect(d.fetchSource("https://www.youtube.com/watch?v=abc12345678")).rejects.toThrow(SOCIAL_UNSUPPORTED_MSG);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run lib/server/downloader.test.ts` → FAIL.

- [ ] **Step 3: Write `lib/server/downloader.ts`**

```ts
export const SOCIAL_UNSUPPORTED_MSG =
  "Paste a direct video link or use a brand campaign asset — social-URL import is coming soon.";

export interface FetchedSource { buffer: Buffer; mime: string; }
export interface Downloader {
  kind: "direct" | "social";
  /** Fetch raw bytes of the source video. The Next route stores them + probes duration. */
  fetchSource(url: string): Promise<FetchedSource>;
}

const SOCIAL_HOSTS = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|#|$)/i;

const directFetch: Downloader = {
  kind: "direct",
  async fetchSource(url: string): Promise<FetchedSource> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const mime = res.headers.get("content-type") ?? "video/mp4";
    if (!/^video\//i.test(mime) && !VIDEO_EXT.test(url)) {
      throw new Error(`Not a video (content-type ${mime}). Use a direct .mp4/.mov link.`);
    }
    return { buffer: Buffer.from(await res.arrayBuffer()), mime };
  },
};

const socialStub: Downloader = {
  kind: "social",
  async fetchSource(): Promise<FetchedSource> { throw new Error(SOCIAL_UNSUPPORTED_MSG); },
};

/** Pick the downloader for a URL. v1: direct files only; social hosts throw. */
export function resolveDownloader(url: string): Downloader {
  let host = "";
  try { host = new URL(url).hostname; } catch { /* fall through */ }
  if (SOCIAL_HOSTS.test(host)) return socialStub;
  return directFetch;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run lib/server/downloader.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/downloader.ts lib/server/downloader.test.ts
git commit -m "feat(clipping): downloader — direct fetch + social v1 stub"
```

---

### Task 6: clipConfig defaults + validation

**Files:**
- Create: `lib/builder/clipConfig.ts`
- Test: `lib/builder/clipConfig.test.ts`

- [ ] **Step 1: Write the failing test** `lib/builder/clipConfig.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_CLIP_CONFIG, normalizeClipConfig } from "./clipConfig";

describe("normalizeClipConfig", () => {
  it("fills defaults for an empty input", () => {
    const c = normalizeClipConfig({});
    expect(c).toEqual(DEFAULT_CLIP_CONFIG);
  });
  it("clamps length + N and filters platforms to the whitelist", () => {
    const c = normalizeClipConfig({ clipLength: { min: 1, max: 999 }, maxClipsPerSource: 99, platforms: ["tiktok", "myspace"] });
    expect(c.clipLength.min).toBeGreaterThanOrEqual(5);
    expect(c.clipLength.max).toBeLessThanOrEqual(90);
    expect(c.maxClipsPerSource).toBeLessThanOrEqual(10);
    expect(c.platforms).toEqual(["tiktok"]);     // myspace dropped
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run lib/builder/clipConfig.test.ts` → FAIL.

- [ ] **Step 3: Write `lib/builder/clipConfig.ts`**

```ts
import type { ClipConfig } from "@/lib/server/clipTypes";

const PLATFORM_WHITELIST = ["tiktok", "instagram", "threads", "youtube", "facebook", "x"];

export const DEFAULT_CLIP_CONFIG: ClipConfig = {
  clipLength: { min: 20, max: 45 },
  maxClipsPerSource: 3,
  captionsOn: true,
  captionStyle: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" },
  hookStyle: "cold_open",
  platforms: ["tiktok"],
  autoPost: true,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Merge partial operator input over the defaults with safe bounds. */
export function normalizeClipConfig(input: Partial<ClipConfig>): ClipConfig {
  const d = DEFAULT_CLIP_CONFIG;
  const minLen = clamp(input.clipLength?.min ?? d.clipLength.min, 5, 90);
  const maxLen = clamp(input.clipLength?.max ?? d.clipLength.max, minLen, 90);
  const platforms = (input.platforms ?? d.platforms).filter((p) => PLATFORM_WHITELIST.includes(p));
  return {
    clipLength: { min: minLen, max: maxLen },
    maxClipsPerSource: clamp(input.maxClipsPerSource ?? d.maxClipsPerSource, 1, 10),
    captionsOn: input.captionsOn ?? d.captionsOn,
    captionStyle: input.captionStyle ?? d.captionStyle,
    hookStyle: input.hookStyle === "context_first" ? "context_first" : "cold_open",
    platforms: platforms.length ? platforms : d.platforms,
    autoPost: input.autoPost ?? d.autoPost,
    brandLogoUrl: input.brandLogoUrl,
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run lib/builder/clipConfig.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/builder/clipConfig.ts lib/builder/clipConfig.test.ts
git commit -m "feat(clipping): clipConfig defaults + normalization"
```

---

### Task 7: Convex schema — clipJobs + clips tables + clipConfig on influencers

**Files:**
- Modify: `convex/schema.ts` (influencers table + two new tables)

- [ ] **Step 1: Add `clipConfig` to the `influencers` table** (after the `avatarStills` field added earlier):

```ts
    // Clipping-agent config (only set when agentType === "clipping").
    clipConfig: v.optional(v.object({
      clipLength: v.object({ min: v.number(), max: v.number() }),
      maxClipsPerSource: v.number(),
      captionsOn: v.boolean(),
      captionStyle: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string() }),
      hookStyle: v.string(),
      platforms: v.array(v.string()),
      autoPost: v.boolean(),
      brandLogoUrl: v.optional(v.string()),
    })),
```

- [ ] **Step 2: Add the two new tables** (alongside the other `defineTable` blocks):

```ts
  clipJobs: defineTable({
    mintAddress: v.string(),
    sessionId: v.optional(v.string()),
    sourceUrl: v.string(),
    sourceType: v.string(),               // "url" | "campaign_asset"
    campaignId: v.optional(v.string()),
    contentRewardId: v.optional(v.string()),
    ownerWallet: v.optional(v.string()),
    status: v.string(),                   // queued|downloading|transcribing|analyzing|clipping|posting|completed|error
    durationSeconds: v.optional(v.number()),
    transcript: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_status", ["status"]),

  clips: defineTable({
    jobId: v.id("clipJobs"),
    mintAddress: v.string(),
    title: v.string(),
    reason: v.string(),
    startSeconds: v.number(),
    endSeconds: v.number(),
    viralScore: v.number(),
    clipUrl: v.optional(v.string()),
    captionText: v.string(),
    status: v.string(),                   // rendering|ready|posting|posted|skipped|failed
    postUrl: v.optional(v.string()),
    platform: v.optional(v.string()),
    submissionId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_mint", ["mintAddress"]),
```

- [ ] **Step 3: Regenerate + typecheck**

Run: `npx convex codegen && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^marketing-video/' | grep -v 'bigint is not assignable'`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(clipping): clipJobs + clips tables + clipConfig on influencers"
```

---

### Task 8: Convex queries + mutations for clip jobs/clips

**Files:**
- Create: `convex/clipJobs.ts` (queries + mutations; the `process` action is Task 12)

- [ ] **Step 1: Write the mutations + queries**

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const enqueue = mutation({
  args: {
    mintAddress: v.string(),
    sessionId: v.optional(v.string()),
    sourceUrl: v.string(),
    sourceType: v.string(),
    campaignId: v.optional(v.string()),
    contentRewardId: v.optional(v.string()),
    ownerWallet: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("clipJobs", { ...args, status: "queued", createdAt: now, updatedAt: now });
    return jobId;
  },
});

export const setStatus = mutation({
  args: { jobId: v.id("clipJobs"), status: v.string(), error: v.optional(v.string()),
          durationSeconds: v.optional(v.number()), transcript: v.optional(v.string()) },
  handler: async (ctx, { jobId, ...patch }) => {
    await ctx.db.patch(jobId, { ...patch, updatedAt: Date.now() });
  },
});

export const insertClip = mutation({
  args: { jobId: v.id("clipJobs"), mintAddress: v.string(), title: v.string(), reason: v.string(),
          startSeconds: v.number(), endSeconds: v.number(), viralScore: v.number(), captionText: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("clips", { ...args, status: "rendering", createdAt: now, updatedAt: now });
  },
});

export const setClip = mutation({
  args: { clipId: v.id("clips"), status: v.optional(v.string()), clipUrl: v.optional(v.string()),
          postUrl: v.optional(v.string()), platform: v.optional(v.string()), submissionId: v.optional(v.string()),
          captionText: v.optional(v.string()) },
  handler: async (ctx, { clipId, ...patch }) => {
    await ctx.db.patch(clipId, { ...patch, updatedAt: Date.now() });
  },
});

// Reactive list for the builder Clips queue (newest first).
export const listClipsByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const rows = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listJobsByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const rows = await ctx.db.query("clipJobs").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getClipsForJob = query({
  args: { jobId: v.id("clipJobs") },
  handler: async (ctx, { jobId }) => ctx.db.query("clips").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect(),
});
```

- [ ] **Step 2: Regenerate + typecheck**

Run: `npx convex codegen && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^marketing-video/' | grep -v 'bigint is not assignable'`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add convex/clipJobs.ts convex/_generated
git commit -m "feat(clipping): clipJobs convex queries + mutations"
```

---

### Task 9: `/api/video/download` route

**Files:**
- Create: `app/api/video/download/route.ts`
- Modify: `convex/clipStorage.ts` (a tiny mutation to mint a Convex storage upload URL) — OR store via the existing pattern.

The route resolves the `Downloader`, fetches bytes, stores them, probes duration with ffmpeg, and returns `{ url, durationSeconds }`. It stores to **Convex storage** via an action-generated upload URL the same way `videoJobs` uses `ctx.storage`. Since this route is in Next (no `ctx.storage`), it uploads through the Convex HTTP `generateUploadUrl` pattern.

- [ ] **Step 1: Add a storage upload-url mutation** `convex/clipStorage.ts`

```ts
import { mutation } from "./_generated/server";
export const generateUploadUrl = mutation(async (ctx) => await ctx.storage.generateUploadUrl());
export const getUrl = mutation({
  args: {},
  handler: async () => null, // placeholder; real getUrl below
});
```

Then add to `convex/clipStorage.ts` a `getStorageUrl`:

```ts
import { v } from "convex/values";
import { mutation } from "./_generated/server";
export const resolveStorageUrl = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => await ctx.storage.getUrl(storageId),
});
```

(Keep only `generateUploadUrl` + `resolveStorageUrl`; delete the placeholder `getUrl`.)

- [ ] **Step 2: Write the route** `app/api/video/download/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { resolveDownloader } from "@/lib/server/downloader";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

function probeDuration(bin: string, path: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0);
    });
    proc.on("error", () => resolve(0));
  });
}

export async function POST(req: NextRequest) {
  let body: { sourceUrl?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const sourceUrl = String(body.sourceUrl ?? "");
  if (!sourceUrl) return NextResponse.json({ error: "sourceUrl required" }, { status: 400 });
  if (!ffmpegPath) return NextResponse.json({ error: "ffmpeg unavailable" }, { status: 500 });
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex URL not set" }, { status: 500 });

  const workDir = await mkdtemp(join(tmpdir(), "vello-dl-"));
  try {
    const dl = resolveDownloader(sourceUrl);
    const { buffer, mime } = await dl.fetchSource(sourceUrl);   // social stub throws the friendly message
    const localPath = join(workDir, "src.mp4");
    await writeFile(localPath, buffer);
    const durationSeconds = await probeDuration(ffmpegPath, localPath);

    const convex = new ConvexHttpClient(CONVEX_URL);
    const uploadUrl = await convex.mutation(api.clipStorage.generateUploadUrl, {});
    const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mime }, body: new Uint8Array(buffer) });
    const { storageId } = (await up.json()) as { storageId: string };
    const url = await convex.mutation(api.clipStorage.resolveStorageUrl, { storageId: storageId as unknown as never });
    if (!url) throw new Error("storage getUrl returned null");

    return NextResponse.json({ ok: true, url, durationSeconds });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 200 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

- [ ] **Step 3: Codegen + typecheck**

Run: `npx convex codegen && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^marketing-video/' | grep -v 'bigint is not assignable'`
Expected: no output.

- [ ] **Step 4: Manual smoke** — POST a small direct `.mp4` URL; confirm `{ ok: true, url, durationSeconds > 0 }`. POST a youtube URL; confirm `{ ok: false, error: "Paste a direct video link…" }`.

- [ ] **Step 5: Commit**

```bash
git add app/api/video/download/route.ts convex/clipStorage.ts convex/_generated
git commit -m "feat(clipping): /api/video/download — fetch + store + probe duration"
```

---

### Task 10: `/api/video/transcribe-clip` route (OpenAI Whisper, word timings)

**Files:**
- Create: `app/api/video/transcribe-clip/route.ts`

ffmpeg extracts mono 16kHz MP3 audio (small → fits Whisper's 25MB limit for typical sources) from the stored source URL, then calls OpenAI Whisper `whisper-1` with `response_format=verbose_json` and `timestamp_granularities[]=segment` & `word`. Returns `{ segments, words, durationSeconds }`.

- [ ] **Step 1: Write the route** `app/api/video/transcribe-clip/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let e = ""; proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 8000) e = e.slice(-8000); });
    proc.on("error", reject);
    proc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${e.slice(-400)}`))));
  });
}

export async function POST(req: NextRequest) {
  let body: { sourceUrl?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const sourceUrl = String(body.sourceUrl ?? "");
  if (!sourceUrl) return NextResponse.json({ error: "sourceUrl required" }, { status: 400 });
  if (!OPENAI_KEY) return NextResponse.json({ ok: false, error: "OPENAI_API_KEY not set" }, { status: 200 });
  if (!ffmpegPath) return NextResponse.json({ error: "ffmpeg unavailable" }, { status: 500 });

  const workDir = await mkdtemp(join(tmpdir(), "vello-stt-"));
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`fetch source HTTP ${res.status}`);
    const srcPath = join(workDir, "src.mp4");
    await writeFile(srcPath, Buffer.from(await res.arrayBuffer()));

    const audioPath = join(workDir, "audio.mp3");
    await runFfmpeg(ffmpegPath, ["-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath]);
    const audio = await readFile(audioPath);

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    form.append("timestamp_granularities[]", "word");

    const stt = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: form,
    });
    if (!stt.ok) throw new Error(`whisper HTTP ${stt.status}: ${(await stt.text()).slice(0, 200)}`);
    const data = (await stt.json()) as {
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string }>;
      words?: Array<{ word: string; start: number; end: number }>;
    };

    return NextResponse.json({
      ok: true,
      durationSeconds: data.duration ?? 0,
      segments: (data.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })),
      words: (data.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 200 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^marketing-video/' | grep -v 'bigint is not assignable'` → no output.

- [ ] **Step 3: Manual smoke** — POST a stored short MP4 with speech; confirm `segments.length > 0` and `words[0].start` is a number.

- [ ] **Step 4: Commit**

```bash
git add app/api/video/transcribe-clip/route.ts
git commit -m "feat(clipping): /api/video/transcribe-clip — ffmpeg audio + Whisper word timings"
```

---

### Task 11: `/api/video/clip` route — cut + apply EditOp[]

**Files:**
- Create: `app/api/video/clip/route.ts`

Body: `{ sourceUrl, startSeconds, endSeconds, ops: EditOp[], words: TranscriptWord[] }`. Builds one ffmpeg invocation: trim `[start,end]`, then a filtergraph assembled from the ops in order (reframe → emphasis/speed → drawtext overlays → subtitles burn → logo overlay), optionally prepended title card, re-encode, store to Convex storage, return `{ clipUrl }`. Mirrors the `concat` route's spawn/store pattern.

- [ ] **Step 1: Write the route** `app/api/video/clip/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { validateEditPlan } from "@/lib/server/clipEditOps";
import { renderCaptionsAss } from "@/lib/server/captionRenderer";
import type { TranscriptWord, CaptionStyle } from "@/lib/server/clipTypes";

export const runtime = "nodejs";
export const maxDuration = 300;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let e = ""; proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 8000) e = e.slice(-8000); });
    proc.on("error", reject);
    proc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${e.slice(-500)}`))));
  });
}

// drawtext anchor → x/y expressions on a 1080x1920 canvas.
const POS: Record<string, { x: string; y: string }> = {
  top: { x: "(w-text_w)/2", y: "h*0.08" }, center: { x: "(w-text_w)/2", y: "(h-text_h)/2" }, bottom: { x: "(w-text_w)/2", y: "h*0.82" },
  "top-left": { x: "40", y: "h*0.08" }, "top-right": { x: "w-text_w-40", y: "h*0.08" },
  "bottom-left": { x: "40", y: "h*0.82" }, "bottom-right": { x: "w-text_w-40", y: "h*0.82" },
};
const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’");

export async function POST(req: NextRequest) {
  let body: { sourceUrl?: string; startSeconds?: number; endSeconds?: number; ops?: unknown; words?: TranscriptWord[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { sourceUrl, startSeconds = 0, endSeconds = 0 } = body;
  if (!sourceUrl || endSeconds <= startSeconds) return NextResponse.json({ error: "sourceUrl + valid window required" }, { status: 400 });
  if (!ffmpegPath || !CONVEX_URL) return NextResponse.json({ error: "ffmpeg/convex unavailable" }, { status: 500 });

  const ops = validateEditPlan(body.ops);
  const words = Array.isArray(body.words) ? body.words : [];
  const dur = endSeconds - startSeconds;
  const workDir = await mkdtemp(join(tmpdir(), "vello-clip-"));
  try {
    // 1. Download + trim the window first (fast seek).
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`fetch source HTTP ${res.status}`);
    const srcPath = join(workDir, "src.mp4");
    await writeFile(srcPath, Buffer.from(await res.arrayBuffer()));

    // 2. Build the filtergraph from ops (in order).
    const filters: string[] = [];
    const reframe = ops.find((o) => o.op === "reframe");
    if (reframe && reframe.op === "reframe" && reframe.mode === "pad") {
      filters.push("scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black");
    } else {
      filters.push("scale=-2:1920,crop=1080:1920"); // crop-to-fill 9:16
    }
    for (const o of ops) {
      if (o.op === "emphasis" && o.kind === "speed") filters.push(`setpts=${(1 / (o.amount ?? 1.25)).toFixed(3)}*PTS`);
      if (o.op === "text_overlay") {
        const p = POS[o.position] ?? POS.top;
        filters.push(`drawtext=text='${esc(o.text)}':fontcolor=${o.style.fontColor}:fontsize=${o.style.fontSize}:borderw=3:bordercolor=black:x=${p.x}:y=${p.y}:enable='between(t,${o.startSec},${o.endSec})'`);
      }
      if (o.op === "logo_overlay") { /* handled as a second input below */ }
    }
    // 3. Subtitles burn (write ASS file, append filter).
    const subOp = ops.find((o) => o.op === "subtitles");
    if (subOp && subOp.op === "subtitles") {
      const assPath = join(workDir, "subs.ass");
      await writeFile(assPath, renderCaptionsAss(words, { clipStartSec: startSeconds, clipEndSec: endSeconds, style: subOp.style as CaptionStyle }));
      filters.push(`subtitles=${assPath.replace(/\\/g, "/").replace(/:/g, "\\:")}`);
    }

    // 4. Run ffmpeg: seek + trim + filtergraph + re-encode.
    const outPath = join(workDir, "out.mp4");
    await runFfmpeg(ffmpegPath, [
      "-y", "-ss", String(startSeconds), "-t", String(dur), "-i", srcPath,
      "-vf", filters.join(","), "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac",
      "-movflags", "+faststart", outPath,
    ]);

    // 5. Store to Convex storage.
    const out = await readFile(outPath);
    const convex = new ConvexHttpClient(CONVEX_URL);
    const uploadUrl = await convex.mutation(api.clipStorage.generateUploadUrl, {});
    const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array(out) });
    const { storageId } = (await up.json()) as { storageId: string };
    const clipUrl = await convex.mutation(api.clipStorage.resolveStorageUrl, { storageId: storageId as unknown as never });

    return NextResponse.json({ ok: true, clipUrl });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 200 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

> Note: `title_card`, `logo_overlay`, and `zoom_punch`/`freeze` emphasis need a second ffmpeg input / pre-concat; v1 ships `reframe`, `subtitles`, `text_overlay`, and `speed`. The remaining ops are accepted by `validateEditPlan` but rendered as no-ops until a follow-up step adds their ffmpeg handlers (logged so they aren't silently lost). Add a `console.warn` for any op whose handler is not yet implemented.

- [ ] **Step 2: Add the no-op warning** — after building `filters`, log unimplemented ops:

```ts
    const implemented = new Set(["reframe", "subtitles", "text_overlay", "emphasis"]);
    ops.filter((o) => !implemented.has(o.op)).forEach((o) => console.warn(`[video/clip] op '${o.op}' not yet rendered (accepted, skipped)`));
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^marketing-video/' | grep -v 'bigint is not assignable'` → no output.

- [ ] **Step 4: Manual smoke** — POST a stored MP4 + a `[5,25]` window + `[{op:"reframe",mode:"crop"},{op:"subtitles",style:{...}}]` + the words array; confirm a 9:16 captioned `clipUrl` plays.

- [ ] **Step 5: Commit**

```bash
git add app/api/video/clip/route.ts
git commit -m "feat(clipping): /api/video/clip — trim + reframe + subtitles + text overlays"
```

---

### Task 12: Convex `clipJobs.process` action — the orchestrator

**Files:**
- Modify: `convex/clipJobs.ts` (add the `process` internalAction + wire `enqueue` to schedule it)

Mirror `convex/videoJobs.ts`: forward `kieApiKey` + `appUrl`; call the Next routes; advance status; insert clips; cut each; auto-post top N; submit. Runs in the 10-min action budget.

- [ ] **Step 1: Add imports + schedule from `enqueue`** at the top of `convex/clipJobs.ts`:

```ts
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
```

In `enqueue`'s handler, after inserting, schedule the job (add `kieApiKey`/`appUrl` args to `enqueue`):

```ts
    await ctx.scheduler.runAfter(0, internal.clipJobs.process, { jobId, kieApiKey: args.kieApiKey, appUrl: args.appUrl });
    return jobId;
```

(Add `kieApiKey: v.optional(v.string())`, `appUrl: v.optional(v.string())` to `enqueue.args`.)

- [ ] **Step 2: Add the `process` action**

```ts
export const process = internalAction({
  args: { jobId: v.id("clipJobs"), kieApiKey: v.optional(v.string()), appUrl: v.optional(v.string()) },
  handler: async (ctx, { jobId, kieApiKey, appUrl }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? appUrl ?? "http://localhost:3000";
    const job = await ctx.runQuery(api.clipJobs.getJob, { jobId });
    if (!job) return null;
    const { selectClipMoments } = await import("../lib/server/clipMomentSelector");
    const { planClipEdits } = await import("../lib/server/clipEditPlanner");
    const { normalizeClipConfig } = await import("../lib/builder/clipConfig");

    const set = (patch: Record<string, unknown>) => ctx.runMutation(api.clipJobs.setStatus, { jobId, ...patch } as never);
    const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

    try {
      // Load the agent (config + skills).
      const agent = await ctx.runQuery(api.influencers.getByMint, { mintAddress: job.mintAddress });
      const config = normalizeClipConfig((agent?.clipConfig ?? {}) as never);
      const skillFiles = await ctx.runQuery(api.agentSkillFiles.listByMint, { mintAddress: job.mintAddress });
      const skills = (skillFiles ?? []).map((s: { title: string; markdown: string }) => ({ name: s.title, instructions: s.markdown.replace(/^---[\s\S]*?---\s*/, "").trim() }));

      // 1. Download.
      await set({ status: "downloading" });
      const dl = await post("/api/video/download", { sourceUrl: job.sourceUrl });
      if (!dl.ok) { await set({ status: "error", error: dl.error }); return null; }
      await set({ status: "transcribing", durationSeconds: dl.durationSeconds });

      // 2. Transcribe.
      const stt = await post("/api/video/transcribe-clip", { sourceUrl: dl.url });
      if (!stt.ok || !(stt.segments?.length)) { await set({ status: "error", error: stt.error ?? "no transcript" }); return null; }
      const transcript = { durationSeconds: stt.durationSeconds || dl.durationSeconds, segments: stt.segments, words: stt.words };

      // 3. Select moments.
      await set({ status: "analyzing" });
      const moments = await selectClipMoments(transcript, config, { apiKey: kieApiKey });

      // Insert clip rows.
      const clipIds: string[] = [];
      for (const m of moments) {
        const id = await ctx.runMutation(api.clipJobs.insertClip, {
          jobId, mintAddress: job.mintAddress, title: m.title, reason: m.reason,
          startSeconds: m.startSeconds, endSeconds: m.endSeconds, viralScore: m.viralScore, captionText: m.captionText,
        });
        clipIds.push(id);
      }

      // 4. Cut each clip (+ edit plan).
      await set({ status: "clipping" });
      for (let i = 0; i < moments.length; i++) {
        const m = moments[i];
        const window = transcript.segments.filter((s: { start: number; end: number }) => s.end > m.startSeconds && s.start < m.endSeconds);
        const ops = await planClipEdits({ skills, config, window, moment: m }, { apiKey: kieApiKey });
        const cut = await post("/api/video/clip", { sourceUrl: dl.url, startSeconds: m.startSeconds, endSeconds: m.endSeconds, ops, words: transcript.words });
        if (cut.ok && cut.clipUrl) await ctx.runMutation(api.clipJobs.setClip, { clipId: clipIds[i] as never, status: "ready", clipUrl: cut.clipUrl });
        else await ctx.runMutation(api.clipJobs.setClip, { clipId: clipIds[i] as never, status: "failed" });
      }

      // 5. Auto-post the top N ready clips (if enabled).
      if (config.autoPost) {
        await set({ status: "posting" });
        const ready = await ctx.runQuery(api.clipJobs.getClipsForJob, { jobId });
        const top = ready.filter((c: { status: string; clipUrl?: string }) => c.status === "ready" && c.clipUrl)
          .sort((a: { viralScore: number }, b: { viralScore: number }) => b.viralScore - a.viralScore)
          .slice(0, config.maxClipsPerSource);
        for (const c of top) {
          const r = await post(`/api/agents/run-task`, {
            mintAddress: job.mintAddress, taskType: "post_content", title: `Clip: ${c.title}`,
            input: { platforms: config.platforms, contentType: "video", mediaUrl: c.clipUrl, text: c.captionText || c.title, description: c.captionText || c.title, niche: agent?.niche },
            triggeredBy: "clip_autopost",
          });
          const postUrl = JSON.stringify(r?.output?.result ?? "").match(/https?:\/\/[^\s"'\\]+/)?.[0];
          if (r?.output?.status === "posted" && postUrl) {
            await ctx.runMutation(api.clipJobs.setClip, { clipId: c._id, status: "posted", postUrl, platform: config.platforms[0] });
            if (job.campaignId && job.contentRewardId) { /* content-reward submit (Step 3) */ }
          }
        }
      }
      await set({ status: "completed" });
    } catch (err) {
      await set({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
    return null;
  },
});
```

- [ ] **Step 3: Add the `getJob` query** to `convex/clipJobs.ts`:

```ts
export const getJob = query({ args: { jobId: v.id("clipJobs") }, handler: async (ctx, { jobId }) => ctx.db.get(jobId) });
```

And inside the auto-post loop, where `job.contentRewardId` is set, record to jobtepi-web (reuse the shipped route):

```ts
            if (job.contentRewardId && job.ownerWallet) {
              await post("/api/content-rewards/submit", { contentRewardId: job.contentRewardId, ownerWallet: job.ownerWallet, contentUrl: postUrl, videoUrl: c.clipUrl, platform: config.platforms[0], title: c.title, description: c.captionText });
            }
```

- [ ] **Step 4: Codegen + typecheck**

Run: `npx convex codegen && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^marketing-video/' | grep -v 'bigint is not assignable'`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add convex/clipJobs.ts convex/_generated
git commit -m "feat(clipping): clipJobs.process orchestrator (download→transcribe→clip→post→submit)"
```

---

### Task 13: `clip_source` + `join_clip_campaign` executors in run-task

**Files:**
- Modify: `app/api/agents/run-task/route.ts` (add to the `TaskType` union + `EXECUTORS`)

- [ ] **Step 1: Add `"clip_source"` and `"join_clip_campaign"` to the `TaskType` union and `ALLOWED_TASK_TYPES`** (search for where `create_video` is listed).

- [ ] **Step 2: Add the executors** to `EXECUTORS` (after `create_video`). These enqueue a clip job; the heavy work runs in the Convex action.

```ts
  clip_source: async (agent, ctx, input) => {
    const sourceUrl = String(input.sourceUrl ?? input.url ?? "");
    if (!/^https?:\/\//i.test(sourceUrl)) {
      return { output: { status: "error", note: "Provide a direct video URL (sourceUrl)." }, cost: 0 };
    }
    await convex.mutation(api.clipJobs.enqueue, {
      mintAddress: agent.mintAddress,
      sessionId: ctx.draft ? (ctx.draft as { sessionId?: string }).sessionId : undefined,
      sourceUrl, sourceType: "url",
      ownerWallet: (agent as unknown as { creatorWallet?: string }).creatorWallet,
      kieApiKey: KIE_KEY || undefined,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin,
    });
    return { output: { status: "queued", note: "Clipping started — clips will appear in the Clips queue." }, cost: 0.02,
      memory: { kind: "lesson", summary: `Started clipping a source video.`, importance: 45 } };
  },

  join_clip_campaign: async (agent, ctx, input) => {
    const sourceUrl = String(input.sourceUrl ?? input.assetUrl ?? "");
    const contentRewardId = typeof input.contentRewardId === "string" ? input.contentRewardId : undefined;
    if (!/^https?:\/\//i.test(sourceUrl)) return { output: { status: "error", note: "Campaign has no source asset URL." }, cost: 0 };
    await convex.mutation(api.clipJobs.enqueue, {
      mintAddress: agent.mintAddress,
      sourceUrl, sourceType: "campaign_asset",
      campaignId: typeof input.campaignId === "string" ? input.campaignId : undefined,
      contentRewardId,
      ownerWallet: (agent as unknown as { creatorWallet?: string }).creatorWallet,
      kieApiKey: KIE_KEY || undefined,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin,
    });
    return { output: { status: "queued", note: "Clipping the campaign asset — clips auto-post + submit when ready." }, cost: 0.02 };
  },
```

> Note: `convex`, `KIE_KEY`, and `req` are already in scope in the run-task handler (used by `create_video`/`videoJobs.enqueue`). The `enqueue` mutation gains `kieApiKey`/`appUrl` args in Task 12 Step 1.

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^marketing-video/' | grep -v 'bigint is not assignable'` → no output.

- [ ] **Step 4: Commit**

```bash
git add app/api/agents/run-task/route.ts
git commit -m "feat(clipping): clip_source + join_clip_campaign task executors"
```

---

### Task 14: Agent type — add `clipping` to agentTypes

**Files:**
- Modify: `lib/builder/agentTypes.ts`

- [ ] **Step 1: Add the type + phase + system prompt**

```ts
export type AgentType = "influencer" | "worker" | "trader" | "campaign" | "clipping";
export type ClippingPhase = "clip_setup" | "clip_style" | "clip_platforms" | "clip_mint" | "clip_ready";

export const CLIPPING_SYSTEM_PROMPT = `You ARE a clip-producer agent builder. You set up a CLIPPING agent: it takes a long-form video (a pasted direct URL or a brand campaign asset), finds the most viral moments, cuts vertical 9:16 short-form clips, decorates them per the operator's skills (subtitles, on-screen text, etc.), and posts them.

You do NOT generate AI video or a face — you cut REAL footage.

Collect, ONE topic at a time, then fill agentBlueprint:
1) brand + niche + caption voice  → persona.name, persona.niche, persona.voiceArchetype
2) clip style → clipConfig.clipLength {min,max}, clipConfig.maxClipsPerSource, clipConfig.captionsOn, clipConfig.captionStyle, clipConfig.hookStyle
3) target platforms → clipConfig.platforms
Then guide them to MINT (wallet + identity). After mint, they can paste a video URL ("clip this: <url>") or join a Clipping campaign.

Actions you can emit:
- {"type":"clip_source","sourceUrl":"https://..."} — start clipping a pasted URL
- {"type":"join_clip_campaign","campaignId":"...","contentRewardId":"...","sourceUrl":"..."} — clip a campaign asset
Never claim a clip posted before the job completes — clips appear in the Clips queue as they render.`;
```

- [ ] **Step 2: Wire the prompt into the chat route** — in `app/api/ai/chat/route.ts`, where the system prompt is selected by `agentType` (search the `INFLUENCER_SYSTEM_PROMPT`/`TRADER_SYSTEM_PROMPT` branch), add a `clipping` branch returning `CLIPPING_SYSTEM_PROMPT`.

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^marketing-video/' | grep -v 'bigint is not assignable'` → no output.

- [ ] **Step 4: Commit**

```bash
git add lib/builder/agentTypes.ts app/api/ai/chat/route.ts
git commit -m "feat(clipping): clipping agentType + system prompt"
```

---

### Task 15: Studio build tab

**Files:**
- Modify: `app/studio/build/page.tsx`

- [ ] **Step 1: Add the tab** to `AGENT_TABS` (after the trader entry):

```ts
  { id: "clipping", label: "Clipping", icon: Scissors },
```

Add `Scissors` to the `lucide-react` import at the top of the file.

- [ ] **Step 2: Confirm routing** — the existing tab handler routes to `/builder?type={id}`; `clipping` flows through automatically. No further change.

- [ ] **Step 3: Typecheck + build** — `npm run build 2>&1 | tail -3` → builds (Static/Dynamic summary, no error).

- [ ] **Step 4: Commit**

```bash
git add app/studio/build/page.tsx
git commit -m "feat(clipping): Clipping tab in /studio/build"
```

---

### Task 16: Builder wizard wiring + mint persistence

**Files:**
- Modify: `app/builder/page.tsx` (handle `agentType === "clipping"`: capture `clipConfig` into the blueprint; render no avatar-face step)
- Modify: `app/api/nft/mint/route.ts` + `convex/nftAgents.ts` `saveInfluencer` (persist `clipConfig`)

- [ ] **Step 1: Persist clipConfig through mint** — in `convex/nftAgents.ts` `saveInfluencer`, add `clipConfig: v.optional(v.any())` to args and write it on insert + patch (mirror how `agentStills` is conditionally set):

```ts
        ...(args.clipConfig ? { clipConfig: args.clipConfig } : {}),
```

In `app/api/nft/mint/route.ts`, pass `clipConfig: agentBlueprint?.clipConfig` to `saveInfluencer`.

- [ ] **Step 2: Builder branch** — in `app/builder/page.tsx`, where the avatar-generation / mint card flow is gated by `agentType`, add: when `agentType === "clipping"`, skip the NFT-portrait generation step (use a single generated brand-logo tile or a default) and let the mint card mint with `clipConfig` from the blueprint. The chat (driven by `CLIPPING_SYSTEM_PROMPT`) fills `agentBlueprint.clipConfig`; normalize it with `normalizeClipConfig` before mint.

- [ ] **Step 3: Codegen + typecheck + build**

Run: `npx convex codegen && npm run build 2>&1 | tail -3`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add app/builder/page.tsx app/api/nft/mint/route.ts convex/nftAgents.ts convex/_generated
git commit -m "feat(clipping): clipping wizard branch + persist clipConfig on mint"
```

---

### Task 17: Clips queue UI

**Files:**
- Create: `components/builder/ClipsQueue.tsx`
- Modify: `components/builder/AgentWorkspace.tsx` (mount it for clipping agents)

- [ ] **Step 1: Write `ClipsQueue.tsx`** — a reactive list of the agent's clips:

```tsx
"use client";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function ClipsQueue({ mintAddress }: { mintAddress: string }) {
  const clips = useQuery(api.clipJobs.listClipsByMint, mintAddress ? { mintAddress } : "skip") ?? [];
  const setClip = useMutation(api.clipJobs.setClip);
  if (!clips.length) return <p className="text-[12px] text-zinc-500">No clips yet — paste a video URL or join a Clipping campaign.</p>;
  return (
    <div className="space-y-2">
      {clips.map((c) => (
        <div key={c._id} className="border border-zinc-300 rounded-lg p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-serif font-bold text-[13px] truncate">{c.title}</span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">{c.status} · {c.viralScore}</span>
          </div>
          {c.clipUrl && <video src={c.clipUrl} controls className="mt-2 w-full max-h-72 rounded" />}
          <p className="text-[11px] text-zinc-600 mt-1 truncate">{c.captionText || c.reason}</p>
          <div className="flex gap-2 mt-2">
            {c.postUrl && <a href={c.postUrl} target="_blank" rel="noreferrer" className="text-[11px] underline">view post</a>}
            {c.status === "ready" && <button onClick={() => setClip({ clipId: c._id, status: "skipped" })} className="text-[11px] text-zinc-500">skip</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount it** — in `components/builder/AgentWorkspace.tsx`, when `blueprint.agentType === "clipping"`, render `<ClipsQueue mintAddress={mintAddress} />` in place of (or beside) the UGC Generations panel. Import the component.

- [ ] **Step 3: Typecheck + build** — `npm run build 2>&1 | tail -3` → builds clean.

- [ ] **Step 4: Commit**

```bash
git add components/builder/ClipsQueue.tsx components/builder/AgentWorkspace.tsx
git commit -m "feat(clipping): live Clips queue in the builder"
```

---

### Task 18: Final integration review + full test/build gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite** — `npx vitest run lib/server/ lib/builder/` → all pass (existing 64 + new clip tests).
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^marketing-video/' | grep -v 'bigint is not assignable'` → no output.
- [ ] **Step 3: Build** — `npm run build 2>&1 | tail -3` → clean.
- [ ] **Step 4: End-to-end smoke** — create a clipping agent in `/studio/build`, mint, paste a direct MP4 URL with speech, confirm: job advances (downloading→…→completed), clips appear in the queue, captions are burned, and (if `autoPost`) a post link is recorded.
- [ ] **Step 5: Dispatch the final code-reviewer** (per subagent-driven-development) over the whole branch diff.

---

## Self-Review

**Spec coverage:**
- Distinct `clipping` type + wizard → Tasks 14, 15, 16. ✓
- Source = brand assets + direct URL, v1 social stub → Tasks 5, 13. ✓
- Self-built engine (download→transcribe→select→edit→cut→post→submit) → Tasks 9–13. ✓
- Clips are *just clips* (real cuts, separate job table) → Tasks 7, 11, 12 (no Veo/Seedance path). ✓
- Skill-driven Edit Plan (EditOp[] from user skills) → Tasks 1, 4, 11, 12. ✓
- v1 EditOp set (subtitles, text overlay, title card, logo, emphasis) → Task 1 (schema all); Task 11 renders reframe/subtitles/text_overlay/speed now, others accepted + logged for a follow-up handler. ✓ (flagged, not silently dropped)
- Auto-post top N + review queue → Tasks 12 (top-N auto-post), 17 (queue + skip). ✓
- Earning (vello submission + content-reward) → Task 12 Step 3. ✓
- Word-timed transcription → Task 10 (Whisper). ✓
- Convex job mirrors videoJobs → Tasks 8, 12. ✓

**Placeholder scan:** No "TBD"/"handle edge cases" — every code step has real code. The single deferred item (logo/title_card/zoom ffmpeg handlers) is explicitly scoped with a `console.warn` so it is visible, not a silent gap.

**Type consistency:** `ClipConfig`, `EditOp`, `Transcript`/`TranscriptWord`/`TranscriptSegment`, `ClipMoment` are defined once (Tasks 1–2) and reused with identical names in Tasks 3, 4, 6, 11, 12. `validateEditPlan`, `renderCaptionsAss(words, {clipStartSec,clipEndSec,style})`, `selectClipMoments(transcript, config, deps)`, `planClipEdits({skills,config,window,moment}, deps)`, `resolveDownloader(url)`, `normalizeClipConfig(input)` signatures match across their definition and call sites. Convex `clipJobs.enqueue/setStatus/insertClip/setClip/listClipsByMint/getClipsForJob/getJob/process` names are consistent between Tasks 8, 12, 13, 17.

**Known v1 limitation (documented):** `/api/video/clip` renders `reframe`, `subtitles`, `text_overlay`, and `speed` emphasis; `title_card`, `logo_overlay`, and `zoom_punch`/`freeze` are validated + accepted but skipped-with-warning until their ffmpeg handlers land (a small, isolated follow-up — second input + filter for logo/title; `zoompan` for zoom).

**Follow-up landed (2026-06-02):** the four deferred handlers now render. The filtergraph was extracted into a pure, testable builder `lib/server/clipFilterGraph.ts` (unit-tested in `clipFilterGraph.test.ts` + a real-ffmpeg integration suite `clipFilterGraph.ffmpeg.test.ts`). Simple plans still compile to a single `-vf` chain; any op needing a second input or a re-timed stream escalates to `-filter_complex`:
- `logo_overlay` → 2nd input, `format=rgba,colorchannelmixer=aa=<opacity>` + corner-anchored `overlay`.
- `title_card` → lavfi `color` slate + `anullsrc`, `drawtext` title, `concat` prepended to the body (SAR + audio format normalized so concat succeeds).
- `zoom_punch` → `split` + scaled/cropped branch composited via a time-windowed `overlay` (duration-preserving).
- `freeze` → held-frame (`trim`+`loop`+`fps`) composited via a time-windowed `overlay` (duration-preserving).
`reframe` now appends `setsar=1` so non-square sources don't break concat/overlay. `drawtext` colors are normalized (3-digit hex → 6-digit). The `/api/video/clip` route delegates all filter construction to the builder. Remaining limitation: `speed` emphasis still re-times only the video stream, so it can desync overlays/subtitles (rarely emitted).

**Social-URL ingestion landed (2026-06-02):** `lib/server/downloader.ts` now resolves social hosts (YouTube/TikTok/Instagram/X/Facebook) to a real yt-dlp downloader instead of a stub. The binary is taken from `YTDLP_PATH` (else `yt-dlp` on PATH); Node deps are lazy-imported so the module stays edge-runtime-loadable for unit tests. yt-dlp args are a pure, tested `buildYtdlpArgs` (≤1080p mp4, merge to mp4, `--no-playlist`, `--max-filesize 500M`). If the binary is absent, `fetchSource` rejects with the actionable `SOCIAL_NEEDS_YTDLP` message rather than a raw ENOENT (tested under the node env). The `/api/video/download` `maxDuration` was raised to 300s; `YTDLP_PATH` documented in `.env.example`.

**Vello-native clip submissions landed (2026-06-02):** `convex/submissions.ts` adds `submitClipToCampaign` — when a clip job tied to a Vello campaign posts a clip, it creates (or reuses) the agent's single submission for that campaign, links `clips.submissionId`, and bumps `campaigns.submissionsCount`. One submission per (campaign, agent): the first posted clip creates it, later clips of the same job reuse it (latest post link wins unless the oracle/brand already settled). Wired into `clipJobs.process` alongside the existing jobtepi-web content-reward submit, guarded by `job.campaignId` + `job.ownerWallet`. `clipJobs.campaignId` / `clips.submissionId` are no longer placeholders. Covered by a convex-test suite (`convex/submissions.test.ts`).
