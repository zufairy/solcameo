import { PublicKey } from "@solana/web3.js";

/**
 * Every payment for generations (Higgsfield, Kie and the other providers the operator tops up by hand) lands in this
 * wallet on mainnet. It is the default, so a missing or stale environment variable can never send provider revenue to
 * the old platform treasury. Set SOLCAMEO_GENERATION_COLLECTION_WALLET only to deliberately move it.
 */
export const HIGGSFIELD_PAYMENT_WALLET = "EhXTsbTMTgkGhBdUGAWx5JL78Jmu1dZgDCVUFWJp3pSa";

export function generationCollectionWallet(): string {
  const address = process.env.SOLCAMEO_GENERATION_COLLECTION_WALLET?.trim() || HIGGSFIELD_PAYMENT_WALLET;
  // An invalid override throws rather than quietly paying a different wallet.
  return new PublicKey(address).toBase58();
}
