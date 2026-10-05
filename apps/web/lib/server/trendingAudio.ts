// Trending meme-audio source for the clip.memeaudio skill. The actual sounds
// come from an EXTERNAL trending API configured via env:
//   MEME_AUDIO_API_URL  — GET endpoint returning a list of trending sounds
//   MEME_AUDIO_API_KEY  — optional bearer token for that endpoint
// With no MEME_AUDIO_API_URL set (or on ANY error), fetchTrendingAudio returns []
// so the inspector simply shows no sounds and the render is unchanged — the
// feature degrades gracefully instead of failing the pipeline.

export interface TrendingAudio {
  /** Stable id the inspector stores as config.audioId. */
  id: string;
  /** Human label for the sound (shown in the inspector list). */
  title: string;
  /** Direct URL to the audio file — fetched to a temp input by the clip route. */
  audioUrl: string;
  /** Optional length in seconds (used to trim the overlay if provided). */
  durationSec?: number;
}

const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(+v)) return +v;
  return undefined;
};

/** Map a loosely-typed API record onto a TrendingAudio, or null if it lacks the
 *  load-bearing fields (id + audioUrl). Tolerates a few common field aliases so
 *  a third-party schema doesn't need an exact match. */
function coerce(raw: unknown): TrendingAudio | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id) ? o.id : str(o.soundId) ? o.soundId : str(o.uuid) ? o.uuid : undefined;
  const audioUrl = str(o.audioUrl) ? o.audioUrl : str(o.url) ? o.url : str(o.mp3) ? o.mp3 : undefined;
  if (!str(id) || !str(audioUrl)) return null;
  const title = str(o.title) ? o.title : str(o.name) ? o.name : id;
  const durationSec = num(o.durationSec) ?? num(o.duration);
  return { id, title, audioUrl, ...(durationSec ? { durationSec } : {}) };
}

/**
 * Fetch up to `limit` trending sounds from MEME_AUDIO_API_URL. Returns [] when
 * the env is unset or anything goes wrong (network, non-200, bad JSON, no array)
 * — never throws, so the inspector list and the render pipeline stay resilient.
 */
export async function fetchTrendingAudio(limit = 20): Promise<TrendingAudio[]> {
  const url = (globalThis.process?.env?.MEME_AUDIO_API_URL ?? "").trim();
  if (!url) return [];
  const key = (globalThis.process?.env?.MEME_AUDIO_API_KEY ?? "").trim();
  const cap = Math.min(100, Math.max(1, Math.floor(limit) || 20));
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    // Accept either a bare array or { items|sounds|data: [...] }.
    const list = Array.isArray(json)
      ? json
      : Array.isArray((json as { items?: unknown })?.items)
        ? (json as { items: unknown[] }).items
        : Array.isArray((json as { sounds?: unknown })?.sounds)
          ? (json as { sounds: unknown[] }).sounds
          : Array.isArray((json as { data?: unknown })?.data)
            ? (json as { data: unknown[] }).data
            : [];
    return list.map(coerce).filter((a): a is TrendingAudio => a !== null).slice(0, cap);
  } catch {
    return [];
  }
}
