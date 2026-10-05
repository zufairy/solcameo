# Duration-aware, unique video-script generation from the builder chat

**Date:** 2026-06-05
**Area:** `apps/vello` — influencer builder (`/builder?type=influencer`)
**Status:** Approved design, ready for implementation plan

## Problem

In the builder chat, asking "make a longer script" does not actually produce a
longer script. The script shown stays short and is not regenerated. Length is
also capped below the engine's real ceiling.

### Root causes (verified in code)

1. **Chat never regenerates for length.** A message like "make it longer" is
   routed to the campaign-focused chat AI (`app/api/ai/chat/route.ts`), which
   does not touch the video script. The existing `VideoScriptCard` keeps its
   original script, so nothing gets longer.
2. **No duration parsing.** Nothing maps "1 minute" / "30 seconds" / "longer"
   to `targetSeconds`. Initial generation defaults to 24s
   (`lib/server/videoScript.ts:131`).
3. **UI caps length at 32s.** The card length chips are `[8, 16, 24, 32]`
   (`lib/builder/agentTypes.ts` `STANDARD_VIDEO_LENGTHS`), although
   `MAX_VIDEO_SECONDS = 60` is already supported by the render pipeline.
4. **Weak uniqueness on regen.** The chat path passes no `nonce` and no
   user-specific wording, so re-asks produce near-identical text.
5. **Fixed token budget.** `callClaudeJSON({ maxTokens: 1200 })`
   (`videoScript.ts:205`) does not scale with length. Adequate for 60s today,
   but brittle; will be scaled defensively.

## Goals

- A user can drive script length from chat natural language: absolute
  ("1 minute", "30 seconds", "60s") and relative ("longer", "shorter",
  "way longer"). Range 5–60s.
- "Longer"/"shorter" steps one notch along `[8, 16, 24, 32, 48, 60]` from the
  current script's length ("way"/"much" jumps two notches).
- The regenerated script is genuinely longer/shorter (correct word count and
  distinct beats — not padded or truncated) and unique to the user's request.
- The full script renders (already true; no display truncation).

## Non-goals (YAGNI)

- No new chat-AI prompt schema changes (a deterministic parser is used instead).
- No change to the render/stitching pipeline.
- No per-word TTS timing; the 2.5 words/sec heuristic stays.

## Design

Three focused pieces plus a small UI touch.

### 1. Duration-intent parser (new pure helper)

`lib/builder/scriptDirective.ts`:

```ts
export const SCRIPT_LENGTH_STEPS = [8, 16, 24, 32, 48, 60] as const;

export interface ScriptDirective {
  isLengthEdit: boolean;   // true when the message is about changing the script length
  seconds: number;         // resolved target, clamped to [5, 60]
  refinement: string;      // remaining user text folded into the brief (may be "")
}

export function parseScriptDirective(text: string, currentSeconds: number): ScriptDirective;
```

Rules:
- **Absolute** matches first: `"1 minute"|"one minute"` → 60; `"half a minute"|"30 sec(onds)?"` → 30;
  `\b(\d{1,3})\s*(s|sec|secs|seconds)\b` → N; `\b(\d+(?:\.\d+)?)\s*(m|min|minute|minutes)\b` → N*60.
  Result clamped to `[MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS]` (5–60).
- **Relative** when no absolute value: contains "longer"/"more"/"extend" → step up; "shorter"/"less" → step down,
  along `SCRIPT_LENGTH_STEPS` starting from the step nearest `currentSeconds`. Modifiers
  "way"/"much"/"a lot" → 2 steps; "a bit"/"slightly" → still 1 step.
- `isLengthEdit` is true if any absolute OR relative length signal matched.
- `refinement` = the message with the matched length phrase removed, trimmed. Used so the
  new script also reflects extra asks (e.g. "make it funnier and a minute long").
- Pure, deterministic, no LLM call. Unit-tested.

### 2. Wire into the builder chat flow (`app/builder/page.tsx`)

In the chat submit handler, before routing a message to the campaign chat AI:
- If a `VideoScriptCard` already exists in the current thread, call
  `parseScriptDirective(message, lastCard.estSeconds)`.
- If `isLengthEdit`, **short-circuit**: regenerate that card via
  `POST /api/agents/video-script` with `{ mintAddress, topic, durationSeconds: seconds, refinement }`,
  show the existing "✍️ rewriting for {n}s…" indicator (reuse `handleVideoCardLength` logic),
  and update the card in place. Do not call the campaign chat AI for this turn.
- If not a length edit, behave exactly as today.

The most recent card in the thread is the target. (If none exists, the message
falls through to normal chat — "make it longer" with no script yet is a no-op
length-wise.)

### 3. Better generation algorithm (`lib/server/videoScript.ts` + `app/api/agents/video-script/route.ts`)

- Route accepts optional `refinement: string`; passes it through to
  `generateVideoScript(opts.refinement)`.
- `generateVideoScript`:
  - Fold `refinement` into the prompt as an explicit "OPERATOR REQUEST" line so
    content is unique to the ask.
  - Always generate a `nonce` when one isn't supplied, so regenerations differ.
  - `windowCount = ceil(targetSeconds / 8)` → up to 8 beats at 60s. Keep the
    "every window has NEW words, never repeat a line" rule (this is what makes a
    real longer script rather than padding).
  - Scale tokens: `maxTokens = Math.max(1200, windowCount * 350)`.
  - Keep the 5–60s clamp and the 2.5 words/sec mapping.

### 4. UI touch

`lib/builder/agentTypes.ts`: extend `STANDARD_VIDEO_LENGTHS` to
`[8, 16, 24, 32, 48, 60]`. The card chip labels show "1 min" for 60. Chips and
chat share the same regen path.

## Data flow

```
user types "make it a 1 minute version, funnier"
  → parseScriptDirective → { isLengthEdit:true, seconds:60, refinement:"funnier" }
  → POST /api/agents/video-script { topic, durationSeconds:60, refinement:"funnier" }
  → generateVideoScript: words≈150, windowCount=8 (8 beats), nonce, maxTokens≈2800
  → returns hook/script/caption/raw/estSeconds/clipCount
  → VideoScriptCard updates in place (full script via whitespace-pre-wrap)
```

## Error handling

- Regen failure: keep the existing card script (current behavior) and surface a
  brief inline note; length state still applies.
- Parser ambiguity: if no length signal, treat as a normal chat message (safe
  fallback — never hijacks unrelated messages).
- Clamp all durations to [5, 60]; never send out-of-range to the engine.

## Testing

- `parseScriptDirective` unit tests: "1 minute"→60, "30 seconds"→30, "60s"→60,
  "make it longer" from 24→32, "way longer" from 16→32, "shorter" from 24→16,
  "make it funnier and a minute long"→{60, refinement:"make it funnier and"},
  no-signal→isLengthEdit:false, clamping ("5 minutes"→60, "2s"→5).
- `videoScript` math unit tests: at 8/24/60s assert windowCount = 1/3/8 and
  maxTokens scales; refinement appears in the prompt; nonce always present.

## Affected files

- `lib/builder/scriptDirective.ts` (new) + test
- `lib/builder/agentTypes.ts` (length steps)
- `app/builder/page.tsx` (chat short-circuit on length edits)
- `lib/server/videoScript.ts` (refinement, nonce, beats, maxTokens) + test
- `app/api/agents/video-script/route.ts` (accept + forward `refinement`)
