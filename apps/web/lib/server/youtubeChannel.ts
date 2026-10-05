/**
 * YouTube CHANNEL / PLAYLIST → top-N performing videos.
 *
 * A campaign (or a manual clipper) can point a Source at a whole YouTube channel
 * (`https://www.youtube.com/@Handle`) or a playlist. The clip pipeline can only
 * download a SINGLE video, so — exactly like a Google Drive FOLDER — we expand the
 * collection at RESOLVE time into a bounded list of clippable `watch?v=<id>` URLs,
 * ranked by view count so the best-performing videos surface first. Each becomes
 * its own clippable Source.
 *
 * CRITICAL: this enumeration runs ONLY at resolve time (bounded `--playlist-end`,
 * a hard timeout, over the shared residential proxy). It must NEVER run inside the
 * 290s synchronous audio pull (`convex/clipJobs.ts`) — that receives a single,
 * already-resolved `watch?v=` URL. yt-dlp's `--flat-playlist` mode lists entries
 * WITHOUT downloading each video, so the walk is cheap and quick.
 *
 * Reuses vello's EXISTING scraper stack (the same yt-dlp binary + residential
 * proxy + optional cookies `scraperService` already uses) — no YouTube Data API
 * key exists or is needed; yt-dlp already returns per-video `view_count`.
 */

import { resolveYtdlpBin, writeCookies, stickyProxy } from "./scraperService";

/** A single clippable video (structurally a CampaignSourceVideo). */
export interface ChannelVideo {
  url: string;
  name: string;
}

/** One entry from `yt-dlp --flat-playlist -J` (only the fields we read). */
export interface FlatPlaylistEntry {
  id?: string | null;
  url?: string | null;
  webpage_url?: string | null;
  title?: string | null;
  view_count?: number | null;
  duration?: number | null;
}

const DEFAULT_LIMIT = 5; // default top-N videos per channel
const MAX_LIMIT = 10; // hard cap — never expand a channel into more than this
const POOL_MULTIPLIER = 4; // fetch a bounded pool > limit so "top performing" is meaningful
const MAX_POOL = 40; // absolute cap on how many entries we enumerate
const ENUM_TIMEOUT_MS = 25_000; // hard timeout on the yt-dlp channel walk

// A bare 11-char YouTube video id.
const YT_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Pull a YouTube video id out of a flat-playlist entry. Flat entries usually carry
 * `id` = the 11-char video id, but fall back to parsing a `url`/`webpage_url`.
 * Returns null when the entry isn't a single video (e.g. a nested playlist).
 */
export function entryVideoId(e: FlatPlaylistEntry): string | null {
  const id = (e.id ?? "").trim();
  if (YT_VIDEO_ID_RE.test(id)) return id;
  for (const raw of [e.url, e.webpage_url]) {
    if (!raw) continue;
    const s = String(raw);
    if (YT_VIDEO_ID_RE.test(s)) return s; // url is just the bare id
    const m =
      s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
      s.match(/\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/) ||
      s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

/**
 * PURE: rank flat-playlist entries by `view_count` desc and return the top-N as
 * `watch?v=<id>` videos. Deduped by video id, order preserved on ties.
 *
 * FALLBACK: when NO entry carries a `view_count` (yt-dlp's flat extraction can omit
 * it), source order is preserved instead of dropping to 0 — a channel's default tab
 * is recency-ordered and a playlist is author-ordered, both reasonable N picks. The
 * caller can prefer the channel's Videos tab so "top" still means "most recent
 * uploads" in that degraded case.
 */
export function rankTopVideos(entries: FlatPlaylistEntry[], limit: number): ChannelVideo[] {
  const n = Math.max(0, Math.floor(limit));
  const cleaned: { id: string; views: number | null; title: string }[] = [];
  const seen = new Set<string>();
  for (const e of entries ?? []) {
    const id = entryVideoId(e);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const views =
      typeof e.view_count === "number" && Number.isFinite(e.view_count) && e.view_count >= 0
        ? e.view_count
        : null;
    const title = (e.title ?? "").trim() || id;
    cleaned.push({ id, views, title });
  }
  const anyViews = cleaned.some((c) => c.views !== null);
  const ranked = anyViews
    ? [...cleaned].sort((a, b) => (b.views ?? -1) - (a.views ?? -1)) // desc; entries w/o views sink
    : cleaned; // no view data anywhere → keep source (recency/author) order
  return ranked.slice(0, n).map((c) => ({
    url: `https://www.youtube.com/watch?v=${c.id}`,
    name: c.title.slice(0, 120),
  }));
}

/**
 * Normalize a channel URL to its Videos tab so flat enumeration returns actual
 * uploads (the channel "home"/featured tab mixes shorts, playlists and a trailer).
 * Playlist and already-/videos URLs pass through unchanged.
 */
export function channelVideosUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/(@[\w.-]+|channel\/[\w-]+|user\/[\w.-]+|c\/[\w.-]+)/i);
    if (!m) return url; // playlist or unrecognized shape → leave as-is
    return `${u.origin}/${m[1]}/videos`;
  } catch {
    return url;
  }
}

/** Run `yt-dlp --flat-playlist -J` over the residential proxy, hard-timeout bounded,
 *  and return the parsed `entries[]`. Never resolves for more than ENUM_TIMEOUT_MS. */
async function runFlatPlaylist(target: string, playlistEnd: number): Promise<FlatPlaylistEntry[]> {
  const { spawn } = await import("node:child_process");
  const bin = await resolveYtdlpBin();
  const { path: cookiesPath, cleanup } = await writeCookies();
  const sessionId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  const proxy = stickyProxy(sessionId);

  const args = [
    target,
    "--flat-playlist", // list entries WITHOUT downloading each video (cheap + fast)
    "-J", // dump-single-json (the playlist/channel object, with entries[])
    "--no-download",
    "--no-warnings",
    "--quiet",
    "--ignore-config",
    "--socket-timeout", "15",
    "--retries", "1",
    "--extractor-retries", "1",
    "--playlist-end", String(playlistEnd), // bound the walk
    ...(proxy ? ["--proxy", proxy] : []),
    ...(cookiesPath ? ["--cookies", cookiesPath] : []),
  ];

  return await new Promise<FlatPlaylistEntry[]>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup().finally(fn);
    };
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      done(() => reject(new Error("yt-dlp channel enumeration timed out")));
    }, ENUM_TIMEOUT_MS);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (e) =>
      done(() => reject(e.message.includes("ENOENT") ? new Error("yt-dlp not installed on server (set YTDLP_PATH)") : e)),
    );
    proc.on("close", (code) => done(() => {
      // yt-dlp can exit non-zero when a few entries fail yet still emit the playlist
      // JSON — accept any parseable stdout; only reject when there's nothing to parse.
      if (!stdout.trim()) {
        return reject(new Error(`yt-dlp exited ${code}: ${stderr.trim().slice(0, 200) || "no playlist output"}`));
      }
      try {
        const parsed = JSON.parse(stdout) as { entries?: FlatPlaylistEntry[] };
        resolve(Array.isArray(parsed.entries) ? parsed.entries : []);
      } catch {
        reject(new Error("yt-dlp returned unparseable playlist JSON"));
      }
    }));
  });
}

/**
 * Expand a YouTube CHANNEL or PLAYLIST URL into its top-N performing videos
 * (`watch?v=<id>`), ranked by view count. Bounded (`limit` capped at MAX_LIMIT, a
 * pool capped at MAX_POOL) and hard-timeout protected. THROWS on a spawn/parse
 * failure so the caller can degrade gracefully to an empty list — this must never
 * bubble into a clip run.
 */
export async function listChannelVideos(
  url: string,
  opts?: { limit?: number; sortBy?: "views" },
): Promise<ChannelVideo[]> {
  const limit = Math.max(1, Math.min(Math.floor(opts?.limit ?? DEFAULT_LIMIT), MAX_LIMIT));
  // Fetch a bounded POOL larger than `limit` so ranking by views is meaningful (the
  // N most recent aren't necessarily the N best-performing), but never unbounded.
  const pool = Math.min(Math.max(limit * POOL_MULTIPLIER, limit), MAX_POOL);
  const target = channelVideosUrl(url);
  const entries = await runFlatPlaylist(target, pool);
  return rankTopVideos(entries, limit);
}

/** Find long-form YouTube candidates in search relevance order. A result is only
 * a lead for the operator to review; search does not grant clipping rights. */
export async function searchYoutubeLongVideos(query: string, limit = 3): Promise<ChannelVideo[]> {
  const term = query.trim().slice(0, 100);
  if (!term) return [];
  const entries = await runFlatPlaylist(`ytsearch12:${term}`, 12);
  const found: ChannelVideo[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = entryVideoId(entry);
    if (!id || seen.has(id) || typeof entry.duration !== "number" || entry.duration < 120) continue;
    seen.add(id);
    found.push({ url: `https://www.youtube.com/watch?v=${id}`, name: (entry.title || id).slice(0, 120) });
    if (found.length >= Math.max(1, Math.min(limit, 5))) break;
  }
  return found;
}
