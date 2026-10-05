import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";

/**
 * MASTER transcript+analysis cache (see schema.transcriptCache). Keyed by a
 * video's stable sourceKey so the same video — clipped by ANY agent — is
 * transcribed + analyzed exactly once. The Next transcribe route reads this
 * before calling ElevenLabs; on a miss it stores the result here.
 */

export const getByKey = query({
  args: { sourceKey: v.string() },
  handler: async (ctx, { sourceKey }) => {
    const row = await ctx.db
      .query("transcriptCache")
      .withIndex("by_source", (q) => q.eq("sourceKey", sourceKey))
      .first();
    if (!row) return null;
    return {
      version: row.version,
      durationSeconds: row.durationSeconds,
      transcriptUrl: await ctx.storage.getUrl(row.transcriptStorageId),
      analysis: row.analysis,
      provider: row.provider,
      language: row.language ?? null,
      sourceModifiedTime: row.sourceModifiedTime ?? null,
      createdAt: row.createdAt,
    };
  },
});

/**
 * Internal: given a batch of sourceKeys, return the subset that already have a
 * cached transcript row. Used by `campaignTranscribe.backfillStatus` to count
 * how many campaign sources are warm vs. still pending — without paying to
 * stream each (potentially large) transcript blob URL back.
 */
export const cachedKeys = internalQuery({
  args: { sourceKeys: v.array(v.string()) },
  handler: async (ctx, { sourceKeys }) => {
    const hits: string[] = [];
    for (const key of sourceKeys) {
      const row = await ctx.db
        .query("transcriptCache")
        .withIndex("by_source", (q) => q.eq("sourceKey", key))
        .first();
      if (row) hits.push(key);
    }
    return hits;
  },
});

export const put = mutation({
  args: {
    sourceKey: v.string(),
    version: v.number(),
    durationSeconds: v.number(),
    transcriptStorageId: v.id("_storage"),
    analysis: v.any(),
    provider: v.string(),
    language: v.optional(v.string()),
    sourceModifiedTime: v.optional(v.string()),
    createdAt: v.number(),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // SECRET-GATED: the sole caller is the /api/video/transcribe-clip server route.
    // Ungated, anyone could poison the shared transcript cache (fake transcripts feed
    // clip analysis/generation). The destructure keeps `authSecret` out of the row.
    const { authSecret, ...rest } = args;
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    // Upsert: drop any existing row(s) for this key (+ free their old blobs),
    // then insert the fresh one.
    const existing = await ctx.db
      .query("transcriptCache")
      .withIndex("by_source", (q) => q.eq("sourceKey", rest.sourceKey))
      .collect();
    for (const r of existing) {
      await ctx.storage.delete(r.transcriptStorageId).catch(() => {});
      await ctx.db.delete(r._id);
    }
    return await ctx.db.insert("transcriptCache", rest);
  },
});
