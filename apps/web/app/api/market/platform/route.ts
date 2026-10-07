import { NextResponse } from "next/server";
import { lastPlatformSnapshot, platformSnapshot } from "@/lib/server/platformSnapshot";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET() {
  const headers = { "Cache-Control": "public, s-maxage=2, stale-while-revalidate=6" };
  try {
    const data = await platformSnapshot();
    if (!data) return NextResponse.json({ available: false }, { headers });
    return NextResponse.json(data, { headers });
  } catch {
    const stale = lastPlatformSnapshot();
    if (stale) return NextResponse.json({ ...stale, stale: true }, { headers });
    return NextResponse.json({ available: false, error: "Market data temporarily unavailable" }, { status: 503 });
  }
}
