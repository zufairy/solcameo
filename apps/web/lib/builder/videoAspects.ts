import type { VideoEngineId } from "@/lib/builder/agentTypes";

export type VideoAspect = "9:16" | "16:9" | "1:1";

export const VIDEO_ASPECTS: ReadonlyArray<{ value: VideoAspect; label: string }> = [
  { value: "9:16", label: "Portrait 9:16" },
  { value: "16:9", label: "Landscape 16:9" },
  { value: "1:1", label: "Square 1:1" },
];

/** Veo and Gemini Omni render portrait or landscape only; Grok and Seedance also render square. */
const NO_SQUARE = /veo|gemini-omni/i;

export const aspectsForEngine = (engine?: VideoEngineId | string) =>
  VIDEO_ASPECTS.filter((a) => a.value !== "1:1" || !NO_SQUARE.test(String(engine ?? "")));

export const isVideoAspect = (v: unknown): v is VideoAspect => v === "9:16" || v === "16:9" || v === "1:1";

/** The caller's pick if this engine can render it, else portrait (the default every engine supports). */
export const aspectFor = (engine: VideoEngineId | string | undefined, pick: unknown): VideoAspect =>
  isVideoAspect(pick) && aspectsForEngine(engine).some((a) => a.value === pick) ? pick : "9:16";
