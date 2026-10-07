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
  it("rejects callers without the server secret", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.referrals.ensureCode, { wallet: A, authSecret: "wrong" })).rejects.toThrow(/unauthorized/);
  });
});
