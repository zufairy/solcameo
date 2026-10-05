/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WALLET = "Wallet1111111111111111111111111111111111";

describe("userCredits.ensure + getBalance", () => {
  it("creates a zero-balance row on first ensure, is idempotent", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.userCredits.ensure, { ownerWallet: WALLET });
    await t.mutation(internal.userCredits.ensure, { ownerWallet: WALLET });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("userCredits").withIndex("by_owner", (q) => q.eq("ownerWallet", WALLET)).collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].balanceCredits).toBe(0);

    const bal = await t.query(api.userCredits.getBalance, { ownerWallet: WALLET });
    expect(bal!.balanceCredits).toBe(0);
  });

  it("getBalance returns null for a wallet with no row", async () => {
    const t = convexTest(schema, modules);
    const bal = await t.query(api.userCredits.getBalance, { ownerWallet: "NeverSeen" });
    expect(bal).toBeNull();
  });
});

describe("userCredits.credit", () => {
  it("adds credits and records a ledger row, deduped by stripeEventId", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.userCredits.credit, {
      ownerWallet: WALLET, deltaCredits: 1000, kind: "purchase", stripeEventId: "evt_1",
    });
    // Replay of the same Stripe event must not double-credit.
    await t.mutation(internal.userCredits.credit, {
      ownerWallet: WALLET, deltaCredits: 1000, kind: "purchase", stripeEventId: "evt_1",
    });
    const bal = await t.query(api.userCredits.getBalance, { ownerWallet: WALLET });
    expect(bal!.balanceCredits).toBe(1000);
    expect(bal!.totalPurchasedCredits).toBe(1000);

    const ledger = await t.query(api.userCredits.listLedger, { ownerWallet: WALLET });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe("purchase");
  });
});

describe("userCredits.creditFromWebhook", () => {
  const OLD_ENV = process.env.INTERNAL_CRON_SECRET;

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.INTERNAL_CRON_SECRET;
    else process.env.INTERNAL_CRON_SECRET = OLD_ENV;
  });

  it("rejects a missing INTERNAL_CRON_SECRET env var", async () => {
    delete process.env.INTERNAL_CRON_SECRET;
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.userCredits.creditFromWebhook, {
        ownerWallet: WALLET, deltaCredits: 100, kind: "purchase", stripeEventId: "evt_bad", authSecret: "whatever",
      }),
    ).rejects.toThrow("unauthorized");
  });

  it("rejects a wrong authSecret", async () => {
    process.env.INTERNAL_CRON_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.userCredits.creditFromWebhook, {
        ownerWallet: WALLET, deltaCredits: 100, kind: "purchase", stripeEventId: "evt_bad2", authSecret: "wrong-secret",
      }),
    ).rejects.toThrow("unauthorized");
    const bal = await t.query(api.userCredits.getBalance, { ownerWallet: WALLET });
    expect(bal).toBeNull();
  });

  it("credits the balance with a correct authSecret, idempotent on stripeEventId", async () => {
    process.env.INTERNAL_CRON_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    await t.mutation(api.userCredits.creditFromWebhook, {
      ownerWallet: WALLET, deltaCredits: 1000, kind: "purchase", stripeEventId: "evt_webhook_1", authSecret: "correct-secret",
    });
    // Simulate a Stripe webhook retry of the same event.
    await t.mutation(api.userCredits.creditFromWebhook, {
      ownerWallet: WALLET, deltaCredits: 1000, kind: "purchase", stripeEventId: "evt_webhook_1", authSecret: "correct-secret",
    });
    const bal = await t.query(api.userCredits.getBalance, { ownerWallet: WALLET });
    expect(bal!.balanceCredits).toBe(1000);
    const ledger = await t.query(api.userCredits.listLedger, { ownerWallet: WALLET });
    expect(ledger).toHaveLength(1);
  });
});

describe("userCredits.debit", () => {
  it("denies (ok:false) when balance is insufficient, does not go negative", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.userCredits.credit, {
      ownerWallet: WALLET, deltaCredits: 50, kind: "purchase",
    });
    const res = await t.mutation(internal.userCredits.debit, {
      ownerWallet: WALLET, deltaCredits: 100,
    });
    expect(res.ok).toBe(false);
    const bal = await t.query(api.userCredits.getBalance, { ownerWallet: WALLET });
    expect(bal!.balanceCredits).toBe(50);
  });

  it("deducts on sufficient balance and records a spend ledger row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.userCredits.credit, {
      ownerWallet: WALLET, deltaCredits: 100, kind: "purchase",
    });
    const res = await t.mutation(internal.userCredits.debit, {
      ownerWallet: WALLET, deltaCredits: 40, relatedMintAddress: "Mint111",
    });
    expect(res.ok).toBe(true);
    expect(res.balanceCredits).toBe(60);
    const ledger = await t.query(api.userCredits.listLedger, { ownerWallet: WALLET });
    expect(ledger.find((r) => r.kind === "spend")!.deltaCredits).toBe(-40);
  });
});
