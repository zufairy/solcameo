import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireAuth, checkOwnership } from "@/lib/server/requireAuth";
import { loadShareAgent, renderShareGif } from "@/lib/server/xShareCardRender";
import { putImage, r2ImageConfigured } from "@/lib/server/imageStorage";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Freeze the exact share image on public R2 before Upload-Post fetches it. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => null) as { mint?: unknown; nonce?: unknown } | null;
  const mint = typeof body?.mint === "string" ? body.mint.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.slice(0, 32) : "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !nonce) {
    return NextResponse.json({ error: "Invalid agent or image variant." }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!url || !secret || !r2ImageConfigured()) {
    return NextResponse.json({ error: "Image publishing is not configured. Check Convex and R2 storage settings." }, { status: 503 });
  }
  try {
    const convex = new ConvexHttpClient(url);
    const agent = await convex.query(api.influencers.getByMintServer, { mintAddress: mint, authSecret: secret });
    if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    const denied = checkOwnership(auth.user, agent);
    if (denied) return denied;
    const data = await loadShareAgent(mint);
    if (!data) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    // The animated membership card — X plays GIFs inline.
    const bytes = await renderShareGif(data, nonce);
    const stored = await putImage(bytes, "image/gif", { keyPrefix: "agent-share/x" });
    return NextResponse.json({ ok: true, url: stored.url });
  } catch (error) {
    console.error("[share/x-media] failed", error);
    return NextResponse.json({ error: "Could not prepare a public share image. Please try again." }, { status: 500 });
  }
}
