# Creative Video Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make builder-generated videos identity-locked, format-varied, and grounded in the agent's brain (docs + memory + installed skills), with the storyboard faithfully following the generated script + persona.

**Architecture:** Three new server helpers feed the existing script→storyboard→Veo pipeline: `characterRefs` (static identity references), `agentBrain` (docs+memory+skills), `creativeDirector` (LLM picks a varied format/angle). The `create_video` executor assembles brain → brief → script; the pipeline uses static refs and a storyboard that breaks the existing script into near-verbatim beats rendered for the chosen format.

**Tech Stack:** TypeScript, Next.js 16, Convex, Vitest (edge-runtime), Kie/Claude, Veo 3.1.

---

## File Structure

- Create: `lib/server/characterRefs.ts` — pick static identity refs from the avatar set.
- Create: `lib/server/characterRefs.test.ts`
- Create: `lib/server/agentBrain.ts` — assemble {knowledge, memories, skills} (custom skills included).
- Create: `lib/server/agentBrain.test.ts`
- Create: `lib/server/creativeDirector.ts` — `planCreativeBrief` (LLM, varied format) + fallback.
- Create: `lib/server/creativeDirector.test.ts`
- Modify: `lib/server/kie-video-pipeline.ts` — use static refs + always reference-mode; storyboard follows script + brief.
- Modify: `lib/server/videoScript.ts` — accept `brief` + `skills`; write for the format.
- Modify: `app/api/agents/run-task/route.ts` — build brain → brief → script; thread `avatarUrls` + `creativeBrief`.
- Modify: `convex/videoJobs.ts` — payload: `avatarUrls`, `creativeBrief`.

---

## Task 1: characterRefs — static identity references

**Files:**
- Create: `lib/server/characterRefs.ts`
- Test: `lib/server/characterRefs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveCharacterRefs } from "./characterRefs";

describe("resolveCharacterRefs", () => {
  it("prefers static images over a GIF avatar and caps at 3", () => {
    const r = resolveCharacterRefs(
      "https://x/gifs/a.gif",
      ["https://x/1.png", "https://x/2.jpg", "https://x/3.webp", "https://x/4.png"],
    );
    expect(r.refs).toEqual(["https://x/1.png", "https://x/2.jpg", "https://x/3.webp"]);
    expect(r.note).toBeUndefined();
  });

  it("dedupes and keeps the primary static avatar first", () => {
    const r = resolveCharacterRefs("https://x/1.png", ["https://x/1.png", "https://x/2.png"]);
    expect(r.refs).toEqual(["https://x/1.png", "https://x/2.png"]);
  });

  it("GIF-only → returns the gif with a static-avatar note", () => {
    const r = resolveCharacterRefs("https://x/a.gif", ["https://x/b.gif"]);
    expect(r.refs).toEqual(["https://x/a.gif"]);
    expect(r.note).toMatch(/static avatar/i);
  });

  it("no usable image → empty refs + note", () => {
    const r = resolveCharacterRefs("", []);
    expect(r.refs).toEqual([]);
    expect(r.note).toMatch(/identity may drift/i);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npx vitest run lib/server/characterRefs.test.ts`
Expected: FAIL — "Cannot find module './characterRefs'".

- [ ] **Step 3: Implement**

Create `lib/server/characterRefs.ts`:

```ts
/**
 * Resolve up to 3 STATIC character reference images for Veo's REFERENCE_2_VIDEO
 * mode. The minted avatar set is generated as static PNGs; the avatarUrl may be
 * an animated GIF display variant that Veo can't lock onto well. We prefer the
 * statics so the rendered character matches the agent.
 */
const STATIC_RE = /\.(png|jpe?g|webp)(\?|#|$)/i;
const GIF_RE = /\.gif(\?|#|$)/i;
const HTTP_RE = /^https?:\/\//i;

export interface CharacterRefs {
  refs: string[];
  note?: string;
}

export function resolveCharacterRefs(avatarUrl: string, avatarUrls: string[] = []): CharacterRefs {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const u of [avatarUrl, ...avatarUrls]) {
    const url = (u ?? "").trim();
    if (!url || !HTTP_RE.test(url) || seen.has(url)) continue;
    seen.add(url);
    candidates.push(url);
  }

  const statics = candidates.filter((u) => STATIC_RE.test(u));
  if (statics.length > 0) return { refs: statics.slice(0, 3) };

  const gifs = candidates.filter((u) => GIF_RE.test(u));
  if (gifs.length > 0) {
    return {
      refs: [gifs[0]],
      note: "avatar is animated — set a static avatar for the tightest identity lock",
    };
  }

  // Any remaining http images (unknown extension) — use them; else nothing.
  if (candidates.length > 0) return { refs: candidates.slice(0, 3) };
  return { refs: [], note: "no reference image — identity may drift" };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/server/characterRefs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/characterRefs.ts lib/server/characterRefs.test.ts
git commit -m "feat(video): static character references for identity lock"
```

---

## Task 2: agentBrain — docs + memory + installed skills

**Files:**
- Create: `lib/server/agentBrain.ts`
- Test: `lib/server/agentBrain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildAgentBrain } from "./agentBrain";

const KN = [
  { title: "Brand voice", content: "warm, witty, Malaysian context", tags: ["voice"] },
  { title: "Nasi lemak facts", content: "coconut rice dish", tags: ["food"] },
];
const MEM = [{ kind: "lesson", summary: "hooks under 3s win", importance: 80 }];
const SKILLS = [{ name: "Malay Voice", instructions: "use lah/kan, KL slang" }];

describe("buildAgentBrain", () => {
  it("always includes installed skills", () => {
    const b = buildAgentBrain({ topic: "anything", knowledge: KN, memories: MEM, skills: SKILLS });
    expect(b.skills).toHaveLength(1);
    expect(b.skills[0].name).toBe("Malay Voice");
  });

  it("ranks knowledge by topic relevance first", () => {
    const b = buildAgentBrain({ topic: "nasi lemak food", knowledge: KN, memories: MEM, skills: [] });
    expect(b.knowledge[0].title).toBe("Nasi lemak facts");
  });

  it("works with empty brain", () => {
    const b = buildAgentBrain({ topic: "x", knowledge: [], memories: [], skills: [] });
    expect(b.knowledge).toEqual([]);
    expect(b.skills).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npx vitest run lib/server/agentBrain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/server/agentBrain.ts`:

```ts
export interface BrainKnowledge { title: string; content: string; tags?: string[] }
export interface BrainMemory { kind: string; summary: string; importance: number }
export interface BrainSkill { name: string; instructions: string }

export interface AgentBrain {
  knowledge: BrainKnowledge[];
  memories: BrainMemory[];
  skills: BrainSkill[];
}

/**
 * Assemble the agent's "brain" for creative generation: knowledge ranked by
 * relevance to the topic (then kept compact), recent memories, and ALL installed
 * skills (catalog + custom). Pure — callers fetch the raw data.
 */
export function buildAgentBrain(args: {
  topic: string;
  knowledge: BrainKnowledge[];
  memories: BrainMemory[];
  skills: BrainSkill[];
}): AgentBrain {
  const words = args.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const score = (k: BrainKnowledge) => {
    const blob = `${k.title} ${k.content} ${(k.tags ?? []).join(" ")}`.toLowerCase();
    return words.reduce((n, w) => (blob.includes(w) ? n + 1 : n), 0);
  };
  const knowledge = [...args.knowledge]
    .map((k) => ({ k, s: score(k) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 6)
    .map(({ k }) => k);

  const memories = [...args.memories]
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 6);

  // Skills are ALWAYS included — they define the agent's operating style.
  const skills = args.skills.filter((s) => s.name && s.instructions).slice(0, 8);

  return { knowledge, memories, skills };
}

/** Render the brain into a compact prompt block for the director + script. */
export function brainToPromptBlock(brain: AgentBrain): string {
  const k = brain.knowledge.map((x) => `- ${x.title}: ${x.content.slice(0, 200).replace(/\s+/g, " ").trim()}`).join("\n");
  const m = brain.memories.map((x) => `- [${x.kind}] ${x.summary}`).join("\n");
  const s = brain.skills.map((x) => `- ${x.name}: ${x.instructions.slice(0, 240).replace(/\s+/g, " ").trim()}`).join("\n");
  return [
    k ? `KNOWLEDGE BASE (cite these — don't invent):\n${k}` : "",
    s ? `ACTIVE SKILLS (operating style — obey these):\n${s}` : "",
    m ? `MEMORIES (lessons/preferences):\n${m}` : "",
  ].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/server/agentBrain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/agentBrain.ts lib/server/agentBrain.test.ts
git commit -m "feat(video): agentBrain — rank docs + memory + always include skills"
```

---

## Task 3: creativeDirector — varied format + plot

**Files:**
- Create: `lib/server/creativeDirector.ts`
- Test: `lib/server/creativeDirector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { VIDEO_FORMATS, fallbackBrief } from "./creativeDirector";

describe("creativeDirector fallback (no LLM)", () => {
  it("rotates to a format NOT used by the last video", () => {
    const b = fallbackBrief({
      niche: "food", contentPillars: ["recipes", "street food"],
      videoFormats: ["tutorial", "day_in_life"], lastFormat: "tutorial",
    });
    expect(b.format).toBe("day_in_life");
    expect(VIDEO_FORMATS).toContain(b.format);
    expect(b.topic.length).toBeGreaterThan(0);
  });

  it("falls back to the global format list when persona has none", () => {
    const b = fallbackBrief({ niche: "tech", contentPillars: [], videoFormats: [], lastFormat: "talking_head" });
    expect(b.format).not.toBe("talking_head");
    expect(VIDEO_FORMATS).toContain(b.format);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npx vitest run lib/server/creativeDirector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/server/creativeDirector.ts`:

```ts
import { callClaudeJSON } from "./kie-claude";
import { brainToPromptBlock, type AgentBrain } from "./agentBrain";

export const VIDEO_FORMATS = [
  "talking_head", "storytelling", "tutorial", "pov", "listicle",
  "day_in_life", "reaction", "hot_take", "b_roll_voiceover",
] as const;
export type VideoFormat = string;

export interface CreativeBrief {
  format: VideoFormat;
  angle: string;
  topic: string;
  structureNotes: string;
  visualTreatment: string;
}

export interface DirectorPersona {
  name: string;
  niche: string;
  archetype?: string;
  voiceArchetype?: string;
  language?: string;
  contentPillars: string[];
  videoFormats: string[];
}

/** Deterministic fallback — rotate to a fresh format and a content-pillar topic. */
export function fallbackBrief(args: {
  niche: string; contentPillars: string[]; videoFormats: string[]; lastFormat?: string;
}): CreativeBrief {
  const pool = (args.videoFormats.length ? args.videoFormats : [...VIDEO_FORMATS])
    .filter((f) => f !== args.lastFormat);
  const format = pool[0] ?? VIDEO_FORMATS.find((f) => f !== args.lastFormat) ?? "storytelling";
  const topic = args.contentPillars[0] ?? `${args.niche} insight`;
  return {
    format,
    angle: `A fresh ${format} take on ${topic}`,
    topic,
    structureNotes: `Structure the beats for a ${format} video.`,
    visualTreatment: `On-brand ${args.niche} setting, natural lighting, scroll-stopping framing.`,
  };
}

/**
 * Pick a DISTINCT video format + plot for this render, grounded in the persona's
 * taste (videoFormats) + brain, and different from recent videos. LLM-driven;
 * falls back to a deterministic rotation if the model is unavailable.
 */
export async function planCreativeBrief(args: {
  persona: DirectorPersona;
  brain: AgentBrain;
  recentFormats: string[];   // formats of the last few videos
  seedTopic?: string;
  apiKey?: string;
}): Promise<CreativeBrief> {
  const { persona, brain, recentFormats } = args;
  const lastFormat = recentFormats[0];

  const system = `You are the creative director for an AI influencer on Vello. Choose ONE concrete video FORMAT and a fresh plot for the next short-form video. Reply with ONLY a JSON object — no prose, no code fences.`;
  const user = `CREATOR: ${persona.name} — ${persona.archetype ?? "creator"} in the ${persona.niche} niche, ${persona.voiceArchetype ?? "expert"} voice${persona.language ? `, posts in ${persona.language}` : ""}.
CONTENT PILLARS: ${persona.contentPillars.join(", ") || "(none)"}
PREFERRED FORMATS (the operator's taste — choose within these when possible): ${persona.videoFormats.join(", ") || "(any)"}
RECENT VIDEO FORMATS (do NOT repeat these): ${recentFormats.join(", ") || "(none yet)"}
${args.seedTopic ? `REQUESTED TOPIC: ${args.seedTopic}\n` : ""}
${brainToPromptBlock(brain)}

Allowed formats: ${VIDEO_FORMATS.join(", ")}.
Pick a format that fits the creator's preferred formats AND is different from the recent ones above. Invent a SPECIFIC fresh angle/plot grounded in the knowledge + skills + pillars. Return ONLY:
{ "format": "one of the allowed formats", "angle": "the specific creative angle/plot", "topic": "concise topic", "structureNotes": "how the beats should flow for this format", "visualTreatment": "setting, camera, energy, aesthetic" }`;

  try {
    const raw = await callClaudeJSON<Partial<CreativeBrief>>({ system, user, maxTokens: 700, apiKey: args.apiKey });
    const format = typeof raw.format === "string" && (VIDEO_FORMATS as readonly string[]).includes(raw.format)
      ? raw.format : undefined;
    if (format && format !== lastFormat && typeof raw.topic === "string" && raw.topic.trim()) {
      return {
        format,
        angle: String(raw.angle ?? `${format} on ${raw.topic}`).slice(0, 240),
        topic: String(raw.topic).slice(0, 120),
        structureNotes: String(raw.structureNotes ?? "").slice(0, 400),
        visualTreatment: String(raw.visualTreatment ?? "").slice(0, 400),
      };
    }
  } catch { /* fall through */ }

  return fallbackBrief({
    niche: persona.niche, contentPillars: persona.contentPillars,
    videoFormats: persona.videoFormats, lastFormat,
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/server/creativeDirector.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/creativeDirector.ts lib/server/creativeDirector.test.ts
git commit -m "feat(video): creative director — varied format/plot per video"
```

---

## Task 4: videoScript writes for the brief + skills

**Files:**
- Modify: `lib/server/videoScript.ts`

- [ ] **Step 1: Add a `brief` + `skills` option to `generateVideoScript`**

In `lib/server/videoScript.ts`, change the `opts` parameter type of `generateVideoScript`:

```ts
  opts: {
    topic?: string;
    apiKey?: string;
    targetSeconds?: number;
    brief?: { format: string; angle: string; structureNotes?: string };
    skills?: Array<{ name: string; instructions: string }>;
  },
```

- [ ] **Step 2: Inject the brief + skills into the prompt**

In the `user` prompt string (after the existing `RULES` heading and before the JSON example), the script is currently format-agnostic. Add a FORMAT block. Find the line that begins the RULES list and insert, just before it:

```ts
const briefBlock = opts.brief
  ? `\nVIDEO FORMAT: ${opts.brief.format} — ${opts.brief.angle}\n${opts.brief.structureNotes ? `Structure: ${opts.brief.structureNotes}\n` : ""}Write the monologue to fit THIS format (not a generic talking-head).\n`
  : "";
const skillsBlock = (opts.skills?.length)
  ? `\nACTIVE SKILLS (obey these — they define the creator's style/voice):\n${opts.skills.map((s) => `- ${s.name}: ${s.instructions.slice(0, 240)}`).join("\n")}\n`
  : "";
```

Then insert `${briefBlock}${skillsBlock}` into the `user` template string right after the `TOPIC: "${topic}"` line.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep videoScript`
Expected: empty.

- [ ] **Step 4: Run suite (no regression)**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add lib/server/videoScript.ts
git commit -m "feat(video): script written for the creative brief format + active skills"
```

---

## Task 5: pipeline — static identity refs + storyboard follows script + brief

**Files:**
- Modify: `lib/server/kie-video-pipeline.ts`

- [ ] **Step 1: Add `avatarUrls` + `creativeBrief` to `GenerateVideoArgs`**

In the `GenerateVideoArgs` interface (after `referenceImageUrls?`):

```ts
  /** Full static avatar set — used to pick identity references. */
  avatarUrls?: string[];
  /** Creative brief — the format/angle this video should follow. */
  creativeBrief?: { format: string; angle: string; structureNotes?: string; visualTreatment?: string };
```

- [ ] **Step 2: Use static refs in `generateVideoFromScript`**

Add the import at the top:

```ts
import { resolveCharacterRefs } from "./characterRefs";
```

Replace the existing `refImages` construction:

```ts
  const refImages = [args.avatarUrl, ...(args.referenceImageUrls ?? [])]
    .filter((u, i, arr) => u && /^https?:\/\//i.test(u) && arr.indexOf(u) === i)
    .slice(0, 3);
```

with:

```ts
  // Identity lock: prefer STATIC images from the avatar set (the avatar may be an
  // animated GIF Veo can't lock onto). resolveCharacterRefs picks up to 3 statics.
  const charRefs = resolveCharacterRefs(args.avatarUrl, [
    ...(args.avatarUrls ?? []),
    ...(args.referenceImageUrls ?? []),
  ]);
  const refImages = charRefs.refs;
  if (charRefs.note && !videoNote) videoNote = charRefs.note;
```

(`videoNote` is already declared `let` in this function.)

- [ ] **Step 3: Pass the brief into the storyboard planner call**

Find `const planned = await planStoryWithClaude(args, totalSegments);` — no change to the call (the brief is on `args`). Continue to Step 4.

- [ ] **Step 4: Reframe `planStoryWithClaude` to FOLLOW the script + persona + format**

In `planStoryWithClaude`, the `system` prompt currently asks the model to PLAN beats (it can drift / rewrite). Add a brief-aware, script-faithful directive. After the `const lang = ...` line, add:

```ts
  const brief = args.creativeBrief;
  const formatBlock = brief
    ? `\nVIDEO FORMAT: ${brief.format} — ${brief.angle}.${brief.structureNotes ? ` Beat flow: ${brief.structureNotes}.` : ""}${brief.visualTreatment ? ` Visual treatment: ${brief.visualTreatment}.` : ""}\nRender the VISUALS for this format (not a generic talking-head).`
    : "";
```

In the `system` STORY PRINCIPLES list, add as the FIRST principle:

```
- FOLLOW THE SCRIPT EXACTLY. You are storyboarding an EXISTING script — do NOT rewrite, paraphrase, or invent new lines. Each beat's "voiceover" MUST be a contiguous slice of the FULL SCRIPT below, in order, same words, same language. Cover the whole script across the beats.
```

And append `${formatBlock}` to the end of the `user` prompt string (after the existing final instruction line).

- [ ] **Step 5: Typecheck the pipeline**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "kie-video-pipeline"`
Expected: empty.

- [ ] **Step 6: Run unit tests**

Run: `npx vitest run lib/server/videoSegmentation.test.ts lib/server/characterRefs.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/server/kie-video-pipeline.ts
git commit -m "feat(video): static identity refs + storyboard follows script & brief"
```

---

## Task 6: create_video executor — brain → brief → script

**Files:**
- Modify: `app/api/agents/run-task/route.ts`

- [ ] **Step 1: Build brain + brief before generating the script (else branch)**

In the `create_video` executor, the `else` branch currently calls `generateVideoScript({ name, niche, language, archetype }, ctx, { topic, targetSeconds })`. Replace that else branch body with:

```ts
      const reqSeconds = typeof input.durationSeconds === "number" ? input.durationSeconds : undefined;
      const { buildAgentBrain } = await import("@/lib/server/agentBrain");
      const { planCreativeBrief } = await import("@/lib/server/creativeDirector");

      // Custom-skill instructions: knowledge entries this agent has of category "skill".
      const skills = ctx.knowledge
        .filter((k) => (k.category ?? "") === "skill" || /^skill:/i.test(k.title))
        .map((k) => ({ name: k.title.replace(/^skill:\s*/i, ""), instructions: k.content }));

      const q = ctx.draft?.questionnaire ?? {};
      const brain = buildAgentBrain({
        topic,
        knowledge: ctx.knowledge.map((k) => ({ title: k.title, content: k.content, tags: k.tags })),
        memories: ctx.memories,
        skills,
      });
      const recentFormats = ctx.memories
        .map((m) => (m.summary.match(/format[:=]\s*([a-z_]+)/i)?.[1] ?? ""))
        .filter(Boolean);
      const brief = await planCreativeBrief({
        persona: {
          name: agent.name, niche: agent.niche, archetype: agent.archetype,
          voiceArchetype: q.voiceArchetype as string | undefined,
          language: agent.language,
          contentPillars: Array.isArray(q.contentPillars) ? (q.contentPillars as string[]) : [],
          videoFormats: Array.isArray(q.videoFormats) ? (q.videoFormats as string[]) : [],
        },
        brain,
        recentFormats,
        seedTopic: typeof input.topic === "string" ? input.topic : undefined,
      });

      const { generateVideoScript } = await import("@/lib/server/videoScript");
      const gen = await generateVideoScript(
        { name: agent.name, niche: agent.niche, language: agent.language, archetype: agent.archetype },
        ctx,
        { topic: brief.topic, targetSeconds: reqSeconds, brief, skills },
      );
      scriptResult = gen.raw;
      // Stash the brief so deferVideo + memory can use it.
      (scriptResult as Record<string, unknown>)._brief = brief;
```

- [ ] **Step 2: Thread `avatarUrls` + `creativeBrief` into `deferVideo`**

In the `deferVideo` object, after `referenceImageUrls: extraRefs,` add:

```ts
      avatarUrls: (((ctx.draft as unknown as { avatarUrls?: string[] })?.avatarUrls) ?? []).filter((u) => /^https?:\/\//i.test(u)),
      creativeBrief: (scriptResult as Record<string, unknown>)._brief as VideoJobPayload["creativeBrief"],
```

- [ ] **Step 3: Add the fields to `VideoJobPayload`**

In `VideoJobPayload` (after `language?: string;`):

```ts
  avatarUrls?: string[];
  creativeBrief?: { format: string; angle: string; structureNotes?: string; visualTreatment?: string };
```

- [ ] **Step 4: Record the format in memory (so next time varies)**

The `create_video` executor's returned `memory.summary` should include the format. Find the create_video success return's `memory: { kind, summary, importance }` and ensure the summary appends ` format:${brief.format}` — e.g. change the summary to include `format:${(scriptResult as Record<string, unknown>)._brief ? ((scriptResult as Record<string, unknown>)._brief as { format: string }).format : "talking_head"}`. (Keep it simple: append `\` format:${brief.format}\`` to the existing summary string where `brief` is in scope.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "run-task"`
Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add app/api/agents/run-task/route.ts
git commit -m "feat(video): create_video builds brain → creative brief → grounded script"
```

---

## Task 7: Convex payload — avatarUrls + creativeBrief

**Files:**
- Modify: `convex/videoJobs.ts`

- [ ] **Step 1: Add the validator fields**

In `convex/videoJobs.ts`, in the `videoPayload = v.object({ ... })`, after `language: v.optional(v.string()),` add:

```ts
  avatarUrls: v.optional(v.array(v.string())),
  creativeBrief: v.optional(v.object({
    format: v.string(),
    angle: v.string(),
    structureNotes: v.optional(v.string()),
    visualTreatment: v.optional(v.string()),
  })),
```

The `generate` action already spreads `...args.video` into `generateVideoFromScript`, so `avatarUrls` + `creativeBrief` flow through automatically.

- [ ] **Step 2: Codegen + typecheck**

Run: `npx convex codegen && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "videoJobs|run-task"`
Expected: codegen exit 0; grep empty.

- [ ] **Step 3: Commit**

```bash
git add convex/videoJobs.ts
git commit -m "feat(video): carry avatarUrls + creativeBrief through the video job"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all suites pass (incl. `characterRefs`, `agentBrain`, `creativeDirector`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json ; echo EXIT=$?`
Expected: `EXIT=0`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: exit 0 (ignore the pre-existing `bigint` warning).

- [ ] **Step 4: Final commit (if anything adjusted)**

```bash
git add -A && git commit -m "test(video): creative engine suite green"
```

---

## Self-Review Notes

- **Spec coverage:** Pillar 1 identity → Task 1 + Task 5 (refs) + Task 6/7 (wiring); Pillar 2 director → Task 3 + Task 6; Pillar 3 brain → Task 2 + Task 6; storyboard-follows-script → Task 5 Step 4; persona/format in script → Task 4; testing → Tasks 1/2/3/8.
- **Type consistency:** `CreativeBrief { format, angle, topic, structureNotes, visualTreatment }` used identically in creativeDirector, videoScript opts (subset), pipeline `creativeBrief`, and Convex validator. `resolveCharacterRefs(avatarUrl, avatarUrls)` consistent. `buildAgentBrain({topic, knowledge, memories, skills})` consistent.
- **Open verification during execution:** confirm `ctx.knowledge` entries carry `category`/`tags` (Task 6 Step 1 filters skill entries by `category === "skill"`, which is how the create_skill handler saves them). If `ctx.knowledge` lacks `category`, fall back to the `Skill:`-title match (already included).
- `git add -A` in Task 8 Step 4: there are unrelated uncommitted files in the repo — prefer adding only the plan's files; only use `-A` if the working tree is clean of unrelated changes (it may not be — add specific files instead).
