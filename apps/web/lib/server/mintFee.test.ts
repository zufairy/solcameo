/**
 * H03 (Part 1): the signature used to COMPLETE a mint is pinned to the
 * reservation's OWN verified signature on a "paid" resume — never the current
 * request's raw, client-supplied txSignature. This stops a "paid"-session resume
 * from substituting an arbitrary never-verified string into completeMint's
 * consumeSignature and minting for free.
 */
import { describe, it, expect } from "vitest";
import { mintProofSignatureFor } from "./mintFee";

describe("mintProofSignatureFor — pin the mint-completion signature (H03)", () => {
  it("paid RESUME uses the reservation's verified signature, NOT the request's", () => {
    const proof = mintProofSignatureFor(
      { feeUsdc: 50, status: "paid", txSignature: "SIG_VERIFIED" },
      "SIG_ATTACKER_SUBSTITUTED",
    );
    expect(proof).toBe("SIG_VERIFIED");
  });

  it("first paid pass (just verified this request, row still 'reserved') uses the request signature", () => {
    const proof = mintProofSignatureFor(
      { feeUsdc: 50, status: "reserved", txSignature: undefined },
      "SIG_JUST_VERIFIED",
    );
    expect(proof).toBe("SIG_JUST_VERIFIED");
  });

  it("FREE path (no fee) uses the request signature (the free_promo_ placeholder) unchanged", () => {
    const proof = mintProofSignatureFor(
      { feeUsdc: 0, status: "reserved", txSignature: undefined },
      "free_promo_abc",
    );
    expect(proof).toBe("free_promo_abc");
  });

  it("fails closed if a 'paid' row is missing its stored signature (never falls back to the request value)", () => {
    // markMintPaid always stores txSignature on a paid row, so this branch is
    // unreachable in production. If it ever occurred, returning "" makes
    // completeMint's consumeSignature throw "Missing txSignature" (no mint) rather
    // than silently consuming a substituted, never-verified request value.
    const proof = mintProofSignatureFor({ feeUsdc: 50, status: "paid", txSignature: undefined }, "SIG_X");
    expect(proof).toBe("");
  });
});
