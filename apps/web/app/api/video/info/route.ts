import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { assertPublicHttpUrl, resolveYtdlpBin } from "@/lib/server/downloader";
import { getDriveVideoMetadata, isDriveUrl } from "@/lib/server/driveDownload";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { probeRemoteVideoDurationSeconds } from "@/lib/server/ffmpegBin";

export const runtime = "nodejs";

/**
 * Public, unauthenticated, METADATA-ONLY lookup — used by the landing-page
 * hero's "drop a video link" flow to show real title/duration/thumbnail in
 * the "clip it" modal before the visitor has signed up. Never downloads the
 * video: `yt-dlp --dump-json --skip-download` just reads the source's public
 * metadata (same info yt-dlp would use to plan a real download), so this is
 * cheap and fast enough to run from an anonymous landing-page click. Falls
 * back to YouTube's oEmbed endpoint (no duration, but a title/thumbnail) if
 * yt-dlp is unavailable or the source isn't yt-dlp-supported.
 */
const INFO_WALL_MS = 12_000;

function runYtDlpJson(bin: string, url: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["--dump-json", "--skip-download", "--no-warnings", "--no-playlist", url], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); if (out.length > 2_000_000) out = out.slice(-2_000_000); });
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already gone */ } }, INFO_WALL_MS);
    proc.on("error", () => { clearTimeout(timer); resolve(null); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !out.trim()) { resolve(null); return; }
      try { resolve(JSON.parse(out.trim().split("\n")[0])); } catch { resolve(null); }
    });
  });
}

async function oembedFallback(url: string): Promise<{ title?: string; author?: string; thumbnailUrl?: string } | null> {
  if (!/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)$/i.test(new URL(url).hostname)) return null;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return { title: data.title, author: data.author_name, thumbnailUrl: data.thumbnail_url };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") ?? "";
  try {
    await assertPublicHttpUrl(raw);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Invalid URL" }, { status: 400 });
  }

  try {
    if (isDriveUrl(raw)) {
      // Drive metadata may come from Vello's service account and include a
      // private file shared with it. Keep that lookup behind a signed-in user;
      // the public landing-page YouTube metadata flow remains unchanged.
      const auth = await requireInternalOrUserAuth(req);
      if (auth.error) return auth.error;
      const metadata = await getDriveVideoMetadata(raw);
      if (metadata?.durationSeconds) return NextResponse.json({ ok: true, title: metadata.name ?? "Google Drive video", durationSeconds: metadata.durationSeconds, thumbnailUrl: `/api/video/thumbnail?url=${encodeURIComponent(raw)}` });
      // Length unreadable but the file IS reachable (e.g. an odd container, or
      // Drive still processing a fresh upload) — let the download proceed; the
      // run is re-priced on the real length once the file lands.
      // Never stricter than the real downloader: a metadata probe can fail on a
      // file the download job fetches fine (Drive interstitials, Range quirks),
      // so an unverified length is NOT an error. The Editor prices the minimum,
      // the job reports a genuinely private file, and the Clip run re-checks
      // credits on the real length once the file lands.
      return NextResponse.json({ ok: true, title: metadata?.name ?? "Google Drive video", lengthUnknown: true, thumbnailUrl: `/api/video/thumbnail?url=${encodeURIComponent(raw)}` });
    }
    const bin = await resolveYtdlpBin();
    const info = await runYtDlpJson(bin, raw);
    // Direct file links (.mp4 on a CDN, S3, …) come back from yt-dlp's generic
    // extractor without a duration — read it from the container header so the
    // Editor can still price the download by length before fetching it.
    const directLink = /\.(mp4|mov|m4v|webm|mkv)$/i.test(new URL(raw).pathname);
    const ytDuration = info && typeof info.duration === "number" && info.duration > 0 ? info.duration : undefined;
    const durationSeconds = ytDuration ?? (directLink ? (await probeRemoteVideoDurationSeconds(raw)) ?? undefined : undefined);
    if (info || durationSeconds) {
      return NextResponse.json({
        ok: true,
        title: info && typeof info.title === "string" ? info.title : "",
        author: info ? (typeof info.uploader === "string" ? info.uploader : (typeof info.channel === "string" ? info.channel : "")) : "",
        thumbnailUrl: info && typeof info.thumbnail === "string" ? info.thumbnail : "",
        durationSeconds,
      });
    }
  } catch {
    // yt-dlp unavailable/failed — fall through to the oEmbed fallback below.
  }

  const fb = await oembedFallback(raw);
  if (fb) return NextResponse.json({ ok: true, title: fb.title ?? "", author: fb.author ?? "", thumbnailUrl: fb.thumbnailUrl ?? "" });
  return NextResponse.json({ ok: false, error: "Could not fetch video info" }, { status: 200 });
}
