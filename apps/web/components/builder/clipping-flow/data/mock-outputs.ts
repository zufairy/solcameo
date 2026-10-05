import type { VelloNodeData, NodeOutput } from "@/components/builder/clipping-flow/types/clipping";

/** Default gradient used for compose-node post previews. */
export const COMPOSE_GRADIENT = "linear-gradient(135deg, #db2777, #7c3aed)";

export function makeMockOutput(data: VelloNodeData): NodeOutput {
  // config shapes are validated elsewhere; read loosely for mock previews
  const cfg = data.config as unknown as Record<string, unknown>;
  switch (data.kind) {
    case "source":
      return {
        type: "files",
        count: (cfg.maxFiles as number) ?? 24,
        sample: ["IMG_0421.jpg", "IMG_0422.jpg", "IMG_0423.jpg", "reel_cut_07.png"],
      };
    case "compose":
      // Transparent skill hub - passes its clip through, fanning attached
      // skills around it. Preview is a simple composed-post stub.
      return {
        type: "post",
        headline: "Composed clip - skills applied",
        gradient: COMPOSE_GRADIENT,
      };
    case "skill":
      if (cfg.variant === "captions")
        return {
          type: "caption",
          text: "POV: you finally shipped it 🚀 the late nights were worth every frame.",
          hashtags: ["#fyp", "#buildinpublic", "#vello", "#creator"],
        };
      if (cfg.variant === "broll")
        return { type: "overlay", pack: (cfg.pack as string) ?? "city", clips: 6 };
      if (cfg.variant === "marketplace")
        return {
          type: "caption",
          text: `${(cfg.skillName as string) ?? "Skill"} - instructions queued for the AI editor on the next run.`,
          hashtags: [],
        };
      return { type: "crop", ratio: (cfg.ratio as string) ?? "9:16" };
    case "publish":
      return {
        type: "publish",
        url: "https://www.tiktok.com/@vello/video/7421984020",
        views: "12.4K",
      };
    default:
      return { type: "files", count: 0, sample: [] };
  }
}
