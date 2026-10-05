/// <reference types="vite/client" />
/**
 * Money-path tests for the agent-mint fee ledger (convex/mintFee.ts) — the
 * backing for "first two agents free, then $10". These lock in the fixes for the
 * adversarial findings: append-only + secret-gated (no client-flippable gate),
 * only COMMITTED rows count (abandoned reservations never over-charge), the
 * freebie is granted at most once via the atomic claimMint gate (no concurrent
 * double-grant, no reservation "banking"), DID + wallet union, and the backfill.
 */
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "test-internal-secret";
const FEE = 10;
const WALLET_A = "WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "WalletBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DID = "did:privy:user123";

beforeEach(() => {
  process.env.INTERNAL_CRON_SECRET = SECRET;
});

function reserveArgs(sessionId: string, wallet: string, extra: Record<string, unknown> = {}) {
  return { authSecret: SECRET, sessionId, creatorWallet: wallet, creatorWallets: [wallet], standardFeeUsdc: FEE, forceFree: false, ...extra };
}
function claimArgs(sessionId: string, wallet: string, extra: Record<string, unknown> = {}) {
  return { authSecret: SECRET, sessionId, creatorWallet: wallet, creatorWallets: [wallet], standardFeeUsdc: FEE, forceFree: false, agentLimit: 15, ...extra };
}
/** Drive one full free/paid mint of `wallet` under `sessionId` to a committed state. */
async function completeFreeMint(t: ReturnType<typeof convexTest>, sessionId: string, wallet: string, mintAddress: string) {
  await t.mutation(api.mintFee.reserveMintFee, reserveArgs(sessionId, wallet));
  const claim = await t.mutation(api.mintFee.claimMint, claimArgs(sessionId, wallet));
  expect(claim.ok).toBe(true);
  await t.mutation(api.nftAgents.saveInfluencer, {
    authSecret: SECRET, sessionId, mintAddress, creatorWallet: wallet,
    name: "Agent", handle: `h_${mintAddress}`, avatarUrl: "https://example.com/a.png",
    niche: "lifestyle", language: "English", archetype: "friend", description: "test",
  });
}

describe("mintFee.reserveMintFee — quote + record (advisory)", () => {
  it("first agent for a fresh account quotes free", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    expect(r).toMatchObject({ feeUsdc: 0, reason: "free", status: "reserved" });
  });

  it("every new session stays free after prior committed agents (creation is free)", async () => {
    const t = convexTest(schema, modules);
    await completeFreeMint(t, "s1", WALLET_A, "mint_1");
    await completeFreeMint(t, "s2", WALLET_A, "mint_2");
    const r3 = await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s3", WALLET_A));
    expect(r3).toMatchObject({ feeUsdc: 0, reason: "free" });
  });

  it("a fully-minted session reports alreadyMinted so the route resumes", async () => {
    const t = convexTest(schema, modules);
    await completeFreeMint(t, "s1", WALLET_A, "mint_1");
    const resume = await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    expect(resume).toMatchObject({ alreadyMinted: true, mintAddress: "mint_1" });
  });

  it("counts by account DID too — a fresh unlinked wallet can't dodge the agent limit", async () => {
    const t = convexTest(schema, modules);
    // Fill the DID-linked account to the 15-agent limit under WALLET_A.
    await t.run(async (ctx) => {
      for (let i = 0; i < 15; i++) {
        await ctx.db.insert("agentMintCharges", {
          sessionId: `did-prior-${i}`, creatorWallet: WALLET_A, creatorDid: DID,
          feeUsdc: 0, reason: "free", status: "claimed", createdAt: Date.now(), committedAt: Date.now(),
        });
      }
    });
    // A fresh wallet under the SAME DID is denied the 16th agent.
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s_new", WALLET_B, { creatorWallets: [WALLET_B], creatorDid: DID }));
    const c = await t.mutation(api.mintFee.claimMint, claimArgs("s_new", WALLET_B, { creatorWallets: [WALLET_B], creatorDid: DID }));
    expect(c).toMatchObject({ ok: false, limitReached: true });
  });

  it("an ABANDONED reservation never over-charges the account's real next mint (F6)", async () => {
    const t = convexTest(schema, modules);
    // Session s1 reserves free but is never claimed/minted (user gave up).
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    // A brand-new session for the same wallet is STILL free — reserved rows don't count.
    const r2 = await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s2", WALLET_A));
    expect(r2.feeUsdc).toBe(0);
  });

  it("a banked (still-reserved) session stays free — creation is free for everyone", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    await completeFreeMint(t, "s2", WALLET_A, "mint_2");
    await completeFreeMint(t, "s3", WALLET_A, "mint_3");
    const requote = await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    expect(requote).toMatchObject({ feeUsdc: 0, reason: "free" });
  });

  it("forceFree (kill switch) still quotes free", async () => {
    const t = convexTest(schema, modules);
    await completeFreeMint(t, "s1", WALLET_A, "mint_1");
    const r = await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s2", WALLET_A, { forceFree: true }));
    expect(r).toMatchObject({ feeUsdc: 0, reason: "free" });
  });

  it("rejects an unauthorized caller", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A, { authSecret: "wrong" }))).rejects.toThrow(/unauthorized/);
  });
});

describe("mintFee.claimMint — atomic agent-limit gate", () => {
  it("grants free agents up to the 15-agent limit, then denies the 16th", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 15; i++) {
      await completeFreeMint(t, `s${i}`, WALLET_A, `mint_${i}`);
    }
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s15", WALLET_A));
    const c16 = await t.mutation(api.mintFee.claimMint, claimArgs("s15", WALLET_A));
    expect(c16).toMatchObject({ ok: false, limitReached: true, agentLimit: 15 });
  });

  it("is idempotent — re-claiming an already-claimed session stays ok (resume)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    await t.mutation(api.mintFee.claimMint, claimArgs("s1", WALLET_A));
    const again = await t.mutation(api.mintFee.claimMint, claimArgs("s1", WALLET_A));
    expect(again.ok).toBe(true);
  });

  it("denies a legacy still-reserved row that owes a fee (never paid)", async () => {
    const t = convexTest(schema, modules);
    // Legacy row from the paid era — reserved with a fee still due.
    await t.run(async (ctx) => {
      await ctx.db.insert("agentMintCharges", {
        sessionId: "legacy", creatorWallet: WALLET_A, feeUsdc: FEE, reason: "fee",
        status: "reserved", createdAt: Date.now(),
      });
    });
    const c = await t.mutation(api.mintFee.claimMint, claimArgs("legacy", WALLET_A));
    expect(c).toMatchObject({ ok: false, feeUsdc: FEE });
  });

  it("allows a paid reservation through", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s3", WALLET_A));
    await t.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId: "s3", txSignature: "realSig" });
    const c = await t.mutation(api.mintFee.claimMint, claimArgs("s3", WALLET_A));
    expect(c.ok).toBe(true);
  });

  it("rejects an unauthorized claim", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    await expect(t.mutation(api.mintFee.claimMint, claimArgs("s1", WALLET_A, { authSecret: "nope" }))).rejects.toThrow(/unauthorized/);
  });

  it("repeat creation under the limit stays free", async () => {
    const t = convexTest(schema, modules);
    await completeFreeMint(t, "s1", WALLET_A, "mint_1");
    await completeFreeMint(t, "s2", WALLET_A, "mint_2");
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s3", WALLET_A));
    const c = await t.mutation(api.mintFee.claimMint, claimArgs("s3", WALLET_A));
    expect(c).toMatchObject({ ok: true, feeUsdc: 0 });
  });

  it("a stuck 'claimed' free mint self-heals — a NEW session isn't wrongly gated after CLAIM_TTL", async () => {
    const t = convexTest(schema, modules);
    // A free mint that was claimed but whose agent creation died mid-flight, long ago.
    await t.run(async (ctx) => {
      await ctx.db.insert("agentMintCharges", {
        sessionId: "dead", creatorWallet: WALLET_A, feeUsdc: 0, reason: "first_agent_free",
        status: "claimed", createdAt: Date.now() - 60 * 60 * 1000, committedAt: Date.now() - 60 * 60 * 1000,
      });
      await ctx.db.insert("agentMintCharges", {
        sessionId: "live-1", creatorWallet: WALLET_B, feeUsdc: 0, reason: "first_agent_free",
        status: "claimed", createdAt: Date.now(), committedAt: Date.now(),
      });
      await ctx.db.insert("agentMintCharges", {
        sessionId: "live-2", creatorWallet: WALLET_B, feeUsdc: 0, reason: "first_agent_free",
        status: "claimed", createdAt: Date.now(), committedAt: Date.now(),
      });
    });
    // The stale claim aged out of the count; recent claims still count toward the limit.
    const q = await t.query(api.mintFee.quoteMintFee, { creatorWallet: WALLET_A, creatorWallets: [WALLET_A], standardFeeUsdc: FEE, forceFree: false });
    expect(q.priorMints).toBe(0);
    const q2 = await t.query(api.mintFee.quoteMintFee, { creatorWallet: WALLET_B, creatorWallets: [WALLET_B], standardFeeUsdc: FEE, forceFree: false });
    expect(q2.priorMints).toBe(2);
    expect(q2.feeUsdc).toBe(0);
  });
});

describe("mintFee.quoteMintFee — read-only display quote", () => {
  it("quotes free for a fresh account and writes no row", async () => {
    const t = convexTest(schema, modules);
    const q = await t.query(api.mintFee.quoteMintFee, { creatorWallet: WALLET_A, creatorWallets: [WALLET_A], standardFeeUsdc: FEE, forceFree: false });
    expect(q.feeUsdc).toBe(0);
    const rows = await t.run(async (ctx) => ctx.db.query("agentMintCharges").collect());
    expect(rows.length).toBe(0);
  });

  it("re-evaluates a still-reserved session live and reports the account's agent count", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    await completeFreeMint(t, "s2", WALLET_A, "mint_2");
    await completeFreeMint(t, "s3", WALLET_A, "mint_3");
    const q = await t.query(api.mintFee.quoteMintFee, { sessionId: "s1", creatorWallet: WALLET_A, creatorWallets: [WALLET_A], standardFeeUsdc: FEE, forceFree: false });
    expect(q.feeUsdc).toBe(0);
    expect(q.priorMints).toBe(2);
    expect(q.agentLimit).toBe(1);
  });
});

describe("mintFee.backfillFromInfluencers — existing agents count as prior mints", () => {
  async function seedInfluencer(t: ReturnType<typeof convexTest>, mintAddress: string, wallet: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("influencers", {
        mintAddress, creatorWallet: wallet, name: "Agent", handle: `h_${mintAddress}`,
        avatarUrl: "https://example.com/a.png", niche: "lifestyle", language: "English",
        archetype: "friend", description: "test",
        personality: { warmth: 50, humor: 50, authority: 50, boldness: 50 },
        tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0,
      });
    });
  }

  it("backfills existing agents so they count toward the limit, idempotently", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, "mint_existing", WALLET_A);
    await seedInfluencer(t, "mint_existing_2", WALLET_A);
    expect((await t.mutation(api.mintFee.backfillFromInfluencers, { authSecret: SECRET })).inserted).toBe(2);
    expect((await t.mutation(api.mintFee.backfillFromInfluencers, { authSecret: SECRET })).inserted).toBe(0);
    const q = await t.query(api.mintFee.quoteMintFee, { creatorWallet: WALLET_A, creatorWallets: [WALLET_A], standardFeeUsdc: FEE, forceFree: false });
    expect(q.priorMints).toBe(2);
  });

  it("rejects an unauthorized backfill", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.mintFee.backfillFromInfluencers, { authSecret: "nope" })).rejects.toThrow(/unauthorized/);
  });
});

/**
 * A successfully-created agent must NEVER re-earn the freebie (lost $10). The
 * fee row is committed to "minted" by a SEPARATE best-effort HTTP call
 * (markMintCharged) after the agent is created; if that call fails, the row
 * stays "claimed" with no mintAddress, ages out of the freebie count after
 * CLAIM_TTL, and the SAME wallet's next mint is wrongly granted free again.
 * Fix = (1) promote the fee row atomically INSIDE saveInfluencer (the mutation
 * that creates the agent), and (2) count the wallet's actually-created agents as
 * ground-truth prior mints in countPrior. Fail closed: agent exists ⇒ not free.
 */
describe("mintFee — a successfully created agent counts as a prior mint (fail closed)", () => {
  async function seedInfluencer(t: ReturnType<typeof convexTest>, mintAddress: string, wallet: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("influencers", {
        mintAddress, creatorWallet: wallet, name: "Agent", handle: `h_${mintAddress}`,
        avatarUrl: "https://example.com/a.png", niche: "lifestyle", language: "English",
        archetype: "friend", description: "test",
        personality: { warmth: 50, humor: 50, authority: 50, boldness: 50 },
        tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0,
      });
    });
  }
  function saveInfluencerArgs(sessionId: string, wallet: string, mintAddress: string, extra: Record<string, unknown> = {}) {
    return {
      authSecret: SECRET, sessionId, mintAddress, creatorWallet: wallet,
      name: "Agent", handle: `h_${mintAddress}`, avatarUrl: "https://example.com/a.png",
      niche: "lifestyle", language: "English", archetype: "friend", description: "test",
      ...extra,
    };
  }

  it("counts a created agent as ground truth even when its fee row is stuck 'claimed' past CLAIM_TTL", async () => {
    const t = convexTest(schema, modules);
    // An agent creation that SUCCEEDED but whose markMintCharged promotion
    // failed: the row is stuck "claimed" with no mintAddress, aged out. The
    // created agents themselves must still count toward the 15-agent limit.
    await t.run(async (ctx) => {
      await ctx.db.insert("agentMintCharges", {
        sessionId: "stuck", creatorWallet: WALLET_A, feeUsdc: 0, reason: "free",
        status: "claimed", createdAt: Date.now() - 60 * 60 * 1000, committedAt: Date.now() - 60 * 60 * 1000,
      });
    });
    await seedInfluencer(t, "mint_stuck", WALLET_A);
    await seedInfluencer(t, "mint_stuck_2", WALLET_A);
    const q = await t.query(api.mintFee.quoteMintFee, { creatorWallet: WALLET_A, creatorWallets: [WALLET_A], standardFeeUsdc: FEE, forceFree: false });
    expect(q.priorMints).toBeGreaterThanOrEqual(2);
    // Under the limit → a new session is still granted.
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s_new", WALLET_A));
    const c = await t.mutation(api.mintFee.claimMint, claimArgs("s_new", WALLET_A));
    expect(c).toMatchObject({ ok: true, feeUsdc: 0 });
  });

  it("saveInfluencer atomically commits the session's fee row to 'minted' (root cause — no stuck 'claimed')", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    const claim = await t.mutation(api.mintFee.claimMint, claimArgs("s1", WALLET_A));
    expect(claim.ok).toBe(true);
    // Agent creation — the fee-row promote must happen HERE, not in the best-effort
    // markMintCharged HTTP call that the route swallows on failure.
    await t.mutation(api.nftAgents.saveInfluencer, saveInfluencerArgs("s1", WALLET_A, "mint_1"));
    const row = await t.run(async (ctx) =>
      ctx.db.query("agentMintCharges").withIndex("by_session", (q) => q.eq("sessionId", "s1")).first());
    expect(row?.status).toBe("minted");
    expect(row?.mintAddress).toBe("mint_1");
    // A NEW session for the same wallet is still free until the second committed mint exists.
    const r2 = await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s2", WALLET_A));
    expect(r2.feeUsdc).toBe(0);
  });

  it("saveInfluencer only promotes when a reservation exists (non-mint callers unaffected)", async () => {
    const t = convexTest(schema, modules);
    // No reservation for this session — a direct/internal saveInfluencer must not
    // insert or touch any fee ledger row.
    await t.mutation(api.nftAgents.saveInfluencer, saveInfluencerArgs("no_reservation", WALLET_A, "mint_x"));
    const rows = await t.run(async (ctx) => ctx.db.query("agentMintCharges").collect());
    expect(rows.length).toBe(0);
  });

  it("a genuine FIRST mint (no prior agent, no ledger) is still FREE", async () => {
    const t = convexTest(schema, modules);
    const q = await t.query(api.mintFee.quoteMintFee, { creatorWallet: WALLET_A, creatorWallets: [WALLET_A], standardFeeUsdc: FEE, forceFree: false });
    expect(q).toMatchObject({ feeUsdc: 0, priorMints: 0 });
  });

  it("a same-session resume stays idempotent — its own agent never flips its free mint to $10", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    await t.mutation(api.mintFee.claimMint, claimArgs("s1", WALLET_A));
    await t.mutation(api.nftAgents.saveInfluencer, saveInfluencerArgs("s1", WALLET_A, "mint_1"));
    // Re-quote + re-claim the SAME session — still its locked-in FREE decision.
    const requote = await t.mutation(api.mintFee.reserveMintFee, reserveArgs("s1", WALLET_A));
    expect(requote).toMatchObject({ feeUsdc: 0, alreadyMinted: true, mintAddress: "mint_1" });
    const reclaim = await t.mutation(api.mintFee.claimMint, claimArgs("s1", WALLET_A));
    expect(reclaim).toMatchObject({ ok: true, feeUsdc: 0 });
  });

  it("does not count the current session's OWN agent as a prior mint (ownMint self-exclusion)", async () => {
    const t = convexTest(schema, modules);
    // A still-"reserved" session that already carries its mint + agent: countPrior
    // must not treat the session's OWN agent as a prior mint (no free→$50 flip).
    await t.run(async (ctx) => {
      await ctx.db.insert("agentMintCharges", {
        sessionId: "s1", creatorWallet: WALLET_A, mintAddress: "mint_1", feeUsdc: 0,
        reason: "first_agent_free", status: "reserved", createdAt: Date.now(),
      });
    });
    await seedInfluencer(t, "mint_1", WALLET_A);
    const q = await t.query(api.mintFee.quoteMintFee, { sessionId: "s1", creatorWallet: WALLET_A, creatorWallets: [WALLET_A], standardFeeUsdc: FEE, forceFree: false });
    expect(q.feeUsdc).toBe(0);
  });
});
