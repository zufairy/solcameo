// Stock UGC clip library — short pre-uploaded reaction / walking / lifestyle
// clips reused as the canvas for text-story samples (zero video-generation
// spend: the video already exists, only a text overlay is burned on it).
//
// UPLOADING CLIPS (operator guide):
//   Supabase dashboard → Storage → bucket "vello-stock-clips" (created public
//   on first use) → Upload .mp4 files (9:16 vertical, ~6-15s each: reactions,
//   people walking, daily-life b-roll). Filenames don't matter — the picker
//   samples randomly. More clips = less repetition across samples.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SB_SRV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const STOCK_BUCKET = "vello-stock-clips";

const VIDEO_RE = /\.(mp4|mov|webm)$/i;

/** All stock clip public URLs. Empty array when the bucket is missing/empty. */
export async function listStockClips(): Promise<string[]> {
  if (!SB_URL || !SB_SRV_KEY) return [];
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SB_URL, SB_SRV_KEY);
    const buckets = await supabase.storage.listBuckets();
    if (!buckets.data?.some((b) => b.name === STOCK_BUCKET)) {
      await supabase.storage.createBucket(STOCK_BUCKET, { public: true }).catch(() => null);
      return [];
    }
    const { data, error } = await supabase.storage.from(STOCK_BUCKET).list("", { limit: 500 });
    if (error || !data) return [];
    return data
      .filter((f) => VIDEO_RE.test(f.name))
      .map((f) => supabase.storage.from(STOCK_BUCKET).getPublicUrl(f.name).data.publicUrl)
      .filter(Boolean);
  } catch (e) {
    console.warn("[stockClips] list failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Pick up to `n` DISTINCT random clips (fewer when the library is small). */
export function pickRandomClips(urls: string[], n: number): string[] {
  const pool = [...urls];
  const out: string[] = [];
  while (pool.length && out.length < n) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}
