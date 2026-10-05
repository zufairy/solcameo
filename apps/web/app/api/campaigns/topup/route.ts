import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { optionalAuth } from "@/lib/server/requireAuth";
import { resolveLinkedWallets } from "@/lib/server/resolveWallet";
import { verifyUsdcDeposit } from "@/lib/trader/verifyUsdcDeposit";
import { getEscrowUsdcMint } from "@/lib/escrow";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Top up a campaign vault. The convex `campaigns.topUpBudget` mutation is
 * internal-secret gated; the only safe way to reach it is here, where we VERIFY
 * the on-chain USDC deposit (real transfer of `amount` USDC into THIS campaign's
 * vault, from the connected wallet) and credit only the server-verified amount.
 * (Was a public mutation that credited a client-supplied amount against an
 * unverified txSignature → anyone could inflate any campaign's budget.)
 *
 * Authorization is the signed on-chain transfer itself (like buy-shares), so a
 * wallet-only user can fund; a supplied account token is still validated.
 *
 * Body: { campaignId, amount, txSignature, funderWallet }
 */
export async function POST(req: NextRequest) {
  const auth = await optionalAuth(req);
  if (auth.error) return auth.error;

  let body: { campaignId?: string; amount?: number; txSignature?: string; funderWallet?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { campaignId, amount, txSignature, funderWallet } = body;
  if (
    !campaignId ||
    !txSignature ||
    !funderWallet ||
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return NextResponse.json({ error: "missing or invalid fields" }, { status: 400 });
  }
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 503 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  // getById validates a well-formed Convex id server-side, so a malformed
  // campaignId throws — treat that as not-found (clean 404) rather than a 500.
  const campaign = await convex
    .query(api.campaigns.getById, { id: campaignId as Id<"campaigns"> })
    .catch(() => null);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const escrowOwner = (campaign as { pdaAddress?: string }).pdaAddress;
  if (!escrowOwner) return NextResponse.json({ error: "Campaign has no on-chain vault" }, { status: 400 });

  // When signed in, the funding wallet must be linked to the account (a signed-in
  // user can't transact with a wallet that belongs to a different account).
  if (auth.token) {
    const userWallets = await resolveLinkedWallets(auth.token);
    if (userWallets.length > 0 && !userWallets.includes(funderWallet)) {
      return NextResponse.json({ error: "connected wallet is not linked to your account" }, { status: 403 });
    }
  }

  let creditedUsdc: number;
  try {
    ({ creditedUsdc } = await verifyUsdcDeposit({
      txSignature,
      escrowOwner,
      usdcMint: getEscrowUsdcMint().toBase58(),
      minAmountUsdc: amount,
      expectedSender: funderWallet,
    }));
  } catch (e) {
    return NextResponse.json({ error: `deposit not verified: ${(e as Error).message}` }, { status: 400 });
  }

  try {
    const res = await convex.mutation(api.campaigns.topUpBudget, {
      id: campaignId as Id<"campaigns">,
      amount: creditedUsdc,
      txSignature,
      callerWallet: funderWallet,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
