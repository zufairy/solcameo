// /dev/jev "upload your own video" → R2 (never Convex). Lives under
// api/media/upload* so proxy.ts's matcher skips it — Next truncates proxied
// bodies at 10 MB. The body streams to R2 AND, via tee, to the local jev source
// cache, so the first cut after an upload doesn't download it back from R2.
//
// PUT raw file body, ?name=&type=  →  { ok, url, bytes, durationSeconds, width, height, ms }
import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { putVideoStream, r2Configured } from "@/lib/server/videoStorage";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { adoptIntoSourceCache, probeVideo, sourceCachePath } from "@/lib/server/jev/sourceCache";
import { jevGate } from "@/lib/server/jev/gate";
import { RATES, addUpload, costOf, recordRun, storageCost } from "@/lib/server/jev/metrics";

export const runtime = "nodejs";
export const maxDuration = 900;

/** 2 GB — a long 1080p podcast; this is a demo lab, not the archive. */
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv", "video/x-m4v": "m4v",
};

export async function PUT(req: NextRequest) {
  const gate = await jevGate(req);
  if (gate.denied) return gate.denied;
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Media storage (R2) is not configured on this server" }, { status: 503 });

  const size = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ ok: false, error: "Empty upload (Content-Length required)" }, { status: 411 });
  if (size > MAX_BYTES) return NextResponse.json({ ok: false, error: "File too large (max 2 GB)" }, { status: 413 });
  if (!req.body) return NextResponse.json({ ok: false, error: "No body" }, { status: 400 });

  const name = (req.nextUrl.searchParams.get("name") ?? "upload").slice(0, 200);
  const type = (req.nextUrl.searchParams.get("type") ?? req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("video/")) return NextResponse.json({ ok: false, error: `Not a video: ${type || "unknown type"}` }, { status: 415 });
  const ext = EXT_BY_MIME[type] ?? /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase() ?? "mp4";

  const t0 = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "vello-jev-up-"));
  const local = join(dir, `src.${ext}`);
  try {
    const [toR2, toDisk] = req.body.tee();
    // Disk copy is best-effort: a failed write only costs the cut a re-download.
    const disk = pipeline(Readable.fromWeb(toDisk as import("node:stream/web").ReadableStream), createWriteStream(local))
      .then(() => true, () => false);
    const stored = await putVideoStream(toR2, size, { keyPrefix: "jev/uploads", contentType: type, ext });
    const uploadMs = Date.now() - t0;
    const onDisk = await disk;

    const ffmpeg = resolveFfmpegPath();
    const probe = onDisk && ffmpeg ? await probeVideo(ffmpeg, local) : null;
    if (onDisk) await adoptIntoSourceCache(local, stored.url);

    const upload = {
      url: stored.url, name, bytes: size, at: Date.now(),
      durationSeconds: probe?.durationSeconds ?? null, width: probe?.width ?? null, height: probe?.height ?? null,
    };
    await addUpload(gate.userId, upload);
    const run = await recordRun({
      kind: "upload", ok: true, sourceUrl: stored.url, sourceName: name, bytes: size,
      durationSeconds: probe?.durationSeconds,
      ms: { total: Date.now() - t0, upload: uploadMs },
      cost: costOf({ storage: storageCost(size), requests: RATES.r2PerPut }),
    });
    return NextResponse.json({
      ok: true, ...upload, cached: onDisk && sourceCachePath(stored.url) !== local, ms: uploadMs, cost: run.cost,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Upload failed";
    await recordRun({ kind: "upload", ok: false, error, sourceUrl: "", sourceName: name, bytes: size, ms: { total: Date.now() - t0 }, cost: costOf({}) });
    return NextResponse.json({ ok: false, error }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
