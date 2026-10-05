import { NextRequest, NextResponse } from "next/server";
import { loadShareAgent, renderShareCard, renderShareGif } from "@/lib/server/xShareCardRender";

export const runtime = "nodejs";
export const maxDuration = 60;

// Public URL: the social publisher must be able to fetch the image without the
// owner's browser session. Stats come from Convex, never from query parameters.
// ?format=gif returns the animated card; default is the static PNG still.
export async function GET(req: NextRequest) {
  const mint = (req.nextUrl.searchParams.get("mint") ?? "").trim();
  const nonce = (req.nextUrl.searchParams.get("nonce") ?? "0").slice(0, 32);
  const gif = req.nextUrl.searchParams.get("format") === "gif";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: "Invalid agent" }, { status: 400 });
  }
  try {
    const data = await loadShareAgent(mint);
    if (!data) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if (!gif) return await renderShareCard(data, nonce);
    const bytes = await renderShareGif(data, nonce);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/gif", "Cache-Control": "public, max-age=300, s-maxage=300" },
    });
  } catch (error) {
    console.error("[share/x-card] render failed", error);
    return NextResponse.json({ error: "Could not generate the card" }, { status: 500 });
  }
}
