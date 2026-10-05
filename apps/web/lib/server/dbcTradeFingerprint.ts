import { createHash } from "node:crypto";
import { PublicKey, VersionedTransaction, type VersionedMessage } from "@solana/web3.js";

// Wallets may add guard/priority instructions around a reviewed swap (Phantom and
// Solflare inject Lighthouse assertions, any wallet may reprice compute). Those
// cannot move funds, so the review fingerprint ignores them. Every other
// instruction — program, accounts, flags, data — must match exactly.
const IGNORED_PROGRAMS = new Set([
  "ComputeBudget111111111111111111111111111111",
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
]);

export function tradeFingerprint(message: VersionedMessage, wallet: string) {
  if (message.addressTableLookups.length) throw new Error("Unsupported lookup tables");
  const keys = message.staticAccountKeys;
  if (!keys[0]?.equals(new PublicKey(wallet))) throw new Error("Trade fee payer is not your wallet");
  const hash = createHash("sha256");
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex]?.toBase58();
    if (!program) throw new Error("Malformed transaction");
    if (IGNORED_PROGRAMS.has(program)) continue;
    hash.update(program);
    for (const index of ix.accountKeyIndexes) {
      const key = keys[index];
      if (!key) throw new Error("Malformed transaction");
      hash.update(`|${key.toBase58()}:${message.isAccountSigner(index) ? "s" : "-"}${message.isAccountWritable(index) ? "w" : "-"}`);
    }
    hash.update(`|${Buffer.from(ix.data).toString("base64")};`);
  }
  return hash.digest("hex");
}

export function txFingerprint(tx: VersionedTransaction, wallet: string) {
  return tradeFingerprint(tx.message, wallet);
}
