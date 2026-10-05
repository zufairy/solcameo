import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireAuth } from "@/lib/server/requireAuth";
import { streamFetchToFile } from "@/lib/server/downloader";
import { putVideo } from "@/lib/server/videoStorage";

// Ads Library → Recreate hand-off: download an external ad video (its CDN URL
// expires, so we grab it NOW) and re-host it in Convex storage, returning a
// stable URL the recreate pipeline can use as sourceVideoUrl.
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = (body.url ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return NextResponse.json({ ok: false, error: "url is required" }, { status: 400 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });

  const dir = await mkdtemp(join(tmpdir(), "vello-import-"));
  try {
    const local = join(dir, "ad.mp4");
    // SSRF-guarded + size-capped stream download (same guard the whole pipeline uses).
    await streamFetchToFile(url, local, { requireVideo: true });
    const bytes = await readFile(local);
    if (bytes.length < 20_000) throw new Error("Downloaded file is too small to be a video — the source link may have expired.");

    const { url: hosted } = await putVideo(bytes, { keyPrefix: "sources" });
    return NextResponse.json({ ok: true, url: hosted });
  } catch (e) {
    const message = e instanceof Error ? e.message : "import failed";
    return NextResponse.json({ ok: false, error: message.slice(0, 240) }, { status: 502 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
