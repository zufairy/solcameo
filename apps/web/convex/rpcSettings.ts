import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { resolveAdmin } from "./admin";

/**
 * Admin-controlled Solana RPC provider.
 *
 * The Next.js server reads `getProvider` (public, non-sensitive: it only names a provider, never a key) and orders its RPC
 * candidates accordingly, so an admin can move the whole app between QuickNode and Solami without a redeploy. Writes are
 * gated with resolveAdmin, the same pattern as adminPricing.
 */
export const RPC_PROVIDERS = ["quicknode", "solami"] as const;
const KEY = "provider";

export const getProvider = query({
  args: {},
  handler: async (ctx): Promise<{ provider: string | null; updatedAt: number | null; updatedByEmail: string | null }> => {
    const row = await ctx.db.query("rpcSettings").withIndex("by_key", (q) => q.eq("key", KEY)).first();
    return { provider: row?.provider ?? null, updatedAt: row?.updatedAt ?? null, updatedByEmail: row?.updatedByEmail ?? null };
  },
});

export const setProviderData = internalMutation({
  args: { provider: v.string(), updatedByEmail: v.string() },
  handler: async (ctx, { provider, updatedByEmail }) => {
    if (!(RPC_PROVIDERS as readonly string[]).includes(provider)) throw new Error("Unknown RPC provider");
    const row = await ctx.db.query("rpcSettings").withIndex("by_key", (q) => q.eq("key", KEY)).first();
    const next = { provider, updatedByEmail, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("rpcSettings", { key: KEY, ...next });
    return { ok: true as const, provider };
  },
});

export const setProvider = action({
  args: { accessToken: v.string(), provider: v.string() },
  handler: async (ctx, { accessToken, provider }): Promise<{ ok: true; provider: string }> => {
    const caller = await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.rpcSettings.setProviderData, {
      provider,
      updatedByEmail: caller.email ?? caller.walletAddress ?? "unknown-admin",
    });
  },
});
