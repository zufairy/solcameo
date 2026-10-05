/**
 * Pure helpers for previewing / expanding Google Drive FOLDER links that a
 * campaign maker drops into the "Reference links" field on the campaign form.
 *
 * Mirrors the clipper inspector's private `looksLikeDriveFolder` check so the
 * campaign form can resolve a folder via `/api/clip/resolve-source-url` and show
 * its member videos inline, then persist those video URLs into the campaign's
 * `contentFileUrls`. Kept dependency-free so it's trivially unit-testable.
 */

/** True for any Google Drive URL. Keep this host-based rather than matching the
 *  path because Drive exposes files through several valid shapes (`/file/d/`,
 *  `/open?id=`, `/uc?id=`), all of which should use the Drive resolver and full
 *  download path in the editor. */
export function looksLikeGoogleDrive(u: string): boolean {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return host === "drive.google.com" || host.endsWith(".drive.google.com") || host === "drive.usercontent.google.com"
      || host === "docs.google.com" || host.endsWith(".docs.google.com");
  } catch {
    return false;
  }
}

/** True for a Google Drive FOLDER link — the only Drive shape that expands to
 *  a multi-video picker. A single Drive file still resolves through the server
 *  so it is canonicalized before download, but remains a one-video source. */
export function looksLikeDriveFolder(u: string): boolean {
  return looksLikeGoogleDrive(u) && /\/folders\//i.test(u);
}

/** Stable identity for a Drive FILE, independent of /open, /file/d, and share
 * tracking parameters. Never treat a folder ID as a downloadable file. */
export function driveFileIdentity(u: string): string | null {
  if (!looksLikeGoogleDrive(u) || looksLikeDriveFolder(u)) return null;
  try {
    const url = new URL(u);
    const id = url.pathname.match(/\/(?:file\/)?d\/([A-Za-z0-9_-]+)/)?.[1] ?? url.searchParams.get("id");
    return id && /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// Hosts we treat as YouTube (channel/video/playlist all live here). Mirrors the
// shared YOUTUBE_HOST_RE in lib/clip/youtubeUrl.ts.
const YOUTUBE_HOST_RE = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i;

/**
 * PURE client mirror of the server's `classifyYoutubeUrl`
 * (`lib/server/campaignSources.ts`). Classify a YouTube URL by its SHAPE — no
 * network — so the campaign form can decide whether a pasted link is a single
 * video (no server call), an expandable channel/playlist (resolve round-trip),
 * or not YouTube at all. Kept byte-for-byte in step with the server classifier
 * and the clip-canvas inspector's `looksLikeYoutubeChannel` so the three never
 * disagree.
 *
 *  - "video"    → watch?v=<id>, youtu.be/<id>, /shorts|/embed|/v|/live/<id>
 *                 (a watch url that ALSO has &list= is still a single video).
 *  - "channel"  → /@handle, /channel/<id>, /user/<name>, /c/<name> (any tab).
 *  - "playlist" → /playlist?list=, or a bare ?list= with no v=.
 *  - null       → not YouTube, or an unrecognized YouTube page.
 */
function classifyYoutube(u: string): "video" | "channel" | "playlist" | null {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOST_RE.test(url.hostname)) return null;
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // youtu.be/<id> short links are always a single video.
  if (host === "youtu.be") {
    const seg = path.slice(1).split("/")[0];
    return seg ? "video" : null;
  }

  // Explicit single-video paths.
  if (/^\/(shorts|embed|v|live)\/[\w-]+/.test(path)) return "video";

  // /watch → a video when it carries v=, else a playlist page when it's a bare list.
  if (path === "/watch") {
    if (url.searchParams.get("v")) return "video";
    if (url.searchParams.get("list")) return "playlist";
    return null;
  }

  // Playlist pages.
  if (path === "/playlist") return url.searchParams.get("list") ? "playlist" : null;

  // Channel shapes (handle / channel-id / legacy user / custom), any tab suffix.
  if (/^\/(@[\w.-]+|channel\/[\w-]+|user\/[\w.-]+|c\/[\w.-]+)/i.test(path)) return "channel";

  // A bare ?list= hanging off some other path → treat as a playlist.
  if (url.searchParams.get("list")) return "playlist";

  return null;
}

/** True for ANY valid YouTube URL — single video, channel, or playlist. Used to
 *  give the campaign maker inline "✓ YouTube …" validation feedback. Agrees with
 *  the server's classifyYoutubeUrl (non-null == a recognized YouTube link). */
export function looksLikeYoutube(u: string): boolean {
  return classifyYoutube(u) !== null;
}

/** True only for a YouTube CHANNEL or PLAYLIST link (an expandable COLLECTION),
 *  NOT a single video. These are the shapes worth a resolve round-trip into a
 *  member-video preview — the actual channel walk runs SERVER-SIDE via
 *  /api/clip/resolve-source-url (never yt-dlp in the browser). Mirrors the
 *  clip-canvas inspector's `looksLikeYoutubeChannel`. */
export function looksLikeYoutubeChannel(u: string): boolean {
  const k = classifyYoutube(u);
  return k === "channel" || k === "playlist";
}

/** True for any link the campaign form should expand via a resolve round-trip
 *  into a preview of member videos — a Drive FOLDER or a YouTube CHANNEL/PLAYLIST.
 *  Everything else (single video / Drive file / .mp4) stays a single source with
 *  no server call. Mirrors the clip-canvas inspector's `looksExpandableSource`. */
export function looksExpandableSource(u: string): boolean {
  return looksLikeDriveFolder(u) || looksLikeYoutubeChannel(u);
}

/**
 * True when a CLIPPING campaign has at least one clippable VIDEO source — i.e.
 * exactly what the clip-canvas Source-node picker reads
 * (`contentLinks ∪ contentFileUrls`). A campaign filed under the Clipping board
 * that launches with zero sources is hidden from that picker and can never be
 * clipped, so the create form blocks launch unless this returns true.
 *
 * Only VIDEO sources count: pasted source/reference links (direct video URLs or
 * Drive-FOLDER links) and resolved Drive-folder member videos (which become
 * `contentFileUrls`). A raw folder link ALWAYS lives in `contentLinks` even
 * before its preview resolves, so a non-empty link alone is enough. Image
 * uploads (mockups / product shots) are deliberately NOT counted — they persist
 * as `contentFileStorageIds`, never a clippable URL, so they'd let an
 * unclippable campaign through the gate.
 */
export function hasClipSource(args: {
  contentLinks: string[];
  folderVideoCount?: number;
}): boolean {
  const hasLink = args.contentLinks.some((l) => (l ?? "").trim().length > 0);
  return hasLink || (args.folderVideoCount ?? 0) > 0;
}

/** Merge freshly-resolved folder video URLs into an existing list, trimming
 *  blanks and de-duplicating (order-preserving, existing entries first). Used to
 *  build a campaign's `contentFileUrls` from expanded Drive-folder Reference
 *  links without ever double-listing a URL. */
export function mergeFolderVideos(existing: string[], resolved: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of [...existing, ...resolved]) {
    const t = (u ?? "").trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
