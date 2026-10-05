// Same-origin download for /dev/jev clips. The clips live on the public R2
// domain, and a cross-origin <a download> is ignored by browsers (it just opens
// the video), while the bucket has no CORS rule for a fetch-to-blob. This
// streams the object back with Content-Disposition: attachment instead.
//
// GET ?url=<R2 public url under clips/jev/ or jev/uploads/>&name=<file name>
// Only our own R2 prefixes are proxied — never an arbitrary URL (no SSRF).
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED_PREFIXES = ["clips/jev/", "jev/uploads/"];

export async function GET(req: NextRequest) {
  const base = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  const url = req.nextUrl.searchParams.get("url") ?? "";
  if (!base || !url.startsWith(`${base}/`)) return NextResponse.json({ ok: false, error: "not a Vello clip url" }, { status: 400 });
  const key = url.slice(base.length + 1);
  if (key.includes("..") || !ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
    return NextResponse.json({ ok: false, error: "not a Vello clip url" }, { status: 400 });
  }
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) return NextResponse.json({ ok: false, error: `clip unavailable (HTTP ${upstream.status})` }, { status: 502 });
  const name = (req.nextUrl.searchParams.get("name") || "vello-clip.mp4").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
    "Content-Disposition": `attachment; filename="${name.endsWith(".mp4") ? name : `${name}.mp4`}"`,
    "Cache-Control": "private, max-age=3600",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  return new Response(upstream.body, { headers });
}
