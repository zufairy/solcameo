import { describe, it, expect } from "vitest";
import { checkFunding, SOL_GAS_FLOOR } from "./usdcClient";

describe("checkFunding", () => {
  it("ok when usdc >= budget and sol >= gas floor", () => {
    const r = checkFunding({ usdc: 100, sol: 0.05, budget: 100 });
    expect(r).toMatchObject({ ok: true, needUsdc: false, needSol: false });
  });
  it("flags a usdc shortfall with the exact amount", () => {
    const r = checkFunding({ usdc: 40, sol: 0.05, budget: 100 });
    expect(r.ok).toBe(false);
    expect(r.needUsdc).toBe(true);
    expect(r.usdcShort).toBeCloseTo(60);
  });
  it("flags a sol shortfall", () => {
    const r = checkFunding({ usdc: 100, sol: 0, budget: 100 });
    expect(r.ok).toBe(false);
    expect(r.needSol).toBe(true);
    expect(r.solShort).toBeCloseTo(SOL_GAS_FLOOR);
  });
  it("treats null balances as zero", () => {
    const r = checkFunding({ usdc: null, sol: null, budget: 10 });
    expect(r).toMatchObject({ ok: false, needUsdc: true, needSol: true });
  });
});
