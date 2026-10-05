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
const GENERATION_FEE_MILLS = 1000;
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
  return (
    Math.ceil(
      (Math.ceil(duration) * RATE_MILLS[resolution] + GENERATION_FEE_MILLS) /
        10,
    ) / 100
  );
}
export function formatGenerationUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}
