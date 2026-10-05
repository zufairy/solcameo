/**
 * Keyless stock-photo search (Openverse — api.openverse.org, no API key/signup
 * required, CC-licensed images with direct hotlinkable URLs). Used by the
 * Podcast sample template's "article photo" pane: a real photo relevant to the
 * clip's own topic, not a generic stock placeholder, without needing an
 * Unsplash/Pexels/Google-Images API key the deployment doesn't have configured.
 *
 * Best-effort: any failure (network, empty results, malformed response) resolves
 * to null — callers degrade to no composite pane rather than failing the render.
 */

const OPENVERSE_SEARCH = "https://api.openverse.org/v1/images/";
const TIMEOUT_MS = 8_000;
// Below this, a result is more likely a tiny icon/thumbnail than a usable photo.
const MIN_DIMENSION = 480;

interface OpenverseResult {
  url?: string;
  width?: number;
  height?: number;
  mature?: boolean;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with",
  "is", "are", "was", "were", "this", "that", "it", "its", "how", "why", "what",
  "why", "just", "not", "no", "so", "up", "out", "you", "your", "we", "our",
]);

/** A full clip title/sentence ("Bitcoin Breaks $70K Unexpectedly") returns ZERO
 *  Openverse results — its search ANDs every query term against sparse CC-photo
 *  tag/title metadata, so a specific multi-word sentence rarely matches anything.
 *  Strip punctuation/currency/stopwords down to the strongest 1-3 keywords, which
 *  is what a stock-photo search actually wants. */
function toKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // strip punctuation, $, %, etc.
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

async function searchOnce(q: string, controller: AbortController): Promise<OpenverseResult[] | null> {
  const url = `${OPENVERSE_SEARCH}?${new URLSearchParams({
    q,
    page_size: "10",
    mature: "false",
    // Photographic results only — filters out vector/illustration noise that
    // reads as generic clip-art rather than an "article photo".
    category: "photograph",
  }).toString()}`;
  const res = await fetch(url, {
    signal: controller.signal,
    headers: { "User-Agent": "vello-clipper/1.0 (podcast-photo-pane)" },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { results?: OpenverseResult[] } | null;
  return Array.isArray(data?.results) ? data!.results! : null;
}

/**
 * Search for a single relevant, reasonably-sized, non-mature photo. `text` is
 * the clip's own title/caption — reduced to keywords internally (see toKeywords)
 * since Openverse's search ANDs full-sentence queries down to zero hits. Tries
 * progressively broader queries (top-3 keywords → top-1 keyword) so a narrow
 * topic still finds SOMETHING rather than nothing.
 */
export async function searchStockPhoto(text: string, opts?: { timeoutMs?: number }): Promise<string | null> {
  const keywords = toKeywords(text);
  if (keywords.length === 0) return null;
  const attempts = [keywords.slice(0, 3).join(" "), keywords[0]].filter((q, i, arr) => q && arr.indexOf(q) === i);

  // Provider 0 (when configured): Pexels photos — a free key, but real quota
  // (200/hr) instead of Openverse's tiny anonymous PER-IP allowance, which a
  // shared datacenter egress IP (Railway) burns through instantly. That
  // exhaustion is exactly the "could not find any usable stock imagery"
  // production failure — so a keyed provider goes first when available.
  const pexelsKey = process.env.PEXELS_API_KEY?.trim();
  if (pexelsKey) {
    for (const q of attempts) {
      const url = await searchPexelsPhoto(q, pexelsKey, opts?.timeoutMs ?? TIMEOUT_MS).catch(() => null);
      if (url) return url;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? TIMEOUT_MS);
  try {
    for (const q of attempts) {
      const results = await searchOnce(q, controller).catch(() => null);
      if (!results || results.length === 0) continue;
      const pick = results.find(
        (r) => typeof r.url === "string" && r.url && !r.mature &&
          (typeof r.width !== "number" || r.width >= MIN_DIMENSION) &&
          (typeof r.height !== "number" || r.height >= MIN_DIMENSION),
      );
      const url = pick?.url ?? results[0]?.url;
      if (url) return url;
    }
  } finally {
    clearTimeout(timer);
  }

  // Last resort: Wikimedia Commons — keyless with a generous limit, so the
  // chain still returns SOMETHING when Openverse is rate-limited and no Pexels
  // key is configured.
  for (const q of attempts) {
    const url = await searchWikimediaPhoto(q, opts?.timeoutMs ?? TIMEOUT_MS).catch(() => null);
    if (url) return url;
  }
  return null;
}

async function searchPexelsPhoto(q: string, apiKey: string, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: "5", orientation: "portrait" })}`,
      { headers: { Authorization: apiKey }, signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { photos?: { src?: { large2x?: string; large?: string } }[] } | null;
    for (const p of data?.photos ?? []) {
      const url = p.src?.large2x ?? p.src?.large;
      if (url) return url;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface WikimediaPage { imageinfo?: { thumburl?: string; url?: string; width?: number; height?: number }[] }

async function searchWikimediaPhoto(q: string, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `filetype:bitmap ${q}`,
      gsrlimit: "8",
      gsrnamespace: "6",
      prop: "imageinfo",
      iiprop: "url|size",
      iiurlwidth: "1280",
      format: "json",
      origin: "*",
    })}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "vello-clipper/1.0 (stock-photo-fallback)" } });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { query?: { pages?: Record<string, WikimediaPage> } } | null;
    for (const page of Object.values(data?.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      const w = info?.width ?? 0;
      const h = info?.height ?? 0;
      if (w >= MIN_DIMENSION && h >= MIN_DIMENSION && (info?.thumburl || info?.url)) {
        return info.thumburl ?? info.url ?? null;
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
