import { mutation, query, internalMutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { spendableUsdc } from "../lib/economy/nav";
import { priceForWithOverride } from "../lib/economy/servicePrices";
import { discountedCost } from "../lib/tokenomics/platformToken";
import { getSkillPriceOverride } from "./adminPricing";
import { ensureAgentAccount } from "./agentAccount";
import { buildInflight, isClaimable, isInflight, isPaidSig, parseInflight } from "../lib/economy/settlementSentinel";
import { GRACE_MS, LEASE_MS } from "../lib/economy/constants";
import { getOwnerWalletForMint } from "./userCredits";

// Per-call read bounds so an agent's lifetime ledger / settlement history can
// never blow Convex's per-query read limit as the tables grow unbounded.
const SETTLE_TAB_MAX_ROWS = 4000;        // unsettled tail swept per settleTab call
const STRANDED_SCAN_CAP = 1000;          // unpaid candidates scanned per keeper tick
// serviceSpendQuery sums both ledgers in one transaction, so these caps must stay
// well under Convex's ~16384-doc read limit combined. They exceed any real agent's
// row counts, so normal-case totals are exact; only a pathologically large history
// is bounded (the Earnings card renders a slightly low total instead of crashing).
const SPEND_LEDGER_MAX_ROWS = 10000;     // usageLedger rows summed for lifetime spend
const SPEND_SETTLEMENT_MAX_ROWS = 5000;  // feeSettlements rows summed for settled/pending

/** `settledBatchId` sentinel stamped on a usageLedger row paid from the OWNER'S
 *  prepaid credit balance. Such a row carries its REAL costUsdc (so caps,
 *  analytics and refunds see accurate spend) but never rode the agent's
 *  `unsettledTabUsdc` — the sentinel keeps it out of settleTab's unsettled tail
 *  (it must never be swept escrow→treasury) and out of economyReconcile's
 *  tab-drift sum (which compares Σ unsettled costUsdc against the tab). */
export const CREDITS_SETTLED_SENTINEL = "credits";

/** Accrue an arbitrary task cost onto the agent's unsettled tab. Unlike
 *  `recordUsage` (which hard-denies when spendable < cost), this ALWAYS records
 *  the spend — a task already executed, so the cost is real — and flips the
 *  account to `needs_funding` if it pushes spendable negative. Shared by
 *  agentTasks.succeed/fail so every task path debits the (realtime) tab from one
 *  chokepoint. The escrow mirror is reconciled to on-chain separately before the
 *  on-chain sweep, so the spendable gate elsewhere still reflects real funds. */
export async function accrueTaskCost(
  ctx: MutationCtx,
  { mintAddress, service, costUsdc, idemKey, payerWallet, fundingSource }: { mintAddress: string; service: string; costUsdc: number; idemKey?: string; payerWallet?: string; fundingSource?: string },
) {
  const cost = +Number(costUsdc).toFixed(6);
  if (!(cost > 0)) return;
  await ensureAgentAccount(ctx, mintAddress); // old agents may predate auto-genesis
  const account = await ctx.db
    .query("agentAccount")
    .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
    .unique();
  if (!account) return;
  if (account.status === "suspended") return;

  // Idempotency: a duplicate task-completion (double-clicked approve-trade, cron
  // re-fire) must not accrue the fee twice. Unlike recordUsage, accrueTaskCost
  // ALWAYS records (the task ran), so without this guard a re-fire double-charges
  // the agent and settleTab sweeps the doubled amount to the treasury.
  if (idemKey) {
    const prior = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint_idem", (q) => q.eq("mintAddress", mintAddress).eq("idemKey", idemKey))
      .first();
    if (prior) return;
  }

  const now = Date.now();

  // CREDITS-FIRST (same policy as recordUsage): when the agent's owning
  // wallet holds a userCredits balance covering this cost, spend that — the
  // agent wallet exists to RECEIVE money (campaign payouts), not to fund
  // renders. This was the gap that kept draining agent tabs for video
  // generations (agentTasks.succeed bills through HERE, not recordUsage),
  // so a credit-funded operator still hit needs_funding once the tab ran dry.
  // Candidate payers, tried in order: the SIWS-proven login wallet run-task
  // injected on the task (the balance the header badge shows), then the
  // agent's creatorWallet. First one whose balance covers the cost pays.
  const ownerWallet = await getOwnerWalletForMint(ctx, mintAddress);
  const payerCandidates = [...new Set([payerWallet, ownerWallet].filter((w): w is string => !!w))];
  const costCredits = Math.round(cost * 100);
  // `agent_wallet`: the run was funded from the agent's own wallet (run-task checked it covers the cost), so the
  // cost rides the agent tab and is swept from that wallet, and prepaid credits are left alone.
  const influencer = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", mintAddress)).first();
  if (costCredits > 0 && fundingSource !== "agent_wallet" && influencer?.generationFunding !== "agent_wallet" && !influencer?.solstarCharacterId) {
    for (const candidate of payerCandidates) {
      const ledgerId = await ctx.db.insert("usageLedger", {
        mintAddress,
        service,
        qty: 1,
        unitPriceUsdc: cost,
        costUsdc: cost,
        paidWith: "credits" as const,
        // Sentinel: keeps the row OUT of settleTab's unsettled tail — a
        // credits-paid fee never rode the agent's tab, so it must never be
        // swept on-chain. (Same convention as recordUsage's credits path.)
        settledBatchId: CREDITS_SETTLED_SENTINEL,
        ...(idemKey ? { idemKey } : {}),
        at: now,
      });
      const debitRes: { ok: boolean; balanceCredits: number } = await ctx.runMutation(internal.userCredits.debit, {
        ownerWallet: candidate,
        deltaCredits: costCredits,
        relatedMintAddress: mintAddress,
        relatedUsageLedgerId: ledgerId,
      });
      if (debitRes.ok) return;
      await ctx.db.delete(ledgerId); // this balance couldn't cover it — try the next payer / the agent tab
    }
  }

  await ctx.db.insert("usageLedger", {
    mintAddress,
    service,
    qty: 1,
    unitPriceUsdc: cost,
    costUsdc: cost,
    ...(idemKey ? { idemKey } : {}),
    at: now,
  });
  const unsettledTabUsdc = +(account.unsettledTabUsdc + cost).toFixed(6);
  const underwater = spendableUsdc({ ...account, unsettledTabUsdc }) <= 0;
  await ctx.db.patch(account._id, {
    unsettledTabUsdc,
    status: underwater ? "needs_funding" : "active",
    updatedAt: now,
  });
}

/** Meter a paid service: gate on spendable ≥ cost, else flag needs_funding and
 *  deny. On success append a usage row and add to the unsettled tab. Spec §6.1/§7.
 *  SECURITY: public mutation; before mainnet move behind a verified entry point (spec §11). */
/** Draft (unminted) free tier: count a run against `draft:<sessionId>` with a
 *  $0 usageLedger row — counting + audit with no new table. The cap itself is
 *  enforced by the caller (clip-precheck) via freeRunsToday. */
export const countFreeRun = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    // Check + count atomically (mutations are serializable transactions) so
    // two simultaneous runs can't both slip under the cap.
    const dayStart = new Date().setUTCHours(0, 0, 0, 0);
    const rows = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint_at", (q) => q.eq("mintAddress", `draft:${sessionId}`).gte("at", dayStart))
      .collect();
    const capRuns = Number(process.env.VELLO_FREE_RUNS_PER_DAY ?? "3");
    if (rows.length >= capRuns) {
      return { ok: false as const, reason: "free_tier_limit" as const, runsToday: rows.length, capRuns };
    }
    await ctx.db.insert("usageLedger", {
      mintAddress: `draft:${sessionId}`,
      service: "free_clip_run",
      qty: 1,
      unitPriceUsdc: 0,
      costUsdc: 0,
      at: Date.now(),
    });
    return { ok: true as const, runsToday: rows.length + 1, capRuns };
  },
});

/** Did clip-precheck already charge ANY priced skill for this run? A prior
 *  `${runId}:skill:*` usageLedger row proves the run went through the precheck
 *  charge chokepoint. The /api/video/clip render backstop (#23) uses this to
 *  distinguish a documented run-start under-charge (a skill precheck cleanly
 *  denied on a daily-cap race — proceed, agent's favor) from a direct
 *  billing-less caller that skipped precheck entirely (the exploit — block).
 *  Read-only, non-sensitive. Scans a 48h window (NOT the UTC day) so a run whose
 *  precheck and render straddle UTC midnight still finds its own proof — a
 *  day-scoped bound would drop it and 402 the run to zero clips after taking the
 *  precheck fees. A run completes in minutes-to-~1h, so 48h is ample and bounded. */
const RUN_PROOF_LOOKBACK_MS = 48 * 60 * 60 * 1000;
export const hasRunSkillCharge = query({
  args: { mintAddress: v.string(), runId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, { mintAddress, runId, nowMs }) => {
    if (!runId) return false;
    const since = (nowMs ?? Date.now()) - RUN_PROOF_LOOKBACK_MS;
    const prefix = `${runId}:skill:`;
    const rows = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint_at", (q) => q.eq("mintAddress", mintAddress).gte("at", since))
      .collect();
    return rows.some((r) => typeof r.idemKey === "string" && r.idemKey.startsWith(prefix));
  },
});

export const freeRunsToday = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const dayStart = new Date().setUTCHours(0, 0, 0, 0);
    const rows = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint_at", (q) => q.eq("mintAddress", `draft:${sessionId}`).gte("at", dayStart))
      .collect();
    const cap = Number(process.env.VELLO_FREE_RUNS_PER_DAY ?? "3");
    return { runsToday: rows.length, capRuns: cap };
  },
});

/** Public read of today's spend + the active cap — the clip-precheck route
 *  uses it to show daily headroom before a run starts. */
export const todaysSpendQuery = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const dayStart = new Date().setUTCHours(0, 0, 0, 0);
    const rows = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint_at", (q) => q.eq("mintAddress", mintAddress).gte("at", dayStart))
      .collect();
    const spentTodayUsdc = +rows.reduce((s, u) => s + u.costUsdc, 0).toFixed(6);
    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    const capUsdc = typeof account?.dailyCapUsdc === "number"
      ? account.dailyCapUsdc
      : Number(process.env.VELLO_DAILY_SPEND_CAP_USDC ?? "10");
    return { spentTodayUsdc, capUsdc };
  },
});

/** Lifetime service spend for an agent (clips + tasks all meter into usageLedger).
 *  totalSpentUsdc = every metered fee; settledToTreasuryUsdc = the portion already
 *  swept on-chain to the platform treasury (feeSettlements); unsettledTabUsdc = the
 *  accrued-but-not-yet-swept tail. Drives the Earnings card's Spent / Available. */
export const serviceSpendQuery = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const rows = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .take(SPEND_LEDGER_MAX_ROWS);
    const totalSpentUsdc = +rows.reduce((s, u) => s + u.costUsdc, 0).toFixed(6);
    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    const unsettledTabUsdc = +Math.max(0, account?.unsettledTabUsdc ?? 0).toFixed(6);
    const settlements = await ctx.db
      .query("feeSettlements")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .take(SPEND_SETTLEMENT_MAX_ROWS);
    // A settlement is PAID once it carries a real on-chain signature; treat a
    // non-empty txSignature that is NOT the `INFLIGHT:<token>:<expiry>` sentinel
    // as paid (swept to treasury), and undefined/null OR an INFLIGHT-prefixed
    // value as still-pending (booked but not yet swept).
    const settledToTreasuryUsdc = +settlements.filter((f) => isPaidSig(f.txSignature)).reduce((s, f) => s + f.amountUsdc, 0).toFixed(6);
    const pendingSettlementUsdc = +settlements.filter((f) => !isPaidSig(f.txSignature)).reduce((s, f) => s + f.amountUsdc, 0).toFixed(6);
    return { totalSpentUsdc, unsettledTabUsdc, settledToTreasuryUsdc, pendingSettlementUsdc };
  },
});

/** Set this agent's daily spend cap (USDC). undefined → use the env default;
 *  0 → no limit. Secret-gated: callers reach it through /api/economy/set-cap,
 *  which authenticates the operator (Privy) + ownership-scopes the mint before
 *  forwarding the internal secret. */
export const setDailyCap = mutation({
  args: { mintAddress: v.string(), capUsdc: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { mintAddress, capUsdc, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    await ensureAgentAccount(ctx, mintAddress);
    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) return { ok: false as const };
    const clean = typeof capUsdc === "number" && Number.isFinite(capUsdc) ? Math.max(0, capUsdc) : undefined;
    await ctx.db.patch(account._id, { dailyCapUsdc: clean });
    return { ok: true as const, dailyCapUsdc: clean };
  },
});

/** Sum of today's (UTC) usage for the mint — backs the daily spend cap. */
export async function todaysSpend(ctx: MutationCtx, mintAddress: string): Promise<number> {
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const rows = await ctx.db
    .query("usageLedger")
    .withIndex("by_mint_at", (q) => q.eq("mintAddress", mintAddress).gte("at", dayStart))
    .collect();
  return +rows.reduce((s, u) => s + u.costUsdc, 0).toFixed(6);
}

export const recordUsage = mutation({
  args: { mintAddress: v.string(), service: v.string(), qty: v.number(), idemKey: v.optional(v.string()), walletOnly: v.optional(v.boolean()), requireTransfer: v.optional(v.boolean()), reservationTaskId: v.optional(v.id("agentTasks")), holderDiscountPct: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { mintAddress, service, qty, idemKey, walletOnly, requireTransfer, reservationTaskId, holderDiscountPct, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    // Consult the admin price override (skillPriceOverrides) at charge time — this
    // is THE money chokepoint every charge path routes through, so an admin-set
    // price flows to canvas clip-precheck, cloud clipJobs, and the autoClip scout
    // fee alike. Absent/invalid override → the static default (priceFor semantics).
    const override = await getSkillPriceOverride(ctx, service);
    // SOLCAMEO holder discount: supplied by the server after it read the owner wallet's on-chain balance, and clamped here so a
    // bad caller can never push the price below the top tier's discount.
    const cost = discountedCost(priceForWithOverride(service, qty, override), holderDiscountPct ?? 0);
    // Idempotency check happens once, up front, so it's shared by both the
    // credits path and the agentAccount fallback below — a retried step must
    // not be billed twice regardless of which balance paid for it originally.
    if (idemKey) {
      const priorLedger = await ctx.db
        .query("usageLedger")
        .withIndex("by_mint_idem", (q) => q.eq("mintAddress", mintAddress).eq("idemKey", idemKey))
        .first();
      if (priorLedger) {
        // A reservation is not payment proof. In particular, failed runs retain
        // their idempotency row after refunding; replaying it must not unlock work.
        const batch = priorLedger.settledBatchId;
        if (priorLedger.costUsdc <= 0 || batch?.startsWith("refund:")) {
          return { ok: false as const, reason: "charge_refunded" as const };
        }
        let paymentConfirmed = !requireTransfer && (batch === CREDITS_SETTLED_SENTINEL || !!batch?.startsWith("refund-credit:"));
        if (batch && !paymentConfirmed) {
          const settlementId = ctx.db.normalizeId("feeSettlements", batch);
          const settlement = settlementId ? await ctx.db.get(settlementId) : null;
          paymentConfirmed = !!settlement?.paid && isPaidSig(settlement.txSignature);
          if (!paymentConfirmed) return { ok: false as const, reason: "payment_pending" as const };
        }
        const acctForDup = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).unique();
        return { ok: true as const, costUsdc: priorLedger.costUsdc, unsettledTabUsdc: acctForDup?.unsettledTabUsdc ?? 0, duplicate: true as const, paymentConfirmed };
      }
    }

    // Load the account UP FRONT: the suspension + daily-cap gates below must run
    // BEFORE either payment path, not only on the USDC fallback. (Previously the
    // credits branch returned before both, so a suspended agent kept running and
    // credit spend never counted against the cap.) The account may legitimately
    // be missing for a credit-funded agent, so this is nullable here; the USDC
    // fallback below still throws when it needs one.
    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    // A suspended agent's charge is a DENIAL, not a throw: callers gate on
    // `ok:false` to deny work. Throwing here was swallowed by best-effort
    // callers → the agent got free work. Return so the caller blocks the run.
    // Applies to CREDIT-funded work too — suspension is about the agent, not
    // about which wallet is paying.
    if (account?.status === "suspended") return { ok: false as const, reason: "suspended" as const };

    const now = Date.now();
    // Per-agent daily spend cap (Convex env; devnet guardrail — a bug or an
    // attacker can't run the tab up unbounded). Denial does NOT flip
    // needs_funding: the account may be perfectly funded, just rate-capped.
    // Per-agent cap overrides the global env default; 0 = no limit.
    // Enforced ahead of BOTH payment paths, and `todaysSpend` sums the REAL
    // costUsdc that credits-paid rows now carry, so a credit-funded agent is
    // capped exactly like a USDC-funded one.
    const cap = typeof account?.dailyCapUsdc === "number"
      ? account.dailyCapUsdc
      : Number(process.env.VELLO_DAILY_SPEND_CAP_USDC ?? "10");
    if (Number.isFinite(cap) && cap > 0) {
      const spentToday = await todaysSpend(ctx, mintAddress);
      if (spentToday + cost > cap) {
        return { ok: false as const, reason: "daily_cap" as const, costUsdc: cost, capUsdc: cap, spentTodayUsdc: spentToday };
      }
    }

    // Credits-first: if the agent's owning wallet has a userCredits balance
    // covering this cost, charge that instead of the agent's own USDC. This is
    // the primary path for credit-funded users; agents with no owning wallet
    // (investor-funded) or an exhausted balance fall through to agentAccount
    // exactly as before.
    const ownerWallet = await getOwnerWalletForMint(ctx, mintAddress);
    const influencer = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", mintAddress)).first();
    if (ownerWallet && !walletOnly && !requireTransfer && influencer?.generationFunding !== "agent_wallet" && !influencer?.solstarCharacterId) {
      const costCredits = Math.round(cost * 100);
      // A cost under $0.005 rounds to 0 credits — userCredits.debit throws on a
      // non-positive delta, and an uncaught throw here would abort the whole
      // mutation instead of falling through to agentAccount. Skip the credits
      // attempt entirely for a zero-credit charge; agentAccount still bills it.
      if (costCredits > 0) {
        // Insert the usage row FIRST so its id can be threaded into the credit
        // ledger entry (`relatedUsageLedgerId`) — that link is what lets the
        // Billing page show WHICH service a credit spend paid for. Both writes
        // are in the same serializable transaction, and the row is deleted
        // again if the debit can't be covered, so a denied debit leaves nothing
        // behind and the agentAccount fallback bills normally.
        const ledgerId = await ctx.db.insert("usageLedger", {
          mintAddress,
          service,
          qty,
          unitPriceUsdc: cost / qty,
          // REAL cost — never 0. Analytics, the daily cap, reconcile and the
          // refund path all read costUsdc as ground truth; `paidWith` (not a
          // zeroed cost) is what records that credits, and not the agent's
          // USDC tab, funded it.
          costUsdc: cost,
          paidWith: "credits" as const,
          // Sentinel: keeps the row OUT of settleTab's unsettled tail and out of
          // economyReconcile's tab-drift sum. A credits-paid fee never rode the
          // agent's `unsettledTabUsdc`, so it must never be swept on-chain.
          settledBatchId: CREDITS_SETTLED_SENTINEL,
          ...(idemKey ? { idemKey } : {}),
          at: now,
        });
        const debitRes: { ok: boolean; balanceCredits: number } = await ctx.runMutation(internal.userCredits.debit, {
          ownerWallet,
          deltaCredits: costCredits,
          relatedMintAddress: mintAddress,
          relatedUsageLedgerId: ledgerId,
        });
        if (debitRes.ok) {
          return {
            ok: true as const,
            costUsdc: cost,
            unsettledTabUsdc: account?.unsettledTabUsdc ?? 0,
            paidWithCredits: true as const,
          };
        }
        await ctx.db.delete(ledgerId); // balance couldn't cover it — fall through unbilled
      }
    }

    if (walletOnly || influencer?.generationFunding === "agent_wallet" || influencer?.solstarCharacterId) {
      const withdrawal = await ctx.db.query("agentWithdrawals").withIndex("by_mint_status", q => q.eq("mintAddress", mintAddress).eq("status", "pending")).first();
      if (withdrawal) return { ok: false as const, reason: "wallet_busy" as const, costUsdc: cost };
    }
    if (!account) throw new Error("no agentAccount for mint");
    // Gate: insufficient funds is a DENIAL (not an error) — flag needs_funding so
    // autonomy pauses + the builder/investors are notified. Returned, not thrown,
    // so the status patch commits (a thrown mutation rolls back all writes).
    const reservation = reservationTaskId ? await ctx.db.get(reservationTaskId) : null;
    if (reservationTaskId && (!reservation || reservation.mintAddress !== mintAddress || !["pending", "running"].includes(reservation.status) || !reservation.walletHold || reservation.walletHold.settled)) {
      return { ok: false as const, reason: "invalid_reservation" as const };
    }
    const ownHold = reservation?.walletHold?.amountUsdc ?? 0;
    const available = spendableUsdc({ ...account, unsettledTabUsdc: requireTransfer ? Math.max(0, account.unsettledTabUsdc) : account.unsettledTabUsdc, generationReservedUsdc: Math.max(0, (account.generationReservedUsdc ?? 0) - ownHold) });
    if (available < cost) {
      await ctx.db.patch(account._id, { status: "needs_funding", updatedAt: now });
      return { ok: false as const, reason: "needs_funding" as const, costUsdc: cost };
    }
    await ctx.db.insert("usageLedger", {
      mintAddress,
      service,
      qty,
      unitPriceUsdc: cost / qty,
      costUsdc: cost,
      paidWith: "agent_account" as const,
      ...(idemKey ? { idemKey } : {}),
      at: now,
    });
    await ctx.db.patch(account._id, {
      unsettledTabUsdc: account.unsettledTabUsdc + cost,
      ...(reservation ? { generationReservedUsdc: Math.max(0, (account.generationReservedUsdc ?? 0) - ownHold) } : {}),
      status: "active",
      updatedAt: now,
    });
    if (reservation?.walletHold) await ctx.db.patch(reservation._id, { walletHold: { ...reservation.walletHold, settled: true } });
    return { ok: true as const, costUsdc: cost, unsettledTabUsdc: account.unsettledTabUsdc + cost };
  },
});

/** REFUND the per-skill run fees a clip job charged up-front, for a run that
 *  delivered NOTHING (0 successful clips — the CALLER checks that predicate before
 *  invoking this; see clipJobs.refundRunFeesIfNoClips). A funding GATE charges each
 *  wired skill up-front so a broke/daily-capped agent can't START a run, but a run
 *  that produces zero clips must not keep the money. This reverses `recordUsage`
 *  for the run's `${jobId}:skill:*` charges — a 0-clip run ends charged $0 for them,
 *  INCLUDING any the HOURLY settle cron already swept off the tab mid-run (C12).
 *
 *  It scans the run's `${jobId}:skill:*` charges in the bounded 48h charge→refund
 *  window (a run charges then fails within ~1h; the reaper's outer bound is ~20min —
 *  the SAME lookback hasRunSkillCharge uses) and splits them by whether the settle
 *  cron already moved them off the tab:
 *
 *   - STILL-UNSETTLED skill fees (settledBatchId === undefined) — the common case:
 *     VOID in place. Stamp settledBatchId with a `refund:<jobId>` sentinel (removes
 *     the row from settleTab's unsettled-tail scan so it is never swept) and zero
 *     costUsdc/unitPriceUsdc (drops it from the DERIVED daily-spend + lifetime-spend
 *     sums). The row is KEPT (audit marker + the precheck proof hasRunSkillCharge
 *     relies on — its idemKey is untouched). The unsettled tab is credited back by
 *     the exact voided sum (clamped ≥ 0): a voided row leaves the `!settledBatchId`
 *     sum by its old cost and the tab drops by that same sum, so the tab-drift
 *     invariant (Σ unsettled usageLedger costUsdc === unsettledTabUsdc) holds.
 *
 *   - ALREADY-SWEPT skill fees (settledBatchId is a real settlement id) — the run
 *     straddled the hourly boundary and the settle cron booked these onto a
 *     feeSettlements row and moved them OFF the tab. They are NOT in the unsettled
 *     sum, so voiding + tab-crediting them would BREAK the tab-drift invariant.
 *     Instead book ONE idempotent compensating CREDIT: a NEGATIVE, still-unsettled
 *     usageLedger row keyed `${jobId}:refund-credit`, and reduce the tab by the same
 *     sum. The settlement row is LEFT INTACT (the treasury still collects it
 *     on-chain via debit_fee — never a race with the sweep, never coversUsageIds
 *     surgery on a settlement that may cover OTHER jobs); the credit simply defers/
 *     claws that revenue back off the agent's NEXT fees. Net across every sweep
 *     timing: the agent's spendable/NAV returns to pre-run (the unpaid-settlement
 *     hold-out and the credit cancel; once the sweep lands the lowered vault balance
 *     and the credit cancel). Fail-closed toward the AGENT — the credit equals
 *     exactly the swept sum (never more) and only defers TREASURY revenue.
 *
 *  IDEMPOTENT + money-safe: a second call re-voids nothing (unsettled rows now carry
 *  the refund sentinel + cost 0) and skips the credit (the `${jobId}:refund-credit`
 *  row already exists) → no-op; a never-charged job → no-op. It only touches rows
 *  THIS job charged. Secret-gated at the public wrapper; the tx body is a shared
 *  helper so the reaper (a mutation) can call it directly without a runMutation hop. */
export async function refundRunFeesTx(
  ctx: MutationCtx,
  { mintAddress, jobId }: { mintAddress: string; jobId: string },
): Promise<{ refundedUsdc: number; count: number }> {
  const prefix = `${jobId}:skill:`;
  const creditIdem = `${jobId}:refund-credit`;
  const now = Date.now();
  const marker = `refund:${jobId}`;

  // Read this run's skill charges (settled OR unsettled) in the bounded 48h window.
  // We MUST see the settled ones too: if the hourly settle fired mid-run it stamped
  // them with a settledBatchId, so the old unsettled-tail-only scan missed them and
  // a 0-clip run stayed charged for fees it never earned (C12). A row already voided
  // by a prior refund has costUsdc 0 (excluded by costUsdc>0 below).
  const since = now - RUN_PROOF_LOOKBACK_MS;
  const rows = await ctx.db
    .query("usageLedger")
    .withIndex("by_mint_at", (q) => q.eq("mintAddress", mintAddress).gte("at", since))
    .collect();
  const mine = rows.filter(
    (u) => u.costUsdc > 0 && typeof u.idemKey === "string" && u.idemKey.startsWith(prefix),
  );
  if (mine.length === 0) return { refundedUsdc: 0, count: 0 };

  // (0) CREDITS-PAID skill fees → refund the owner's CREDIT balance, never the
  // agent's USDC tab (they were never charged there). These rows carry a real
  // costUsdc — that is what makes them visible to the `costUsdc > 0` filter
  // above at all — plus the `credits` sentinel in settledBatchId, so they must
  // be split out BEFORE the settled/unsettled buckets below (the sentinel is not
  // a settlement id, and crediting the tab for them would invent money).
  const creditPaid = mine.filter((u) => u.paidWith === "credits");
  const usdcPaid = mine.filter((u) => u.paidWith !== "credits");
  let creditRefundUsdc = 0;
  if (creditPaid.length > 0) {
    const ownerWallet = await getOwnerWalletForMint(ctx, mintAddress);
    const creditsToRefund = creditPaid.reduce((s, u) => s + Math.round(u.costUsdc * 100), 0);
    // Void the rows in place FIRST (mirrors the unsettled-void semantics: the
    // audit row + its idemKey stay, cost drops to 0) — that also makes a second
    // refund call a no-op, since the `costUsdc > 0` filter then skips them.
    for (const u of creditPaid) {
      await ctx.db.patch(u._id, { settledBatchId: marker, costUsdc: 0, unitPriceUsdc: 0 });
    }
    if (ownerWallet && creditsToRefund > 0) {
      await ctx.runMutation(internal.userCredits.credit, {
        ownerWallet,
        deltaCredits: creditsToRefund,
        kind: "refund" as const,
        relatedMintAddress: mintAddress,
      });
      creditRefundUsdc = +(creditsToRefund / 100).toFixed(6);
    }
  }

  const unsettled = usdcPaid.filter((u) => u.settledBatchId === undefined);
  const settled = usdcPaid.filter((u) => u.settledBatchId !== undefined); // a real settlement id

  // (1) Still-unsettled skill fees → VOID in place + credit the tab back.
  const unsettledRefund = +unsettled.reduce((s, u) => s + u.costUsdc, 0).toFixed(6);
  for (const u of unsettled) {
    await ctx.db.patch(u._id, { settledBatchId: marker, costUsdc: 0, unitPriceUsdc: 0 });
  }

  // (2) Already-swept skill fees → ONE idempotent compensating credit (negative,
  // still-unsettled row) so the tab-drift invariant survives and the agent is made
  // whole regardless of the on-chain sweep's timing.
  let settledRefund = 0;
  if (settled.length > 0) {
    const priorCredit = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint_idem", (q) => q.eq("mintAddress", mintAddress).eq("idemKey", creditIdem))
      .first();
    if (!priorCredit) {
      settledRefund = +settled.reduce((s, u) => s + u.costUsdc, 0).toFixed(6);
      if (settledRefund > 0) {
        await ctx.db.insert("usageLedger", {
          mintAddress,
          service: "clip_refund_credit",
          qty: 1,
          unitPriceUsdc: -settledRefund,
          costUsdc: -settledRefund,
          idemKey: creditIdem,
          at: now,
        });
      }
    }
  }

  const refundedUsdc = +(unsettledRefund + settledRefund + creditRefundUsdc).toFixed(6);
  const count = creditPaid.length + unsettled.length + (settledRefund > 0 ? settled.length : 0);
  if (refundedUsdc === 0) return { refundedUsdc: 0, count }; // nothing new (e.g. already-credited re-fire)
  // Credits-only refund: the agent's USDC tab was never touched by these fees,
  // so leave `unsettledTabUsdc` alone (invariant: only agent_account-path
  // charges may ever move the tab).
  if (unsettledRefund === 0 && settledRefund === 0) return { refundedUsdc, count };

  const account = await ctx.db
    .query("agentAccount")
    .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
    .unique();
  if (account) {
    // Voids can only pull the tab toward 0 (they were on it — clamp ≥ 0). The
    // compensating credit is a genuine negative offset that MAY drive the tab below
    // 0 (it reduces the agent's NEXT settle) — that is the intended refund, so it is
    // applied WITHOUT the clamp.
    const afterVoids = Math.max(0, account.unsettledTabUsdc - unsettledRefund);
    const nextTab = +(afterVoids - settledRefund).toFixed(6);
    await ctx.db.patch(account._id, { unsettledTabUsdc: nextTab, updatedAt: now });
  }
  return { refundedUsdc, count };
}

/** Secret-gated public wrapper so the clip actions (clipJobs.process / finalizeJob)
 *  can void a failed run's fees via ctx.runMutation. See refundRunFeesTx. */
export const refundRunFees = mutation({
  args: { mintAddress: v.string(), jobId: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, jobId, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    return await refundRunFeesTx(ctx, { mintAddress, jobId });
  },
});

/** Batch-settle the accrued tab: escrow → treasury accounting. Collects all
 *  unsettled usageLedger rows for the mint, inserts a feeSettlements record,
 *  stamps each row with the settlement id, and deducts from the account balances.
 *  Returns { settled: false } when there is nothing to sweep. Spec §7. */
export const settleTab = mutation({
  args: { mintAddress: v.string(), requireTransfer: v.optional(v.boolean()), authSecret: v.string() },
  handler: async (ctx, { mintAddress, requireTransfer, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) throw new Error("no agentAccount for mint");

    // Read ONLY the unsettled tail via the by_mint_settled index (settledBatchId
    // undefined) instead of collecting the agent's whole lifetime ledger. Bounded
    // so an unexpectedly large tail settles in batches over successive ticks (the
    // account tab stays positive, so the hourly cron re-fires until it drains).
    const tail = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint_settled", (q) => q.eq("mintAddress", mintAddress).eq("settledBatchId", undefined))
      .take(SETTLE_TAB_MAX_ROWS);
    const unsettled = requireTransfer ? tail.filter(row => row.costUsdc > 0) : tail;

    const amount = +unsettled.reduce((s, u) => s + u.costUsdc, 0).toFixed(6);
    if (amount <= 0) {
      const coveredUsdc = +unsettled.reduce((sum, row) => sum + Math.max(0, row.costUsdc), 0).toFixed(6);
      if (coveredUsdc <= 0) return { settled: false as const };
      // Atomically consume refund credits. Preserve the audit rows and carry
      // unused credit forward, so the same credit cannot fund another run twice.
      const now = Date.now();
      const marker = `refund-credit:${unsettled.find((row) => row.costUsdc > 0)!._id}`;
      for (const row of unsettled) await ctx.db.patch(row._id, { settledBatchId: marker });
      if (amount < 0) await ctx.db.insert("usageLedger", {
        mintAddress, service: "clip_refund_credit", qty: 1,
        unitPriceUsdc: amount, costUsdc: amount, idemKey: `${marker}:remaining`, at: now,
      });
      // The net tail remains unchanged; no USDC transfer is owed for this batch.
      return { settled: false as const, credited: true as const, coveredUsdc };
    }

    const now = Date.now();
    const settlementId = await ctx.db.insert("feeSettlements", {
      mintAddress,
      amountUsdc: amount,
      coversUsageIds: unsettled.map((u) => u._id as unknown as string),
      paid: false,
      at: now,
    });

    for (const u of unsettled) {
      await ctx.db.patch(u._id, { settledBatchId: settlementId as unknown as string });
    }

    // Chain=truth (compute-settlement migration): the on-chain vault + reconcile
    // OWN escrowUsdc/liquidUsdc now. settleTab must NOT debit the mirror here, or it
    // DOUBLE-COUNTS the fee — agent-vault `debit_fee` also moves the same USDC out
    // of the vault on-chain. We only move the covered fee OFF the tab; it is now
    // booked in the feeSettlements row above and held out of spendable by
    // reconcile's unpaid-settlement guard until debit_fee lands and reconcile reads
    // the lowered vault balance. (Was: escrowUsdc/liquidUsdc were also decremented.)
    await ctx.db.patch(account._id, {
      unsettledTabUsdc: requireTransfer ? +(account.unsettledTabUsdc - amount).toFixed(6) : Math.max(0, account.unsettledTabUsdc - amount),
      updatedAt: now,
    });

    return { settled: true as const, settlementId, amountUsdc: amount };
  },
});

/** Per-settlement concurrency LOCK (compare-and-set). A settle attempt (in-band
 *  or the recovery keeper) claims a booked row by writing an
 *  `INFLIGHT:<claimToken>:<expiryMs>` sentinel into txSignature BEFORE it moves
 *  any USDC on-chain. Mutations are serializable transactions, so the
 *  read-then-conditional-write here is atomic: of two concurrent claimers,
 *  exactly one observes the row as claimable and wins; the other re-reads the
 *  just-written INFLIGHT sentinel and is rejected. This is the chokepoint that
 *  prevents a double on-chain transfer for the same booked debit.
 *
 *  Succeeds when the row has NEVER been attempted (txSignature undefined) OR
 *  carries an EXPIRED INFLIGHT lease (a crashed prior settler — the keeper steals
 *  it). A real base58 signature (already paid) is NEVER claimable. */
export const claimSettlement = mutation({
  args: {
    settlementId: v.id("feeSettlements"),
    claimToken: v.string(),
    nowMs: v.number(),
    authSecret: v.string(),
  },
  handler: async (ctx, { settlementId, claimToken, nowMs, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const row = await ctx.db.get(settlementId);
    if (!row) return { claimed: false as const, reason: "not_found" as const };
    if (!isClaimable(row.txSignature, nowMs)) {
      // Either terminally paid, or a still-valid INFLIGHT lease owned by a live
      // settler — do NOT steal it.
      return { claimed: false as const, reason: isPaidSig(row.txSignature) ? ("paid" as const) : ("locked" as const) };
    }
    await ctx.db.patch(settlementId, { txSignature: buildInflight(claimToken, nowMs + LEASE_MS) });
    return {
      claimed: true as const,
      amountUsdc: row.amountUsdc,
      coversUsageIds: row.coversUsageIds,
      mintAddress: row.mintAddress,
    };
  },
});

/** Defer a failed claim with an unpaid cooldown sentinel so the keeper does not
 *  retry it immediately. Only call this on a PRE-BROADCAST failure (no on-chain
 *  signature was ever produced — balance / load-key / fee steps). NEVER call it
 *  for a confirm-step ambiguity (the USDC may have moved): leave the INFLIGHT
 *  sentinel so the keeper verifies on-chain before re-transferring.
 *
 *  Guarded so it can only defer an INFLIGHT sentinel it (or an expired lease)
 *  owns — it will not wipe a real, paid signature. Idempotent on an already-clear
 *  row. The `claimToken` must match the live lease unless the lease has expired. */
export const releaseSettlement = mutation({
  args: {
    settlementId: v.id("feeSettlements"),
    claimToken: v.string(),
    nowMs: v.number(),
    authSecret: v.string(),
    retryDelayMs: v.optional(v.number()),
  },
  handler: async (ctx, { settlementId, claimToken, nowMs, authSecret, retryDelayMs }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const row = await ctx.db.get(settlementId);
    if (!row) return { released: false as const, reason: "not_found" as const };
    if (isPaidSig(row.txSignature)) return { released: false as const, reason: "paid" as const };
    if (!row.txSignature) return { released: true as const }; // already unattempted
    const parsed = parseInflight(row.txSignature);
    // Only release the lease this caller owns, or an expired one (self-heal).
    if (parsed && parsed.token !== claimToken && parsed.expiryMs >= nowMs) {
      return { released: false as const, reason: "owned_by_other" as const };
    }
    // Persist backpressure across workers/restarts with the existing unpaid
    // lease format. Claims and recovery queries already respect its expiry.
    const delay = Number.isFinite(retryDelayMs) ? Math.min(3_600_000, Math.max(60_000, retryDelayMs!)) : 300_000;
    await ctx.db.patch(settlementId, { txSignature: buildInflight(claimToken, nowMs + delay) });
    return { released: true as const };
  },
});

/** Record a confirm-step AMBIGUOUS failure: the settler broadcast a transfer and
 *  got a signature back, but confirmation failed (the USDC MAY have moved). We
 *  LEAVE the INFLIGHT lock in place and embed the broadcast signature into the
 *  sentinel so the recovery keeper can verify it on-chain before deciding to
 *  re-transfer. Critically we do NOT mark it paid and do NOT release it — the
 *  keeper must resolve it via getSignatureStatus. Only rewrites a row this caller
 *  still owns (its INFLIGHT lease); never touches a paid row. The lease expiry is
 *  preserved so the keeper's grace/expiry logic is unchanged. */
export const markSettlementConfirmAmbiguous = mutation({
  args: {
    settlementId: v.id("feeSettlements"),
    claimToken: v.string(),
    confirmSig: v.string(),
    /** The confirm sig's blockhash lastValidBlockHeight — lets the keeper prove
     *  blockhash expiry before re-transferring a dropped tx (F2). Optional so
     *  legacy / bet callers that lack it still work. */
    lastValidBlockHeight: v.optional(v.number()),
    /** Ambiguous-pass counter the keeper carries forward so a genuinely-stuck
     *  row alerts instead of deferring forever (F2). Defaults to the row's
     *  current count + nothing here — the keeper increments and re-passes it. */
    attempts: v.optional(v.number()),
    authSecret: v.string(),
  },
  handler: async (ctx, { settlementId, claimToken, confirmSig, lastValidBlockHeight, attempts, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const row = await ctx.db.get(settlementId);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (isPaidSig(row.txSignature)) return { ok: false as const, reason: "paid" as const };
    const parsed = parseInflight(row.txSignature);
    // Only annotate the lease this caller owns; if the lock isn't ours anymore,
    // don't clobber another settler's work.
    if (!parsed || parsed.token !== claimToken) return { ok: false as const, reason: "not_owner" as const };
    // Pin to an explicit `string` so the inferred mutation type stays narrow
    // (keeps the generated ApiFromModules inference stable across the codebase).
    const nextSentinel: string = buildInflight(claimToken, parsed.expiryMs, confirmSig, lastValidBlockHeight, attempts);
    await ctx.db.patch(settlementId, { txSignature: nextSentinel });
    return { ok: true as const };
  },
});

/** Stamp the real on-chain tx signature once the keeper has broadcast (and
 *  confirmed) the escrow→treasury transfer. An INFLIGHT sentinel is the EXPECTED
 *  current value (this caller just claimed the row), so it is OVERWRITABLE; a
 *  real base58 signature still throws "already paid" so a confirmed settlement is
 *  never double-stamped. Rejects writing an INFLIGHT value here (only real sigs
 *  may be marked paid). */
export const markSettlementPaid = mutation({
  args: { settlementId: v.id("feeSettlements"), txSignature: v.string(), authSecret: v.string() },
  handler: async (ctx, { settlementId, txSignature, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    if (isInflight(txSignature)) throw new Error("cannot mark paid with an INFLIGHT sentinel");
    const row = await ctx.db.get(settlementId);
    if (!row) throw new Error("settlement not found");
    // A real signature is terminal; an INFLIGHT sentinel (or undefined) is the
    // claimed state we overwrite with the confirmed signature.
    if (isPaidSig(row.txSignature)) throw new Error("settlement already paid");
    // `paid` mirrors isPaidSig(txSignature) for the by_paid_at recovery index.
    await ctx.db.patch(settlementId, { txSignature, paid: true });
  },
});

/** RECOVERY KEEPER read side. Lists settlements that are stranded — booked but
 *  not paid — and old enough to be safe to re-drive:
 *    (txSignature undefined  OR  an INFLIGHT lease whose expiry < now)
 *    AND  at < now - GRACE_MS   (give the in-band settle time to finish first)
 *  A row carrying a LIVE (unexpired) INFLIGHT lease is skipped — its settler is
 *  presumed still working. Returns the parsed inflight sentinel (if any) so the
 *  keeper knows whether a confirm-step signature must be verified on-chain. */
export const listStrandedSettlements = query({
  args: { nowMs: v.number(), authSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { nowMs, authSecret, limit }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const cutoff = nowMs - GRACE_MS;
    const take = Math.max(1, Math.min(limit ?? 50, 200));
    const stranded: Array<{
      settlementId: string;
      mintAddress: string;
      amountUsdc: number;
      coversUsageIds: string[];
      sentinel: string | null;
      at: number;
    }> = [];
    // Read ONLY unpaid rows older than the grace window via the by_paid_at index
    // (oldest-first), bounded by STRANDED_SCAN_CAP — terminally-paid rows (the vast
    // majority at scale) are never scanned. A live INFLIGHT lease is skipped in
    // memory; the rest re-drive on the next tick if we hit `take`.
    const candidates = await ctx.db
      .query("feeSettlements")
      .withIndex("by_paid_at", (q) => q.eq("paid", false).lt("at", cutoff))
      .take(STRANDED_SCAN_CAP);
    for (const row of candidates) {
      if (isPaidSig(row.txSignature)) continue;       // defensive: paid flag drifted from sig
      if (!isClaimable(row.txSignature, nowMs)) continue; // live INFLIGHT lease — its settler is working
      stranded.push({
        settlementId: row._id as unknown as string,
        mintAddress: row.mintAddress,
        amountUsdc: row.amountUsdc,
        coversUsageIds: row.coversUsageIds,
        sentinel: row.txSignature ?? null,
        at: row.at,
      });
      if (stranded.length >= take) break;
    }
    return stranded;
  },
});

/** ONE-OFF backfill — stamp `paid` onto legacy feeSettlements rows (written before
 *  the field existed) so the by_paid_at recovery index can find pre-existing
 *  stranded rows. Derives paid = isPaidSig(txSignature). Reads only rows still
 *  missing the field (paid === undefined) per batch and reschedules itself, so it
 *  stays within transaction limits and is safe to re-run.
 *  Run with:  npx convex run usage:backfillSettlementPaid */
export const backfillSettlementPaid = internalMutation({
  args: { updated: v.optional(v.number()) },
  handler: async (ctx, { updated }): Promise<{ done: boolean; updated: number }> => {
    const BATCH = 500;
    const rows = await ctx.db
      .query("feeSettlements")
      .withIndex("by_paid_at", (q) => q.eq("paid", undefined))
      .take(BATCH);
    for (const row of rows) {
      await ctx.db.patch(row._id, { paid: isPaidSig(row.txSignature) });
    }
    const total = (updated ?? 0) + rows.length;
    if (rows.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.usage.backfillSettlementPaid, { updated: total });
      return { done: false, updated: total };
    }
    return { done: true, updated: total };
  },
});

/** Recompute the live amount a settlement should sweep from its covered usage
 *  rows (defensive: the keeper recomputes rather than trusting the stored
 *  amount). Secret-gated; used by the recovery keeper. Returns null if the row
 *  is gone or no longer claimable. */
export const settlementForRecovery = query({
  args: { settlementId: v.id("feeSettlements"), nowMs: v.number(), authSecret: v.string() },
  handler: async (ctx, { settlementId, nowMs, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const row = await ctx.db.get(settlementId);
    if (!row) return null;
    return {
      mintAddress: row.mintAddress,
      amountUsdc: row.amountUsdc,
      coversUsageIds: row.coversUsageIds,
      sentinel: row.txSignature ?? null,
      claimable: isClaimable(row.txSignature, nowMs),
      paid: isPaidSig(row.txSignature),
    };
  },
});
