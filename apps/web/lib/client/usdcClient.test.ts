import { describe, it, expect } from "vitest";
import { priorTransferLanded } from "./usdcClient";

/**
 * sendUsdc double-pay guard: a confirmation timeout throws even when the transfer
 * DID land, so a blind retry sends a SECOND real USDC transfer. On retry we look
 * the prior signature up on the ledger (getSignatureStatuses, searchTransactionHistory)
 * and only re-send when it is provably NOT there. priorTransferLanded encodes that
 * decision: a status found without an err = it landed → do NOT re-send.
 */
describe("priorTransferLanded", () => {
  it("true when the prior signature is on the ledger with no error (it landed)", () => {
    expect(priorTransferLanded({ err: null })).toBe(true);
    expect(priorTransferLanded({ err: null, confirmationStatus: "confirmed" })).toBe(true);
    expect(priorTransferLanded({ err: null, confirmationStatus: "processed" })).toBe(true);
  });

  it("false when the signature is not on the ledger (dropped/never landed → safe to resend)", () => {
    expect(priorTransferLanded(null)).toBe(false);
    expect(priorTransferLanded(undefined)).toBe(false);
  });

  it("false when the prior tx is on the ledger but ERRORED (it failed → safe to resend)", () => {
    expect(priorTransferLanded({ err: { InstructionError: [0, "Custom"] } })).toBe(false);
  });
});
