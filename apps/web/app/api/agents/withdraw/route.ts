import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { getUsdcBalanceStrict, transferUsdc } from "@/lib/trader/usdcTransfer";
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";
import { navPerShare } from "@/lib/economy/nav";
import { computeSafeWithdrawable } from "@/lib/economy/safeWithdrawable";
import { investEnabled } from "@/lib/flags";

export const runtime = "nodejs";

// Float tolerance when comparing the requested amount to the computed safe cap.
const EPSILON = 1e-6;

/**
 * Owner WITHDRAW: send an agent's spendable on-chain USDC from its custodial
 * wallet to the OWNER's (creatorWallet) wallet. A partial-amount, idempotent,
 * keeper-backed cousin of agents/delete/route.ts's full-drain refund. Money-out,
 * so:
 *   - SIWS owner-gated (destination is agent.creatorWallet, NEVER client-supplied).
 *   - The transfer amount is checked against a FRESH strict on-chain read
 *     (getUsdcBalanceStrict); a null (RPC-unknown) read ABORTS — we never trust
 *     the Convex mirror for money-out.
 *   - safeWithdrawable holds back the unsettled tab, booked-but-unswept fees,
 *     in-flight reservations, and any share-backed (investor) floor.
 *   - withdrawals.begin creates ONE row per idempotencyKey BEFORE the transfer;
 *     a retry with the same key never re-broadcasts (the recover-withdrawals
 *     keeper owns any in-flight/ambiguous transfer).
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    mintAddress?: string;
    amountUsdc?: number;
    idempotencyKey?: string;
  };
  const mintAddress = body.mintAddress;
  const amountUsdc = body.amountUsdc;
  const idempotencyKey = body.idempotencyKey;

  if (!mintAddress) return NextResponse.json({ ok: false, error: "mintAddress required" }, { status: 400 });
  if (typeof amountUsdc !== "number" || !Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    return NextResponse.json({ ok: false, error: "amountUsdc must be a positive number" }, { status: 400 });
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return NextResponse.json({ ok: false, error: "idempotencyKey required" }, { status: 400 });
  }

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  // Resolve the agent (full doc incl. encrypted key) and the destination.
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!agent?.agentWallet || !agent.agentWalletSecret) {
    return NextResponse.json({ ok: false, error: "agent has no escrow wallet" }, { status: 400 });
  }
  const ownerWallet = agent.creatorWallet;
  if (!ownerWallet) {
    return NextResponse.json({ ok: false, error: "agent has no owner wallet on record" }, { status: 400 });
  }

  // Ownership: only the SIWS-proven owner (or an internal caller) may withdraw.
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, ownerWallet);
    if (err) return err;
  }

  // FRESH strict on-chain read — NEVER the mirror for the transfer amount. A null
  // read (RPC 429/timeout/drop) is UNKNOWN, so abort rather than over/under-send.
  const real = await getUsdcBalanceStrict(agent.agentWallet);
  if (real === null) {
    return NextResponse.json(
      { ok: false, error: "on-chain balance temporarily unavailable — please retry", retriable: true },
      { status: 503 },
    );
  }

  // Obligations that must stay in the wallet.
  const spend = await convex.query(api.usage.serviceSpendQuery, { mintAddress });
  const unsettledTab = spend?.unsettledTabUsdc ?? 0;
  const pendingSettlement = spend?.pendingSettlementUsdc ?? 0;
  const ledger = await convex.query(api.agentTasks.walletLedger, { mintAddress });
  const reserved = ledger?.reserved ?? 0;
  const account = await convex.query(api.agentAccount.get, { mintAddress });
  const sharesOutstanding = account?.sharesOutstanding ?? 0;
  // In-flight share redemptions: each has ALREADY burned its shares (so the floor
  // below no longer covers it) but its USDC payout is still in this wallet until the
  // transfer confirms. Hold that sum back too, or the owner could drain the
  // redeemer's earmarked capital during the burn→confirm window (F1-0 double-spend).
  // 0 for the common clipper (no redemptions).
  const pendingRedemptionPayouts =
    (await convex.query(api.shareRedemptions.pendingPayoutSumForMint, { mintAddress, authSecret: secret })) ?? 0;
  // Share-backed floor: investor+founder capital pooled in the SAME wallet backs
  // NAV, so it can NOT be withdrawn (that would break redeemShares' liquidity).
  // 0 for the common clipper-with-no-investors case — AND 0 whenever Invest is
  // globally disabled (no external buyers to protect) or the outstanding shares are
  // dust (founder artifact). Passing investEnabled() keeps this route in lockstep
  // with the client's Withdraw-button gate.
  const safeWithdrawable = computeSafeWithdrawable({
    real,
    unsettledTab,
    pendingSettlement,
    reserved,
    sharesOutstanding,
    navPerShare: account ? navPerShare(account) : 0,
    pendingRedemptionPayouts,
    investEnabled: investEnabled(),
  });
  // Defensive: real was already null-checked above (503), so this can't be null;
  // the guard keeps the type narrow and the abort-on-unknown invariant explicit.
  if (safeWithdrawable === null) {
    return NextResponse.json(
      { ok: false, error: "on-chain balance temporarily unavailable — please retry", retriable: true },
      { status: 503 },
    );
  }

  if (amountUsdc > safeWithdrawable + EPSILON) {
    return NextResponse.json(
      {
        ok: false,
        error: `Requested $${amountUsdc.toFixed(2)} exceeds the safe withdrawable balance $${safeWithdrawable.toFixed(2)}.`,
        safeWithdrawable,
      },
      { status: 400 },
    );
  }

  // Idempotent begin: creates the row (or returns the existing one) + the
  // one-in-flight-per-mint lock. A DIFFERENT key while another withdrawal for this
  // mint is pending throws → 409.
  let begun: { id: Id<"agentWithdrawals">; status: "pending" | "paid" | "failed"; txSignature: string | null; existing: boolean };
  try {
    begun = (await convex.mutation(api.withdrawals.begin, {
      mintAddress,
      ownerWallet,
      amountUsdc,
      idempotencyKey,
      authSecret: secret,
    })) as typeof begun;
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
  }

  const id = begun.id;

  // Replay of a key that already settled — return the recorded result, no re-send.
  if (begun.status === "paid") {
    return NextResponse.json({ ok: true, alreadyPaid: true, txSignature: begun.txSignature, amountUsdc });
  }
  // A prior attempt with this SAME key pre-broadcast-failed — tell the client to
  // retry with a fresh key (the modal generates a new key per attempt).
  if (begun.status === "failed") {
    return NextResponse.json(
      { ok: false, error: "a previous attempt with this key failed — retry", retriable: true },
      { status: 409 },
    );
  }
  // A prior attempt with this SAME key created the row and owns the transfer
  // (in-flight, or the keeper is resolving a confirm-ambiguous send). NEVER
  // re-broadcast — that is exactly the redeem-shares double-spend.
  if (begun.existing) {
    return NextResponse.json(
      { ok: false, status: "processing", pending: true, message: "withdrawal is already being processed" },
      { status: 202 },
    );
  }

  // We just created the row (existing:false) → perform the transfer EXACTLY once.
  // Sponsored gas (PLATFORM_FEE_PAYER_SECRET) so the agent wallet needs zero SOL.
  const transfer = await transferUsdc({
    fromSecretBase64: readAgentSecret(agent.agentWalletSecret),
    fromPubkey: agent.agentWallet,
    toPubkey: ownerWallet,
    amountUsdc,
    feePayerSecretBase64: process.env.PLATFORM_FEE_PAYER_SECRET || undefined,
  });

  if (transfer.ok) {
    await convex.mutation(api.withdrawals.markPaid, { id, txSignature: transfer.txSignature!, authSecret: secret });
    // Re-sync the escrow mirror to the (now-lowered) on-chain balance. Best-effort
    // — a reconcile hiccup must not undo a recorded, confirmed payment.
    try {
      const fresh = await getUsdcBalanceStrict(agent.agentWallet);
      await convex.mutation(api.agentAccount.reconcileEscrowToOnchainServer, {
        mintAddress,
        onchainUsdc: fresh,
        authSecret: secret,
      });
    } catch {
      /* mirror drift self-heals on the next reconcile */
    }
    return NextResponse.json({ ok: true, txSignature: transfer.txSignature, amountUsdc });
  }

  // Confirm-AMBIGUOUS: a signature was broadcast but confirmation failed — the
  // USDC MAY have moved. Persist the sig + blockhash expiry and hand it to the
  // keeper; do NOT release, do NOT re-send.
  if (transfer.txSignature) {
    await convex.mutation(api.withdrawals.markAmbiguous, {
      id,
      txSignature: transfer.txSignature,
      ...(transfer.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: transfer.lastValidBlockHeight } : {}),
      attempts: 1,
      authSecret: secret,
    });
    return NextResponse.json(
      { ok: false, error: "withdrawal pending on-chain verification", pending: true, txSignature: transfer.txSignature },
      { status: 502 },
    );
  }

  // PRE-broadcast failure: no signature was ever produced → no USDC moved. Mark
  // failed (frees the per-mint lock) so the owner may retry with a NEW key.
  await convex.mutation(api.withdrawals.markFailed, { id, authSecret: secret });
  return NextResponse.json(
    { ok: false, error: transfer.error ?? "transfer failed", step: transfer.step, retriable: true },
    { status: 502 },
  );
}
