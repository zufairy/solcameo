import { NextRequest, NextResponse } from "next/server";
import { ensureInfluencerWallet } from "@/lib/server/agentWallet";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

// POST /api/nft/backfill-wallets
// Generates a dedicated agent wallet for any influencer that doesn't have one yet.
export async function POST(req: NextRequest) {
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });
  try {
    // Provisions a custodial keypair (writes agentWalletSecret) — gate to the agent's owner only.
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    const { mintAddress } = await req.json() as { mintAddress?: string };
    if (!mintAddress) return NextResponse.json({ error: "mintAddress required" }, { status: 400 });

    const convex = new ConvexHttpClient(CONVEX_URL);
    const doc = await convex.query(api.influencers.getByMint, { mintAddress });
    if (!doc) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    if (!auth.internal) {
      const ownershipError = requireOwnerWithSiws(auth, doc);
      if (ownershipError) return ownershipError;
    }

    return NextResponse.json({ ok: true, ...await ensureInfluencerWallet(mintAddress) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
