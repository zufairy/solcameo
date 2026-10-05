import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Server-side persistence for the clipping node graph (nodes + edges). Replaces
 * the old localStorage-only storage (clipGraphStorage) so the operator's pipeline
 * survives across devices/browsers and is the same for anyone viewing the agent.
 *
 * Keyed mint-preferred with a sessionId fallback — identical to agentSkillFiles —
 * so a minted agent reconfigured in another browser session still resolves to the
 * one canonical row. Mutations are keyed (no extra auth) to match the rest of the
 * builder's Convex surface (agentSkillFiles.setConfig/upsert/setWired).
 */

/** Mint-preferred lookup, sessionId fallback (matches agentSkillFiles). */
async function findRow(
  ctx: { db: any },
  mintAddress: string | undefined,
  sessionId: string,
) {
  if (mintAddress) {
    const byMint = await ctx.db
      .query("clipGraphs")
      .withIndex("by_mint", (q: any) => q.eq("mintAddress", mintAddress))
      .first();
    if (byMint) return byMint;
  }
  return await ctx.db
    .query("clipGraphs")
    .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
    .first();
}

/** Load the saved graph for this agent/session. Returns null when nothing saved
 *  yet (the canvas then falls back to its localStorage cache / template picker). */
export const getByKey = query({
  args: { mintAddress: v.optional(v.string()), sessionId: v.string() },
  handler: async (ctx, { mintAddress, sessionId }) => {
    const row = await findRow(ctx, mintAddress, sessionId);
    if (!row) return null;
    return { nodes: row.nodes, edges: row.edges, updatedAt: row.updatedAt };
  },
});

/** Upsert the graph (debounced from the canvas). Mint-preferred so reconfiguring a
 *  minted agent in a new session patches the same row instead of forking a draft. */
export const save = mutation({
  args: {
    mintAddress: v.optional(v.string()),
    sessionId: v.string(),
    nodes: v.any(),
    edges: v.any(),
  },
  handler: async (ctx, { mintAddress, sessionId, nodes, edges }) => {
    const existing = await findRow(ctx, mintAddress, sessionId);
    const patch = {
      nodes,
      edges,
      updatedAt: Date.now(),
      ...(mintAddress ? { mintAddress } : {}),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("clipGraphs", { mintAddress, sessionId, nodes, edges, updatedAt: Date.now() });
  },
});
