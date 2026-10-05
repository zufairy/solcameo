import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Create a download job (status "downloading"); the Next route fills it async. */
export const create = mutation({
  args: { sourceUrl: v.string(), authSecret: v.string() },
  handler: async (ctx, { sourceUrl, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    return await ctx.db.insert("downloadJobs", { sourceUrl, status: "downloading", at: Date.now() });
  },
});

export const setResult = mutation({
  args: { id: v.id("downloadJobs"), status: v.union(v.literal("done"), v.literal("error")), url: v.optional(v.string()), durationSeconds: v.optional(v.number()), error: v.optional(v.string()), authSecret: v.string() },
  handler: async (ctx, { id, status, url, durationSeconds, error, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    await ctx.db.patch(id, { status, url, durationSeconds, error, at: Date.now() });
  },
});

/**
 * Live byte progress from the running download (throttled by the caller). The
 * schema is at the TS type-complexity ceiling, so rather than add a field we
 * stash the JSON progress in the existing `error` slot WHILE downloading — it's
 * unused until a real failure, and setResult overwrites it on done/error.
 * download-status reads it back as `progress` only while status is "downloading".
 */
export const setProgress = mutation({
  args: { id: v.id("downloadJobs"), pct: v.number(), downloadedBytes: v.number(), totalBytes: v.number(), speed: v.optional(v.string()), stage: v.optional(v.string()), authSecret: v.string() },
  handler: async (ctx, { id, pct, downloadedBytes, totalBytes, speed, stage, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const job = await ctx.db.get(id);
    if (!job || job.status !== "downloading") return; // don't clobber a finished/errored job
    // `at` doubles as the heartbeat reapStaleDownloads checks — a live pull keeps it fresh.
    await ctx.db.patch(id, { error: JSON.stringify({ pct, downloadedBytes, totalBytes, ...(speed ? { speed } : {}), ...(stage ? { stage } : {}) }), at: Date.now() });
  },
});

/** A job silent this long is dead — the download runs inside the Next process,
 *  so a server restart/deploy mid-pull strands the row on "downloading" forever
 *  (the editor's persisted card then spins indefinitely). Mirrored client-side
 *  in VideoEditorTab's DownloadJobCard. */
const DOWNLOAD_STALE_MS = 30 * 60_000;

/** Cron: fail orphaned "downloading" rows with no heartbeat past DOWNLOAD_STALE_MS. */
export const reapStaleDownloads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let reaped = 0;
    // No status index (schema is at the type-complexity ceiling) — scan the recent tail.
    const rows = await ctx.db.query("downloadJobs").order("desc").take(1000);
    for (const j of rows) {
      if (j.status !== "downloading" || now - j.at < DOWNLOAD_STALE_MS) continue;
      await ctx.db.patch(j._id, { status: "error", error: "Download stalled — no progress for 30 min. Paste the link again to retry.", at: now });
      reaped++;
    }
    return { reaped };
  },
});

export const get = query({
  args: { id: v.id("downloadJobs") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});
