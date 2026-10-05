# Script-first video flow (Claude Haiku 4.5)

**Date:** 2026-06-01
**Status:** Approved by operator — implementing
**Area:** AI Influencer builder — video generation UX

## Problem (confirmed in code)

`create_video` today fires `/api/agents/run-task`, which immediately **defers** the render to
a Convex job and returns `{ async: true, output: { script } }`. The client only checks for
`videoUrl`/`storyboardImageUrl`, finds neither, and prints "✅ Task completed" — so **the
script is never shown**, there is **no confirm step** (the wallet is charged immediately), and
the finished video only ever appears in the Generations tab if the background job succeeds.

## New flow

```
"make a video about X"
  1. SCRIPT  → POST /api/agents/video-script  (Claude Haiku 4.5; no wallet, no task)
               → { topic, hook, script, caption, beats, estSeconds, clipCount, engine, durationSeconds }
  2. CARD    → chat renders a script card: hook + script + beats + "~Xs · N clips on {engine}"
               + length chips [15s/30s/60s] + [▶ Generate] [✎ Edit] [✕ Cancel].  Nothing spent.
  3. RENDER  → Generate → POST /api/agents/run-task (create_video) WITH the script + chosen
               durationSeconds in `input` → wallet precheck → enqueue Convex job → "rendering…"
  4. IN CHAT → client watches agentTasks.listByMint; on success a <video> bubble appears in chat
               (also in Generations). On fail → error bubble + retry hint.
```

## Decisions (locked with operator)

1. Confirm UX = **script card with buttons** (no auto-spend, no type-to-confirm guessing).
2. Length = **auto from script** (grounded in memory) **+ 15/30/60s override chips**, stitched up to 60s.
3. Model = **Claude Haiku 4.5** for scripts AND storyboard/video prompts (the verified
   `/claude/v1/messages` endpoint). Gemini stays as last-resort only.

## Units

1. **`lib/server/kie-claude.ts`** (new) — verified Claude Haiku 4.5 caller (`/claude/v1/messages`,
   Anthropic shape). `callClaudeText()` + `callClaudeJSON()`. Pure `fetch` (Convex-bundle safe).
2. **`lib/server/videoScript.ts`** (new) — `generateVideoScript(agent, ctx, {topic})` builds the
   in-voice script prompt (persona + knowledge + recent video memories for continuity) and parses
   `{hook, scriptText, caption, hashtags, raw}` via kie-claude. Shared by the route + run-task.
3. **`/api/agents/video-script/route.ts`** (new) — loads agent + ctx, calls `generateVideoScript`,
   computes `estSeconds`/`clipCount`/`engine` from `estimateSecondsFromScript` + `clipsForLength` +
   the influencer's `videoEngine`. No wallet debit, no task record.
4. **`create_video` executor** (`run-task`) — if `input.hook`+`input.scriptText` (or `input.script`)
   are present, **reuse** them and skip regeneration; accept `input.durationSeconds`. The fallback
   script path switches Gemini → `generateVideoScript` (Claude).
5. **`kie-video-pipeline.ts`** — `planStoryWithClaude` reasoning routes through kie-claude (Haiku)
   instead of the unverified `claude-sonnet-4-5/v1/chat/completions` path. Gemini last-resort kept.
6. **Builder client** (`app/builder/page.tsx`):
   - The `create_video` action now calls `/api/agents/video-script` and renders a **script card**
     message (`videoScriptCard` on the Message type) instead of firing the render.
   - Card: length chips (local state), [Generate] (→ run-task with script+duration, then watch),
     [Edit] (focus input prefilled), [Cancel] (dismiss).
   - A reactive watcher over `api.agentTasks.listByMint` pushes a `<video>` chat bubble when a
     watched create_video task succeeds (storyboard image as poster), or an error + retry on fail.

## Data flow / reliability

- No schema change — script rides in the card message + run-task `input`; the finished video URL
  rides in `agentTasks.output`; the reactive `status` drives the in-chat watcher.
- The render still runs in the Convex job, so it needs `KIE_API_KEY` + `NEXT_PUBLIC_APP_URL` in the
  **Convex** environment (not just Next `.env.local`). If absent, that alone = "video never renders".

## Error handling

- Script call fails → show a clear error in chat, offer retry; no card, no spend.
- Generate with insufficient wallet → existing 402 friendly message (unchanged).
- Render fails → watcher renders the task's error + a "try again" affordance.

## Testing

- Unit: estimate mapping already covered by `videoEstimation.test.ts`; add a script-parse test for
  `kie-claude` JSON extraction (fenced + raw).
- Manual: "make a video about X" → card with script + correct ~Xs·N-clips; tweak length chip;
  Generate → rendering → `<video>` appears in chat and Generations.

## Out of scope

- Stitching internals (already implemented), new engines, schema changes.
