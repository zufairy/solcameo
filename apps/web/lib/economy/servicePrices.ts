export type Service = "render" | "image_gen" | "llm_message" | "social_post" | "transcription";

/** USDC list price per unit of each metered service. Tunable. Spec §6.1. */
export const SERVICE_PRICES: Record<Service, number> = {
  render: 0.40,
  image_gen: 0.05,
  llm_message: 0.003,
  social_post: 0.05,
  transcription: 0.10,
};

/**
 * Per-RUN clip-skill fees ("skills-only" pricing): installing a skill is free;
 * the fee is charged once per run for each skill wired into the pipeline.
 * Demand/compute-graded $0.10–$0.43. Clip-render + transcription compute is
 * absorbed into this margin (not billed separately). Shared by the server
 * charge path (priceFor below) AND the marketplace / budget UI.
 */
export const CLIP_SKILL_PRICE_USDC: Record<string, number> = {
  "clip.facetrack": 0.43,     // vision API + premium auto-reframe
  "clip.captions": 0.40,      // core viral feature
  "clip.filters": 0.15,       // color grade (light ffmpeg color chain)
  "clip.trendingaudio": 0.15, // curated music library + auto-by-mood bed
  "clip.transitions": 0.12,   // ffmpeg xfade at the clip seams (light re-encode)
  "clip.hook": 0.35,          // LLM hook line
  "clip.keywords": 0.30,      // trendy retention
  "clip.prompt": 0.28,        // LLM targeting
  "clip.zoom": 0.25,          // high-energy
  "clip.fillercut": 0.20,     // pacing
  "clip.meme": 0.18,          // comedic overlay
  // clip.speed is FREE: the ffmpeg graph (lib/server/clipFilterGraph.ts) STRIPS
  // every "speed" emphasis op (setpts would retime video only → desyncs audio +
  // burned captions), so the op currently renders nothing. Charging for a dead op
  // is dishonest billing. Restore the price (~0.15) once speed is actually
  // implemented (atempo on audio + caption-timestamp scaling / -shortest).
  "clip.speed": 0,            // pacing — see note above; $0 until speed renders
  "clip.title": 0.12,         // title slate
  "clip.campaignscout": 0.10, // niche targeting
  // Wired skills that currently run FREE. They were ABSENT from this map before,
  // so `clipSkillRunCost`/`priceFor` already treated them as $0 (via `?? 0`) — but
  // absence ALSO hid them from the admin marketplace/pricing table (which iterates
  // THIS map). Listing them explicitly at 0 surfaces them there + lets an admin set
  // a price, while keeping runtime billing byte-for-byte identical ($0 until priced).
  "clip.brainrot": 0,      // brainrot caption-style variant
  "clip.captionstyle": 0,  // caption styling preset
  "clip.memeaudio": 0,     // meme audio bed
  "clip.reactionsfx": 0,   // reaction SFX overlay
  "clip.sticker": 0,       // sticker overlay
  "clip.style": 0,         // visual style preset

  // Base clipping fee — priced by SOURCE VIDEO LENGTH, OpusClip-style ("How Do
  // Credits Work?", help.opus.pro: 1 credit per minute of source, regardless
  // of how many clips come out of it), not a flat per-run fee. Billed as
  // `qty = ceil(minutes)` against this per-unit price (see
  // lib/economy/clipCreditPricing.ts) through the SAME recordUsage /
  // decideSkillChargeGate machinery every other clip-skill fee uses — it
  // lives in THIS map (not SERVICE_PRICES) so it inherits admin overrides +
  // the marketplace pricing table for free, and its refund-on-zero-clips path
  // for free too (clipChargeGate keys refunds on the SAME `:skill:` idemKey
  // prefix regardless of which map priced the id).
  //
  // $0.02/min is ~5x the verified real cost of getting from "1 hour of
  // source" to "ranked, captioned clip moments" — $0.2206/hr ElevenLabs
  // Scribe transcription (live account billing, measured 2026-09-22: $30 for
  // 136h) plus ~$0.01/hr Gemini 3.6 Flash moment analysis via Kie (real
  // $0.225 / $1.125 per 1M input/output tokens) — while staying far cheaper
  // per minute than OpusClip's own effective ~$0.05–0.10/min on its paid
  // plans.
  //
  // This REPLACES the old "skills-only, $0 with nothing wired" clipping
  // charge: the Editor tab (the current clipping surface — the node-canvas
  // skill-wiring UI it replaced is retired) never wires marketplace skill
  // nodes, so every Editor-tab run used to charge $0 while still costing
  // Vello real money. Marketplace skills (hook, filters, trending audio, …)
  // remain OPTIONAL add-ons billed the same flat per-run way as before, on
  // top of this base fee.
  "clip_source_minute": 0.02,
};

/** The synthetic "skill" id the base per-minute clipping fee is billed under
 *  (see the map entry above). Not a real marketplace skill — never wired by
 *  an operator — but charged through the identical recordUsage path. */
export const CLIP_SOURCE_MINUTE_ID = "clip_source_minute";

/** Per-run cost of the skills wired into a run (deduped; unknown ids = $0). */
export function clipSkillRunCost(skillIds: string[]): number {
  const uniq = [...new Set(skillIds)];
  return +uniq.reduce((s, id) => s + (CLIP_SKILL_PRICE_USDC[id] ?? 0), 0).toFixed(6);
}

/* ── Admin-overridable prices (marketplace skill pricing tab) ───────────────
 * The maps above are the STATIC defaults. An admin can override any skill's
 * per-run price via the `skillPriceOverrides` Convex table; a row = an override,
 * absence = use the static default. servicePrices.ts stays a PURE module (it is
 * imported by client + server), so the DB override lookup happens in the Convex
 * charge path and is threaded into the pure helpers below as `override` args. */

/** Upper bound for an admin-set price — a fat-finger guard so a mis-typed value
 *  can't charge an agent an absurd amount. Prices are per-run USDC. */
export const MAX_SKILL_PRICE_USDC = 100;

/** Metered SERVICE ids (keys of SERVICE_PRICES — NOT clip skills) that are ALSO
 *  admin-overridable in the Pricing tab, listed alongside the clip skills. Their
 *  static default is SERVICE_PRICES[id]. Start with the auto-post fee: the post
 *  charge path (agentTasks.succeed → effectivePostCostUsdc) reads the SAME
 *  "social_post" override key, so an admin edit here changes what a publish costs. */
export const PRICEABLE_SERVICE_IDS: string[] = ["social_post"];

/** True when `p` is a valid admin-set price: a finite number in [0, cap]. */
export function isValidSkillPrice(p: unknown): p is number {
  return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= MAX_SKILL_PRICE_USDC;
}

/** Static list price (unit) for a service or clip-skill id; undefined = unknown. */
export function staticUnitPrice(service: string): number | undefined {
  return (SERVICE_PRICES as Record<string, number>)[service] ?? CLIP_SKILL_PRICE_USDC[service];
}

/** Effective unit price = a VALID admin override, else the static default.
 *  Returns undefined only when the id is unknown AND unoverridden. Pure — the
 *  caller (a Convex mutation) reads the override row and passes it in. */
export function effectiveUnitPrice(service: string, override?: number): number | undefined {
  if (override !== undefined && isValidSkillPrice(override)) return override;
  return staticUnitPrice(service);
}

/** USDC to debit for a `post_content` task, honoring an admin override of the
 *  social_post (auto-post) fee. The run-task post executor emits the STATIC
 *  SERVICE_PRICES.social_post on a REAL publish, and a small floor cost (e.g.
 *  $0.001) on a failed/partial post. Only a full-fee publish is re-priced to the
 *  effective (valid override ?? default) fee; any other `rawCost` — the failed-post
 *  floor — is billed exactly as-is, so a failed post never pays the full override.
 *  Pure: the Convex charge mutation reads the override row and passes it in. */
export function effectivePostCostUsdc(rawCost: number, override?: number): number {
  if (rawCost !== SERVICE_PRICES.social_post) return rawCost;
  const eff = effectiveUnitPrice("social_post", override);
  return eff === undefined ? rawCost : +eff.toFixed(6);
}

/** `priceFor` with an admin override applied to the unit price. Same validation
 *  + rounding as `priceFor`; the single money-computing helper the charge path
 *  (usage.recordUsage) uses so overrides flow to every metered charge. */
export function priceForWithOverride(service: string, qty: number, override?: number): number {
  const unit = effectiveUnitPrice(service, override);
  if (unit === undefined) throw new Error(`unknown service: ${service}`);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("qty must be a positive number");
  return +(unit * qty).toFixed(6);
}

/** Per-run clip-skill cost honoring admin overrides (deduped; unknown ids = $0).
 *  `overrides` maps skillId → override price; a skill absent from the map uses its
 *  static default. Mirrors `clipSkillRunCost` so the pre-flight estimate matches
 *  what usage.recordUsage actually charges. */
export function clipSkillRunCostWithOverrides(skillIds: string[], overrides: Record<string, number>): number {
  const uniq = [...new Set(skillIds)];
  return +uniq.reduce((s, id) => {
    const ov = overrides[id];
    const unit = ov !== undefined && isValidSkillPrice(ov) ? ov : (CLIP_SKILL_PRICE_USDC[id] ?? 0);
    return s + unit;
  }, 0).toFixed(6);
}

/** Format a per-run price as a marketplace label ("$0.12 / run" or "Free"). */
export function priceLabelFromUsdc(p?: number): string {
  return typeof p === "number" && p > 0 ? `$${p.toFixed(2)} / run` : "Free";
}

/** Marketplace label for a skill's STATIC per-run price. For the admin-override-
 *  aware label, pass the effective price to `priceLabelFromUsdc` instead. */
export function clipSkillPriceLabel(skillId: string): string {
  return priceLabelFromUsdc(CLIP_SKILL_PRICE_USDC[skillId]);
}

/** Total USDC cost for `qty` units of a service (or a clip-skill id). Throws on unknown. */
export function priceFor(service: string, qty: number): number {
  const unit = (SERVICE_PRICES as Record<string, number>)[service] ?? CLIP_SKILL_PRICE_USDC[service];
  if (unit === undefined) throw new Error(`unknown service: ${service}`);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("qty must be a positive number");
  return +(unit * qty).toFixed(6);
}
