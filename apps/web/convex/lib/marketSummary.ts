import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Per-coin counters the market list reads instead of counting follow and episode rows on every run. Writers keep
 * them current in the same transaction as the row they add or remove, so they cannot drift from the source rows;
 * `rebuildMarketSummary` repairs any coin that predates this table.
 */
const COUNT_CAP = 5000;

/** Count a coin's rows from the source tables (bounded). */
export async function countSources(ctx: MutationCtx, tokenId: Id<"ssTokens">, characterId: Id<"ssCharacters">) {
  const episodes = await ctx.db.query("ssEpisodes").withIndex("by_token", (q) => q.eq("tokenId", tokenId)).take(COUNT_CAP);
  const followers = (await ctx.db.query("ssFollows").withIndex("by_character", (q) => q.eq("characterId", characterId)).take(COUNT_CAP)).length;
  const latest = episodes.reduce<(typeof episodes)[number] | undefined>((a, e) => (!a || e.index > a.index ? e : a), undefined);
  return { followers, episodes: episodes.length, posterUrl: latest?.posterUrl };
}

/**
 * The coin's summary row. A row created here is counted from the source tables, which already include the write
 * that triggered this call, so `fresh` tells the caller not to apply its delta a second time.
 */
async function row(ctx: MutationCtx, tokenId: Id<"ssTokens">) {
  const existing = await ctx.db.query("ssMarketSummary").withIndex("by_token", (q) => q.eq("tokenId", tokenId)).unique();
  if (existing) return { doc: existing, fresh: false };
  const token = await ctx.db.get(tokenId);
  if (!token) return null;
  const counts = await countSources(ctx, tokenId, token.characterId);
  const id = await ctx.db.insert("ssMarketSummary", { tokenId, characterId: token.characterId, ...counts, updatedAt: Date.now() });
  return { doc: (await ctx.db.get(id))!, fresh: true };
}

/** Call after inserting or deleting follow rows. */
export async function adjustFollowers(ctx: MutationCtx, characterId: Id<"ssCharacters">, delta: number): Promise<void> {
  const token = await ctx.db.query("ssTokens").withIndex("by_character", (q) => q.eq("characterId", characterId)).unique();
  const r = token && (await row(ctx, token._id));
  if (r && !r.fresh) await ctx.db.patch(r.doc._id, { followers: Math.max(0, r.doc.followers + delta), updatedAt: Date.now() });
}

/** Call after inserting an episode row. */
export async function recordEpisodeAdded(ctx: MutationCtx, tokenId: Id<"ssTokens">, posterUrl: string): Promise<void> {
  const r = await row(ctx, tokenId);
  if (r && !r.fresh) await ctx.db.patch(r.doc._id, { episodes: r.doc.episodes + 1, posterUrl: posterUrl || r.doc.posterUrl, updatedAt: Date.now() });
}
