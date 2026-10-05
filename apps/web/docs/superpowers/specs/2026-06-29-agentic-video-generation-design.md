# Agentic, time-accurate, unique AI-influencer video generation

_Date: 2026-06-29 · Status: approved_

## Problem

Two defects in the AI-influencer video pipeline:

1. **Videos look cropped / scripts unfinished.** Already root-caused and partially
   fixed (the packer no longer overstuffs an 8s clip; scripts are trimmed to
   budget). But the **duration itself** is hardcoded (`targetSeconds: 24` in the
   campaign path) and ignores any per-agent setting, and there is no validation
   that the produced script actually fits the chosen time.
2. **Every video plays the same style.** A memory-aware creative director
   (`planCreativeBrief`) exists but the autonomous/campaign path bypasses it and
   uses a static `CLASS_FORMAT` map, and the chosen `visualTreatment` is not
   propagated into the per-clip prompts — so output is a generic talking-head.

## Goal

Each video is **complete** (script ⇄ time tally by construction), **on the
agent's chosen length** (a per-agent range the agent picks within), and
**unique** (format/angle/visual treatment vary per video from the agent's
memory + settings), while identity (face/voice/persona/language) stays locked.

## Decisions (from brainstorming)

- Duration: **per-agent min–max range; the agent picks a length within it per video.**
- Fit algorithm: **validate → 1 corrective regen → safety-trim** (hard guarantee).
- Variation: **vary format + angle + visual treatment; lock identity.** Memory-driven.
- Config: **stored field + smart default; wire BOTH paths.** Builder UI is a follow-up.

## Architecture (Approach A)

```
agent config (durationRange) + brain (memory/knowledge/skills) + recentFormats
      │
      ▼
planVideoCreative()  ──►  { brief: {format, angle, topic, structureNotes, visualTreatment},
      │                      targetSeconds (∈ range) }
      ▼
generateFittedScript(targetSeconds, brief)   // validate → 1 regen → enforceScriptBudget
      │
      ▼ scriptText (tallies with targetSeconds)
kie-video-pipeline  // storyboard + clips, visualTreatment threaded into every clip prompt
      │
      ▼ packBeatsIntoWindows (≤ clipSeconds each — already fixed)
   stitched, complete, on-time, unique video
```

### Components

1. **Duration config** — `videoMinSeconds?` / `videoMaxSeconds?` on the
   `influencers` table + draft questionnaire. Constants
   `DEFAULT_VIDEO_MIN = 15`, `DEFAULT_VIDEO_MAX = 45` in `agentTypes.ts`; helper
   `resolveDurationRange(min?, max?)` clamps into `[MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS]`
   and guarantees `min ≤ max`.

2. **`pickTargetSeconds(format, range, nonce)`** (`agentTypes.ts`) — deterministic
   heuristic mapping format → length bucket (`hot_take`/`reaction` short,
   `tutorial`/`storytelling`/`day_in_life` long, others mid) with nonce jitter,
   clamped to the range. Used as the fallback and to bound the LLM's suggestion.

3. **`planVideoCreative()`** (`creativeDirector.ts`) — wraps `planCreativeBrief`
   (now also returns a `suggestedSeconds`), clamps the suggestion to the range via
   `pickTargetSeconds` as fallback, returns `{ brief, targetSeconds }`.

4. **`generateFittedScript()`** (`videoScript.ts`) — calls `generateVideoScript`;
   measures `estimateSecondsFromScript`; if `|actual − target| / target > 0.15`,
   regenerates once with an explicit length refinement; final `enforceScriptBudget`
   to the target ceiling. Returns the fitted `VideoScript` plus the measured seconds.

5. **`visualTreatment` propagation** — added to `buildSegmentPrompt` (every clip
   honours setting/camera/lighting/energy from the brief). Campaign path now passes
   the director's real brief instead of the static map.

6. **Wiring** — `generate-content/route.ts` and `run-task/route.ts` call
   `planVideoCreative` + `generateFittedScript`; the builder/manual path keeps the
   operator's explicit `seconds` as the target but still runs the fit validator.
   The chosen `format` is persisted to the video task/memory so `recentFormats`
   drives away from repetition next time.

## Error handling

- `planCreativeBrief` → `fallbackBrief` (existing). `planVideoCreative` →
  `pickTargetSeconds` fallback for length.
- `generateFittedScript` → if regen fails or model down, trim-only still guarantees fit.
- Duration always clamped to `range ∩ [MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS]`.
- Empty brain → director still works off niche/pillars.

## Testing

- `resolveDurationRange` / `pickTargetSeconds`: clamp to range, `min ≤ max`,
  format buckets, nonce produces variety within range.
- `generateFittedScript` (model mocked): overshoot and undershoot both land within
  tolerance and never exceed the ceiling; single-regen path exercised.
- `buildSegmentPrompt`: output contains the `visualTreatment`.
- `planVideoCreative`: `targetSeconds ∈ range`; format ≠ last format.
- Existing `videoSegmentation` / `videoScript` tests stay green.

## Out of scope (follow-up)

- Builder UI slider for the duration range.
- Performance-aware director (leaning toward formats that historically performed).
