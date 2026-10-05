import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { downloadAndStore } from "@/lib/server/ytDownload";

export const runtime = "nodejs";
// Social-URL (yt-dlp) downloads can take longer than a direct fetch.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  // No agent to scope here — require a valid SIWS session for user callers
  // (internal cron callers skip). A proven wallet must back any download.
  if (!auth.internal) {
    const siwsError = requireSiwsSession(auth);
    if (siwsError) return siwsError;
  }
  let body: { sourceUrl?: string; mode?: "full" | "audio" | "segment"; start?: number; end?: number; mintAddress?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const sourceUrl = String(body.sourceUrl ?? "");
  if (!sourceUrl) return NextResponse.json({ error: "sourceUrl required" }, { status: 400 });
  // Audio-first pipeline: "audio" pulls a tiny transcription-only file; "segment"
  // pulls just one clip window (start..end). Both are small enough to run inside
  // this single request (no async job needed). "full" = the legacy whole-video pull.
  const mode = body.mode === "audio" || body.mode === "segment" ? body.mode : "full";
  const section = mode === "segment" && Number.isFinite(body.start) && Number.isFinite(body.end)
    ? { start: Math.max(0, Number(body.start)), end: Number(body.end) }
    : undefined;
  if (mode === "segment" && !section) return NextResponse.json({ error: "segment mode requires start+end" }, { status: 400 });
  try {
    const { url, durationSeconds, storageId } = await downloadAndStore(sourceUrl, { mode, section, mintAddress: body.mintAddress });
    return NextResponse.json({ ok: true, url, durationSeconds, storageId });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
