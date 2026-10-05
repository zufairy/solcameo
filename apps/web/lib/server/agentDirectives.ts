/**
 * STANDING DIRECTIVES — the copilot's instructions, made binding.
 *
 * THE BUG THIS EXISTS FOR: an operator tells the builder copilot "only make
 * commercial videos, the agent doesn't need to speak", the copilot agrees… and the
 * next render is still a talking head. Two links were missing:
 *
 *  1. the chat was never PERSISTED — nothing about that turn reached agentMemory,
 *     so the next generation had no idea the instruction existed;
 *  2. even loaded, memories only ever fed the creative brief as PROSE CONTEXT for
 *     the script LLM. Nothing keyed off them. Format/speech/style were decided by
 *     videoConfig + a rotating seed, so `styles: ["talking_head"]` kept winning.
 *
 * This module is the missing contract. A chat turn is parsed into STRUCTURED
 * fields, stored as one canonical memory line, and read back deterministically at
 * render time — no LLM in the loop, so the same instruction always resolves to the
 * same directive. Later directives override earlier ones FIELD BY FIELD, so "go
 * back to talking to camera" reverses only the speech rule and leaves the rest.
 *
 * The canonical memory summary is a single line so it survives every existing
 * memory reader unchanged (they all treat `summary` as display text):
 *
 *   [DIRECTIVE] speech=silent; format=commercial; avoid=hard sell
 */

/** How (or whether) the agent's voice appears in its videos. */
export type SpeechMode =
  /** Filmed talking to camera, lip-synced — the historical default. */
  | "on_camera"
  /** Heard but never filmed speaking: off-camera narration over visuals. */
  | "voiceover"
  /** No speech at all — visuals + music/ambience carry the video. */
  | "silent";

export interface AgentDirectives {
  speech?: SpeechMode;
  /** Creative format to force, e.g. "commercial". Matches the Director's format vocabulary. */
  format?: string;
  /** Extra visual direction that must apply to every video. */
  visualStyle?: string;
  /** Things every video must contain (brand name, product shot, CTA…). */
  mustInclude?: string[];
  /** Things no video may contain. */
  avoid?: string[];
  /** Spoken/written language lock, free text ("Malay"). */
  language?: string;
  /** Newest contributing memory's timestamp — for logging/debug. */
  updatedAt?: number;
}

/** agentMemory.kind for a standing directive. */
export const DIRECTIVE_KIND = "directive";
/** Directives outrank ordinary lessons in recallMemories' importance ordering. */
export const DIRECTIVE_IMPORTANCE = 98;
const PREFIX = "[DIRECTIVE]";

const MAX_LIST = 6;
const MAX_ITEM_CHARS = 80;
const MAX_STYLE_CHARS = 160;

const SPEECH_MODES: SpeechMode[] = ["on_camera", "voiceover", "silent"];

function clean(s: string, max: number): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

function dedupe(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const v = clean(raw, MAX_ITEM_CHARS);
    if (!v) continue;
    if (out.some((x) => x.toLowerCase() === v.toLowerCase())) continue;
    out.push(v);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

/** True when the directive carries nothing worth storing. */
export function isEmptyDirective(d: AgentDirectives): boolean {
  return !d.speech && !d.format && !d.visualStyle && !d.language
    && !(d.mustInclude?.length) && !(d.avoid?.length);
}

// ── Extraction ───────────────────────────────────────────────────────────────
// Deliberately RULE-BASED, not an LLM call. The operator's instruction must map
// to the same directive every time (and cost nothing per chat turn); a model that
// re-reads "no talking" differently on Tuesday is exactly the flakiness this is
// meant to remove. Phrasings are matched broadly, in English and Malay, because
// this is the language pair the builder is actually used in.

const NO_SPEECH_RX = [
  // "talking" but NOT "talking-head" — "no talking-head" is a framing instruction
  // (use off-camera voice), while "no talking" means silence. Same three words.
  /\b(no|without|zero)\s+(talking(?![- ]?head)|speaking|speech|speaker|dialogue|dialog|voice(s)?|voice[- ]?over|voiceover|narration|narrator|script|spoken\s+words?|words?\s+spoken|audio\s+voice|lip[- ]?sync)\b/i,
  /\b(don'?t|do\s+not|doesn'?t|does\s+not|no\s+need\s+to|shouldn'?t|should\s+not|never|not)\s+(talk(ing)?|speak(ing)?|say(ing)?\s+(anything|any\s*thing|words?)|saying)\b/i,
  // Broken-English phrasings the builder actually sees: "not speaker not saying
  // anything", "video no speaker", "nobody talk", "no one speaks".
  /\bnot?\s+speaker\b/i,
  /\bnot\s+saying\s+(anything|any\s*thing)\b/i,
  /\b(nobody|no\s*one|no-one|noone)\s+(talks?|speaks?|says?)\b/i,
  /\b(silent|no\s+sound\s+of\s+voice|mute[d]?)\s+(video|videos|clip|clips|spot|ad)\b/i,
  /\bvisuals?\s+only\b|\bmusic\s+only\b|\bambien(t|ce)\s+only\b/i,
  /\b(tak|tidak|jangan|tanpa)\s+(perlu\s+)?(bercakap|cakap|bersuara|suara|dialog|skrip)\b/i,   // Malay
  /\btiada\s+(suara|dialog|percakapan|skrip)\b/i,                                              // Malay
];
const VOICEOVER_RX = [
  /\b(voice[- ]?over|voiceover|narrat(e|ion|or))\b.{0,30}\b(only|instead)\b/i,
  /\b(off[- ]?camera|behind\s+the\s+camera)\b.{0,30}\b(narrat|voice|speak)/i,
  /\b(don'?t|do\s+not|no)\s+(show|film)\s+.{0,20}(talking|face\s+talking|lip)/i,
  /\bno\s+(talking[- ]head|lip[- ]?sync)\b/i,
];
const ON_CAMERA_RX = [
  /\b(talk|speak|speaking|talking)\s+(directly\s+)?to\s+(the\s+)?camera\b/i,
  /\b(talking[- ]head|on[- ]camera)\b(?!.{0,20}\b(no|never|avoid)\b)/i,
  /\b(back\s+to|resume|go\s+back\s+to)\s+.{0,20}(talking|speaking)\b/i,
];
const COMMERCIAL_RX =
  /\b(commercial|advert|advertisement|ad\s+spot|tv\s+spot|brand\s+film|product\s+ad|iklan)\b/i;

const FORMAT_WORDS: { rx: RegExp; format: string }[] = [
  { rx: COMMERCIAL_RX, format: "commercial" },
  { rx: /\b(product\s+demo|demo\s+video|demonstration)\b/i, format: "product demo" },
  { rx: /\b(b[- ]?roll|montage|lifestyle\s+montage|cinematic\s+montage)\b/i, format: "cinematic montage" },
  { rx: /\b(tutorial|how[- ]to|explainer)\b/i, format: "tutorial" },
  { rx: /\b(testimonial|review\s+video)\b/i, format: "testimonial" },
  { rx: /\b(unboxing)\b/i, format: "unboxing" },
];

const LANGUAGE_RX = /\b(?:speak|write|caption|narrate|in)\s+(?:only\s+)?(english|malay|bahasa(?:\s+melayu)?|indonesian|tamil|mandarin|chinese|arabic|spanish|portuguese|french|german|japanese|korean|thai|vietnamese|hindi)\b/i;

const AVOID_RX = /\b(?:avoid|never|don'?t\s+(?:use|include|show)|no\s+more)\s+([^.!?\n]{3,80})/i;
const MUST_RX = /\b(?:always|make\s+sure\s+(?:to|you)?|must\s+(?:include|show|have)|every\s+video\s+(?:must|should))\s+([^.!?\n]{3,80})/i;
const STYLE_RX = /\b(?:style|look|vibe|aesthetic|shot)\s+(?:should\s+be|is|:)\s*([^.!?\n]{3,160})/i;

/** True when the sentence is a STANDING instruction ("from now on", "always") vs a
 *  one-off request ("make me one video about X"). Standing-ness is not required —
 *  a bare "no talking" still counts — but it lifts confidence for logging. */
function looksStanding(text: string): boolean {
  return /\b(from\s+now\s+on|always|every\s+video|going\s+forward|by\s+default|never|only\s+(?:make|do|create)|dari\s+sekarang|selalu)\b/i.test(text);
}

/**
 * Parse ONE operator message into structured directives. Returns an empty object
 * when the message carries no standing instruction (the common case), so the
 * caller can skip the write.
 */
export function parseDirectives(text: string): AgentDirectives {
  const t = (text ?? "").slice(0, 4000);
  if (!t.trim()) return {};
  const d: AgentDirectives = {};

  // SPEECH — order matters. "no talking" is the strongest signal and must not be
  // re-read as on-camera by the looser talking-head pattern below it.
  if (NO_SPEECH_RX.some((rx) => rx.test(t))) d.speech = "silent";
  else if (VOICEOVER_RX.some((rx) => rx.test(t))) d.speech = "voiceover";
  else if (ON_CAMERA_RX.some((rx) => rx.test(t))) d.speech = "on_camera";

  for (const { rx, format } of FORMAT_WORDS) {
    if (rx.test(t)) { d.format = format; break; }
  }
  // A commercial with no explicit speech instruction still means "stop filming a
  // monologue" — the ad's copy becomes off-camera narration. An explicit speech
  // instruction in the same message always wins over this inference.
  if (d.format === "commercial" && !d.speech) d.speech = "voiceover";

  const lang = t.match(LANGUAGE_RX)?.[1];
  if (lang) d.language = clean(lang.replace(/^bahasa(\s+melayu)?$/i, "Malay"), 24);

  const style = t.match(STYLE_RX)?.[1];
  if (style) d.visualStyle = clean(style, MAX_STYLE_CHARS);

  const avoid = t.match(AVOID_RX)?.[1];
  // "never talk" is already captured as speech=silent — don't also store it as a
  // free-text avoid line, or the prompt repeats itself.
  if (avoid && !/\b(talk|speak|bercakap)\b/i.test(avoid)) d.avoid = dedupe([avoid]);

  const must = t.match(MUST_RX)?.[1];
  if (must) d.mustInclude = dedupe([must]);

  return d;
}

// ── Canonical memory line ────────────────────────────────────────────────────

/** Encode directives as the ONE-LINE canonical memory summary. */
export function encodeDirectiveSummary(d: AgentDirectives): string {
  const parts: string[] = [];
  if (d.speech) parts.push(`speech=${d.speech}`);
  if (d.format) parts.push(`format=${d.format}`);
  if (d.visualStyle) parts.push(`style=${d.visualStyle}`);
  if (d.language) parts.push(`language=${d.language}`);
  if (d.mustInclude?.length) parts.push(`must=${d.mustInclude.join(" | ")}`);
  if (d.avoid?.length) parts.push(`avoid=${d.avoid.join(" | ")}`);
  return `${PREFIX} ${parts.join("; ")}`;
}

/** Decode a canonical directive memory line. Non-directive summaries yield {}. */
export function decodeDirectiveSummary(summary: string): AgentDirectives {
  const s = (summary ?? "").trim();
  if (!s.toUpperCase().startsWith(PREFIX)) return {};
  const body = s.slice(PREFIX.length).trim();
  const d: AgentDirectives = {};
  for (const chunk of body.split(";")) {
    const [rawKey, ...rest] = chunk.split("=");
    const key = rawKey.trim().toLowerCase();
    const value = clean(rest.join("="), 400);
    if (!key || !value) continue;
    if (key === "speech" && (SPEECH_MODES as string[]).includes(value)) d.speech = value as SpeechMode;
    else if (key === "format") d.format = clean(value, 60);
    else if (key === "style") d.visualStyle = clean(value, MAX_STYLE_CHARS);
    else if (key === "language") d.language = clean(value, 24);
    else if (key === "must") d.mustInclude = dedupe(value.split("|"));
    else if (key === "avoid") d.avoid = dedupe(value.split("|"));
  }
  return d;
}

// ── Merge ────────────────────────────────────────────────────────────────────

export interface MemoryLike {
  kind: string;
  summary: string;
  importance?: number;
  /** Creation time. Missing (older readers) sorts as 0 — array order then decides. */
  at?: number;
}

/**
 * Fold every directive memory into ONE effective directive set: newest wins PER
 * FIELD, so "actually, speak to camera again" flips only `speech` and keeps the
 * commercial format. Non-directive memories are ignored.
 *
 * Input order does not matter (memories arrive importance-ranked, not
 * chronological) — rows are sorted by `at` ascending and applied oldest → newest,
 * so the last write of each field is the one that survives.
 */
export function resolveAgentDirectives(memories: MemoryLike[] | undefined | null, ignoreBefore?: number): AgentDirectives {
  const rows = (memories ?? [])
    .filter((m) => m && typeof m.summary === "string")
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.kind === DIRECTIVE_KIND || m.summary.trim().toUpperCase().startsWith(PREFIX))
    // `ignoreBefore` = the operator's last MANUAL Director-tab save
    // (videoConfig.manualUpdatedAt): a directive recorded before that moment is
    // stale — the manual config is the newer word and must win. Directives
    // issued in chat AFTER the save still apply.
    .filter(({ m }) => !ignoreBefore || (m.at ?? 0) > ignoreBefore)
    // Stable: equal timestamps keep their original relative order.
    .sort((a, b) => ((a.m.at ?? 0) - (b.m.at ?? 0)) || (a.i - b.i));

  const out: AgentDirectives = {};
  for (const { m } of rows) {
    const d = decodeDirectiveSummary(m.summary);
    if (isEmptyDirective(d)) continue;
    if (d.speech) out.speech = d.speech;
    if (d.format) out.format = d.format;
    if (d.visualStyle) out.visualStyle = d.visualStyle;
    if (d.language) out.language = d.language;
    // Lists ACCUMULATE (each "always mention X" adds a rule) rather than replace,
    // capped so a chatty session can't grow the prompt without bound.
    if (d.mustInclude?.length) out.mustInclude = dedupe([...(out.mustInclude ?? []), ...d.mustInclude]);
    if (d.avoid?.length) out.avoid = dedupe([...(out.avoid ?? []), ...d.avoid]);
    if (m.at) out.updatedAt = m.at;
  }
  return out;
}

// ── Application ──────────────────────────────────────────────────────────────

/** Hard-constraint block appended to every creative/storyboard/video prompt. */
export function directiveBlock(d: AgentDirectives): string {
  if (isEmptyDirective(d)) return "";
  const lines: string[] = [];
  if (d.speech === "silent") {
    lines.push(
      "NO SPEECH: nobody speaks in this video. No dialogue, no voiceover, no narration, no lip-sync, no talking head. Carry the whole video with visuals, on-screen text, motion and music/ambience.",
    );
  } else if (d.speech === "voiceover") {
    lines.push(
      "OFF-CAMERA VOICE ONLY: the voice is narration laid over the visuals. Never film anyone talking to camera and never lip-sync.",
    );
  } else if (d.speech === "on_camera") {
    lines.push("ON CAMERA: the character speaks to camera, lip-synced to the script.");
  }
  if (d.format) lines.push(`FORMAT IS FIXED: every video is a ${d.format}. Do not fall back to any other format.`);
  if (d.visualStyle) lines.push(`VISUAL STYLE: ${d.visualStyle}.`);
  if (d.language) lines.push(`LANGUAGE: ${d.language} only.`);
  if (d.mustInclude?.length) lines.push(`ALWAYS: ${d.mustInclude.join("; ")}.`);
  if (d.avoid?.length) lines.push(`NEVER: ${d.avoid.join("; ")}.`);
  return `OPERATOR STANDING ORDERS (these OVERRIDE the persona defaults, the style presets, and your own preferences — obey them exactly):\n- ${lines.join("\n- ")}`;
}

/**
 * Apply directives to a resolved creative brief. The Director's rotating style is
 * a DEFAULT; a standing order is not. Returns a new brief — callers keep theirs.
 */
export function applyDirectivesToBrief<
  T extends { format: string; angle: string; structureNotes: string; visualTreatment: string },
>(brief: T, d: AgentDirectives): T {
  if (isEmptyDirective(d)) return brief;
  const notes: string[] = [brief.structureNotes];
  if (d.speech === "silent") notes.push("No spoken words at all — visuals, on-screen text and music only");
  else if (d.speech === "voiceover") notes.push("Off-camera narration over the visuals; never filmed talking to camera");
  if (d.mustInclude?.length) notes.push(`Always: ${d.mustInclude.join("; ")}`);
  if (d.avoid?.length) notes.push(`Never: ${d.avoid.join("; ")}`);
  return {
    ...brief,
    // A forced format REPLACES the rotation — this is the line that stops the
    // "talking_head" style preset from winning over the operator's instruction.
    format: d.format ?? brief.format,
    visualTreatment: [brief.visualTreatment, d.visualStyle].filter(Boolean).join(", "),
    structureNotes: notes.filter(Boolean).join(". "),
  };
}

/** Does this directive set forbid on-camera lip-sync? */
export function forbidsLipSync(d: AgentDirectives): boolean {
  return d.speech === "silent" || d.speech === "voiceover";
}

/**
 * Persist the operator's STANDING ORDERS from a chat turn into the agent's
 * episodic memory, so every later generation reads them (see the module
 * doc-comment above). Shared by every chat surface that talks to an agent —
 * the builder copilot (`/api/ai/chat`) and the in-character agent chat
 * (`/api/agents/chat`) both call this so an instruction like "speak Malay
 * from now on" persists and overrides the creative director regardless of
 * which chat widget it was typed into.
 *
 * Only the LATEST user message is parsed — earlier turns were already persisted on
 * their own turn, and re-parsing history would resurrect an instruction the
 * operator has since reversed. Ordinary chatter parses to nothing and writes
 * nothing, so the memory graph stays signal, not transcript.
 *
 * Best-effort by contract: a failure here must never break the chat reply.
 */
export async function persistStandingDirective(args: {
  messages: Array<{ role?: unknown; content?: unknown }>;
  mintAddress?: string;
  sessionId?: string;
  /** Which chat surface this came from, kept for the memory's detail view. */
  source: string;
}): Promise<void> {
  try {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
    const authSecret = process.env.INTERNAL_CRON_SECRET?.trim();
    const mint = (args.mintAddress ?? "").trim();
    const session = (args.sessionId ?? "").trim();
    // No identity → nowhere safe to store it (writing under "" would pool this
    // project's orders into every other project's brain).
    if (!convexUrl || !authSecret || (!mint && !session)) return;

    const lastUser = [...args.messages]
      .reverse()
      .find((m) => m?.role === "user" && typeof m.content === "string" && (m.content as string).trim());
    const text = typeof lastUser?.content === "string" ? lastUser.content : "";
    if (!text.trim()) return;

    const directives = parseDirectives(text);
    // "remember that …" / "note that …" — an explicit ask to keep something. Stored as
    // a plain preference (it steers the script/persona prompts through the agent brain)
    // rather than a machine-read directive, since it's free-form knowledge.
    const explicit = text.match(/\b(?:remember|note|keep in mind|jangan lupa|ingat)\s+(?:that\s+|this[:,]?\s+)?([^\n]{4,300})/i)?.[1]?.trim();
    if (isEmptyDirective(directives) && !explicit) return;

    const { ConvexHttpClient } = await import("convex/browser");
    const { api } = await import("@/convex/_generated/api");
    const convex = new ConvexHttpClient(convexUrl);
    const identity = { ...(mint ? { mintAddress: mint } : {}), ...(session ? { sessionId: session } : {}) };

    if (!isEmptyDirective(directives)) {
      const summary = encodeDirectiveSummary(directives);
      await convex.mutation(api.agentTasks.recordMemory, {
        ...identity,
        kind: DIRECTIVE_KIND,
        summary,
        // The operator's own words, kept for the graph's detail view and for any
        // future re-parse with a smarter extractor.
        context: JSON.stringify({ source: args.source, said: text.slice(0, 600), parsed: directives }),
        importance: DIRECTIVE_IMPORTANCE,
        authSecret,
      });
      console.log(`[${args.source}] standing order saved for ${mint || session}: ${summary}`);
    }

    if (explicit) {
      await convex.mutation(api.agentTasks.recordMemory, {
        ...identity,
        kind: "preference",
        summary: explicit.slice(0, 240),
        context: JSON.stringify({ source: args.source, said: text.slice(0, 600) }),
        // Below a directive (which is machine-enforced) but well above routine
        // task chatter, so it survives recall ranking.
        importance: 85,
        authSecret,
      }).catch(() => { /* dedup/floor rejections are expected — never fatal */ });
      console.log(`[${args.source}] remembered for ${mint || session}: ${explicit.slice(0, 80)}`);
    }
  } catch (e) {
    console.warn(`[${args.source}] standing-order persist failed (non-fatal):`, e instanceof Error ? e.message : e);
  }
}
