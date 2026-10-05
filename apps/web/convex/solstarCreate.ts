// convex/solstarCreate.ts
import { ensureCharacterAgent } from "./lib/characterAgent";
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { assertSecret } from "./lib/solstarAuth";
import { recordFeedEvent } from "./solstarFeed";
import { shortWallet } from "../lib/solstar/feed";
import { normalizeText } from "../lib/solstar/text";
import { PAPER_VIRTUAL_SOL, PAPER_VIRTUAL_TOKENS } from "../lib/solstar/economics";
import {
  BIO_MAX, IDEMPOTENCY_KEY_MAX, IDEMPOTENCY_KEY_MIN, IMAGE_MAX_BYTES, IMAGE_TYPES, NAME_MAX, NAME_MIN,
  TICKER_PATTERN, isCategory,
} from "../lib/solstar/createForm";

import { launchOptionsValidator } from "./lib/launchOptions";
import { launchOptionsSchema } from "../lib/pump/economics";


export const generateUploadUrl = mutation({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    assertSecret(authSecret);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createCharacter = mutation({
  args: {
    wallet: v.string(), name: v.string(), ticker: v.string(), bio: v.string(), category: v.string(),
    launchOptions: v.optional(launchOptionsValidator),
    imageStorageId: v.id("_storage"), rightsAttested: v.boolean(), idempotencyKey: v.string(), authSecret: v.string(),
  },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    if (a.idempotencyKey.length < IDEMPOTENCY_KEY_MIN || a.idempotencyKey.length > IDEMPOTENCY_KEY_MAX) throw new Error("invalid_key");
    if (a.wallet.length < 32 || a.wallet.length > 44) throw new Error("invalid_wallet");
    const name = normalizeText(a.name);
    if (name.length < NAME_MIN || name.length > NAME_MAX) throw new Error("invalid_name");
    const ticker = a.ticker.toUpperCase();
    if (!TICKER_PATTERN.test(ticker)) throw new Error("invalid_ticker");
    const bio = normalizeText(a.bio);
    if (bio.length > BIO_MAX) throw new Error("invalid_bio");
    if (!isCategory(a.category)) throw new Error("invalid_category");
    if (a.rightsAttested !== true) throw new Error("rights_required");

    const launchOptions = a.launchOptions ? launchOptionsSchema.parse(a.launchOptions) : undefined;
    const wallet = a.wallet;
    const key = a.idempotencyKey;
    const prior = await ctx.db.query("ssCharacters").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", key)).first();
    if (prior) {
      if (prior.ownerWallet !== wallet) throw new Error("idempotency_conflict");
      const priorToken = await ctx.db.query("ssTokens").withIndex("by_character", (q) => q.eq("characterId", prior._id)).first();
      if (priorToken) {
        const agentMintAddress = await ensureCharacterAgent(ctx, prior, priorToken);
        return { characterId: prior._id, tokenId: priorToken._id, agentMintAddress, reused: true as const };
      }
    }

    const file = await ctx.db.system.get("_storage", a.imageStorageId);
    if (!file || file.size <= 0 || file.size > IMAGE_MAX_BYTES || !(IMAGE_TYPES as readonly string[]).includes(file.contentType ?? "")) {
      throw new Error("invalid_image");
    }
    const imageUrl = await ctx.storage.getUrl(a.imageStorageId);
    if (imageUrl === null) throw new Error("invalid_image");

    const taken = await ctx.db.query("ssTokens").withIndex("by_network_ticker", (q) => q.eq("network", "paper").eq("ticker", ticker)).first();
    if (taken) throw new Error("ticker_taken");

    const now = Date.now();


    const characterId = await ctx.db.insert("ssCharacters", {
      ...(launchOptions ? { launchOptions } : {}), ownerWallet: wallet, name, bio, referenceImageUrl: imageUrl, category: a.category, status: "approved",
      rightsAttested: true, rightsReviewed: false, createdAt: now, idempotencyKey: key, imageStorageId: a.imageStorageId,
    });
    const tokenId = await ctx.db.insert("ssTokens", {
      characterId, network: "paper", name, ticker, description: bio, state: "paper",
      solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS, createdAt: now,
    });
    await ctx.db.insert("ssBudgets", { tokenId, network: "paper", fundedLamports: 0n, reservedLamports: 0n, spentLamports: 0n });
    await recordFeedEvent(ctx, {
      eventType: "character_created", wallet, characterId, tokenId, network: "paper",
      body: `${shortWallet(wallet)} created ${name} ($${ticker}) (simulated paper token)`,
    });
    const character = await ctx.db.get(characterId);
    const token = await ctx.db.get(tokenId);
    if (!character || !token) throw new Error("creation_failed");
    const agentMintAddress = await ensureCharacterAgent(ctx, character, token);
    return { characterId, tokenId, agentMintAddress, reused: false as const };
  },
});

/** Server-only launch lookup; preview ownership is proven before preparing transactions. */
export const getLaunchCharacter = query({
  args: { characterId: v.id("ssCharacters"), wallet: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const character = await ctx.db.get(a.characterId);
    if (!character || character.ownerWallet !== a.wallet) throw new Error("character_not_found");
    const token = await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", a.characterId)).first();
    if (!token) throw new Error("token_not_found");
    return { character, token };
  },
});
/** Called only after the server verifies both exact wallet transactions on mainnet. */
export const finalizePumpLaunch = mutation({
  args: { characterId: v.id("ssCharacters"), wallet: v.string(), mint: v.string(), launchSignature: v.string(), sharingSignature: v.optional(v.string()), authSecret: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const character = await ctx.db.get(a.characterId);
    if (!character || character.ownerWallet !== a.wallet) throw new Error("character_not_found");
    const token = await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", a.characterId)).first();
    if (!token) throw new Error("token_not_found");
    if (token.mint && token.mint !== a.mint) throw new Error("launch_conflict");
    await ctx.db.patch(token._id, { network: "mainnet", state: "live", mint: a.mint, launchSignature: a.launchSignature, ...(a.sharingSignature ? { sharingSignature: a.sharingSignature } : {}) });
    const budget = await ctx.db.query("ssBudgets").withIndex("by_token", q => q.eq("tokenId", token._id)).first();
    if (budget) await ctx.db.patch(budget._id, { network: "mainnet" });
    return { characterId: character._id, mint: a.mint };
  },
});

/** Reserve before submission, so parallel tabs cannot launch two mints for one character. */
export const reservePumpMint = mutation({
  args: { characterId: v.id("ssCharacters"), wallet: v.string(), mint: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const character = await ctx.db.get(a.characterId);
    if (!character || character.ownerWallet !== a.wallet) throw new Error("character_not_found");
    const token = await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", a.characterId)).first();
    if (!token) throw new Error("token_not_found");
    if (token.mint && token.mint !== a.mint) throw new Error("launch_conflict");
    if (token.state === "live") throw new Error("already_launched");
    await ctx.db.patch(token._id, { mint: a.mint, state: "pending" });
    return { mint: a.mint };
  },
});

/** Server verifies the exact signed DBC creation and pool ownership before finalizing. */
export const finalizeDbcLaunch = mutation({
  args: { characterId: v.id("ssCharacters"), wallet: v.string(), mint: v.string(), config: v.string(), pool: v.string(), network: v.union(v.literal("devnet"), v.literal("mainnet")), launchSignature: v.string(), economy: v.optional(v.union(v.literal("creator-only"), v.literal("sustainable-v1"))), treasuryWallet: v.optional(v.string()), authSecret: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const character = await ctx.db.get(a.characterId);
    if (!character || character.ownerWallet !== a.wallet) throw new Error("character_not_found");
    const token = await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", a.characterId)).first();
    if (token?.state === "live" && token.mint === a.mint && token.dbcConfig === a.config && token.dbcPool === a.pool) return { mint: a.mint };
    if (!token || token.mint !== a.mint || token.state !== "pending") throw new Error("launch_conflict");
    await ctx.db.patch(token._id, { network: a.network, state: "live", mint: a.mint, dbcConfig: a.config, dbcPool: a.pool, launchSignature: a.launchSignature, ...(a.economy ? {economy:a.economy} : {}), ...(a.treasuryWallet ? {treasuryWallet:a.treasuryWallet} : {}) });
    const budget = await ctx.db.query("ssBudgets").withIndex("by_token", q => q.eq("tokenId", token._id)).first();
    if (budget) await ctx.db.patch(budget._id, { network: a.network, fundedLamports: 0n, reservedLamports: 0n, spentLamports: 0n });
    if (a.economy === "sustainable-v1") {
      if (!a.treasuryWallet) throw new Error("treasury_required");
      await ctx.db.insert("ssFlywheels", {tokenId:token._id, enabled:true, nextRunAt:Date.now(), leaseUntil:0, status:"awaiting_fees", updatedAt:Date.now()});
    }
    return { mint: a.mint };
  },
});

/** Repair existing user-created coins; seeded demo characters are excluded. */
export const backfillCharacterAgents = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("ssCharacters").paginate({ cursor, numItems: 100 });
    let linked = 0;
    for (const character of page.page) {
      if (!character.idempotencyKey || character.status === "archived") continue;
      const token = await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", character._id)).unique();
      if (!token) continue;
      await ensureCharacterAgent(ctx, character, token);
      linked++;
    }
    return { linked, cursor: page.continueCursor, done: page.isDone };
  },
});
