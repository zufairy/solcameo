# Vercel-Safe Agentic Video Render Pipeline — Design

**Date:** 2026-06-03
**Status:** Approved (architecture), pending implementation plan
**Owner:** builder / vello-worker

## Problem

`create_video` tasks get stuck on "rendering in the background" and never produce
a video in Kie. Root cause is architectural, not a one-line bug:

1. **Wrong runtime for the work.** The heavy render (storyboard image → Veo/Seedance
   clips → polling → stitch) runs inside a single **Convex action**
   (`videoJobs.generate`) with a ~9-minute budget. Convex actions have a wall-clock
   cap; a long render can be **killed mid-way**, before reaching the line that marks
   the task succeeded/failed — so the task is left **stuck "running"/"rendering"
   forever** (the observed symptom).
2. **The stitch is unreachable.** Multi-clip videos (e.g. a 24s Veo video = 3×8s
   clips) are concatenated by calling back to `http://localhost:3000/api/video/concat`.
   The Convex deployment runs in the cloud and **cannot reach localhost**, so the
   stitch never happens.
3. `NEXT_PUBLIC_APP_URL` is unset, so cross-runtime callbacks default to localhost.

Net: even when Kie would succeed, the cross-runtime + time-limit design makes the
render unreliable.

## Decision

- **Render runtime:** the entire pipeline runs in the **Next.js runtime** (one
  runtime that can reach Kie *and* run ffmpeg concat in-process). The Convex render
  action is retired from the hot path.
- **Deploy target:** Vercel / serverless, **~300s function cap**. The render must
  therefore be **durable and chunked** — no single invocation may exceed 300s.

## Architecture

A self-driving chain of short Next route invocations. Each invocation performs
**exactly one bounded Kie step** (well under 300s), persists progress to Convex,
then **fire-and-forget re-invokes the route** for the next step and returns
immediately. Render state lives in Convex, so the chain is resumable: if an
invocation dies, the next one resumes from the persisted state and never repeats
completed work.

```
run-task (create_video)
  └─ generate script (sync, fast)
  └─ create videoRenderJob (phase=storyboard, kieModel from agent.videoEngine)
  └─ mark agentTask "running"
  └─ fire-and-forget POST /api/video/render-step { jobId }   ← returns immediately

/api/video/render-step  (maxDuration=300, runs ONE step then re-invokes itself)
  storyboard → 1 Kie image call → save storyboardImageUrl → phase=clips
  clips      → render ONE clip (Veo/Seedance, poll budget ~250s) → push clipUrls
               → more clips? stay : phase=stitching
  stitching  → ffmpeg concat IN-PROCESS (no localhost callback) → videoUrl
               → autoPost? phase=posting : phase=done
  posting    → post_content + submitForCampaign → phase=done
  done|failed→ mark agentTask succeeded/failed with final output
  (after a non-terminal step: fire-and-forget POST /api/video/render-step { jobId })
```

## Components

### 1. Convex: `videoRenderJobs` table

A **new** table (the existing `videoJobs` belongs to the retired Convex render
action and is not reused). Durable render state, one row per render:

| field | type | purpose |
|-------|------|---------|
| `taskId` | id("agentTasks") | the task this render fulfils; marked succeeded/failed at the end |
| `mintAddress` | string | agent identity |
| `kieModel` | string | the agent's **selected** video engine slug (veo3_fast / veo3 / seedance) |
| `phase` | string | `storyboard` \| `clips` \| `stitching` \| `posting` \| `done` \| `failed` |
| `script` | string (JSON) | hook + script + caption (from the sync script step) |
| `clipPlan` | array(object) | per-clip prompts/segments (computed once at **kickoff**, where the script is already available) |
| `clipUrls` | array(string) | completed clip URLs — resume point; never re-rendered |
| `clipIndex` | number | next clip to render |
| `storyboardImageUrl` | optional string | |
| `videoUrl` | optional string | final stitched video |
| `statusMessage` | string | human progress text for the viewing place |
| `attempts` | number | per-phase retry counter (caps runaway loops) |
| `autoPost` | optional object | platforms / campaignId / ownerWallet / caption (reuses existing submission flow) |
| `error` | optional string | |

Mutations: `createRenderJob`, `patchRenderJob` (phase/status/clip progress),
`getRenderJob`. Query is reactive so the card can read `statusMessage`/`phase`.

### 2. Next route: `/api/video/render-step` (`maxDuration = 300`)

- Auth: internal-secret gate (server-to-server self-invocation), same pattern as the
  autonomy loop's `INTERNAL_HEADERS`.
- Loads the job, dispatches on `phase`, performs one step, patches the job.
- On a non-terminal step, fire-and-forget re-invokes itself (`void fetch(...)`, no
  await) and returns `{ ok: true, phase }` immediately.
- On terminal (`done`/`failed`), marks the `agentTask` succeeded/failed with the
  assembled output and does NOT re-invoke.
- Idempotency: each step checks "already done?" before acting (e.g. storyboard
  already has a URL → skip to clips), so a duplicate invocation is safe.

### 3. `lib/server/kie-video-pipeline.ts` — expose step functions

Refactor the monolithic `generateVideoFromScript` into reusable steps the route
calls one at a time:

- `planClips(args) → clipPlan` (segment the script into engine-sized windows)
- `renderStoryboard(args) → storyboardImageUrl`
- `renderClip(args, clipPlan[i]) → clipUrl` (one Veo/Seedance call + bounded poll)
- `stitch(clipUrls) → videoUrl` (ffmpeg concat, in-process — moves the logic from
  `/api/video/concat` into a function the route calls directly; the concat route
  can remain as a thin wrapper for back-compat)

`generateVideoFromScript` may remain as a convenience wrapper (script-card "Generate
preview" path) but is no longer the durable hot path.

### 4. Kickoff in `run-task` `create_video`

Replace the `deferVideo → videoJobs.enqueue` (Convex action) path with:
1. Generate script synchronously (unchanged).
2. Compute the `clipPlan` from the script (via `planClips`), then `createRenderJob`
   with `kieModel` resolved from `agent.videoEngine`, the `clipPlan`, and `autoPost`
   (campaignId/platforms/ownerWallet/caption). The `storyboard` step therefore only
   renders the image; the plan already exists.
3. Mark the task running (run-task already does this).
4. Fire-and-forget `POST /api/video/render-step { jobId }`.
5. Return `{ ok: true, taskId, async: true }`.

### 5. Viewing place (card)

`TaskRunningFeed` reads the render job's reactive `statusMessage` (via the task
output or a small join) and shows real progress: "Generating storyboard…",
"Rendering clip 2/3…", "Stitching…", "Posting to TikTok…". On `done`, the existing
`TaskResultPreview` renders the storyboard + video. This fulfils the "see what's
happening" requirement with real state, not a fake spinner.

### 6. Agentic + skills + selected model (unchanged, wired through)

- The heartbeat **planner** already selects `create_video` based on installed skills
  (`vello.campaigns`, `social.uploadpost`) and attaches `autoPost`/`campaignId`.
- The render reads the agent's **selected `videoEngine` → `kieModel`** so it honors
  the operator's model choice for the Kie call.

## Error handling & reliability

- Each invocation < 300s → never killed mid-step on Vercel.
- State persisted → a dead invocation resumes from `clipUrls`/`phase`.
- `attempts` per phase: after N (e.g. 2) failures of the same phase, mark the job and
  task `failed` with the error instead of looping forever.
- `failStaleTasks` reaper remains the final backstop for any orphaned render.
- Partial success: if clips render but stitch fails after retries, fail with the
  storyboard image preserved in output (so the card still shows something).

## Out of scope (future)

- Token-level streaming of the model's reasoning / cross-agent chat into the viewing
  place (the larger "Paperclip" live feed) — separate spec.
- A dedicated `apps/vello-worker` queue/worker for production scale — the route-chain
  is the working solution now and can graduate to a worker later without changing the
  task/UI contract or the `videoRenderJobs` shape.

## Testing

- Unit: `planClips` segmentation; step idempotency (re-running a completed phase is a
  no-op); `attempts` cap fails cleanly.
- Integration (dev, real Kie): fire a 1-clip render (fast model) → storyboard + video
  + task succeeded. Fire a 3-clip render → 3 chained invocations, resume after a
  forced mid-chain failure, final stitched video.
- Manual: heartbeat with a campaign → create_video → render chain → auto-post →
  submission recorded; watch the card's viewing place show live phase text.
