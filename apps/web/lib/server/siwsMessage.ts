/**
 * Branded, editable Sign-In-With-Solana (SIWS) message.
 *
 * The message a user signs to prove wallet control. The intro copy is editable
 * (just change SIWS_MESSAGE_INTRO); the load-bearing fields (Wallet / Nonce /
 * Issued / Expires) are appended deterministically so the SERVER can reconstruct
 * the exact bytes the wallet signed.
 *
 * IMPORTANT: the server is the only thing that builds this string. The client
 * receives the finished `message` from /api/auth/siws/nonce and signs it
 * verbatim — the client's own message text is NEVER trusted by /verify.
 */

/** Editable branded preamble. Change this freely; it does not affect verification
 *  as long as both the /nonce response and the /verify reconstruction use the
 *  same constant (they both call buildSiwsMessage). */
export const SIWS_MESSAGE_INTRO =
  "Vello — Sign in with Solana\n\n" +
  "Sign this message to prove you control this wallet and to authorize agent & " +
  "treasury actions on Vello. This request will not trigger a blockchain " +
  "transaction or cost any fees.";

export interface SiwsMessageFields {
  wallet: string;
  nonce: string;
  /** Issued-at, epoch ms. */
  issuedAt: number;
  /** Expiry, epoch ms. */
  expiresAt: number;
}

/**
 * Build the exact message string the wallet signs. Deterministic for a given set
 * of fields — the server reconstructs it byte-for-byte during verification from
 * the trusted (HMAC-signed) nonce, so a tampered client message can never pass.
 */
export function buildSiwsMessage(fields: SiwsMessageFields): string {
  return (
    `${SIWS_MESSAGE_INTRO}\n\n` +
    `Wallet: ${fields.wallet}\n` +
    `Nonce: ${fields.nonce}\n` +
    `Issued: ${new Date(fields.issuedAt).toISOString()}\n` +
    `Expires: ${new Date(fields.expiresAt).toISOString()}`
  );
}
