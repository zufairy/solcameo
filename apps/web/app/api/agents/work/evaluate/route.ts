import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { evaluateCampaignsForAgent } from "@/lib/server/campaignEvaluate";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Work tab "Evaluate now": run the agent's campaign decision and persist it
 *  (same code path the autonomous scout runs). Owner-only. */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { mintAddress?: string };
  const mintAddress = String(body.mintAddress ?? "").trim();
  if (!mintAddress) return NextResponse.json({ ok: false, error: "mintAddress required" }, { status: 400 });
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  if (!auth.internal) {
    const agent = await new ConvexHttpClient(CONVEX_URL).query(api.influencers.getByMintServer, { mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }
  const evaluated = await evaluateCampaignsForAgent(mintAddress, { persist: true });
  if (!evaluated) return NextResponse.json({ ok: false, error: "agent not found" }, { status: 404 });
  const { agent, results } = evaluated;
  return NextResponse.json({
    ok: true,
    agent: { niche: agent.niche, medianViews: agent.medianViews, sampleCount: agent.sampleCount, estCostUsdc: agent.estCostUsdc, connectedPlatforms: agent.connectedPlatforms },
    results: results.map(({ sources, ...r }) => ({ ...r, sourceCount: sources.length })),
  });
}
