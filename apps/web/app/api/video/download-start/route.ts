import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { downloadAndStore, ensureEditorPreview } from "@/lib/server/ytDownload";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Kick off a source download OFF the request thread and return a jobId
 * immediately. The download (slow for long YouTube videos through the
 * residential proxy) continues in the persistent Node process and writes its
 * result to the downloadJobs row; the client polls /api/video/download-status.
 *
 * Persistent-server only (Railway/Docker standalone): the un-awaited promise
 * keeps running after the 202 response. On a serverless host it would be killed
 * — there, the synchronous /api/video/download is the fallback.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  // No agent to scope — require a valid SIWS session for user callers (internal skip).
  if (!auth.internal) {
    const siwsError = requireSiwsSession(auth);
    if (siwsError) return siwsError;
  }
  let body: { sourceUrl?: string; mode?: "full" | "audio" | "segment"; mintAddress?: string; section?: { start?: number; end?: number }; editorPreview?: boolean; previewOnly?: boolean; forcePreview?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const sourceUrl = String(body.sourceUrl ?? "");
  if (!sourceUrl) return NextResponse.json({ error: "sourceUrl required" }, { status: 400 });
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex URL not set" }, { status: 500 });
  // "audio" = pull the whole source as a tiny audio-only artifact (Drive/direct
  // strip video on the fly). "segment" + `section` = just a [start,end] window
  // (e.g. a fast few-second preview) — MUCH smaller/faster than a full pull and
  // far less likely to fail mid-download. Default "full".
  const mode: "full" | "audio" | "segment" = body.mode === "audio" ? "audio" : body.mode === "segment" ? "segment" : "full";
  const section = mode === "segment" && body.section
    && typeof body.section.start === "number" && typeof body.section.end === "number" && body.section.end > body.section.start
    ? { start: Math.max(0, body.section.start), end: body.section.end }
    : undefined;
  // A "segment" request with no valid section is meaningless — fall back to full
  // rather than silently downloading nothing useful.
  const effectiveMode = mode === "segment" && !section ? "full" : mode;

  const convex = new ConvexHttpClient(CONVEX_URL);
  const jobId = await convex.mutation(api.downloadJobs.create, { sourceUrl, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });

  // Throttle progress writes to Convex (~1/sec) — yt-dlp emits many lines.
  let lastWrite = 0;
  const onProgress = (p: { pct: number; downloadedBytes: number; totalBytes: number; speed?: string; stage?: string }) => {
    const now = Date.now();
    if (now - lastWrite < 1000 && p.pct < 100) return; // always let the final 100% through
    lastWrite = now;
    void convex
      .mutation(api.downloadJobs.setProgress, { id: jobId, pct: p.pct, downloadedBytes: p.downloadedBytes, totalBytes: p.totalBytes, ...(p.speed ? { speed: p.speed } : {}), ...(p.stage ? { stage: p.stage } : {}), authSecret: process.env.INTERNAL_CRON_SECRET ?? "" })
      .catch(() => {});
  };
  onProgress({ pct: 3, downloadedBytes: 0, totalBytes: 0, stage: "Connecting to video source" });

  // Whole-source pulls (the clip job's audio-first step, or a full pull) are
  // awaited by a 25-min poll (convex/clipJobs.ts ASYNC_DL_MAX_MS), so the
  // downloader's 3-min default retry budget was the REAL ceiling — a 240 MB
  // progressive-only YouTube source through the residential proxy (~1.3 MB/s)
  // needs ~3 min for the bytes alone, after a failed first client attempt.
  // Segment pulls stay on the default (small window, fast).
  const retryBudgetMs = section ? undefined : 10 * 60_000;

  // Fire-and-forget — runs after the response is sent. Writes its own outcome.
  void (async () => {
    try {
      const prepare = () => downloadAndStore(sourceUrl, { onProgress, mode: effectiveMode, section, mintAddress: body.mintAddress, editorPreview: body.editorPreview === true, forcePreview: body.forcePreview === true, ...(retryBudgetMs ? { retryBudgetMs } : {}) });
      let result: { url: string; durationSeconds: number };
      if (body.previewOnly) {
        try {
          result = await ensureEditorPreview(sourceUrl, body.mintAddress, undefined, undefined, onProgress, body.forcePreview === true);
        } catch (e) {
          if (!(e instanceof Error) || !e.message.includes("original video is not stored yet")) throw e;
          result = await downloadAndStore(sourceUrl, { onProgress, mode: "segment", section: { start: 0, end: 10 }, mintAddress: body.mintAddress, editorPreview: true, forcePreview: body.forcePreview === true });
        }
      } else {
        result = await prepare();
      }
      const { url, durationSeconds } = result;
      await convex.mutation(api.downloadJobs.setResult, { id: jobId, status: "done", url, durationSeconds, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    } catch (e) {
      await convex
        .mutation(api.downloadJobs.setResult, { id: jobId, status: "error", error: e instanceof Error ? e.message : String(e), authSecret: process.env.INTERNAL_CRON_SECRET ?? "" })
        .catch(() => {});
    }
  })();

  return NextResponse.json({ ok: true, jobId }, { status: 202 });
}
