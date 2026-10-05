import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { requireAuth } from "@/lib/server/requireAuth";
import { resolveLinkedWallets } from "@/lib/server/resolveWallet";
import { transferUsdc } from "@/lib/trader/usdcTransfer";
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";

// String refs — shareRedemptions is a NEW Convex module, so the generated `api`
// types lag until `npx convex deploy` regenerates them (mirrors clipJobs' CRM_UPSERT).
const SR_BEGIN = makeFunctionReference<"mutation">("shareRedemptions:begin");
const SR_MARK_PAID = makeFunctionReference<"mutation">("shareRedemptions:markPaid");
const SR_MARK_AMBIGUOUS = makeFunctionReference<"mutation">("shareRedemptions:markAmbiguous");
const SR_MARK_FAILED = makeFunctionReference<"mutation">("shareRedemptions:markFailed");

type BeginResult =
  | { created: true; locked: false; redemptionId: string; redeemRowId: string; payout: number; exitFee: number; navPerShare: number }
  | { created: false; locked: false; redemption: { redemptionId: string; status: string; payoutUsdc: number; txSignature: string | null; error: string | null } }
  | { created: false; locked: true };

/**
 * Redeem shares for USDC — idempotent + keeper-recoverable (H4).
 *
 * The burn (shareLedger redeem row + escrow debit) and the pending `shareRedemptions`
 * row are created ATOMICALLY by begin; ONLY a freshly-created redemption transfers.
 * A same-key retry of a confirm-timeout 502 returns the existing row — it never
 * re-burns and never re-broadcasts, so a client retry can neither double-burn nor
 * double-pay. A pre-broadcast transfer failure REVERSES the burn (markFailed →
 * shares restored); a confirm-ambiguous transfer stores the sig (markAmbiguous) for
 * the recovery keeper (/api/economy/recover-redemptions), which verifies it on-chain
 * before ever re-transferring. Preserves the 2% exit fee + liquidity invariants
 * (enforced inside begin's shared burn helper).
 */
export async function POST(req: NextRequest) {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  const body = await req.json();
  const { mintAddress, holderWallet, sharesToBurn } = body as { mintAddress?: string; holderWallet?: string; sharesToBurn?: number };
  if (!mintAddress || !holderWallet || typeof sharesToBurn !== "number" || !Number.isFinite(sharesToBurn) || sharesToBurn <= 0) {
    return NextResponse.json({ error: "missing or invalid fields" }, { status: 400 });
  }
  // A CLIENT-STABLE key makes a retry deduplicate (return the same row). Clients
  // SHOULD send a stable key per redemption intent; without one we fall back to a
  // fresh UUID (the one-in-flight-per-holder lock in begin still blocks a concurrent
  // double-submit). Cap the length so a hostile key can't bloat the row.
  const idempotencyKey = (typeof body.idempotencyKey === "string" && body.idempotencyKey.trim())
    ? body.idempotencyKey.trim().slice(0, 200)
    : randomUUID();

  // Enforce wallet ownership — the holder wallet must be linked to this account.
  const userWallets = await resolveLinkedWallets(auth.token);
  if (!userWallets.includes(holderWallet)) {
    return NextResponse.json({ error: "connected wallet is not linked to your account" }, { status: 403 });
  }

  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!agent?.agentWallet || !agent.agentWalletSecret) {
    return NextResponse.json({ error: "agent has no escrow wallet" }, { status: 400 });
  }

  // 1) begin — create-or-return the pending redemption (burns ONLY on fresh create).
  let begin: BeginResult;
  try {
    begin = (await convex.mutation(SR_BEGIN, { mintAddress, holderWallet, sharesToBurn, idempotencyKey, authSecret: secret })) as BeginResult;
  } catch (e) {
    // begin throws on the burn guards (insufficient shares / liquid / invariant).
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  if (!begin.created) {
    if (begin.locked) {
      return NextResponse.json({ error: "a redemption for this wallet is already in progress — try again once it settles" }, { status: 409 });
    }
    // Same-key retry: resolve from the existing row's state — NEVER re-broadcast.
    const r = begin.redemption;
    if (r.status === "paid") {
      return NextResponse.json({ ok: true, payout: r.payoutUsdc, txSignature: r.txSignature, idempotent: true });
    }
    if (r.status === "failed") {
      return NextResponse.json({ error: r.error ?? "redemption failed; shares were restored", redemptionId: r.redemptionId }, { status: 502 });
    }
    // still pending → the transfer is in-flight / awaiting the recovery keeper.
    return NextResponse.json(
      { error: "redemption is still processing; it will be finalized automatically", redemptionId: r.redemptionId, pending: true },
      { status: 202 },
    );
  }

  // 2) Fresh redemption — the burn already committed. BROADCAST-ATTEMPT MARKER:
  // bump attempts to 1 BEFORE the transfer, so if this process dies in the tiny
  // window after transferUsdc moves USDC but before we record the sig, the keeper
  // sees a no-sig pending row with attempts≥1 and treats it as "outcome unknown"
  // (never blind re-transfers → no double-pay). A crash BEFORE this marker leaves
  // attempts=0 = "never attempted" → the keeper safely re-transfers.
  await convex.mutation(SR_MARK_AMBIGUOUS, { redemptionId: begin.redemptionId, attempts: 1, authSecret: secret });

  // Transfer the payout ONCE.
  const transfer = await transferUsdc({
    fromSecretBase64: readAgentSecret(agent.agentWalletSecret),
    fromPubkey: agent.agentWallet,
    toPubkey: holderWallet,
    amountUsdc: begin.payout,
  });

  if (transfer.ok) {
    await convex.mutation(SR_MARK_PAID, { redemptionId: begin.redemptionId, txSignature: transfer.txSignature!, authSecret: secret });
    return NextResponse.json({ ok: true, payout: begin.payout, exitFee: begin.exitFee, txSignature: transfer.txSignature });
  }

  // Transfer failed. A sig means it was BROADCAST (the USDC may have moved) — store
  // it for the keeper to verify; NEVER reverse. A sig-less failure is pre-broadcast
  // (no USDC moved) — REVERSE the burn so the holder keeps their shares.
  if (transfer.txSignature) {
    await convex.mutation(SR_MARK_AMBIGUOUS, {
      redemptionId: begin.redemptionId,
      txSignature: transfer.txSignature,
      ...(transfer.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: transfer.lastValidBlockHeight } : {}),
      attempts: 1,
      authSecret: secret,
    });
    return NextResponse.json(
      { error: `payout broadcast but not yet confirmed (${transfer.step}); the recovery keeper will finalize it`, redemptionId: begin.redemptionId, pending: true },
      { status: 202 },
    );
  }

  await convex.mutation(SR_MARK_FAILED, { redemptionId: begin.redemptionId, reason: `${transfer.step}: ${transfer.error}`, authSecret: secret });
  return NextResponse.json(
    { error: `payout transfer failed (${transfer.step}: ${transfer.error}); your shares were restored — please retry`, redemptionId: begin.redemptionId },
    { status: 502 },
  );
}
