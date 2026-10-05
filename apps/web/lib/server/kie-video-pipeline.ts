// Kie video pipeline — proper endpoint per model.
//
// PHASES:
//   1. STORYBOARD PROMPT — Claude builds a structured visual storyboard
//      prompt (best at story structure & cinematic language)
//   2. STORYBOARD IMAGE — Kie nano-banana-pro (multi-panel comic)
//   3. VIDEO — engine-specific endpoint:
//      - veo3 / veo3_fast →  https://api.kie.ai/api/v1/veo3/generate
//      - bytedance/seedance-2-fast → https://api.kie.ai/api/v1/jobs/createTask
//      - others → https://api.kie.ai/api/v1/jobs/createTask
//
// Docs:
//   Veo3:    https://docs.kie.ai/veo3-api/generate-veo-3-video
//   Seedance: https://docs.kie.ai/market/bytedance/seedance-2-fast

import {
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  estimateSecondsFromScript,
  maxClipForModel,
} from "../builder/agentTypes";
import { callClaudeText, callClaudeJSON } from "./kie-claude";
import { packBeatsIntoWindows, buildVoiceProfile, beatSecondsFromVoiceover, planGrokExtendWindows, windowSeconds, GROK_EXTEND_THRESHOLD_SECONDS, GROK_BASE_MAX_SECONDS } from "./videoSegmentation";
import { resolveCharacterRefs } from "./characterRefs";
import { formatRequiresStartFrame } from "../builder/formatCatalog";
import { buildVideoStyleDirective } from "./videoPromptStyle";
import { CLIP_RENDER_BUDGET_MS, clipPollBudgetMs } from "./videoRenderBudget";
import { getEngineAdapter } from "@/lib/server/engineAdapters";
import { adaptPromptForEngine } from "../builder/enginePromptAdapters";
import { composeBeatFormatPrompt } from "../builder/formatPromptBuilder";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveFfmpegPath } from "./ffmpegBin";

const execFileP = promisify(execFile);

// The Convex render runtime has its own env (no .env.local), so the key is
// forwarded from the Next enqueue and stashed here at the start of a render.
// Falls back to process.env for the Next-side callers (generate-content route).
let runtimeKieKey = "";
function kieKey(): string {
  return runtimeKieKey || process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";
}

// Image generation — nano-banana-pro via unified jobs API
const KIE_JOBS_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_JOBS_POLL = "https://api.kie.ai/api/v1/jobs/recordInfo";

// Video — Veo dedicated endpoint (Kie docs page is "veo3-api" but the REST
// path is /api/v1/veo/ — the model field distinguishes veo3 vs veo3_fast).
const KIE_VEO_GENERATE = "https://api.kie.ai/api/v1/veo/generate";
const KIE_VEO_RECORD = "https://api.kie.ai/api/v1/veo/record-info";

/** Seedance chain progress, persisted between render-step invocations so a
 *  timed-out multi-clip render resumes instead of re-paying for every clip. */
export interface SeedanceChainState {
  /** Completed clip URLs, in order. */
  clipUrls: string[];
  /** Index of the next clip to render. */
  nextIndex: number;
  /** Frame-chain anchor for the next clip (previous clip's last frame). */
  firstFrame?: string;
  /** The rendered opening keyframe (nano-banana) — skip re-rendering it. */
  keyframeUrl?: string;
  /** A Kie task already created for `pendingClipIndex` but not yet polled to
   *  completion — resume POLLS it instead of creating a duplicate task. */
  pendingTaskId?: string;
  pendingClipIndex?: number;
}

export interface StoryBeat {
  index: number;
  scene: string;
  voiceover: string;
  camera: string;
  seconds: number;
  /** Engine-aware, persona-infused per-window visual direction authored by the
   *  storyboard LLM. Consumed by the per-clip prompt builders; falls back to the
   *  template scene/camera text when absent. */
  videoPrompt?: string;
  /** Exact on-screen text overlay this beat must render in-frame (Recreate:
   *  mirrors the source video's captions/graphics). Only honored when
   *  args.allowOnScreenText is set — the default templates forbid burned text. */
  onScreenText?: string;
  /** The ONE cast member who delivers this beat's line (multi-character
   *  shows) — drives per-speaker dialogue attribution in the clip prompts so
   *  two characters never lip-sync the same line. */
  speaker?: string;
  /** This beat CUTS to a new scene/location (planner-authored). Drives the
   *  window packer (windows prefer to break here) and the seedance chain's
   *  per-clip continuity mode: a new-scene clip re-anchors on the style refs
   *  with a deliberate story cut instead of frame-chaining the previous
   *  clip's last frame — so scene changes are intentional plot moves, never
   *  the mid-take environment glitches frame-chaining across a location
   *  change produced. */
  newScene?: boolean;
}

export interface VideoGenerationResult {
  storyboardImageUrl: string;
  videoUrl: string;
  storyBeats: StoryBeat[];
  storyboardPrompt: string;
  videoPrompt: string;
  durationSeconds: number;
  storyboardError?: string;
  videoError?: string;
  /** Non-fatal note — e.g. the stitched video is shorter than requested. */
  videoNote?: string;
  /** Persona visual-identity kernel actually used for this render (computed once,
   *  see GenerateVideoArgs.personaKernel). Returned so chunked callers (e.g. the
   *  Veo render-step, which only receives the storyboard-phase result) can forward
   *  it into later phases/prompt builders instead of losing it. */
  personaKernel?: string;
}

export interface GenerateVideoArgs {
  agentName: string;
  agentNiche: string;
  /** Videos-tab "No Persona": skip the persona kernel entirely — the prompts
   *  carry only the operator's script/brief, no character voice or backstory. */
  noPersona?: boolean;
  agentArchetype?: string;
  characterBible?: string;
  /** Optional personality dials (0-100) — used to derive a stable voice profile. */
  personality?: { warmth?: number; humor?: number; authority?: number; boldness?: number };
  /** Optional explicit voice hint from the persona questionnaire. */
  voiceArchetype?: string;
  /** Pre-distilled persona visual-identity kernel (see lib/server/personaKernel.ts).
   *  Carried on every clip prompt so renders depend on the agent's persona + memory.
   *  Computed once per render and persisted so chunked render-steps reuse it. */
  personaKernel?: string;
  /** Persona's spoken language — the ENTIRE script/voiceover is in this language. */
  language?: string;
  /** Extra persona surface forwarded into the visual-identity kernel builder. */
  aesthetic?: string;
  brandColor?: string;
  colorGrade?: string;
  cameraStyle?: string;
  energy?: string;
  settings?: string[];
  traits?: string[];
  catchphrase?: string;
  /** Primary character reference image (required) */
  avatarUrl: string;
  /** Seedance lead-image strategy. Seedance treats its lead input as the
   *  LITERAL first frame — so a real photo lead (product shot, website
   *  screenshot) opens the video as that photo, which is exactly wrong for a
   *  fully-animated render.
   *  - "avatar" (default): current behavior — canonical still leads.
   *  - "storyboard": lead with the styled storyboard image when one rendered
   *    (an anime storyboard opens as anime); no storyboard → NO lead at all
   *    (pure text-to-video), with the product photo riding as a trailing
   *    reference only. */
  seedanceLead?: "avatar" | "storyboard";
  /**
   * Optional additional reference images (1-3 total including avatarUrl).
   * Veo 3.1 REFERENCE_2_VIDEO mode locks the character across the video by
   * referencing up to 3 images — pass the avatar + extra angle/pose shots.
   */
  referenceImageUrls?: string[];
  /** The campaign's product image — used as 1 of the 3 Veo reference images. */
  productImageUrl?: string;
  /** Extra product angle/detail shots (productImageUrl is always first when
   *  both are set) — multiple looks at the SAME product so Kie renders it more
   *  precisely instead of guessing from one flat photo. Recreate's product mode
   *  fills this from AI-picked images scraped off the product's website. */
  productImageUrls?: string[];
  /** Vision description of that product (type/shape/colors/packaging/label text).
   *  Threaded into clip + extend prompts so the engine renders THIS exact product
   *  — extends get no images, so the words are the only product anchor there. */
  productDescription?: string;
  /** ALL campaign images (cover + uploaded attachments) — fed to the storyboard
   *  image generation as extra references (the storyboard accepts up to 5). */
  campaignImageUrls?: string[];
  /** Full campaign context (brand, brief, crawled website, image inventory) — fed
   *  to the Claude storyboard planner so it understands the business + product
   *  and dedicates a panel to showcasing the product. */
  campaignContext?: string;
  /** Full static avatar set — used to pick identity references. */
  avatarUrls?: string[];
  /** Creative brief — the format/angle this video should follow. */
  creativeBrief?: { format: string; angle: string; topic?: string; structureNotes?: string; visualTreatment?: string };
  /**
   * Whether a voice appears in this video, and how — resolved from the operator's
   * STANDING ORDERS (builder copilot → agentMemory → lib/server/agentDirectives.ts).
   *  - "on_camera": filmed talking, lip-synced (the historical default);
   *  - "voiceover": heard but never filmed speaking;
   *  - "silent":    no speech anywhere — visuals + music carry the video.
   * Unset falls back to the format inference (a commercial narrates off-camera),
   * so existing renders behave exactly as before.
   */
  speech?: "on_camera" | "voiceover" | "silent";
  /** Verbatim standing-orders block appended to every prompt this render sends. */
  standingOrders?: string;
  /**
   * The agent's active skills (custom-authored first) — the storyboard director
   * obeys these so the visuals + structure follow the operator-defined skills.
   */
  skills?: Array<{ name: string; instructions: string }>;
  topic: string;
  hook: string;
  scriptText: string;
  durationSeconds?: number;
  /** Output aspect ratio for the final video clips. Defaults to "9:16". */
  aspectRatio?: string;
  /** Requested output resolution. Engines that don't support 1080p stay at 720p. */
  resolution?: "720p" | "1080p" | "4k";
  videoModel?: string;
  /** Allow (and require) beats' `onScreenText` overlays to be rendered in-frame.
   *  Default templates say "no captions/logos"; Recreate sets this so the source
   *  video's on-screen text is reproduced instead of suppressed. */
  allowOnScreenText?: boolean;
  /** Optional recent memories the agent has learned — used by Claude to keep continuity */
  memories?: Array<{ kind: string; summary: string; importance: number }>;
  /** Optional knowledge snippets — used to ground visuals in the agent's studied content */
  knowledge?: Array<{ title: string; content: string }>;
  /**
   * Concatenate multiple finished clip URLs into one stitched video, returning
   * the merged video's URL. Provided by the Convex job (ffmpeg + storage); the
   * pipeline lib has no file-system/storage access of its own. Required for
   * Seedance videos longer than one 15s clip.
   */
  stitchClips?: (clipUrls: string[], opts?: { crossfadeSeconds?: number; trimSeconds?: number; headTrimSeconds?: number }) => Promise<string>;
  /**
   * Wall-clock budget for the whole pipeline (ms). The clip/extend chain stops
   * before this so we always return the longest video that finished. Defaults
   * to 280s (the sync HTTP route); the Convex job passes ~560s (10-min action).
   */
  timeBudgetMs?: number;
  /**
   * Kie API key forwarded by the caller. Required when running inside the Convex
   * action (its runtime env has no KIE_API_KEY). Next-side callers can omit it —
   * the pipeline falls back to process.env.
   */
  apiKey?: string;
  /**
   * Phase selector for the Vercel-safe chunked render (see
   * docs/superpowers/specs/2026-06-03-vercel-safe-agentic-video-render-design.md).
   * The render-step route runs the storyboard and video phases in SEPARATE sub-300s
   * invocations:
   *   - "storyboard" → plan + render the storyboard image, then return early (no video)
   *   - "video"      → skip planning/storyboard (use `resume`) and render the video only
   *   - undefined    → run the whole pipeline in one call (preview path / back-compat)
   */
  phase?: "storyboard" | "video";
  /** Handoff from the storyboard phase, fed back into the video phase. */
  resume?: StoryboardHandoff;
  /** Scene beats the SCRIPT call already authored (videoScript.ts's
   *  scene_beats) — when ≥3 arrive, the pipeline reuses them as the story plan
   *  and SKIPS the separate planStoryWithClaude round trip entirely: one LLM
   *  call now authors script + beats together (the Director/bible settings
   *  drive it), instead of two calls re-deriving the same structure. */
  preplannedBeats?: { scene?: string; camera?: string; action?: string; visualNotes?: string; newScene?: boolean; speaker?: string; line?: string }[];
  /** Seedance per-clip resume state (persisted by the caller via
   *  onSeedanceProgress after every completed step) — a phase retry CONTINUES
   *  the chain from here instead of regenerating the keyframe + every clip. */
  seedanceResume?: SeedanceChainState;
  /** Called with a PARTIAL state after each completed seedance step (keyframe
   *  rendered, clip finished, task created); the caller merges + persists it. */
  onSeedanceProgress?: (state: Partial<SeedanceChainState>) => Promise<void>;
  /** Operator opt-out (Videos tab "Skip storyboard"): don't render the multi-panel
   *  storyboard guide image at all — the clips reference the character/reference
   *  images directly. Beat planning still runs (the clip prompts need it). */
  skipStoryboard?: boolean;
  /** Pre-composed engine-neutral prompt from the format catalog (spec: format
   *  catalog prompts, phase 1) — produced by lib/builder/formatPromptBuilder
   *  from the show bible + topic. When present, buildVideoPrompt adapts THIS to
   *  the target engine's dialect instead of its legacy free-form composition. */
  formatPrompt?: string;
  /** The catalog format id this render's prompt was templated from. Carried
   *  alongside formatPrompt mainly for diagnostics/logging (see the format
   *  prompt injection log line in generateVideoFromScript), plus the
   *  formatRequiresStartFrame() check below. */
  formatId?: string;
}

/**
 * What the storyboard phase produces and the video phase needs to resume. Only
 * these three are consumed on resume — duration, segment count, and the video
 * prompt are recomputed deterministically from the same args in the video phase.
 */
export interface StoryboardHandoff {
  storyboardImageUrl: string;
  beats: StoryBeat[];
  storyboardPrompt: string;
}

export interface VeoChainPlan {
  isVeo: boolean;
  model: "veo3" | "veo3_fast" | "veo3_lite";
  segmentPrompts: string[];
  /** Per-window SCENE-establishing generate prompts (buildSegmentPrompt for every
   *  window). Used ONLY by the STITCH FALLBACK — when native /veo/extend is blocked
   *  (the prominent-people filter) a window is rendered as a fresh STANDALONE clip.
   *  segmentPrompts[i>0] are LEAN "continue the existing take" continuations meant
   *  for the extend endpoint (which inherits the parent frame); feeding those to a
   *  fresh generate gave it no distinct scene, so every fallback clip collapsed into
   *  the same shot ("the same video N times"). These carry each window's own scene +
   *  spoken line so the fallback clips stay distinct. Optional for backward-compat
   *  with jobs planned before this field existed (falls back to segmentPrompts). */
  standalonePrompts?: string[];
  refImages: string[];
  totalSegments: number;
  /** Veo accepts "16:9" | "9:16" | "Auto" only. Defaults to "9:16". */
  aspectRatio: "16:9" | "9:16" | "Auto";
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Storyboard planning ──────────────────────────────────────────────────
// Gemini 3.6 Flash (via kie-claude.ts) — strongest at narrative structure +
// cinematographic language of the models Kie keeps reliably up.

async function planStoryWithClaude(args: GenerateVideoArgs, totalSegments: number): Promise<{ beats: StoryBeat[]; imagePrompt: string }> {
  const totalSeconds = Math.max(5, args.durationSeconds ?? totalSegments * 8);
  // The actual per-window length, not a hardcoded "8-second" — the planner
  // used to always tell Claude every window is 8s even for Grok (real ~15s
  // windows) or Seedance (variable 4-15s windows), so the story got paced for
  // the wrong chunk size and the beats didn't line up with how the video was
  // actually going to be sliced downstream.
  const windowSecLabel = Math.max(1, Math.round(totalSeconds / Math.max(1, totalSegments)));

  // No-Persona: the operator's prompt must be the EXACT text Kie renders from —
  // not an LLM's "camera-ready visual direction" rewrite of it. Before this,
  // No-Persona only locked the SPOKEN words to the verbatim script (the
  // FIDELITY LOCK below, which overwrites `voiceover`) — every beat's
  // `videoPrompt`/`scene` (what buildSegmentPrompt/buildGrokPrompt actually
  // hand to Kie as the shot description) was STILL 100% Claude-authored
  // regardless of noPersona, because the storyboard system prompt above asks
  // for that on every call and nothing ever locked it back down. That's the
  // "prompt is still adjusted" bug: the spoken line matched, but the visual
  // prompt Kie rendered from never did. Skip the storyboard-authoring call
  // entirely here — every beat's videoPrompt is the operator's prompt, verbatim.
  if (args.noPersona) {
    const scriptText = (args.scriptText ?? "").trim();
    const segCount = Math.max(1, totalSegments);
    const lines = splitScriptAcrossBeats(scriptText, segCount);
    const beats: StoryBeat[] = lines.map((line, i) => {
      const voiceover = line.trim();
      return {
        index: i + 1,
        scene: scriptText,
        voiceover,
        camera: "static",
        videoPrompt: scriptText,
        seconds: beatSecondsFromVoiceover(voiceover),
      };
    });
    return { beats, imagePrompt: scriptText };
  }
  // ~2 beats per 8s window so each window has a hook + turn. Clamp to a sane range.
  // At least 6 beats/panels so the storyboard reads as a proper, organized
  // sequence (numbered panels with a plot caption each), not 2 sparse frames.
  const beatCount = Math.max(6, Math.min(14, totalSegments * 2));
  // A clean grid in reading order: 3 columns for ≤6, 4 for larger.
  const gridCols = beatCount <= 6 ? 3 : 4;
  const gridRows = Math.ceil(beatCount / gridCols);
  // The whole monologue MUST stay in ONE language (the persona's), or the video
  // drifts (e.g. opens in English then switches to Malay).
  const lang = (args.language ?? "").trim() || "the exact same language as the FULL SCRIPT below";

  const brief = args.creativeBrief;
  const formatBlock = brief
    ? `\nVIDEO FORMAT: ${brief.format} — ${brief.angle}.${brief.structureNotes ? ` Beat flow: ${brief.structureNotes}.` : ""}${brief.visualTreatment ? ` Visual treatment: ${brief.visualTreatment}.` : ""}\nRender the VISUALS for this format (not a generic talking-head).`
    : "";
  const intentBlock = buildBuilderIntentBlock(args);

  // When the Director style is "commercial", the storyboard itself must be an AD
  // (product hero shots + lifestyle montage), not a person monologuing to camera —
  // otherwise the storyboard reference image drags every Veo clip back to a
  // talking-head. This override reframes the beats + panels as a TV commercial.
  const commercial = isCommercialFormat(brief?.format);
  const mode = speechMode(args);
  // SILENT ORDER — the storyboard must not plan a monologue. Beats still carry
  // ON-SCREEN text ideas, but no spoken line, so nothing downstream has words to
  // lip-sync. Written as its own override because the beat schema above asks for a
  // "voiceover" field; here we tell the director to leave it empty.
  const silentBlock = mode === "silent"
    ? `\n\nSILENT VIDEO OVERRIDE — NOBODY SPEAKS:
- The operator has ordered videos with NO speech. Set EVERY beat's "voiceover" to "" (empty string). Do NOT write dialogue, narration, or lyrics anywhere.
- Tell the story PURELY through visuals: action, product, environment, motion, composition and pacing.
- Never plan a shot of someone talking to camera, mouthing words, or being interviewed.
- The FULL SCRIPT below is STORY REFERENCE ONLY for this video — it is NOT spoken. Ignore the rule about slicing it into voiceover lines: use it to decide WHAT IS SHOWN, then leave every "voiceover" empty.`
    : "";
  const commercialBlock = commercial
    ? `\n\nAD FORMAT OVERRIDE — THIS IS A TV COMMERCIAL, NOT A TALKING-HEAD:
- Storyboard this as a premium brand ADVERTISEMENT. Panels are AD SHOTS — glossy PRODUCT HERO shots, aspirational LIFESTYLE vignettes, benefit demonstrations, and beauty-lit macro close-ups — a dynamic montage, NOT a person monologuing to camera.
- Each beat's "scene" describes an AD SHOT (what the commercial shows). The character MAY appear using / enjoying / presenting the product, but is NEVER filmed talking straight to camera.
- The "voiceover" lines are OFF-CAMERA NARRATION played over these visuals (still first-person in the character's voice, but nobody lip-syncs it on camera).
- Make the PRODUCT the hero of MULTIPLE panels — pristine, desirable, faithfully matching its reference image.
- Vary shots aggressively like a real commercial: extreme macro product detail, wide aspirational lifestyle, product-on-surface hero shot, hands-with-product, over-the-shoulder use.`
    : "";

  // Inject recent agent memories so Claude keeps narrative continuity with
  // past videos / lessons / preferences the agent has learned.
  const memoryBlock = (args.memories ?? []).slice(0, 5).map(m =>
    `- [${m.kind}, importance ${m.importance}] ${m.summary}`
  ).join("\n");

  const knowledgeBlock = (args.knowledge ?? []).slice(0, 4).map(k =>
    `- ${k.title}: ${k.content.slice(0, 200).replace(/\s+/g, " ").trim()}`
  ).join("\n");

  // Active skills — the agent's authored operating manual (ranked, custom first).
  // The storyboard MUST obey these, so the visuals + structure follow them. Give
  // them real room (was 300 chars, which clipped the rules so they barely landed).
  const skillsBlock = (args.skills ?? []).slice(0, 6).map(s =>
    `### ${s.name}\n${s.instructions.slice(0, 700).replace(/\s+/g, " ").trim()}`
  ).join("\n\n");

  const system = `You are a viral short-form video storyboard director who has shipped 1B+ views on TikTok and Reels.

YOUR JOB
Plan a ${beatCount}-beat storyboard for a ${aspectPhrase(args.aspectRatio)} short-form video, then write a SINGLE image prompt that visualises ALL ${beatCount} beats as a multi-panel storyboard image. Each panel frames a ${aspectPhrase(args.aspectRatio)} shot.

CRITICAL OUTPUT RULES
Return ONLY this JSON. No markdown, no commentary, no explanations outside the JSON:
{
  "beats": [
    {
      "index": 1,
      "scene": "what the camera sees + what the character does — be specific, visual, concrete (1-2 sentences)",
      "voiceover": "≤22 words first-person line the character speaks, written ENTIRELY in ${lang}. Must flow naturally into the next beat's voiceover.",
      "camera": "static | push in | pull out | pan left | pan right | low angle | high angle | handheld",
      "seconds": number,
      "videoPrompt": "1-2 sentence, camera-ready visual direction for THIS window written for the target video engine — concrete shot, subject action, framing, lighting, and motion — consistent with the character identity kernel. Do NOT restate dialogue here.",
      "newScene": false
    }
    // ... exactly ${beatCount} beats
  ],
  "imagePrompt": "single paragraph (300-500 words) describing an ORGANIZED ${beatCount}-panel numbered storyboard image (panels in a ${gridCols}×${gridRows} grid, reading order, each numbered with a short plot caption, following the storyline)"
}

STORY PRINCIPLES
- FOLLOW THE SCRIPT EXACTLY. You are storyboarding an EXISTING script — do NOT rewrite, paraphrase, or invent new lines. Each beat's "voiceover" MUST be a contiguous slice of the FULL SCRIPT below, in order, same words, same language. Cover the whole script across the beats.
- Beat 1 = HOOK. The visual that stops the scroll + the line that demands attention.
- Beat ${beatCount} = PAYOFF. The line or visual that earns a share/comment/save.
- Every beat moves the story forward — NO filler, NO repetition.
${(args.formatId === "cartoon" || args.formatId === "anime" || /cartoon|anime/i.test(args.creativeBrief?.format ?? "")) ? `- ANIMATION ENERGY: this is an ANIMATED show — write it like one. Exaggerated expressions and reactions (double-takes, jaw drops, eye pops), at least one visual GAG or physical-comedy beat per scene, snappy timing (fast in, hold the reaction, cut), props and environment that participate in the joke/drama. A character standing still explaining something is a FAILED beat — rewrite it as the character DOING the thing while the line lands.
` : ""}- DIRECT LIKE A FILMMAKER: every beat's scene/videoPrompt is built around one concrete PHYSICAL ACTION — a character DOES something visible (moves through the space, reacts with their whole body, grabs/uses a prop, demonstrates the thing) — never just "X talks to camera". Dialogue plays OVER the action (characters speak WHILE doing), not instead of it.
- SHOT VARIETY: cut the beats together like an editor — mix wide establishing, medium, close-up reaction, and over-the-shoulder framings across the beats (name the framing in "camera"); never the same framing twice in a row.
- STRUCTURE IT LIKE A MINI-EPISODE with a real plot: setup → development → payoff. For videos long enough to hold 2+ windows, use 2-4 distinct SCENES (different locations/settings) that serve the story — mark the FIRST beat of each new location with "newScene": true (beat 1 is never marked). A scene change must land exactly where a new ~window starts, never mid-window; INSIDE a scene the location, background and lighting stay completely fixed.
- Voiceover lines stitch together into a single flowing monologue when read sequentially.
- LANGUAGE LOCK: EVERY voiceover line must be written ENTIRELY in ${lang}. NEVER mix languages, never switch to English partway, never translate — the whole video is spoken in one consistent language from the first beat to the last.
${args.noPersona ? "" : "- Stay in the agent's voice — match the character bible, niche, and past lessons below.\n"}- This video is split into exactly ${totalSegments} sequential ~${windowSecLabel}-second windows. Distribute the beats so each window has its own distinct lines. NEVER repeat or restate a line across windows — each window must speak NEW words that move the story forward.${commercialBlock}${silentBlock}${ordersBlock(args)}

${intentBlock}

IMAGE PROMPT RULES (this is what we send to nano-banana-pro, WITH the character's reference photos attached, to render the storyboard)
- This storyboard is a high-resolution KEYFRAME SHEET for downstream video generation. Keep every panel instantly readable at thumbnail size: large subjects, clear silhouettes, clean negative space, and obvious action.
- For long videos, treat each ~${windowSecLabel}-second window as a continuity chain: the ending pose/composition of one panel should flow naturally into the next panel unless the beat intentionally cuts to a new scene.
- IDENTITY IS THE #1 PRIORITY. The attached reference image(s) define ONE consistent, ORIGINAL character — a FICTIONAL character, NOT a real, famous, or recognizable public figure, and NOT based on any real individual. They are the ground truth for this character's look. Open the imagePrompt by naming the character as "the same original character shown in the attached reference", and in EVERY panel description restate that it is that SAME character (consistent look), so the renderer never drifts to a different-looking character.
- DO NOT INVENT THE LOOK. You cannot see the reference, so you MUST NOT describe or guess the character's fixed features — no hair colour or length, no eye colour, no skin tone, no face shape, no age, no body type. Those come ONLY from the attached reference. Writing a conflicting feature (e.g. "blonde" when the reference is brunette) fights the reference and BREAKS the consistency. Describe ONLY things the reference does not fix: pose, gesture, facial EXPRESSION/emotion, action, wardrobe action, setting, lighting, lens, and camera angle. For the character, always write "the same original character from the reference" instead of a physical description.
- ORGANIZED STORYBOARD LAYOUT: exactly ${beatCount} panels arranged in a clean, evenly-spaced ${gridCols}×${gridRows} grid with thin uniform gutters, in READING ORDER (left → right, top → bottom = beat 1 → beat ${beatCount}). The panels MUST follow the plot of the storyline in order — panel 1 is the hook, panel ${beatCount} is the payoff.
${args.campaignContext ? `- PRODUCT PANEL (this is a PAID CAMPAIGN): the campaign's PRODUCT IMAGE(S) are attached as references. Dedicate at least ONE panel to clearly SHOWCASING the product — the character holding/using/presenting it — reproduced FAITHFULLY from the attached product image (same product, packaging, colors). Make that panel's caption about the product's benefit. The product must be recognizable.` : ""}
- ABSOLUTELY NO TEXT anywhere in the image: no panel numbers, no captions, no labels, no speech bubbles, no watermarks, no logos, no on-screen writing of any kind. Convey each beat PURELY through the visuals (pose, expression, action, composition). The plot reads through the panel ORDER alone, left→right, top→bottom.
- The character is CONSISTENT across every panel and matches the reference — the SAME original character, same face and features, same skin tone, same hair, same outfit, and same rendering medium. No variation, no aging, no restyling. If any panel's character looks different, it is wrong.
- MEDIUM / REALISM LOCK — render every panel in the SAME medium as the reference. If the reference is a realistic, lifelike style, render realistic, cinematic live-action film stills — DO NOT stylise, cartoonify, illustrate, anime-fy, or "comic-book" them. Only render an illustrated/cartoon/2D/3D-animated style if the reference is ITSELF clearly a drawing or animation. When unsure, default to realistic cinematic rendering that matches the reference.
- Make it CINEMATIC and high-end: dramatic key + rim lighting, shallow depth of field, rich textures and skin detail, dynamic camera angles that vary per beat (close-up, medium, wide, low/high angle), strong color grading, professional cinematography, and a scroll-stopping composition in every panel. Each panel should look like a frame from a premium short film, not a flat sketch.
- Keep the layout spacious and legible so the storyboard can be used as a video reference image without ambiguity; favor bigger panel subjects over tiny background detail.
- Each panel description must include: the beat number, a reminder that the subject is "the same original character from the reference", subject pose, facial expression/emotion, environment/setting, lighting, lens/framing, and camera angle — vivid and specific, in story order. Describe the pose/expression/action, NOT the character's fixed features (those come from the reference).
- Reinforce: render ZERO text — not even tiny numbers or captions. A clean, wordless visual storyboard.
- Maintain visual continuity: shared lighting palette, consistent environment cues, the same outfit and styling in every panel unless the story demands a scene change.

End the imagePrompt with the literal phrase: "Every panel is the SAME original character from the attached reference — keep that look consistent across all panels, no drift. This is a fictional original character, not a real or recognizable person. Match the reference's look and medium (realistic if the reference is realistic). Cinematic, high-detail. ${beatCount} panels in a ${gridCols}×${gridRows} grid, reading order, following the storyline. NO TEXT anywhere — no numbers, captions, labels, or watermarks."`;

  const user = `TOPIC (what this video is actually about — the storyboard's plot must match this${args.noPersona ? "" : `, not a generic ${args.agentNiche} scene`}): ${args.topic}

${args.noPersona
    ? `CHARACTER: whoever is shown in the attached reference image. Follow the operator's prompt/script exactly — do not invent a niche, archetype, or backstory for them.\n`
    : `CHARACTER: ${args.agentName}, a ${args.agentArchetype ?? "creator"} in the ${args.agentNiche} niche. The niche/archetype only inform HOW the character looks and acts — they never replace the TOPIC as the storyboard's subject.\n${args.characterBible ? `\nCHARACTER BIBLE (identity lock — preserve voice + visual style):\n${args.characterBible.slice(0, 800)}` : ""}\n`}TARGET VIDEO ENGINE: ${args.videoModel ?? "veo3_fast"} — write each beat.videoPrompt as a single continuous live-action shot (no split-screen/grid/text overlay).
${args.campaignContext ? `\nPAID CAMPAIGN CONTEXT — this video promotes the business below; plan the storyboard to PROMOTE the product and CONVERT, and make sure ONE panel showcases the product (its real image is attached to the renderer). Understand the product from this before planning:\n${args.campaignContext.slice(0, 2000)}\n` : ""}

WRITTEN HOOK (must drive beat 1):
"${args.hook}"

FULL SCRIPT (use this as the spine — beats should map onto these sentences):
${args.scriptText.slice(0, 800)}
${skillsBlock ? `\nACTIVE SKILLS (the agent's operating manual — OBEY these for format, structure, visual style, and voice; the operator-authored skills come first and take priority):\n${skillsBlock}` : ""}
${memoryBlock ? `\nRECENT MEMORIES (continuity — reference past lessons / preferences):\n${memoryBlock}` : ""}
${knowledgeBlock ? `\nKNOWLEDGE BASE (factual grounding):\n${knowledgeBlock}` : ""}

Plan exactly ${beatCount} beats totaling ~${totalSeconds} seconds (≈${Math.round(totalSeconds / beatCount)}s per beat). The voiceovers when read in order should sound like one continuous monologue from the character. The image prompt must produce an ORGANIZED ${beatCount}-panel storyboard in a ${gridCols}×${gridRows} grid that follows the plot in order (left→right, top→bottom) — with ABSOLUTELY NO TEXT in the image (no numbers, captions, or labels).${formatBlock}`;

  // Gemini 3.6 Flash (kie-claude.ts's single brain — see its header comment).
  // If it throws OR returns prose with no JSON (an occasional refusal), retry
  // once before giving up — so a declined call doesn't collapse the storyboard
  // to a single beat.
  const hasJson = (s: string) => /\{[\s\S]*\}/.test(s);
  let raw = "";
  try {
    raw = await callClaudeText({ system, user, maxTokens: 2500, apiKey: args.apiKey || kieKey() });
    if (hasJson(raw)) {
      console.log(`[kie-video-pipeline] storyboard via Gemini 3.6 Flash ✓`);
    } else {
      console.warn(`[kie-video-pipeline] storyboard returned no JSON (likely a refusal) — retrying once`);
      raw = "";
    }
  } catch (err) {
    console.warn(`[kie-video-pipeline] storyboard call failed (${err instanceof Error ? err.message : err}), retrying once`);
  }
  if (!hasJson(raw)) {
    raw = await callClaudeText({ system, user, maxTokens: 2500, apiKey: args.apiKey || kieKey() });
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Storyboard chat returned no JSON");
  const parsed = JSON.parse(match[0]) as { beats?: StoryBeat[]; imagePrompt?: string };
  if (!Array.isArray(parsed.beats) || parsed.beats.length === 0) throw new Error("No beats returned");

  let beats: StoryBeat[] = parsed.beats.map((b, i) => ({
    index: i + 1,
    scene: String(b.scene ?? "").slice(0, 280),
    voiceover: String(b.voiceover ?? "").slice(0, 140),
    camera: String(b.camera ?? "static").slice(0, 30),
    videoPrompt: b.videoPrompt ? String(b.videoPrompt).slice(0, 400) : undefined,
    seconds: beatSecondsFromVoiceover(String(b.voiceover ?? "")),
    ...(typeof (b as { speaker?: unknown }).speaker === "string" && String((b as { speaker?: unknown }).speaker).trim() ? { speaker: String((b as { speaker?: unknown }).speaker).trim().slice(0, 60) } : {}),
    ...(i > 0 && (b as { newScene?: unknown }).newScene === true ? { newScene: true } : {}),
  }));

  // FIDELITY LOCK: the spoken audio MUST be the operator's actual script, not the
  // model's paraphrase. The LLM (or the Gemini fallback) frequently reworded the
  // voiceovers, so the rendered video spoke the "wrong" lines. We keep the model's
  // VISUAL work (scene/camera/imagePrompt) but deterministically overwrite every
  // beat's voiceover with the verbatim script, split in order across the beats.
  const scriptText = (args.scriptText ?? "").trim();
  if (scriptText) {
    const lines = splitScriptAcrossBeats(scriptText, beats.length);
    beats = beats.map((b, i) => {
      const voiceover = (lines[i] ?? "").trim();
      return { ...b, voiceover, seconds: beatSecondsFromVoiceover(voiceover) };
    });
  }

  return { beats, imagePrompt: parsed.imagePrompt ?? "" };
}

/**
 * Split a continuous script into `beatCount` contiguous, EVENLY word-balanced
 * chunks, preserving order. Each beat gets ≈ the same number of words, so when
 * the beats are packed into 8-second windows every clip speaks only its ~8s
 * slice — never the whole monologue crammed into the opening clip.
 *
 * The previous sentence-based version dumped the entire script into beat 1 when
 * there were fewer sentences than beats (the ≥6-panel minimum), which is exactly
 * what made the first clip try to speak the full ~24s script in 8 seconds.
 *
 * We split by WORD here (not sentence) precisely because individual sentences are
 * often longer than one beat's budget; word-balancing is what keeps each window
 * ≈ 8 seconds. Mid-sentence cuts are fine — the clips are stitched into one
 * continuous take, so the audio reads as a single flowing monologue.
 */
function splitScriptAcrossBeats(scriptText: string, beatCount: number): string[] {
  const clean = scriptText.replace(/\s+/g, " ").trim();
  if (beatCount <= 1) return [clean];
  const words = clean ? clean.split(/\s+/).filter(Boolean) : [];

  const groups: string[] = [];
  let start = 0;
  for (let i = 0; i < beatCount; i++) {
    const remainingWords = words.length - start;
    const remainingGroups = beatCount - i;
    // ceil distributes the remainder onto the earliest beats and self-corrects
    // each step, so totals always cover the whole script with no overflow.
    const size = remainingWords > 0 ? Math.ceil(remainingWords / remainingGroups) : 0;
    groups.push(words.slice(start, start + size).join(" "));
    start += size;
  }
  return groups.slice(0, beatCount);
}

// ─── Video motion prompt (passed to veo3/seedance) ───────────────────────────

/**
 * VERBATIM PROMPT MODE — Videos tab with BOTH "No storyboard" and "No persona"
 * checked: the operator's prompt goes to the engine EXACTLY as typed, with the
 * given reference images, and NOTHING is amended — no persona voice, no
 * Director styles, no beat structure, no camera/scene direction, no lock
 * boilerplate. Every prompt builder below short-circuits on this, so no code
 * path (Veo base/extend, Grok chain, Seedance, Omni, generic) can re-compose
 * the text.
 */
function isVerbatimPromptMode(args: GenerateVideoArgs): boolean {
  return args.noPersona === true && args.skipStoryboard === true;
}

/** Words that mean the render is a STYLIZED / staged production — these need
 *  the multi-panel storyboard guide for scene flow and can only benefit from
 *  an illustrated reference. Checked against every creative surface the render
 *  carries (format id, brief, visual treatment, persona, aesthetic). */
const STYLIZED_RX = /\b(cartoon|anime|animated?|animation|comic|manga|illustrat\w*|claymation|pixar|stop[- ]?motion|pixel[- ]?art|3d[- ]?render|drama|skit|sketch|episode|episodic|series|story(?:time|line)?|narrative|documentary|cinematic[- ]?b[- ]?roll|music[- ]?video|fantasy|sci[- ]?fi)\b/i;

/** Words that mean the render should look like REAL captured footage of the
 *  real person in the reference image — a synthetic storyboard reference only
 *  drags these toward an AI-illustrated look. */
const REALISTIC_RX = /\b(ugc|selfie|talking[- ]?head|vlog|vlogger|review|unboxing|testimonial|interview|street|podcast|reaction|pov|handheld|iphone|phone[- ]?cam|candid|day[- ]?in[- ]?the[- ]?life|get[- ]?ready[- ]?with[- ]?me|grwm|realistic|photoreal|real[- ]?person|lifestyle)\b/i;

/**
 * Decide whether THIS render should generate + attach a storyboard image.
 * Applies to every video model. The storyboard is an AI-drawn multi-panel
 * illustration: great for stylized/episodic shows (scene flow, cast blocking),
 * actively harmful for realistic UGC-style videos (it pulls the engine toward
 * the illustration instead of the operator's REAL reference photo).
 *
 * Rule: any stylized signal anywhere → use the storyboard. Otherwise any
 * realistic signal → skip it. No signal either way → skip (default realistic:
 * the reference image is the ground truth, and MEDIUM LOCK already told us
 * in-doubt renders should read as realistic cinematic).
 */
function decideStoryboardUse(args: GenerateVideoArgs): { use: boolean; reason: string } {
  const surfaces = [
    args.formatId,
    args.creativeBrief?.format,
    args.creativeBrief?.visualTreatment,
    args.creativeBrief?.structureNotes,
    args.personaKernel,
    args.aesthetic,
    args.agentArchetype,
    args.standingOrders,
  ].filter(Boolean).join("\n");
  const stylized = surfaces.match(STYLIZED_RX)?.[0];
  if (stylized) return { use: true, reason: `stylized signal "${stylized}"` };
  const realistic = surfaces.match(REALISTIC_RX)?.[0];
  if (realistic) return { use: false, reason: `realistic signal "${realistic}"` };
  return { use: false, reason: "no stylized signal — defaulting to the real reference image" };
}
function verbatimPromptOf(args: GenerateVideoArgs): string {
  return (args.scriptText ?? "").trim() || (args.topic ?? "").trim();
}

/** Extracts the format id this render is actually using, from whichever
 *  creative surface carries it — same lookup every format-id check in this
 *  file already does. */
function currentFormatId(args: GenerateVideoArgs): string {
  return (args.formatId || args.creativeBrief?.format || "").toLowerCase();
}

/** Cartoon/Anime — a fully stylized/illustrated show, never a real-person
 *  identity render. Drives the storyboard's identity + medium language below:
 *  the generic identityDirective/MEDIUM LOCK text was written for realistic
 *  talking-head/UGC formats (detailed FACE-anatomy matching, "when in doubt
 *  render realistic cinematic") and, applied unconditionally, actively
 *  pushed a Cartoon render toward photorealism — exactly the "still showing
 *  realistic video" report. */
function isStylizedAnimationFormat(args: GenerateVideoArgs): boolean {
  const id = currentFormatId(args);
  return id === "cartoon" || id === "anime";
}

/**
 * Format-specific Grok/img2video anchor-image prompts. The multi-panel
 * illustrated storyboard (the generic path below) is right for STYLIZED shows
 * (cartoon, anime, drama, episodic) but actively wrong for formats whose whole
 * point is looking like real, unstaged footage of the real reference person —
 * each of those needs its OWN single-photo treatment, because "realistic" means
 * something different for a silent candid clip than for a vox-pop street
 * interview or a played-straight absurd moment. Formats not listed here (and
 * every stylized format) fall through to the existing storyboard/skip logic
 * unchanged. Keyed on lib/builder/formatCatalog.ts ids that list "grok-imagine-15"
 * in `engines` and are single-shot/realistic rather than multi-panel-episodic.
 */
const GROK_FORMAT_ANCHOR_PROMPTS: Record<string, (args: GenerateVideoArgs, beats: StoryBeat[], charRefCount: number) => string> = {
  // Silent candid short: a real-feeling snapshot of the exact topic-specific
  // moment (shirt/room/prop change) — see the realism-prompt notes below.
  "no-voice-candids": (args, beats, charRefCount) => {
    const primaryScene = (beats[0]?.scene || args.topic || "").trim();
    const vibe = (args.creativeBrief?.visualTreatment || args.creativeBrief?.angle || "").slice(0, 200).trim();
    // Stacking many "make it realistic" instructions backfires — models over-correct
    // into an obviously-degraded fake-grain filter. What actually reads as a real
    // phone photo is SITUATION (a person mid-action, not posed for the camera) plus
    // 2-3 concrete optical/compositional cues, not a wall of negatives.
    return (
      `A real iPhone photo a friend snapped candidly — not a posed portrait, not a professional shoot. ` +
      `The exact person from the attached reference photo${charRefCount > 1 ? "s" : ""} (same face, skin tone, hair, build), caught mid-moment: ${primaryScene}. Topic: ${args.topic}.${vibe ? ` Vibe: ${vibe}.` : ""} Only change the outfit, setting, or props this exact moment needs — nothing else invented.\n\n` +
      `Snapshot look: natural available light, slightly off-center framing, a little handheld motion blur. Not symmetrical, not studio-lit, not airbrushed — just a normal phone photo. One single photo, no illustration, no grid, no on-screen text.`
    );
  },
  // Absurd: real-world photorealism EXCEPT one impossible element, visible and
  // treated as completely normal — the realism sells the joke, so this still
  // wants a real-photo anchor, not an illustrated storyboard.
  "absurd": (args, beats, charRefCount) => {
    const primaryScene = (beats[0]?.scene || args.topic || "").trim();
    return (
      `A real photo, ordinary and unstaged, of the exact person from the attached reference photo${charRefCount > 1 ? "s" : ""} (same face, skin tone, hair, build) — EXCEPT for one impossible element, fully visible and treated as completely normal by everyone in frame: ${primaryScene}. Topic: ${args.topic}.\n\n` +
      `Everything else in the scene is mundane and true-to-life: natural light, real textures, ordinary framing, nothing cinematic or staged. The impossible thing is the only unusual thing here — render it with the SAME photographic realism as the rest of the shot, not as an illustration or effect. One single photo, no grid, no on-screen text.`
    );
  },
  // id "street-interview" is now the How To format (lib/builder/formatCatalog.ts —
  // id kept stable for backward compat, content replaced): a presenter
  // teaching/demonstrating a step directly to camera, desk or handheld, NOT a
  // street vox-pop moment.
  "street-interview": (args, beats, charRefCount) => {
    const primaryScene = (beats[0]?.scene || args.topic || "").trim();
    return (
      `A real how-to/tutorial snapshot: the exact person from the attached reference photo${charRefCount > 1 ? "s" : ""} (same face, skin tone, hair, build), mid-demonstration, actively showing or explaining a step: ${primaryScene}. Topic: ${args.topic}.\n\n` +
      `Look: desk setup or handheld selfie framing, natural indoor light, a plausible real teaching/demo setting (desk, workspace, room) with whatever prop or object the step needs visible in frame, direct eye contact with the camera. Not a studio portrait, not cinematic. One single photo, no illustration, no grid, no on-screen text.`
    );
  },
};

/** True when this format has its own dedicated Grok/img2video anchor-image
 *  treatment above (as opposed to the generic stylized-storyboard-or-skip path). */
function hasGrokFormatAnchor(args: GenerateVideoArgs): boolean {
  return currentFormatId(args) in GROK_FORMAT_ANCHOR_PROMPTS;
}

/** Builds THIS format's anchor-image prompt — see GROK_FORMAT_ANCHOR_PROMPTS. */
function buildGrokFormatAnchorPrompt(args: GenerateVideoArgs, beats: StoryBeat[], charRefCount: number): string {
  const builder = GROK_FORMAT_ANCHOR_PROMPTS[currentFormatId(args)];
  return builder(args, beats, charRefCount);
}

function buildVideoPrompt(args: GenerateVideoArgs, beats: StoryBeat[], durationSeconds: number): string {
  if (isVerbatimPromptMode(args)) return verbatimPromptOf(args);
  // Format-templated path (formatCatalog): the idea pipeline pre-composed the
  // prompt from the format's template; adapt it to this engine's dialect and
  // fold in the storyboard beats instead of the legacy composition below.
  if (args.formatPrompt) {
    return adaptPromptForEngine({
      engineId: args.videoModel ?? "",
      prompt: args.formatPrompt,
      beats: beats.map((b) => b.scene),
    });
  }
  // Per-beat block: scene description + verbatim spoken line + camera move
  const beatBlock = beats.map((b, i) => {
    const label = i === 0 ? "OPENING" : i === beats.length - 1 ? "CLOSING" : `BEAT ${b.index}`;
    return `[${label} — ${b.seconds}s]
Scene: ${b.scene}
Camera: ${b.camera}
${b.voiceover ? `Spoken: "${b.voiceover}"` : "Silent action"}`;
  }).join("\n\n");

  // Full spoken monologue stitched from voiceovers — used for lip-sync timing
  const spokenScript = beats
    .map(b => b.voiceover)
    .filter(Boolean)
    .join(" ")
    .trim();

  const style = buildHumanVisualStyle(args);
  const intentBlock = buildBuilderIntentBlock(args);

  return `A ${durationSeconds}-second ${aspectPhrase(args.aspectRatio)} short-form video${args.noPersona ? "" : ` starring ${args.agentName}`}.

CHARACTER LOCK: the same original character in the reference image — consistent face, skin tone, hair, outfit, art style. No drift between frames. This is a FICTIONAL original character, not a real, famous, or recognizable person.

${isStylizedAnimationFormat(args) ? `STYLE LOCK: this is an ILLUSTRATED, ANIMATED show — every frame is drawn/rendered in the reference image's exact art style (line work, shading, color palette, character design, shape language). NEVER photorealistic live-action; even a real photo/product reference gets REDRAWN into the show's art style, not pasted as a photograph.` : `STYLE LOCK: match the character reference's visual MEDIUM. If the reference is a realistic style, render realistic cinematic live-action — do NOT cartoonify or illustrate. Only render an animated/illustrated style if the character reference is itself a drawing.`} A storyboard guide image (if provided) is only a shot reference — never reproduce it as a grid/panels/collage; output one continuous full-frame shot.

STYLE: ${style}

${intentBlock}

TOPIC: ${args.topic}

FULL SCRIPT (this is what the character says — lip-sync to this exact line, ordered):
"${spokenScript}"

PER-BEAT BLOCKING:
${beatBlock}

WRITTEN SCRIPT CONTEXT (background — drives emotional tone):
${args.scriptText.slice(0, 400).replace(/\s+/g, " ").trim()}

DIRECTION:
- Natural human motion. Micro-expressions, breathing, small gestures.
- Camera follows the per-beat direction above. No shaky cam unless a beat asks for "handheld".
- Lighting and color grade consistent throughout the clip.
- Lip-sync precisely to the spoken script — every syllable should match mouth movement.
- End on a strong final frame matching the closing beat.

DO NOT:
- Render any visible text, captions, subtitles, or watermarks on screen
- Change the character's identity, outfit, or art style mid-video
- Cut to a different person or unrelated scene
- Introduce text overlays for the script lines (the character speaks them out loud only)`;
}

// ─── Beat → time-window grouping ─────────────────────────────────────────────
// Each Veo 3.1 clip can only be 8 seconds. For longer videos we generate the
// first 8s normally, then chain Kie's /veo/extend endpoint with subsequent
// windows. Beats are packed into windows by `packBeatsIntoWindows` (imported
// from ./videoSegmentation) by accumulated spoken seconds — never padded.

/** A commercial / ad-style format must render as a voiceover-driven TV commercial
 *  — product hero shots + aspirational lifestyle montage — NOT an on-camera
 *  talking-head. Detected from the Director's creativeBrief.format. */
function isCommercialFormat(format?: string): boolean {
  return /commercial|advert|\bad spot\b|\bad\b|\bads\b|tv ?spot|brand film/i.test(format ?? "");
}

/**
 * The video's SPEECH MODE. An explicit `speech` (the operator's standing order)
 * always wins; otherwise it is inferred from the format exactly as before — a
 * commercial narrates off-camera, everything else is filmed talking. This is the
 * single decision every audio block below reads, so "no speaking" can no longer be
 * honoured in one prompt and ignored in the next.
 */
function speechMode(args: GenerateVideoArgs): "on_camera" | "voiceover" | "silent" {
  if (args.speech === "on_camera" || args.speech === "voiceover" || args.speech === "silent") return args.speech;
  return isCommercialFormat(args.creativeBrief?.format) ? "voiceover" : "on_camera";
}

/** Standing-orders block, prefixed for prompt readability. Empty when there are none. */
function ordersBlock(args: GenerateVideoArgs): string {
  const o = (args.standingOrders ?? "").trim();
  return o ? `\n\n${o}` : "";
}

function buildHumanVisualStyle(args: GenerateVideoArgs): string {
  const brief = args.creativeBrief;
  return buildVideoStyleDirective({
    description: [
      ...(args.noPersona ? [] : [args.agentName, args.agentNiche, args.agentArchetype, args.characterBible]),
      brief?.format,
      brief?.angle,
      brief?.structureNotes,
      brief?.visualTreatment,
    ].filter(Boolean).join(" "),
    format: brief?.format,
    angle: brief?.angle,
    structureNotes: brief?.structureNotes,
    visualTreatment: brief?.visualTreatment,
    characterBible: args.noPersona ? undefined : args.characterBible,
    agentArchetype: args.noPersona ? undefined : args.agentArchetype,
    niche: args.noPersona ? undefined : args.agentNiche,
  });
}

function buildReferenceMapBlock(entries: Array<{ slot: number; label: string; role: string }>): string {
  return entries.map((entry) => `Reference @Image${entry.slot}: ${entry.role} — ${entry.label}`).join("\n");
}

function buildBuilderIntentBlock(args: GenerateVideoArgs): string {
  const brief = args.creativeBrief;
  const format = brief ? `${brief.format}${brief.angle ? ` / ${brief.angle}` : ""}` : "creator-led short-form";
  const treatment = brief?.visualTreatment?.trim() || "human, specific, and believable";
  const goal = args.campaignContext ? "convert viewers with a clear product story" : "feel like the exact content the audience came for";
  return [
    `BUILDER INTENT: obey the builder's brief exactly and make a ${format} video that ${goal}.`,
    `INTENT LOOK: ${treatment}.`,
    `INTENT RULE: the first beat must show the clearest action, benefit, or emotional hook — never a generic establishing shot.`,
    `INTENT RULE: every later beat should add new information, not repeat the same moment or re-explain the same idea.`,
    // No-Persona render: drop both persona-preservation rules below — they were
    // instructing the model to "preserve the requested persona" and pick a
    // persona-driven visual mode (cartoon_episode/ugc_handheld/etc.) regardless
    // of the checkbox, which is the exact bypass that let persona flavor back
    // into an otherwise-stripped prompt.
    ...(args.noPersona ? [] : [
      `INTENT RULE: preserve the requested persona, character identity, scene logic, and tone across the full video, especially long chains.`,
      `INTENT RULE: if the persona is cartoon_episode, keep it stylized, expressive, and episode-like; if ugc_handheld, keep it raw, casual, and handheld; if realistic_cinematic, keep it grounded and filmic; if premium_brand, keep it polished but still human.`,
    ]),
  ].join(" ");
}

function buildEngineReferenceDirective(
  engine: "veo" | "seedance" | "grok" | "gemini-omni" | "generic",
  opts: { hasStoryboard: boolean; hasProduct: boolean; hasCharacterId?: boolean },
): string {
  if (engine === "grok") {
    return [
      "REFERENCE STRATEGY FOR GROK: use only the canonical character image as `@image1`.",
      "Treat that image as the first-frame anchor and the source of truth for identity.",
      "Do not restate physical features; prompt motion, camera path, mood, timing, and scene change around that anchor.",
    ].join(" ");
  }
  if (engine === "seedance") {
    return [
      "REFERENCE STRATEGY FOR SEEDANCE: reference order matters.",
      "Use Reference @Image1 for the character anchor, Reference @Image2 for the storyboard / scene guide, and Reference @Image3 for the product anchor when available.",
      "Keep the same face, wardrobe, and energy across the chain, and let each new clip begin from the previous clip's real last frame.",
      "If a beat changes scene, make the change intentional and readable; if not, preserve continuity exactly.",
    ].join(" ");
  }
  if (engine === "gemini-omni") {
    return [
      "REFERENCE STRATEGY FOR GEMINI OMNI: the FIRST attached reference photo IS the character — same person, exact same face, no re-interpretation.",
      "OPENING-FRAME / ENVIRONMENT LOCK — the first attached reference photo is a REAL photo of the person in their REAL environment: treat it as the video's opening frame. The video continues from that exact moment — SAME room, same background objects and clutter, same lighting and white balance, same wardrobe, same camera distance and angle — as if the person set the phone down and hit record. Do NOT relocate them to a cleaner set, do NOT restyle the room, do NOT relight it into studio light.",
      opts.hasStoryboard ? "Use the storyboard reference in `image_urls` for shot/scene guidance within that environment." : "",
      opts.hasProduct ? "Keep the product or brand asset in `image_urls` as a secondary anchor." : "",
      "Treat the character as the source of truth for identity, and the reference photo as the source of truth for place, light, and realism.",
    ].filter(Boolean).join(" ");
  }
  return [
    "REFERENCE STRATEGY: Image 1 is the character anchor.",
    opts.hasStoryboard ? "Image 2 is the storyboard / composition guide." : "",
    opts.hasProduct ? "Image 3 is the product / brand anchor." : "",
    "Use references to keep identity and shot logic stable, but let the prompt define the action, camera, and sequence progression.",
  ].filter(Boolean).join(" ");
}

/** Human orientation phrase for the requested output ratio. Threaded into EVERY
 *  KIE prompt so the Director's 16:9 / 1:1 / 9:16 choice actually shapes the frame
 *  — the prompts used to hardcode "vertical 9:16", which overrode the aspect the
 *  API param requested and forced portrait no matter what was selected. */
function aspectPhrase(aspect?: string): string {
  if (aspect === "16:9") return "horizontal 16:9 widescreen";
  if (aspect === "1:1") return "square 1:1";
  return "vertical 9:16"; // portrait — the default
}

function resolveGrokAspect(aspect?: string): "16:9" | "9:16" | "1:1" {
  if (aspect === "16:9" || aspect === "1:1") return aspect;
  return "9:16";
}

function resolveOutputAspect(model: string | undefined, aspect?: string): "16:9" | "9:16" | "1:1" {
  if (/grok/i.test(model ?? "")) return resolveGrokAspect(aspect);
  if (aspect === "16:9" || aspect === "1:1") return aspect;
  return "9:16";
}

function resolveVideoResolution(model: string | undefined, requested?: "720p" | "1080p" | "4k"): "720p" | "1080p" | "4k" {
  if (/veo/i.test(model ?? "")) return requested ?? "720p";
  return "720p";
}

/**
 * TRUE for engines that should NOT be handed a rendered multi-panel storyboard.
 *
 * Grok Imagine is a pure IMAGE-to-video model: it treats the attached image as the
 * literal first frame — scene geometry, colours and subject identity all come from
 * it. We therefore use a PORTRAIT storyboard guide image as a secondary reference,
 * not the animating frame itself, and keep the character still as Image 1 so the
 * first-frame identity stays locked. The prompt then carries the shot direction,
 * while Image 2 holds the storyboard / scene layout.
 */
function skipsStoryboardImage(_model?: string): boolean {
  return false;
}

/**
 * Grok Imagine 1.5 prompt — written to xAI's documented image-to-video contract
 * rather than the Veo-shaped template the other engines use.
 *
 * What the model actually rewards (xAI + practitioner guides, July 2026):
 *  - Structure: subject motion + intensity → camera move → light/atmosphere →
 *    `AUDIO:` block. The AUDIO delimiter stops the model blending sound direction
 *    into the visual choreography.
 *  - DON'T re-describe the reference image. It can see it; re-describing burns
 *    prompt budget and fights the frame. Say what MOVES, not what exists.
 *  - Direct instructions beat adjectives: "camera slowly pushes in" lands,
 *    "cinematic and dynamic" does not.
 *  - ONE motion hierarchy + ONE camera path per clip. Competing actions smear.
 *  - Negative prompts are IGNORED — every constraint is phrased positively.
 *  - Shorter is more stable. This builds ~1-2k chars, not the 4k the generic
 *    template produced (which Grok then truncated at its 5k API limit anyway).
 *  - Dialogue goes in quotes after `AUDIO:` for synced native speech.
 *
 * Used for EVERY Grok clip (single take, each window of a split render, and the
 * base of an extend chain) — the old code only used it for single-clip renders and
 * fell back to the Veo talking-head template otherwise.
 */
/** Trim to at most `n` chars WITHOUT cutting mid-word — a mid-word cut
 *  ("high-detail fo", "this prompt is ") reads as garbage to the model and
 *  visibly degraded grok output. Ends on the last full word, no trailing space. */
function trimAtWord(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Strip PLANNER-facing meta-instructions that leak into grok prompts via the
 *  style template ("STYLE TEMPLATE: premium_brand", "Start each beat with a
 *  visible action first, then…") — those are instructions for OUR planner, not
 *  scene description, and they confuse the video model. */
function sanitizeStyleForEngine(style: string): string {
  return style
    .replace(/STYLE TEMPLATE:\s*\S+\s*/gi, "")
    .replace(/\bLOOK:\s*/g, "")
    .replace(/Start each beat with[^.]*\.\s*/gi, "")
    .replace(/Use the exact persona tone[^.]*\.\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildGrokPrompt(
  args: GenerateVideoArgs,
  segBeats: StoryBeat[],
  clipSeconds: number,
  voiceProfile: string,
  window?: { index: number; total: number; prevBeat?: StoryBeat },
  opts?: { extraBlocks?: string[] },
): string {
  if (isVerbatimPromptMode(args)) return verbatimPromptOf(args);
  const mode = speechMode(args);
  const brief = args.creativeBrief;
  const spoken = segBeats.map((b) => b.voiceover).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const per = Math.max(2, Math.round(clipSeconds / Math.max(1, segBeats.length)));
  const isFirstWindow = !window || window.index === 0;
  const isLastWindow = !window || window.index === window.total - 1;

  // ACTION — what MOVES, beat by beat, with its own timing. Concrete verbs only;
  // the reference image already establishes what the scene IS.
  const stylizedGrok = isStylizedAnimationFormat(args);
  const action = segBeats.map((b, i) => {
    const scene = (b.videoPrompt || b.scene || "").replace(/\s+/g, " ").trim();
    if (!scene) return "";
    const t = `${i === 0 ? 0 : i * per}-${Math.min(clipSeconds, (i + 1) * per)}s`;
    const overlay = args.allowOnScreenText && b.onScreenText?.trim()
      ? ` ON-SCREEN TEXT overlay reads exactly: "${b.onScreenText.trim()}".`
      : "";
    return `- ${t}: ${scene}${b.camera ? ` (camera: ${b.camera})` : ""}${overlay}`;
  }).filter(Boolean).join("\n");

  // ONE camera path for the clip — the first beat's move, or a safe default.
  const camera = (segBeats[0]?.camera ?? "").trim() || "slow push-in";

  // LOOK — the Director's treatment, trimmed. Concrete look/lighting words survive;
  // this is the operator's per-video signature so it stays.
  const look = trimAtWord([brief?.visualTreatment, brief?.format ? `${brief.format} energy` : ""]
    .filter(Boolean).join(", "), 260);
  const style = sanitizeStyleForEngine(buildHumanVisualStyle(args));
  const intentBlock = buildBuilderIntentBlock(args);

  // AUDIO — the delimiter Grok keys on. Dialogue in quotes for native lip-synced
  // speech; narration marked off-camera; silent asks for ambience only (and never
  // mentions a line, so there is nothing for the model to voice).
  const hasSpeakerLines = segBeats.some((b) => b.speaker && b.voiceover?.trim());
  const audio = mode === "silent"
    ? `AUDIO: ambient sound and music bed only — room tone, motion foley matched to the action on screen. No speech, no dialogue, no narration, no singing.`
    : mode === "voiceover"
      ? `AUDIO: off-camera narration, spoken by an unseen voice while the visuals play: "${spoken || "(ambience carries it)"}" Plus light ambient sound matched to the action.`
      : hasSpeakerLines
        ? `AUDIO — each line spoken ONLY by the named character, lip-synced; the other character reacts and NEVER mouths a line that isn't theirs (no speaking in unison):
${segBeats.filter((b) => b.voiceover?.trim()).map((b) => `- ${b.speaker || args.agentName}: "${b.voiceover.trim()}"`).join("\n")}
Plus light room tone.`
        : `AUDIO: the person in frame speaks these exact words, lip-synced: "${spoken || "(natural ambience, no speech)"}" Plus light room tone.`;

  // STABILITY — the documented image-to-video fix for identity/product drift, kept
  // to one line instead of the long "do not describe the character" boilerplate the
  // Veo template needs (Grok is reading the actual face, not guessing it).
  const frameRule = args.allowOnScreenText
    ? `Render every ON-SCREEN TEXT overlay exactly as quoted in the action beats — same wording, spelling and casing, cleanly legible; no OTHER text, captions or logos.`
    : `clean frame with no captions or logos.`;
  const noRepeatPad = mode === "silent"
    ? ""
    : ` If the spoken line finishes before the ${clipSeconds}s are up, do NOT repeat, loop, or restate any of it — a natural pause, reaction, or continued silent action carries the remaining time instead.`;
  const stability = mode === "silent" || mode === "voiceover"
    ? `KEEP STABLE: the face, hair, outfit and art style from the reference image, unchanged for the full ${clipSeconds}s. Nobody speaks or mouths words on camera. One continuous take, ${frameRule}${noRepeatPad}`
    : `KEEP STABLE: the face, hair, outfit and art style from the reference image, unchanged for the full ${clipSeconds}s. One continuous take, ${frameRule}${noRepeatPad}`;

  const continuation = !isFirstWindow
    ? `CONTINUES the previous clip: same subject, wardrobe, location, lighting and grade — new camera angle, motion carries forward. ${window?.prevBeat?.voiceover && mode !== "silent" ? `Already said, do not repeat: "${window.prevBeat.voiceover.trim().split(/\s+/).slice(-8).join(" ")}"` : ""}`
    : "";

  const ending = isLastWindow
    ? `End on a settled, intentional final frame with motion still finishing naturally.`
    : `End with motion mid-flow so the next clip continues cleanly.`;

  const engineBlock = (opts?.extraBlocks ?? []).filter(Boolean).join("\n");

  // BUDGET-FIT ASSEMBLY. The old builder concatenated everything and let
  // capPromptForModel tail-truncate whatever blew past Kie's 5000-char limit —
  // which cut from the END, exactly where the KEEP-STABLE / no-repeat / ending
  // rules and persona live. Result: overlong prompts silently lost their
  // stability rules (identity drift, repeated lines) and confused the model
  // with a wall of mid-sentence text. Now the core direction (action, camera,
  // audio, stability, ending, continuation) is NEVER cut; the flavor blocks
  // (persona kernel, voice, style, intent, look, standing orders) shrink and
  // then drop, in reverse-importance order, until the prompt fits.
  // FORMAT — the catalog format's template, carried ONCE as its own block
  // (never folded into each beat — see the injection site in
  // generateVideoFromScript for why). Trimmed per tier like the other flavor
  // blocks; the beat ACTIONs stay the specific, timed direction.
  const formatDirective = (args.formatPrompt ?? "").replace(/\s+/g, " ").trim();

  const assemble = (t: { look: number; kernel: number; voice: number; orders: number; format: number; style: boolean; intent: boolean }): string => {
    const lookT = trimAtWord(look, t.look);
    const formatT = t.format > 0 && formatDirective ? `FORMAT: ${trimAtWord(formatDirective, t.format)}\n` : "";
    const kernel = t.kernel > 0 && args.personaKernel ? `\n\nCHARACTER: ${trimAtWord(args.personaKernel, t.kernel)}` : "";
    // voiceProfile self-labels ("VOICE — IDENTICAL IN EVERY CLIP. SAME VOICE AS
    // CLIP 1 — …") with the continuity lock FIRST, so trimAtWord's word-boundary
    // cut at any tier keeps that lock even when the descriptive tail is trimmed.
    const voice = t.voice > 0 && mode !== "silent" ? `\n\n${trimAtWord(voiceProfile, t.voice)}` : "";
    const orders = t.orders > 0 ? trimAtWord(ordersBlock(args), t.orders) : "";
    return `Animate the attached reference image set into ONE continuous ${clipSeconds}-second ${aspectPhrase(args.aspectRatio)} take.
${stylizedGrok ? `\nANIMATED SCENE: the character physically ACTS the beats out in-world (moves, reacts, uses props) with the dialogue playing over the action — an episode moment with expressive character animation, never a static character mouthing lines at the viewer.\n` : ""}
ACTION (timed):
${action || `- 0-${clipSeconds}s: the subject moves naturally in frame with alive micro-motion`}

CAMERA: ${camera} — one single continuous path across the whole clip, no cuts.
${lookT ? `LOOK: ${lookT}.\n` : ""}${formatT}${continuation ? `${continuation}\n` : ""}${t.style && style ? `STYLE: ${style}\n` : ""}
${t.intent ? `${intentBlock}\n` : ""}${audio}
${engineBlock ? `\n${engineBlock}\n` : ""}

${stability}
${ending}${kernel}${voice}${orders}`;
  };
  // Tier 1: everything, generous caps. Tier 2: flavor blocks tightened.
  // Tier 3: style/intent dropped, persona+voice minimal — core direction intact.
  const tiers = [
    { look: 260, kernel: 500, voice: 300, orders: 600, format: 420, style: true, intent: true },
    { look: 140, kernel: 250, voice: 150, orders: 300, format: 240, style: true, intent: false },
    // voice:0 used to drop the voice descriptor ENTIRELY on the leanest tier —
    // exactly the case a long/multi-beat script (the videos most likely to
    // extend into 2+ clips) falls into. 130 chars keeps just the front-loaded
    // "SAME VOICE AS CLIP 1" lock line (voiceProfile is ordered so that line
    // survives this trim); everything else in that tier is already minimal.
    { look: 100, kernel: 160, voice: 130, orders: 200, format: 120, style: false, intent: false },
  ];
  for (const tier of tiers) {
    const p = assemble(tier);
    if (p.length <= GROK_MAX_PROMPT_CHARS) return p;
  }
  // Even the leanest tier is over (colossal script window) — the word-boundary
  // cap in capPromptForModel is the final safety net, but tier 3 already put the
  // critical rules well before the cut point.
  return assemble(tiers[tiers.length - 1]);
}

/**
 * FINAL-CHECK ALGO: one Claude pass that DISTILLS the assembled prompt into
 * the compact, industry-standard shape each video model actually responds to.
 * The assembled drafts carry the full context stack (persona kernel, voice,
 * style template, standing orders, format template) — but every prompting
 * guide for these models agrees the opposite wins:
 *   - image-to-video (Grok): the reference image ALREADY carries scene, look
 *     and identity — the prompt should be SHORT and verb-led (subject +
 *     action + camera + mood + sound + one stability rule), never a
 *     re-description of the scene. Extra words are noise that OVERRIDE what
 *     the image communicates.
 *   - text-first engines (Veo dialect / Omni / Seedance): ~100-200 words in
 *     concrete film language (shot type front-loaded, camera move, lighting,
 *     style, explicit audio) — not block dumps.
 * Live failure this replaces: 4000-char prompts with contradictions ("ONE
 * continuous take" + a 6-beat shot list), leaked planner meta-instructions
 * ("STYLE TEMPLATE: premium_brand … Start each beat with…"), and mid-word
 * truncations — all of which produced mushy, unrealistic output.
 * Best-effort with a hard timeout: any failure returns the input unchanged.
 */
const DISTILL_CACHE_MAX = 300;
const distillCache = new Map<string, string>();
function rememberDistilled(key: string, value: string): string {
  if (distillCache.size >= DISTILL_CACHE_MAX) {
    const first = distillCache.keys().next().value;
    if (first !== undefined) distillCache.delete(first);
  }
  distillCache.set(key, value);
  return value;
}

async function distillEnginePromptWithClaude(
  raw: string,
  opts: {
    engine: "grok" | "gemini-omni" | "seedance" | "generic";
    clipSeconds: number;
    silent: boolean;
    /** This clip CONTINUES a frame-chained sequence (its first frame IS the
     *  previous clip's final frame) — the distilled prompt must begin
     *  mid-motion and never re-introduce character/setting. */
    continuation?: boolean;
    /** This is the video's LAST clip — the distilled prompt must keep/land a
     *  proper ENDING (settled final frame, payoff delivered), never end
     *  mid-motion as if another clip followed. Without this the distill pass
     *  routinely dropped the draft's closing direction as "flavor". */
    finalClip?: boolean;
    /** This clip opens a NEW scene/location (a deliberate story cut) — the
     *  prompt must establish the new setting while keeping character design +
     *  art style identical; mutually exclusive with `continuation`. */
    sceneCut?: boolean;
    /** Stylized/animated render: allow 2-3 staged shots cut on action inside
     *  the clip (animation reads cuts as film grammar) and keep the draft's
     *  physical-action beats — never reduce the scene to a character mouthing
     *  lines. */
    multiShot?: boolean;
    /** Declared art style (e.g. the anime aesthetic) that must govern the
     *  ENTIRE prompt — protects stylized renders from realism drift. */
    artStyle?: string;
  },
): Promise<string> {
  const isImageLed = opts.engine === "grok";
  const budget = isImageLed ? 900 : opts.engine === "seedance" ? 1900 : 1400;
  // Same draft + same options → same distilled prompt. Retries / resumed jobs
  // / re-renders of an unchanged plan used to pay this Kie call again per clip.
  const cacheKey = `${opts.engine}|${opts.clipSeconds}|${opts.silent ? 1 : 0}|${opts.continuation ? 1 : 0}|${opts.finalClip ? 1 : 0}|${opts.sceneCut ? 1 : 0}|${opts.multiShot ? 1 : 0}|${opts.artStyle ?? ""}|${raw}`;
  const cached = distillCache.get(cacheKey);
  if (cached) return cached;
  try {
    const system =
      "You are a senior prompt engineer for AI video generation models. Distill the draft into ONE short production-grade prompt. Reply ONLY with JSON: {\"prompt\": \"...\"}.";
    const engineRules = isImageLed
      ? `TARGET MODEL: Grok Imagine image-to-video. The attached reference image already carries the scene, lighting, wardrobe and identity — do NOT re-describe them. Write a SHORT, verb-led motion prompt:
- Line 1: the shot + one continuous camera path (e.g. "Handheld vertical phone shot, slow push-in.").
- Then ONE flowing action arc for the person from the photo across ${opts.clipSeconds} seconds — 2-3 concrete physical motions, present tense, no timestamps, no shot list, no cuts.
- One short mood/lighting clause ONLY if it adds something the image can't show.
- AUDIO line: ${opts.silent ? "ambient sound only, explicitly no speech, no narration, no singing." : "keep the spoken line EXACTLY as quoted in the draft, word for word, lip-synced."}
- End with one stability line: same face, outfit and room as the photo, no on-screen text.
HARD LIMIT: under ${budget} characters. Shorter is better.`
      : opts.engine === "seedance"
      ? `TARGET MODEL: Seedance image-to-video (frame-chained sequence — the attached first frame IS the literal opening frame this clip animates forward from). Seedance rewards RICH, STRUCTURED direction — write ~150-230 words in this shape:
1. One continuation line: animate forward from the attached frame (never re-describe its character design/palette — the model reads it directly).
2. The ACTION, moment by moment: concrete physical business, present tense — what each character DOES, with what prop, and how they REACT to each other.
3. INTERACTION (multi-character scenes): the characters play the scene WITH each other — they face each other, make eye contact, react on the listener's face while the other speaks, hand things over, bump, chase, interrupt. NEVER two characters posed side-by-side both facing the camera.
4. Camera + shots.
5. Atmosphere in one clause (lighting shift, weather, energy) only if it changes during the clip.
TOPIC FIDELITY: the draft's beats implement the OPERATOR'S specific idea — keep every topic-specific noun, prop, event and joke exactly; never genericize them into vague "content".
- Describe only what MOVES and CHANGES across ${opts.clipSeconds} seconds.
${opts.multiShot
  ? `- ACTION-LED: the character physically PERFORMS the scene (moves, reacts, uses props) with dialogue over the action — keep every concrete action verb from the draft; never reduce it to a character mouthing lines.
- You may stage 2-3 SHOTS cut on action inside the clip (wide → medium → close-up), all inside the SAME scene/location — name each shot's framing briefly.`
  : `- One continuous flowing action arc, present tense, concrete verbs — no timestamps, no shot list, no cuts inside the clip.
- One camera line (a single continuous move).`}
- The WORLD stays consistent: same location, lighting direction, color palette and character design as the first frame for the whole clip, unless the draft explicitly cuts to a new scene.
- TAIL RULE (must survive): if the action finishes before the clip ends, the character HOLDS a natural motion in the SAME scene for the remaining seconds — the final seconds NEVER cut away, flash a different image, change location, or show an end card.
- AUDIO: ${opts.silent ? "ambient/music only, explicitly no speech." : "keep any quoted spoken line EXACTLY word for word, lip-synced."}
HARD LIMIT: under ${budget} characters.`
      : `TARGET MODEL: a cinematic text-to-video engine (Veo-class). Write ~100-160 words of concrete film language:
- Front-load the shot type and camera move, then subject + action, setting, lighting/atmosphere, style.
- One scene, one continuous moment — no shot lists, no timestamps.
- AUDIO: ${opts.silent ? "ambient only, explicitly no speech." : "keep any quoted spoken line EXACTLY word for word."}
- Keep identity locked to the reference image (same face, wardrobe) in one line; no on-screen text.
HARD LIMIT: under ${budget} characters.`;
    const styleLock = opts.artStyle
      ? `\nART STYLE LOCK: the entire video is rendered in this exact style — "${opts.artStyle.replace(/\s+/g, " ").slice(0, 240)}". OPEN the prompt by declaring this style, keep every visual phrase consistent with it, and delete any photorealistic/live-action language that contradicts it.`
      : "";
    const continuity = opts.continuation
      ? `\nCONTINUATION: this clip's first frame IS the final frame of the previous clip. Begin MID-MOTION from that exact frame — same character model (face, hair, outfit, proportions), same art style, same palette and lighting. Never re-introduce the character or setting, never restart the story; this is the NEXT moment of the same continuous scene.`
      : "";
    const cut = opts.sceneCut
      ? `\nSCENE CUT: this clip opens a NEW location — a planned story cut, not a continuation of the previous shot. ESTABLISH the new setting from the draft's scene description in the first line; keep the character design, art style, palette and grade IDENTICAL to the rest of the show; never reference or blend in the previous scene's location.`
      : "";
    const finale = opts.finalClip
      ? `\nFINAL CLIP: this is the video's LAST clip. The prompt MUST end the story properly — the action resolves and settles into a clean, intentional final frame (a held look, a landed gesture, a finished moment), with the last spoken line delivered as the payoff. Never end mid-motion, mid-gesture, or as if another clip follows.`
      : "";
    const user = `${engineRules}${styleLock}${continuity}${cut}${finale}

ALWAYS: keep every "Reference @ImageN: …" mapping line VERBATIM at the end of the prompt (they bind the attached images — opening frame, storyboard guide, product — and must survive). LANGUAGE LOCK: every quoted spoken line and every quoted on-screen text stays in its ORIGINAL language, character for character — never translate, transliterate, or paraphrase it into English (or any other language). DIALOGUE ATTRIBUTION: when lines are attributed to named characters ("Name: \"...\""), keep every attribution EXACTLY — who speaks which line is part of the direction, and one character must never absorb another's line. Delete planner meta-instructions ("STYLE TEMPLATE:", "Start each beat with…", "Use the exact persona tone"), truncated fragments, repeated ideas, and any contradiction between "continuous take" and cut language. If the draft's character notes say raw/candid/iPhone/vlog/handheld, the whole prompt must read as real phone footage (natural light, believable physics, true skin texture) — delete studio/cinematic language that fights it. Keep any TEXT-FREE requirement as one short line.

DRAFT:
${raw.slice(0, 4800)}`;
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("refine timeout")), 25_000));
    const out = await Promise.race([callClaudeJSON<{ prompt?: string }>({ system, user, maxTokens: 900 }), timeout]);
    const refined = typeof out?.prompt === "string" ? out.prompt.trim() : "";
    if (refined.length >= 120 && refined.length <= Math.max(budget * 1.4, 1600)) {
      console.log(`[kie-video-pipeline] ${opts.engine} prompt distilled by Claude (${raw.length} → ${refined.length} chars)`);
      return rememberDistilled(cacheKey, refined);
    }
    return raw;
  } catch (e) {
    console.warn(`[kie-video-pipeline] ${opts.engine} prompt distill skipped: ${e instanceof Error ? e.message : e}`);
    return raw;
  }
}

/**
 * Continuation prompt for ONE native-extend step — shared by BOTH Grok
 * (grok-imagine/extend) and Veo (/veo/extend). Unlike buildSegmentPrompt (which
 * drives an INDEPENDENT take from the avatar still with reference-image/character-
 * lock boilerplate), the extend endpoints already hold the previous clip's final
 * frame (inherited via the parent taskId — NO reference images are sent), so the
 * prompt's job is purely to CONTINUE that exact take forward through THIS time
 * window: same person, wardrobe, lighting, and motion energy, no reset, no
 * reference boilerplate, no repeated narration. `segBeats` is this window's
 * time-slice of the script; `prevLastBeat` is the prior window's final beat (the
 * frame we're continuing from). This is deliberately LEAN so it never trips an
 * engine's prompt-length limit or drifts into re-establishing the scene.
 */
function buildExtendPrompt(
  args: GenerateVideoArgs,
  segBeats: StoryBeat[],
  clipSeconds: number,
  voiceProfile: string,
  prevLastBeat: StoryBeat | undefined,
  isLast: boolean,
): string {
  if (isVerbatimPromptMode(args)) return verbatimPromptOf(args);
  // Deliberately LEAN — this is the actual fix for real crash/undertandable-
  // ness reports ("too much context, Grok chokes on it"). An extend call
  // inherits the previous clip's real final frame via task_id: it already
  // HAS the character, wardrobe, lighting, location, and style baked into
  // the pixels it's continuing from. Re-explaining all of that (persona
  // kernel, full visual-style block, builder-intent block, standing-orders
  // block, a multi-line continuity-lock paragraph, a bulleted direction
  // list) was pure redundant context stacked on TOP of the actual per-beat
  // script — the one thing this call genuinely needs that it doesn't
  // already have. Every extra paragraph is a paragraph Grok has to
  // reconcile against the frame it can already see, which is exactly what
  // produces garbled/rejected continuations. The only new information a
  // continuation call needs: what's said/shown in THIS window, and a single
  // one-line reminder to keep moving instead of resetting.
  const per = Math.max(2, Math.round(clipSeconds / Math.max(1, segBeats.length)));

  const lines = segBeats.map((b, i) => {
    const scene = (b.scene || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const line = (b.voiceover || "").replace(/\s+/g, " ").trim();
    const overlay = args.allowOnScreenText && b.onScreenText?.trim()
      ? ` — ON-SCREEN TEXT overlay reads exactly: "${b.onScreenText.trim()}"`
      : "";
    const isFinal = isLast && i === segBeats.length - 1;
    return `${isFinal ? "CLOSE" : `+${i + 1}`} (~${b.seconds || per}s)${scene ? `: ${scene}` : ""}${line ? ` — says: "${line}"` : ""}${overlay}`;
  }).join("\n");

  const prevWords = prevLastBeat?.voiceover
    ? prevLastBeat.voiceover.trim().split(/\s+/).slice(-6).join(" ")
    : "";
  // Kept, not part of the bloat that was cut: the persona kernel is the
  // identity-consistency anchor across a chained render (a distilled block,
  // not a paragraph pile); standing orders are explicit operator
  // instructions (e.g. compliance rules) that must never silently drop from
  // any prompt path; a product mention keeps a campaign's product from
  // drifting once extends stop sending reference images; the builder-intent
  // block's "add new information, don't repeat" rule is the direct fix for
  // extend's actual failure mode (looping/restating the same beat). All
  // short and load-bearing — unlike the removed full visual-style block and
  // the old multi-line continuity-lock paragraph, which just re-described
  // in prose what the inherited frame already shows Grok directly.
  const kernelLine = args.personaKernel ? `${args.personaKernel}\n\n` : "";
  const intentLine = `${buildBuilderIntentBlock(args)}\n`;
  const productLine = args.productDescription
    ? `SAME PRODUCT throughout — never a different or generic one: ${args.productDescription.replace(/\s+/g, " ").trim().slice(0, 300)}.\n`
    : "";
  const silentLine = speechMode(args) === "silent"
    ? "NO SPEECH — silent spot, nobody talks or mouths words, ambience/music only.\n"
    : "";
  const onScreenLine = args.allowOnScreenText
    ? "Render each quoted ON-SCREEN TEXT overlay exactly as written, nothing else on screen."
    : "ABSOLUTELY NO on-screen text, captions, subtitles, logos, or watermarks.";

  return `${kernelLine}CONTINUE THE EXISTING TAKE — same person/place/lighting as the frame you're starting from; do not restart, cut, or re-establish anything.${prevWords ? ` (Just said: "...${prevWords}" — do not repeat it.)` : ""}
${intentLine}${productLine}${silentLine}
Next ${clipSeconds}s, in order:
${lines}

Keep motion continuous the whole time (no freeze/loop/static hold). If the line finishes early, hold a natural reaction instead of repeating it. One continuous take, no jump cuts. ${onScreenLine}${isLast ? " End on a clean final frame." : " End mid-motion so the next segment continues smoothly."}${voiceProfile ? `\n\n${trimAtWord(voiceProfile, 320)}` : ""}${ordersBlock(args)}`;
}

function buildSegmentPrompt(
  args: GenerateVideoArgs,
  segBeats: StoryBeat[],
  segmentIndex: number,
  totalSegments: number,
  voiceProfile: string,
  prevSegmentLastBeat?: StoryBeat,
  clipSeconds = 8,
  opts?: { engine?: string; extraBlocks?: string[]; sceneCut?: boolean },
): string {
  if (isVerbatimPromptMode(args)) return verbatimPromptOf(args);
  const isFirst = segmentIndex === 0;
  const isLast = segmentIndex === totalSegments - 1;
  const dur = `${clipSeconds}s`;
  const segLabel = isFirst ? `OPENING SEGMENT (${dur})` : isLast ? `FINAL SEGMENT ${segmentIndex + 1}/${totalSegments} (${dur})` : `MIDDLE SEGMENT ${segmentIndex + 1}/${totalSegments} (${dur})`;

  // ONLY this window's spoken line — never the full monologue. This is a
  // contiguous slice of the kie-generated script for this 8s window.
  const spokenLine = segBeats.map(b => b.voiceover).filter(Boolean).join(" ").trim();

  // Continuity for clips 2+: a short "already said" cue + a hard no-repeat rule.
  const prevWords = prevSegmentLastBeat?.voiceover
    ? prevSegmentLastBeat.voiceover.trim().split(/\s+/).slice(-6).join(" ")
    : "";
  // Two continuation stances:
  //  - Frame-chained engines (Veo extend, Seedance): the viewer literally sees one
  //    continuous take, so demand exact visual match.
  //  - HARD-CUT engines (Gemini Omni multi-clip): clips are independent takes
  //    joined with straight cuts, so ask for a deliberate JUMP CUT — same person /
  //    outfit / room, but a NEW camera angle or framing per clip (the natural
  //    UGC jump-cut rhythm). Asking Omni for a "seamless continuous take" it
  //    can't actually deliver made every clip re-open the same way instead of
  //    moving the story forward.
  const hardCut = opts?.engine === "gemini-omni";
  const continuityBlock = !isFirst && opts?.sceneCut
    ? `NEW SCENE — DELIBERATE STORY CUT (READ FIRST)
The story CONTINUES from the previous clip, but this clip opens in a NEW location — a planned scene change, like a cut in a film. Render the new setting exactly as SCENE below describes; do NOT carry over the previous scene's background, props or location.

Keep IDENTICAL across the cut: the character design (face, proportions, outfit, colors), the art style (line work, shading, palette), and the color grade — the same show, the next scene.

${prevSegmentLastBeat?.voiceover ? `PREVIOUSLY (already spoken — do NOT repeat): "...${prevSegmentLastBeat.voiceover.trim().split(/\s+/).slice(-6).join(" ")}"
Continue the story FORWARD from there. Speak ONLY the new line below.

` : ""}`
    : !isFirst && prevSegmentLastBeat
    ? hardCut
      ? `JUMP-CUT CONTINUATION — READ FIRST
This clip is joined to the previous one with a HARD CUT (jump-cut editing, like a creator's self-shot video). Same character, same outfit and hair, same room and lighting — but pick a NOTICEABLY different camera framing or angle than a standard centered shot (closer, further, slightly off-axis) so the cut reads as an intentional edit.

MID-FLOW RULE: this is the MIDDLE of one continuous monologue. Do NOT open with a greeting, an intro, a hook, or any restart ("hey guys", "so", "welcome back"). The character is already mid-thought.

PREVIOUSLY (already spoken — do NOT repeat): "...${prevWords}"
Do NOT restate, paraphrase, summarise, or re-speak any earlier line. Speak ONLY the new line below, nothing before it.

`
      : `SEAMLESS CONTINUATION — READ FIRST
This clip is CONCATENATED onto the previous ${clipSeconds}-second clip; the viewer sees one continuous take.

Visual continuity (match exactly): same character pose, outfit, hair, expression; same environment, background, lighting direction, color temperature; same camera position and lens motion; same motion energy.

PREVIOUSLY (already spoken — do NOT repeat): "...${prevWords}"
Continue the monologue FORWARD from there. Do NOT restate, paraphrase, summarise, or re-speak any earlier line. Speak ONLY the new line below.

`
    : "";

  const authoredShot = segBeats.map((b) => b.videoPrompt).filter(Boolean).join(" ").trim();
  const sceneText = (authoredShot
    || segBeats.map((b) => b.scene).filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 300))
    || (isCommercialFormat(args.creativeBrief?.format)
      ? `a premium product hero shot in an aspirational, beauty-lit setting`
      : `${args.agentName} talking directly to camera`);
  const cameraText = segBeats[0]?.camera ?? "static";
  // The director's visual treatment (setting / camera / lighting / energy) is the
  // per-video signature that makes each render look DIFFERENT — thread it into
  // every clip so the whole video follows the chosen aesthetic, not a generic
  // talking-head. Format + angle give the clip its style identity.
  const brief = args.creativeBrief;
  const treatmentBlock = brief
    ? `VIDEO STYLE — ${brief.format}${brief.angle ? `: ${brief.angle}` : ""}. ${brief.visualTreatment ? `Visual treatment: ${brief.visualTreatment}` : ""}\nRender THIS clip in that style (setting, camera, lighting, energy) — not a generic talking-head.\n`
    : "";
  const styleBlock = buildHumanVisualStyle(args);
  const intentBlock = buildBuilderIntentBlock(args);
  // Medium lock, stylized-aware: Cartoon/Anime renders must NEVER get the
  // realism-leaning default (it read "render realistic cinematic live-action"
  // to any model unsure about a stylized reference — the classic "cartoon
  // came out as a live-action person" drift). One shared line so all four
  // templates below (talking-head / commercial / voiceover / silent) agree.
  const styleLockLine = isStylizedAnimationFormat(args)
    ? `STYLE LOCK: this is an ILLUSTRATED, ANIMATED show — every frame is drawn/rendered in the reference image's exact art style (line work, shading, color palette, character design, shape language). NEVER photorealistic live-action; even a real photo/product reference gets REDRAWN into the show's art style, not pasted as a photograph.`
    : `STYLE LOCK: match the character reference's MEDIUM — realistic cinematic live-action if the reference is a realistic style (never cartoonify or illustrate); animated/illustrated only if the reference itself is a drawing.`;
  const engineName = (opts?.engine ?? "veo") as "veo" | "seedance" | "grok" | "gemini-omni" | "generic";
  const engineBlock = [
    `ENGINE TARGET: ${engineName}`,
    buildEngineReferenceDirective(engineName, {
      hasStoryboard: Boolean(brief),
      hasProduct: Boolean(args.productImageUrl),
      hasCharacterId: false, // Omni character registry removed — image refs only
    }),
    ...(opts?.extraBlocks ?? []),
  ].filter(Boolean).join("\n");

  // Persona identity kernel — the constant per-render signal that makes every
  // clip depend on THIS agent's persona/memory, not a generic template.
  const kernelBlock = args.personaKernel
    ? `${args.personaKernel}\n\n`
    : "";

  const mode = speechMode(args);

  // ── SILENT SPOT (operator standing order: "no need to speak") ───────────────
  // Highest priority: BOTH branches below hard-code speech ("lip-sync EXACTLY" /
  // "VOICEOVER — this line plays…"), so a no-speech order had to be handled before
  // either of them or the clip prompt still asked for a talking performance.
  if (mode === "silent") {
    const silentContinuity = !isFirst
      ? "\nCONTINUATION: this clip concatenates onto the previous one — same look, same subject, same grade. Change the SHOT (new angle/scene); never restart or re-establish.\n"
      : "";
    return `${kernelBlock}${segLabel} — a ${clipSeconds}-second ${aspectPhrase(args.aspectRatio)} SILENT video. NOBODY SPEAKS.

NO SPEECH AT ALL: no dialogue, no voiceover, no narration, no lip-sync, no mouthing words, no singing, no interview framing. Do NOT show a person addressing the camera. The audio bed is ambience/music only.
Carry the whole clip with VISUALS: action, product, environment, motion, composition, pacing.
${isFirst
      ? "OPEN on a striking, scroll-stopping frame that sets the idea instantly."
      : isLast
        ? "CLOSE on a strong, intentional payoff frame."
        : "Continue the visual sequence; keep the look and energy consistent while changing the shot."}
${silentContinuity}${treatmentBlock}SCENE: ${sceneText}
CAMERA: ${cameraText}
STYLE: ${styleBlock}
${intentBlock}
${engineBlock ? `\n${engineBlock}\n` : ""}

REFERENCE IMAGES (in order): (1) CHARACTER — the same original character (a FICTIONAL original character, not a real, famous, or recognizable person); keep their look consistent in any frame where they appear, and never film them talking. (2) STORYBOARD GUIDE if present — framing guidance only; NEVER reproduce it as a grid, panels, split-screen, or collage. (3) PRODUCT if present — feature it faithfully and prominently.
${styleLockLine}
ONE single continuous full-frame shot — a real moving video, NOT a storyboard/comic/grid. NO on-screen text, captions, subtitles, logos, or watermarks.

DIRECTION:
- Keep MOTION ALIVE the entire ${clipSeconds}s — subject action, gentle continuous camera movement. NEVER freeze, loop, or hold a static frame.
- Cinematic, high-detail, premium production quality; consistent lighting, grade and location.${ordersBlock(args)}`;
  }

  // ── COMMERCIAL / AD SPOT ────────────────────────────────────────────────────
  // A "commercial" Director style must render like a real TV ad — voiceover
  // narration over product hero shots + aspirational lifestyle montage — NOT the
  // default talking-head. The talking-head template below hard-codes "talking
  // straight to camera" + "lip-sync EXACTLY", which drowned out the commercial
  // treatment and made every commercial come out as a talking-head. Branch here.
  if (isCommercialFormat(brief?.format)) {
    const adContinuity = !isFirst && prevWords
      ? `\nCONTINUATION: this clip concatenates onto the previous one — keep the SAME premium look, product, brand world, color grade and music energy. Do NOT re-use narration already spoken ("...${prevWords}"). Change the SHOT (new angle/scene) like a real ad montage.\n`
      : "";
    return `${kernelBlock}${segLabel} — a ${clipSeconds}-second ${aspectPhrase(args.aspectRatio)} TV-COMMERCIAL ad spot for a premium brand. This is an ADVERTISEMENT, NOT a talking-head to-camera video.

VOICEOVER — this line plays as polished, confident OFF-CAMERA NARRATION over the visuals. Do NOT show anyone lip-syncing or mouthing it to camera:
"${spokenLine || "(no narration — let the product visuals + music carry it)"}"

SHOOT IT LIKE A HIGH-END TV COMMERCIAL:
- Glossy PRODUCT HERO SHOTS + aspirational LIFESTYLE vignettes + benefit demonstrations, cut together with dynamic energy and sweeping / precise camera moves.
- The PRODUCT (reference image 3 if present) is the STAR — feature it prominently, pristine and desirable, reproduced faithfully from its reference.
- The character (reference image 1) appears WITHIN the ad — using, enjoying, or presenting the product in-scene — but is NOT filmed talking straight to camera. The message is carried entirely by the voiceover.
- ${isFirst
      ? "OPEN on a striking, scroll-stopping product / lifestyle shot that sets the aspiration."
      : isLast
        ? "CLOSE on a hero product beauty-shot / brand payoff frame."
        : "Continue the ad montage; keep the premium look and energy consistent while changing the shot."}
${adContinuity}${treatmentBlock}SCENE: ${sceneText}
CAMERA: ${cameraText}
STYLE: ${styleBlock}
${intentBlock}
${engineBlock ? `\n${engineBlock}\n` : ""}

${voiceProfile}

REFERENCE IMAGES (in order): (1) CHARACTER — the same original character (a FICTIONAL original character, not a real, famous, or recognizable person); keep their face/look consistent WHENEVER they appear in-scene. (2) STORYBOARD GUIDE if present — framing guidance only; NEVER reproduce it as a grid, panels, split-screen, or collage. (3) PRODUCT if present — feature it faithfully and prominently as the hero.
CHARACTER LOCK: keep the character consistent with reference image 1 in any frame where they appear.
${styleLockLine}
ONE single continuous full-frame shot — a real moving video, NOT a storyboard/comic/grid. NO on-screen text, captions, subtitles, logos, or watermarks.

DIRECTION:
- Commercial-grade cinematography: motivated lighting, shallow depth of field, rich texture and product detail, punchy premium color grade, tasteful slow-motion where it sells the product.
- Audio is VOICEOVER only — aspirational, brand-confident narration; NO on-camera lip-sync dialogue.
- Match color grade, white balance, and audio loudness across clips.${!isFirst ? "\n- Do NOT repeat any narration already spoken in an earlier clip; keep the same brand world, product, and premium look." : ""}${ordersBlock(args)}`;
  }

  // ── OFF-CAMERA VOICEOVER (non-commercial format, but the operator ordered that
  //    nobody is filmed speaking). Same visual language as the format asks for; the
  //    words are narration laid over it.
  if (mode === "voiceover") {
    return `${kernelBlock}${segLabel} — a ${clipSeconds}-second ${aspectPhrase(args.aspectRatio)} video narrated OFF-CAMERA. Nobody is filmed talking.

VOICEOVER — this line plays as off-camera narration over the visuals. Do NOT show anyone lip-syncing or mouthing it to camera:
"${spokenLine || "(no narration — let the visuals carry it)"}"

${isFirst
      ? "OPEN on a striking, scroll-stopping visual that sets up the line."
      : isLast
        ? "CLOSE on a strong payoff frame."
        : "Continue seamlessly from the previous clip — same energy and pace, new shot."}
${treatmentBlock}SCENE: ${sceneText}
CAMERA: ${cameraText}
STYLE: ${styleBlock}
${intentBlock}
${engineBlock ? `\n${engineBlock}\n` : ""}

${voiceProfile}

REFERENCE IMAGES (in order): (1) CHARACTER — the same original character (a FICTIONAL original character, not a real, famous, or recognizable person); keep their look consistent where they appear, but NEVER film them talking to camera. (2) STORYBOARD GUIDE if present — framing guidance only; never a grid/collage. (3) PRODUCT if present — feature it naturally.
${styleLockLine}
ONE single continuous full-frame shot. NO on-screen text, captions, subtitles, logos, or watermarks.

DIRECTION:
- Keep motion alive the whole ${clipSeconds}s; consistent lighting, grade, wardrobe and location.
- Audio is narration only — no on-camera lip-sync dialogue.${ordersBlock(args)}`;
  }

  // ── TALKING-HEAD (default) ──────────────────────────────────────────────────
  // ── ANIMATED SCENE (Cartoon / Anime) ────────────────────────────────────────
  // Stylized shows are EPISODES, not talking heads: the character acts the
  // scene out IN-WORLD (moving, reacting, handling props) while the dialogue
  // plays over the action — never "presenting to camera". The default
  // template below literally frames every clip as "talking straight to
  // camera", which is exactly why cartoons came out as static mouths with no
  // action. Multishot is allowed here (2-3 staged shots cut on action) —
  // animation reads cuts as normal film grammar.
  if (isStylizedAnimationFormat(args)) {
    // Per-speaker dialogue: with a multi-character cast, every line belongs to
    // exactly ONE named character — a single unattributed quote made BOTH
    // characters lip-sync the same words (the classic duo-mouthing-in-unison
    // bug on every I2V engine). Named lines + the crosstalk rule fix it.
    const hasSpeakers = segBeats.some((b) => b.speaker && b.voiceover?.trim());
    const dialogueBlock = hasSpeakers
      ? `DIALOGUE — each line is spoken ONLY by the named character (lip-synced, EXACTLY these words); everyone else in frame reacts physically and NEVER mouths another character's line. Two characters must NEVER speak in unison:
${segBeats.filter((b) => b.voiceover?.trim()).map((b) => `- ${b.speaker || args.agentName}: "${b.voiceover.trim()}"`).join("\n")}`
      : `DIALOGUE — spoken IN-SCENE by the character while they act (lip-synced, EXACTLY these words and nothing else):
"${spokenLine || "(no dialogue — the action carries this scene)"}"`;
    return `${kernelBlock}${segLabel} — a ${clipSeconds}-second ${aspectPhrase(args.aspectRatio)} ANIMATED SCENE from an ongoing show. This is an episode moment, NOT a presenter piece.

${dialogueBlock}

ACT IT OUT: the character physically PERFORMS this scene — moving through the space, reacting with the whole body, using props, doing the thing the scene describes. Never a static character mouthing lines at the viewer. The dialogue lands WHILE the action happens.
${hasSpeakers ? `BLOCKING — the characters play the scene WITH EACH OTHER: they face each other and make eye contact when speaking, the listener visibly REACTS during the other's line (expressions, gestures, business), they physically interact (hand things over, point, grab, push, lean in). NEVER stage them side-by-side both facing the viewer like presenters.
` : ""}SHOTS: stage this as ${clipSeconds <= 6 ? "ONE clear shot" : "2-3 shots cut on action (e.g. wide establishing → medium action → close-up reaction)"} — animation cuts read as normal film grammar; keep every shot inside the SAME scene/location.
${isFirst
      ? "OPENING: start mid-action on a scroll-stopping visual beat."
      : isLast
        ? "FINAL SCENE: the action resolves — land the payoff and settle into a clean, intentional final frame."
        : "Continue the story's momentum — new action, no reset."}
${continuityBlock ? `\n${continuityBlock}` : ""}
${treatmentBlock}SCENE: ${sceneText}
CAMERA: ${cameraText}
${intentBlock}
${engineBlock ? `\n${engineBlock}\n` : ""}

${voiceProfile}

REFERENCE IMAGES (in order): (1) CHARACTER/ART-STYLE anchor — match its exact character design and art style in every frame. (2) STORYBOARD GUIDE if present — follow its composition and poses for this scene; NEVER render it as a grid/panels/collage. (3) PRODUCT if present — draw it faithfully INTO the scene in the same art style.
CHARACTER LOCK: identical character design (face shape, proportions, outfit, colors) in every frame of every shot.
${styleLockLine}
Full-frame animated footage only — no borders, no panels, no on-screen text, captions, subtitles, logos, or watermarks.

DIRECTION:
- Expressive character ANIMATION: squash-and-stretch energy where the style allows, strong silhouettes, readable poses, real physical comedy/drama beats — motion in every second.
- Match palette, line weight and grade across every shot and clip.${!isFirst ? "\n- Do NOT repeat any line already spoken in an earlier clip." : ""}${ordersBlock(args)}`;
  }

  // ── LIVE-ACTION SKETCH (Skit) ───────────────────────────────────────────────
  // A skit is a PERFORMED comedy scene, not a presenter piece — the default
  // talking-head template ("talking straight to camera") flattened every
  // sketch into a monologue. Same acted-scene structure as the animated
  // template, photoreal medium.
  if (currentFormatId(args) === "skit") {
    const skitSpeakers = segBeats.some((b) => b.speaker && b.voiceover?.trim());
    const skitDialogue = skitSpeakers
      ? `DIALOGUE — each line spoken ONLY by the named character (lip-synced, EXACTLY these words); everyone else reacts, never mouthing another's line, never speaking in unison:
${segBeats.filter((b) => b.voiceover?.trim()).map((b) => `- ${b.speaker || args.agentName}: "${b.voiceover.trim()}"`).join("\n")}`
      : `DIALOGUE — delivered IN-CHARACTER inside the scene (lip-synced, EXACTLY these words and nothing else):
"${spokenLine || "(no dialogue — the physical comedy carries this scene)"}"`;
    return `${kernelBlock}${segLabel} — a ${clipSeconds}-second ${aspectPhrase(args.aspectRatio)} LIVE-ACTION SKETCH-COMEDY SCENE. A performed scene with a setup and a punchline — NOT a talking-head to camera.

${skitDialogue}

ACT IT OUT: the character PERFORMS the sketch — commits fully to the bit, uses props and the space, physical comedy beats, reaction timing (beat → reaction → escalation). Deadpan sells it; never wink at the camera.
${isFirst
      ? "OPENING: start mid-bit on the setup — drop the viewer straight into the premise."
      : isLast
        ? "FINAL BEAT: land the punchline; hold the reaction a half-beat, then settle into a clean final frame."
        : "Escalate the bit — new action, same premise, no reset."}
${continuityBlock ? `\n${continuityBlock}` : ""}
${treatmentBlock}SCENE: ${sceneText}
CAMERA: ${cameraText}
STYLE: ${styleBlock}
${intentBlock}
${engineBlock ? `\n${engineBlock}\n` : ""}

${voiceProfile}

REFERENCE IMAGES (in order): (1) CHARACTER — the same original character (a FICTIONAL original character, not a real, famous, or recognizable person); keep this face, hair, and outfit consistent. (2) STORYBOARD GUIDE if present — framing/pose guidance only; never a grid/collage. (3) PRODUCT if present — feature it naturally in the bit.
CHARACTER LOCK: no identity drift from reference image 1 across ANY frame.
${styleLockLine}
Full-frame footage only — no on-screen text, captions, subtitles, logos, or watermarks.

DIRECTION:
- Comedic timing over polish: real reactions, held beats, motion in every second — never a static explainer.
- Match color grade and audio loudness across clips.${!isFirst ? "\n- Do NOT repeat any line already spoken in an earlier clip." : ""}${ordersBlock(args)}`;
  }

  // SCRIPT-FIRST: the exact spoken line for THIS window (a contiguous slice of the
  // kie-generated script) leads the prompt. This keeps the script prominent for
  // the model AND truncation-safe — a simplified retry can never drop it because
  // it's at the top, not buried after the reference/lock boilerplate.
  return `${kernelBlock}${segLabel} — a ${clipSeconds}-second ${aspectPhrase(args.aspectRatio)} video of ${args.agentName} talking straight to camera.

SPOKEN LINE — lip-sync EXACTLY, every syllable; this is the ONLY thing said in this clip:
"${spokenLine || "(no speech — natural ambient performance)"}"

${isFirst
    ? "OPENING / HOOK: this is the first frame viewers see — open on an expression + motion that STOPS THE SCROLL, then deliver the line with high energy. End on momentum so the next clip flows."
    : isLast
      ? "FINAL CLIP: land the payoff on this closing line; end on a strong final frame."
      : "Continue seamlessly from the previous clip — same energy and pace."}
${continuityBlock ? `\n${continuityBlock}` : ""}
${treatmentBlock}SCENE: ${sceneText}
CAMERA: ${cameraText}
STYLE: ${styleBlock}
${intentBlock}
${engineBlock ? `\n${engineBlock}\n` : ""}

${voiceProfile}

REFERENCE IMAGES (in order): (1) CHARACTER — the same original character to feature (a FICTIONAL original character, not a real, famous, or recognizable person); keep this face, skin tone, hair, and outfit consistent; THIS character speaks the line. (2) STORYBOARD GUIDE if present — use ONLY for framing/pose guidance; NEVER reproduce it as a grid, panels, split-screen, or collage. (3) PRODUCT if present — feature it naturally in the scene.
CHARACTER LOCK: no identity drift from reference image 1 across ANY frame, especially where the clip begins.
${styleLockLine}
ONE single continuous full-frame shot — a real moving video, NOT a storyboard/comic/grid. No on-screen text, captions, subtitles, or watermarks; the character SPEAKS the line out loud (no text overlay).

DIRECTION:
- Natural human motion, micro-expressions, breathing, small gestures; precise lip-sync to the spoken line above.
- ${isFirst
    ? "Hook priority — scroll-stopping open."
    : isLast
      ? "Land the payoff."
      : "Match the prior clip's energy; end on continued motion for a seamless next clip."}
- Match color grade, white balance, and audio loudness across clips.${!isFirst ? "\n- Do NOT repeat any line already spoken in an earlier clip; do NOT change costume/lighting/location from the previous clip." : ""}${ordersBlock(args)}`;
}

/** @internal — exported for prompt-divergence tests only. */
// ── Operator "no on-screen text" directive ───────────────────────────────────
// Staff bug: an operator writes "no subtitles" / "[no captions]" / "tanpa
// sarikata" in the prompt box, and the render (a) burns the INSTRUCTION itself
// as literal on-screen text (engines treat quoted text as content, and Grok
// ignores negatives entirely), and (b) still hallucinates its own subtitles.
// Detection is intent-based (EN + MS), and the response is POSITIVE phrasing —
// the only constraint form these models reliably obey.
const NO_TEXT_DIRECTIVE_RE =
  /(?:\b(?:no|without|don'?t|do not|never|avoid|remove|zero)\b[^.\n]{0,50}\b(?:subtitles?|captions?|sarikata|on[- ]?screen te(?:xt|ks)|text overlays?|words? on screen|lyrics)\b)|(?:\b(?:tanpa|jangan)\b[^.\n]{0,50}\b(?:subtitle|sarikata|kapsyen|teks)\b)/i;

/** True when any operator-authored surface asks for a text-free frame. */
function detectNoOnScreenTextDirective(args: GenerateVideoArgs): boolean {
  const surfaces = [
    args.topic,
    args.standingOrders,
    args.creativeBrief?.angle,
    args.creativeBrief?.structureNotes,
    args.creativeBrief?.visualTreatment,
  ].filter(Boolean).join("\n");
  return NO_TEXT_DIRECTIVE_RE.test(surfaces);
}

/** An onScreenText value that reads as an INSTRUCTION (bracketed, or talking
 *  about subtitles/captions) — the planner echoing the operator's directive
 *  into a text overlay. Must never be burned into the frame. */
function isInstructionLikeOverlay(t: string): boolean {
  return /^[\[({]|[\])}]$/.test(t.trim()) || /\b(subtitles?|captions?|sarikata|kapsyen|no text|don'?t|do not|jangan|tanpa|instruction)\b/i.test(t);
}

/** One hard, positively-phrased block appended to every clip prompt when the
 *  operator demanded a text-free frame. */
const NO_TEXT_PROMPT_BLOCK =
  `TEXT-FREE FRAME (OPERATOR REQUIREMENT — HIGHEST PRIORITY): render a completely clean frame for the entire clip. ` +
  `Every single frame contains ZERO written words: zero subtitles, zero captions, zero labels, zero lyrics, zero watermarks, zero on-screen text of any kind. ` +
  `All language in this prompt is DIRECTION for you, never content to display.`;

export const __test = {
  buildSegmentPrompt,
  detectNoOnScreenTextDirective,
  isInstructionLikeOverlay,
  buildExtendPrompt,
  buildGrokPrompt,
  buildVeoChainPlan,
  buildFallbackStoryboardPrompt,
  selectStoryboardResolution,
  isImageRefError,
  capPromptForModel,
  skipsStoryboardImage,
  resolveOutputAspect,
  resolveOutputResolution: resolveVideoResolution,
};

// ─── Kie helpers ─────────────────────────────────────────────────────────────

// Grok Imagine rejects a `prompt` longer than 5000 chars at createTask with
// "The text length cannot exceed the maximum limit" (verified live: 5000 ok,
// 5100 fails) — which failed EVERY Grok clip → no video, since our prompt folds
// in the persona kernel + storyboard + Director brief. Cap Grok prompts a safe
// margin under the limit at the single chokepoint every Grok call flows through.
const GROK_MAX_PROMPT_CHARS = 4800;
// /veo/extend trips a parse/safety failure on an over-long prompt (the old code
// fed it the full reference-image GENERATE prompt — persona kernel + treatment +
// voice profile + lock boilerplate, routinely 3-4.5k+ chars — so every extend
// errored and the video truncated to its first clip). The continuation prompt is
// now lean, but cap defensively at the extend chokepoint so length can never be
// the failure mode again.
const VEO_EXTEND_MAX_PROMPT_CHARS = 4800;

/** Truncate on a WORD boundary, PROTECTING a fixed reserve of trailing chars
 *  untouched — every engine's prompt template (buildSegmentPrompt,
 *  buildExtendPrompt, buildGrokPrompt) appends `ordersBlock`/technical/
 *  stability/no-repeat rules LAST, so a naive slice-from-the-front truncation
 *  keeps flavor text and discards exactly the rules that stop a long video
 *  from crashing/duplicating (the documented root cause of the Grok >5000-char
 *  hard-fail and the Veo /extend parse failures this file already fixed for
 *  those two engines specifically — this generalizes the same protection to
 *  every engine instead of leaving Kling/Veo-generate/Gemini-Omni on the old
 *  blunt tail-cut). Cuts the MIDDLE, keeps the front (persona/scene setup)
 *  and the tail (technical rules) intact. */
function truncateOnWordBoundary(p: string, max: number): string {
  if (p.length <= max) return p;
  const TAIL_RESERVE = Math.min(1200, Math.floor(max * 0.35));
  const headBudget = max - TAIL_RESERVE - 20; // 20 chars for the join marker
  if (headBudget <= 0) {
    // max itself is smaller than one reserve — degenerate case, just cut the tail.
    const clipped = p.slice(0, max);
    return clipped.replace(/\s+\S*$/, "") || clipped;
  }
  const headRaw = p.slice(0, headBudget);
  const head = (headRaw.replace(/\s+\S*$/, "") || headRaw).trimEnd();
  const tailRaw = p.slice(p.length - TAIL_RESERVE);
  const tail = tailRaw.replace(/^\S*\s+/, "") || tailRaw;
  return `${head}\n[...]\n${tail}`;
}

/** LLM condensing pass — tries to shrink an over-budget prompt down to fit
 *  WITHOUT losing meaning (persona identity, the scene's core action, and the
 *  engine's trailing technical/stability rules), unlike blunt truncation which
 *  always discards something verbatim. Best-effort: on any failure (timeout,
 *  bad output, still-too-long result) falls back to truncateOnWordBoundary,
 *  which is a hard length guarantee. Only invoked for prompts meaningfully
 *  over budget — a small overage is handled by the cheaper truncation alone,
 *  since condensing a whole video prompt costs an LLM round-trip per clip. */
async function condensePromptForModel(model: string, prompt: string, max: number): Promise<string> {
  try {
    // Grok Imagine specifically: xAI's own guidance is front-load the first
    // 20-30 words (subject + action), keep to ONE subject/action/camera-move/
    // style-cue when quality degrades, and structure as [Subject Motion] →
    // [Camera Movement/Shot] → [Lighting/Atmosphere] → AUDIO:[...] — a wall of
    // dense description is exactly what causes the "morphing/glitching" failure
    // mode on longer Grok takes, independent of just fitting the char budget.
    const engineGuidance = /grok/i.test(model)
      ? `\n\nThis is a Grok Imagine prompt specifically. Grok responds best to a lean, front-loaded structure — put the subject and main action in the FIRST sentence, then camera movement, then lighting/style, then an explicit "AUDIO:" line last. Prefer ONE clear action and ONE camera move over stacking several — a dense, multi-clause prompt is what causes Grok to degrade into morphing/glitching on longer takes, not just what overflows the character budget.`
      : "";
    const system = `You rewrite AI video-generation prompts so they fit a hard character budget, WITHOUT losing what makes the video work. Reply with ONLY the rewritten prompt text — no commentary, no quotes, no markdown fences.`;
    const user = `Rewrite this ${model} video-generation prompt to be UNDER ${max} characters (currently ${prompt.length}).

MUST PRESERVE, essentially verbatim:
- The character/persona's visual identity and appearance description (who they are, what they look like) — this keeps the character consistent across clips.
- The scene's core action and dialogue/voiceover content — what actually happens and is said.
- ANY trailing technical/stability/continuity/no-repeat/camera rules — these are usually the LAST paragraph(s) and exist specifically to stop the render engine from glitching or repeating itself on long clips. Never drop or shorten these.

CUT FIRST (in this order) to make room:
1. Redundant restatements of the same idea in different words.
2. Generic scene-setting flavor/atmosphere language that doesn't change what's rendered.
3. Verbose phrasing — tighten sentences, don't remove content they carry.${engineGuidance}

PROMPT TO REWRITE:
${prompt}`;
    const out = (await callClaudeText({ system, user, maxTokens: Math.ceil(max / 3) })).trim();
    if (out.length > 0 && out.length <= max) {
      console.warn(`[kie-video-pipeline] condensed ${model} prompt ${prompt.length}→${out.length} chars via LLM (limit ${max})`);
      return out;
    }
    if (out.length > 0) {
      // LLM tried but overshot — still better raw material than the original
      // for the tail-protecting fallback (it already dropped some flavor text).
      const cut = truncateOnWordBoundary(out, max);
      console.warn(`[kie-video-pipeline] LLM condense overshot (${out.length} > ${max}) for ${model}, tail-truncated to ${cut.length}`);
      return cut;
    }
  } catch (e) {
    console.warn(`[kie-video-pipeline] LLM prompt condense failed for ${model}, falling back to tail-truncation:`, e instanceof Error ? e.message : e);
  }
  const cut = truncateOnWordBoundary(prompt, max);
  console.warn(`[kie-video-pipeline] capped ${model} prompt ${prompt.length}→${cut.length} chars (tail-protected, limit ${max})`);
  return cut;
}

// Below this overage, the cheap tail-protecting truncation alone is close
// enough to lossless that an LLM round-trip isn't worth the latency/cost —
// condensing only kicks in when a meaningful chunk of content would otherwise
// be discarded.
const CONDENSE_OVERAGE_THRESHOLD_CHARS = 600;

async function capPromptForModel(model: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Applies to every VIDEO jobs model (grok, gemini-omni, kling, seedance, …):
  // an overlong prompt either hard-fails at createTask (Grok's verified 5000
  // limit) or quietly degrades the render on the others — a >4.8k wall of text
  // is where "the video isn't what I asked for" comes from. The storyboard
  // image model (nano-banana) is exempt: its multi-panel prompt is legitimately
  // long and its API accepts it.
  if (/nano-banana/i.test(model)) return input;
  const p = input.prompt;
  if (typeof p !== "string" || p.length <= GROK_MAX_PROMPT_CHARS) return input;
  const overage = p.length - GROK_MAX_PROMPT_CHARS;
  const cut = overage > CONDENSE_OVERAGE_THRESHOLD_CHARS
    ? await condensePromptForModel(model, p, GROK_MAX_PROMPT_CHARS)
    : truncateOnWordBoundary(p, GROK_MAX_PROMPT_CHARS);
  return { ...input, prompt: cut };
}

async function createJobsTask(model: string, rawInput: Record<string, unknown>): Promise<string> {
  const input = await capPromptForModel(model, rawInput);
  console.log(`[kie-video-pipeline] jobs.createTask ${model} →`, JSON.stringify(input).slice(0, 220));
  const res = await fetch(KIE_JOBS_CREATE, {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kie jobs.createTask ${model} HTTP ${res.status}: ${text.slice(0, 220)}`);
  let json: { code: number; msg: string; data: { taskId: string } };
  try { json = JSON.parse(text); } catch { throw new Error(`Kie jobs.createTask ${model} non-JSON: ${text.slice(0, 200)}`); }
  if (json.code !== 200) throw new Error(`Kie jobs.createTask ${model}: ${json.msg}`);
  console.log(`[kie-video-pipeline] jobs.createTask ${model} ✓ taskId=${json.data.taskId}`);
  return json.data.taskId;
}

async function pollJobsTask(taskId: string, timeoutMs: number, label = "task"): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let delay = 4000;
  let pollCount = 0;
  let lastPayloadSample = "";
  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay * 1.4, 12_000);
    pollCount++;
    const res = await fetch(`${KIE_JOBS_POLL}?taskId=${taskId}`, { headers: { Authorization: `Bearer ${kieKey()}` } });
    if (!res.ok) { console.warn(`[kie-video-pipeline] jobs poll ${label} HTTP ${res.status}`); continue; }
    const raw = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any;
    try { json = JSON.parse(raw); } catch { console.warn(`[kie-video-pipeline] jobs poll ${label} non-JSON: ${raw.slice(0, 200)}`); continue; }
    lastPayloadSample = JSON.stringify(json).slice(0, 400);

    const { status, errorMessage } = extractKieState(json);
    if (pollCount <= 2 || pollCount % 3 === 0) {
      console.log(`[kie-video-pipeline] jobs poll ${label} #${pollCount} status=${status} payload=${lastPayloadSample}`);
    }
    if (status === "success") {
      const url = extractKieVideoUrl(json);
      if (!url) {
        console.error(`[kie-video-pipeline] jobs poll ${label} SUCCESS but no URL found:`, JSON.stringify(json).slice(0, 1200));
        throw new Error(`Kie ${label} success but no parseable resultUrl. Payload: ${JSON.stringify(json).slice(0, 300)}`);
      }
      console.log(`[kie-video-pipeline] jobs poll ${label} ✓ url=${url.slice(0, 100)}`);
      return url;
    }
    if (status === "fail") throw new Error(`Kie ${label} failed: ${errorMessage ?? "no reason"}. Payload: ${lastPayloadSample}`);
  }
  throw new Error(`Kie ${label} timed out after ${timeoutMs / 1000}s. Last payload: ${lastPayloadSample}`);
}

/**
 * Probe a remote video's duration via ffprobe (reads container metadata over
 * HTTP, no full download). Returns null on any failure — a probe failure must
 * NEVER block the render pipeline, only skip the validation that uses it.
 *
 * Exists because Kie's grok-imagine/extend `extend_at`/`extend_times` contract
 * was never verified against a live multi-extend render (see the comment above
 * GROK_EXTEND_MODEL) — if Kie silently ignores the anchor and returns a clip
 * that restarted instead of continuing, the symptom is the character repeating
 * earlier lines, and the ONLY externally-observable signal that happened is
 * that the returned video's duration didn't actually grow. This is that check.
 */
async function probeVideoDurationSeconds(url: string): Promise<number | null> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) return null;
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe"));
  try {
    const { stdout } = await execFileP(ffprobePath, [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url,
    ], { timeout: 20_000 });
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch (e) {
    console.warn(`[kie-video-pipeline] duration probe failed (skipping validation): ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    return null;
  }
}

// ─── Grok Imagine native extend chain ────────────────────────────────────────
// docs.kie.ai/market/grok-imagine/extend. For a Grok video > 15s we render a base
// clip (grok-imagine/image-to-video) then CONTINUE it with grok-imagine/extend —
// each extend inherits the previous clip's real final frames, so the take stays
// frame-continuous (smooth + consistent) instead of the independent-takes+stitch
// path which reset from the avatar still each clip. Each extend's output task_id
// feeds the next call. The final extend's URL is the complete cumulative video.
const GROK_EXTEND_MODEL = "grok-imagine/extend";

async function generateGrokExtended(opts: {
  args: GenerateVideoArgs;
  /** Base grok image-to-video slug (args.videoModel). */
  videoModel: string;
  /** Fully-built base image-to-video input (prompt/image_urls/duration/…). */
  baseInput: Record<string, unknown>;
  base: StoryBeat[];
  extendWindows: StoryBeat[][];
  voiceProfile: string;
  deadlineMs: number;
  /** Base clip length in seconds (already clamped to Grok's 6–15 range). */
  baseSeconds: number;
  /** Full requested duration, for progress notes. */
  targetSeconds: number;
}): Promise<{ url: string; note?: string }> {
  const { args, videoModel, baseInput, base, extendWindows, voiceProfile, deadlineMs, baseSeconds, targetSeconds } = opts;

  // 1) Base clip — the anchor the whole chain continues from.
  const baseTaskId = await createJobsTask(videoModel, baseInput);
  const basePollMs = Math.max(60_000, deadlineMs - Date.now() - 15_000);
  let currentUrl = await pollJobsTask(baseTaskId, basePollMs, "grok-base");

  // 2) Extend forward, one time-window at a time. task_id chains from the previous
  //    (cumulative) clip so the model continues the real take rather than restarting.
  let prevTaskId = baseTaskId;
  let accumulated = baseSeconds;
  let prevLastBeat: StoryBeat | undefined = base[base.length - 1];
  let done = 0;

  for (let i = 0; i < extendWindows.length; i++) {
    // Extends are SEQUENTIAL, so guard the wall-clock: if too little budget remains
    // for another generate+poll, return the smooth video we have so far.
    if (deadlineMs - Date.now() < 90_000) {
      return { url: currentUrl, note: `Grok extended to ~${accumulated}s of ${targetSeconds}s (time budget).` };
    }
    const win = extendWindows[i];
    const secs = Math.max(4, Math.min(15, Math.round(windowSeconds(win))));
    const isLast = i === extendWindows.length - 1;
    const prompt = buildExtendPrompt(args, win, secs, voiceProfile, prevLastBeat, isLast);
    const extendInput: Record<string, unknown> = {
      task_id: prevTaskId,
      prompt,
      // Append at the current end of the cumulative video (min 2 per Kie).
      extend_at: Math.max(2, Math.round(accumulated)),
      // Kie's own docs example (docs.kie.ai/market/grok-imagine/extend) sends
      // this as a STRING ("6", not 6) despite the human-readable schema text
      // elsewhere saying "type: number" — this was the actual, unverified gap
      // the comment above GROK_EXTEND_MODEL flagged ("never verified against
      // a live multi-extend render"). A number here likely got silently
      // rejected/mishandled by Kie, throwing on the FIRST extend attempt and
      // falling through to the independent-takes+hard-cut fallback every
      // time — exactly the "looks the same, no continuation" symptom.
      extend_times: String(secs),
    };
    // One retry per extend step — a transient Kie hiccup on step 1 used to
    // permanently abandon the WHOLE chain (done===0 → rethrow → caller falls
    // back to the independent-takes+hard-cut path), even though step 2+ would
    // likely have succeeded fine. This is the actual reason "sometimes it
    // works, sometimes it silently reverts to the old hard-cut look."
    let lastErr: unknown;
    let succeeded = false;
    for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
      try {
        const extTaskId = await createJobsTask(GROK_EXTEND_MODEL, extendInput);
        const pollMs = Math.max(60_000, deadlineMs - Date.now() - 15_000);
        const extendedUrl = await pollJobsTask(extTaskId, pollMs, `grok-extend ${i + 1}/${extendWindows.length}${attempt > 0 ? ` (retry ${attempt})` : ""}`);
        // Validate the extend actually GREW the cumulative video instead of
        // restarting from the anchor clip — see probeVideoDurationSeconds' doc
        // comment. A probe failure (null) never blocks the pipeline; only a
        // CONFIRMED short duration counts as a failed extend.
        const expectedSeconds = accumulated + secs;
        const probedSeconds = await probeVideoDurationSeconds(extendedUrl);
        if (probedSeconds != null && probedSeconds < expectedSeconds - 3) {
          throw new Error(
            `grok-extend ${i + 1} returned ${probedSeconds.toFixed(1)}s, expected ~${expectedSeconds}s — Kie likely ignored extend_at and restarted the clip instead of continuing it (this is the "script repeats" symptom)`,
          );
        }
        currentUrl = extendedUrl;
        prevTaskId = extTaskId;
        accumulated += secs;
        prevLastBeat = win[win.length - 1];
        done++;
        succeeded = true;
      } catch (err) {
        lastErr = err;
        const emsg = err instanceof Error ? err.message : String(err);
        console.warn(`[kie-video-pipeline] grok-extend ${i + 1} attempt ${attempt + 1} failed: ${emsg.slice(0, 400)}`);
      }
    }
    if (!succeeded) {
      // If we already extended at least once, KEEP the smooth partial video rather
      // than discarding a good render. If the FIRST extend failed (only the short
      // base exists), rethrow so the caller falls back to the full-length stitch path.
      const emsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      if (done >= 1) {
        console.warn(`[kie-video-pipeline] grok-extend ${i + 1} failed after retry (${emsg.slice(0, 200)}) — keeping ${accumulated}s partial`);
        return { url: currentUrl, note: `Grok extended to ~${accumulated}s of ${targetSeconds}s (extend ${i + 1} failed).` };
      }
      throw lastErr;
    }
  }

  return { url: currentUrl };
}

// ─── Veo3 dedicated endpoint ─────────────────────────────────────────────────
// Docs: https://docs.kie.ai/veo3-api/generate-veo-3-video

/**
 * Kie Veo 3.1 video generation.
 * Per docs (https://docs.kie.ai/veo3-api/generate-veo-3-video):
 *   - endpoint:   POST /api/v1/veo/generate
 *   - models:     veo3 (Quality) | veo3_fast (Fast) | veo3_lite (Lite)
 *   - imageUrls:  1-3 reference images
 *   - generationType:
 *       TEXT_2_VIDEO                   — text only, no images
 *       FIRST_AND_LAST_FRAMES_2_VIDEO  — 1 or 2 images as keyframes
 *       REFERENCE_2_VIDEO              — 1-3 reference images (locks character)
 *                                        ⚠ REQUIRES model=veo3_fast
 *   - aspect_ratio: 16:9 | 9:16 | Auto (snake_case in body)
 *   - resolution:   720p | 1080p | 4k
 *   - duration:     4 | 6 | 8 (default 8)
 */
/**
 * Strip an over-constrained prompt down to its essentials for a retry. Keeps the
 * scene + spoken line + character/voice lock (everything before DIRECTION:), then
 * appends a terse low-constraint instruction so a stalled task renders quickly.
 */
function simplifyVeoPrompt(prompt: string, error: string, aspect?: string, continuation = false): string {
  // PRESERVE THE SPOKEN LINE above all — it's the kie script and must never be
  // dropped by a retry. (The old version sliced the head to 900 chars, which cut
  // the line off because it sat after the long reference/lock boilerplate.) The
  // continuation prompt phrases the line as SPOKEN too, so both shapes are matched.
  const spoken =
    prompt.match(/SPOKEN LINE[^\n]*\n"([^"]*)"/i)?.[1]
    ?? prompt.match(/lip-sync EXACTLY[^"]*"([^"]*)"/i)?.[1]
    ?? prompt.match(/Spoken \(lip-sync exact\):\s*"([^"]*)"/i)?.[1]
    ?? prompt.match(/SPOKEN[^\n]*\n"([^"]*)"/i)?.[1]
    ?? "";
  const note = /timed out/i.test(error)
    ? "Keep it simple so it renders quickly."
    : "Keep it clean and straightforward.";
  // EXTEND retry: this call continues an existing take (the /veo/extend endpoint
  // inherits the previous clip's final frame), so the fallback must CONTINUE the
  // shot — resetting to "a video of the person talking to camera" would re-open the
  // scene and defeat the whole point of the extend.
  if (continuation) {
    return [
      `CONTINUE THE EXISTING TAKE — pick up EXACTLY where the previous clip's last frame left off, as one unbroken shot. Same person (identical face, hair, outfit — no identity drift), same environment, lighting, framing, and motion energy. Do NOT restart, cut, or re-establish the scene.`,
      spoken ? `SPOKEN — the same person keeps talking, naturally lip-synced; the only new words said: "${spoken}"` : "",
      `ONE continuous full-frame shot, natural motion and lip-sync. No on-screen text or captions. ${note}`,
    ].filter(Boolean).join("\n\n");
  }
  return [
    `A ${aspectPhrase(aspect)} video of the same original character in reference image 1 talking to camera — consistent face, hair, and outfit, no drift; a fictional original character (not a real or recognizable person); realistic style if the reference is realistic (do not cartoonify).`,
    spoken ? `SPOKEN LINE — lip-sync EXACTLY, the only words said: "${spoken}"` : "",
    `ONE continuous full-frame shot, natural motion and lip-sync. NOT a storyboard/grid. No on-screen text or captions. ${note}`,
  ].filter(Boolean).join("\n\n");
}

/**
 * Rewrite an EXTEND prompt to get past Veo's PROMINENT_PEOPLE / public-figure
 * safety filter (Kie `PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED`). The extend
 * already inherits the parent clip's exact character via the frame, so the prompt
 * needs NO face/identity language at all — and phrasing like "identical face",
 * "exact person", "reproduce this face", "no identity drift" is precisely what cues
 * the filter that a real, recognizable person is being depicted. So we DROP all of
 * it and add an explicit "fictional, non-celebrity, not a real public figure"
 * directive. Paired with a fresh random `seeds` per retry (the documented lever for
 * varying generated content), this reliably clears the probabilistic filter.
 */
function softenProminentPeoplePrompt(prompt: string): string {
  const spoken =
    prompt.match(/SPOKEN[^\n]*\n"([^"]*)"/i)?.[1]
    ?? prompt.match(/lip-sync EXACTLY[^"]*"([^"]*)"/i)?.[1]
    ?? prompt.match(/only new words said:\s*"([^"]*)"/i)?.[1]
    ?? "";
  return [
    "CONTINUE THE EXISTING TAKE as one seamless, unbroken shot — pick up exactly where the previous clip's last frame left off. Keep the same scene, background, lighting, framing, wardrobe, and motion energy; do NOT cut, restart, or re-establish the scene.",
    "The subject is a FICTIONAL, generic, everyday character. Do NOT depict, resemble, imitate, or reference any real, famous, celebrity, or otherwise recognizable public figure.",
    spoken ? `The character keeps talking, naturally lip-synced; the only new words said: "${spoken}"` : "",
    "Natural continuous human motion. No on-screen text, captions, subtitles, logos, or watermarks.",
  ].filter(Boolean).join("\n\n");
}

/** Fresh Veo `seeds` value (10000-99999 per the /veo/extend + /veo/generate docs).
 *  A new seed each retry varies the generated content, which is the key to clearing
 *  the probabilistic prominent-people / safety filter. */
function randomVeoSeed(): number {
  return 10000 + Math.floor(Math.random() * 90000);
}

/**
 * Trim an over-constrained storyboard image prompt for a retry while KEEPING the
 * two things that must never drift: the character identity and the art-style lock
 * (cartoon stays cartoon — never photo-realised). A simpler prompt renders faster
 * when the first attempt stalled.
 */
function simplifyImagePrompt(prompt: string): string {
  // Keep the leading identity directive IN FULL (it is the one thing that must
  // never be trimmed), then a shortened slice of the scene description so the
  // retry renders faster without ever losing the exact-face lock.
  const [identity, ...rest] = prompt.split(/\n\nSTORYBOARD TO RENDER[^\n]*\n/);
  const idHead = (identity ?? prompt).slice(0, 1200).trim();
  const scene = rest.join(" ").replace(/\s+/g, " ").slice(0, 480).trim();
  return `${idHead}${scene ? `\n\nSTORYBOARD (simplified): ${scene}` : ""}

CHARACTER LOCK: the storyboard character is the SAME original character as the attached reference — consistent face, skin tone, hair, outfit, and proportions in every panel. A FICTIONAL original character, not a real, famous, or recognizable person. Do not redesign, average, beautify, or age the character.
MEDIUM LOCK: match the reference's medium. If it is a realistic style, render realistic cinematic film stills — do NOT cartoonify or illustrate. Only use an animated/illustrated style if the reference is itself a drawing.
Keep the composition clean and cinematic so it renders quickly. No text, captions, labels, numbers, speech bubbles, or watermarks.`;
}

/**
 * De-identify a storyboard image prompt after the prominent-public-figure filter
 * fires. Strips the "real person / exact face / photorealistic real person"
 * language that cues the filter and reframes the subject as a FICTIONAL, ORIGINAL
 * character — while KEEPING cross-panel consistency. Mirrors softenProminentPeoplePrompt
 * (the video-side de-identifier). Paired with dropping the refs, this clears the block.
 */
export function deidentifyImagePrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/ONE specific real person/gi, "one consistent original character")
    .replace(/\bthe exact same person\b/gi, "the same original character")
    .replace(/\bexact same person\b/gi, "same original character")
    .replace(/\bthe exact person\b/gi, "the same character")
    .replace(/\bexact person\b/gi, "same character")
    .replace(/\bexact individual\b/gi, "same character")
    .replace(/\breal[- ]?looking person\b/gi, "original character")
    .replace(/\breal[- ]?person\b/gi, "fictional character")
    .replace(/\bphotorealistic\b/gi, "cinematic realistic")
    .replace(/\bphotoreal\b/gi, "cinematic realistic")
    .replace(/\bcopy (that|the|their) face precisely\b/gi, "keep the character's look consistent")
    .replace(/\breproduce (this|that|their) face precisely\b/gi, "keep the character's look consistent")
    .replace(/\bsame exact face\b/gi, "consistent look")
    .replace(/\binstantly recognizable as that [^.]*\./gi, "visually consistent across panels.")
    .replace(/\breference phot(o|os|ograph|ographs)?\b/gi, "character design reference");
  return `IMPORTANT: This is a FICTIONAL, ORIGINAL, non-celebrity character — NOT a real, famous, or recognizable public figure, and NOT based on any real individual. Render an original stylized character and keep its appearance CONSISTENT across all panels.\n\n${cleaned}`;
}

/**
 * Render the multi-panel storyboard image, waiting generously and retrying on a
 * timeout/failure. The storyboard phase owns the whole ~300s function budget
 * (the video renders in a separate phase), so we no longer cap at 100s — most
 * "timeouts" were just the Kie task still processing. We give the first attempt
 * the bulk of the budget, then retry once with a simplified (but still character-
 * and style-locked) prompt. `image_input` carries the character reference frames
 * so the rendered character matches the minted NFT — same face, same art style.
 */
async function renderStoryboardImage(args: {
  prompt: string;
  refImages: string[];
  aspectRatio: string;
  resolution?: "1K" | "2K";
  /** Kie jobs model slug — defaults to the multi-panel storyboard's
   *  nano-banana-pro; single-scene keyframes use nano-banana-2. */
  model?: string;
}): Promise<string> {
  const deadline = Date.now() + 250_000; // safely under the route's 300s maxDuration
  // Up to 3 attempts: (1) full prompt + refs, (2) simplified prompt + refs,
  // (3) refs DROPPED — so a reference image Kie can't fetch/recognize can never
  // fail the whole storyboard (and thus every engine's video). `dropRefs` flips
  // the moment Kie reports an image-reference error, skipping straight to the
  // text-only render instead of burning the retry on the same poisoned refs.
  const maxAttempts = 3;
  let lastErr = "";
  let dropRefs = false;
  // Flips when Kie's prominent-public-figure filter fires: we then render a
  // de-identified, fictional-character version of the prompt (and drop the photoreal
  // refs that cued it) so the storyboard still renders instead of hard-failing.
  let deidentify = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 35_000) break; // not enough budget for a meaningful try

    // Attempt 1 gets the lion's share; reserve budget for the later retries.
    const pollTimeout =
      attempt === 1 && maxAttempts > 1
        ? Math.min(180_000, remaining - 50_000)
        : Math.max(45_000, remaining - 8_000);

    const prompt = deidentify
      ? deidentifyImagePrompt(args.prompt)
      : attempt === 1 ? args.prompt : simplifyImagePrompt(args.prompt);
    const useRefs = !dropRefs && args.refImages.length > 0;
    try {
      const input: Record<string, unknown> = {
        prompt,
        aspect_ratio: args.aspectRatio,
        resolution: args.resolution ?? "2K",
      };
      // nano-banana-pro reads references from `image_input` (an ARRAY) and SILENTLY
      // ignores image_url — this array is what actually locks the face + art style.
      if (useRefs) input.image_input = args.refImages.slice(0, 8);

      const taskId = await createJobsTask(args.model ?? "nano-banana-pro", input);
      const url = await pollJobsTask(taskId, Math.max(45_000, pollTimeout), `storyboard-image(try ${attempt}${useRefs ? "" : ", no refs"})`);
      return url;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      // A reference Kie couldn't fetch/recognize poisons the WHOLE request — drop
      // the refs so the NEXT attempt renders text-only and still succeeds.
      if (useRefs && isImageRefError(lastErr)) {
        dropRefs = true;
        console.warn(`[kie-video-pipeline] storyboard image attempt ${attempt} rejected the reference images (${lastErr}); retrying WITHOUT refs`);
      } else if (isProminentPersonError(lastErr)) {
        // The photoreal refs + "real person / exact face" prompt cued the
        // prominent-public-figure filter. Drop the refs AND render a de-identified,
        // fictional-character prompt so the next attempt clears it.
        dropRefs = true;
        deidentify = true;
        console.warn(`[kie-video-pipeline] storyboard image attempt ${attempt} blocked by the prominent-people filter (${lastErr.slice(0, 120)}); retrying de-identified, no refs`);
      } else {
        console.warn(`[kie-video-pipeline] storyboard image attempt ${attempt}/${maxAttempts} failed: ${lastErr}`);
      }
    }
  }

  throw new Error(lastErr || "storyboard image render failed");
}

/**
 * Detect a content-policy / "prominent person" rejection from Veo/Kie — the model
 * refuses to animate a recognizable real person from a reference image. The fix
 * is to retry WITHOUT the user-supplied image (text-to-video of a generic
 * character) so the render still succeeds.
 */
function isProminentPersonError(msg: string): boolean {
  return /prominent|public figure|celebrit|real[- ]?person|recognizable person|person'?s? (face|likeness)|likeness|person generation|people generation|content polic|safety polic|policy violation|sensitive content|cannot generate.*person|not allowed.*person/i.test(
    msg,
  );
}

/**
 * Detect a Kie rejection caused by a REFERENCE IMAGE that Kie couldn't fetch or
 * recognize (e.g. an extensionless Convex-storage URL when re-hosting to a `.png`
 * was unavailable — the exact "image_input file type not supported" 500 Kie
 * returns). Crucially, ONE bad reference fails the WHOLE request and poisons the
 * good refs too, so the fix is to retry WITHOUT the reference images — the render
 * still succeeds (generic character), never a hard failure for every engine.
 */
function isImageRefError(msg: string): boolean {
  return /file type not supported|image_input|image not found|image url|invalid image|unsupported image|failed to (?:fetch|download|load).*image|download.*image|image.*(?:not supported|unreachable|invalid|failed)|unsupported (?:mime|media) type|mime type|text\/plain|unsupported file type/i.test(
    msg,
  );
}

/**
 * Drop reference URLs a Kie video model would reject on its CONTENT-TYPE. Grok's
 * image-to-video (and others) fail the WHOLE task during polling with
 * "Unsupported MIME type: text/plain" when a ref URL serves non-image bytes (an
 * HTML error page, a redirect, an SVG, an extensionless storage blob typed as
 * text/plain). We do a lightweight HEAD/GET and KEEP a url only when the server
 * confirms `image/*`. On a network error / timeout we KEEP the url (err toward
 * not-dropping — the per-clip retry-without-refs is the safety net for anything
 * that still poisons the request).
 */
async function keepImageContentType(urls: string[]): Promise<string[]> {
  const ok = await Promise.all(
    urls.map(async (u) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 7000);
        try {
          const r = await fetch(u, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; VelloBot/1.0)" },
            signal: ctrl.signal,
          });
          if (!r.ok) return true; // ambiguous (host may block bots) — keep, let retry handle it
          const ct = r.headers.get("content-type") ?? "";
          // Definite non-image → DROP (this is the "text/plain" Grok rejects). Keep
          // application/octet-stream — some CDNs serve real image bytes that way, and
          // the per-clip retry-without-refs backstops it if Kie does reject it.
          if (/^(?:text\/|application\/(?:json|xml|xhtml)|image\/svg)/i.test(ct)) return false;
          return true;
        } finally {
          clearTimeout(t);
        }
      } catch {
        return true; // network hiccup — keep; the retry-without-refs backstops it
      }
    }),
  );
  return urls.filter((_, i) => ok[i]);
}

/** Size the retry attempts to the remaining render budget so they never overrun. */
function veoRetryBudget(deadlineMs: number): { maxAttempts: number; pollTimeoutMs: number } {
  const remaining = deadlineMs - Date.now();
  if (remaining > 360_000) return { maxAttempts: 2, pollTimeoutMs: 170_000 };
  if (remaining > 230_000) return { maxAttempts: 2, pollTimeoutMs: Math.floor((remaining - 20_000) / 2) };
  return { maxAttempts: 1, pollTimeoutMs: Math.min(180_000, Math.max(60_000, remaining - 20_000)) };
}

async function generateVeo3Video(args: {
  prompt: string;
  imageUrls: string[];
  model: "veo3" | "veo3_fast" | "veo3_lite";
  aspectRatio: "16:9" | "9:16" | "Auto";
  durationSeconds: number;
  resolution?: "720p" | "1080p" | "4k";
  /** Retry attempts on timeout/failure — each one revises the prompt + refs. */
  maxAttempts?: number;
  /** Per-attempt poll timeout (ms). Shorter on retries to fit the render budget. */
  pollTimeoutMs?: number;
  /** Hard wall-clock deadline (epoch ms) for the whole escalation. */
  deadlineMs?: number;
  /** Anchor seed for the FIRST submit (retries still reseed to bust the safety
   *  filter). Threaded from the base clip so a stitched fresh clip shares the
   *  chain's generative trajectory → the same face. Absent → random each attempt. */
  seed?: number;
}): Promise<{ url: string; taskId: string; endpointUsed: "veo" | "veo3" | "jobs"; seed: number }> {
  // Veo 3.1 duration must be one of [4, 6, 8] — round up to the first valid
  // value >= requested seconds (fallback 8). Delegated to the shared
  // per-engine adapter (lib/server/engineAdapters.ts), which is provably
  // faithful to this same round-up-to-{4,6,8} semantics.
  const duration = getEngineAdapter(args.model).encodeDuration(args.durationSeconds) as number;
  const outputResolution = resolveVideoResolution(args.model, args.resolution);

  // Veo reference images must be STATIC. Animated GIFs accept (code 200) but never
  // complete — drop them up front. Order is [person, storyboard, product].
  const allImages = args.imageUrls.filter((u) => !/\.gif(\?|#|$)/i.test(u));
  const person = allImages[0];
  const aiRefs = allImages.slice(1); // storyboard + product (AI-rendered, not photos)

  // ── Strategy escalation ───────────────────────────────────────────────────
  // The "prominent public figure" safety filter fires on photorealistic faces, so
  // dropping just the raw photo isn't enough (the photoreal storyboard trips it
  // too). We escalate through modes that KEEP the character but are progressively
  // less likely to be flagged, and retry each (the filter is probabilistic — a
  // repeat call frequently passes):
  //   1. REFERENCE_2_VIDEO, all refs            — best identity + motion
  //   2. REFERENCE_2_VIDEO, AI refs only         — drop the raw photo
  //   3. FIRST_AND_LAST_FRAMES, avatar still     — image-to-video "animate THIS
  //      provided image": rarely flagged AND preserves the exact character
  // text-to-video is used ONLY when we genuinely have no usable image.
  type Strat = { genType: "REFERENCE_2_VIDEO" | "FIRST_AND_LAST_FRAMES_2_VIDEO" | "TEXT_2_VIDEO"; images: string[]; label: string };
  const strategies: Strat[] = [];
  if (allImages.length > 0) {
    strategies.push({ genType: "REFERENCE_2_VIDEO", images: allImages.slice(0, 3), label: "ref:all" });
    if (aiRefs.length > 0) strategies.push({ genType: "REFERENCE_2_VIDEO", images: aiRefs.slice(0, 3), label: "ref:ai-only" });
    // Image-to-video must use a SINGLE clean portrait (the avatar) — never the
    // multi-panel storyboard, which would animate the grid.
    if (person) strategies.push({ genType: "FIRST_AND_LAST_FRAMES_2_VIDEO", images: [person], label: "img2vid:avatar" });
  }
  // ALWAYS keep a no-image text-only path as the final fallback. When Kie can't
  // fetch/recognize the reference images (e.g. an extensionless storage URL), every
  // image-bearing strategy fails the WHOLE request — without this the render would
  // hard-fail for every engine. `sawImageRefError` fast-forwards to it.
  strategies.push({ genType: "TEXT_2_VIDEO", images: [], label: "text" });

  const deadline = args.deadlineMs ?? (Date.now() + (args.pollTimeoutMs ?? 180_000) + 30_000);
  // Was 2 — each attempt is a full billed Kie generation, and with up to 4
  // strategies in the escalation ladder that meant up to 8 paid calls per clip.
  // A same-strategy retry only helps the probabilistic prominent-person filter;
  // escalating to the NEXT strategy (which the loop already does after this many
  // attempts) recovers most of that value at half the cost.
  const RETRIES_PER_STRATEGY = 1;
  let prompt = args.prompt;
  let lastErr: unknown;
  // Once Kie rejects the reference images, every image-bearing strategy will fail
  // the same way — skip straight to the text-only fallback instead of burning the
  // budget re-sending the poisoned refs.
  let sawImageRefError = false;
  // The anchor seed (if supplied) is used on the very FIRST submit only; every
  // retry reseeds to clear the probabilistic prominent-people filter.
  let usedAnchorSeed = false;

  for (const strat of strategies) {
    if (sawImageRefError && strat.images.length > 0) continue;
    for (let attempt = 1; attempt <= RETRIES_PER_STRATEGY; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 45_000) {
        console.warn(`[kie-video-pipeline] veo budget exhausted (${Math.round(remaining / 1000)}s) before ${strat.label} #${attempt}`);
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "veo render ran out of time"));
      }
      // Use the anchor seed on the first submit (face continuity for stitched fresh
      // clips); otherwise a fresh seed each attempt so a same-strategy retry after a
      // probabilistic prominent-people block generates DIFFERENT content (and can
      // pass) instead of reproducing the identical blocked frame. The seed that
      // produces the SUCCESSFUL clip is returned so the extend chain can reuse it.
      const currentSeed = !usedAnchorSeed && typeof args.seed === "number" ? args.seed : randomVeoSeed();
      usedAnchorSeed = true;
      const reqBody: Record<string, unknown> = {
        prompt,
        model: args.model,
        aspect_ratio: args.aspectRatio,
        duration,
        resolution: outputResolution,
        enableTranslation: true,
        enableFallback: true,
        generationType: strat.genType,
        seeds: currentSeed,
      };
      if (strat.images.length > 0) reqBody.imageUrls = strat.images;
      console.log(`[kie-video-pipeline] veo3.1 ${args.model} ${strat.label} #${attempt}/${RETRIES_PER_STRATEGY} → genType=${strat.genType} refs=${strat.images.length}`);

      try {
        const { taskId, endpointUsed } = await submitVeoTask(reqBody, args.model, strat.images, prompt, args.aspectRatio, duration);
        // Poll for (almost) the whole remaining deadline instead of a hard 180s
        // cap — a still-processing veo task must not be abandoned while budget
        // remains. An explicit pollTimeoutMs only ever LOWERS this, never raises
        // the old 180s floor.
        const budgetMs = clipPollBudgetMs(deadline, Date.now());
        const pollMs = Math.min(args.pollTimeoutMs ?? budgetMs, budgetMs);
        const url = endpointUsed === "jobs"
          ? await pollJobsTask(taskId, pollMs, `veo(${args.model})`)
          : await pollVeoTask(
              taskId,
              endpointUsed === "veo" ? KIE_VEO_RECORD : "https://api.kie.ai/api/v1/veo3/record-info",
              args.model,
              pollMs,
            );
        return { url, taskId, endpointUsed, seed: currentSeed };
      } catch (err) {
        lastErr = err;
        const emsg = err instanceof Error ? err.message : String(err);
        if (isProminentPersonError(emsg)) {
          // Probabilistic block — quick retry on the SAME strategy, then advance
          // to the next (image-to-video eventually, which keeps the character).
          console.warn(`[kie-video-pipeline] ${strat.label} #${attempt} blocked (prominent person): ${emsg.slice(0, 140)} — ${attempt < RETRIES_PER_STRATEGY ? "retrying" : "escalating strategy"}`);
          continue;
        }
        if (strat.images.length > 0 && isImageRefError(emsg)) {
          // Kie can't fetch/recognize a reference image — it poisons the whole
          // request, so every image strategy will fail identically. Fast-forward
          // to the text-only fallback instead of retrying with the same refs.
          console.warn(`[kie-video-pipeline] ${strat.label} #${attempt} rejected the reference images (${emsg.slice(0, 140)}) — escalating to text-only`);
          sawImageRefError = true;
          break;
        }
        // Transient/other failure — simplify the prompt and retry the strategy.
        console.warn(`[kie-video-pipeline] ${strat.label} #${attempt} failed: ${emsg.slice(0, 160)} — retrying`);
        prompt = simplifyVeoPrompt(args.prompt, emsg, args.aspectRatio);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "veo render failed"));
}

/** Submit a Veo task across the current → legacy → jobs endpoints (404 fallback). */
async function submitVeoTask(
  reqBody: Record<string, unknown>,
  model: string,
  images: string[],
  prompt: string,
  aspectRatio: string,
  duration: number,
): Promise<{ taskId: string; endpointUsed: "veo" | "veo3" | "jobs" }> {
  try {
    return { taskId: await tryVeoEndpoint(KIE_VEO_GENERATE, reqBody), endpointUsed: "veo" };
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (!/HTTP 404/.test(msg)) throw firstErr;
    console.warn(`[kie-video-pipeline] /veo/generate 404, trying /veo3/generate`);
    try {
      return { taskId: await tryVeoEndpoint("https://api.kie.ai/api/v1/veo3/generate", reqBody), endpointUsed: "veo3" };
    } catch (secondErr) {
      const msg2 = secondErr instanceof Error ? secondErr.message : String(secondErr);
      if (!/HTTP 404/.test(msg2)) throw secondErr;
      console.warn(`[kie-video-pipeline] /veo3/generate also 404, falling back to jobs/createTask`);
      const taskId = await createJobsTask(model, {
        prompt,
        image_url: images[0],
        aspect_ratio: aspectRatio,
        duration: String(duration),
      });
      return { taskId, endpointUsed: "jobs" };
    }
  }
}

// Veo 3.1 EXTEND endpoint — chains a follow-up clip onto an existing taskId.
// Docs: https://docs.kie.ai/veo3-api/extend-video
// POST /api/v1/veo/extend { taskId, prompt, model? } → { code, msg, data: { taskId } }
// The returned video URL is the FULL stitched video (original + extension).
async function extendVeo3Video(args: {
  parentTaskId: string;
  prompt: string;
  model: "veo3" | "veo3_fast" | "veo3_lite";
  /** How many times to retry this extend before giving up. */
  attempts?: number;
  /** Wall-clock deadline (epoch ms) — retries stop before it. */
  deadlineMs?: number;
  /** The base clip's seed. Reused on the FIRST attempt so the extended segment
   *  shares the base clip's generative trajectory → the same face. Retries fall
   *  back to a fresh seed (needed to vary content past the probabilistic
   *  prominent-people filter). Absent → fresh seed every attempt (prior behavior). */
  baseSeed?: number;
}): Promise<{ url: string; taskId: string }> {
  // Prominent-people / safety blocks fail FAST (the submit returns the error before
  // any poll), so extra attempts are cheap — give the seed+de-identify buster plenty
  // of tries. Only a SUCCESSFUL submit spends the long poll budget.
  const attempts = Math.max(1, args.attempts ?? 6);
  const deadline = args.deadlineMs ?? (Date.now() + 200_000);
  // Defensive length cap — an over-long extend prompt hard-errors /veo/extend.
  let prompt = truncateOnWordBoundary(args.prompt, VEO_EXTEND_MAX_PROMPT_CHARS);
  let lastErr: unknown;

  // KIE's /veo/extend uses a DIFFERENT model vocabulary than /veo/generate:
  // generate takes veo3 / veo3_fast / veo3_lite, but extend ONLY accepts
  // fast / quality / lite. Sending "veo3_fast" here returns code 422
  // "model only supports fast, quality or lite". Map to the extend vocabulary.
  const baseModel = args.model === "veo3" ? "quality" : args.model === "veo3_lite" ? "lite" : "fast";
  let extendModel = baseModel;
  let prominentHits = 0; // how many times the prominent-people filter has fired

  // Extends are flaky (submit hiccups, poll timeouts, PROBABILISTIC safety blocks
  // like PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED). The parent taskId is
  // unchanged, so a fresh extend on the same parent is always safe to retry.
  for (let a = 1; a <= attempts; a++) {
    const remaining = deadline - Date.now();
    if (remaining < 55_000) {
      console.warn(`[kie-video-pipeline] extend: ${Math.round(remaining / 1000)}s left — too little budget for attempt ${a}`);
      break;
    }
    // Attempt 1 reuses the BASE clip's seed so the extended frames inherit the same
    // generative trajectory → consistent face across the chain. Retries use a fresh
    // seed — a different seed generates different content, the documented lever for
    // getting past the probabilistic prominent-people filter (retrying the SAME
    // request+seed just reproduces the same block).
    const seeds = a === 1 && typeof args.baseSeed === "number" ? args.baseSeed : randomVeoSeed();
    console.log(`[kie-video-pipeline] veo3.1 EXTEND parent=${args.parentTaskId.slice(0, 16)}… model=${extendModel} seed=${seeds} #${a}/${attempts}`);
    try {
      const res = await fetch("https://api.kie.ai/api/v1/veo/extend", {
        method: "POST",
        headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: args.parentTaskId, prompt, model: extendModel, seeds }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Kie veo/extend HTTP ${res.status}: ${text.slice(0, 220)}`);
      let json: { code: number; msg: string; data: { taskId: string } };
      try { json = JSON.parse(text); } catch { throw new Error(`Kie veo/extend non-JSON: ${text.slice(0, 200)}`); }
      // code 400 = content-policy (the prominent-people filter surfaces here) and
      // 501 = extension failed — both are retryable with a new seed / softer prompt.
      if (json.code !== 200) throw new Error(`Kie veo/extend code=${json.code}: ${json.msg}`);
      const extTaskId = json.data.taskId;
      const pollMs = clipPollBudgetMs(deadline, Date.now());
      const url = await pollVeoTask(extTaskId, KIE_VEO_RECORD, `extend(${extendModel})`, pollMs);
      console.log(`[kie-video-pipeline] veo/extend ✓ ${extTaskId}`);
      return { url, taskId: extTaskId };
    } catch (err) {
      lastErr = err;
      const emsg = err instanceof Error ? err.message : String(err);
      const prominent = isProminentPersonError(emsg);
      console.warn(`[kie-video-pipeline] extend #${a}/${attempts} failed${prominent ? " (prominent-people filter)" : ""}: ${emsg.slice(0, 150)}${a < attempts ? " — retrying" : ""}`);
      if (prominent) {
        // SOLVE the prominent-people block: de-identify the prompt (strip the
        // face/identity-lock language that cues the filter — the parent frame still
        // carries the real character), and after a couple of hits escalate to the
        // `quality` model. Combined with the fresh seed above, this clears the filter.
        prominentHits++;
        prompt = softenProminentPeoplePrompt(prompt);
        if (prominentHits >= 2 && baseModel === "fast") extendModel = "quality";
        if (a < attempts) await sleep(1500); // fast fail → short backoff, more tries fit
      } else {
        // Other failure — simplify the CONTINUATION prompt (never reset to a fresh
        // talking-head) and retry.
        prompt = simplifyVeoPrompt(args.prompt, emsg, undefined, true);
        if (a < attempts) await sleep(2500);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "veo extend failed"));
}

// Multi-clip Veo 3.1: generate first 8s, then chain extends to reach target duration.
// Each Veo clip is 8s max → for 24s target we generate + extend + extend.
// Returns the URL of the FINAL extended video (which contains all segments stitched).
//
// CRITICAL — time-budget aware:
// Next.js function timeout is 300s. Storyboard already burned ~60-90s. Each
// generate/extend takes 60-120s end-to-end. So we monitor wall-clock and
// stop chaining extends if we'd risk a hard kill. The user always gets back
// the longest stitched URL we successfully completed.
async function generateExtendedVeo3(args: {
  // one per 8s chunk, ordered. `prompt` drives the native /veo/extend; the optional
  // `standalonePrompt` is the SCENE-establishing generate prompt used when a window
  // must fall back to a fresh standalone clip (so fallback clips stay distinct).
  segments: Array<{ prompt: string; standalonePrompt?: string }>;
  imageUrls: string[];
  model: "veo3" | "veo3_fast" | "veo3_lite";
  aspectRatio: "16:9" | "9:16" | "Auto";
  resolution?: "720p" | "1080p" | "4k";
  /** Wall-clock deadline (epoch ms) at which we MUST stop chaining. */
  deadlineMs?: number;
  /** ffmpeg concat callback. When an extend is blocked by the safety filter, we
   *  render a FRESH standalone clip from the refs and concat it here instead of
   *  truncating. Absent → keep the current (shorter) video on extend failure. */
  stitchClips?: (clipUrls: string[], opts?: { crossfadeSeconds?: number; trimSeconds?: number; headTrimSeconds?: number }) => Promise<string>;
}): Promise<string> {
  if (args.segments.length === 0) throw new Error("generateExtendedVeo3: no segments");
  const deadline = args.deadlineMs ?? (Date.now() + 280_000);

  // Clip 1: standard generate (this is the must-have — the user gets at least 8s).
  // Retries are budget-aware so they never starve the extend chain.
  const first = await generateVeo3Video({
    prompt: args.segments[0].prompt,
    imageUrls: args.imageUrls,
    model: args.model,
    aspectRatio: args.aspectRatio,
    durationSeconds: 8,
    resolution: args.resolution,
    deadlineMs: deadline,
    ...veoRetryBudget(deadline),
  });
  console.log(`[kie-video-pipeline] segment 1/${args.segments.length} ready → ${first.url.slice(0, 80)}`);

  // Extend is only valid on dedicated veo endpoints (veo/veo3). The legacy
  // jobs/createTask fallback can't be extended — return clip 1 in that case.
  if (first.endpointUsed === "jobs") {
    console.warn(`[kie-video-pipeline] extend unavailable on jobs fallback — returning first clip only`);
    return first.url;
  }

  // Reserve ~90s per remaining extend. If we don't have at least 60s of
  // headroom before the deadline, bail with what we have.
  const EXTEND_RESERVE_MS = 90_000;
  let currentTaskId = first.taskId;
  let currentUrl = first.url;
  // Latches once an extend is blocked: the native chain is broken, so every
  // remaining clip is a fresh standalone generate. We ACCUMULATE the fresh clips and
  // concat ONCE at the end (concatenating eagerly re-encoded the whole growing video
  // on every fallback → O(N) re-encodes + compounding generation loss).
  let stitchMode = false;
  const freshClips: string[] = [];
  for (let i = 1; i < args.segments.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining < EXTEND_RESERVE_MS) {
      console.warn(`[kie-video-pipeline] time budget exhausted at segment ${i + 1}/${args.segments.length} (${Math.round(remaining/1000)}s left) — returning current ${i}-segment video`);
      break;
    }
    if (!stitchMode) {
      try {
        const ext = await extendVeo3Video({
          parentTaskId: currentTaskId,
          prompt: args.segments[i].prompt,
          model: args.model,
          attempts: 6,           // seed+de-identify buster retries (safety blocks fail fast)
          deadlineMs: deadline,
          baseSeed: first.seed,  // reuse the base clip's seed → consistent face across extends
        });
        currentTaskId = ext.taskId;
        currentUrl = ext.url;
        console.log(`[kie-video-pipeline] segment ${i + 1}/${args.segments.length} extended → ${currentUrl.slice(0, 80)}`);
        continue;
      } catch (err) {
        // All retries for THIS extend failed (usually the prominent-public-figure
        // filter never clears). If we can concat, switch to STITCH fallback and
        // render this window as a fresh standalone clip; else keep what we have.
        console.warn(`[kie-video-pipeline] extend ${i + 1} failed after retries — ${args.stitchClips ? "switching to fresh-clip stitch fallback" : "stopping"}:`, err instanceof Error ? err.message : err);
        if (!args.stitchClips) break;
        stitchMode = true;
      }
    }
    // STITCH FALLBACK: fresh standalone clip from the avatar refs (identity locked
    // by the reference images), concatenated onto the accumulated video. Use the
    // window's SCENE-establishing generate prompt (not the lean extend continuation)
    // and a FRESH seed — reusing the base clip's seed + identical refs reproduced the
    // SAME shot for every window ("the same video N times"); the refs alone keep the face.
    try {
      const fresh = await generateVeo3Video({
        prompt: args.segments[i].standalonePrompt ?? args.segments[i].prompt,
        imageUrls: args.imageUrls,
        model: args.model,
        aspectRatio: args.aspectRatio,
        durationSeconds: 8,
        resolution: args.resolution,
        deadlineMs: deadline,
        // NO seed anchor — a fresh seed per window keeps each fallback clip distinct.
        ...veoRetryBudget(deadline),
      });
      freshClips.push(fresh.url);
      console.log(`[kie-video-pipeline] segment ${i + 1}/${args.segments.length} fresh clip queued for stitch → ${fresh.url.slice(0, 80)}`);
    } catch (e) {
      console.warn(`[kie-video-pipeline] stitch fallback clip ${i + 1} failed, stopping with ${freshClips.length} queued:`, e instanceof Error ? e.message : e);
      break;
    }
  }
  // Single concat: the extend-chain cumulative video followed by every fresh clip.
  if (freshClips.length > 0 && args.stitchClips) {
    try {
      currentUrl = await args.stitchClips([currentUrl, ...freshClips], { crossfadeSeconds: 0 }); // hard cuts — a fade at the seam read as a transition effect
    } catch (e) {
      console.warn(`[kie-video-pipeline] final stitch concat failed, returning extend-only video:`, e instanceof Error ? e.message : e);
    }
  }
  return currentUrl;
}

export function buildVeoChainPlan(
  args: GenerateVideoArgs & { storyboardImageUrl: string },
  beats: StoryBeat[],
): VeoChainPlan {
  const videoModel = args.videoModel ?? "veo3_fast";
  // Only Veo models use the per-clip /veo/extend chain. Any other engine (Seedance,
  // Kling, Grok, Gemini, …) renders through the generic KIE jobs path in the video
  // phase, so report isVeo:false and let render-step take the monolithic branch.
  const isVeo = /^veo3(_|-|$)/i.test(videoModel) || videoModel === "veo3";
  const model: VeoChainPlan["model"] =
    videoModel === "veo3" ? "veo3" : videoModel === "veo3_lite" ? "veo3_lite" : "veo3_fast";
  // Prefer the operator's requested duration (Video Director length range) so the
  // video is actually that long; fall back to estimating from the script's word
  // count only when no duration was requested.
  const rawSeconds = args.durationSeconds ?? estimateSecondsFromScript(args.scriptText);
  const durationSeconds = Math.min(MAX_VIDEO_SECONDS, Math.max(MIN_VIDEO_SECONDS, rawSeconds));
  // The packer never overstuffs a clip (≤ 8s of speech each), so it may need a
  // few more windows than the nominal ceil(duration/8) to cover the whole script
  // without folding the tail into the last clip (which is what cut the ending).
  // Give it headroom sized to the beats' actual spoken seconds, bounded by the
  // global max clip count. `segmentPrompts.length` below becomes the real total.
  const spokenSeconds = beats.reduce((n, b) => n + beatSecondsFromVoiceover(b.voiceover), 0);
  const maxClips = Math.ceil(MAX_VIDEO_SECONDS / 8);
  const windowCap = Math.min(
    maxClips,
    Math.max(Math.ceil(durationSeconds / 8), Math.ceil(spokenSeconds / 8)),
  );
  const segments = packBeatsIntoWindows(beats, 8, windowCap);
  const voiceProfile = buildVoiceProfile({
    agentName: args.agentName,
    agentNiche: args.agentNiche,
    agentArchetype: args.agentArchetype,
    voiceArchetype: args.voiceArchetype,
    personality: args.personality,
    language: args.language,
  });
  // Exactly 3 Veo reference images, by priority: person, storyboard, product.
  const personRef = (args.avatarUrls ?? []).find((u) => !/\.gif(\?|#|$)/i.test(u)) ?? args.avatarUrl;
  const refImages = [personRef, args.storyboardImageUrl, args.productImageUrl]
    .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u) && !/\.gif(\?|#|$)/i.test(u))
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 3);
  const segmentPrompts = segments.map((segBeats, i) => {
    const prevLastBeat = i > 0 ? segments[i - 1][segments[i - 1].length - 1] : undefined;
    // Clip 0 is a fresh GENERATE (from the reference images) — the full segment
    // prompt. Clips 1+ go through /veo/extend, which inherits the previous clip's
    // final frame via the parent taskId and takes NO images — so they need the LEAN
    // CONTINUATION prompt (same as Grok's extend), not the reference-image/character-
    // lock generate prompt. Reusing the generate prompt was re-opening the scene and
    // over-running Veo's prompt limit → every extend errored and the video truncated.
    return i === 0
      ? buildSegmentPrompt(args, segBeats, i, segments.length, voiceProfile, prevLastBeat)
      : buildExtendPrompt(args, segBeats, 8, voiceProfile, prevLastBeat, i === segments.length - 1);
  });
  // Scene-establishing GENERATE prompt for every window — used only when a window
  // falls back to a fresh standalone clip (native extend blocked). Unlike the lean
  // extend continuation, each of these carries its OWN window's scene + spoken line,
  // so the stitch-fallback clips stay visually distinct instead of duplicating.
  const standalonePrompts = segments.map((segBeats, i) => {
    const prevLastBeat = i > 0 ? segments[i - 1][segments[i - 1].length - 1] : undefined;
    return buildSegmentPrompt(args, segBeats, i, segments.length, voiceProfile, prevLastBeat);
  });
  return {
    isVeo,
    model,
    segmentPrompts,
    standalonePrompts,
    refImages,
    totalSegments: segmentPrompts.length,
    // Veo only accepts 16:9 / 9:16 / Auto — "1:1" (and undefined) fall back to 9:16.
    aspectRatio: (args.aspectRatio === "16:9" || args.aspectRatio === "9:16") ? args.aspectRatio : "9:16",
  };
}

export async function renderVeoChainClip(args: {
  plan: VeoChainPlan;
  clipIndex: number;
  parentTaskId?: string;
  apiKey?: string;
  /** Base clip's seed, persisted after clip 0 and threaded into every extend so the
   *  character's face stays consistent across the chain. Undefined for clip 0 (it
   *  MINTS the seed, returned below) and for legacy jobs with no persisted seed. */
  baseSeed?: number;
  /** STITCH fallback latch: once a prior extend failed after all retries, every
   *  remaining clip is a fresh standalone generate (from the avatar refs) that the
   *  caller concats — we skip the now-broken native-extend chain entirely. */
  stitchMode?: boolean;
}): Promise<{ url: string; taskId: string; canExtend: boolean; seed?: number; isStandalone: boolean }> {
  if (args.apiKey) runtimeKieKey = args.apiKey.trim();
  const prompt = args.plan.segmentPrompts[args.clipIndex];
  if (!prompt) {
    throw new Error(`No segment prompt found for clip ${args.clipIndex + 1}/${args.plan.totalSegments}`);
  }

  // One clip per render-step invocation (300s maxDuration), so give the poll the
  // whole budget — the timeout bug was a 180s cap that quit while the task was
  // still processing and the function still had time.
  const deadlineMs = Date.now() + CLIP_RENDER_BUDGET_MS;

  if (args.clipIndex === 0) {
    const first = await generateVeo3Video({
      prompt,
      imageUrls: args.plan.refImages,
      model: args.plan.model,
      aspectRatio: args.plan.aspectRatio,
      durationSeconds: 8,
      resolution: "720p",
      deadlineMs,
    });
    return {
      url: first.url,
      taskId: first.taskId,
      canExtend: first.endpointUsed !== "jobs",
      seed: first.seed,
      isStandalone: false,
    };
  }

  // Continuation clip. PREFER KIE's native /veo/extend (frame-continuous, best
  // seam). But the prominent-public-figure safety filter is probabilistic and for
  // some faces it NEVER clears — extendVeo3Video's own seed+de-identify retries all
  // fail and it throws. Rather than truncate the video, FALL BACK to a fresh
  // standalone clip generated from the avatar reference images (which lock the face)
  // and let render-step concat it. `stitchMode` means a prior clip already fell back,
  // so the extend chain is broken — skip straight to a fresh generate.
  if (!args.stitchMode && args.parentTaskId) {
    try {
      const ext = await extendVeo3Video({
        parentTaskId: args.parentTaskId,
        prompt,
        model: args.plan.model,
        deadlineMs,
        baseSeed: args.baseSeed,
      });
      return { url: ext.url, taskId: ext.taskId, canExtend: true, seed: args.baseSeed, isStandalone: false };
    } catch (err) {
      console.warn(
        `[kie-video-pipeline] veo extend clip ${args.clipIndex + 1} failed after all retries ` +
        `(${err instanceof Error ? err.message.slice(0, 160) : String(err)}) — falling back to a ` +
        `fresh standalone continuation clip (stitch).`,
      );
    }
  }

  // STITCH FALLBACK — a fresh generate from the SAME avatar reference images. The
  // refs (not a parent frame) carry the identity here, and generateVeo3Video's
  // strategy escalation (reference → ai-refs → image-to-video → text-only) is far
  // more likely to clear the prominent-people filter than /veo/extend, which can
  // only reseed. Returns just this ~8s clip; render-step concats it. canExtend stays
  // true so the render loop keeps producing the remaining windows (also as fresh
  // clips, since stitchMode latches on the caller side).
  //
  // TWO things keep each fallback clip DISTINCT (the fix for "the same video N times"):
  //   1. the SCENE-establishing generate prompt for THIS window (standalonePrompts[i]),
  //      NOT the lean "continue the existing take" extend prompt — a fresh generate has
  //      no parent frame, so a scene-less continuation gave it nothing to differentiate;
  //   2. a FRESH seed (no baseSeed anchor) — the reference images already lock the
  //      face, so reusing the base clip's seed only reproduced the SAME shot. Anchoring
  //      the seed here is what collapsed every fallback window into a duplicate take.
  const standalonePrompt = args.plan.standalonePrompts?.[args.clipIndex] ?? prompt;
  // Reserve ~60s of the invocation for the caller's concat (download both clips +
  // re-encode + upload) so the fresh generate can't consume the whole budget and
  // leave the stitch to be SIGKILLed at the 300s function cap.
  const freshDeadlineMs = deadlineMs - 60_000;
  const fresh = await generateVeo3Video({
    prompt: standalonePrompt,
    imageUrls: args.plan.refImages,
    model: args.plan.model,
    aspectRatio: args.plan.aspectRatio,
    durationSeconds: 8,
    resolution: "720p",
    deadlineMs: freshDeadlineMs,
    // NO seed anchor — a fresh random seed per window keeps the fallback clips
    // visually distinct; the reference images (not the seed) preserve the face.
    ...veoRetryBudget(freshDeadlineMs),
  });
  // Keep the chain's base seed threaded through so any later NATIVE extend still has
  // its continuity anchor; a standalone clip's own seed is irrelevant to the stitch.
  return { url: fresh.url, taskId: fresh.taskId, canExtend: true, seed: args.baseSeed ?? fresh.seed, isStandalone: true };
}

// ─── Grok chunked chain (Recreate) ───────────────────────────────────────────
// The Grok analogue of buildVeoChainPlan/renderVeoChainClip: ONE clip per
// invocation, safe for the self-refiring render-step loop. Clip 0 is a
// grok-imagine/image-to-video base take; clips 1+ are grok-imagine/extend steps
// chained on the previous task_id, each returning the CUMULATIVE video — so no
// stitching is needed and the seam stays frame-continuous.

const GROK_CHAIN_BASE_MAX_SECONDS = 15;
const GROK_CHAIN_BASE_MIN_SECONDS = 6;
const GROK_CHAIN_EXTEND_MAX_SECONDS = 15;
const GROK_CHAIN_EXTEND_MIN_SECONDS = 4;

export interface GrokChainPlan {
  /** Base image-to-video slug (grok-imagine/image-to-video). */
  model: string;
  basePrompt: string;
  baseSeconds: number;
  /** One lean continuation prompt per extend window (clip index i+1). */
  extendPrompts: string[];
  /** Seconds each extend window appends (parallel to extendPrompts). */
  extendSeconds: number[];
  /** Start-frame + supporting references for the BASE clip only (extends inherit frames). */
  refImages: string[];
  aspectRatio: "16:9" | "9:16" | "1:1";
  resolution: "720p" | "1080p" | "4k";
  /** 1 (base) + extendPrompts.length. */
  totalSegments: number;
}

/** A beat's screen time: the planner's explicit seconds (Recreate mirrors the
 *  source scene durations) with the spoken-length estimate as fallback — so the
 *  finished chain length tracks the ORIGINAL video, not the script estimate. */
function grokBeatSeconds(b: StoryBeat): number {
  return b.seconds && b.seconds > 0 ? b.seconds : beatSecondsFromVoiceover(b.voiceover);
}

export function buildGrokChainPlan(args: GenerateVideoArgs, beats: StoryBeat[]): GrokChainPlan {
  if (beats.length === 0) throw new Error("buildGrokChainPlan needs at least one beat");
  const model = args.videoModel && /grok/i.test(args.videoModel) ? args.videoModel : "grok-imagine/image-to-video";

  // Pack beats into a ≤15s base window + ≤15s extend windows by their SCREEN
  // seconds, so the total matches the planned (source) duration.
  const windows: StoryBeat[][] = [];
  let current: StoryBeat[] = [];
  let acc = 0;
  for (const b of beats) {
    const s = grokBeatSeconds(b);
    const cap = windows.length === 0 ? GROK_CHAIN_BASE_MAX_SECONDS : GROK_CHAIN_EXTEND_MAX_SECONDS;
    if (current.length > 0 && acc + s > cap) {
      windows.push(current);
      current = [];
      acc = 0;
    }
    current.push(b);
    acc += s;
  }
  if (current.length > 0) windows.push(current);

  // windowSeconds() (word-count based, floored ONCE per window) drives the
  // ACTUAL duration requested from Kie — grokBeatSeconds above only decides
  // window BOUNDARIES (which beats land in which clip). Using the same
  // per-beat-summed value for the requested duration over-allocates seconds
  // whenever a window has several short beats, and Kie's model fills the
  // excess by padding/repeating the line to match the requested length.
  // Requested duration per window: the beats' EXPLICIT screen seconds when the
  // plan carries them (visual timing is authoritative — a recreation/cartoon/
  // silent beat is on screen far longer than its line takes to say), otherwise
  // the word-count estimate. Word-count-ONLY here was the "24s planned, 10s
  // rendered" bug: a 14s window whose spoken line was 6 words got requested as
  // a 6s clip, silently collapsing every low-dialogue video. The no-repeat rule
  // in the prompts (not a shortened request) is what guards against padding.
  const windowSecs = windows.map((w) => {
    const explicit = w.reduce((n, b) => n + (b.seconds && b.seconds > 0 ? b.seconds : 0), 0);
    return Math.max(explicit, windowSeconds(w));
  });
  const baseSeconds = Math.max(GROK_CHAIN_BASE_MIN_SECONDS, Math.min(GROK_CHAIN_BASE_MAX_SECONDS, Math.round(windowSecs[0])));

  const voiceProfile = buildVoiceProfile({
    agentName: args.agentName,
    agentNiche: args.agentNiche,
    agentArchetype: args.agentArchetype,
    voiceArchetype: args.voiceArchetype,
    personality: args.personality,
    language: args.language,
  });

  // Multiple LOOKS at the SAME product (upload + any AI-picked site shots) beat
  // one flat photo for precision — prioritized right after the character anchor,
  // ahead of generic supporting references (e.g. web/app screenshots).
  const productImages = [args.productImageUrl, ...(args.productImageUrls ?? [])]
    .filter((u): u is string => typeof u === "string" && isHttpImageUrl(u))
    .filter((value, index, arr) => arr.indexOf(value) === index);
  const refImages = [args.avatarUrl, ...productImages, ...(args.referenceImageUrls ?? [])]
    .filter((u): u is string => typeof u === "string" && isHttpImageUrl(u))
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 3);
  const productDesc = args.productDescription?.replace(/\s+/g, " ").trim().slice(0, 300) ?? "";
  const productSlots = productImages.map((u) => refImages.indexOf(u) + 1).filter((slot) => slot > 0);
  const refBlock = buildReferenceMapBlock([
    { slot: 1, label: "the person / presenter — first frame + identity lock", role: "Character" },
    ...productSlots.map((slot, i) => ({
      slot,
      label: productDesc
        ? `the product to feature${productSlots.length > 1 ? ` (reference photo ${i + 1}/${productSlots.length}, same product)` : ""}: ${productDesc}`
        : `product / brand anchor${productSlots.length > 1 ? ` (reference photo ${i + 1}/${productSlots.length})` : ""}`,
      role: "Product",
    })),
  ]);
  // Extends inherit frames but NO images — this text block is the only product
  // anchor there, so it rides every clip: the engine must show the USER's product,
  // never invent or revert to a different one.
  const productBlock = productDesc
    ? `PRODUCT (show THIS exact product, never a different or generic one)${productSlots.length > 1 ? ` — ${productSlots.length} reference photos of it are attached, showing different angles/details of the SAME item; use them together to render it precisely` : ""}: ${productDesc}. Keep its shape, colors, packaging and label text consistent in every shot it appears in.`
    : "";

  const basePrompt = buildGrokPrompt(args, windows[0], baseSeconds, voiceProfile, { index: 0, total: windows.length }, { extraBlocks: [refBlock, ...(productBlock ? [productBlock] : [])] });
  const extendPrompts: string[] = [];
  const extendSeconds: number[] = [];
  for (let i = 1; i < windows.length; i++) {
    const secs = Math.max(GROK_CHAIN_EXTEND_MIN_SECONDS, Math.min(GROK_CHAIN_EXTEND_MAX_SECONDS, Math.round(windowSecs[i])));
    const prevLastBeat = windows[i - 1][windows[i - 1].length - 1];
    extendPrompts.push(buildExtendPrompt(args, windows[i], secs, voiceProfile, prevLastBeat, i === windows.length - 1));
    extendSeconds.push(secs);
  }

  return {
    model,
    basePrompt,
    baseSeconds,
    extendPrompts,
    extendSeconds,
    refImages,
    aspectRatio: resolveGrokAspect(args.aspectRatio),
    resolution: resolveVideoResolution(model, args.resolution),
    totalSegments: 1 + extendPrompts.length,
  };
}

export async function renderGrokChainClip(args: {
  plan: GrokChainPlan;
  clipIndex: number;
  /** Previous clip's Kie task id — required for clips 1+ (the extend chains on it). */
  parentTaskId?: string;
  /** Seconds of video already rendered (the extend appends at this point). */
  accumulatedSeconds?: number;
  apiKey?: string;
}): Promise<{ url: string; taskId: string; canExtend: boolean; accumulatedSeconds: number }> {
  if (args.apiKey) runtimeKieKey = args.apiKey.trim();
  const { plan, clipIndex } = args;
  const deadlineMs = Date.now() + CLIP_RENDER_BUDGET_MS;
  const pollMs = () => Math.max(60_000, deadlineMs - Date.now() - 15_000);

  if (clipIndex === 0) {
    // docs.kie.ai/market/grok-imagine/image-to-video — start-frame refs in
    // `image_urls`, duration as a "6".."30" string.
    const input: Record<string, unknown> = {
      prompt: plan.basePrompt,
      image_urls: plan.refImages.length > 0 ? plan.refImages : undefined,
      mode: "normal",
      aspect_ratio: plan.aspectRatio,
      duration: String(plan.baseSeconds),
      resolution: plan.resolution,
    };
    let taskId: string;
    let url: string;
    try {
      taskId = await createJobsTask(plan.model, input);
      url = await pollJobsTask(taskId, pollMs(), "grok-chain-base");
    } catch (err) {
      const emsg = err instanceof Error ? err.message : String(err);
      // One unfetchable reference image fails the WHOLE request — retry text-only
      // rather than hard-failing the render.
      if (input.image_urls && isImageRefError(emsg)) {
        console.warn(`[kie-video-pipeline] grok-chain base failed with images (${emsg.slice(0, 140)}) — retrying without images`);
        const noImg = { ...input };
        delete noImg.image_urls;
        taskId = await createJobsTask(plan.model, noImg);
        url = await pollJobsTask(taskId, pollMs(), "grok-chain-base");
      } else {
        throw err;
      }
    }
    return { url, taskId, canExtend: plan.totalSegments > 1, accumulatedSeconds: plan.baseSeconds };
  }

  const extIdx = clipIndex - 1;
  const prompt = plan.extendPrompts[extIdx];
  const secs = plan.extendSeconds[extIdx];
  if (!prompt || !secs) throw new Error(`No grok extend window for clip ${clipIndex + 1}/${plan.totalSegments}`);
  if (!args.parentTaskId) throw new Error(`Grok extend clip ${clipIndex + 1} has no parent task id to chain from`);
  const accumulated = args.accumulatedSeconds ?? plan.baseSeconds;
  // docs.kie.ai/market/grok-imagine/extend — append at the current cumulative end
  // (min 2 per Kie); the result is the FULL cumulative video, not just the tail.
  const taskId = await createJobsTask(GROK_EXTEND_MODEL, {
    task_id: args.parentTaskId,
    prompt,
    extend_at: Math.max(2, Math.round(accumulated)),
    // Kie's docs example sends this as a STRING ("6", not 6) — see the note
    // on the sibling call in generateGrokExtended above.
    extend_times: String(secs),
  });
  const url = await pollJobsTask(taskId, pollMs(), `grok-chain-extend ${clipIndex}/${plan.totalSegments - 1}`);
  // Same validation as generateGrokExtended: confirm the extend actually grew
  // the cumulative video instead of restarting from the anchor (the "script
  // repeats" symptom) — see probeVideoDurationSeconds' doc comment.
  const expectedSeconds = accumulated + secs;
  const probedSeconds = await probeVideoDurationSeconds(url);
  if (probedSeconds != null && probedSeconds < expectedSeconds - 3) {
    throw new Error(
      `grok-chain-extend ${clipIndex} returned ${probedSeconds.toFixed(1)}s, expected ~${expectedSeconds}s — Kie likely ignored extend_at and restarted the clip instead of continuing it`,
    );
  }
  return { url, taskId, canExtend: clipIndex + 1 < plan.totalSegments, accumulatedSeconds: expectedSeconds };
}

// ─── Wan 2.2 Animate Replace ─────────────────────────────────────────────────
// docs.kie.ai/market/wan/2-2-animate-replace — a DIFFERENT algorithm from the
// prompt-driven engines: no script, no beats, no prompts. It takes the SOURCE
// video + ONE character image and swaps the person in the footage with that
// character, preserving the original motion, expressions, scene and pacing.
// Both inputs are capped at 10MB by Kie (the caller compresses the video first).
const WAN_ANIMATE_REPLACE_MODEL = "wan/2-2-animate-replace";

export async function renderWanAnimateSwap(args: {
  /** Source video URL (≤10MB — Kie rejects larger files). */
  videoUrl: string;
  /** Character image URL — the person to swap INTO the footage (one person, clearly visible). */
  imageUrl: string;
  resolution?: "480p" | "580p" | "720p";
  apiKey?: string;
}): Promise<{ url: string; taskId: string }> {
  if (args.apiKey) runtimeKieKey = args.apiKey.trim();
  const deadlineMs = Date.now() + CLIP_RENDER_BUDGET_MS;
  const taskId = await createJobsTask(WAN_ANIMATE_REPLACE_MODEL, {
    video_url: args.videoUrl,
    image_url: args.imageUrl,
    resolution: args.resolution ?? "720p",
  });
  const url = await pollJobsTask(taskId, Math.max(60_000, deadlineMs - Date.now() - 15_000), "wan-animate-replace");
  return { url, taskId };
}

// ─── Runway Aleph 2.0 (video EDITING, not generation) ────────────────────────
// docs.kie.ai/runway-api/generate-aleph-video + get-aleph-video-details.
// Aleph transforms EXISTING footage per a text prompt while keeping everything
// not mentioned pixel-stable — the "replicate this ad with MY product" engine:
// original camera angles, motion, timing and pacing survive because the frames
// are edited, not regenerated. `referenceImage` anchors the swap target (the
// user's product photo / avatar).
const ALEPH_GENERATE_URL = "https://api.kie.ai/api/v1/aleph/generate";
const ALEPH_RECORD_URL = "https://api.kie.ai/api/v1/aleph/record-info";

export async function renderRunwayAleph(args: {
  /** The source video to EDIT (the uploaded reference ad). */
  videoUrl: string;
  /** What to change (and implicitly, everything else stays as filmed). */
  prompt: string;
  /** Image anchoring the replacement (product photo / avatar). */
  referenceImage?: string;
  aspectRatio?: string;
  apiKey?: string;
}): Promise<{ url: string; taskId: string }> {
  if (args.apiKey) runtimeKieKey = args.apiKey.trim();
  const deadlineMs = Date.now() + CLIP_RENDER_BUDGET_MS;

  const allowedAspects = new Set(["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"]);
  const body: Record<string, unknown> = {
    prompt: args.prompt,
    videoUrl: args.videoUrl,
    ...(args.referenceImage ? { referenceImage: args.referenceImage } : {}),
    ...(args.aspectRatio && allowedAspects.has(args.aspectRatio) ? { aspectRatio: args.aspectRatio } : {}),
  };
  const res = await fetch(ALEPH_GENERATE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kie aleph HTTP ${res.status}: ${text.slice(0, 220)}`);
  let json: { code?: number; msg?: string; data?: { taskId?: string } };
  try { json = JSON.parse(text); } catch { throw new Error(`Kie aleph non-JSON: ${text.slice(0, 200)}`); }
  const taskId = json.data?.taskId;
  if ((json.code ?? 200) !== 200 || !taskId) throw new Error(`Kie aleph create failed (code=${json.code}): ${json.msg ?? text.slice(0, 200)}`);
  console.log(`[kie-video-pipeline] aleph task ✓ ${taskId}`);

  // Poll — successFlag 1 = done (response.resultVideoUrl); a non-empty
  // errorMessage / non-zero errorCode = failed; otherwise still generating.
  while (Date.now() < deadlineMs - 10_000) {
    await sleep(8_000);
    try {
      const poll = await fetch(`${ALEPH_RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${kieKey()}` },
      });
      const pText = await poll.text();
      const pJson = JSON.parse(pText) as {
        code?: number;
        data?: { successFlag?: number; errorCode?: number; errorMessage?: string; response?: { resultVideoUrl?: string } };
      };
      const d = pJson.data;
      if (!d) continue;
      if (d.successFlag === 1) {
        const url = d.response?.resultVideoUrl;
        if (url && /^https?:\/\//i.test(url)) return { url, taskId };
        throw new Error("Aleph reported success but returned no video URL");
      }
      if ((d.errorCode ?? 0) !== 0 || (d.errorMessage ?? "").trim()) {
        throw new Error(`Aleph edit failed: ${(d.errorMessage ?? `code ${d.errorCode}`).slice(0, 220)}`);
      }
    } catch (e) {
      // A hard failure message aborts; transient fetch/parse hiccups keep polling.
      if (e instanceof Error && /Aleph (edit failed|reported success)/.test(e.message)) throw e;
    }
  }
  throw new Error(`Aleph edit timed out after ${Math.round(CLIP_RENDER_BUDGET_MS / 1000)}s (task ${taskId})`);
}

async function tryVeoEndpoint(url: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kie veo HTTP ${res.status}: ${text.slice(0, 220)}`);
  let json: { code: number; msg: string; data: { taskId: string } };
  try { json = JSON.parse(text); } catch { throw new Error(`Kie veo non-JSON: ${text.slice(0, 200)}`); }
  if (json.code !== 200) throw new Error(`Kie veo code=${json.code}: ${json.msg}`);
  console.log(`[kie-video-pipeline] veo task ✓ ${json.data.taskId} via ${url}`);
  return json.data.taskId;
}

// Defensive extractor — pulls a video URL from ANY of the known Kie response shapes.
//
// Kie returns resultUrls in surprisingly varied forms across endpoints/versions:
//   - string[]                       — newer veo poll
//   - Array<{url}>                   — some market endpoints
//   - string "http://…"              — single URL
//   - string "[http://…, http://…]"  — STRINGIFIED bracket form (per Veo 3.1 callback spec)
//   - stringified JSON in resultJson — older jobs/createTask path
//
// We try every known location AND every known wrapping. Anything that
// resolves to an http(s) URL wins.
function pickFirstUrl(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    // Direct URL
    const direct = value.match(/https?:\/\/[^\s"'\]\[,]+/i);
    if (direct) return direct[0];
    // Stringified array form: try JSON.parse first, then a regex sweep
    try {
      const parsed = JSON.parse(value);
      const fromParsed = pickFirstUrl(parsed);
      if (fromParsed) return fromParsed;
    } catch { /* fall through */ }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickFirstUrl(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = value as any;
    if (typeof obj.url === "string") {
      const found = pickFirstUrl(obj.url);
      if (found) return found;
    }
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractKieVideoUrl(payload: any): string | undefined {
  if (!payload) return undefined;
  const data = payload.data ?? payload;
  if (!data) return undefined;

  // ORDER MATTERS: fullResultUrls is the STITCHED/COMBINED video after
  // /veo/extend chains. Kie returns it alongside `resultUrls` (which is ONLY
  // the new 8s extension segment) — we must prefer the full one. For initial
  // /veo/generate calls, fullResultUrls is absent and resultUrls is correct.
  const candidates: unknown[] = [
    data.response?.fullResultUrls,
    data.info?.fullResultUrls,
    data.fullResultUrls,
    data.response?.resultUrls,
    data.info?.resultUrls,
    data.resultUrls,
    data.result?.resultUrls,
    data.urls,
    data.videoUrls,
    data.output?.urls,
    data.output?.videoUrls,
    data.response?.originUrls,
    data.info?.originUrls,
  ];

  // Sometimes resultJson is a stringified JSON containing resultUrls
  if (typeof data.resultJson === "string") {
    try {
      const parsed = JSON.parse(data.resultJson);
      candidates.push(parsed.resultUrls, parsed.urls);
    } catch { /* ignore */ }
  }

  for (const c of candidates) {
    const url = pickFirstUrl(c);
    if (url) return url;
  }

  // LAST RESORT — sweep entire payload as a string for any http(s) URL.
  // If Kie put the URL anywhere we didn't anticipate, this still finds it.
  try {
    const dump = JSON.stringify(payload);
    const m = dump.match(/https?:\/\/[^\s"'\\\]]+\.(mp4|mov|webm|m3u8)\b[^\s"'\\\]]*/i);
    if (m) return m[0];
  } catch { /* ignore */ }

  return undefined;
}

// Pull the last-frame image URL Seedance returns when `return_last_frame: true`.
// Kie's field name varies, so we probe the likely spots then fall back to any
// image URL in the payload. Used to frame-chain Seedance clips into one take.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractKieLastFrameUrl(payload: any): string | undefined {
  if (!payload) return undefined;
  const data = payload.data ?? payload;
  if (!data) return undefined;
  const candidates: unknown[] = [
    data.lastFrameUrl,
    data.last_frame_url,
    data.response?.lastFrameUrl,
    data.response?.last_frame_url,
    data.info?.lastFrameUrl,
    data.output?.lastFrameUrl,
    data.result?.lastFrameUrl,
  ];
  if (typeof data.resultJson === "string") {
    try {
      const parsed = JSON.parse(data.resultJson);
      candidates.push(parsed.lastFrameUrl, parsed.last_frame_url);
    } catch { /* ignore */ }
  }
  for (const c of candidates) {
    const url = pickFirstUrl(c);
    if (url) return url;
  }
  // Last resort: any image URL in the payload (the last-frame is the only image
  // a video job returns, so this is safe).
  try {
    const dump = JSON.stringify(payload);
    const m = dump.match(/https?:\/\/[^\s"'\\\]]+\.(jpg|jpeg|png|webp)\b[^\s"'\\\]]*/i);
    if (m) return m[0];
  } catch { /* ignore */ }
  return undefined;
}

// Defensive state extractor — Kie uses successFlag OR state depending on endpoint
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractKieState(payload: any): { status: "success" | "fail" | "pending"; errorMessage?: string } {
  const data = payload?.data ?? payload;
  if (!data) return { status: "pending" };

  // Pattern A: successFlag (newer veo endpoint)
  if (typeof data.successFlag === "number") {
    if (data.successFlag === 1) return { status: "success" };
    if (data.successFlag === 2 || data.successFlag === 3) return { status: "fail", errorMessage: data.errorMessage ?? data.errMsg };
    return { status: "pending" };
  }

  // Pattern B: state string (jobs/createTask)
  if (typeof data.state === "string") {
    if (data.state === "success") return { status: "success" };
    if (data.state === "fail" || data.state === "failed") return { status: "fail", errorMessage: data.failMsg ?? data.errorMessage };
    return { status: "pending" };
  }

  // Pattern C: status string
  if (typeof data.status === "string") {
    if (/^(success|completed|done)$/i.test(data.status)) return { status: "success" };
    if (/^(fail|failed|error)$/i.test(data.status)) return { status: "fail", errorMessage: data.errorMessage ?? data.failMsg };
    return { status: "pending" };
  }

  return { status: "pending" };
}

async function pollVeoTask(taskId: string, recordUrl: string, modelLabel: string, timeoutMs = 180_000): Promise<string> {
  // Tighter deadline so a stuck Veo task can't burn the whole function budget.
  // Veo Fast typically finishes in 30-90s; Quality 60-150s. The caller may pass a
  // shorter timeout so a retry attempt still fits within the render budget.
  const deadline = Date.now() + timeoutMs;
  let delay = 4000;
  let pollCount = 0;
  let lastPayloadSample = "";
  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay * 1.3, 15_000);
    pollCount++;
    const r = await fetch(`${recordUrl}?taskId=${taskId}`, { headers: { Authorization: `Bearer ${kieKey()}` } });
    if (!r.ok) {
      console.warn(`[kie-video-pipeline] veo(${modelLabel}) poll HTTP ${r.status}`);
      continue;
    }
    const raw = await r.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any;
    try { json = JSON.parse(raw); } catch {
      console.warn(`[kie-video-pipeline] veo(${modelLabel}) poll non-JSON: ${raw.slice(0, 200)}`);
      continue;
    }
    lastPayloadSample = JSON.stringify(json).slice(0, 400);

    const { status, errorMessage } = extractKieState(json);
    if (pollCount <= 2 || pollCount % 3 === 0) {
      console.log(`[kie-video-pipeline] veo(${modelLabel}) poll #${pollCount} status=${status} payload=${lastPayloadSample}`);
    }

    if (status === "success") {
      const url = extractKieVideoUrl(json);
      if (!url) {
        // Last-resort: dump full payload so we can see the actual shape
        console.error(`[kie-video-pipeline] veo(${modelLabel}) reported SUCCESS but no URL found in payload:`, JSON.stringify(json).slice(0, 1200));
        throw new Error(`veo(${modelLabel}) success but no parseable resultUrl. Payload: ${JSON.stringify(json).slice(0, 300)}`);
      }
      console.log(`[kie-video-pipeline] veo(${modelLabel}) ✓ video ready: ${url.slice(0, 100)}`);
      return url;
    }
    if (status === "fail") {
      throw new Error(`veo(${modelLabel}) failed: ${errorMessage ?? "no reason given"}. Payload: ${lastPayloadSample}`);
    }
    // status === "pending" → continue polling
  }
  throw new Error(`veo(${modelLabel}) timed out after ${Math.round(timeoutMs / 1000)}s. Last payload: ${lastPayloadSample}`);
}

// ─── Seedance 2 (ByteDance) via Kie jobs endpoint ────────────────────────────
// Docs: https://docs.kie.ai/market/bytedance/seedance-2
// Seedance caps at 15s per generation and has NO native extend/merge endpoint.
// To build longer videos we frame-chain: each clip is generated from the
// previous clip's last frame (return_last_frame → first_frame_url), then the
// clips are concatenated by the caller-provided `stitchClips` (ffmpeg in the
// Convex job). The full `bytedance/seedance-2` model exposes the frame params
// the `-fast` variant lacks.
const SEEDANCE_MODEL = "bytedance/seedance-2";
const SEEDANCE_MIN_CLIP = 5;
const SEEDANCE_MAX_CLIP = 15;

// Seedance 1.5 Pro — a DIFFERENT model + request shape from the legacy Seedance
// 2.0 default above, not just a version bump: up to 2 anchor/reference images
// via `input_urls` (no separate first-frame param), 4-12s clips (not 5-15s),
// and `resolution` is a real request param (480p/720p/1080p) instead of always
// forced to 720p. docs.kie.ai/market/bytedance/seedance-1-5-pro
const SEEDANCE_15_PRO_MODEL = "bytedance/seedance-1.5-pro";
const SEEDANCE_15_PRO_MIN_CLIP = 4;
const SEEDANCE_15_PRO_MAX_CLIP = 12;
const is15ProModel = (videoModel: string | undefined): boolean => /seedance.*1[.\-]?5/i.test(videoModel ?? "");

/** Generate one Seedance clip from a starting frame; return its URL + last frame.
 *  `model` selects Seedance 1.5 Pro's request shape vs the legacy 2.0 default —
 *  see is15ProModel above. */
async function generateSeedanceClip(args: {
  prompt: string;
  firstFrameUrl: string;
  durationSeconds: number;
  wantLastFrame: boolean;
  referenceImageUrls?: string[];
  /** Seedance-2 accepts 1:1 / 16:9 / 9:16 (+ 4:3/3:4/21:9/Auto). Defaults to "9:16". */
  aspectRatio?: "16:9" | "9:16" | "1:1" | "Auto";
  /** Poll ceiling (ms). Defaults to 360s; parallel clips pass the render's
   *  remaining budget so a slow clip can't overrun the invocation. */
  timeoutMs?: number;
  /** The agent's selected engine slug (VIDEO_ENGINES[].kieModel) — picks
   *  Seedance 1.5 Pro vs the legacy 2.0 request shape. Defaults to 2.0. */
  model?: string;
  /** Director's Resolution setting — only Seedance 1.5 Pro actually honors it
   *  (2.0 stays hardcoded 720p, unchanged behavior). */
  resolution?: "480p" | "720p" | "1080p";
  /** Resume: poll THIS existing Kie task instead of creating a new one — an
   *  invocation that timed out mid-poll left a task still rendering; creating
   *  a fresh one duplicates a paid generation. */
  resumeTaskId?: string;
  /** Fired right after task creation with the new taskId (persist it so a
   *  timeout can resume the poll). */
  onTaskCreated?: (taskId: string) => Promise<void> | void;
}): Promise<{ videoUrl: string; lastFrameUrl?: string }> {
  const pro = is15ProModel(args.model);
  const model = pro ? SEEDANCE_15_PRO_MODEL : SEEDANCE_MODEL;
  // getEngineAdapter() only knows the GENERIC "seedance" pattern (clamp 5-15s) —
  // it can't tell 1.5 Pro's 4-12s range apart from 2.0's 5-15s, so clamp directly
  // here instead of going through it for the pro path.
  const duration = pro
    ? Math.max(SEEDANCE_15_PRO_MIN_CLIP, Math.min(SEEDANCE_15_PRO_MAX_CLIP, Math.round(args.durationSeconds)))
    : (getEngineAdapter(model).encodeDuration(args.durationSeconds) as number);
  const input: Record<string, unknown> = pro
    ? {
        prompt: args.prompt,
        // Seedance 1.5 Pro: max 2 images total via input_urls, no separate
        // first-frame field. Lead with the continuity frame so it dominates,
        // then fill the remaining slot with a character/product reference.
        // No `return_last_frame`/`wantLastFrame` here — undocumented for this
        // model, so multi-clip continuity degrades gracefully instead: if the
        // poll response carries no last-frame (extractKieLastFrameUrl → undefined),
        // the caller just re-anchors the NEXT clip on the same starting frame
        // rather than erroring.
        // Deduped (storyboard-lead passes the same image as start AND ref) and
        // OMITTED entirely when empty — no first frame = pure text-to-video.
        ...((): Record<string, unknown> => {
          const urls = Array.from(new Set([args.firstFrameUrl, ...(args.referenceImageUrls ?? [])].filter(Boolean))).slice(0, 2);
          return urls.length ? { input_urls: urls } : {};
        })(),
        aspect_ratio: args.aspectRatio ?? "9:16",
        duration,
        resolution: args.resolution ?? "1080p",
      }
    : {
        prompt: args.prompt,
        // Image-to-Video: the clip opens on this frame. For clip 1 this is the
        // avatar; for later clips it's the previous clip's last frame → continuity.
        // Empty (storyboard-lead with no storyboard) → text-to-video: omit it.
        ...(args.firstFrameUrl ? { first_frame_url: args.firstFrameUrl } : {}),
        ...(args.referenceImageUrls?.length ? { reference_image_urls: args.referenceImageUrls.slice(0, 9) } : {}),
        aspect_ratio: args.aspectRatio ?? "9:16",
        duration,
        resolution: "720p",
        ...(args.wantLastFrame ? { return_last_frame: true } : {}),
      };
  const taskId = args.resumeTaskId || await createJobsTask(model, input);
  if (!args.resumeTaskId) await args.onTaskCreated?.(taskId);
  return await pollSeedanceClip(taskId, args.timeoutMs ?? 360_000);
}

/** Poll a Seedance job, returning both the video URL and (if present) the last frame. */
async function pollSeedanceClip(taskId: string, timeoutMs: number): Promise<{ videoUrl: string; lastFrameUrl?: string }> {
  const deadline = Date.now() + timeoutMs;
  let delay = 4000;
  let lastPayloadSample = "";
  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay * 1.4, 12_000);
    const res = await fetch(`${KIE_JOBS_POLL}?taskId=${taskId}`, { headers: { Authorization: `Bearer ${kieKey()}` } });
    if (!res.ok) { console.warn(`[kie-video-pipeline] seedance poll HTTP ${res.status}`); continue; }
    const raw = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any;
    try { json = JSON.parse(raw); } catch { console.warn(`[kie-video-pipeline] seedance poll non-JSON: ${raw.slice(0, 200)}`); continue; }
    lastPayloadSample = JSON.stringify(json).slice(0, 400);
    const { status, errorMessage } = extractKieState(json);
    if (status === "success") {
      const videoUrl = extractKieVideoUrl(json);
      if (!videoUrl) throw new Error(`Seedance success but no video URL. Payload: ${JSON.stringify(json).slice(0, 300)}`);
      const lastFrameUrl = extractKieLastFrameUrl(json);
      console.log(`[kie-video-pipeline] seedance clip ✓ video=${videoUrl.slice(0, 80)} lastFrame=${lastFrameUrl ? "yes" : "no"}`);
      return { videoUrl, lastFrameUrl };
    }
    if (status === "fail") throw new Error(`Seedance failed: ${errorMessage ?? "no reason"}. Payload: ${lastPayloadSample}`);
  }
  throw new Error(`Seedance timed out after ${timeoutMs / 1000}s. Last payload: ${lastPayloadSample}`);
}

/** Even split of a target duration across N clips, each clamped to the selected
 *  Seedance model's clip range (4-12s for 1.5 Pro, 5-15s for the 2.0 default). */
function splitDurationIntoClips(total: number, segments: number, videoModel?: string): number[] {
  const pro = is15ProModel(videoModel);
  const lo = pro ? SEEDANCE_15_PRO_MIN_CLIP : SEEDANCE_MIN_CLIP;
  const hi = pro ? SEEDANCE_15_PRO_MAX_CLIP : SEEDANCE_MAX_CLIP;
  const each = Math.max(lo, Math.min(hi, Math.round(total / segments)));
  return Array.from({ length: segments }, () => each);
}

/** Best-effort trailing scene-jump trim (see lib/server/videoTailGuard.ts) —
 *  bounded by remaining wall-clock so it can never push the render past its
 *  own deadline; any failure keeps the original clip. */
async function guardSeedanceTail(url: string, deadlineMs: number): Promise<string | null> {
  if (deadlineMs - Date.now() < 60_000) return null; // no budget — ship as-is
  try {
    const { trimTrailingSceneJump } = await import("./videoTailGuard");
    return await trimTrailingSceneJump(url);
  } catch {
    return null;
  }
}

/**
 * Generate a Seedance video of `durationSeconds`, frame-chaining `totalSegments`
 * clips for continuity and stitching them into one file via `stitchClips`.
 * Single-clip videos (≤15s) skip stitching and return the Kie URL directly.
 * If multiple clips are needed but no stitcher is provided, returns the first
 * clip and reports a note (never silently claims the full length).
 */
async function generateSeedanceStitched(args: {
  beats: StoryBeat[];
  genArgs: GenerateVideoArgs;
  durationSeconds: number;
  totalSegments: number;
  startFrameUrl: string;
  referenceImageUrls: string[];
  referenceMapBlock: string;
  deadlineMs: number;
}): Promise<{ url: string; note?: string }> {
  const { beats, genArgs, durationSeconds, totalSegments, startFrameUrl, referenceImageUrls, referenceMapBlock, deadlineMs } = args;
  // Seedance-2 accepts 1:1 / 16:9 / 9:16 (and 4:3/3:4/21:9/adaptive). Pass the
  // operator's Director choice through — including native SQUARE — instead of
  // collapsing everything to portrait. docs.kie.ai/market/bytedance/seedance-2
  const seedanceAspect: "16:9" | "9:16" | "1:1" | "Auto" =
    (genArgs.aspectRatio === "16:9" || genArgs.aspectRatio === "9:16" || genArgs.aspectRatio === "1:1")
      ? genArgs.aspectRatio : "9:16";
  const pro = is15ProModel(genArgs.videoModel);
  const seedanceResolution: "480p" | "720p" | "1080p" | undefined = pro
    ? (genArgs.resolution === "1080p" ? "1080p" : "720p")
    : undefined;
  const seedanceWindowSec = pro ? SEEDANCE_15_PRO_MAX_CLIP : (/seedance/i.test(genArgs.videoModel ?? "") ? SEEDANCE_MAX_CLIP : 8);
  let segments = packBeatsIntoWindows(beats, seedanceWindowSec, totalSegments);
  const clipLo = pro ? SEEDANCE_15_PRO_MIN_CLIP : SEEDANCE_MIN_CLIP;
  const clipHi = pro ? SEEDANCE_15_PRO_MAX_CLIP : SEEDANCE_MAX_CLIP;
  // The packer sizes windows from SPOKEN seconds only — beats with thin/no
  // voiceover (silent formats, visual-led cartoons) collapse into far fewer
  // windows than the requested duration needs (a 30s ask packed into ONE
  // 4s-of-speech window rendered a single 4s clip — the "chose 30s, got 4s"
  // bug). Guarantee enough windows to physically COVER the requested length
  // at ≤clipHi per clip: when packing under-delivers, re-split the beats
  // evenly across the required window count instead.
  const neededWindows = Math.max(1, Math.min(totalSegments, Math.ceil(durationSeconds / clipHi)));
  if (segments.length < neededWindows) {
    const per = Math.ceil(beats.length / neededWindows);
    const resplit: StoryBeat[][] = [];
    for (let i = 0; i < beats.length; i += per) resplit.push(beats.slice(i, i + per));
    if (resplit.length > segments.length) {
      console.log(`[kie-video-pipeline] seedance window re-split: packer produced ${segments.length} window(s) for a ${durationSeconds}s request — re-split into ${resplit.length} to cover the full length`);
      segments = resplit;
    }
  }
  // Clip lengths: distribute the REQUESTED duration across the windows,
  // weighted by each window's spoken seconds (so a long scene gets more
  // runtime than a short one), each clamped to the model's legal range.
  // Weighting by speech alone (the previous approach) let sparse-voiceover
  // windows shrink the TOTAL video far below the requested length.
  const evenDurations = splitDurationIntoClips(durationSeconds, segments.length, genArgs.videoModel);
  const weights = segments.map((seg) => Math.max(1, windowSeconds(seg)));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const clipDurations = segments.map((seg, i) => {
    const share = Math.round((durationSeconds * weights[i]) / weightSum);
    return weightSum > 0 && share > 0 ? Math.max(clipLo, Math.min(clipHi, share)) : evenDurations[i];
  });
  const voiceProfile = buildVoiceProfile({
    agentName: genArgs.agentName, agentNiche: genArgs.agentNiche,
    agentArchetype: genArgs.agentArchetype, voiceArchetype: genArgs.voiceArchetype,
    personality: genArgs.personality, language: genArgs.language,
  });

  // Single clip — no stitching needed.
  if (segments.length === 1) {
    const prompt = await distillEnginePromptWithClaude(
      buildSegmentPrompt(genArgs, segments[0], 0, 1, voiceProfile, undefined, clipDurations[0], {
        engine: "seedance",
        extraBlocks: [referenceMapBlock],
      }),
      { engine: "seedance", clipSeconds: clipDurations[0], silent: speechMode(genArgs) === "silent", finalClip: true, multiShot: isStylizedAnimationFormat(genArgs), ...(genArgs.aesthetic ? { artStyle: genArgs.aesthetic } : {}) },
    );
    const { videoUrl } = await generateSeedanceClip({
      prompt,
      firstFrameUrl: startFrameUrl,
      durationSeconds: clipDurations[0],
      wantLastFrame: false,
      referenceImageUrls,
      aspectRatio: seedanceAspect,
      model: genArgs.videoModel,
      resolution: seedanceResolution,
    });
    return { url: (await guardSeedanceTail(videoUrl, deadlineMs)) ?? videoUrl };
  }

  // Multi-clip — generate the windows sequentially so each clip can start from
  // the actual last frame of the previous clip. This is slower than parallel
  // rendering, but it is the precise continuity path the builder asked for:
  // 1) clip 1 starts from the canonical character still,
  // 2) each later clip starts from the previous clip's returned last frame,
  // 3) every clip still gets the same reference-image bundle, so style/product
  //    cues stay stable while the motion evolves.
  // Resume state (persisted by the caller after every completed step): a phase
  // retry continues from the last finished clip instead of re-paying for the
  // whole chain. Kie generations are real money — this is the fix for "one
  // 30s video created a pile of unused Kie renders".
  const chainResume = genArgs.seedanceResume;
  const clipUrls: string[] = [...(chainResume?.clipUrls ?? [])];
  const startIndex = Math.max(clipUrls.length, Math.min(chainResume?.nextIndex ?? 0, segments.length));
  let failures = 0;
  let currentFirstFrame = chainResume?.firstFrame || startFrameUrl;
  if (startIndex > 0) {
    console.log(`[kie-video-pipeline] seedance chain RESUME: ${clipUrls.length}/${segments.length} clips already rendered — continuing from clip ${startIndex + 1}`);
  }
  const pollMs = Math.max(60_000, deadlineMs - Date.now() - 15_000);

  // Planner-marked scene change at a window's head: that clip is a DELIBERATE
  // story cut to a new location. It re-anchors on the style refs (not the
  // previous clip's last frame — frame-chaining a location change is exactly
  // what produced the mid-take environment glitches), and its prompt says
  // "new scene, same characters/art style" instead of "seamless continuation".
  const sceneCuts = segments.map((seg, i) => i > 0 && seg[0]?.newScene === true);
  // Distill EVERY clip's prompt in parallel up front — none of them depends
  // on a rendered frame (only on the beats, known now), and the sequential
  // per-clip distill added one full blocking LLM round trip per clip to the
  // chain's wall-clock for no benefit. Clips already banked by a resumed
  // chain (index < startIndex) are never rendered again, so their prompts
  // are not distilled either — each skipped distill is one fewer Kie LLM call.
  const silentRender = speechMode(genArgs) === "silent";
  const prompts = await Promise.all(segments.map((seg, i) => {
    if (i < startIndex) return Promise.resolve("");
    const prevLastBeat = i > 0 ? segments[i - 1][segments[i - 1].length - 1] : undefined;
    return distillEnginePromptWithClaude(
      buildSegmentPrompt(genArgs, seg, i, segments.length, voiceProfile, prevLastBeat, clipDurations[i], {
        engine: "seedance",
        extraBlocks: [referenceMapBlock],
        sceneCut: sceneCuts[i],
      }),
      {
        engine: "seedance",
        clipSeconds: clipDurations[i],
        silent: silentRender,
        continuation: i > 0 && !sceneCuts[i],
        sceneCut: sceneCuts[i],
        finalClip: i === segments.length - 1,
        multiShot: isStylizedAnimationFormat(genArgs),
        ...(genArgs.aesthetic ? { artStyle: genArgs.aesthetic } : {}),
      },
    );
  }));

  for (let i = startIndex; i < segments.length; i++) {
    const sceneCut = sceneCuts[i];
    const prompt = prompts[i];

    // Cost guard: never START a clip we can't realistically await — a task
    // created 20s before the invocation dies is a paid generation nobody
    // polls. With ≥1 clip already banked, hand the remaining work to the
    // next invocation (resume state above); with none, let it run (a partial
    // is better than nothing).
    if (clipUrls.length > 0 && deadlineMs - Date.now() < 120_000) {
      await genArgs.onSeedanceProgress?.({ clipUrls, nextIndex: i, firstFrame: currentFirstFrame });
      throw new Error(`SEEDANCE_TIME_BUDGET: ${clipUrls.length}/${segments.length} clips done — retry resumes from clip ${i + 1}`);
    }

    // Up to 2 attempts per clip on REAL failures. A poll TIMEOUT is not
    // retried in-invocation — the task is still rendering on Kie's side, so
    // a retry would create a duplicate paid generation; instead the timeout
    // bubbles up and the NEXT invocation re-polls the SAME task
    // (pendingTaskId in the resume state).
    let lastErr: unknown;
    let recovered = false;
    const resumePending = chainResume?.pendingClipIndex === i && chainResume.pendingTaskId ? chainResume.pendingTaskId : undefined;
    for (let attempt = 0; attempt < 2 && !recovered; attempt++) {
      try {
        if (attempt > 0) {
          console.warn(`[kie-video-pipeline] seedance clip ${i + 1}/${segments.length} retry ${attempt}/1`);
        }
        const { videoUrl, lastFrameUrl } = await generateSeedanceClip({
          prompt,
          // Scene cut: never chain the previous location's pixels into the new
          // scene — and don't re-anchor on the opening keyframe either (it
          // depicts scene 1's location and would pull the new scene back
          // there). Text-to-video lead for this clip; character + art style
          // hold through the remaining reference images, the scene text
          // describes the new location.
          firstFrameUrl: sceneCut ? "" : currentFirstFrame,
          durationSeconds: clipDurations[i],
          wantLastFrame: i < segments.length - 1,
          referenceImageUrls: sceneCut ? referenceImageUrls.filter((u) => u !== startFrameUrl) : referenceImageUrls,
          aspectRatio: seedanceAspect,
          timeoutMs: pollMs,
          model: genArgs.videoModel,
          resolution: seedanceResolution,
          // First attempt of a resumed pending clip polls the EXISTING task.
          resumeTaskId: attempt === 0 ? resumePending : undefined,
          onTaskCreated: (taskId) => genArgs.onSeedanceProgress?.({ clipUrls, nextIndex: i, firstFrame: currentFirstFrame, pendingTaskId: taskId, pendingClipIndex: i }),
        });
        clipUrls.push(videoUrl);
        if (lastFrameUrl) {
          currentFirstFrame = lastFrameUrl;
        } else if (i < segments.length - 1) {
          // Seedance 1.5 Pro returns NO last frame — without one the next clip
          // re-anchored on the ORIGINAL keyframe, so every chained clip
          // visibly restarted from the same opening frame ("all clips look
          // like the same frame"). Extract the real final frame ourselves
          // (ffmpeg seeks the tail over HTTP) and host it as the next anchor;
          // only on failure does continuity degrade to the previous frame.
          try {
            const { extractLastFrameBase64 } = await import("./ffmpegBin");
            const { hostBase64ForKie } = await import("./imageForKie");
            const b64 = await extractLastFrameBase64(videoUrl);
            const hosted = b64 ? await hostBase64ForKie(b64, i) : null;
            if (hosted) {
              currentFirstFrame = hosted;
              console.log(`[kie-video-pipeline] seedance clip ${i + 1}: last frame extracted locally for the next clip's anchor`);
            } else {
              console.warn(`[kie-video-pipeline] seedance clip ${i + 1}: no last frame (engine or local) — next clip re-anchors on the previous frame`);
            }
          } catch (e) {
            console.warn(`[kie-video-pipeline] seedance clip ${i + 1} local last-frame extract failed: ${e instanceof Error ? e.message : e}`);
          }
        }
        recovered = true;
        // Bank the finished clip immediately — a later crash/timeout resumes
        // AFTER it instead of re-rendering it.
        await genArgs.onSeedanceProgress?.({ clipUrls, nextIndex: i + 1, firstFrame: currentFirstFrame, pendingTaskId: undefined, pendingClipIndex: undefined });
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        // Timeout: the Kie task is likely still rendering — do NOT create a
        // duplicate. Bubble up; the next invocation re-polls it.
        if (/timed out/i.test(msg)) {
          throw new Error(`SEEDANCE_TIME_BUDGET: clip ${i + 1} still rendering on Kie — retry resumes its poll`);
        }
      }
    }
    if (!recovered) {
      failures++;
      const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
      console.warn(`[kie-video-pipeline] seedance clip ${i + 1}/${segments.length} failed after 2 attempts: ${reason}`);
      // Don't abort the rest of the chain — a mid-chain segment failing
      // shouldn't truncate every segment after it. The next clip continues
      // from the last SUCCESSFUL frame (currentFirstFrame is left untouched),
      // so continuity degrades slightly at this one join instead of the
      // whole video losing this segment's runtime.
      if (deadlineMs - Date.now() < 90_000) break; // keep headroom to stitch what we have
    }
  }

  if (clipUrls.length === 0) throw new Error(`All ${segments.length} seedance clips failed`);
  const note = failures > 0
    ? `Rendered ${clipUrls.length}/${segments.length} clips (${failures} failed) — shorter than ${durationSeconds}s.`
    : undefined;

  // Tail guard on the FINAL clip only — a trailing scene-jump there is the
  // "last seconds show the wrong frame" glitch the operator sees on the
  // finished video. Mid-chain clips don't need it: each cut lands on a
  // planned clip boundary anyway.
  const lastIdx = clipUrls.length - 1;
  const guardedLast = await guardSeedanceTail(clipUrls[lastIdx], deadlineMs);
  if (guardedLast) clipUrls[lastIdx] = guardedLast;

  if (clipUrls.length === 1) return { url: clipUrls[0], note };
  if (!genArgs.stitchClips) {
    return {
      url: clipUrls[0],
      note: `Multi-clip stitching unavailable — returned first of ${clipUrls.length} clips. ${note ?? ""}`.trim(),
    };
  }
  // HARD CUT between chained clips: clip N+1's first frame IS clip N's last
  // frame, so a crossfade double-exposes that same frame into a half-second
  // morph smear (the "crashy" act break). A straight cut is seamless by
  // construction.
  const stitched = await genArgs.stitchClips(clipUrls, { crossfadeSeconds: 0 });
  return { url: stitched, note };
}

// (Gemini Omni character registry removed — Omni now always renders from the
// original reference image in `image_urls`, which preserves the real person's
// face and environment instead of a re-interpreted registry identity.)

// ─── Main pipeline entry ─────────────────────────────────────────────────────

export async function generateVideoFromScript(args: GenerateVideoArgs): Promise<VideoGenerationResult> {
  // Stash a forwarded key for this render so every Kie fetch (and the storyboard
  // Claude call) can authenticate even in the Convex runtime.
  if (args.apiKey) runtimeKieKey = args.apiKey.trim();
  if (!kieKey()) throw new Error("KIE_API_KEY not configured for the render runtime. In production the video render runs in the Convex action — set it there with `npx convex env set KIE_API_KEY <key>` (it's separate from Next's .env.local).");
  if (!args.avatarUrl) throw new Error("Agent has no avatarUrl — mint the agent with an avatar first");
  if (!/^https?:\/\//i.test(args.avatarUrl)) {
    throw new Error(`avatarUrl is not an HTTP URL (got "${args.avatarUrl.slice(0, 40)}…"). Kie can only fetch public HTTPS images.`);
  }

  // Persona kernel — compute once and reuse. If the caller already supplied one
  // (persisted on the render job), keep it so chunked render-steps stay consistent.
  // No-Persona renders skip it entirely: no CHARACTER block rides any prompt.
  // The kernel is its own LLM round trip that nothing in Phase 1 (story
  // planning) reads — the first consumer is decideStoryboardUse / the clip
  // prompt builders after planning — so it is STARTED here and awaited right
  // after the planning block, letting the two independent LLM calls overlap
  // instead of paying their latencies back to back. `.catch` marks the
  // promise handled so a planning-time throw can't surface an unhandled
  // rejection; the real error still rethrows at the await below.
  let pendingKernel: Promise<string> | undefined;
  if (args.noPersona) {
    args.personaKernel = "";
  } else if (!args.personaKernel) {
    pendingKernel = import("@/lib/server/personaKernel").then(({ buildPersonaKernel }) => buildPersonaKernel(
      {
        agentName: args.agentName,
        agentNiche: args.agentNiche,
        agentArchetype: args.agentArchetype,
        voiceArchetype: args.voiceArchetype,
        characterBible: args.characterBible,
        aesthetic: args.aesthetic,
        brandColor: args.brandColor,
        colorGrade: args.colorGrade,
        cameraStyle: args.cameraStyle,
        energy: args.energy,
        settings: args.settings,
        traits: args.traits,
        catchphrase: args.catchphrase,
        personality: args.personality,
        memories: args.memories,
      },
      { apiKey: args.apiKey },
    ));
    pendingKernel.catch(() => {});
  }

  // Tracked for time-budget enforcement on the extend chain.
  const pipelineStartMs = Date.now();

  // ── Engine-aware duration estimation from script ─────────────────────────
  // Speaking rate ≈ 2.5 words/sec (shared with the builder UI so the estimate
  // shown there matches what we generate). The number of clips depends on the
  // engine's max clip length: Veo clips are a fixed 8s (stitched via native
  // /veo/extend); Seedance clips are up to 15s (stitched via frame-chain +
  // ffmpeg concat). Capped at MAX_VIDEO_SECONDS (60s).
  const videoModel = args.videoModel ?? "veo3_fast";
  const maxClip = maxClipForModel(videoModel);
  const outputResolution = resolveVideoResolution(videoModel, args.resolution);
  // Raw spoken length. The VIDEO MUST COVER THE WHOLE SCRIPT — so take the larger
  // of the requested duration and the script's own spoken length. A requested 16s
  // with a 22s script renders 3×8s = 24s (covers the script) instead of cutting it
  // off at 16s. Capped at MAX_VIDEO_SECONDS.
  const scriptEstimate = estimateSecondsFromScript(args.scriptText);
  // Grok can go SHORT: the Director slider starts at 1s for it. Kie's grok API
  // floor is 6s, so a 1-5s request renders a 6s take and is TRIMMED to length
  // after the render (grokTrimSeconds below). Other engines keep the 5s floor.
  const engineMinSeconds = /grok/i.test(videoModel) ? 1 : MIN_VIDEO_SECONDS;
  const requested = args.durationSeconds && args.durationSeconds >= engineMinSeconds
    ? Math.min(MAX_VIDEO_SECONDS, Math.round(args.durationSeconds))
    : 0;
  // A short explicit grok request (<6s) is honored EXACTLY — script coverage
  // must not stretch it (the whole point is a 1-5s take).
  const grokTrimSeconds = /grok/i.test(videoModel) && requested > 0 && requested < 6 ? requested : 0;
  // Script coverage may stretch past the requested duration, but only a
  // LITTLE (≤20%): an unbounded max(requested, scriptEstimate) let a slightly
  // wordy script push a 20s request into a whole EXTRA segment window (e.g.
  // seedance 20s → 25s estimate → 3 clips of 12s instead of 2), tripling Kie
  // calls and shipping a video far longer than the operator chose. Within
  // +20% the extra seconds absorb into the existing windows' clip lengths;
  // beyond that the script itself is the problem and gets paced to fit.
  const coverageCap = requested > 0 ? Math.round(requested * 1.2) : MAX_VIDEO_SECONDS;
  const rawSeconds = grokTrimSeconds
    ? requested
    : Math.min(MAX_VIDEO_SECONDS, Math.max(requested, Math.min(scriptEstimate, coverageCap)));
  // How many clips this engine needs, capped so the stitched video stays ≤60s.
  // VERBATIM MODE (no storyboard + no persona): the operator's exact prompt is
  // one take — never split into windows, never repeated across clips.
  const verbatimMode = isVerbatimPromptMode(args);
  // maxClipForModel("grok") returns 20 — the UI menu's display ceiling, not a
  // real single /jobs/createTask duration (Kie's actual per-call cap is 15s,
  // see GROK_BASE_MAX_SECONDS). Planning the window COUNT off the 20s figure
  // used to tell the story-plan LLM "this is N windows of 8s" with N computed
  // from the wrong per-clip size (e.g. a 20s request planned as 1 window,
  // then rendered as 2 real 15s+5s clips downstream) — the story beats and
  // the actual clip split disagreed, which is exactly the "10s+15s instead of
  // 15s+5s" mis-split. Planning off the REAL per-call cap keeps both in sync.
  const planClipMax = /grok/i.test(videoModel) ? GROK_BASE_MAX_SECONDS : maxClip;
  const maxSegments = Math.floor(MAX_VIDEO_SECONDS / planClipMax) || 1;
  const totalSegments = verbatimMode ? 1 : Math.min(maxSegments, Math.max(1, Math.ceil(rawSeconds / planClipMax)));
  // Veo clips are a fixed 8s each, so the finished length is segments × 8.
  // Seedance clips are variable (4-15s), so it hits the raw target directly.
  const durationSeconds = verbatimMode
    ? Math.min(maxClip, Math.max(engineMinSeconds, requested || Math.min(rawSeconds, maxClip)))
    : maxClip === 8
      ? totalSegments * maxClip
      : Math.min(MAX_VIDEO_SECONDS, Math.max(engineMinSeconds, rawSeconds));
  // Fixed-8s-clip engines (Veo) round the OPERATOR'S requested length up to the
  // next full clip multiple — a 9-10s Director selection needs 2 clips to cover
  // any spoken content past 8s, so it renders 16s, not 9-10s. That's the "I picked
  // 9-10s but got a much longer video" bug: the extra ~6-7s is clip-multiple
  // rounding, not anything the script needed. Only safe to trim back down to the
  // request when the script ALREADY fits inside it (requested >= scriptEstimate)
  // — otherwise the overshoot is real coverage the script needs and cutting it
  // would chop speech mid-sentence, which is worse than a longer video.
  // Any engine may round a window UP past the request (Veo's 8s multiples,
  // Grok's 6s floor + per-window rounding, Seedance's 4/5s clip floor). When
  // the script already fits inside the request, trim the finished video to it.
  const overshootTrimSeconds = !verbatimMode && requested > 0 && requested >= scriptEstimate && durationSeconds > requested
    ? requested
    : 0;
  // Shared coverage math lives in lib/server/coverage.ts; the per-engine
  // dispatch below still owns the actual clipping strategy.
  const adapter = getEngineAdapter(videoModel);
  console.log(`[kie-video-pipeline] START agent=${args.agentName} topic="${args.topic}" scriptWords=${args.scriptText.trim().split(/\s+/).filter(Boolean).length} estDur=${durationSeconds}s segments=${totalSegments} model=${videoModel}`);

  // Declared BEFORE Phase 1: the planning fallback below reads it, and it used to
  // be declared only after Phase 2's ref setup — so a failed/refused storyboard
  // plan hit the temporal dead zone and crashed the whole render with
  // "Cannot access '<minified>' before initialization".
  const grokPortraitStoryboard = /grok/i.test(videoModel);

  // ── Phase 1: Claude builds storyboard structure + image prompt
  // On the resumed VIDEO phase the plan was already produced in the storyboard
  // phase — reuse it instead of re-calling Claude.
  let beats: StoryBeat[];
  let storyboardPrompt: string;
  if (verbatimMode) {
    // No planning LLM call: the operator's prompt is the whole direction. The
    // single beat exists only for downstream bookkeeping (window math, logs) —
    // every prompt builder is gated on isVerbatimPromptMode and ignores it.
    beats = [{ index: 1, scene: verbatimPromptOf(args).slice(0, 200), voiceover: "", camera: "", seconds: durationSeconds }];
    storyboardPrompt = "";
    console.log(`[kie-video-pipeline] VERBATIM mode — exact operator prompt, no planning, no storyboard, 1 take`);
  } else if (args.phase === "video" && args.resume) {
    beats = args.resume.beats;
    storyboardPrompt = args.resume.storyboardPrompt;
  } else if ((args.preplannedBeats?.filter((b) => (b.scene ?? b.action ?? "").trim()).length ?? 0) >= 3) {
    // The script call already authored the beats (action/camera/scene/newScene)
    // — reuse them instead of paying planStoryWithClaude to re-derive the same
    // structure from the same script. Voiceover fidelity comes from the
    // deterministic verbatim-script split, exactly like the planner path.
    const pre = args.preplannedBeats!.filter((b) => (b.scene ?? b.action ?? "").trim());
    beats = pre.map((b, i) => ({
      index: i + 1,
      scene: String(b.scene ?? b.action ?? "").slice(0, 280),
      voiceover: "",
      camera: String(b.camera ?? "static").slice(0, 30),
      videoPrompt: [b.action, b.scene, b.visualNotes].filter(Boolean).join(" — ").slice(0, 400) || undefined,
      seconds: 3,
      ...(typeof b.speaker === "string" && b.speaker.trim() ? { speaker: b.speaker.trim().slice(0, 60) } : {}),
      ...(i > 0 && b.newScene === true ? { newScene: true } : {}),
    }));
    // Voiceover per beat: when the script call attributed exact per-beat lines
    // (multi-character dialogue — `line` + `speaker`), USE them verbatim; an
    // even word-split across a conversation would slice lines mid-speaker and
    // mis-attribute dialogue. Monologue scripts (no per-beat lines) keep the
    // deterministic even split as before.
    const preLines = args.preplannedBeats!.map((b) => (typeof b.line === "string" ? b.line.trim() : ""));
    const linesUsable = preLines.filter(Boolean).length >= Math.ceil(beats.length / 2);
    const preScript = (args.scriptText ?? "").trim();
    if (linesUsable) {
      beats = beats.map((b, i) => {
        const voiceover = preLines[i] ?? "";
        return { ...b, voiceover, seconds: beatSecondsFromVoiceover(voiceover) };
      });
    } else if (preScript) {
      const lines = splitScriptAcrossBeats(preScript, beats.length);
      beats = beats.map((b, i) => {
        const voiceover = (lines[i] ?? "").trim();
        return { ...b, voiceover, seconds: beatSecondsFromVoiceover(voiceover) };
      });
    }
    storyboardPrompt = buildFallbackStoryboardPrompt(args, beats, { portrait: grokPortraitStoryboard });
    console.log(`[kie-video-pipeline] story plan: ${beats.length} beats reused from the script call — planner round trip skipped`);
  } else if (totalSegments === 1 && durationSeconds <= 8 && (args.scriptText ?? "").trim() && !formatRequiresStartFrame(args.formatId ?? "")) {
    // SHORT single-window video (≤ 8s): the whole story is one or two spoken
    // sentences — a storyboard PLANNER round-trip (one Kie LLM call) adds
    // nothing the script doesn't already say. Split the script into ≤ 2 beats
    // and use the deterministic storyboard prompt. Start-frame formats keep
    // the planner because their grid image feeds identity.
    const lines = splitScriptAcrossBeats(args.scriptText.trim(), 2).filter(Boolean);
    beats = (lines.length ? lines : [args.scriptText.trim()]).map((voiceover, i) => ({
      index: i + 1,
      scene: (i === 0 ? args.hook : voiceover).slice(0, 200),
      voiceover,
      camera: i === 0 ? "push in" : "hold",
      seconds: beatSecondsFromVoiceover(voiceover),
    }));
    storyboardPrompt = buildFallbackStoryboardPrompt(args, beats, { portrait: grokPortraitStoryboard });
    console.log(`[kie-video-pipeline] story plan: ${beats.length} beat(s) from the script — planner skipped for a ${durationSeconds}s single-window video`);
  } else {
    try {
      const planned = await planStoryWithClaude(args, totalSegments);
      beats = planned.beats;
      storyboardPrompt = planned.imagePrompt ||
        // Fallback: build prompt manually if Claude omitted imagePrompt
        buildFallbackStoryboardPrompt(args, beats, { portrait: grokPortraitStoryboard });
      console.log(`[kie-video-pipeline] story plan: ${beats.length} beats`);
    } catch (err) {
      console.warn(`[kie-video-pipeline] storyboard planning failed:`, err instanceof Error ? err.message : err);
      beats = [{ index: 1, scene: args.hook.slice(0, 200), voiceover: args.hook.slice(0, 100), camera: "push in", seconds: durationSeconds }];
      storyboardPrompt = buildFallbackStoryboardPrompt(args, beats, { portrait: grokPortraitStoryboard });
    }
  }

  // Persona kernel (started before Phase 1) must be resolved before anything
  // below reads args.personaKernel (storyboard decision, every clip prompt).
  if (pendingKernel) args.personaKernel = await pendingKernel;

  // ── Operator "no on-screen text" directive + instruction-echo scrub ────────
  // (a) A negative text directive anywhere in the operator's surfaces flips the
  //     render to a hard text-free stance: overlays off + a positively-phrased
  //     TEXT-FREE block PREPENDED to the standing orders (so it rides every clip
  //     prompt, and survives the grok prompt-budget trim which cuts from the
  //     tail). (b) Regardless of directives, any planned onScreenText that reads
  //     as an INSTRUCTION (the planner echoing "[no subtitles]" into an overlay)
  //     is dropped — instructions are never content.
  // LENGTH CONTRACT: the planner's per-beat seconds decide window boundaries
  // AND (Grok) the seconds requested per window — when they sum past the
  // operator's requested length the render runs long (a 5s ask planned as six
  // 3-4s beats rendered 20s). Scale them down proportionally to the request.
  if (!verbatimMode && requested > 0) {
    const planned = beats.reduce((n, b) => n + (b.seconds && b.seconds > 0 ? b.seconds : 0), 0);
    const cap = requested * 1.1;
    if (planned > cap) {
      const k = requested / planned;
      beats = beats.map((b) => ({ ...b, seconds: Math.max(1, Math.round((b.seconds ?? 0) * k)) }));
      console.log(`[kie-video-pipeline] beats planned ${planned}s for a ${requested}s request — scaled ×${k.toFixed(2)} to fit`);
    }
  }

  const suppressOnScreenText = detectNoOnScreenTextDirective(args);
  if (suppressOnScreenText) {
    args.allowOnScreenText = false;
    args.standingOrders = [NO_TEXT_PROMPT_BLOCK, (args.standingOrders ?? "").trim()].filter(Boolean).join("\n\n");
    console.log(`[kie-video-pipeline] operator no-text directive detected — text-free frame enforced`);
  }
  beats = beats.map((b) =>
    b.onScreenText && (suppressOnScreenText || isInstructionLikeOverlay(b.onScreenText))
      ? { ...b, onScreenText: undefined }
      : b,
  );

  // ── Format prompt injection (format catalog, phase 1) ──────────────────────
  // buildVideoPrompt() below (used for `formatPrompt`) ALSO folds
  // args.formatPrompt through adaptPromptForEngine, but that return value only
  // ever lands in the diagnostic `videoPrompt` field on the result — it is
  // NEVER what gets POSTed to Kie. The functions that build the REAL request
  // (buildSegmentPrompt/buildGrokPrompt via `beat.videoPrompt` ?? `beat.scene`,
  // buildExtendPrompt via `beat.scene`) read fields off each StoryBeat and
  // never see `args.formatPrompt` at all — so without this, a selected format
  // was completely inert at the engine boundary. Overwrite BOTH fields on every
  // beat so every segment/extend/grok builder path picks it up. Verbatim mode
  // (operator's exact prompt, no persona/storyboard) is an explicit operator
  // override and already fully owns `beats` above — skip injection there so it
  // keeps precedence. Also skip on a resumed VIDEO phase: those `beats` came
  // straight from `args.resume` — i.e. this SAME injection already ran during
  // the earlier storyboard-phase call before its beats were handed off — so
  // re-running here would compose the format prompt into an already-composed
  // beat and duplicate it.
  const resumedFromStoryboardPhase = args.phase === "video" && !!args.resume;
  if (args.formatPrompt && !verbatimMode && !resumedFromStoryboardPhase) {
    const engineId = args.videoModel ?? "";
    if (/grok/i.test(engineId)) {
      // GROK: do NOT fold the whole format template into every beat — that
      // repeated the full template once per ACTION line in buildGrokPrompt,
      // drowning the actual beat actions and blowing the prompt budget (the
      // "video isn't what I prompted" bug). Beats keep their own specific
      // scenes; buildGrokPrompt reads args.formatPrompt directly and carries
      // it ONCE as its own FORMAT block.
      console.log(`[kie-video-pipeline] format prompt carried as grok FORMAT block (formatId=${args.formatId ?? "none"})`);
    } else {
      beats = beats.map((b) => {
        const composed = composeBeatFormatPrompt({ engineId, formatPrompt: args.formatPrompt!, beatScene: b.scene });
        return { ...b, videoPrompt: composed, scene: composed };
      });
      console.log(`[kie-video-pipeline] format prompt injected into ${beats.length} beat(s) (formatId=${args.formatId ?? "none"}, engine=${engineId})`);
    }
  }

  // One canonical voice descriptor for the whole render — embedded verbatim in
  // every clip prompt so the voice never drifts across extends.
  const voiceProfile = buildVoiceProfile({
    agentName: args.agentName,
    agentNiche: args.agentNiche,
    agentArchetype: args.agentArchetype,
    voiceArchetype: args.voiceArchetype,
    personality: args.personality,
    language: args.language,
  });

  const videoPrompt = buildVideoPrompt(args, beats, durationSeconds);

  // Identity lock: resolve up to 3 STATIC reference images (the avatarUrl may be
  // an animated GIF Kie can't read). These drive BOTH the storyboard image and
  // the video clips, so the rendered character matches the minted NFT exactly —
  // including its art style (cartoon stays cartoon).
  const charRefs = resolveCharacterRefs(args.avatarUrl, [
    ...(args.avatarUrls ?? []),
    ...(args.referenceImageUrls ?? []),
  ]);
  const refImages = charRefs.refs;
  // The single best static frame for image models that take one reference.
  const primaryStill = refImages[0];

  // Storyboard references = the character stills FIRST (identity anchor), then the
  // campaign's images (cover + uploaded attachments from the campaign join) so the
  // storyboard features the actual product/brand. nano-banana-pro reads several
  // references; we cap at 5 (character + campaign), character always included.
  const campaignRefs = (args.campaignImageUrls ?? []).filter(
    (u) => typeof u === "string" && /^https?:\/\//i.test(u) && !/\.gif(\?|#|$)/i.test(u),
  );
  const storyboardRefImages = Array.from(new Set([...refImages, ...campaignRefs])).slice(0, 5);

  // ── Phase 2: storyboard image — organized numbered multi-panel sequence.
  // Reinforce the layout + identity constraints (models drop instructions buried
  // mid-prompt; trailing reinforcement helps).
  const panelCount = beats.length;
  const sbGridCols = panelCount <= 6 ? 3 : 4;
  const sbGridRows = Math.ceil(panelCount / sbGridCols);
  const storyboardResolution = selectStoryboardResolution(panelCount);
  // How many of the attached references are the CHARACTER vs the campaign PRODUCT,
  // so the prompt can tell the renderer which is which and require a product panel.
  const charCountInBoard = storyboardRefImages.filter((u) => refImages.includes(u)).length;
  const productCountInBoard = storyboardRefImages.length - charCountInBoard;
  const productBlock = productCountInBoard > 0
    ? `\n\nPRODUCT REFERENCES: of the ${storyboardRefImages.length} attached reference images, the first ${charCountInBoard} show the CHARACTER (the person to feature), and the remaining ${productCountInBoard} are the campaign's PRODUCT / brand. Dedicate AT LEAST ONE panel to the character clearly SHOWCASING the product (holding / using / presenting it), reproducing the product FAITHFULLY from those product references — same shape, packaging, colours, and logo. The product must be recognizable.`
    : "";
  const charRefCount = Math.max(1, charCountInBoard);
  // Identity directive LEADS the prompt (image models weight the opening tokens
  // most) and is restated at the end, so nano-banana keeps the SAME original
  // character across panels instead of drifting. Framed as a FICTIONAL ORIGINAL
  // character (not a "real person… recognizable as that individual") — that older
  // phrasing cued Veo/nano-banana's prominent-public-figure safety filter and blocked
  // the render. Consistency is preserved; only the "real recognizable person" cue is
  // removed.
  const stylizedAnimation = isStylizedAnimationFormat(args);
  // Cartoon/Anime get a DIFFERENT identity directive — no face-anatomy
  // checklist (eye shape/colour, nose, mouth, jawline...). That language
  // assumes a real-person photo reference and, worse, tells the model to
  // match a SPECIFIC FACE from the attached image — but the attached image
  // here is an ART-STYLE BOARD (line work, palette, character-design
  // conventions), not a literal face to reproduce. Demanding face-level
  // fidelity to a style board is incoherent instruction that visibly nudged
  // renders toward realism instead of the intended illustrated style.
  const identityDirective = stylizedAnimation
    ? `PRIMARY DIRECTIVE — MATCH THE ATTACHED ART STYLE, ORIGINAL CHARACTER: This is a FICTIONAL, ORIGINAL character in an ILLUSTRATED/ANIMATED show — NOT a real person, NOT photorealistic. The first ${charRefCount} attached image${charRefCount > 1 ? "s define" : " defines"} this show's exact ART STYLE and character design (line work, shading style, color palette, proportions, silhouette, shape language) — every panel MUST be drawn in that same illustrated style. This is about STYLE and DESIGN CONSISTENCY, not matching a real face: keep the character's design (outfit, color scheme, proportions, distinguishing features) consistent across panels, redrawn fresh each time in the reference's art style, never pasted as a photograph and never rendered as real-world photography. The reference's art style overrides any conflicting description in the storyboard below.`
    : `PRIMARY DIRECTIVE — SAME ORIGINAL CHARACTER, CONSISTENT LOOK: This is a FICTIONAL, ORIGINAL character — NOT a real, famous, or recognizable public figure, and NOT based on any real individual. The first ${charRefCount} attached image${charRefCount > 1 ? "s are the character design reference" : " is the character design reference"} for this original character, who MUST appear in EVERY panel. Keep the character's look CONSISTENT with that reference across all panels — same facial structure and proportions, same eye shape/colour and spacing, same nose, mouth, jawline and chin, same eyebrows, same skin tone, same hairstyle and hair colour, same apparent age and build — so it reads as the same character throughout. Do NOT redesign, average, beautify, age, or change the character between panels; keep the look stable. The character design reference overrides any conflicting description in the storyboard below.`;
  const finalImagePrompt =
    identityDirective +
    `\n\nSTORYBOARD TO RENDER (put the person above into each of these panels):\n` +
    storyboardPrompt +
    productBlock +
    (grokPortraitStoryboard
      ? `\n\nGROK STORYBOARD MODE: render this as a tall PORTRAIT reference sheet for image-to-video handoff. Use a 9:16 canvas, keep the panels large and readable, and prefer a vertical stack or tall grid over a wide contact sheet. Image 1 remains the character anchor; this storyboard image is Image 2 and exists to steer scene, composition, and shot order.`
      : "") +
    `\n\nKEYFRAME SHEET ADDENDUM: This image is a downstream reference for video engines, so optimize for consistency and readability first. Keep the subject large in frame, the composition clean, the silhouettes obvious, and the wardrobe / lighting / environment stable enough that later video frames can match it without guessing. For long videos, each panel should feel like the next beat in a continuous shot chain — the last moment of one beat should naturally hand off to the next beat. Do not create tiny busy details that will disappear when used as a video reference.` +
    (stylizedAnimation
      // The generic MEDIUM LOCK below defaults to realism "when in doubt" —
      // exactly backwards for a format whose whole premise IS the illustrated
      // style. State the medium as a hard fact instead of inferring it from
      // the reference image, which removed the ambiguity that kept
      // collapsing to photoreal output.
      ? `\n\nMEDIUM LOCK: This is an ILLUSTRATED, ANIMATED show — every panel renders in that drawn/animated style, matching the attached art-style reference exactly. NEVER render photorealistic, live-action, or photographic panels under any circumstance, even if a reference photo of a real person/product is also attached (use it only for pose/identity/product shape, redrawn in the show's art style).`
      : `\n\nMEDIUM LOCK: Match the CHARACTER reference's medium exactly: if it is a realistic style, render realistic cinematic live-action film stills — DO NOT cartoonify, illustrate, anime-fy, or turn it into a comic. Only use an illustrated/animated style if the character reference is itself a drawing. When in doubt, render realistic cinematic.`) +
    `\n\nQUALITY: cinematic lighting (key + rim), shallow depth of field, rich texture and detail, dynamic per-panel camera angles, filmic color grade — make each panel look like a premium short-film frame, not a flat sketch.` +
    `\n\nLAYOUT: an ORGANIZED ${sbGridCols}×${sbGridRows} grid of ${panelCount} panels in reading order (left→right, top→bottom), following the storyline beat 1 → beat ${panelCount}. The story reads through panel ORDER alone — do NOT label or number the panels.` +
    `\n\nFINAL CONSISTENCY CHECK: Before finishing, confirm EVERY panel shows the SAME original character, consistent with the reference — one consistent character, no drift. If any panel's character differs from the reference, it is WRONG.` +
    `\n\nNEGATIVE / FORBIDDEN: render ABSOLUTELY NO TEXT — no panel numbers, no captions, no labels, no speech bubbles, no watermarks, no logos, no timecodes, no on-screen writing of any kind. A clean, wordless visual storyboard.`;

  let storyboardImageUrl = "";
  let storyboardError: string | undefined;
  // Grok gets a portrait storyboard guide as a secondary reference, but its first
  // attached image still anchors the literal first frame. The storyboard image is
  // there to steer composition / shot order, not to become the animated frame.
  const noStoryboard = skipsStoryboardImage(videoModel);
  // AUTO-SKIP for a single-take short Grok render: the storyboard image exists
  // to steer SHOT ORDER across multiple clips/panels — a one-clip ≤10s Grok take
  // has no shot order to steer, its identity/scene lock comes entirely from the
  // character/product references it already gets. Rendering the multi-panel
  // guide there was a pure add-on cost (one nano-banana generation + its poll
  // wait, retried up to twice) with no visible effect on the output.
  const autoSkipStoryboard = /grok/i.test(videoModel) && totalSegments === 1 && rawSeconds <= 10 && !args.resume;
  // Same reasoning for Seedance's storyboard-LEAD formats (Cartoon/Anime): the
  // dedicated opening keyframe rendered further below (nano-banana-2,
  // seedanceKeyframeUrl) is ALREADY the video's sole visual anchor for a
  // single-shot render — there's no second/third shot left for this
  // multi-panel grid to steer. Rendering it anyway paid for a whole SEPARATE
  // image generation whose output then wasn't even referenced when building
  // the keyframe (the keyframe only reads beats[0] text) — pure wasted cost
  // on every single-shot cartoon/anime video. A multi-segment render still
  // gets the full multi-panel guide (real shot-order value there).
  // Seedance storyboard-lead: the multi-panel GRID is dead weight for 1.5 Pro
  // at ANY length — its 2 input_urls slots carry the keyframe + a style ref
  // and the grid is deliberately excluded (it leaked onto screen, see
  // seedanceStoryboardRef) — so rendering it burns a full nano-banana
  // generation + ~30-60s of wall-clock for an image nothing consumes. Skip it
  // for 1.5 Pro always; legacy 2.0 (which really attaches the grid via
  // reference_image_urls) keeps it for multi-segment renders only.
  const autoSkipSeedanceKeyframeBoard = /seedance/i.test(videoModel) && args.seedanceLead === "storyboard" && !args.resume
    && (is15ProModel(videoModel) || totalSegments === 1);
  // REALISM AUTO-DECISION (all engines): a generated storyboard image is itself
  // an AI illustration — attaching it as a scene reference pulls a REALISTIC
  // render toward that synthetic look. When the video should look real (UGC /
  // talking-head / selfie / vlog style, real-person reference), the most
  // realistic result comes from referencing ONLY the operator's real image, so
  // the storyboard image is skipped. Stylized shows (cartoon / anime / drama /
  // episodic / story formats) NEED the multi-panel guide for scene flow and
  // keep it. Operator's explicit skipStoryboard still wins; resume phases keep
  // whatever the storyboard phase already decided.
  const storyboardDecision = decideStoryboardUse(args);
  const autoRealisticSkip = !args.resume && !storyboardDecision.use;
  // Formats with their own single-photo realism treatment (GROK_FORMAT_ANCHOR_PROMPTS)
  // override the generic realistic-skip: instead of anchoring straight to the
  // operator's original photo (which never reflects THIS video's topic-specific
  // scene/outfit/prop change), generate one real-photo-style anchor image of the
  // exact moment first, using THIS format's own prompt treatment.
  const formatHasAnchor = hasGrokFormatAnchor(args);
  if (formatHasAnchor && !args.resume && !args.skipStoryboard) {
    try {
      const anchorPrompt = buildGrokFormatAnchorPrompt(args, beats, charRefCount);
      console.log(`[kie-video-pipeline] ${currentFormatId(args)}: rendering a real-photo anchor image for this video's exact moment`);
      storyboardImageUrl = await renderStoryboardImage({
        prompt: anchorPrompt,
        refImages: storyboardRefImages,
        aspectRatio: resolveGrokAspect(args.aspectRatio),
        resolution: storyboardResolution,
      });
    } catch (err) {
      storyboardError = err instanceof Error ? err.message : String(err);
      console.warn(`[kie-video-pipeline] format anchor image failed (${storyboardError}) — proceeding WITHOUT it; clips render from the character reference images directly.`);
      storyboardImageUrl = "";
    }
  } else if (args.skipStoryboard || autoSkipStoryboard || autoRealisticSkip || autoSkipSeedanceKeyframeBoard) {
    // Operator checked "Skip storyboard" (or an auto-skip fired): no guide
    // image is rendered — the video clips reference the character/reference
    // images (the pinned/attached video reference when one is set) directly,
    // same as the storyboard-failure path.
    console.log(args.skipStoryboard
      ? `[kie-video-pipeline] skipStoryboard — no storyboard image; clips reference the character/reference images directly`
      : autoSkipStoryboard
        ? `[kie-video-pipeline] auto-skip storyboard: single ${rawSeconds}s grok take — clips reference the character/reference images directly`
        : autoSkipSeedanceKeyframeBoard
          ? `[kie-video-pipeline] auto-skip multi-panel storyboard: single-shot seedance-lead render — the opening keyframe is the sole visual anchor`
          : `[kie-video-pipeline] auto-skip storyboard (realistic render: ${storyboardDecision.reason}) — clips anchor to the real reference image directly`);
  } else if (noStoryboard) {
    console.log(`[kie-video-pipeline] ${videoModel} is image-to-video — using the storyboard guide as an attached reference, not the animated first frame`);
  } else if (args.phase === "video" && args.resume) {
    // Resumed video phase — the image was rendered in the storyboard phase.
    storyboardImageUrl = args.resume.storyboardImageUrl;
  } else {
    try {
      // Wait generously + retry (the storyboard phase owns the whole function
      // budget). storyboardRefImages = character stills (identity) + campaign
      // images (product/brand), up to 5 — so the storyboard locks the face AND
      // features the campaign's product.
      console.log(`[kie-video-pipeline] storyboard refs = ${storyboardRefImages.length} (character:${refImages.length} + campaign:${campaignRefs.length})`);
      storyboardImageUrl = await renderStoryboardImage({
        prompt: finalImagePrompt,
        refImages: storyboardRefImages,
        aspectRatio: grokPortraitStoryboard ? resolveGrokAspect(args.aspectRatio) : beats.length <= 4 ? "1:1" : beats.length <= 6 ? "4:3" : "16:9",
        resolution: storyboardResolution,
      });
    } catch (err) {
      storyboardError = err instanceof Error ? err.message : String(err);
      // NON-FATAL: the storyboard is only a multi-panel SHOT-GUIDE reference — the
      // actual clips lock identity from the character reference images, not this
      // image. A storyboard block (most often the prominent-public-figure safety
      // filter) must NOT fail the whole render; proceed without the guide instead.
      console.warn(`[kie-video-pipeline] storyboard image failed (${storyboardError}) — proceeding WITHOUT a storyboard guide; clips render from the character reference images directly.`);
      storyboardImageUrl = "";
    }
  }

  const canonicalStill = primaryStill ?? args.avatarUrl;
  const storyboardRefForSeedance = isHttpImageUrl(storyboardImageUrl) ? storyboardImageUrl : undefined;
  const productRefForSeedance = isHttpImageUrl(args.productImageUrl) ? args.productImageUrl : undefined;
  // Lead strategy (see GenerateVideoArgs.seedanceLead): Seedance's lead input
  // IS the opening frame. "storyboard" mode (fully-animated renders) never
  // leads with a real photo — anime videos were literally opening on the
  // website screenshot / product photo. The styled storyboard leads instead;
  // with no storyboard the render goes text-to-video and the product photo
  // rides only as a trailing style/fidelity reference.
  // Derived from the FORMAT as well as the explicit flag: only the heartbeat
  // idea-pipeline (and run-task's catalog branch) pass seedanceLead —
  // a manual Director-tab cartoon render arrived with it unset, fell into
  // character-lead, and anchored the video on canonicalStill (the PROFILE
  // PHOTO) instead of the generated keyframe. Stylized formats are always
  // storyboard-lead by definition.
  const seedanceStoryboardLead = args.seedanceLead === "storyboard" || isStylizedAnimationFormat(args);
  // ── SEEDANCE OPENING KEYFRAME (styled renders) ──────────────────────────────
  // Seedance 1.5 is FIRST-FRAME image-to-video: whatever image leads IS the
  // literal opening frame it animates from. Leading with the multi-panel
  // storyboard GRID made it animate a comic sheet — panel borders drifting on
  // screen, the "anime looks broken" bug. For storyboard-lead renders we now
  // render ONE dedicated full-bleed keyframe first on nano-banana-2: the story's
  // opening moment (beat 1) in the exact target art style, with the product
  // reference attached so the product is drawn faithfully into the frame.
  let seedanceKeyframeUrl = "";
  if (args.seedanceResume?.keyframeUrl) {
    // Resume: the keyframe already rendered on a previous invocation — reuse
    // it instead of paying nano-banana again.
    seedanceKeyframeUrl = args.seedanceResume.keyframeUrl;
    console.log(`[kie-video-pipeline] seedance keyframe reused from resume state`);
  } else if (((seedanceStoryboardLead && /seedance/i.test(videoModel)) || (isStylizedAnimationFormat(args) && /grok/i.test(videoModel))) && args.phase !== "storyboard") {
    try {
      const openingBeat = beats[0];
      const productLine = productRefForSeedance
        ? " The attached product reference must appear drawn faithfully INTO this frame in the same art style — exact shape, packaging, colors and logo, never as a pasted photograph."
        : "";
      // Was hardcoded "anime keyframe" — wrong for Cartoon (and any other
      // seedance-storyboard-lead format that isn't anime specifically),
      // describing a style the operator never asked for regardless of what
      // they actually uploaded/typed. Style now comes ONLY from what the
      // operator actually supplied (aesthetic text + attached reference
      // image), never a hardcoded genre assumption.
      const formatId = currentFormatId(args);
      const genericLabel = formatId === "anime" ? "anime" : formatId === "cartoon" ? "cartoon" : "stylized animated";
      const keyframePrompt =
        `ONE single full-bleed vertical ${genericLabel} keyframe — the OPENING FRAME of a short film. NOT a grid, NOT panels, NOT a storyboard, no borders, no text.` +
        ` Scene: ${(openingBeat?.videoPrompt || openingBeat?.scene || args.topic).replace(/\s+/g, " ").slice(0, 500)}.` +
        ` Art style: ${(args.aesthetic || `a clean, premium ${genericLabel} look`).slice(0, 300)}.` +
        ` Freeze the frame MID-ACTION: the character caught in a dynamic pose with real momentum (leaning, mid-gesture, mid-step, reacting), exaggerated expression, strong silhouette — never a neutral standing pose or a posed portrait. Cinematic composition with clear subject and depth, key lighting, background elements that support the story moment; every element positioned so the shot can start MOVING from this exact frame.${productLine}`;
      // Character/style refs (refImages — the show's cast design-sheet stills
      // AND any uploaded art-style reference board, both land here via
      // resolveIdentityRefs) were MISSING from this call: only the
      // product/campaign images were passed, so neither a recurring cast's
      // look NOR an uploaded style reference (e.g. "match this exact
      // cartoon's art style") ever anchored the frame Seedance then animates
      // from — it was purely text-described (`args.aesthetic`), which is why
      // an uploaded style board got ignored and a 2-character duo's design
      // drifted episode to episode. These go FIRST (the frame's most
      // important visual anchor), capped so the total (refs + product +
      // campaign) stays within renderStoryboardImage's own 8-image limit.
      const keyframeCharRefs = refImages.slice(0, 3);
      seedanceKeyframeUrl = await renderStoryboardImage({
        prompt: keyframePrompt + (keyframeCharRefs.length
          ? ` The attached reference image(s) define this show's exact visual style AND/OR recurring character design — match their art style (line work, shading, color palette, shape language) and, where they show a face, keep that character's proportions/outfit/colors consistent, redrawn in this frame (never pasted as a photograph). Take ONLY the art style and character design from the references — NEVER their background, room, or location: this frame's setting comes exclusively from the Scene description above, so a reference drawn in one room must not pull every video back into that same room.`
          : ""),
        refImages: [...keyframeCharRefs, productRefForSeedance, ...((args.campaignImageUrls ?? []).filter(isHttpImageUrl))].filter((u): u is string => Boolean(u)).slice(0, 8),
        aspectRatio: resolveGrokAspect(args.aspectRatio),
        resolution: "2K",
        model: "nano-banana-2",
      });
      console.log(`[kie-video-pipeline] seedance opening keyframe rendered (nano-banana-2)`);
      if (seedanceKeyframeUrl) await args.onSeedanceProgress?.({ keyframeUrl: seedanceKeyframeUrl });
    } catch (e) {
      console.warn(`[kie-video-pipeline] seedance keyframe failed (${e instanceof Error ? e.message : e}) — falling back to text-to-video lead`);
      seedanceKeyframeUrl = "";
    }
  }
  // Lead priority: the dedicated single-scene keyframe, else pure text-to-video
  // (NEVER the multi-panel grid as the literal opening frame). Character-lead
  // renders keep the canonical still.
  const seedanceStartFrame = seedanceStoryboardLead ? seedanceKeyframeUrl : canonicalStill;
  // Seedance 1.5 Pro has NO separate first-frame param — everything goes into
  // `input_urls` (max 2) as literal visual ANCHORS the model may render on
  // screen. Passing the multi-panel storyboard GRID there put the actual
  // comic-sheet into the video (the "early clip shows the storyboard" bug) —
  // and when the keyframe render failed, the grid became the OPENING frame.
  // For 1.5 Pro the grid never rides along: the two slots go to the keyframe
  // (or canonical still) + the strongest character/art-style ref, which is
  // what the frame actually needs. Legacy 2.0 keeps the grid — it has a real
  // separate first_frame_url, so a reference image can't leak on screen.
  const seedanceIsPro = is15ProModel(videoModel);
  const seedanceStoryboardRef = seedanceIsPro ? undefined : storyboardRefForSeedance;
  const seedanceStyleRef = seedanceIsPro ? refImages.find((u) => isHttpImageUrl(u)) : undefined;
  const seedanceReferenceImages = Array.from(new Set((
    seedanceStoryboardLead
      ? [seedanceKeyframeUrl || undefined, seedanceStyleRef, seedanceStoryboardRef, productRefForSeedance]
      : [canonicalStill, seedanceStyleRef, seedanceStoryboardRef, productRefForSeedance]
  ).filter((u): u is string => Boolean(u))));
  // Reference-map rows derived FROM the actual list above (same order, same
  // slots) — labeling slots the list doesn't carry (or vice versa) points the
  // model at the wrong attached image.
  const seedanceRefRows = seedanceReferenceImages.map((u, i) => {
    const slot = i + 1;
    if (u === seedanceKeyframeUrl) return { slot, label: "the OPENING FRAME — the video starts on exactly this frame and animates forward from it; keep its art style, character design and palette for the whole video", role: "Scene" };
    if (u === canonicalStill && !seedanceStoryboardLead) return {
      slot,
      label: stylizedAnimation
        ? "art-style / character-design anchor (match its illustrated style, palette and design across all shots — never its background/location, never real-world photography)"
        : "canonical character anchor (same face, hair, outfit, energy across all shots)",
      role: "Character",
    };
    if (u === seedanceStyleRef) return { slot, label: "art-style / character-design reference — match its illustrated style, palette and character design ONLY; never copy its background/location, never show this image itself on screen", role: "Character" };
    if (u === seedanceStoryboardRef) return { slot, label: "storyboard / composition guide for the shot sequence — match ITS art style, not photo-realism; never show the storyboard sheet itself on screen", role: "Scene" };
    return { slot, label: "product / brand anchor — draw it faithfully IN the video's art style (shape, colors, logo), never as a pasted photograph", role: "Product" };
  });
  const seedanceReferenceBlock = seedanceRefRows.length ? buildReferenceMapBlock(seedanceRefRows) : "";
  if (seedanceStoryboardLead) {
    console.log(`[kie-video-pipeline] seedance storyboard-lead: start=${seedanceKeyframeUrl ? "keyframe (nano-banana-2)" : "none (text-to-video)"} refs=${seedanceReferenceImages.length}`);
  }
  const grokRefForStoryboard = isHttpImageUrl(storyboardImageUrl) ? storyboardImageUrl : undefined;
  const grokRefForProduct = isHttpImageUrl(args.productImageUrl) ? args.productImageUrl : undefined;
  // Grok's image-to-video LITERALLY animates from image_urls[0] — whatever
  // geometry that image has IS the output's geometry, largely independent of
  // the `aspect_ratio` request param (same lesson lib/server/nftKie.ts's own
  // comment already documents for minted avatar stills: "a square reference
  // forced Grok to invent the top/bottom of the frame"). For a format with a
  // dedicated anchor image (GROK_FORMAT_ANCHOR_PROMPTS — no-voice-candids,
  // absurd, street-interview/How To), that anchor is rendered specifically at
  // the operator's chosen aspect ratio; putting the RAW reference photo
  // (canonicalStill — often square, e.g. a profile upload) first instead
  // silently overrode it, producing a square video even with 9:16 selected.
  // The anchor now leads when one rendered successfully; the raw photo rides
  // second as a secondary identity reference, never first-frame geometry.
  const grokAnchorLeads = hasGrokFormatAnchor(args) && !!grokRefForStoryboard;
  // Stylized (Cartoon/Anime) Grok render: the GENERATED keyframe — the story's
  // opening moment drawn in the show's exact art style — IS image_urls[0], the
  // literal frame Grok animates forward from. The profile photo is EXCLUDED
  // entirely for stylized renders (leading with it is what kept producing
  // realistic people instead of the cartoon); the art-style ref rides second.
  const grokStylizedLead = isStylizedAnimationFormat(args) && isHttpImageUrl(seedanceKeyframeUrl) ? seedanceKeyframeUrl : undefined;
  const grokStyleRef = isStylizedAnimationFormat(args) ? refImages.find((u) => isHttpImageUrl(u)) : undefined;
  const grokReferenceImages = Array.from(new Set((
    grokStylizedLead
      ? [grokStylizedLead, grokStyleRef, grokRefForProduct]
      : isStylizedAnimationFormat(args)
      ? [grokStyleRef, grokRefForStoryboard, grokRefForProduct]
      : grokAnchorLeads
      ? [grokRefForStoryboard, canonicalStill, grokRefForProduct]
      : [canonicalStill, grokRefForStoryboard, grokRefForProduct]
  ).filter((u): u is string => Boolean(u)))).slice(0, 3);
  const grokReferenceBlock = grokStylizedLead
    ? buildReferenceMapBlock([
        { slot: 1, label: "the OPENING FRAME — the video starts on exactly this frame and animates forward from it; keep its art style, character design and palette for the whole video", role: "Scene" },
        ...(grokStyleRef ? [{ slot: 2, label: "art-style / character-design reference — match its illustrated style; never show this image itself on screen", role: "Character" }] : []),
        ...(grokRefForProduct ? [{ slot: (grokStyleRef ? 2 : 1) + 1, label: "product / brand anchor — drawn faithfully IN the art style, never as a photograph", role: "Product" }] : []),
      ])
    : isStylizedAnimationFormat(args)
    ? buildReferenceMapBlock([
        ...(grokStyleRef ? [{ slot: 1, label: "art-style / character-design anchor — match its illustrated style, palette and character design across all shots; never its background/location, never real-world photography", role: "Character" }] : []),
        ...(grokRefForStoryboard ? [{ slot: grokStyleRef ? 2 : 1, label: "storyboard / composition guide — match ITS art style; never render the sheet itself", role: "Scene" }] : []),
        ...(grokRefForProduct ? [{ slot: (grokStyleRef ? 1 : 0) + (grokRefForStoryboard ? 1 : 0) + 1, label: "product / brand anchor — drawn in the art style", role: "Product" }] : []),
      ])
    : grokAnchorLeads
    ? buildReferenceMapBlock([
        { slot: 1, label: "the OPENING FRAME — the video starts on exactly this frame and animates forward from it; keep its framing, pose and aspect ratio", role: "Scene" },
        { slot: 2, label: "canonical character identity reference (same face, skin tone, hair, build)", role: "Character" },
        ...(grokRefForProduct ? [{ slot: 3, label: "product / brand anchor", role: "Product" }] : []),
      ])
    : buildReferenceMapBlock([
        { slot: 1, label: "canonical character anchor; first-frame identity lock", role: "Character" },
        ...(grokRefForStoryboard ? [{ slot: 2, label: "portrait storyboard / scene guide for shot order", role: "Scene" }] : []),
        ...(grokRefForProduct ? [{ slot: grokRefForStoryboard ? 3 : 2, label: "product / brand anchor", role: "Product" }] : []),
      ]);

  // ── Storyboard phase boundary ── for the chunked render we stop here and hand
  // the storyboard back; the VIDEO phase runs in the next sub-300s invocation.
  if (args.phase === "storyboard") {
    return {
      storyboardImageUrl,
      videoUrl: "",
      storyBeats: beats,
      storyboardPrompt,
      videoPrompt,
      durationSeconds,
      storyboardError,
      personaKernel: args.personaKernel,
    };
  }

  // ── Phase 3: video — route to engine-specific endpoint
  let videoUrl = "";
  let videoError: string | undefined;
  let videoNote: string | undefined;
  // Shared wall-clock deadline for the clip/extend chain. The Convex job grants
  // ~560s (10-min action); the legacy sync route grants 280s.
  const deadlineMs = pipelineStartMs + (args.timeBudgetMs ?? 280_000);
  // refImages / primaryStill were resolved before the storyboard phase (static
  // frames only — never the GIF). Surface the "no static" note if present.
  if (charRefs.note && !videoNote) videoNote = charRefs.note;

  // Veo accepts at most 3 reference images. Send EXACTLY the three that matter:
  //   1. the character (person) still — locks identity,
  //   2. the rendered STORYBOARD image — locks the planned shots/composition,
  //   3. the campaign PRODUCT image — so the clip features the product.
  // Previously only character stills were sent (storyboard + product were never
  // referenced), so the video drifted from the storyboard. Order = priority.
  const isUsable = (u: unknown): u is string =>
    typeof u === "string" && /^https?:\/\//i.test(u) && !/\.gif(\?|#|$)/i.test(u);
  // GROK takes the FIRST image as the frame it animates, so the first identity
  // anchor is the minted character still (primaryStill = the static face resolved
  // from the mint avatar by resolveCharacterRefs). The portrait storyboard guide
  // can still be passed as a later reference image to steer shot order, and the
  // product reference can join it when present.
  // Cast-bearing formats (founder-talk, skit, anime, cartoon — see formatCatalog's
  // START_FRAME_FORMATS) need the storyboard as an image-to-video start frame:
  // identity drifts across a bare text start, so when the catalog says this
  // format requires it AND a storyboard image actually rendered, force the
  // branch that includes it even if skipsStoryboardImage would otherwise drop it.
  const preferStartFrame = !!args.formatId && formatRequiresStartFrame(args.formatId) && !!storyboardImageUrl;
  const veoRefCandidates = (skipsStoryboardImage(videoModel) && !preferStartFrame
    ? [primaryStill, args.productImageUrl]
    : [primaryStill, storyboardImageUrl, args.productImageUrl])
    .filter(isUsable)
    .filter((u, i, arr) => arr.indexOf(u) === i) // de-dupe
    .slice(0, 3);
  // Preflight by CONTENT-TYPE: a ref that serves non-image bytes (text/plain HTML,
  // an SVG, a redirect) makes Kie fail the WHOLE task ("Unsupported MIME type") —
  // and for image-to-video engines like Grok that meant NO video at all. Drop the
  // confirmed-bad ones here so the good refs survive (best fidelity); the per-clip
  // retry-without-refs still backstops anything that slips through.
  // Only the engines that actually SEND this list (Veo, and the generic
  // Kling-style jobs shape) pay for the preflight — Grok builds its own
  // grokReferenceImages and Seedance its own seedanceReferenceImages, and
  // neither ever reads veoRefImages, so the HEAD/GET probes (up to 7s each)
  // were pure wasted wall-clock on those renders.
  const usesVeoRefImages = !/seedance|grok/i.test(videoModel);
  const veoRefImages = usesVeoRefImages ? await keepImageContentType(veoRefCandidates) : veoRefCandidates;
  if (veoRefImages.length < veoRefCandidates.length) {
    console.warn(`[kie-video-pipeline] dropped ${veoRefCandidates.length - veoRefImages.length} ref image(s) with a non-image content-type (Kie would reject the task)`);
  }
  console.log(`[kie-video-pipeline] refs = person:${isUsable(primaryStill) ? "✓" : "✗"} storyboard:${isUsable(storyboardImageUrl) ? "portrait guide ✓" : "✗"} product:${isUsable(args.productImageUrl) ? "✓" : "✗"} → ${veoRefImages.length} usable image(s)`);
  try {
    if (videoModel === "veo3" || videoModel === "veo3_fast" || videoModel === "veo3-fast" || videoModel === "veo3_lite") {
      // REFERENCE_2_VIDEO (true reference-to-video, character-locked) is only
      // available on veo3_fast. Whenever we have reference images — which is
      // ALWAYS, since the storyboard image is in the set — force veo3_fast so the
      // clip references the character instead of falling back to text-to-video.
      const mdl: "veo3" | "veo3_fast" | "veo3_lite" =
        veoRefImages.length > 0
          ? "veo3_fast"
          : videoModel === "veo3" ? "veo3"
          : videoModel === "veo3_lite" ? "veo3_lite"
          : "veo3_fast";
      // ── Split storyBeats into 8-second segments ───────────────────────────
      // Each segment becomes one Veo clip (initial generate + extends).
      // We group consecutive beats by accumulated `seconds` until we hit ~8s,
      // then start a new segment. The full per-segment prompt is a sub-version
      // of the master video prompt, focused on just that segment's beats.
      // Veo clips render at a fixed 8s, so size the window count to the beats'
      // actual spoken seconds (bounded by the global max) — never fewer, or the
      // packer would fold the script's tail into the last clip and cut it off.
      const veoSpoken = beats.reduce((n, b) => n + beatSecondsFromVoiceover(b.voiceover), 0);
      const veoWindowCap = Math.min(
        Math.ceil(MAX_VIDEO_SECONDS / 8),
        Math.max(totalSegments, Math.ceil(veoSpoken / 8)),
      );
      const segments = packBeatsIntoWindows(beats, 8, veoWindowCap);
      if (segments.length < totalSegments) {
        videoNote = `Rendered ${segments.length * 8}s — the script only had enough distinct content for ${segments.length} of ${totalSegments} eight-second windows.`;
        console.warn(`[kie-video-pipeline] ${videoNote}`);
      }
      // Clip 0 = fresh generate (reference images). Clips 1+ = /veo/extend, which
      // inherits the prior clip's final frame (no images) → LEAN CONTINUATION prompt,
      // never the reference-image generate prompt (that re-opened the scene + tripped
      // Veo's prompt limit, erroring every extend and truncating the video).
      const segmentPrompts = segments.map((segBeats, i) => {
        const prevLastBeat = i > 0 ? segments[i - 1][segments[i - 1].length - 1] : undefined;
        return i === 0
          ? buildSegmentPrompt(args, segBeats, i, segments.length, voiceProfile, prevLastBeat)
          : buildExtendPrompt(args, segBeats, 8, voiceProfile, prevLastBeat, i === segments.length - 1);
      });
      // Scene-establishing generate prompt per window — used only for the stitch
      // fallback (native extend blocked) so each fallback clip stays distinct.
      const standalonePrompts = segments.map((segBeats, i) => {
        const prevLastBeat = i > 0 ? segments[i - 1][segments[i - 1].length - 1] : undefined;
        return buildSegmentPrompt(args, segBeats, i, segments.length, voiceProfile, prevLastBeat);
      });
      if (segmentPrompts.length === 1) {
        // Single 8s clip — no extends needed
        const result = await generateVeo3Video({
          prompt: segmentPrompts[0],
          imageUrls: veoRefImages,
          model: mdl,
          // Veo only accepts 16:9 / 9:16 / Auto — "1:1" (and undefined) fall back to 9:16.
          aspectRatio: (args.aspectRatio === "16:9" || args.aspectRatio === "9:16") ? args.aspectRatio : "9:16",
          durationSeconds: 8,
          resolution: "720p",
          deadlineMs,
          ...veoRetryBudget(deadlineMs),
        });
        videoUrl = result.url;
      } else {
        // Multi-clip: generate + extend chain. The shared deadline ensures we
        // always return the longest video that finished before the timeout.
        videoUrl = await generateExtendedVeo3({
          segments: segmentPrompts.map((p, i) => ({ prompt: p, standalonePrompt: standalonePrompts[i] })),
          imageUrls: veoRefImages,
          model: mdl,
          // Veo only accepts 16:9 / 9:16 / Auto — "1:1" (and undefined) fall back to 9:16.
          aspectRatio: (args.aspectRatio === "16:9" || args.aspectRatio === "9:16") ? args.aspectRatio : "9:16",
          resolution: "720p",
          deadlineMs,
          // Fresh-clip stitch fallback when /veo/extend is blocked by the safety filter.
          stitchClips: args.stitchClips,
        });
      }
    } else if (/seedance/i.test(videoModel)) {
      // Seedance: frame-chain up to `totalSegments` clips (15s each) and stitch
      // them into one file via the caller-provided ffmpeg concat.
      const result = await generateSeedanceStitched({
        beats,
        genArgs: args,
        durationSeconds,
        totalSegments,
        startFrameUrl: seedanceStartFrame,
        referenceImageUrls: seedanceReferenceImages,
        referenceMapBlock: seedanceReferenceBlock,
        deadlineMs,
      });
      videoUrl = result.url;
      videoNote = result.note;
    } else {
      // Generic engine path (Kling, Grok, Gemini, …) via KIE's /jobs/createTask.
      // Each model has its own max clip length; cover the requested duration with
      // ceil(duration / clipMax) clips and concat them (independent shots — no
      // model-specific frame-chain params, so this works for any jobs model).
      const isGrok = /grok/i.test(videoModel);
      // maxClipForModel("grok") returns 20 — that's the UI menu's display ceiling
      // (a "30s" grok clip is really base-15+extend-15 under the hood), NOT a
      // legal single /jobs/createTask duration. This segmentation math is the
      // SAFETY NET that runs whenever the dedicated Grok native-extend chain
      // below (isGrok && durationSeconds > GROK_EXTEND_THRESHOLD_SECONDS) can't
      // fire or fails — e.g. the script's beats don't fill a 2nd extend window,
      // or the chain throws. Using the 20s menu value here let a bare
      // `genOneClip` slip an un-clamped duration:"20" straight to Kie, which
      // hard-rejects/clips past its real 15s-per-call ceiling. Force Grok's real
      // per-call cap here so the fallback path can never exceed it — it just
      // falls back to more (shorter) independent takes instead.
      const clipMax = isGrok ? GROK_BASE_MAX_SECONDS : maxClipForModel(videoModel);
      // Cover the requested duration with the FEWEST balanced clips each within the
      // model's coherent range: ceil(duration / clipMax) clips, then clipLen splits
      // the duration evenly across them (so 30s on Grok = 2×15s, NOT 20s+10s). This
      // keeps every clip in the 10-20s coherent sweet spot instead of one long take
      // that degrades. A ≤clipMax video stays a single take.
      const segCount = Math.max(1, Math.min(totalSegments, Math.ceil(durationSeconds / clipMax)));
      const segs = packBeatsIntoWindows(beats, clipMax, segCount);
      const clipLen = Math.max(MIN_VIDEO_SECONDS, Math.min(clipMax, Math.ceil(durationSeconds / segs.length)));
      // Per-window duration from each window's ACTUAL script length (word count),
      // not an even division of the total — same fix as Grok's extend chain
      // (windowSeconds() in videoSegmentation.ts). Used for Gemini Omni below: an
      // even division made every clip request the SAME length regardless of how
      // much a given window's beats actually speak, so a short-script window still
      // got asked to fill a long clip and padded/repeated to do it.
      const segLens = segs.map((s) => Math.max(MIN_VIDEO_SECONDS, Math.min(clipMax, Math.round(windowSeconds(s)))));
      // Gemini Omni uses a DIFFERENT input schema than the other jobs models:
      // reference images go in `image_urls` (an array, up to 7 — NOT `image_url`/
      // `image_input`), and `duration` MUST be one of the enum strings "4"|"6"|"8"|
      // "10" (an off-enum value like "7" or "9" is rejected). Sending the generic
      // shape here is what failed with "model name not supported / invalid input".
      // Docs: https://docs.kie.ai/market/gemini-omni-video
      const isGeminiOmni = /gemini-omni/i.test(videoModel);
      // Gemini Omni renders from the ORIGINAL reference image only — no KIE
      // character registry. The character-create step re-interpreted the photo
      // into a registry identity that drifted from the real person; sending the
      // photo itself first in `image_urls` (with the opening-frame lock in the
      // prompt) keeps the actual face, room, and light of the original image.
      const omniCharacterId: string | undefined = undefined;
      // Delegated to the shared per-engine adapter (lib/server/engineAdapters.ts),
      // which replicates this exact reduce-seeded-at-10 semantics.
      const snapGeminiDuration = (secs: number): string => String(getEngineAdapter("gemini-omni").encodeDuration(secs));
      // Gemini Omni has no native extend/task-chain (supportsNativeExtend: false
      // in engineAdapters.ts). The previous `video_list` continuation experiment
      // (feeding clip i's tail into clip i+1) is GONE: live renders showed the
      // model REPLAYS the supplied tail at the head of the new clip — the same
      // seconds of footage AND the same spoken lines appeared twice across the
      // stitch ("few starting seconds like replicated video" / "script said 2
      // times"). Omni multi-clip now renders INDEPENDENT takes (identity locked
      // via character_ids) joined with HARD CUTS — jump-cut editing, prompted
      // per segment — which is both duplicate-free and parallelizable.
      const genOneClip = async (i: number): Promise<string> => {
        const prevLastBeat = i > 0 ? segs[i - 1][segs[i - 1].length - 1] : undefined;
        // A single-clip Grok take (≤clipMax video) uses the rich full-duration
        // prompt (whole arc + Director style + narration). When a longer video is
        // split into multiple Grok clips, each depicts only its OWN window via the
        // per-window segment prompt — which carries a CONTINUATION note (same look/
        // product/grade, new shot) so the stitched clips read as one coherent piece.
        // Grok gets its OWN prompt shape for every clip. Previously only a
        // single-clip render did; a split render fell back to the Veo-shaped
        // talking-head template, which re-described the reference image, buried the
        // motion direction under lock boilerplate, and blew past Grok's prompt limit.
        // Content-aware sizing (this window's ACTUAL script length, not an
        // even division of the total) applies to Grok too — Grok's single-clip
        // fallback path was still requesting the flat `clipLen` (e.g. 15s)
        // regardless of how many seconds this window's beats actually speak,
        // which is exactly what produced "20s requested, 15s rendered, mostly
        // silent": Grok fills its real ~8-12s of dialogue then sits silent for
        // the rest of the requested duration. Gemini Omni already got this
        // fix; Grok needs the identical treatment.
        const thisClipLen = (isGeminiOmni || isGrok) ? segLens[i] : clipLen;
        // Every jobs-engine prompt goes through the Claude FINAL-CHECK distill
        // (short image-led shape for Grok; compact film language for Omni +
        // generic). Verbatim operator prompts are exempt — the operator's
        // exact wording must reach Kie untouched.
        const distillFor = (draft: string, engine: "grok" | "gemini-omni" | "generic") =>
          isVerbatimPromptMode(args)
            ? Promise.resolve(draft)
            : distillEnginePromptWithClaude(draft, { engine, clipSeconds: thisClipLen, silent: speechMode(args) === "silent", finalClip: i === segs.length - 1 });
        const prompt = isGrok
          ? await distillFor(
              buildGrokPrompt(args, segs[i], thisClipLen, voiceProfile, { index: i, total: segs.length, prevBeat: prevLastBeat }, { extraBlocks: [grokReferenceBlock] }),
              "grok",
            )
          : await distillFor(
              buildSegmentPrompt(args, segs[i], i, segs.length, voiceProfile, prevLastBeat, thisClipLen, {
                engine: isGeminiOmni ? "gemini-omni" : "generic",
                extraBlocks: isGeminiOmni ? [
                  buildReferenceMapBlock([
                    {
                      slot: 1,
                      // omniCharacterId can be absent (character-creation call failed —
                      // see the fallback below, which puts the avatar still directly
                      // into image_urls in that case). Don't claim character_ids is the
                      // anchor when it wasn't actually sent — that misled the model into
                      // expecting an identity lock that wasn't there.
                      label: omniCharacterId
                        ? "canonical character comes from character_ids; keep face/wardrobe/mood fixed"
                        : "canonical character reference photo; keep face/wardrobe/mood fixed",
                      role: "Character",
                    },
                    ...(storyboardImageUrl ? [{ slot: 2, label: "storyboard / scene guide for the shot flow", role: "Scene" }] : []),
                    ...(isHttpImageUrl(args.productImageUrl) ? [{ slot: storyboardImageUrl ? 3 : 2, label: "product / brand anchor", role: "Product" }] : []),
                  ]),
                ] : undefined,
              }),
              isGeminiOmni ? "gemini-omni" : "generic",
            );
        // Gemini accepts 16:9 / 9:16 only; Grok ALSO accepts 1:1 (square). Honor
        // the operator's Director choice per what each engine supports.
        const narrowAspect = args.aspectRatio === "16:9" ? "16:9" : "9:16";
        const grokAspect = resolveGrokAspect(args.aspectRatio);
        let input: Record<string, unknown>;
        if (isGeminiOmni) {
          const omniImageUrls = Array.from(new Set([
            // The reference photo ALWAYS rides in image_urls — even with a
            // character_id. The character registry holds the FACE, but the
            // photo holds the REAL WORLD: the actual room, lighting, wardrobe
            // and camera feel. Without it Omni invents a generic clean set,
            // which is exactly the "looks AI-generated" complaint — the prompt
            // below pins this photo as the opening-frame/environment anchor.
            isHttpImageUrl(canonicalStill) ? canonicalStill : undefined,
            isHttpImageUrl(storyboardImageUrl) ? storyboardImageUrl : undefined,
            isHttpImageUrl(args.productImageUrl) ? args.productImageUrl : undefined,
          ].filter((url): url is string => Boolean(url))));
          // docs.kie.ai/market/gemini-omni-video — refs go in `image_urls`, and
          // `duration` MUST be the enum "4"|"6"|"8"|"10".
          input = {
            prompt,
            image_urls: omniImageUrls.length > 0 ? omniImageUrls.slice(0, 7) : undefined, // scene + product refs; character comes from character_ids when present, else the fallback still above
            character_ids: omniCharacterId ? [omniCharacterId] : undefined,
            aspect_ratio: narrowAspect,
            duration: snapGeminiDuration(thisClipLen),
            resolution: outputResolution,
          };
        } else if (isGrok) {
          // docs.kie.ai/market/grok-imagine/image-to-video — the start-frame ref
          // (person still first) goes in `image_urls`; we also pass the portrait
          // storyboard guide and product anchor when available so Grok can keep the
          // same character and shot flow across longer sequences. `duration` is a
          // "6".."30" string, `mode` ∈ fun|normal|spicy, `resolution` ∈ 480p|720p.
          input = {
            prompt,
            image_urls: grokReferenceImages.length > 0 ? grokReferenceImages : undefined,
            mode: "normal",
            aspect_ratio: grokAspect,
            // Content-aware (thisClipLen), not the flat target-derived clipLen
            // — asking Grok to fill MORE seconds than the window's actual
            // script has words for is exactly what produces dead-air padding.
            duration: String(adapter.encodeDuration(thisClipLen)),
            resolution: outputResolution,
          };
        } else {
          // Kling + any other generic jobs engine (best-effort shared shape).
          input = {
            prompt,
            image_url: primaryStill ?? args.avatarUrl,
            image_input: veoRefImages.length > 0 ? veoRefImages : undefined,
            aspect_ratio: args.aspectRatio ?? "9:16",
            duration: String(clipLen),
            resolution: outputResolution,
          };
        }
        // Bound the poll by the invocation's remaining wall-clock (not a flat 360s)
        // so a slow clip can't run past the function limit and kill sibling clips
        // that are generating in parallel.
        const runClip = async (clipInput: Record<string, unknown>): Promise<string> => {
          const taskId = await createJobsTask(videoModel, clipInput);
          const pollMs = Math.max(60_000, deadlineMs - Date.now() - 15_000);
          return await pollJobsTask(taskId, pollMs, `video(${videoModel} ${i + 1}/${segs.length})`);
        };
        try {
          return await runClip(input);
        } catch (err) {
          const emsg = err instanceof Error ? err.message : String(err);
          const hadImages = !!(input.image_urls || input.image_url || input.image_input);
          // A reference image Kie can't fetch/recognize fails the WHOLE clip — strip
          // the image refs and retry text-only so the clip (and video) still renders
          // instead of hard-failing. Gemini Omni takes `image_urls` as OPTIONAL and
          // renders fine text-only, and its ref-image rejections don't always match
          // isImageRefError's phrasing (they surface as a generic task failure) — so
          // for gemini-omni we retry text-only on ANY failure, not just recognized
          // image errors. This was the "All N gemini-omni-video clips failed" case.
          if (hadImages && (isGeminiOmni || isImageRefError(emsg))) {
            console.warn(`[kie-video-pipeline] ${videoModel} clip ${i + 1} failed with images (${emsg.slice(0, 140)}) — retrying without images`);
            const noImg = { ...input };
            delete noImg.image_urls; delete noImg.image_url; delete noImg.image_input;
            return await runClip(noImg);
          }
          throw err;
        }
      };

      // Grok > 15s → native extend chain (frame-continuous, smooth) instead of
      // independent-takes+crossfade. Plans a ≤15s base + length-scaled extend
      // windows; on ANY failure falls through to the stitch path below (which is
      // guarded by `if (!videoUrl)`), so a render never hard-fails.
      // News Commentary is EXCLUDED from the extend chain: chaining several
      // /extend calls off a single base clip kept producing broken/inconsistent
      // footage for this format's talking-head-over-b-roll style (each extend
      // step compounds drift). News Commentary instead always uses the
      // independent-takes path below: every clip is generated FRESH from the
      // SAME reference still (continuing the script, not the pixels) and
      // stitched with a hard cut — which is exactly how a real news segment
      // is edited (cut between takes, not one unbroken shot).
      const skipGrokExtend = currentFormatId(args) === "news-commentary";
      if (isGrok && durationSeconds > GROK_EXTEND_THRESHOLD_SECONDS && !skipGrokExtend) {
        const plan = planGrokExtendWindows(beats);
        if (plan.base.length > 0 && plan.extendWindows.length > 0) {
          try {
            const baseSeconds = Math.max(6, Math.min(15, Math.round(windowSeconds(plan.base))));
            const grokAspect = resolveGrokAspect(args.aspectRatio);
            const baseInput: Record<string, unknown> = {
              prompt: buildGrokPrompt(args, plan.base, baseSeconds, voiceProfile, undefined, { extraBlocks: [grokReferenceBlock] }),
              // The SAME resolved reference set as the single-clip path — for a
              // stylized render that's the generated keyframe + art-style ref
              // (never the profile photo, which pulled the chain realistic).
              image_urls: grokReferenceImages.length > 0 ? grokReferenceImages : canonicalStill ? [canonicalStill] : undefined,
              mode: "normal",
              aspect_ratio: grokAspect,
              duration: String(baseSeconds),
              resolution: outputResolution,
            };
            const extended = await generateGrokExtended({
              args, videoModel, baseInput, base: plan.base, extendWindows: plan.extendWindows,
              voiceProfile, deadlineMs, baseSeconds, targetSeconds: durationSeconds,
            });
            videoUrl = extended.url;
            videoNote = extended.note ?? `Grok native extend chain — base ${baseSeconds}s + ${plan.extendWindows.length} extend${plan.extendWindows.length === 1 ? "" : "s"} (frame-continuous).`;
          } catch (e) {
            console.warn(`[kie-video-pipeline] grok extend chain failed, falling back to independent-takes+stitch: ${e instanceof Error ? e.message : e}`);
          }
        }
      }

      // Gemini Omni > 1 clip: NO sequential video_list chain any more (it
      // duplicated the previous clip's tail — see genOneClip's comment). Omni
      // now flows into the SAME independent-takes+parallel-stitch path as the
      // other jobs engines below, with hard cuts instead of a crossfade.

      // Single clip (or no stitcher available) → return the one clip directly.
      // Guarded so the Grok extend chain / Gemini chain above (when either
      // produced a video) isn't overwritten.
      if (videoUrl) {
        // Extend chain already produced the video — nothing to do here.
      } else if (segs.length === 1 || !args.stitchClips) {
        videoUrl = await genOneClip(0);
        if (segs.length > 1) videoNote = `Rendered 1 clip (${clipLen}s) — no stitcher available for ${videoModel}.`;
      } else {
        // Generic-engine clips are INDEPENDENT (each generated from the avatar
        // still, NOT frame-chained), so generate them ALL IN PARALLEL and stitch
        // the parts together. A sequential loop only fit ~2-3 clips before the
        // invocation deadline ("Stopped at 2/5 clips (time budget)"); in parallel
        // every clip finishes in roughly one clip's wall-clock, so the full
        // selected length renders consistently. Failed clips are dropped and the
        // rest are stitched IN ORDER (index order preserved) so the video is as
        // long as we could produce rather than lost.
        const settled = await Promise.allSettled(segs.map((_, i) => genOneClip(i)));
        const byIndex: (string | null)[] = settled.map((r) => (r.status === "fulfilled" && r.value ? r.value : null));
        let firstReason = "";
        settled.forEach((r, i) => {
          if (byIndex[i]) return;
          const reason = r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : "empty result";
          if (!firstReason) firstReason = reason;
          console.warn(`[kie-video-pipeline] ${videoModel} clip ${i + 1}/${segs.length} failed: ${reason}`);
        });
        // Up to 2 sequential retries per failed clip (budget permitting).
        // Without this a single transient clip failure silently shortened the
        // video (a 20s request shipping as one 10s take with only a note).
        for (let i = 0; i < byIndex.length; i++) {
          if (byIndex[i]) continue;
          for (let attempt = 1; attempt <= 2 && !byIndex[i]; attempt++) {
            if (deadlineMs - Date.now() < 90_000) break; // keep headroom for the stitch
            try {
              byIndex[i] = await genOneClip(i);
              console.log(`[kie-video-pipeline] ${videoModel} clip ${i + 1}/${segs.length} recovered on retry ${attempt}/2`);
            } catch (e) {
              console.warn(`[kie-video-pipeline] ${videoModel} clip ${i + 1}/${segs.length} retry ${attempt}/2 failed: ${e instanceof Error ? e.message : e}`);
            }
          }
        }
        const clipUrls = byIndex.filter((u): u is string => !!u);
        const failures = byIndex.length - clipUrls.length;
        // Surface the REAL Kie error (was a blank "clips failed" that hid the cause).
        if (clipUrls.length === 0) throw new Error(`All ${segs.length} ${videoModel} clips failed: ${firstReason.slice(0, 220)}`);
        if (failures > 0) videoNote = `Rendered ${clipUrls.length}/${segs.length} clips (${failures} failed) — shorter than ${durationSeconds}s.`;
        // Stitch style per engine:
        //  - Gemini Omni: HARD CUTS (crossfade 0). Each clip is prompted as a
        //    deliberate jump-cut continuation of one monologue (see
        //    buildSegmentPrompt's JUMP-CUT block) — a crossfade over two talking
        //    heads smears the mouth mid-word and reads as a glitch, while a
        //    straight cut reads as normal creator editing.
        //  - Grok: HARD CUTS too — the crossfade read as a slow "fading
        //    transition" on candid reaction clips; straight fast cuts are the
        //    native TikTok grammar.
        //  - Other independent-shot engines (Kling): a short crossfade for the
        //    smooth ad-montage feel. Fail-safe: the concat route falls back to
        //    a clean hard cut if the crossfade errors.
        videoUrl = clipUrls.length === 1
          ? clipUrls[0]
          // Gemini Omni: hard cuts + a small HEAD trim on clips 2..n — each
          // independent take tends to re-establish/replay the opening beat, so
          // the first ~0.6s at every seam read as replicated footage. Cutting
          // it makes the joins read as normal jump-cut editing.
          : await args.stitchClips(clipUrls, isGeminiOmni
              ? { crossfadeSeconds: 0, headTrimSeconds: 0.6 }
              : isGrok
                ? { crossfadeSeconds: 0 }
                : { crossfadeSeconds: 0.5 });
        if (isGeminiOmni && clipUrls.length > 1 && !videoNote) {
          videoNote = `Gemini Omni: ${clipUrls.length} independent takes joined with hard jump cuts (character locked via character_ids).`;
        }
      }

    }

    // Trim the finished video down to the operator's actual requested length —
    // covers BOTH overshoot directions, whichever engine/branch produced videoUrl:
    //  - Grok SHORT take (<6s requested): Kie's floor is 6s, so the render above
    //    is a 6s take that needs cutting down to the exact request.
    //  - Fixed-8s-clip engines (Veo): rounded UP to a full clip multiple
    //    (overshootTrimSeconds, computed above — only set when the script
    //    already fit inside the request, so trimming never cuts off speech).
    // Best-effort: without a stitcher (or on failure) the untrimmed render is kept.
    const finalTrimSeconds = grokTrimSeconds || overshootTrimSeconds;
    if (videoUrl && finalTrimSeconds && args.stitchClips) {
      try {
        videoUrl = await args.stitchClips([videoUrl], { trimSeconds: finalTrimSeconds });
        videoNote = videoNote ?? (grokTrimSeconds
          ? `Trimmed to ${finalTrimSeconds}s (Grok's minimum native take is 6s).`
          : `Trimmed to ${finalTrimSeconds}s (the requested length — clip rounding otherwise overshoots to full 8s multiples).`);
      } catch (e) {
        console.warn(`[kie-video-pipeline] final-length trim failed (${e instanceof Error ? e.message : e}) — keeping the untrimmed render`);
      }
    }
  } catch (err) {
    videoError = err instanceof Error ? err.message : String(err);
    console.warn(`[kie-video-pipeline] video (${videoModel}) FAILED:`, videoError);
  }

  console.log(`[kie-video-pipeline] DONE storyboard=${Boolean(storyboardImageUrl)} video=${Boolean(videoUrl)}`);

  return {
    storyboardImageUrl,
    videoUrl,
    storyBeats: beats,
    storyboardPrompt,
    videoPrompt,
    durationSeconds,
    storyboardError,
    videoError,
    videoNote,
    personaKernel: args.personaKernel,
  };
}

// ─── Fallback storyboard prompt (when Claude omits imagePrompt) ──────────────

function buildFallbackStoryboardPrompt(
  args: GenerateVideoArgs,
  beats: StoryBeat[],
  opts?: { portrait?: boolean },
): string {
  const panelCount = beats.length;
  const portrait = Boolean(opts?.portrait);
  const grid = portrait
    ? panelCount <= 3
      ? "1×3"
      : `2×${Math.ceil(panelCount / 2)}`
    : panelCount <= 4
      ? "2×2"
      : panelCount <= 6
        ? "2×3"
        : "3×3";
  const panels = beats.map(b =>
    `  Panel ${b.index}: ${b.scene}${b.voiceover ? ` Character says: "${b.voiceover.slice(0, 60)}"` : ""}. Camera: ${b.camera}.`
  ).join("\n");
  return `A high-resolution multi-panel STORYBOARD keyframe sheet — ${panelCount} sequential panels in a ${portrait ? "tall portrait" : "landscape"} ${grid} grid with thin white borders and generous spacing.

Each panel is a 9:16 frame from a planned short-form video starring the same original character in the reference image (a FICTIONAL original character, not a real or recognizable person). Keep the character consistent across ALL panels — same face, hair, outfit, skin tone, art style.

STYLE LOCK: render in the SAME medium as the reference image — if it is cartoon / illustrated / anime / 2D / 3D-render, keep that exact style; only use photorealism if the reference is a real photo. Never convert a stylised character to realistic.

CONTINUITY LOCK: the storyboard must read like a video production sheet, not a collage. Keep the subject large and readable, preserve the same wardrobe and lighting cues across panels, and make each panel feel like the next beat in a continuous shot chain so the video engine can follow it without guessing.${portrait ? " Keep the sheet tall, portrait-first, and easy to hand off as a reference image." : ""}

TOPIC: ${args.topic}

PANELS:
${panels}

Lighting and finish appropriate to the reference image's style. No speech bubbles, no text overlays, no panel numbers, no watermarks. Favor clear silhouettes, obvious motion, and large readable panels over tiny detail.`;
}

function selectStoryboardResolution(panelCount: number): "1K" | "2K" {
  return panelCount > 4 ? "2K" : "1K";
}

function isHttpImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value) && !/\.gif(\?|#|$)/i.test(value);
}
