import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { encryptWalletSecret } from "../server/walletCrypto";
import { readAgentSecret } from "./walletSecretAccess";

beforeAll(() => {
  // 32-byte key so encrypt/decrypt actually round-trips in this test
  process.env.WALLET_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
});

describe("readAgentSecret", () => {
  it("round-trips an encrypted secret back to the original base64", () => {
    const original = Buffer.from(crypto.randomBytes(64)).toString("base64");
    const stored = encryptWalletSecret(original);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(readAgentSecret(stored)).toBe(original);
  });

  it("passes legacy plaintext through unchanged", () => {
    const legacy = Buffer.from(crypto.randomBytes(64)).toString("base64");
    expect(readAgentSecret(legacy)).toBe(legacy);
  });
});
