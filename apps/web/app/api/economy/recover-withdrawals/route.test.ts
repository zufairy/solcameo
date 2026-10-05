// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decideUnknownWithdrawal } from "@/lib/economy/recoveryDecisions";

/**
 * The withdrawal keeper's decision for a confirm-ambiguous withdrawal whose
 * broadcast signature getSignatureStatus reports UNKNOWN. Same blockhash-expiry
 * rule as the settlement keeper: the ONLY safe re-transfer is when the tx's
 * blockhash is PROVABLY expired (cluster tip > lastValidBlockHeight). Anything
 * uncertain MUST defer — re-transferring on uncertainty would double-send USDC.
 */
describe("decideUnknownWithdrawal (blockhash-expiry rule)", () => {
  it("re-transfers when the blockhash is PROVABLY expired (tip > lvbh)", () => {
    expect(decideUnknownWithdrawal({ lastValidBlockHeight: 100, currentHeight: 101 })).toBe("retransfer");
    expect(decideUnknownWithdrawal({ lastValidBlockHeight: 100, currentHeight: 5_000 })).toBe("retransfer");
  });

  it("DEFERS while still in-window (tip <= lvbh) — the sig could still land", () => {
    expect(decideUnknownWithdrawal({ lastValidBlockHeight: 100, currentHeight: 100 })).toBe("defer");
    expect(decideUnknownWithdrawal({ lastValidBlockHeight: 100, currentHeight: 99 })).toBe("defer");
  });

  it("DEFERS when lvbh is unknown (null/undefined) — can't prove expiry", () => {
    expect(decideUnknownWithdrawal({ lastValidBlockHeight: null, currentHeight: 9_999_999 })).toBe("defer");
    expect(decideUnknownWithdrawal({ lastValidBlockHeight: undefined, currentHeight: 9_999_999 })).toBe("defer");
  });

  it("DEFERS when the live tip couldn't be read (currentHeight null)", () => {
    expect(decideUnknownWithdrawal({ lastValidBlockHeight: 100, currentHeight: null })).toBe("defer");
  });

  it("DEFERS when BOTH lvbh and tip are unavailable", () => {
    expect(decideUnknownWithdrawal({ lastValidBlockHeight: null, currentHeight: null })).toBe("defer");
  });
});
