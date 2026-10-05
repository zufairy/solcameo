# Engine-Aware Video Duration + 60s Multi-Clip Stitching

**Date:** 2026-06-01
**Status:** Approved design — pending implementation plan
**Area:** AI influencer builder — video generation pipeline

## Problem

In the builder, generating a video for an AI influencer produces a long script but
shows an impossible per-beat duration like `handheld · 2.5s`. Two root causes:

1. **Wrong estimate.** The per-beat `seconds` shown in the story-beats preview comes
   from Claude's raw JSON or a naive even split (`totalSeconds / beats.length`,
   `lib/server/kie-video-pipeline.ts:190`). A long voiceover line cannot be spoken in
   2.5s, so the number is meaningless.
2. **Hardcoded to Veo's 8s clip.** Duration rounding and segment math assume an 8s
   clip everywhere (`kie-video-pipeline.ts:825,831` — `Math.ceil(durationSeconds / 8)`),
   ignoring that Seedance supports 15s clips. Seedance's call even clamps to 12s
   (`:792`), contradicting its `maxClipSeconds: 15` config in `lib/builder/agentTypes.ts`.

The operator also wants both engines to produce **stitched videos up to 60 seconds**,
with a **clear alert** about how many clips a given length needs, **dynamic to the
selected engine**.

## Constraints discovered during research

- **Veo** stitches natively. Kie's `POST /api/v1/veo/extend`
  ([docs](https://docs.kie.ai/veo3-api/extend-video)) returns one server-side-stitched
  file. The code already chains it (`generateExtendedVeo3`). No documented length cap.
- **Seedance cannot be stitched by Kie.** Both `bytedance/seedance-2-fast` and the full
  `bytedance/seedance-2` cap at **15s per generation** with **no extend endpoint**, and
  Kie has **no video merge/concatenate tool** anywhere in its market. The full
  `seedance-2` model does expose `return_last_frame`, `first_frame_url`, and
  `last_frame_url`, so clips can be **frame-chained** for visual continuity — but the
  resulting N clips must be concatenated by us.
- **No concat infra exists** in the repo (no ffmpeg, Cloudinary, Shotstack, Mux;
  `app/workers` is the unrelated "hire a worker" feature).
- **Generation is synchronous** in `app/api/agents/run-task/route.ts`
  (`maxDuration = 300`, pipeline budget 280s). A real 60s video (storyboard + 4–8 clips
  at ~60–120s each) cannot finish inside one 5-minute request for *either* engine —
  today it returns whatever stitched so far (~16–24s).
- **Convex action limits** ([docs](https://docs.convex.dev/production/state/limits)):
  **10-minute** execution timeout (ample), **512MB** Node-runtime memory (tight — drives
  the ffmpeg approach), plus `ctx.scheduler` (background jobs) and `ctx.storage`
  (Blob file hosting).

## Decisions (locked with operator)

1. **Behavior when a script exceeds one clip:** produce **one stitched video** from N
   engine-sized clips (not separate posts, not trimmed).
2. **Surfaces:** corrected estimate + multi-clip alert appear in **both** the generated
   story-beats preview **and** the engine-selection area, dynamic to engine.
3. **Seedance stitch mechanism:** **in-app ffmpeg** concatenation (no external service /
   cost). Frame-chain via `seedance-2` `return_last_frame`, then merge with ffmpeg.wasm.
4. **Long videos run as a background job** (Convex scheduler action, not the 300s HTTP
   request), so 60s reliably completes.
5. **Target ceiling:** 60 seconds.

## Architecture

### 1. Background job (async create_video)

Leverage the existing reactive `agentTasks` record — the UI (`TaskCardRunnable` in
`components/builder/AgentWorkspace.tsx`) already watches it live.

- `run-task` for `create_video`: wallet preflight → `agentTasks.create` (`pending`) →
  `ctx.scheduler.runAfter(0, internal.videoJobs.run, { taskId, ... })` → return
  immediately `{ ok: true, taskId, async: true }`. No more synchronous `await
  generateVideoFromScript` in the HTTP route.
- New `convex/videoJobs.ts` — **`"use node"` internal action** (10-min budget). Runs:
  script (if needed) → storyboard → clip generation → stitch → `agentTasks.succeed`
  with output (video URL), or `agentTasks.fail` with a partial-cost debit on error.
- The action **reuses** `lib/server/kie-video-pipeline.ts` (Convex's bundler follows the
  import). Only the file's host changes; the Kie `fetch` logic is portable.
- Other task types keep their current synchronous path — only `create_video` goes async.

### 2. Engine-aware estimation (`lib/builder/agentTypes.ts`)

Single source of truth, shared by server + UI (removes duplication currently in the
pipeline file):

- `export const SPEAKING_WORDS_PER_SEC = 2.5;`
- `estimateSecondsFromScript(text: string): number` — `ceil(words / 2.5)`, min ~5s,
  **cap 60s**.
- `maxClipForModel(kieModel: string): number` — resolves Veo → 8, Seedance → 15 from the
  model slug (so the server doesn't hardcode 8).
- Reuse existing `clipsForLength(engine, seconds)` and `videoCostForLength` unchanged.

In `planStoryWithClaude` / beat post-processing, recompute each beat's `seconds` from its
own voiceover word count (floor ~2s for silent/action beats) so the displayed estimate is
realistic and `sum(beat.seconds) ≈ durationSeconds`.

### 3. Veo path

Already stitches via native extend. Changes:
- Derive `maxClip = maxClipForModel(videoModel)` instead of literal `8`;
  `totalSegments = ceil(durationSeconds / maxClip)`; round duration up to a multiple of
  `maxClip`.
- Runs inside the 10-min action, so up to 8×8s ≈ 64s (cap 60s) completes rather than
  truncating at the 280s HTTP budget.

### 4. Seedance path (new multi-clip stitch)

- Switch engine slug `bytedance/seedance-2-fast` → **`bytedance/seedance-2`** (frame
  params). Raise the duration clamp 12 → 15.
- **Frame chain:** generate clip 1 (≤15s) with `return_last_frame: true`; use the
  returned frame URL as `first_frame_url` for clip 2; repeat to reach the target
  (60s = 4×15s). Each clip's prompt is the per-segment prompt (reuse
  `splitBeatsIntoSegments` / `buildSegmentPrompt`).
- **Concat:** download the N clips, merge with **ffmpeg.wasm concat demuxer using
  `-c copy`** (stream copy, no re-encode — required to fit 512MB), upload the merged mp4
  to **Convex storage**, return `ctx.storage.getUrl(storageId)`.
- **Single clip (≤15s):** skip ffmpeg entirely — return the Kie URL directly.

### 5. Data model

`agentTasks` (additive, optional fields — confirm exact names in plan):
- `videoStorageId?: v.id("_storage")` — the merged mp4 in Convex storage (Seedance multi-clip).
- Optionally a coarse `progress?` string (e.g. `"storyboard"`, `"clip 2/4"`, `"stitching"`)
  for the running-state UI. The reactive record already carries `status`,
  `startedAt`, `completedAt`, `output`.

### 6. UI (`components/builder/AgentWorkspace.tsx`)

- **Story-beats preview** (~L1677): header becomes
  `Story · N beats · ~Xs · M clip(s) on {engine}` using `parsed.durationSeconds` +
  `clipsForLength`. When `M > 1`, an inline amber alert:
  `~Xs needs M clips on {engine} (max {maxClip}s/clip)` and, for Veo, a hint that
  Seedance fits 15s/clip (and vice-versa).
- **Engine picker** (`VideoEnginePicker`, ~L2146): a dynamic per-engine line — Veo
  "stitches 8s clips, up to 60s"; Seedance "stitches 15s clips, up to 60s" — updates live
  on selection.
- **Async running state:** the card shows "generating… (~N min)" driven by the reactive
  `agentTasks` record (already wired); add a small note that long videos take minutes.

## Data flow (60s Seedance example)

```
UI Generate → POST /api/agents/run-task (create_video)
  → wallet preflight (upper-bound cost = storyboard + videoCostForLength(engine, est))
  → agentTasks.create(pending) → scheduler.runAfter(0, videoJobs.run) → 200 {taskId, async}
videoJobs.run (Convex node action, ≤10 min):
  → script (Claude) → estimate 60s → 4 segments (15s each)
  → storyboard image (nano-banana-pro)
  → clip1 (return_last_frame) → clip2(first_frame=frame1) → clip3 → clip4
  → download 4 mp4s → ffmpeg.wasm concat -c copy → merged.mp4
  → ctx.storage.store(blob) → getUrl → agentTasks.succeed(output={videoUrl,...})
UI (reactive) → matchingTask.status flips to succeeded → renders <video>
```

## Error handling

- Storyboard failure → fail task (existing behavior preserved).
- Veo extend chain partial → return longest stitched URL (existing).
- Seedance frame-chain: if a later clip fails, concat the clips completed so far and
  **surface a note** that the video is shorter than requested — never silently claim 60s.
- ffmpeg `-c copy` rejects mismatched codecs → fall back to returning the longest single
  successfully-chained clip + error note (do not re-encode; that breaks the 512MB budget).
- Wallet debit on failure keeps the existing partial-cost logic.

## Testing

- `lib/builder/agentTypes.ts`: unit-test `estimateSecondsFromScript` (word→seconds, 60s
  cap, empty) and `maxClipForModel` (veo3/veo3_fast/veo3_lite → 8, seedance slugs → 15).
- `clipsForLength` already covered by behavior; add cases for the 15s engine.
- Convex action: integration test the task lifecycle (create → scheduled → succeed/fail)
  with `convex-test`, mocking Kie fetch + ffmpeg.
- Manual verification: generate a ~16s Veo (2 clips) and a ~30s Seedance (2 clips) end to
  end; confirm one stitched file plays and the preview shows correct `~Xs · M clips`.

## Out of scope

- Re-encoding / transitions between Seedance clips (stream-copy concat only).
- Pricing math changes (`videoCostForLength` already bills per clip correctly).
- The external-merge-service path (Shotstack/Cloudinary/Mux) — kept as the documented
  fallback if ffmpeg.wasm proves unstable at 512MB in practice.
- Engines other than Veo / Seedance.

## Implementation note (deviation from design)

During build, `@ffmpeg/ffmpeg` v0.12+ turned out to be **browser-only** (Node support
was dropped), so "ffmpeg.wasm in the Convex action" is not viable. Revised to fit this
codebase's existing pattern (Convex actions already call back into the Next app over HTTP
— see `convex/crons.ts` heartbeat → run-task):

- **ffmpeg runs in a Next.js Node route** `app/api/video/concat/route.ts` via
  `ffmpeg-static` + `child_process` (`-f concat -c copy`), where binaries reliably run.
- **The Convex action** `convex/videoJobs.ts` runs in the **default runtime** (the
  pipeline uses only `fetch`/timers — no Node built-ins), generates the frame-chained
  clips, calls the concat route via `stitchClips`, and stores the returned mp4 with
  `ctx.storage`. No ffmpeg or Node bundling in Convex — sidesteps the 512MB/binary risk.
- **No schema change**: the video URL goes in `agentTasks.output`; the reactive `status`
  field drives the UI running state.
- **Deploy requirement**: the Convex action needs `KIE_API_KEY` and `NEXT_PUBLIC_APP_URL`
  set in the **Convex** environment (not just Next `.env`), since the storyboard/clip Kie
  calls now run inside Convex.

## Key risks

1. **ffmpeg.wasm in Convex 512MB** — mitigated by strict `-c copy` remux, single-threaded
   bundled core, temp-file MEMFS. Fallback: external merge service.
2. **Convex bundling of ffmpeg.wasm core** — bundle the core locally (not CDN fetch) so
   the Node action has no network dependency mid-run; watch Convex code-size limits.
3. **Frame-chain continuity** — `return_last_frame` → `first_frame_url` should keep the
   character locked; reference images still passed for identity.
