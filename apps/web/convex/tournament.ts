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
const PAYOUTS_CAP = 500;
const HIGHLIGHT_SCAN = 600;

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
      agentWallet: string | null; lifetimeEarningsUsdc: number;
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
        agentWallet: d.agentWallet ?? null,
        lifetimeEarningsUsdc: Number.isFinite(d.lifetimeEarningsUsdc) ? (d.lifetimeEarningsUsdc as number) : 0,
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

    // Earnings = distribution payouts (verified work). `onchainUsdc` is the part
    // of that whose splits carry a tx signature, i.e. checkable on the cluster.
    const payouts = await ctx.db
      .query("distributions")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(PAYOUTS_CAP);
    let earningsUsdc = 0, earningsOnchainUsdc = 0, payoutCount = 0;
    for (const d of payouts) {
      if (d.createdAt < from || d.status === "failed") continue;
      payoutCount++;
      earningsUsdc += d.totalPayoutUsdc;
      for (const sp of d.splits) if (sp.status === "paid" && sp.txSignature) earningsOnchainUsdc += sp.usdc;
    }

    return {
      views,
      byPlatform,
      earningsUsdc,
      earningsOnchainUsdc,
      payoutCount,
      posted,
      generated,
      jobs: jobCount,
      ledgerCostUsdc,
      lastPostedAt,
      truncated: clips.length >= CLIPS_CAP || jobs.length >= JOBS_CAP || ledger.length >= LEDGER_CAP || payouts.length >= PAYOUTS_CAP,
    };
  },
});

/** Top posted clips by views since `since`. Scans only the newest HIGHLIGHT_SCAN
 *  posted clips off by_status_postedAt (never the whole table) and joins the
 *  clipping agent for display. */
export const topClips = query({
  args: { since: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { since, limit }) => {
    const rows = await ctx.db
      .query("clips")
      .withIndex("by_status_postedAt", (q) => q.eq("status", "posted").gte("postedAt", since ?? 0))
      .order("desc")
      .take(HIGHLIGHT_SCAN);
    const top = rows
      .filter((c) => !!c.clipUrl && (c.viewCount ?? 0) > 0)
      .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
      .slice(0, Math.min(Math.max(limit ?? 8, 1), 24));
    const agents = new Map<string, { name: string; handle: string; avatarUrl: string } | null>();
    for (const c of top) {
      if (agents.has(c.mintAddress)) continue;
      const a = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", c.mintAddress)).first();
      agents.set(c.mintAddress, a ? { name: a.name, handle: a.handle, avatarUrl: a.avatarUrl } : null);
    }
    return top.map((c) => ({
      id: c._id as string,
      title: c.title,
      clipUrl: c.clipUrl as string,
      postUrl: c.postUrl ?? null,
      platform: platformKey(c.platform),
      views: c.viewCount ?? 0,
      postedAt: c.postedAt ?? c.createdAt,
      mintAddress: c.mintAddress,
      agent: agents.get(c.mintAddress) ?? null,
    }));
  },
});

/** Wallet + most recent paid payout signatures per agent — the inputs the
 *  /api/tournament/onchain route needs to verify earnings against the RPC. */
export const onchainTargets = query({
  args: { mints: v.array(v.string()) },
  handler: async (ctx, { mints }) => {
    const out: { mintAddress: string; wallet: string | null; signatures: string[] }[] = [];
    for (const mintAddress of mints.slice(0, 120)) {
      const a = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).first();
      const dists = await ctx.db.query("distributions").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).order("desc").take(8);
      const signatures: string[] = [];
      for (const d of dists) for (const sp of d.splits) if (sp.status === "paid" && sp.txSignature && !signatures.includes(sp.txSignature)) signatures.push(sp.txSignature);
      out.push({ mintAddress, wallet: a?.agentWallet ?? null, signatures: signatures.slice(0, 6) });
    }
    return out;
  },
});
