import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { optionalAuth } from "@/lib/server/requireAuth";
import { resolveLinkedWallets } from "@/lib/server/resolveWallet";
import { verifyUsdcDeposit } from "@/lib/trader/verifyUsdcDeposit";
import { investEnabled } from "@/lib/flags";

const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT!;

export async function POST(req: NextRequest) {
  // Invest is turned OFF by default (NEXT_PUBLIC_INVEST_ENABLED). Refuse BEFORE any
  // USDC is verified/consumed or shares are minted. Redeem is unaffected.
  if (!investEnabled()) {
    return NextResponse.json({ error: "investing_not_available" }, { status: 403 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  // Buying is authorized by the signed on-chain USDC transfer (verified below),
  // so a Google session is NOT required — a wallet-only user can invest. A token
  // that IS supplied is still validated (and a bad one is rejected).
  const auth = await optionalAuth(req);
  if (auth.error) return auth.error;

  const { mintAddress, investorWallet, depositUsdc, txSignature } = await req.json();
  if (!mintAddress || !investorWallet || !txSignature || typeof depositUsdc !== "number" || !Number.isFinite(depositUsdc) || depositUsdc <= 0) {
    return NextResponse.json({ error: "missing or invalid fields" }, { status: 400 });
  }

  // When signed in, keep the existing guard: the investing wallet must be one of
  // the wallets linked to the account, so a signed-in user can't transact with a
  // wallet that belongs to a different account. (Wallet-only callers skip this —
  // their ownership is proven by the on-chain sender check below.)
  if (auth.token) {
    const userWallets = await resolveLinkedWallets(auth.token);
    if (userWallets.length > 0 && !userWallets.includes(investorWallet)) {
      return NextResponse.json({ error: "connected wallet is not linked to your account" }, { status: 403 });
    }
  }

  // ConvexHttpClient cannot invoke internalQuery — use the secret-gated public
  // twin (same doc shape) so this money path actually resolves the agent.
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET! });
  if (!agent?.agentWallet) return NextResponse.json({ error: "agent has no escrow wallet" }, { status: 400 });

  let creditedUsdc: number;
  try {
    // Fix #1: capture the verified on-chain amount; depositUsdc is only the floor.
    // expectedSender binds the deposit to the connected wallet — this is what
    // authorizes the purchase for wallet-only (no account session) callers.
    ({ creditedUsdc } = await verifyUsdcDeposit({ txSignature, escrowOwner: agent.agentWallet, usdcMint: USDC_MINT, minAmountUsdc: depositUsdc, expectedSender: investorWallet }));
  } catch (e) {
    return NextResponse.json({ error: `deposit not verified: ${(e as Error).message}` }, { status: 400 });
  }

  try {
    // Fix #1: pass the verified credited amount, not the caller-supplied amount.
    // buyShares is INTERNAL_CRON_SECRET-gated (mints unbacked shares) — inject the secret.
    const res = await convex.mutation(api.shares.buyShares, { mintAddress, investorWallet, depositUsdc: creditedUsdc, txSignature, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
