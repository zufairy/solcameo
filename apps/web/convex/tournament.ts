import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Keep Clipping Tournament — public leaderboard data.
 *
 * Two READ-CAPPED queries instead of one platform-wide scan (Convex aborts a
 * query past 16,384 docs / 8 MiB; see clipJobs.ts totalVideosProduced):
 *   - roster:     every clipping agent (light projection, one collect over
 *                 influencers — ~100 rows).
 *   - agentStats: one agent's window totals off by_mint indexes, each table
 *                 capped. The page subscribes once per roster row and ranks in
 *                 lib/tournament/rank.ts, so a 60-agent board = 60 small live
 *                 subscriptions, never one giant one.
 */

const CLIPS_CAP = 1500;
const JOBS_CAP = 600;
const LEDGER_CAP = 2000;

function numberFrom(...values: unknown[]): number {
  for (const value of values) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  return 0;
}

/** Normalise a clip's recorded platform to the ids the Post Material cards chart. */
function platformKey(raw: unknown): string {
  const p = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!p) return "other";
  if (p === "twitter") return "x";
  if (p === "ig") return "instagram";
  if (p === "yt" || p === "youtube_shorts") return "youtube";
  if (p === "fb") return "facebook";
  return p;
}

function deltaFrom(...values: unknown[]): number {
  for (const value of values) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return 0;
}

export const roster = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("influencers").order("desc").collect();
    const seen = new Set<string>();
    const out: {
      mintAddress: string; name: string; handle: string; handleLower: string; avatarUrl: string; platforms: string[];
      // Real per-platform connected identity (id/handle/displayName) — set by the
      // syncConnectedSocials cron (see influencers.setConnectedPlatforms). Needed to
      // build a real "open their TikTok/Instagram/..." link: the Vello agent handle
      // is NOT the same as the connected account's own public @name.
      connectedSocialAccounts: Record<string, { id?: string; handle?: string; displayName?: string }>;
      followers: number; followerDelta: number; createdAt: number;
    }[] = [];
    for (const d of docs) {
      if ((d.agentType ?? "influencer") !== "clipping") continue;
      if (seen.has(d.mintAddress)) continue;
      seen.add(d.mintAddress);
      const extra = d as unknown as Record<string, unknown>;
      out.push({
        mintAddress: d.mintAddress,
        name: d.name,
        handle: d.handle,
        handleLower: d.handleLower ?? d.handle.toLowerCase(),
        avatarUrl: d.avatarUrl,
        platforms: (d.connectedPlatforms ?? []).filter((p): p is string => typeof p === "string"),
        connectedSocialAccounts: (d.connectedSocialAccounts ?? {}) as Record<string, { id?: string; handle?: string; displayName?: string }>,
        followers: numberFrom(extra.followers, extra.followerCount, extra.socialFollowers, extra.audienceFollowers),
        followerDelta: deltaFrom(extra.followersDelta24h, extra.followerDelta24h, extra.followersDelta, extra.followerDelta),
        createdAt: d._creationTime,
      });
    }
    return out;
  },
});

/** One agent's totals since `since` (epoch ms; omit = all time). */
export const agentStats = query({
  args: { mintAddress: v.string(), since: v.optional(v.number()) },
  handler: async (ctx, { mintAddress, since }) => {
    const from = since ?? 0;
    // Newest-first so a capped scan drops the OLDEST rows — the window we
    // care about is always the recent end.
    const clips = await ctx.db
      .query("clips")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(CLIPS_CAP);
    let views = 0, posted = 0, generated = 0, lastPostedAt: number | null = null;
    const byPlatform: Record<string, number> = {};
    for (const c of clips) {
      const t = c.postedAt ?? c.createdAt;
      if (c.createdAt >= from) generated++;
      if (c.status === "posted" && t >= from) {
        posted++;
        views += c.viewCount ?? 0;
        const pk = platformKey(c.platform);
        byPlatform[pk] = (byPlatform[pk] ?? 0) + (c.viewCount ?? 0);
        if (lastPostedAt === null || t > lastPostedAt) lastPostedAt = t;
      }
    }
    const jobs = await ctx.db
      .query("clipJobs")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(JOBS_CAP);
    const jobCount = jobs.filter((j) => j.createdAt >= from).length;

    const ledger = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint_at", (q) => q.eq("mintAddress", mintAddress).gte("at", from))
      .order("desc")
      .take(LEDGER_CAP);
    const ledgerCostUsdc = ledger.reduce((s, r) => s + (Number.isFinite(r.costUsdc) ? r.costUsdc : 0), 0);

    return {
      views,
      byPlatform,
      posted,
      generated,
      jobs: jobCount,
      ledgerCostUsdc,
      lastPostedAt,
      truncated: clips.length >= CLIPS_CAP || jobs.length >= JOBS_CAP || ledger.length >= LEDGER_CAP,
    };
  },
});
