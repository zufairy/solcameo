import { Transaction, VersionedTransaction } from "@solana/web3.js";

export type SignBytes = (serialized: Uint8Array) => Promise<Uint8Array>;

/**
 * Adapt a bytes-level Solana signer (Privy's `useSignTransaction`, which takes
 * and returns `Uint8Array`s) to wallet-adapter's object-level `signTransaction`
 * shape used across the app (`sendUsdc`, `sendFundingTransfer`, trader cards).
 *
 * Legacy transactions are serialized WITHOUT signature checks — at this point
 * the tx has a fee payer + blockhash but no signatures yet, which is exactly
 * the state every call site signs in.
 */
export async function signTransactionViaBytes<T extends Transaction | VersionedTransaction>(
  tx: T,
  signBytes: SignBytes,
): Promise<T> {
  const isVersioned = "version" in tx;
  const serialized = isVersioned
    ? (tx as VersionedTransaction).serialize()
    : new Uint8Array((tx as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false }));
  const signed = await signBytes(serialized);
  return (isVersioned
    ? VersionedTransaction.deserialize(signed)
    : Transaction.from(signed)) as T;
}
