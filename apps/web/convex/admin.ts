import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { verifyToken } from "./lib/supabaseAuth";
import { assertAdminUser } from "./lib/auth";
import { appFetch } from "./lib/appFetch";

/** Verify the Supabase token and assert the caller is an active admin. */
export async function resolveAdmin(ctx: ActionCtx, accessToken: string): Promise<Doc<"users">> {
  const { supabaseId } = await verifyToken(accessToken);
  const user = await ctx.runQuery(internal.users.getBySupabaseId, { supabaseId });
  return assertAdminUser(user);
}

type Ok = { ok: boolean };
type AdminUserRow = {
  _id: Id<"users">;
  name?: string;
  email?: string;
  image?: string;
  walletAddress?: string;
  isAdmin: boolean;
  status: string;
  createdAt?: number;
  lastSeenAt?: number;
  agentCount: number;
  investmentCount: number;
  investedUsdc: number;
  creditBalance: number;
  clipsProduced: number;
  clipsPosted: number;
};

/* ── Users ──────────────────────────────────────────────────────────────── */

export const listUsersData = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    // Newest registration on top. Prefer the explicit `createdAt` (written at
    // signup); fall back to Convex's `_creationTime` for any legacy row that
    // predates the field, so ordering is total even with missing timestamps.
    users.sort(
      (a, b) => (b.createdAt ?? b._creationTime) - (a.createdAt ?? a._creationTime),
    );
    return await Promise.all(
      users.map(async (u) => {
        const agents = u.walletAddress
          ? await ctx.db
              .query("influencers")
              .withIndex("by_creator", (q) => q.eq("creatorWallet", u.walletAddress!))
              .collect()
          : [];
        const wallets = new Set(u.walletAddress ? [u.walletAddress] : []);
        for await (const link of ctx.db.query("walletLinks").withIndex("by_user", (q) => q.eq("userId", u._id))) {
          wallets.add(link.walletAddress);
        }
        const mints = new Set(agents.map((agent) => agent.mintAddress));
        for (const wallet of wallets) {
          if (wallet === u.walletAddress) continue;
          for await (const agent of ctx.db.query("influencers").withIndex("by_creator", (q) => q.eq("creatorWallet", wallet))) {
            mints.add(agent.mintAddress);
          }
        }
        let clipsProduced = 0;
        let clipsPosted = 0;
        for (const mint of mints) {
          for await (const clip of ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mint))) {
            const posted = clip.status === "posted" || clip.postedAt !== undefined || !!clip.postUrl;
            // A failed publishing attempt still counts as produced if rendered.
            if (clip.clipUrl || posted) clipsProduced++;
            if (posted) clipsPosted++;
          }
        }
        const investments = u.walletAddress
          ? await ctx.db
              .query("investments")
              .withIndex("by_investor", (q) => q.eq("investorWallet", u.walletAddress!))
              .collect()
          : [];
        const creditRow = u.walletAddress
          ? await ctx.db.query("userCredits").withIndex("by_owner", (q) => q.eq("ownerWallet", u.walletAddress!)).unique()
          : null;
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          image: u.image,
          walletAddress: u.walletAddress,
          isAdmin: u.isAdmin === true,
          status: u.status ?? "active",
          createdAt: u.createdAt,
          lastSeenAt: u.lastSeenAt,
          agentCount: agents.length,
          investmentCount: investments.length,
          investedUsdc: investments.reduce((s, i) => s + i.usdcAmount, 0),
          creditBalance: creditRow?.balanceCredits ?? 0,
          clipsProduced,
          clipsPosted,
        };
      }),
    );
  },
});

export const listUsers = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<AdminUserRow[]> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.admin.listUsersData, {});
  },
});

/** Admin Leads page — landing-page lead captures, newest first. */
export const listLeads = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<Doc<"leads">[]> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.leads.listData, {});
  },
});

/** Admin Nodes page — /node webinar sign-ups, newest first. */
export const listNodeApplications = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<Doc<"nodeApplications">[]> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.nodeApplications.listData, {});
  },
});

export const setNodeApplicationStatus = action({
  args: { accessToken: v.string(), id: v.id("nodeApplications"), status: v.string() },
  handler: async (ctx, { accessToken, id, status }): Promise<Ok> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.nodeApplications.setStatusData, { id, status });
  },
});

export const setUserFlagsData = internalMutation({
  args: {
    userId: v.id("users"),
    isAdmin: v.optional(v.boolean()),
    status: v.optional(v.union(v.literal("active"), v.literal("suspended"))),
  },
  handler: async (ctx, { userId, isAdmin, status }) => {
    const patch: Record<string, unknown> = {};
    if (isAdmin !== undefined) patch.isAdmin = isAdmin;
    if (status !== undefined) patch.status = status;
    await ctx.db.patch(userId, patch);
    return { ok: true };
  },
});

export const setUserAdmin = action({
  args: { accessToken: v.string(), userId: v.id("users"), isAdmin: v.boolean() },
  handler: async (ctx, { accessToken, userId, isAdmin }): Promise<Ok> => {
    const caller = await resolveAdmin(ctx, accessToken);
    if (caller._id === userId && !isAdmin) {
      throw new Error("You cannot remove your own admin rights.");
    }
    return await ctx.runMutation(internal.admin.setUserFlagsData, { userId, isAdmin });
  },
});

/** Per-account override of mintFee.AGENT_LIMIT_PER_WALLET, keyed by email
 *  (the natural handle admins think in terms of, e.g. "give this client
 *  unlimited agents"). undefined/null clears the override back to the
 *  platform default; -1 means unlimited; any other number is a custom cap.
 *  See mintFee.resolveAgentLimitOverride for how it's applied. */
export const setAgentLimitOverrideData = internalMutation({
  args: { email: v.string(), agentLimit: v.optional(v.number()) },
  handler: async (ctx, { email, agentLimit }) => {
    const target = email.trim().toLowerCase();
    const matches = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), target))
      .collect();
    if (matches.length === 0) throw new Error(`No user found for email ${email}`);
    // An email can own more than one row (e.g. a pre-migration duplicate) — the
    // account actually in use is whichever was seen most recently, not
    // necessarily the first one the table scan happens to return.
    const user = matches.reduce((latest, u) => ((u.lastSeenAt ?? 0) > (latest.lastSeenAt ?? 0) ? u : latest));
    await ctx.db.patch(user._id, { agentLimitOverride: agentLimit });
    return { ok: true, userId: user._id, matchedRows: matches.length };
  },
});

export const setAgentLimitOverride = action({
  args: { accessToken: v.string(), email: v.string(), agentLimit: v.optional(v.number()) },
  handler: async (ctx, { accessToken, email, agentLimit }): Promise<Ok> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.admin.setAgentLimitOverrideData, { email, agentLimit });
  },
});

export const setUserStatus = action({
  args: {
    accessToken: v.string(),
    userId: v.id("users"),
    status: v.union(v.literal("active"), v.literal("suspended")),
  },
  handler: async (ctx, { accessToken, userId, status }): Promise<Ok> => {
    const caller = await resolveAdmin(ctx, accessToken);
    if (caller._id === userId && status === "suspended") {
      throw new Error("You cannot suspend your own account.");
    }
    return await ctx.runMutation(internal.admin.setUserFlagsData, { userId, status });
  },
});

/** Admin top-up — grants credits directly to a user's prepaid balance (same
 *  pool `userCredits.debit` spends from on generation), ledgered as
 *  "admin_adjustment" so it's distinguishable from a real Stripe purchase in
 *  reporting. Positive amounts only — this is a top-up tool, not a way to claw
 *  credits back (that would need a debit path with its own confirmation UX). */
export const adjustUserCredits = action({
  args: { accessToken: v.string(), userId: v.id("users"), deltaCredits: v.number() },
  handler: async (ctx, { accessToken, userId, deltaCredits }): Promise<{ ok: boolean; balanceCredits: number }> => {
    await resolveAdmin(ctx, accessToken);
    if (!Number.isFinite(deltaCredits) || deltaCredits <= 0) throw new Error("Amount must be a positive number");
    const user = await ctx.runQuery(internal.users.getById, { userId });
    if (!user?.walletAddress) throw new Error("This user has no linked wallet yet");
    const result = await ctx.runMutation(internal.userCredits.credit, {
      ownerWallet: user.walletAddress,
      deltaCredits: Math.round(deltaCredits),
      kind: "admin_adjustment",
    });
    return { ok: true, balanceCredits: result.balanceCredits };
  },
});

/* ── Agents ─────────────────────────────────────────────────────────────── */

export const updateAgentData = internalMutation({
  args: {
    mintAddress: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      handle: v.optional(v.string()),
      niche: v.optional(v.string()),
      language: v.optional(v.string()),
      archetype: v.optional(v.string()),
      agentType: v.optional(v.string()),
      description: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      tvl: v.optional(v.number()),
      monthlyEarnings: v.optional(v.number()),
      sharePrice: v.optional(v.number()),
      totalShares: v.optional(v.number()),
      availableShares: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { mintAddress, patch }) => {
    const agent = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!agent) throw new Error("Agent not found");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(agent._id, { ...clean, updatedAt: Date.now() });
    return { ok: true };
  },
});

export const setAgentHeartbeatData = internalMutation({
  args: { mintAddress: v.string(), enabled: v.optional(v.boolean()), cron: v.optional(v.string()) },
  handler: async (ctx, { mintAddress, enabled, cron }) => {
    const agent = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!agent) throw new Error("Agent not found");
    const patch: Record<string, unknown> = {};
    if (enabled !== undefined) patch.heartbeatEnabled = enabled;
    if (cron !== undefined) patch.heartbeatCron = cron;
    await ctx.db.patch(agent._id, patch);
    return { ok: true };
  },
});

/** Ops read-out: how many agents currently have a live heartbeat. Used to verify a
 *  mass pause actually landed (and to see it stay at 0 until owners re-enable). */
export const heartbeatStatusData = internalQuery({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("influencers").collect();
    const on = agents.filter((a) => a.heartbeatEnabled === true);
    return {
      total: agents.length,
      enabled: on.length,
      disabled: agents.length - on.length,
      autoClipEnabled: agents.filter((a) => a.autoClipEnabled === true).length,
      stillOn: on.slice(0, 25).map((a) => ({ name: a.name, mintAddress: a.mintAddress })),
    };
  },
});

/** Ops kill-switch: pause EVERY agent heartbeat. Only flips heartbeatEnabled — the
 *  cron/schedule fields are left untouched so any owner can turn theirs back on from
 *  the builder (influencers.updateHeartbeat) and resume where they left off. */
export const disableAllHeartbeatsData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("influencers").collect();
    let paused = 0;
    for (const a of agents) {
      if (a.heartbeatEnabled !== true) continue;
      await ctx.db.patch(a._id, { heartbeatEnabled: false });
      paused += 1;
    }
    return { paused, total: agents.length };
  },
});

export const fireHeartbeatData = internalMutation({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const agent = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!agent) throw new Error("Agent not found");
    await ctx.db.patch(agent._id, { heartbeatEnabled: true, heartbeatLastFiredAt: 0 });
    return { ok: true };
  },
});

export const adjustPaperBalanceData = internalMutation({
  args: { mintAddress: v.string(), amount: v.number() },
  handler: async (ctx, { mintAddress, amount }) => {
    const agent = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!agent) throw new Error("Agent not found");
    const next = Math.max(0, (agent.paperUsdcBalance ?? 0) + amount);
    await ctx.db.patch(agent._id, { paperUsdcBalance: next });
    return { ok: true, balance: next };
  },
});

// NOTE: the raw `deleteAgentData` row-delete that used to live here was REMOVED.
// It wiped the influencers row — INCLUDING the agent's encrypted wallet key —
// WITHOUT refunding the wallet's USDC or freeing the upload-post slot, so any
// leftover balance became permanently unrecoverable. `deleteAgent` below now
// routes through /api/agents/delete (refund owner → free slot → delete).

export const updateAgent = action({
  args: {
    accessToken: v.string(),
    mintAddress: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      handle: v.optional(v.string()),
      niche: v.optional(v.string()),
      language: v.optional(v.string()),
      archetype: v.optional(v.string()),
      agentType: v.optional(v.string()),
      description: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      tvl: v.optional(v.number()),
      monthlyEarnings: v.optional(v.number()),
      sharePrice: v.optional(v.number()),
      totalShares: v.optional(v.number()),
      availableShares: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { accessToken, mintAddress, patch }): Promise<Ok> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.admin.updateAgentData, { mintAddress, patch });
  },
});

export const setAgentHeartbeat = action({
  args: { accessToken: v.string(), mintAddress: v.string(), enabled: v.optional(v.boolean()), cron: v.optional(v.string()) },
  handler: async (ctx, { accessToken, mintAddress, enabled, cron }): Promise<Ok> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.admin.setAgentHeartbeatData, { mintAddress, enabled, cron });
  },
});

export const fireHeartbeatNow = action({
  args: { accessToken: v.string(), mintAddress: v.string() },
  handler: async (ctx, { accessToken, mintAddress }): Promise<Ok> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.admin.fireHeartbeatData, { mintAddress });
  },
});

export const adjustAgentPaperBalance = action({
  args: { accessToken: v.string(), mintAddress: v.string(), amount: v.number() },
  handler: async (ctx, { accessToken, mintAddress, amount }): Promise<{ ok: boolean; balance: number }> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.admin.adjustPaperBalanceData, { mintAddress, amount });
  },
});

/**
 * Admin-only DELETE of an agent. Admin-gated (accessToken → resolveAdmin), then
 * routed through /api/agents/delete — the ONE correct teardown: it (0) REFUNDS
 * the agent wallet's leftover USDC to the OWNER (platform-sponsored gas via
 * PLATFORM_FEE_PAYER_SECRET; ABORTS the delete if the refund fails so funds are
 * never orphaned), (1) frees the upload-post profile slot (deleteProfile), then
 * (2) deletes influencers + agentAccount. The route's X-Internal-Secret path
 * skips per-agent ownership, so an admin can delete ANY agent while the refund
 * still goes to that agent's own owner.
 */
export const deleteAgent = action({
  args: { accessToken: v.string(), mintAddress: v.string() },
  handler: async (
    ctx,
    { accessToken, mintAddress },
  ): Promise<{ ok: boolean; refund?: unknown; profileFreed?: boolean }> => {
    await resolveAdmin(ctx, accessToken);
    const base = process.env.NEXT_PUBLIC_APP_URL;
    const secret = process.env.INTERNAL_CRON_SECRET;
    if (!base || !secret) {
      throw new Error("NEXT_PUBLIC_APP_URL / INTERNAL_CRON_SECRET must be set for admin delete");
    }
    const res = await appFetch(`/api/agents/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": secret },
      body: JSON.stringify({ mintAddress }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean; error?: string; refund?: unknown; profileFreed?: boolean;
    };
    if (!res.ok || !data.ok) throw new Error(data.error || `delete failed (${res.status})`);
    return { ok: true, refund: data.refund, profileFreed: data.profileFreed };
  },
});

/* ── Oracle / on-chain payout ───────────────────────────────────────────── */

/**
 * Admin-only "Run oracle + crank now": force the on-chain campaign payout on
 * demand instead of waiting for the crons (runDueOracle every 30 min →
 * /api/oracle/run; runClaimPayouts every 10 min → /api/oracle/claim). Admin-gated
 * (accessToken → resolveAdmin), then POSTs the two already-X-Internal-Secret-gated
 * oracle routes with that same secret — mirrors the `deleteAgent` fetch pattern.
 * This ONLY triggers the existing endpoints: it does not touch the oracle/crank
 * logic or the on-chain dispute window. Returns each route's JSON body so the
 * admin UI can summarize settled/deferred/claimed (and the dispute-window no-op).
 */
export const runOraclePayout = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<{ ok: boolean; oracle: unknown; crank: unknown }> => {
    await resolveAdmin(ctx, accessToken);
    const base = process.env.NEXT_PUBLIC_APP_URL;
    const secret = process.env.INTERNAL_CRON_SECRET;
    if (!base || !secret) {
      throw new Error("NEXT_PUBLIC_APP_URL / INTERNAL_CRON_SECRET must be set to run the oracle");
    }
    const headers = { "Content-Type": "application/json", "X-Internal-Secret": secret };

    // 1) Attest matured submissions on-chain (record_performance / reject_clip).
    const oracleRes = await appFetch(`/api/oracle/run`, { method: "POST", headers });
    const oracle = (await oracleRes.json().catch(() => ({}))) as { error?: string };
    if (!oracleRes.ok) throw new Error(oracle.error || `oracle run failed (${oracleRes.status})`);

    // 2) Crank claim_payout for every attested, past-dispute-window submission.
    const crankRes = await appFetch(`/api/oracle/claim`, { method: "POST", headers });
    const crank = (await crankRes.json().catch(() => ({}))) as { error?: string };
    if (!crankRes.ok) throw new Error(crank.error || `claim crank failed (${crankRes.status})`);

    return { ok: true, oracle, crank };
  },
});

/* ── Campaigns ──────────────────────────────────────────────────────────── */

// NOTE: this edits the Convex/DB row ONLY. It does NOT move on-chain USDC or
// touch the campaign's escrow vault — the on-chain deposit path is the separate
// admin "Deposit to escrow" action (topUpCampaignTx → /api/campaigns/topup).
export const updateCampaignData = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    status: v.optional(v.string()),
    budget: v.optional(v.number()),
    deadline: v.optional(v.string()),
    ratePerThousandViews: v.optional(v.number()),
  },
  handler: async (ctx, { campaignId, status, budget, deadline, ratePerThousandViews }) => {
    const patch: Record<string, unknown> = {};
    if (status !== undefined) patch.status = status;
    if (budget !== undefined) patch.budget = budget;
    if (deadline !== undefined) patch.deadline = deadline;
    if (ratePerThousandViews !== undefined) patch.ratePerThousandViews = ratePerThousandViews;
    await ctx.db.patch(campaignId, patch);
    return { ok: true };
  },
});

export const updateCampaign = action({
  args: {
    accessToken: v.string(),
    campaignId: v.id("campaigns"),
    status: v.optional(v.string()),
    budget: v.optional(v.number()),
    deadline: v.optional(v.string()),
    ratePerThousandViews: v.optional(v.number()),
  },
  handler: async (ctx, { accessToken, campaignId, status, budget, deadline, ratePerThousandViews }): Promise<Ok> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.admin.updateCampaignData, { campaignId, status, budget, deadline, ratePerThousandViews });
  },
});
