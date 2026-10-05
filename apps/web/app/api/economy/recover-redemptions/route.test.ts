// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decideUnknownRedemption } from "@/lib/economy/recoveryDecisions";

/**
 * H4: the redemption keeper's decision for a confirm-ambiguous payout whose broadcast
 * signature getSignatureStatus reports UNKNOWN. The ONLY safe re-transfer is when the
 * tx's blockhash is provably expired (cluster tip > lastValidBlockHeight) — everything
 * else MUST defer, never re-transfer on uncertainty (else a double payout).
 */
describe("decideUnknownRedemption (blockhash-expiry rule)", () => {
  it("re-transfers when the blockhash is PROVABLY expired (tip > lvbh)", () => {
    expect(decideUnknownRedemption({ lastValidBlockHeight: 100, currentHeight: 101 })).toBe("retransfer");
    expect(decideUnknownRedemption({ lastValidBlockHeight: 100, currentHeight: 5_000 })).toBe("retransfer");
  });

  it("DEFERS while still in-window (tip <= lvbh) — the sig could still land", () => {
    expect(decideUnknownRedemption({ lastValidBlockHeight: 100, currentHeight: 100 })).toBe("defer"); // boundary
    expect(decideUnknownRedemption({ lastValidBlockHeight: 100, currentHeight: 99 })).toBe("defer");
    expect(decideUnknownRedemption({ lastValidBlockHeight: 100, currentHeight: 1 })).toBe("defer");
  });

  it("DEFERS when lvbh is unknown (null/undefined) — can't prove expiry", () => {
    expect(decideUnknownRedemption({ lastValidBlockHeight: undefined, currentHeight: 9_999_999 })).toBe("defer");
    expect(decideUnknownRedemption({ lastValidBlockHeight: null, currentHeight: 9_999_999 })).toBe("defer");
  });

  it("DEFERS when the live tip couldn't be read (getBlockHeight errored → null)", () => {
    expect(decideUnknownRedemption({ lastValidBlockHeight: 100, currentHeight: null })).toBe("defer");
  });

  it("DEFERS when BOTH lvbh and tip are unavailable", () => {
    expect(decideUnknownRedemption({ lastValidBlockHeight: null, currentHeight: null })).toBe("defer");
  });
});
