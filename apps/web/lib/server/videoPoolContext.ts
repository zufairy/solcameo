import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { sourceKey } from "@/lib/server/sourceKey";
import type { PoolItem } from "@/lib/server/videoPool";

/**
 * Transcript CONTEXT for the Hook Videos / Main Content pools.
 *
 * Contextual picking needs to know what each uploaded video is about. Transcribing
 * one is neither free nor fast, so this module only ever READS the shared transcript
 * cache (keyed by `sourceKey`, the same key the transcribe route writes) and warms
 * misses in the BACKGROUND.
 *
 * The consequence is deliberate and worth stating plainly: the first run after an
 * upload has no transcript, so selection cycles instead of matching. By the next run
 * the cache is warm and picks become contextual. The alternative — blocking a render
 * on N transcriptions — would make the first run of a fresh pool crawl, and a slow
 * or failed STT call would take the whole run down with it.
 */

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** Flatten a cached transcript blob into plain text for keyword matching. */
function transcriptText(blob: unknown): string {
  const t = blob as { segments?: { text?: string }[]; words?: { word?: string }[] } | null;
  if (!t) return "";
  if (Array.isArray(t.segments) && t.segments.length) {
    return t.segments.map((s) => s?.text ?? "").join(" ").trim();
  }
  if (Array.isArray(t.words) && t.words.length) {
    return t.words.map((w) => w?.word ?? "").join(" ").trim();
  }
  return "";
}

/**
 * Build pool items for `urls`, attaching each video's cached transcript when one
 * exists. Never throws: a cache miss, an unreachable blob, or no Convex at all just
 * yields an item with no transcript, which selection handles by cycling.
 */
export async function loadPool(urls: readonly string[] | undefined | null): Promise<PoolItem[]> {
  const clean = (urls ?? []).filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim());
  if (clean.length === 0) return [];
  if (!CONVEX_URL) return clean.map((url) => ({ url }));

  const convex = new ConvexHttpClient(CONVEX_URL);
  return await Promise.all(
    clean.map(async (url): Promise<PoolItem> => {
      try {
        const cached = (await convex.query(api.transcriptCache.getByKey, { sourceKey: sourceKey(url) })) as
          | { transcriptUrl: string | null }
          | null;
        if (!cached?.transcriptUrl) return { url };
        const text = transcriptText(await (await fetch(cached.transcriptUrl)).json());
        return text ? { url, transcript: text } : { url };
      } catch {
        return { url }; // context is a bonus, never a requirement
      }
    }),
  );
}

/**
 * Kick off transcription for pool entries that have no cached transcript yet, so
 * the NEXT run can match on content. Fire-and-forget by design — the caller must not
 * await render-blocking work for a nicety. The transcribe route is idempotent and
 * caches by sourceKey, so re-warming an already-cached video costs nothing.
 */
export function warmPool(pool: PoolItem[], baseUrl: string, secret: string): void {
  const missing = pool.filter((p) => !p.transcript).map((p) => p.url);
  if (missing.length === 0 || !baseUrl) return;
  for (const sourceUrl of missing) {
    fetch(`${baseUrl}/api/video/transcribe-clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "X-Internal-Secret": secret } : {}) },
      body: JSON.stringify({ sourceUrl }),
    }).catch((e) => console.warn(`[videoPool] warm transcribe failed for ${sourceUrl.slice(0, 80)}: ${e instanceof Error ? e.message : e}`));
  }
}
