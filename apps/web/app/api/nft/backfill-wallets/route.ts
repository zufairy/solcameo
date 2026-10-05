import { NextRequest, NextResponse } from "next/server";
import { Keypair } from "@solana/web3.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { encryptWalletSecret } from "@/lib/server/walletCrypto";

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

    // Already has a wallet — return it
    if (doc.agentWallet) {
      return NextResponse.json({ ok: true, agentWallet: doc.agentWallet, created: false });
    }

    const keypair = Keypair.generate();
    const agentWallet = keypair.publicKey.toBase58();
    const agentWalletSecret = Buffer.from(keypair.secretKey).toString("base64");

    await convex.mutation(api.influencers.setAgentWallet, { mintAddress, agentWallet, agentWalletSecret: encryptWalletSecret(agentWalletSecret), authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });

    return NextResponse.json({ ok: true, agentWallet, created: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
