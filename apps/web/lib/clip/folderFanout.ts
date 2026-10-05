/**
 * Master Videos — "clip ALL videos in a folder/channel" fan-out decision (#4a).
 *
 * The clip pipeline is ONE-video-per-job. `resolveSourceUrl` already expands a Drive
 * FOLDER (or a YouTube CHANNEL/PLAYLIST) into its full ranked `videos[]` list; by
 * DEFAULT a run clips only the TOP video (`videos[0]`). This helper turns that same
 * resolved list into the set of member URLs to enqueue when the operator explicitly
 * opts into "clip all":
 *
 *   - clipAll = false (the default)  → ONLY the top video (`videos[0]`), unchanged.
 *   - clipAll = true                 → EVERY member video, in ranked order, BOUNDED
 *                                       by `cap` so a huge folder can't spawn unbounded
 *                                       PAID jobs. When `total > cap` the first `cap`
 *                                       are kept (already ranked) and `capped:true`
 *                                       flags it so the caller can tell the user
 *                                       "Clipped the first N of M" — never a silent drop.
 *
 * Pure + never throws (mirrors the MAX_FOLDER_VIDEOS guard pattern in
 * lib/server/driveDownload.ts). An EMPTY `videos` yields `urls:[]`; the caller
 * short-circuits with "contents not enough" BEFORE reaching this.
 */

export interface ClipFanoutPlan {
  /** The member-video URLs to enqueue (one clip job each). */
  urls: string[];
  /** How many clippable member videos the source resolved to (pre-cap). */
  total: number;
  /** True when `total` exceeded the cap and the list was truncated to the first `cap`. */
  capped: boolean;
}

export function planClipFanout(
  videos: ReadonlyArray<{ url: string }>,
  clipAll: boolean,
  cap: number,
): ClipFanoutPlan {
  const total = videos.length;
  // Default (and every non-collection source): just the top-ranked video.
  if (!clipAll) {
    return { urls: total > 0 ? [videos[0].url] : [], total, capped: false };
  }
  // Opt-in fan-out: every member, ranked order preserved, bounded by the cap.
  const limit = Math.max(1, Math.floor(cap) || DEFAULT_CLIP_FOLDER_MAX_JOBS);
  const urls = videos.slice(0, limit).map((v) => v.url);
  return { urls, total, capped: total > limit };
}

/**
 * Hard cap on how many clip jobs ONE "clip all" fan-out may enqueue (mirrors the
 * MAX_FOLDER_VIDEOS pattern in lib/server/driveDownload.ts). Env-tunable for a
 * legitimately large library; default 20 keeps a rogue/huge folder from running up
 * an unbounded paid-render bill.
 */
export const DEFAULT_CLIP_FOLDER_MAX_JOBS = 20;

export function clipFolderMaxJobs(): number {
  return Number(globalThis.process?.env?.CLIP_FOLDER_MAX_JOBS) || DEFAULT_CLIP_FOLDER_MAX_JOBS;
}
