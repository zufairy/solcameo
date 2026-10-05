import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getNetwork } from "@/lib/solana/network";
import { investEnabled } from "@/lib/flags";


/**
 * DEVNET-ONLY test invest. Records an investment in the vault (mints shares at
 * NAV) WITHOUT requiring the user's wallet to sign — so the full economy
 * (shares → NAV → redeem) is testable even when Phantom refuses to sign the
 * on-chain transfer. Hard-disabled on mainnet, where investors must send real
 * USDC via the wallet-signed flow. The escrow mirror is credited as if the
 * deposit landed; this is a test affordance, not a real on-chain transfer.
 */
export async function POST(req: NextRequest) {
  // Invest is turned OFF by default (NEXT_PUBLIC_INVEST_ENABLED). Refuse before any
  // shares are minted — this devnet test path mints shares too.
  if (!investEnabled()) {
    return NextResponse.json({ error: "investing_not_available" }, { status: 403 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  if (getNetwork() === "mainnet-beta") {
    return NextResponse.json({ error: "test-invest is disabled on mainnet — use the real wallet-signed flow" }, { status: 403 });
  }

  const { mintAddress, investorWallet, depositUsdc } = await req.json();
  if (!mintAddress || !investorWallet || typeof depositUsdc !== "number" || !Number.isFinite(depositUsdc) || depositUsdc <= 0) {
    return NextResponse.json({ error: "missing or invalid fields" }, { status: 400 });
  }

  try {
    // Provision the account if this agent predates auto-genesis (old agents).
    await convex.mutation(api.agentAccount.ensure, { mintAddress });
    // Synthetic, single-use signature so the replay guard is satisfied per call.
    const txSignature = `test-invest-${mintAddress}-${investorWallet}-${depositUsdc}-${Math.floor(performance.now())}`;
    // buyShares is INTERNAL_CRON_SECRET-gated (mints unbacked shares) — inject the secret.
    const res = await convex.mutation(api.shares.buyShares, { mintAddress, investorWallet, depositUsdc, txSignature, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    return NextResponse.json({ ok: true, test: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
