import { NextRequest, NextResponse } from "next/server";
import { authorizeCharacterScope } from "@/lib/server/characterDraft";
import { putImage, r2ImageConfigured } from "@/lib/server/imageStorage";

export const maxDuration = 30;
const MAX_BYTES = 10 * 1024 * 1024;

/** Optional "Upload your photo" reference. Transcoded to JPEG, stored in R2. */
export async function POST(req: NextRequest) {
  if (!r2ImageConfigured()) return NextResponse.json({ error: "Image storage (R2) not configured" }, { status: 503 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const a = await authorizeCharacterScope(req, typeof form?.get("mintAddress") === "string" ? (form!.get("mintAddress") as string) : null, form?.get("draft") === "1");
  if (a.error) return a.error;
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Upload an image under 10MB" }, { status: 400 });
  }
  try {
    const sharp = (await import("sharp")).default;
    // A logo is flattened onto white (not black) so a transparent dark mark stays readable.
    const logo = form?.get("kind") === "logo";
    const base = sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true });
    const jpg = await (logo ? base.flatten({ background: "#ffffff" }) : base).jpeg({ quality: 90 }).toBuffer();
    const stored = await putImage(jpg, "image/jpeg", { keyPrefix: `characters/${a.mint}/${logo ? "logo" : "photo"}` });
    return NextResponse.json({ url: stored.url });
  } catch {
    return NextResponse.json({ error: "That image could not be read" }, { status: 400 });
  }
}
