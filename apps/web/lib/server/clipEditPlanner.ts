import { callClaudeJSON } from "./kie-claude";
import { validateEditPlan, type EditOp } from "./clipEditOps";
import type { ClipConfig, ClipMoment, TranscriptSegment, TranscriptWord, CaptionStyle } from "./clipTypes";
import { CLIP_SKILL_BY_ID, CAPTION_SKILL_STYLE, hookOverlayOp, hookText, stickerOverlayOp, memeText, STICKER_START_SEC } from "../builder/clipSkillsCatalog";
import { isCaptionPresetId } from "../builder/captionPresets";
import { transformStickerText } from "./stickerTransform";
import { transformHookText } from "./hookTransform";
import { withVelloWatermark } from "../builder/velloWatermark";

type CallJSON = (args: { system: string; user: string; apiKey?: string }) => Promise<unknown>;

export interface PlanArgs {
  skills: Array<{ skillId?: string; name: string; instructions: string;
    /** Per-node caption preset picked in the Dynamic Captions inspector. */
    captionPreset?: string;
    /** Per-node caption alignment (top|center|bottom) — Dynamic Captions inspector. */
    captionAlign?: "top" | "center" | "bottom";
    /** Exact caption placement (block centre, % from the top) — set by dragging
     *  the caption in the Editor preview. Wins over captionAlign. */
    captionYPct?: number;
    /** Per-node Smart Captions instruction (clip.captionstyle) — steers the
     *  caption text (translate / casing / emojis). */
    captionPrompt?: string;
    /** Per-node Auto Hook config picked in the clip.hook inspector. */
    hookDurationSec?: number;
    /** "Always on": keep the hook up until the end of the clip. */
    hookAlwaysOn?: boolean;
    hookTemplateId?: string;
    /** Per-node hook text position (top|center|bottom) — overrides the template. */
    hookPosition?: "top" | "center" | "bottom";
    /** Per-node custom hook look (overrides the template's render). */
    hookCustomDesign?: import("../builder/hookDesigns").CustomHookDesign;
    /** Per-node prompt-box idea steering the hook overlay line (clip.hook). */
    hookPrompt?: string;
    /** Auto Hook language dropdown (e.g. "Spanish") — the LLM otherwise only
     *  guesses the hook's language from the caption text, which skewed
     *  English whenever the caption was short/ambiguous. */
    hookLanguage?: string;
    /** Per-node Hook Title Card config picked in the clip.title inspector. */
    titleTemplateId?: string;
    titleDurationSec?: number;
    /** Per-node prompt-box idea steering the slate headline text. */
    titlePrompt?: string;
    /** Per-node Smart Framing mode (clip.facetrack inspector). */
    framingMode?: "auto" | "pan" | "zoom" | "full";
    /** Per-node Zoom Punch framing/animation style (clip.zoom inspector). */
    zoomStyle?: "blur" | "blur_zoom_in" | "blur_zoom_out" | "punch";
    /** Per-node Viral Sticker config (clip.sticker inspector). */
    stickerPrompt?: string;
    stickerStyleId?: string;
    stickerPosition?: string;
    /** Per-node Brain Rot config (clip.brainrot inspector). */
    bgLayout?: "vstack" | "hstack";
    bgId?: string;
    /** Per-node Meme Audio config (clip.memeaudio inspector). */
    audioUrl?: string;
    audioId?: string;
    gainDb?: number;
    /** Per-node reaction-SFX pack pick (clip.memeaudio inspector). The AI still
     *  auto-picks the sting by emotion; this only swaps which pack it draws from. */
    sfxPackId?: string;
    /** Per-node Video Filters config (clip.filters inspector). */
    filterPreset?: "vintage" | "warm" | "cool" | "bw" | "vivid" | "cinematic" | "hd" | "superhd" | "moody" | "filmic" | "matte";
    filterSaturation?: number;
    filterBrightness?: number;
    /** Per-node Reaction SFX config (clip.reactionsfx inspector). */
    sfxId?: string;
    /** Per-node Trending Audio config (clip.trendingaudio inspector). */
    musicTrackId?: string;
    autoMusic?: boolean;
    /** Operator's own uploaded MP3 — wins over musicTrackId/autoMusic when set. */
    customAudioUrl?: string;
    /** Per-node Overlay Image config (clip.overlayimage inspector): the operator's
     *  uploaded image + placement. The deterministic floor burns it into the clip. */
    overlayImageUrl?: string;
    overlayMode?: "overlay" | "frame";
    overlayPosition?: "overlay" | "top" | "bottom";
    overlayOpacity?: number;
    overlayScale?: number }>;
  config: ClipConfig;
  window: TranscriptSegment[];
  /** Per-word transcript timestamps for THIS source (clip-window-relative
   *  selection happens in the floor). Optional — when present the MEME reaction
   *  SFX is retimed onto the moment's content peak; when absent the SFX keeps its
   *  emotion-derived constant beat. */
  words?: TranscriptWord[];
  moment: ClipMoment;
}
export interface PlanDeps { callJSON?: CallJSON; apiKey?: string; }

/** A unique key per op so floor ops only fill an op-kind the LLM didn't emit. */
const opKind = (o: EditOp): string => (o.op === "emphasis" ? `emphasis:${o.kind}` : o.op);

/** Op kinds each known skill is allowed to contribute. The LLM editor sometimes
 *  invents extra ops (e.g. a huge text_overlay when only captions were wired) —
 *  with all-known skills we filter its plan down to what was actually wired. */
const SKILL_OP_KINDS: Record<string, string[]> = {
  "clip.captions": ["subtitles"],
  "clip.title": ["title_card"],
  "clip.meme": ["text_overlay"],
  "clip.zoom": ["emphasis:zoom_punch", "blur_frame"],
  "clip.speed": ["emphasis:speed"],
  "clip.hook": ["text_overlay"],
  "clip.sticker": ["text_overlay"],
  "clip.overlayimage": ["image_overlay"],
  "clip.captionstyle": ["subtitles"],
  "clip.keywords": ["subtitles"],
  "clip.fillercut": ["remove_fillers"],
  "clip.facetrack": ["face_reframe"],
  "clip.brainrot": ["composite_bg"],
  "clip.memeaudio": ["audio_overlay"],
  "clip.trendingaudio": ["audio_overlay"],
  "clip.filters": ["color_filter"],
  "clip.prompt": [], // steers moment selection in plan-moments; adds no edit ops
  "clip.campaignscout": [], // surfaces campaign matches in the run log; no edit ops
  "clip.transitions": [], // render-level seam transition (clipConfig.transition); no edit ops
};
const kindsForSkill = (id: string): string[] | undefined =>
  SKILL_OP_KINDS[id] ?? (id.startsWith("clip.style.") ? ["subtitles"] : undefined);

/** Merge the caption style implied by wired caption skills (presets/emoji).
 *  Applied LAST so a chosen preset beats whatever style the LLM emitted. */
function applyCameraSkillStyle(plan: EditOp[], args: PlanArgs): EditOp[] {
  // Zoom punches are opt-in: only the Zoom Punch skill (clip.zoom — the Editor's
  // Specials toggle) may add them. allowedOpKinds skips filtering entirely when an
  // unknown/custom skill is wired, which let the LLM sprinkle zoom_punch onto clips
  // whose operator had Zoom Punch switched OFF.
  if (!args.skills.some((s) => s.skillId === "clip.zoom")) {
    plan = plan.filter((o) => !(o.op === "emphasis" && o.kind === "zoom_punch"));
  }
  const mode = args.skills.find((s) => s.skillId === "clip.facetrack")?.framingMode;
  if (!mode) return plan;
  // Explicit editor camera choices outrank any model-generated crop or zoom.
  const out = plan.filter((o) => o.op !== "face_reframe" && !(mode === "full" && o.op === "emphasis" && o.kind === "zoom_punch"));
  if (mode === "full") {
    for (const op of out) if (op.op === "reframe") op.mode = "pad";
  }
  out.push({ op: "face_reframe", mode });
  return out;
}

function applyCaptionSkillStyle(plan: EditOp[], args: PlanArgs): EditOp[] {
  plan = applyCameraSkillStyle(plan, args);
  let patch: Partial<CaptionStyle> | null = null;
  for (const s of args.skills) {
    const p = s.skillId ? CAPTION_SKILL_STYLE[s.skillId] : undefined;
    if (p) patch = { ...(patch ?? {}), ...p };
  }
  // The operator's per-node preset pick (Dynamic Captions inspector) wins over
  // any style implied by wired caption skills.
  for (const s of args.skills) {
    if (s.captionPreset && isCaptionPresetId(s.captionPreset)) patch = { ...(patch ?? {}), preset: s.captionPreset };
  }
  // Caption alignment (top|center|bottom) — set on style.position so it drives the
  // ASS alignment. Applied AFTER the preset so it wins (presets don't set a
  // position; this is the operator's explicit vertical placement).
  for (const s of args.skills) {
    if (s.captionAlign === "top" || s.captionAlign === "center" || s.captionAlign === "bottom") {
      patch = { ...(patch ?? {}), position: s.captionAlign };
    }
    if (typeof s.captionYPct === "number" && Number.isFinite(s.captionYPct)) {
      patch = { ...(patch ?? {}), yPct: Math.min(100, Math.max(0, s.captionYPct)) };
    }
  }
  // ON-VIDEO caption text instruction (language / casing / emojis) now lives on
  // Dynamic Captions (clip.captions) — the skill that owns the burned-in captions.
  // clip.captionstyle (Smart Captions) is kept as a LEGACY fallback so agents saved
  // before the split keep working; new nodes carry it on clip.captions.
  for (const s of args.skills) {
    if ((s.skillId === "clip.captions" || s.skillId === "clip.captionstyle") && s.captionPrompt && s.captionPrompt.trim()) {
      patch = { ...(patch ?? {}), prompt: s.captionPrompt.trim() };
    }
  }
  if (!patch) return plan;
  const styled = { ...args.config.captionStyle, ...patch };
  const has = plan.some((o) => o.op === "subtitles");
  return has
    ? plan.map((o) => (o.op === "subtitles" ? { ...o, style: styled } : o))
    : [...plan, { op: "subtitles", style: styled }];
}

/** Allowed op kinds for a plan: baseline (reframe + captions/logo per config)
 *  plus each wired skill's kinds. Returns null (no filtering) when any wired
 *  skill is unknown — custom skill MDs may legitimately need any op. */
function allowedOpKinds(args: PlanArgs): Set<string> | null {
  const allowed = new Set<string>(["reframe"]);
  if (args.config.captionsOn) allowed.add("subtitles");
  if (args.config.brandLogoUrl) allowed.add("logo_overlay");
  for (const s of args.skills) {
    const kinds = s.skillId ? kindsForSkill(s.skillId) : undefined;
    if (!kinds) return null;
    kinds.forEach((k) => allowed.add(k));
  }
  return allowed;
}

/** A small lead-in so the percussive sting lands ON the emphasis beat rather than
 *  after the speaker finishes the emphasised word. */
const SFX_LEAD_IN = 0.12;
const SFX_FILLERS = new Set(["um", "uh", "like", "you", "the", "a", "and"]);
const SFX_TAG_RE = /^\(?(laughter|laughs|applause|music|cheer)\)?[.,!?]*$/i;

/** Find the content peak (moment-relative seconds) for a reaction SFX from the
 *  per-word timestamps inside [m.startSeconds, m.endSeconds]. Priority:
 *   1. audio-event tag (Gemini-fallback path only — filtered out on ElevenLabs);
 *   2. emphatic punctuation (! / ?! / ? — survives in `words` on BOTH paths);
 *   3. most-emphatic (longest-held) content word — a drawn-out word is the beat;
 *   4. densest-speech point — start of the tightest 4-word run.
 *  Returns null when no usable signal exists, so the caller keeps the emotion
 *  constant. */
function pickSfxPeakRel(m: ClipMoment, words: TranscriptWord[] | undefined): number | null {
  if (!words || words.length === 0) return null;
  const inWin = words.filter((w) => w.end > m.startSeconds && w.start < m.endSeconds);
  if (inWin.length === 0) return null;
  const rel = (w: TranscriptWord) => Math.max(0, w.start - m.startSeconds);

  // 1. Audio-event tag (only present on the Gemini fallback path).
  const tag = inWin.find((w) => SFX_TAG_RE.test(w.word.trim()));
  if (tag) return rel(tag);

  // 2. Emphatic punctuation — the reliable cross-provider signal.
  const punch = inWin.find((w) => /[!?](\?|!)?$/.test(w.word.trim()));
  if (punch) return rel(punch);

  // 3. Most-emphatic (longest-held) content word. Guard against synthesized
  //    even-spread word timings: if the max hold is barely above the median,
  //    treat it as "no emphasis" and fall through to density.
  const content = inWin.filter((w) => {
    const t = w.word.trim().replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    return t.length >= 3 && !SFX_FILLERS.has(t);
  });
  if (content.length > 0) {
    const durs = content.map((w) => Math.max(0, w.end - w.start));
    const sorted = [...durs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    let best = content[0]; let bestDur = durs[0];
    for (let i = 1; i < content.length; i++) { if (durs[i] > bestDur) { bestDur = durs[i]; best = content[i]; } }
    if (median <= 0 || bestDur > median * 1.05) return rel(best);
  }

  // 4. Densest-speech point — start of the tightest 4-word window (smallest
  //    summed inter-word gap). Needs ≥4 words; else nothing usable.
  if (inWin.length >= 4) {
    let bestStart = inWin[0]; let bestGap = Infinity;
    for (let i = 0; i + 3 < inWin.length; i++) {
      let gap = 0;
      for (let j = i; j < i + 3; j++) gap += Math.max(0, inWin[j + 1].start - inWin[j].end);
      if (gap < bestGap) { bestGap = gap; bestStart = inWin[i]; }
    }
    return rel(bestStart);
  }
  return null;
}

/** Speech-density heuristic for Trending Audio's Auto Music: is this clip
 *  DIALOGUE-HEAVY (near-continuous talking, little breathing room)? A vocal
 *  song's own singing voice fights a busy speaker for the listener's ear far
 *  worse than it fights an occasional line — so Auto Music should reach for an
 *  instrumental bed here and save the vocal tracks for lighter/visual clips.
 *
 *  Natural single-speaker English runs ~2.3-2.7 words/sec; a sustained rate at
 *  or above ~1.8 (leaving room for a two-person back-and-forth, which reads
 *  denser per wall-clock second) means the clip is mostly talking, not mostly
 *  visual. Falls back to window-text word count (args.window) when per-word
 *  timestamps aren't available (some sources never get Whisper word-align);
 *  a short/near-empty window is never flagged (need ≥8 words to judge, so a
 *  b-roll clip with one caption line doesn't wrongly get treated as dialogue).
 *  Pure — no I/O, directly unit-testable. */
export function isDialogueHeavy(m: ClipMoment, words: TranscriptWord[] | undefined, window: TranscriptSegment[] | undefined): boolean {
  const span = Math.max(0.1, m.endSeconds - m.startSeconds);
  const wordsInWin = (words ?? []).filter((w) => w.end > m.startSeconds && w.start < m.endSeconds);
  let count = wordsInWin.length;
  if (count === 0 && window?.length) {
    // No per-word timestamps for this source — fall back to the window's
    // transcript text (already scoped to roughly this clip by the caller).
    count = window.map((s) => s.text).join(" ").split(/\s+/).filter(Boolean).length;
  }
  if (count < 8) return false;
  const rate = count / span;
  return rate >= 1.8;
}

/** Mutate the just-produced clip.memeaudio `audio_overlay` op so its `atSec`
 *  lands on the moment's CONTENT peak (with a lead-in), instead of the
 *  emotion-derived constant. No peak / no words → the op is left untouched, so
 *  the emotion constant remains the fallback. Preserves the chosen sound + gain;
 *  clamps with the SAME bound the pure floor uses so the sting never runs past
 *  clip end. */
function retimeReactionSfx(ops: EditOp[], m: ClipMoment, words: TranscriptWord[] | undefined): void {
  const peakRel = pickSfxPeakRel(m, words);
  if (peakRel == null) return;
  const len = Math.max(0, m.endSeconds - m.startSeconds);
  const atSec = Math.min(Math.max(0, len - 0.5), Math.max(0, peakRel - SFX_LEAD_IN));
  for (const op of ops) {
    if (op.op === "audio_overlay") op.atSec = atSec;
  }
}

/**
 * Deterministic op set GUARANTEED for the wired skills — no LLM call. Each skill
 * with a `floor` contributes its op(s) derived from the moment metadata. This is
 * the resilient baseline: if KIE is flaky / out of credits / returns prose, these
 * still render so every wired skill visibly applies.
 */
function buildSkillFloor(args: PlanArgs): EditOp[] {
  const floor: EditOp[] = [];
  for (const s of args.skills) {
    // clip.hook is handled EXCLUSIVELY by applyHookStyle (transform-or-prepend),
    // so it never enters the op-kind merge — otherwise its text_overlay floor
    // would collide with another text_overlay skill (e.g. clip.meme) and one of
    // the two would be silently dropped when the LLM emits a single overlay.
    // clip.hook + clip.sticker are single-instance overlays handled by their own
    // apply* passes (so they don't collide with each other / clip.meme in the
    // text_overlay merge); skip them here.
    if (s.skillId === "clip.hook" || s.skillId === "clip.sticker" || s.skillId === "clip.title") continue;
    const def = s.skillId ? CLIP_SKILL_BY_ID[s.skillId] : undefined;
    if (!def?.floor) continue;
    // Per-node config rides the skill object (like captionPreset) — merge the
    // floor-relevant fields into the config so the deterministic floor actually
    // sees the operator's picks (the global ClipConfig never carries them).
    const perNode: Record<string, unknown> = {};
    if (s.skillId === "clip.facetrack" && s.framingMode) perNode.framingMode = s.framingMode;
    // Zoom Punch: the operator's chosen framing/animation style (blurred full-person
    // frame vs a momentary punch-in on the face) must reach the deterministic floor.
    if (s.skillId === "clip.zoom" && s.zoomStyle) perNode.zoomStyle = s.zoomStyle;
    if (s.skillId === "clip.brainrot") {
      // Brain Rot composites a gameplay background ONLY when the operator
      // explicitly picked one in the inspector (a real bg id, or "random" for the
      // rotating pool). A bare/stale row carries no bgId — e.g. a skill left
      // installed in agentSkillFiles after its canvas node was removed (the node
      // graph is localStorage-only, so removal doesn't delete the cloud row), or
      // an installed-but-never-configured node. In those cases we must NOT emit
      // composite_bg: the gameplay bg must never appear unless Brain Rot is
      // genuinely active WITH a chosen background. Skip the floor entirely so no
      // composite_bg op is produced (mirrors the graceful-degrade path).
      if (!s.bgId) continue;
      if (s.bgLayout) perNode.bgLayout = s.bgLayout;
      perNode.bgId = s.bgId;
    }
    if (s.skillId === "clip.memeaudio") {
      // Merged Meme & Reaction SFX: a trending sound (audioUrl) OR a curated SFX (sfxId).
      if (s.audioUrl) perNode.audioUrl = s.audioUrl;
      if (s.audioId) perNode.audioId = s.audioId;
      if (s.sfxId) perNode.sfxId = s.sfxId;
      // Reaction-SFX pack pick — the floor reads config.sfxPackId to swap the pack
      // (the AI still auto-picks the sting by emotion). Unset ⇒ Gen Z Meme default.
      if (s.sfxPackId) perNode.sfxPackId = s.sfxPackId;
      if (typeof s.gainDb === "number") perNode.gainDb = s.gainDb;
    }
    if (s.skillId === "clip.trendingaudio") {
      // Trending Audio: the operator's picked track and/or the auto-by-mood flag
      // must reach the floor (the global ClipConfig never carries them).
      if (s.musicTrackId) perNode.musicTrackId = s.musicTrackId;
      if (typeof s.autoMusic === "boolean") perNode.autoMusic = s.autoMusic;
      if (typeof s.gainDb === "number") perNode.gainDb = s.gainDb;
      if (s.customAudioUrl) perNode.customAudioUrl = s.customAudioUrl;
      // Content-aware track pick: a dialogue-dense clip gets an instrumental bed
      // instead of a vocal song (see isDialogueHeavy) — only matters for Auto
      // Music; an explicit manual pick or the operator's own upload are untouched.
      perNode.heavyDialogue = isDialogueHeavy(args.moment, args.words, args.window);
    }
    if (s.skillId === "clip.overlayimage") {
      // Overlay Image: the operator's uploaded image + placement drive the floor's
      // image_overlay op (a bare node with no image stays INERT — never invent one).
      if (typeof s.overlayImageUrl === "string" && s.overlayImageUrl.trim()) perNode.overlayImageUrl = s.overlayImageUrl.trim();
      if (s.overlayMode === "overlay" || s.overlayMode === "frame") perNode.overlayMode = s.overlayMode;
      if (s.overlayPosition === "overlay" || s.overlayPosition === "top" || s.overlayPosition === "bottom") perNode.overlayPosition = s.overlayPosition;
      if (typeof s.overlayOpacity === "number") perNode.overlayOpacity = s.overlayOpacity;
      if (typeof s.overlayScale === "number") perNode.overlayScale = s.overlayScale;
    }
    if (s.skillId === "clip.filters") {
      if (s.filterPreset) perNode.filterPreset = s.filterPreset;
      if (typeof s.filterSaturation === "number") perNode.filterSaturation = s.filterSaturation;
      if (typeof s.filterBrightness === "number") perNode.filterBrightness = s.filterBrightness;
    }
    const cfg = Object.keys(perNode).length ? { ...args.config, ...perNode } : args.config;
    const produced = def.floor(args.moment, cfg);
    // Content-aware retime for the MEME reaction SFX: the pure floor emits the
    // emotion-derived constant beat; override its audio_overlay.atSec onto the
    // moment's content peak when per-word timestamps are available. Leaves the
    // sound + gain (and the constant fallback) untouched.
    if (s.skillId === "clip.memeaudio") retimeReactionSfx(produced, args.moment, args.words);
    floor.push(...produced);
  }
  return floor;
}

/** Sole authority for the Auto Hook overlay when clip.hook is wired: force the
 *  opening overlay onto the operator's chosen duration + design (so the inspector
 *  pick WINS over the LLM, mirroring applyCaptionSkillStyle), and ENSURE one
 *  exists even if the LLM emitted none. Targets only startSec===0 so a clip.meme
 *  overlay (startSec 1) is never matched or clobbered. */
async function applyHookStyle(plan: EditOp[], args: PlanArgs, apiKey?: string): Promise<EditOp[]> {
  const hook = args.skills.find((s) => s.skillId === "clip.hook");
  if (!hook) return plan;
  // A bare/stale clip.hook row carries NONE of its inspector picks — e.g. a skill
  // left installed in agentSkillFiles after its canvas node was removed (the node
  // graph is localStorage-only, so removal doesn't delete the cloud row), or an
  // installed-but-never-configured node. hookText() always yields a string (it
  // falls back to "Watch this"), so without this gate a bare row would still burn
  // an opening hook overlay. Treat a row with no inspector config as inactive and
  // emit NO op — mirrors the Brain Rot `if (!s.bgId) continue;` graceful-degrade.
  const prompt = (hook.hookPrompt ?? "").trim();
  const hookConfigured =
    prompt.length > 0 ||
    typeof hook.hookDurationSec === "number" ||
    hook.hookAlwaysOn === true ||
    typeof hook.hookTemplateId === "string" ||
    hook.hookPosition === "top" || hook.hookPosition === "center" || hook.hookPosition === "bottom" ||
    (typeof hook.hookCustomDesign === "object" && hook.hookCustomDesign !== null);
  if (!hookConfigured) return plan;
  // The "Text position" dropdown (hookPosition) overrides the template's baked
  // position; fold it into the custom-look override so hookOverlayOp resolves it.
  const custom = hook.hookPosition || hook.hookCustomDesign
    ? { ...(hook.hookCustomDesign ?? {}), ...(hook.hookPosition ? { position: hook.hookPosition } : {}) }
    : undefined;
  // Always have the KIE LLM write the hook line from THIS clip's own caption —
  // an operator prompt steers it further, but its absence no longer skips
  // generation. Previously an empty prompt fell straight to the deterministic
  // "first 6 words of the caption" truncation, which is why two clips whose
  // captions opened the same way (or lacked one) burned the SAME hook. A
  // per-clip LLM read of each clip's own content can't collide like that.
  // transformHookText still falls back to that deterministic text if the LLM
  // call fails or no key is configured, so a hook always renders either way.
  const promptText = (await transformHookText(args.moment.captionText || args.moment.title || "", prompt, hookText(args.moment), apiKey ?? "", hook.hookLanguage)).text;
  let applied = false;
  const out = plan.map((o) => {
    if (!applied && o.op === "text_overlay" && o.startSec === 0) {
      applied = true;
      return hookOverlayOp(promptText ?? o.text, hook.hookDurationSec, hook.hookTemplateId, custom, hook.hookAlwaysOn === true);
    }
    return o;
  });
  // No opening overlay survived (LLM emitted none, or only a later meme) — insert
  // the operator's hook right after reframe so it always renders.
  if (!applied) {
    const at = out.findIndex((o) => o.op === "reframe");
    out.splice(at >= 0 ? at + 1 : 0, 0, hookOverlayOp(promptText ?? hookText(args.moment), hook.hookDurationSec, hook.hookTemplateId, custom, hook.hookAlwaysOn === true));
  }
  return out;
}


/** Sole authority for the Viral Sticker overlay when clip.sticker is wired:
 *  write a context-aware sticker line (operator prompt → LLM, else a deterministic
 *  phrase from the clip caption) and burn it as a styled box at STICKER_START_SEC
 *  (0.3) — distinct from the hook (0) and the meme (1), so all three coexist. */
async function applyStickerStyle(plan: EditOp[], args: PlanArgs, apiKey?: string): Promise<EditOp[]> {
  const sk = args.skills.find((s) => s.skillId === "clip.sticker");
  if (!sk) return plan;
  // Same bare/stale-row guard as the hook (and Brain Rot's `if (!s.bgId)`):
  // stickerOverlayOp always yields text (memeText falls back to "WAIT FOR IT"), so
  // a clip.sticker row with no inspector picks — stale after its canvas node was
  // removed, or never configured — would otherwise burn a sticker. Emit NO op
  // unless the operator genuinely configured the sticker.
  const stickerConfigured =
    typeof sk.stickerStyleId === "string" ||
    (typeof sk.stickerPosition === "string" && sk.stickerPosition.length > 0) ||
    (typeof sk.stickerPrompt === "string" && sk.stickerPrompt.trim().length > 0);
  if (!stickerConfigured) return plan;
  const fallback = memeText(args.moment);
  const { text } = await transformStickerText(
    args.moment.captionText || args.moment.title || "",
    sk.stickerPrompt ?? "",
    fallback,
    apiKey ?? "",
  );
  const op = stickerOverlayOp(text || fallback, sk.stickerStyleId, sk.stickerPosition);
  // RESTYLE the LLM's own sticker overlay in place. The sticker MD tells the LLM to
  // "Add exactly ONE text_overlay" but never pins startSec 0.3, so the old "match an
  // overlay at ≈0.3" branch was effectively dead for LLM output: the code always fell
  // through to the insert, APPENDING a 2nd sticker while the LLM's raw overlay (which
  // passes the allow-filter, since clip.sticker maps to text_overlay) survived → a
  // DOUBLE sticker. Claim the sticker's own 0.3 slot, OR the first text_overlay that
  // is NOT the hook slot (0, when clip.hook is wired) and NOT a meme slot (>=1, when
  // clip.meme is wired) — i.e. the LLM's stray sticker — and only insert fresh when
  // none exists, so hook(0) + meme(>=1) + sticker(0.3) still coexist. (applyStickerStyle
  // runs after applyHookStyle, so the hook already occupies startSec 0 by now.)
  const hookWired = args.skills.some((s) => s.skillId === "clip.hook");
  const memeWired = args.skills.some((s) => s.skillId === "clip.meme");
  let applied = false;
  const out = plan.map((o) => {
    if (applied || o.op !== "text_overlay") return o;
    const isStickerSlot = Math.abs(o.startSec - STICKER_START_SEC) < 0.05;
    const isHookSlot = hookWired && o.startSec === 0;
    const isMemeSlot = memeWired && o.startSec >= 1;
    if (isStickerSlot || (!isHookSlot && !isMemeSlot)) { applied = true; return op; }
    return o;
  });
  if (!applied) {
    const at = out.findIndex((o) => o.op === "reframe");
    out.splice(at >= 0 ? at + 1 : 0, 0, op);
  }
  return out;
}

/** Fallback plan when the LLM editor fails entirely: reframe + captions (if on)
 *  + every wired skill's deterministic floor + brand logo. NEVER bare reframe. */
function buildFloor(args: PlanArgs, skillFloor: EditOp[]): EditOp[] {
  const ops: EditOp[] = [{ op: "reframe", mode: "crop" }];
  if (args.config.captionsOn) ops.push({ op: "subtitles", style: args.config.captionStyle });
  ops.push(...skillFloor);
  if (args.config.brandLogoUrl) ops.push({ op: "logo_overlay", imageUrl: args.config.brandLogoUrl, corner: "br", opacity: 0.85 });
  return validateEditPlan(ops);
}

export async function planClipEdits(args: PlanArgs, deps: PlanDeps = {}): Promise<EditOp[]> {
  const callJSON: CallJSON = deps.callJSON ?? (callClaudeJSON as unknown as CallJSON);
  const skillsBlock = args.skills.slice(0, 6).map((s) => `- ${s.name}: ${s.instructions.slice(0, 300).replace(/\s+/g, " ").trim()}`).join("\n");
  const system = `You are a short-form video editor. Output an ORDERED edit plan for ONE 9:16 clip as JSON.
Allowed ops (compose freely; obey the SKILLS):
- {"op":"reframe","mode":"crop"|"pad"}            (always include; runs first)
- {"op":"subtitles","style":{"mode":"karaoke"|"line","fontColor":"#hex","fontSize":num,"position":"top"|"center"|"bottom"}}
- {"op":"text_overlay","text":str,"position":"top"|"center"|"bottom"|"top-left"|"top-right"|"bottom-left"|"bottom-right","startSec":num,"endSec":num,"style":{"fontColor":"#hex","fontSize":num,"bold":bool}}
- {"op":"logo_overlay","imageUrl":str,"corner":"tl"|"tr"|"bl"|"br","opacity":0-1}
- {"op":"emphasis","kind":"zoom_punch"|"speed"|"freeze","atSec":num}
The SKILLS are the operator's rules — follow them exactly. Return ONLY {"ops":[...]}.`;
  const clipLen = (args.moment.endSeconds - args.moment.startSeconds).toFixed(1);
  const user = `OPERATOR SKILLS (obey):\n${skillsBlock || "(none — use sensible defaults)"}\n
CAPTIONS DEFAULT: ${args.config.captionsOn ? `ON (${args.config.captionStyle.mode}, ${args.config.captionStyle.fontColor})` : "OFF"}
${args.config.brandLogoUrl ? `BRAND LOGO available: ${args.config.brandLogoUrl}` : ""}
CLIP: "${args.moment.title}" — ${clipLen}s. Hook caption text idea: "${args.moment.captionText}".
TRANSCRIPT (clip window):\n${args.window.map((s) => s.text).join(" ").slice(0, 1500)}`;

  const skillFloor = buildSkillFloor(args);
  const allowed = allowedOpKinds(args);

  // Two attempts: Kie Claude intermittently replies with prose instead of JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callJSON({ system, user, apiKey: deps.apiKey });
      const ops = (raw as { ops?: unknown })?.ops;
      let plan = validateEditPlan(ops);
      // Keep the LLM honest: drop ops no wired skill (or the config) asked for.
      if (allowed) plan = plan.filter((o) => allowed.has(opKind(o)));
      if (plan.length === 0) throw new Error("edit plan validated to zero ops");
      if (args.config.captionsOn && !plan.some((o) => o.op === "subtitles")) {
        plan.push({ op: "subtitles", style: args.config.captionStyle });
      }
      // Merge: the LLM enriches, but every wired skill's floor op must be present.
      // If the LLM already emitted that op-kind, keep its (richer) version; else
      // fill from the floor so the skill still visibly applies.
      const have = new Set(plan.map(opKind));
      for (const f of skillFloor) {
        // A mid-clip text_overlay floor (clip.meme, startSec >= 1) must NOT be
        // blocked by the opening hook overlay (startSec 0, owned by applyHookStyle)
        // — they share the "text_overlay" op-kind. Gate the meme floor on whether a
        // MID-CLIP overlay already exists, not on the op-kind alone, so hook + meme
        // can coexist. Other op-kinds keep the simple op-kind dedup.
        if (f.op === "text_overlay") {
          // f is the clip.meme floor (the ONLY floor text_overlay — hook/sticker are
          // skipped in buildSkillFloor). The meme's whole identity is its look
          // (white on a black box, size 64, outline 8 — so it never blends into the
          // #FFEE00 karaoke captions). The system-prompt overlay schema can't express
          // bgColor/outline, so an LLM mid-clip overlay renders plain (often yellow).
          // So instead of SUPPRESSING the floor when an LLM overlay exists, FORCE the
          // meme style onto it (keep the LLM's richer text/timing); else add the floor.
          // Mirrors the apply*Style philosophy hook/sticker already use.
          const mid = plan.find((o) => o.op === "text_overlay" && o.startSec >= 1);
          if (mid && mid.op === "text_overlay" && f.op === "text_overlay") mid.style = { ...mid.style, ...f.style };
          else plan.push(f);
        } else if (f.op === "audio_overlay") {
          // Multiple audio overlays coexist (e.g. two clip.memeaudio nodes each emit
          // one) — the graph amixes N of them. The LLM never emits audio_overlay,
          // so every floor one is wanted; the op-kind dedup would wrongly drop all but
          // the first.
          plan.push(f);
        } else if (!have.has(opKind(f))) {
          plan.push(f); have.add(opKind(f));
        }
      }
      // `await` (not a bare return): this is inside the retry try/catch, so a
      // sticker-stage rejection must fall through to the next attempt / floor.
      return withVelloWatermark(await applyStickerStyle(await applyHookStyle(applyCaptionSkillStyle(validateEditPlan(plan), args), args, deps.apiKey), args, deps.apiKey), args.config.velloWatermark === true);
    } catch (err) {
      console.warn(`[clipEditPlanner] attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : err);
    }
  }
  // LLM unusable (prose / 402 out-of-credits / down) → deterministic floor so the
  // wired skills (title card, meme text, zoom) STILL render. The sticker stage is
  // outside the retry try/catch here, so guard it: a sticker-stage throw must NOT
  // sink the whole floor (the documented "wired skills STILL render" guarantee).
  // transformStickerText already swallows its own LLM errors, so this is
  // defense-in-depth against any future synchronous throw in the sticker path.
  console.warn(`[clipEditPlanner] using deterministic skill floor (${skillFloor.length} skill ops)`);
  // No applyTitleStyle: the opening title slate is retired (it was concatenated
  // BEFORE the footage, delaying every clip). The hook is the on-video overlay.
  const floor = await applyHookStyle(applyCaptionSkillStyle(buildFloor(args, skillFloor), args), args, deps.apiKey);
  try {
    return withVelloWatermark(await applyStickerStyle(floor, args, deps.apiKey), args.config.velloWatermark === true);
  } catch (err) {
    console.warn(`[clipEditPlanner] floor sticker stage failed, returning floor:`, err instanceof Error ? err.message : err);
    return withVelloWatermark(floor, args.config.velloWatermark === true);
  }
}
