// Managed YouTube download fallback (Apify "YouTube Video Downloader" actor).
//
// Why: YouTube bot-walls datacenter IPs (Railway included) even with PO tokens,
// cookies rot fast when replayed from a datacenter, and our residential proxy
// is metered and runs dry. The actor runs yt-dlp on RESIDENTIAL egress it owns
// (proxy included, ~$0.02-0.05 per successful video, failures free) and hands
// back a file at a stable HTTPS link — not IP-locked like googlevideo URLs — so
// our server can stream it straight into the normal pipeline.
//
// Used by lib/server/downloader.ts ONLY after every yt-dlp attempt hit the bot
// wall / an exhausted proxy. Off unless APIFY_TOKEN is set.
//   APIFY_TOKEN        — Apify API token (required to enable)
//   APIFY_YT_ACTOR     — actor id, default "memo23~youtube-video-downloader"

const DEFAULT_ACTOR = "memo23~youtube-video-downloader";

export function managedYoutubeConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN?.trim());
}

/** Map our height cap to the actor's `quality` enum (best tier not above it). */
export function apifyQualityFor(maxHeight: number): string {
  if (maxHeight >= 2160) return "2160p";
  if (maxHeight >= 1440) return "1440p";
  if (maxHeight >= 1080) return "1080p";
  if (maxHeight >= 720) return "720p";
  if (maxHeight >= 480) return "480p";
  return "360p";
}

export interface ManagedYoutubeResult {
  /** HTTPS link to the finished file (token appended for api.apify.com). */
  fileUrl: string;
  title?: string;
  durationSec?: number;
  fileSizeBytes?: number;
  quality?: string;
}

/**
 * Run the actor synchronously for ONE video and return where the file landed.
 * Throws with the actor's own error text on failure (no charge on failure).
 */
export async function runManagedYoutube(
  url: string,
  opts: { maxHeight: number; audioOnly?: boolean; timeoutMs: number },
): Promise<ManagedYoutubeResult> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error("managed YouTube download not configured (APIFY_TOKEN unset)");
  const actor = (process.env.APIFY_YT_ACTOR?.trim() || DEFAULT_ACTOR).replace("/", "~");
  const timeoutSecs = Math.max(60, Math.floor(opts.timeoutMs / 1000) - 10);
  const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items`
    + `?token=${encodeURIComponent(token)}&timeout=${timeoutSecs}&clean=true`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoUrls: [url],
      format: opts.audioOnly ? "mp3" : "mp4",
      quality: opts.audioOnly ? "best" : apifyQualityFor(opts.maxHeight),
      maxConcurrency: 1,
      perVideoTimeoutSecs: Math.max(60, timeoutSecs - 20),
      storageType: "apify",
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`managed YouTube download HTTP ${res.status}: ${text.slice(0, 200)}`);
  let items: unknown;
  try { items = JSON.parse(text); } catch { throw new Error(`managed YouTube download returned non-JSON: ${text.slice(0, 160)}`); }
  const item = (Array.isArray(items) ? items[0] : null) as Record<string, unknown> | null;
  if (!item) throw new Error("managed YouTube download returned no result");
  if (typeof item.error === "string" && item.error) throw new Error(`managed YouTube download failed: ${item.error.slice(0, 200)}`);
  const link = [item.downloadUrl, item.kvStoreUrl].find((u): u is string => typeof u === "string" && /^https:\/\//.test(u));
  if (!link) throw new Error(`managed YouTube download gave no file link${typeof item.storageError === "string" ? `: ${item.storageError}` : ""}`);
  // Apify storage links are readable by id, but a restricted account may
  // require the token — add it for Apify's own API host only.
  const fileUrl = /^https:\/\/api\.apify\.com\//.test(link) && !/[?&]token=/.test(link)
    ? `${link}${link.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
    : link;
  return {
    fileUrl,
    title: typeof item.title === "string" ? item.title : undefined,
    durationSec: typeof item.durationSec === "number" ? item.durationSec : undefined,
    fileSizeBytes: typeof item.fileSizeBytes === "number" ? item.fileSizeBytes : undefined,
    quality: typeof item.quality === "string" ? item.quality : undefined,
  };
}
