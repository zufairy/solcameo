import { describe, it, expect } from "vitest";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS, shouldCreditCheckoutSession } from "./stripeClient";

describe("shouldCreditCheckoutSession", () => {
  it("credits a PAID one-time pack session", () => {
    expect(shouldCreditCheckoutSession({
      mode: "payment", payment_status: "paid", metadata: { kind: "purchase", credits: "1000" },
    })).toBe(true);
  });

  // Regression: a subscription checkout fires checkout.session.completed AND
  // invoice.paid for the first period under different event ids, so the
  // stripeEventId dedupe can't catch it — crediting here double-granted month 1.
  it("does NOT credit a subscription session (invoice.paid owns every grant)", () => {
    expect(shouldCreditCheckoutSession({
      mode: "subscription", payment_status: "paid", metadata: { kind: "subscription", credits: "6000" },
    })).toBe(false);
  });

  it("does NOT credit a session flagged kind:subscription even if mode says otherwise", () => {
    expect(shouldCreditCheckoutSession({
      mode: "payment", payment_status: "paid", metadata: { kind: "subscription" },
    })).toBe(false);
  });

  it("does NOT credit an unpaid / async-pending / no_payment_required session", () => {
    for (const payment_status of ["unpaid", "no_payment_required", null, undefined]) {
      expect(shouldCreditCheckoutSession({ mode: "payment", payment_status, metadata: { kind: "purchase" } })).toBe(false);
    }
  });
});

describe("CREDIT_PACKS", () => {
  it("has exactly the 4 expected pack ids", () => {
    expect(Object.keys(CREDIT_PACKS).sort()).toEqual(["10", "100", "25", "50"]);
  });

  it("has positive usd and credits for every pack", () => {
    for (const pack of Object.values(CREDIT_PACKS)) {
      expect(pack.usd).toBeGreaterThan(0);
      expect(pack.credits).toBeGreaterThan(0);
    }
  });

  it("credits scale with usd (bigger packs are never a worse deal per dollar)", () => {
    const packs = Object.values(CREDIT_PACKS).sort((a, b) => a.usd - b.usd);
    for (let i = 1; i < packs.length; i++) {
      const prevRate = packs[i - 1].credits / packs[i - 1].usd;
      const rate = packs[i].credits / packs[i].usd;
      expect(rate).toBeGreaterThanOrEqual(prevRate);
    }
  });
});

describe("SUBSCRIPTION_TIERS", () => {
  it("has exactly the 3 paid tier ids", () => {
    expect(Object.keys(SUBSCRIPTION_TIERS).sort()).toEqual(["creator", "growth", "starter"]);
  });

  // Regression: the credit tiers used to reuse the marketing plan NAMES at
  // different PRICES (starter/$59, growth/$199, pro/$499) while /pricing showed
  // Starter free, Growth $59, Pro $199 — the same plan name quoted two prices.
  it("prices match the live /pricing plan of the same name", () => {
    expect(SUBSCRIPTION_TIERS.growth.usd).toBe(59);
    expect(SUBSCRIPTION_TIERS.creator.usd).toBe(29);
    expect(SUBSCRIPTION_TIERS.starter.usd).toBe(9);
  });

  it("has positive usd and creditsPerMonth for every tier", () => {
    for (const tier of Object.values(SUBSCRIPTION_TIERS)) {
      expect(tier.usd).toBeGreaterThan(0);
      expect(tier.creditsPerMonth).toBeGreaterThan(0);
    }
  });

  it("creditsPerMonth scale with usd (bigger tiers are never a worse deal per dollar)", () => {
    const tiers = Object.values(SUBSCRIPTION_TIERS).sort((a, b) => a.usd - b.usd);
    for (let i = 1; i < tiers.length; i++) {
      const prevRate = tiers[i - 1].creditsPerMonth / tiers[i - 1].usd;
      const rate = tiers[i].creditsPerMonth / tiers[i].usd;
      expect(rate).toBeGreaterThanOrEqual(prevRate);
    }
  });
});
