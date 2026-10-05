import { CLIP_SKILL_PRICE_USDC } from "../economy/servicePrices";

/**
 * #23 (free-skilled-clips): server-side inversion of the clip skill→op registry
 * so /api/video/clip can bill from the `ops` it actually renders instead of
 * trusting the client to declare its skills.
 *
 * The forward map is SKILL_OP_KINDS (lib/server/clipEditPlanner.ts) + each
 * skill's floor() (lib/builder/clipSkillsCatalog.ts). Inverting it is LOSSY:
 * several op kinds have both PRICED and FREE emitters, and charging those would
 * MIS-CHARGE real users whose run legitimately came from the free sibling —
 * the precheck idemKey only dedups skills that were actually charged at
 * run-start, so a wrong inversion is a FRESH charge, not a no-op:
 *
 *  - `subtitles`   ← clip.captions ($0.40) but ALSO the built-in Captions node
 *                    (free, compile-graph captionsOn), clip.captionstyle,
 *                    clip.keywords, clip.style.* — style markers are forgeable
 *                    and the built-in node's output is marker-identical.
 *  - `text_overlay`← clip.hook ($0.35) / clip.meme ($0.18) / clip.sticker (free).
 *                    The startSec slots (0 / 0.3 / ≥1) only disambiguate FLOOR
 *                    ops, not LLM-planned ones. The priced value (the LLM hook/
 *                    meme copy) is delivered at PLAN time anyway — the render is
 *                    just drawtext.
 *  - `audio_overlay`← clip.trendingaudio ($0.15) / clip.memeaudio (free).
 *  - `composite_bg` ← clip.brainrot (unpriced today).
 *
 * So the CHARGE map below carries ONLY ops emitted exclusively by one priced
 * skill; the ambiguous kinds instead require a billing IDENTITY (the route's
 * fail-closed 402 gate via opsRequireBillingIdentity) without being charged.
 * Under-charging is the agent's favor — the same stance clip-precheck documents.
 */
export const EXCLUSIVE_PRICED_SKILL_BY_OP: Record<string, string> = {
  face_reframe: "clip.facetrack", // $0.43 — vision face-detect runs in THIS route
  remove_fillers: "clip.fillercut",
  color_filter: "clip.filters",
  title_card: "clip.title",
  blur_frame: "clip.zoom", // Zoom Punch's blurred full-person framing (free today; gated by price)
};

/** `emphasis` is one op kind shared by zoom/speed — the op's `kind` field is the
 *  planner's own disambiguator (SKILL_OP_KINDS keys `emphasis:zoom_punch` /
 *  `emphasis:speed`). Only zoom_punch is priced; speed is stripped by the ffmpeg
 *  graph and deliberately $0 (servicePrices.ts), freeze maps to no skill. */
export const EXCLUSIVE_PRICED_SKILL_BY_EMPHASIS_KIND: Record<string, string> = {
  zoom_punch: "clip.zoom",
};

/** Op kinds that are skill output but can't be safely charged (see above): they
 *  still must not render for free-with-no-identity, so they trip the 402 gate. */
const AMBIGUOUS_SKILL_OP_KINDS = new Set(["subtitles", "text_overlay", "audio_overlay", "composite_bg"]);

/** Body `ops` is untrusted/unknown — normalize to op-shaped rows, drop garbage. */
function opRows(ops: unknown): { op?: unknown; kind?: unknown }[] {
  return Array.isArray(ops) ? (ops.filter((o) => o && typeof o === "object") as { op?: unknown; kind?: unknown }[]) : [];
}

/** The priced skill ids provably rendered by these ops (deduped). Guarded by the
 *  live price table so a future re-pricing to $0 stops the charge (and never
 *  feeds priceFor an id it would throw on). */
export function derivePricedSkillsFromOps(ops: unknown): string[] {
  const out = new Set<string>();
  for (const o of opRows(ops)) {
    const kind = typeof o.op === "string" ? o.op : "";
    const skillId = kind === "emphasis"
      ? EXCLUSIVE_PRICED_SKILL_BY_EMPHASIS_KIND[typeof o.kind === "string" ? o.kind : ""]
      : EXCLUSIVE_PRICED_SKILL_BY_OP[kind];
    if (skillId && CLIP_SKILL_PRICE_USDC[skillId] > 0) out.add(skillId);
  }
  return [...out];
}

/** True when the ops contain ANY skill-class render (priced-derivable OR an
 *  ambiguous kind) — the route then refuses to render without a billing
 *  identity (mintAddress or draft sessionId). Plain cuts (reframe/logo_overlay
 *  only) stay identity-free. */
export function opsRequireBillingIdentity(ops: unknown): boolean {
  if (derivePricedSkillsFromOps(ops).length > 0) return true;
  return opRows(ops).some((o) => typeof o.op === "string" && AMBIGUOUS_SKILL_OP_KINDS.has(o.op));
}
