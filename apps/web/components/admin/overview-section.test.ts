import { describe, it, expect } from "vitest";
import { TokenAccountNotFoundError } from "@solana/spl-token";
import { classifyUsdcReadError, nextTreasuryBalance } from "./overview-section";

/**
 * H13/BUG-036: the admin "Vello Treasury" KPI collapsed ANY USDC read failure
 * (RPC 429/timeout on the same Helius/public RPC this app documents as
 * rate-limit-prone) into a confident $0.00 — visually identical to the
 * treasury genuinely being empty. These two pure functions are the fix's
 * decision core (mirrors getUsdcBalanceStrict in lib/trader/usdcTransfer.ts
 * and useWalletUsdc in lib/client/usdcClient.ts): classify which errors mean a
 * REAL zero vs UNKNOWN, and never let an unknown read overwrite a
 * previously-known-good balance with a false 0.
 */
describe("classifyUsdcReadError", () => {
  it("a genuinely missing/never-created token account is a real 0", () => {
    expect(classifyUsdcReadError(new TokenAccountNotFoundError())).toBe(0);
  });

  it("any other error (RPC 429/timeout/socket drop) is UNKNOWN — never a false 0", () => {
    expect(classifyUsdcReadError(new Error("429 Too Many Requests"))).toBeUndefined();
    expect(classifyUsdcReadError(new Error("fetch failed"))).toBeUndefined();
    expect(classifyUsdcReadError(new Error("timeout"))).toBeUndefined();
    expect(classifyUsdcReadError("non-Error throw")).toBeUndefined();
    expect(classifyUsdcReadError(undefined)).toBeUndefined();
  });
});

describe("nextTreasuryBalance", () => {
  it("an unknown USDC read (undefined) keeps the last known usdc value, not 0", () => {
    expect(nextTreasuryBalance({ usdc: 1234.56, sol: 3 }, undefined, 2_000_000_000)).toEqual({ usdc: 1234.56, sol: 2 });
  });

  it("an unknown USDC read with no prior value yields null (unavailable), not 0", () => {
    expect(nextTreasuryBalance(null, undefined, 1_000_000_000)).toEqual({ usdc: null, sol: 1 });
  });

  it("a real read — including a genuine empty-account 0 — replaces the previous value", () => {
    expect(nextTreasuryBalance({ usdc: 1234.56, sol: 3 }, 0, 1_000_000_000)).toEqual({ usdc: 0, sol: 1 });
    expect(nextTreasuryBalance({ usdc: 0, sol: 1 }, 500, 1_000_000_000)).toEqual({ usdc: 500, sol: 1 });
  });
});
