/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;
const A = "WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", B = "WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("referrals", () => {
  it("gives a wallet one stable code", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(api.referrals.ensureCode, { wallet: A, authSecret: SECRET });
    expect(first).toMatch(/^[A-Z2-9]{8}$/);
    expect(await t.mutation(api.referrals.ensureCode, { wallet: A, authSecret: SECRET })).toBe(first);
  });
  it("binds a wallet once, never to itself, and refuses loops", async () => {
    const t = convexTest(schema, modules);
    const codeA = await t.mutation(api.referrals.ensureCode, { wallet: A, authSecret: SECRET });
    const codeB = await t.mutation(api.referrals.ensureCode, { wallet: B, authSecret: SECRET });
    expect(await t.mutation(api.referrals.bind, { refereeWallet: A, code: codeA, authSecret: SECRET })).toMatchObject({ ok: false, reason: "self_referral" });
    expect(await t.mutation(api.referrals.bind, { refereeWallet: B, code: "NOPE1234", authSecret: SECRET })).toMatchObject({ ok: false, reason: "unknown_code" });
    expect(await t.mutation(api.referrals.bind, { refereeWallet: B, code: codeA, authSecret: SECRET })).toEqual({ ok: true });
    expect(await t.mutation(api.referrals.bind, { refereeWallet: B, code: codeA, authSecret: SECRET })).toMatchObject({ reason: "already_bound" });
    expect(await t.mutation(api.referrals.bind, { refereeWallet: A, code: codeB, authSecret: SECRET })).toMatchObject({ reason: "loop" });
    expect(await t.query(api.referrals.bindingFor, { refereeWallet: B, authSecret: SECRET })).toMatchObject({ referrerWallet: A });
  });
  it("records the share once per settlement, as pending when the referrer holds enough and as missed when not", async () => {
    const t = convexTest(schema, modules);
    const args = { referrerWallet: A, refereeWallet: B, mintAddress: "mint1", spendUsdc: 1, marginUsdc: 0.13, rate: 0.25, authSecret: SECRET };
    expect(await t.mutation(api.referrals.accrue, { ...args, settlementId: "s1", tier: 2 })).toMatchObject({ ok: true, status: "pending", shareUsdc: 0.0325 });
    expect(await t.mutation(api.referrals.accrue, { ...args, settlementId: "s1", tier: 2 })).toMatchObject({ duplicate: true });
    expect(await t.mutation(api.referrals.accrue, { ...args, settlementId: "s2", tier: 0 })).toMatchObject({ ok: true, status: "missed" });
    const mine = await t.query(api.referrals.mine, { wallet: A, authSecret: SECRET });
    expect(mine).toMatchObject({ pendingUsdc: 0.0325, missedUsdc: 0.0325, paidUsdc: 0 });
    const stats = await t.query(api.referrals.publicStats, {});
    expect(stats).toMatchObject({ accruedUsdc: 0.0325, missedUsdc: 0.0325, events: 2 });
    expect((await t.query(api.referrals.leaderboard, {}))[0].usdc).toBeCloseTo(0.0325, 4);
  });
  it("queues payouts at the minimum and marks them paid once, only with a real transfer signature", async () => {
    const t = convexTest(schema, modules);
    const args = { referrerWallet: A, refereeWallet: B, mintAddress: "mint1", spendUsdc: 50, marginUsdc: 6.5, rate: 0.3, tier: 3, authSecret: SECRET };
    await t.mutation(api.referrals.accrue, { ...args, settlementId: "p1" }); // 1.95
    await t.mutation(api.referrals.accrue, { ...args, settlementId: "p2" }); // 1.95
    expect(await t.query(api.referrals.payoutQueue, { minUsdc: 5, authSecret: SECRET })).toEqual([]);
    await t.mutation(api.referrals.accrue, { ...args, settlementId: "p3" }); // 5.85 total
    const queue = await t.query(api.referrals.payoutQueue, { minUsdc: 5, authSecret: SECRET });
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ wallet: A, usdc: 5.85, accruals: 3 });
    await expect(t.mutation(api.referrals.markPaid, { referrerWallet: A, upToAt: queue[0].upToAt, txSignature: "short", authSecret: SECRET })).rejects.toThrow(/signature/);
    const sig = "5".repeat(88);
    expect(await t.mutation(api.referrals.markPaid, { referrerWallet: A, upToAt: queue[0].upToAt, txSignature: sig, authSecret: SECRET })).toEqual({ paid: 3, usdc: 5.85 });
    expect(await t.mutation(api.referrals.markPaid, { referrerWallet: A, upToAt: queue[0].upToAt, txSignature: sig, authSecret: SECRET })).toEqual({ paid: 0, usdc: 0 });
    expect(await t.query(api.referrals.mine, { wallet: A, authSecret: SECRET })).toMatchObject({ pendingUsdc: 0, paidUsdc: 5.85 });
    expect(await t.query(api.referrals.payoutQueue, { minUsdc: 5, authSecret: SECRET })).toEqual([]);
  });
  it("rejects callers without the server secret", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.referrals.ensureCode, { wallet: A, authSecret: "wrong" })).rejects.toThrow(/unauthorized/);
  });
});

describe("referral payouts", () => {
  const accrue = (t: ReturnType<typeof convexTest>, n: number, share: number) =>
    t.mutation(api.referrals.accrue, { settlementId: `s${n}`, referrerWallet: A, refereeWallet: B, mintAddress: "m", spendUsdc: share * 4, marginUsdc: share / 0.5, rate: 0.5, tier: 1, authSecret: SECRET });
  it("pays 50% of the margin at the starting tier", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(api.referrals.accrue, { settlementId: "x", referrerWallet: A, refereeWallet: B, mintAddress: "m", spendUsdc: 10, marginUsdc: 1.3, rate: 0.5, tier: 1, authSecret: SECRET });
    expect(r).toMatchObject({ ok: true, shareUsdc: 0.65, status: "pending" });
  });
  it("leases earnings once, finishes with the signature, and never pays the same earnings twice", async () => {
    const t = convexTest(schema, modules);
    await accrue(t, 1, 3); await accrue(t, 2, 3);
    expect(await t.query(api.referrals.payoutWork, { minUsdc: 5, authSecret: SECRET })).toEqual([A]);
    const lease = await t.mutation(api.referrals.beginPayout, { referrerWallet: A, minUsdc: 5, authSecret: SECRET });
    expect(lease).toMatchObject({ kind: "fresh", usdc: 6 });
    if (lease.kind !== "fresh") throw new Error("expected a fresh lease");
    // A second run while the first is unfinished resumes it instead of leasing the same money again.
    expect(await t.mutation(api.referrals.beginPayout, { referrerWallet: A, minUsdc: 5, authSecret: SECRET })).toMatchObject({ kind: "resume", id: lease.id });
    const sig = "5".repeat(88);
    await t.mutation(api.referrals.recordPayoutSig, { id: lease.id, sig, lastValidBlockHeight: 123, authSecret: SECRET });
    expect(await t.mutation(api.referrals.finishPayout, { id: lease.id, sig, authSecret: SECRET })).toMatchObject({ paid: 2, usdc: 6 });
    expect(await t.mutation(api.referrals.finishPayout, { id: lease.id, sig, authSecret: SECRET })).toMatchObject({ paid: 0 });
    expect(await t.mutation(api.referrals.beginPayout, { referrerWallet: A, minUsdc: 5, authSecret: SECRET })).toEqual({ kind: "none" });
    expect(await t.query(api.referrals.mine, { wallet: A, authSecret: SECRET })).toMatchObject({ pendingUsdc: 0, paidUsdc: 6 });
  });
  it("hands earnings back to the queue after a payout that never left", async () => {
    const t = convexTest(schema, modules);
    await accrue(t, 1, 6);
    const lease = await t.mutation(api.referrals.beginPayout, { referrerWallet: A, minUsdc: 5, authSecret: SECRET });
    if (lease.kind !== "fresh") throw new Error("expected a fresh lease");
    await t.mutation(api.referrals.failPayout, { id: lease.id, error: "payout wallet has too little USDC", authSecret: SECRET });
    expect(await t.mutation(api.referrals.beginPayout, { referrerWallet: A, minUsdc: 5, authSecret: SECRET })).toMatchObject({ kind: "fresh", usdc: 6 });
  });
  it("does not offer a payout below the minimum", async () => {
    const t = convexTest(schema, modules);
    await accrue(t, 1, 2);
    expect(await t.query(api.referrals.payoutWork, { minUsdc: 5, authSecret: SECRET })).toEqual([]);
    expect(await t.mutation(api.referrals.beginPayout, { referrerWallet: A, minUsdc: 5, authSecret: SECRET })).toEqual({ kind: "none" });
  });
});
