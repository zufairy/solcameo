import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { resolveDownloader, type FetchOpts } from "@/lib/server/downloader";
import { putVideo, putVideoFile, r2Configured } from "@/lib/server/videoStorage";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { driveFileId } from "@/lib/server/sourceKey";

/** The same Drive file arrives as /file/d/, /open?id=, and links with tracking
 * params. Cache by file identity so another paste does not spend its quota. */
export function downloadCacheSourceUrl(sourceUrl: string): string {
  const fileId = driveFileId(sourceUrl);
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : sourceUrl;
}

const EDITOR_PREVIEW_SECONDS = 10;

/** Browser-safe H.264/AAC preview of a previously stored full source. This
 * never contacts Drive again: a quota-blocked original can still be previewed
 * from its R2/Convex copy. */
export async function ensureEditorPreview(
  sourceUrl: string,
  mintAddress?: string,
  localFullPath?: string,
  originalDuration?: number,
  onProgress?: FetchOpts["onProgress"],
  force = false,
): Promise<{ url: string; storageId: string; durationSeconds: number }> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const ffmpegPath = resolveFfmpegPath();
  if (!convexUrl || !ffmpegPath) throw new Error("Preview conversion is unavailable on this server");
  const convex = new ConvexHttpClient(convexUrl);
  const sectionKey = `editor-h264-0-${EDITOR_PREVIEW_SECONDS}`;
  onProgress?.({ pct: 10, downloadedBytes: 0, totalBytes: 0, stage: "Checking saved video preview" });
  for (const candidate of force ? [] : cacheLookupUrls(sourceUrl)) {
    const preview = await convex.query(api.downloadCache.getByKey, { sourceUrl: candidate, mode: "segment", sectionKey });
    if (preview?.url) {
      const { storedFileExists } = await import("@/lib/clip/sourceMedia");
      if (await storedFileExists(preview.url)) {
        if (mintAddress) await convex.mutation(api.downloadCache.put, {
          sourceUrl: preview.sourceUrl, mode: "segment", sectionKey,
          url: preview.url, storageId: preview.storageId,
          durationSeconds: preview.durationSeconds, mintAddress,
        });
        return { url: preview.url, storageId: preview.storageId, durationSeconds: preview.durationSeconds ?? originalDuration ?? EDITOR_PREVIEW_SECONDS };
      }
    }
  }

  let fullUrl: string | undefined;
  let cacheUrl = downloadCacheSourceUrl(sourceUrl);
  let fullDuration = originalDuration;
  if (!localFullPath) {
    for (const candidate of cacheLookupUrls(sourceUrl)) {
      const full = await convex.query(api.downloadCache.getByKey, { sourceUrl: candidate, mode: "full", sectionKey: "" });
      if (full?.url) {
        const { storedFileExists } = await import("@/lib/clip/sourceMedia");
        if (!(await storedFileExists(full.url))) continue;
        fullUrl = full.url;
        cacheUrl = full.sourceUrl;
        fullDuration = full.durationSeconds;
        break;
      }
    }
    // Older editor sessions saved a raw 0-10s segment, often MOV/HEVC. It is
    // still our stored media: transcode that copy instead of re-hitting a Drive
    // file whose download quota may now be exhausted.
    if (!fullUrl) for (const candidate of cacheLookupUrls(sourceUrl)) {
      const segment = await convex.query(api.downloadCache.getByKey, { sourceUrl: candidate, mode: "segment", sectionKey: `0-${EDITOR_PREVIEW_SECONDS}` });
      if (segment?.url) {
        const { storedFileExists } = await import("@/lib/clip/sourceMedia");
        if (!(await storedFileExists(segment.url))) continue;
        fullUrl = segment.url;
        cacheUrl = segment.sourceUrl;
        fullDuration = segment.durationSeconds;
        break;
      }
    }
    if (!fullUrl) throw new Error("The original video is not stored yet. Download it before generating a preview.");
  }

  const workDir = await mkdtemp(join(tmpdir(), "vello-editor-preview-"));
  try {
    let input = localFullPath;
    const output = join(workDir, "preview.mp4");
    const transcode = (mediaInput: string, timeoutMs?: number) => new Promise<void>((resolve, reject) => {
      const args = [
        "-y", "-i", mediaInput, "-t", String(EDITOR_PREVIEW_SECONDS),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale=w=1280:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output,
      ];
      const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"], ...(timeoutMs ? { timeout: timeoutMs, killSignal: "SIGKILL" as const } : {}) });
      let stderr = "";
      proc.stderr.on("data", (part) => { stderr = `${stderr}${part}`.slice(-1200); });
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Preview conversion failed: ${stderr.slice(-400)}`)));
      proc.on("error", reject);
    });
    const ownR2Base = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
    const canRangePreview = !input && !!fullUrl && !!ownR2Base && fullUrl.startsWith(`${ownR2Base}/`);
    let remoteReady = false;
    if (canRangePreview && fullUrl) {
      try {
        // FFmpeg's HTTP input seeks by Range, so this normally reads only the
        // head (+ moov atom if at the tail) of our R2 copy, not the whole GBs.
        onProgress?.({ pct: 35, downloadedBytes: 0, totalBytes: 0, stage: "Reading the first 10 seconds from saved video" });
        await transcode(fullUrl, 30_000);
        remoteReady = true;
      } catch {
        input = undefined; // bounded fallback: download our copy, never Drive
      }
    }
    if (!remoteReady) {
      if (!input && fullUrl) {
        onProgress?.({ pct: 45, downloadedBytes: 0, totalBytes: 0, stage: "Opening saved video (no Drive download)" });
        input = (await resolveDownloader(fullUrl).fetchSource(fullUrl, { workDir, mode: "full" })).path;
      }
      if (!input) throw new Error("Stored video could not be opened for preview");
      onProgress?.({ pct: 65, downloadedBytes: 0, totalBytes: 0, stage: "Converting the first 10 seconds for playback" });
      await transcode(input);
    }
    const { size } = await stat(output);
    if (size < 1024 || await probeDuration(ffmpegPath, output) < 0.1) throw new Error("Preview conversion produced an empty video");
    onProgress?.({ pct: 90, downloadedBytes: size, totalBytes: size, stage: "Saving playable preview" });
    const stored = r2Configured()
      ? await putVideoFile(output, size, { keyPrefix: "previews", contentType: "video/mp4" })
      : await putVideo(await readFile(output), { keyPrefix: "previews", contentType: "video/mp4" });
    await convex.mutation(api.downloadCache.put, {
      sourceUrl: cacheUrl, mode: "segment", sectionKey, url: stored.url, storageId: stored.storageId,
      durationSeconds: fullDuration ?? EDITOR_PREVIEW_SECONDS, mintAddress,
    });
    onProgress?.({ pct: 100, downloadedBytes: size, totalBytes: size, stage: "Preview ready" });
    return { ...stored, durationSeconds: fullDuration ?? EDITOR_PREVIEW_SECONDS };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function cacheLookupUrls(sourceUrl: string): string[] {
  return [...new Set([sourceUrl, downloadCacheSourceUrl(sourceUrl)])];
}

/** ffmpeg `-i` duration probe (seconds). */
export function probeDuration(bin: string, path: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      resolve(m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0);
    });
    proc.on("error", () => resolve(0));
  });
}

/**
 * Download a source (yt-dlp for social, direct fetch, or Drive), store it in
 * Convex storage, and return its public URL + duration. Shared by the
 * synchronous `/api/video/download` route and the async download-job runner
 * (long YouTube videos through the slow residential proxy can exceed a single
 * request's timeout — the async path runs this off the request thread).
 */
export async function downloadAndStore(
  sourceUrl: string,
  opts: FetchOpts & { mintAddress?: string; editorPreview?: boolean; forcePreview?: boolean } = {},
): Promise<{ url: string; durationSeconds: number; storageId: string; cached?: boolean }> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new Error("ffmpeg unavailable");
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  if (!CONVEX_URL) throw new Error("Convex URL not set");
  const convexEarly = new ConvexHttpClient(CONVEX_URL);

  // Every mode is cache-eligible now — "full"/"audio" key on the URL alone; a
  // "segment" pull additionally keys on its [start,end] window, since two
  // different windows of the same source are different artifacts (see
  // schema.ts's downloadCache comment).
  const cacheMode = opts.mode ?? "full";
  const cacheSectionKey = opts.section ? `${opts.section.start}-${opts.section.end}` : "";
  const cacheUrl = downloadCacheSourceUrl(sourceUrl);
  // A source preview has its own browser-safe cache key. Prefer that or a
  // previously downloaded full source before asking Drive/YouTube for bytes.
  if (opts.editorPreview && cacheMode === "segment" && opts.section?.start === 0 && opts.section.end <= EDITOR_PREVIEW_SECONDS) {
    try {
      const preview = await ensureEditorPreview(sourceUrl, opts.mintAddress, undefined, undefined, opts.onProgress, opts.forcePreview);
      return { ...preview, cached: true };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("original video is not stored yet")) throw error;
      // No stored source: fetch only the requested short window below.
    }
  }
  const hit = opts.editorPreview && cacheMode === "segment" ? null : await (async () => {
    let found = null;
    for (const candidate of cacheLookupUrls(sourceUrl)) {
      found = await convexEarly.query(api.downloadCache.getByKey, { sourceUrl: candidate, mode: cacheMode, sectionKey: cacheSectionKey });
      if (found) break;
    }
    // Self-heal a stale row: if its blob was deleted, re-download (the fresh
    // result overwrites the row via downloadCache.put below).
    const { storedFileExists } = await import("@/lib/clip/sourceMedia");
    const valid = found && (await storedFileExists(found.url)) ? found : null;
    if (found && !valid) console.warn(`[download] cached ${cacheMode} blob is gone (404) — re-downloading ${sourceUrl.slice(0, 80)}`);
    return valid;
  })().catch(() => null);
  if (hit) {
      // Attribute this agent's use of the link too, even on a cache hit, so
      // it shows up in THEIR Downloads tab.
      if (opts.mintAddress) {
        await convexEarly
          .mutation(api.downloadCache.put, {
            sourceUrl: hit.sourceUrl,
            mode: cacheMode,
            sectionKey: cacheSectionKey,
            url: hit.url,
            storageId: hit.storageId,
            durationSeconds: hit.durationSeconds,
            mintAddress: opts.mintAddress,
          })
          .catch(() => {});
      }
      if (opts.editorPreview && cacheMode === "full") {
        // Conversion errors are NOT a cache miss: falling through here would
        // re-hit a quota-blocked Drive file even though its full copy is safe.
        const preview = await ensureEditorPreview(sourceUrl, opts.mintAddress, undefined, hit.durationSeconds, opts.onProgress, opts.forcePreview);
        return { ...preview, cached: true };
      }
      return { url: hit.url, durationSeconds: hit.durationSeconds ?? 0, storageId: hit.storageId, cached: true };
  }

  const workDir = await mkdtemp(join(tmpdir(), "vello-dl-"));
  try {
    const dl = resolveDownloader(sourceUrl);
    const report = opts.onProgress;
    const transferProgress = report
      ? (p: Parameters<NonNullable<FetchOpts["onProgress"]>>[0]) => report({ ...p, pct: Math.min(82, Math.max(0, p.pct) * 0.82), stage: p.stage || "Downloading source video" })
      : undefined;
    // Retry the first pull on TRANSIENT failures (network/5xx/429/proxy blip,
    // YouTube bot-check 403) — a single source has no other retry, so one blip
    // would fail the whole clip job. Permanent errors (bad URL, not-a-video,
    // SSRF-blocked, oversize) fail fast. Up to 3 attempts with short backoff.
    //
    // This is a SEPARATE retry layer from the yt-dlp-specific one inside
    // downloader.ts's socialDownloader.fetchSource (proxy IP + player-client
    // cycling, itself bounded by opts.retryBudgetMs / YTDLP_RETRY_BUDGET_MS).
    // Stacking BOTH with no shared awareness of elapsed time meant a caller
    // passing a tight retryBudgetMs to bound ONE fetchSource call could still
    // see up to 3x that total, since each of THIS wrapper's outer attempts
    // re-granted the inner loop a fresh full budget — exactly what kept
    // blowing a synchronous route's maxDuration and surfacing as the
    // platform gateway's raw "upstream error" response. Now tracks its own
    // outer deadline (same opts.retryBudgetMs, default 3min) and passes the
    // shrinking REMAINDER into each attempt, so the combined inner+outer
    // total is bounded by retryBudgetMs, not a multiple of it.
    const outerBudgetMs = opts.retryBudgetMs ?? 3 * 60_000;
    const outerDeadline = Date.now() + outerBudgetMs;
    const fetchWithRetry = async () => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const remaining = outerDeadline - Date.now();
        if (remaining < 10_000) throw lastErr ?? new Error("download retry budget exhausted");
        try {
          // The downloader STREAMS the source to a file in workDir (no RAM
          // buffer) so a multi-GB video can't OOM the process.
          return await dl.fetchSource(sourceUrl, { ...opts, onProgress: transferProgress, workDir, retryBudgetMs: remaining });
        } catch (e) {
          lastErr = e;
          const msg = e instanceof Error ? e.message : String(e);
          const transient = /HTTP 5\d\d|HTTP 429|HTTP 403|not a bot|sign in to confirm|network|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|stalled|socket hang up|SSLError|SSL: |RECORD_LAYER_FAILURE|EOF occurred in violation of protocol|Connection reset by peer/i.test(msg);
          // DRIVE_QUOTA = Google's 24h per-file download block — retrying just re-trips
          // it, so fail fast (the friendly message tells the user to copy/upload/wait).
          const permanent = /Invalid download URL|Blocked|too large|Not a video|matches no streams|SOCIAL_NEEDS_YTDLP|install yt-dlp|DRIVE_QUOTA/i.test(msg);
          if (!transient || permanent || attempt === 3) throw e;
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      throw lastErr;
    };
    const { path: localPath, mime } = await fetchWithRetry();
    report?.({ pct: 85, downloadedBytes: 0, totalBytes: 0, stage: "Checking the video" });
    const durationSeconds = await probeDuration(ffmpegPath, localPath);

    if (opts.editorPreview && cacheMode === "segment") {
      // Segment downloaders may stream-copy MOV/HEVC or non-faststart MP4. Never
      // hand those bytes to <video>; normalize before publishing the preview.
      const preview = await ensureEditorPreview(sourceUrl, opts.mintAddress, localPath, undefined,
        report ? (p) => report({ ...p, pct: 85 + p.pct * 0.15 }) : undefined, opts.forcePreview);
      return { ...preview };
    }

    const convex = new ConvexHttpClient(CONVEX_URL);
    const { size } = await stat(localPath);

    // If the artifact exceeds the storage upload ceiling (~100 MB behind the gateway →
    // HTTP 413, which is otherwise UNRECOVERABLE), re-encode it smaller first. A high-
    // bitrate 25–60s segment from a 1080p+ source can blow past it; the clip render
    // output is 9:16 phone-res, so a 1280-capped re-encode loses nothing visible. Long-
    // source AUDIO is dropped to 64k mono (ample for STT). Best-effort: if the shrink
    // doesn't help, fall through and let the upload try the original anyway.
    const UPLOAD_SAFE_MAX = 80 * 1024 * 1024;
    let uploadPath = localPath;
    let uploadSize = size;
    if (size > UPLOAD_SAFE_MAX) {
      report?.({ pct: 89, downloadedBytes: size, totalBytes: size, stage: "Optimizing for fast editing" });
      const isAudio = mime.startsWith("audio");
      const shrunk = join(workDir, isAudio ? "shrunk.m4a" : "shrunk.mp4");
      const args = isAudio
        ? ["-y", "-i", localPath, "-vn", "-c:a", "aac", "-b:a", "64k", "-ac", "1", shrunk]
        : ["-y", "-i", localPath, "-vf", "scale=w=1280:h=1280:force_original_aspect_ratio=decrease", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", shrunk];
      try {
        await new Promise<void>((res, rej) => {
          const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
          let err = "";
          p.stderr.on("data", (d) => (err += d.toString()));
          p.on("close", (code) => (code === 0 ? res() : rej(new Error(`re-encode exit ${code}: ${err.slice(-180)}`))));
          p.on("error", rej);
        });
        const s2 = await stat(shrunk);
        if (s2.size > 0 && s2.size < size) { uploadPath = shrunk; uploadSize = s2.size; }
      } catch (e) {
        console.warn(`[ytDownload] shrink re-encode failed (uploading original): ${e instanceof Error ? e.message : e}`);
      }
    }

    // Upload the on-disk file to Convex storage.
    //
    // WHY NOT a plain streaming fetch(): Node/undici's `fetch` sends a
    // Readable-stream body with `Transfer-Encoding: chunked` and DROPS any
    // caller-set `Content-Length` (per the Fetch spec — a stream body has an
    // unknown length, so undici cannot emit a fixed Content-Length and falls
    // back to chunked). Convex's storage upload endpoint sits behind a gateway
    // that rejects/!mishandles chunked POSTs, surfacing as HTTP 502. The
    // previous Buffer/Uint8Array body sent a fixed-length, non-chunked request,
    // which is why it worked before commit 27197eb.
    //
    // FIX without re-introducing the RAM OOM the 2GB cap fix avoided:
    //  - SMALL artifacts (the audio/segment modes that clipJobs.process and the
    //    clipping-flow UI actually use) are well under the RAM budget, so we
    //    read them into a Buffer and POST a fixed-length, non-chunked request.
    //  - GENUINELY LARGE artifacts (the legacy mode:"full" whole-video path,
    //    still reachable via /api/video/download-start) must NOT be buffered, so
    //    we stream from disk but force a fixed-length request by setting
    //    `Content-Length` on a Request whose body is a Readable — undici honors
    //    an explicit length for a known-size file stream when duplex:"half" is
    //    paired with the header and avoids chunked. If a host still chunks it,
    //    the bounded retry below absorbs a transient 502/503.
    // 64 MiB threshold: comfortably above audio/segment artifacts, far below the
    // multi-GB sources we must never buffer.
    const SMALL_UPLOAD_MAX = 64 * 1024 * 1024;

    // R2 first: same bytes, zero-egress serving. Falls through to the legacy
    // Convex upload only when the R2 env isn't configured.
    if (r2Configured()) {
      report?.({ pct: 95, downloadedBytes: uploadSize, totalBytes: uploadSize, stage: "Saving securely to Vello" });
      const stored = uploadSize <= SMALL_UPLOAD_MAX
        ? await putVideo(await readFile(uploadPath), { keyPrefix: "sources", contentType: mime })
        : await putVideoFile(uploadPath, uploadSize, { keyPrefix: "sources", contentType: mime });
      await convex
        .mutation(api.downloadCache.put, {
          sourceUrl: cacheUrl, mode: cacheMode, sectionKey: cacheSectionKey, url: stored.url, storageId: stored.storageId, durationSeconds, mintAddress: opts.mintAddress,
        })
        .catch((e) => console.warn(`[download] could not save cache entry: ${e instanceof Error ? e.message : e}`));
      if (opts.editorPreview && cacheMode === "full") return ensureEditorPreview(sourceUrl, opts.mintAddress, localPath, durationSeconds,
        opts.onProgress ? (p) => opts.onProgress?.({ ...p, pct: 95 + p.pct * 0.05 }) : undefined, opts.forcePreview);
      return { url: stored.url, durationSeconds, storageId: stored.storageId };
    }

    report?.({ pct: 95, downloadedBytes: uploadSize, totalBytes: uploadSize, stage: "Saving securely to Vello" });

    const doUpload = async (): Promise<Response> => {
      const uploadUrl = await convex.mutation(api.clipStorage.generateUploadUrl, {});
      if (uploadSize <= SMALL_UPLOAD_MAX) {
        // Fixed-length, non-chunked body — a Buffer/Uint8Array has a known
        // length so undici emits Content-Length and never Transfer-Encoding.
        const buf = await readFile(uploadPath);
        return fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": mime },
          body: new Uint8Array(buf),
        });
      }
      // Large: stream from disk, RAM-safe. Force a non-chunked request.
      return fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mime, "Content-Length": String(uploadSize) },
        body: createReadStream(uploadPath) as unknown as BodyInit,
        // @ts-expect-error duplex is required by Node's fetch for a streaming body but missing from the DOM RequestInit lib types.
        duplex: "half",
      });
    };

    // Bounded retry on transient gateway failures (502 Bad Gateway / 503
    // Unavailable). A fresh upload URL is minted each attempt. 3 attempts with
    // short linear backoff — mirrors the source-fetch retry above.
    let up: Response | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      up = await doUpload();
      if (up.ok) break;
      if ((up.status === 502 || up.status === 503) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      break;
    }
    if (!up || !up.ok) throw new Error(`storage upload failed: HTTP ${up?.status ?? "no response"}`);
    const { storageId } = (await up.json()) as { storageId: string };
    const url = await convex.mutation(api.clipStorage.resolveStorageUrl, { storageId: storageId as unknown as never });
    if (!url) throw new Error("storage getUrl returned null");
    await convex
      .mutation(api.downloadCache.put, {
        sourceUrl: cacheUrl, mode: cacheMode, sectionKey: cacheSectionKey, url, storageId, durationSeconds, mintAddress: opts.mintAddress,
      })
      .catch((e) => console.warn(`[download] could not save cache entry: ${e instanceof Error ? e.message : e}`));
    if (opts.editorPreview && cacheMode === "full") return ensureEditorPreview(sourceUrl, opts.mintAddress, localPath, durationSeconds,
      opts.onProgress ? (p) => opts.onProgress?.({ ...p, pct: 95 + p.pct * 0.05 }) : undefined, opts.forcePreview);
    return { url, durationSeconds, storageId };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Stream a source to a file in `workDir` (RAM-safe) + probe its duration. NO
 * Convex upload — the file stays on local disk for the caller's whole lifetime
 * (the clip-batch route pulls ONCE, then ffmpeg input-seeks each clip out of it).
 * Reuses the SAME downloader + transient-retry as downloadAndStore. The caller
 * owns `workDir` (creation + cleanup). The existing oversize cap inside
 * fetchSource (downloader.ts MAX_DOWNLOAD_BYTES, env-tunable) still applies →
 * disk-bounded.
 */
/** downloadCache lookup for a whole-source ("full") pull. Returns the stored
 *  copy's public URL, or null on miss / any lookup failure (best-effort). */
async function lookupCachedFull(sourceUrl: string): Promise<string | null> {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  if (!CONVEX_URL) return null;
  try {
    const client = new ConvexHttpClient(CONVEX_URL);
    for (const candidate of cacheLookupUrls(sourceUrl)) {
      const hit = await client.query(api.downloadCache.getByKey, { sourceUrl: candidate, mode: "full", sectionKey: "" });
      const url = typeof hit?.url === "string" ? hit.url.trim() : "";
      if (/^https?:\/\//i.test(url)) return url;
    }
    return null;
  } catch {
    return null;
  }
}

export async function downloadToLocal(
  sourceUrl: string,
  opts: FetchOpts & { workDir: string },
): Promise<{ path: string; mime: string; durationSeconds: number }> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new Error("ffmpeg unavailable");

  // REUSE AN ALREADY-DOWNLOADED COPY. The cloud clip job pulls the whole source
  // through here, and until now ignored downloadCache entirely — so a video the
  // operator had ALREADY downloaded in the editor (a stored R2/Convex copy) was
  // fetched AGAIN from YouTube through the residential proxy, and any proxy
  // hiccup (SSL RECORD_LAYER_FAILURE, bot wall, quota) failed the whole run.
  // A "full" pull keys on the URL alone (same key downloadAndStore writes), so
  // on a hit we fetch the stored copy directly (plain HTTPS, no yt-dlp) and only
  // fall through to the original URL if that copy is dead. Segment/audio pulls
  // keep their own path — the cached full file is not what they need.
  if ((opts.mode ?? "full") === "full" && !opts.section) {
    const cached = await lookupCachedFull(sourceUrl);
    if (cached && cached !== sourceUrl) {
      try {
        const { path, mime } = await resolveDownloader(cached).fetchSource(cached, { ...opts, mode: "full" });
        return { path, mime, durationSeconds: await probeDuration(ffmpegPath, path) };
      } catch (e) {
        console.warn(`[downloadToLocal] cached copy unusable (${e instanceof Error ? e.message : e}) — re-pulling original`);
      }
    }
  }

  const dl = resolveDownloader(sourceUrl);
  // Same outer+inner budget-sharing fix as downloadAndStore above — pass the
  // shrinking REMAINDER into each attempt instead of re-granting a fresh
  // retryBudgetMs every outer retry.
  const outerBudgetMs = opts.retryBudgetMs ?? 3 * 60_000;
  const outerDeadline = Date.now() + outerBudgetMs;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const remaining = outerDeadline - Date.now();
    if (remaining < 10_000) throw lastErr ?? new Error("download retry budget exhausted");
    try {
      const { path, mime } = await dl.fetchSource(sourceUrl, { ...opts, mode: opts.mode ?? "full", retryBudgetMs: remaining });
      return { path, mime, durationSeconds: await probeDuration(ffmpegPath, path) };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /HTTP 5\d\d|HTTP 429|HTTP 403|not a bot|sign in to confirm|network|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|stalled|socket hang up|SSLError|SSL: |RECORD_LAYER_FAILURE|EOF occurred in violation of protocol|Connection reset by peer/i.test(msg);
      const permanent = /Invalid download URL|Blocked|too large|Not a video|matches no streams|SOCIAL_NEEDS_YTDLP|install yt-dlp|DRIVE_QUOTA/i.test(msg);
      if (!transient || permanent || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}
