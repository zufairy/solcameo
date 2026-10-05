// Shared video-script generator.
//
// Used by BOTH the script-preview route (/api/agents/video-script) and the
// run-task create_video executor, so the script the operator confirms on the
// card is exactly what gets rendered. Grounds the script in the agent's persona,
// knowledge base, and recent video memories (continuity — builds on past videos).
//
// Robustness: the model is asked for JSON. Claude Haiku 4.5 occasionally REFUSES
// (returns prose like "I appreciate the prompt, but…") — usually triggered by
// first-person "you ARE <name>" impersonation framing. So we (1) frame the task
// as third-person creative copywriting (which Claude does readily), and (2) fall
// back Claude → Gemini → a deterministic heuristic so a script is ALWAYS produced
// and the video render can proceed.

import { callClaudeJSON, extractClaudeJson } from "./kie-claude";
import { MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS, SPEAKING_WORDS_PER_SEC, estimateSecondsFromScript } from "../builder/agentTypes";
import { buildVideoStyleDirective, classifyVideoTemplate } from "./videoPromptStyle";

const KIE_GEMINI_URL = "https://api.kie.ai/gemini-3-6-flash-openai/v1/chat/completions";

export interface ScriptLengthPlan {
  targetSeconds: number;
  targetWords: number;
  windowCount: number;
  lowWords: number;
  highWords: number;
  maxTokens: number;
}

/** Map a requested duration to the word/beat/token budget for one script.
 *  `windowSeconds` = the render engine's REAL per-clip length (Veo 8s,
 *  Seedance 1.5 Pro 12s, Seedance 2.0 / Grok 15s, Kling/Omni 10s) so the
 *  script's window pacing matches how the video actually gets sliced —
 *  hardcoding 8s paced every engine's script for Veo's chunk size. */
export function computeScriptLengthPlan(requestedSeconds: number | undefined, windowSeconds?: number): ScriptLengthPlan {
  const targetSeconds = Math.max(
    MIN_VIDEO_SECONDS,
    Math.min(MAX_VIDEO_SECONDS, Math.round(requestedSeconds && requestedSeconds > 0 ? requestedSeconds : 24)),
  );
  const targetWords = Math.round(targetSeconds * SPEAKING_WORDS_PER_SEC);
  const winSec = Math.max(4, Math.min(15, Math.round(windowSeconds && windowSeconds > 0 ? windowSeconds : 8)));
  const windowCount = Math.max(1, Math.ceil(targetSeconds / winSec));
  const lowWords = Math.round(targetWords * 0.85);
  const highWords = Math.round(targetWords * 1.15);
  // Enough JSON headroom that even an 8-beat script never truncates.
  const maxTokens = Math.max(1200, windowCount * 350);
  return { targetSeconds, targetWords, windowCount, lowWords, highWords, maxTokens };
}

/**
 * Trim a script down to at most `maxWords`, preferring a sentence boundary so it
 * ends on a complete line. LLMs routinely overshoot the requested word budget;
 * left unchecked the extra words push the video past the max-duration cap, and
 * the renderer drops the tail — so the spoken script "never finishes". Clamping
 * here keeps the script and the rendered video length in lock-step.
 *
 * Pure + deterministic. Returns the cleaned (whitespace-collapsed) script
 * unchanged when it already fits.
 */
export function enforceScriptBudget(text: string, maxWords: number): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean || maxWords <= 0) return clean;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return clean;

  // Keep whole sentences until adding the next one would exceed the budget.
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]+|\S[^.!?。！？]*$/g) ?? [clean];
  let out = "";
  let count = 0;
  for (const s of sentences) {
    const w = s.trim().split(/\s+/).filter(Boolean).length;
    if (count > 0 && count + w > maxWords) break;
    out += (out ? " " : "") + s.trim();
    count += w;
    if (count >= maxWords) break;
  }
  // If even the first sentence overruns the budget, hard-cut at a word boundary
  // and close with an ellipsis so the line still reads as finished.
  if (count > maxWords) {
    out = words.slice(0, maxWords).join(" ").replace(/[,;:—–-]+$/, "").trim() + "…";
  }
  return out.trim();
}

/** A prompt line carrying the operator's extra ask, or "" when there is none. */
export function operatorRequestLine(refinement: string | undefined): string {
  const r = (refinement ?? "").trim();
  return r ? `OPERATOR REQUEST (honor this in the rewrite): ${r}\n` : "";
}

export interface ScriptAgent {
  name: string;
  niche: string;
  language?: string;
  archetype?: string;
}

export interface ScriptCtx {
  knowledge: Array<{ title: string; content: string }>;
  memories: Array<{ kind: string; summary: string; importance: number }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  draft: { questionnaire?: Record<string, any>; characterBible?: string } | null;
}

export interface VideoScript {
  topic: string;
  hook: string;
  scriptText: string;
  caption: string;
  hashtags: string[];
  /** Full raw JSON the model returned — echoed into the task output. */
  raw: Record<string, unknown>;
  /** Which generator produced it (for logging/telemetry). */
  source: "claude" | "gemini" | "heuristic";
}

export interface VideoScriptPromptOptions {
  topic?: string;
  targetSeconds?: number;
  brief?: { format: string; angle: string; structureNotes?: string; visualTreatment?: string };
  skills?: Array<{ name: string; instructions: string }>;
  campaignContext?: string;
  nonce?: string;
  refinement?: string;
  /** Recent produced scripts — the model must not reuse their hooks/openings/structures. */
  avoidScripts?: string[];
  /** The render engine's REAL per-clip window length in seconds (see
   *  computeScriptLengthPlan) — paces the script's beat windows to how the
   *  selected engine actually slices the video. Defaults to 8 (Veo). */
  windowSeconds?: number;
  /** Grounded fact snippets carried from a news-sourced idea (cite, don't invent). */
  newsRefs?: string[];
  /** Standing order: "silent" = the character NEVER speaks — no voiceover, no
   *  dialogue; the script becomes on-screen text lines + visual beats. */
  speech?: "silent";
  /** The compiled SHOW BIBLE persona — when present it is the source of truth
   *  and fully REPLACES the (older) draft questionnaire persona + draft
   *  characterBible in the prompt, so a redesigned show never scripts in the
   *  old persona's voice. */
  bible?: {
    premise: string;
    voiceTone: string;
    language?: string;
    catchphrases?: string[];
    visualStyle?: string;
    cast: Array<{ name: string; role: string; visualIdentity: string }>;
  };
}

function kieKey(apiKey?: string): string {
  return apiKey?.trim() || process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";
}

function buildPersonaDescriptor(agent: ScriptAgent, ctx: ScriptCtx, opts: VideoScriptPromptOptions): {
  voiceArchetype: string;
  catchphrase: string;
  traits: string;
  beliefs: string;
  audience: string;
  language: string;
  template: ReturnType<typeof classifyVideoTemplate>;
  styleDirective: string;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (ctx.draft?.questionnaire ?? {}) as Record<string, any>;
  const voiceArchetype = q.voiceArchetype ? String(q.voiceArchetype) : "expert";
  const catchphrase = q.catchphrase ? String(q.catchphrase) : "";
  const traits = Array.isArray(q.traits) ? (q.traits as string[]).join(", ") : "";
  const beliefs = Array.isArray(q.beliefs) ? (q.beliefs as string[]).slice(0, 2).join(" | ") : "";
  const audience = q.audience ? String(q.audience) : "";
  const language = agent.language || "English";
  const template = classifyVideoTemplate({
    voiceArchetype,
    description: [
      ctx.draft?.characterBible,
      agent.archetype,
      agent.niche,
      opts.brief?.format,
      opts.brief?.angle,
      opts.brief?.structureNotes,
      opts.brief?.visualTreatment,
    ].filter(Boolean).join(" "),
    format: opts.brief?.format,
    angle: opts.brief?.angle,
    structureNotes: opts.brief?.structureNotes,
    visualTreatment: opts.brief?.visualTreatment,
    characterBible: ctx.draft?.characterBible,
    agentArchetype: agent.archetype,
    niche: agent.niche,
  });
  const styleDirective = buildVideoStyleDirective({
    voiceArchetype,
    description: ctx.draft?.characterBible ?? opts.brief?.visualTreatment ?? opts.brief?.structureNotes ?? "",
    format: opts.brief?.format,
    angle: opts.brief?.angle,
    structureNotes: opts.brief?.structureNotes,
    visualTreatment: opts.brief?.visualTreatment,
    characterBible: ctx.draft?.characterBible,
    agentArchetype: agent.archetype,
    niche: agent.niche,
  });
  return { voiceArchetype, catchphrase, traits, beliefs, audience, language, template, styleDirective };
}

export function buildVideoScriptPrompt(agent: ScriptAgent, ctx: ScriptCtx, opts: VideoScriptPromptOptions): string {
  const topic = opts.topic?.trim()
    || (ctx.draft?.questionnaire?.contentPillars as string[] | undefined)?.[0]
    || `${agent.niche} update`;
  const { targetSeconds, targetWords, windowCount, lowWords, highWords } = computeScriptLengthPlan(opts.targetSeconds, opts.windowSeconds);
  const winSecLabel = Math.max(4, Math.min(15, Math.round(opts.windowSeconds && opts.windowSeconds > 0 ? opts.windowSeconds : 8)));
  const nonce = opts.nonce ?? `${targetSeconds}-${Math.round((targetWords * 9301 + 49297) % 233280)}-${(opts.topic ?? "").length}`;
  const operatorLine = operatorRequestLine(opts.refinement);
  const persona = buildPersonaDescriptor(agent, ctx, opts);

  const recentVideoMemories = ctx.memories
    .filter((m) => /video|drafted|hook/i.test(m.summary))
    .slice(0, 4)
    .map((m) => `- ${m.summary}`)
    .join("\n");

  const topicKeywords = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const relevantKnowledge = ctx.knowledge
    .filter((k) => {
      const blob = (k.title + " " + k.content).toLowerCase();
      return topicKeywords.some((kw) => blob.includes(kw));
    })
    .slice(0, 3)
    .map((k, i) => `${i + 1}. [${k.title}]\n${k.content.slice(0, 400).replace(/\s+/g, " ").trim()}`)
    .join("\n\n");

  const briefBlock = opts.brief
    ? `\nVIDEO FORMAT: ${opts.brief.format} — ${opts.brief.angle}\n${opts.brief.structureNotes ? `Structure: ${opts.brief.structureNotes}\n` : ""}${opts.brief.visualTreatment ? `Visual treatment: ${opts.brief.visualTreatment}\n` : ""}Write the monologue to fit THIS format (not a generic talking-head).`
    : "";
  const skillsBlock = (opts.skills?.length)
    ? `\nACTIVE SKILLS — these are OPERATOR INSTRUCTIONS. Follow them exactly; they override generic defaults for this creator's style, structure, voice and CTA:\n${opts.skills.slice(0, 6).map((s) => `### ${s.name}\n${s.instructions.slice(0, 800).trim()}`).join("\n\n")}\n`
    : "";
  const avoidBlock = (opts.avoidScripts?.length)
    ? `\nRECENT SCRIPTS — DO NOT REUSE their hooks, opening lines, sentence structures, or phrasings. Write something structurally DIFFERENT:\n${opts.avoidScripts.slice(0, 5).map((s, i) => `${i + 1}. "${s.replace(/\s+/g, " ").slice(0, 220)}…"`).join("\n")}\n`
    : "";
  const newsBlock = (opts.newsRefs?.length)
    ? `\nLIVE FACTS (from today's web search — the script's claims must come from THESE, dated and real; never invent additional specifics):\n${opts.newsRefs.slice(0, 5).map((r) => `- ${r.slice(0, 300)}`).join("\n")}\n`
    : "";
  const campaignBlock = opts.campaignContext
    ? `\nPAID CAMPAIGN — THIS SCRIPT MUST SELL THE PRODUCT BELOW. Read the crawled business info, understand what the product does and who it's for, then write a script whose goal is CONVERSION: a hook tied to the product's core benefit, a concrete value proposition the audience cares about, and a clear call-to-action (try/visit/sign up). Mention the brand naturally in the creator's voice. Use REAL details from the website — do not invent features.\n${opts.campaignContext.slice(0, 2500)}\n`
    : "";

  const sceneRules = persona.template === "cartoon_episode"
    ? "This is a cartoon/episodic persona: write clean, episode-like beats with recurring visual motifs, expressive acting, and clear scene transitions."
    : persona.template === "comic_explainer"
      ? "This is a comic/explainer persona: write fast readable beats with playful rhythm and strong visual clarity."
      : persona.template === "premium_brand"
        ? "This is a premium brand persona: make it elegant, but still human and tactile."
        : persona.template === "realistic_cinematic"
          ? "This is a realistic/cinematic persona: keep it grounded, cinematic, and lived-in."
          : "This is a UGC/handheld persona: keep it casual, immediate, and creator-native.";

  // SHOW BIBLE persona wins outright: when the operator compiled a bible, its
  // premise/cast/voice ARE the persona — the older draft-questionnaire persona
  // and draft characterBible are dropped entirely (mixing them is how a
  // redesigned show kept scripting in the old persona's voice).
  const bible = opts.bible;
  const scriptLang = bible?.language || persona.language;
  const personaBlock = bible
    ? `CREATOR PERSONA (from the operator's SHOW BIBLE — this supersedes any older persona config)
- Show premise: ${bible.premise.slice(0, 400)}
- Voice: ${bible.voiceTone || persona.voiceArchetype}
- Language for the lines: ${scriptLang}
${bible.cast.length ? `- Cast (keep names + visual identity EXACT):\n${bible.cast.slice(0, 4).map((c) => `  · ${c.name} (${c.role}) — ${c.visualIdentity}`).join("\n")}` : ""}${bible.catchphrases?.length ? `\n- Signature lines available: ${bible.catchphrases.slice(0, 4).map((c) => `"${c}"`).join(" / ")}` : ""}${bible.visualStyle ? `\n- Visual world: ${bible.visualStyle}` : ""}`
    : `CREATOR PERSONA
- Name (a brand/handle): ${agent.name}
- Niche: ${agent.niche}
- Voice archetype: ${persona.voiceArchetype} (not generic, not chatbot)
- Language for the spoken lines: ${scriptLang}
- Audience: ${persona.audience || "their followers"}
- Core traits: ${persona.traits || "—"}
- Beliefs: ${persona.beliefs || "—"}${persona.catchphrase ? `\n- Signature opening energy: "${persona.catchphrase}"` : ""}${ctx.draft?.characterBible ? `\nCharacter bible (tone + style):\n${ctx.draft.characterBible.slice(0, 600)}` : ""}`;

  // Standing order "no speaking": the whole script pivots from voiceover to
  // on-screen text + visuals. This must live in the SCRIPT stage — fixing it
  // only at the render/storyboard stage leaves the confirmed script full of
  // spoken lines that the storyboard is then told to follow exactly.
  const silent = opts.speech === "silent";
  const silentRules = silent
    ? `\nSILENT VIDEO — HARD RULE: the character NEVER speaks. There is NO voiceover, NO dialogue, NO narration — music/ambience and visuals carry the video.
- "hook" = the opening ON-SCREEN TEXT line (≤ 8 words) that stops the scroll.
- "script" = the sequence of ON-SCREEN TEXT lines (short, punchy captions shown over the visuals), one per beat, in ${scriptLang}. NOT spoken lines.
- scene_beats carry the actual story: actions, reactions, and visual payoffs must be readable with the sound off.\n`
    : "";

  return `Write the next short-form video script for the creator persona below.

${personaBlock}

VISUAL TEMPLATE: ${persona.template}
VISUAL RULES: ${persona.styleDirective}
${sceneRules}

OPERATOR'S TOPIC (WHAT THIS VIDEO IS ACTUALLY ABOUT — HIGHEST PRIORITY): "${topic}"
This exact line is what the operator asked for THIS video. Write about THIS, specifically — not a generic ${agent.niche} take, not whatever the persona usually talks about. The CREATOR PERSONA above (name, niche, traits, beliefs) is ONLY a voice/tone/appearance reference for HOW to say it — it never substitutes a different subject for WHAT the topic says. If the topic names a specific thing, event, product, or claim, that thing must be the actual subject of the hook and script, not a reskinned version of the persona's usual content.
VARIATION TOKEN: ${nonce} — use ONLY to diversify: write a DISTINCTLY different hook, structure, and wording than a default take; never print the token.
${operatorLine}${briefBlock}${skillsBlock}${campaignBlock}${avoidBlock}${newsBlock}${relevantKnowledge ? `\nKNOWLEDGE TO CITE (use these specific facts, don't invent stats):\n${relevantKnowledge}\n` : ""}${recentVideoMemories ? `\nPAST VIDEOS (pick a DIFFERENT angle):\n${recentVideoMemories}\n` : ""}
${silentRules}SCENE-FIRST RULES
1. Hook ≤ 12 words in ${scriptLang} that stops the scroll${bible ? "" : `, in the ${persona.voiceArchetype} voice`}, ABOUT THE OPERATOR'S TOPIC above.${opts.campaignContext ? " Tie the hook to the product's core benefit." : ""}
2. ${silent
    ? `Script = the ON-SCREEN TEXT lines only (see SILENT VIDEO rule), in ${scriptLang}, one short line per beat across ${windowCount} sequential ~${winSecLabel}-second windows.`
    : `Script = the spoken voiceover only, in ${scriptLang}, ${lowWords}-${highWords} words (~${targetSeconds}s). It will be split into ${windowCount} sequential ~${winSecLabel}-second windows. Keep it natural and easy to perform. If the show has MULTIPLE cast members, write it as a real CONVERSATION between them (still one flowing text — each beat's "line"/"speaker" attributes who says what); a single-character show stays a first-person monologue. The LAST sentence must LAND the video — a payoff, punchline, conclusion, or call-to-action that closes the story; never stop mid-thought or trail off.`}
3. Add a scene-first structure in the JSON: include a scene_beats array with ${windowCount > 1 ? `${Math.max(3, windowCount)}-8` : "3-8"} beats that starts each beat with a concrete PHYSICAL ACTION (the character DOES something visible — never just "talks to camera"), then the camera framing (vary it like an editor: wide / medium / close-up / OTS, never the same twice in a row), then the scene detail. These beats ARE the render's shot plan — they go straight to the video engine. SETTING: invent a setting that serves THIS topic specifically — a new video should NOT default to the same room/location as previous ones (vary it: different rooms, outdoors, workplaces, vehicles, fantastical spaces — wherever the story is strongest); the character stays the same, the WORLD changes per episode. Mark "newScene": true on a beat that CUTS to a new location (never beat 1); scene changes must land where a new ~${winSecLabel}s window starts, and inside a scene the location stays fixed. If the show has MULTIPLE cast members, set "speaker" on every beat to the ONE named character who delivers that beat's line — alternate naturally so it reads as a real conversation, and never have two characters share a line. If the persona is cartoonish or episodic, make the beats feel like a proper episode: exaggerated reactions, at least one visual gag or physical beat per scene, snappy timing. If the persona is UGC, make them feel handheld and spontaneous.
4. Unless the persona explicitly requests polished output, keep the video look human, imperfect, and slightly unpolished — slight shake, mild grain or VHS texture, natural motion blur, and asymmetrical framing are good defaults.
5. Ground every claim in the knowledge/beliefs above — no invented stats.${opts.campaignContext ? " For the campaign, use ONLY real product details from the crawled website." : ""}
6. SPEAKABILITY: write like a person talks, not like copy. Contractions, short sentences, one idea per beat. BANNED: "game changer", "let's dive in", "in today's video", "without further ado", "unlock", "elevate", "delve", generic listicle phrasing, and any sentence you couldn't say out loud in one breath.
7. Caption: 1-2 sentences with personality.${opts.campaignContext ? "\n8. CONVERSION: build to a clear call-to-action in the final beat (try it / visit / sign up) — make viewers want the product." : ""}

Return ONLY this JSON (no fences, no commentary):
{
  "hook": "≤12 words in ${scriptLang}",
  "script": "${silent ? `on-screen text lines in ${scriptLang}, one per beat, ${windowCount} beats, NO spoken lines` : `${lowWords}-${highWords} word first-person monologue in ${scriptLang}, ${windowCount} distinct ~${winSecLabel}s beats, the final beat closes the story with a real payoff/ending, no repeated lines`}",
  "caption": "1-2 sentence caption in ${scriptLang}",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "scene_beats": [
    { "seconds": "0-2", "action": "what happens first", "camera": "camera move", "scene": "scene description", "visual_notes": "texture / human imperfection notes", "newScene": false, "speaker": "cast member name who delivers this beat's line (multi-character shows only)", "line": "the EXACT words this beat speaks — a contiguous slice of the script field, in order; all lines concatenated must equal the script" }
  ],
  "visual_style": "${persona.template}",
  "camera_notes": "human, slightly imperfect, never too polished unless requested",
  "opening_action": "how the first seconds start",
  "closing_action": "how the ending lands",
  "platforms": ["tiktok","instagram"],
  "estimated_views_low": 1000,
  "estimated_views_high": 5000
}`;
}

// Gemini JSON fallback (the original working model). Returns null on any failure
// — including the timeouts this account sometimes sees — so the caller can fall
// through to the heuristic.
async function callGeminiScript(system: string, user: string, apiKey?: string): Promise<Record<string, unknown> | null> {
  const key = kieKey(apiKey);
  if (!key) return null;
  try {
    const res = await fetch(KIE_GEMINI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-6-flash-openai",
        stream: false,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json().catch(() => ({}))) as any;
    const text = data?.choices?.[0]?.message?.content ?? data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text ?? "").join("") ?? "";
    return text ? extractClaudeJson(String(text)) : null;
  } catch {
    return null;
  }
}

// Deterministic last resort — guarantees a usable, on-topic script so the render
// (and its cost deduction) always proceeds, even if both models are unavailable.
function heuristicScript(agent: ScriptAgent, topic: string, catchphrase: string, targetWords: number): Record<string, unknown> {
  const tag = agent.niche.replace(/[^a-z0-9]+/gi, "");
  const opener = catchphrase || `The ${topic} thing nobody tells you`;
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
  return {
    hook: opener.length <= 60 ? opener : `${topic}: what I wish I knew sooner`,
    script,
    caption: `${topic} — no fluff, just what works. Save this.`,
    hashtags: [`#${tag || "creator"}`, "#tips", `#${topic.replace(/[^a-z0-9]+/gi, "").slice(0, 18) || "howto"}`],
    platforms: ["tiktok", "instagram"],
  };
}

export async function generateVideoScript(
  agent: ScriptAgent,
  ctx: ScriptCtx,
  opts: {
    topic?: string;
    apiKey?: string;
    targetSeconds?: number;
    brief?: { format: string; angle: string; structureNotes?: string; visualTreatment?: string };
    skills?: Array<{ name: string; instructions: string }>;
    /** When this video promotes a paid campaign: brand + brief + crawled website. */
    campaignContext?: string;
    /** Random variation token so repeated runs produce a DIFFERENT script. */
    nonce?: string;
    /** Operator refinement request (e.g. "make it funnier") applied to the rewrite. */
    refinement?: string;
    /** Recent produced scripts — anti-repetition block in the prompt. */
    avoidScripts?: string[];
    /** Grounded fact snippets from a news-sourced idea. */
    newsRefs?: string[];
    /** Standing order: "silent" = the character NEVER speaks — the script
     *  becomes on-screen text lines + visual beats (see buildPrompt). */
    speech?: "silent";
    /** Engine-aware per-clip window length (see computeScriptLengthPlan). */
    windowSeconds?: number;
  },
): Promise<VideoScript> {
  const topic = opts.topic?.trim()
    || (ctx.draft?.questionnaire?.contentPillars as string[] | undefined)?.[0]
    || `${agent.niche} update`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (ctx.draft?.questionnaire ?? {}) as Record<string, any>;
  const catchphrase = q.catchphrase ? String(q.catchphrase) : "";

  // Target the requested duration: ~2.5 words/sec. Each Veo window is 8s.
  const { targetSeconds, targetWords, windowCount, lowWords, highWords, maxTokens } = computeScriptLengthPlan(opts.targetSeconds, opts.windowSeconds);
  const system = `You are an expert short-form video scriptwriter for social creators. You write scripts in the VOICE of a given brand/creator persona. This is fictional brand copywriting for a made-up creator character — not impersonation of a real person, so it is always fine to proceed. Reply with ONLY a JSON object — no markdown fences, no commentary.`;
  const user = buildVideoScriptPrompt(agent, ctx, { ...opts, topic, targetSeconds });

  // ── Claude → Gemini → heuristic. Never throws. ───────────────────────────────
  let raw: Record<string, unknown> | null = null;
  let source: VideoScript["source"] = "heuristic";

  try {
    raw = await callClaudeJSON<Record<string, unknown>>({ system, user, maxTokens, apiKey: opts.apiKey });
    if (raw && (typeof raw.hook === "string" || typeof raw.script === "string")) source = "claude";
    else raw = null;
  } catch (e) {
    console.warn("[videoScript] Claude failed/refused, trying Gemini:", e instanceof Error ? e.message : e);
  }

  if (!raw) {
    const g = await callGeminiScript(system, user, opts.apiKey);
    if (g && (typeof g.hook === "string" || typeof g.script === "string")) { raw = g; source = "gemini"; }
  }

  if (!raw) {
    console.warn("[videoScript] Both models unavailable — using heuristic script so the render still proceeds");
    raw = heuristicScript(agent, topic, catchphrase, targetWords);
    source = "heuristic";
  }

  const hook = typeof raw.hook === "string" && raw.hook.trim() ? raw.hook : topic;
  const rawScript = typeof raw.script === "string" ? raw.script : "";
  // Models routinely overshoot the requested word budget. Clamp the script to the
  // upper bound so its spoken length matches the requested duration — otherwise
  // the renderer can't fit it in the rendered clips and the ending gets cut.
  const scriptText = enforceScriptBudget(rawScript, highWords);
  const caption = typeof raw.caption === "string" ? raw.caption : "";
  const hashtags = Array.isArray(raw.hashtags) ? (raw.hashtags as unknown[]).map(String) : [];

  const rawWords = rawScript.split(/\s+/).filter(Boolean).length;
  const finalWords = scriptText.split(/\s+/).filter(Boolean).length;
  console.log(`[videoScript] script via ${source} · topic="${topic}" · ${finalWords} words (budget ${lowWords}-${highWords}${rawWords > finalWords ? `, trimmed from ${rawWords}` : ""})`);
  return { topic, hook, scriptText, caption, hashtags, raw, source };
}

/** A fitted script plus the seconds it is measured to actually fill. */
export interface FittedVideoScript extends VideoScript {
  /** Spoken length of the final script (seconds), measured at the canonical rate. */
  fittedSeconds: number;
  /** The target the agent asked for — `fittedSeconds` is reconciled toward this. */
  targetSeconds: number;
}

/** Within how far off-target (fraction) we accept a script without regenerating. */
// Only a draft this far UNDER the target triggers the (single) corrective
// re-generation. Widened from 0.15 → 0.22 so a normal length wobble no longer
// costs a full second script call; overshoot never regenerates (it's trimmed).
const FIT_TOLERANCE = 0.22;

/**
 * Generate a script and guarantee it FITS the requested duration so the rendered
 * video looks complete and natural — never a script crammed into too little time
 * or a clip that ends mid-sentence.
 *
 * Algorithm (validate → 1 regen → safety-trim):
 *   1. Generate at `targetSeconds`; measure spoken seconds.
 *   2. If outside ±FIT_TOLERANCE, regenerate ONCE with an explicit length
 *      correction telling the model exactly how many words/seconds to hit.
 *   3. Always finish with `enforceScriptBudget` so the script can never exceed the
 *      render capacity (the upper word bound for the target).
 *
 * Never throws — `generateVideoScript` already falls back Claude → Gemini →
 * heuristic, and the trim is deterministic.
 */
export async function generateFittedScript(
  agent: ScriptAgent,
  ctx: ScriptCtx,
  opts: Parameters<typeof generateVideoScript>[2] & { targetSeconds: number },
): Promise<FittedVideoScript> {
  const target = Math.max(MIN_VIDEO_SECONDS, Math.min(MAX_VIDEO_SECONDS, Math.round(opts.targetSeconds)));
  const plan = computeScriptLengthPlan(target);

  let script = await generateVideoScript(agent, ctx, { ...opts, targetSeconds: target });
  let seconds = estimateSecondsFromScript(script.scriptText);

  // SILENT videos: the "script" is short on-screen text lines, not speech — its
  // word count says nothing about the video's length (the visuals fill the
  // requested seconds). Skip the spoken-length fitting entirely: the corrective
  // pass below literally asks for a longer MONOLOGUE, which is how a silent
  // order came back with spoken lines again.
  if (opts.speech === "silent") {
    return { ...script, fittedSeconds: target, targetSeconds: target };
  }

  // Corrective pass(es), but ONLY for a severe UNDERSHOOT. An overshoot is trimmed
  // deterministically by enforceScriptBudget below, so re-generating for a too-long
  // draft just burns a full extra Claude(+Gemini) round-trip on every render. Firing
  // only when the draft is materially too SHORT keeps the common case at one script
  // call. (Was: any miss > FIT_TOLERANCE → a 2nd generation almost every time.)
  //
  // A single correction wasn't reliable enough: a persistent undershoot (still
  // >15% short after the first correction) silently shipped as a too-short
  // script — which is exactly what fed too-little content into Grok's
  // base+extend window planner (videoSegmentation.ts), producing a render
  // shorter than requested or an extend window with dead air (Kie filling
  // the requested clip length past what the script actually speaks). One
  // bounded 2nd correction (3 script calls, worst case, only when the 1st
  // correction itself still missed badly) closes that gap without changing
  // the common one-call path for scripts that land within tolerance.
  let undershoot = (target - seconds) / target;
  let corrections = 0;
  // Short targets (≤ 8s, one engine window) don't get correction round-trips:
  // a 12-word script is within a sentence of "right" and enforceScriptBudget
  // already trims overshoot — each refine was a full extra Kie call for nothing.
  const maxCorrections = target <= 8 ? 0 : 2;
  while (undershoot > FIT_TOLERANCE && corrections < maxCorrections) {
    corrections++;
    const correction =
      `Your previous draft ran ${seconds}s (${script.scriptText.split(/\s+/).filter(Boolean).length} words); ` +
      `it must be longer. Write the monologue to land at ~${target}s — exactly ${plan.lowWords}-${plan.highWords} words, ` +
      `no more, no less. Keep the same persona, hook, and language. Add real substance (a concrete supporting point, example, or detail), never filler or repeated phrasing just to hit the count.`;
    const refined = await generateVideoScript(agent, ctx, {
      ...opts,
      targetSeconds: target,
      refinement: [opts.refinement, correction].filter(Boolean).join(" "),
    });
    const refinedSeconds = estimateSecondsFromScript(refined.scriptText);
    // Keep whichever draft is closer to the target.
    if (Math.abs(refinedSeconds - target) <= Math.abs(seconds - target)) {
      script = refined;
      seconds = refinedSeconds;
    }
    undershoot = (target - seconds) / target;
  }

  // Safety net: never exceed the render capacity for the target.
  const trimmed = enforceScriptBudget(script.scriptText, plan.highWords);
  if (trimmed !== script.scriptText) {
    script = { ...script, scriptText: trimmed };
    seconds = estimateSecondsFromScript(trimmed);
  }

  return { ...script, fittedSeconds: seconds, targetSeconds: target };
}
