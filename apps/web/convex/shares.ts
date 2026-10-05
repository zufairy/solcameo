import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { consumeSignature } from "./lib/payments";
import { navPerShare, sharesForDeposit, redeemPayout, exceedsWalletCap } from "../lib/economy/nav";
import { investEnabled } from "../lib/flags";

/**
 * BURN a holder's shares + debit escrow for a redemption, writing the authoritative
 * shareLedger `redeem` row. Pure ledger move (no USDC transfer). Shared by BOTH
 * shares.redeemShares (legacy single-shot) and shareRedemptions.begin (the
 * idempotent/recoverable path) so the two can never drift on the burn math or the
 * invariant guards. Throws on: no account, over-redeem, insufficient liquid USDC,
 * or the escrow≥tab invariant. Reversible via `reverseRedeemBurn`.
 */
export async function burnSharesForRedeem(
  ctx: MutationCtx,
  { mintAddress, holderWallet, sharesToBurn }: { mintAddress: string; holderWallet: string; sharesToBurn: number },
): Promise<{ redeemRowId: Id<"shareLedger">; payout: number; exitFee: number; navPerShare: number; sharesBurned: number }> {
  if (sharesToBurn <= 0) throw new Error("sharesToBurn must be positive");

  const account = await ctx.db
    .query("agentAccount")
    .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
    .unique();
  if (!account) throw new Error("no agentAccount for mint");

  const held = (await ctx.db
    .query("shareLedger")
    .withIndex("by_wallet", (q) => q.eq("wallet", holderWallet))
    .collect())
    .filter((r) => r.mintAddress === mintAddress)
    .reduce((s, r) => s + r.shares, 0);
  if (sharesToBurn > held) throw new Error(`insufficient shares: holds ${held}, asked ${sharesToBurn}`);

  const nav = navPerShare(account);
  const { exitFee, payout } = redeemPayout({ sharesToBurn, nav });

  if (account.liquidUsdc < payout) {
    throw new Error(`insufficient liquid USDC: ${account.liquidUsdc} < payout ${payout} (capital deployed)`);
  }
  // Invariant 4 (defensive): redeeming at NAV preserves escrow ≥ tab whenever it
  // held before — kept as a guard against future bugs / direct state edits.
  if (account.escrowUsdc - payout < account.unsettledTabUsdc - 1e-6) {
    throw new Error("invariant: redemption would pull escrow below the unsettled service tab");
  }

  const now = Date.now();
  await ctx.db.patch(account._id, {
    sharesOutstanding: account.sharesOutstanding - sharesToBurn,
    escrowUsdc: account.escrowUsdc - payout,
    liquidUsdc: account.liquidUsdc - payout,
    updatedAt: now,
  });
  const redeemRowId = await ctx.db.insert("shareLedger", {
    mintAddress, wallet: holderWallet, kind: "redeem",
    shares: -sharesToBurn, navPerShare: nav, usdcAmount: payout, exitFeeUsdc: exitFee, at: now,
  });
  return { redeemRowId, payout, exitFee, navPerShare: nav, sharesBurned: sharesToBurn };
}

/** Net shares a wallet currently holds in an agent (sum of signed ledger rows). */
export const walletShares = query({
  args: { mintAddress: v.string(), wallet: v.string() },
  handler: async (ctx, { mintAddress, wallet }) => {
    const rows = await ctx.db
      .query("shareLedger")
      .withIndex("by_wallet", (q) => q.eq("wallet", wallet))
      .collect();
    return rows
      .filter((r) => r.mintAddress === mintAddress)
      .reduce((s, r) => s + r.shares, 0);
  },
});

/** Record an investor's USDC deposit and mint shares at the current NAV.
 *  Replay-guarded by the on-chain deposit signature. Enforces the 10%-of-
 *  planned-supply wallet cap. The actual USDC must already be in escrow (the
 *  route verifies the deposit tx before calling this). Spec §5.2.
 *  SECURITY: this mints unbacked shares and has no on-chain deposit verification
 *  of its own — it trusts that its caller (the buy-shares route/action) has
 *  already verified the USDC landed in escrow. It is therefore SECRET-GATED:
 *  only a server caller holding INTERNAL_CRON_SECRET (the buy-shares route) may
 *  invoke it. Ungated, anyone with the public Convex URL could mint free shares.
 */
export const buyShares = mutation({
  args: {
    mintAddress: v.string(),
    investorWallet: v.string(),
    depositUsdc: v.number(),
    txSignature: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, investorWallet, depositUsdc, txSignature, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    // Defense in depth: refuse to mint shares while Invest is turned off, BEFORE the
    // deposit signature is consumed. Gated by NEXT_PUBLIC_INVEST_ENABLED (default
    // off; set it in the Convex env to re-enable). Does NOT affect redeem.
    if (!investEnabled()) throw new Error("Investing is not available yet");
    if (depositUsdc <= 0) throw new Error("depositUsdc must be positive");

    await consumeSignature(ctx, { txSignature, purpose: "invest", ref: mintAddress, amount: depositUsdc });

    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) throw new Error("no agentAccount for mint");
    if (account.status === "suspended") throw new Error("agent is suspended");

    const nav = navPerShare(account);
    const shares = sharesForDeposit({ depositUsdc, nav });

    const current = (await ctx.db
      .query("shareLedger")
      .withIndex("by_wallet", (q) => q.eq("wallet", investorWallet))
      .collect())
      .filter((r) => r.mintAddress === mintAddress)
      .reduce((s, r) => s + r.shares, 0);

    if (exceedsWalletCap({ walletSharesAfter: current + shares, plannedSupply: account.plannedSupply })) {
      throw new Error("buy exceeds the 10%-of-planned-supply wallet cap");
    }

    const now = Date.now();
    await ctx.db.patch(account._id, {
      sharesOutstanding: account.sharesOutstanding + shares,
      escrowUsdc: account.escrowUsdc + depositUsdc,
      liquidUsdc: account.liquidUsdc + depositUsdc,
      updatedAt: now,
    });
    await ctx.db.insert("shareLedger", {
      mintAddress, wallet: investorWallet, kind: "buy",
      shares, navPerShare: nav, usdcAmount: depositUsdc, txSignature, at: now,
    });
    return { shares, navPerShare: nav };
  },
});

/** Burn a holder's shares and record a (pending) USDC payout at NAV, minus a 2%
 *  exit fee that STAYS in escrow (lifts NAV for remaining holders). Does NOT move
 *  funds — the route transfers the returned payout then calls markRedeemPaid.
 *  Guards: holder owns the shares; escrow stays ≥ the unsettled tab (invariant 4);
 *  liquid USDC covers the payout. Spec §6.2. */
export const redeemShares = mutation({
  // SECRET-GATED: burns a holder's shares + records a real USDC payout. As a
  // public mutation it was an IDOR — anyone could burn ANY holder's shares and
  // corrupt pooled escrow (E2E hunt #39). Reach it only through
  // /api/market/redeem-shares, which requireAuth + linked-wallet-proves the
  // caller owns holderWallet before forwarding the internal secret.
  // NOTE (H4): the /api/market/redeem-shares route now drives redemptions through
  // shareRedemptions.begin (idempotent + keeper-recoverable) instead of this
  // one-shot burn. This mutation is retained for backward-compat + the economy
  // tests; both paths share `burnSharesForRedeem` so the burn math can't drift.
  args: { mintAddress: v.string(), holderWallet: v.string(), sharesToBurn: v.number(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, holderWallet, sharesToBurn, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    return burnSharesForRedeem(ctx, { mintAddress, holderWallet, sharesToBurn });
  },
});

/** Stamp the on-chain payout signature onto a redeem row once the transfer lands.
 *  Idempotency guard: throws if the row was already stamped, preventing double-pay. */
export const markRedeemPaid = mutation({
  // SECRET-GATED (same IDOR class as redeemShares — public, anyone could stamp
  // any redeem row). Reached only through /api/market/redeem-shares.
  args: { redeemRowId: v.id("shareLedger"), txSignature: v.string(), authSecret: v.string() },
  handler: async (ctx, { redeemRowId, txSignature, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    const row = await ctx.db.get(redeemRowId);
    if (!row) throw new Error("redeem row not found");
    if (row.txSignature) throw new Error("redeem already marked paid");
    await ctx.db.patch(redeemRowId, { txSignature });
  },
});
