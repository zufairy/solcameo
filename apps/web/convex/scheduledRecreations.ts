import { autoScheduleVideoToX } from "./scheduledContent";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DAY_MS = 86_400_000;
const MAX_ACTIVE_PER_AGENT = 20;
const MAX_REPEATS = 30;
const modeV = v.union(v.literal("motion-transfer"), v.literal("object-swap"));
const resV = v.union(v.literal("480p"), v.literal("720p"), v.literal("1080p"));
const repeatV = v.union(v.literal("once"), v.literal("daily"), v.literal("weekly"));

function gate(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
}

/** Queue a render. Called by the owner-authorised Next route. */
export const create = mutation({
  args: {
    authSecret: v.string(), mintAddress: v.string(), referenceId: v.string(), referenceTitle: v.string(), referencePoster: v.optional(v.string()),
    videoUrl: v.string(), imageUrls: v.array(v.string()), prompt: v.string(), mode: modeV, resolution: resV,
    runAt: v.number(), repeat: repeatV, repeatCount: v.optional(v.number()),
    durationSec: v.number(), autoPost: v.optional(v.boolean()),
  },
  handler: async (ctx, { authSecret, repeatCount, ...a }) => {
    gate(authSecret);
    const now = Date.now();
    if (a.runAt < now + 30_000) throw new Error("time_in_past");
    if (a.runAt > now + 366 * DAY_MS) throw new Error("time_too_far");
    if (!a.imageUrls.length || a.imageUrls.length > 8) throw new Error("invalid_images");
    const active = await ctx.db.query("scheduledRecreations").withIndex("by_mint", (q) => q.eq("mintAddress", a.mintAddress)).order("desc").take(100);
    if (active.filter((r) => r.status === "scheduled" || r.status === "running" || r.status === "submitted").length >= MAX_ACTIVE_PER_AGENT) throw new Error("too_many_scheduled");
    const remaining = a.repeat === "once" ? 1 : Math.min(MAX_REPEATS, Math.max(2, Math.floor(repeatCount ?? 7)));
    return ctx.db.insert("scheduledRecreations", { ...a, remaining, status: "scheduled", createdAt: now, updatedAt: now });
  },
});

/** An immediate (Generate now) render that was already billed and submitted, tracked so the cron can finish and auto-post it. */
export const recordSubmitted = mutation({
  args: {
    authSecret: v.string(), mintAddress: v.string(), referenceId: v.string(), referenceTitle: v.string(), referencePoster: v.optional(v.string()),
    videoUrl: v.string(), imageUrls: v.array(v.string()), prompt: v.string(), mode: modeV, resolution: resV,
    requestId: v.string(), durationSec: v.number(), billingRunId: v.string(), autoPost: v.boolean(),
  },
  handler: async (ctx, { authSecret, ...a }) => {
    gate(authSecret);
    const now = Date.now();
    return ctx.db.insert("scheduledRecreations", { ...a, runAt: now, repeat: "once", remaining: 1, status: "submitted", createdAt: now, updatedAt: now });
  },
});

export const markPosted = mutation({
  args: { authSecret: v.string(), id: v.id("scheduledRecreations"), caption: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, { authSecret, id, caption, error }) => {
    gate(authSecret);
    await ctx.db.patch(id, { postStatus: error ? "failed" : "posted", caption, postError: error?.slice(0, 300), updatedAt: Date.now() });
  },
});

export const listForMint = query({
  args: { authSecret: v.string(), mintAddress: v.string() },
  handler: async (ctx, { authSecret, mintAddress }) => {
    gate(authSecret);
    return ctx.db.query("scheduledRecreations").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).order("desc").take(40);
  },
});

export const cancel = mutation({
  args: { authSecret: v.string(), mintAddress: v.string(), id: v.id("scheduledRecreations") },
  handler: async (ctx, { authSecret, mintAddress, id }) => {
    gate(authSecret);
    const row = await ctx.db.get(id);
    if (!row || row.mintAddress !== mintAddress) throw new Error("not_found");
    if (row.status !== "scheduled") throw new Error("not_cancellable");
    await ctx.db.patch(id, { status: "cancelled", updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/** Cron: take due rows, mark them running, and queue the next occurrence for repeating schedules. */
export const claimDue = mutation({
  args: { authSecret: v.string(), limit: v.number() },
  handler: async (ctx, { authSecret, limit }) => {
    gate(authSecret);
    const now = Date.now();
    const due = await ctx.db.query("scheduledRecreations").withIndex("by_status_runAt", (q) => q.eq("status", "scheduled").lte("runAt", now)).take(Math.min(20, limit));
    for (const row of due) {
      await ctx.db.patch(row._id, { status: "running", updatedAt: now });
      if (row.repeat !== "once" && row.remaining > 1) {
        const { _id, _creationTime, requestId: _r, resultUrl: _u, error: _e, postStatus: _p, caption: _c, postError: _pe, billingRunId: _b, ...rest } = row;
        void _id; void _creationTime; void _r; void _u; void _e; void _p; void _c; void _pe; void _b;
        await ctx.db.insert("scheduledRecreations", { ...rest, runAt: row.runAt + (row.repeat === "daily" ? DAY_MS : 7 * DAY_MS), remaining: row.remaining - 1, status: "scheduled", createdAt: now, updatedAt: now });
      }
    }
    return due;
  },
});

export const markSubmitted = mutation({
  args: { authSecret: v.string(), id: v.id("scheduledRecreations"), requestId: v.string() },
  handler: async (ctx, { authSecret, id, requestId }) => { gate(authSecret); await ctx.db.patch(id, { status: "submitted", requestId, updatedAt: Date.now() }); },
});

export const markFailed = mutation({
  args: { authSecret: v.string(), id: v.id("scheduledRecreations"), error: v.string() },
  handler: async (ctx, { authSecret, id, error }) => { gate(authSecret); await ctx.db.patch(id, { status: "failed", error: error.slice(0, 300), updatedAt: Date.now() }); },
});

export const markCompleted = mutation({
  args: { authSecret: v.string(), id: v.id("scheduledRecreations"), resultUrl: v.string() },
  handler: async (ctx, { authSecret, id, resultUrl }) => {
    gate(authSecret);
    const row = await ctx.db.get(id);
    await ctx.db.patch(id, { status: "completed", resultUrl, updatedAt: Date.now() });
    // An opted-in replicated video joins the agent's automatic X schedule (when X is connected).
    if (row && row.autoPost) await autoScheduleVideoToX(ctx, { mintAddress: row.mintAddress, videoUrl: resultUrl, videoNote: row.referenceTitle }).catch(() => undefined);
  },
});

/** Cron: rows waiting on Higgsfield. Running rows older than 10 minutes were orphaned by a crash and are failed. */
export const listInFlight = query({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    gate(authSecret);
    const submitted = await ctx.db.query("scheduledRecreations").withIndex("by_status_runAt", (q) => q.eq("status", "submitted")).take(30);
    const stale = await ctx.db.query("scheduledRecreations").withIndex("by_status_runAt", (q) => q.eq("status", "running").lte("runAt", Date.now() - 10 * 60_000)).take(20);
    return { submitted, stale };
  },
});
