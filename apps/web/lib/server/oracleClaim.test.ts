import { describe, it, expect } from "vitest";
import { computeClaimSettlement, settleClaimTranche } from "./oracleClaim";

/**
 * Unit tests for the pure claim-settlement money math. No Solana, no Convex —
 * just the integer/base-unit arithmetic the claim route runs after a confirmed
 * `claim_payout`. Covers: one-shot full pay, multi-tranche delta crediting,
 * budget-clamped → terminal, fee-unknown fail-closed, and the on-chain floor.
 */
describe("computeClaimSettlement", () => {
  it("one-shot full pay (feeBps 0): credits the whole amount, terminal", () => {
    const r = computeClaimSettlement({
      paidUsdcBefore: 0,
      newPaidUsdc: 200,
      payoutAmountUsdc: 200,
      navCreditedUsdc: 0,
      feeBps: 0,
      feeKnown: true,
    });
    expect(r.grossThisTick).toBe(200);
    expect(r.netDeltaToCredit).toBe(200);
    expect(r.newNavCreditedUsdc).toBe(200);
    expect(r.claimDone).toBe(true); // newPaid >= payout
  });

  it("one-shot full pay with a fee: credits net = gross − floor(fee)", () => {
    // feeBps 250 = 2.5%. gross $200 → fee $5 → net $195.
    const r = computeClaimSettlement({
      paidUsdcBefore: 0,
      newPaidUsdc: 200,
      payoutAmountUsdc: 200,
      navCreditedUsdc: 0,
      feeBps: 250,
      feeKnown: true,
    });
    expect(r.grossThisTick).toBe(200);
    expect(r.netDeltaToCredit).toBe(195);
    expect(r.newNavCreditedUsdc).toBe(195);
    expect(r.claimDone).toBe(true);
  });

  it("multi-tranche: two ticks each credit ONLY their delta, never double-credit", () => {
    // Budget-capped partial then top-up completion. feeBps 250 (2.5%).
    // Tick 1: paid 0 → 120. cumulative net = floor(120e6 * 9750/10000) = 117.
    const t1 = computeClaimSettlement({
      paidUsdcBefore: 0,
      newPaidUsdc: 120,
      payoutAmountUsdc: 200,
      navCreditedUsdc: 0,
      feeBps: 250,
      feeKnown: true,
    });
    expect(t1.grossThisTick).toBe(120);
    expect(t1.netDeltaToCredit).toBe(117); // 120 * 0.975
    expect(t1.newNavCreditedUsdc).toBe(117);
    expect(t1.claimDone).toBe(false); // 120 < 200 and gross > 0

    // Tick 2: paid 120 → 200 (rest paid after top-up). cumulative net =
    // floor(200e6 * 9750/10000) = 195. Already credited 117 → delta 78.
    const t2 = computeClaimSettlement({
      paidUsdcBefore: 120,
      newPaidUsdc: 200,
      payoutAmountUsdc: 200,
      navCreditedUsdc: t1.newNavCreditedUsdc, // 117 carried forward
      feeBps: 250,
      feeKnown: true,
    });
    expect(t2.grossThisTick).toBe(80);
    expect(t2.netDeltaToCredit).toBe(78); // 195 cumulative − 117 already
    expect(t2.newNavCreditedUsdc).toBe(195);
    expect(t2.claimDone).toBe(true);

    // Total credited across both ticks == cumulative net, no double-count.
    expect(t1.netDeltaToCredit + t2.netDeltaToCredit).toBe(195);
  });

  it("idempotent re-crank of a fully-paid row credits nothing and stays terminal", () => {
    // Same cumulative paid as already credited → delta 0.
    const r = computeClaimSettlement({
      paidUsdcBefore: 200,
      newPaidUsdc: 200,
      payoutAmountUsdc: 200,
      navCreditedUsdc: 195, // net of 2.5% fee
      feeBps: 250,
      feeKnown: true,
    });
    expect(r.grossThisTick).toBe(0);
    expect(r.netDeltaToCredit).toBe(0);
    expect(r.newNavCreditedUsdc).toBe(195);
    expect(r.claimDone).toBe(true); // gross 0 ⇒ terminal
  });

  it("budget-clamped partial then a 0-progress crank ⇒ claimDone (budget exhausted)", () => {
    // Off-chain estimate $200, but the on-chain budget only ever pays $80.
    // Tick 1: 0 → 80 (partial; off-chain still thinks 200 owed).
    const t1 = computeClaimSettlement({
      paidUsdcBefore: 0,
      newPaidUsdc: 80,
      payoutAmountUsdc: 200,
      navCreditedUsdc: 0,
      feeBps: 0,
      feeKnown: true,
    });
    expect(t1.grossThisTick).toBe(80);
    expect(t1.netDeltaToCredit).toBe(80);
    expect(t1.claimDone).toBe(false); // 80 < 200, gross > 0 → still due

    // Tick 2: budget exhausted on-chain → a successful crank pays 0. paid
    // unchanged at 80. gross 0 ⇒ terminal even though 80 < 200 estimate.
    const t2 = computeClaimSettlement({
      paidUsdcBefore: 80,
      newPaidUsdc: 80,
      payoutAmountUsdc: 200,
      navCreditedUsdc: t1.newNavCreditedUsdc,
      feeBps: 0,
      feeKnown: true,
    });
    expect(t2.grossThisTick).toBe(0);
    expect(t2.netDeltaToCredit).toBe(0);
    expect(t2.newNavCreditedUsdc).toBe(80);
    expect(t2.claimDone).toBe(true); // gross 0 ⇒ budget-exhausted ⇒ terminal
  });

  it("feeUnknown ⇒ credits nothing this tick and is NOT terminal (back-fills later)", () => {
    // The config read failed → fail-closed. Gross was real, but we credit 0 and
    // do not advance navCredited. claimDone is gated only on the paid/estimate
    // facts (gross 0 OR fully settled) — both false here → stays due, so a later
    // feeKnown tick recomputes the delta against the lagging navCredited.
    const r = computeClaimSettlement({
      paidUsdcBefore: 0,
      newPaidUsdc: 120,
      payoutAmountUsdc: 200,
      navCreditedUsdc: 0,
      feeBps: 0, // ignored when feeKnown=false (do not default-credit)
      feeKnown: false,
    });
    expect(r.grossThisTick).toBe(120);
    expect(r.netDeltaToCredit).toBe(0); // fail-closed: credit nothing
    expect(r.newNavCreditedUsdc).toBe(0); // does not advance
    expect(r.claimDone).toBe(false); // 120 < 200 → still due, back-fills later
  });

  it("feeUnknown is back-filled on a later feeKnown tick against the lagging navCredited", () => {
    // Tick 1 (fee unknown): paid 0 → 120, credited nothing, navCredited stays 0.
    const t1 = computeClaimSettlement({
      paidUsdcBefore: 0,
      newPaidUsdc: 120,
      payoutAmountUsdc: 200,
      navCreditedUsdc: 0,
      feeBps: 0,
      feeKnown: false,
    });
    expect(t1.netDeltaToCredit).toBe(0);
    expect(t1.newNavCreditedUsdc).toBe(0);

    // Tick 2 (fee now known): a re-crank pays nothing more (paid stays 120) but
    // the cumulative net is now credited in full against the lagging navCredited.
    // cumulative net = floor(120e6 * 9750/10000) = 117.
    const t2 = computeClaimSettlement({
      paidUsdcBefore: 120,
      newPaidUsdc: 120,
      payoutAmountUsdc: 200,
      navCreditedUsdc: t1.newNavCreditedUsdc, // still 0
      feeBps: 250,
      feeKnown: true,
    });
    // gross 0 this tick, BUT the back-fill credits the cumulative net.
    expect(t2.grossThisTick).toBe(0);
    expect(t2.netDeltaToCredit).toBe(117);
    expect(t2.newNavCreditedUsdc).toBe(117);
    expect(t2.claimDone).toBe(true); // gross 0 ⇒ terminal
  });

  it("fee math FLOORS net (chain truncates, never rounds up — spec formula)", () => {
    // gross 100.000001 USDC = 100_000_001 base units, feeBps 333 (3.33%).
    // Per spec, net = floor(newPaid_base * (10000 − feeBps) / 10000):
    //   floor(100_000_001 * 9667 / 10000) = floor(96_670_000.9667) = 96_670_000
    //   → 96.670000 USDC. The fractional 0.9667 base unit is TRUNCATED, so the
    //   off-chain credit can never promise more than the chain actually nets.
    const r = computeClaimSettlement({
      paidUsdcBefore: 0,
      newPaidUsdc: 100.000001,
      payoutAmountUsdc: 100.000001,
      navCreditedUsdc: 0,
      feeBps: 333,
      feeKnown: true,
    });
    expect(r.grossThisTick).toBeCloseTo(100.000001, 9);
    expect(r.netDeltaToCredit).toBeCloseTo(96.67, 9);
    expect(r.newNavCreditedUsdc).toBeCloseTo(96.67, 9);
    expect(r.claimDone).toBe(true);
  });

  it("never returns a negative gross when paid mirror is ahead of on-chain", () => {
    // Defensive: if paidUsdcBefore somehow exceeds newPaidUsdc, gross clamps to 0.
    const r = computeClaimSettlement({
      paidUsdcBefore: 200,
      newPaidUsdc: 150,
      payoutAmountUsdc: 200,
      navCreditedUsdc: 200,
      feeBps: 0,
      feeKnown: true,
    });
    expect(r.grossThisTick).toBe(0);
    expect(r.netDeltaToCredit).toBe(0); // cumulative net 150 < already-credited 200
    expect(r.newNavCreditedUsdc).toBe(200);
    expect(r.claimDone).toBe(true); // gross 0 ⇒ terminal
  });
});

/**
 * XCUT-1: reserve-before-credit ordering. The load-bearing invariant is that the
 * navCreditedUsdc watermark is COMMITTED before the irreversible NAV credit is
 * issued — so a mirror-write failure can never leave a landed credit with a stale
 * watermark that a later paid-growth tick re-credits (double-pay).
 */
describe("settleClaimTranche (reserve-before-credit)", () => {
  it("no-op when there is nothing to credit (netDelta <= 0)", async () => {
    let reserved = false;
    let credited = false;
    const r = await settleClaimTranche({
      netDeltaToCredit: 0,
      reserve: async () => { reserved = true; },
      credit: async () => { credited = true; return true; },
    });
    expect(r).toEqual({ reserved: false, credited: false, stranded: false });
    expect(reserved).toBe(false);
    expect(credited).toBe(false); // credit never attempted with no delta
  });

  it("NEVER issues the credit when the reserve (mirror write) fails", async () => {
    const creditCalls: number[] = [];
    await expect(
      settleClaimTranche({
        netDeltaToCredit: 117,
        reserve: async () => { throw new Error("convex unreachable"); },
        credit: async () => { creditCalls.push(1); return true; },
      }),
    ).rejects.toThrow(/unreachable/);
    // The credit must not have run — the caller's row catch will skip + retry.
    expect(creditCalls).toEqual([]);
  });

  it("reports a strand (under-credit, fail-closed) when reserve commits but credit fails", async () => {
    const r = await settleClaimTranche({
      netDeltaToCredit: 100,
      reserve: async () => {},
      credit: async () => false,
    });
    expect(r).toEqual({ reserved: true, credited: false, stranded: true });
  });

  it("orders reserve strictly BEFORE credit", async () => {
    const order: string[] = [];
    const r = await settleClaimTranche({
      netDeltaToCredit: 50,
      reserve: async () => { order.push("reserve"); },
      credit: async () => { order.push("credit"); return true; },
    });
    expect(order).toEqual(["reserve", "credit"]);
    expect(r).toEqual({ reserved: true, credited: true, stranded: false });
  });

  it("two-tick sim: a mirror-write failure on tick 1 + paid-growth on tick 2 credits ONCE (no double)", async () => {
    // Model the keeper's two writes: a fake idempotent NAV ledger keyed by
    // trancheKey (distribute-earnings dedups on it), and the submission mirror.
    const ledger = new Map<string, number>(); // trancheKey -> credited USDC
    const mirror = { paidUsdc: 0, navCreditedUsdc: 0 };
    const feeBps = 250; // 2.5%

    async function tick(newPaidUsdc: number, reserveFails: boolean) {
      const s = computeClaimSettlement({
        paidUsdcBefore: mirror.paidUsdc,
        newPaidUsdc,
        payoutAmountUsdc: 200,
        navCreditedUsdc: mirror.navCreditedUsdc,
        feeBps,
        feeKnown: true,
      });
      const trancheKey = `sub:${s.newNavCreditedUsdc}`;
      return settleClaimTranche({
        netDeltaToCredit: s.netDeltaToCredit,
        reserve: async () => {
          if (reserveFails) throw new Error("mirror write failed"); // markPaidOnchain threw
          mirror.paidUsdc = newPaidUsdc;
          mirror.navCreditedUsdc = s.newNavCreditedUsdc;
        },
        credit: async () => {
          if (!ledger.has(trancheKey)) ledger.set(trancheKey, s.netDeltaToCredit);
          return true;
        },
      });
    }
    const totalCredited = () => [...ledger.values()].reduce((a, b) => a + b, 0);

    // Tick 1: on-chain paid 0 → 120, but the reserve (mirror write) FAILS → throws
    // BEFORE any credit is issued. Nothing credited, watermark unchanged.
    await expect(tick(120, true)).rejects.toThrow(/mirror write failed/);
    expect(totalCredited()).toBe(0);
    expect(mirror.navCreditedUsdc).toBe(0);

    // Tick 2: paid grew to 200; reserve now succeeds → credits the full cumulative
    // net ONCE (195), NOT 312. The tick-1 delta was never credited because the
    // reserve fails-closed before the credit.
    const r2 = await tick(200, false);
    expect(r2).toEqual({ reserved: true, credited: true, stranded: false });
    expect(totalCredited()).toBe(195); // floor(200 * 0.975) — no double-credit
    expect(mirror.navCreditedUsdc).toBe(195);
  });

  it("two-tick sim (happy path): tick1 partial then tick2 completion credit only their deltas", async () => {
    const ledger = new Map<string, number>();
    const mirror = { paidUsdc: 0, navCreditedUsdc: 0 };
    async function tick(newPaidUsdc: number) {
      const s = computeClaimSettlement({
        paidUsdcBefore: mirror.paidUsdc,
        newPaidUsdc,
        payoutAmountUsdc: 200,
        navCreditedUsdc: mirror.navCreditedUsdc,
        feeBps: 250,
        feeKnown: true,
      });
      const trancheKey = `sub:${s.newNavCreditedUsdc}`;
      return settleClaimTranche({
        netDeltaToCredit: s.netDeltaToCredit,
        reserve: async () => { mirror.paidUsdc = newPaidUsdc; mirror.navCreditedUsdc = s.newNavCreditedUsdc; },
        credit: async () => { if (!ledger.has(trancheKey)) ledger.set(trancheKey, s.netDeltaToCredit); return true; },
      });
    }
    await tick(120); // credits 117
    await tick(200); // credits 78
    expect([...ledger.values()].reduce((a, b) => a + b, 0)).toBe(195);
    expect(mirror.navCreditedUsdc).toBe(195);
  });
});
