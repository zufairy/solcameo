# Video Director — Phase 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a per-agent "Video Director" config (length range, rotating styles/hooks/settings/moods, look & feel, CTA, custom direction, cadence) that drives every generated video so output is varied, longer, and on-brand.

**Architecture:** A pure style registry (`videoStyles.ts`) + a pure resolver (`videoDirector.ts`) turn a stored `videoConfig` (on the Convex `influencers` doc) into per-video directives — a varied `durationSeconds` and a composed `brief` (format/angle/structureNotes/visualTreatment) that the existing `generateVideoScript` + storyboard already consume. The `create_video` executor calls the resolver as the default (explicit `input` still wins). A new builder "Director" tab edits the config; `videosPerDay` maps to the existing heartbeat cadence.

**Tech Stack:** Next.js + TypeScript, Convex, Vitest, Tailwind. Spec: `docs/superpowers/specs/2026-06-05-video-director-design.md`.

**Phase 1 scope:** data model (full `videoConfig`, all fields persisted), Director tab (all controls), resolver wiring for **length + style/brief + cadence + hire default**. Render-side features (aspect ratio render, brand logo, Hook Text overlay, Captions burn) are stored but **not rendered** in Phase 1 — they are Phases 2–4 (separate plans).

---

## File Structure

- Create: `lib/builder/videoStyles.ts` — style/hook/setting/mood/camera/grade registries (pure data + types).
- Create: `lib/builder/videoStyles.test.ts` — registry invariants.
- Create: `lib/builder/videoDirector.ts` — `VideoConfig` type, `resolveVideoDirectives`, `randInRange`, `pickRotating`, `composeBrief`, `DEFAULT_VIDEO_CONFIG`.
- Create: `lib/builder/videoDirector.test.ts` — resolver behavior.
- Modify: `lib/builder/heartbeatSchedule.ts` — add `videosPerDayToCron`.
- Modify: `lib/builder/heartbeatSchedule.test.ts` — cadence mapping test.
- Modify: `convex/schema.ts` — add `videoConfig` to `influencers`.
- Modify: `convex/influencers.ts` — add `setVideoConfig` mutation (sets cadence too).
- Modify: `lib/builder/agentTypes.ts` — add `videoConfig?` to `AgentBlueprint`.
- Modify: `app/api/agents/run-task/route.ts` — call `resolveVideoDirectives` in the `create_video` executor.
- Modify: `app/api/agents/hire-generate/route.ts` — stop hardcoding `durationSeconds: 16`.
- Create: `components/builder/VideoDirectorTab.tsx` — the Director tab UI.
- Modify: `components/builder/AgentWorkspace.tsx` — add the "director" tab + content branch.

---

### Task 1: Style + creative registries

**Files:**
- Create: `lib/builder/videoStyles.ts`
- Test: `lib/builder/videoStyles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/builder/videoStyles.test.ts
import { describe, it, expect } from "vitest";
import {
  VIDEO_STYLES, HOOK_STYLES, SETTINGS, MOODS, CAMERA_STYLES, COLOR_GRADES,
  getStyle,
} from "./videoStyles";

describe("video registries", () => {
  it("every style has a non-empty format and visualTreatment", () => {
    expect(VIDEO_STYLES.length).toBeGreaterThanOrEqual(8);
    for (const s of VIDEO_STYLES) {
      expect(s.id).toBeTruthy();
      expect(s.format.trim().length).toBeGreaterThan(0);
      expect(s.visualTreatment.trim().length).toBeGreaterThan(0);
    }
  });

  it("ids are unique across the style registry", () => {
    const ids = VIDEO_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getStyle returns the def or undefined", () => {
    expect(getStyle("talking_head")?.label).toBeTruthy();
    expect(getStyle("nope")).toBeUndefined();
  });

  it("hook/setting/mood/camera/grade registries are non-empty with fragments", () => {
    for (const reg of [HOOK_STYLES, SETTINGS, MOODS, CAMERA_STYLES, COLOR_GRADES]) {
      expect(reg.length).toBeGreaterThan(0);
      for (const item of reg) expect(item.fragment.trim().length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/builder/videoStyles.test.ts`
Expected: FAIL — cannot find module `./videoStyles`.

- [ ] **Step 3: Write the registries**

```ts
// lib/builder/videoStyles.ts
export interface VideoStyleDef {
  id: string;
  label: string;
  icon: string;          // emoji for the UI
  description: string;
  format: string;        // → brief.format
  angle: string;         // → brief.angle (default; a hook may override)
  structureNotes: string;// → brief.structureNotes
  visualTreatment: string;// → brief.visualTreatment (merged downstream)
}

export interface Fragment { id: string; label: string; icon?: string; fragment: string; }

export const VIDEO_STYLES: VideoStyleDef[] = [
  { id: "talking_head", label: "Talking Head", icon: "🗣️",
    description: "Creator speaks directly to camera.",
    format: "talking-head", angle: "direct address",
    structureNotes: "Creator on camera speaking to the viewer; tight framing.",
    visualTreatment: "single subject to-camera, eye contact, clean background" },
  { id: "commercial", label: "Commercial", icon: "🎬",
    description: "Polished product ad with a clear sell.",
    format: "commercial spot", angle: "product benefit",
    structureNotes: "Punchy ad beats: problem → product → payoff → CTA.",
    visualTreatment: "polished advertising look, product hero shots, dynamic cuts" },
  { id: "ootd", label: "OOTD", icon: "👗",
    description: "Outfit / styling showcase.",
    format: "outfit showcase", angle: "style reveal",
    structureNotes: "Show the look from multiple angles; styling call-outs.",
    visualTreatment: "fashion framing, full-body + detail shots, mirror/turn reveals" },
  { id: "vlog", label: "Vlog / Day-in-life", icon: "📹",
    description: "Lifestyle b-roll with narration.",
    format: "vlog", angle: "day-in-the-life",
    structureNotes: "Loose narrative across moments; voiceover over b-roll.",
    visualTreatment: "handheld b-roll, candid moments, natural light" },
  { id: "tutorial", label: "Tutorial", icon: "📚",
    description: "Step-by-step how-to.",
    format: "tutorial", angle: "how-to",
    structureNotes: "Numbered steps; each beat is one clear step.",
    visualTreatment: "demonstrative close-ups, on-screen step framing" },
  { id: "ugc_review", label: "UGC Review", icon: "📦",
    description: "Authentic unboxing / review.",
    format: "ugc review", angle: "honest review",
    structureNotes: "First-person reaction, unbox, try, verdict.",
    visualTreatment: "authentic selfie-style, real hands-on product, natural setting" },
  { id: "cinematic_broll", label: "Cinematic B-roll", icon: "🎞️",
    description: "Atmospheric, minimal talking.",
    format: "cinematic b-roll", angle: "mood piece",
    structureNotes: "Few or no spoken words; let visuals + captions carry it.",
    visualTreatment: "cinematic slow-motion, shallow depth of field, moody grade" },
  { id: "asmr", label: "ASMR", icon: "🤫",
    description: "Satisfying, sound-led.",
    format: "asmr", angle: "sensory",
    structureNotes: "Slow, satisfying actions; minimal speech.",
    visualTreatment: "macro close-ups, tactile detail, soft lighting" },
];

export const HOOK_STYLES: Fragment[] = [
  { id: "question", label: "Question", fragment: "open with a provocative question the viewer wants answered" },
  { id: "bold_claim", label: "Bold claim", fragment: "open with a bold, scroll-stopping claim" },
  { id: "pattern_interrupt", label: "Pattern interrupt", fragment: "open with an unexpected visual/line that breaks the scroll" },
  { id: "story", label: "Story", fragment: "open mid-story at a tense moment" },
  { id: "stat", label: "Stat", fragment: "open with a surprising statistic or number" },
  { id: "problem_solution", label: "Problem→Solution", fragment: "open by naming the viewer's problem, then promise the fix" },
];

export const SETTINGS: Fragment[] = [
  { id: "studio", label: "Studio", fragment: "clean studio backdrop" },
  { id: "home", label: "Home", fragment: "cozy home interior" },
  { id: "outdoor", label: "Outdoor / Urban", fragment: "urban street / outdoor city setting" },
  { id: "nature", label: "Nature", fragment: "natural outdoor landscape" },
  { id: "cafe", label: "Cafe", fragment: "warm cafe / lifestyle setting" },
  { id: "abstract", label: "Abstract set", fragment: "stylized abstract set with bold colors" },
];

export const MOODS: Fragment[] = [
  { id: "upbeat", label: "Upbeat", fragment: "upbeat, energetic mood" },
  { id: "aspirational", label: "Aspirational", fragment: "aspirational, premium mood" },
  { id: "edgy", label: "Edgy", fragment: "edgy, bold mood" },
  { id: "cozy", label: "Cozy", fragment: "warm, cozy, intimate mood" },
  { id: "luxe", label: "Luxe", fragment: "luxurious, high-end mood" },
];

export const CAMERA_STYLES: Fragment[] = [
  { id: "ugc_handheld", label: "UGC handheld", fragment: "handheld UGC camera movement" },
  { id: "tripod", label: "Clean tripod", fragment: "stable tripod framing" },
  { id: "cinematic", label: "Cinematic gimbal", fragment: "smooth cinematic gimbal moves" },
  { id: "selfie", label: "Selfie", fragment: "front-facing selfie framing" },
];

export const COLOR_GRADES: Fragment[] = [
  { id: "natural", label: "Natural", fragment: "natural true-to-life color" },
  { id: "warm", label: "Warm", fragment: "warm golden color grade" },
  { id: "vibrant", label: "Vibrant", fragment: "punchy saturated color grade" },
  { id: "moody", label: "Moody film", fragment: "moody cinematic film grade" },
  { id: "clean_bright", label: "Clean bright", fragment: "bright clean high-key look" },
];

export function getStyle(id: string): VideoStyleDef | undefined {
  return VIDEO_STYLES.find((s) => s.id === id);
}

export function getFragment(reg: Fragment[], id: string): Fragment | undefined {
  return reg.find((f) => f.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/builder/videoStyles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/builder/videoStyles.ts lib/builder/videoStyles.test.ts
git commit -m "feat(video-director): style + creative registries"
```

---

### Task 2: Cadence mapping helper

**Files:**
- Modify: `lib/builder/heartbeatSchedule.ts`
- Test: `lib/builder/heartbeatSchedule.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing test file)**

```ts
// lib/builder/heartbeatSchedule.test.ts  (add this block)
import { videosPerDayToCron } from "./heartbeatSchedule";

describe("videosPerDayToCron", () => {
  it("maps common rates to the nearest heartbeat bucket", () => {
    expect(videosPerDayToCron(24)).toBe("every_1h");
    expect(videosPerDayToCron(12)).toBe("every_2h");
    expect(videosPerDayToCron(6)).toBe("every_4h");
    expect(videosPerDayToCron(2)).toBe("every_12h");
    expect(videosPerDayToCron(1)).toBe("every_24h");
  });
  it("0 (or less) means manual / no auto-post", () => {
    expect(videosPerDayToCron(0)).toBe("manual");
    expect(videosPerDayToCron(-3)).toBe("manual");
  });
  it("snaps in-between rates to the nearest bucket", () => {
    expect(videosPerDayToCron(3)).toBe("every_4h");   // 6/day=4h vs 2/day=12h → nearest is 4h
    expect(videosPerDayToCron(20)).toBe("every_1h");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/builder/heartbeatSchedule.test.ts`
Expected: FAIL — `videosPerDayToCron` is not exported.

- [ ] **Step 3: Implement `videosPerDayToCron`**

Add to `lib/builder/heartbeatSchedule.ts` (end of file):

```ts
/**
 * Map a "videos per day" target to the nearest heartbeat cron bucket. The
 * heartbeat fires the autonomy loop which auto-creates+posts a video per fire,
 * so cadence === posts/day. 0 → "manual" (no auto-post).
 */
export function videosPerDayToCron(perDay: number): string {
  if (!Number.isFinite(perDay) || perDay <= 0) return "manual";
  // bucket → posts/day
  const buckets: { cron: string; perDay: number }[] = [
    { cron: "every_1h", perDay: 24 },
    { cron: "every_2h", perDay: 12 },
    { cron: "every_4h", perDay: 6 },
    { cron: "every_12h", perDay: 2 },
    { cron: "every_24h", perDay: 1 },
  ];
  let best = buckets[buckets.length - 1];
  let bestDelta = Infinity;
  for (const b of buckets) {
    const d = Math.abs(b.perDay - perDay);
    if (d < bestDelta) { bestDelta = d; best = b; }
  }
  return best.cron;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/builder/heartbeatSchedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/builder/heartbeatSchedule.ts lib/builder/heartbeatSchedule.test.ts
git commit -m "feat(video-director): videosPerDay → heartbeat cron mapping"
```

---

### Task 3: The resolver — `videoDirector.ts`

**Files:**
- Create: `lib/builder/videoDirector.ts`
- Test: `lib/builder/videoDirector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/builder/videoDirector.test.ts
import { describe, it, expect } from "vitest";
import { resolveVideoDirectives, randInRange, DEFAULT_VIDEO_CONFIG, type VideoConfig } from "./videoDirector";

const cfg: VideoConfig = {
  ...DEFAULT_VIDEO_CONFIG,
  minSeconds: 16, maxSeconds: 48,
  styles: ["talking_head", "commercial", "ootd"],
  hookStyles: ["question", "bold_claim"],
  settings: ["studio", "home"],
  energy: "high", cta: "follow", customDirective: "always smiling", avoid: "no politics",
};
const agent = { mintAddress: "m1", niche: "fashion", videoConfig: cfg };

describe("randInRange", () => {
  it("stays within [min,max] and snaps to a supported length", () => {
    for (let i = 0; i < 50; i++) {
      const v = randInRange(16, 48, `seed-${i}`);
      expect(v).toBeGreaterThanOrEqual(16);
      expect(v).toBeLessThanOrEqual(48);
      expect([8, 16, 24, 32, 48, 60]).toContain(v);
    }
  });
});

describe("resolveVideoDirectives", () => {
  it("explicit input duration overrides the config range", () => {
    const d = resolveVideoDirectives(agent, { durationSeconds: 24 }, "s1");
    expect(d.durationSeconds).toBe(24);
  });

  it("derives a varied duration from the config range when input omits it", () => {
    const d = resolveVideoDirectives(agent, {}, "s2");
    expect(d.durationSeconds).toBeGreaterThanOrEqual(16);
    expect(d.durationSeconds).toBeLessThanOrEqual(48);
  });

  it("composes a brief from the rolled style + hook + energy + cta + custom + avoid", () => {
    const d = resolveVideoDirectives(agent, {}, "s3");
    expect(cfg.styles).toContain(
      // brief.format equals the rolled style's format string
      // (assert it is one of the configured styles' formats)
      d.brief.format,
    );
    expect(d.brief.structureNotes).toContain("always smiling");
    expect(d.brief.structureNotes.toLowerCase()).toContain("avoid");
    expect(d.brief.angle.length).toBeGreaterThan(0);
    expect(d.brief.visualTreatment.length).toBeGreaterThan(0);
  });

  it("avoids repeating the immediately-previous style when more than one style", () => {
    const last = "talking-head"; // a previous brief.format
    const d = resolveVideoDirectives(agent, {}, "s3", last);
    expect(d.brief.format).not.toBe(last);
  });

  it("falls back to sane defaults when videoConfig is absent", () => {
    const d = resolveVideoDirectives({ mintAddress: "m2", niche: "tech" }, {}, "s4");
    expect(d.durationSeconds).toBeGreaterThanOrEqual(8);
    expect(d.brief.format.length).toBeGreaterThan(0);
  });
});
```

> Note: the second assertion in "composes a brief" compares `d.brief.format`
> against the configured styles' *formats*. Map them in the test if you prefer
> stricter checking; the registry maps `talking_head → "talking-head"`,
> `commercial → "commercial spot"`, `ootd → "outfit showcase"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/builder/videoDirector.test.ts`
Expected: FAIL — cannot find module `./videoDirector`.

- [ ] **Step 3: Implement the resolver**

```ts
// lib/builder/videoDirector.ts
import { STANDARD_VIDEO_LENGTHS } from "./agentTypes";
import {
  VIDEO_STYLES, HOOK_STYLES, SETTINGS, MOODS, CAMERA_STYLES, COLOR_GRADES,
  getStyle, getFragment,
} from "./videoStyles";

export interface CaptionStyleLike { mode: string; fontColor: string; fontSize: number; position: string; }

export interface VideoConfig {
  minSeconds: number;
  maxSeconds: number;
  videosPerDay: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
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
  hookText?: { enabled: boolean; source: "auto" | "custom"; text?: string; style: CaptionStyleLike };
  captions?: { enabled: boolean; style: CaptionStyleLike };
}

export const DEFAULT_CAPTION_STYLE: CaptionStyleLike = { mode: "word", fontColor: "#ffffff", fontSize: 42, position: "bottom" };

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  minSeconds: 16,
  maxSeconds: 32,
  videosPerDay: 1,
  aspectRatio: "9:16",
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
};

/** Deterministic 32-bit hash of a string seed. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A varied length in [min,max], snapped to the nearest supported length inside the range. */
export function randInRange(min: number, max: number, seed: string): number {
  const lo = Math.max(5, Math.min(min, max));
  const hi = Math.min(60, Math.max(min, max));
  const inRange = STANDARD_VIDEO_LENGTHS.filter((s) => s >= lo && s <= hi);
  const pool = inRange.length ? inRange : [Math.max(8, Math.min(60, lo))];
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
    hookText?: VideoConfig["hookText"];
    brandLogoUrl?: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentLike = { mintAddress?: string; niche?: string; videoConfig?: VideoConfig | null; [k: string]: any };
type VideoInput = { durationSeconds?: number; format?: string };

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
): VideoDirectives {
  const cfg: VideoConfig = { ...DEFAULT_VIDEO_CONFIG, ...(agent.videoConfig ?? {}) };

  const durationSeconds = typeof input.durationSeconds === "number"
    ? input.durationSeconds
    : randInRange(cfg.minSeconds, cfg.maxSeconds, seed);

  // Build the rotating style pool: registry styles + any custom free-text styles.
  const stylePool = [...(cfg.styles ?? []), ...((cfg.customStyles ?? []).map((s) => `custom:${s}`))];
  let styleId = input.format
    ? undefined
    : (pickRotating(stylePool, seed, "style") ?? "talking_head");

  // Resolve to a style def (custom styles become an ad-hoc def from their text).
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

  // Avoid repeating the immediately-previous style when possible.
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

  return {
    durationSeconds,
    brief: { format, angle, structureNotes, visualTreatment },
    aspectRatio: cfg.aspectRatio,
    overlays: { captions: cfg.captions, hookText: cfg.hookText, brandLogoUrl: cfg.brandLogoUrl },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/builder/videoDirector.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/builder/videoDirector.ts lib/builder/videoDirector.test.ts
git commit -m "feat(video-director): per-video directive resolver"
```

---

### Task 4: Schema + blueprint type

**Files:**
- Modify: `convex/schema.ts` (the `influencers` table — add after `monetization`)
- Modify: `lib/builder/agentTypes.ts` (`AgentBlueprint` interface)

- [ ] **Step 1: Add `videoConfig` to the influencers schema**

In `convex/schema.ts`, inside `influencers: defineTable({ ... })`, immediately after the `monetization: v.optional(v.object({ ... }))` block, add:

```ts
    /** Video Director config — per-agent creative control over generated videos.
     *  Resolved per video by lib/builder/videoDirector.ts. See
     *  docs/superpowers/specs/2026-06-05-video-director-design.md */
    videoConfig: v.optional(v.object({
      minSeconds: v.number(),
      maxSeconds: v.number(),
      videosPerDay: v.number(),
      aspectRatio: v.string(),
      styles: v.array(v.string()),
      customStyles: v.optional(v.array(v.string())),
      hookStyles: v.optional(v.array(v.string())),
      settings: v.optional(v.array(v.string())),
      moods: v.optional(v.array(v.string())),
      energy: v.optional(v.string()),
      cameraStyle: v.optional(v.string()),
      colorGrade: v.optional(v.string()),
      voiceover: v.optional(v.boolean()),
      cta: v.optional(v.string()),
      ctaText: v.optional(v.string()),
      customDirective: v.optional(v.string()),
      avoid: v.optional(v.string()),
      brandLogoUrl: v.optional(v.string()),
      brandColor: v.optional(v.string()),
      hookText: v.optional(v.object({
        enabled: v.boolean(),
        source: v.string(),
        text: v.optional(v.string()),
        style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string() }),
      })),
      captions: v.optional(v.object({
        enabled: v.boolean(),
        style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string() }),
      })),
    })),
```

- [ ] **Step 2: Add `videoConfig` to the blueprint type**

In `lib/builder/agentTypes.ts`, inside `export interface AgentBlueprint {`, near `videoEngine?:`, add:

```ts
  // Imported lazily to avoid a hard dep cycle; the shape matches lib/builder/videoDirector.VideoConfig.
  videoConfig?: import("./videoDirector").VideoConfig;
```

- [ ] **Step 3: Regenerate Convex types**

Run: `npx convex codegen`
Expected: completes without error.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "videoDirector|agentTypes|schema.ts" | grep -vE "implicitly has an 'any'|TS2339" | head`
Expected: no output (no new structural errors).

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts lib/builder/agentTypes.ts convex/_generated
git commit -m "feat(video-director): videoConfig on influencers schema + blueprint"
```

---

### Task 5: `setVideoConfig` mutation (persists config + cadence)

**Files:**
- Modify: `convex/influencers.ts` (add after `setMonetization`)

- [ ] **Step 1: Add the mutation**

In `convex/influencers.ts`, import the cron mapper at the top (next to the existing heartbeat import):

```ts
import { nextHeartbeatFireAt, resolveIntervalMs, videosPerDayToCron } from "../lib/builder/heartbeatSchedule";
```

Then add after the `setMonetization` mutation:

```ts
/**
 * Persist the agent's Video Director config. Also maps videosPerDay onto the
 * heartbeat cadence (heartbeatCron + heartbeatNextFireAt) so "N videos/day"
 * actually drives auto-posting.
 */
export const setVideoConfig = mutation({
  args: {
    mintAddress: v.string(),
    // Accept the full object; schema validates the shape.
    videoConfig: v.object({
      minSeconds: v.number(),
      maxSeconds: v.number(),
      videosPerDay: v.number(),
      aspectRatio: v.string(),
      styles: v.array(v.string()),
      customStyles: v.optional(v.array(v.string())),
      hookStyles: v.optional(v.array(v.string())),
      settings: v.optional(v.array(v.string())),
      moods: v.optional(v.array(v.string())),
      energy: v.optional(v.string()),
      cameraStyle: v.optional(v.string()),
      colorGrade: v.optional(v.string()),
      voiceover: v.optional(v.boolean()),
      cta: v.optional(v.string()),
      ctaText: v.optional(v.string()),
      customDirective: v.optional(v.string()),
      avoid: v.optional(v.string()),
      brandLogoUrl: v.optional(v.string()),
      brandColor: v.optional(v.string()),
      hookText: v.optional(v.object({
        enabled: v.boolean(), source: v.string(), text: v.optional(v.string()),
        style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string() }),
      })),
      captions: v.optional(v.object({
        enabled: v.boolean(),
        style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string() }),
      })),
    }),
  },
  handler: async (ctx, { mintAddress, videoConfig }) => {
    const doc = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!doc) throw new Error("Agent not found");

    // Map videos/day → heartbeat cadence.
    const cron = videosPerDayToCron(videoConfig.videosPerDay);
    const patch: Record<string, unknown> = { videoConfig, heartbeatCron: cron, updatedAt: Date.now() };
    const intervalMs = resolveIntervalMs(cron);
    if (intervalMs > 0) {
      patch.heartbeatEnabled = true;
      patch.heartbeatNextFireAt = nextHeartbeatFireAt(Date.now(), intervalMs, mintAddress);
    }
    await ctx.db.patch(doc._id, patch);
    return { ok: true, heartbeatCron: cron };
  },
});
```

- [ ] **Step 2: Regenerate + typecheck**

Run: `npx convex codegen && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "influencers.ts" | grep -vE "implicitly has an 'any'|TS2339"`
Expected: no new structural errors.

- [ ] **Step 3: Commit**

```bash
git add convex/influencers.ts convex/_generated
git commit -m "feat(video-director): setVideoConfig mutation + cadence mapping"
```

---

### Task 6: Wire the resolver into `create_video`

**Files:**
- Modify: `app/api/agents/run-task/route.ts` (the `create_video` executor, around the `reqSeconds` / `planCreativeBrief` / `generateVideoScript` block near lines 765–810)

- [ ] **Step 1: Import the resolver**

At the top of `app/api/agents/run-task/route.ts`, add:

```ts
import { resolveVideoDirectives } from "@/lib/builder/videoDirector";
```

- [ ] **Step 2: Resolve directives before building the brief**

In the `create_video` executor, find:

```ts
      const reqSeconds = typeof input.durationSeconds === "number" ? input.durationSeconds : undefined;
```

Replace it with (look up the agent's last video style to avoid repeats; `ctx.memories` is already loaded for the executor):

```ts
      // Video Director — resolve per-video length + style from the agent's config.
      // Explicit input still wins. Seed varies per (agent, topic, time) so length
      // and style differ across videos.
      const lastFormat = (ctx.memories ?? [])
        .map((m) => m.summary.match(/format[:=]\s*([a-z_ -]+)/i)?.[1]?.trim())
        .find(Boolean);
      const directorSeed = `${(agent as { mintAddress?: string }).mintAddress ?? ""}:${typeof input.topic === "string" ? input.topic : ""}:${Math.floor(Date.now() / 60000)}`;
      const directives = resolveVideoDirectives(agent as Record<string, unknown>, { durationSeconds: input.durationSeconds as number | undefined, format: input.format as string | undefined }, directorSeed, lastFormat);
      const reqSeconds = directives.durationSeconds;
```

- [ ] **Step 3: Apply the directed brief**

Find the `const brief = await planCreativeBrief({ ... })` call. Immediately AFTER it, override the brief's style fields with the director's (so the planner still provides the topic, but the format/angle/treatment come from the config):

```ts
      // Override planner style with the Director's rolled style (keep its topic).
      brief.format = directives.brief.format;
      brief.angle = directives.brief.angle;
      brief.structureNotes = [directives.brief.structureNotes, (brief as { structureNotes?: string }).structureNotes].filter(Boolean).join(". ");
      (brief as { visualTreatment?: string }).visualTreatment = directives.brief.visualTreatment;
```

> If `brief` is typed as a fixed shape and TS complains, cast via
> `const b = brief as Record<string, unknown>;` and assign through `b`.

- [ ] **Step 4: Persist the chosen format into task memory (for next-time anti-repeat)**

This already happens — the executor writes a memory summary for create_video. Ensure the summary string includes `format: <format>` so `lastFormat` works next time. Find where the create_video memory summary is built (search `summary:` near `Drafted script` / video success in this executor) and append `` ` · format=${reqBriefFormat}` `` where `reqBriefFormat = directives.brief.format`. If the summary is built in `buildMemory`, instead add to the task `output` an object field `format: directives.brief.format` (the executor JSON-stringifies `output`). Concretely, in the returned `output` object for create_video, add:

```ts
        format: directives.brief.format,
```

(The `listGenerations`/memory consumers already read `output`.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "run-task/route" | grep -vE "implicitly has an 'any'|TS2339"`
Expected: no new structural errors.

- [ ] **Step 6: Build (route compiles)**

Run: `npx next build --webpack 2>&1 | grep -iE "failed to compile|error TS" | head`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add app/api/agents/run-task/route.ts
git commit -m "feat(video-director): drive create_video length + style from videoConfig"
```

---

### Task 7: Hire-flow inherits agent defaults

**Files:**
- Modify: `app/api/agents/hire-generate/route.ts` (the `input` passed to run-task)

- [ ] **Step 1: Stop hardcoding the duration**

In `app/api/agents/hire-generate/route.ts`, find the `input` object in the `run-task` fetch body:

```ts
        input: {
          topic,
          durationSeconds: 16,
          productImageUrl: refImages[0],
          campaignImageUrls: refImages,
          campaignContext: campaignContext || undefined,
          skipBalanceCheck: true,
        },
```

Remove the `durationSeconds: 16,` line so the agent's `videoConfig` range applies:

```ts
        input: {
          topic,
          productImageUrl: refImages[0],
          campaignImageUrls: refImages,
          campaignContext: campaignContext || undefined,
          skipBalanceCheck: true,
        },
```

- [ ] **Step 2: Build**

Run: `npx next build --webpack 2>&1 | grep -iE "failed to compile|error TS" | head`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app/api/agents/hire-generate/route.ts
git commit -m "feat(video-director): hire flow inherits agent video length/style defaults"
```

---

### Task 8: Director tab UI

**Files:**
- Create: `components/builder/VideoDirectorTab.tsx`
- Modify: `components/builder/AgentWorkspace.tsx` (add "director" to the tab union, a tab button, and a content branch)

- [ ] **Step 1: Create the tab component**

```tsx
// components/builder/VideoDirectorTab.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Check, Lock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  VIDEO_STYLES, HOOK_STYLES, SETTINGS, MOODS, CAMERA_STYLES, COLOR_GRADES,
} from "@/lib/builder/videoStyles";
import { DEFAULT_VIDEO_CONFIG, type VideoConfig } from "@/lib/builder/videoDirector";
import { videoCostForLength, getVideoEngine } from "@/lib/builder/agentTypes";

const card = "rounded-xl border border-zinc-300/70 bg-white p-4";
const label = "text-[11px] font-semibold text-zinc-500 mb-2 block";

function Chips({ options, selected, onToggle }: { options: { id: string; label: string; icon?: string }[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button key={o.id} type="button" onClick={() => onToggle(o.id)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors ${on ? "bg-zinc-900 text-white border-zinc-900" : "bg-white border-zinc-300 text-zinc-700 hover:border-zinc-500"}`}>
            {o.icon ? `${o.icon} ` : ""}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function VideoDirectorTab({ mintAddress }: { mintAddress?: string }) {
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as { videoConfig?: VideoConfig } | null | undefined;
  const save = useMutation(api.influencers.setVideoConfig);
  const [cfg, setCfg] = useState<VideoConfig>(DEFAULT_VIDEO_CONFIG);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (doc?.videoConfig) setCfg({ ...DEFAULT_VIDEO_CONFIG, ...doc.videoConfig }); }, [doc?.videoConfig]);

  const commit = (next: VideoConfig) => {
    setCfg(next);
    if (!mintAddress) return;
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await save({ mintAddress, videoConfig: next }); setState("saved"); setTimeout(() => setState("idle"), 1400); }
      catch { setState("idle"); }
    }, 600);
  };

  const toggle = (key: "styles" | "hookStyles" | "settings" | "moods", id: string) => {
    const cur = (cfg[key] as string[] | undefined) ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    commit({ ...cfg, [key]: next });
  };

  const engine = getVideoEngine(undefined);
  const costLo = videoCostForLength(engine, cfg.minSeconds);
  const costHi = videoCostForLength(engine, cfg.maxSeconds);

  return (
    <div className="flex flex-col gap-4" style={{ fontFamily: "var(--font-inter)" }}>
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-bold text-zinc-900">Video Director</h3>
        {!mintAddress ? <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400"><Lock className="size-3" /> Mint to save</span>
          : state === "saving" ? <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400"><Loader2 className="size-3 animate-spin" /> Saving</span>
          : state === "saved" ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><Check className="size-3" /> Saved</span> : null}
      </div>

      {/* Length + cadence */}
      <div className={card}>
        <label className={label}>Length range (seconds)</label>
        <div className="flex items-center gap-3">
          <input type="number" min={5} max={60} value={cfg.minSeconds} disabled={!mintAddress}
            onChange={(e) => commit({ ...cfg, minSeconds: Math.min(Number(e.target.value) || 5, cfg.maxSeconds) })}
            className="h-9 w-20 rounded-lg border border-zinc-300 px-2 text-[13px] tabular-nums" />
          <span className="text-zinc-400">to</span>
          <input type="number" min={5} max={60} value={cfg.maxSeconds} disabled={!mintAddress}
            onChange={(e) => commit({ ...cfg, maxSeconds: Math.max(Number(e.target.value) || 60, cfg.minSeconds) })}
            className="h-9 w-20 rounded-lg border border-zinc-300 px-2 text-[13px] tabular-nums" />
          <span className="ml-auto text-[11px] text-zinc-500">≈ ${costLo.toFixed(2)}–${costHi.toFixed(2)}/video</span>
        </div>
        <label className={`${label} mt-3`}>Videos per day</label>
        <input type="number" min={0} max={24} value={cfg.videosPerDay} disabled={!mintAddress}
          onChange={(e) => commit({ ...cfg, videosPerDay: Math.max(0, Math.min(24, Number(e.target.value) || 0)) })}
          className="h-9 w-24 rounded-lg border border-zinc-300 px-2 text-[13px] tabular-nums" />
      </div>

      {/* Styles */}
      <div className={card}>
        <label className={label}>Styles (rotates for variety)</label>
        <Chips options={VIDEO_STYLES} selected={cfg.styles} onToggle={(id) => toggle("styles", id)} />
      </div>

      {/* Hooks / Settings / Moods */}
      <div className={card}>
        <label className={label}>Hook openings</label>
        <Chips options={HOOK_STYLES} selected={cfg.hookStyles ?? []} onToggle={(id) => toggle("hookStyles", id)} />
        <label className={`${label} mt-3`}>Settings</label>
        <Chips options={SETTINGS} selected={cfg.settings ?? []} onToggle={(id) => toggle("settings", id)} />
        <label className={`${label} mt-3`}>Moods</label>
        <Chips options={MOODS} selected={cfg.moods ?? []} onToggle={(id) => toggle("moods", id)} />
      </div>

      {/* Look & feel + custom direction */}
      <div className={card}>
        <label className={label}>Camera</label>
        <Chips options={CAMERA_STYLES} selected={cfg.cameraStyle ? [cfg.cameraStyle] : []} onToggle={(id) => commit({ ...cfg, cameraStyle: id as VideoConfig["cameraStyle"] })} />
        <label className={`${label} mt-3`}>Color grade</label>
        <Chips options={COLOR_GRADES} selected={cfg.colorGrade ? [cfg.colorGrade] : []} onToggle={(id) => commit({ ...cfg, colorGrade: id as VideoConfig["colorGrade"] })} />
        <label className={`${label} mt-3`}>Custom direction</label>
        <textarea rows={3} value={cfg.customDirective ?? ""} disabled={!mintAddress}
          onChange={(e) => commit({ ...cfg, customDirective: e.target.value })}
          placeholder="Anything the agent should always do in its videos…"
          className="w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-[12.5px]" />
        <label className={`${label} mt-3`}>Avoid</label>
        <input value={cfg.avoid ?? ""} disabled={!mintAddress}
          onChange={(e) => commit({ ...cfg, avoid: e.target.value })}
          placeholder="Never show / mention…"
          className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-[13px]" />
      </div>
    </div>
  );
}
```

> Note: `getVideoEngine(undefined)` returns the default engine — confirm its
> export signature in `lib/builder/agentTypes.ts` and adjust if it needs a slug.
> If `videoCostForLength` requires a different engine object, pass
> `getVideoEngine(blueprint.videoEngine)` instead.

- [ ] **Step 2: Add the tab to AgentWorkspace**

In `components/builder/AgentWorkspace.tsx`:

1. Import at the top: `import VideoDirectorTab from "./VideoDirectorTab";`
2. Extend the tab union (line ~438): `const [activeTab, setActiveTab] = useState<"home" | "tasks" | "generations" | "budget" | "director">("home");`
3. In the tab-button list (around line 631–648), add a `{ id: "director", label: "Director" }` entry matching the existing button shape.
4. In the tab-content switch (around line 652+), add a branch before the default `home`:

```tsx
        ) : activeTab === "director" ? (
          <section className="max-w-[760px] mx-auto px-6 py-6">
            <VideoDirectorTab mintAddress={mintAddress} />
          </section>
```

(Match the exact JSX/ternary structure already used for `tasks`/`budget`/`generations`.)

- [ ] **Step 3: Build**

Run: `npx next build --webpack 2>&1 | grep -iE "failed to compile|error TS" | head`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add components/builder/VideoDirectorTab.tsx components/builder/AgentWorkspace.tsx
git commit -m "feat(video-director): builder Director tab"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the full unit suite for the new modules**

Run: `npx vitest run lib/builder/videoStyles.test.ts lib/builder/videoDirector.test.ts lib/builder/heartbeatSchedule.test.ts`
Expected: all PASS.

- [ ] **Step 2: Full production build**

Run: `npx next build --webpack`
Expected: `BUILD_EXIT=0`, `/agents`, `/builder`, `/api/agents/run-task`, `/api/agents/hire-generate` all listed.

- [ ] **Step 3: Manual smoke (document, do not automate)**

In the builder for a minted agent: open the **Director** tab → set length range 16–48, pick 3 styles, set videos/day = 3 → confirm "Saved". Trigger a video (heartbeat fire or hire) → confirm the generated video's length varies and the style reflects a configured style. Confirm `heartbeatCron` became `every_4h` (3/day → nearest bucket).

- [ ] **Step 4: Final commit (if any docs/notes changed)**

```bash
git add -A && git commit -m "chore(video-director): phase 1 verification notes"
```

---

## Notes for Phases 2–4 (separate plans)

- **Phase 2** — thread `directives.aspectRatio` into the Veo/storyboard render (`videoJobs` payload → `kie-video-pipeline`); add optional brand-logo overlay via `clipFilterGraph`'s `overlay` op.
- **Phase 3** — Hook Text: after the stitched video exists, burn `overlays.hookText` (auto = script hook) over the first 5s via `renderCaptionsAss` + ffmpeg in a bounded `render-step` phase.
- **Phase 4** — Captions: transcribe the stitched video (existing Whisper route) → `renderCaptionsAss` → burn via `buildClipGraph` `subtitles` op, styled by `overlays.captions.style`.
