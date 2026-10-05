# Trending Audio clip skill — Design Spec

**Date:** 2026-06-30
**Status:** Awaiting user green-light (no code written yet)
**Author:** brainstorming session, swarm-mapped (run `wf_d72b4523-59d`, 7 readers + synthesis, verified against source)

---

## 1. Goal

Add a new clipping skill, **Trending Audio** (`clip.trendingaudio`), to the AI clipping
agent canvas. It does two things:

1. **Library:** the operator picks one of ~15 curated music sounds (a built-in grid in the
   node inspector); the chosen track is mixed under the clip.
2. **Auto-add:** an **"Auto-pick to match the mood"** toggle (ON by default) that
   auto-selects a track from the clip's detected mood and mixes it in — no manual pick
   needed. This is the user's *"auto add music based on video sound"*.

The skill must be **bug-free** — the lowest-risk build path was chosen on every axis.

## 2. Decisions locked (from the user)

| Decision | Choice | Consequence |
|---|---|---|
| **Sound source** | **User supplies the files** (already cleared for redistribution) | Pack module is built with a documented id→metadata map + a clear "how to add a track" workflow; ships inert until files are uploaded + `TRENDING_AUDIO_BASE_URL` is set. **No copyrighted TikTok masters.** |
| **Mixing** | **Quiet overlay (lean v1)** | Music is dropped in at a **low fixed gain** over the existing, battle-tested `audio_overlay` rail. **No new ffmpeg code.** No ducking, no looping — those are an explicit fast-follow (§10). |
| **Pricing** | **Small fee (~$0.15/run)** | One entry in `CLIP_SKILL_PRICE_USDC` + a billing/leak test row. |

**Two derived decisions** (forced by the codebase, verified against source):

- **NEW skill, not an extension of "Meme Audio".** `clip.memeaudio` was repurposed into
  *"MEME reaction SFX"* (vine-boom/bruh/fah); its floor reads only `m.emotion` and ignores
  any chosen sound (`clipSkillsCatalog.ts:484-519`). Its old external-API trending-sound
  scaffolding (`lib/server/trendingAudio.ts`, `/api/clip/trending-audio`, the
  `MEME_AUDIO_API_URL` path, the `audioUrl`/`audioId` config) is **dead — we do not touch
  or revive it.**
- **NEW "Music" category.** The store enforces **one wired marketplace skill per category**
  (`clipping-store.ts:125-136`), and `clip.memeaudio` + `clip.brainrot` already occupy
  *"Backgrounds & Audio"* (`clipSkillsCatalog.ts:642-643`). Putting Trending Audio there
  would make it mutually exclusive with brain-rot and SFX. A new **"Music"** category lets
  operators run music + brain-rot + SFX together.

## 3. The honest constraint on "based on video sound"

The pipeline computes **no waveform / tempo / loudness analysis**. The only content signal
that reaches a skill floor is the clip's **mood** — `m.emotion`, graded by the LLM from the
**transcript text**, and only on the cached-analysis path. So:

- **"auto add music based on video sound" is implemented as mood-matching:**
  `emotion → mood → track`, exactly like the `clip.memeaudio` emotion→SFX switch
  (`clipSkillsCatalog.ts:507-512`).
- When emotion is **absent** (the live `selectClipMoments` / evenly-spaced fallback path
  for arbitrary user URLs), auto-mode **falls back to a seeded rotation across the whole
  library** so it still reliably adds music (never a silent no-op when the pack is loaded).
- The toggle is labelled **"Auto-pick to match the clip's mood"**, never "from the waveform".
- True acoustic/BPM matching is **out of scope** (§10) — it needs a net-new analysis pass.

## 4. Architecture — end-to-end path

A wired Trending Audio node flows through the existing rails unchanged; the **only new
runtime module** is the built-in pack. Reused stages are marked *(reuse)*.

```
Inspector (pick track / toggle auto / gain)
  → node config { variant:"marketplace", skillId:"clip.trendingaudio", musicTrackId?, autoMusic, gainDb }
  → [canvas Run]  compile-graph (reuse)              ─┐
  → [cloud]       ClippingFlowCanvas.extract() → agentSkillFiles.config (sync)
                                                       ├→ clipJobs: build skills[] (wired !== false gate) (reuse)
                                                       │    + wired-but-default injection (autoMusic:true)
  → clipEditPlanner.buildSkillFloor()  (NEW branch: thread musicTrackId/autoMusic/gainDb)
       → clip.trendingaudio floor(m, config)  (NEW, in clipSkillsCatalog.ts)
            → trendingAudioPack: resolve track id → URL  (NEW module)
            → emit ONE { op:"audio_overlay", audioUrl, atSec:0, gainDb:-16 }
  → clipEditOps.coerceOp() clamps gainDb -30..+12, drops op if no audioUrl (reuse)
  → clipRender.ts fetches audioUrl (SSRF-guarded) (reuse)
  → clipFilterGraph.ts amix at normalize=0 (reuse)  → rendered clip
```

`SKILL_OP_KINDS["clip.trendingaudio"] = ["audio_overlay"]` keeps the LLM-op filter armed.

## 5. Components (units of work)

Each unit has one clear purpose and a defined interface.

### 5.1 `lib/server/trendingAudioPack.ts` — NEW (the built-in library)
Mirror `reactionSfxPack.ts` exactly. Pure (env-read + string-build only), so the catalog
floor can import it (same as the memeaudio floor imports `reactionSfxUrl`).

```ts
export interface TrendingAudioEntry {
  id: string;        // stable; inspector stores as config.musicTrackId
  label: string;     // shown in the picker grid
  url: string;       // resolved against TRENDING_AUDIO_BASE_URL, or "" when unset
  mood: string;      // auto-pick bucket. The picker maps emotion → "hype" | "funny"
                     // | "emotional"; any other tag (e.g. "chill") is used only in the
                     // no-mood rotation fallback. Tag every supplied track with one.
}

// id → file + metadata. THE place the user registers each supplied track.
const TRACK_FILES: Record<string, { label: string; file: string; mood: string;
  artist?: string; license?: string }> = {
  // EXAMPLE — replaced/extended with the user's 15 cleared files:
  // "hype-01":   { label: "Phonk Drift",   file: "hype-01.mp3",   mood: "hype",
  //                artist: "…", license: "CC0 / cleared" },
};

function joinBase(file: string): string {
  const base = (globalThis.process?.env?.TRENDING_AUDIO_BASE_URL ?? "").trim();
  if (!base) return "";
  return `${base.replace(/\/+$/, "")}/${file}`;
}
export function trendingAudioUrl(id: string): string {
  const e = TRACK_FILES[id]; return e ? joinBase(e.file) : "";
}
export const TRENDING_AUDIO: TrendingAudioEntry[] = Object.entries(TRACK_FILES)
  .map(([id, t]) => ({ id, label: t.label, url: joinBase(t.file), mood: t.mood }));
export const TRENDING_AUDIO_IDS = Object.keys(TRACK_FILES);
export const isTrendingAudioId = (id: unknown): id is string =>
  typeof id === "string" && id in TRACK_FILES;

/** PURE auto-pick: emotion → mood subset → seeded rotation. No Math.random.
 *  Falls back to the whole library when no mood matches (so auto always adds
 *  music while the pack is loaded). Returns "" only when the pack is empty. */
export function pickTrendingTrackByMood(emotion: string | undefined, seed: number): string {
  const ids = TRENDING_AUDIO_IDS;
  if (!ids.length) return "";
  const e = (emotion ?? "").toLowerCase();
  const wantMood =
    /shock|controvers|surpris|wtf|crazy|insane|hype|epic/.test(e) ? "hype"
    : /funny|fun|comed|laugh|meme|silly|awkward/.test(e) ? "funny"
    : /inspir|wow|emotion|sad|touch|amaz/.test(e) ? "emotional"
    : "";                                  // no/neutral mood → rotate across all
  const pool = wantMood ? ids.filter((id) => TRACK_FILES[id].mood === wantMood) : [];
  const use = pool.length ? pool : ids;
  return use[((seed % use.length) + use.length) % use.length];
}
```

**"How to add a track" (the user-supplies-files workflow):** upload the cleared `.mp3`/`.m4a`
to the same public bucket the gameplay/SFX packs use; add one line to `TRACK_FILES` with its
`label`, `file`, `mood`, and a `license` note; set `TRENDING_AUDIO_BASE_URL` once. Tracks
should be **≥ the max clip length** (~45 s) so they cover the clip — shorter tracks stop
early in v1 (looping is the fast-follow, §10).

### 5.2 `lib/builder/clipSkillsCatalog.ts` — register the skill
1. Append the `ClipSkill` to `CLIP_SKILLS` (after the `clip.filters`/`clip.memeaudio`
   block) with the floor below.
2. Add `"Music"` to `CLIP_SKILL_CATEGORIES` (`:618-626`).
3. Add `"clip.trendingaudio": "Music"` to `CATEGORY_BY_ID` (`:629-646`) — **mandatory**, or
   the category-coverage test (`clipSkillsCatalog.test.ts:39-44`) fails and the skill drops
   out of every marketplace chip.
4. Add `musicTrackId?: string` and `autoMusic?: boolean` to `ClipFloorConfig` (`:24-61`).
5. Import `trendingAudioUrl`, `isTrendingAudioId`, `pickTrendingTrackByMood` from
   `../server/trendingAudioPack`.

```ts
{
  id: "clip.trendingaudio",
  name: "Trending Audio",
  icon: "🎵",
  tag: "Music",
  blurb: "Drops a trending music bed under the clip — pick a sound, or let it auto-match the clip's mood.",
  priceLabel: "$0.15",        // display-only; the real price is CLIP_SKILL_PRICE_USDC
  defaultInstalled: false,
  markdownTemplate: [ /* "What I do" + editor rule: deterministic, add no other ops */ ].join("\n"),
  // Manual pick WINS; else auto-pick by mood when autoMusic === true (the default,
  // set by the inspector + the clipJobs wired-default injection). Quiet bed gain.
  // Graceful no-op when the pack/env is unset (url === "") — mirrors brainrot/memeaudio.
  floor: (m, config) => {
    let id = isTrendingAudioId(config.musicTrackId) ? config.musicTrackId : "";
    if (!id && config.autoMusic === true) {
      id = pickTrendingTrackByMood(m.emotion, Math.round((m.startSeconds ?? 0) * 1000));
    }
    if (!id) return [];                                  // no pick + auto off → inert
    const url = trendingAudioUrl(id);
    if (!url) return [];                                 // env/pack unset → graceful
    const gainDb = typeof config.gainDb === "number" ? config.gainDb : -16; // quiet bed
    return [{ op: "audio_overlay", audioUrl: url, atSec: 0, gainDb }];
  },
}
```

### 5.3 `components/builder/clipping-flow/types/clipping.ts` — config fields
Add to `MarketplaceSkillConfig` (`:64-133`): `musicTrackId?: string` and
`autoMusic?: boolean`. Reuse the existing `gainDb?` (`:108-110`) for the bed gain. (Do **not**
reuse the inert `audioUrl`/`audioId` memeaudio fields — dedicated names keep intent clear.)

### 5.4 `components/builder/clipping-flow/inspector/inspector-panel.tsx` — config UI
Add a `{c.skillId === "clip.trendingaudio" && (<TrendingAudioConfig … />)}` branch after the
static `clip.memeaudio` paragraph (`~:1014-1018`). `TrendingAudioConfig` is built from
in-file parts already used by `BrainRotConfig`/`StickerConfig`:
- imports `TRENDING_AUDIO` directly (like `BrainRotConfig` imports `GAMEPLAY_PACK`, `:306-326`);
- a **chip-grid track picker** → `set({ musicTrackId })`;
- an **"Auto-pick to match the clip's mood"** toggle (violet pill pattern, `~:784-792`)
  → `set({ autoMusic })`, **defaulting visibly ON**;
- a **gain Slider** (`Row`+`Slider`) → `set({ gainDb })`, default **−16 dB**, range −30..0
  (a quiet bed; positive gain would bury speech without ducking).
- `set` is the existing NodeForm helper (`~:683-691`) → store `updateNodeConfig`
  (shallow-merge). Per-chip audio audition is **optional** for v1 (no audition exists in the
  codebase today — net-new; deferred, §10).

The marketplace config default (where a fresh node's config is created) sets
`autoMusic: true` so an accept-the-defaults node auto-adds music.

### 5.5 `components/builder/clipping-flow/ClippingFlowCanvas.tsx` — cloud config sync
Add a `clip.trendingaudio` branch to **both** sync blocks — the copilot-config writer
(`~:298-305`, beside the audio fields) and the compile-persist block (`~:1001-1004`) —
pushing `musicTrackId` / `autoMusic` / `gainDb` to `agentSkillFiles.config` so the cloud
auto-clip path receives the operator's picks.

### 5.6 `lib/server/clipEditPlanner.ts` — planner wiring
1. `SKILL_OP_KINDS["clip.trendingaudio"] = ["audio_overlay"]` (`:62-79`). **Omitting this is a
   silent landmine** — `allowedOpKinds()` returns `null` for an unknown wired id (`:128`),
   disabling the "LLM can't invent ops" filter for the *whole graph*.
2. Add `musicTrackId?` and `autoMusic?` to the `PlanArgs.skills[]` inline type (`:20-44`).
3. Add a `clip.trendingaudio` branch in `buildSkillFloor` (`~:246`, mirroring the memeaudio
   branch) copying `musicTrackId` / `autoMusic` / `gainDb` into `perNode` so the floor sees
   the operator's pick. The `audio_overlay` merge already pushes every floor overlay, so a
   Trending Audio bed and a Meme-SFX sting coexist and amix.

### 5.7 `convex/clipJobs.ts` — cloud apply + guard
1. Thread `musicTrackId` / `autoMusic` onto the `skills` shape (`~:841-848`).
2. **Wired-but-default injection** (mirror the brainrot `bgId:"random"` fix at `:838-840`): a
   *wired* `clip.trendingaudio` row with no `musicTrackId` and no explicit `autoMusic`
   defaults `autoMusic: true`, so a genuinely-wired-but-untouched node still renders. A
   non-wired / stale row never reaches here (`wired !== false` filter, `:792`) → **leak-safe**.
3. Add a "won't apply" warning near `:1036-1044` (no track + auto off, or
   `TRENDING_AUDIO_BASE_URL` unset) so an unconfigured node isn't mistaken for a bug.

### 5.8 `lib/economy/servicePrices.ts` — pricing
Add `"clip.trendingaudio": 0.15` to `CLIP_SKILL_PRICE_USDC` (`:19-37`). This single map drives
both the marketplace label (`clipSkillPriceLabel`) and the per-run charge (`clipSkillRunCost`).

### 5.9 No-change stages (confirmed)
`clipEditOps.ts` (already clamps `gainDb` −30..+12, drops the op without `audioUrl`),
`clipRender.ts` (already fetches each overlay URL, SSRF-guarded), `clipFilterGraph.ts`
(amix at `normalize=0`), `marketplace-panel.tsx` / `node-palette.tsx` (auto-list from the
catalog), `agentSkillFiles.ts` (`upsert` takes any `clip.*` id), `skillSplit.ts` (auto-
classifies non-"Targeting & Discovery" as an editing effect). **`compile-graph.ts` — no
change:** it only computes the `clipConfig` (captions/crop/source/maxClips) + the wired-id
set for the cost badge; per-skill config never flows through it. Both the canvas Run and the
cloud path read per-skill config from `agentSkillFiles.config` (written by `extract()`),
exactly as the working `clip.memeaudio` skill does — so threading the new fields through
`extract()` (§5.5) + `clipJobs` (§5.7) + the planner (§5.6) is sufficient on both paths. **The "Music" chip and the
install/own/surface flow appear with zero UI code changes.**

## 6. Skill-gating / no-leak / wired-but-default (the "no bugs" core)

- **Apply only when wired:** every skill is gated by `wired !== false` in clipJobs before it
  reaches `buildSkillFloor`. Trending Audio rides that same gate → no installed-but-unwired
  leak (the historical skill-leak class).
- **Default-on without leaking:** the floor emits only when a track resolves OR
  `autoMusic === true`; "auto on" is supplied by the inspector default + the clipJobs
  injection for wired rows. A bare/stale row (autoMusic undefined, no pick) is **inert**.
- **Graceful degrade:** `trendingAudioUrl()` returns `""` when the pack is empty or
  `TRENDING_AUDIO_BASE_URL` is unset → floor returns `[]` → render unchanged. So the skill is
  safe to ship and surface **before** the user's files exist.
- **Must-verify in implementation:** removing/disconnecting a Trending Audio node sets its
  `agentSkillFiles.wired = false` (the gate all marketplace skills rely on). If node-removal
  does not clear `wired`, that is a pre-existing, all-skills bug — flag it, don't paper over it.

## 7. Mixing behavior (lean v1)

- One `audio_overlay` at `atSec: 0`, gain default **−16 dB** (clamped −30..+12 by
  `coerceOp`). Quiet enough to sit under speech **without** ducking.
- `amix=...:duration=first:...:normalize=0` keeps the clip's own audio at native level and
  sums the bed on top (`clipFilterGraph.ts:747`). **No static post-mix `volume=N`** (the
  `normalize=0` regression at `clipFilterGraph.test.ts:389-405` forbids it).
- **Known v1 limitation (documented, not a bug):** the bed plays **once from the start** and
  is **not looped**; a track shorter than the clip stops early. Mitigation: supply tracks
  ≥ ~45 s. Looping + ducking is the fast-follow (§10).

## 8. Tests (the no-bugs checklist)

- **NEW `lib/server/trendingAudioPack.test.ts`** (clone `reactionSfxPack.test.ts`): known id
  resolves against base (tolerating a trailing slash); unknown id → `""`; **all ids → `""`
  when env unset**; `isTrendingAudioId` true/false/non-string; `pickTrendingTrackByMood`
  **deterministic** per `(emotion, seed)`, mood-matches when present, rotates across all when
  emotion absent, and `""` on an empty pack.
- **Regenerate** `__snapshots__/clipSkillsCatalog.test.ts.snap` (`vitest -u`): two snapshots
  change (ids·names·tags; floor-ops). `node-catalog.test.ts.snap` is **not** affected.
- **Extend `clipFloorExtras.test.ts`:** picked `musicTrackId` → exactly one `audio_overlay`
  at the resolved URL with the bed gain; env unset → `[]`; auto mode picks deterministically
  from `m.emotion`; emotion absent → rotated pick (not `[]`) while the pack is loaded;
  per-node config reaches the floor via `planClipEdits` (the "global-config trap" regression).
- **Extend `clipEditPlanner.test.ts`:** a trendingaudio-only graph **drops** an LLM-invented
  `title_card` (proves `allowedOpKinds` didn't fall back to `null`); `clip.trendingaudio` +
  `clip.memeaudio` both wired → **two** `audio_overlay` ops survive (not deduped).
- **Extend `clipJobsSkillFilter.test.ts`** (priced): a `wired:false` stale install neither
  applies nor bills; a wired one bills $0.15.
- Full suite green (the existing 220 clip tests stay byte-identical — no render-code change).

## 9. Env / ops

- Add **`TRENDING_AUDIO_BASE_URL`** (mirrors `GAMEPLAY_PACK_BASE_URL` / `REACTION_SFX_BASE_URL`).
- User uploads the 15 cleared files to the public bucket; serve real audio MIME (the render
  fetch rejects HTML/JSON/image and blocks private/loopback hosts).
- Set the env on **Railway + Convex**. Unset = graceful no-op (skill surfaces, renders nothing).

## 10. Out of scope / explicitly deferred (fast-follow)

These are **not** in v1 (the user chose the lean path). Each is isolated so it can be added
later without touching v1's byte-identical render:
- **Ducked + looped bed:** a `kind:"music"` flag on `audio_overlay` → in `buildComplex`,
  loop the input (`-stream_loop -1`/`aloop`) to clip length and `sidechaincompress` keyed off
  the speech `[abase]`, amixed with un-ducked speech; sting overlays stay on the existing
  plain `normalize=0` sum; add a real-ffmpeg accept test (verify `sidechaincompress` is in the
  bundled `ffmpeg-static`).
- **Per-chip audio audition** in the inspector (single shared `Audio`, one-at-a-time guard,
  CORS hosting, unmount cleanup).
- **True acoustic match** (tempo/BPM/loudness) — a net-new `ffmpeg astats`/`ebur128` pass or
  a BPM dependency.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `SKILL_OP_KINDS` omission disables the LLM-op filter graph-wide | Add the entry + the dedicated planner test (§8). |
| Config not threaded → floor ignores the operator's pick | `buildSkillFloor` branch + clipJobs thread + a `planClipEdits` assertion. |
| Wired-but-default vs stale-row leak | Floor gates on `musicTrackId`-or-`autoMusic===true`; clipJobs injects `autoMusic:true` for wired rows only; the `wired !== false` filter blocks stale rows. |
| Category collision (mutual exclusion) | New "Music" category in both `CLIP_SKILL_CATEGORIES` + `CATEGORY_BY_ID`. |
| Auto no-ops where emotion is absent | `pickTrendingTrackByMood` rotates across all tracks when no mood — auto still adds music. |
| Asset/SSRF reachability | Public bucket origin + real audio MIME + the clipJobs "won't apply" warning. |
| Naming collision with existing `trendingAudio.ts` | New module is **`trendingAudioPack.ts`**; the old external-API file is untouched. |
| Snapshot drift | Run `vitest -u`, review the two-line catalog diff. |
| Music buries speech (no ducking in v1) | Low default gain (−16 dB), slider capped at 0 dB; ducking is the fast-follow. |
| Short track stops mid-clip | Document the ≥45 s guidance; looping is the fast-follow. |

## 12. Files touched (summary)

**New:** `lib/server/trendingAudioPack.ts`, `lib/server/trendingAudioPack.test.ts`.
**Edit:** `lib/builder/clipSkillsCatalog.ts`, `lib/builder/__snapshots__/clipSkillsCatalog.test.ts.snap` (regen),
`components/builder/clipping-flow/types/clipping.ts`,
`components/builder/clipping-flow/inspector/inspector-panel.tsx`,
`components/builder/clipping-flow/ClippingFlowCanvas.tsx`,
`lib/server/clipEditPlanner.ts`, `convex/clipJobs.ts`, `lib/economy/servicePrices.ts`,
`lib/builder/clipFloorExtras.test.ts`, `lib/server/clipEditPlanner.test.ts`,
`lib/server/clipJobsSkillFilter.test.ts`.
**No change (reused):** `clipEditOps.ts`, `clipRender.ts`, `clipFilterGraph.ts`,
`marketplace-panel.tsx`, `node-palette.tsx`, `agentSkillFiles.ts`, `skillSplit.ts`.
**Untouched (dead scaffolding):** `lib/server/trendingAudio.ts`, `app/api/clip/trending-audio/route.ts`.
