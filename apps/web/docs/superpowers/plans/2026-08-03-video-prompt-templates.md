# Persona-Aware Video Prompt Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every builder video script use a persona-aware prompt template, and make the default visual direction feel human, slightly imperfect, and less over-polished unless the persona explicitly asks for a polished look.

**Architecture:** Add a small template layer inside the shared video-script generator so both the builder preview and the final render path get the same prompt structure. The template layer classifies each persona into a visual family, adds default anti-polish camera/style constraints, and lets the model expand that into a structured scene-by-scene script with clear beats, camera notes, and a strong opening hook.

**Tech Stack:** TypeScript, Next.js App Router, Kie Claude via `lib/server/kie-claude.ts`, Vitest.

## Global Constraints

- Keep the shared script path as the single source of truth for preview and render.
- Preserve the existing fallback chain so a script is always produced.
- Default visuals should be human, imperfect, and lightly handheld unless persona settings explicitly request polished output.
- Persona-specific templates must still honor the operator's requested tone, niche, and refinement.

---

### Task 1: Add persona template selection

**Files:**
- Modify: `apps/web/lib/server/videoScript.ts`
- Test: `apps/web/lib/server/videoScript.test.ts`

**Interfaces:**
- Consumes: `generateVideoScript(...)`, persona questionnaire fields, brief data, refinement text.
- Produces: a new template classifier and prompt-builder helpers that choose between realistic, cartoon, episodic, UGC, brand, and comic styles.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { classifyVideoTemplate } from "./videoScript";

describe("classifyVideoTemplate", () => {
  it("selects cartoon_episode for cartoonish or episodic personas", () => {
    expect(classifyVideoTemplate({
      voiceArchetype: "playful",
      description: "cartoonish, episodic creator with recurring characters",
      format: "talking_head",
    })).toBe("cartoon_episode");
  });

  it("selects realistic_cinematic when the persona asks for polished realism", () => {
    expect(classifyVideoTemplate({
      voiceArchetype: "expert",
      description: "cinematic, polished, realistic influencer",
      format: "cinematic",
    })).toBe("realistic_cinematic");
  });

  it("defaults to ugc_handheld for ordinary creator personas", () => {
    expect(classifyVideoTemplate({
      voiceArchetype: "expert",
      description: "daily creator for short-form video",
      format: "ugc",
    })).toBe("ugc_handheld");
  });
});
```

- [ ] **Step 2: Implement the classifier**

Create a small pure helper in `lib/server/videoScript.ts` that maps persona text and existing format hints to a template key.

- [ ] **Step 3: Run the new test**

Run: `npx vitest run lib/server/videoScript.test.ts`
Expected: the new classifier tests fail before implementation and pass afterward.

### Task 2: Expand the Claude prompt builder

**Files:**
- Modify: `apps/web/lib/server/videoScript.ts`
- Test: `apps/web/lib/server/videoScript.test.ts`

**Interfaces:**
- Consumes: template key, persona summary, brief, skills, campaign context, refinement, target seconds.
- Produces: a richer prompt block with scene beats, camera motion, non-symmetry, and anti-polish defaults.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildVideoScriptPrompt } from "./videoScript";

describe("buildVideoScriptPrompt", () => {
  it("includes human-imperfect defaults unless the persona requests polish", () => {
    const prompt = buildVideoScriptPrompt({
      template: "ugc_handheld",
      persona: { name: "Mina", niche: "fashion", voiceArchetype: "playful", description: "daily short-form creator" },
      brief: { format: "talking_head", angle: "selfie", structureNotes: "fast hook" },
      skills: [],
      refinement: "",
      targetSeconds: 24,
    });
    expect(prompt).toMatch(/handheld/i);
    expect(prompt).toMatch(/slight shake/i);
    expect(prompt).toMatch(/not overly polished/i);
  });

  it("adds polished language only when the persona explicitly asks for it", () => {
    const prompt = buildVideoScriptPrompt({
      template: "realistic_cinematic",
      persona: { name: "Mina", niche: "fashion", voiceArchetype: "luxury", description: "cinematic polished editorial" },
      brief: { format: "cinematic", angle: "wide", structureNotes: "slow reveal" },
      skills: [],
      refinement: "",
      targetSeconds: 24,
    });
    expect(prompt).toMatch(/polished/i);
  });
});
```

- [ ] **Step 2: Rewrite the prompt composition**

Make the shared prompt explicitly require:
- a hook in the first seconds
- a beat-by-beat scene list
- camera notes for each beat
- human micro-imperfections by default
- style-specific rules for cartoon, episodic, realistic, and UGC templates

- [ ] **Step 3: Run the prompt tests**

Run: `npx vitest run lib/server/videoScript.test.ts`
Expected: the prompt assertions pass and the generator still returns valid JSON through the existing Claude path.

### Task 3: Thread the new prompt through existing callers

**Files:**
- Modify: `apps/web/app/api/agents/video-script/route.ts`
- Modify: `apps/web/app/api/influencer/generate-content/route.ts` if needed for consistency

**Interfaces:**
- Consumes: the updated shared generator.
- Produces: identical script quality in preview and render, without duplicating prompt logic.

- [ ] **Step 1: Update call sites**

Pass through the same persona data already available in the builder path so the template selection sees the same inputs in preview and render.

- [ ] **Step 2: Sanity-check output shape**

Confirm the API still returns `hook`, `script`, `caption`, `hashtags`, and `raw` without breaking the builder UI.

- [ ] **Step 3: Verify build path consistency**

Make sure the render path and the preview path now produce the same prompt family for the same persona.

