import type { VersionedTransactionResponse } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
/** Attribute only this transaction's WSOL vault debit; never use a shared treasury balance. */
export function confirmedQuoteDebit(
  tx: VersionedTransactionResponse,
  vault: PublicKey,
) {
  if (!tx.meta || tx.meta.err)
    throw new Error("Claim was not confirmed successfully.");
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta.loadedAddresses,
  });
  let index = -1;
  for (let i = 0; i < keys.length; i++)
    if (keys.get(i)?.equals(vault)) index = i;
  const before = tx.meta.preTokenBalances?.find(
    (b) => b.accountIndex === index,
  );
  const after = tx.meta.postTokenBalances?.find(
    (b) => b.accountIndex === index,
  );
  if (
    !before ||
    !after ||
    before.mint !== "So11111111111111111111111111111111111111112" ||
    after.mint !== before.mint
  )
    throw new Error("Could not verify the collected SOL fee.");
  const amount =
    BigInt(before.uiTokenAmount.amount) - BigInt(after.uiTokenAmount.amount);
  if (amount < 0n) throw new Error("Invalid claim amount");
  return amount;
}
