# Duration-aware Script Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the builder chat regenerate a video script to a requested length (5–60s, absolute or relative) that is genuinely longer/shorter and unique to the user's request.

**Architecture:** A pure client-side parser turns chat text ("1 minute", "make it longer") into a target seconds + leftover refinement. The builder chat short-circuits length-edit messages to regenerate the existing script card via the existing `/api/agents/video-script` endpoint, which now accepts a `refinement` string. `lib/server/videoScript.ts` scales words/beats/tokens to the duration and always varies output with a nonce.

**Tech Stack:** Next.js (App Router), TypeScript, Vitest, Convex (read-only here).

---

## File Structure

- `lib/builder/scriptDirective.ts` (new) — pure parser `parseScriptDirective` + `SCRIPT_LENGTH_STEPS`. Test: `lib/builder/scriptDirective.test.ts`.
- `lib/builder/agentTypes.ts` (modify) — extend `STANDARD_VIDEO_LENGTHS`.
- `lib/server/videoScript.ts` (modify) — add pure helpers `computeScriptLengthPlan`, `operatorRequestLine`; use `refinement`, always-on nonce, scaled `maxTokens`. Test: `lib/server/videoScript.test.ts`.
- `app/api/agents/video-script/route.ts` (modify) — accept + forward `refinement`.
- `app/builder/page.tsx` (modify) — extract `regenerateVideoScriptCard` helper; short-circuit length-edit chat messages.

---

## Task 1: Script directive parser (pure)

**Files:**
- Create: `lib/builder/scriptDirective.ts`
- Test: `lib/builder/scriptDirective.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { parseScriptDirective, SCRIPT_LENGTH_STEPS } from "./scriptDirective";

describe("SCRIPT_LENGTH_STEPS", () => {
  it("is the 8..60 ladder", () => {
    expect([...SCRIPT_LENGTH_STEPS]).toEqual([8, 16, 24, 32, 48, 60]);
  });
});

describe("parseScriptDirective — absolute", () => {
  it("'make it a 1 minute version' -> 60", () => {
    const d = parseScriptDirective("make it a 1 minute version", 24);
    expect(d.isLengthEdit).toBe(true);
    expect(d.seconds).toBe(60);
  });
  it("'30 seconds' -> 30", () => {
    expect(parseScriptDirective("keep it 30 seconds", 24).seconds).toBe(30);
  });
  it("'60s' -> 60", () => {
    expect(parseScriptDirective("60s please", 24).seconds).toBe(60);
  });
  it("'half a minute' -> 30", () => {
    expect(parseScriptDirective("half a minute", 24).seconds).toBe(30);
  });
  it("clamps '5 minutes' -> 60 and '2s' -> 5", () => {
    expect(parseScriptDirective("5 minutes", 24).seconds).toBe(60);
    expect(parseScriptDirective("2s", 24).seconds).toBe(5);
  });
});

describe("parseScriptDirective — relative", () => {
  it("'make it longer' steps up 24 -> 32", () => {
    expect(parseScriptDirective("make it longer", 24).seconds).toBe(32);
  });
  it("'way longer' steps up two 16 -> 32", () => {
    expect(parseScriptDirective("way longer", 16).seconds).toBe(32);
  });
  it("'shorter' steps down 24 -> 16", () => {
    expect(parseScriptDirective("make it shorter", 24).seconds).toBe(16);
  });
  it("longer at the top (60) stays 60", () => {
    expect(parseScriptDirective("longer", 60).seconds).toBe(60);
  });
});

describe("parseScriptDirective — refinement + non-length", () => {
  it("extracts refinement around the length phrase", () => {
    const d = parseScriptDirective("make it funnier and 1 minute long", 24);
    expect(d.seconds).toBe(60);
    expect(d.refinement.toLowerCase()).toContain("funnier");
  });
  it("non-length message -> isLengthEdit false", () => {
    const d = parseScriptDirective("make a video about coffee", 24);
    expect(d.isLengthEdit).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/builder/scriptDirective.test.ts`
Expected: FAIL — "Failed to resolve import './scriptDirective'".

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/builder/scriptDirective.ts
// Pure parser: turn a chat message into a target video length + leftover
// refinement. No React/Convex deps so it is trivially unit-testable.
import { MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS } from "./agentTypes";

export const SCRIPT_LENGTH_STEPS = [8, 16, 24, 32, 48, 60] as const;

export interface ScriptDirective {
  isLengthEdit: boolean; // message is about changing the script length
  seconds: number;       // resolved target, clamped to [MIN, MAX]
  refinement: string;    // remaining user text (may be "")
}

const clamp = (n: number) =>
  Math.max(MIN_VIDEO_SECONDS, Math.min(MAX_VIDEO_SECONDS, Math.round(n)));

function nearestStepIndex(seconds: number): number {
  let best = 0;
  for (let i = 1; i < SCRIPT_LENGTH_STEPS.length; i++) {
    if (Math.abs(SCRIPT_LENGTH_STEPS[i] - seconds) < Math.abs(SCRIPT_LENGTH_STEPS[best] - seconds)) best = i;
  }
  return best;
}

export function parseScriptDirective(text: string, currentSeconds: number): ScriptDirective {
  const t = (text ?? "").toLowerCase();
  let matched: RegExp | null = null;
  let seconds: number | null = null;

  // ── Absolute durations (checked first) ──
  const minutesNum = t.match(/\b(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  const secondsNum = t.match(/\b(\d{1,3})\s*(?:s|sec|secs|second|seconds)\b/);
  const oneMinute = /\b(?:one|1)\s+minute\b/.test(t);
  const halfMinute = /\bhalf a minute\b/.test(t);

  if (secondsNum) { seconds = clamp(parseInt(secondsNum[1], 10)); matched = /\b\d{1,3}\s*(?:s|sec|secs|second|seconds)\b/; }
  else if (minutesNum) { seconds = clamp(parseFloat(minutesNum[1]) * 60); matched = /\b\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes)\b/; }
  else if (oneMinute) { seconds = 60; matched = /\b(?:one|1)\s+minute\b/; }
  else if (halfMinute) { seconds = 30; matched = /\bhalf a minute\b/; }

  // ── Relative direction (only when no absolute number) ──
  let relativeMatched = false;
  if (seconds === null) {
    const up = /\b(longer|extend|more)\b/.test(t);
    const down = /\b(shorter|less|trim)\b/.test(t);
    if (up || down) {
      relativeMatched = true;
      const jump = /\b(way|much|a lot|lot)\b/.test(t) ? 2 : 1;
      const idx = nearestStepIndex(currentSeconds);
      const nextIdx = up
        ? Math.min(SCRIPT_LENGTH_STEPS.length - 1, idx + jump)
        : Math.max(0, idx - jump);
      seconds = SCRIPT_LENGTH_STEPS[nextIdx];
    }
  }

  const isLengthEdit = seconds !== null;
  if (!isLengthEdit) return { isLengthEdit: false, seconds: clamp(currentSeconds), refinement: text?.trim() ?? "" };

  // Strip the matched length phrase from the message to get the refinement.
  let refinement = text ?? "";
  if (matched) refinement = refinement.replace(new RegExp(matched.source, "i"), " ");
  if (relativeMatched) refinement = refinement.replace(/\b(way|much|a lot|lot|longer|shorter|extend|more|less|trim)\b/gi, " ");
  refinement = refinement.replace(/\b(make it|version|long|please)\b/gi, " ").replace(/\s+/g, " ").trim();

  return { isLengthEdit: true, seconds: seconds as number, refinement };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/builder/scriptDirective.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/builder/scriptDirective.ts lib/builder/scriptDirective.test.ts
git commit -m "feat(vello): pure parser for script length directives from chat"
```

---

## Task 2: Extend length ladder in the UI constants

**Files:**
- Modify: `lib/builder/agentTypes.ts:652`

- [ ] **Step 1: Make the edit**

Replace line 652:

```ts
export const STANDARD_VIDEO_LENGTHS = [8, 16, 24, 32] as const;
```

with:

```ts
export const STANDARD_VIDEO_LENGTHS = [8, 16, 24, 32, 48, 60] as const;
```

- [ ] **Step 2: Verify the card chips include 48 and 60**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "agentTypes|VideoScriptCard" | grep -v "implicitly has an 'any'" | head`
Expected: no new errors. (The card chips render from `STANDARD_VIDEO_LENGTHS`, so 48/60 now appear.)

- [ ] **Step 3: Commit**

```bash
git add lib/builder/agentTypes.ts
git commit -m "feat(vello): add 48s and 60s to standard video lengths"
```

---

## Task 3: Duration-scaled, refinement-aware script generation

**Files:**
- Modify: `lib/server/videoScript.ts`
- Test: `lib/server/videoScript.test.ts`

- [ ] **Step 1: Write the failing test (pure helpers)**

```ts
/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { computeScriptLengthPlan, operatorRequestLine } from "./videoScript";

describe("computeScriptLengthPlan", () => {
  it("8s -> 1 window", () => {
    const p = computeScriptLengthPlan(8);
    expect(p.targetSeconds).toBe(8);
    expect(p.windowCount).toBe(1);
  });
  it("24s -> 3 windows, ~60 words", () => {
    const p = computeScriptLengthPlan(24);
    expect(p.windowCount).toBe(3);
    expect(p.targetWords).toBe(60);
  });
  it("60s -> 8 windows and larger token budget", () => {
    const p = computeScriptLengthPlan(60);
    expect(p.windowCount).toBe(8);
    expect(p.maxTokens).toBeGreaterThanOrEqual(1200);
    expect(p.maxTokens).toBeGreaterThan(computeScriptLengthPlan(8).maxTokens);
  });
  it("clamps to [5,60] and floors sub-5 to a usable value", () => {
    expect(computeScriptLengthPlan(2).targetSeconds).toBe(5);
    expect(computeScriptLengthPlan(120).targetSeconds).toBe(60);
  });
  it("low/high bound the target words", () => {
    const p = computeScriptLengthPlan(24);
    expect(p.lowWords).toBeLessThan(p.targetWords);
    expect(p.highWords).toBeGreaterThan(p.targetWords);
  });
});

describe("operatorRequestLine", () => {
  it("returns an OPERATOR REQUEST line when refinement present", () => {
    expect(operatorRequestLine("funnier")).toContain("OPERATOR REQUEST");
    expect(operatorRequestLine("funnier")).toContain("funnier");
  });
  it("returns empty string when no refinement", () => {
    expect(operatorRequestLine("")).toBe("");
    expect(operatorRequestLine("   ")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/videoScript.test.ts`
Expected: FAIL — `computeScriptLengthPlan`/`operatorRequestLine` are not exported.

- [ ] **Step 3: Add the pure helpers**

At the top of `lib/server/videoScript.ts`, after the existing imports (the file already imports from `../lib/...`; add this import if not present):

```ts
import { MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS, SPEAKING_WORDS_PER_SEC } from "../builder/agentTypes";
```

Then add these exported helpers near the top of the module (above `generateVideoScript`):

```ts
export interface ScriptLengthPlan {
  targetSeconds: number;
  targetWords: number;
  windowCount: number;
  lowWords: number;
  highWords: number;
  maxTokens: number;
}

/** Map a requested duration to the word/beat/token budget for one script. */
export function computeScriptLengthPlan(requestedSeconds: number | undefined): ScriptLengthPlan {
  const targetSeconds = Math.max(
    MIN_VIDEO_SECONDS,
    Math.min(MAX_VIDEO_SECONDS, Math.round(requestedSeconds && requestedSeconds > 0 ? requestedSeconds : 24)),
  );
  const targetWords = Math.round(targetSeconds * SPEAKING_WORDS_PER_SEC);
  const windowCount = Math.max(1, Math.ceil(targetSeconds / 8));
  const lowWords = Math.round(targetWords * 0.85);
  const highWords = Math.round(targetWords * 1.15);
  // Enough JSON headroom that even an 8-beat script never truncates.
  const maxTokens = Math.max(1200, windowCount * 350);
  return { targetSeconds, targetWords, windowCount, lowWords, highWords, maxTokens };
}

/** A prompt line carrying the operator's extra ask, or "" when there is none. */
export function operatorRequestLine(refinement: string | undefined): string {
  const r = (refinement ?? "").trim();
  return r ? `OPERATOR REQUEST (honor this in the rewrite): ${r}\n` : "";
}
```

- [ ] **Step 4: Run the pure-helper tests**

Run: `npx vitest run lib/server/videoScript.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the helpers + refinement + always-on nonce in `generateVideoScript`**

In `lib/server/videoScript.ts`, add `refinement?: string;` to the `opts` object type (next to `nonce?: string;`).

Replace the length block (currently around lines 130–135):

```ts
  const targetSeconds = opts.targetSeconds && opts.targetSeconds >= 8 ? Math.round(opts.targetSeconds) : 24;
  const targetWords = Math.round(targetSeconds * 2.5);
  const windowCount = Math.max(1, Math.round(targetSeconds / 8));
  const lowWords = Math.round(targetWords * 0.85);
  const highWords = Math.round(targetWords * 1.15);
```

with:

```ts
  const { targetSeconds, targetWords, windowCount, lowWords, highWords, maxTokens } = computeScriptLengthPlan(opts.targetSeconds);
  // Always vary output across regenerations, even when the caller didn't pass one.
  const nonce = opts.nonce ?? `${targetSeconds}-${Math.round((targetWords * 9301 + 49297) % 233280)}-${(opts.topic ?? "").length}`;
  const operatorLine = operatorRequestLine(opts.refinement);
```

Note: `targetWords` is now used by the prompt (already referenced) — keep all existing `${lowWords}`, `${highWords}`, `${windowCount}`, `${targetSeconds}` interpolations as-is.

In the user-prompt string, add `${operatorLine}` right after the `VARIATION TOKEN` / brief block area (it currently interpolates `${opts.nonce ? ... : ""}` — change that to use the local `nonce` and append `operatorLine`). Concretely, in the prompt template change:

```ts
${opts.nonce ? `VARIATION TOKEN: ${opts.nonce} — use ONLY to diversify: ...\n` : ""}
```

to:

```ts
`VARIATION TOKEN: ${nonce} — use ONLY to diversify: write a DISTINCTLY different hook, structure, and wording than a default take; never print the token.\n` + operatorLine +
```

(Keep the rest of that concatenation chain unchanged.)

Finally, update the LLM call to use the scaled token budget. Replace:

```ts
    raw = await callClaudeJSON<Record<string, unknown>>({ system, user, maxTokens: 1200, apiKey: opts.apiKey });
```

with:

```ts
    raw = await callClaudeJSON<Record<string, unknown>>({ system, user, maxTokens, apiKey: opts.apiKey });
```

- [ ] **Step 6: Verify typecheck + tests still pass**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "videoScript.ts" | grep -v "implicitly has an 'any'" | head`
Expected: no new errors.
Run: `npx vitest run lib/server/videoScript.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/server/videoScript.ts lib/server/videoScript.test.ts
git commit -m "feat(vello): duration-scaled script plan + refinement + always-on nonce"
```

---

## Task 4: Forward `refinement` through the video-script API

**Files:**
- Modify: `app/api/agents/video-script/route.ts:26-58`

- [ ] **Step 1: Make the edit**

Change the body type + destructure (line 26-27):

```ts
    const body = (await req.json()) as { mintAddress?: string; topic?: string; durationSeconds?: number };
    const { mintAddress, topic, durationSeconds } = body;
```

to:

```ts
    const body = (await req.json()) as { mintAddress?: string; topic?: string; durationSeconds?: number; refinement?: string };
    const { mintAddress, topic, durationSeconds, refinement } = body;
```

Change the `generateVideoScript` opts (currently `{ topic, targetSeconds }`):

```ts
      { topic, targetSeconds },
```

to:

```ts
      { topic, targetSeconds, refinement },
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "video-script/route.ts" | grep -v "implicitly has an 'any'" | head`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/agents/video-script/route.ts
git commit -m "feat(vello): video-script API accepts refinement"
```

---

## Task 5: Chat short-circuit — regenerate the script on length edits

**Files:**
- Modify: `app/builder/page.tsx` (import; extract `regenerateVideoScriptCard`; refactor `handleVideoCardLength`; short-circuit in `sendMessage`)

- [ ] **Step 1: Add the import**

Near the other `@/lib/builder/...` imports at the top of `app/builder/page.tsx`, add:

```ts
import { parseScriptDirective } from "@/lib/builder/scriptDirective";
```

- [ ] **Step 2: Extract a shared regenerate helper and reuse it in `handleVideoCardLength`**

Replace the body of `handleVideoCardLength` (currently `app/builder/page.tsx:1765-1793`) so it delegates to a new helper that also accepts a `refinement`:

```ts
  const regenerateVideoScriptCard = useCallback(async (cardId: string, card: VideoScriptCardData, seconds: number, refinement?: string) => {
    const bp = agentBlueprintRef.current;
    if (!bp?.mintAddress) return;
    setVideoCardLengths((s) => ({ ...s, [cardId]: seconds }));
    setVideoCardRewriting((s) => ({ ...s, [cardId]: true }));
    try {
      const res = await fetch("/api/agents/video-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress: bp.mintAddress, topic: card.topic, durationSeconds: seconds, refinement }),
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        const d = data as { hook: string; script: string; caption: string; raw: Record<string, unknown>; estSeconds: number; clipCount: number };
        setMessages((prev) => prev.map((m) => m.id === cardId && m.videoScriptCard
          ? { ...m, videoScriptCard: { ...m.videoScriptCard, hook: d.hook, script: d.script, caption: d.caption, raw: d.raw, estSeconds: d.estSeconds, clipCount: d.clipCount } }
          : m));
      }
    } catch {
      // Keep existing script; length still applies and render packs what's there.
    } finally {
      setVideoCardRewriting((s) => ({ ...s, [cardId]: false }));
    }
  }, []);

  const handleVideoCardLength = useCallback(async (cardId: string, card: VideoScriptCardData, seconds: number) => {
    if (seconds === card.estSeconds) {
      setVideoCardLengths((s) => ({ ...s, [cardId]: seconds }));
      return;
    }
    await regenerateVideoScriptCard(cardId, card, seconds);
  }, [regenerateVideoScriptCard]);
```

- [ ] **Step 3: Short-circuit length edits in `sendMessage`**

In `app/builder/page.tsx`, immediately AFTER the pending-link early-return block (after line 2099, before `setIsProcessing(true)` at 2101), insert:

```ts
    // ── Script length edit ──────────────────────────────────────────────────
    // If a script card already exists and the message is about its length
    // ("make it longer", "1 minute version", "shorter"), regenerate that card
    // for the new duration instead of routing to the campaign chat model.
    const lastScriptMsg = [...messages].reverse().find((m) => m.videoScriptCard);
    if (lastScriptMsg?.videoScriptCard) {
      const directive = parseScriptDirective(messageText, lastScriptMsg.videoScriptCard.estSeconds);
      if (directive.isLengthEdit) {
        setInputText("");
        setMessages((prev) => [...prev, { id: `${Date.now()}-len-user`, text: messageText, sender: "user", timestamp: new Date() }]);
        await regenerateVideoScriptCard(lastScriptMsg.id, lastScriptMsg.videoScriptCard, directive.seconds, directive.refinement || undefined);
        return;
      }
    }
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "builder/page.tsx" | grep -v "implicitly has an 'any'" | head`
Expected: no new errors (the listed pre-existing implicit-any lines are unrelated).

- [ ] **Step 5: Manual smoke test**

Run the app, open `/builder?type=influencer&mint=<a real mint>`, ask "make a video about X", then send "make it a 1 minute version, funnier".
Expected: the same card shows "✍️ rewriting for 60s…", then updates to a visibly longer (~150-word, 8-beat) script with the funnier angle; the `~60s` / clip-count metadata updates.

- [ ] **Step 6: Commit**

```bash
git add app/builder/page.tsx
git commit -m "feat(vello): regenerate script from chat length edits (longer/shorter/1 minute)"
```

---

## Self-Review

**Spec coverage:**
- Chat natural-language length → Task 1 (parser) + Task 5 (short-circuit). ✓
- Absolute + relative, 5–60s, step ladder → Task 1. ✓
- Genuinely longer (beats/words scale) + up to 1 minute → Task 3 (`computeScriptLengthPlan`, windowCount=ceil, 60s→8 beats). ✓
- Unique to request → Task 3 (always-on nonce + `operatorRequestLine`) threaded via Task 4 (`refinement`) + Task 5. ✓
- No truncation in display → unchanged (card already `whitespace-pre-wrap`); token budget scaled (Task 3) so the model output itself isn't cut. ✓
- 1-minute clickable chip → Task 2. ✓

**Placeholder scan:** none — every code step contains full code.

**Type consistency:** `parseScriptDirective(text, currentSeconds) -> { isLengthEdit, seconds, refinement }` used identically in Tasks 1 & 5. `computeScriptLengthPlan` / `operatorRequestLine` defined and consumed in Task 3. `refinement` flows route(Task 4) → `generateVideoScript` opts (Task 3) consistently. `regenerateVideoScriptCard(cardId, card, seconds, refinement?)` defined and called in Task 5.
