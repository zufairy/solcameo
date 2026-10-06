import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { loadKeypair } from "./usdcTransfer";

const kp = Keypair.generate();
describe("loadKeypair", () => {
  it("reads base64, base58 and JSON-array keypairs", () => {
    expect(loadKeypair(Buffer.from(kp.secretKey).toString("base64")).publicKey.equals(kp.publicKey)).toBe(true);
    expect(loadKeypair(bs58.encode(kp.secretKey)).publicKey.equals(kp.publicKey)).toBe(true);
    expect(loadKeypair(JSON.stringify([...kp.secretKey])).publicKey.equals(kp.publicKey)).toBe(true);
  });
  it("refuses a 32-byte public key pasted where a secret belongs", () => {
    expect(() => loadKeypair(kp.publicKey.toBase58())).toThrow(/64-byte/);
    expect(() => loadKeypair("")).toThrow();
  });
});
