import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Bounds so a client can't write unbounded knowledge (memory/cost DoS).
const MAX_CONTENT_CHARS = 20_000;
const MAX_ARRAY_LEN = 50;
const MAX_ENTRIES_PER_SESSION = 500;

export const saveEntry = mutation({
  args: {
    sessionId: v.string(),
    title: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    category: v.string(),
    links: v.array(v.string()),
    entryType: v.optional(v.string()),
    localId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const content = args.content.slice(0, MAX_CONTENT_CHARS);
    const tags = args.tags.slice(0, MAX_ARRAY_LEN);
    const links = args.links.slice(0, MAX_ARRAY_LEN);
    // Deduplicate by localId if provided
    if (args.localId) {
      const existing = await ctx.db
        .query("agentKnowledge")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .filter((q) => q.eq(q.field("localId"), args.localId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          title: args.title,
          content,
          tags,
          category: args.category,
          links,
        });
        return existing._id;
      }
    }
    const existingCount = await ctx.db
      .query("agentKnowledge")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(MAX_ENTRIES_PER_SESSION);
    if (existingCount.length >= MAX_ENTRIES_PER_SESSION) return null;
    return await ctx.db.insert("agentKnowledge", {
      ...args,
      content,
      tags,
      links,
    });
  },
});

/**
 * Persist an auto-learned knowledge entry for a MINTED agent (resolves the
 * builder session via nftDrafts). Used by the autonomy loop so tasks like the
 * trend audit and self-reflection write their full findings into the agent's
 * second brain — not just a one-line episodic memory. `localId` dedups (e.g.
 * one trend-audit entry per day, refreshed on re-runs) so the brain grows
 * steadily instead of flooding.
 */
export const saveEntryByMint = mutation({
  args: {
    mintAddress: v.string(),
    title: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    category: v.string(),
    entryType: v.optional(v.string()),
    localId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db
      .query("nftDrafts")
      .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress))
      .first();
    if (!draft) return null; // not minted / no builder session to attach to
    const sessionId = draft.sessionId;

    if (args.localId) {
      const existing = await ctx.db
        .query("agentKnowledge")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .filter((q) => q.eq(q.field("localId"), args.localId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          title: args.title,
          content: args.content,
          tags: args.tags,
          category: args.category,
        });
        return existing._id;
      }
    }
    return await ctx.db.insert("agentKnowledge", {
      sessionId,
      title: args.title,
      content: args.content,
      tags: args.tags,
      category: args.category,
      links: [],
      entryType: args.entryType ?? "auto_memory",
      localId: args.localId,
    });
  },
});

export const updateEntry = mutation({
  args: {
    id: v.id("agentKnowledge"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const deleteEntry = mutation({
  args: { id: v.id("agentKnowledge") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/** Wipe every knowledge entry for one agent's session — the Brain graph's "Delete All". */
export const deleteAllBySession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const rows = await ctx.db
      .query("agentKnowledge")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
});

export const listBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return ctx.db
      .query("agentKnowledge")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
  },
});

export const listByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const draft = await ctx.db
      .query("nftDrafts")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!draft) return [];
    return ctx.db
      .query("agentKnowledge")
      .withIndex("by_session", (q) => q.eq("sessionId", draft.sessionId))
      .collect();
  },
});

/** Aggregate knowledge stats for an agent — joins through nftDrafts to resolve sessionId. */
export const statsByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const draft = await ctx.db
      .query("nftDrafts")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!draft) return { count: 0, categories: [] as string[], totalChars: 0, recentTitles: [] as string[] };
    const entries = await ctx.db
      .query("agentKnowledge")
      .withIndex("by_session", (q) => q.eq("sessionId", draft.sessionId))
      .collect();
    const categories = [...new Set(entries.map((e) => e.category))];
    const totalChars = entries.reduce((s, e) => s + e.content.length, 0);
    const recentTitles = entries.slice(-3).map((e) => e.title);
    return { count: entries.length, categories, totalChars, recentTitles };
  },
});
