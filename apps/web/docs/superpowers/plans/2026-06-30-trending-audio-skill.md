# Trending Audio clip skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use superpowers:test-driven-development for every code task.

**Goal:** Add a new `clip.trendingaudio` ("Trending Audio") marketplace clip skill — a built-in library of music tracks the operator can pick, plus an auto-pick-by-mood toggle — that mixes a quiet music bed under the clip via the existing `audio_overlay` rail.

**Architecture:** A new pure pack module (`trendingAudioPack.ts`, mirroring `reactionSfxPack.ts`) hosts the library + a deterministic mood→track picker. A new `ClipSkill` catalog entry (new "Music" category) emits one `audio_overlay` op from its deterministic floor. Per-node config (`musicTrackId`/`autoMusic`/`gainDb`) is threaded through the planner + clipJobs exactly like the existing `clip.memeaudio` skill. No render-core changes (lean overlay; ducking/looping deferred).

**Tech Stack:** TypeScript, Next.js, Convex, Vitest, React (xyflow canvas). Tests run from `apps/web` via `npx vitest run <path>`.

## Global Constraints

- **NEW skill, NEW category.** Skill id `clip.trendingaudio`; category `"Music"` added to `CLIP_SKILL_CATEGORIES` + `CATEGORY_BY_ID`. Do NOT place it in "Backgrounds & Audio" (one-skill-per-category collision with `clip.memeaudio` + `clip.brainrot`).
- **Do NOT touch the dead external-API scaffolding:** `lib/server/trendingAudio.ts`, `app/api/clip/trending-audio/route.ts`, or the `audioUrl`/`audioId` memeaudio config fields. New module is named **`trendingAudioPack.ts`** (the bare name `trendingAudio.ts` already exists).
- **Lean overlay only.** Emit one `audio_overlay` at `atSec:0`, default gain **−16 dB**. NO new ffmpeg code (`clipEditOps.ts`, `clipFilterGraph.ts`, `clipRender.ts` unchanged). NO static post-mix `volume=N`.
- **Leak-safe gating.** Floor emits only when a real track resolves OR `autoMusic === true`. `clipJobs` injects `autoMusic:true` for a genuinely-wired-but-unconfigured row; the `wired !== false` filter blocks stale rows.
- **Graceful degrade.** `trendingAudioUrl()` returns `""` when the pack is empty or `TRENDING_AUDIO_BASE_URL` is unset → floor returns `[]` → render unchanged. Ships inert until the user uploads files + sets the env.
- **Pricing:** `CLIP_SKILL_PRICE_USDC["clip.trendingaudio"] = 0.15`.
- **No `Math.random` / `Date.now`** in the picker — deterministic seeded rotation only.
- **Determinism in code paths the floor uses; pure floor** (no server runtime import beyond the pack module, which is itself pure env+string).

---

### Task 1: The built-in pack module (`trendingAudioPack.ts`)

**Files:**
- Create: `apps/web/lib/server/trendingAudioPack.ts`
- Test: `apps/web/lib/server/trendingAudioPack.test.ts`
- Reference (mirror): `apps/web/lib/server/reactionSfxPack.ts`, `apps/web/lib/server/reactionSfxPack.test.ts`

**Interfaces:**
- Produces:
  - `interface TrendingAudioEntry { id: string; label: string; url: string; mood: string }`
  - `trendingAudioUrl(id: string): string` — resolved URL, or `""` when id unknown / base env unset
  - `isTrendingAudioId(id: unknown): id is string`
  - `TRENDING_AUDIO: TrendingAudioEntry[]`, `TRENDING_AUDIO_IDS: string[]`, `DEFAULT_TRENDING_AUDIO_ID: string`
  - `pickTrendingTrackByMood(emotion: string | undefined, seed: number): string` — deterministic; mood-matched id, else seeded rotation across all; `""` only when the pack is empty

- [ ] **Step 1: Read the mirror files** `reactionSfxPack.ts` and `reactionSfxPack.test.ts` to copy the exact env-handling + test harness (how it sets/clears the `*_BASE_URL` env around calls).

- [ ] **Step 2: Write the failing test** `apps/web/lib/server/trendingAudioPack.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TRENDING_AUDIO, TRENDING_AUDIO_IDS, isTrendingAudioId,
  trendingAudioUrl, pickTrendingTrackByMood,
} from "@/lib/server/trendingAudioPack";

const ENV = "TRENDING_AUDIO_BASE_URL";
const saved = process.env[ENV];
beforeEach(() => { process.env[ENV] = "https://cdn.example.com/music"; });
afterEach(() => { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved; });

describe("trendingAudioPack", () => {
  it("ships a non-empty curated library, every id well-formed", () => {
    expect(TRENDING_AUDIO_IDS.length).toBeGreaterThan(0);
    for (const id of TRENDING_AUDIO_IDS) {
      expect(isTrendingAudioId(id)).toBe(true);
      const e = TRENDING_AUDIO.find((t) => t.id === id)!;
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.mood.length).toBeGreaterThan(0);
    }
  });

  it("resolves a known id against the base (tolerating a trailing slash)", () => {
    process.env[ENV] = "https://cdn.example.com/music/";
    const id = TRENDING_AUDIO_IDS[0];
    expect(trendingAudioUrl(id)).toMatch(/^https:\/\/cdn\.example\.com\/music\/[^/]+/);
    expect(trendingAudioUrl(id)).not.toContain("//music//");
  });

  it("returns '' for an unknown id even with the base set", () => {
    expect(trendingAudioUrl("clip.nope.zzz")).toBe("");
  });

  it("returns '' for EVERY id when the base env is unset (graceful degrade)", () => {
    delete process.env[ENV];
    for (const id of TRENDING_AUDIO_IDS) expect(trendingAudioUrl(id)).toBe("");
  });

  it("guards non-string / unknown ids", () => {
    expect(isTrendingAudioId(123)).toBe(false);
    expect(isTrendingAudioId(undefined)).toBe(false);
    expect(isTrendingAudioId("not-an-id")).toBe(false);
  });

  it("auto-picks deterministically and matches mood when present", () => {
    const a = pickTrendingTrackByMood("This was shocking and insane", 7);
    const b = pickTrendingTrackByMood("This was shocking and insane", 7);
    expect(a).toBe(b);                          // deterministic
    expect(isTrendingAudioId(a)).toBe(true);
    expect(TRENDING_AUDIO.find((t) => t.id === a)!.mood).toBe("hype"); // shock→hype
  });

  it("auto-picks SOME track (rotation) when emotion is absent, while the pack is loaded", () => {
    const id = pickTrendingTrackByMood(undefined, 3);
    expect(isTrendingAudioId(id)).toBe(true);
    // rotation is seed-stable
    expect(pickTrendingTrackByMood(undefined, 3)).toBe(id);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails** — `cd apps/web && npx vitest run lib/server/trendingAudioPack.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `apps/web/lib/server/trendingAudioPack.ts`** (mirror `reactionSfxPack.ts`). Seed `TRACK_FILES` with representative placeholder entries spanning the three mood buckets (the user replaces/extends with their 15 cleared files; the structure + tests are proven now):

```ts
// Built-in music library for the clip.trendingaudio skill. Each track is hosted
// at TRENDING_AUDIO_BASE_URL/<file>; that env MUST be set for the skill to emit
// audio. With no base URL, trendingAudioUrl() returns "" — the catalog floor then
// emits NO audio_overlay op (render unchanged), so the feature degrades gracefully
// instead of pointing ffmpeg at a missing input. Mirrors reactionSfxPack.
//
// NOTE: the entries below are PLACEHOLDERS. Replace/extend with the operator's ~15
// CLEARED (royalty-free / owned) tracks: add one line per track with its label, the
// uploaded filename, a mood bucket, and a license note. Do NOT add copyrighted
// masters — the skill self-hosts + re-uploads each file into user clips.

export interface TrendingAudioEntry {
  /** Stable id the inspector stores as config.musicTrackId; also the file stem. */
  id: string;
  /** Human label for the inspector picker. */
  label: string;
  /** Resolved absolute URL of the track, or "" when the base env is unset. */
  url: string;
  /** Auto-pick bucket. The picker maps emotion → "hype" | "funny" | "emotional";
   *  any other tag (e.g. "chill") participates only in the no-mood rotation. */
  mood: string;
}

const TRACK_FILES: Record<string, { label: string; file: string; mood: string; license?: string }> = {
  // ── PLACEHOLDERS — replace with the operator's 15 cleared tracks ──
  "hype-01":      { label: "Phonk Drift",      file: "hype-01.mp3",      mood: "hype",      license: "PLACEHOLDER — replace with cleared track" },
  "hype-02":      { label: "Hard Trap",        file: "hype-02.mp3",      mood: "hype",      license: "PLACEHOLDER — replace with cleared track" },
  "funny-01":     { label: "Goofy Bounce",     file: "funny-01.mp3",     mood: "funny",     license: "PLACEHOLDER — replace with cleared track" },
  "funny-02":     { label: "Quirky Whistle",   file: "funny-02.mp3",     mood: "funny",     license: "PLACEHOLDER — replace with cleared track" },
  "emotional-01": { label: "Soft Piano",       file: "emotional-01.mp3", mood: "emotional", license: "PLACEHOLDER — replace with cleared track" },
  "emotional-02": { label: "Cinematic Swell",  file: "emotional-02.mp3", mood: "emotional", license: "PLACEHOLDER — replace with cleared track" },
  "chill-01":     { label: "Lofi Wave",        file: "chill-01.mp3",     mood: "chill",     license: "PLACEHOLDER — replace with cleared track" },
};

/** Join the env base with a filename, tolerating a trailing slash. Returns "" when
 *  no base is configured (caller treats that as "unavailable"). */
function joinBase(file: string): string {
  const base = (globalThis.process?.env?.TRENDING_AUDIO_BASE_URL ?? "").trim();
  if (!base) return "";
  return `${base.replace(/\/+$/, "")}/${file}`;
}

/** Resolved URL for a track id, or "" if the id is unknown or the base env is unset. */
export function trendingAudioUrl(id: string): string {
  const entry = TRACK_FILES[id];
  if (!entry) return "";
  return joinBase(entry.file);
}

/** The full track list, each url resolved against TRENDING_AUDIO_BASE_URL (or ""). */
export const TRENDING_AUDIO: TrendingAudioEntry[] = Object.entries(TRACK_FILES).map(
  ([id, { label, file, mood }]) => ({ id, label, mood, url: joinBase(file) }),
);

/** Stable list of track ids — the inspector picker values. */
export const TRENDING_AUDIO_IDS = Object.keys(TRACK_FILES);

/** Default track when none is picked and auto can't match (kept for callers/tests). */
export const DEFAULT_TRENDING_AUDIO_ID = TRENDING_AUDIO_IDS[0] ?? "";

/** Whether a track id is one of the curated set. */
export const isTrendingAudioId = (id: unknown): id is string =>
  typeof id === "string" && id in TRACK_FILES;

/** PURE auto-pick: emotion → mood subset → seeded rotation within it. Falls back to
 *  the WHOLE library when no mood matches, so auto always adds music while the pack
 *  is loaded. Returns "" only when the pack is empty. No Math.random / Date.now. */
export function pickTrendingTrackByMood(emotion: string | undefined, seed: number): string {
  const ids = TRENDING_AUDIO_IDS;
  if (!ids.length) return "";
  const e = (emotion ?? "").toLowerCase();
  const wantMood =
    /shock|controvers|surpris|wtf|crazy|insane|hype|epic/.test(e) ? "hype"
    : /funny|fun|comed|laugh|meme|silly|awkward/.test(e) ? "funny"
    : /inspir|wow|emotion|sad|touch|amaz/.test(e) ? "emotional"
    : "";
  const pool = wantMood ? ids.filter((id) => TRACK_FILES[id].mood === wantMood) : [];
  const use = pool.length ? pool : ids;
  const i = ((seed % use.length) + use.length) % use.length;
  return use[i];
}
```

- [ ] **Step 5: Run the test, verify it passes** — `cd apps/web && npx vitest run lib/server/trendingAudioPack.test.ts` → PASS.

- [ ] **Step 6: Typecheck the new file** — `cd apps/web && npx tsc --noEmit` (or the project's typecheck script if narrower). Expected: no new errors.

---

### Task 2: Register the skill + deterministic floor (`clipSkillsCatalog.ts`)

**Files:**
- Modify: `apps/web/lib/builder/clipSkillsCatalog.ts` (CLIP_SKILLS, CLIP_SKILL_CATEGORIES, CATEGORY_BY_ID, ClipFloorConfig, imports)
- Test: `apps/web/lib/builder/clipFloorExtras.test.ts` (extend)
- Modify (regen): `apps/web/lib/builder/__snapshots__/clipSkillsCatalog.test.ts.snap`

**Interfaces:**
- Consumes: `trendingAudioUrl`, `isTrendingAudioId`, `pickTrendingTrackByMood` (Task 1).
- Produces: a `clip.trendingaudio` `ClipSkill` whose `floor(m, config)` returns `[{ op:"audio_overlay", audioUrl, atSec:0, gainDb }]` or `[]`. New `ClipFloorConfig` fields `musicTrackId?: string`, `autoMusic?: boolean`.

- [ ] **Step 1: Read** `clipFloorExtras.test.ts` to copy its harness (how it builds a `ClipFloorMoment` + calls a skill's floor, and how it sets `*_BASE_URL` env), and re-read `clipSkillsCatalog.ts:24-93,400-520,615-647` for exact insertion points.

- [ ] **Step 2: Write the failing tests** — add to `apps/web/lib/builder/clipFloorExtras.test.ts` a `describe("clip.trendingaudio floor", …)` block:

```ts
// inside clipFloorExtras.test.ts — uses the file's existing moment factory + env setup
import { CLIP_SKILL_BY_ID } from "@/lib/builder/clipSkillsCatalog";

const floor = (m, cfg) => CLIP_SKILL_BY_ID["clip.trendingaudio"].floor!(m, cfg);
const baseCfg = { captionsOn: false, captionStyle: undefined }; // match the file's ClipFloorConfig stub

describe("clip.trendingaudio floor", () => {
  beforeEach(() => { process.env.TRENDING_AUDIO_BASE_URL = "https://cdn.example.com/music"; });

  it("emits one audio_overlay at the resolved URL for a picked track, quiet bed gain", () => {
    const ops = floor(moment({ emotion: "" }), { ...baseCfg, musicTrackId: "funny-01" });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "audio_overlay", atSec: 0 });
    expect(ops[0].audioUrl).toContain("funny-01");
    expect(ops[0].gainDb).toBe(-16);
  });

  it("auto-picks by mood when autoMusic is on and no track is picked", () => {
    const ops = floor(moment({ emotion: "hilarious comedy bit" }), { ...baseCfg, autoMusic: true });
    expect(ops).toHaveLength(1);
    expect(ops[0].audioUrl).toMatch(/funny-0[12]/);
  });

  it("is INERT when neither a track nor autoMusic is set (leak-safe)", () => {
    expect(floor(moment({ emotion: "funny" }), { ...baseCfg })).toEqual([]);
  });

  it("degrades to [] when the base env is unset", () => {
    delete process.env.TRENDING_AUDIO_BASE_URL;
    expect(floor(moment({ emotion: "" }), { ...baseCfg, musicTrackId: "funny-01" })).toEqual([]);
  });

  it("honors an explicit gainDb override", () => {
    const ops = floor(moment({ emotion: "" }), { ...baseCfg, musicTrackId: "funny-01", gainDb: -8 });
    expect(ops[0].gainDb).toBe(-8);
  });
});
```
(Adapt `moment(...)`/`baseCfg` to the helpers the file already defines.)

- [ ] **Step 3: Run, verify failure** — `cd apps/web && npx vitest run lib/builder/clipFloorExtras.test.ts` → FAIL (`clip.trendingaudio` undefined).

- [ ] **Step 4: Implement the catalog changes** in `apps/web/lib/builder/clipSkillsCatalog.ts`:
  1. Add the import near the other pack imports (top, ~lines 9-10):
     ```ts
     import { trendingAudioUrl, isTrendingAudioId, pickTrendingTrackByMood } from "../server/trendingAudioPack";
     ```
  2. Add two fields to `ClipFloorConfig` (after `sfxId?`, ~line 60):
     ```ts
     /** clip.trendingaudio: chosen music track id (lib/server/trendingAudioPack). */
     musicTrackId?: string;
     /** clip.trendingaudio: auto-pick a mood-matched track (default ON when wired). */
     autoMusic?: boolean;
     ```
  3. Append a `ClipSkill` to `CLIP_SKILLS` (after the `clip.memeaudio` entry, ~line 520):
     ```ts
     {
       id: "clip.trendingaudio",
       name: "Trending Audio",
       icon: "🎵",
       tag: "Music",
       blurb: "Drops a trending music bed under the clip — pick a sound, or let it auto-match the clip's mood.",
       priceLabel: "$0.15",
       defaultInstalled: false,
       markdownTemplate: [
         "# Trending Audio",
         "",
         "**What I do:** Mix a trending music bed UNDER the clip. Pick one of the built-in sounds in the node's inspector, or leave **Auto-pick** on to match the clip's mood automatically.",
         "",
         "**Editor rules:**",
         "- Apply the chosen/auto music deterministically; do not add other ops on its behalf.",
       ].join("\n"),
       // Manual pick WINS; else auto-pick by mood when autoMusic === true (the default,
       // set by the inspector + the clipJobs wired-default injection). Quiet bed gain so
       // speech stays dominant (no ducking in v1). Graceful no-op when the pack/env is
       // unset (url === "") — mirrors brainrot/memeaudio.
       floor: (m, config) => {
         let id = isTrendingAudioId(config.musicTrackId) ? config.musicTrackId : "";
         if (!id && config.autoMusic === true) {
           id = pickTrendingTrackByMood(m.emotion, Math.round((m.startSeconds ?? 0) * 1000));
         }
         if (!id) return [];
         const url = trendingAudioUrl(id);
         if (!url) return [];
         const gainDb = typeof config.gainDb === "number" ? config.gainDb : -16;
         return [{ op: "audio_overlay", audioUrl: url, atSec: 0, gainDb }];
       },
     },
     ```
  4. Add `"Music"` to `CLIP_SKILL_CATEGORIES` (after `"Backgrounds & Audio"`, ~line 624).
  5. Add `"clip.trendingaudio": "Music",` to `CATEGORY_BY_ID` (after the `clip.memeaudio` line, ~line 643).

- [ ] **Step 5: Run the floor tests, verify pass** — `cd apps/web && npx vitest run lib/builder/clipFloorExtras.test.ts` → PASS.

- [ ] **Step 6: Run the catalog suite + regenerate snapshots** — `cd apps/web && npx vitest run lib/builder/clipSkillsCatalog.test.ts -u`. Then **review the snapshot diff**: exactly two snapshots gain a `clip.trendingaudio` line (ids·names·tags; floor-ops). Confirm `node-catalog.test.ts.snap` is untouched.

- [ ] **Step 7: Commit checkpoint** — staged in the final commit (Task 8); run the two suites once more to confirm green.

---

### Task 3: Planner wiring (`clipEditPlanner.ts`)

**Files:**
- Modify: `apps/web/lib/server/clipEditPlanner.ts` (`SKILL_OP_KINDS`, `PlanArgs.skills[]` type, `buildSkillFloor`)
- Test: `apps/web/lib/server/clipEditPlanner.test.ts` (extend)

**Interfaces:**
- Consumes: the `clip.trendingaudio` floor (Task 2).
- Produces: `SKILL_OP_KINDS["clip.trendingaudio"] = ["audio_overlay"]`; `buildSkillFloor` threads `musicTrackId`/`autoMusic`/`gainDb` into `perNode`.

- [ ] **Step 1: Read** `clipEditPlanner.ts:20-90,214-268` and the relevant parts of `clipEditPlanner.test.ts` (how it mocks the LLM + asserts allowed ops).

- [ ] **Step 2: Write the failing tests** — add to `clipEditPlanner.test.ts`:
  - a case where a `clip.trendingaudio`-only graph + a mocked LLM that returns an extra `title_card` MUST drop the `title_card` (proves `allowedOpKinds` didn't fall back to `null`);
  - a case where `clip.trendingaudio` (picked track) + `clip.memeaudio` (shock moment) both wired → **two** `audio_overlay` ops survive;
  - a case proving a picked `musicTrackId` reaches the floor via `planClipEdits` (the resulting overlay URL contains the picked id).

  (Mirror the existing memeaudio/brainrot planner cases for the exact mock + assert shape.)

- [ ] **Step 3: Run, verify failure** — `cd apps/web && npx vitest run lib/server/clipEditPlanner.test.ts` → FAIL.

- [ ] **Step 4: Implement** in `clipEditPlanner.ts`:
  1. `SKILL_OP_KINDS` (~line 62-79): add `"clip.trendingaudio": ["audio_overlay"],`.
  2. `PlanArgs.skills[]` inline type (~line 20-44): add `musicTrackId?: string; autoMusic?: boolean;` (next to the existing `audioUrl?`/`gainDb?`).
  3. `buildSkillFloor` (~line 246, after the `clip.memeaudio` branch): add
     ```ts
     if (s.skillId === "clip.trendingaudio") {
       if (s.musicTrackId) perNode.musicTrackId = s.musicTrackId;
       if (typeof s.autoMusic === "boolean") perNode.autoMusic = s.autoMusic;
       if (typeof s.gainDb === "number") perNode.gainDb = s.gainDb;
     }
     ```

- [ ] **Step 5: Run, verify pass** — `cd apps/web && npx vitest run lib/server/clipEditPlanner.test.ts` → PASS.

---

### Task 4: Pricing (`servicePrices.ts`)

**Files:**
- Modify: `apps/web/lib/economy/servicePrices.ts` (`CLIP_SKILL_PRICE_USDC`)
- Test: `apps/web/lib/economy/servicePrices.test.ts` (extend)

**Interfaces:**
- Produces: `clipSkillRunCost("clip.trendingaudio") === 0.15`; `clipSkillPriceLabel("clip.trendingaudio")` shows `$0.15`.

- [ ] **Step 1: Read** `servicePrices.ts:19-49` and `servicePrices.test.ts` for the assert pattern.

- [ ] **Step 2: Write the failing test** — add to `servicePrices.test.ts`:
```ts
it("prices clip.trendingaudio at $0.15", () => {
  expect(clipSkillRunCost("clip.trendingaudio")).toBe(0.15);
  expect(clipSkillPriceLabel("clip.trendingaudio")).toContain("0.15");
});
```
(import `clipSkillRunCost`/`clipSkillPriceLabel` as the file already does.)

- [ ] **Step 3: Run, verify failure** — `cd apps/web && npx vitest run lib/economy/servicePrices.test.ts` → FAIL.

- [ ] **Step 4: Implement** — add `"clip.trendingaudio": 0.15,` to `CLIP_SKILL_PRICE_USDC` (~line 19-37).

- [ ] **Step 5: Run, verify pass** — `cd apps/web && npx vitest run lib/economy/servicePrices.test.ts` → PASS.

---

### Task 5: Cloud apply + guard (`convex/clipJobs.ts`)

**Files:**
- Modify: `apps/web/convex/clipJobs.ts` (skills shape thread; wired-but-default injection; "won't apply" warning)
- Test: `apps/web/lib/server/clipJobsSkillFilter.test.ts` (extend, billing/leak)

**Interfaces:**
- Consumes: the planner skills shape (Task 3), pricing (Task 4).
- Produces: a wired `clip.trendingaudio` row reaches the floor with its config; a bare wired row defaults `autoMusic:true`; a `wired:false` stale row neither applies nor bills.

- [ ] **Step 1: Read** `clipJobs.ts` around the skill-build (`~:790-848`) and skill-apply/warning (`~:1030-1055`), and `clipJobsSkillFilter.test.ts` to learn its harness.

- [ ] **Step 2: Write the failing test** — add to `clipJobsSkillFilter.test.ts`: a wired `clip.trendingaudio` install applies + bills $0.15; a `wired:false` install neither applies nor bills. (Mirror the existing brainrot/memeaudio rows.)

- [ ] **Step 3: Run, verify failure** — `cd apps/web && npx vitest run lib/server/clipJobsSkillFilter.test.ts` → FAIL.

- [ ] **Step 4: Implement** in `clipJobs.ts`:
  1. Thread `musicTrackId`/`autoMusic` onto the `skills` object built for the planner (beside the existing `audioUrl`/`gainDb`/`sfxId` spreads, ~:841-848).
  2. **Wired-but-default injection** (mirror the brainrot `bgId:"random"` fix, ~:838-840): for a wired `clip.trendingaudio` row with no `musicTrackId` and `autoMusic === undefined`, set `autoMusic: true`.
  3. **"Won't apply" warning** (~:1036-1044): if a wired `clip.trendingaudio` resolves no track (auto off + no pick, or `TRENDING_AUDIO_BASE_URL` unset), push a warning string (mirror the memeaudio warning) — not an error.

- [ ] **Step 5: Run, verify pass** — `cd apps/web && npx vitest run lib/server/clipJobsSkillFilter.test.ts` → PASS.

- [ ] **Step 6: Convex typecheck** — `cd apps/web && npx convex codegen` is NOT run here (no schema change); rely on `npx tsc --noEmit` in Task 8.

---

### Task 6: Config type + Inspector UI

**Files:**
- Modify: `apps/web/components/builder/clipping-flow/types/clipping.ts` (`MarketplaceSkillConfig`)
- Modify: `apps/web/components/builder/clipping-flow/inspector/inspector-panel.tsx` (new `TrendingAudioConfig` block + the marketplace config default)
- Reference (mirror): the in-file `BrainRotConfig` (imports `GAMEPLAY_PACK`), `StickerConfig`, the violet auto-toggle pill, the `Row`+`Slider` gain control.

**Interfaces:**
- Consumes: `TRENDING_AUDIO` (Task 1).
- Produces: node config `{ skillId:"clip.trendingaudio", variant:"marketplace", musicTrackId?, autoMusic, gainDb }` with `autoMusic` defaulting ON.

- [ ] **Step 1:** Add to `MarketplaceSkillConfig` (`types/clipping.ts:64-133`):
```ts
/** Trending Audio (clip.trendingaudio): chosen built-in music track id. */
musicTrackId?: string;
/** Trending Audio: auto-pick a mood-matched track (default ON when the node is added). */
autoMusic?: boolean;
```

- [ ] **Step 2: Read** `inspector-panel.tsx` around `:306-326` (BrainRotConfig importing GAMEPLAY_PACK), `:484-548` (StickerConfig chip grid), `:784-792` (violet auto pill), `:683-691` (the `set` NodeForm helper), and `:1008-1018` (the memeaudio block + where marketplace config blocks render).

- [ ] **Step 3: Implement** the import + a `TrendingAudioConfig` component (mirror `BrainRotConfig`):
```tsx
import { TRENDING_AUDIO } from "@/lib/server/trendingAudioPack";

function TrendingAudioConfig({ c, set }: { c: MarketplaceSkillConfig; set: (p: Partial<MarketplaceSkillConfig>) => void }) {
  const auto = c.autoMusic !== false;             // default ON
  const gain = typeof c.gainDb === "number" ? c.gainDb : -16;
  return (
    <>
      {/* violet auto pill — mirror the existing toggle at :784-792 */}
      <TogglePill active={auto} onClick={() => set({ autoMusic: !auto })}>
        Auto-pick to match the clip’s mood
      </TogglePill>
      {/* track chip-grid — disabled/dimmed when auto is on; picking one also implies manual */}
      <div className="grid grid-cols-2 gap-2">
        {TRENDING_AUDIO.map((t) => (
          <button key={t.id}
            data-active={c.musicTrackId === t.id}
            onClick={() => set({ musicTrackId: t.id, autoMusic: false })}
            className={/* mirror StickerConfig chip styles */ ""}>
            {t.label}
          </button>
        ))}
      </div>
      {/* gain slider — Row + Slider, range -30..0, default -16 */}
      <Row label={`Music volume ${gain} dB`}>
        <Slider min={-30} max={0} step={1} value={gain} onChange={(v) => set({ gainDb: v })} />
      </Row>
    </>
  );
}
```
  Then render it in the marketplace chain after the memeaudio block (`~:1014-1018`):
```tsx
{c.skillId === "clip.trendingaudio" && <TrendingAudioConfig c={c} set={set} />}
```
  (Use the file's real `TogglePill`/`Row`/`Slider`/chip primitives — names per the in-file patterns; do not invent components.)

- [ ] **Step 4:** Where a fresh marketplace node's config is created (the make-config / add-skill default), ensure a new `clip.trendingaudio` node gets `{ variant:"marketplace", skillId:"clip.trendingaudio", autoMusic: true }` so it auto-adds music out of the box. (Find the existing per-skill default; mirror it.)

- [ ] **Step 5: Typecheck** — `cd apps/web && npx tsc --noEmit` → no new errors. (No unit test for the inspector block; covered by typecheck + the integration suite.)

---

### Task 7: Cloud config sync (`ClippingFlowCanvas.tsx`)

**Files:**
- Modify: `apps/web/components/builder/clipping-flow/ClippingFlowCanvas.tsx` (both `extract()` sync blocks)

**Interfaces:**
- Consumes: node config fields (Task 6).
- Produces: `agentSkillFiles.config` for `clip.trendingaudio` carries `musicTrackId`/`autoMusic`/`gainDb` on both the copilot-config write and the compile-persist path.

- [ ] **Step 1: Read** `ClippingFlowCanvas.tsx:288-328` (the per-skill `extract()` config serialization, memeaudio at ~:298-305) and the compile-persist block (~:1001-1004).

- [ ] **Step 2: Implement** a `clip.trendingaudio` branch in BOTH blocks, mirroring the memeaudio branch, syncing `musicTrackId`/`autoMusic`/`gainDb`:
```ts
if (skillId === "clip.trendingaudio") {
  if (cfg.musicTrackId) out.musicTrackId = cfg.musicTrackId;
  if (typeof cfg.autoMusic === "boolean") out.autoMusic = cfg.autoMusic;
  if (typeof cfg.gainDb === "number") out.gainDb = cfg.gainDb;
}
```
  (Match the exact local variable names + shape used by the surrounding memeaudio/brainrot branches.)

- [ ] **Step 3: Typecheck** — `cd apps/web && npx tsc --noEmit` → no new errors.

---

### Task 8: Full verification, commit, push

- [ ] **Step 1: Run the full clip test surface:**
```
cd apps/web && npx vitest run lib/server/trendingAudioPack.test.ts lib/builder/clipFloorExtras.test.ts lib/builder/clipSkillsCatalog.test.ts lib/server/clipEditPlanner.test.ts lib/economy/servicePrices.test.ts lib/server/clipJobsSkillFilter.test.ts lib/builder/skillSplit.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Run the broader clip suite** (catch any snapshot/integration drift):
```
cd apps/web && npx vitest run lib/server lib/builder
```
Expected: all PASS (the 220+ existing clip tests stay green — no render-core change).

- [ ] **Step 3: Typecheck + lint:**
```
cd apps/web && npx tsc --noEmit
cd apps/web && npx next lint --file components/builder/clipping-flow/inspector/inspector-panel.tsx --file components/builder/clipping-flow/ClippingFlowCanvas.tsx
```
Expected: clean (or only pre-existing warnings).

- [ ] **Step 4: Verify git scope** — `git status` + `git log origin/main..HEAD --oneline`. Stage ONLY the trending-audio files (the new/edited files listed in this plan), leaving all unrelated working-tree changes unstaged.

- [ ] **Step 5: Commit** (no Co-Authored-By trailer):
```
git add apps/web/lib/server/trendingAudioPack.ts apps/web/lib/server/trendingAudioPack.test.ts \
  apps/web/lib/builder/clipSkillsCatalog.ts apps/web/lib/builder/__snapshots__/clipSkillsCatalog.test.ts.snap \
  apps/web/lib/builder/clipFloorExtras.test.ts apps/web/lib/server/clipEditPlanner.ts apps/web/lib/server/clipEditPlanner.test.ts \
  apps/web/lib/economy/servicePrices.ts apps/web/lib/economy/servicePrices.test.ts \
  apps/web/convex/clipJobs.ts apps/web/lib/server/clipJobsSkillFilter.test.ts \
  apps/web/components/builder/clipping-flow/types/clipping.ts \
  apps/web/components/builder/clipping-flow/inspector/inspector-panel.tsx \
  apps/web/components/builder/clipping-flow/ClippingFlowCanvas.tsx \
  apps/web/docs/superpowers/specs/2026-06-30-trending-audio-skill-design.md \
  apps/web/docs/superpowers/plans/2026-06-30-trending-audio-skill.md
git commit -m "feat(clip): add Trending Audio skill (built-in music library + auto-pick by mood)"
```

- [ ] **Step 6: Land on main cleanly** — determine the divergence from Step 4, then put ONLY this commit on `main` and push (a main-based branch + cherry-pick, or fast-forward if appropriate). Confirm the pushed diff is exactly this feature.

- [ ] **Step 7: Post-merge note** — the skill ships INERT until the operator uploads the 15 cleared tracks + sets `TRENDING_AUDIO_BASE_URL` on Railway + Convex. State this in the final report.

---

## Self-Review (writing-plans)

- **Spec coverage:** pack (T1), catalog+floor+category+ClipFloorConfig (T2), planner SKILL_OP_KINDS+thread (T3), pricing (T4), clipJobs apply+inject+warn (T5), config type+inspector (T6), cloud sync (T7), tests + verify + ship (T1-T8). compile-graph correctly untouched (per spec §5.9). ✓
- **Placeholder scan:** the only "placeholders" are the seeded `TRACK_FILES` entries — intentional + documented (user supplies files); all code/test steps carry real content. ✓
- **Type consistency:** `musicTrackId`/`autoMusic`/`gainDb` identical across `ClipFloorConfig`, `MarketplaceSkillConfig`, `PlanArgs.skills[]`, clipJobs, extract. Floor returns `audio_overlay` matching `SKILL_OP_KINDS`. Picker/url signatures match Task 1. ✓
