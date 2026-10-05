import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { resolveAdmin } from "./admin";
import { ensureAgentAccount } from "./agentAccount";
import { navPerShare } from "../lib/economy/nav";

/**
 * Manually credit (+) or deduct (−) an agent's escrow USDC. Off-chain ledger
 * only — no on-chain USDC moves. The signed delta accumulates into
 * agentAccount.adminAdjustmentUsdc so reconcileEscrowToOnchain preserves it.
 * Every call writes an adminAdjustments audit row.
 * SEMANTICS: an admin credit is a PERMANENT LEDGER SUBSIDY — it has no
 * on-chain backing, and reconcileEscrowToOnchain always re-adds the full
 * cumulative offset on top of the live on-chain balance. Service fees
 * (settleTab) deduct from the escrow mirror as usual; after the keeper
 * sweeps real on-chain funds the mirror and (onchain + offset) re-converge.
 * CAVEAT: an unbacked credit also raises the NAV that share redemptions pay
 * out against (shares.redeemShares checks the mirror, but the on-chain payout
 * draws real funds) — a redemption can then fail at the transfer step if the
 * agent wallet holds less than the mirror claims. For redemption-safe credits,
 * deposit real USDC to the agent wallet instead and let reconcile pick it up.
 */
export const adjustEscrowData = internalMutation({
  args: {
    mintAddress: v.string(),
    deltaUsdc: v.number(),
    reason: v.string(),
    adminEmail: v.string(),
  },
  handler: async (ctx, { mintAddress, deltaUsdc, reason, adminEmail }) => {
    if (!reason.trim()) throw new Error("A reason is required for every escrow adjustment.");
    if (reason.trim().length > 500) throw new Error("Reason must be 500 characters or fewer.");
    if (!Number.isFinite(deltaUsdc) || deltaUsdc === 0) {
      throw new Error("Adjustment delta must be a finite, non-zero number.");
    }
    if (Math.abs(deltaUsdc) > 1_000_000) {
      throw new Error("Adjustment delta cannot exceed $1,000,000 per operation.");
    }
    const accountId = await ensureAgentAccount(ctx, mintAddress);
    const account = await ctx.db.get(accountId);
    if (!account) throw new Error("Agent account not found");

    const escrowBefore = account.escrowUsdc;
    let escrowAfter = +(escrowBefore + deltaUsdc).toFixed(6);
    if (escrowAfter < 0) {
      throw new Error(`Deduction would push escrow below zero (current $${escrowBefore.toFixed(2)}).`);
    }
    escrowAfter = Math.max(0, escrowAfter); // -0 / float-dust guard
    const liquidAfter = Math.max(0, +(account.liquidUsdc + deltaUsdc).toFixed(6));
    const offsetAfter = +((account.adminAdjustmentUsdc ?? 0) + deltaUsdc).toFixed(6);
    const now = Date.now();
    const spendable = Math.max(0, escrowAfter - account.unsettledTabUsdc);

    await ctx.db.patch(account._id, {
      escrowUsdc: escrowAfter,
      liquidUsdc: liquidAfter,
      adminAdjustmentUsdc: offsetAfter,
      // Same fund-state rule as reconcile: never un-suspend.
      status: account.status === "suspended" ? "suspended" : (spendable > 0 ? "active" : "needs_funding"),
      updatedAt: now,
    });
    await ctx.db.insert("adminAdjustments", {
      mintAddress, adminEmail, deltaUsdc, reason: reason.trim(),
      escrowBefore, escrowAfter, at: now,
    });
    return { ok: true as const, escrowBefore, escrowAfter };
  },
});

export const adjustEscrow = action({
  args: {
    accessToken: v.string(),
    mintAddress: v.string(),
    deltaUsdc: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, { accessToken, mintAddress, deltaUsdc, reason }): Promise<{ ok: boolean; escrowBefore: number; escrowAfter: number }> => {
    const caller = await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress, deltaUsdc, reason,
      adminEmail: caller.email ?? caller.walletAddress ?? "unknown-admin",
    });
  },
});

/* ── Investments (read) ─────────────────────────────────────────────────── */

// Display cap for the global list; the summary is computed over ALL rows so
// the headline numbers are exact. The UI labels the table "latest 300".
const INVESTMENTS_LIST_LIMIT = 300;

export type AdminInvestmentRow = {
  mintAddress: string;
  agentName?: string;
  agentAvatarUrl?: string;
  investorWallet: string;
  sharesBought: number;
  usdcAmount: number;
  sharePrice: number;
  investedAt: number;
};

export type AdminInvestmentsResult = {
  rows: AdminInvestmentRow[];
  summary: { totalUsdc: number; uniqueInvestors: number; agentsFunded: number };
};

export const listInvestmentsData = internalQuery({
  args: {},
  handler: async (ctx): Promise<AdminInvestmentsResult> => {
    // NOTE: Convex hard-limits a single query execution to ~16K documents /
    // 8 MiB. At devnet scale (O(hundreds) of rows) a full collect is fine.
    // Re-evaluate before launch if investments could exceed ~10K rows —
    // switch to a pre-aggregated counter + a by_investedAt index.
    const all = await ctx.db.query("investments").collect();
    const summary = {
      totalUsdc: all.reduce((s, r) => s + r.usdcAmount, 0),
      uniqueInvestors: new Set(all.map((r) => r.investorWallet)).size,
      agentsFunded: new Set(all.map((r) => r.mintAddress)).size,
    };
    const latest = [...all].sort((a, b) => b.investedAt - a.investedAt).slice(0, INVESTMENTS_LIST_LIMIT);
    const agentByMint = new Map<string, { name: string; avatarUrl: string } | null>();
    const rows: AdminInvestmentRow[] = [];
    for (const r of latest) {
      if (!agentByMint.has(r.mintAddress)) {
        const agent = await ctx.db
          .query("influencers")
          .withIndex("by_mint", (q) => q.eq("mintAddress", r.mintAddress))
          .first();
        agentByMint.set(r.mintAddress, agent ? { name: agent.name, avatarUrl: agent.avatarUrl } : null);
      }
      const agent = agentByMint.get(r.mintAddress) ?? null;
      rows.push({
        mintAddress: r.mintAddress,
        agentName: agent?.name,
        agentAvatarUrl: agent?.avatarUrl,
        investorWallet: r.investorWallet,
        sharesBought: r.sharesBought,
        usdcAmount: r.usdcAmount,
        sharePrice: r.sharePrice,
        investedAt: r.investedAt,
      });
    }
    return { rows, summary };
  },
});

export type AgentInvestmentDetail = {
  agent: { name: string; handle: string; avatarUrl: string; agentType?: string } | null;
  account: {
    escrowUsdc: number; liquidUsdc: number; unsettledTabUsdc: number;
    sharesOutstanding: number; status: string; adminAdjustmentUsdc: number;
    navPerShare: number;
  } | null;
  investors: { investorWallet: string; sharesBought: number; usdcAmount: number; investedAt: number }[];
  ledger: { kind: string; wallet: string; shares: number; navPerShare: number; usdcAmount: number; at: number }[];
  adjustments: { adminEmail: string; deltaUsdc: number; reason: string; escrowBefore: number; escrowAfter: number; at: number }[];
};

export const agentInvestmentDetailData = internalQuery({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }): Promise<AgentInvestmentDetail> => {
    const agent = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    const investments = await ctx.db
      .query("investments")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    const ledger = await ctx.db
      .query("shareLedger")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    const adjustments = await ctx.db
      .query("adminAdjustments")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();

    // Aggregate investments per wallet (same shape as investments.listByMint).
    const byWallet = new Map<string, { investorWallet: string; sharesBought: number; usdcAmount: number; investedAt: number }>();
    for (const r of investments) {
      const cur = byWallet.get(r.investorWallet);
      if (cur) {
        cur.sharesBought += r.sharesBought;
        cur.usdcAmount += r.usdcAmount;
        cur.investedAt = Math.max(cur.investedAt, r.investedAt);
      } else {
        byWallet.set(r.investorWallet, {
          investorWallet: r.investorWallet, sharesBought: r.sharesBought,
          usdcAmount: r.usdcAmount, investedAt: r.investedAt,
        });
      }
    }

    return {
      agent: agent ? { name: agent.name, handle: agent.handle, avatarUrl: agent.avatarUrl, agentType: agent.agentType } : null,
      account: account ? {
        escrowUsdc: account.escrowUsdc, liquidUsdc: account.liquidUsdc,
        unsettledTabUsdc: account.unsettledTabUsdc, sharesOutstanding: account.sharesOutstanding,
        status: account.status, adminAdjustmentUsdc: account.adminAdjustmentUsdc ?? 0,
        navPerShare: navPerShare(account),
      } : null,
      investors: [...byWallet.values()].sort((a, b) => b.sharesBought - a.sharesBought),
      ledger: ledger.sort((a, b) => b.at - a.at).map((l) => ({
        kind: l.kind, wallet: l.wallet, shares: l.shares,
        navPerShare: l.navPerShare, usdcAmount: l.usdcAmount, at: l.at,
      })),
      adjustments: adjustments.sort((a, b) => b.at - a.at).map((a) => ({
        adminEmail: a.adminEmail, deltaUsdc: a.deltaUsdc, reason: a.reason,
        escrowBefore: a.escrowBefore, escrowAfter: a.escrowAfter, at: a.at,
      })),
    };
  },
});

/* ── Admin-gated public wrappers ────────────────────────────────────────── */

export const listInvestments = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<AdminInvestmentsResult> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.adminEconomy.listInvestmentsData, {});
  },
});

export const agentInvestmentDetail = action({
  args: { accessToken: v.string(), mintAddress: v.string() },
  handler: async (ctx, { accessToken, mintAddress }): Promise<AgentInvestmentDetail> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.adminEconomy.agentInvestmentDetailData, { mintAddress });
  },
});
