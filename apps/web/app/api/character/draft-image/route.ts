import { optimizePortrait } from "@/lib/server/optimizePortrait";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { authorizeCharacterScope } from "@/lib/server/characterDraft";
import { imagePublicUrl } from "@/lib/server/imageStorage";
import { convexClient, internalSecret, errorResponse } from "@/lib/server/solstarRoute";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const scope = await authorizeCharacterScope(req, null, true);
  if (scope.error) return scope.error;
  const body = await req.json().catch(() => null);
  const prefix = imagePublicUrl(`characters/${scope.mint}/gen/`);
  if (!body || typeof body.url !== "string" || !prefix.startsWith("https://") || !body.url.startsWith(prefix)) return NextResponse.json({ error: "Choose a generated portrait from your draft" }, { status: 400 });
  const secret = internalSecret();
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  try {
    const response = await fetch(body.url, { redirect: "error" });
    if (!response.ok) throw new Error("Portrait unavailable");
    const image = await optimizePortrait(Buffer.from(await response.arrayBuffer()), 1024);
    if (image.length > 2_097_152) return NextResponse.json({ error: "Portrait is too large" }, { status: 400 });
    const uploadUrl = await convexClient().mutation(api.solstarCreate.generateUploadUrl, { authSecret: secret });
    const uploaded = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/webp" }, body: new Uint8Array(image) });
    if (!uploaded.ok) throw new Error("Upload failed");
    return NextResponse.json({ imageStorageId: (await uploaded.json()).storageId });
  } catch (error) { return errorResponse(error); }
}
