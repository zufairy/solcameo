/**
 * Exact Kie.ai video pricing, taken from Kie's own pricing feed (api.kie.ai/client/v1/model-pricing/page,
 * the data behind kie.ai/pricing), checked 2026-10-06. Kie sells credits at $0.005 each, so every number
 * below is Kie's credit price, never a guess. Retail = provider cost plus the Solcameo fee (RETAIL_MARKUP),
 * applied by callers via `videoCostForLength`.
 *
 * Rows used: the "no video input" rows (we only ever send images), and Seedance 1.5 Pro "without audio",
 * because the render does not request audio (Kie's `generate_audio` defaults to false).
 */
export const KIE_CREDIT_USD = 0.005;

export type VideoQuality = "480p" | "720p" | "1080p" | "4k";

export interface KieVideoPricing {
  /** Qualities the render actually requests from Kie for this model. */
  qualities: VideoQuality[];
  defaultQuality: VideoQuality;
  /** Lengths offered in the dropdown, in seconds. Longer videos are stitched from several clips. */
  durations: number[];
  /** Kie credits to render `seconds` of finished video at `quality`. */
  credits(quality: VideoQuality, seconds: number): number;
}

const perSecond = (rates: Partial<Record<VideoQuality, number>>, floorSeconds = 1) =>
  (quality: VideoQuality, seconds: number) => Math.max(seconds, floorSeconds) * (rates[quality] ?? rates["720p"] ?? 0);

/** Gemini Omni bills per clip by length and resolution. 720p and 1080p cost the same. */
const OMNI_CLIP: Record<"hd" | "4k", Record<number, number>> = {
  hd: { 4: 63, 6: 84, 8: 105, 10: 126 },
  "4k": { 4: 147, 6: 168, 8: 189, 10: 210 },
};
function omniCredits(quality: VideoQuality, seconds: number) {
  const table = OMNI_CLIP[quality === "4k" ? "4k" : "hd"];
  let remaining = Math.max(seconds, 4);
  let total = 0;
  while (remaining > 0) {
    const clip = Math.min(10, remaining);
    total += table[[4, 6, 8, 10].find((s) => s >= clip) ?? 10];
    remaining -= clip;
  }
  return total;
}

/** Veo 3.1 Fast renders fixed 8s clips (video extensions bill the same as the base clip). */
const VEO_FAST_CLIP: Partial<Record<VideoQuality, number>> = { "720p": 60, "1080p": 65, "4k": 180 };

export const KIE_VIDEO_PRICING: Record<string, KieVideoPricing> = {
  // Grok Imagine image-to-video: 2.4 credits/s at 480p, 4.5 at 720p. The 6s+ extend model bills the same per second.
  "grok-imagine-15": {
    qualities: ["480p", "720p"], defaultQuality: "720p", durations: [6, 10, 15, 20, 30],
    credits: perSecond({ "480p": 2.4, "720p": 4.5 }, 6),
  },
  // Seedance 2.0 Fast, no video input: 11.7 credits/s at 480p, 24.8 at 720p.
  "seedance-v2": {
    qualities: ["480p", "720p"], defaultQuality: "720p", durations: [5, 8, 10, 15, 20],
    credits: perSecond({ "480p": 11.7, "720p": 24.8 }, 5),
  },
  // Seedance 1.5 Pro, without audio: 3.5 credits/s at 720p, 7.5 at 1080p.
  "seedance-1-5-pro": {
    qualities: ["720p", "1080p"], defaultQuality: "720p", durations: [4, 8, 12, 24, 36],
    credits: perSecond({ "720p": 3.5, "1080p": 7.5 }, 4),
  },
  "gemini-omni": {
    qualities: ["720p", "1080p", "4k"], defaultQuality: "720p", durations: [4, 6, 8, 10, 20, 30],
    credits: omniCredits,
  },
  // Hidden from pickers but still billable when an agent is already configured on them.
  "veo3-fast": {
    qualities: ["720p", "1080p", "4k"], defaultQuality: "720p", durations: [8, 16, 24, 32],
    credits: (quality, seconds) => Math.ceil(Math.max(seconds, 1) / 8) * (VEO_FAST_CLIP[quality] ?? 60),
  },
  "kling-v3": {
    qualities: ["720p", "1080p"], defaultQuality: "720p", durations: [5, 10],
    credits: perSecond({ "720p": 14, "1080p": 18 }, 5),
  },
};

/** Provider cost in USD for one finished video, or null when this engine has no Kie price table. */
export function kieProviderCostUsd(engineId: string, seconds: number, quality?: VideoQuality): number | null {
  const spec = KIE_VIDEO_PRICING[engineId === "grok-imagine-10" ? "grok-imagine-15" : engineId];
  if (!spec || seconds <= 0) return spec ? 0 : null;
  const q = quality && spec.qualities.includes(quality) ? quality : spec.defaultQuality;
  return spec.credits(q, seconds) * KIE_CREDIT_USD;
}
