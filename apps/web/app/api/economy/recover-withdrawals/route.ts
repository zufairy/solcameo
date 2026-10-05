import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import {
  getSignatureStatus,
  getCurrentBlockHeight,
  getUsdcBalanceStrict,
  transferUsdc,
} from "@/lib/trader/usdcTransfer";
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";
import { STRAND_ALERT_AFTER_ATTEMPTS } from "@/lib/economy/constants";
import { decideUnknownWithdrawal } from "@/lib/economy/recoveryDecisions";

export const runtime = "nodejs";
export const maxDuration = 60;

type StrandedWithdrawal = {
  id: string;
  mintAddress: string;
  ownerWallet: string;
  amountUsdc: number;
  idempotencyKey: string;
  txSignature: string | null;
  lastValidBlockHeight: number | null;
  attempts: number;
  createdAt: number;
};

type RowOutcome =
  | { id: string; result: "paid"; txSignature: string; verified?: boolean }
  | { id: string; result: "retransferred"; txSignature: string }
  | { id: string; result: "ambiguous_left" }
  | { id: string; result: "deferred" }
  | { id: string; result: "orphan_no_sig" }
  | { id: string; result: "failed" }
  | { id: string; result: "skipped"; reason: string };

/**
 * RECOVERY KEEPER for stranded owner withdrawals — the analog the redeem-shares
 * path never had. Internal-secret gated; driven by the `recover stranded
 * withdrawals` cron (convex/crons.ts), mirroring recover-settlements.
 *
 * Per stranded `pending` row:
 *   - NO signature → a crash orphan. We can't PROVE the earlier attempt didn't
 *     broadcast, so we NEVER auto-re-transfer (transferUsdc is not idempotent
 *     on-chain, unlike the settlement debit_fee). We alert loudly for manual
 *     review and leave it (the per-mint lock stays held until an admin resolves).
 *   - WITH a signature (confirm-ambiguous) → verify it on-chain FIRST:
 *       landed  → markPaid (no re-transfer).
 *       failed  → the tx errored on-chain (no USDC moved) → re-transfer.
 *       unknown → decide by blockhash expiry; only a PROVABLY expired sig may be
 *                 re-transferred, else defer + (past threshold) alert.
 */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  const stranded = (await convex.query(api.withdrawals.listStranded, {
    nowMs: Date.now(),
    limit: 50,
    authSecret: secret,
  })) as StrandedWithdrawal[];

  const outcomes: RowOutcome[] = [];
  for (const s of stranded) {
    try {
      outcomes.push(await recoverOne(convex, secret, s));
    } catch (e) {
      outcomes.push({ id: s.id, result: "skipped", reason: e instanceof Error ? e.message : "error" });
    }
  }

  const recovered = outcomes.filter((o) => o.result === "paid" || o.result === "retransferred").length;
  return NextResponse.json({ ok: true, scanned: stranded.length, recovered, outcomes });
}

/** Best-effort mirror re-sync after a confirmed payout (mirrors the settlement
 *  keeper's reconcileAfterPay). Never undoes a recorded payment. */
async function reconcileAfterPay(convex: ConvexHttpClient, secret: string, mintAddress: string, agentWallet: string): Promise<void> {
  try {
    const fresh = await getUsdcBalanceStrict(agentWallet);
    await convex.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress, onchainUsdc: fresh, authSecret: secret });
  } catch (e) {
    console.warn(`[recover-withdrawals] post-pay reconcile failed for ${mintAddress}: ${e instanceof Error ? e.message : e}`);
  }
}

async function recoverOne(convex: ConvexHttpClient, secret: string, s: StrandedWithdrawal): Promise<RowOutcome> {
  const id = s.id as Id<"agentWithdrawals">;

  // ── Crash orphan (no broadcast sig): NEVER blindly re-transfer. Alert + hold. ──
  if (!s.txSignature) {
    const attempts = s.attempts + 1;
    await convex.mutation(api.withdrawals.bumpAttempts, { id, attempts, authSecret: secret });
    if (attempts >= STRAND_ALERT_AFTER_ATTEMPTS) {
      console.error(
        `[withdrawal-strand] id=${s.id} mint=${s.mintAddress} owner=${s.ownerWallet} ` +
        `amountUsdc=${s.amountUsdc} idem=${s.idempotencyKey} attempts=${attempts} — pending with NO ` +
        `broadcast signature (crash orphan); cannot prove no USDC moved — manual review needed`,
      );
    }
    return { id: s.id, result: "orphan_no_sig" };
  }

  // ── Confirm-ambiguous: verify the broadcast sig on-chain BEFORE any re-send. ──
  const status = await getSignatureStatus(s.txSignature);
  if (status === "landed") {
    await convex.mutation(api.withdrawals.markPaid, { id, txSignature: s.txSignature, authSecret: secret });
    await reconcileAfterPay(convex, secret, s.mintAddress, await resolveAgentWallet(convex, secret, s.mintAddress));
    return { id: s.id, result: "paid", txSignature: s.txSignature, verified: true };
  }
  if (status === "unknown") {
    const currentHeight = await getCurrentBlockHeight();
    const decision = decideUnknownWithdrawal({ lastValidBlockHeight: s.lastValidBlockHeight, currentHeight });
    if (decision === "defer") {
      const attempts = s.attempts + 1;
      await convex.mutation(api.withdrawals.bumpAttempts, { id, attempts, authSecret: secret });
      if (attempts >= STRAND_ALERT_AFTER_ATTEMPTS) {
        console.error(
          `[withdrawal-strand] id=${s.id} sig=${s.txSignature} lvbh=${s.lastValidBlockHeight ?? "unknown"} ` +
          `attempts=${attempts} amountUsdc=${s.amountUsdc} mint=${s.mintAddress} — confirm-ambiguous and not ` +
          `yet resolvable (tip not past lvbh); manual review needed`,
        );
      }
      return { id: s.id, result: "deferred" };
    }
    // decision === "retransfer": blockhash provably expired → safe to re-transfer.
  }
  // status === "failed" → the tx errored on-chain (no USDC moved); safe to re-transfer.

  // ── Re-transfer (sig proven unable-to-have-moved-funds): failed OR expired. ──
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress: s.mintAddress, authSecret: secret });
  if (!agent?.agentWallet || !agent.agentWalletSecret) {
    return { id: s.id, result: "skipped", reason: "no agent wallet" };
  }
  const transfer = await transferUsdc({
    fromSecretBase64: readAgentSecret(agent.agentWalletSecret),
    fromPubkey: agent.agentWallet,
    toPubkey: s.ownerWallet,
    amountUsdc: s.amountUsdc,
    feePayerSecretBase64: process.env.PLATFORM_FEE_PAYER_SECRET || undefined,
  });
  if (transfer.ok) {
    await convex.mutation(api.withdrawals.markPaid, { id, txSignature: transfer.txSignature!, authSecret: secret });
    await reconcileAfterPay(convex, secret, s.mintAddress, agent.agentWallet);
    return { id: s.id, result: "retransferred", txSignature: transfer.txSignature! };
  }
  if (transfer.txSignature) {
    // The re-transfer was ALSO confirm-ambiguous — persist the fresh sig + lvbh.
    await convex.mutation(api.withdrawals.markAmbiguous, {
      id,
      txSignature: transfer.txSignature,
      ...(transfer.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: transfer.lastValidBlockHeight } : {}),
      attempts: s.attempts + 1,
      authSecret: secret,
    });
    return { id: s.id, result: "ambiguous_left" };
  }
  // Pre-broadcast failure on re-drive → bump attempts, retry next tick.
  await convex.mutation(api.withdrawals.bumpAttempts, { id, attempts: s.attempts + 1, authSecret: secret });
  return { id: s.id, result: "deferred" };
}

async function resolveAgentWallet(convex: ConvexHttpClient, secret: string, mintAddress: string): Promise<string> {
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  return agent?.agentWallet ?? "";
}
