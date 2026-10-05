# Video: Unique Time-Aligned Segments + Consistent Voice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make builder-generated videos render N distinct 8-second clips (no repeated content) in one consistent voice, with operator-selected Veo-aligned duration.

**Architecture:** Extract the pure segmentation + voice logic into a new focused module `lib/server/videoSegmentation.ts` (time-windowed beat packing, no duplication; canonical voice profile). The Kie pipeline consumes it, builds per-window prompts that carry only their own spoken line plus a verbatim voice block, and the script generator targets the chosen duration. Durations become multiples of Veo's fixed 8s clip.

**Tech Stack:** TypeScript, Next.js 16, Vitest (edge-runtime), Kie/Veo 3.1 API.

---

## File Structure

- Create: `lib/server/videoSegmentation.ts` — pure: `beatSecondsFromVoiceover`, `packBeatsIntoWindows`, `buildVoiceProfile`, `VoicePersona` type.
- Create: `lib/server/videoSegmentation.test.ts` — unit tests for the above.
- Modify: `lib/server/kie-video-pipeline.ts` — consume the new module; rewrite `buildSegmentPrompt`; thread `totalSegments`/voice; set under-content note; remove `splitBeatsIntoSegments` + local `beatSecondsFromVoiceover`.
- Modify: `lib/server/videoScript.ts` — add `targetSeconds` to scale script length + window count.
- Modify: `lib/builder/agentTypes.ts` — `STANDARD_VIDEO_LENGTHS` → `[8,16,24,32]`, `IDEAL_VIDEO_SECONDS` → `24`.
- Modify: `app/api/agents/run-task/route.ts` — pass `targetSeconds` into `generateVideoScript`.
- Modify: `app/api/agents/video-script/route.ts` — pass `targetSeconds` into `generateVideoScript`.
- Modify: `components/builder/AgentWorkspace.tsx` — selector copy (lengths come from the constant automatically).

The pipeline keeps exporting `StoryBeat`; the new module imports it **type-only** to avoid a runtime cycle.

---

## Task 1: Veo-aligned standard lengths

**Files:**
- Modify: `lib/builder/agentTypes.ts:625-626`
- Test: `lib/builder/videoEstimation.test.ts`

- [ ] **Step 1: Update the constants**

In `lib/builder/agentTypes.ts` replace:

```ts
export const IDEAL_VIDEO_SECONDS = 30;
export const STANDARD_VIDEO_LENGTHS = [15, 30, 45, 60] as const;
```

with:

```ts
// Veo generates fixed 8s clips (extended for longer videos), so the standard
// lengths are multiples of 8 — every step is exactly one more 8s clip.
export const IDEAL_VIDEO_SECONDS = 24;
export const STANDARD_VIDEO_LENGTHS = [8, 16, 24, 32] as const;
```

- [ ] **Step 2: Check for now-invalid references**

Run: `grep -rn "IDEAL_VIDEO_SECONDS\|STANDARD_VIDEO_LENGTHS\|videoSeconds" components/builder app lib --include=*.ts --include=*.tsx | grep -v node_modules`
Expected: confirm no code asserts a specific old value (15/30/45/60). The economics panel in `AgentWorkspace.tsx` recomputes from the constant, so no logic change is needed.

- [ ] **Step 3: Run the existing estimation tests**

Run: `npx vitest run lib/builder/videoEstimation.test.ts`
Expected: PASS (these test `estimateSecondsFromScript`, not the length list). If any assertion references old lengths, update it to the new values.

- [ ] **Step 4: Commit**

```bash
git add lib/builder/agentTypes.ts
git commit -m "feat(video): Veo-aligned standard lengths [8,16,24,32]"
```

---

## Task 2: Pure segmentation module — `beatSecondsFromVoiceover` + `packBeatsIntoWindows`

**Files:**
- Create: `lib/server/videoSegmentation.ts`
- Test: `lib/server/videoSegmentation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/server/videoSegmentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { beatSecondsFromVoiceover, packBeatsIntoWindows } from "./videoSegmentation";
import type { StoryBeat } from "./kie-video-pipeline";

// Build a beat whose voiceover is `words` words long (≈ words/2.5 seconds).
function beat(index: number, words: number): StoryBeat {
  return {
    index,
    scene: `scene ${index}`,
    voiceover: Array.from({ length: words }, () => "w").join(" "),
    camera: "static",
    seconds: 0,
  };
}

describe("beatSecondsFromVoiceover", () => {
  it("derives seconds from word count at 2.5 wps, floor 2", () => {
    expect(beatSecondsFromVoiceover("")).toBe(3); // silent → 3s default
    expect(beatSecondsFromVoiceover("one two")).toBe(2); // 2 words → ceil(0.8)=1 → floored to 2
    expect(beatSecondsFromVoiceover(Array.from({ length: 20 }, () => "w").join(" "))).toBe(8); // 20/2.5
  });
});

describe("packBeatsIntoWindows", () => {
  it("packs ~20-word beats into one 8s window each", () => {
    const beats = [beat(1, 20), beat(2, 20), beat(3, 20)];
    const windows = packBeatsIntoWindows(beats, 8, 3);
    expect(windows).toHaveLength(3);
    expect(windows.every((w) => w.length === 1)).toBe(true);
  });

  it("groups short beats so each window approaches 8s", () => {
    // four 10-word (4s) beats → ~2 per 8s window → 2 windows
    const beats = [beat(1, 10), beat(2, 10), beat(3, 10), beat(4, 10)];
    const windows = packBeatsIntoWindows(beats, 8, 4);
    expect(windows.length).toBe(2);
    expect(windows[0]).toHaveLength(2);
  });

  it("returns FEWER windows than requested when content is short — never duplicates", () => {
    const beats = [beat(1, 20), beat(2, 20)]; // only ~16s of content
    const windows = packBeatsIntoWindows(beats, 8, 4); // asked for 4
    expect(windows.length).toBe(2); // matched to content
    const allIndexes = windows.flat().map((b) => b.index);
    expect(new Set(allIndexes).size).toBe(allIndexes.length); // no beat reused
  });

  it("caps at maxWindows, folding overflow into the last window", () => {
    const beats = Array.from({ length: 10 }, (_, i) => beat(i + 1, 20)); // ~80s
    const windows = packBeatsIntoWindows(beats, 8, 2);
    expect(windows.length).toBe(2);
    expect(windows.flat()).toHaveLength(10); // every beat still present exactly once
  });

  it("single beat → single window", () => {
    expect(packBeatsIntoWindows([beat(1, 20)], 8, 4)).toHaveLength(1);
  });

  it("no beat object appears in two windows (no-duplication invariant)", () => {
    const beats = Array.from({ length: 7 }, (_, i) => beat(i + 1, 15));
    const windows = packBeatsIntoWindows(beats, 8, 4);
    const seen = new Set<number>();
    for (const w of windows) for (const b of w) {
      expect(seen.has(b.index)).toBe(false);
      seen.add(b.index);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/server/videoSegmentation.test.ts`
Expected: FAIL — "Cannot find module './videoSegmentation'".

- [ ] **Step 3: Implement the module (segmentation half)**

Create `lib/server/videoSegmentation.ts`:

```ts
import { SPEAKING_WORDS_PER_SEC } from "../builder/agentTypes";
import type { StoryBeat } from "./kie-video-pipeline";

/**
 * Realistic on-screen seconds for one beat, from how long its spoken line takes
 * at the shared speaking rate. Floors at 2s; silent beats (no voiceover) get 3s.
 */
export function beatSecondsFromVoiceover(voiceover: string): number {
  const words = (voiceover ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 3;
  return Math.max(2, Math.ceil(words / SPEAKING_WORDS_PER_SEC));
}

/**
 * Pack beats into time windows of ~`clipSeconds` each (one Veo clip per window).
 *
 * Walks beats in order, accumulating spoken seconds. Closes a window when adding
 * the next beat would exceed `clipSeconds * 1.25` AND the window already holds
 * at least `clipSeconds * 0.6` of content. Never exceeds `maxWindows` — once on
 * the last allowed window, all remaining beats fold into it.
 *
 * Crucially it NEVER pads or duplicates: if the beats only fill K < maxWindows
 * windows, it returns K windows. The caller renders exactly that many clips.
 */
export function packBeatsIntoWindows(
  beats: StoryBeat[],
  clipSeconds = 8,
  maxWindows = 8,
): StoryBeat[][] {
  if (beats.length === 0) return [];
  const cap = Math.max(1, maxWindows);
  const hardMax = clipSeconds * 1.25;
  const softMin = clipSeconds * 0.6;

  const windows: StoryBeat[][] = [];
  let current: StoryBeat[] = [];
  let acc = 0;

  for (const b of beats) {
    const onLastAllowedWindow = windows.length === cap - 1;
    const s = beatSecondsFromVoiceover(b.voiceover);
    const wouldOverflow = acc + s > hardMax;

    if (current.length > 0 && wouldOverflow && acc >= softMin && !onLastAllowedWindow) {
      windows.push(current);
      current = [];
      acc = 0;
    }
    current.push(b);
    acc += s;
  }
  if (current.length > 0) windows.push(current);
  return windows;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/server/videoSegmentation.test.ts`
Expected: PASS (segmentation tests). `buildVoiceProfile` tests come in Task 3.

- [ ] **Step 5: Commit**

```bash
git add lib/server/videoSegmentation.ts lib/server/videoSegmentation.test.ts
git commit -m "feat(video): time-windowed beat packing (no duplication)"
```

---

## Task 3: Voice profile — `buildVoiceProfile`

**Files:**
- Modify: `lib/server/videoSegmentation.ts`
- Test: `lib/server/videoSegmentation.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `lib/server/videoSegmentation.test.ts`:

```ts
import { buildVoiceProfile } from "./videoSegmentation";

describe("buildVoiceProfile", () => {
  const base = { agentName: "Aiko", agentNiche: "finance" };

  it("is deterministic for the same input", () => {
    const a = buildVoiceProfile(base);
    const b = buildVoiceProfile(base);
    expect(a).toBe(b);
  });

  it("includes an explicit identical-across-clips instruction and a pace", () => {
    const p = buildVoiceProfile(base);
    expect(p).toMatch(/identical in every clip/i);
    expect(p).toMatch(/150 wpm|words per minute/i);
  });

  it("reflects language as an accent cue", () => {
    const p = buildVoiceProfile({ ...base, language: "Malay" });
    expect(p.toLowerCase()).toContain("malay");
  });

  it("returns a complete descriptor even with empty persona", () => {
    const p = buildVoiceProfile({ agentName: "", agentNiche: "" });
    expect(p.length).toBeGreaterThan(40);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run lib/server/videoSegmentation.test.ts -t buildVoiceProfile`
Expected: FAIL — "buildVoiceProfile is not a function".

- [ ] **Step 3: Implement `buildVoiceProfile`**

Append to `lib/server/videoSegmentation.ts`:

```ts
export interface VoicePersona {
  agentName: string;
  agentNiche: string;
  agentArchetype?: string;
  language?: string;
  /** Optional explicit voice hint from the persona questionnaire. */
  voiceArchetype?: string;
  /** Optional personality dials (0-100) used to pick energy/warmth. */
  personality?: { warmth?: number; humor?: number; authority?: number; boldness?: number };
}

const WPM = Math.round(SPEAKING_WORDS_PER_SEC * 60); // 150

/**
 * One canonical voice descriptor, derived once per render and embedded verbatim
 * in every clip prompt so Veo reproduces the SAME voice across generate +
 * extends. Pure + deterministic. Always returns a complete descriptor.
 */
export function buildVoiceProfile(p: VoicePersona): string {
  const lang = (p.language ?? "English").trim() || "English";
  const accent =
    /english/i.test(lang) ? "neutral clear accent" : `light ${lang}-accented English`;

  const authority = p.personality?.authority ?? 55;
  const warmth = p.personality?.warmth ?? 60;
  const boldness = p.personality?.boldness ?? 55;

  const pitch = authority >= 65 ? "lower-pitched" : authority <= 40 ? "higher-pitched" : "mid-pitched";
  const tone = warmth >= 60 ? "warm and friendly" : warmth <= 35 ? "cool and measured" : "even, approachable";
  const energy = boldness >= 65 ? "high-energy, punchy" : boldness <= 35 ? "calm, steady" : "upbeat, confident";

  const archetype = (p.voiceArchetype || p.agentArchetype || "expert creator").toString();

  return (
    `VOICE — IDENTICAL IN EVERY CLIP: a ${pitch}, ${tone} ${archetype} voice with a ${accent}, ` +
    `speaking at a natural ~${WPM} wpm (words per minute), ${energy} delivery. ` +
    `The vocal identity — gender, pitch, timbre, accent, and pace — MUST be the same in every clip ` +
    `and across every extend boundary. Never change or re-cast the voice between clips.`
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/server/videoSegmentation.test.ts`
Expected: PASS (all segmentation + voice tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/videoSegmentation.ts lib/server/videoSegmentation.test.ts
git commit -m "feat(video): canonical voice profile derived from persona"
```

---

## Task 4: Consume the module in the pipeline; rewrite segment prompt + voice block

**Files:**
- Modify: `lib/server/kie-video-pipeline.ts`

- [ ] **Step 1: Import the pure helpers and delete the local duplicates**

At the top of `lib/server/kie-video-pipeline.ts`, after the existing imports, add:

```ts
import { packBeatsIntoWindows, buildVoiceProfile } from "./videoSegmentation";
```

Delete the local `function beatSecondsFromVoiceover(...)` (lines ~118-122) and the entire `function splitBeatsIntoSegments(...)` (lines ~311-331). Add an import of the shared `beatSecondsFromVoiceover`:

```ts
import { packBeatsIntoWindows, buildVoiceProfile, beatSecondsFromVoiceover } from "./videoSegmentation";
```

- [ ] **Step 2: Add `personality` to `GenerateVideoArgs`**

In the `GenerateVideoArgs` interface add (after `characterBible`):

```ts
  /** Optional personality dials (0-100) — used to derive a stable voice profile. */
  personality?: { warmth?: number; humor?: number; authority?: number; boldness?: number };
  /** Optional explicit voice hint from the persona questionnaire. */
  voiceArchetype?: string;
```

- [ ] **Step 3: Rewrite `buildSegmentPrompt` to carry only its window + the voice profile**

Replace the whole `buildSegmentPrompt(...)` function with:

```ts
function buildSegmentPrompt(
  args: GenerateVideoArgs,
  segBeats: StoryBeat[],
  segmentIndex: number,
  totalSegments: number,
  voiceProfile: string,
  prevSegmentLastBeat?: StoryBeat,
  clipSeconds = 8,
): string {
  const isFirst = segmentIndex === 0;
  const isLast = segmentIndex === totalSegments - 1;
  const dur = `${clipSeconds}s`;
  const segLabel = isFirst ? `OPENING SEGMENT (${dur})` : isLast ? `FINAL SEGMENT ${segmentIndex + 1}/${totalSegments} (${dur})` : `MIDDLE SEGMENT ${segmentIndex + 1}/${totalSegments} (${dur})`;

  const beatBlock = segBeats.map((b, i) => {
    const label = isFirst && i === 0 ? "HOOK" : isLast && i === segBeats.length - 1 ? "PAYOFF" : `BEAT ${b.index}`;
    return `[${label}]
Scene: ${b.scene}
Camera: ${b.camera}
${b.voiceover ? `Spoken (lip-sync exact): "${b.voiceover}"` : "Silent action"}`;
  }).join("\n\n");

  // ONLY this window's spoken line — never the full monologue.
  const spokenLine = segBeats.map(b => b.voiceover).filter(Boolean).join(" ").trim();

  // Continuity for clips 2+: a short "already said" cue + a hard no-repeat rule.
  const prevWords = prevSegmentLastBeat?.voiceover
    ? prevSegmentLastBeat.voiceover.trim().split(/\s+/).slice(-6).join(" ")
    : "";
  const continuityBlock = !isFirst && prevSegmentLastBeat
    ? `SEAMLESS CONTINUATION — READ FIRST
This clip is CONCATENATED onto the previous 8-second clip via Kie's veo/extend endpoint; the viewer sees one continuous take.

Visual continuity (match exactly): same character pose, outfit, hair, expression; same environment, background, lighting direction, color temperature; same camera position and lens motion; same motion energy.

PREVIOUSLY (already spoken — do NOT repeat): "...${prevWords}"
Continue the monologue FORWARD from there. Do NOT restate, paraphrase, summarise, or re-speak any earlier line. Speak ONLY the new line below.

`
    : "";

  return `${segLabel} — an 8-second vertical 9:16 clip starring ${args.agentName}.

${continuityBlock}CHARACTER LOCK: the exact person in the reference image — same face, skin tone, hair, outfit, art style. No identity drift across ANY frame, ESPECIALLY at the boundary where this clip begins.

${voiceProfile}

TOPIC: ${args.topic}

${beatBlock}

${spokenLine ? `SPOKEN AUDIO FOR THIS SEGMENT ONLY (lip-sync exactly, every syllable — this is the ONLY line spoken in this clip): "${spokenLine}"` : ""}

DIRECTION:
- Natural human motion, micro-expressions, breathing, small gestures.
- Lip-sync precisely every syllable to the spoken line above.
- ${isFirst
    ? "Hook is the priority — open on a face/motion that stops the scroll. End on a frame with momentum so the next 8s extension flows naturally."
    : isLast
      ? "Land the payoff. End on a strong final frame matching the closing line."
      : "Maintain the same energy and pace as the prior segment. End on a frame with continued motion so the NEXT clip can pick up seamlessly."}
- Color grade, white balance, and audio loudness must match the prior segment.

FORBIDDEN:
- No visible text, captions, subtitles, watermarks, or on-screen writing of any kind
- No identity drift — character must match the reference image precisely
- No unrelated cuts, jump-cuts, or scene changes mid-clip
${!isFirst ? "- NO abrupt costume, lighting, or location change from the prior segment — this is a continuation, not a new shot\n- NO repeating any line already spoken in an earlier clip\n" : ""}- No text overlays for the spoken line (character speaks it out loud only)`;
}
```

- [ ] **Step 4: Verify it still compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "kie-video-pipeline|videoSegmentation" | head`
Expected: callers of `buildSegmentPrompt`/`splitBeatsIntoSegments` now error (fixed in Task 5). No errors from the new module itself.

- [ ] **Step 5: Commit**

```bash
git add lib/server/kie-video-pipeline.ts
git commit -m "feat(video): per-window prompts with voice block + no-repeat cue"
```

---

## Task 5: Wire windows + voice + segment count through `planStoryWithClaude` and `generateVideoFromScript`

**Files:**
- Modify: `lib/server/kie-video-pipeline.ts`

- [ ] **Step 1: Pass `totalSegments` into `planStoryWithClaude` and scale beat count**

Change the signature and beat-count line in `planStoryWithClaude`:

```ts
async function planStoryWithClaude(args: GenerateVideoArgs, totalSegments: number): Promise<{ beats: StoryBeat[]; imagePrompt: string }> {
  const totalSeconds = Math.max(5, args.durationSeconds ?? totalSegments * 8);
  // ~2 beats per 8s window so each window has a hook + turn. Clamp to a sane range.
  const beatCount = Math.max(2, Math.min(14, totalSegments * 2));
```

In the `system` prompt, after the STORY PRINCIPLES list, add this line:

```
- This video is split into exactly ${totalSegments} sequential 8-second windows. Distribute the beats so each window has its own distinct lines. NEVER repeat or restate a line across windows — each window must speak NEW words that move the story forward.
```

Keep the rest of `planStoryWithClaude` unchanged (it already maps/clamps beats and recomputes `seconds` via the spoken line — but switch that to the imported helper: it already calls `beatSecondsFromVoiceover`, now imported).

- [ ] **Step 2: Compute the voice profile + windows in `generateVideoFromScript`**

In `generateVideoFromScript`, right after `beats`/`storyboardPrompt` are resolved (after the `planStoryWithClaude` try/catch, before `const videoPrompt = ...`), update the plan call and add:

```ts
  // (the planStoryWithClaude call inside the try becomes:)
  //   const planned = await planStoryWithClaude(args, totalSegments);

  // One canonical voice descriptor for the whole render — embedded verbatim in
  // every clip prompt so the voice never drifts across extends.
  const voiceProfile = buildVoiceProfile({
    agentName: args.agentName,
    agentNiche: args.agentNiche,
    agentArchetype: args.agentArchetype,
    language: undefined, // pipeline args carry no language; persona archetype + niche drive it
    voiceArchetype: args.voiceArchetype,
    personality: args.personality,
  });
```

Update the `planStoryWithClaude(args)` call inside the try block to `planStoryWithClaude(args, totalSegments)`.

- [ ] **Step 3: Replace `splitBeatsIntoSegments` usage in the Veo branch**

In the Veo branch of `generateVideoFromScript`, replace:

```ts
      const segments = splitBeatsIntoSegments(beats, totalSegments);
      const segmentPrompts = segments.map((segBeats, i) => {
        const prevLastBeat = i > 0 ? segments[i - 1][segments[i - 1].length - 1] : undefined;
        return buildSegmentPrompt(args, segBeats, i, segments.length, prevLastBeat);
      });
```

with:

```ts
      const segments = packBeatsIntoWindows(beats, 8, totalSegments);
      if (segments.length < totalSegments) {
        videoNote = `Rendered ${segments.length * 8}s — the script only had enough distinct content for ${segments.length} of ${totalSegments} eight-second windows.`;
        console.warn(`[kie-video-pipeline] ${videoNote}`);
      }
      const segmentPrompts = segments.map((segBeats, i) => {
        const prevLastBeat = i > 0 ? segments[i - 1][segments[i - 1].length - 1] : undefined;
        return buildSegmentPrompt(args, segBeats, i, segments.length, voiceProfile, prevLastBeat);
      });
```

- [ ] **Step 4: Replace `splitBeatsIntoSegments` in the Seedance path**

In `generateSeedanceStitched`, replace `const segments = splitBeatsIntoSegments(beats, totalSegments);` with `const segments = packBeatsIntoWindows(beats, args.genArgs.videoModel && /seedance/i.test(args.genArgs.videoModel) ? 15 : 8, totalSegments);` and update both `buildSegmentPrompt(genArgs, segments[0], 0, 1, clipDurations[0])` and the loop call `buildSegmentPrompt(genArgs, segments[i], i, segments.length, prevLastBeat, clipDurations[i])` to pass the voice profile:

```ts
  const voiceProfile = buildVoiceProfile({
    agentName: genArgs.agentName, agentNiche: genArgs.agentNiche,
    agentArchetype: genArgs.agentArchetype, voiceArchetype: genArgs.voiceArchetype,
    personality: genArgs.personality,
  });
  // single-clip:
  const prompt = buildSegmentPrompt(genArgs, segments[0], 0, 1, voiceProfile, undefined, clipDurations[0]);
  // loop:
  const prompt = buildSegmentPrompt(genArgs, segments[i], i, segments.length, voiceProfile, prevLastBeat, clipDurations[i]);
```

- [ ] **Step 5: Typecheck the pipeline end-to-end**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "kie-video-pipeline|videoSegmentation" | head`
Expected: no errors from these files.

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run lib/server/videoSegmentation.test.ts lib/builder/videoEstimation.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/server/kie-video-pipeline.ts
git commit -m "feat(video): drive segments by time windows + voice profile end-to-end"
```

---

## Task 6: Script generator targets the chosen duration

**Files:**
- Modify: `lib/server/videoScript.ts`

- [ ] **Step 1: Add `targetSeconds` to the options + compute a word target**

In `generateVideoScript`, change the signature options to:

```ts
  opts: { topic?: string; apiKey?: string; targetSeconds?: number },
```

After `const language = agent.language || "English";` add:

```ts
  // Target the requested duration: ~2.5 words/sec. Each Veo window is 8s.
  const targetSeconds = opts.targetSeconds && opts.targetSeconds >= 8 ? Math.round(opts.targetSeconds) : 24;
  const targetWords = Math.round(targetSeconds * 2.5);
  const windowCount = Math.max(1, Math.round(targetSeconds / 8));
  const lowWords = Math.round(targetWords * 0.85);
  const highWords = Math.round(targetWords * 1.15);
```

- [ ] **Step 2: Make the prompt request the scaled length + distinct windows**

Replace RULES line 2 and the JSON `script` field hint:

```ts
// in the RULES block, replace the "Script = ... 50-80 words (~20-32s)" line with:
2. Script = the first-person monologue the creator speaks, in ${language}, ${lowWords}-${highWords} words (~${targetSeconds}s). It will be split into ${windowCount} sequential 8-second windows — write it as ${windowCount} distinct beats that each move the story forward. NEVER repeat or restate a line; every window must contain NEW words.
```

And update the JSON example field:

```ts
  "script": "${lowWords}-${highWords} word first-person monologue in ${language}, ${windowCount} distinct 8s beats, no repeated lines",
```

- [ ] **Step 3: Scale the heuristic fallback length**

In `heuristicScript`, accept a length hint and repeat distinct sentences up to the target. Change its signature to `function heuristicScript(agent: ScriptAgent, topic: string, catchphrase: string, targetWords: number)` and build the script by joining distinct sentence templates until reaching ~targetWords (no sentence repeated):

```ts
  const sentences = [
    `Real talk about ${topic}.`,
    `Most people in ${agent.niche} overthink this.`,
    `Here's what actually works: keep it simple and stay consistent.`,
    `Double down on the one thing that moves the needle.`,
    `Skip the busywork that just feels productive.`,
    `Do that and you're already ahead of everyone still waiting for the perfect moment.`,
  ];
  let script = "";
  for (const s of sentences) {
    if (script.split(/\s+/).filter(Boolean).length >= targetWords) break;
    script += (script ? " " : "") + s;
  }
```

Update the `heuristicScript(...)` call site to pass `targetWords`.

- [ ] **Step 4: Run the build/typecheck for this file**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep videoScript | head`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/server/videoScript.ts
git commit -m "feat(video): script length + window count target the chosen duration"
```

---

## Task 7: Thread `targetSeconds` from the callers

**Files:**
- Modify: `app/api/agents/run-task/route.ts`
- Modify: `app/api/agents/video-script/route.ts`

- [ ] **Step 1: run-task — pass duration into script generation**

In `app/api/agents/run-task/route.ts`, in the `create_video` executor, the `else` branch that calls `generateVideoScript` currently passes `{ topic }`. Change it to forward the requested duration:

```ts
      const requestedSeconds = typeof input.durationSeconds === "number" ? input.durationSeconds : undefined;
      const { generateVideoScript } = await import("@/lib/server/videoScript");
      const gen = await generateVideoScript(
        { name: agent.name, niche: agent.niche, language: agent.language, archetype: agent.archetype },
        ctx,
        { topic, targetSeconds: requestedSeconds },
      );
      scriptResult = gen.raw;
```

(`requestedSeconds` is already computed lower in the function; hoist or recompute it here — recomputing is fine.)

Also pass persona voice fields into `deferVideo` so the pipeline's voice profile is accurate. Add to the `deferVideo` object:

```ts
      personality: (agent as unknown as { personality?: { warmth?: number; humor?: number; authority?: number; boldness?: number } }).personality,
      voiceArchetype: (ctx.draft?.questionnaire?.voiceArchetype as string | undefined),
```

(Confirm `VideoJobPayload` includes these fields — add them in `convex/videoJobs.ts` / the payload type if it is strongly typed; see Step 3.)

- [ ] **Step 2: video-script route — pass the requested duration**

In `app/api/agents/video-script/route.ts`, read a duration from the request body and forward it. Near the existing `generateVideoScript(` call (line ~52), change the opts to include `targetSeconds`:

```ts
    const targetSeconds = typeof body?.durationSeconds === "number" ? body.durationSeconds : undefined;
    const script = await generateVideoScript(agent, ctx, { topic, apiKey, targetSeconds });
```

(Use the route's existing parsed body variable name; if it doesn't parse `durationSeconds`, add it to the body parsing.)

- [ ] **Step 3: Extend the video job payload type (if typed)**

Run: `grep -n "personality\|voiceArchetype\|scriptText\|durationSeconds" convex/videoJobs.ts | head`
If `VideoJobPayload` (or the Convex `enqueue` args) is a typed object, add optional `personality` and `voiceArchetype` fields mirroring `GenerateVideoArgs`, and ensure the Convex render action forwards them into `generateVideoFromScript`. If the payload is loosely typed/`v.any()`, no change needed.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "run-task|video-script|videoJobs" | head`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/agents/run-task/route.ts app/api/agents/video-script/route.ts convex/videoJobs.ts
git commit -m "feat(video): forward target duration + voice persona to script + render"
```

---

## Task 8: UI copy for the Veo-aligned selector

**Files:**
- Modify: `components/builder/AgentWorkspace.tsx:1569-1571`

- [ ] **Step 1: Update the helper copy**

Replace the paragraph at `AgentWorkspace.tsx:1569-1571`:

```tsx
            <p className="text-[12px] text-zinc-600 leading-relaxed flex-1 min-w-[200px]">
              Each step is one 8-second Veo clip — <span className="font-bold text-zinc-900">{IDEAL_VIDEO_SECONDS}s</span> ({IDEAL_VIDEO_SECONDS / 8} clips) is a strong default. Longer videos chain more clips, each with its own distinct lines.
            </p>
```

- [ ] **Step 2: Verify the page builds**

Run: `npm run build 2>&1 | grep -E "Failed|error" | grep -iv bigint | head`
Expected: no errors. (Full build also exercises the modified routes.)

- [ ] **Step 3: Commit**

```bash
git add components/builder/AgentWorkspace.tsx
git commit -m "feat(video): selector copy for 8s-aligned lengths"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all suites PASS (incl. `videoSegmentation.test.ts`, `videoEstimation.test.ts`).

- [ ] **Step 2: Typecheck the whole app**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: exit 0 (ignore the pre-existing `bigint` native-binding warning).

- [ ] **Step 4: Final commit (if anything was adjusted)**

```bash
git add -A
git commit -m "test(video): full suite green for unique-segment + voice changes"
```

---

## Self-Review Notes

- **Spec coverage:** §1 lengths → Task 1/8; §2 script target → Task 6/7; §3 packBeatsIntoWindows → Task 2 (+Task 5 wiring); §4 per-window prompt → Task 4; §5 voice profile → Task 3 (+Task 5 wiring); §6 planStoryWithClaude alignment → Task 5; testing → Task 2/3/9.
- **No duplication invariant** is explicitly tested (Task 2, Step 1).
- **Type consistency:** `packBeatsIntoWindows(beats, clipSeconds, maxWindows)`, `buildVoiceProfile(VoicePersona)`, `buildSegmentPrompt(args, segBeats, segmentIndex, totalSegments, voiceProfile, prevSegmentLastBeat?, clipSeconds?)` used identically across tasks.
- **Open verification during execution:** confirm the operator-selected `videoSeconds` actually reaches `input.durationSeconds` on the create_video task (AgentWorkspace ~1860 → task dispatch). If it does not, add a task to pass it through; the pipeline already falls back to script estimation, so behaviour degrades gracefully if missed.
