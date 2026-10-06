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
  args: { wallet: v.string(), body: v.string(), authSecret: v.string(), characterId: v.optional(v.id("ssCharacters")), theme: v.optional(v.string()), callCapSol: v.optional(v.number()) },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    if (a.wallet.length < 32 || a.wallet.length > 44) throw new Error("invalid_wallet");
    const body = normalizeChat(a.body);
    if (body.length < 1 || body.length > CHAT_MAX) throw new Error("invalid_body");
    const now = Date.now();
    const wallet = a.wallet;
    const windowRows = await ctx.db.query("ssFeed")
      .withIndex("by_wallet_kind_created", (q) => q.eq("wallet", wallet).eq("kind", "chat").gte("createdAt", now - RATE_WINDOW_MS))
      .take(RATE_LIMIT);
    if (windowRows.length >= RATE_LIMIT) throw new Error("rate_limited");
    const last = await ctx.db.query("ssFeed")
      .withIndex("by_wallet_kind_created", (q) => q.eq("wallet", wallet).eq("kind", "chat"))
      .order("desc").first();
    if (last && last.body.toLowerCase() === body.toLowerCase()) throw new Error("duplicate_message");
    let linked: { characterId?: Id<"ssCharacters">; tokenId?: Id<"ssTokens">; network: "paper" | "devnet" | "mainnet" } = { network: "paper" };
    if (a.characterId) {
      const character = await ctx.db.get(a.characterId);
      if (!character || character.status !== "approved") throw new Error("character_not_found");
      const token = await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", a.characterId!)).first();
      if (!token) throw new Error("token_not_found");
      linked = { characterId: character._id, tokenId: token._id, network: token.network };
    }
    const THEMES = ["colosseum", "solana", "lambo", "bullrun", "neon", "ferrari", "vault", "aurora"];
    const theme = a.characterId && a.theme && THEMES.includes(a.theme) ? a.theme : undefined;
    const callCapSol = a.characterId && typeof a.callCapSol === "number" && Number.isFinite(a.callCapSol) && a.callCapSol > 0 && a.callCapSol < 1e12 ? a.callCapSol : undefined;
    await ctx.db.insert("ssFeed", { kind: "chat", wallet, body, ...linked, ...(theme ? { theme } : {}), ...(callCapSol ? { callCapSol } : {}), createdAt: now });
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
    theme: r.theme, callCapSol: r.callCapSol,
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

/** Reactive, agent-linked callouts only; general chat and trade events stay in the activity feed. */
export const listCallouts = query({
  args: {},
  handler: async ctx => {
    const rows = await ctx.db.query("ssFeed").withIndex("by_kind_created", q => q.eq("kind", "chat")).order("desc").take(100);
    const joined = await Promise.all(rows.filter(r => r.characterId).map(async r => {
      const character = await ctx.db.get(r.characterId!);
      if (!character || character.status !== "approved") return null;
      const token = r.tokenId ? await ctx.db.get(r.tokenId) : null;
      if (!token) return null;
      return { ...publicRow(r), name: character.name, imageUrl: character.referenceImageUrl, ticker: token.ticker };
    }));
    return joined.filter(r => r !== null).slice(0, 30);
  },
});
