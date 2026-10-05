import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { putImage } from "@/lib/server/imageStorage";
import { putVideo, r2Configured } from "@/lib/server/videoStorage";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Editor media upload → R2. One endpoint for the Overlay drawer (images /
 * videos) and the Music drawer ("upload your own track").
 *
 * WHY: editor uploads went to Convex file storage and the music/SFX packs lived
 * in a Supabase bucket — both have gone away under us (Supabase 402 since
 * 2026-09-02; Convex storage tied to a billing-gated deployment). Every video
 * this app renders already lands on R2 (lib/server/videoStorage.ts), so the
 * operator's own media goes there too: one public bucket, one set of env vars,
 * URLs that ffmpeg can fetch at burn time.
 *
 * multipart/form-data, field `file`. Returns { ok, url, kind, name }.
 */
const MAX_BYTES = 200 * 1024 * 1024;
const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4",
  "audio/aac": "audio/mp4", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/ogg": "audio/ogg",
};

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!auth.internal) {
    const err = requireSiwsSession(auth);
    if (err) return err;
  }
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Media storage (R2) is not configured on this server" }, { status: 503 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "Expected multipart/form-data with a `file` field" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "`file` field required" }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });

  const mime = (file.type || "").toLowerCase();
  const name = file.name || "upload";
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (mime.startsWith("image/")) {
      const { url } = await putImage(bytes, mime, { keyPrefix: "editor/images" });
      return NextResponse.json({ ok: true, url, kind: "image", name });
    }
    if (mime.startsWith("video/")) {
      const { url } = await putVideo(bytes, { keyPrefix: "editor/videos", contentType: "video/mp4" });
      return NextResponse.json({ ok: true, url, kind: "video", name });
    }
    const audioType = AUDIO_TYPES[mime] ?? (mime.startsWith("audio/") ? "audio/mpeg" : undefined);
    if (audioType) {
      const { url } = await putVideo(bytes, { keyPrefix: "editor/music", contentType: audioType });
      return NextResponse.json({ ok: true, url, kind: "audio", name });
    }
    return NextResponse.json({ ok: false, error: `Unsupported file type: ${mime || "unknown"}` }, { status: 415 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}
