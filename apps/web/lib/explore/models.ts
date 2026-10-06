import { getVideoEngine, videoCostForLength, type VideoEngineId } from "@/lib/builder/agentTypes";
import { KIE_VIDEO_PRICING, type VideoQuality } from "@/lib/builder/kieVideoPricing";
import { estimateGenerationUsd, GENJUTSU_RESOLUTIONS, type GenjutsuResolution } from "./generationPrice";

export type ExploreModelId = "genjutsu-motion" | "genjutsu-object" | "grok-imagine-15" | "seedance-v2" | "seedance-1-5-pro" | "gemini-omni" | "veo3-fast";

export interface ExploreModel {
  id: ExploreModelId;
  label: string;
  /** Genjutsu copies the reference's motion onto your character; the others are image-to-video models steered by a prompt. */
  kind: "genjutsu" | "engine";
  mode?: "motion-transfer" | "object-swap";
  engine?: VideoEngineId;
  qualities: readonly string[];
  defaultQuality: string;
  blurb: string;
}

export const EXPLORE_MODELS: ExploreModel[] = [
  { id: "genjutsu-motion", label: "Genjutsu · Motion transfer", kind: "genjutsu", mode: "motion-transfer", qualities: GENJUTSU_RESOLUTIONS, defaultQuality: "720p", blurb: "Copies this clip's exact motion onto your influencer." },
  { id: "genjutsu-object", label: "Genjutsu · Object swap", kind: "genjutsu", mode: "object-swap", qualities: GENJUTSU_RESOLUTIONS, defaultQuality: "720p", blurb: "Keeps the clip and swaps in your influencer." },
  { id: "grok-imagine-15", label: "Grok Imagine", kind: "engine", engine: "grok-imagine-15", qualities: KIE_VIDEO_PRICING["grok-imagine-15"].qualities, defaultQuality: KIE_VIDEO_PRICING["grok-imagine-15"].defaultQuality, blurb: "Expressive image-to-video from your portrait, in the spirit of the reference." },
  { id: "veo3-fast", label: "Veo 3.1 Fast", kind: "engine", engine: "veo3-fast", qualities: KIE_VIDEO_PRICING["veo3-fast"].qualities, defaultQuality: KIE_VIDEO_PRICING["veo3-fast"].defaultQuality, blurb: "Google Veo with strong character lock and native audio." },
  { id: "seedance-v2", label: "Seedance 2.0 Fast", kind: "engine", engine: "seedance-v2", qualities: KIE_VIDEO_PRICING["seedance-v2"].qualities, defaultQuality: KIE_VIDEO_PRICING["seedance-v2"].defaultQuality, blurb: "Smooth motion and a tight identity lock." },
  { id: "seedance-1-5-pro", label: "Seedance 1.5 Pro", kind: "engine", engine: "seedance-1-5-pro", qualities: KIE_VIDEO_PRICING["seedance-1-5-pro"].qualities, defaultQuality: KIE_VIDEO_PRICING["seedance-1-5-pro"].defaultQuality, blurb: "Cinematic camera work at a low price." },
  { id: "gemini-omni", label: "Gemini Omni", kind: "engine", engine: "gemini-omni", qualities: KIE_VIDEO_PRICING["gemini-omni"].qualities, defaultQuality: KIE_VIDEO_PRICING["gemini-omni"].defaultQuality, blurb: "Google's multimodal model with native audio." },
];

export const modelById = (id: string): ExploreModel => EXPLORE_MODELS.find((m) => m.id === id) ?? EXPLORE_MODELS[0];

/** The quality to use for `model`: the pick if the model sells it, else its default. */
export function qualityFor(model: ExploreModel, quality: string): string {
  return model.qualities.includes(quality) ? quality : model.defaultQuality;
}

/** The length (seconds) a Kie model renders for a reference: the first offered length that covers it. */
export function engineSeconds(model: ExploreModel, duration: number): number {
  const options = model.engine ? KIE_VIDEO_PRICING[model.engine]?.durations ?? [] : [];
  const rounded = Math.max(1, Math.ceil(duration));
  return options.find((d) => d >= rounded) ?? options[options.length - 1] ?? rounded;
}

/** Customer price for one render, including the Solcameo fee, or null when the reference is out of range. */
export function estimateModelUsd(model: ExploreModel, duration: number, quality: string): number | null {
  const q = qualityFor(model, quality);
  if (model.kind === "genjutsu") return estimateGenerationUsd(duration, q as GenjutsuResolution);
  if (!Number.isFinite(duration) || duration <= 0 || !model.engine) return null;
  return Math.round(videoCostForLength(getVideoEngine(model.engine), engineSeconds(model, duration), q as VideoQuality) * 100) / 100;
}

/** Legacy motion clips keep their transfer flow; prompt references use their source model. */
export const modelForReference = (item?: { preferredModel?: string } | null): ExploreModel => modelById(item?.preferredModel ?? "genjutsu-motion");

export function cameoReferencePrompt(item: { prompt?: string }, name: string): string {
  const token = name.replace(/\s+/g, "").replace(/[^\w-]/g, "") || "agent";
  return (item.prompt ?? "").replace(/@cameo\b/g, `@${token}`);
}

export function referenceEstimate(item: { preferredModel?: string; duration: number }): number | null {
  const model = modelForReference(item);
  return estimateModelUsd(model, item.duration, model.defaultQuality);
}
