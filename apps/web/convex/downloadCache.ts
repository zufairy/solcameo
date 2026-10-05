import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// Look up a previously-downloaded source by (url, mode, section) — used before
// spending a fresh yt-dlp pull + storage upload on a link/window that's
// already been fetched. Indexed on sourceUrl alone (see schema.ts comment) —
// at most ~3 rows share a URL (full/audio/segment variants), filtered in JS.
export const getByKey = query({
  args: { sourceUrl: v.string(), mode: v.string(), sectionKey: v.string() },
  handler: async (ctx, { sourceUrl, mode, sectionKey }) => {
    const rows = await ctx.db
      .query("downloadCache")
      .withIndex("by_url", (q) => q.eq("sourceUrl", sourceUrl))
      .collect();
    return rows.find((r) => (r.mode ?? "full") === mode && (r.sectionKey ?? "") === sectionKey) ?? null;
  },
});

// Record a freshly-downloaded source so the next paste of the same link (or
// re-cut of the same clip window) is served from Convex storage instead of
// re-downloading.
export const put = mutation({
  args: {
    sourceUrl: v.string(),
    mode: v.string(),
    sectionKey: v.string(),
    url: v.string(),
    storageId: v.string(),
    durationSeconds: v.optional(v.number()),
    mintAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("downloadCache")
      .withIndex("by_url", (q) => q.eq("sourceUrl", args.sourceUrl))
      .collect();
    const existing = rows.find((r) => (r.mode ?? "full") === args.mode && (r.sectionKey ?? "") === args.sectionKey);
    if (existing) {
      await ctx.db.patch(existing._id, {
        url: args.url,
        storageId: args.storageId,
        durationSeconds: args.durationSeconds,
        mintAddress: args.mintAddress ?? existing.mintAddress,
        createdAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("downloadCache", { ...args, createdAt: Date.now() });
  },
});

// All cached downloads attributed to one agent — powers the builder's
// "Downloads" tab. One row per unique source link (the newest activity for
// that link, whichever mode it was), newest first.
export const listByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const rows = await ctx.db
      .query("downloadCache")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .collect();
    const bySourceUrl = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const prev = bySourceUrl.get(r.sourceUrl);
      if (!prev || r.createdAt > prev.createdAt) bySourceUrl.set(r.sourceUrl, r);
    }
    return Array.from(bySourceUrl.values()).sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Multi-agent twin of listByMint — every cached download across ALL of the
// caller's agents, unioned into one newest-first list. Powers pickers (the JEV
// lab's video source list) that shouldn't require the user to first guess
// which of their agents happens to have downloads — a single-mint lookup went
// quietly empty whenever the DEFAULT-selected agent had none, even though
// another of the user's agents did. Deduped by sourceUrl across mints too (the
// same source can be downloaded under more than one agent).
export const listByMints = query({
  args: { mintAddresses: v.array(v.string()) },
  handler: async (ctx, { mintAddresses }) => {
    const mints = [...new Set(mintAddresses.filter(Boolean))];
    const bySourceUrl = new Map<string, { row: Doc<"downloadCache">; mintAddress: string }>();
    const groups = await Promise.all(mints.map(async (mint) => ({
      mint,
      rows: await ctx.db
        .query("downloadCache")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
        .order("desc")
        .collect(),
    })));
    for (const { mint, rows } of groups) {
      for (const r of rows) {
        // The picker needs a playable full source. Audio and segment variants
        // may be newer, but choosing one here and filtering it in the client
        // made the entire source disappear from /dev/jev.
        if ((r.mode ?? "full") !== "full") continue;
        const prev = bySourceUrl.get(r.sourceUrl);
        if (!prev || r.createdAt > prev.row.createdAt) bySourceUrl.set(r.sourceUrl, { row: r, mintAddress: mint });
      }
    }
    return Array.from(bySourceUrl.values())
      .map(({ row }) => row)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Remove a downloaded source from the builder's Videos/Downloads lists (cleanup).
// Secret-gated — reached via /api/downloads/delete after ownership-scoping the
// mint. Deletes every variant row (full/audio/segment) for that sourceUrl under
// this mint so the tile doesn't reappear as its audio twin. The stored blob is
// left in place (other rows/clips may still reference it).
export const removeBySource = mutation({
  args: { sourceUrl: v.string(), mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { sourceUrl, mintAddress, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const rows = await ctx.db.query("downloadCache").withIndex("by_url", (q) => q.eq("sourceUrl", sourceUrl)).collect();
    let deleted = 0;
    for (const r of rows) {
      if (r.mintAddress === mintAddress) { await ctx.db.delete(r._id); deleted++; }
    }
    return { ok: true, deleted };
  },
});
