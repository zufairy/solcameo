import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { contentControlAdmin } from "@/lib/server/contentControlAuth";
import { putImage } from "@/lib/server/imageStorage";
import { putVideo, r2Configured } from "@/lib/server/videoStorage";
import { gifToMp4 } from "@/lib/server/gifToMp4";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(req: NextRequest) {
  const auth = await contentControlAdmin(req);
  if (auth.error) return auth.error;
  if (!r2Configured()) return NextResponse.json({ error: "Media storage is not configured" }, { status: 503 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 100 * 1024 * 1024) return NextResponse.json({ error: "Choose an image or MP4 video under 100 MB" }, { status: 400 });
    const buffer = new Uint8Array(await file.arrayBuffer());
    if (file.type === "image/gif") {
      // Keep the animation: a GIF becomes a looping video (the JPEG path below would flatten it to one frame).
      const video = await putVideo(new Uint8Array(await gifToMp4(Buffer.from(buffer))), { keyPrefix: "marketing/videos", contentType: "video/mp4" });
      return NextResponse.json({ ok: true, url: video.url, kind: "video" });
    }
    if (file.type.startsWith("image/")) {
      const bytes = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      const image = await putImage(bytes, "image/jpeg", { keyPrefix: "marketing/images" });
      return NextResponse.json({ ok: true, url: image.url, kind: "photo" });
    }
    if (file.type === "video/mp4") {
      const video = await putVideo(buffer, { keyPrefix: "marketing/videos", contentType: "video/mp4" });
      return NextResponse.json({ ok: true, url: video.url, kind: "video" });
    }
    return NextResponse.json({ error: "Choose an image or MP4 video" }, { status: 415 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 }); }
}
