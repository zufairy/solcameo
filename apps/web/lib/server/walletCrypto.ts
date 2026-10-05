/**
 * Envelope encryption for agent Solana wallet secret keys (JOB-88).
 *
 * Background: agent wallets are off-chain signers (the agent signs arbitrary
 * Jupiter swap / USDC transfer instructions), so a raw secret key MUST exist
 * somewhere at signing time — PDA-only signing can't cover arbitrary CPIs.
 * The residual risk closed here is *at-rest* exposure: previously the raw
 * base64 64-byte secret was persisted verbatim in Convex (`influencers
 * .agentWalletSecret`), so anyone with Convex dashboard/DB access could
 * exfiltrate every agent wallet.
 *
 * Fix: the secret is stored encrypted with AES-256-GCM. The 256-bit master
 * key lives ONLY in the Next.js signing runtime (`WALLET_ENCRYPTION_KEY`) and
 * is NEVER written to Convex — so a Convex compromise yields ciphertext only.
 *
 * The `encrypt`/`decrypt` pair is a deliberate seam: to later custody the key
 * in a KMS / dedicated signer service, swap the body of `loadMasterKey` (and,
 * if the KMS does the crypto, the two functions) without touching call sites.
 *
 * Storage format (versioned, so the scheme can evolve):
 *   v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 *
 * Backward compatibility: legacy rows hold a bare base64 secret with no
 * `v1:` prefix. `decryptWalletSecret` passes those through unchanged so the
 * system keeps working during a rolling migration (see
 * `app/api/nft/encrypt-wallets`).
 */
import crypto from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

let warnedMissingKey = false;

/**
 * Parse the master key from `WALLET_ENCRYPTION_KEY`. Accepts a 32-byte key as
 * either 64 hex chars or base64. Returns null when unset (dev fallback).
 * Throws when the key is present but malformed — a misconfigured key must fail
 * loudly rather than silently disable encryption.
 */
export function loadMasterKey(): Buffer | null {
  const raw = process.env.WALLET_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `WALLET_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: openssl rand -hex 32`,
    );
  }
  return key;
}

/** True when `value` is in the encrypted `v1:` envelope format. */
export function isEncryptedSecret(value: string): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

/**
 * Encrypt a wallet secret for storage at rest.
 *
 * FAIL CLOSED: when no master key is configured we THROW rather than persist an
 * agent private key in the clear — storing plaintext secrets is never acceptable
 * by default. The ONLY escape hatch is an explicit local-dev opt-out
 * (`ALLOW_PLAINTEXT_WALLET_SECRETS === "1"`), which restores the old warn +
 * plaintext behaviour so local dev / tests can run with zero crypto config.
 * Production MUST set `WALLET_ENCRYPTION_KEY` (openssl rand -hex 32) and MUST NOT
 * set the opt-out.
 *
 * Idempotent: re-encrypting an already-encrypted value is a no-op.
 */
export function encryptWalletSecret(plaintextBase64: string): string {
  if (isEncryptedSecret(plaintextBase64)) return plaintextBase64;

  const key = loadMasterKey();
  if (!key) {
    // Without a key we can only store plaintext — refuse, unless a developer has
    // explicitly opted into plaintext-at-rest for local dev.
    if (process.env.ALLOW_PLAINTEXT_WALLET_SECRETS !== "1") {
      throw new Error(
        "[walletCrypto] refusing to store an agent wallet secret UNENCRYPTED: " +
          "WALLET_ENCRYPTION_KEY is not set. Set it (openssl rand -hex 32), or — " +
          "for local dev ONLY — set ALLOW_PLAINTEXT_WALLET_SECRETS=1 to opt out.",
      );
    }
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        "[walletCrypto] WALLET_ENCRYPTION_KEY not set and " +
          "ALLOW_PLAINTEXT_WALLET_SECRETS=1 — agent wallet secrets are being stored " +
          "UNENCRYPTED (local-dev opt-out). NEVER do this in production.",
      );
    }
    return plaintextBase64;
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintextBase64, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a stored wallet secret back to the raw base64 64-byte secret key.
 *
 * - Encrypted (`v1:`) values require the master key; a missing/wrong key throws
 *   (we must not silently fail to produce a signer).
 * - Legacy bare-base64 values are returned unchanged so unmigrated rows keep
 *   signing during rollout.
 */
export function decryptWalletSecret(stored: string): string {
  if (!isEncryptedSecret(stored)) return stored; // legacy plaintext passthrough

  const key = loadMasterKey();
  if (!key) {
    throw new Error(
      "[walletCrypto] cannot decrypt agent wallet secret: WALLET_ENCRYPTION_KEY is not set",
    );
  }

  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new Error("[walletCrypto] malformed encrypted secret (expected v1:iv:tag:ct)");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
