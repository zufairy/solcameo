import { describe, expect, it, vi } from "vitest";
import { Keypair, type Connection } from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";
import { readTokenAmount, tokenAccountExists } from "./tokenBalance";

const ata = Keypair.generate().publicKey;
const conn = (info: { data: Buffer } | null) => ({ getAccountInfo: vi.fn(async () => info) }) as unknown as Connection;
const account = (amount: bigint) => {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint: Keypair.generate().publicKey, owner: Keypair.generate().publicKey, amount, delegateOption: 0, delegate: Keypair.generate().publicKey, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: Keypair.generate().publicKey }, data);
  return { data };
};

describe("token balance", () => {
  it("reads a wallet with no USDC account as a plain zero, not an error", async () => {
    expect(await readTokenAmount(conn(null), ata)).toBe(0n);
    expect(await tokenAccountExists(conn(null), ata)).toBe(false);
  });
  it("reads the real amount from an existing account", async () => {
    expect(await readTokenAmount(conn(account(1_230_000n)), ata)).toBe(1_230_000n);
    expect(await tokenAccountExists(conn(account(0n)), ata)).toBe(true);
  });
});
