import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

/**
 * Account-wide agent reservations. claimMint checks capacity and claims a slot
 * in one transaction, preventing concurrent sessions from exceeding the plan.
 * Live agents plus in-flight claims count; deleted agents release their slots.
 * Historical fee fields remain for compatibility with paid mint reservations.
 */

/** List price of a non-free agent mint. Mirrors lib/server/mintFee.ts (client
 *  quote copy) — keep in sync. AGENT CREATION IS NOW FREE — this constant only
 *  remains because the ledger schema records a fee per row; decideFee below
 *  always returns 0. */
export const MINT_FEE_USDC = 10;
/** Hard cap on agents per account — creation is free, limited to this many.
 *  Enforced atomically in claimMint (the same OCC gate that used to guard the
 *  creation), counted from active reservations and live agents across the account. */
export const AGENT_LIMIT_PER_WALLET = 1;

/** Failed in-flight creation releases its reservation after five minutes.
 * saveInfluencer rechecks capacity atomically before inserting a late render. */
const CLAIM_TTL_MS = 5 * 60 * 1000;

type Charge = Doc<"agentMintCharges">;

/** True if a row counts as a committed prior agent. minted/paid always count;
 *  a "claimed" (free, in-progress) row counts only until CLAIM_TTL elapses. */
function isCommitted(r: Charge, now: number): boolean {
  if (r.status === "minted" || r.status === "paid") return true;
  if (r.status === "claimed") return now - (r.committedAt ?? r.createdAt) < CLAIM_TTL_MS;
  return false;
}

/** Distinct committed prior mints for an account (wallets ∪ DID), excluding this
 *  session. Only committed rows count — never bare reservations. */
export async function countPrior(
  ctx: QueryCtx | MutationCtx,
  opts: { wallets: string[]; creatorDid?: string; excludeSessionId: string; now: number },
): Promise<number> {
  const rows = new Map<string, Charge>();
  for (const w of opts.wallets) {
    const byWallet = await ctx.db
      .query("agentMintCharges")
      .withIndex("by_wallet", (q) => q.eq("creatorWallet", w))
      .collect();
    for (const r of byWallet) rows.set(r._id, r);
  }
  if (opts.creatorDid) {
    const byDid = await ctx.db
      .query("agentMintCharges")
      .withIndex("by_did", (q) => q.eq("creatorDid", opts.creatorDid))
      .collect();
    for (const r of byDid) rows.set(r._id, r);
  }
  const seenMints = new Set<string>();
  let unaddressed = 0;
  let ownMint: string | undefined;
  for (const r of rows.values()) {
    if (r.sessionId === opts.excludeSessionId) {
      // Remember the current session's own mint so the influencers backstop below
      // never counts this in-flight agent as a PRIOR mint against itself.
      if (r.mintAddress) ownMint = r.mintAddress;
      continue;
    }
    if (!isCommitted(r, opts.now)) continue;
    if (r.mintAddress) {
      // Historical/deleted agents do not consume a live slot.
      const live = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", r.mintAddress!)).first();
      if (live) seenMints.add(r.mintAddress);
    }
    else unaddressed += 1;
  }
  // Live agents also count when their reservation is missing or expired.
  // Skip the current session's agent so a retry does not count itself twice.
  for (const w of opts.wallets) {
    const agents = await ctx.db
      .query("influencers")
      .withIndex("by_creator", (q) => q.eq("creatorWallet", w))
      .collect();
    for (const a of agents) {
      if (!a.mintAddress || a.mintAddress === ownMint) continue;
      seenMints.add(a.mintAddress);
    }
  }
  return seenMints.size + unaddressed;
}

function dedupeWallets(creatorWallet: string, creatorWallets: string[]): string[] {
  return [...new Set([creatorWallet, ...creatorWallets].filter(Boolean))];
}

/** UI-safe rendering of an effective limit — the client's SlotsMeter builds an
 *  array of this many segments, so the internal "-1 = unlimited" sentinel must
 *  never reach it directly. */
function displayLimit(effectiveLimit: number): number {
  return effectiveLimit < 0 ? 999 : effectiveLimit;
}

/** Pure fee policy: agent creation is FREE for everyone. The paid path in the
 *  route/card is dead code kept only for schema compatibility. */
function decideFee(_priorMints: number, _standardFeeUsdc: number, _forceFree: boolean): { feeUsdc: number; reason: string } {
  return { feeUsdc: 0, reason: "free" };
}

/** Read-only fee quote for the GET endpoint (display only — never reserves). */
export const quoteMintFee = query({
  args: {
    sessionId: v.optional(v.string()),
    creatorWallet: v.string(),
    creatorWallets: v.array(v.string()),
    creatorDid: v.optional(v.string()),
    standardFeeUsdc: v.number(),
    forceFree: v.boolean(),
    agentLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wallets = dedupeWallets(args.creatorWallet, args.creatorWallets);
    const effectiveLimit = args.agentLimit ?? AGENT_LIMIT_PER_WALLET;
    // A settled session shows its locked-in decision. A still-"reserved" session
    // is only a quote, so RE-EVALUATE it live — otherwise a reservation locked at
    // "free" would keep showing free after the freebie was consumed elsewhere.
    if (args.sessionId) {
      const existing = await ctx.db
        .query("agentMintCharges")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId!))
        .first();
      if (existing && existing.status !== "reserved") {
        const priorSettled = await countPrior(ctx, { wallets, creatorDid: args.creatorDid, excludeSessionId: "", now: Date.now() });
        return { feeUsdc: existing.feeUsdc, reason: existing.reason, priorMints: priorSettled, status: existing.status, agentLimit: displayLimit(effectiveLimit) };
      }
    }
    const priorMints = await countPrior(ctx, { wallets, creatorDid: args.creatorDid, excludeSessionId: args.sessionId ?? "", now: Date.now() });
    const fee = decideFee(priorMints, args.standardFeeUsdc, args.forceFree);
    return { ...fee, priorMints, status: "none", agentLimit: displayLimit(effectiveLimit) };
  },
});

/**
 * Decide + record the fee QUOTE for a session (advisory — the freebie is only
 * truly consumed atomically in claimMint). Idempotent per session: a settled
 * session returns its locked decision (and alreadyMinted so the route resumes);
 * a still-"reserved" session is RE-EVALUATED against the current committed count
 * and its stored fee updated, so a reservation quoted "free" is upgraded to $50
 * once the account's freebie has been used elsewhere (kills reservation-banking).
 *
 * PUBLIC mutation gated by an INTERNAL_CRON_SECRET arg (NOT internalMutation) —
 * it's invoked from the /api/nft/mint Next route via ConvexHttpClient, which can
 * only call PUBLIC functions. Same pattern as campaigns.topUpBudget. The secret
 * check on the first handler line is the real gate.
 */
export const reserveMintFee = mutation({
  args: {
    authSecret: v.string(),
    sessionId: v.string(),
    creatorWallet: v.string(),
    creatorWallets: v.array(v.string()),
    creatorDid: v.optional(v.string()),
    standardFeeUsdc: v.number(),
    forceFree: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    const now = Date.now();
    const wallets = dedupeWallets(args.creatorWallet, args.creatorWallets);
    const existing = await ctx.db
      .query("agentMintCharges")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
    if (existing && (existing.creatorWallet !== args.creatorWallet || (existing.creatorDid && existing.creatorDid !== args.creatorDid))) throw new Error("Mint session belongs to another account");
    if (existing?.status === "deleted") throw new Error("This agent was deleted. Start a new builder session.");
    if (existing?.status === "minted" && existing.mintAddress) {
      const live = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", existing.mintAddress!)).first();
      if (!live) throw new Error("This agent was deleted. Start a new builder session.");
    }
    if (existing && existing.status !== "reserved") {
      // Committed (claimed/paid/minted) — the decision is locked.
      return {
        feeUsdc: existing.feeUsdc,
        reason: existing.reason,
        status: existing.status,
        txSignature: existing.txSignature,
        alreadyMinted: existing.status === "minted",
        mintAddress: existing.mintAddress,
      };
    }
    const priorMints = await countPrior(ctx, { wallets, creatorDid: args.creatorDid, excludeSessionId: args.sessionId, now });
    const { feeUsdc, reason } = decideFee(priorMints, args.standardFeeUsdc, args.forceFree);
    if (existing) {
      // Re-price the live reservation if the freebie was used since it was quoted.
      if (existing.feeUsdc !== feeUsdc || existing.reason !== reason) {
        await ctx.db.patch(existing._id, { feeUsdc, reason });
      }
      return { feeUsdc, reason, status: "reserved" as const, txSignature: existing.txSignature, alreadyMinted: false, mintAddress: undefined };
    }
    await ctx.db.insert("agentMintCharges", {
      sessionId: args.sessionId,
      creatorWallet: args.creatorWallet,
      creatorDid: args.creatorDid,
      feeUsdc,
      reason,
      status: "reserved",
      createdAt: now,
    });
    return { feeUsdc, reason, status: "reserved" as const, txSignature: undefined, alreadyMinted: false, mintAddress: undefined };
  },
});

/**
 * Atomically claim the freebie (or confirm a paid mint) right before the agent
 * is created. This is THE freebie gate: for a free reservation it counts the
 * account's committed prior mints and, if none, flips this row to "claimed" in
 * the SAME mutation — so N concurrent first-mints serialize under Convex OCC and
 * only one is granted; the rest come back {ok:false} and must pay. Paid rows are
 * always allowed (money already committed). Idempotent for a claimed/minted row.
 * Returns ok=false with the fee the caller must now charge instead.
 */
export const claimMint = mutation({
  args: {
    authSecret: v.string(),
    sessionId: v.string(),
    creatorWallet: v.string(),
    creatorWallets: v.array(v.string()),
    creatorDid: v.optional(v.string()),
    standardFeeUsdc: v.number(),
    /** MINT_FEE_DISABLED kill switch — when set, grant every mint free. */
    forceFree: v.boolean(),
    agentLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    const now = Date.now();
    const row = await ctx.db
      .query("agentMintCharges")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
    if (!row) throw new Error("no reservation for session");
    // A live minted agent may resume; in-flight claims recheck current capacity.
    if (row.creatorWallet !== args.creatorWallet || (row.creatorDid && row.creatorDid !== args.creatorDid)) throw new Error("Mint session belongs to another account");
    if (row.status === "deleted") throw new Error("This agent was deleted. Start a new builder session.");
    if (row.status === "minted") {
      const live = row.mintAddress && await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", row.mintAddress!)).first();
      if (!live) throw new Error("This agent was deleted. Start a new builder session.");
      return { ok: true as const, feeUsdc: row.feeUsdc };
    }
    // status === "reserved". Legacy paid rows (still reserved with a fee) can't
    // exist under the free policy, but keep the deny for safety.
    if (row.feeUsdc > 0 && row.status !== "paid") return { ok: false as const, feeUsdc: row.feeUsdc };
    // AGENT LIMIT gate (replaces the old freebie gate, same atomic OCC pattern):
    // count committed prior agents and claim in one mutation, so N concurrent
    // creations serialize and the account can never exceed the cap.
    const wallets = dedupeWallets(args.creatorWallet, args.creatorWallets);
    const priorMints = await countPrior(ctx, { wallets, creatorDid: args.creatorDid, excludeSessionId: args.sessionId, now });
    const effectiveLimit = args.agentLimit ?? AGENT_LIMIT_PER_WALLET;
    // -1 (or any negative) means unlimited for this account — skip the cap entirely.
    if (effectiveLimit >= 0 && priorMints >= effectiveLimit) {
      return { ok: false as const, feeUsdc: 0, limitReached: true as const, agentCount: priorMints, agentLimit: effectiveLimit };
    }
    await ctx.db.patch(row._id, { status: "claimed", committedAt: now, agentLimit: effectiveLimit, creatorWallets: wallets, creatorDid: args.creatorDid });
    return { ok: true as const, feeUsdc: 0 };
  },
});

/** Record that the $50 deposit was verified on-chain. Idempotent, and SINGLE-USE:
 *  a given on-chain payment signature may fund AT MOST one reservation's paid
 *  transition. verifyUsdcDeposit (the route's on-chain check) is a pure read with
 *  no replay memory, so the same real $50 payment verifies true forever — without
 *  this guard a wallet could replay its ONE genuine payment across unlimited fresh
 *  sessions, stranding each at "paid" and minting extra agents for free (H03). The
 *  guard is keyed on THIS ledger (not the shared processedSignatures) so it never
 *  collides with the "nft_mint" consume nftAgents.completeMint does on the SAME
 *  signature. Wallet-scoped is sufficient: the route's verifyUsdcDeposit binds the
 *  deposit's funder to creatorWallet (expectedSender), so a given signature is
 *  always presented under the same wallet. */
export const markMintPaid = mutation({
  args: { authSecret: v.string(), sessionId: v.string(), txSignature: v.string() },
  handler: async (ctx, { authSecret, sessionId, txSignature }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    const row = await ctx.db
      .query("agentMintCharges")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    if (!row) throw new Error("no reservation for session");
    // Idempotent: an already committed (paid/minted) row is left as-is — a route
    // retry never re-checks or re-flips it.
    if (row.status !== "reserved") return;
    // Single-use: reject a signature that already funded ANOTHER of this wallet's
    // paid/minted reservations (the same real payment can't buy two mints).
    const forWallet = await ctx.db
      .query("agentMintCharges")
      .withIndex("by_wallet", (q) => q.eq("creatorWallet", row.creatorWallet))
      .collect();
    const reused = forWallet.some(
      (r) =>
        r.sessionId !== sessionId &&
        r.txSignature === txSignature &&
        (r.status === "paid" || r.status === "minted"),
    );
    if (reused) throw new Error("mint fee signature already used");
    await ctx.db.patch(row._id, { status: "paid", txSignature, committedAt: Date.now() });
  },
});

/** Mark the reservation fully minted. Idempotent. */
export const markMintCharged = mutation({
  args: { authSecret: v.string(), sessionId: v.string(), mintAddress: v.string() },
  handler: async (ctx, { authSecret, sessionId, mintAddress }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    const row = await ctx.db
      .query("agentMintCharges")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    if (row) await ctx.db.patch(row._id, { status: "minted", mintAddress });
  },
});

/**
 * One-time transition backfill: mark every EXISTING agent as a prior mint so a
 * user who already has agents pays $50 on their next one (instead of getting a
 * fresh freebie because the ledger started empty). Internal-secret gated,
 * idempotent (skips wallets that already have a backfilled/minted row). Run once
 * after deploy via the Convex dashboard or scripts/backfill-mint-ledger.mjs.
 */
export const backfillFromInfluencers = mutation({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    const now = Date.now();
    const influencers = await ctx.db.query("influencers").collect();
    let inserted = 0;
    for (const inf of influencers) {
      if (!inf.creatorWallet || !inf.mintAddress) continue;
      const existing = await ctx.db
        .query("agentMintCharges")
        .withIndex("by_session", (q) => q.eq("sessionId", `backfill:${inf.mintAddress}`))
        .first();
      if (existing) continue;
      await ctx.db.insert("agentMintCharges", {
        sessionId: `backfill:${inf.mintAddress}`,
        creatorWallet: inf.creatorWallet,
        creatorDid: undefined,
        mintAddress: inf.mintAddress,
        feeUsdc: 0,
        reason: "backfill",
        status: "minted",
        createdAt: now,
      });
      inserted += 1;
    }
    return { inserted, scanned: influencers.length };
  },
});

/** Account identity is derived only from a verified token by a server route. */
export const accountIdentity = query({
  args: { authSecret: v.string(), userId: v.string(), wallets: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const user = await ctx.db.query("users").withIndex("by_supabase", q => q.eq("supabaseId", args.userId)).unique();
    const wallets = new Set(args.wallets.filter(Boolean));
    if (user?.walletAddress) wallets.add(user.walletAddress);
    if (user) {
      for await (const link of ctx.db.query("walletLinks").withIndex("by_user", q => q.eq("userId", user._id))) wallets.add(link.walletAddress);
    }
    const agents: { mintAddress: string; name: string }[] = [];
    for (const wallet of wallets) {
      for await (const agent of ctx.db.query("influencers").withIndex("by_creator", q => q.eq("creatorWallet", wallet))) agents.push({ mintAddress: agent.mintAddress, name: agent.name });
    }
    return { wallets: [...wallets], agents, agentLimitOverride: user?.agentLimitOverride };
  },
});

/** Recheck in the insertion transaction, including after an expired mint claim. */
export async function assertMintCapacity(ctx: MutationCtx, sessionId: string, creatorWallet: string) {
  const row = await ctx.db.query("agentMintCharges").withIndex("by_session", q => q.eq("sessionId", sessionId)).first();
  if (!row) return; // trusted internal provisioning has no user reservation
  if (row.creatorWallet !== creatorWallet || row.status === "deleted" || row.status === "reserved") throw new Error("Invalid mint reservation");
  const wallets = row.creatorWallets ?? [creatorWallet];
  const limit = row.agentLimit ?? AGENT_LIMIT_PER_WALLET;
  const count = await countPrior(ctx, { wallets, creatorDid: row.creatorDid, excludeSessionId: sessionId, now: Date.now() });
  if (limit >= 0 && count >= limit) throw new Error("Agent limit reached. Delete an agent to free a slot.");
}
