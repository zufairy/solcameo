import { NextResponse } from "next/server";
/** GIPHY requires search calls from the client; this is its public integration key. */
export function GET() {
  return NextResponse.json({ apiKey: process.env.NEXT_PUBLIC_GIPHY_API_KEY || process.env.GIPHY_API_KEY || null }, { headers: { "Cache-Control": "no-store" } });
}
