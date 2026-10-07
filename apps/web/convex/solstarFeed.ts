import { calloutTradeV } from "./lib/calloutTrade";
import { isCalloutAttachment, CALLOUT_MEDIA_LIMIT } from "../lib/solstar/calloutMedia";
// convex/solstarFeed.ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertSecret } from "./lib/solstarAuth";
import { shortWallet } from "../lib/solstar/feed";
import { normalizeText } from "../lib/solstar/text";

const CHAT_MAX = 280;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 30_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const TICKER_COUNT = 30;
const EVENT_THROTTLE_MS = 10_000;

const normalizeChat = normalizeText;

type EventType = "character_created" | "trade" | "follow";

export type FeedEventArgs = {
  eventType: EventType;
  body: string;
  wallet?: string;
  tokenId?: Id<"ssTokens">;
  characterId?: Id<"ssCharacters">;
  amountLamports?: string;
  side?: "buy" | "sell";
  network: "paper" | "devnet" | "mainnet";
};

/** Plain helper (not a registered function): runs inside the caller's mutation so errors propagate. */
export async function recordFeedEvent(ctx: MutationCtx, args: FeedEventArgs): Promise<void> {
  if ((args.eventType === "trade" || args.eventType === "follow") && args.wallet !== undefined) {
    const wallet = args.wallet;
    const recent = await ctx.db.query("ssFeed")
      .withIndex("by_wallet_kind_created", (q) => q.eq("wallet", wallet).eq("kind", "event").gte("createdAt", Date.now() - EVENT_THROTTLE_MS))
      .first();
    if (recent) return;
  }
  await ctx.db.insert("ssFeed", { kind: "event", ...args, createdAt: Date.now() });
}

export const postChat = mutation({
  args: { wallet: v.string(), body: v.string(), authSecret: v.string(), characterId: v.optional(v.id("ssCharacters")), theme: v.optional(v.string()), callCapSol: v.optional(v.number()), calloutMetric: v.optional(v.union(v.literal("earnings"), v.literal("views"), v.literal("trade"))), tradePnlUsd: v.optional(v.number()), onchainTrade: v.optional(calloutTradeV), attachments: v.optional(v.array(v.object({ url: v.string(), type: v.union(v.literal("image"), v.literal("gif")), alt: v.string() }))) },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    if (a.wallet.length < 32 || a.wallet.length > 44) throw new Error("invalid_wallet");
    const body = normalizeChat(a.body);
    if ((!body.length && !a.attachments?.length) || body.length > CHAT_MAX) throw new Error("invalid_body");
    if (a.calloutMetric && a.calloutMetric !== "trade" && !a.characterId) throw new Error("character_required");
    if (a.tradePnlUsd !== undefined) throw new Error("invalid_trade_pnl");
    if (a.calloutMetric === "trade") {
      const t = a.onchainTrade;
      if (!t || t.wallet !== a.wallet || ![t.amountSol, t.time, t.pnlSol, t.realizedSol, t.unrealizedSol].every(Number.isFinite) || t.amountSol < 0 || t.time <= 0 || t.signature.length < 64 || t.signature.length > 90 || Math.abs(t.pnlSol - t.realizedSol - t.unrealizedSol) > 1e-8) throw new Error("trade_not_verified");
    } else if (a.onchainTrade) throw new Error("invalid_trade_pnl");
    if (a.attachments && (a.attachments.length > CALLOUT_MEDIA_LIMIT || !a.attachments.every(isCalloutAttachment))) throw new Error("invalid_attachment");
    const now = Date.now();
    const wallet = a.wallet;
    const windowRows = await ctx.db.query("ssFeed")
      .withIndex("by_wallet_kind_created", (q) => q.eq("wallet", wallet).eq("kind", "chat").gte("createdAt", now - RATE_WINDOW_MS))
      .take(RATE_LIMIT);
    if (windowRows.length >= RATE_LIMIT) throw new Error("rate_limited");
    const last = await ctx.db.query("ssFeed")
      .withIndex("by_wallet_kind_created", (q) => q.eq("wallet", wallet).eq("kind", "chat"))
      .order("desc").first();
    if (last && last.body.toLowerCase() === body.toLowerCase() && JSON.stringify(last.attachments ?? []) === JSON.stringify(a.attachments ?? [])) throw new Error("duplicate_message");
    let linked: { characterId?: Id<"ssCharacters">; tokenId?: Id<"ssTokens">; network: "paper" | "devnet" | "mainnet" } = { network: a.onchainTrade?.network ?? "paper" };
    if (a.characterId) {
      const character = await ctx.db.get(a.characterId);
      if (!character || character.status !== "approved") throw new Error("character_not_found");
      const token = await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", a.characterId!)).first();
      if (!token) throw new Error("token_not_found");
      linked = { characterId: character._id, tokenId: token._id, network: token.network };
    }
    const THEMES = ["colosseum", "solana", "lambo", "bullrun", "neon", "ferrari", "vault", "aurora"];
    const theme = (a.characterId || a.calloutMetric === "trade") && a.theme && THEMES.includes(a.theme) ? a.theme : undefined;
    const callCapSol = a.characterId && typeof a.callCapSol === "number" && Number.isFinite(a.callCapSol) && a.callCapSol > 0 && a.callCapSol < 1e12 ? a.callCapSol : undefined;
    await ctx.db.insert("ssFeed", { kind: "chat", wallet, body, ...linked, ...(theme ? { theme } : {}), ...(callCapSol ? { callCapSol } : {}), ...(a.calloutMetric ? { calloutMetric: a.calloutMetric } : {}), ...(a.onchainTrade ? { onchainTrade: a.onchainTrade } : {}), ...(a.attachments?.length ? { attachments: a.attachments } : {}), createdAt: now });
    return { ok: true as const };
  },
});

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function publicRow(r: Doc<"ssFeed">) {
  return {
    id: r._id as string, kind: r.kind, eventType: r.eventType,
    wallet: r.wallet === undefined ? undefined : shortWallet(r.wallet),
    body: r.body, tokenId: r.tokenId, characterId: r.characterId,
    amountLamports: r.amountLamports, side: r.side, network: r.network, createdAt: r.createdAt,
    onchainTrade: r.onchainTrade, attachments: r.attachments, theme: r.theme, callCapSol: r.callCapSol, calloutMetric: r.calloutMetric, tradePnlUsd: r.tradePnlUsd,
  };
}

export const listFeed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("ssFeed").withIndex("by_created").order("desc").take(clampLimit(limit));
    return rows.map(publicRow);
  },
});

export const tickerItems = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("ssFeed").withIndex("by_kind_created", (q) => q.eq("kind", "event")).order("desc").take(TICKER_COUNT);
    return rows.map((r) => ({
      id: r._id as string, eventType: r.eventType, body: r.body, characterId: r.characterId,
      tokenId: r.tokenId, side: r.side, amountLamports: r.amountLamports, createdAt: r.createdAt,
    }));
  },
});

/** Reactive agent and standalone trader callouts; general chat and trade events stay in the activity feed. */
export const listCallouts = query({
  args: { network: v.optional(v.union(v.literal("paper"), v.literal("devnet"), v.literal("mainnet"))) },
  handler: async (ctx, { network }) => {
    const rows = await ctx.db.query("ssFeed").withIndex("by_kind_created", q => q.eq("kind", "chat")).order("desc").take(100);
    const joined = await Promise.all(rows.filter(r => r.characterId || (r.calloutMetric === "trade" && r.wallet)).map(async r => {
      if (!r.characterId) {
        const wallet = r.wallet!;
        const link = await ctx.db.query("walletLinks").withIndex("by_wallet", q => q.eq("walletAddress", wallet)).first();
        const user = link ? await ctx.db.get(link.userId) : await ctx.db.query("users").withIndex("by_wallet", q => q.eq("walletAddress", wallet)).first();
        const name = user?.name || `${wallet.slice(0, 4)}…${wallet.slice(-4)}`, imageUrl = user?.image || "/brand/solcameo-mark.png";
        if (network && r.onchainTrade?.network !== network) return null;
        return { ...publicRow(r), name, imageUrl, authorName: name, authorImage: imageUrl, ticker: r.onchainTrade?.ticker || "", trader: true, mint: r.onchainTrade?.mint };
      }
      const character = await ctx.db.get(r.characterId);
      if (!character || character.status !== "approved") return null;
      const token = r.tokenId ? await ctx.db.get(r.tokenId) : null;
      if (!token || (network && token.network !== network)) return null;
      const author = r.wallet ? await profileFor(ctx, r.wallet) : null;
      return { ...publicRow(r), name: character.name, imageUrl: character.referenceImageUrl, authorName: author?.name ?? publicRow(r).wallet ?? "Trader", authorImage: author?.imageUrl ?? "/brand/solcameo-mark.png", ticker: token.ticker, trader: false, mint: token.mint };
    }));
    return joined.filter(r => r !== null).slice(0, 30);
  },
});


const REPLY_MAX = 280;
const REPLY_LIMIT = 6;

/** Add a reply to a callout thread. */
export const postReply = mutation({
  args: { wallet: v.string(), calloutId: v.id("ssFeed"), body: v.string(), parentId: v.optional(v.id("ssCalloutReplies")), authSecret: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    if (a.wallet.length < 32 || a.wallet.length > 44) throw new Error("invalid_wallet");
    const body = normalizeChat(a.body);
    if (!body.length || body.length > REPLY_MAX) throw new Error("invalid_body");
    const post = await ctx.db.get(a.calloutId);
    if (!post || post.kind !== "chat") throw new Error("callout_not_found");
    if (a.parentId) {
      const parent = await ctx.db.get(a.parentId);
      if (!parent || parent.calloutId !== a.calloutId) throw new Error("callout_not_found");
    }
    const now = Date.now();
    const recent = await ctx.db.query("ssCalloutReplies").withIndex("by_wallet_created", q => q.eq("wallet", a.wallet).gte("createdAt", now - RATE_WINDOW_MS)).take(REPLY_LIMIT);
    if (recent.length >= REPLY_LIMIT) throw new Error("rate_limited");
    if (recent.some(r => r.calloutId === a.calloutId && r.body.toLowerCase() === body.toLowerCase())) throw new Error("duplicate_message");
    await ctx.db.insert("ssCalloutReplies", { calloutId: a.calloutId, wallet: a.wallet, body, createdAt: now, ...(a.parentId ? { parentId: a.parentId } : {}) });
    return { ok: true as const };
  },
});

async function profileFor(ctx: { db: any }, wallet: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const link = await ctx.db.query("walletLinks").withIndex("by_wallet", (q: any) => q.eq("walletAddress", wallet)).first(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const user = link ? await ctx.db.get(link.userId) : await ctx.db.query("users").withIndex("by_wallet", (q: any) => q.eq("walletAddress", wallet)).first(); // eslint-disable-line @typescript-eslint/no-explicit-any
  return { name: (user?.name as string | undefined) || `${wallet.slice(0, 4)}…${wallet.slice(-4)}`, imageUrl: (user?.image as string | undefined) || "/brand/solcameo-mark.png" };
}

/** Oldest-first replies for one callout thread (reactive). */
export const listReplies = query({
  args: { calloutId: v.id("ssFeed") },
  handler: async (ctx, { calloutId }) => {
    const rows = await ctx.db.query("ssCalloutReplies").withIndex("by_callout_created", q => q.eq("calloutId", calloutId)).order("asc").take(100);
    const cache = new Map<string, { name: string; imageUrl: string }>();
    return Promise.all(rows.map(async r => {
      let p = cache.get(r.wallet);
      if (!p) { p = await profileFor(ctx, r.wallet); cache.set(r.wallet, p); }
      return { id: r._id as string, parentId: (r.parentId as string | undefined) ?? null, wallet: shortWallet(r.wallet), body: r.body, createdAt: r.createdAt, name: p.name, imageUrl: p.imageUrl };
    }));
  },
});

/** Reply counts per callout, for the feed rows. */
export const replyCounts = query({
  args: { calloutIds: v.array(v.id("ssFeed")) },
  handler: async (ctx, { calloutIds }) => {
    const out: Record<string, number> = {};
    for (const id of calloutIds.slice(0, 40)) out[id as string] = (await ctx.db.query("ssCalloutReplies").withIndex("by_callout_created", q => q.eq("calloutId", id)).take(100)).length;
    return out;
  },
});

/** The coin behind a callout plus the influencer's latest videos, newest first, for the thread's vertical feed. */
export const creatorFeed = query({
  args: { characterId: v.optional(v.id("ssCharacters")), mint: v.optional(v.string()) },
  handler: async (ctx, { characterId, mint }) => {
    let token = characterId ? await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", characterId)).first() : null;
    if (!token && mint) {
      for (const network of ["mainnet", "devnet"] as const) {
        const rows = await ctx.db.query("ssTokens").withIndex("by_network", q => q.eq("network", network)).take(400);
        token = rows.find(t => t.mint === mint) ?? null;
        if (token) break;
      }
    }
    if (!token) return null;
    const character = await ctx.db.get(token.characterId);
    if (!character || character.status !== "approved") return null;
    type Video = { id: string; url: string; poster: string | null; caption: string; at: number; views: number | null };
    const videos: Video[] = [];
    const seen = new Set<string>();
    const add = (v: Video) => { if (v.url && !seen.has(v.url)) { seen.add(v.url); videos.push(v); } };
    // Every video the coin's agent has made counts, posted or not: finished renders and episodes, community-round
    // jobs, and series episodes. Only samples and cancelled/failed work are left out.
    const [episodes, jobs] = await Promise.all([
      ctx.db.query("ssEpisodes").withIndex("by_token", q => q.eq("tokenId", token!._id)).order("desc").take(20),
      ctx.db.query("ssContentJobs").withIndex("by_token", q => q.eq("tokenId", token!._id)).order("desc").take(20),
    ]);
    for (const e of episodes) if (e.source !== "sample") add({ id: `ep:${e._id}`, url: e.videoUrl, poster: e.posterUrl, caption: e.title, at: e.createdAt, views: null });
    for (const j of jobs) if (j.videoUrl && !j.error) add({ id: `job:${j._id}`, url: j.videoUrl, poster: j.referenceImageUrl ?? null, caption: j.prompt.slice(0, 140), at: j.createdAt, views: null });
    if (token.mint) {
      const m = token.mint;
      const [clips, sched, renders, series] = await Promise.all([
        ctx.db.query("clips").withIndex("by_mint", q => q.eq("mintAddress", m)).order("desc").take(20),
        ctx.db.query("scheduledContent").withIndex("by_mint", q => q.eq("mintAddress", m)).order("desc").take(20),
        ctx.db.query("videoRenderJobs").withIndex("by_mint", q => q.eq("mintAddress", m)).order("desc").take(20),
        ctx.db.query("seriesEpisodes").withIndex("by_mint", q => q.eq("mintAddress", m)).order("desc").take(20),
      ]);
      for (const e of series) if (e.videoUrl) add({ id: `series:${e._id}`, url: e.videoUrl, poster: null, caption: e.premise, at: e.createdAt, views: null });
      for (const c of clips) if (c.clipUrl) add({ id: `clip:${c._id}`, url: c.clipUrl, poster: null, caption: c.captionText || c.title || "", at: c.createdAt, views: c.viewCount ?? null });
      for (const s of sched) if (s.videoUrl && s.status !== "cancelled") add({ id: `gen:${s._id}`, url: s.videoUrl, poster: s.storyboardImageUrl ?? null, caption: s.caption || s.topic || "", at: s.createdAt, views: null });
      for (const r of renders) if (r.videoUrl && r.phase !== "failed") add({ id: `render:${r._id}`, url: r.videoUrl, poster: r.storyboardImageUrl ?? null, caption: r.autoPost?.caption || r.videoNote || "", at: r._creationTime, views: null });
    }
    videos.sort((a, b) => b.at - a.at);
    return {
      token: { characterId: token.characterId as string, mint: token.mint ?? null, ticker: token.ticker, network: token.network, name: character.name, imageUrl: character.referenceImageUrl, tradable: !!token.dbcPool },
      videos: videos.slice(0, 24),
    };
  },
});

const VIDEO_KEY_MAX = 900;
const VIDEO_COMMENT_LIMIT = 8;

/** Add a chat message under a video. Same wallet proof, length and spam limits as callout replies. */
export const postVideoComment = mutation({
  args: { wallet: v.string(), videoKey: v.string(), characterId: v.optional(v.id("ssCharacters")), body: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    if (a.wallet.length < 32 || a.wallet.length > 44) throw new Error("invalid_wallet");
    if (!a.videoKey || a.videoKey.length > VIDEO_KEY_MAX) throw new Error("invalid_video");
    const body = normalizeChat(a.body);
    if (!body.length || body.length > REPLY_MAX) throw new Error("invalid_body");
    const now = Date.now();
    const recent = await ctx.db.query("ssVideoComments").withIndex("by_wallet_created", q => q.eq("wallet", a.wallet).gte("createdAt", now - RATE_WINDOW_MS)).take(VIDEO_COMMENT_LIMIT);
    if (recent.length >= VIDEO_COMMENT_LIMIT) throw new Error("rate_limited");
    if (recent.some(r => r.videoKey === a.videoKey && r.body.toLowerCase() === body.toLowerCase())) throw new Error("duplicate_message");
    await ctx.db.insert("ssVideoComments", { videoKey: a.videoKey, wallet: a.wallet, body, createdAt: now, ...(a.characterId ? { characterId: a.characterId } : {}) });
    return { ok: true as const };
  },
});

/** The latest messages under a video, oldest first so the chat reads top to bottom (reactive). */
export const listVideoComments = query({
  args: { videoKey: v.string() },
  handler: async (ctx, { videoKey }) => {
    if (!videoKey || videoKey.length > VIDEO_KEY_MAX) return [];
    const rows = (await ctx.db.query("ssVideoComments").withIndex("by_video_created", q => q.eq("videoKey", videoKey)).order("desc").take(150)).reverse();
    const cache = new Map<string, { name: string; imageUrl: string }>();
    return Promise.all(rows.map(async r => {
      let p = cache.get(r.wallet);
      if (!p) { p = await profileFor(ctx, r.wallet); cache.set(r.wallet, p); }
      return { id: r._id as string, wallet: shortWallet(r.wallet), body: r.body, createdAt: r.createdAt, name: p.name, imageUrl: p.imageUrl };
    }));
  },
});
