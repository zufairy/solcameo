/**
 * youtubeUrl — PURE, dependency-free YouTube URL-shape classification.
 *
 * Why it lives in `lib/clip/` (not `lib/server/campaignSources.ts`, where this
 * logic was born): `campaignSources.ts` statically imports Node-only Drive +
 * yt-dlp helpers (`driveDownload`, `youtubeChannel`), so importing IT into the
 * Convex action bundle (convex/clipJobs.ts) would drag those Node deps into the
 * Convex runtime. These two functions only touch the `URL` global, so — exactly
 * like `lib/clip/failure.ts` — they extract cleanly into a zero-import module
 * that BOTH runtimes share: the Next server (`@/lib/clip/youtubeUrl`) and the
 * Convex pipeline (`../lib/clip/youtubeUrl`).
 *
 * campaignSources.ts re-exports these for backwards compatibility.
 */

// Hosts we treat as YouTube (channel/video/playlist all live here).
export const YOUTUBE_HOST_RE = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i;

/**
 * Classify a YouTube URL by its SHAPE — pure, no network, so it's the fast gate
 * that keeps a CHANNEL/PLAYLIST link out of the single-video download rail. A
 * channel url wired as if it were one video makes yt-dlp try to walk the WHOLE
 * channel, and the 290s synchronous audio pull (clipJobs) aborts → the "timeout"
 * the user saw on the Source node.
 *
 *  - "video"    → a single playable video: watch?v=<id>, youtu.be/<id>,
 *                 /shorts|/embed|/v|/live/<id>. (A watch url that ALSO has &list=
 *                 is still a single video — we clip the video, ignore the list.)
 *  - "channel"  → /@handle, /channel/<id>, /user/<name>, /c/<name> (any tab).
 *  - "playlist" → /playlist or a bare ?list= with no v=.
 *  - null       → not YouTube, or an unrecognized YouTube page (search, feed, …).
 */
export function classifyYoutubeUrl(url: string): "video" | "channel" | "playlist" | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOST_RE.test(u.hostname)) return null;
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "") || "/";

  // youtu.be/<id> short links are always a single video.
  if (host === "youtu.be") {
    const seg = path.slice(1).split("/")[0];
    return seg ? "video" : null;
  }

  // Explicit single-video paths.
  if (/^\/(shorts|embed|v|live)\/[\w-]+/.test(path)) return "video";

  // /watch → a video when it carries v=, else a playlist page when it's a bare list.
  if (path === "/watch") {
    if (u.searchParams.get("v")) return "video";
    if (u.searchParams.get("list")) return "playlist";
    return null;
  }

  // Playlist pages.
  if (path === "/playlist") return u.searchParams.get("list") ? "playlist" : null;

  // Channel shapes (handle / channel-id / legacy user / custom), any tab suffix.
  if (/^\/(@[\w.-]+|channel\/[\w-]+|user\/[\w.-]+|c\/[\w.-]+)/i.test(path)) return "channel";

  // A bare ?list= hanging off some other path → treat as a playlist.
  if (u.searchParams.get("list")) return "playlist";

  return null;
}

/** True when a URL is a YouTube channel or playlist (an expandable COLLECTION),
 *  not a single video. Used to flag the Source-node picker to show a sub-picker,
 *  mirroring a Google Drive folder, AND as the pipeline's fail-fast guard so a
 *  collection link never enters the single-video 290s download rail. */
export function isYoutubeCollection(url: string): boolean {
  const k = classifyYoutubeUrl(url);
  return k === "channel" || k === "playlist";
}
