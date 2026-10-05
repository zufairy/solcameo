# Clipping Agent — Design Spec

**Date:** 2026-06-02
**App:** `apps/vello` (Next.js + Convex + Solana)
**Status:** Approved design — ready for implementation plan

## Goal

Add a new **Clipping agent** type alongside the existing UGC (influencer) agent. A
clipping agent ingests a long-form source video, agentically finds the best
moments, cuts them into vertical short-form clips (reframed to 9:16, decorated per
a skill-driven edit plan), and posts them — auto-posting the top N while leaving
every clip in a review queue. Clipping closes the same earn-per-views loop as UGC:
clips submit to vello-native campaigns and jobtepi-web `Clipping` content rewards.

**A clip is *just a clip*.** The output is always a real segment of the source
footage, reframed and decorated with overlays — it NEVER uses the UGC
storyboard→Veo/Seedance *synthesis* path. No AI-generated faces or scenes. The two
pipelines are fully separate (distinct agent type, distinct job table, distinct
executor). Editing is **skill-driven**: the agent's user-authored skills + prompts
compose an open-ended, ordered list of ffmpeg edit operations per clip.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Source input | Brand campaign assets + pasted **direct** video URLs |
| v1 download scope | Direct file URLs (MP4/MOV) + brand assets via fetch; YouTube/TikTok behind a pluggable `Downloader` interface (stub now, v2 plug-in) |
| Clip engine | **Self-built**: download → transcribe → Claude picks moments → **skill-driven edit plan** → ffmpeg cut/reframe/decorate → post → submit |
| Clip output | **Just clips** — real cut segments of the source, never AI-synthesised video. Separate from the UGC Veo/Seedance path |
| Editing | **Skill-driven Edit Plan**: the agent's user-authored skills + prompts compose an ordered, extensible `EditOp[]` per clip (subtitles, text overlays, title/hook card, logo/watermark, emphasis). New op types plug in without changing the pipeline |
| Agent model | **Distinct `clipping` agentType** with a streamlined no-face wizard; still mints for a wallet + identity so it earns like other agents |
| Post flow | **Auto-post top N**, every clip also in a review queue (preview / edit caption / re-clip / delete / post-now) |
| Orchestration | **Convex background job** mirroring the existing UGC `videoJobs` pattern |

## Non-goals (v1)

- Downloading arbitrary YouTube/TikTok/X URLs (needs a yt-dlp-style service — deferred behind the `Downloader` interface).
- Chunking sources longer than one 10-minute Convex action can process (resume pass is a v2 extension; v1 returns what it cut).
- Re-using the dormant Supabase `ai_clipper_*` tables for live state (Convex drives the reactive UI instead).

---

## Architecture

A `clip_source` entry in the existing `agentTasks` table (so it shows in the
**Tasks** panel like `create_video`) enqueues a `clipJobs` row. A Convex action
`clipJobs.process` (10-min budget) orchestrates the pipeline, calling thin Next
routes for the IO/ffmpeg-bound steps (Convex has no filesystem), and advancing
status as it goes. Reactive `clipJobs` + `clips` queries drive a live Clips queue
in the builder — exactly how `videoJobs` + `agentTasks` drive the UGC UI today.

```
clip_source task ─► enqueue clipJobs row ─► clipJobs.process (Convex, 10-min)
  1. DOWNLOAD    /api/video/download       → stable URL + duration  (status: downloading)
  2. TRANSCRIBE  /api/video/transcribe-clip → segments + word times (transcribing)
                 (ffmpeg extract audio → OpenAI Whisper verbose_json)
  3. SELECT      clipMomentSelector (Claude via kie-claude)        (analyzing)
                 transcript + clipConfig → N moments
                 {start,end,title,reason,viralScore,captionText}
                 → insert `clips` rows (status: rendering)
  3b. EDIT PLAN  clipEditPlanner (Claude + user SKILLS)            (analyzing)
                 skills + clipConfig + transcript window → EditOp[]
                 [reframe, subtitles, text_overlay, title_card,
                  logo_overlay, emphasis...] per clip
  4. CUT         /api/video/clip  (per moment, ffmpeg)             (clipping)
                 cut[start,end] → apply EditOp[] in order
                 (crop/pad 9:16 → burn subs → overlays → cards → logo)
                 → clipUrl, clip status: ready
  5. POST        post_content / uploadVideo (top N, staggered)     (posting)
                 → postUrl, clip status: posted
  6. SUBMIT      submissions.setPostLink + content-reward helper    (completed)
```

### Reused infrastructure (already shipped)

- ffmpeg: `app/api/video/concat/route.ts` — `ffmpeg-static` + `spawn` pattern reused by the new download/transcribe/clip routes
- Transcription: a NEW `app/api/video/transcribe-clip/route.ts` (the existing `transcribe-video` route only fetches YouTube caption text / Gemini inference — no word timings, which clipping requires). Uses OpenAI Whisper `whisper-1` (`verbose_json`, word timestamps) on ffmpeg-extracted audio; `OPENAI_API_KEY` is already configured.
- LLM: `lib/server/kie-claude.ts` (`callClaudeJSON`)
- Posting: `post_content` executor + `lib/server/uploadPost.ts` `uploadVideo`
- Earning: `lib/server/contentRewardSubmit.ts` + `/api/content-rewards/submit`; `convex/submissions.ts` `setPostLink`
- Job pattern: `convex/videoJobs.ts` (credentials forwarded; ffmpeg done in Next routes)

---

## Components

Each unit has one purpose and a clear interface.

### Agent type & builder

- **`lib/builder/agentTypes.ts`** — add `"clipping"` to `AgentType`; add a `ClippingPhase`
  (`clip_setup → clip_style → platforms → clip_mint → clip_ready`); add a concise
  `CLIPPING_SYSTEM_PROMPT` ("clip producer" persona) that guides setup and can emit
  `clip_source` / `join_clip_campaign` actions.
- **`app/studio/build/page.tsx`** — add the `[✂ Clipping]` tab.
- **Wizard** (builder chat + cards): Brand & niche + caption voice → clip style
  (length range, `maxClipsPerSource` default 3, hook style, captions on/off + style)
  → target platforms → mint (wallet + identity; portrait = one generated logo tile,
  not a character-ref face set).
- **`convex/influencers` / mint** — persist `agentType: "clipping"` and a `clipConfig`
  blob: `{ clipLength: {min,max}, maxClipsPerSource, captionsOn, captionStyle,
  hookStyle, platforms, autoPost, brandLogoUrl? }`. The fine-grained, open-ended
  editing behaviour lives in the agent's **skills** (markdown), not in fixed config —
  `clipConfig` holds only the coarse defaults; skills drive the per-clip `EditOp[]`.

### Data model (Convex)

**`clipJobs`** (one per source):
```
mintAddress, sessionId?, sourceUrl, sourceType: "url" | "campaign_asset",
campaignId?, contentRewardId?,
status: queued | downloading | transcribing | analyzing | clipping | posting | completed | error,
durationSeconds?, transcript?, error?, createdAt, updatedAt
```
Indexes: `by_mint`, `by_status`.

**`clips`** (children of a job):
```
jobId, mintAddress, title, reason, startSeconds, endSeconds, viralScore (0-100),
clipUrl?, captionText,
status: rendering | ready | posting | posted | skipped | failed,
postUrl?, platform?, submissionId?, createdAt, updatedAt
```
Indexes: `by_job`, `by_mint`.

### Pipeline units

- **`lib/server/downloader.ts`** — `interface Downloader { fetchSource(url): Promise<{url, durationSeconds, mime}> }`; `directFetch` impl accepts `mp4/mov/webm` (and brand-asset URLs); a `socialDownloader` stub throws `"not supported in v1"`. A `resolveDownloader(url)` picks the impl.
- **`lib/server/clipMomentSelector.ts`** — *pure*: `(transcript, clipConfig) => Moment[]` via `callClaudeJSON`; respects length range, max N, hook style; **degrade path** returns evenly-spaced clips if the LLM fails twice.
- **`lib/server/clipEditPlanner.ts`** — *pure*: `(skills, clipConfig, transcriptWindow, moment) => EditOp[]`. Asks Claude (`callClaudeJSON`) to compose the ordered edit plan for one clip, **grounded in the agent's user-authored skills** (same skills the UGC pipeline already loads via `ctx.skills`, custom-first). Validates ops against the allowed schema; drops unknown ops; **always prepends `reframe`**. Degrade path = `[reframe]` + `subtitles` when `captionsOn`.
- **`lib/server/clipEditOps.ts`** — the `EditOp` schema (discriminated union) + a `validateEditPlan(ops)` guard. The single source of truth for what edits exist; extending it = adding a case here + an ffmpeg handler.
- **`lib/server/captionRenderer.ts`** — *pure*: `(transcriptWindow, style) => SubtitleSpec` (ASS/SRT) used by the `subtitles` op.
- **`app/api/video/download/route.ts`** — calls the resolved `Downloader`, stores to Convex storage, returns `{url, durationSeconds}`.
- **`app/api/video/transcribe-clip/route.ts`** — ffmpeg extracts mono 16kHz audio from the stored source → OpenAI Whisper `whisper-1` (`verbose_json`, `timestamp_granularities: ["segment","word"]`) → returns `{segments:[{start,end,text}], words:[{word,start,end}]}`. (`OPENAI_API_KEY` already configured.)
- **`app/api/video/clip/route.ts`** — ffmpeg: cut `[start,end]`, then **apply the `EditOp[]` in order** (a small handler per op type → ffmpeg filtergraph) → store → return `clipUrl`. An unknown/failed single op is skipped, not fatal.
- **`convex/clipJobs.ts`** — `enqueue` mutation + `process` action (mirrors `videoJobs.ts`; forwards Kie key + appUrl; ffmpeg/transcribe/download done via Next routes).

### Skill-driven Edit Plan

The edit plan is how customization stays **open-ended but practical**: a finite,
extensible set of operations whose *content and placement* are chosen freely by the
agent from the operator's skills/prompts. New capabilities = new `EditOp` cases.

```ts
type EditOp =
  | { op: "reframe"; mode: "crop" | "pad"; }                       // always first → 9:16
  | { op: "subtitles"; style: CaptionStyle; }                      // burn transcript captions
  | { op: "text_overlay"; text: string; position: Anchor;         // e.g. hook caption "in front"
      startSec: number; endSec: number; style: TextStyle; }
  | { op: "title_card"; text: string; durationSec: number;        // intro card before the clip
      style: TextStyle; }
  | { op: "logo_overlay"; imageUrl: string; corner: Corner;        // brand logo / @handle watermark
      opacity: number; }
  | { op: "emphasis"; kind: "zoom_punch" | "speed" | "freeze";    // beat emphasis at a timestamp
      atSec: number; amount?: number; };
```

`clipEditPlanner` returns an ordered `EditOp[]`; `/api/video/clip` maps each op to an
ffmpeg step (`crop/scale/pad`, `subtitles`/`ass`, `drawtext`, a pre-pended title
segment, `overlay`, `zoompan`/`setpts`). The op list is validated before render, so
a hallucinated op never reaches ffmpeg. Example a skill could produce:
`[reframe, subtitles(karaoke,yellow), text_overlay("POV: you just…",top,0,2s), logo_overlay(@handle,br)]`.

### UI

- **Clips queue** (builder right panel, beside UGC Generations): reactive `clips`
  query; each card = preview player + title + `viralScore` + status chip, with
  **▶ preview · ✎ caption · ↻ re-clip · ✕ delete/skip · post-now**.
- **Triggers**: `clip_source` action (paste direct URL) and `join_clip_campaign`
  action (read a jobtepi-web `type='Clipping'` campaign asset). Optional heartbeat
  scan auto-starts eligible clipping-campaign jobs.

---

## Data flow: posting & earning

When a job finishes cutting, the top `maxClipsPerSource` clips (ranked by
`viralScore`) are queued to **auto-post on a staggered schedule** (reusing the
heartbeat/scheduler so a source's clips don't all drop at once). Each clip is
posted via the existing `post_content` / `uploadVideo` path with its
`captionText`. On a successful post:

- **Vello-native campaign** → `submissions.setPostLink({submissionId, postUrl, platform})`.
- **jobtepi-web Clipping content reward** → `submitContentRewardLink` (resolves owner
  wallet → jobtepi user via `wallet_auth_bindings`, writes `content_rewards_submissions`).

Clips beyond N stay `ready` (unposted) unless promoted. `autoPost: false` makes the
whole flow a pure review-gate (nothing posts until the operator taps post-now).

---

## Error handling

Fault-isolated per step, mirroring `videoJobs`:

- **Download** fails / non-video / oversized → `clipJobs.status = error` + plain message; `clip_source` task failed; no clip cost. Pasted YouTube/TikTok URL is rejected up front with: *"Paste a direct video link or use a brand campaign asset — social-URL import is coming soon."*
- **Transcribe** fails → retry once, then error (can't pick good moments blind).
- **Moment selection** fails → retry once, then **degrade** to evenly-spaced clips of the configured length (job still yields usable clips).
- **ffmpeg cut** fails for one clip → that clip `failed`; the rest continue.
- **Posting** fails → clip stays `ready`; operator can "post now"; submission stays pending (reuses the existing "paste the link" fallback).
- **Action time budget** — if the 10-min action runs low, return the clips already cut; leave the rest `rendering` for a v2 resume pass. Dedup by `sourceUrl + mint` so re-runs don't double-clip.

---

## Testing

vitest, matching existing `lib/server/*.test.ts` style — pure modules, no network:

- **`clipMomentSelector`** — fixture transcript → moments respect length range, max N, hook style; degrade path yields evenly-spaced clips.
- **`clipEditOps` / `validateEditPlan`** — accepts well-formed ops, rejects/drops unknown ops, always keeps `reframe` first.
- **`clipEditPlanner`** — given a fixture skill ("burn yellow karaoke subs + hook caption first 2s"), the planned `EditOp[]` contains the matching `subtitles` + `text_overlay`; degrade path returns `[reframe(, subtitles)]`.
- **`captionRenderer`** — transcript window → correct ASS/SRT timing + style.
- **`downloader`** — accepts direct MP4/MOV; rejects YouTube/TikTok in v1.
- **`clipConfig`** validation — bounds on length/N, platform whitelist.

ffmpeg routes (`/api/video/download`, `/api/video/clip`) and `convex/clipJobs.ts`
are smoke/manually validated with a green build — exactly as the `concat` route +
`videoJobs` are today.

---

## File manifest (new / changed)

**New**
- `convex/clipJobs.ts`
- `lib/server/downloader.ts`
- `lib/server/clipMomentSelector.ts`
- `lib/server/clipEditOps.ts` — `EditOp` schema + `validateEditPlan`
- `lib/server/clipEditPlanner.ts` — skills → `EditOp[]`
- `lib/server/captionRenderer.ts`
- `app/api/video/download/route.ts`
- `app/api/video/transcribe-clip/route.ts` — ffmpeg audio + OpenAI Whisper word timings
- `app/api/video/clip/route.ts` — cut + apply `EditOp[]`
- `components/builder/ClipsQueue.tsx`
- tests: `lib/server/clipMomentSelector.test.ts`, `lib/server/clipEditOps.test.ts`, `lib/server/clipEditPlanner.test.ts`, `lib/server/captionRenderer.test.ts`, `lib/server/downloader.test.ts`

**Changed**
- `convex/schema.ts` — add `clipJobs` + `clips` tables; add `clipConfig` to `influencers`
- `lib/builder/agentTypes.ts` — add `clipping` type, phases, system prompt
- `app/studio/build/page.tsx` — add Clipping tab
- `app/builder/page.tsx` — clipping wizard cards + `clip_source` / `join_clip_campaign` actions + Clips queue mount
- `app/api/agents/run-task/route.ts` — `clip_source` task executor → enqueue clipJob, passing `ctx.skills` (custom-first, same as the UGC `videoJobs` payload) so `clipEditPlanner` is grounded in the operator's authored skills
- `convex/nftAgents.ts` / mint route — persist `agentType: "clipping"` + `clipConfig`
