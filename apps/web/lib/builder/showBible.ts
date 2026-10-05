// Show Bible — the agent's creative source of truth, compiled by LLM from the
// operator's free-form concept prompt. Stored on influencers.showBible as a
// PERMISSIVE blob (v.any()) — this normalizer is the real shape contract, same
// pattern as clipConfig (see the schema comment on clipConfig).
import { videoLengthStepsForEngine, type VideoEngineId } from "./agentTypes";
import { getArchetype, identityRefKindsFor, type VisualRefKind } from "./showArchetypes";

export interface ShowBibleCastMember { name: string; role: string; visualIdentity: string; }
/** A locked look reference — real photo, AI design sheet, extracted video
 *  frame, or the wizard's style frame. `role` scopes it to a cast member
 *  ("cast:<name>") or the show's overall look ("style"). Only `locked` refs
 *  feed the render (resolveIdentityRefs). */
export interface ShowBibleVisualRef {
  url: string;
  kind: VisualRefKind;
  role: string; // "cast:<name>" | "style"
  locked?: boolean;
}
export interface ShowBible {
  version: number;
  compiledFrom?: string;
  /** Show archetype id (lib/builder/showArchetypes.ts) — decides the identity
   *  ref policy (the realism rule) + wizard defaults. Absent = "custom". */
  archetype?: string;
  visualRefs?: ShowBibleVisualRef[];
  premise: string;
  format: { kinds: string[]; rotation?: "round-robin" | "weighted" };
  cast: ShowBibleCastMember[];
  visualWorld: { style: string; settings: string[]; moods: string[] };
  voice: { tone: string; language?: string; catchphrases?: string[] };
  contentEngine: { newsQueries: string[]; evergreenPools: string[]; seriesArcs: boolean };
  /** Influencer balance: percent of ideas that entertain vs teach vs promote.
   *  Keeps the feed from becoming all hard sell. Sums to 100. */
  contentMix: { entertain: number; value: number; promo: number };
  variationAxes: { hookStyles: string[]; structures: string[]; cameraTreatments?: string[] };
  cadence: { perFormatDuration: Record<string, { min: number; max: number }>; postsPerDay?: number };
  /** Named per-video recipes ("Street interview", "Hot take"). When present they
   *  are the SOURCE OF TRUTH for what a video looks like — the director rotates
   *  through them by weight instead of walking format/hook/structure axes
   *  independently. Absent (legacy bible) → bibleVideoStyles synthesizes one
   *  starter style per format kind from the old axes, so behavior is preserved
   *  without any data migration. */
  videoStyles?: VideoStyle[];
}

/** One self-contained video recipe the director can rotate to. */
export interface VideoStyle {
  id: string;
  name: string;
  /** Format kind (was one of format.kinds). */
  format: string;
  /** Narrative shape (was variationAxes.structures[]). */
  structure?: string;
  /** Opening-hook style (was variationAxes.hookStyles[]). */
  hookStyle?: string;
  cameraTreatment?: string;
  /** Length range; falls back to cadence.perFormatDuration[format]. */
  durationSec?: { min: number; max: number };
  /** Rotation share — a weight-2 style renders twice per cycle. Default 1. */
  weight?: number;
  /** Onboarding wizard's per-format tunable choices (StepTunables), keyed by
   *  tunable key -> chosen value. Passthrough-only here: the render pipeline
   *  doesn't currently read this, it's carried so draftFromBible can restore
   *  what the operator picked on a later edit/Redo without re-asking. */
  tunables?: Record<string, string>;
}

export interface RotationState { hookIdx: number; structureIdx: number; settingIdx: number; formatIdx: number; styleIdx?: number; }

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x).trim()).filter(Boolean) : [];
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const DEFAULT_CONTENT_MIX = { entertain: 60, value: 30, promo: 10 } as const;

/** Coerce a mix to non-negative percents summing 100; junk → the default. */
export function normalizeContentMix(raw: unknown): { entertain: number; value: number; promo: number } {
  const r = obj(raw);
  const e = Math.max(0, num(r.entertain, 0));
  const v = Math.max(0, num(r.value, 0));
  const p = Math.max(0, num(r.promo, 0));
  const total = e + v + p;
  if (total <= 0) return { ...DEFAULT_CONTENT_MIX };
  const entertain = Math.round((e / total) * 100);
  const value = Math.round((v / total) * 100);
  return { entertain, value, promo: 100 - entertain - value };
}

export function normalizeShowBible(raw: unknown): ShowBible | null {
  const r = obj(raw);
  const premise = str(r.premise).trim();
  const format = obj(r.format);
  const kinds = strArr(format.kinds);
  if (!premise || kinds.length === 0) return null;

  const visual = obj(r.visualWorld);
  const voice = obj(r.voice);
  const engine = obj(r.contentEngine);
  const axes = obj(r.variationAxes);
  const cadence = obj(r.cadence);

  const perFormatDuration: Record<string, { min: number; max: number }> = {};
  const pfdRaw = obj(cadence.perFormatDuration);
  for (const [k, val] of Object.entries(pfdRaw)) {
    const d = obj(val);
    const min = num(d.min, 16);
    const max = num(d.max, 32);
    perFormatDuration[k] = { min: Math.min(min, max), max: Math.max(min, max) };
  }

  const cast = Array.isArray(r.cast)
    ? r.cast.map((c) => {
        const m = obj(c);
        return { name: str(m.name).trim(), role: str(m.role).trim(), visualIdentity: str(m.visualIdentity).trim() };
      }).filter((c) => c.name)
    : [];

  const bible: ShowBible = {
    version: Math.max(1, Math.round(num(r.version, 1))),
    premise,
    format: { kinds, ...(format.rotation === "weighted" ? { rotation: "weighted" as const } : {}) },
    cast,
    visualWorld: { style: str(visual.style).trim(), settings: strArr(visual.settings), moods: strArr(visual.moods) },
    voice: {
      tone: str(voice.tone).trim(),
      ...(str(voice.language).trim() ? { language: str(voice.language).trim() } : {}),
      ...(strArr(voice.catchphrases).length ? { catchphrases: strArr(voice.catchphrases) } : {}),
    },
    contentEngine: {
      newsQueries: strArr(engine.newsQueries),
      evergreenPools: strArr(engine.evergreenPools),
      seriesArcs: engine.seriesArcs === true,
    },
    contentMix: normalizeContentMix(r.contentMix),
    variationAxes: {
      hookStyles: strArr(axes.hookStyles),
      structures: strArr(axes.structures),
      ...(strArr(axes.cameraTreatments).length ? { cameraTreatments: strArr(axes.cameraTreatments) } : {}),
    },
    cadence: {
      perFormatDuration,
      ...(num(cadence.postsPerDay, 0) > 0 ? { postsPerDay: num(cadence.postsPerDay, 1) } : {}),
    },
  };
  if (str(r.compiledFrom).trim()) bible.compiledFrom = str(r.compiledFrom).trim();

  // Video styles: keep only usable recipes — a format plus a name (id derived
  // from the name when missing). Junk rows are dropped, weight clamped to [1,10].
  if (Array.isArray(r.videoStyles)) {
    const styles: VideoStyle[] = r.videoStyles.map((raw) => {
      const m = obj(raw);
      const format = str(m.format).trim();
      const name = str(m.name).trim();
      if (!format || !name) return null;
      const id = str(m.id).trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const d = obj(m.durationSec);
      const min = num(d.min, 0);
      const max = num(d.max, 0);
      // Tunables: passthrough only — string values, unknown keys allowed (the
      // wizard's format-specific tunable set isn't fixed here), non-string
      // junk dropped rather than erroring the whole style.
      const tunablesRaw = obj(m.tunables);
      const tunables: Record<string, string> = {};
      for (const [k, v] of Object.entries(tunablesRaw)) {
        const sv = str(v).trim();
        if (sv) tunables[k] = sv;
      }
      const s: VideoStyle = {
        id, name, format,
        ...(str(m.structure).trim() ? { structure: str(m.structure).trim() } : {}),
        ...(str(m.hookStyle).trim() ? { hookStyle: str(m.hookStyle).trim() } : {}),
        ...(str(m.cameraTreatment).trim() ? { cameraTreatment: str(m.cameraTreatment).trim() } : {}),
        ...(min > 0 && max > 0 ? { durationSec: { min: Math.min(min, max), max: Math.max(min, max) } } : {}),
        weight: Math.min(10, Math.max(1, Math.round(num(m.weight, 1)))),
        ...(Object.keys(tunables).length ? { tunables } : {}),
      };
      return s;
    }).filter((s): s is VideoStyle => s !== null);
    if (styles.length) bible.videoStyles = styles;
  }

  // Archetype: only a registry id survives (unknown ids dropped, not errored —
  // an old client or a hallucinating compiler must not invalidate the bible).
  if (getArchetype(str(r.archetype).trim())) bible.archetype = str(r.archetype).trim();

  // Visual refs: keep only usable render inputs — public http(s), non-gif,
  // known kind. (Kie can't read GIFs or data: URIs; see run-task's isStill.)
  const REF_KINDS = new Set(["real-photo", "ai-sheet", "video-frame", "style-frame"]);
  const refs: ShowBibleVisualRef[] = Array.isArray(r.visualRefs)
    ? r.visualRefs.map((raw) => {
        const m = obj(raw);
        const url = str(m.url).trim();
        const kind = str(m.kind).trim();
        if (!/^https?:\/\//i.test(url) || /\.gif(\?|#|$)/i.test(url) || !REF_KINDS.has(kind)) return null;
        return {
          url,
          kind: kind as VisualRefKind,
          role: str(m.role).trim() || "style",
          ...(m.locked === true ? { locked: true } : {}),
        };
      }).filter((x): x is ShowBibleVisualRef => x !== null).slice(0, 20)
    : [];
  if (refs.length) bible.visualRefs = refs;

  return bible;
}

/**
 * Resolve the bible's IDENTITY references for a render: locked refs only,
 * filtered by the archetype's realism policy (a realistic show never gets an
 * AI-generated still as an identity ref), cast refs first in bible.cast order
 * (the lead's look IS the show), style refs fill the rest. Capped at 3 — Veo's
 * reference budget. Empty result = caller falls through to its existing
 * avatarStills/pinned-ref behavior, never fewer refs than before.
 */
export function resolveIdentityRefs(bible: ShowBible): { primary?: string; extras: string[] } {
  const allowed = new Set(identityRefKindsFor(bible.archetype));
  const usable = (bible.visualRefs ?? []).filter((r) => r.locked === true && allowed.has(r.kind));
  if (!usable.length) return { primary: undefined, extras: [] };

  const ordered: string[] = [];
  const push = (url: string) => { if (!ordered.includes(url) && ordered.length < 3) ordered.push(url); };
  for (const member of bible.cast) {
    for (const r of usable) if (r.role === `cast:${member.name}`) push(r.url);
  }
  // Cast refs whose member is no longer in the cast list still count, after the cast.
  for (const r of usable) if (r.role.startsWith("cast:")) push(r.url);
  // A dedicated art-style board (role "art-style" — Cartoon/Anime's Step 3
  // upload) REPLACES the wizard's generic face pick (role "style", often the
  // minted avatar still) entirely, not just outranks it. Both pass the
  // stylized-archetype kind filter above (ai-sheet AND style-frame are both
  // allowed), so ordering alone wasn't enough: the face pick still rode
  // along as a SECONDARY reference (bibleRefs.extras), meaning Kie still got
  // sent a real profile photo alongside the style board — "just use the
  // art-style reference, not the profile picture" was still half-true.
  // Once an explicit style board exists, the generic face pick is dropped
  // from `usable` completely; the style board is the ONLY identity/style
  // anchor sent for a stylized show.
  const hasArtStyleRef = usable.some((r) => r.role === "art-style");
  for (const r of usable) if (r.role === "art-style") push(r.url);
  for (const r of usable) if (!r.role.startsWith("cast:") && r.role !== "art-style" && !(hasArtStyleRef && r.role === "style")) push(r.url);

  return { primary: ordered[0], extras: ordered.slice(1) };
}

export function normalizeRotationState(raw: unknown): RotationState {
  const r = obj(raw);
  const idx = (v: unknown) => Math.max(0, Math.round(num(v, 0)));
  return { hookIdx: idx(r.hookIdx), structureIdx: idx(r.structureIdx), settingIdx: idx(r.settingIdx), formatIdx: idx(r.formatIdx), styleIdx: idx(r.styleIdx) };
}

/** The bible's video styles — authored `videoStyles` when present, otherwise one
 *  synthesized starter per format kind (structure/hook/camera assigned round-robin
 *  from the legacy variation axes, duration from cadence.perFormatDuration), so a
 *  legacy bible keeps rotating exactly as before with zero data migration. */
export function bibleVideoStyles(bible: ShowBible): VideoStyle[] {
  if (bible.videoStyles?.length) return bible.videoStyles;
  const axes = bible.variationAxes;
  const at = <T,>(list: T[] | undefined, i: number): T | undefined =>
    list && list.length ? list[i % list.length] : undefined;
  return bible.format.kinds.map((kind, i) => {
    const s: VideoStyle = {
      id: kind.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name: kind.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      format: kind,
      weight: 1,
    };
    const structure = at(axes.structures, i);
    const hookStyle = at(axes.hookStyles, i);
    const camera = at(axes.cameraTreatments, i);
    const dur = bible.cadence.perFormatDuration[kind];
    if (structure) s.structure = structure;
    if (hookStyle) s.hookStyle = hookStyle;
    if (camera) s.cameraTreatment = camera;
    if (dur) s.durationSec = dur;
    return s;
  });
}

/** Match an operator's ask ("make a street interview video") or an explicit id
 *  to one of the bible's video styles. Id match first, then a whole-name
 *  case-insensitive containment either way. Generic words never match — the
 *  name must appear as a phrase. Undefined when nothing matches. */
export function matchVideoStyle(bible: ShowBible, text: string): VideoStyle | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  const styles = bibleVideoStyles(bible);
  const byId = styles.find((s) => s.id.toLowerCase() === t);
  if (byId) return byId;
  return styles.find((s) => {
    const name = s.name.trim().toLowerCase();
    return name.length >= 4 && (t === name || t.includes(name) || name.includes(t));
  });
}

/** Weighted rotation order: each style repeated `weight` times. */
function expandedStyles(bible: ShowBible): VideoStyle[] {
  return bibleVideoStyles(bible).flatMap((s) => Array<VideoStyle>(Math.min(10, Math.max(1, s.weight ?? 1))).fill(s));
}

const modLen = (i: number, len: number) => (len > 0 ? (i + 1) % len : 0);

/** Deterministic variety: every production advances every axis by one. */
export function advanceRotation(state: RotationState, bible: ShowBible): RotationState {
  return {
    hookIdx: modLen(state.hookIdx, bible.variationAxes.hookStyles.length),
    structureIdx: modLen(state.structureIdx, bible.variationAxes.structures.length),
    settingIdx: modLen(state.settingIdx, bible.visualWorld.settings.length),
    formatIdx: modLen(state.formatIdx, bible.format.kinds.length),
    styleIdx: modLen(state.styleIdx ?? 0, expandedStyles(bible).length),
  };
}

const pick = <T,>(list: T[], idx: number): T | undefined => (list.length ? list[idx % list.length] : undefined);

export interface BibleDirectives {
  format: string;
  durationSeconds: number;
  brief: { format: string; angle: string; structureNotes: string; visualTreatment: string };
}

/**
 * Resolve one video's creative directives from the bible + rotation state.
 * Replaces the videoConfig style/hook/setting rolls for bible agents; the
 * duration comes from cadence.perFormatDuration for the chosen format, snapped
 * to the engine's supported length ladder.
 */
export function resolveBibleDirectives(
  bible: ShowBible,
  state: RotationState,
  opts: { durationSeconds?: number; engine?: string; styleId?: string },
): BibleDirectives {
  // Style-driven: an EXPLICIT styleId (a style-stamped idea, or the operator
  // naming a style in the copilot) pins that recipe; otherwise pick this
  // production's recipe by weighted rotation. Legacy states (no styleIdx) fall
  // back to formatIdx, which maps 1:1 onto the synthesized per-format starter
  // styles — old bibles behave exactly as before.
  const expanded = expandedStyles(bible);
  const pinned = opts.styleId ? bibleVideoStyles(bible).find((s) => s.id === opts.styleId) : undefined;
  const style = pinned
    ?? (expanded.length ? expanded[(state.styleIdx ?? state.formatIdx) % expanded.length] : undefined);
  const format = style?.format ?? pick(bible.format.kinds, state.formatIdx) ?? bible.format.kinds[0];
  // The Director's per-format length (cadence.perFormatDuration) is the
  // operator's knob and WINS; a style's own durationSec is only the seed for
  // formats the operator never set. Before this, style.durationSec won and a
  // "make it 5s" edit (BIBLE_PATCH setFormatDuration → cadence only) or a
  // wizard slider change was silently ignored — the "picked 5s, got 20s" bug.
  const range = bible.cadence.perFormatDuration[format] ?? style?.durationSec ?? { min: 16, max: 32 };
  const steps = videoLengthStepsForEngine((opts.engine as VideoEngineId | undefined) ?? undefined);
  const hi = Math.min(60, Math.max(range.min, range.max));
  // `hi` (the format's own configured max) is the hard ceiling — see the
  // matching fix/comment in lib/builder/videoDirector.ts's resolveVideoDirectives.
  // Without capping the engine floor at `hi`, a format saved as "5s max" while
  // resolved against an engine whose floor sits above it (Veo/Omni's 10s) made
  // `lo > hi`, and the clamp below degenerated to `lo` — silently discarding
  // the configured max and producing an oversized autonomous render.
  const lo = Math.min(hi, Math.max(steps[0] ?? 5, Math.min(range.min, range.max)));
  const requested = typeof opts.durationSeconds === "number" ? opts.durationSeconds : Math.round((lo + hi) / 2);
  const clamped = Math.max(lo, Math.min(hi, requested));
  const inLadder = steps.filter((s) => s >= lo && s <= hi);
  const durationSeconds = inLadder.length
    ? inLadder.reduce((best, s) => (Math.abs(s - clamped) < Math.abs(best - clamped) ? s : best), inLadder[0])
    : clamped;

  // The style's own recipe pins hook/structure/camera; anything the style leaves
  // unset keeps rotating through the legacy axes for per-video variety.
  const hook = style?.hookStyle ?? pick(bible.variationAxes.hookStyles, state.hookIdx);
  const structure = style?.structure ?? pick(bible.variationAxes.structures, state.structureIdx);
  const setting = pick(bible.visualWorld.settings, state.settingIdx);
  const mood = pick(bible.visualWorld.moods, state.settingIdx);
  const camera = style?.cameraTreatment ?? pick(bible.variationAxes.cameraTreatments ?? [], state.settingIdx);

  const structureNotes = [
    structure ? `Narrative structure: ${structure}` : "",
    hook ? `Hook style: ${hook}` : "",
    bible.voice.tone ? `Voice: ${bible.voice.tone}` : "",
    bible.voice.catchphrases?.length ? `Signature lines available: ${bible.voice.catchphrases.join(" / ")}` : "",
  ].filter(Boolean).join(". ");
  const visualTreatment = [
    bible.visualWorld.style,
    setting ? `set in: ${setting}` : "",
    mood ? `mood: ${mood}` : "",
    camera ?? "",
    bible.cast.length ? `recurring cast (keep visual identity EXACT): ${bible.cast.map((c) => `${c.name} — ${c.visualIdentity}`).join("; ")}` : "",
  ].filter(Boolean).join(", ");

  return {
    format,
    durationSeconds,
    brief: { format, angle: hook ?? "fresh angle on the premise", structureNotes, visualTreatment },
  };
}
