import { describe, it, expect } from "vitest";
import { shouldBlockForSol } from "./fundWallet";

// Regression guard for the devnet-RPC-read gotcha: a FAILED SOL balance read
// (null) must NEVER be treated as 0 SOL and false-block a funding deposit.
describe("shouldBlockForSol", () => {
  const floor = 0.0025; // USDC fee headroom

  it("blocks on a real zero balance", () => {
    expect(shouldBlockForSol(0, floor)).toBe(true);
  });

  it("blocks when the read succeeded but is below the fee floor", () => {
    expect(shouldBlockForSol(0.001, floor)).toBe(true);
  });

  it("does NOT block when the read failed (null) — RPC flake must not read as 0", () => {
    expect(shouldBlockForSol(null, floor)).toBe(false);
  });

  it("does not block when the balance is above the floor", () => {
    expect(shouldBlockForSol(0.5, floor)).toBe(false);
    expect(shouldBlockForSol(floor, floor)).toBe(false); // exactly at floor is fine
  });
});
