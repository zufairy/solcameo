/** Published Genjutsu motion-transfer rates, checked 2026-10-06.
 * https://open.higgsfield.ai/models/higgsfield/genjutsu/motion-transfer/v1.0/playground
 * Provider rounds input duration up to whole seconds; rates exclude account discounts.
 */
export const GENJUTSU_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export type GenjutsuResolution = (typeof GENJUTSU_RESOLUTIONS)[number];
const RATE_MILLS: Record<GenjutsuResolution, number> = {
  "480p": 318,
  "720p": 681,
  "1080p": 1632,
};
/** Solcameo's fee on top of the Higgsfield rate: 15% of the provider cost, the same markup as every other generation. Single source of truth for UI and billing. */
export const SOLCAMEO_MARKUP_PCT = 15;
export function solcameoMarkupMills(providerMills: number): number {
  return Math.ceil((providerMills * SOLCAMEO_MARKUP_PCT) / 100);
}
export function estimateGenerationUsd(
  duration: number,
  resolution: GenjutsuResolution,
): number | null {
  if (
    !Number.isFinite(duration) ||
    duration < 4 ||
    duration > 30 ||
    !(resolution in RATE_MILLS)
  )
    return null;
  const providerMills = Math.ceil(duration) * RATE_MILLS[resolution];
  return Math.ceil((providerMills + solcameoMarkupMills(providerMills)) / 10) / 100;
}
export function formatGenerationUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}
