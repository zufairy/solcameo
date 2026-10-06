import { optimizePortrait } from "@/lib/server/optimizePortrait";
import { NextRequest, NextResponse } from "next/server";
import { authorizeCharacterScope } from "@/lib/server/characterDraft";
import { imagePublicUrl, putImage, r2ImageConfigured } from "@/lib/server/imageStorage";
import { errorResponse } from "@/lib/server/solstarRoute";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const scope = await authorizeCharacterScope(req, null, true);
  if (scope.error) return scope.error;
  const body = await req.json().catch(() => null);
  const prefix = imagePublicUrl(`characters/${scope.mint}/gen/`);
  if (!body || typeof body.url !== "string" || !prefix.startsWith("https://") || !body.url.startsWith(prefix)) return NextResponse.json({ error: "Choose a generated portrait from your draft" }, { status: 400 });
  if (!r2ImageConfigured()) return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  try {
    const response = await fetch(body.url, { redirect: "error" });
    if (!response.ok) throw new Error("Portrait unavailable");
    const image = await optimizePortrait(Buffer.from(await response.arrayBuffer()), 1024);
    if (image.length > 2_097_152) return NextResponse.json({ error: "Portrait is too large" }, { status: 400 });
    // Final character portraits live in R2, never in Convex file storage.
    const stored = await putImage(image, "image/webp", { keyPrefix: "characters/final" });
    return NextResponse.json({ imageUrl: stored.url });
  } catch (error) { return errorResponse(error); }
}
