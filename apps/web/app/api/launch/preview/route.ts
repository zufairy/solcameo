import { NextRequest, NextResponse } from "next/server";
import { parseLaunchInput } from "@/lib/server/launch/launchInput";
import { previewWebsite, WebsiteUnreadableError } from "@/lib/server/launch/analyzeWebsite";

/**
 * Anonymous, text-only website preview for the index-page Launch modal —
 * the "here's your product, your agent's name, your winning pitch" moment
 * that lands BEFORE the sign-in wall. One Claude call, no images, no video.
 * IP rate-limited (per-instance memory; good enough for a marketing surface).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const WINDOW_MS = 60 * 60 * 1000;
const PER_WINDOW = 6;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= PER_WINDOW) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) { for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k); }
  return false;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const input = parseLaunchInput(body);
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  if (rateLimited(ip)) return NextResponse.json({ ok: false, error: "Too many previews from this network — sign in to continue." }, { status: 429 });
  try {
    const p = await previewWebsite(input.websiteUrl);
    const reaction = p.concepts.find((c) => c.format === "reaction");
    return NextResponse.json({
      ok: true,
      websiteUrl: input.websiteUrl,
      productSummary: p.productSummary,
      agentName: p.identity.agentName,
      handle: p.identity.handle,
      niche: p.identity.niche,
      hookText: reaction?.hookText ?? "",
      concepts: p.concepts.map((c) => ({ format: c.format, title: c.title })),
    });
  } catch (e) {
    if (e instanceof WebsiteUnreadableError) return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    return NextResponse.json({ ok: false, error: `Couldn't read that site right now: ${e instanceof Error ? e.message.slice(0, 160) : "error"}` }, { status: 502 });
  }
}
