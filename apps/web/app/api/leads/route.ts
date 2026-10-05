import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** Anonymous landing-page lead capture (hero "drop a video link" input).
 *  Fire-and-forget from the client; best-effort — a capture failure must
 *  never break the visitor's flow, so errors come back as ok:false, not 5xx. */
export async function POST(req: NextRequest) {
  try {
    const { url, source } = (await req.json().catch(() => ({}))) as { url?: string; source?: string };
    const clean = (url ?? "").trim().slice(0, 500);
    const src = source === "cta_website" ? "cta_website" as const : source === "hero_website" ? "hero_website" as const : "hero_video_link" as const;
    let parsed: URL;
    try {
      parsed = new URL(clean);
    } catch {
      return NextResponse.json({ ok: false, error: "invalid url" }, { status: 400 });
    }
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".")) {
      return NextResponse.json({ ok: false, error: "invalid url" }, { status: 400 });
    }
    if (!CONVEX_URL) return NextResponse.json({ ok: false });
    const convex = new ConvexHttpClient(CONVEX_URL);
    await convex.mutation(api.leads.capture, {
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      source: src,
      url: clean,
      userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? undefined,
      referer: req.headers.get("referer")?.slice(0, 300) ?? undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn("[leads] capture failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false });
  }
}
