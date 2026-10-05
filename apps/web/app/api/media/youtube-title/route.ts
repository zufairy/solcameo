import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Resolves a YouTube video's real title via the public oEmbed endpoint (free,
 * keyless — no Data API quota needed). Proxied server-side because YouTube's
 * oEmbed response has no CORS headers, so a browser fetch straight to it is
 * blocked. Used by the Editor's Videos panel so cards show "How I Built a
 * $10M SaaS" instead of the raw source URL.
 *
 * GET ?url=<sourceUrl> → { ok, title } (ok:false for a non-YouTube URL or a
 * private/deleted video — caller falls back to the URL).
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")?.trim();
  if (!url || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    return NextResponse.json({ ok: false, error: "not a YouTube url" }, { status: 400 });
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`oEmbed HTTP ${res.status}`);
    const json = (await res.json()) as { title?: string };
    if (!json.title) throw new Error("no title in response");
    return NextResponse.json({ ok: true, title: json.title });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "lookup failed" }, { status: 502 });
  }
}
