import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createWorkspace = mutation({
  args: {
    ownerWallet: v.string(),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    audience: v.optional(v.string()),
    knowledgeBaseText: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Ensure slug is unique by appending timestamp suffix if taken
    const existing = await ctx.db
      .query("builderWorkspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    const slug = existing ? `${args.slug}-${Date.now()}` : args.slug;

    const id = await ctx.db.insert("builderWorkspaces", {
      ...args,
      slug,
      status: "active",
    });

    return { id, slug };
  },
});

export const createProduct = mutation({
  args: {
    workspaceId: v.id("builderWorkspaces"),
    ownerWallet: v.string(),
    name: v.string(),
    headline: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    deliverables: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("builderProducts", {
      ...args,
      status: "active",
    });
    return { id };
  },
});

export const createCampaign = mutation({
  args: {
    workspaceId: v.id("builderWorkspaces"),
    productId: v.optional(v.id("builderProducts")),
    ownerWallet: v.string(),
    name: v.string(),
    angle: v.optional(v.string()),
    campaignType: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    budgetUsdc: v.optional(v.number()),
    ratePerThousandViews: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("builderCampaigns", {
      ...args,
      status: "draft",
    });
    return { id };
  },
});

export const getWorkspaceBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return ctx.db
      .query("builderWorkspaces")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
  },
});

export const listWorkspacesByOwner = query({
  args: { ownerWallet: v.string() },
  handler: async (ctx, { ownerWallet }) => {
    return ctx.db
      .query("builderWorkspaces")
      .withIndex("by_owner", (q) => q.eq("ownerWallet", ownerWallet))
      .order("desc")
      .take(20);
  },
});

export const listActiveCampaigns = query({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db
      .query("builderCampaigns")
      .collect();

    // Enrich with workspace info
    return Promise.all(
      campaigns.map(async (c) => {
        const workspace = await ctx.db.get(c.workspaceId);
        const product = c.productId ? await ctx.db.get(c.productId) : null;
        return { ...c, workspace, product };
      })
    );
  },
});
