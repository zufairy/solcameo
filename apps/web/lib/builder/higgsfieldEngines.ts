/** Higgsfield-hosted video engines. Pure data, shared by the Director UI
 *  (agentTypes) and the render pipeline. Endpoint slugs were checked against
 *  api.higgsfield.ai (they validate their request schema; Cinema Studio has no
 *  public REST slug yet, so it is not offered).
 *
 *  The engine ids deliberately avoid the words "seedance"/"grok": the Kie
 *  pipeline branches on those substrings and would route a Higgsfield render
 *  through the wrong code path. */
export interface HiggsfieldEngine {
  id: string;
  endpoint: string;
  minClipSeconds: number;
  maxClipSeconds: number;
  /** Resolutions the endpoint accepts. */
  resolutions: readonly string[];
}

export const HIGGSFIELD_ENGINES: Record<string, HiggsfieldEngine> = {
  "hf:sd20": { id: "hf:sd20", endpoint: "bytedance/seedance-2.0/image-to-video", minClipSeconds: 4, maxClipSeconds: 15, resolutions: ["480p", "720p", "1080p", "4k"] },
  "hf:sd25": { id: "hf:sd25", endpoint: "bytedance/seedance-2.5/image-to-video", minClipSeconds: 4, maxClipSeconds: 30, resolutions: ["480p", "720p", "1080p"] },
  "hf:gxv": { id: "hf:gxv", endpoint: "xai/grok-imagine-video/image-to-video", minClipSeconds: 2, maxClipSeconds: 15, resolutions: ["480p", "720p"] },
};

export function isHiggsfieldModel(model: string | undefined): boolean {
  return !!model && model in HIGGSFIELD_ENGINES;
}
