# Video pipeline: reference-to-video + script/face fidelity

Date: 2026-06-04
Status: approved

## Problem

Videos generated from the copilot and task cards do not feature the agent's
character, persona, or the generated script:

1. **Spoken lines drift from the script.** `planStoryWithClaude` asks the LLM to
   slice the script into beat voiceovers but never enforces it; Haiku paraphrases
   or the Gemini fallback invents lines, so the first clip speaks the wrong words.
2. **Character is dropped.** On Veo's "prominent person" content-policy block, the
   previous fallback switched to `TEXT_2_VIDEO` (no reference) → an unrelated person.
3. **Storyboard face doesn't match** the uploaded reference (weak Haiku prompt,
   weak identity lock).
4. **Reference mode is gated on `model === "veo3_fast"`**, so other engines silently
   used a weaker 1-image / text mode.

## Fixes

**A. Storyboard matches the uploaded face**
- Generate the storyboard prompt with **Claude Sonnet** (`claude-sonnet-4-5`) — add
  an optional `model` param to `callClaudeText` / `callClaudeJSON`.
- Feed the planner the character bible + "the attached photos are ONE specific real
  person; reproduce that exact face in every panel."
- Harden the image-prompt identity lock; pass the person reference first.

**B. Always reference-to-video, never text2video**
- Force `veo3_fast` for the reference render whenever reference images exist (the
  model that supports `REFERENCE_2_VIDEO`).
- The storyboard image is always in the reference set, so the image list is never
  empty → `TEXT_2_VIDEO` can never be selected.
- On a prominent-person block: drop ONLY the raw avatar photo (index 0) and keep
  reference-to-video with the AI storyboard + product images. Remove the
  drop-to-text2video path.

**C. Character context** — falls out of A + B.

**D. Beats speak the EXACT script (core "wrong prompt" fix)**
- After the LLM returns beats (used for scene/camera/visuals + the storyboard image
  prompt), **deterministically overwrite every beat's `voiceover`** by splitting the
  provided `scriptText` into contiguous, word-balanced groups in order. The LLM
  never gets to reword spoken lines. Recompute per-beat seconds from the new line.

## Scope
`lib/server/kie-video-pipeline.ts` and `lib/server/kie-claude.ts`. The copilot and
task-card paths both call `create_video` → this pipeline, so both are fixed.
