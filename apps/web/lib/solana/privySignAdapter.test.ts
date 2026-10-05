// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { signTransactionViaBytes } from "./privySignAdapter";

const FAKE_BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

describe("signTransactionViaBytes", () => {
  it("round-trips a legacy Transaction through a bytes-level signer", async () => {
    const payer = Keypair.generate();
    const dest = Keypair.generate().publicKey;
    const tx = new Transaction();
    tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: dest, lamports: 1000 }));
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = FAKE_BLOCKHASH;

    // Bytes-level signer mimicking Privy: deserialize, sign, reserialize.
    const signBytes = async (serialized: Uint8Array) => {
      const inner = Transaction.from(serialized);
      inner.partialSign(payer);
      return new Uint8Array(inner.serialize({ requireAllSignatures: false, verifySignatures: false }));
    };

    const signed = await signTransactionViaBytes(tx, signBytes);
    expect(signed).toBeInstanceOf(Transaction);
    expect(signed.verifySignatures()).toBe(true);
    expect(signed.instructions).toHaveLength(1);
    expect(signed.feePayer?.equals(payer.publicKey)).toBe(true);
  });

  it("round-trips a VersionedTransaction through a bytes-level signer", async () => {
    const payer = Keypair.generate();
    const dest = Keypair.generate().publicKey;
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: FAKE_BLOCKHASH,
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: dest, lamports: 1000 })],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);

    const signBytes = async (serialized: Uint8Array) => {
      const inner = VersionedTransaction.deserialize(serialized);
      inner.sign([payer]);
      return inner.serialize();
    };

    const signed = await signTransactionViaBytes(tx, signBytes);
    expect(signed).toBeInstanceOf(VersionedTransaction);
    expect(signed.signatures[0].some((b) => b !== 0)).toBe(true);
  });
});
