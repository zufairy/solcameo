// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptWalletSecret,
  encryptWalletSecret,
  isEncryptedSecret,
  loadMasterKey,
} from "./walletCrypto";

// A realistic 64-byte Solana secret key encoded as base64 (88 chars).
const SECRET_B64 = Buffer.from(
  Array.from({ length: 64 }, (_, i) => (i * 7 + 3) % 256),
).toString("base64");

// Deterministic 32-byte AES-256 key as hex.
const KEY_HEX = "1".repeat(64);

describe("walletCrypto (JOB-88 envelope encryption)", () => {
  const prev = process.env.WALLET_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.WALLET_ENCRYPTION_KEY = KEY_HEX;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.WALLET_ENCRYPTION_KEY;
    else process.env.WALLET_ENCRYPTION_KEY = prev;
  });

  it("round-trips a secret through encrypt → decrypt", () => {
    const enc = encryptWalletSecret(SECRET_B64);
    expect(enc).not.toBe(SECRET_B64);
    expect(isEncryptedSecret(enc)).toBe(true);
    expect(decryptWalletSecret(enc)).toBe(SECRET_B64);
  });

  it("produces ciphertext that does NOT contain the plaintext", () => {
    const enc = encryptWalletSecret(SECRET_B64);
    expect(enc.includes(SECRET_B64)).toBe(false);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc.split(":")).toHaveLength(4);
  });

  it("uses a fresh IV each call (non-deterministic ciphertext)", () => {
    expect(encryptWalletSecret(SECRET_B64)).not.toBe(encryptWalletSecret(SECRET_B64));
  });

  it("is idempotent — re-encrypting an encrypted value is a no-op", () => {
    const enc = encryptWalletSecret(SECRET_B64);
    expect(encryptWalletSecret(enc)).toBe(enc);
  });

  it("passes legacy bare-base64 secrets through decrypt unchanged", () => {
    expect(isEncryptedSecret(SECRET_B64)).toBe(false);
    expect(decryptWalletSecret(SECRET_B64)).toBe(SECRET_B64);
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const enc = encryptWalletSecret(SECRET_B64);
    const parts = enc.split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff; // flip a bit in the ciphertext
    parts[3] = ct.toString("base64");
    expect(() => decryptWalletSecret(parts.join(":"))).toThrow();
  });

  it("accepts both hex and base64 master keys", () => {
    const keyBytes = Buffer.from(KEY_HEX, "hex");
    process.env.WALLET_ENCRYPTION_KEY = keyBytes.toString("base64");
    const enc = encryptWalletSecret(SECRET_B64);
    // Decrypt with the hex form of the same key.
    process.env.WALLET_ENCRYPTION_KEY = KEY_HEX;
    expect(decryptWalletSecret(enc)).toBe(SECRET_B64);
  });

  it("throws on a malformed master key", () => {
    process.env.WALLET_ENCRYPTION_KEY = "tooshort";
    expect(() => loadMasterKey()).toThrow(/32 bytes/);
  });

  describe("no master key configured (fail closed)", () => {
    const prevOptOut = process.env.ALLOW_PLAINTEXT_WALLET_SECRETS;
    beforeEach(() => {
      delete process.env.WALLET_ENCRYPTION_KEY;
      delete process.env.ALLOW_PLAINTEXT_WALLET_SECRETS;
    });
    afterEach(() => {
      if (prevOptOut === undefined) delete process.env.ALLOW_PLAINTEXT_WALLET_SECRETS;
      else process.env.ALLOW_PLAINTEXT_WALLET_SECRETS = prevOptOut;
    });

    it("encrypt THROWS rather than persist plaintext (no key, no opt-out)", () => {
      expect(() => encryptWalletSecret(SECRET_B64)).toThrow(/WALLET_ENCRYPTION_KEY/);
    });

    it("encrypt returns plaintext unchanged when the local-dev opt-out is set", () => {
      process.env.ALLOW_PLAINTEXT_WALLET_SECRETS = "1";
      expect(encryptWalletSecret(SECRET_B64)).toBe(SECRET_B64);
    });

    it("decrypt of legacy plaintext still works", () => {
      expect(decryptWalletSecret(SECRET_B64)).toBe(SECRET_B64);
    });

    it("decrypt of an encrypted value throws (cannot produce a signer)", () => {
      process.env.WALLET_ENCRYPTION_KEY = KEY_HEX;
      const enc = encryptWalletSecret(SECRET_B64);
      delete process.env.WALLET_ENCRYPTION_KEY;
      expect(() => decryptWalletSecret(enc)).toThrow(/WALLET_ENCRYPTION_KEY/);
    });
  });
});
