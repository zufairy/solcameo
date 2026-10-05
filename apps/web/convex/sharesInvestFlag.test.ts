/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// The buyShares mutation is gated by NEXT_PUBLIC_INVEST_ENABLED (default OFF) — a
// defense-in-depth block so no shares are minted while Invest is turned off, even
// for a caller holding the internal secret. The /api/market/buy-shares +
// /api/market/test-invest routes carry the same gate at the edge.
const SECRET = "test-cron-secret-invest-flag";
const MINT = "MintFlag1111111111111111111111111111111111";
const INV = "InvFlagAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("shares.buyShares invest-flag gate", () => {
  const prevInvest = process.env.NEXT_PUBLIC_INVEST_ENABLED;
  const prevSecret = process.env.INTERNAL_CRON_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_CRON_SECRET = SECRET;
  });
  afterEach(() => {
    if (prevInvest === undefined) delete process.env.NEXT_PUBLIC_INVEST_ENABLED;
    else process.env.NEXT_PUBLIC_INVEST_ENABLED = prevInvest;
    if (prevSecret === undefined) delete process.env.INTERNAL_CRON_SECRET;
    else process.env.INTERNAL_CRON_SECRET = prevSecret;
  });

  it("refuses the buy when invest is disabled — no shares minted, escrow untouched", async () => {
    process.env.NEXT_PUBLIC_INVEST_ENABLED = "false";
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });

    await expect(
      t.mutation(api.shares.buyShares, {
        mintAddress: MINT, investorWallet: INV, depositUsdc: 100, txSignature: "flag-off-sig", authSecret: SECRET,
      }),
    ).rejects.toThrow(/not available/i);

    // The gate fires BEFORE consumeSignature / minting: nothing moved.
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.sharesOutstanding).toBe(0);
    expect(acct!.escrowUsdc).toBe(0);
    expect(await t.query(api.shares.walletShares, { mintAddress: MINT, wallet: INV })).toBe(0);
  });

  it("treats an unset flag as disabled (safe default)", async () => {
    delete process.env.NEXT_PUBLIC_INVEST_ENABLED;
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });

    await expect(
      t.mutation(api.shares.buyShares, {
        mintAddress: MINT, investorWallet: INV, depositUsdc: 100, txSignature: "flag-unset-sig", authSecret: SECRET,
      }),
    ).rejects.toThrow(/not available/i);
    expect(await t.query(api.shares.walletShares, { mintAddress: MINT, wallet: INV })).toBe(0);
  });

  it("allows the buy when invest is enabled", async () => {
    process.env.NEXT_PUBLIC_INVEST_ENABLED = "true";
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });

    const res = await t.mutation(api.shares.buyShares, {
      mintAddress: MINT, investorWallet: INV, depositUsdc: 100, txSignature: "flag-on-sig", authSecret: SECRET,
    });
    expect(res.shares).toBe(100);
    expect(await t.query(api.shares.walletShares, { mintAddress: MINT, wallet: INV })).toBe(100);
  });

  it("auth precedes the flag: a wrong secret is still rejected as unauthorized when enabled", async () => {
    process.env.NEXT_PUBLIC_INVEST_ENABLED = "true";
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });

    await expect(
      t.mutation(api.shares.buyShares, {
        mintAddress: MINT, investorWallet: INV, depositUsdc: 100, txSignature: "bad-secret-sig", authSecret: "wrong",
      }),
    ).rejects.toThrow(/unauthorized/i);
  });
});
