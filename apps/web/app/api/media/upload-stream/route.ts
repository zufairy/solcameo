import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/requireAuth";
import { putVideoStream, r2Configured } from "@/lib/server/videoStorage";

export const runtime = "nodejs";
// A multi-GB source over a home connection takes minutes.
export const maxDuration = 900;

/** 4 GB — comfortably above a 2-hour 1080p podcast. */
const MAX_BYTES = 4 * 1024 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv", "video/x-m4v": "m4v",
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/x-wav": "wav",
};

/**
 * Raw-body upload → R2, streamed (never buffered). The browser PUTs the File
 * itself (`fetch`/XHR body = File, so Content-Length is exact) with
 * `?name=&type=`. Excluded from proxy.ts's matcher — Next 16 truncates any body
 * >10 MB (proxyClientMaxBodySize) on routes the proxy runs on.
 *
 * Why not a browser-direct presigned PUT: the R2 bucket has no CORS rule, so
 * the preflight 403s. This keeps uploads R2-only without touching bucket config.
 */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Media storage (R2) is not configured on this server" }, { status: 503 });

  const size = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ ok: false, error: "Empty upload (Content-Length required)" }, { status: 411 });
  if (size > MAX_BYTES) return NextResponse.json({ ok: false, error: "File too large (max 4 GB)" }, { status: 413 });
  if (!req.body) return NextResponse.json({ ok: false, error: "No body" }, { status: 400 });

  const name = (req.nextUrl.searchParams.get("name") ?? "upload").slice(0, 200);
  const type = (req.nextUrl.searchParams.get("type") ?? req.headers.get("content-type") ?? "").toLowerCase();
  const kind = type.startsWith("video/") ? "video" : type.startsWith("image/") ? "image" : type.startsWith("audio/") ? "audio" : null;
  if (!kind) return NextResponse.json({ ok: false, error: `Unsupported file type: ${type || "unknown"}` }, { status: 415 });
  const nameExt = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  const ext = EXT_BY_MIME[type] ?? nameExt ?? (kind === "video" ? "mp4" : kind === "image" ? "png" : "mp3");

  try {
    const { url } = await putVideoStream(req.body, size, {
      keyPrefix: kind === "video" ? "editor/videos" : kind === "image" ? "editor/images" : "editor/music",
      contentType: type,
      ext,
    });
    return NextResponse.json({ ok: true, url, kind, name });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}
