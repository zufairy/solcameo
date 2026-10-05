import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws, requireSiwsSession } from "@/lib/server/requireAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const SECRET = process.env.INTERNAL_CRON_SECRET ?? "";

/**
 * Complete / reconcile the ON-CHAIN NFT for an agent whose record only has a
 * synthetic `vello_…` mint id (the on-chain mint previously failed — e.g. the
 * dead devnet Helius RPC) but who IS minted/functional in the app.
 *
 * It runs the REAL Metaplex mint (now that the RPC is healthy), then records it
 * on the influencer row via `setNft` (nftMintAddress/tx/explorer — the stable
 * internal `mintAddress` is kept, so nothing else breaks). Idempotent: if the
 * record already has a real nftMintAddress, it just returns that.
 *
 * Body: { mintAddress: string }   Returns { ok, mintAddress, nftMintAddress, minted: boolean }
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!auth.internal) {
    const err = requireSiwsSession(auth);
    if (err) return err;
  }

  let body: { mintAddress?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const mintAddress = String(body.mintAddress ?? "").trim();
  if (!mintAddress) return NextResponse.json({ ok: false, error: "mintAddress required" }, { status: 400 });
  if (!CONVEX_URL || !SECRET) return NextResponse.json({ ok: false, error: "server not configured" }, { status: 503 });

  const convex = new ConvexHttpClient(CONVEX_URL);

  try {
    const agent = (await convex.query(api.influencers.getByMintServer, {
      mintAddress, authSecret: SECRET,
    })) as { mintAddress?: string; nftMintAddress?: string; creatorWallet?: string; name?: string; description?: string; avatarUrl?: string } | null;
    if (!agent) return NextResponse.json({ ok: false, error: "Agent not found" }, { status: 404 });

    if (!auth.internal) {
      const ownershipError = requireOwnerWithSiws(auth, agent);
      if (ownershipError) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Already has a real on-chain NFT recorded → nothing to do.
    if (agent.nftMintAddress) {
      return NextResponse.json({ ok: true, mintAddress, nftMintAddress: agent.nftMintAddress, explorerUrl: explorer(agent.nftMintAddress), minted: false });
    }

    // No on-chain NFT yet → mint one now and record it.
    const { mintAgentNft } = await import("@/lib/server/nftMint");
    const minted = await mintAgentNft({
      name: agent.name ?? "Vello Agent",
      description: agent.description ?? "",
      imageUrl: agent.avatarUrl,
      ownerWallet: agent.creatorWallet ?? "",
    });
    if (!minted.mintAddress) throw new Error("mint returned no address");

    await convex.mutation(api.influencers.setNft, {
      mintAddress, nftMintAddress: minted.mintAddress, nftTxSignature: minted.txSignature, nftExplorerUrl: minted.explorerUrl, authSecret: SECRET,
    });

    return NextResponse.json({ ok: true, mintAddress, nftMintAddress: minted.mintAddress, explorerUrl: minted.explorerUrl, minted: true });
  } catch (err) {
    console.error("[complete-onchain-mint]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "complete-onchain-mint failed" },
      { status: 502 },
    );
  }
}

function explorer(mint: string): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_NETWORK?.toLowerCase().startsWith("mainnet") ? "" : "?cluster=devnet";
  return `https://explorer.solana.com/address/${mint}${cluster}`;
}