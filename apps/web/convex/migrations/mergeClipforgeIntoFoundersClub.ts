import { internalMutation } from "../_generated/server";

/**
 * One-off: "ClipForge AI" and "Founders Club Malaysia" (both owned by the same
 * wallet, fatinnasyurah@gmail.com) turned out to be the SAME real creator —
 * the human connected the same TikTok/Instagram/YouTube/Threads accounts under
 * two separate Vello agent rows. The user wants to keep Founders Club Malaysia
 * as the one agent going forward, with ClipForge's clip/view history folded in.
 *
 * What this does:
 * - Reassigns every `clips` row (view counts, post urls) and `clipJobs` row
 *   from ClipForge's mint to Founders Club's mint, so all analytics live under
 *   one agent.
 * - Copies ClipForge's connectedPlatforms/connectedSocialAccounts/follower
 *   fields onto Founders Club — cosmetic display fields only (the real
 *   upload-post OAuth link is keyed server-side by mintAddress and unaffected;
 *   Founders Club already posts successfully on its own connection).
 * - Retires ClipForge: clears its connected-account display fields and turns
 *   off clipConfig.autoPost so nothing posts under it again. The row itself is
 *   kept (not deleted) so nothing referencing its _id breaks.
 * - Founders Club's OWN settings (name, handle, description, niche,
 *   personality, clipConfig) are NEVER touched — only the fields listed above.
 *
 * Safe to re-run: once ClipForge has 0 clips/clipJobs left and autoPost is
 * already false, the second pass is a no-op.
 *
 * Run once via `npx convex run migrations/mergeClipforgeIntoFoundersClub:run`
 * — never `convex dev`.
 */

const CLIPFORGE_MINT = "DmjKScqdTeBR8EnTYMYg3S41K9LcKSr8Rn5KTba8Gdmb";
const FOUNDERS_CLUB_MINT = "4nD5WAZ3zKMqMKA8LyMwh54wDVxPTcerANrXvTjk315M";

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const clipforge = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", CLIPFORGE_MINT))
      .unique();
    const foundersClub = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", FOUNDERS_CLUB_MINT))
      .unique();
    if (!clipforge || !foundersClub) {
      throw new Error(`Missing agent row: clipforge=${!!clipforge} foundersClub=${!!foundersClub}`);
    }

    // 1) Reassign clip history (view counts, post urls) to Founders Club.
    const clips = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", CLIPFORGE_MINT)).collect();
    for (const c of clips) await ctx.db.patch(c._id, { mintAddress: FOUNDERS_CLUB_MINT });

    // 2) Reassign job history for consistency.
    const jobs = await ctx.db.query("clipJobs").withIndex("by_mint", (q) => q.eq("mintAddress", CLIPFORGE_MINT)).collect();
    for (const j of jobs) await ctx.db.patch(j._id, { mintAddress: FOUNDERS_CLUB_MINT });

    // 3) Copy the connection + follower display fields onto Founders Club —
    //    ClipForge's copy is the more complete one (Founders Club's is stale/empty).
    await ctx.db.patch(foundersClub._id, {
      connectedPlatforms: clipforge.connectedPlatforms,
      connectedSocialAccounts: clipforge.connectedSocialAccounts,
      followerCount: clipforge.followerCount,
      followerDelta24h: clipforge.followerDelta24h,
      followerHistory: clipforge.followerHistory,
      followersByPlatform: clipforge.followersByPlatform,
      followersSyncedAt: clipforge.followersSyncedAt,
    });

    // 4) Retire ClipForge: disconnect + stop auto-posting. Row kept, not deleted.
    await ctx.db.patch(clipforge._id, {
      connectedPlatforms: [],
      connectedSocialAccounts: {},
      clipConfig: { ...clipforge.clipConfig, autoPost: false },
    });

    return { clipsMoved: clips.length, jobsMoved: jobs.length };
  },
});
