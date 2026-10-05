/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import { GRACE_MS, LEASE_MS } from "../lib/economy/constants";
import { parseInflight, isInflight, isPaidSig, buildInflight } from "../lib/economy/settlementSentinel";

const modules = import.meta.glob("./**/*.ts");
const MINT = "RecovTestMint11111111111111111111111111111";

type StrandedRow = {
  settlementId: string;
  mintAddress: string;
  amountUsdc: number;
  coversUsageIds: string[];
  sentinel: string | null;
  at: number;
};

// Money mutations are public but INTERNAL_CRON_SECRET-gated.
const SECRET = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

async function seedAccount(t: TestConvex<typeof schema>, escrowUsdc = 100) {
  await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
  await t.run(async (ctx) => {
    const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
    await ctx.db.patch(a!._id, { escrowUsdc, liquidUsdc: escrowUsdc });
  });
}

/** Book a settlement via the real pure settleTab path (record usage → settle). */
async function bookSettlement(t: TestConvex<typeof schema>): Promise<Id<"feeSettlements">> {
  await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });
  const res = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
  if (!res.settled) throw new Error("expected settled");
  return res.settlementId as Id<"feeSettlements">;
}

// ───────────────────────────────────────────────────────────────────────────
describe("settleTab purity (regression guard for usage.test.ts)", () => {
  it("books a feeSettlements row with txSignature UNDEFINED (no sentinel)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.txSignature).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("claimSettlement (per-row compare-and-set lock)", () => {
  it("first claim wins and writes an INFLIGHT sentinel; returns amount + covers + mint", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);

    const now = Date.now();
    const r = await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tokenA", nowMs: now, authSecret: SECRET });
    expect(r.claimed).toBe(true);
    if (!r.claimed) throw new Error("unreachable");
    expect(r.amountUsdc).toBe(0.4);
    expect(r.mintAddress).toBe(MINT);
    expect(r.coversUsageIds).toHaveLength(1);

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(isInflight(row!.txSignature)).toBe(true);
    const parsed = parseInflight(row!.txSignature);
    expect(parsed!.token).toBe("tokenA");
    expect(parsed!.expiryMs).toBe(now + LEASE_MS);
  });

  it("second concurrent claim is REJECTED while the first lease is live", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);

    const now = Date.now();
    const first = await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tokenA", nowMs: now, authSecret: SECRET });
    const second = await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tokenB", nowMs: now, authSecret: SECRET });
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect((second as { reason?: string }).reason).toBe("locked");

    // the sentinel still belongs to tokenA (tokenB did NOT overwrite it)
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(parseInflight(row!.txSignature)!.token).toBe("tokenA");
  });

  it("an EXPIRED lease is stealable by a new claimer", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);

    const t0 = Date.now();
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "stale", nowMs: t0, authSecret: SECRET });
    // jump past the lease expiry
    const later = t0 + LEASE_MS + 1;
    const steal = await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "fresh", nowMs: later, authSecret: SECRET });
    expect(steal.claimed).toBe(true);
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(parseInflight(row!.txSignature)!.token).toBe("fresh");
    expect(parseInflight(row!.txSignature)!.expiryMs).toBe(later + LEASE_MS);
  });

  it("F4: a MALFORMED INFLIGHT sentinel is reclaimable (the keeper steals it)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    // Corrupt the sentinel so parseInflight returns null.
    await t.run(async (ctx) => ctx.db.patch(id, { txSignature: "INFLIGHT:garbage-no-colon" }));
    const r = await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "rescuer", nowMs: Date.now(), authSecret: SECRET });
    expect(r.claimed).toBe(true);
    const row = await t.run(async (ctx) => ctx.db.get(id));
    // It is now owned by the rescuer's fresh, well-formed lease.
    expect(parseInflight(row!.txSignature)!.token).toBe("rescuer");
  });

  it("a PAID row is never claimable", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: Date.now(), authSecret: SECRET });
    await t.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: "RealBase58Sig111", authSecret: SECRET });

    const r = await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok2", nowMs: Date.now(), authSecret: SECRET });
    expect(r.claimed).toBe(false);
    expect((r as { reason?: string }).reason).toBe("paid");
  });

  it("rejects a call without the internal secret", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    await expect(
      t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "x", nowMs: Date.now(), authSecret: "wrong" }),
    ).rejects.toThrow(/unauthorized/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("releaseSettlement (pre-broadcast failure → durable cooldown)", () => {
  it("excludes insufficient-funds retries until their 30-minute cooldown expires", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    const now = Date.now();
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "mine", nowMs: now, authSecret: SECRET });
    await t.mutation(api.usage.releaseSettlement, { settlementId: id, claimToken: "mine", nowMs: now, retryDelayMs: 1_800_000, authSecret: SECRET });
    expect(await t.query(api.usage.listStrandedSettlements, { nowMs: now + 1_799_999, authSecret: SECRET })).toEqual([]);
    const due = await t.query(api.usage.listStrandedSettlements, { nowMs: now + 1_800_001, authSecret: SECRET });
    expect(due.map(r => r.settlementId)).toContain(id);
  });
  it("defers retries while retaining unpaid debt", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    const now = Date.now();
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "mine", nowMs: now, authSecret: SECRET });
    const r = await t.mutation(api.usage.releaseSettlement, { settlementId: id, claimToken: "mine", nowMs: now, authSecret: SECRET });
    expect(r.released).toBe(true);
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(parseInflight(row!.txSignature)!.expiryMs).toBe(now + 300_000);
    expect(row!.paid).toBe(false);
    const early = await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "retry", nowMs: now + 1, authSecret: SECRET });
    expect(early.claimed).toBe(false);
    const later = await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "retry", nowMs: now + 300_001, authSecret: SECRET });
    expect(later.claimed).toBe(true);
  });

  it("refuses to release a lease owned by someone else (still live)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    const now = Date.now();
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "owner", nowMs: now, authSecret: SECRET });
    const r = await t.mutation(api.usage.releaseSettlement, { settlementId: id, claimToken: "intruder", nowMs: now, authSecret: SECRET });
    expect(r.released).toBe(false);
    expect((r as { reason?: string }).reason).toBe("owned_by_other");
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(parseInflight(row!.txSignature)!.token).toBe("owner");
  });

  it("never wipes a real paid signature", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: Date.now(), authSecret: SECRET });
    await t.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: "PaidSig222", authSecret: SECRET });
    const r = await t.mutation(api.usage.releaseSettlement, { settlementId: id, claimToken: "tok", nowMs: Date.now(), authSecret: SECRET });
    expect(r.released).toBe(false);
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.txSignature).toBe("PaidSig222");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("markSettlementPaid (overwrites INFLIGHT, rejects real sig)", () => {
  it("OVERWRITES an INFLIGHT sentinel with the confirmed signature", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: Date.now(), authSecret: SECRET });
    // currently INFLIGHT
    const before = await t.run(async (ctx) => ctx.db.get(id));
    expect(isInflight(before!.txSignature)).toBe(true);

    await t.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: "ConfirmedSig333", authSecret: SECRET });
    const after = await t.run(async (ctx) => ctx.db.get(id));
    expect(after!.txSignature).toBe("ConfirmedSig333");
    expect(isPaidSig(after!.txSignature)).toBe(true);
  });

  it("rejects re-marking an already-paid (real sig) settlement", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: Date.now(), authSecret: SECRET });
    await t.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: "FirstReal444", authSecret: SECRET });
    await expect(
      t.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: "SecondReal555", authSecret: SECRET }),
    ).rejects.toThrow(/already paid/);
  });

  it("refuses to mark paid with an INFLIGHT value", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    await expect(
      t.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: buildInflight("x", Date.now()), authSecret: SECRET }),
    ).rejects.toThrow(/INFLIGHT/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("markSettlementConfirmAmbiguous (confirm-step ambiguity)", () => {
  it("embeds the confirm sig into the INFLIGHT sentinel WITHOUT marking paid or releasing", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    const now = Date.now();
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: now, authSecret: SECRET });
    const r = await t.mutation(api.usage.markSettlementConfirmAmbiguous, { settlementId: id, claimToken: "tok", confirmSig: "MaybeLanded666", authSecret: SECRET });
    expect(r.ok).toBe(true);

    const row = await t.run(async (ctx) => ctx.db.get(id));
    // still INFLIGHT (NOT paid), lease preserved, sig recoverable
    expect(isInflight(row!.txSignature)).toBe(true);
    expect(isPaidSig(row!.txSignature)).toBe(false);
    const parsed = parseInflight(row!.txSignature)!;
    expect(parsed.token).toBe("tok");
    expect(parsed.expiryMs).toBe(now + LEASE_MS);
    expect(parsed.confirmSig).toBe("MaybeLanded666");
  });

  it("only the lease owner may annotate", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "owner", nowMs: Date.now(), authSecret: SECRET });
    const r = await t.mutation(api.usage.markSettlementConfirmAmbiguous, { settlementId: id, claimToken: "intruder", confirmSig: "x", authSecret: SECRET });
    expect(r.ok).toBe(false);
  });

  it("F2: threads lastValidBlockHeight + attempts into the sentinel (recoverable by the keeper)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    const now = Date.now();
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: now, authSecret: SECRET });
    const r = await t.mutation(api.usage.markSettlementConfirmAmbiguous, {
      settlementId: id, claimToken: "tok", confirmSig: "DroppedSig999",
      lastValidBlockHeight: 555_000, attempts: 2, authSecret: SECRET,
    });
    expect(r.ok).toBe(true);

    const row = await t.run(async (ctx) => ctx.db.get(id));
    const parsed = parseInflight(row!.txSignature)!;
    expect(parsed.token).toBe("tok");
    expect(parsed.expiryMs).toBe(now + LEASE_MS); // lease preserved
    expect(parsed.confirmSig).toBe("DroppedSig999");
    expect(parsed.lastValidBlockHeight).toBe(555_000);
    expect(parsed.attempts).toBe(2);
    // still INFLIGHT, NOT paid
    expect(isInflight(row!.txSignature)).toBe(true);
    expect(isPaidSig(row!.txSignature)).toBe(false);
  });

  it("F2: works WITHOUT lastValidBlockHeight (legacy/pre-broadcast bet caller)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    const now = Date.now();
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: now, authSecret: SECRET });
    const r = await t.mutation(api.usage.markSettlementConfirmAmbiguous, {
      settlementId: id, claimToken: "tok", confirmSig: "LegacySig111", authSecret: SECRET,
    });
    expect(r.ok).toBe(true);
    const parsed = parseInflight((await t.run(async (ctx) => ctx.db.get(id)))!.txSignature)!;
    expect(parsed.confirmSig).toBe("LegacySig111");
    expect(parsed.lastValidBlockHeight).toBeUndefined();
    expect(parsed.attempts).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("listStrandedSettlements (grace window + sentinel filter)", () => {
  it("does NOT list a freshly-booked row (inside the grace window)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await bookSettlement(t);
    const stranded = await t.query(api.usage.listStrandedSettlements, { nowMs: Date.now(), authSecret: SECRET });
    expect(stranded).toHaveLength(0);
  });

  it("lists an UNATTEMPTED row once it is older than the grace window", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    // advance virtual now past at + GRACE_MS
    const future = Date.now() + GRACE_MS + 1;
    const stranded = await t.query(api.usage.listStrandedSettlements, { nowMs: future, authSecret: SECRET });
    expect(stranded.map((s: StrandedRow) => s.settlementId)).toContain(id);
    expect(stranded.find((s: StrandedRow) => s.settlementId === id)!.sentinel).toBeNull();
  });

  it("SKIPS a row whose INFLIGHT lease is still live (settler presumed working)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    const future = Date.now() + GRACE_MS + 1;
    // claim with a lease that extends well past `future`
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "live", nowMs: future, authSecret: SECRET });
    const stranded = await t.query(api.usage.listStrandedSettlements, { nowMs: future + 1, authSecret: SECRET });
    expect(stranded.map((s: StrandedRow) => s.settlementId)).not.toContain(id);
  });

  it("LISTS a row whose INFLIGHT lease has expired (and surfaces its confirm sig)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    const claimAt = Date.now();
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "crashed", nowMs: claimAt, authSecret: SECRET });
    await t.mutation(api.usage.markSettlementConfirmAmbiguous, { settlementId: id, claimToken: "crashed", confirmSig: "AmbigSig777", authSecret: SECRET });
    // now is past BOTH the grace window AND the lease expiry
    const future = Math.max(claimAt + LEASE_MS, Date.now() + GRACE_MS) + 1;
    const stranded = await t.query(api.usage.listStrandedSettlements, { nowMs: future, authSecret: SECRET });
    const row = stranded.find((s: StrandedRow) => s.settlementId === id);
    expect(row).toBeDefined();
    expect(parseInflight(row!.sentinel)!.confirmSig).toBe("AmbigSig777");
  });

  it("never lists a PAID row", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: Date.now(), authSecret: SECRET });
    await t.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: "Paid888", authSecret: SECRET });
    const stranded = await t.query(api.usage.listStrandedSettlements, { nowMs: Date.now() + GRACE_MS + 1, authSecret: SECRET });
    expect(stranded.map((s: StrandedRow) => s.settlementId)).not.toContain(id);
  });

  it("F4: SURFACES a row carrying a malformed INFLIGHT sentinel (recoverable, not stranded)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const id = await bookSettlement(t);
    // Force a corrupt INFLIGHT-prefixed value that parseInflight cannot decode.
    await t.run(async (ctx) => ctx.db.patch(id, { txSignature: "INFLIGHT:garbage-no-colon" }));
    const stranded = await t.query(api.usage.listStrandedSettlements, { nowMs: Date.now() + GRACE_MS + 1, authSecret: SECRET });
    // Before F4 this row was neither paid nor claimable → silently stuck. Now it
    // is listed so the keeper reclaims and recovers it.
    expect(stranded.map((s: StrandedRow) => s.settlementId)).toContain(id);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("reconcile RE-CREDIT guard (the stranded-money bug)", () => {
  it("an UNPAID settlement is NOT re-credited to spendable (held out of escrow)", async () => {
    const t = convexTest(schema, modules);
    // record + settle: tab is zeroed, an UNPAID feeSettlements row of 0.4 remains.
    await fundAndBook(t, 100); // escrow funded to 100, then book 0.4
    // raw on-chain balance is still 100 (the transfer never happened). Reconcile
    // must subtract the 0.4 unpaid settlement → spendable = 99.6, escrow = 99.6.
    const recon = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, {
      mintAddress: MINT, onchainUsdc: 100, authSecret: SECRET,
    });
    expect(recon.ok).toBe(true);
    if (!recon.ok) throw new Error("unreachable");
    expect(recon.escrowUsdc).toBeCloseTo(99.6, 6);
    expect(recon.spendableUsdc).toBeCloseTo(99.6, 6);
  });

  it("an INFLIGHT (claimed-but-unpaid) settlement is ALSO held out of spendable", async () => {
    const t = convexTest(schema, modules);
    await fundAndBook(t, 100);
    const settlements = await t.run(async (ctx) =>
      ctx.db.query("feeSettlements").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    const id = settlements[0]._id;
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: Date.now(), authSecret: SECRET });
    const recon = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 100, authSecret: SECRET });
    if (!recon.ok) throw new Error("unreachable");
    expect(recon.escrowUsdc).toBeCloseTo(99.6, 6); // INFLIGHT == unpaid
  });

  it("a PAID settlement is NOT subtracted (the on-chain balance already dropped)", async () => {
    const t = convexTest(schema, modules);
    await fundAndBook(t, 100);
    const settlements = await t.run(async (ctx) =>
      ctx.db.query("feeSettlements").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    const id = settlements[0]._id;
    await t.mutation(api.usage.claimSettlement, { settlementId: id, claimToken: "tok", nowMs: Date.now(), authSecret: SECRET });
    await t.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: "Paid999", authSecret: SECRET });
    // after the on-chain transfer the wallet holds 99.6; reconcile must NOT
    // subtract the (now paid) 0.4 again.
    const recon = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 99.6, authSecret: SECRET });
    if (!recon.ok) throw new Error("unreachable");
    expect(recon.escrowUsdc).toBeCloseTo(99.6, 6);
    expect(recon.spendableUsdc).toBeCloseTo(99.6, 6);
  });

  it("NO DOUBLE REDUCE: unsettled tab + settled-unpaid never both hit spendable", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, 0);
    // Charge TWO services: render (0.40) settled, image_gen (0.05) left on the tab.
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 100, liquidUsdc: 100 });
    });
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });
    // settle ONLY the render charge (settleTab sweeps the whole current tab → 0.40,
    // and ZEROES the tab). The feeSettlements row (0.40) is unpaid.
    await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    // now add a fresh image_gen charge that lands on the (now-zeroed) tab.
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "image_gen", qty: 1, authSecret: SECRET });

    // tab should be exactly 0.05 (image_gen), settled-unpaid should be 0.40 (render).
    const acctBefore = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acctBefore!.unsettledTabUsdc).toBeCloseTo(0.05, 6);

    // Raw on-chain still 100 (no transfer happened). Correct spendable:
    //   escrow = 100 - 0.40 (settled-unpaid) = 99.60
    //   spendable = escrow - 0.05 (tab) = 99.55
    // The render 0.40 must be counted ONCE (via the settlement), the image_gen
    // 0.05 ONCE (via the tab) — total reduction 0.45, NOT 0.85.
    const recon = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 100, authSecret: SECRET });
    if (!recon.ok) throw new Error("unreachable");
    expect(recon.escrowUsdc).toBeCloseTo(99.6, 6);       // only the settled-unpaid subtracted from escrow
    expect(recon.spendableUsdc).toBeCloseTo(99.55, 6);   // tab subtracted on top — single count each
  });
});

/** Helper: fund escrow to `escrow`, then record+settle a render (0.4) leaving an
 *  UNPAID feeSettlements row. Returns the settlement id. */
async function fundAndBook(t: TestConvex<typeof schema>, escrow: number): Promise<Id<"feeSettlements">> {
  await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
  await t.run(async (ctx) => {
    const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
    await ctx.db.patch(a!._id, { escrowUsdc: escrow, liquidUsdc: escrow });
  });
  await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });
  const res = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
  if (!res.settled) throw new Error("expected settled");
  return res.settlementId as Id<"feeSettlements">;
}
