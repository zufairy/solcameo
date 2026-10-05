/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "RedeemMint11111111111111111111111111111111";
const HOLDER = "HolderWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const SECRET = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

/** Seed an account with `shares` held by HOLDER at NAV $1 (escrow == shares). */
async function seedHolder(t: TestConvex<typeof schema>, shares = 10_000) {
  await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
  await t.run(async (ctx) => {
    const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
    await ctx.db.patch(a!._id, { sharesOutstanding: shares, escrowUsdc: shares, liquidUsdc: shares });
    await ctx.db.insert("shareLedger", { mintAddress: MINT, wallet: HOLDER, kind: "buy", shares, navPerShare: 1, usdcAmount: shares, at: Date.now() });
  });
}

async function acct(t: TestConvex<typeof schema>) {
  return t.query(api.agentAccount.get, { mintAddress: MINT });
}
async function heldShares(t: TestConvex<typeof schema>) {
  return t.query(api.shares.walletShares, { mintAddress: MINT, wallet: HOLDER });
}

// ───────────────────────────────────────────────────────────────────────────
describe("shareRedemptions.begin (idempotent burn)", () => {
  it("a FRESH begin burns exactly once (shares + escrow debited at the 2% exit fee)", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const r = await t.mutation(api.shareRedemptions.begin, {
      mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 1_000, idempotencyKey: "k1", authSecret: SECRET,
    });
    expect(r.created).toBe(true);
    if (!r.created) throw new Error("unreachable");
    expect(r.payout).toBe(980);                 // 1000 × $1 × 0.98
    expect(r.exitFee).toBeCloseTo(20, 6);
    const a = await acct(t);
    expect(a!.sharesOutstanding).toBe(9_000);
    expect(a!.escrowUsdc).toBe(9_020);          // 10000 − 980 (fee retained)
    expect(await heldShares(t)).toBe(9_000);
  });

  it("a SAME-KEY retry does NOT burn again and does NOT create a second row (no double-burn)", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const first = await t.mutation(api.shareRedemptions.begin, {
      mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 1_000, idempotencyKey: "dup", authSecret: SECRET,
    });
    expect(first.created).toBe(true);
    const after1 = await acct(t);

    const retry = await t.mutation(api.shareRedemptions.begin, {
      mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 1_000, idempotencyKey: "dup", authSecret: SECRET,
    });
    expect(retry.created).toBe(false);
    if (retry.created) throw new Error("unreachable");
    expect(retry.locked).toBe(false);
    // Escrow + shares are UNCHANGED by the retry — the burn ran exactly once.
    const after2 = await acct(t);
    expect(after2!.escrowUsdc).toBe(after1!.escrowUsdc);
    expect(after2!.sharesOutstanding).toBe(after1!.sharesOutstanding);
    // Exactly ONE shareRedemptions row + ONE redeem ledger row exist.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("shareRedemptions").withIndex("by_mint_status", (q) => q.eq("mintAddress", MINT).eq("status", "pending")).collect());
    expect(rows).toHaveLength(1);
    const redeemRows = await t.run(async (ctx) =>
      (await ctx.db.query("shareLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect()).filter((x) => x.kind === "redeem"));
    expect(redeemRows).toHaveLength(1);
  });

  it("a DIFFERENT-key redemption while one is pending is LOCKED (no second burn)", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 1_000, idempotencyKey: "a", authSecret: SECRET });
    const before = await acct(t);
    const locked = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 500, idempotencyKey: "b", authSecret: SECRET });
    expect(locked.created).toBe(false);
    if (locked.created) throw new Error("unreachable");
    expect(locked.locked).toBe(true);
    const after = await acct(t);
    expect(after!.escrowUsdc).toBe(before!.escrowUsdc); // nothing burned
    expect(after!.sharesOutstanding).toBe(before!.sharesOutstanding);
  });

  it("rejects a burn larger than the holder owns (burn guard, no row created)", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 1_000);
    await expect(
      t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 1_001, idempotencyKey: "over", authSecret: SECRET }),
    ).rejects.toThrow(/shares/i);
  });

  it("rejects without the internal secret", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 1_000);
    await expect(
      t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 100, idempotencyKey: "x", authSecret: "wrong" }),
    ).rejects.toThrow(/unauthorized/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("shareRedemptions.markPaid / markAmbiguous (keeper resolution)", () => {
  it("a CONFIRM-AMBIGUOUS redemption is resolved by markPaid, not re-sent (no double-pay)", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const r = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 1_000, idempotencyKey: "amb", authSecret: SECRET });
    if (!r.created) throw new Error("unreachable");
    const burnedEscrow = (await acct(t))!.escrowUsdc;

    // The route saw a confirm-timeout WITH a sig → store it (no reverse).
    await t.mutation(api.shareRedemptions.markAmbiguous, {
      redemptionId: r.redemptionId, txSignature: "BroadcastSig111", lastValidBlockHeight: 555_000, attempts: 1, authSecret: SECRET,
    });
    let row = await t.query(api.shareRedemptions.getByIdem, { idempotencyKey: "amb", authSecret: SECRET });
    expect(row!.status).toBe("pending");
    expect(row!.txSignature).toBe("BroadcastSig111");
    expect(row!.lastValidBlockHeight).toBe(555_000);

    // The keeper verified the sig LANDED on-chain → markPaid (never re-transfers).
    await t.mutation(api.shareRedemptions.markPaid, { redemptionId: r.redemptionId, txSignature: "BroadcastSig111", authSecret: SECRET });
    row = await t.query(api.shareRedemptions.getByIdem, { idempotencyKey: "amb", authSecret: SECRET });
    expect(row!.status).toBe("paid");
    expect(row!.txSignature).toBe("BroadcastSig111");
    // The ledger burn row was stamped with the payout sig.
    const redeemRow = await t.run(async (ctx) => ctx.db.get(r.redeemRowId));
    expect(redeemRow!.txSignature).toBe("BroadcastSig111");
    // Escrow was NOT re-credited (the burn stands — the holder was paid).
    expect((await acct(t))!.escrowUsdc).toBe(burnedEscrow);
  });

  it("markAmbiguous never CLEARS an existing sig (a bare attempts touch keeps it)", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const r = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 100, idempotencyKey: "keep", authSecret: SECRET });
    if (!r.created) throw new Error("unreachable");
    await t.mutation(api.shareRedemptions.markAmbiguous, { redemptionId: r.redemptionId, txSignature: "Sig777", attempts: 1, authSecret: SECRET });
    // keeper soft-claim touch (no sig arg) — must NOT wipe Sig777.
    await t.mutation(api.shareRedemptions.markAmbiguous, { redemptionId: r.redemptionId, attempts: 2, authSecret: SECRET });
    const row = await t.query(api.shareRedemptions.getByIdem, { idempotencyKey: "keep", authSecret: SECRET });
    expect(row!.txSignature).toBe("Sig777");
    expect(row!.attempts).toBe(2);
  });

  it("clearSig drops a stale sig (the keeper's pre-retransfer marker) but keeps the row pending + attempts", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const r = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 100, idempotencyKey: "cs", authSecret: SECRET });
    if (!r.created) throw new Error("unreachable");
    // A prior failed/expired sig is recorded, then the keeper is about to broadcast a
    // FRESH tx: clearSig removes the stale sig so a crash-after-broadcast can't
    // re-read it and double-pay (the row becomes no-sig / attempts≥1 → alert path).
    await t.mutation(api.shareRedemptions.markAmbiguous, { redemptionId: r.redemptionId, txSignature: "StaleFailedSig", lastValidBlockHeight: 10, attempts: 1, authSecret: SECRET });
    await t.mutation(api.shareRedemptions.markAmbiguous, { redemptionId: r.redemptionId, clearSig: true, attempts: 2, authSecret: SECRET });
    const row = await t.query(api.shareRedemptions.getByIdem, { idempotencyKey: "cs", authSecret: SECRET });
    expect(row!.status).toBe("pending");
    expect(row!.txSignature).toBeNull();          // stale sig dropped
    expect(row!.lastValidBlockHeight).toBeNull(); // and its lvbh
    expect(row!.attempts).toBe(2);                // broadcast-attempt marker advanced
    // markFailed may now REVERSE it (no sig blocks it anymore).
    const res = await t.mutation(api.shareRedemptions.markFailed, { redemptionId: r.redemptionId, authSecret: SECRET });
    expect(res.ok).toBe(true);
  });

  it("markPaid is idempotent and refuses a reversed (failed) row", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const r = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 100, idempotencyKey: "p", authSecret: SECRET });
    if (!r.created) throw new Error("unreachable");
    await t.mutation(api.shareRedemptions.markPaid, { redemptionId: r.redemptionId, txSignature: "Paid1", authSecret: SECRET });
    const again = await t.mutation(api.shareRedemptions.markPaid, { redemptionId: r.redemptionId, txSignature: "Paid2", authSecret: SECRET });
    expect(again.alreadyPaid).toBe(true);
    const row = await t.query(api.shareRedemptions.getByIdem, { idempotencyKey: "p", authSecret: SECRET });
    expect(row!.txSignature).toBe("Paid1"); // not overwritten
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("shareRedemptions.markFailed (burn reversal)", () => {
  it("REVERSES the burn on a pre-broadcast failure — shares + escrow restored", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const before = await acct(t);
    const r = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 1_000, idempotencyKey: "f", authSecret: SECRET });
    if (!r.created) throw new Error("unreachable");
    expect((await acct(t))!.sharesOutstanding).toBe(9_000); // burned

    const res = await t.mutation(api.shareRedemptions.markFailed, { redemptionId: r.redemptionId, reason: "fees: no SOL", authSecret: SECRET });
    expect(res.ok).toBe(true);
    // Fully restored to the pre-redemption state.
    const after = await acct(t);
    expect(after!.sharesOutstanding).toBe(before!.sharesOutstanding);
    expect(after!.escrowUsdc).toBe(before!.escrowUsdc);
    expect(after!.liquidUsdc).toBe(before!.liquidUsdc);
    expect(await heldShares(t)).toBe(10_000); // holder keeps all shares
    // The burn ledger row was deleted (no lingering redeem row).
    const redeemRows = await t.run(async (ctx) =>
      (await ctx.db.query("shareLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect()).filter((x) => x.kind === "redeem"));
    expect(redeemRows).toHaveLength(0);
    const row = await t.query(api.shareRedemptions.getByIdem, { idempotencyKey: "f", authSecret: SECRET });
    expect(row!.status).toBe("failed");
    // And a NEW redemption is now allowed (the lock released).
    const fresh = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 500, idempotencyKey: "f2", authSecret: SECRET });
    expect(fresh.created).toBe(true);
  });

  it("REFUSES to reverse once a payout sig was broadcast (never restore shares AND pay)", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const r = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 1_000, idempotencyKey: "g", authSecret: SECRET });
    if (!r.created) throw new Error("unreachable");
    await t.mutation(api.shareRedemptions.markAmbiguous, { redemptionId: r.redemptionId, txSignature: "MaybeLanded", attempts: 1, authSecret: SECRET });
    const res = await t.mutation(api.shareRedemptions.markFailed, { redemptionId: r.redemptionId, authSecret: SECRET });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("has_broadcast_sig");
    // Still burned (not restored).
    expect((await acct(t))!.sharesOutstanding).toBe(9_000);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("shareRedemptions.listStranded (grace / soft-lease)", () => {
  it("does NOT list a freshly-created redemption (inside the grace window)", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 100, idempotencyKey: "s1", authSecret: SECRET });
    const stranded = await t.query(api.shareRedemptions.listStranded, { nowMs: Date.now(), graceMs: 5 * 60_000, limit: 50, authSecret: SECRET });
    expect(stranded).toHaveLength(0);
  });

  it("LISTS a pending redemption once it is older than the grace window", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const r = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 100, idempotencyKey: "s2", authSecret: SECRET });
    if (!r.created) throw new Error("unreachable");
    const future = Date.now() + 5 * 60_000 + 1;
    const stranded = await t.query(api.shareRedemptions.listStranded, { nowMs: future, graceMs: 5 * 60_000, limit: 50, authSecret: SECRET });
    expect(stranded.map((s) => s.redemptionId)).toContain(r.redemptionId);
  });

  it("never lists a PAID or FAILED redemption", async () => {
    const t = convexTest(schema, modules);
    await seedHolder(t, 10_000);
    const paid = await t.mutation(api.shareRedemptions.begin, { mintAddress: MINT, holderWallet: HOLDER, sharesToBurn: 100, idempotencyKey: "pd", authSecret: SECRET });
    if (!paid.created) throw new Error("unreachable");
    await t.mutation(api.shareRedemptions.markPaid, { redemptionId: paid.redemptionId, txSignature: "Done", authSecret: SECRET });
    const future = Date.now() + 5 * 60_000 + 1;
    const stranded = await t.query(api.shareRedemptions.listStranded, { nowMs: future, graceMs: 5 * 60_000, limit: 50, authSecret: SECRET });
    expect(stranded.map((s) => s.redemptionId)).not.toContain(paid.redemptionId);
  });
});
