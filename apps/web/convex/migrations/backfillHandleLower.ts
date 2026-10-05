import { internalMutation } from "../_generated/server";
import { uniqueHandleLower } from "../influencers";

/**
 * One-off backfill for the /market/<handle> URL scheme — every influencer row
 * created before `handleLower` existed has it undefined. Processes oldest-first
 * (by _creationTime) so the earliest agent to claim a handle keeps the bare
 * slug; a later duplicate gets auto-suffixed (uniqueHandleLower, same rule new
 * agents already get at creation). Safe to re-run: rows that already have
 * `handleLower` are skipped.
 *
 * Run once via `npx convex run migrations/backfillHandleLower:run` after
 * deploying this schema change — never `convex dev`.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("influencers").order("asc").collect();
    let updated = 0;
    for (const row of rows) {
      if (row.handleLower) continue;
      const handleLower = await uniqueHandleLower(ctx, row.handle, row._id);
      await ctx.db.patch(row._id, { handleLower });
      updated++;
    }
    return { scanned: rows.length, updated };
  },
});
