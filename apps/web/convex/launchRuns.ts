import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Secret gate for writes — every writer is server-side (the /api/launch/start
// route + the orchestrator) and holds INTERNAL_CRON_SECRET.
function requireSecret(authSecret: string): void {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const LAUNCHES_PER_DAY = 2;
export const LAUNCHES_LIFETIME = 6;

const clipShape = v.object({
  templateId: v.string(),
  templateLabel: v.string(),
  ok: v.boolean(),
  clipUrl: v.optional(v.string()),
  title: v.optional(v.string()),
  error: v.optional(v.string()),
});

/** Create a launch run at stage "analyzing". Throws `rate_limited` when the
 *  owner already launched LAUNCHES_PER_DAY times in 24h or LAUNCHES_LIFETIME
 *  overall — a Launch burns analysis + image + 3 video generations. */
export const create = mutation({
  args: {
    ownerDid: v.string(),
    creatorWallet: v.string(),
    websiteUrl: v.string(),
    sourceUrl: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { authSecret, ...args }) => {
    requireSecret(authSecret);
    const now = Date.now();
    const prior = await ctx.db
      .query("launchRuns")
      .withIndex("by_owner", (q) => q.eq("ownerDid", args.ownerDid))
      .collect();
    const recent = prior.filter((r) => now - r.createdAt < DAY_MS).length;
    if (recent >= LAUNCHES_PER_DAY || prior.length >= LAUNCHES_LIFETIME) {
      throw new Error("rate_limited");
    }
    return await ctx.db.insert("launchRuns", { ...args, stage: "analyzing", createdAt: now, updatedAt: now });
  },
});

/** Merge-patch one run as the orchestrator advances. */
export const patch = mutation({
  args: {
    runId: v.id("launchRuns"),
    authSecret: v.string(),
    stage: v.optional(v.string()),
    error: v.optional(v.string()),
    productSummary: v.optional(v.string()),
    agentName: v.optional(v.string()),
    handle: v.optional(v.string()),
    niche: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    mintAddress: v.optional(v.string()),
    ugcRunId: v.optional(v.id("ugcSampleRuns")),
    samplesSkipped: v.optional(v.boolean()),
    clips: v.optional(v.array(clipShape)),
    clipsError: v.optional(v.string()),
  },
  handler: async (ctx, { runId, authSecret, ...fields }) => {
    requireSecret(authSecret);
    const run = await ctx.db.get(runId);
    if (!run) return;
    const clean = Object.fromEntries(Object.entries(fields).filter(([, val]) => val !== undefined));
    await ctx.db.patch(runId, { ...clean, updatedAt: Date.now() });
  },
});

/** One run, live — /launch/[runId] subscribes to this. */
export const get = query({
  args: { runId: v.id("launchRuns") },
  handler: async (ctx, { runId }) => await ctx.db.get(runId),
});

/** An owner's launches, newest first. */
export const listByOwner = query({
  args: { ownerDid: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerDid, limit }) => {
    return await ctx.db
      .query("launchRuns")
      .withIndex("by_owner", (q) => q.eq("ownerDid", ownerDid))
      .order("desc")
      .take(Math.min(50, Math.max(1, limit ?? 10)));
  },
});
