import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireProvenWallet } from "@/lib/server/solstarRoute";
import { putImage, r2ImageConfigured } from "@/lib/server/imageStorage";
import { CALLOUT_UPLOAD_BYTES } from "@/lib/solstar/calloutMedia";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const auth = await requireProvenWallet(req);
  if ("res" in auth) return auth.res;
  if (!r2ImageConfigured()) return NextResponse.json({ error: "Image storage is unavailable." }, { status: 503 });
  const max = CALLOUT_UPLOAD_BYTES + 64 * 1024;
  if (Number(req.headers.get("content-length")) > max) return NextResponse.json({ error: "Use an image under 8 MB." }, { status: 413 });
  try {
    const reader = req.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); return NextResponse.json({ error: "Use an image under 8 MB." }, { status: 413 }); }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": req.headers.get("content-type") || "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > CALLOUT_UPLOAD_BYTES) return NextResponse.json({ error: "Choose an image under 8 MB." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata();
    const mime = ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", heif: meta.compression === "av1" ? "image/avif" : "" } as Record<string, string>)[meta.format || ""];
    if (!mime || !meta.width || !meta.height || meta.width * meta.height > 24_000_000) return NextResponse.json({ error: "Use PNG, JPG, WebP, AVIF or GIF." }, { status: 415 });
    const { url } = await putImage(bytes, mime, { keyPrefix: "callouts" });
    return NextResponse.json({ url, type: meta.format === "gif" ? "gif" : "image", alt: file.name.slice(0, 160) });
  } catch { return NextResponse.json({ error: "Could not upload this image. Try another file." }, { status: 400 }); }
}
