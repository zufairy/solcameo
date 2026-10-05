# Video Director — full creative control over an agent's generated videos

**Date:** 2026-06-05
**Status:** Draft (awaiting review)

## Problem

When an operator builds an AI influencer, they have **no control over how its
videos turn out**. Every `create_video` call hardcodes `durationSeconds: 16` and
uses a generic auto-brief, so:

- All videos are the **same length** (~16s) — short and repetitive.
- There is **no way to set the style** (talking-head vs commercial vs OOTD vs …).
- There is **no cadence control** tied to how many videos post per day.
- There are **no overlays** — no hook text, no burned-in captions.

Operators want a "director's chair": set the length range, the rotating style mix,
cadence, look/feel, and overlays — so each agent produces **varied, on-brand,
unique** videos (including longer ones), and two operators can produce wildly
different agents.

## What already exists (so we build on it, not from scratch)

- **Length + style are already pipeline inputs.** `generateVideoScript(opts)`
  accepts `targetSeconds` and a `brief { format, angle, structureNotes }`; the
  storyboard planner (`lib/server/kie-video-pipeline.ts`) consumes `format`,
  `visualTreatment`, and `campaignContext`. Standard lengths are
  `[8,16,24,32,48,60]`, max 60s, stitched from 8s Veo clips.
- **Caption/overlay rendering already exists.** `lib/server/captionRenderer.ts`
  (`renderCaptionsAss`), `lib/server/clipFilterGraph.ts` (`buildClipGraph` with
  `subtitles` + logo `overlay` ops), and `app/api/video/clip/route.ts` already
  burn ASS captions + logos via ffmpeg. `app/api/video/transcribe-clip` runs
  Whisper for word timings. `clipConfig.captionStyle` = `{ mode, fontColor,
  fontSize, position }`.
- **Cadence already exists.** The heartbeat (`heartbeatCron` → `resolveIntervalMs`)
  fires the autonomy loop on named buckets (`every_1h`, `every_2h`, `every_4h`,
  `every_12h`, `every_24h`) and already auto-creates+posts a video per fire.
- **Engine selection already exists** (`videoEngine` + `VideoEnginePicker`),
  giving precedent for a per-agent video setting and a builder tab.

The gap is: a **persistent per-agent config**, a **builder tab** to edit it, a
**resolver** that turns it into per-video directives (with variety), **cadence
wiring**, and connecting the **overlay features** to the generation output.

## Goals

1. Operators set length range, rotating styles/hooks/settings, cadence, look/feel,
   overlays, and free-text custom direction in a new **Director** tab.
2. Every generated video (autonomous + hire default) respects the config; the
   client's explicit request still overrides.
3. Videos **vary** in length and style across an agent's output, and can run
   **longer** (up to 60s).
4. **Hook Text** overlay (first 5s) and **Captions** (burned-in subtitles) are
   available as toggles.

## Non-goals (v1)

- A full timeline/scene editor. The Director sets *preferences*; the pipeline
  still composes each video.
- Music/audio track selection (Veo provides native audio). Revisit later.
- Per-video manual overrides in the builder UI beyond the hire modal's existing
  product fields (the hire flow inherits agent defaults).

## Data model

Add an optional `videoConfig` to the Convex `influencers` table and mirror it on
the builder `AgentBlueprint` (persisted pre-mint, written through at mint).

```ts
videoConfig?: {
  // Length & cadence & render
  minSeconds: number;            // 5..60, default 16
  maxSeconds: number;            // 5..60, default 32 (>= minSeconds)
  videosPerDay: number;          // 0..24 → maps to heartbeatCron
  aspectRatio: "9:16" | "1:1" | "16:9";  // default "9:16"

  // Rotate each video (variety)
  styles: string[];              // style ids from the registry, >=1
  customStyles?: string[];       // free-text styles, also rotated in
  hookStyles?: string[];         // hook ids; default ["bold_claim","question"]
  settings?: string[];           // scene ids; default ["studio"]
  moods?: string[];              // optional vibe ids

  // Brand feel (consistent)
  energy?: "calm" | "balanced" | "high" | "hype";        // default "balanced"
  cameraStyle?: "ugc_handheld" | "tripod" | "cinematic" | "selfie";
  colorGrade?: "natural" | "warm" | "vibrant" | "moody" | "clean_bright";
  voiceover?: boolean;           // default true; false = silent b-roll + captions
  cta?: "follow" | "visit_link" | "comment" | "shop" | "none";
  ctaText?: string;              // optional custom CTA line

  // "Imagine anything" levers
  customDirective?: string;      // free text appended to the brief
  avoid?: string;                // free text negative list

  // Branding
  brandLogoUrl?: string;
  brandColor?: string;           // hex

  // Overlays
  hookText?: {
    enabled: boolean;
    source: "auto" | "custom";   // auto = the script hook line
    text?: string;               // when source === "custom"
    style: CaptionStyleLike;     // font/color/position/animation
  };
  captions?: {
    enabled: boolean;
    style: CaptionStyleLike;
  };
}
```

`CaptionStyleLike` reuses the shape from `clipConfig.captionStyle`
(`{ mode, fontColor, fontSize, position }`) so the existing ASS renderer applies
unchanged.

New Convex mutation: `influencers.setVideoConfig({ mintAddress, videoConfig })`
(patch-merge). Pre-mint values live on the blueprint and are persisted by the
mint route.

## Style registry — `lib/builder/videoStyles.ts`

A single source of truth, used by both the UI and the resolver. Each style id maps
to the brief levers the pipeline already consumes:

```ts
export interface VideoStyleDef {
  id: string; label: string; icon: string; description: string;
  format: string;          // → brief.format
  angle: string;           // → brief.angle (default; hook may override)
  structureNotes: string;  // → brief.structureNotes
  visualTreatment: string; // → brief.visualTreatment (merged with setting/camera/grade)
}
```

Seed: `talking_head`, `commercial`, `ootd`, `vlog`, `tutorial`, `ugc_review`,
`cinematic_broll`, `asmr`. Plus parallel small registries for hooks, settings,
moods, camera styles, and color grades (id → label + a short prompt fragment).

## The core — `resolveVideoDirectives(agent, input)`

A pure-ish function (`lib/builder/videoDirector.ts`) called inside the
`create_video` executor in `app/api/agents/run-task/route.ts`. It returns the
effective directives, with explicit `input` always winning:

```ts
function resolveVideoDirectives(agent, input, seed): {
  durationSeconds: number;
  brief: { format; angle; structureNotes; visualTreatment };
  aspectRatio: "9:16"|"1:1"|"16:9";
  overlays: { hookText?: ResolvedHook; captions?: ResolvedCaptions; logoUrl?; };
}
```

Logic:
- **Duration**: `input.durationSeconds ?? randInRange(min, max, seed)` snapped to a
  supported length. `seed` derives from `mint + topic + fireTime` so it is varied
  but reproducible.
- **Style/hook/setting/mood**: `input.format ?? rotate(styles, seed)`. Rotation is
  **deterministic from `seed`** (no persisted state): `idx = hash(seed) % n`, with
  hook/setting/mood each offset by a different salt so they rotate independently.
  To avoid an immediate repeat, the executor reads the agent's **last succeeded
  `create_video` task** (already queried for context) and, if the rolled style
  equals the last one and `styles.length > 1`, advances by one. No new table or
  write-contention.
- **Brief composition**: `format` = style.format; `angle` = hook fragment;
  `structureNotes` = style.structureNotes + energy pacing + CTA(+text) +
  `customDirective` + `avoid`; `visualTreatment` = style.visualTreatment + setting
  + cameraStyle + colorGrade + aspectRatio + brand color.
- **Overlays**: resolve `hookText` (auto pulls the script's hook after generation)
  and `captions` flags + styles; pass `brandLogoUrl`.

The executor passes `durationSeconds` + `brief` to `generateVideoScript` and
threads `aspectRatio`/overlay directives into the render payload (`videoJobs`).

## Cadence wiring

When the operator sets `videosPerDay`, map to the nearest heartbeat bucket and
write `heartbeatCron` + recompute `heartbeatNextFireAt` (reuse
`nextHeartbeatFireAt`). Mapping:

| videosPerDay | heartbeatCron |
|---|---|
| 24 | every_1h |
| 12 | every_2h |
| 6  | every_4h |
| 2  | every_12h |
| 1  | every_24h |
| 0  | manual (no auto-post) |

(Intermediate values snap to the nearest bucket; the tab shows the resulting "≈
every Nh".)

## Render-side work (phased)

The script + storyboard already honor `targetSeconds` and the brief, so **Phase 1
needs no render changes**. The remaining features touch the render:

- **Aspect ratio** (Phase 2): thread `aspectRatio` into the Veo/storyboard
  generation (today effectively 9:16). Pass through `videoJobs` → pipeline; default
  unchanged so existing flows are unaffected.
- **Brand logo overlay** (Phase 2): reuse `clipFilterGraph`'s logo `overlay` op as
  an optional post-render pass.
- **Hook Text** (Phase 3): after the stitched video exists, burn the hook line
  (auto from the script hook, or `hookText.text`) over the first 5s via an ASS
  event (`renderCaptionsAss` style or a dedicated drawtext op) + ffmpeg.
- **Captions** (Phase 4): post-render, call the existing Whisper transcription on
  the stitched video → word timings → `renderCaptionsAss` → burn via
  `buildClipGraph`'s `subtitles` op. Style from `captions.style`.

Phases 3–4 run as a **bounded post-render step** in the Vercel-safe render chain
(`app/api/video/render-step`), consistent with how clips already burn captions.

## Builder tab — "Director"

A new tab in `AgentWorkspace` (alongside the existing video engine section),
rendered by a new `VideoDirectorTab.tsx`. Sections:

1. **Length & cadence** — dual-thumb range slider (min/max) with a live cost-range
   estimate (`videoCostForLength`); `videosPerDay` stepper showing "≈ every Nh".
2. **Styles** — multi-select cards (icon + description) + "add custom style" input.
3. **Hooks / Settings / Moods** — compact multi-select chip rows.
4. **Look & feel** — energy, camera, color grade, voiceover, aspect ratio toggles.
5. **CTA** — type + optional custom text.
6. **Overlays** — Hook Text (toggle + source + style) and Captions (toggle +
   style), with small live style previews.
7. **Advanced** — custom directive + avoid text areas; brand logo + color.

Saves through `setVideoConfig` (debounced) post-mint and the blueprint pre-mint,
matching the `MonetizationCards` pattern. A "Preview directives" affordance shows
what the *next* video would roll (style/length/hook) for transparency.

## Hire-flow integration

`app/api/agents/hire-generate` stops sending `durationSeconds: 16`. It omits
length/style so `resolveVideoDirectives` supplies the agent's defaults (varied +
rotated). The client's product images / URL / description still drive content and
override topic; a future optional "length/style" control in the hire modal is out
of scope here.

## Units / boundaries

- `videoStyles.ts` (registry) — pure data, no deps.
- `videoDirector.ts` (resolver) — pure function over `(agent, input, seed)`;
  unit-testable without the pipeline.
- `influencers.setVideoConfig` (Convex) — persistence.
- `VideoDirectorTab.tsx` — UI; depends on registry + mutation only.
- `create_video` executor — calls the resolver, threads results to script + render.
- Render features — isolated post-render ops reusing `captionRenderer` +
  `clipFilterGraph`.

## Testing

- `videoDirector.test.ts`: range randomization stays in `[min,max]` and snaps to
  supported lengths; rotation never repeats the immediate previous style when >1
  style; explicit `input` overrides config; brief composition includes
  energy/CTA/customDirective/avoid.
- `videoStyles.test.ts`: every style id yields a non-empty format + treatment.
- Cadence mapping test: `videosPerDay` → expected `heartbeatCron`.
- Render features covered by extending existing `clipFilterGraph` ffmpeg tests for
  the hook-text + captions ops on a generated (non-clip) source.

## Rollout / phases

1. **Core** — schema `videoConfig`, registry, resolver, executor wiring, Director
   tab (length/style/hook/setting/look/CTA/custom), cadence mapping, hire default.
   Delivers the primary ask: varied length + style, full preference control.
2. **Render params** — aspect ratio + brand logo overlay.
3. **Hook Text** overlay (first 5s).
4. **Captions** (transcribe → burn).

Each phase is shippable on its own; Phase 1 is the bulk of the value and needs no
render changes.
