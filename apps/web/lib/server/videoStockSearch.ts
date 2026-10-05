/**
 * Stock VIDEO search for the Documentary app — real b-roll footage instead of
 * still photos wherever a provider is configured.
 *
 * Provider chain (best first), each skipped when its key is absent:
 *   1. Pexels Videos  — PEXELS_API_KEY  (free key, ~150k clips, portrait filter)
 *   2. Pixabay Videos — PIXABAY_API_KEY (free key, ~230k clips)
 * No keyless stock-video API exists (Openverse is images/audio only), so with
 * no keys configured this resolves null and the caller falls back to the
 * Ken Burns photo path.
 *
 * Best-effort like imageSearch: every failure resolves null, never throws.
 */

const TIMEOUT_MS = 9_000;

export interface StockVideoHit {
  url: string;          // direct video file (mp4/webm/ogv)
  durationSec: number;  // provider-reported clip length (0 = unknown)
  provider: "pexels" | "pixabay" | "wikimedia";
}

interface PexelsVideoFile { link?: string; width?: number; height?: number; file_type?: string }
interface PexelsVideo { duration?: number; video_files?: PexelsVideoFile[] }

async function searchPexels(query: string, apiKey: string): Promise<StockVideoHit | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `https://api.pexels.com/videos/search?${new URLSearchParams({
      query,
      orientation: "portrait",
      size: "medium",
      per_page: "6",
    })}`;
    const res = await fetch(url, { headers: { Authorization: apiKey }, signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { videos?: PexelsVideo[] } | null;
    for (const v of data?.videos ?? []) {
      const dur = Number(v.duration ?? 0);
      if (dur < 4 || dur > 60) continue; // too short to cover a scene / too heavy
      // Prefer a portrait HD file; fall back to the largest mp4.
      const files = (v.video_files ?? []).filter((f) => f.link && /mp4/i.test(f.file_type ?? "mp4"));
      const portrait = files.filter((f) => (f.height ?? 0) > (f.width ?? 0) && (f.height ?? 0) >= 1080);
      const pick = (portrait.length ? portrait : files).sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
      if (pick?.link) return { url: pick.link, durationSec: dur, provider: "pexels" };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface PixabayVideoEntry { duration?: number; videos?: Record<string, { url?: string; width?: number; height?: number }> }

async function searchPixabay(query: string, apiKey: string): Promise<StockVideoHit | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `https://pixabay.com/api/videos/?${new URLSearchParams({
      key: apiKey,
      q: query,
      per_page: "6",
      safesearch: "true",
    })}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { hits?: PixabayVideoEntry[] } | null;
    for (const h of data?.hits ?? []) {
      const dur = Number(h.duration ?? 0);
      if (dur < 4 || dur > 60) continue;
      const file = h.videos?.large?.url ? h.videos.large : h.videos?.medium;
      if (file?.url) return { url: file.url, durationSec: dur, provider: "pixabay" };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface WikimediaVideoPage { imageinfo?: { url?: string; mediatype?: string; size?: number }[] }

/** Wikimedia Commons — KEYLESS real footage (webm/ogv, ffmpeg reads both).
 *  Quality varies more than Pexels, but it means the video path works with no
 *  configuration at all. */
async function searchWikimediaVideo(query: string): Promise<StockVideoHit | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `filetype:video ${query}`,
      gsrlimit: "8",
      gsrnamespace: "6",
      prop: "imageinfo",
      iiprop: "url|size|mediatype",
      format: "json",
      origin: "*",
    })}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "vello-documentary/1.0 (stock-broll)" } });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { query?: { pages?: Record<string, WikimediaVideoPage> } } | null;
    for (const page of Object.values(data?.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      const size = info?.size ?? 0;
      // Skip tiny stubs and files too heavy to download inside the render budget.
      if (info?.mediatype === "VIDEO" && info.url && size > 300_000 && size < 60_000_000) {
        return { url: info.url, durationSec: 0, provider: "wikimedia" };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when a KEYED provider is configured. Wikimedia works keyless, so video
 *  search is always worth attempting — this only signals "premium footage on". */
export function stockVideoConfigured(): boolean {
  return !!(process.env.PEXELS_API_KEY?.trim() || process.env.PIXABAY_API_KEY?.trim());
}

/** Best real b-roll clip for a 2-4 word scene query, or null.
 *  Chain: Pexels (key) → Pixabay (key) → Wikimedia Commons (keyless). */
export async function searchStockVideo(query: string): Promise<StockVideoHit | null> {
  const q = query.trim();
  if (!q) return null;
  const pexelsKey = process.env.PEXELS_API_KEY?.trim();
  if (pexelsKey) {
    const hit = await searchPexels(q, pexelsKey);
    if (hit) return hit;
  }
  const pixabayKey = process.env.PIXABAY_API_KEY?.trim();
  if (pixabayKey) {
    const hit = await searchPixabay(q, pixabayKey);
    if (hit) return hit;
  }
  return await searchWikimediaVideo(q);
}
