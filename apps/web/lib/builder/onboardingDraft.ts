/** Onboarding wizard draft — the wizard's state, mapped 1:1 onto the show
 *  bible. Pure: the UI dispatches into this, the commit route persists
 *  draftToBible() through influencers.setShowBible. Spec: phase-2 wizard. */
import { formatById, clampFormatDuration, clampWizardDuration, VIDEO_FORMATS } from "./formatCatalog";
import type { ShowBible } from "./showBible";

export interface OnboardingDraft {
  premise: string;
  archetype: string;
  formats: string[];                              // catalog ids, rank order
  perFormatDuration: Record<string, number>;      // chosen seconds per format
  tunables: Record<string, Record<string, string>>; // formatId -> key -> choice
  tone: string;
  language: string;
  energy: string;
  postsPerDay: number;
  /** Chosen render engine (VIDEO_ENGINES id). "" = use the suggested engine
   *  (top-ranked format's first engine). Picked in Step 2's engine dropdown. */
  engine: string;
  /** The influencer's LOCKED look — a photo picked from the agent's minted
   *  stills or uploaded by the operator (Step "Pick the face"). Persisted as
   *  the bible's primary locked visualRef so every render (and Gemini Omni's
   *  image reference) anchors to this exact image. "" = keep whatever refs
   *  the bible already has. */
  identityImageUrl: string;
  /** How the identity image was sourced — decides the visualRef `kind`:
   *  an upload is a real photo, a minted still is an AI sheet. */
  identityImageKind: "" | "real-photo" | "ai-sheet";
  /** Portrait vs landscape — lives on the agent's videoConfig, not the bible
   *  (setVideoConfig, same field VideoDirectorTab's ASPECT_OPTIONS picker
   *  writes), so draftToBible does not touch it; the wizard's commit route
   *  saves it as a sibling write alongside the bible. */
  aspectRatio: "9:16" | "16:9";
  /** Art-style reference image (Cartoon/Anime) — an uploaded style board
   *  ("what kind of cartoon do I want") distinct from the identity/face ref
   *  above. Persisted as its OWN locked visualRef (role "art-style", kind
   *  "style-frame" — passes every archetype's realism policy, including
   *  "any", which is what an unset/custom archetype resolves to) so
   *  resolveIdentityRefs feeds it into the render alongside any cast/face
   *  refs. "" = keep whatever the bible already has. */
  styleReferenceUrl: string;
}

export function emptyDraft(): OnboardingDraft {
  return { premise: "", archetype: "", formats: [], perFormatDuration: {}, tunables: {}, tone: "", language: "", energy: "", postsPerDay: 1, engine: "", identityImageUrl: "", identityImageKind: "", aspectRatio: "9:16", styleReferenceUrl: "" };
}

export function draftFromBible(bible: ShowBible | null | undefined): OnboardingDraft {
  if (!bible) return emptyDraft();
  const formats = (bible.format?.kinds ?? []).filter((k) => formatById(k));
  const perFormatDuration: Record<string, number> = {};
  for (const id of formats) {
    const r = bible.cadence?.perFormatDuration?.[id];
    if (r) perFormatDuration[id] = clampFormatDuration(id, Math.round((r.min + r.max) / 2));
  }
  const [tone = "", energy = ""] = (bible.voice?.tone ?? "").split(" · ");
  // Restore each format's tunables from its videoStyles entry — the same
  // entry draftToBible writes them onto below, keyed by format id (the
  // videoStyle's own `id` IS the format id for a wizard-authored bible).
  const tunables: Record<string, Record<string, string>> = {};
  for (const id of formats) {
    const style = bible.videoStyles?.find((s) => s.id === id);
    if (style?.tunables && Object.keys(style.tunables).length) tunables[id] = { ...style.tunables };
  }
  // Restore the wizard-picked face: the first locked "style"-role visual ref
  // whose kind matches what the face step writes (real-photo upload or
  // ai-sheet minted still).
  const faceRef = (bible.visualRefs ?? []).find(
    (r) => r.locked === true && r.role === "style" && (r.kind === "real-photo" || r.kind === "ai-sheet"),
  );
  const styleRef = (bible.visualRefs ?? []).find((r) => r.locked === true && r.role === "art-style");
  return {
    premise: bible.premise ?? "",
    archetype: bible.archetype ?? "",
    formats,
    perFormatDuration,
    tunables,
    tone, energy,
    language: bible.voice?.language ?? "",
    postsPerDay: bible.cadence?.postsPerDay ?? 1,
    engine: "", // engine lives on the agent doc (videoEngine), not the bible
    identityImageUrl: faceRef?.url ?? "",
    identityImageKind: faceRef ? (faceRef.kind as "real-photo" | "ai-sheet") : "",
    aspectRatio: "9:16", // overridden by OnboardingWizard's initialAspectRatio prop (videoConfig, not the bible)
    styleReferenceUrl: styleRef?.url ?? "",
  };
}

export function draftToBible(draft: OnboardingDraft, existing?: ShowBible | null): ShowBible {
  const perFormatDuration: ShowBible["cadence"]["perFormatDuration"] = { ...(existing?.cadence?.perFormatDuration ?? {}) };
  for (const id of draft.formats) {
    // Engine-aware clamp: a 5s Grok test length (Step 3's engine floor) must
    // survive the save — clampFormatDuration would push it back up.
    const v = clampWizardDuration(id, draft.engine || undefined, draft.perFormatDuration[id]);
    perFormatDuration[id] = { min: v, max: v };
  }
  const tone = [draft.tone, draft.energy].filter(Boolean).join(" · ") || existing?.voice?.tone || "engaging";
  // Face step: the picked/uploaded photo becomes the bible's FIRST locked
  // "style" visual ref (resolveIdentityRefs makes the first ref the primary
  // render reference). Other existing refs are kept; a previous wizard face
  // (same role+kind family, different url) is replaced, not accumulated.
  const withoutFaceRef = draft.identityImageUrl
    ? [
        { url: draft.identityImageUrl, kind: (draft.identityImageKind || "real-photo") as "real-photo" | "ai-sheet", role: "style", locked: true as const },
        ...(existing?.visualRefs ?? []).filter(
          (r) => r.url !== draft.identityImageUrl && !(r.role === "style" && (r.kind === "real-photo" || r.kind === "ai-sheet") && r.locked === true),
        ),
      ]
    : (existing?.visualRefs ?? []);
  // Art-style board (Cartoon/Anime) — a SEPARATE locked ref from the face
  // above (role "art-style", never "style", so the two never collide/overwrite
  // each other). "style-frame" kind passes every archetype's realism policy.
  const visualRefs = draft.styleReferenceUrl
    ? [
        ...withoutFaceRef.filter((r) => !(r.role === "art-style" && r.locked === true)),
        { url: draft.styleReferenceUrl, kind: "style-frame" as const, role: "art-style", locked: true as const },
      ]
    : withoutFaceRef;
  return {
    version: existing?.version ?? 1,
    compiledFrom: "onboarding-wizard",
    archetype: draft.archetype || existing?.archetype,
    visualRefs,
    premise: draft.premise || existing?.premise || "",
    format: { kinds: draft.formats.length ? draft.formats : existing?.format?.kinds ?? [], rotation: "weighted" },
    cast: existing?.cast ?? [],
    visualWorld: existing?.visualWorld ?? { style: "clean modern", settings: [], moods: [] },
    voice: { tone, language: draft.language || existing?.voice?.language, catchphrases: existing?.voice?.catchphrases },
    contentEngine: existing?.contentEngine ?? { newsQueries: [], evergreenPools: [], seriesArcs: false },
    contentMix: existing?.contentMix ?? { entertain: 60, value: 30, promo: 10 },
    variationAxes: existing?.variationAxes ?? { hookStyles: [], structures: [] },
    cadence: { perFormatDuration, postsPerDay: draft.postsPerDay },
    videoStyles: draft.formats.map((id, i) => ({
      id, name: formatById(id)?.name ?? id, format: id,
      weight: draft.formats.length - i,
      ...(draft.perFormatDuration[id] ? { durationSec: { min: clampWizardDuration(id, draft.engine || undefined, draft.perFormatDuration[id]), max: clampWizardDuration(id, draft.engine || undefined, draft.perFormatDuration[id]) } } : {}),
      // I1: persist this format's tunable choices (StepTunables, keyed by
      // format id) onto its videoStyle entry — draftFromBible reads them back
      // out from here so a Redo/edit round-trips what was picked in Step 3.
      ...(draft.tunables[id] && Object.keys(draft.tunables[id]).length ? { tunables: { ...draft.tunables[id] } } : {}),
    })),
  } as ShowBible;
}

export function draftStepComplete(draft: OnboardingDraft, step: number): boolean {
  switch (step) {
    case 1: return draft.premise.trim().length > 0;
    case 2: return true;  // face pick optional — minted avatar remains the fallback
    case 3: return draft.formats.length >= 1 && draft.formats.length <= 3 && draft.formats.every((f) => formatById(f));
    case 4: return true;  // tunables optional
    case 5: return !!draft.tone && !!draft.language;
    case 6: return draft.postsPerDay >= 1;
    default: return true;
  }
}

export const WIZARD_FORMATS = VIDEO_FORMATS.filter((f) => f.pipeline !== "clipping");
