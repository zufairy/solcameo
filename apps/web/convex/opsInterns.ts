import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Intern clipping roster + meeting dashboard.
 * Page is gated by /admin layout (isAdmin). Mutations mirror devTeamSchedule:
 * low-stakes ops writes from the admin UI only — no public product surface.
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("opsInterns").collect();
    rows.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });
    return rows.map((r) => ({
      id: r._id,
      name: r.name,
      note: r.note ?? "",
      mintAddresses: r.mintAddresses,
      active: r.active,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },
});

export const listClippingAgents = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("influencers").order("desc").collect();
    return docs
      .filter((d) => !d.agentType || d.agentType === "clipping" || d.agentType === "influencer")
      .map((d) => ({
        mintAddress: d.mintAddress,
        name: d.name,
        handle: d.handle ?? "",
        avatarUrl: d.avatarUrl ?? "",
        agentType: d.agentType ?? "",
        creatorWallet: d.creatorWallet ?? "",
      }));
  },
});

export const dashboard = query({
  args: {
    rangeStartMs: v.number(),
    rangeEndMs: v.number(),
  },
  handler: async (ctx, { rangeStartMs, rangeEndMs }) => {
    const start = Math.min(rangeStartMs, rangeEndMs);
    const end = Math.max(rangeStartMs, rangeEndMs);

    const interns = await ctx.db.query("opsInterns").collect();
    interns.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });

    const rosterMints = new Set<string>();
    for (const i of interns) for (const m of i.mintAddresses) rosterMints.add(m);

    // Posted clips in range (same index as analytics / admin posts).
    const postedClips = await ctx.db
      .query("clips")
      .withIndex("by_status_postedAt", (q) => q.eq("status", "posted").gte("postedAt", start))
      .take(5000);

    type ClipAgg = { posts: number; views: number; lastPostedAt: number | null };
    const byMint = new Map<string, ClipAgg>();
    for (const c of postedClips) {
      if (c.postedAt == null || c.postedAt < start || c.postedAt >= end) continue;
      if (rosterMints.size > 0 && !rosterMints.has(c.mintAddress)) continue;
      const cur = byMint.get(c.mintAddress) ?? { posts: 0, views: 0, lastPostedAt: null };
      cur.posts += 1;
      cur.views += c.viewCount ?? 0;
      if (cur.lastPostedAt == null || c.postedAt > cur.lastPostedAt) cur.lastPostedAt = c.postedAt;
      byMint.set(c.mintAddress, cur);
    }

    const agentCache = new Map<string, { name: string; handle: string; avatarUrl: string; agentType: string } | null>();
    const getAgent = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const a = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
        .first();
      const lite = a
        ? { name: a.name, handle: a.handle ?? "", avatarUrl: a.avatarUrl ?? "", agentType: a.agentType ?? "" }
        : null;
      agentCache.set(mint, lite);
      return lite;
    };

    let totalPosts = 0;
    let totalViews = 0;
    let totalAccounts = 0;
    let internsActive = 0;

    const out = [];
    for (const i of interns) {
      if (i.active) internsActive += 1;
      const accounts = [];
      let postsInRange = 0;
      let viewsInRange = 0;
      for (const mint of i.mintAddresses) {
        const agg = byMint.get(mint) ?? { posts: 0, views: 0, lastPostedAt: null };
        const agent = await getAgent(mint);
        postsInRange += agg.posts;
        viewsInRange += agg.views;
        totalAccounts += 1;
        accounts.push({
          mintAddress: mint,
          agentName: agent?.name ?? mint.slice(0, 8) + "…",
          agentHandle: agent?.handle ?? "",
          agentAvatar: agent?.avatarUrl ?? "",
          agentType: agent?.agentType ?? "",
          postsInRange: agg.posts,
          viewsInRange: agg.views,
          lastPostedAt: agg.lastPostedAt,
        });
      }
      // Stable: busiest accounts first
      accounts.sort((a, b) => b.postsInRange - a.postsInRange || b.viewsInRange - a.viewsInRange);
      totalPosts += postsInRange;
      totalViews += viewsInRange;
      out.push({
        id: i._id,
        name: i.name,
        note: i.note ?? "",
        active: i.active,
        mintAddresses: i.mintAddresses,
        postsInRange,
        viewsInRange,
        accounts,
      });
    }

    return {
      rangeStartMs: start,
      rangeEndMs: end,
      totals: {
        posts: totalPosts,
        views: totalViews,
        accounts: totalAccounts,
        internsActive,
      },
      interns: out,
    };
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("opsInterns")),
    name: v.string(),
    note: v.optional(v.string()),
    mintAddresses: v.array(v.string()),
    active: v.boolean(),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    const mints = [...new Set(args.mintAddresses.map((m) => m.trim()).filter(Boolean))];
    const now = Date.now();
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing) throw new Error("Intern not found");
      await ctx.db.patch(args.id, {
        name,
        note: args.note?.trim() || undefined,
        mintAddresses: mints,
        active: args.active,
        sortOrder: args.sortOrder ?? existing.sortOrder,
        updatedAt: now,
      });
      return args.id;
    }
    const all = await ctx.db.query("opsInterns").collect();
    const sortOrder = args.sortOrder ?? (all.length === 0 ? 0 : Math.max(...all.map((r) => r.sortOrder)) + 1);
    return await ctx.db.insert("opsInterns", {
      name,
      note: args.note?.trim() || undefined,
      mintAddresses: mints,
      active: args.active,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("opsInterns") },
  handler: async (ctx, { id }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Intern not found");
    await ctx.db.delete(id);
    return { ok: true as const };
  },
});
