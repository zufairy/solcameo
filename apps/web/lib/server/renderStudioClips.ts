// Online footage finder for Render Studio. Searches stock providers in parallel
// (Pexels, Pixabay when keyed; Wikimedia Commons keyless), then ranks candidates
// by how well they fit the canvas so the agent only ever sees a short, relevant,
// pre-vetted list (compact = few tokens, and no hallucinated URLs).

import { callClaudeJSON } from "@/lib/server/kie-claude";
import type { Asset } from "@/lib/render-studio/compose";

const TIMEOUT_MS = 8_000;

export interface Candidate {
  provider: "pexels" | "pixabay" | "wikimedia";
  id: string;
  title: string;
  url: string;
  thumb?: string;
  duration: number;
  width: number;
  height: number;
  /** Rank within its provider query (0 = best match). */
  rank: number;
  query: string;
}

const get = async (url: string, headers?: Record<string, string>): Promise<unknown> => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    return res.ok ? await res.json().catch(() => null) : null;
  } catch { return null; } finally { clearTimeout(t); }
};

interface PexelsFile { link?: string; width?: number; height?: number; file_type?: string }
async function pexels(q: string, portrait: boolean): Promise<Candidate[]> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) return [];
  const data = await get(`https://api.pexels.com/videos/search?${new URLSearchParams({ query: q, per_page: "10", ...(portrait ? { orientation: "portrait" } : {}) })}`, { Authorization: key }) as
    { videos?: Array<{ id?: number; duration?: number; image?: string; url?: string; video_files?: PexelsFile[] }> } | null;
  const out: Candidate[] = [];
  (data?.videos ?? []).forEach((v, rank) => {
    const files = (v.video_files ?? []).filter((f) => f.link && /mp4/i.test(f.file_type ?? "mp4") && (f.height ?? 0) >= 720 && (f.width ?? 0) <= 2200);
    // Smallest file that is still HD: faster to fetch and transcode, same look.
    const pick = files.sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0))[0];
    if (pick?.link && v.duration) out.push({ provider: "pexels", id: `px${v.id}`, title: (v.url ?? "").split("/").filter(Boolean).pop()?.replace(/-\d+$/, "").replace(/-/g, " ") || q, url: pick.link, thumb: v.image, duration: v.duration, width: pick.width ?? 0, height: pick.height ?? 0, rank, query: q });
  });
  return out;
}

async function pixabay(q: string): Promise<Candidate[]> {
  const key = process.env.PIXABAY_API_KEY?.trim();
  if (!key) return [];
  const data = await get(`https://pixabay.com/api/videos/?${new URLSearchParams({ key, q, per_page: "10", safesearch: "true" })}`) as
    { hits?: Array<{ id?: number; duration?: number; tags?: string; picture_id?: string; videos?: Record<string, { url?: string; width?: number; height?: number }> }> } | null;
  const out: Candidate[] = [];
  (data?.hits ?? []).forEach((h, rank) => {
    const f = h.videos?.large?.url ? h.videos.large : h.videos?.medium;
    if (f?.url && h.duration) out.push({ provider: "pixabay", id: `pb${h.id}`, title: (h.tags ?? q).split(",").slice(0, 3).join(", "), url: f.url, thumb: h.picture_id ? `https://i.vimeocdn.com/video/${h.picture_id}_640x360.jpg` : undefined, duration: h.duration, width: f.width ?? 0, height: f.height ?? 0, rank, query: q });
  });
  return out;
}

async function wikimedia(q: string): Promise<Candidate[]> {
  const data = await get(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", generator: "search", gsrsearch: `filetype:video ${q}`, gsrlimit: "8", gsrnamespace: "6", prop: "imageinfo", iiprop: "url|size|mediatype|extmetadata", iiurlwidth: "480", format: "json", origin: "*" })}`, { "User-Agent": "vello-render-studio/1.0" }) as
    { query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ url?: string; thumburl?: string; mediatype?: string; size?: number; width?: number; height?: number }> }> } } | null;
  const out: Candidate[] = [];
  Object.values(data?.query?.pages ?? {}).forEach((p, rank) => {
    const i = p.imageinfo?.[0];
    if (i?.mediatype === "VIDEO" && i.url && (i.size ?? 0) > 300_000 && (i.size ?? 0) < 80_000_000) out.push({ provider: "wikimedia", id: `wm${rank}${(p.title ?? "").length}`, title: (p.title ?? q).replace(/^File:/, "").replace(/\.\w+$/, "").replace(/_/g, " "), url: i.url, thumb: i.thumburl, duration: 0, width: i.width ?? 0, height: i.height ?? 0, rank, query: q });
  });
  return out;
}

/** Higher is better. Rewards provider relevance, fit to the canvas, HD, usable length. */
export function scoreCandidate(c: Candidate, canvas: { width: number; height: number }): number {
  let s = 100 - c.rank * 9;
  const wantPortrait = canvas.height > canvas.width, wantLandscape = canvas.width > canvas.height;
  const portrait = c.height > c.width, landscape = c.width > c.height;
  if (c.width && c.height) {
    if ((wantPortrait && portrait) || (wantLandscape && landscape) || (!wantPortrait && !wantLandscape)) s += 22;
    else s -= 12;
    const px = c.width * c.height;
    s += px >= 1920 * 1080 * 0.9 ? 12 : px >= 1280 * 720 * 0.9 ? 6 : -15;
    if (px > 3840 * 2160) s -= 20;
  }
  if (c.duration) s += c.duration >= 5 && c.duration <= 25 ? 14 : c.duration < 3 ? -25 : c.duration > 45 ? -12 : 0;
  if (c.provider === "wikimedia") s -= 14;
  return s;
}

export function rankCandidates(all: Candidate[], canvas: { width: number; height: number }, limit = 8): Candidate[] {
  const seen = new Set<string>();
  return all
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .map((c) => ({ c, s: scoreCandidate(c, canvas) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Turns a brief into 2-3 short stock-footage search queries (one tiny model call, heuristic fallback). */
export async function planQueries(brief: string): Promise<string[]> {
  const heuristic = () => {
    const words = brief.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
    return [words.slice(0, 3).join(" ")].filter(Boolean);
  };
  try {
    const r = await callClaudeJSON<{ queries?: string[] }>({
      system: 'You write stock-footage search queries. Reply ONLY JSON {"queries":[...]} with 2-3 queries of 2-4 plain words each, concrete visuals (what the camera sees), no brand names or trademarks, no verbs like "make".',
      user: brief.slice(0, 400),
      maxTokens: 80,
    });
    const q = (r.queries ?? []).map((s) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 3);
    return q.length ? q : heuristic();
  } catch { return heuristic(); }
}
const STOP = new Set(["make", "video", "with", "that", "this", "your", "from", "have", "want", "need", "clip", "clips", "footage", "please", "using", "about", "agent", "vello", "logo", "intro", "background"]);

export function providersConfigured(): string[] {
  return [process.env.PEXELS_API_KEY?.trim() && "pexels", process.env.PIXABAY_API_KEY?.trim() && "pixabay", "wikimedia"].filter(Boolean) as string[];
}

export async function searchFootage(queries: string[], canvas: { width: number; height: number }, limit = 8): Promise<Candidate[]> {
  const portrait = canvas.height > canvas.width;
  const jobs = queries.slice(0, 3).flatMap((q) => [pexels(q, portrait), pixabay(q), wikimedia(q)]);
  const all = (await Promise.all(jobs)).flat();
  return rankCandidates(all, canvas, limit);
}

export const toAsset = (c: Candidate): Asset => ({ id: c.id, kind: "video", url: c.url, title: c.title.slice(0, 60), duration: c.duration || undefined, width: c.width || undefined, height: c.height || undefined, thumb: c.thumb, source: "stock" });
