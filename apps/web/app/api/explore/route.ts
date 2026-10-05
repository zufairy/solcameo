import { NextRequest, NextResponse } from "next/server";
import { FEED, normalizeFeed } from "@/lib/explore/feed";
export async function GET(req: NextRequest) {
  const cursor = Number(req.nextUrl.searchParams.get("cursor") ?? 1);
  if (!Number.isInteger(cursor) || cursor < 1 || cursor > 10000) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  try {
    const res = await fetch(`${FEED}?lang=en&source=community&size=48&cursor=${cursor}&sort=trending`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error("Upstream unavailable");
    return NextResponse.json(normalizeFeed(await res.json()), { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ error: "The reference library is temporarily unavailable. Please retry." }, { status: 502 });
  }
}
