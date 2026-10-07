import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertSecret } from "./lib/solstarAuth";
import { recordFeedEvent } from "./solstarFeed";
import { adjustFollowers } from "./lib/marketSummary";
import { shortWallet } from "../lib/solstar/feed";
import { SEED_CHARACTERS } from "../lib/solstar/seed";
import { PAPER_VIRTUAL_SOL, PAPER_VIRTUAL_TOKENS } from "../lib/solstar/economics";

const networkV = v.union(v.literal("paper"), v.literal("devnet"), v.literal("mainnet"));
const MAX_LIST = 100;

/** Clients never see raw bigints: reserves are serialised as decimal strings. */
function publicToken(token: Doc<"ssTokens">) {
  const { solReserve, tokenReserve, ...rest } = token;
  return { ...rest, solReserve: solReserve.toString(), tokenReserve: tokenReserve.toString() };
}

async function followerCount(ctx: QueryCtx, characterId: Id<"ssCharacters">): Promise<number> {
  const rows = await ctx.db.query("ssFollows").withIndex("by_character", (q) => q.eq("characterId", characterId)).collect();
  return rows.length;
}

export const listCharacters = query({
  args: { search: v.optional(v.string()), category: v.optional(v.string()), network: v.optional(networkV) },
  handler: async (ctx, args) => {
    const network = args.network ?? "paper";
    const needle = args.search?.trim().toLowerCase();
    const tokens = await ctx.db.query("ssTokens").withIndex("by_network", (q) => q.eq("network", network)).collect();
    const rows = [];
    for (const token of tokens) {
      const character = await ctx.db.get(token.characterId);
      if (!character || character.status !== "approved") continue;
      if (args.category && character.category !== args.category) continue;
      if (needle) {
        const hay = `${character.name}\n${token.ticker}\n${character.bio}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      rows.push({ character, token });
    }
    rows.sort((a, b) => b.token.createdAt - a.token.createdAt);
    const out = [];
    for (const { character, token } of rows.slice(0, MAX_LIST)) {
      const latestEpisode = await ctx.db.query("ssEpisodes").withIndex("by_token", (q) => q.eq("tokenId", token._id)).order("desc").first();
      out.push({ character, token: publicToken(token), latestEpisode, followers: await followerCount(ctx, character._id) });
    }
    return out;
  },
});

export const getCharacter = query({
  args: { characterId: v.id("ssCharacters") },
  handler: async (ctx, { characterId }) => {
    const character = await ctx.db.get(characterId);
    if (!character || character.status !== "approved") return null;
    const token = await ctx.db.query("ssTokens").withIndex("by_character", (q) => q.eq("characterId", characterId)).first();
    if (!token) return null;
    const episodes = await ctx.db.query("ssEpisodes").withIndex("by_token", (q) => q.eq("tokenId", token._id)).order("desc").collect();
    const budget = await ctx.db.query("ssBudgets").withIndex("by_token", (q) => q.eq("tokenId", token._id)).first();
    return {
      character,
      token: publicToken(token),
      episodes,
      followers: await followerCount(ctx, characterId),
      budget: {
        funded: (budget?.fundedLamports ?? 0n).toString(),
        reserved: (budget?.reservedLamports ?? 0n).toString(),
        spent: (budget?.spentLamports ?? 0n).toString(),
      },
    };
  },
});

export const getTokenPool = query({
  args: { tokenId: v.id("ssTokens") },
  handler: async (ctx, { tokenId }) => {
    const token = await ctx.db.get(tokenId);
    if (!token) return null;
    return { solReserve: token.solReserve.toString(), tokenReserve: token.tokenReserve.toString(), network: token.network };
  },
});

export const isFollowing = query({
  args: { wallet: v.string(), characterId: v.id("ssCharacters") },
  handler: async (ctx, { wallet, characterId }) => {
    const row = await ctx.db.query("ssFollows").withIndex("by_wallet_character", (q) => q.eq("wallet", wallet).eq("characterId", characterId)).first();
    return row !== null;
  },
});

function assertWallet(wallet: string): void {
  if (wallet.length < 32 || wallet.length > 44) throw new Error("invalid_wallet");
}

export const follow = mutation({
  args: { wallet: v.string(), characterId: v.id("ssCharacters"), authSecret: v.string() },
  handler: async (ctx, { wallet, characterId, authSecret }) => {
    assertSecret(authSecret);
    assertWallet(wallet);
    const existing = await ctx.db.query("ssFollows").withIndex("by_wallet_character", (q) => q.eq("wallet", wallet).eq("characterId", characterId)).first();
    if (!existing) {
      const character = await ctx.db.get(characterId);
      if (!character) throw new Error("character_not_found");
      await ctx.db.insert("ssFollows", { wallet, characterId, createdAt: Date.now() });
      await adjustFollowers(ctx, characterId, 1);
      await recordFeedEvent(ctx, {
        eventType: "follow", wallet, characterId, network: "paper",
        body: `${shortWallet(wallet)} followed ${character.name}`,
      });
    }
    return null;
  },
});

export const unfollow = mutation({
  args: { wallet: v.string(), characterId: v.id("ssCharacters"), authSecret: v.string() },
  handler: async (ctx, { wallet, characterId, authSecret }) => {
    assertSecret(authSecret);
    assertWallet(wallet);
    const rows = await ctx.db.query("ssFollows").withIndex("by_wallet_character", (q) => q.eq("wallet", wallet).eq("characterId", characterId)).collect();
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length) await adjustFollowers(ctx, characterId, -rows.length);
    return null;
  },
});

export const seedSample = mutation({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    assertSecret(authSecret);
    if ((await ctx.db.query("ssCharacters").first()) !== null) return { seeded: false };
    const now = Date.now();
    for (const [i, seed] of SEED_CHARACTERS.entries()) {
      // Earlier seeds are newer, so the list keeps the source ordering.
      const createdAt = now - i * 1000;
      const characterId = await ctx.db.insert("ssCharacters", {
        ownerWallet: "SEED", name: seed.name, bio: seed.bio, referenceImageUrl: seed.image, category: seed.category,
        status: "approved", rightsAttested: true, rightsReviewed: false, createdAt,
      });
      const tokenId = await ctx.db.insert("ssTokens", {
        characterId, network: "paper", name: seed.name, ticker: seed.ticker, description: seed.bio,
        state: "paper", solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS, createdAt,
      });
      await ctx.db.insert("ssEpisodes", {
        tokenId, index: 0, videoUrl: seed.video, posterUrl: seed.image, title: seed.episodeTitle, source: "sample", createdAt,
      });
      await ctx.db.insert("ssBudgets", { tokenId, network: "paper", fundedLamports: 0n, reservedLamports: 0n, spentLamports: 0n });
    }
    return { seeded: true };
  },
});
