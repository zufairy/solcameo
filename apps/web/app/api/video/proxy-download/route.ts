import { NextRequest, NextResponse } from "next/server";

// Streams a finished clip (Convex storage URL) back through our own origin with
// Content-Disposition: attachment, so the browser does a real forced .mp4
// download with a friendly filename (cross-origin <a download> can't set the
// name, and Convex storage may serve inline). SSRF-guarded: only Convex storage
// hosts are allowed.
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  const rawName = req.nextUrl.searchParams.get("name") ?? "vello-clip";
  const name = (rawName.replace(/[^\w-]+/g, "_").slice(0, 60) || "vello-clip");

  let host = "";
  try { host = new URL(url).hostname; } catch { return NextResponse.json({ error: "bad url" }, { status: 400 }); }
  const allowed = /^https:\/\//i.test(url) && /(^|\.)convex\.(cloud|site)$/i.test(host);
  if (!allowed) return NextResponse.json({ error: "only Convex storage URLs are allowed" }, { status: 400 });

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
  }
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${name}.mp4"`,
      "Cache-Control": "no-store",
    },
  });
}
