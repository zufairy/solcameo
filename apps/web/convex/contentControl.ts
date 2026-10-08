import { v } from "convex/values";
import { query, mutation, internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { appFetch } from "./lib/appFetch";
import { videoMilestoneIdentity } from "../lib/videoMilestoneKey";
import { agentLaunchCaption, videoMilestoneCaption, tokenLaunchCaption, coinsDigestCaption, videoLaunchCaption } from "../lib/marketingCaption";
import { marketPath } from "../lib/solstar/marketSlug";
import { bestMilestone, nextSlot, postClass, type PostedEntry } from "../lib/contentQuota";

/** The posting destination. Automatic posts never depend on someone pressing a button first: with nothing saved, they go to the marketing account, queue up, and publish by themselves as soon as X is connected. */
async function settingsFor(ctx: MutationCtx) {
  const row = await ctx.db.query("contentControlSettings").withIndex("by_key", q => q.eq("key", "marketing")).unique();
  if (row) return row;
  const id = await ctx.db.insert("contentControlSettings", { key: "marketing", autoAnnounce: true, autoMilestones: true, updatedAt: Date.now() });
  return (await ctx.db.get(id))!;
}
function authorize(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("Unauthorized");
}
export async function enqueueAgentAnnouncement(ctx: MutationCtx, agent: { mintAddress: string; name: string; handle: string; description: string; niche: string; avatarUrl: string; agentType?: string }) {
  const settings = await settingsFor(ctx);
  // Always on: every new mint is announced to the selected destination (or the Vello marketing account).
  const dedupeKey = `agent-launch:${agent.mintAddress}`;
  if (await ctx.db.query("contentControlPosts").withIndex("by_dedupeKey", q => q.eq("dedupeKey", dedupeKey)).unique()) return;
  const id = await ctx.db.insert("contentControlPosts", {
    dedupeKey, source: "mint", targetMint: settings.targetMint, agentMint: agent.mintAddress,
    agentName: agent.name, caption: agentLaunchCaption(agent), mediaUrl: agent.avatarUrl,
    kind: "photo", platforms: ["x"], status: "queued", attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.contentControl.dispatch, { id });
}
const SITE = "https://solcameo.com";
const LIVE_STATES = new Set(["live", "graduated", "migrated"]);
/** A coin that just went live on mainnet: queue one announcement with a ticker-first caption and its card. */
export async function enqueueTokenAnnouncement(ctx: MutationCtx, tokenId: Id<"ssTokens">) {
  const settings = await settingsFor(ctx);
  const token = await ctx.db.get(tokenId);
  if (!token || token.network !== "mainnet" || !LIVE_STATES.has(token.state) || !token.ticker) return;
  const dedupeKey = `token-launch:${tokenId}`;
  if (await ctx.db.query("contentControlPosts").withIndex("by_dedupeKey", q => q.eq("dedupeKey", dedupeKey)).unique()) return;
  const character = await ctx.db.get(token.characterId);
  const id = await ctx.db.insert("contentControlPosts", {
    dedupeKey, source: "token", targetMint: settings.targetMint, tokenId, agentName: token.name,
    caption: tokenLaunchCaption({ name: token.name, ticker: token.ticker, bio: character?.bio || token.description, category: character?.category, url: `${SITE}${marketPath({ characterId: String(token.characterId), ticker: token.ticker })}` }),
    mediaUrl: character?.referenceImageUrl, kind: "photo", platforms: ["x"], status: "queued", attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.contentControl.dispatch, { id });
}
/** Roundup of the coins minted in the last 24 hours. One per 6 hour window; nothing is posted on a quiet day. */
async function enqueueCoinsDigest(ctx: MutationCtx, force: boolean) {
  const settings = await settingsFor(ctx);
  const now = Date.now(), live = (await ctx.db.query("ssTokens").withIndex("by_network", q => q.eq("network", "mainnet")).order("desc").take(500)).filter(t => LIVE_STATES.has(t.state) && t.ticker);
  const fresh = live.filter(t => t.createdAt >= now - 24 * 3_600_000);
  if (!fresh.length) return { queued: false as const, reason: "No coins were minted in the last 24 hours" };
  const dedupeKey = force ? `coins-digest:manual:${now}` : `coins-digest:${Math.floor(now / (6 * 3_600_000))}`;
  if (await ctx.db.query("contentControlPosts").withIndex("by_dedupeKey", q => q.eq("dedupeKey", dedupeKey)).unique()) return { queued: false as const, reason: "Already queued for this window" };
  const id = await ctx.db.insert("contentControlPosts", {
    dedupeKey, source: "digest", targetMint: settings.targetMint, agentName: `${fresh.length} new coins`,
    caption: coinsDigestCaption({ count: fresh.length, tickers: fresh.map(t => t.ticker), total: live.length, url: SITE }),
    kind: "photo", platforms: ["x"], status: "queued", attempts: 0, createdAt: now, updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.contentControl.dispatch, { id });
  return { queued: true as const, id };
}
/**
 * Network statistics, twice a day at random-looking hours (one morning slot, one evening slot, UTC, different every day), each
 * showing a different card (views, leaderboard, platforms, clip engine, new agents) chosen by the day. The post is queued
 * empty: the worker builds the card from live data and writes the caption with the real numbers when it publishes.
 */
export const STAT_KINDS = ["network", "leaderboard", "social", "engine", "minted"] as const;
const mix = (n: number, salt: number) => { const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };
async function enqueueStatPost(ctx: MutationCtx, opts: { now: number; force?: boolean; kind?: string }) {
  const settings = await settingsFor(ctx);
  const day = Math.floor(opts.now / 86_400_000), hour = new Date(opts.now).getUTCHours();
  const targets = [8 + Math.floor(mix(day, 1) * 5), 14 + Math.floor(mix(day, 2) * 7)];
  const slots = opts.force ? [{ slot: `manual:${opts.now}`, salt: opts.now % 997 }] : targets.flatMap((t, i) => (hour >= t ? [{ slot: `${i}`, salt: i + 1 }] : []));
  let queued: Id<"contentControlPosts"> | null = null;
  for (const { slot, salt } of slots) {
    const dedupeKey = `stat:${day}:${slot}`;
    if (await ctx.db.query("contentControlPosts").withIndex("by_dedupeKey", q => q.eq("dedupeKey", dedupeKey)).unique()) continue;
    const kind = opts.kind && (STAT_KINDS as readonly string[]).includes(opts.kind) ? opts.kind : STAT_KINDS[Math.floor(mix(day, salt + 9) * STAT_KINDS.length)];
    const id = await ctx.db.insert("contentControlPosts", {
      dedupeKey, source: "stat", statKind: kind, targetMint: settings.targetMint, agentName: `Network stats: ${kind}`, caption: "Network stats", kind: "video", platforms: ["x"],
      status: "queued", attempts: 0, createdAt: opts.now, updatedAt: opts.now,
    });
    await ctx.scheduler.runAfter(0, internal.contentControl.dispatch, { id });
    queued = id;
    if (!opts.force) break; // a late tick catches up one slot at a time, never a burst
  }
  return queued;
}
export const statCron = internalMutation({ args: {}, handler: async (ctx) => { await enqueueStatPost(ctx, { now: Date.now() }); } });
export const statNow = mutation({
  args: { authSecret: v.string(), kind: v.optional(v.string()) },
  handler: async (ctx, { authSecret, kind }) => { authorize(authSecret); const id = await enqueueStatPost(ctx, { now: Date.now(), force: true, kind }); return id ? { queued: true as const, id } : { queued: false as const, reason: "Could not queue a stats post" }; },
});
/** The worker writes the caption once the card's live numbers are known. */
export const setCaption = mutation({
  args: { authSecret: v.string(), id: v.id("contentControlPosts"), caption: v.string() },
  handler: async (ctx, { authSecret, id, caption }) => {
    authorize(authSecret);
    const post = await ctx.db.get(id);
    if (!post || post.status !== "publishing") throw new Error("Post is not being prepared");
    await ctx.db.patch(id, { caption: caption.slice(0, 600) });
  },
});
export const coinsDigestCron = internalMutation({ args: {}, handler: async (ctx) => { await enqueueCoinsDigest(ctx, false); } });
export const coinsDigestNow = mutation({ args: { authSecret: v.string() }, handler: async (ctx, { authSecret }) => { authorize(authSecret); return await enqueueCoinsDigest(ctx, true); } });
/** Data behind the coin cards: one coin (first, with its number) or the newest four, plus the 24 hour and total counts. */
export const coinCardData = query({
  args: { authSecret: v.string(), tokenId: v.optional(v.id("ssTokens")) },
  handler: async (ctx, { authSecret, tokenId }) => {
    authorize(authSecret);
    const now = Date.now(), live = (await ctx.db.query("ssTokens").withIndex("by_network", q => q.eq("network", "mainnet")).order("desc").take(500)).filter(t => LIVE_STATES.has(t.state) && t.ticker);
    const picked = tokenId ? [await ctx.db.get(tokenId)].filter((t): t is NonNullable<typeof t> => !!t) : live.filter(t => t.createdAt >= now - 24 * 3_600_000).slice(0, 4);
    const coins = await Promise.all((picked.length ? picked : live.slice(0, 4)).map(async t => {
      const c = await ctx.db.get(t.characterId);
      return { name: t.name, ticker: t.ticker, imageUrl: c?.referenceImageUrl, category: c?.category, createdAt: t.createdAt };
    }));
    const number = tokenId ? Math.max(1, live.length - live.findIndex(t => t._id === tokenId)) : undefined;
    return { coins, total: live.length, today: live.filter(t => t.createdAt >= now - 24 * 3_600_000).length, number };
  },
});
/**
 * A new video for a coin, posted as soon as it is rendered: the video itself with a caption that names the $TICKER and the
 * influencer. Agents without a live mainnet coin are skipped (no ticker to promote). One post per render job.
 */
export async function enqueueVideoAnnouncement(ctx: MutationCtx, job: { _id: Id<"videoRenderJobs">; mintAddress: string; videoUrl?: string; videoNote?: string }) {
  if (!job.videoUrl) return;
  const settings = await settingsFor(ctx);
  const dedupeKey = `video-new:${job._id}`;
  if (await ctx.db.query("contentControlPosts").withIndex("by_dedupeKey", q => q.eq("dedupeKey", dedupeKey)).unique()) return;
  const agent = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", job.mintAddress)).first();
  if (!agent?.solstarCharacterId) return;
  const token = await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", agent.solstarCharacterId!)).first();
  if (!token || token.network !== "mainnet" || !LIVE_STATES.has(token.state) || !token.ticker) return;
  const id = await ctx.db.insert("contentControlPosts", {
    dedupeKey, source: "video", targetMint: settings.targetMint, agentMint: job.mintAddress, tokenId: token._id, agentName: agent.name,
    caption: videoLaunchCaption({ name: token.name || agent.name, ticker: token.ticker, bio: agent.description, topic: job.videoNote, url: `${SITE}${marketPath({ characterId: String(token.characterId), ticker: token.ticker })}` }),
    mediaUrl: job.videoUrl, kind: "video", platforms: ["x"], status: "queued", attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.contentControl.dispatch, { id });
}
/** A per-video milestone, captured atomically with the trusted measurement. */
export async function enqueueVideoMilestone(ctx: MutationCtx, video: { mintAddress: string; views: number; key: string; postUrl?: string; platform?: string; platformPostId?: string; videoUrl?: string }) {
  // Only the 100k tier is announced now; every new coin video is posted when it is made (see enqueueVideoAnnouncement).
  if (!Number.isFinite(video.views) || video.views <= 100_000) return;
  const config = await ctx.db.query("contentControlSettings").withIndex("by_key", q => q.eq("key", "marketing")).unique();
  const agent = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", video.mintAddress)).first();
  if (!agent) return;
  const identity = videoMilestoneIdentity(video);
  // Two milestones per video: the first measurement past 10k, and a second one past 100k.
  const tier = "100k";
  const dedupeKey = `video-${tier}:${video.mintAddress}:${video.key}`;
  const videoPostKey = `video-${tier}:${video.mintAddress}:${identity}`;
  if (await ctx.db.query("contentControlPosts").withIndex("by_videoPostKey", q => q.eq("videoPostKey", videoPostKey)).first()) return;
  if (await ctx.db.query("contentControlPosts").withIndex("by_dedupeKey", q => q.eq("dedupeKey", dedupeKey)).unique()) return;
  let videoUrl = video.videoUrl;
  if (!videoUrl) {
    const clips = await ctx.db.query("clips").withIndex("by_mint", q => q.eq("mintAddress", video.mintAddress)).order("desc").take(100);
    videoUrl = clips.find(c => (video.postUrl && c.postUrl === video.postUrl) || (c.submissionId && video.key === `submission:${c.submissionId}`))?.clipUrl;
  }
  const id = await ctx.db.insert("contentControlPosts", {
    dedupeKey, videoPostKey, source: "milestone", targetMint: config?.targetMint, agentMint: video.mintAddress, agentName: agent.name,
    caption: videoMilestoneCaption(agent.name, video.views), kind: "photo", platforms: ["x"],
    milestoneViews: Math.floor(video.views), videoUrl, postUrl: video.postUrl, platform: video.platform,
    status: "queued", attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.contentControl.dispatch, { id });
}
export const state = query({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    authorize(authSecret);
    const settings = await ctx.db.query("contentControlSettings").withIndex("by_key", q => q.eq("key", "marketing")).unique();
    const agents = await ctx.db.query("influencers").order("desc").take(2000);
    const posts = await ctx.db.query("contentControlPosts").order("desc").take(100);
    return { settings, posts, agents: agents.map(a => ({ mintAddress: a.mintAddress, name: a.name, avatarUrl: a.avatarUrl, handle: a.handle, niche: a.niche, language: a.language, connectedPlatforms: a.connectedPlatforms })) };
  },
});
export const settings = mutation({
  // Mint announcements and 10k milestone posts are always on; these flags are accepted for older callers and ignored.
  args: { authSecret: v.string(), targetMint: v.optional(v.string()), autoAnnounce: v.optional(v.boolean()), autoMilestones: v.optional(v.boolean()) },
  handler: async (ctx, { authSecret, targetMint }) => {
    authorize(authSecret);
    if (targetMint && !await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", targetMint)).first()) throw new Error("Agent not found");
    const row = await ctx.db.query("contentControlSettings").withIndex("by_key", q => q.eq("key", "marketing")).unique();
    const data = { key: "marketing", targetMint, autoAnnounce: true, autoMilestones: true, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, data); else await ctx.db.insert("contentControlSettings", data);
  },
});
export const queue = mutation({
  args: { authSecret: v.string(), dedupeKey: v.string(), targetMint: v.optional(v.string()), caption: v.string(), mediaUrl: v.optional(v.string()), kind: v.string(), platforms: v.array(v.string()) },
  handler: async (ctx, { authSecret, ...data }) => {
    authorize(authSecret);
    const prior = await ctx.db.query("contentControlPosts").withIndex("by_dedupeKey", q => q.eq("dedupeKey", data.dedupeKey)).unique();
    if (prior) return prior._id;
    // Never post the same thing twice: an identical caption to the same account that is already
    // queued, publishing or posted in the last 30 minutes is reused instead of queued again.
    const recent = await ctx.db.query("contentControlPosts").order("desc").take(60);
    const same = recent.find(p => p.source === "manual" && p.caption === data.caption && p.targetMint === data.targetMint
      && ["queued", "publishing", "submitted", "posted"].includes(p.status) && p.createdAt > Date.now() - 30 * 60_000);
    if (same) return same._id;
    const id = await ctx.db.insert("contentControlPosts", { ...data, source: "manual", status: "queued", attempts: 0, createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.contentControl.dispatch, { id });
    return id;
  },
});
export const claim = mutation({
  args: { authSecret: v.string(), id: v.id("contentControlPosts") },
  handler: async (ctx, { authSecret, id }) => {
    authorize(authSecret);
    const post = await ctx.db.get(id);
    if (!post || !["queued", "publishing"].includes(post.status)) return null;
    if (post.status === "publishing" && post.updatedAt > Date.now() - 5 * 60_000) return null;
    const now = Date.now();
    if (post.status === "queued" && post.notBefore && post.notBefore > now) return null;
    const cls = postClass(post);
    if (post.status === "queued" && cls !== "manual") {
      // Daily budget: each automatic post type has its own quota, spacing and a shared reserve (see lib/contentQuota.ts).
      const cutoff = now - 24 * 3_600_000;
      const groups = await Promise.all(["posted", "submitted", "publishing"].map(status =>
        ctx.db.query("contentControlPosts").withIndex("by_status_and_updatedAt", q => q.eq("status", status).gt("updatedAt", cutoff)).take(100)));
      const history: PostedEntry[] = groups.flat().filter(p => p._id !== id && p.platforms.includes("x"))
        .map(p => ({ cls: postClass(p), at: p.publishedAt ?? p.updatedAt })).filter(h => h.at > cutoff);
      const slot = nextSlot(cls, history, now);
      if (!slot.ok) { await ctx.db.patch(id, { notBefore: slot.notBefore, error: `Scheduled: ${slot.reason}. Posts at ${new Date(slot.notBefore).toISOString()}`, updatedAt: now }); return null; }
      if (cls === "milestone100k") {
        // One slot, several waiting: the most-viewed milestone takes it.
        const waiting = (await ctx.db.query("contentControlPosts").withIndex("by_status_and_updatedAt", q => q.eq("status", "queued")).take(100))
          .filter(p => p.source === "milestone" && postClass(p) === cls && !(p.notBefore && p.notBefore > now));
        if (bestMilestone(waiting)?._id !== id) return null;
      }
    }
    await ctx.db.patch(id, { status: "publishing", attempts: post.attempts + 1, updatedAt: now, notBefore: undefined });
    return post;
  },
});
export const finish = mutation({
  args: { authSecret: v.string(), id: v.id("contentControlPosts"), status: v.string(), error: v.optional(v.string()), requestId: v.optional(v.string()), result: v.optional(v.string()), notBefore: v.optional(v.number()) },
  handler: async (ctx, { authSecret, id, ...data }) => {
    authorize(authSecret);
    const row = await ctx.db.get(id);
    const published = ["posted", "submitted"].includes(data.status) && !row?.publishedAt;
    await ctx.db.patch(id, { ...data, error: data.error, updatedAt: Date.now(), ...(published ? { publishedAt: Date.now() } : {}) });
  },
});
export const setMedia = mutation({
  args: { authSecret: v.string(), id: v.id("contentControlPosts"), mediaUrl: v.string(), kind: v.optional(v.string()) },
  handler: async (ctx, { authSecret, id, mediaUrl, kind }) => {
    authorize(authSecret);
    const post = await ctx.db.get(id);
    if (!post || post.status !== "publishing") throw new Error("Post is not being prepared");
    await ctx.db.patch(id, { mediaUrl, ...(kind ? { kind } : {}) });
  },
});
export const retry = mutation({
  args: { authSecret: v.string(), id: v.id("contentControlPosts") },
  handler: async (ctx, { authSecret, id }) => {
    authorize(authSecret);
    const post = await ctx.db.get(id);
    if (!post || !["failed", "cancelled"].includes(post.status)) throw new Error("This post cannot be retried");
    await ctx.db.patch(id, { status: "queued", error: undefined, notBefore: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.contentControl.dispatch, { id });
  },
});
export const dispatch = internalAction({
  args: { id: v.id("contentControlPosts") },
  handler: async (_ctx, { id }) => {
    const res = await appFetch("/api/admin/content-control/worker", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_CRON_SECRET ?? "" },
      body: JSON.stringify({ id }), signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`Content worker returned ${res.status}`);
  },
});
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const posts = await ctx.runQuery(api.contentControl.pending, { authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    if (!posts.length) return;
    const response = await appFetch("/api/admin/content-control/worker", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_CRON_SECRET ?? "" },
      body: "{}", signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw new Error(`Content sweep returned ${response.status}`);
  },
});
export const pending = query({
  args: { authSecret: v.string(), id: v.optional(v.id("contentControlPosts")) },
  handler: async (ctx, { authSecret, id }) => {
    authorize(authSecret);
    if (id) { const row = await ctx.db.get(id); return row ? [row] : []; }
    const statuses = ["queued", "publishing", "submitted"];
    const now = Date.now();
    // Held posts (daily quota / spacing / provider cap) are skipped until their slot; launches go before milestones.
    const groups = await Promise.all(statuses.map(async status => (await ctx.db.query("contentControlPosts").withIndex("by_status_and_updatedAt", q => q.eq("status", status)).take(40))
      .filter(p => !(p.notBefore && p.notBefore > now)).slice(0, 3)));
    const rank = (p: { source: string }) => (p.source === "mint" || p.source === "token" ? 0 : p.source === "video" ? 1 : p.source === "milestone" ? 2 : p.source === "digest" ? 3 : p.source === "stat" ? 4 : 5);
    return groups.flat().sort((a, b) => rank(a) - rank(b) || a.updatedAt - b.updatedAt);
  },
});
