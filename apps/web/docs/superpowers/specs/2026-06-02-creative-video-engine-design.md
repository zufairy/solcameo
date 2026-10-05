# Creative Engine for Video Generation — Design (Vello)

Date: 2026-06-02
App: `apps/vello`
Area: builder AI-influencer video generation (script → storyboard → Veo clips)

## Problem

Generated videos (1) don't follow the agent's identity, (2) all look the same, and
(3) aren't grounded in the agent's programmed brain. Concretely:

- **Identity:** the agent's avatar is an animated GIF; the pipeline's gif filter
  drops it → Veo runs `TEXT_2_VIDEO` (no character reference) → the character in
  the video isn't the agent.
- **Sameness:** the storyboard is always the same hook→payoff talking-head; it
  ignores the persona's `videoFormats` taste, so every video has the same plot
  and visual treatment.
- **Grounding:** the script uses only a small topic-filtered slice of knowledge
  and ignores the agent's installed skills (incl. custom-engineered ones).
- **Storyboard fidelity:** the storyboard can drift from the actual script and
  persona.

## Goal

A creative engine that produces **identity-locked**, **format-varied**,
**brain-grounded** videos where the **storyboard faithfully follows the generated
script and the persona**. Each agent's content is unique to its programming and no
two videos look the same.

## Decisions (confirmed)

- Variety driver: **LLM creative director** picks a distinct format + plot each
  video, grounded in persona + the operator's `videoFormats` taste, avoiding
  recent repeats.
- Identity: **use static avatar frames** — always pass the static images from the
  avatar set in `REFERENCE_2_VIDEO`; never fall to text mode when a reference
  exists. (GIF-only avatars use the GIF with a "set a static avatar" note;
  server-side frame extraction is a future enhancement.)
- Grounding: **docs + memory + installed skills** — always inject the agent's
  installed skills (catalog + custom) into the director and the script.
- Build **both pillars** in one effort. The **storyboard must follow the script
  and the persona**.

## Architecture — data flow

```
create_video task
  → buildAgentBrain(agent, ctx)            // docs + memory + installed skills
  → planCreativeBrief(persona, brain)      // LLM: { format, angle, topic, structureNotes, visualTreatment } — varied
  → generateVideoScript(brief, brain)      // script written FOR that format/angle, in persona language, citing docs/skills
  → resolveCharacterRefs(avatarUrl, avatarUrls)  // 1–3 STATIC identity refs (GIF→still)
  → planStoryWithClaude(script, brief, persona)  // storyboard FOLLOWS the script + persona + format
  → Veo clips (REFERENCE_2_VIDEO, identity + voice lock) → stitch → autoPost
```

## Pillar 1 — Identity lock (static character reference)

### `lib/server/characterRefs.ts` (new)
- `resolveCharacterRefs(avatarUrl: string, avatarUrls?: string[]): { refs: string[]; note?: string }`
  - Collect candidates: `[avatarUrl, ...avatarUrls]`, http(s) only, deduped.
  - **Primary path:** return up to 3 **static** images (`.png|.jpg|.jpeg|.webp`).
    The minted avatar set (`avatarUrls`) is generated as static PNGs — the GIF is
    only the animated display variant — so statics almost always exist here. This
    is a pure function (no network) and is the main fix.
  - **GIF-only fallback:** if EVERY candidate is a GIF, return the GIF as a single
    ref with `note: "avatar is animated — set a static avatar for the tightest
    identity lock"`. (Veo can still reference a GIF, just less reliably; we don't
    block.) A future enhancement can add server-side frame extraction, but it's
    out of scope here — the static-set path covers the real case.
  - Empty/no usable images → `{ refs: [], note: "no reference image — identity may drift" }`.

### `kie-video-pipeline.ts`
- Replace the inline gif-drop in `generateVeo3Video` with the resolved **static**
  refs passed in from `generateVideoFromScript` (which calls `resolveCharacterRefs`).
- When ≥1 static ref exists, **force `REFERENCE_2_VIDEO` + veo3_fast** and keep
  the refs on the first clip; extends inherit. **Never** silently drop to
  `TEXT_2_VIDEO` when a reference exists.
- Thread `avatarUrls` through `GenerateVideoArgs`.

### Wiring
- run-task `deferVideo` + `VideoJobPayload` + Convex `videoPayload`: add
  `avatarUrls: string[]` (from `ctx.draft.avatarUrls` / agent record).

## Pillar 2 — Creative Director (format + plot variety)

### `lib/server/creativeDirector.ts` (new)
- `FORMATS = ["talking_head","storytelling","tutorial","pov","listicle","day_in_life","reaction","skit","hot_take","b_roll_voiceover"]`.
- `planCreativeBrief(args): Promise<CreativeBrief>` where
  `CreativeBrief = { format: string; angle: string; topic: string; structureNotes: string; visualTreatment: string }`.
  - Inputs: persona (name, niche, archetype, voiceArchetype, language,
    contentPillars, **videoFormats taste**), the agent **brain** (Pillar 3),
    recent video memories (format+topic of last N videos), an optional seed topic.
  - LLM prompt instructs: pick a `format` that fits the persona's configured
    `videoFormats` AND is **different from the last 2–3 videos**; invent a fresh
    `angle`/plot; ground `topic` in knowledge/skills; describe `structureNotes`
    (how beats flow for this format) and `visualTreatment` (setting, camera,
    energy). Return ONLY JSON.
  - Fallback (LLM fails): rotate to the next of the persona's `videoFormats`
    (deterministic) with a topic from content pillars → variety still happens.
- Unit-testable: validation + **does-not-repeat-last-format** given recent history.

## Pillar 3 — Brain grounding (docs + memory + skills)

### `lib/server/agentBrain.ts` (new)
- `buildAgentBrain(args): AgentBrain` where
  `AgentBrain = { knowledge: {title,content}[]; memories: {kind,summary,importance}[]; skills: {name,instructions}[] }`.
  - **Knowledge:** rank the agent's `agentKnowledge` entries by relevance to the
    brief's topic/angle (keyword overlap) + recency, take top ~6 (more than today).
  - **Memories:** recent episodic memories (already in `ctx.memories`).
  - **Skills:** the agent's `installedSkills`. For **custom** skills, pull their
    markdown from `agentSkillFiles` (already saved) and surface as active
    operating style (e.g. the Malay voice skill). Catalog skills → their catalog
    description.
- Used by the creative director (format/angle) and the script generator.

## Storyboard follows script + persona

### `kie-video-pipeline.ts` `planStoryWithClaude`
- Accept the `CreativeBrief` + persona language (already added).
- The director prompt is reframed: **"You are storyboarding an EXISTING script —
  do not rewrite it. Break THIS script into beats; each beat's `voiceover` must be
  a verbatim/near-verbatim slice of the script (same words, same order, same
  language). Render the visuals for the `${format}` format using `structureNotes`
  + `visualTreatment`, staying in the persona's character + aesthetic."**
- This guarantees the storyboard follows the script (no drift) and the persona,
  and adapts the VISUALS to the chosen format (variety) while keeping the spoken
  words exactly as scripted.

## Error handling

- No static images at all (GIF-only) → use the GIF as a reference (Veo still
  references it) and surface a `videoNote` "set a static avatar for the tightest
  identity lock." Only when there is NO usable image do we proceed `TEXT_2_VIDEO`.
  Never hard-block.
- Creative director LLM fails → deterministic format rotation from persona
  `videoFormats`.
- Brain empty (no docs/skills) → persona-only; still varied via the director.
- All existing time-budget / retry / language guards remain.

## Testing

- `characterRefs.test.ts`: prefers static over gif; dedups; caps at 3; gif-only →
  returns the gif with a clear note; no usable image → empty refs + note.
- `creativeDirector.test.ts`: validates brief shape; **format differs from the
  last video's format**; fallback rotates `videoFormats`.
- `agentBrain.test.ts`: installed skills ALWAYS included; knowledge ranked;
  custom-skill markdown surfaced.
- Storyboard-follows-script is prompt-level (manual verify): rendered voiceovers
  match the script words.

## Build order

1. **Pillar 1 — Identity lock** (`characterRefs` + pipeline ref mode + wiring) — fixes "doesn't follow identity" fast.
2. **Pillar 3 — Brain** (`agentBrain`).
3. **Pillar 2 — Creative Director** (`creativeDirector`) + wire brief into script + storyboard.
4. **Storyboard fidelity** — reframe `planStoryWithClaude` to follow the script + persona + format.
5. Wiring (run-task/videoJobs payload: `avatarUrls`, `creativeBrief`) + verify.

## Out of scope

- No change to the Veo/Kie polling, stitching, or autoPost (already done).
- No new persisted schema beyond payload fields (`avatarUrls`, `creativeBrief`).
- Seedance path inherits `resolveCharacterRefs` (static first frame) but no other
  Seedance changes.
