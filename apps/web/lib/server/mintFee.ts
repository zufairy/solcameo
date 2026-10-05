/**
 * Route-side inputs for the agent-mint fee. The ACTUAL free-vs-$10 decision is
 * made atomically inside Convex (convex/mintFee.ts reserveMintFee/quoteMintFee),
 * where the count and the reservation happen in one transaction so concurrent
 * first-mints can't all read zero. This module only supplies the policy knobs
 * the route passes in: the standard list price and the kill switch.
 */

/** List price of a non-free agent mint, in USDC. Mirror of the same constant
 *  in convex/mintFee.ts — keep the two in sync. */
export const MINT_FEE_USDC = 10;

/** MINT_FEE_DISABLED=1 restores the everything-free launch promo (charges nobody). */
export function isMintFeeDisabled(): boolean {
  return process.env.MINT_FEE_DISABLED === "1";
}

/**
 * Pin the signature that COMPLETES a mint to the one actually verified for the
 * reservation — never the current request's raw, client-supplied txSignature.
 *
 * The paid path verifies `body.txSignature` on-chain and records it on the fee
 * row (mintFee.markMintPaid → row.txSignature). But once a session is "paid" the
 * route skips re-verification on every later call for that session. Without this,
 * a "paid"-session resume would forward THIS request's client-controlled
 * txSignature straight into nftAgents.completeMint's consumeSignature — letting an
 * authenticated caller substitute an arbitrary never-verified string and mint an
 * agent for free (H03). So for a "paid" reservation we complete against the row's
 * OWN verified signature; the first-paid pass (row still "reserved" here, just
 * verified this request) and the free_promo_ placeholder path keep using the
 * request value unchanged. A "paid" row missing its stored signature (impossible
 * in practice — markMintPaid always sets it) fails closed to "" so completeMint
 * rejects it rather than consuming a substituted value.
 */
export function mintProofSignatureFor(
  reservation: { feeUsdc: number; status?: string; txSignature?: string },
  requestTxSignature: string,
): string {
  if (reservation.feeUsdc > 0 && reservation.status === "paid") {
    return reservation.txSignature ?? "";
  }
  return requestTxSignature;
}
