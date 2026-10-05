import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { buildServerEscrowProgram, loadKeypair } from "@/lib/server/escrowServer";
import { claimPayoutTx, getClaimRecord, getCampaignPda, getClaimPda, getPlatformConfig } from "@/lib/escrow";
import { computeClaimSettlement, settleClaimTranche } from "@/lib/server/oracleClaim";
import { sendAlert } from "@/lib/server/alert";

/** Minimum SOL the crank/oracle signer must hold before we attempt to sign (ORA-4).
 *  Env-tunable via VELLO_MIN_SIGNER_SOL; defaults to 0.05 SOL. */
const MIN_SIGNER_SOL = Number(process.env.VELLO_MIN_SIGNER_SOL ?? "0.05");

/** Alert when this many rows are skipped in one tick (persistent backlog signal). */
const CLAIM_BACKLOG_ALERT = 5;

export const maxDuration = 300;
export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** One row returned by `api.submissions.dueForClaim` (annotated locally so the
 *  route typechecks without regenerating Convex types). */
type ClaimDue = {
  _id: string;
  campaignId: string;
  influencerMint: string;
  payoutAmountUsdc: number;
  paidUsdc: number;
  navCreditedUsdc: number;
  attestationTx: string;
  creatorWallet: string | null;
  agentWallet: string | null;
};

/** Convert an on-chain USDC base-unit amount (number | BN-like | bigint) to a
 *  decimal USDC number. The reader returns BN for u64 fields. */
function baseUnitsToUsdc(raw: unknown): number {
  if (raw == null) return 0;
  // BN exposes toString(); Number(string)/1e6 is exact for amounts < 2^53 base
  // units (~9.007e9 USDC), well beyond any realistic campaign budget.
  const asNum = typeof raw === "number" ? raw : Number((raw as { toString(): string }).toString());
  return Number.isFinite(asNum) ? asNum / 1_000_000 : 0;
}

/**
 * The permissionless claim keeper (internal-secret ONLY; sole caller is the
 * `runClaimPayouts` cron in convex/crons.ts).
 *
 * Per tick: query Convex for approved, attested, not-fully-paid, non-terminal v2
 * submissions → crank `claim_payout` on-chain for each (signed by
 * VELLO_CRANK_SECRET). The program is the money truth: a duplicate crank pays 0,
 * and the dispute-window / staleness reverts are EXPECTED (retry next tick). On a
 * confirmed payout we read the new cumulative `paid` from the ClaimRecord and run
 * the PURE settlement math (lib/server/oracleClaim) to derive:
 *   - the NET to credit THIS tranche (per-tranche idempotent — multi-tranche
 *     payouts credit only their delta, never under- or double-credit),
 *   - the new cumulative net (the persisted idempotency guard),
 *   - a terminal `claimDone` flag (a 0-progress crank ⇒ budget exhausted, or
 *     fully settled per the estimate ⇒ leaves dueForClaim, no forever-cranking).
 * The navCreditedUsdc watermark is RESERVED (persisted) BEFORE the NAV credit is
 * issued (XCUT-1): a mirror-write failure then aborts the row before any money
 * moves, so a later paid-growth tick can never re-credit an already-credited
 * tranche (no double-pay). A fee-unknown tick defers the credit (netDelta 0) and
 * leaves the row due to back-fill later. Fee is read from PlatformConfig; if that
 * read fails we credit NOTHING this tick (fail-closed, no silent feeBps=0).
 */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const secret = process.env.INTERNAL_CRON_SECRET ?? "";
    if (!CONVEX_URL || !secret) {
      return NextResponse.json({ error: "Claim keeper not configured" }, { status: 500 });
    }

    const crankKey = process.env.VELLO_CRANK_SECRET;
    if (!crankKey) {
      // No crank key → nothing to do. 200 so the cron treats it as a clean no-op.
      return NextResponse.json({ ok: true, skipped: "no crank key" });
    }

    const convex = new ConvexHttpClient(CONVEX_URL);
    const due = (await convex.query(api.submissions.dueForClaim, { authSecret: secret })) as ClaimDue[];

    if (due.length === 0) {
      return NextResponse.json({ ok: true, due: 0, claimed: 0, skipped: 0 });
    }

    const crankKeypair = loadKeypair(crankKey);
    const program = buildServerEscrowProgram(crankKeypair);

    // ORA-4: SOL exhaustion pre-flight. A drained crank key makes EVERY claim_payout
    // fail as a generic revert (indistinguishable from the expected dispute-window /
    // staleness reverts), so a dead key silently loops forever. Read the balance
    // ONCE up front; if it's below the threshold, alert with a DISTINCT reason and
    // skip the whole tick — the due rows are untouched and retry next tick once the
    // key is topped up. A failed balance READ is fail-OPEN (don't strand payouts on
    // a flaky RPC): we log and proceed.
    try {
      const lamports = await program.provider.connection.getBalance(crankKeypair.publicKey);
      const sol = lamports / LAMPORTS_PER_SOL;
      if (sol < MIN_SIGNER_SOL) {
        await sendAlert("signer-low-sol", {
          signer: "crank",
          pubkey: crankKeypair.publicKey.toBase58(),
          balanceSol: sol,
          thresholdSol: MIN_SIGNER_SOL,
          note: "claim keeper skipped this tick — top up VELLO_CRANK_SECRET's wallet",
        });
        console.error(`[oracle.claim] crank signer low on SOL (${sol} < ${MIN_SIGNER_SOL}) — skipping tick, rows retry next tick`);
        return NextResponse.json({ ok: true, due: due.length, claimed: 0, skipped: due.length, reason: "crank signer low on SOL" });
      }
    } catch (err) {
      console.warn("[oracle.claim] SOL balance pre-flight read failed — proceeding (fail-open):", err instanceof Error ? err.message : err);
    }

    // Treasury owner = PlatformConfig.treasury (chain truth). Fall back to the env
    // treasury wallet if the config read fails (e.g. pre-init on a fresh deploy).
    // feeKnown tracks whether the on-chain fee read succeeded: when it FAILED we
    // do NOT silently default feeBps to 0 (that would over-credit NAV by the
    // whole fee). Instead the settlement math fails closed — credits nothing this
    // tick — and a later tick with a successful read back-fills the cumulative net.
    let treasuryOwner: string;
    let feeBps = 0;
    let feeKnown = false;
    try {
      const config = await getPlatformConfig(program);
      treasuryOwner = new PublicKey(config.treasury).toBase58();
      feeBps = Number(config.protocolFeeBps ?? 0);
      feeKnown = true;

      // ORA-5 invariant: the on-chain PlatformConfig.treasury (money truth the
      // program enforces) MUST equal the deploy's env treasury. A divergence means
      // a misconfigured deploy (wrong program/cluster) or a rotated-but-not-updated
      // env — either way the platform is in an ambiguous state around where fees +
      // sweeps land. Fail CLOSED: alert loudly and crank NOTHING this tick rather
      // than move money under the ambiguity. Rows stay due and retry once the
      // mismatch is resolved (env fixed or config rotated).
      const envTreasury = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET?.trim();
      if (envTreasury) {
        let envNorm: string | null = null;
        try {
          envNorm = new PublicKey(envTreasury).toBase58();
        } catch {
          envNorm = null; // unparseable env treasury — treated as a mismatch below
        }
        if (envNorm !== treasuryOwner) {
          await sendAlert("treasury-mismatch", {
            onchainTreasury: treasuryOwner,
            envTreasury,
            note: "PlatformConfig.treasury != NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET — refusing to crank",
          });
          console.error(`[oracle.claim] treasury mismatch: on-chain=${treasuryOwner} env=${envTreasury} — skipping tick`);
          return NextResponse.json({ error: "treasury mismatch", due: due.length, claimed: 0, skipped: due.length }, { status: 500 });
        }
      }
    } catch (err) {
      const envTreasury = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET;
      if (!envTreasury) {
        console.error("[oracle.claim] PlatformConfig read failed and no NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET fallback:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "treasury unresolved" }, { status: 500 });
      }
      treasuryOwner = envTreasury;
      console.warn("[oracle.claim] PlatformConfig read failed — using env treasury fallback; fee UNKNOWN, NAV credit deferred this tick:", err instanceof Error ? err.message : err);
    }

    let claimed = 0;
    let skipped = 0;

    await Promise.allSettled(
      due.map(async (row) => {
        // Can't pay an unknown beneficiary or derive the PDA without the creator.
        if (!row.agentWallet || !row.creatorWallet) {
          console.warn(`[oracle.claim] submission=${row._id} missing ${!row.agentWallet ? "agentWallet" : "creatorWallet"} — skipping`);
          skipped += 1;
          return;
        }

        try {
          const [campaignPda] = getCampaignPda(row.campaignId, row.creatorWallet);
          const [claimPda] = getClaimPda(campaignPda, row._id);

          // Read the current on-chain cumulative `paid` BEFORE deciding to crank.
          let claimRecord = await getClaimRecord(program, claimPda);
          let newPaidUsdc = baseUnitsToUsdc(claimRecord.paid);
          let txSignature: string | undefined;

          // Crank ONLY when the chain still owes money. A row already fully paid
          // on-chain but re-entered dueForClaim (its NAV credit LAGGED on the
          // completing tick) must NOT be cranked: claim_payout would revert owed==0
          // and the catch below would skip it BEFORE the credit retry. Skipping the
          // crank falls straight through to back-fill the lagging NAV credit.
          if (newPaidUsdc < row.payoutAmountUsdc) {
            const res = await claimPayoutTx(
              program,
              row.campaignId,
              row._id,
              row.creatorWallet,
              new PublicKey(row.agentWallet),
              treasuryOwner,
            );
            txSignature = res.txSignature;
            // Re-read the new cumulative paid after the crank confirmed.
            claimRecord = await getClaimRecord(program, claimPda);
            newPaidUsdc = baseUnitsToUsdc(claimRecord.paid);
          }

          // PURE settlement math (lib/server/oracleClaim): gross this tick, the
          // per-tranche NET delta to credit, the new cumulative net, and whether the
          // claim is terminal. On a fully-paid retry tick gross==0 and netDelta =
          // cumulativeNet − the lagging navCreditedUsdc, so the deferred credit
          // back-fills here. Unit-testable without the Solana toolchain.
          const settlement = computeClaimSettlement({
            paidUsdcBefore: row.paidUsdc ?? 0,
            newPaidUsdc,
            payoutAmountUsdc: row.payoutAmountUsdc,
            navCreditedUsdc: row.navCreditedUsdc ?? 0,
            feeBps,
            feeKnown,
          });

          // XCUT-1: RESERVE the navCreditedUsdc watermark BEFORE issuing the
          // irreversible NAV credit. The watermark is what the NEXT tick subtracts
          // to size the next tranche; if we credited first and the mirror write then
          // failed, a later paid-growth tick would recompute a delta against the
          // STALE (too-low) watermark and re-credit the already-paid portion
          // (double-credit). Reserving first means a mirror-write failure aborts the
          // row BEFORE any money moves (fail-closed, retried next tick). The
          // per-tranche key (`${submissionId}:${newNavCreditedUsdc}`) still lets the
          // SAME submission be credited across ticks without collapsing tranches.
          const trancheKey = `${row._id}:${settlement.newNavCreditedUsdc}`;
          let creditOk = true;
          if (settlement.netDeltaToCredit > 0) {
            const outcome = await settleClaimTranche({
              netDeltaToCredit: settlement.netDeltaToCredit,
              // Reserve: commit the watermark + paid mirror FIRST. A throw here
              // propagates to the row catch → skipped → retried next tick with the
              // watermark UNCHANGED (no credit was issued). claimDone is deferred to
              // the finalize write below so a failed credit leaves the row DUE.
              reserve: () =>
                convex
                  .mutation(api.oracle.markPaidOnchain, {
                    authSecret: secret,
                    submissionId: row._id as Id<"submissions">,
                    paidUsdc: newPaidUsdc,
                    ...(txSignature ? { payoutTxSignature: txSignature } : {}),
                    claimPda: claimPda.toBase58(),
                    navCreditedUsdc: settlement.newNavCreditedUsdc,
                  })
                  .then(() => undefined),
              credit: () =>
                scheduleNavCredit({
                  mintAddress: row.influencerMint,
                  payoutUsdc: settlement.netDeltaToCredit,
                  campaignId: row.campaignId,
                  submissionId: row._id,
                  trancheKey,
                  secret,
                }),
            });
            creditOk = outcome.credited;
            if (outcome.stranded) {
              // Reserve committed but the credit failed: the USDC already reached the
              // agent ATA on-chain, only the NAV bookkeeping lags (under-credit,
              // fail-closed). Surface it — this needs an ops re-drive; it will NOT
              // self-heal because the watermark is already reserved (no overpay).
              console.error(`[oracle.claim] NAV credit STRANDED submission=${row._id} tranche=${trancheKey} — reserved but credit failed`);
              await sendAlert("nav-credit-failed", {
                submissionId: row._id,
                campaignId: row.campaignId,
                trancheKey,
                netUsdc: settlement.netDeltaToCredit,
                note: "on-chain paid landed + watermark reserved, but the NAV credit HTTP failed (under-credit, needs re-drive)",
              });
            }
          }

          // Hold the row OPEN (not terminal) when the credit didn't land OR the
          // fee was unknown this tick. A fee-unknown tick deferred the NAV credit
          // (netDelta forced to 0) — the row must stay in dueForClaim so a later
          // tick with a successful PlatformConfig read back-fills the cumulative
          // net against the lagging navCreditedUsdc. Only a fully-credited, fee-
          // known, terminal settlement actually exits the claim set.
          const fullyCredited = creditOk && feeKnown;
          const claimDone = settlement.claimDone && fullyCredited;

          // FINALIZE: advance paid + the terminal flag. When we credited (or had
          // nothing to credit) also (re)affirm the cumulative net; on a strand we
          // OMIT navCreditedUsdc (already reserved above) and leave claimDone false
          // so the row stays due. This write failing is now HARMLESS — the watermark
          // was already committed by the reserve, so no later tick can double-credit.
          await convex.mutation(api.oracle.markPaidOnchain, {
            authSecret: secret,
            submissionId: row._id as Id<"submissions">,
            paidUsdc: newPaidUsdc,
            // No new crank this tick (pure credit-retry) → omit, keep the prior sig.
            ...(txSignature ? { payoutTxSignature: txSignature } : {}),
            claimPda: claimPda.toBase58(),
            claimDone,
            ...(creditOk ? { navCreditedUsdc: settlement.newNavCreditedUsdc } : {}),
          });
          claimed += 1;
        } catch (err) {
          // Expected reverts: InDisputeWindow / AttestationStale / owed==0 (already
          // fully paid). These are NORMAL — the chain is idempotent, retry next tick.
          console.warn(`[oracle.claim] claim_payout submission=${row._id} reverted/failed (retries next tick):`, err instanceof Error ? err.message : err);
          skipped += 1;
        }
      }),
    );

    // ORA-3: surface a non-trivial backlog. Occasional skips are EXPECTED (dispute
    // window / staleness reverts retry next tick); a large or total skip is not —
    // it usually means a systemic on-chain failure (missing ATA, bad config, dead
    // key) worth a human's eyes. Alerting is best-effort and never breaks the tick.
    if (skipped >= CLAIM_BACKLOG_ALERT || (due.length > 0 && claimed === 0 && skipped > 0)) {
      await sendAlert("claim-backlog", { due: due.length, claimed, skipped }).catch(() => {});
    }

    return NextResponse.json({ ok: true, due: due.length, claimed, skipped });
  } catch (err) {
    console.error("[oracle.claim]", err);
    await sendAlert("claim-keeper-error", { message: err instanceof Error ? err.message : String(err) }).catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "Claim keeper failed" }, { status: 500 });
  }
}

/** POST this tranche's NET payout to the existing distribute-earnings route,
 *  which credits the agent vault NAV. Returns true ONLY when the credit landed
 *  (2xx) — the caller advances the persisted navCreditedUsdc / claimDone only on
 *  true, so a failure leaves the row due for an automatic retry next tick.
 *
 *  `trancheKey` (`${submissionId}:${cumulativeNet}`) is the PER-TRANCHE
 *  idempotency key. distribute-earnings de-dupes on it so the SAME submission can
 *  be credited across multiple claim ticks (multi-tranche payout) without the
 *  bare-submissionId guard collapsing tranches 2..n into a no-op, while a true
 *  re-crank of the SAME tranche stays a clean no-op. */
async function scheduleNavCredit(args: {
  mintAddress: string;
  payoutUsdc: number;
  campaignId: string;
  submissionId: string;
  trancheKey: string;
  secret: string;
}): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${baseUrl}/api/agents/distribute-earnings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": args.secret },
      body: JSON.stringify({
        mintAddress: args.mintAddress,
        payoutUsdc: args.payoutUsdc,
        campaignId: args.campaignId,
        submissionId: args.submissionId,
        trancheKey: args.trancheKey,
      }),
    });
    if (!res.ok) {
      console.error(`[oracle.claim] NAV credit submission=${args.submissionId} tranche=${args.trancheKey} HTTP ${res.status} — deferring (retries next tick)`);
      return false;
    }
    return true;
  } catch (e) {
    // Transient failure: navCreditedUsdc was NOT advanced, so the next tick
    // recomputes the SAME delta and retries — self-healing without double-credit.
    console.error(`[oracle.claim] NAV credit dispatch failed submission=${args.submissionId} tranche=${args.trancheKey} (retries next tick):`, e instanceof Error ? e.message : e);
    return false;
  }
}
