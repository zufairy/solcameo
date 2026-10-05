import { describe, it, expect } from "vitest";
import { summarizeOracleRun } from "./util";

/**
 * Unit tests for the pure "Run oracle + crank now" result formatter. No React,
 * no network — just the string the admin sees after the two oracle routes run.
 * Covers: normal settled/deferred/claimed, the load-bearing dispute-window
 * zero-claim message, signer/reason passthrough, not-configured crank, and
 * error passthrough.
 */
describe("summarizeOracleRun", () => {
  it("renders settled / deferred / claimed on a normal tick", () => {
    const s = summarizeOracleRun({
      oracle: { due: 5, settled: 3, deferred: 2 },
      crank: { due: 3, claimed: 2, skipped: 1 },
    });
    expect(s).toBe("Oracle: settled 3 / deferred 2 · Crank: claimed 2 · 1 still in the ~1h dispute window");
  });

  it("renders a clean claimed count when nothing is skipped", () => {
    const s = summarizeOracleRun({
      oracle: { due: 2, settled: 2, deferred: 0 },
      crank: { due: 2, claimed: 2, skipped: 0 },
    });
    expect(s).toBe("Oracle: settled 2 / deferred 0 · Crank: claimed 2");
  });

  it("surfaces the ~1h dispute-window case (claimed 0, skipped>0) — NOT a silent no-op", () => {
    const s = summarizeOracleRun({
      oracle: { due: 4, settled: 4, deferred: 0 },
      crank: { due: 4, claimed: 0, skipped: 4 },
    });
    expect(s).toContain("Oracle: settled 4 / deferred 0");
    expect(s).toContain("Attested 4");
    expect(s).toContain("~1h on-chain dispute window");
    expect(s).toContain("run again after it clears");
  });

  it("passes through a whole-tick skip reason (e.g. crank signer low on SOL)", () => {
    const s = summarizeOracleRun({
      oracle: { settled: 1, deferred: 0 },
      crank: { due: 3, claimed: 0, skipped: 3, reason: "crank signer low on SOL" },
    });
    expect(s).toContain("crank signer low on SOL");
    expect(s).toContain("retry next tick");
    // reason takes precedence over the generic dispute-window copy
    expect(s).not.toContain("dispute window");
  });

  it("reports the not-configured crank (skipped is a string)", () => {
    const s = summarizeOracleRun({
      oracle: { settled: 0, deferred: 0 },
      crank: { skipped: "no crank key" },
    });
    expect(s).toBe("Oracle: settled 0 / deferred 0 · Crank not configured (no crank key)");
  });

  it("notes skippedV2 (approved rows awaiting an agent wallet) on the oracle side", () => {
    const s = summarizeOracleRun({
      oracle: { due: 6, settled: 3, deferred: 1, skippedV2: 2 },
      crank: { due: 3, claimed: 3, skipped: 0 },
    });
    expect(s).toContain("Oracle: settled 3 / deferred 1 · 2 awaiting wallet");
    expect(s).toContain("Crank: claimed 3");
  });

  it("says nothing due when the crank had no rows", () => {
    const s = summarizeOracleRun({
      oracle: { due: 0, settled: 0, deferred: 0 },
      crank: { due: 0, claimed: 0, skipped: 0 },
    });
    expect(s).toBe("Oracle: settled 0 / deferred 0 · Crank: nothing due to pay");
  });

  it("passes through an oracle error and a crank error", () => {
    expect(
      summarizeOracleRun({ oracle: { error: "Oracle run failed" }, crank: { claimed: 0, skipped: 0 } }),
    ).toContain("Oracle error: Oracle run failed");
    expect(
      summarizeOracleRun({ oracle: { settled: 1, deferred: 0 }, crank: { error: "treasury mismatch" } }),
    ).toContain("Crank error: treasury mismatch");
  });

  it("tolerates missing fields (all default to 0)", () => {
    const s = summarizeOracleRun({ oracle: {}, crank: {} });
    expect(s).toBe("Oracle: settled 0 / deferred 0 · Crank: nothing due to pay");
  });
});
