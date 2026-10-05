import { NextRequest, NextResponse } from "next/server";
import { providersConfigured, searchFootage, toAsset } from "@/lib/server/renderStudioClips";
import { rateLimit, studioAuth } from "@/lib/server/renderStudioStream";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Stock footage search for the studio's clip picker: GET ?q=fast+cars&w=1080&h=1920 */
export async function GET(req: NextRequest) {
  const auth = await studioAuth(req);
  if ("error" in auth) return auth.error;
  const wait = rateLimit("rs-clips", auth.key, 60, 60 * 60_000);
  if (wait) return NextResponse.json({ error: `Too many searches, try again in ${wait}s` }, { status: 429 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ error: "Type what footage you want" }, { status: 400 });
  const width = Number(req.nextUrl.searchParams.get("w")) || 1080, height = Number(req.nextUrl.searchParams.get("h")) || 1920;
  const found = await searchFootage([q], { width, height }, 12);
  return NextResponse.json({ assets: found.map(toAsset), providers: providersConfigured() });
}
