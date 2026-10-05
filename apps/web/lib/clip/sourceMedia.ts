type StoredVideo = { url: string; durationSeconds?: number };
export type ClipSourceMedia = { ok: boolean; url?: string; durationSeconds?: number; storageId?: string; error?: string; cached?: boolean };

/** Reuse the full saved source for transcription. A shared download must never
 * carry a storageId into the pipeline's temporary-audio cleanup. */
export async function prepareClipSource({ lookupFull, downloadAudio, onReuse }: {
  lookupFull: () => Promise<StoredVideo | null>;
  downloadAudio: () => Promise<ClipSourceMedia>;
  onReuse: () => Promise<unknown>;
}): Promise<ClipSourceMedia & { durationSeconds: number }> {
  const saved = await lookupFull().catch(() => null);
  // A cached full download whose blob is gone must not be reused (every run
  // would fail "HTTP 404") — fall through to a fresh audio pull instead.
  if (!saved?.url || !(await storedFileExists(saved.url))) {
    const downloaded = await downloadAudio();
    return { ...downloaded, durationSeconds: downloaded.durationSeconds ?? 0 };
  }
  await onReuse();
  return { ok: true, url: saved.url, durationSeconds: saved.durationSeconds ?? 0, cached: true };
}

/** A completed download is already a single-video source. URL classification
 * only understands a limited set of hosts/extensions and must not reject it.
 * Explicit collection runs still expand the original folder/channel. */
export async function resolveClipRunSources({ sourceUrl, clipAll, lookupFull, resolveOriginal }: {
  sourceUrl: string;
  clipAll: boolean;
  lookupFull: () => Promise<StoredVideo | null>;
  resolveOriginal: () => Promise<{ videos: { url: string; name: string }[] }>;
}) {
  if (!clipAll) {
    const saved = await lookupFull().catch(() => null);
    if (saved?.url) return { videos: [{ url: sourceUrl, name: "Downloaded video" }] };
  }
  return resolveOriginal();
}

/** True unless the stored file is definitely GONE (404/410). A cached download
 *  can outlive its blob (cleanup, a manual delete) while the cache row still
 *  points at it — reusing it then failed every run with "HTTP 404" until the
 *  row was cleared. Network errors / timeouts count as alive (don't turn a blip
 *  into a re-download). HEAD with a Range GET fallback for hosts without HEAD. */
export async function storedFileExists(url: string, timeoutMs = 6000): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return true;
  try {
    let res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(timeoutMs) });
      try { await res.body?.cancel(); } catch { /* ignore */ }
    }
    return res.status !== 404 && res.status !== 410;
  } catch {
    return true;
  }
}
