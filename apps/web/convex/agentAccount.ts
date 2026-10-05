import { internalMutation, mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { navPerShare } from "../lib/economy/nav";
import { SEED_SHARE_PRICE_USDC, INITIAL_SHARE_SUPPLY } from "../lib/economy/constants";
import { isPaidSig } from "../lib/economy/settlementSentinel";
import { buildTransactionHistory, submissionToRewardRow, type TxHistoryRow } from "../lib/economy/transactionHistory";

/** Idempotent genesis of an agent's empty economic account. Safe to call from any
 *  mutation (e.g. saveInfluencer at mint). No founder shares — the builder's 15%
 *  accrues from earnings later. Returns the account id. Spec §5.1. */
export async function ensureAgentAccount(ctx: MutationCtx, mintAddress: string) {
  const existing = await ctx.db
    .query("agentAccount")
    .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
    .unique();
  if (existing) return existing._id;
  const now = Date.now();
  return await ctx.db.insert("agentAccount", {
    mintAddress,
    sharesOutstanding: 0,
    escrowUsdc: 0,
    liquidUsdc: 0,
    unsettledTabUsdc: 0,
    status: "active",
    seedSharePrice: SEED_SHARE_PRICE_USDC,
    plannedSupply: INITIAL_SHARE_SUPPLY,
    updatedAt: now,
  });
}

/** Internal genesis entry point (kept for tests / manual seeding). */
export const create = internalMutation({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => ensureAgentAccount(ctx, mintAddress),
});

/** Public genesis — idempotently provision an economic account for an agent that
 *  predates auto-genesis (old agents minted before SP5). Safe to call anytime. */
// RESIDUAL (left public, ungated): idempotently creates the zero-balance agentAccount
// mirror row for a mint (ensureAgentAccount is a no-op if it exists). No sensitive data
// and no money moves; worst case is creating an empty row for a known mint. The only
// caller today is the /api/market/test-invest dev route. Low value; left open.
export const ensure = mutation({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => ensureAgentAccount(ctx, mintAddress),
});

/** Reconcile the escrow mirror to the agent's REAL on-chain USDC balance.
 *  The escrow/liquid figures otherwise only track share-investment flows, so a
 *  wallet funded directly on-chain reads $0 in the mirror. Called from the
 *  settlement path (which has network access to read the chain) so the spendable
 *  gate and on-chain sweep math reflect the wallet's actual balance. Preserves
 *  the unsettled tab; clears `needs_funding` once the wallet covers the tab. */
/** Max unpaid-candidate settlements reconcile will sum in one pass. Unpaid rows are
 *  swept promptly by the keeper, so this is never hit in steady state; exceeding it
 *  signals a systemic settlement backlog. We FAIL CLOSED past it (skip the write,
 *  keep the mirror stale) rather than truncate — see the guard in reconcileImpl. */
const UNPAID_SETTLEMENT_SCAN_CAP = 5000;

/** Max in-flight (pending) share-redemptions reconcile will sum in one pass. A
 *  pending redemption has ALREADY burned its shares + debited escrow at burn time,
 *  but its USDC payout is still physically in the wallet until the transfer confirms,
 *  so the raw on-chain read still holds it — we subtract it (like unpaid settlements)
 *  so a reconcile landing mid-payout can't re-materialize the burned value into
 *  escrow/NAV (H07 double-spend). Pending rows are transient (terminal = paid/failed),
 *  so this cap is never hit in steady state; exceeding it FAILS CLOSED (skip the write,
 *  leave the mirror stale) rather than truncate the sum and UNDER-subtract → over-credit
 *  → fail-OPEN, the wrong direction. Mirrors computeSafeWithdrawable's F1-0 fix. */
const PENDING_REDEMPTION_SCAN_CAP = 5000;

/** Shared reconcile logic — see reconcileEscrowToOnchain (internal) and
 *  reconcileEscrowToOnchainServer (public, secret-gated for Next callers, since
 *  ConvexHttpClient cannot reach internal functions). */
async function reconcileImpl(ctx: MutationCtx, mintAddress: string, onchainUsdc: number | null) {
    // UNKNOWN balance (null) = the on-chain read failed (RPC timeout/429/drop), NOT
    // a confirmed 0. Persisting it would zero a funded agent's escrow/NAV mirror and
    // flip it to needs_funding on a transient blip. Skip the write; the next
    // reconcile after the RPC recovers re-reads the real balance. A confirmed 0
    // (empty account) still reconciles normally.
    if (onchainUsdc === null) return { ok: false as const, reason: "unknown_balance" as const };
    await ensureAgentAccount(ctx, mintAddress);
    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) return { ok: false as const };
    // Admin adjustments are permanent off-chain subsidies with no on-chain
    // counterpart — reconcile always re-adds the FULL cumulative offset on
    // top of the live on-chain balance (fees consumed mid-cycle re-converge
    // once the keeper sweep moves real funds). See adminEconomy.adjustEscrowData.
    const adminOffset = account.adminAdjustmentUsdc ?? 0;
    // Off-chain earnings credits (v1 creditEarnings/creditAndRecord) raise NAV as
    // pure ledger bookkeeping — no USDC ever lands in the wallet, so a chain read
    // can't see them. Like adminOffset, RE-ADD the full cumulative amount on top of
    // the on-chain balance; otherwise reconcile would ERASE legitimately-credited
    // off-chain NAV (H5) the moment the chain is read (e.g. a vault-enabled agent
    // whose on-chain read is 0). Absent → 0 (agents with no off-chain earnings).
    const offchainCredited = account.offchainCreditedUsdc ?? 0;
    // RE-CREDIT GUARD: a settled-but-UNPAID feeSettlements row (settleTab already
    // zeroed the tab + debited the books, but the on-chain transfer hasn't landed
    // — txSignature undefined OR an INFLIGHT lease) still represents USDC the
    // agent OWES the treasury. The raw on-chain balance still holds those funds,
    // so without this subtraction they'd re-appear as spendable. We hold them out
    // of escrow. NOTE: once settleTab runs it ZEROES the tab, so this subtraction
    // REPLACES (does not stack with) the `- unsettledTabUsdc` deduction below: an
    // un-settled fee sits in the tab; a settled-unpaid fee sits here; a fee is
    // never in both at once. See the combined recordUsage+settleTab+reconcile test.
    // BOUNDED unpaid read (fail CLOSED): sum the hold-out from ONLY the
    // unpaid-CANDIDATE settlements — paid===false (booked/INFLIGHT) plus legacy
    // paid===undefined rows (written before the denormalized flag / backfill) — via
    // by_mint_paid. The terminally-PAID majority (paid===true) is never scanned, so
    // this can't blow Convex's ~16k-row per-query cap the way the old unbounded
    // by_mint .collect() did on a long-lived busy agent (it threw → the escrow mirror
    // went stale → spendable/needs_funding drifted). We defensively re-derive unpaid
    // from isPaidSig (mirrors listStrandedSettlements' paid-flag drift guard).
    const unpaidBooked = await ctx.db
      .query("feeSettlements")
      .withIndex("by_mint_paid", (q) => q.eq("mintAddress", mintAddress).eq("paid", false))
      .take(UNPAID_SETTLEMENT_SCAN_CAP + 1);
    const unpaidLegacy = await ctx.db
      .query("feeSettlements")
      .withIndex("by_mint_paid", (q) => q.eq("mintAddress", mintAddress).eq("paid", undefined))
      .take(UNPAID_SETTLEMENT_SCAN_CAP + 1);
    // FAIL CLOSED: if the unpaid-candidate set itself exceeds the cap we CANNOT trust
    // a truncated sum — dropping unpaid rows would UNDER-subtract unpaidSettledUsdc,
    // OVER-credit escrow and open UNBACKED spendable (fail-OPEN, the wrong direction).
    // Skip the write and leave the mirror STALE (like the null-balance case above); a
    // stale mirror never over-pays, a truncated sum would. Reaching here means a
    // systemic settlement backlog (unpaid rows normally sweep fast) needing operator
    // attention, not silent under-subtraction.
    if (unpaidBooked.length > UNPAID_SETTLEMENT_SCAN_CAP || unpaidLegacy.length > UNPAID_SETTLEMENT_SCAN_CAP) {
      return { ok: false as const, reason: "unpaid_overflow" as const };
    }
    const unpaidSettledUsdc = +[...unpaidBooked, ...unpaidLegacy]
      .filter((f) => !isPaidSig(f.txSignature))
      .reduce((s, f) => s + f.amountUsdc, 0)
      .toFixed(6);
    // HOLD BACK in-flight redemptions (H07): shareRedemptions.begin BURNS shares +
    // debits escrow ATOMICALLY at burn time, but the payout only LEAVES the wallet once
    // the transfer confirms (seconds, or minutes on a confirm-ambiguous send the keeper
    // resolves). During that window the fresh on-chain read STILL holds the payout while
    // sharesOutstanding is already reduced — so without this subtraction reconcile would
    // re-credit the burned value back into escrow and INFLATE NAV/spendable, letting the
    // NEXT buyer/redeemer be priced off money a redemption already accounted for
    // (double-spend). The exact same hazard was already fixed for the withdraw path
    // (computeSafeWithdrawable, "F1-0 double-spend"); apply it HERE too, since reconcileImpl
    // is what actually PERSISTS escrow/NAV. Only 'pending' rows are subtracted: once markPaid
    // flips a row to 'paid' the real balance has itself dropped, so subtracting again would
    // double-count (under-credit). Bounded read via the existing by_mint_status index; FAIL
    // CLOSED on overflow (a truncated sum would under-subtract → over-credit).
    const pendingRedemptions = await ctx.db
      .query("shareRedemptions")
      .withIndex("by_mint_status", (q) => q.eq("mintAddress", mintAddress).eq("status", "pending"))
      .take(PENDING_REDEMPTION_SCAN_CAP + 1);
    if (pendingRedemptions.length > PENDING_REDEMPTION_SCAN_CAP) {
      return { ok: false as const, reason: "pending_redemption_overflow" as const };
    }
    const pendingRedemptionUsdc = +pendingRedemptions
      .reduce((s, r) => s + r.payoutUsdc, 0)
      .toFixed(6);
    const escrowUsdc = Math.max(
      0,
      +(Number(onchainUsdc) + adminOffset + offchainCredited - unpaidSettledUsdc - pendingRedemptionUsdc).toFixed(6),
    );
    const now = Date.now();
    const spendable = Math.max(0, escrowUsdc - account.unsettledTabUsdc);
    await ctx.db.patch(account._id, {
      escrowUsdc,
      liquidUsdc: escrowUsdc,
      // Don't override a suspended account; otherwise fund-state follows the math.
      status: account.status === "suspended" ? "suspended" : (spendable > 0 ? "active" : "needs_funding"),
      updatedAt: now,
    });
    return { ok: true as const, escrowUsdc, unsettledTabUsdc: account.unsettledTabUsdc, spendableUsdc: spendable };
}

export const reconcileEscrowToOnchain = internalMutation({
  // onchainUsdc may be null = "balance unknown" (RPC read failed) → reconcile skips.
  args: { mintAddress: v.string(), onchainUsdc: v.union(v.number(), v.null()) },
  handler: (ctx, { mintAddress, onchainUsdc }) => reconcileImpl(ctx, mintAddress, onchainUsdc),
});

/** Public, INTERNAL_CRON_SECRET-gated twin so Next server code (settleAgent,
 *  clip-precheck) can reconcile — ConvexHttpClient can't call internal fns. */
export const reconcileEscrowToOnchainServer = mutation({
  args: { mintAddress: v.string(), onchainUsdc: v.union(v.number(), v.null()), authSecret: v.string() },
  handler: (ctx, { mintAddress, onchainUsdc, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    return reconcileImpl(ctx, mintAddress, onchainUsdc);
  },
});

/** Raw account doc (or null). */
export const get = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) =>
    ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique(),
});

/** Persist vault PDA details after on-chain init_vault. Public but secret-gated
 *  (ConvexHttpClient cannot call internal mutations). Upserts the agentAccount
 *  row: patches if it exists, creates it first via ensureAgentAccount if not. */
export const setVault = mutation({
  args: {
    authSecret: v.string(),
    mintAddress: v.string(),
    vaultAddress: v.string(),
    vaultAgentId: v.string(),
    vaultEnabled: v.boolean(),
  },
  handler: async (ctx, { authSecret, mintAddress, vaultAddress, vaultAgentId, vaultEnabled }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    await ensureAgentAccount(ctx, mintAddress);
    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) throw new Error("agentAccount row missing after ensure");
    await ctx.db.patch(account._id, {
      vaultAddress,
      vaultAgentId,
      vaultEnabled,
      updatedAt: Date.now(),
    });
  },
});

// Per-table read bounds for the union history — bounded so a long-lived agent's
// ledger can never blow Convex's per-query read limit. Each table's most-recent
// slice is read (its index is time-ordered), merged, then capped to HISTORY_TOTAL.
const HISTORY_PER_TABLE = 250;
const HISTORY_TOTAL = 100;

/** Unified money-event history for the agent Earnings card: metered spend,
 *  escrow→treasury sweeps, owner withdrawals, revenue distributions (the agent's
 *  builder cut), campaign-reward payouts (claim_payout, recorded on submissions),
 *  the mint fee, and admin adjustments — each normalized to a single
 *  SIGNED-amount row (+ credit / − debit) and sorted newest-first. On-chain
 *  DEPOSITS have no Convex row; the client merges those in from
 *  /api/solana/usdc-transfers. Read-only, non-sensitive: the same per-agent money
 *  data the Earnings card already surfaces in aggregate. */
export const transactionHistory = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }): Promise<TxHistoryRow[]> => {
    const rows: TxHistoryRow[] = [];

    // Spend — usageLedger (internal, no on-chain sig). Newest slice via by_mint_at.
    const usage = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint_at", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(HISTORY_PER_TABLE);
    for (const u of usage) {
      if (!(u.costUsdc > 0)) continue; // skip $0 rows (e.g. free_clip_run)
      rows.push({
        id: u._id,
        ts: u.at,
        kind: "spend",
        // Credits-paid rows carry the REAL cost (so caps/analytics are accurate)
        // but never moved this agent's on-chain USDC — say so in the label, so a
        // reader doesn't try to reconcile it against the vault balance.
        label: `Spent · ${u.service}${u.paidWith === "credits" ? " (credits)" : ""}`,
        amountUsdc: -u.costUsdc,
        token: "USDC",
      });
    }

    // Sweep to treasury — feeSettlements. A real base58 sig = swept; an INFLIGHT
    // sentinel / undefined = still booked (never surface the sentinel as a link).
    const settlements = await ctx.db
      .query("feeSettlements")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(HISTORY_PER_TABLE);
    for (const f of settlements) {
      const paid = isPaidSig(f.txSignature);
      rows.push({
        id: f._id,
        ts: f.at,
        kind: "sweep",
        label: "Swept to treasury",
        amountUsdc: -f.amountUsdc,
        token: "USDC",
        ...(paid && f.txSignature ? { txSignature: f.txSignature } : {}),
        status: paid ? "paid" : "pending",
      });
    }

    // Withdrawals — agentWithdrawals. by_mint_status prefix-eq reads every status.
    const withdrawals = await ctx.db
      .query("agentWithdrawals")
      .withIndex("by_mint_status", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(HISTORY_PER_TABLE);
    for (const w of withdrawals) {
      rows.push({
        id: w._id,
        ts: w.createdAt,
        kind: "withdraw",
        label: "Withdraw → owner",
        amountUsdc: -w.amountUsdc,
        token: "USDC",
        ...(w.status === "paid" && w.txSignature ? { txSignature: w.txSignature } : {}),
        status: w.status,
      });
    }

    // Revenue — distributions (the agent's builder cut). Pull the builder split's
    // on-chain sig so an on-chain-paid payout dedupes against its incoming transfer.
    const dists = await ctx.db
      .query("distributions")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(HISTORY_PER_TABLE);
    for (const d of dists) {
      // Under the VAULT model the builder is paid in founder SHARES (not USDC), so
      // creditAndRecord writes builderUsdc:0 with investorUsdc/totalPayoutUsdc = the full
      // amount — a real escrow/NAV credit. Gating on `builderUsdc > 0` (the pre-vault
      // convention still used by recordContentRewardEarnings' direct-cash rows) silently
      // dropped EVERY vault credit, so the balance visibly rose but the history explained
      // nothing (H12). Show the amount from whichever field the writer populated; skip
      // only a truly empty row.
      const isVaultCredit = !(d.builderUsdc > 0);
      const amt = d.builderUsdc > 0 ? d.builderUsdc : d.investorUsdc > 0 ? d.investorUsdc : d.totalPayoutUsdc;
      if (!(amt > 0)) continue;
      const builderSplit = d.splits.find((s) => s.role === "builder");
      rows.push({
        id: d._id,
        ts: d.createdAt,
        kind: "revenue",
        label: isVaultCredit
          ? `Revenue · ${d.source ?? "campaign"} (NAV credit)`
          : `Revenue · ${d.source ?? "campaign"}`,
        amountUsdc: +amt,
        token: "USDC",
        ...(builderSplit?.status === "paid" && builderSplit.txSignature
          ? { txSignature: builderSplit.txSignature }
          : {}),
        ...(builderSplit?.status ? { status: builderSplit.status } : {}),
      });
    }

    // Campaign rewards — submissions. The crank's claim_payout credits the agent
    // but records the result on the SUBMISSION (paidUsdc + payoutTxSignature), NOT
    // in distributions, so these payouts would otherwise be missing here. Read this
    // agent's rows via by_influencer_mint (bounded like every other source) and map
    // each PAID one to an incoming "reward" row. The real payout sig (when present)
    // dedupes the row against the SAME payout's incoming on-chain transfer that the
    // client merges from usdc-transfers; pushed AFTER distributions so a
    // distribution wins any (unexpected) shared-sig collision — mirrors the
    // internal-wins-on-chain dedupe above.
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_influencer_mint", (q) => q.eq("influencerMint", mintAddress))
      .order("desc")
      .take(HISTORY_PER_TABLE);
    // Cache campaign lookups so N submissions on the same campaign resolve the
    // name once (a busy agent posts many clips to one campaign).
    const campaignNameCache = new Map<string, string | undefined>();
    for (const s of submissions) {
      // Resolve WHICH campaign (title, else brandName) so the row reads
      // "Campaign reward · <name>" instead of the bare label. Guard a missing id.
      let campaignName: string | undefined;
      if (s.campaignId) {
        const key = String(s.campaignId);
        if (campaignNameCache.has(key)) {
          campaignName = campaignNameCache.get(key);
        } else {
          const campaign = await ctx.db.get(s.campaignId);
          campaignName = campaign?.title || campaign?.brandName || undefined;
          campaignNameCache.set(key, campaignName);
        }
      }
      const row = submissionToRewardRow({ ...s, campaignName });
      if (row) rows.push(row);
    }

    // Admin adjustments — signed off-chain escrow credit/deduction (no on-chain tx).
    const adjustments = await ctx.db
      .query("adminAdjustments")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(HISTORY_PER_TABLE);
    for (const a of adjustments) {
      if (!a.deltaUsdc) continue;
      rows.push({
        id: a._id,
        ts: a.at,
        kind: "adjustment",
        label: `Adjustment · ${a.reason}`,
        amountUsdc: a.deltaUsdc,
        token: "USDC",
      });
    }

    // Mint fee — agentMintCharges has NO by_mint index, so resolve the creator
    // wallet from the influencers record (by_mint), read that wallet's charges
    // (by_wallet), and keep the charged row(s) for THIS mint. A free first agent
    // is $0 → skipped; the paid row carries mintAddress + txSignature.
    const inf = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    const creatorWallet = inf?.creatorWallet;
    if (creatorWallet) {
      const charges = await ctx.db
        .query("agentMintCharges")
        .withIndex("by_wallet", (q) => q.eq("creatorWallet", creatorWallet))
        .take(HISTORY_PER_TABLE);
      for (const c of charges) {
        if (c.mintAddress !== mintAddress) continue;
        if (!(c.feeUsdc > 0)) continue;
        rows.push({
          id: c._id,
          ts: c.createdAt,
          kind: "mint_fee",
          label: "Mint fee",
          amountUsdc: -c.feeUsdc,
          token: "USDC",
          ...(c.txSignature ? { txSignature: c.txSignature } : {}),
          ...(c.status ? { status: c.status } : {}),
        });
      }
    }

    // Union rows are already deduped/sorted-friendly; buildTransactionHistory
    // sorts newest-first and caps (no on-chain group here — the client adds those).
    return buildTransactionHistory(rows, [], HISTORY_TOTAL);
  },
});

/** Account doc plus derived NAV per share. An empty pool (0 shares) reads at the
 *  seed price via navPerShare; an underwater pool (escrow ≤ tab, shares > 0)
 *  reads at 0 — both handled inside navPerShare, so no special-casing here. */
export const getWithNav = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const a = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!a) return null;
    return { ...a, navPerShare: navPerShare(a) };
  },
});
