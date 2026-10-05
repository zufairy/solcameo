import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Stock B-Roll search for the Editor tab's B-Roll drawer — photos AND videos.
 *
 * Provider chain (best available wins, never a hard failure — see catch below):
 *   1. Pexels (photos + VIDEOS — Openverse has no video search at all) when
 *      PEXELS_API_KEY is set. Free, instant self-serve key, no approval wait:
 *      https://www.pexels.com/api/ — sign in, "Your API Key" page.
 *   2. Openverse (photos only), AUTHENTICATED via a free OAuth2 client-
 *      credentials pair when OPENVERSE_CLIENT_ID/OPENVERSE_CLIENT_SECRET are
 *      set. Free, instant, no approval wait — POST name/email/description to
 *      https://api.openverse.org/v1/auth_tokens/register/, get back a
 *      client_id + client_secret immediately.
 *   3. Openverse anonymous (photos only, no keys at all) — the original
 *      no-setup path. Openverse's anonymous quota is low (100/day, 5/min)
 *      and SHARED across every tenant on the same egress IP on a platform
 *      like Railway; once exhausted every request 401s regardless of who's
 *      actually calling. This is the "Openverse HTTP 401" the operator saw —
 *      not a bug in this route, a rate-limit any of the two keys above fixes
 *      for good (Pexels doubly so: reliable AND it adds video search).
 *
 * GET ?q=<query>&type=photo|video (default: video — the B-Roll drawer defaults
 *   to video results) → { ok, provider, results: StockResult[] }
 */

interface StockResult { id: string; url: string; thumbnail: string; title: string; kind: "photo" | "video" }

const TIMEOUT_MS = 10_000;

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchPexelsPhotos(q: string, apiKey: string): Promise<StockResult[]> {
  const res = await timedFetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=24`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  const json = (await res.json()) as { photos?: { id: number; src: { large: string; medium: string }; alt?: string }[] };
  return (json.photos ?? []).map((p) => ({
    id: `pexels-photo-${p.id}`, url: p.src.large, thumbnail: p.src.medium, title: p.alt || q, kind: "photo" as const,
  }));
}

async function searchPexelsVideos(q: string, apiKey: string): Promise<StockResult[]> {
  const res = await timedFetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=24`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  const json = (await res.json()) as {
    videos?: { id: number; image: string; video_files: { link: string; quality: string; width?: number; height?: number }[] }[];
  };
  return (json.videos ?? [])
    .map((v): StockResult | null => {
      // Prefer "sd" quality (a few MB, fast to fetch/burn) over "hd"/"hls";
      // fall back to the narrowest file available so a portrait/vertical
      // source doesn't hand back an unusably huge 4K master.
      const files = v.video_files ?? [];
      const sd = files.find((f) => f.quality === "sd");
      const smallest = [...files].sort((a, b) => (a.width ?? 9999) - (b.width ?? 9999))[0];
      const file = sd ?? smallest;
      if (!file?.link) return null;
      return { id: `pexels-video-${v.id}`, url: file.link, thumbnail: v.image, title: q, kind: "video" };
    })
    .filter((r): r is StockResult => r !== null);
}

/** Client-credentials token, cached in-process for its ~12h lifetime (Openverse
 *  tokens are valid 12h) — avoids a token round-trip on every search. */
let openverseToken: { value: string; expiresAt: number } | null = null;
async function getOpenverseToken(clientId: string, clientSecret: string): Promise<string | null> {
  if (openverseToken && openverseToken.expiresAt > Date.now()) return openverseToken.value;
  try {
    const res = await timedFetch("https://api.openverse.org/v1/auth_tokens/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    openverseToken = { value: json.access_token, expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 43200) - 300) * 1000 };
    return openverseToken.value;
  } catch {
    return null;
  }
}

async function searchOpenversePhotos(q: string): Promise<StockResult[]> {
  const clientId = process.env.OPENVERSE_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENVERSE_CLIENT_SECRET?.trim();
  const token = clientId && clientSecret ? await getOpenverseToken(clientId, clientSecret) : null;
  const res = await timedFetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=24&mature=false`, {
    headers: {
      "User-Agent": "vello-editor/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`Openverse HTTP ${res.status}`);
  const json = (await res.json()) as { results?: { id: string; url: string; thumbnail: string; title?: string }[] };
  return (json.results ?? [])
    .filter((r) => r.url && r.thumbnail)
    .map((r) => ({ id: r.id, url: r.url, thumbnail: r.thumbnail, title: r.title ?? q, kind: "photo" as const }));
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 200);
  const type = req.nextUrl.searchParams.get("type") === "photo" ? "photo" : "video";
  if (!q) return NextResponse.json({ ok: false, error: "q required" }, { status: 400 });

  const pexelsKey = process.env.PEXELS_API_KEY?.trim();

  try {
    if (type === "video") {
      if (!pexelsKey) {
        // No video provider without a Pexels key — Openverse has no video
        // search at all. Ok:true with a clear message, not a hard error: an
        // empty result set with an actionable reason, not a red error toast.
        return NextResponse.json({
          ok: true, provider: "none", results: [],
          notice: "Stock VIDEO search needs a free Pexels API key (PEXELS_API_KEY) — instant signup at pexels.com/api, no approval wait. Photo search still works below.",
        });
      }
      const results = await searchPexelsVideos(q, pexelsKey);
      return NextResponse.json({ ok: true, provider: "pexels", results });
    }
    // type === "photo"
    if (pexelsKey) {
      const results = await searchPexelsPhotos(q, pexelsKey);
      return NextResponse.json({ ok: true, provider: "pexels", results });
    }
    const results = await searchOpenversePhotos(q);
    return NextResponse.json({ ok: true, provider: "openverse", results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "search failed" }, { status: 502 });
  }
}
