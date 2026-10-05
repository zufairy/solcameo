import { describe, expect, it } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { txFingerprint } from "./dbcTradeFingerprint";

const payer = Keypair.generate();
const other = Keypair.generate().publicKey;
const build = (extra: ReturnType<typeof SystemProgram.transfer>[] = [], blockhash = "11111111111111111111111111111111", lamports = 5) =>
  new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: other, lamports }),
        ...extra,
      ],
    }).compileToV0Message(),
  );

describe("tradeFingerprint", () => {
  const w = payer.publicKey.toBase58();
  it("ignores blockhash and compute budget changes", () => {
    const a = build();
    const b = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 9 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: other, lamports: 5 }),
        ],
      }).compileToV0Message(),
    );
    expect(txFingerprint(b, w)).toBe(txFingerprint(a, w));
  });
  it("rejects a changed amount or an extra instruction", () => {
    expect(txFingerprint(build([], undefined, 6), w)).not.toBe(txFingerprint(build(), w));
    const extra = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: other, lamports: 1 });
    expect(txFingerprint(build([extra]), w)).not.toBe(txFingerprint(build(), w));
  });
  it("rejects a foreign fee payer", () => {
    expect(() => txFingerprint(build(), Keypair.generate().publicKey.toBase58())).toThrow();
  });
});
