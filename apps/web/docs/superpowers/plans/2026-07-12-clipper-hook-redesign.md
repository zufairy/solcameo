# Clipper Hook Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI Clipper's Auto Hook (on-video overlay) and Hook Title Card (intro slate) prompt-steered AI text, 5 polished industry-font templates with smooth animations, a 3–6s duration dropdown, position + safe padding, rendered via an animated ASS overlay.

**Architecture:** Replace the static drawtext hook burn with an ASS-based renderer (like captions) so animations + named fonts are free. A shared template model (`hookDesigns.ts`) carries font + animation; bundled OFL fonts render via libass `fontsdir`. A per-node prompt steers per-clip hook text through the existing Claude endpoint.

**Tech Stack:** Next.js (App Router), Convex, ffmpeg + libass (ASS subtitles), Zustand (clipping store), Vitest.

## Global Constraints

- Fonts must be OFL/open-licensed and committed under `apps/web/assets/fonts/` with a `LICENSE` file. Bundled: Anton, Inter (SemiBold), Archivo Black, Montserrat (Bold), Poppins (SemiBold).
- Hook ASS `Fontname` MUST equal each font's internal family name (verified per-font).
- Duration for the clipper hook is one of `[3,4,5,6]` seconds; `clampHookDuration` must never return <3 or >6 for clipper callers (influencer callers may pass wider values — clamp defensively, don't throw).
- Empty `hookPrompt` = existing deterministic hook behavior (no LLM call).
- Every ffmpeg burn already pins fonts to survive font-less hosts; the hook ASS burn must pass `fontsdir=<bundled dir>` so the industry fonts resolve.
- Legacy stored `hookTemplateId` values must migrate to new ids (no crash on old graphs).

---

### Task 1: Bundle OFL fonts + font resolver

**Files:**
- Create: `apps/web/assets/fonts/Anton-Regular.ttf`, `Inter-SemiBold.ttf`, `ArchivoBlack-Regular.ttf`, `Montserrat-Bold.ttf`, `Poppins-SemiBold.ttf`, `apps/web/assets/fonts/OFL.txt`
- Create: `lib/server/hookFonts.ts`
- Test: `lib/server/hookFonts.test.ts`

**Interfaces:**
- Produces: `HOOK_FONT_FAMILY` (map: template-font-name → libass family name), `hookFontsDir(): string` (absolute dir of bundled fonts), `hasHookFonts(): boolean`.

- [ ] **Step 1: Download the 5 OFL fonts** into `apps/web/assets/fonts/` from Google Fonts (all OFL). Add the OFL license text to `OFL.txt`. Confirm each file's internal family name with `fc-scan` or `ffmpeg`/`fontname` — record the exact family names (expected: `Anton`, `Inter`, `Archivo Black`, `Montserrat`, `Poppins`).

- [ ] **Step 2: Write the failing test**

```ts
// lib/server/hookFonts.test.ts
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { HOOK_FONT_FAMILY, hookFontsDir, hasHookFonts } from "./hookFonts";

describe("hookFonts", () => {
  it("resolves a real bundled directory with ttf files", () => {
    expect(hasHookFonts()).toBe(true);
    expect(existsSync(hookFontsDir())).toBe(true);
    const ttf = readdirSync(hookFontsDir()).filter((f) => f.endsWith(".ttf"));
    expect(ttf.length).toBeGreaterThanOrEqual(5);
  });

  it("maps every template font token to a family name", () => {
    for (const token of ["anton", "inter", "archivo", "montserrat", "poppins"]) {
      expect(typeof HOOK_FONT_FAMILY[token]).toBe("string");
      expect(HOOK_FONT_FAMILY[token].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — `npx vitest run lib/server/hookFonts.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `hookFonts.ts`**

```ts
// lib/server/hookFonts.ts
import { join } from "node:path";
import { existsSync } from "node:fs";

// Template `font` token → the font's INTERNAL family name that libass matches on.
export const HOOK_FONT_FAMILY: Record<string, string> = {
  anton: "Anton",
  inter: "Inter",
  archivo: "Archivo Black",
  montserrat: "Montserrat",
  poppins: "Poppins",
};

// Bundled OFL fonts live alongside the app so libass can resolve them on any host
// via `subtitles=...:fontsdir=<this>`. process.cwd() is apps/web at runtime.
let cached: string | undefined;
export function hookFontsDir(): string {
  if (cached) return cached;
  cached = join(process.cwd(), "assets", "fonts");
  return cached;
}

export function hasHookFonts(): boolean {
  return existsSync(hookFontsDir());
}
```

- [ ] **Step 5: Run test** — `npx vitest run lib/server/hookFonts.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/assets/fonts lib/server/hookFonts.ts lib/server/hookFonts.test.ts
git commit -m "feat(hooks): bundle OFL industry fonts + resolver"
```

---

### Task 2: Extend the template model + 5 templates + legacy migration

**Files:**
- Modify: `lib/builder/hookDesigns.ts`
- Test: `lib/builder/hookDesigns.test.ts`

**Interfaces:**
- Produces: `HookAnimation` type (`"pop" | "pop-overshoot" | "slide-down" | "fade" | "word-reveal"`); `HookDesignRender` gains `font: string` (token from `HOOK_FONT_FAMILY`) and `animation: HookAnimation`; `HOOK_DESIGNS` = the 5 templates; `migrateHookTemplateId(id?: string): string`; existing `resolveHookRender`, `clampHookDuration`, `isHookDesignId`, `DEFAULT_HOOK_DESIGN_ID` updated.
- Consumes: nothing (pure data).

- [ ] **Step 1: Write failing tests**

```ts
// lib/builder/hookDesigns.test.ts
import { describe, expect, it } from "vitest";
import {
  HOOK_DESIGNS, DEFAULT_HOOK_DESIGN_ID, migrateHookTemplateId,
  clampHookDuration, resolveHookRender,
} from "./hookDesigns";
import { HOOK_FONT_FAMILY } from "@/lib/server/hookFonts";

describe("hook templates", () => {
  it("has 5 templates, each with a font token and an animation", () => {
    expect(HOOK_DESIGNS).toHaveLength(5);
    for (const d of HOOK_DESIGNS) {
      expect(Object.keys(HOOK_FONT_FAMILY)).toContain(d.render.font);
      expect(d.render.animation).toBeTruthy();
    }
  });
  it("default id exists", () => {
    expect(HOOK_DESIGNS.some((d) => d.id === DEFAULT_HOOK_DESIGN_ID)).toBe(true);
  });
  it("migrates legacy ids to a valid new id", () => {
    expect(HOOK_DESIGNS.some((d) => d.id === migrateHookTemplateId("bold_white"))).toBe(true);
    expect(HOOK_DESIGNS.some((d) => d.id === migrateHookTemplateId(undefined))).toBe(true);
    expect(migrateHookTemplateId("bold_impact")).toBe("bold_impact");
  });
  it("clamps clipper duration into 3..6", () => {
    expect(clampHookDuration(1)).toBeGreaterThanOrEqual(3);
    expect(clampHookDuration(99)).toBeLessThanOrEqual(6);
    expect(clampHookDuration(5)).toBe(5);
  });
  it("resolveHookRender applies custom font/animation over the template", () => {
    const r = resolveHookRender("bold_impact", { font: "poppins", animation: "fade" });
    expect(r.font).toBe("poppins");
    expect(r.animation).toBe("fade");
  });
});
```

- [ ] **Step 2: Run tests** → FAIL.

- [ ] **Step 3: Edit `hookDesigns.ts`** — read the current file first, then:
  - Add `export type HookAnimation = "pop" | "pop-overshoot" | "slide-down" | "fade" | "word-reveal";`
  - Add `font: string;` and `animation: HookAnimation;` to `HookDesignRender`.
  - Add `font?: string;` and `animation?: HookAnimation;` to `CustomHookDesign`.
  - Replace `HOOK_DESIGNS` with the 5 templates:

```ts
export const HOOK_DESIGNS: HookDesign[] = [
  { id: "bold_impact", name: "Bold Impact", blurb: "Heavy condensed, pops in",
    render: { font: "anton", fontColor: "#FFFFFF", fontSize: 60, position: "top",
      outlineColor: "#000000", outlineWidth: 5, animation: "pop" },
    preview: { color: "#fff", fontWeight: 900, textShadow: OUTLINE(1.5) } },
  { id: "clean_slide", name: "Clean Slide", blurb: "Minimal, slides down",
    render: { font: "inter", fontColor: "#FFFFFF", fontSize: 50, position: "top",
      outlineColor: "#000000", outlineWidth: 2, animation: "slide-down" },
    preview: { color: "#fff", fontWeight: 600, textShadow: OUTLINE(1) } },
  { id: "yellow_pop", name: "Yellow Pop", blurb: "Yellow caps, overshoot pop",
    render: { font: "archivo", fontColor: "#FFE600", fontSize: 58, position: "center",
      outlineColor: "#000000", outlineWidth: 5, allCaps: true, animation: "pop-overshoot" },
    preview: { color: "#FFE600", fontWeight: 900, textTransform: "uppercase", textShadow: OUTLINE(1.5) } },
  { id: "black_box", name: "Black Box", blurb: "White on black, fades in",
    render: { font: "montserrat", fontColor: "#FFFFFF", fontSize: 48, position: "bottom",
      outlineColor: "#000000", outlineWidth: 1, boxColor: "#000000", animation: "fade" },
    preview: { color: "#fff", fontWeight: 700, background: "#000", padding: "2px 7px", borderRadius: 4 } },
  { id: "word_reveal", name: "Word Reveal", blurb: "Words appear one by one",
    render: { font: "poppins", fontColor: "#FFFFFF", fontSize: 52, position: "center",
      outlineColor: "#000000", outlineWidth: 3, animation: "word-reveal" },
    preview: { color: "#fff", fontWeight: 600, textShadow: OUTLINE(1.25) } },
];
export const DEFAULT_HOOK_DESIGN_ID = "bold_impact";
```

  - Update `clampHookDuration` to clamp into `[3,6]` (default 5): `const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(6, Math.max(3, n)) : 5;`
  - Add migration:

```ts
const LEGACY_HOOK_ID: Record<string, string> = {
  bold_white: "bold_impact", clean: "clean_slide", yellow_pop: "yellow_pop",
  black_box: "black_box", minimal: "clean_slide", red_alert: "yellow_pop", mint: "word_reveal",
};
export function migrateHookTemplateId(id?: string): string {
  if (id && HOOK_DESIGN_BY_ID[id]) return id;
  if (id && LEGACY_HOOK_ID[id]) return LEGACY_HOOK_ID[id];
  return DEFAULT_HOOK_DESIGN_ID;
}
```

  - Extend `resolveHookRender` to also merge `font` and `animation` from custom.

- [ ] **Step 4: Run tests** → PASS. Also run `npx tsc --noEmit -p tsconfig.json` and fix any consumers that construct `HookDesignRender` without the new required fields.

- [ ] **Step 5: Commit** — `git commit -am "feat(hooks): template model with font+animation, 5 templates, legacy migration"`

---

### Task 3: Export shared ASS helpers

**Files:**
- Modify: `lib/server/captionRenderer.ts` (export `toAssColor`, `toAssTime`)
- OR Create: `lib/server/assUtils.ts` and re-export from captionRenderer.
- Test: covered by Task 4's tests.

**Interfaces:**
- Produces: `toAssColor(hex, fallback?)`, `toAssTime(sec)` importable by `hookRenderer.ts`.

- [ ] **Step 1:** Create `lib/server/assUtils.ts` moving `toAssTime` + `toAssColor` there (copy the exact current implementations from `captionRenderer.ts:4-26`), export both.
- [ ] **Step 2:** In `captionRenderer.ts`, replace the local defs with `import { toAssColor, toAssTime } from "./assUtils";`.
- [ ] **Step 3:** Run `npx vitest run lib/server/captionRenderer.test.ts` → still PASS (no behavior change).
- [ ] **Step 4: Commit** — `git commit -am "refactor(ass): extract shared toAssColor/toAssTime into assUtils"`

---

### Task 4: Animated ASS hook renderer

**Files:**
- Create: `lib/server/hookRenderer.ts`
- Test: `lib/server/hookRenderer.test.ts`

**Interfaces:**
- Consumes: `HOOK_FONT_FAMILY` (Task 1), `HookDesignRender`/`resolveHookRender` (Task 2), `toAssColor`/`toAssTime` (Task 3).
- Produces: `renderHookAss(text: string, opts: { render: HookDesignRender; durationSec: number; width: number; height: number }): string`.

- [ ] **Step 1: Write failing tests**

```ts
// lib/server/hookRenderer.test.ts
import { describe, expect, it } from "vitest";
import { renderHookAss } from "./hookRenderer";
import { resolveHookRender } from "@/lib/builder/hookDesigns";

const dims = { width: 1080, height: 1920 };
const ass = (id: string, text = "This changes everything", dur = 5) =>
  renderHookAss(text, { render: resolveHookRender(id, null), durationSec: dur, ...dims });

describe("renderHookAss", () => {
  it("uses the template's libass family name", () => {
    expect(ass("bold_impact")).toContain("Anton");
    expect(ass("word_reveal")).toContain("Poppins");
  });
  it("emits the correct alignment per position (top=8, center=5, bottom=2)", () => {
    expect(ass("bold_impact")).toMatch(/Alignment[^\n]*,\s*8,/);   // top
    expect(ass("yellow_pop")).toMatch(/Alignment[^\n]*,\s*5,/);    // center
    expect(ass("black_box")).toMatch(/Alignment[^\n]*,\s*2,/);     // bottom
  });
  it("insets margins for safe padding (never 0)", () => {
    const s = ass("bold_impact");
    const m = s.match(/Style:[^\n]*?,(\d+),(\d+),(\d+),\d+\s*$/m); // MarginL,R,V near end of style line
    // simpler: assert the style line contains non-zero margins
    expect(s).not.toMatch(/,0,0,0,\d+\s*$/m);
  });
  it("pop template carries a scale-in \\t tween", () => {
    expect(ass("bold_impact")).toContain("\\t(");
    expect(ass("bold_impact")).toContain("\\fscx");
  });
  it("fade template carries \\fad", () => {
    expect(ass("black_box")).toContain("\\fad(");
  });
  it("word-reveal emits one Dialogue per word", () => {
    const s = ass("word_reveal", "one two three four");
    const dialogues = s.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBe(4);
  });
  it("uppercases when allCaps", () => {
    expect(ass("yellow_pop", "loud")).toContain("LOUD");
  });
  it("times events within the duration window", () => {
    expect(ass("bold_impact", "hi", 4)).toContain("0:00:00.00");
  });
});
```

- [ ] **Step 2: Run tests** → FAIL.

- [ ] **Step 3: Implement `hookRenderer.ts`**

```ts
// lib/server/hookRenderer.ts
import { HOOK_FONT_FAMILY } from "./hookFonts";
import { toAssColor, toAssTime } from "./assUtils";
import type { HookDesignRender } from "@/lib/builder/hookDesigns";

const ALIGN = { top: 8, center: 5, bottom: 2 } as const;
const sanitize = (raw: string): string => raw.replace(/\n/g, " ").replace(/[{}]/g, "").trim();

export function renderHookAss(
  text: string,
  opts: { render: HookDesignRender; durationSec: number; width: number; height: number },
): string {
  const { render: r, durationSec, width, height } = opts;
  const family = HOOK_FONT_FAMILY[r.font] ?? "Arial";
  const words = sanitize(r.allCaps ? text.toUpperCase() : text).split(/\s+/).filter(Boolean);
  const line = words.join(" ");
  const dur = Math.max(0.5, durationSec);

  // Safe padding so text never hits an edge (professional inset).
  const marginLR = Math.round(width * 0.06);
  const marginV = Math.round(height * 0.08);
  const align = ALIGN[r.position];
  const border = r.boxColor ? 3 : 1;              // 3 = opaque box
  const backColour = r.boxColor ? toAssColor(r.boxColor) : "&H64000000";

  const header = [
    "[Script Info]", "ScriptType: v4.00+",
    `PlayResX: ${width}`, `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes", "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Hook,${family},${r.fontSize},${toAssColor(r.fontColor)},&H000000FF,${toAssColor(r.outlineColor)},${backColour},1,0,0,0,100,100,0,0,${border},${r.outlineWidth},0,${align},${marginLR},${marginLR},${marginV},1`,
    "", "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const start = toAssTime(0);
  const end = toAssTime(dur);

  const events: string[] = [];
  if (r.animation === "word-reveal") {
    const per = dur / Math.max(1, words.length);
    for (let i = 0; i < words.length; i++) {
      const shown = words.slice(0, i + 1).join(" ");
      const s = toAssTime(i * per);
      events.push(`Dialogue: 0,${s},${end},Hook,,0,0,0,,{\\fad(80,0)}${shown}`);
    }
  } else {
    const tag = entranceTag(r.animation, dur);
    events.push(`Dialogue: 0,${start},${end},Hook,,0,0,0,,{${tag}}${line}`);
  }
  return `${header}\n${events.join("\n")}\n`;
}

function entranceTag(anim: HookDesignRender["animation"], dur: number): string {
  const exitFadeStartMs = Math.max(0, Math.round(dur * 1000) - 200);
  switch (anim) {
    case "pop":            return `\\fscx60\\fscy60\\fad(60,180)\\t(0,180,\\fscx100\\fscy100)`;
    case "pop-overshoot":  return `\\fscx45\\fscy45\\fad(50,180)\\t(0,140,\\fscx110\\fscy110)\\t(140,220,\\fscx100\\fscy100)`;
    case "slide-down":     return `\\fad(150,180)\\move(0,-60,0,0,0,220)`; // relative-ish drop
    case "fade":
    default:               return `\\fad(180,180)`;
  }
}
```

  Note: `slide-down` uses `\move` in a simplified form; during Step 4 verify visually and adjust the coordinates against the ASS origin if needed (the plan's smoke test in Task 5 renders it).

- [ ] **Step 4: Run tests** → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(hooks): animated ASS hook renderer"`

---

### Task 5: Burn integration — hook ASS + fontsdir in the filter graph

**Files:**
- Modify: `lib/server/clipFilterGraph.ts` (add `hookAssPath?` + `fontsDir?` to params; emit `subtitles=<hookAss>:fontsdir=<dir>` after the caption subtitles filter)
- Test: `lib/server/clipFilterGraph.test.ts` (add a case)

**Interfaces:**
- Consumes: `hookFontsDir()` (Task 1).
- Produces: `buildClipGraph` accepts `hookAssPath?: string` and `fontsDir?: string`; when both set, appends a `subtitles=<escaped hookAss>:fontsdir=<escaped dir>` filter to the video chain.

- [ ] **Step 1: Read** `clipFilterGraph.ts` around the subtitles emission (lines ~425 and ~577) and the params interface (lines ~20-47).
- [ ] **Step 2: Write failing test**

```ts
it("emits a hook subtitles filter with fontsdir when hookAssPath+fontsDir set", () => {
  const g = buildClipGraph({ ops: [{ op: "reframe", mode: "crop" }], startSeconds: 0, endSeconds: 8,
    hookAssPath: "hook.ass", fontsDir: "/app/assets/fonts", logoPaths: [], width: 1080, height: 1920 } as any);
  const joined = g.filterArgs.join(" ");
  expect(joined).toContain("subtitles=hook.ass");
  expect(joined).toContain("fontsdir=");
});
```

- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** — add `hookAssPath?: string; fontsDir?: string;` to the params type; in the simple path (near line 425) and the complex path, after the caption `subtitles` filter, if `params.hookAssPath` push `subtitles=${escFilterPath(params.hookAssPath)}${params.fontsDir ? `:fontsdir=${escFilterPath(params.fontsDir)}` : ""}`.
- [ ] **Step 5: Run** → PASS. Full graph suite green.
- [ ] **Step 6: Commit** — `git commit -am "feat(hooks): hook ASS + fontsdir in clip filter graph"`

---

### Task 6: Wire Auto Hook (clip.hook) to the ASS renderer

**Files:**
- Modify: `lib/server/clipRender.ts` (write `hook.ass` and pass `hookAssPath` + `fontsDir`)
- Modify: `app/api/video/overlay-burn/route.ts` (influencer hook → same ASS path)
- Modify: `lib/builder/clipSkillsCatalog.ts` `hookOverlayOp` — emit a `hook` marker op the render consumes, OR keep the op and have the render translate it to ASS.

**Interfaces:**
- Consumes: `renderHookAss` (Task 4), `resolveHookRender`/`clampHookDuration`/`migrateHookTemplateId` (Task 2), `hookFontsDir` (Task 1).

- [ ] **Step 1: Read** `clipRender.ts` where it currently handles the hook `text_overlay` op + writes ASS for captions + calls `buildClipGraph`.
- [ ] **Step 2:** For the hook op, instead of a drawtext text_overlay, compute `render = resolveHookRender(migrateHookTemplateId(cfg.hookTemplateId), cfg.hookCustomDesign)`, `dur = clampHookDuration(cfg.hookDurationSec)`, and write `hook.ass = renderHookAss(hookText, { render, durationSec: dur, width, height })`. Pass `hookAssPath: "hook.ass"`, `fontsDir: hookFontsDir()` into `buildClipGraph`.
- [ ] **Step 3:** Mirror in `overlay-burn/route.ts`: build `render` from the resolved hook payload, write `hook.ass`, pass `hookAssPath`+`fontsDir` (use the already-probed `canvasW/canvasH` from the landscape fix).
- [ ] **Step 4: Smoke test** (guarded ffmpeg test like `clipFilterGraph.ffmpeg.test.ts`): render a 3s sample clip with a `bold_impact` hook ASS + fontsdir → ffmpeg exits 0, output has video. Run only when ffmpeg present.
- [ ] **Step 5:** Manual `/verify`: generate one clip with Auto Hook installed, confirm the hook animates + uses Anton + is padded.
- [ ] **Step 6: Commit** — `git commit -am "feat(hooks): render Auto Hook via animated ASS in clip + influencer burns"`

---

### Task 7: Hook Title Card — animated slate text

**Files:**
- Modify: `lib/server/clipFilterGraph.ts` (title_card slate: burn its text via a hook ASS on the slate stream instead of centered drawtext)
- Modify: `lib/builder/clipSkillsCatalog.ts` (`clip.title` floor: pass template/duration/prompt-derived text; default duration 3s from the 3–6 set)

**Interfaces:**
- Consumes: `renderHookAss`, `resolveHookRender`.

- [ ] **Step 1: Read** the `title_card` block in `clipFilterGraph.ts` (~lines 693-726).
- [ ] **Step 2:** Render the slate's text via `renderHookAss` (position `center`, the chosen template) burned onto the black `color` slate stream (add a `subtitles` filter on the slate before concat), keeping the concat structure.
- [ ] **Step 3:** Give `clip.title` a config path (`titleTemplateId`, `titleDurationSec`, `titlePrompt`) analogous to `clip.hook`.
- [ ] **Step 4: Smoke + manual verify** the slate animates.
- [ ] **Step 5: Commit** — `git commit -am "feat(hooks): animated Hook Title Card slate"`

---

### Task 8: Per-clip AI hook from the prompt

**Files:**
- Modify: `lib/builder/clipSkillsCatalog.ts` (`ClipFloorConfig` gains `hookPrompt?: string`, `hookPosition?`)
- Modify: the clip hook-text generation site (`lib/server/clipEditPlanner.ts` `applyHookStyle`, or the floor builder) to call the Claude hook endpoint when `hookPrompt` is set.
- Reuse: `app/api/agents/hook/generate/route.ts` logic (or `callClaudeText` directly server-side).
- Test: `lib/server/clipEditPlanner.test.ts` (add a case with a stubbed generator)

**Interfaces:**
- Consumes: `callClaudeText` / the hook endpoint. Produces per-clip hook text steered by `hookPrompt`.

- [ ] **Step 1:** Add `hookPrompt?: string` and `hookPosition?: "top"|"center"|"bottom"` to `ClipFloorConfig`.
- [ ] **Step 2: Write failing test** — with `hookPrompt` empty, hook text = deterministic `hookText(m)`; with a prompt + a stubbed generator, hook text = the generated line (mock the generator).
- [ ] **Step 3:** Implement a small `generateClipHook(transcript, prompt)` server helper (wraps `callClaudeText` with the same system prompt + `tidyHook` cap as the endpoint) and call it in the hook-text path when `hookPrompt` is non-empty; else keep deterministic.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(hooks): prompt-steered per-clip hook text"`

---

### Task 9: Inspector — prompt box, 3–6s dropdown, animated previews (both tools)

**Files:**
- Modify: `components/builder/clipping-flow/inspector/inspector-panel.tsx` (`HookOverlayConfig`; new `TitleCardConfig`)
- Modify: styles for the animated preview chip (CSS keyframes matching each template's animation)

**Interfaces:**
- Consumes: `HOOK_DESIGNS`, `migrateHookTemplateId`, `updateNodeConfig`.

- [ ] **Step 1: Read** the current `HookOverlayConfig` (inspector-panel.tsx:812-952) and the Viral Sticker `prompt` field (~955+) to mirror the textarea.
- [ ] **Step 2:** Add a `prompt` textarea (persist `hookPrompt`), replace the duration `Slider` with a `NativeSelect`/dropdown of `[3,4,5,6]` (persist `hookDurationSec`), keep the position dropdown, and make each template chip play its animation via a CSS class keyed on `d.render.animation`.
- [ ] **Step 3:** Add `TitleCardConfig` and wire it for `c.skillId === "clip.title"` (prompt + template + 3–6 duration).
- [ ] **Step 4:** Migrate stored ids on read with `migrateHookTemplateId` so old graphs render.
- [ ] **Step 5: Manual verify** in the browser (`/run` the clipper builder): both nodes show prompt box + animated chips + 3–6 dropdown; selections persist.
- [ ] **Step 6: Commit** — `git commit -am "feat(hooks): inspector prompt box, 3-6s dropdown, animated previews for both hook tools"`

---

### Task 10: Align influencer HookConfig (consistency)

**Files:**
- Modify: `components/builder/AppStoreTab.tsx` (`HookConfig`: switch `HOOK_DURATION_CHOICES` to `[3,4,5,6]`, use the migrated template ids)

**Interfaces:** none new.

- [ ] **Step 1:** Change `HOOK_DURATION_CHOICES` to `[3,4,5,6]`; ensure the influencer overlay burn (Task 6) already renders via ASS so its hooks animate too.
- [ ] **Step 2: Manual verify** an influencer video hook animates with the industry font.
- [ ] **Step 3: Commit** — `git commit -am "feat(hooks): align influencer HookConfig to 3-6s + shared templates"`

---

## Self-review notes

- **Spec coverage:** prompt box (T8/T9), templates+fonts (T1/T2), animation via ASS (T3/T4), burn integration (T5/T6/T7), duration 3–6 (T2 clamp, T9/T10 UI), position+padding (T4), both tools (T6 overlay + T7 slate), migration (T2). All covered.
- **Type consistency:** `renderHookAss(text, {render, durationSec, width, height})` used identically in T5/T6/T7. `migrateHookTemplateId`, `resolveHookRender`, `clampHookDuration`, `HOOK_FONT_FAMILY` names consistent across tasks.
- **Deferred detail:** the `slide-down` `\move` coordinates are verified/tuned in T4 Step 4 / T6 smoke test (ASS origin depends on alignment) — acceptable, it's a visual tuning within one step, not an interface ambiguity.
