import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

/**
 * Set an agent's daily spend cap. The Convex mutation usage.setDailyCap is
 * secret-gated, so the client can no longer call it directly. This route
 * authenticates the operator (Privy Bearer), ownership-scopes the mint, then
 * forwards the internal secret. Body: { mintAddress, capUsdc? }.
 */
export async function POST(req: NextRequest) {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const { mintAddress, capUsdc } = (await req.json()) as { mintAddress?: string; capUsdc?: number };
  if (!mintAddress) return NextResponse.json({ error: "missing mintAddress" }, { status: 400 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }

  const clean = typeof capUsdc === "number" && Number.isFinite(capUsdc) ? Math.max(0, capUsdc) : undefined;
  const result = await convex.mutation(api.usage.setDailyCap, { mintAddress, capUsdc: clean, authSecret: secret });
  return NextResponse.json(result);
}
