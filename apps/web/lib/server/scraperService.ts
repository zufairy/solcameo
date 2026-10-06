/**
 * Residential-proxy view-count fetcher — uses vello's EXISTING scraper stack:
 * the same `yt-dlp` binary + residential proxy (`YTDLP_PROXY`) + optional cookies
 * (`YTDLP_COOKIES`) that `downloader.ts` already uses to pull clips. No external
 * service / token: we ask yt-dlp for the post's metadata (`view_count`) over the
 * same proxy, so TikTok / Instagram / YouTube view counts come back the same way
 * the platform serves them to a real residential client.
 *
 * Env (already configured for vello downloads — nothing new to set):
 *   YTDLP_PATH      explicit yt-dlp binary (else ./bin/yt-dlp → `yt-dlp` on PATH)
 *   YTDLP_PROXY     residential proxy forwarded to `yt-dlp --proxy`
 *   YTDLP_COOKIES   Netscape cookies.txt (raw or base64) — helps IG/age-gated posts
 */

import { getPostAnalytics, resolveUsername } from "./uploadPost";
import { fetchXPostViews, fetchXPostViewsForProfile, tweetIdFromUrl } from "./xApi";

export type ScrapePlatform = "tiktok" | "instagram" | "youtube";

export type ScrapeResult =
  | {
      ok: true;
      views: number;
      raw: Record<string, unknown>;
      // The REAL social permalink + native id upload-post resolved while measuring.
      // Only present on the upload-post analytics path (fetchUploadPostViews) — the
      // yt-dlp proxy scrape measures an already-known url and never re-derives one.
      // The scrape-views worker uses these to backfill a submission whose stored
      // content_url is the raw clip/CDN url (not a post link), so a genuinely-posted
      // clip stops showing "not posted"/no-link once its views sync.
      postUrl?: string;
      platformPostId?: string;
    }
  | { ok: false; reason: string };

const viewsOf = (m: Record<string, number>): number =>
  Math.max(0, Math.floor(m.views ?? m.play_count ?? m.plays ?? m.video_views ?? m.view_count ?? m.impressions ?? 0));

/** Extract the native platform_post_id from a post URL (the upload-post analytics
 *  `platform_post_id` lookup key). Instagram uses a numeric media id, not the
 *  shortcode, so it's not URL-derivable → undefined (request_id is used instead). */
function postIdFromUrl(platform: string, url: string): string | undefined {
  try {
    if (platform === "tiktok") return url.match(/\/video\/(\d+)/)?.[1] ?? url.match(/\/photo\/(\d+)/)?.[1];
    if (platform === "youtube") return url.match(/\/shorts\/([\w-]+)/)?.[1] ?? url.match(/[?&]v=([\w-]+)/)?.[1] ?? url.match(/youtu\.be\/([\w-]+)/)?.[1];
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * UPLOAD-POST analytics (NO proxy/scrape) — read the live view count from
 * upload-post for a post we published there. Tries the durable request_id handle
 * first, then falls back to (platform_post_id + the agent's upload-post username).
 * This is the "Sync all views" path: it reads analytics from where the post was
 * actually uploaded, per the upload-post Post-Analytics API.
 */
export async function fetchUploadPostViews(args: {
  platform: string;
  requestId?: string | null;
  postUrl?: string | null;
  mintAddress?: string | null;
}): Promise<ScrapeResult> {
  const { platform } = args;
  try {
    // X posts: read impressions straight from the X API (realtime), falling back to upload-post only if it can't.
    if ((platform === "x" || platform === "twitter") && args.postUrl) {
      const tweetId = tweetIdFromUrl(args.postUrl);
      if (tweetId) {
        // The agent's own connected X account first (no extra token needed), then the app bearer token.
        const profile = args.mintAddress ? resolveUsername(args.mintAddress) : "";
        let r = profile ? await fetchXPostViewsForProfile(profile, tweetId) : { ok: false as const, reason: "no_profile" };
        if (!r.ok) r = await fetchXPostViews(tweetId);
        if (r.ok) return { ok: true, views: r.views, raw: r.raw, postUrl: args.postUrl, platformPostId: tweetId };
      }
    }
    // 1) by request_id (the async-upload handle captured at post time)
    if (args.requestId) {
      const a = await getPostAnalytics({ requestId: args.requestId, platform });
      if (a.ok) return { ok: true, views: viewsOf(a.metrics), raw: a.metrics, postUrl: a.postUrl, platformPostId: a.platformPostId };
    }
    // 2) by platform_post_id + the agent's upload-post profile username
    const postId = args.postUrl ? postIdFromUrl(platform, args.postUrl) : undefined;
    const username = args.mintAddress ? resolveUsername(args.mintAddress) : "";
    if (postId && username) {
      const a = await getPostAnalytics({ platformPostId: postId, platform, username });
      if (a.ok) return { ok: true, views: viewsOf(a.metrics), raw: a.metrics, postUrl: a.postUrl, platformPostId: a.platformPostId };
      return { ok: false, reason: `uploadpost_${a.reason}` };
    }
    return { ok: false, reason: "uploadpost_no_handle" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "uploadpost_error" };
  }
}

const PROBE_TIMEOUT_MS = 22_000;

/** Resolve the yt-dlp binary the same way downloader.ts does.
 *  Exported so sibling yt-dlp callers (e.g. youtubeChannel) reuse ONE resolver. */
export async function resolveYtdlpBin(): Promise<string> {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  try {
    const { join } = await import("node:path");
    const { access } = await import("node:fs/promises");
    const local = join(process.cwd(), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    await access(local);
    return local;
  } catch {
    return "yt-dlp";
  }
}

/** Materialize YTDLP_COOKIES (raw text or base64) to a temp file; returns its path
 *  + a cleanup fn, or nulls when no cookies are configured.
 *  Exported so sibling yt-dlp callers (e.g. youtubeChannel) reuse ONE cookie writer. */
export async function writeCookies(): Promise<{ path: string | null; cleanup: () => Promise<void> }> {
  const env = process.env.YTDLP_COOKIES?.trim();
  if (!env) return { path: null, cleanup: async () => {} };
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const raw =
    env.startsWith("# ") || env.startsWith("#\t") || env.includes("\n")
      ? env
      : Buffer.from(env, "base64").toString("utf8");
  const dir = await mkdtemp(join(tmpdir(), "vello-ckie-"));
  const path = join(dir, "cookies.txt");
  await writeFile(path, raw, "utf8");
  return { path, cleanup: async () => { try { await rm(dir, { recursive: true, force: true }); } catch {} } };
}

function pickViews(meta: Record<string, unknown>): number {
  const candidates = [meta.view_count, meta.play_count, meta.concurrent_view_count];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c >= 0) return Math.floor(c);
    if (typeof c === "string") {
      const n = Number(c.replace(/,/g, ""));
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
  }
  return 0;
}

/**
 * Build a STICKY residential-proxy URL by injecting a DataImpulse session tag
 * (`__sessid-<id>`) into the proxy username, so every request in one yt-dlp run
 * (page + signed API call) exits through the SAME residential IP. TikTok 403s the
 * scrape otherwise (its API ties the signature to the requesting IP) — this is the
 * key trick jobtepi's scraper uses. A fresh session id = a fresh IP, so retries
 * after a block land on a different IP. Returns the base proxy unchanged when it
 * has no credentials to tag.
 *
 * Exported so sibling yt-dlp callers (e.g. youtubeChannel's channel enumeration)
 * reuse the SAME sticky-session trick over the shared residential proxy.
 */
export function stickyProxy(sessionId: string): string | undefined {
  const base = process.env.YTDLP_PROXY?.trim();
  if (!base) return undefined;
  const m = base.match(/^(https?:\/\/)([^:@/]+):([^@]+)@(.+)$/);
  if (!m) return base; // no user:pass to tag — use as-is (rotating)
  const [, scheme, user, pass, hostport] = m;
  return `${scheme}${user}__sessid-${sessionId}:${pass}@${hostport}`;
}

/** Run yt-dlp in metadata-only mode (`-J`, no download) over the residential proxy
 *  and return the parsed JSON for `url`. `proxy` is a sticky-session proxy URL. */
async function probeMetadata(url: string, proxy: string | undefined): Promise<Record<string, unknown>> {
  const { spawn } = await import("node:child_process");
  const bin = await resolveYtdlpBin();
  const { path: cookiesPath, cleanup } = await writeCookies();

  const args = [
    url,
    "-J", // dump-single-json (metadata only)
    "--no-download",
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--ignore-config",
    "--socket-timeout", "15",
    "--retries", "1",
    "--extractor-retries", "1",
    ...(proxy ? ["--proxy", proxy] : []),
    ...(cookiesPath ? ["--cookies", cookiesPath] : []),
  ];

  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

    const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); cleanup().finally(fn); };
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} done(() => reject(new Error("yt-dlp metadata probe timed out"))); }, PROBE_TIMEOUT_MS);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (e) => done(() => reject(e.message.includes("ENOENT") ? new Error("yt-dlp not installed on server (set YTDLP_PATH)") : e)));
    proc.on("close", (code) => done(() => {
      if (code !== 0 || !stdout.trim()) {
        return reject(new Error(`yt-dlp exited ${code}: ${stderr.trim().slice(0, 200) || "no metadata"}`));
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error("yt-dlp returned unparseable metadata"));
      }
    }));
  });
}

const SCRAPE_ATTEMPTS = 3; // each retry uses a FRESH sticky session → fresh residential IP

/**
 * Fetch the live view count for a post via vello's yt-dlp + residential proxy.
 * Retries up to SCRAPE_ATTEMPTS times, each on a fresh STICKY proxy session (a
 * fresh residential IP), so a TikTok block/timeout on one IP is retried on
 * another — this is what makes TikTok scraping actually land (matches jobtepi).
 */
export async function fetchScrapedViews(platform: ScrapePlatform, url: string): Promise<ScrapeResult> {
  if (!url) return { ok: false, reason: "missing post url" };
  if (platform === "tiktok" && !url.includes("tiktok.com")) return { ok: false, reason: "not a tiktok url" };
  if (platform === "instagram" && !url.includes("instagram.com")) return { ok: false, reason: "not an instagram url" };
  if (platform === "youtube" && !url.includes("youtube.com") && !url.includes("youtu.be"))
    return { ok: false, reason: "not a youtube url" };

  let lastErr = "scrape failed";
  for (let attempt = 0; attempt < SCRAPE_ATTEMPTS; attempt++) {
    const sessionId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
    try {
      const meta = await probeMetadata(url, stickyProxy(sessionId));
      const views = pickViews(meta);
      // A real 0 is possible, but a parse miss also yields 0 — accept it; the
      // never-lower write guard means a spurious 0 can't hurt the stored count.
      return { ok: true, views, raw: meta };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "scrape failed";
    }
  }
  return { ok: false, reason: lastErr };
}
