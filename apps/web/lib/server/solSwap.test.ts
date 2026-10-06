import { describe, expect, it } from "vitest";
import { GAS_FLOOR_LAMPORTS, GAS_GASLESS_MIN_USD, SOL_RESERVE_LAMPORTS, planGasTopUp, planTopUp } from "./solSwap";

const SOL = 1_000_000_000;
const base = { usdcPerSol: 150, maxSwapUsd: 50 };

describe("planTopUp (is the agent's SOL enough once swapped?)", () => {
  it("does nothing when USDC already covers the job", () => {
    expect(planTopUp({ ...base, requiredUsd: 1, usdcBalance: 1.5, solLamports: 0 })).toEqual({ enough: true });
  });
  it("swaps just the shortfall plus a small buffer when SOL can cover it", () => {
    const plan = planTopUp({ ...base, requiredUsd: 1.0, usdcBalance: 0.4, solLamports: 1 * SOL });
    expect(plan).toMatchObject({ enough: false, canSwap: true });
    if (plan.enough || !plan.canSwap) throw new Error("expected a swap");
    // short $0.60 (+1.2% buffer) at $150/SOL, with 0.5% slippage headroom
    expect(plan.usdcTarget).toBeCloseTo(0.6072, 4);
    expect(plan.lamports).toBeCloseTo(Math.ceil((0.6072 / 150) * 1e9 * 1.005), -2);
    expect(plan.lamports).toBeLessThan(0.01 * SOL);
  });
  it("never spends the SOL reserve that pays the swap's own network fee", () => {
    expect(planTopUp({ ...base, requiredUsd: 1, usdcBalance: 0, solLamports: SOL_RESERVE_LAMPORTS })).toMatchObject({ canSwap: false, reason: "no_sol" });
    const tight = planTopUp({ ...base, requiredUsd: 3, usdcBalance: 0, solLamports: SOL_RESERVE_LAMPORTS + 5_000_000 });
    expect(tight).toMatchObject({ canSwap: false, reason: "not_enough_sol" });
    if (!tight.enough && !tight.canSwap) expect(tight.solNeeded).toBeGreaterThan((SOL_RESERVE_LAMPORTS + 5_000_000) / SOL);
  });
  it("refuses without a live price and above the per-swap limit", () => {
    expect(planTopUp({ requiredUsd: 1, usdcBalance: 0, solLamports: SOL, usdcPerSol: null })).toMatchObject({ canSwap: false, reason: "no_price" });
    expect(planTopUp({ ...base, requiredUsd: 80, usdcBalance: 0, solLamports: 10 * SOL })).toMatchObject({ canSwap: false, reason: "over_limit" });
  });
});

describe("planGasTopUp (can the agent pay its own network fee?)", () => {
  const plan = (o: Partial<Parameters<typeof planGasTopUp>[0]>) => planGasTopUp({ solLamports: 0, usdcBalance: 20, keepUsdc: 2, solUsd: 150, hasKey: true, ...o });
  it("does nothing when the wallet already holds enough SOL", () => {
    expect(plan({ solLamports: GAS_FLOOR_LAMPORTS })).toEqual({ ok: true, swap: false });
  });
  it("swaps about a dollar of USDC when the wallet has some SOL to pay for the swap itself", () => {
    const p = plan({ solLamports: 2_000_000 });
    expect(p).toMatchObject({ ok: true, swap: true, gasless: false });
    if (p.ok && p.swap) expect(p.usd).toBeLessThan(2);
  });
  it("needs a gasless order of at least $10 when the wallet has no SOL at all", () => {
    const p = plan({ solLamports: 0 });
    expect(p).toMatchObject({ ok: true, swap: true, gasless: true });
    if (p.ok && p.swap) expect(p.usd).toBeGreaterThanOrEqual(GAS_GASLESS_MIN_USD);
    expect(plan({ solLamports: 0, hasKey: false })).toEqual({ ok: false, reason: "needs_key_for_gasless" });
  });
  it("never touches the USDC set aside for the job", () => {
    expect(plan({ solLamports: 0, usdcBalance: 12, keepUsdc: 2 })).toEqual({ ok: false, reason: "usdc_too_low" });
    expect(plan({ solLamports: 2_000_000, usdcBalance: 2.5, keepUsdc: 2 })).toEqual({ ok: false, reason: "usdc_too_low" });
    expect(plan({ solUsd: null })).toEqual({ ok: false, reason: "no_price" });
  });
});
