/// <reference types="vite/client" />
/**
 * H03 (Part 2 / defense-in-depth): a mint-fee payment signature is SINGLE-USE.
 *
 * verifyUsdcDeposit is a pure on-chain read with no replay memory, so the same
 * real $10 payment signature verifies true forever. Without a DB-side guard a
 * wallet that made ONE genuine payment could replay that one signature across
 * unlimited fresh builder sessions, stranding each at "paid" and then minting
 * extra agents for free. mintFee.markMintPaid now rejects a signature that
 * already funded another of the wallet's paid/minted reservations. The guard is
 * keyed on THIS ledger (not the shared processedSignatures) so it never collides
 * with the "nft_mint" consume that nftAgents.completeMint does on the same
 * signature. The free-tier path (no fee, no signature) is untouched.
 */
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-internal-secret-h03";
const FEE = 10;
const WALLET = "WalletH03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "WalletH03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

beforeEach(() => {
  process.env.INTERNAL_CRON_SECRET = SECRET;
});

function reserveArgs(sessionId: string, wallet: string, extra: Record<string, unknown> = {}) {
  return { authSecret: SECRET, sessionId, creatorWallet: wallet, creatorWallets: [wallet], standardFeeUsdc: FEE, forceFree: false, ...extra };
}

/** Put `wallet` into "has two prior committed mints" state so its NEXT mint owes $10. */
async function primePaidState(t: ReturnType<typeof convexTest>, wallet: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agentMintCharges", {
      sessionId: `prior1:${wallet}`, creatorWallet: wallet, mintAddress: `mintPrior1:${wallet}`,
      feeUsdc: 0, reason: "first_agent_free", status: "minted", createdAt: Date.now(),
    });
    await ctx.db.insert("agentMintCharges", {
      sessionId: `prior2:${wallet}`, creatorWallet: wallet, mintAddress: `mintPrior2:${wallet}`,
      feeUsdc: 0, reason: "first_agent_free", status: "minted", createdAt: Date.now(),
    });
  });
}

describe("mintFee.markMintPaid — single-use payment signature (H03)", () => {
  it("REJECTS reusing one payment signature to pay for a SECOND session", async () => {
    const t = convexTest(schema, modules);
    await primePaidState(t, WALLET);
    // Session A: legit $10 payment with signature SIG_REAL.
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("A", WALLET));
    await t.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId: "A", txSignature: "SIG_REAL" });
    // Session B: same wallet replays the SAME signature — must be rejected.
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("B", WALLET));
    await expect(
      t.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId: "B", txSignature: "SIG_REAL" }),
    ).rejects.toThrow(/already used/i);
    // Row B stays "reserved" (not paid) — no free mint can follow from it.
    const rowB = await t.run(async (ctx) =>
      ctx.db.query("agentMintCharges").withIndex("by_session", (q) => q.eq("sessionId", "B")).first());
    expect(rowB?.status).toBe("reserved");
  });

  it("ACCEPTS a fresh, never-used signature for a second paid mint (legit $100 → two agents)", async () => {
    const t = convexTest(schema, modules);
    await primePaidState(t, WALLET);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("A", WALLET));
    await t.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId: "A", txSignature: "SIG_ONE" });
    // A genuinely separate $10 payment (distinct on-chain signature) is allowed.
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("B", WALLET));
    await t.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId: "B", txSignature: "SIG_TWO" });
    const rowB = await t.run(async (ctx) =>
      ctx.db.query("agentMintCharges").withIndex("by_session", (q) => q.eq("sessionId", "B")).first());
    expect(rowB?.status).toBe("paid");
    expect(rowB?.txSignature).toBe("SIG_TWO");
  });

  it("is IDEMPOTENT for the same session — re-marking with the same sig does not self-reject (route retry)", async () => {
    const t = convexTest(schema, modules);
    await primePaidState(t, WALLET);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("A", WALLET));
    await t.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId: "A", txSignature: "SIG_SAME" });
    await t.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId: "A", txSignature: "SIG_SAME" });
    const rowA = await t.run(async (ctx) =>
      ctx.db.query("agentMintCharges").withIndex("by_session", (q) => q.eq("sessionId", "A")).first());
    expect(rowA?.status).toBe("paid");
  });

  it("is wallet-scoped — one wallet's signature never blocks a DIFFERENT wallet's own signature", async () => {
    const t = convexTest(schema, modules);
    await primePaidState(t, WALLET);
    await primePaidState(t, OTHER);
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("A", WALLET));
    await t.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId: "A", txSignature: "SIG_W" });
    await t.mutation(api.mintFee.reserveMintFee, reserveArgs("C", OTHER));
    await t.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId: "C", txSignature: "SIG_O" });
    const rowC = await t.run(async (ctx) =>
      ctx.db.query("agentMintCharges").withIndex("by_session", (q) => q.eq("sessionId", "C")).first());
    expect(rowC?.status).toBe("paid");
  });

  it("FREE-TIER path is unaffected — a first free mint never touches markMintPaid and still works", async () => {
    const t = convexTest(schema, modules);
    // Fresh wallet → first mint is free (no fee, no signature).
    const r = await t.mutation(api.mintFee.reserveMintFee, reserveArgs("F", WALLET));
    expect(r).toMatchObject({ feeUsdc: 0, reason: "free" });
    const claim = await t.mutation(api.mintFee.claimMint, reserveArgs("F", WALLET));
    expect(claim.ok).toBe(true);
  });
});
