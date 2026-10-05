/**
 * Keyless background-MUSIC search for the Documentary app — same free Openverse
 * audio catalog audioSearch.ts uses for SFX, but tuned for long ambient music
 * beds (30s+) instead of one-shot stings. Best-effort: null means "render with
 * voiceover only", never a failed documentary.
 */

const OPENVERSE_AUDIO_SEARCH = "https://api.openverse.org/v1/audio/";
const MIN_DURATION_MS = 25_000;

export const MUSIC_MOODS = [
  { id: "cinematic", label: "Cinematic", queries: ["cinematic ambient music", "epic orchestral background"] },
  { id: "calm", label: "Calm & Warm", queries: ["calm piano ambient", "soft acoustic background music"] },
  { id: "uplifting", label: "Uplifting", queries: ["uplifting corporate music", "inspiring background music"] },
  { id: "mystery", label: "Mystery", queries: ["dark ambient drone", "mysterious atmosphere music"] },
  { id: "none", label: "No music", queries: [] },
] as const;

export type MusicMoodId = (typeof MUSIC_MOODS)[number]["id"];

export function normalizeMusicMood(id: string | undefined): MusicMoodId {
  return (MUSIC_MOODS.some((m) => m.id === id) ? id : "cinematic") as MusicMoodId;
}

interface OpenverseAudioResult { url?: string; duration?: number; mature?: boolean }

export async function searchMoodMusic(mood: string, timeoutMs = 8000): Promise<string | null> {
  const def = MUSIC_MOODS.find((m) => m.id === normalizeMusicMood(mood));
  if (!def || def.queries.length === 0) return null;
  for (const q of def.queries) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const url = `${OPENVERSE_AUDIO_SEARCH}?${new URLSearchParams({ q, page_size: "15", mature: "false" }).toString()}`;
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "vello-documentary/1.0" } });
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as { results?: OpenverseAudioResult[] } | null;
      const pick = (data?.results ?? []).find(
        (r) => r.url && !r.mature && typeof r.duration === "number" && r.duration >= MIN_DURATION_MS,
      );
      if (pick?.url) return pick.url;
    } catch {
      /* try next query */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
