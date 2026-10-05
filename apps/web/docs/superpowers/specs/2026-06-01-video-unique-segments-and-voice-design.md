# Video: Unique Time-Aligned Segments + Consistent Voice — Design

Date: 2026-06-01
App: `apps/vello`
Area: builder "generate video from task" → Kie/Veo pipeline

## Problem

When the builder generates a video from a task, longer videos (multi-clip)
**repeat the same content** across clips, and the **voice drifts** between
clips. Root causes, found in `lib/server/kie-video-pipeline.ts`:

1. `splitBeatsIntoSegments` splits beats by **count**, not spoken **time** —
   despite its comment claiming "accumulated seconds." Segments don't align to
   Veo's fixed 8s clips (8/16/24/32s).
2. When there are fewer beats than segments it **duplicates the last beat**
   (`segs.push([beats[last]])`), sending the identical scene + voiceover to
   multiple `/veo/extend` calls → literal repetition.
3. Every segment prompt embeds the **full monologue** plus "lip-sync exactly,"
   so on `/veo/extend` the model re-reads earlier lines.
4. Prompts lock the **visual** character but never describe the **voice**
   (pitch/accent/gender/pace), so Veo invents a new voice per clip → drift.
5. The script generator produces a **fixed 50–80 words** regardless of target
   duration, so a 32s (4-clip) video lacks enough distinct content → padding.

## Goal

For an N×8s video, produce **N clips each speaking a distinct, non-overlapping
~8s slice** of the script, in an **identical voice** across every clip. No
repetition. Duration is operator-selected in 8s-aligned steps.

## Decisions (confirmed)

- **Operator picks duration**, in Veo-aligned steps (8/16/24/32). The selected
  value drives the script length and the segment count.
- **Match segments to content**: never duplicate a beat. If the script only
  fills K windows, render K segments (K×8s) and report the real length.
- **Auto-derive a VoiceProfile** from existing persona data; no new UI field.

## Architecture

All changes are localized. Primary file: `lib/server/kie-video-pipeline.ts`.
Supporting edits: `lib/server/videoScript.ts`, `lib/builder/agentTypes.ts`,
`components/builder/AgentWorkspace.tsx`, and the create_video executor in
`app/api/agents/run-task/route.ts`.

### 1. Veo-aligned durations (`agentTypes.ts` + UI)

- `STANDARD_VIDEO_LENGTHS` → `[8, 16, 24, 32]` (multiples of Veo's 8s clip).
- `IDEAL_VIDEO_SECONDS` → `24` (must be one of the options; was `30`, now invalid).
  Audit other references to these constants (cost/runway economics in
  `AgentWorkspace`) — they recompute fine on the new values.
- The `AgentWorkspace` selector renders these; copy updated (drop the "30s is
  best" line, mention each step is one 8s clip).
- The operator-selected `videoSeconds` is passed as `durationSeconds` on the
  create_video task and reaches the pipeline (verify the existing plumbing at
  `AgentWorkspace.tsx:~1860` and `run-task/route.ts:341,360`). For Veo,
  `totalSegments = durationSeconds / 8` (exact, since options are multiples of 8),
  capped at `MAX_VIDEO_SECONDS / 8`.

### 2. Script targeted to duration (`videoScript.ts`)

- `generateVideoScript` accepts `opts.targetSeconds`.
- Word target = `round(targetSeconds × SPEAKING_WORDS_PER_SEC)` (e.g. 32s → ~80).
  The prompt asks for that many words **±15%**, structured as `N = targetSeconds/8`
  **distinct beats — one per 8-second window** — with the explicit rule: "each
  window advances the story; never restate or re-speak a previous line."
- Heuristic/gemini fallbacks also scale their length to `targetSeconds`.
- Backward compatible: when `targetSeconds` is absent, behaviour is unchanged.

### 3. Deterministic time-windowed segmentation (core fix)

New pure function in `kie-video-pipeline.ts` (replaces `splitBeatsIntoSegments`):

```
packBeatsIntoWindows(beats, clipSeconds = 8, maxWindows): StoryBeat[][]
```

- Walks beats in order, accumulating `beatSecondsFromVoiceover(beat)`.
- Closes the current window when adding the next beat would exceed
  `clipSeconds × 1.25` (slack so an ~8s line isn't split), or when the window
  has reached at least `clipSeconds × 0.6` and the next beat would overflow.
- Never exceeds `maxWindows`; remaining beats fold into the last window.
- **No padding / no duplication**: if beats fill fewer than the requested
  windows, returns fewer windows. The caller renders exactly that many clips.
- Pure and deterministic → unit-tested.

The pipeline computes `requestedWindows = totalSegments`, calls
`packBeatsIntoWindows(beats, 8, requestedWindows)`, and uses
`windows.length` as the actual clip count. If `windows.length < totalSegments`,
set `videoNote` ("rendered {windows.length*8}s — script content only filled
{windows.length} of {totalSegments} windows").

### 4. Per-segment prompt = only its window (`buildSegmentPrompt`)

- The spoken-audio block contains **only the current window's** voiceovers
  (concatenated), not the full script.
- Replace the "FULL MONOLOGUE" dump with a brief, non-spoken continuity cue for
  clips 2+: `PREVIOUSLY (already spoken — do NOT repeat): "…last ~5 words"` and
  an explicit instruction: "Continue the monologue FORWARD from here. Do not
  restate, paraphrase, or re-speak any earlier line."
- Keep the existing visual seamless-continuation anchor (pose/lighting/camera).
- Add the VoiceProfile block (below) verbatim.

### 5. Stable VoiceProfile (consistency fix)

New pure function `buildVoiceProfile(args): string` in `kie-video-pipeline.ts`,
derived from persona inputs already available on `GenerateVideoArgs`
(agentName, agentNiche, agentArchetype, characterBible, language, and — added —
optional `personality` + `gender`/`voiceArchetype` if present):

- Infers: perceived gender + age band, timbre, accent (from `language`), pacing
  (`~${SPEAKING_WORDS_PER_SEC*60} wpm`), and energy/warmth/authority (from
  personality/archetype). Sensible defaults when data is sparse.
- Returns one canonical paragraph, e.g.:
  `VOICE — IDENTICAL IN EVERY CLIP: warm mid-pitched female voice, mid-20s,
  light Malaysian-English accent, upbeat confident pacing ~150 wpm. The vocal
  identity, pitch, accent, timbre, and pace MUST be the same in every clip and
  at every extend boundary. Never change the voice.`
- Computed **once** per render and embedded **verbatim** in every segment prompt
  (and the single-clip prompt) under a dedicated `VOICE` heading. Identical
  string everywhere → Veo reproduces the same voice across generate + extends.

### 6. Storyboard planning alignment (`planStoryWithClaude`)

- Beat count is derived from segments: `beatCount = clamp(totalSegments × 2, 2, 14)`
  (≈2 beats per 8s window, ~10 words/beat).
- The director prompt is told there are exactly `totalSegments` windows and must
  produce beats that map cleanly onto them with **no repeated lines across
  windows**.
- `planStoryWithClaude` receives `totalSegments` (new arg).

## Data flow

operator picks 8/16/24/32 → create_video task carries `durationSeconds` →
pipeline: `totalSegments = dur/8` → `generateVideoScript({targetSeconds})`
returns a script sized to N windows → `planStoryWithClaude(totalSegments)` →
`packBeatsIntoWindows` → per-window prompt (own line + VoiceProfile + "don't
repeat" + visual continuity) → clip 1 generate, clips 2…N extend → stitched URL.

## Error handling

- Under-content: render `windows.length` clips, set an accurate `videoNote`;
  never duplicate.
- Sparse persona: `buildVoiceProfile` always returns a complete descriptor via
  defaults.
- Keep existing time-budget guards, extend-failure fallback (return longest
  finished video), and the jobs-API no-extend fallback.

## Testing

New `lib/server/kie-segmentation.test.ts` (vitest, edge runtime):
- `packBeatsIntoWindows`: exact 8s packing; under-content → fewer windows;
  over-content → capped at maxWindows; single beat → single window; **invariant:
  no StoryBeat object appears in two windows (no duplication)**; each window's
  summed seconds ≤ `8 × 1.25`.
- `buildVoiceProfile`: deterministic for the same input; includes language-driven
  accent; non-empty with empty persona.

Existing `lib/builder/videoEstimation.test.ts` stays; update any assertion that
depends on `STANDARD_VIDEO_LENGTHS` values.

## Out of scope

- Seedance frame-chain path keeps using the new `packBeatsIntoWindows` (its clip
  length differs, passed as `clipSeconds`), but no other Seedance changes.
- No change to the storyboard image generation, Kie polling, or URL extraction.
- No new persisted schema beyond optionally threading `personality`/voice fields
  already present on the agent into `GenerateVideoArgs`.
