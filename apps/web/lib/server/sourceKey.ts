import { createHash } from "node:crypto";

/**
 * Normalize a video source URL into a STABLE cache key so the same video maps to
 * one transcript+analysis across all agents (the master cache). Keyed by the
 * video's identity, not the full URL (which carries tracking params / changes).
 *
 *   YouTube      -> "yt:<videoId>"
 *   Google Drive -> "gdrive:<fileId>"   (+ optional modifiedTime appended by caller)
 *   anything else-> "url:<sha256(url)[:32]>"
 */
export function sourceKey(rawUrl: string, opts?: { modifiedTime?: string | number }): string {
  const url = String(rawUrl ?? "").trim();
  const yt = youtubeId(url);
  if (yt) return `yt:${yt}`;
  const gd = driveFileId(url);
  if (gd) return opts?.modifiedTime ? `gdrive:${gd}:${opts.modifiedTime}` : `gdrive:${gd}`;
  return `url:${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
}

/** Extract a YouTube video id from watch / youtu.be / shorts / embed URLs. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return clean(u.pathname.slice(1));
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return clean(v);
      const m = u.pathname.match(/^\/(?:shorts|embed|v)\/([^/?]+)/);
      if (m) return clean(m[1]);
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/** Extract a Google Drive file id from /file/d/<id>/, ?id=<id>, /uc?id=, open?id=. */
export function driveFileId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$|^drive\.usercontent\.google\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/file\/d\/([^/]+)/) || u.pathname.match(/\/d\/([^/]+)/);
    if (m) return clean(m[1]);
    const id = u.searchParams.get("id");
    if (id) return clean(id);
  } catch {
    /* not a URL */
  }
  return null;
}

const clean = (s: string) => (/^[A-Za-z0-9_-]{6,}$/.test(s) ? s : null) as string | null;

/**
 * Did a source's underlying content change since it was cached? A Drive file can
 * be REPLACED IN PLACE (same fileId/link, new bytes — Drive's "Manage versions ->
 * Upload new version") with no change to the URL, so `sourceKey()` keeps
 * returning the same `gdrive:<fileId>` and a naive cache lookup HITS forever
 * (H08/BUG-031). modifiedTime is the only signal that the bytes changed.
 *
 * True only when BOTH sides are known and differ. Unknown on either side
 * (non-Drive source, or a failed/unavailable metadata read) returns false —
 * there is no evidence of a change, so the caller should NOT force a miss.
 */
export function sourceContentChanged(
  cachedModifiedTime: string | null | undefined,
  currentModifiedTime: string | null | undefined,
): boolean {
  return !!cachedModifiedTime && !!currentModifiedTime && cachedModifiedTime !== currentModifiedTime;
}
