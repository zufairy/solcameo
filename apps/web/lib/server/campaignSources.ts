import { getContentRewardById } from "@/lib/content-rewards";
import { driveFileId, sourceKey } from "@/lib/server/sourceKey";
import { driveFolderId, driveFileUrl, isDriveUrl, listDriveFolderVideos } from "@/lib/server/driveDownload";
import { listChannelVideos } from "@/lib/server/youtubeChannel";
// The pure YouTube URL-shape classifiers live in a dependency-free module so the
// Convex clip pipeline (convex/clipJobs.ts) can share the same fail-fast guard
// WITHOUT pulling this file's Node-only Drive/yt-dlp imports into its bundle.
// Re-exported below so existing importers of `@/lib/server/campaignSources` keep working.
import { YOUTUBE_HOST_RE, classifyYoutubeUrl, isYoutubeCollection } from "@/lib/clip/youtubeUrl";

export { classifyYoutubeUrl, isYoutubeCollection };

/**
 * Resolve a Supabase Stage content_reward (`content_rewards`) into a list of
 * CLIPPABLE video URLs the in-app clipper can ingest.
 *
 * The "what to clip" lives in the FREE-TEXT `available_content` column (NOT a
 * clean array) — usually one or more Google Drive links, occasionally direct
 * video URLs or a youtube/tiktok/instagram link, often mixed with a telegram
 * link and the brand's website. We pull URLs out with a regex, classify each,
 * EXPAND Drive folders into their member files, and SKIP telegram + bare
 * websites.
 *
 * GRACEFUL by design: a missing Drive key (no GOOGLE_DRIVE_API_KEY /
 * GOOGLE_SERVICE_ACCOUNT_JSON) means folders can't be listed → those folders
 * yield no videos, but any direct/single-file URLs still come back, and the
 * function never throws on a single bad link. Returns null only when the reward
 * itself can't be found.
 */

export interface CampaignSourceVideo {
  url: string;
  name: string;
}

export interface CampaignSourcesResult {
  contentRewardId: string;
  title: string;
  videos: CampaignSourceVideo[];
}

// Global URL matcher for free text. Stops at whitespace and common trailing
// punctuation/markup so a URL glued to surrounding prose still parses cleanly.
const URL_RE = /https?:\/\/[^\s)>\]"']+/g;

// Hosts we never treat as a clippable video source.
const TELEGRAM_RE = /(^|\.)t\.me$|(^|\.)telegram\.me$|(^|\.)telegram\.org$/i;

// Known video hosts whose links we keep even without a file path.
const VIDEO_HOST_RE =
  /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)tiktok\.com$|(^|\.)instagram\.com$|(^|\.)vimeo\.com$/i;

// Direct-download video file extensions.
const DIRECT_VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i;

/** Trim trailing punctuation a regex match commonly drags in from prose. */
function tidy(raw: string): string {
  return raw.replace(/[.,;]+$/g, "").trim();
}

/** Extract every http(s) URL from the free-text fields of a content reward. */
export function extractUrls(...texts: (string | string[] | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    const blob = Array.isArray(t) ? t.join("\n") : t;
    const matches = blob.match(URL_RE);
    if (matches) for (const m of matches) out.push(tidy(m));
  }
  return out;
}

/** Classify one URL into the videos it represents (folder → many, file → one,
 *  known-host/direct → one, telegram/bare-site → none). Never throws. */
async function classifyUrl(url: string): Promise<CampaignSourceVideo[]> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }

  // 1. Google Drive FOLDER → expand into per-file gdrive URLs.
  const folderId = driveFolderId(url);
  if (folderId) {
    try {
      const files = await listDriveFolderVideos(folderId);
      // Empty (no Drive key / private / not a video folder) → degrade gracefully.
      return files.map((f) => ({ url: driveFileUrl(f.fileId), name: f.name }));
    } catch {
      return []; // listing failed (private folder, transient API error) → skip
    }
  }

  // 2. Google Drive single FILE.
  if (isDriveUrl(url)) {
    const id = driveFileId(url);
    return [{ url: id ? driveFileUrl(id) : url, name: "Drive file" }];
  }

  // 3. Telegram — never a clippable source.
  if (TELEGRAM_RE.test(u.hostname)) return [];

  // 4. YouTube — split by URL SHAPE. A single VIDEO downloads fine today (the
  //    download rail dispatches by hostname and yt-dlp pulls one video). A
  //    CHANNEL/PLAYLIST must NEVER be wired as a single source: yt-dlp would try
  //    to walk the whole channel and the 290s synchronous audio pull aborts.
  if (YOUTUBE_HOST_RE.test(u.hostname)) {
    const kind = classifyYoutubeUrl(url);
    if (kind === "video") {
      return [{ url, name: `${u.hostname.replace(/^www\./, "")}${u.pathname}`.slice(0, 120) }];
    }
    if (kind === "channel" || kind === "playlist") {
      // Expand a channel/playlist into its top-N PERFORMING videos — the SAME
      // resolve-time expansion a Drive FOLDER gets (folder → member files). Each
      // performing video becomes its own clippable `watch?v=` source. Bounded +
      // hard-timeout inside listChannelVideos; NEVER runs in the 290s audio pull.
      // Graceful: an enum failure (no yt-dlp, blocked, empty) degrades to [].
      try {
        return await listChannelVideos(url, { limit: 5 });
      } catch (err) {
        console.error("listChannelVideos failed:", err);
        return [];
      }
    }
    // Unrecognized YouTube page (search, feed, …) → not clippable; skip (no hang).
    return [];
  }

  // 5. Other known video hosts (tiktok/instagram/vimeo) stay single-source.
  if (VIDEO_HOST_RE.test(u.hostname)) {
    return [{ url, name: `${u.hostname.replace(/^www\./, "")}${u.pathname}`.slice(0, 120) }];
  }

  // 6. An operator-UPLOADED file in our own Convex storage (the editor's upload
  //    fallback when R2 rejects a >200MB file) — extensionless /api/storage/<id>,
  //    so the extension check below would drop it as "not clippable".
  if (/(^|\.)convex\.(cloud|site)$/i.test(u.hostname) && u.pathname.startsWith("/api/storage/")) {
    return [{ url, name: "Uploaded video" }];
  }

  // 7. Direct downloadable video file on any host.
  if (DIRECT_VIDEO_RE.test(u.pathname)) {
    return [{ url, name: u.pathname.split("/").pop() || u.hostname }];
  }

  // 8. Everything else (brand site, bare host, docs, etc.) — skip.
  return [];
}

/**
 * Resolve a RAW pasted URL → the clippable videos it represents, plus whether it
 * was a Google Drive FOLDER. Reuses the SAME classifier the campaign path uses, so
 * the Paste-URL pill can expand a Drive folder into its member files exactly like
 * the Campaign pill does. GRACEFUL / never-throws (mirrors classifyUrl): a blank or
 * un-parseable URL, a private/unshared folder, or a missing Drive key all collapse
 * to `videos: []` — the caller decides how to surface an empty result.
 *
 *  - Drive FOLDER          → isFolder:true,  videos = every file in the folder (recursed).
 *  - YouTube CHANNEL/PLAYLIST → isFolder:true, videos = its top-N performing videos.
 *  - Drive FILE            → isFolder:false, videos = [that one file].
 *  - single youtube/tiktok/instagram/vimeo/direct-mp4 → isFolder:false, videos = [the url].
 *  - telegram / bare site / anything else            → isFolder:false, videos = [].
 *
 * `isFolder` means "an expandable COLLECTION" (Drive folder OR YouTube
 * channel/playlist) — the Source-node picker keys on it to show a sub-picker of
 * the member videos, so a channel behaves exactly like a Drive folder in the UI.
 */
export async function resolveSourceUrl(
  url: string,
): Promise<{ videos: CampaignSourceVideo[]; isFolder: boolean }> {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return { videos: [], isFolder: false };
  const isFolder = !!driveFolderId(trimmed) || isYoutubeCollection(trimmed);
  try {
    return { videos: await classifyUrl(trimmed), isFolder };
  } catch (err) {
    console.error("resolveSourceUrl failed:", err);
    // classifyUrl already swallows per-URL failures, but stay defensive so a user
    // typo can never bubble a 500 out of the route.
    return { videos: [], isFolder };
  }
}

/**
 * Resolve a content_reward id → its clippable video URLs.
 * Returns null when the reward can't be found; otherwise an always-present
 * (possibly empty) `videos[]`, deduped by stable source identity.
 *
 * The Source-node dropdown re-calls this on EVERY open. Resolving a Drive FOLDER
 * means a slow Drive API listing (+ subfolder recursion), so results are memoized
 * per reward for a short TTL and the per-URL resolution runs CONCURRENTLY — a
 * sequential await per folder was the dropdown's load latency.
 */
const CAMPAIGN_CACHE = new Map<string, { at: number; result: CampaignSourcesResult }>();
const CAMPAIGN_CACHE_TTL_MS = 5 * 60_000;

export async function resolveCampaignSources(rewardId: string): Promise<CampaignSourcesResult | null> {
  const hit = CAMPAIGN_CACHE.get(rewardId);
  if (hit && Date.now() - hit.at < CAMPAIGN_CACHE_TTL_MS) return hit.result;

  const reward = await getContentRewardById(rewardId);
  if (!reward) return null;

  const urls = extractUrls(reward.available_content, reward.content_requirements);

  // Resolve every URL CONCURRENTLY — each Drive folder is a slow listing, so
  // awaiting them one-by-one compounded the latency.
  const classifiedLists = await Promise.all(urls.map((url) => classifyUrl(url).catch(() => [])));

  const videos: CampaignSourceVideo[] = [];
  const seen = new Set<string>();
  for (const classified of classifiedLists) {
    for (const v of classified) {
      const key = sourceKey(v.url);
      if (seen.has(key)) continue;
      seen.add(key);
      videos.push(v);
    }
  }

  const result: CampaignSourcesResult = { contentRewardId: reward.id, title: reward.campaign_name, videos };
  CAMPAIGN_CACHE.set(rewardId, { at: Date.now(), result });
  return result;
}
