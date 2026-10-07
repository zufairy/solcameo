import { describe, expect, it } from "vitest";
import { isDefiniteRejection } from "./usdcTransfer";

describe("isDefiniteRejection", () => {
  it("treats a cluster refusal as proof the transaction was never sent", () => {
    expect(isDefiniteRejection(new Error("failed to send transaction: Transaction simulation failed: Blockhash not found"))).toBe(true);
    expect(isDefiniteRejection(new Error("Transaction simulation failed: Attempt to debit an account but found no record of a prior credit."))).toBe(true);
    expect(isDefiniteRejection(new Error("custom program error: 0x1"))).toBe(true);
  });
  it("treats timeouts and dropped connections as inconclusive (the transaction may be on the wire)", () => {
    expect(isDefiniteRejection(new Error("RPC timeout"))).toBe(false);
    expect(isDefiniteRejection(new Error("The operation was aborted due to timeout"))).toBe(false);
    expect(isDefiniteRejection(new Error("fetch failed"))).toBe(false);
    expect(isDefiniteRejection(new Error("429 Too Many Requests"))).toBe(false);
  });
});
