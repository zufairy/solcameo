import { v } from "convex/values";
import { mutation } from "./_generated/server";

// Mint a one-time upload URL; the Next route POSTs the video bytes to it.
export const generateUploadUrl = mutation(async (ctx) => await ctx.storage.generateUploadUrl());

// Resolve a stored object's public URL after upload.
export const resolveStorageUrl = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => await ctx.storage.getUrl(storageId),
});

// Delete an uploaded source blob after its clips are rendered — the source is
// transient (only the clip blobs are kept). Best-effort: ignore a bad id.
// SECRET-GATED: this can delete ANY storage object by id, so it must never be
// callable directly from the browser. Server callers (clipJobs action, the
// /api/clip-storage/delete route) forward INTERNAL_CRON_SECRET.
export const deleteStorage = mutation({
  args: { storageId: v.string(), authSecret: v.string() },
  handler: async (ctx, { storageId, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    try { await ctx.storage.delete(storageId as unknown as never); return { ok: true as const }; }
    catch { return { ok: false as const }; }
  },
});
