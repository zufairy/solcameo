import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const gate = (authSecret: string) => {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
};

const decisionFields = {
  score: v.optional(v.number()),
  reasons: v.optional(v.array(v.string())),
  expectedViews: v.optional(v.number()),
  expectedPayoutUsdc: v.optional(v.number()),
  netUsdc: v.optional(v.number()),
  ratePerThousandViews: v.optional(v.number()),
  budgetRemainingUsdc: v.optional(v.number()),
  deadlineAt: v.optional(v.number()),
};

/** Work tab read: every campaign this agent has evaluated, newest decision first. */
export const listByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const rows = await ctx.db.query("campaignMemberships").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    return rows.sort((a, b) => (a.status === b.status ? (b.score ?? 0) - (a.score ?? 0) : a.status === "active" ? -1 : b.status === "active" ? 1 : 0));
  },
});

/** Campaign page: agents ACTIVELY working a campaign, newest join first —
 *  reactive, so the list and count update the moment an agent joins/leaves.
 *  Public-safe: only name/handle/avatar/type of already-public agents. */
export const joinedByCampaign = query({
  args: { campaignId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { campaignId, limit }) => {
    const cap = Math.min(Math.max(limit ?? 24, 1), 60);
    const rows = await ctx.db
      .query("campaignMemberships")
      .withIndex("by_campaign_status", (q) => q.eq("campaignId", campaignId).eq("status", "active"))
      .collect();
    rows.sort((a, b) => (b.joinedAt ?? b.updatedAt) - (a.joinedAt ?? a.updatedAt));
    const agents = await Promise.all(rows.slice(0, cap).map(async (m) => {
      const a = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", m.mintAddress)).first();
      return {
        mint: m.mintAddress,
        name: a?.name ?? "Agent",
        handle: a?.handle ?? null,
        avatarUrl: a?.avatarUrl ?? null,
        agentType: a?.agentType ?? null,
        decidedBy: m.decidedBy,
        joinedAt: m.joinedAt ?? m.updatedAt,
      };
    }));
    return { total: rows.length, agents };
  },
});

/** Scout read: keys of ACTIVE memberships (secret-gated, server only). */
export const activeKeysForMint = query({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }): Promise<string[]> => {
    gate(authSecret);
    const rows = await ctx.db.query("campaignMemberships").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    return rows.filter((r) => r.status === "active").map((r) => r.key);
  },
});

/** The agent's OWN verdict for one campaign. Never overrides an operator
 *  decision (join/leave from the Work tab) — it only refreshes the numbers. */
export const upsertAgentDecision = mutation({
  args: {
    mintAddress: v.string(), authSecret: v.string(),
    campaignId: v.optional(v.string()), contentRewardId: v.optional(v.string()),
    rail: v.string(), title: v.string(), verdict: v.string(), // "join" | "skip"
    ...decisionFields,
  },
  handler: async (ctx, { mintAddress, authSecret, campaignId, contentRewardId, rail, title, verdict, ...d }) => {
    gate(authSecret);
    const key = campaignId ?? contentRewardId;
    if (!key) throw new Error("campaignId or contentRewardId required");
    const now = Date.now();
    const existing = await ctx.db.query("campaignMemberships").withIndex("by_mint_key", (q) => q.eq("mintAddress", mintAddress).eq("key", key)).unique();
    const status = verdict === "join" ? "active" : "skipped";
    if (existing) {
      if (existing.decidedBy === "operator") {
        await ctx.db.patch(existing._id, { ...d, title, lastEvaluatedAt: now, updatedAt: now });
        return { ok: true as const, status: existing.status, decidedBy: "operator" as const };
      }
      await ctx.db.patch(existing._id, {
        ...d, title, status, lastEvaluatedAt: now, updatedAt: now,
        ...(status === "active" && existing.status !== "active" ? { joinedAt: now } : {}),
      });
      return { ok: true as const, status, decidedBy: "agent" as const };
    }
    await ctx.db.insert("campaignMemberships", {
      mintAddress, campaignId, contentRewardId, key, rail, title, status, decidedBy: "agent",
      ...d, lastEvaluatedAt: now, updatedAt: now, ...(status === "active" ? { joinedAt: now } : {}),
    });
    return { ok: true as const, status, decidedBy: "agent" as const };
  },
});

/** Operator override from the Work tab: join / leave / hand back to the agent. */
export const setOperatorDecision = mutation({
  args: {
    mintAddress: v.string(), authSecret: v.string(),
    campaignId: v.optional(v.string()), contentRewardId: v.optional(v.string()),
    rail: v.string(), title: v.string(),
    action: v.string(), // "join" | "leave" | "auto"
  },
  handler: async (ctx, { mintAddress, authSecret, campaignId, contentRewardId, rail, title, action }) => {
    gate(authSecret);
    const key = campaignId ?? contentRewardId;
    if (!key) throw new Error("campaignId or contentRewardId required");
    const now = Date.now();
    const existing = await ctx.db.query("campaignMemberships").withIndex("by_mint_key", (q) => q.eq("mintAddress", mintAddress).eq("key", key)).unique();
    if (action === "auto") {
      // Hand the decision back to the agent; its next evaluation sets status.
      if (existing) await ctx.db.patch(existing._id, { decidedBy: "agent", updatedAt: now });
      return { ok: true as const, status: existing?.status ?? "skipped", decidedBy: "agent" as const };
    }
    const status = action === "join" ? "active" : "left";
    if (existing) {
      await ctx.db.patch(existing._id, { status, decidedBy: "operator", updatedAt: now, ...(status === "active" && existing.status !== "active" ? { joinedAt: now } : {}) });
    } else {
      await ctx.db.insert("campaignMemberships", { mintAddress, campaignId, contentRewardId, key, rail, title, status, decidedBy: "operator", lastEvaluatedAt: now, updatedAt: now, ...(status === "active" ? { joinedAt: now } : {}) });
    }
    return { ok: true as const, status, decidedBy: "operator" as const };
  },
});
