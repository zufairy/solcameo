/**
 * Cover Image tool (Editor tab sidebar, Clipping drawer) — a single operator-
 * uploaded image applied as the THUMBNAIL/COVER of every clip this project
 * posts. Persisted on the `clip.cover` agentSkillFiles row (config.coverImageUrl)
 * so it auto-saves for every future clip and run, the same pattern Post
 * Captions uses (lib/builder/postCaptionInstruction.ts).
 *
 * Read by BOTH:
 *  - the Editor tab (restores the upload on remount), and
 *  - app/api/agents/run-task/route.ts (the real post-time path — drip-scheduled
 *    clips AND manual "Post now"), which attaches it as:
 *      - Instagram Reels: `cover_url` (a real custom-cover field upload-post
 *        supports directly).
 *      - YouTube: `thumbnail_url` (ditto).
 *      - TikTok: upload-post/TikTok's API has NO custom-cover-IMAGE field, only
 *        `cover_timestamp` (pick a frame, by time, from the video itself). So
 *        for TikTok the image is instead burned in as a literal ~1.2s still
 *        FIRST FRAME of the video TikTok receives (lib/server/tiktokCoverBurn.ts)
 *        — TikTok's own frame-based cover then naturally lands on it. Only the
 *        file sent to TikTok is touched; every other platform keeps the
 *        original, unmodified clip.
 */
export const CLIP_COVER_SKILL_ID = "clip.cover";

const CONFIG_KEY = "coverImageUrl";

export function readCoverImageUrl(cfg: unknown): string | undefined {
  const c = (cfg && typeof cfg === "object" ? cfg : {}) as Record<string, unknown>;
  const v = c[CONFIG_KEY];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function withCoverImageUrl(prevCfg: unknown, coverImageUrl: string | null): Record<string, unknown> {
  const prev = (prevCfg && typeof prevCfg === "object" ? prevCfg : {}) as Record<string, unknown>;
  if (!coverImageUrl) {
    const { [CONFIG_KEY]: _drop, ...rest } = prev;
    return rest;
  }
  return { ...prev, [CONFIG_KEY]: coverImageUrl };
}
