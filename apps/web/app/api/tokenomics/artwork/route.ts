import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireProvenWallet } from "@/lib/server/solstarRoute";
import { platformLaunchOwner } from "@/lib/server/platformLaunchOwner";
import { putImage, r2ImageConfigured } from "@/lib/server/imageStorage";

export const runtime = "nodejs";
const MAX_BYTES = 8 * 1024 * 1024;

/** Upload the platform token artwork: square 1024px PNG stored in R2, returned as the URL the launch uses. */
export async function POST(req: NextRequest) {
  const auth = await requireProvenWallet(req);
  if ("res" in auth) return auth.res;
  const owner = await platformLaunchOwner();
  if (!owner || auth.wallet !== owner) return NextResponse.json({ error: "Connect the platform wallet to upload artwork." }, { status: 403 });
  if (!r2ImageConfigured()) return NextResponse.json({ error: "Image storage is unavailable." }, { status: 503 });
  if (Number(req.headers.get("content-length")) > MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "Use an image under 8 MB." }, { status: 413 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) return NextResponse.json({ error: "Choose an image under 8 MB." }, { status: 400 });
    const input = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(input, { limitInputPixels: 24_000_000 }).metadata();
    if (!meta.width || !meta.height || !["jpeg", "png", "webp", "avif", "heif", "gif"].includes(meta.format ?? ""))
      return NextResponse.json({ error: "Use a PNG, JPG, WebP or AVIF image." }, { status: 415 });
    if (Math.min(meta.width, meta.height) < 256) return NextResponse.json({ error: "Use an image at least 256 x 256 pixels." }, { status: 400 });
    const png = await sharp(input, { limitInputPixels: 24_000_000 }).rotate().resize(1024, 1024, { fit: "cover", position: "centre" }).png({ compressionLevel: 9 }).toBuffer();
    const { url } = await putImage(png, "image/png", { keyPrefix: "platform-token" });
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Could not upload this image. Try another file." }, { status: 400 });
  }
}
