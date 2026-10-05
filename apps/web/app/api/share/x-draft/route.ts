import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireAuth, checkOwnership } from "@/lib/server/requireAuth";
import { geminiChat } from "@/lib/server/geminiFast";
import { loadShareAgent } from "@/lib/server/xShareCardRender";
import { fallbackPostText, finalizePostText, hashSeed, postPrompt } from "@/lib/share/xShareCard";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null) as { mint?: unknown; nonce?: unknown } | null;
  const mint = typeof body?.mint === "string" ? body.mint.trim() : "";
  const nonce = typeof body?.nonce === "string" || typeof body?.nonce === "number" ? String(body.nonce).slice(0, 32) : "0";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: "Invalid agent" }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!url || !secret) return NextResponse.json({ error: "Share service is not configured" }, { status: 503 });

  try {
    const convex = new ConvexHttpClient(url);
    const agent = await convex.query(api.influencers.getByMintServer, { mintAddress: mint, authSecret: secret });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    const denied = checkOwnership(auth.user, agent);
    if (denied) return denied;
    // Stats only — the card image route grabs the clip frames itself.
    const data = await loadShareAgent(mint, { media: false });
    if (!data) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const prompt = postPrompt(data.stats);
    // A slow or unavailable model must never block the owner from sharing a
    // factual card. The deterministic local copy is the production fallback.
    const reply = await geminiChat([
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ], { maxTokens: 220, timeoutMs: 9_000, maxModels: 1, maxPasses: 1, tag: "x-share" }).catch(() => null);
    let generated: string | null = null;
    if (reply?.text) {
      try {
        const parsed = JSON.parse(reply.text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { post?: unknown };
        if (typeof parsed.post === "string") generated = parsed.post;
      } catch { /* fall back to a truthful local draft */ }
    }
    const seed = hashSeed(mint, data.stats.views, nonce);
    const text = generated ? finalizePostText(generated, mint) : fallbackPostText(data.stats, seed, mint);
    return NextResponse.json({ ok: true, text, stats: data.stats, nonce });
  } catch (error) {
    console.error("[share/x-draft] failed", error);
    return NextResponse.json({ error: "Could not prepare your post" }, { status: 500 });
  }
}
