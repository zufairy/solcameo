/**
 * Keyless trending SFX search (Openverse's /v1/audio/ endpoint — same free,
 * no-signup CC-licensed catalog as imageSearch.ts, just the audio index instead
 * of images; mostly freesound.org previews + some Wikimedia Commons clips).
 * Used by the Gen Z sample template to widen its reaction-sting pool beyond the
 * 3 fixed bundled sounds (vine-boom/bruh/fah) with real internet meme/reaction
 * SFX, bucketed by the same shock/funny/hype emotion buckets reactionSfxPack.ts
 * already uses — so a keyword hit still gets a THEMATICALLY appropriate sound,
 * just from a much larger pool.
 */

const OPENVERSE_AUDIO_SEARCH = "https://api.openverse.org/v1/audio/";
// Punchy reaction stings are short — cut anything that reads as a music bed /
// long ambience clip rather than a one-shot hit.
const MAX_DURATION_MS = 4_000;
const MIN_DURATION_MS = 150;

interface OpenverseAudioResult {
  url?: string;
  duration?: number; // milliseconds
  mature?: boolean;
}

/** Curated search terms per emotion bucket — a few tries each so a single dead
 *  query (or a term with no short results) doesn't leave a bucket empty. */
const BUCKET_QUERIES: Record<"shock" | "funny" | "hype", string[]> = {
  shock: ["record scratch", "dramatic alarm sting", "suspense stinger"],
  funny: ["comedic boing", "cartoon pop sound", "slide whistle"],
  hype: ["airhorn", "cash register win", "crowd cheer sting"],
};

async function searchOnce(q: string, timeoutMs: number): Promise<OpenverseAudioResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${OPENVERSE_AUDIO_SEARCH}?${new URLSearchParams({ q, page_size: "10", mature: "false" }).toString()}`;
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "vello-clipper/1.0 (genz-sfx)" } });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as { results?: OpenverseAudioResult[] } | null;
    return Array.isArray(data?.results) ? data!.results! : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** One short, non-mature trending SFX URL for the given emotion bucket, or null
 *  if every query for that bucket came up empty/failed. Best-effort — never
 *  throws. */
export async function searchTrendingSfx(bucket: "shock" | "funny" | "hype", opts?: { timeoutMs?: number }): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 6_000;
  for (const q of BUCKET_QUERIES[bucket]) {
    const results = await searchOnce(q, timeoutMs);
    const pick = results.find(
      (r) => typeof r.url === "string" && r.url && !r.mature &&
        typeof r.duration === "number" && r.duration >= MIN_DURATION_MS && r.duration <= MAX_DURATION_MS,
    );
    if (pick?.url) return pick.url;
  }
  return null;
}
