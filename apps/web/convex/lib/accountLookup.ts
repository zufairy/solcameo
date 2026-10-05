import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export type AccountIdentity = { accountName?: string; accountEmail?: string };

/**
 * Resolve the Vello account behind an admin-list row, so admins see WHO asked
 * instead of a bare wallet / "Anonymous". Tries the verified identity (Privy
 * DID) first, then any linked wallet (walletLinks), then the legacy
 * `users.walletAddress` mirror. Memoised via `cache` because the admin lists
 * repeat the same wallet across many rows.
 */
export async function lookupAccount(
  ctx: QueryCtx,
  { did, wallet }: { did?: string; wallet?: string },
  cache: Map<string, Doc<"users"> | null>,
): Promise<AccountIdentity> {
  const key = `${did ?? ""}|${wallet ?? ""}`;
  if (!cache.has(key)) cache.set(key, await findUser(ctx, did, wallet));
  const user = cache.get(key);
  return user ? { accountName: user.name, accountEmail: user.email } : {};
}

async function findUser(ctx: QueryCtx, did?: string, wallet?: string): Promise<Doc<"users"> | null> {
  if (did) {
    const byDid = await ctx.db
      .query("users")
      .withIndex("by_supabase", (q) => q.eq("supabaseId", did))
      .first();
    if (byDid) return byDid;
  }
  if (wallet) {
    const link = await ctx.db
      .query("walletLinks")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", wallet))
      .first();
    if (link) {
      const linked = await ctx.db.get(link.userId);
      if (linked) return linked;
    }
    return await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", wallet))
      .first();
  }
  return null;
}
