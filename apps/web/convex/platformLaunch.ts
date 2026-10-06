import { v } from "convex/values";
import { PAPER_VIRTUAL_SOL, PAPER_VIRTUAL_TOKENS } from "../lib/solstar/economics";
import { mutation, query } from "./_generated/server";

function guard(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
}
export const owner = query({
  args: { authSecret: v.string() },
  handler: async (_ctx, a) => { guard(a.authSecret); return process.env.SOLCAMEO_PLATFORM_LAUNCH_WALLET?.trim() || null; },
});
export const get = query({
  args: { network: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    guard(a.authSecret);
    return ctx.db.query("platformTokenLaunches").withIndex("by_network", q => q.eq("network", a.network)).unique();
  },
});
export const draft = mutation({
  args: { network: v.string(), wallet: v.string(), name: v.string(), description: v.string(), image: v.string(), optionsJson: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    guard(a.authSecret);
    const prior = await ctx.db.query("platformTokenLaunches").withIndex("by_network", q => q.eq("network", a.network)).unique();
    if (prior) {
      if (prior.wallet !== a.wallet) throw new Error("not_owner");
      // An in-progress launch's reviewed terms must never change.
      if (prior.state !== "draft") return prior._id;
      await ctx.db.patch(prior._id, { name: a.name, description: a.description, image: a.image, optionsJson: a.optionsJson });
      return prior._id;
    }
    return ctx.db.insert("platformTokenLaunches", { network: a.network, wallet: a.wallet, name: a.name, description: a.description, image: a.image, optionsJson: a.optionsJson, ticker: "SOLCAMEO", state: "draft" });
  },
});
export const update = mutation({
  args: { network: v.string(), wallet: v.string(), authSecret: v.string(), action: v.union(v.literal("reserve"), v.literal("replace"), v.literal("release"), v.literal("finalize")), mint: v.string(), oldMint: v.optional(v.string()), config: v.optional(v.string()), pool: v.optional(v.string()), signature: v.optional(v.string()) },
  handler: async (ctx, a) => {
    guard(a.authSecret);
    const row = await ctx.db.query("platformTokenLaunches").withIndex("by_network", q => q.eq("network", a.network)).unique();
    if (!row || row.wallet !== a.wallet) throw new Error("not_owner");
    if (row.state === "live") {
      if (a.action === "finalize" && row.mint === a.mint && row.pool === a.pool) return;
      throw new Error("platform_token_already_live");
    }
    if (a.action === "release") {
      if (row.mint !== a.mint) throw new Error("mint_conflict");
      await ctx.db.patch(row._id, { mint: undefined, config: undefined, state: "draft" });
    } else if (a.action === "replace") {
      if (row.mint !== a.oldMint || !a.config) throw new Error("mint_conflict");
      await ctx.db.patch(row._id, { mint: a.mint, config: a.config, state: "reserved" });
    } else {
      if (row.mint && row.mint !== a.mint) throw new Error("mint_conflict");
      if (!a.config) throw new Error("config_required");
      if (row.config && row.config !== a.config) throw new Error("config_conflict");
      if (a.action === "finalize" && (!a.pool || !a.signature)) throw new Error("confirmation_required");
      await ctx.db.patch(row._id, { mint: a.mint, config: a.config, ...(a.action === "finalize" ? { pool: a.pool, signature: a.signature, state: "live" as const } : { state: "reserved" as const }) });
    }
  },
});

/** The market listing (character + token record) that lets the live SOLCAMEO token use the normal market page and trade box. */
export const listing = query({
  args: { network: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    guard(a.authSecret);
    const network = a.network === "devnet" ? "devnet" : "mainnet";
    const token = await ctx.db.query("ssTokens").withIndex("by_network_ticker", q => q.eq("network", network).eq("ticker", "SOLCAMEO")).first();
    return token?.state === "live" ? { characterId: token.characterId as string, needsRepair: token.tokenReserve <= 0n || token.solReserve <= 0n } : null;
  },
});

/** Create (once) the character and token records for the live platform token. Safe to call repeatedly. */
export const linkListing = mutation({
  args: { network: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    guard(a.authSecret);
    const network = a.network === "devnet" ? "devnet" as const : "mainnet" as const;
    const row = await ctx.db.query("platformTokenLaunches").withIndex("by_network", q => q.eq("network", network)).unique();
    if (!row || row.state !== "live" || !row.mint || !row.pool || !row.config) throw new Error("platform_token_not_live");
    const existing = await ctx.db.query("ssTokens").withIndex("by_network_ticker", q => q.eq("network", network).eq("ticker", "SOLCAMEO")).first();
    if (existing) {
      if (existing.mint !== row.mint) throw new Error("ticker_in_use");
      // The market page prices from these reserves and throws on a zero token reserve, so a record created with zeros is repaired.
      const reserves = existing.tokenReserve <= 0n || existing.solReserve <= 0n ? { solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS } : {};
      if (existing.state !== "live" || existing.dbcPool !== row.pool || Object.keys(reserves).length) await ctx.db.patch(existing._id, { state: "live", dbcPool: row.pool, dbcConfig: row.config, ...reserves });
      return { characterId: existing.characterId as string, created: false as const };
    }
    const now = Date.now();
    const characterId = await ctx.db.insert("ssCharacters", {
      ownerWallet: row.wallet, name: row.name, bio: row.description, referenceImageUrl: row.image, category: "Tech", status: "approved",
      rightsAttested: true, rightsReviewed: true, createdAt: now, idempotencyKey: `platform-token-${network}`,
    });
    const tokenId = await ctx.db.insert("ssTokens", {
      characterId, network, name: row.name, ticker: "SOLCAMEO", description: row.description, economy: "creator-only",
      dbcConfig: row.config, dbcPool: row.pool, mint: row.mint, ...(row.signature ? { launchSignature: row.signature } : {}),
      state: "live", solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS, createdAt: now,
    });
    await ctx.db.insert("ssBudgets", { tokenId, network, fundedLamports: 0n, reservedLamports: 0n, spentLamports: 0n });
    return { characterId: characterId as string, created: true as const };
  },
});
