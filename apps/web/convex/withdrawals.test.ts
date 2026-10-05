/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { GRACE_MS } from "../lib/economy/constants";

const modules = import.meta.glob("./**/*.ts");

// Money mutations are public but INTERNAL_CRON_SECRET-gated (same pattern as
// settlementRecovery.test.ts). Set the secret + pass authSecret everywhere.
const SECRET = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

const MINT = "WdTestMint11111111111111111111111111111111";
const MINT2 = "WdTestMint22222222222222222222222222222222";
const OWNER = "OwnerWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function begin(
  t: TestConvex<typeof schema>,
  key: string,
  opts: { mintAddress?: string; amountUsdc?: number } = {},
) {
  return t.mutation(api.withdrawals.begin, {
    mintAddress: opts.mintAddress ?? MINT,
    ownerWallet: OWNER,
    amountUsdc: opts.amountUsdc ?? 10,
    idempotencyKey: key,
    authSecret: SECRET,
  });
}

// ───────────────────────────────────────────────────────────────────────────
describe("withdrawals.begin (idempotency + one-in-flight-per-mint lock)", () => {
  it("creates a fresh pending row on the first call (existing:false)", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    expect(r.existing).toBe(false);
    expect(r.status).toBe("pending");
    expect(r.txSignature).toBeNull();
  });

  it("REPLAY with the same key returns the SAME row and never re-inserts", async () => {
    const t = convexTest(schema, modules);
    const first = await begin(t, "kdup");
    const second = await begin(t, "kdup");
    expect(second.existing).toBe(true);
    expect(second.id).toBe(first.id);
    const rows = await t.run(async (ctx) => ctx.db.query("agentWithdrawals").collect());
    expect(rows).toHaveLength(1); // exactly one row, no double-drain risk
  });

  it("a DIFFERENT key while another withdrawal for this mint is pending THROWS", async () => {
    const t = convexTest(schema, modules);
    await begin(t, "kA");
    await expect(begin(t, "kB", { amountUsdc: 5 })).rejects.toThrow(/in flight/i);
  });

  it("a DIFFERENT mint is NOT blocked by another mint's pending withdrawal", async () => {
    const t = convexTest(schema, modules);
    await begin(t, "kA");
    const other = await begin(t, "kC", { mintAddress: MINT2, amountUsdc: 3 });
    expect(other.existing).toBe(false);
  });

  it("once the pending row is PAID, a new key may begin (lock freed)", async () => {
    const t = convexTest(schema, modules);
    const first = await begin(t, "kA");
    await t.mutation(api.withdrawals.markPaid, { id: first.id as Id<"agentWithdrawals">, txSignature: "PaidSig1", authSecret: SECRET });
    const next = await begin(t, "kD");
    expect(next.existing).toBe(false);
  });

  it("once the pending row FAILED, a new key may begin (lock freed)", async () => {
    const t = convexTest(schema, modules);
    const first = await begin(t, "kA");
    await t.mutation(api.withdrawals.markFailed, { id: first.id as Id<"agentWithdrawals">, authSecret: SECRET });
    const next = await begin(t, "kE");
    expect(next.existing).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.withdrawals.begin, { mintAddress: MINT, ownerWallet: OWNER, amountUsdc: 10, idempotencyKey: "x", authSecret: "wrong" }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("rejects a non-positive amount", async () => {
    const t = convexTest(schema, modules);
    await expect(begin(t, "kZero", { amountUsdc: 0 })).rejects.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("withdrawals.markPaid (double-pay guard)", () => {
  it("stamps the signature + status paid on a pending row", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    await t.mutation(api.withdrawals.markPaid, { id: r.id as Id<"agentWithdrawals">, txSignature: "RealSig", authSecret: SECRET });
    const row = await t.run(async (ctx) => ctx.db.get(r.id as Id<"agentWithdrawals">));
    expect(row!.status).toBe("paid");
    expect(row!.txSignature).toBe("RealSig");
  });

  it("a SECOND markPaid on an already-paid row THROWS (never double-pays)", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    await t.mutation(api.withdrawals.markPaid, { id: r.id as Id<"agentWithdrawals">, txSignature: "First", authSecret: SECRET });
    await expect(
      t.mutation(api.withdrawals.markPaid, { id: r.id as Id<"agentWithdrawals">, txSignature: "Second", authSecret: SECRET }),
    ).rejects.toThrow(/already marked paid/);
  });

  it("PROMOTES a confirm-ambiguous (pending WITH a sig) row to paid (status-based guard)", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    const id = r.id as Id<"agentWithdrawals">;
    // ambiguous: a sig is stored while the row stays pending
    await t.mutation(api.withdrawals.markAmbiguous, { id, txSignature: "MaybeLanded", lastValidBlockHeight: 999, attempts: 1, authSecret: SECRET });
    // the keeper later verifies it landed and stamps it paid — must NOT throw even
    // though a txSignature is already present (guard is on status, not sig)
    await t.mutation(api.withdrawals.markPaid, { id, txSignature: "MaybeLanded", authSecret: SECRET });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("paid");
  });

  it("refuses to mark a FAILED row paid", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    const id = r.id as Id<"agentWithdrawals">;
    await t.mutation(api.withdrawals.markFailed, { id, authSecret: SECRET });
    await expect(
      t.mutation(api.withdrawals.markPaid, { id, txSignature: "x", authSecret: SECRET }),
    ).rejects.toThrow(/failed/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("withdrawals.markAmbiguous", () => {
  it("keeps status pending and stores sig + lvbh + attempts", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    const id = r.id as Id<"agentWithdrawals">;
    const res = await t.mutation(api.withdrawals.markAmbiguous, { id, txSignature: "Sig", lastValidBlockHeight: 12345, attempts: 2, authSecret: SECRET });
    expect(res.ok).toBe(true);
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("pending");
    expect(row!.txSignature).toBe("Sig");
    expect(row!.lastValidBlockHeight).toBe(12345);
    expect(row!.attempts).toBe(2);
  });

  it("no-ops on a paid row (never rewrites a settled withdrawal)", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    const id = r.id as Id<"agentWithdrawals">;
    await t.mutation(api.withdrawals.markPaid, { id, txSignature: "Paid", authSecret: SECRET });
    const res = await t.mutation(api.withdrawals.markAmbiguous, { id, txSignature: "Other", authSecret: SECRET });
    expect(res.ok).toBe(false);
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.txSignature).toBe("Paid"); // unchanged
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("withdrawals.markFailed", () => {
  it("moves a pending row to failed", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    const id = r.id as Id<"agentWithdrawals">;
    await t.mutation(api.withdrawals.markFailed, { id, authSecret: SECRET });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("failed");
  });

  it("throws on a PAID row (never un-pays)", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    const id = r.id as Id<"agentWithdrawals">;
    await t.mutation(api.withdrawals.markPaid, { id, txSignature: "Paid", authSecret: SECRET });
    await expect(t.mutation(api.withdrawals.markFailed, { id, authSecret: SECRET })).rejects.toThrow(/paid/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("withdrawals.listStranded (grace window + status filter)", () => {
  it("does NOT list a fresh pending row (inside the grace window)", async () => {
    const t = convexTest(schema, modules);
    await begin(t, "k1");
    const stranded = await t.query(api.withdrawals.listStranded, { nowMs: Date.now(), authSecret: SECRET });
    expect(stranded).toHaveLength(0);
  });

  it("lists a pending row once it is older than the grace window", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    const future = Date.now() + GRACE_MS + 5_000;
    const stranded = await t.query(api.withdrawals.listStranded, { nowMs: future, authSecret: SECRET });
    expect(stranded.map((s) => s.id)).toContain(r.id);
    expect(stranded.find((s) => s.id === r.id)!.txSignature).toBeNull();
  });

  it("surfaces the confirm-ambiguous sig + lvbh of a stranded row", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    const id = r.id as Id<"agentWithdrawals">;
    await t.mutation(api.withdrawals.markAmbiguous, { id, txSignature: "Ambig", lastValidBlockHeight: 777, attempts: 1, authSecret: SECRET });
    const future = Date.now() + GRACE_MS + 5_000;
    const stranded = await t.query(api.withdrawals.listStranded, { nowMs: future, authSecret: SECRET });
    const row = stranded.find((s) => s.id === r.id);
    expect(row).toBeDefined();
    expect(row!.txSignature).toBe("Ambig");
    expect(row!.lastValidBlockHeight).toBe(777);
  });

  it("never lists a PAID row", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    await t.mutation(api.withdrawals.markPaid, { id: r.id as Id<"agentWithdrawals">, txSignature: "Paid", authSecret: SECRET });
    const future = Date.now() + GRACE_MS + 5_000;
    const stranded = await t.query(api.withdrawals.listStranded, { nowMs: future, authSecret: SECRET });
    expect(stranded.map((s) => s.id)).not.toContain(r.id);
  });

  it("never lists a FAILED row", async () => {
    const t = convexTest(schema, modules);
    const r = await begin(t, "k1");
    await t.mutation(api.withdrawals.markFailed, { id: r.id as Id<"agentWithdrawals">, authSecret: SECRET });
    const future = Date.now() + GRACE_MS + 5_000;
    const stranded = await t.query(api.withdrawals.listStranded, { nowMs: future, authSecret: SECRET });
    expect(stranded.map((s) => s.id)).not.toContain(r.id);
  });

  it("rejects a wrong secret", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.withdrawals.listStranded, { nowMs: Date.now(), authSecret: "nope" }),
    ).rejects.toThrow(/unauthorized/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cross-table money-out lock (F1-0): a share redemption burns its shares BEFORE its
// USDC payout confirms — while it is `pending` the payout is still physically in the
// wallet, so a withdrawal must NOT be allowed to start and drain it.
describe("withdrawals.begin ✕ pending shareRedemptions (cross-table lock)", () => {
  /** Insert a shareRedemptions row (with its backing shareLedger redeem row) directly. */
  async function seedRedemption(
    t: TestConvex<typeof schema>,
    opts: { mintAddress?: string; status?: string; payoutUsdc?: number; key?: string } = {},
  ) {
    const mintAddress = opts.mintAddress ?? MINT;
    await t.run(async (ctx) => {
      const redeemRowId = await ctx.db.insert("shareLedger", {
        mintAddress, wallet: "HolderRedeemer", kind: "redeem", shares: -100, navPerShare: 1, usdcAmount: opts.payoutUsdc ?? 98, exitFeeUsdc: 2, at: Date.now(),
      });
      await ctx.db.insert("shareRedemptions", {
        mintAddress, holderWallet: "HolderRedeemer", idempotencyKey: opts.key ?? "red-1",
        sharesBurned: 100, payoutUsdc: opts.payoutUsdc ?? 98, exitFeeUsdc: 2, redeemRowId,
        status: opts.status ?? "pending", attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
  }

  it("REFUSES to begin a withdrawal while a redemption for the SAME mint is pending", async () => {
    const t = convexTest(schema, modules);
    await seedRedemption(t, { status: "pending" });
    await expect(begin(t, "w1")).rejects.toThrow(/redemption/i);
    // No withdrawal row was created (fail-closed, before any transfer).
    const rows = await t.run(async (ctx) => ctx.db.query("agentWithdrawals").collect());
    expect(rows).toHaveLength(0);
  });

  it("ALLOWS a withdrawal when the mint's redemption already SETTLED (paid) — only pending blocks", async () => {
    const t = convexTest(schema, modules);
    await seedRedemption(t, { status: "paid" });
    const r = await begin(t, "w2");
    expect(r.existing).toBe(false); // not blocked by a settled redemption
  });

  it("ALLOWS a withdrawal when the mint's redemption was REVERSED (failed)", async () => {
    const t = convexTest(schema, modules);
    await seedRedemption(t, { status: "failed" });
    const r = await begin(t, "w3");
    expect(r.existing).toBe(false);
  });

  it("a redemption pending for a DIFFERENT mint does NOT block this mint's withdrawal", async () => {
    const t = convexTest(schema, modules);
    await seedRedemption(t, { mintAddress: MINT2, status: "pending" });
    const r = await begin(t, "w4"); // MINT (not MINT2)
    expect(r.existing).toBe(false);
  });

  it("a same-key REPLAY still returns the existing row even if a redemption later goes pending (retry-safe)", async () => {
    const t = convexTest(schema, modules);
    // First withdrawal begins cleanly (no redemption yet).
    const first = await begin(t, "wreplay");
    expect(first.existing).toBe(false);
    // Now a redemption for the mint goes pending; a REPLAY of the same key must still
    // return the existing row (the keeper owns the in-flight transfer) — the guard
    // must not strand an already-created withdrawal.
    await seedRedemption(t, { status: "pending" });
    const replay = await begin(t, "wreplay");
    expect(replay.existing).toBe(true);
    expect(replay.id).toBe(first.id);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("withdrawals.getByIdem", () => {
  it("returns the row for a known key, null for an unknown one", async () => {
    const t = convexTest(schema, modules);
    await begin(t, "known");
    const found = await t.query(api.withdrawals.getByIdem, { idempotencyKey: "known", authSecret: SECRET });
    expect(found?.idempotencyKey).toBe("known");
    const missing = await t.query(api.withdrawals.getByIdem, { idempotencyKey: "nope", authSecret: SECRET });
    expect(missing).toBeNull();
  });
});
