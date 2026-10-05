import { randomUUID } from "node:crypto";
import { submitVideo, waitForVideo } from "./higgsfield";

export const MOTION_SWAP_FORMAT_ID = "motion-swap";

/** Pull the library clip the operator chose for the Motion Swap format out of a show bible. */
export function motionReferenceFromBible(bible: unknown): string | null {
  const styles = (bible as { videoStyles?: Array<{ id?: string; tunables?: Record<string, string> }> } | null)?.videoStyles;
  const url = styles?.find((s) => s.id === MOTION_SWAP_FORMAT_ID)?.tunables?.reference;
  return typeof url === "string" && /^https:\/\/\S+$/.test(url) ? url : null;
}

/** Genjutsu motion transfer: the reference clip's motion applied to the character image. */
export async function renderMotionSwap(opts: {
  referenceVideoUrl: string;
  characterImageUrl: string;
  timeoutMs: number;
  idempotencyPrefix: string;
}): Promise<string> {
  if (!/^https:\/\//.test(opts.characterImageUrl)) throw new Error("Motion Swap needs a character image");
  const requestId = await submitVideo(
    "motion-transfer",
    { video_url: opts.referenceVideoUrl, image_urls: [opts.characterImageUrl], resolution: "720p" },
    `${opts.idempotencyPrefix}:${randomUUID()}`.slice(0, 120),
  );
  return waitForVideo(requestId, opts.timeoutMs);
}
