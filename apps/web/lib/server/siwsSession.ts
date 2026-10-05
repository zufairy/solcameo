/**
 * Stateless, HMAC-signed SIWS nonce + session tokens.
 *
 * Both the one-time NONCE (handed out by /api/auth/siws/nonce) and the SESSION
 * (issued by /api/auth/siws/verify once the wallet signature checks out) are
 * self-contained, HMAC-SHA256-signed tokens. Nothing is persisted in Convex — the
 * schema is at its TS type-complexity ceiling, so we deliberately avoid adding
 * tables/fields. The signed payload carries its own expiry, so the tokens are
 * tamper-proof and self-cleaning.
 *
 * Token format:  base64url(JSON payload) "." base64url(HMAC-SHA256(payloadB64, secret))
 *
 * Server-only — imports node:crypto. Never import from client code.
 *
 * Env:
 *   SIWS_SESSION_SECRET — server-only HMAC key. In production this MUST be set to
 *     a distinct, high-entropy value; production FAILS CLOSED if it is unset. In
 *     dev only, it falls back to a FIXED dev-only constant (below) — deliberately
 *     NOT INTERNAL_CRON_SECRET, so the SIWS signing key and the money-mutation cron
 *     secret can never be the same value (one leak must not compromise the other).
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h — sign ONCE per session
const NONCE_TTL_MS = 5 * 60 * 1000; // 5min — short window for the sign round-trip

// Dev-only signing key. A FIXED, non-secret constant used ONLY when
// NODE_ENV !== "production" and SIWS_SESSION_SECRET is unset, so local SIWS flows
// work with zero setup. It is intentionally NOT derived from INTERNAL_CRON_SECRET
// (or any real secret): the SIWS signing key and the money-mutation cron secret
// must never collapse onto one value, so that a leak of one cannot compromise the
// other. Sessions signed with this constant are only ever valid in local dev —
// production fails closed and requires a real, distinct SIWS_SESSION_SECRET.
const DEV_SIWS_FALLBACK_SECRET =
  "vello-dev-only-siws-session-key-not-a-secret-do-not-use-in-prod";

function getSecret(): string {
  const dedicated = (process.env.SIWS_SESSION_SECRET || "").trim();
  if (dedicated) return dedicated;
  // Production FAILS CLOSED: a real, distinct SIWS_SESSION_SECRET is mandatory.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SIWS_SESSION_SECRET must be set in production (there is no dev fallback in prod).",
    );
  }
  // Dev only: a fixed constant, NOT INTERNAL_CRON_SECRET — the two secrets must
  // never share a key.
  return DEV_SIWS_FALLBACK_SECRET;
}

// ── base64url helpers (Buffer-based; this module is node-only) ────────────────
function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}
function b64urlEncodeJson(obj: unknown): string {
  return b64urlEncode(Buffer.from(JSON.stringify(obj), "utf8"));
}
function b64urlDecodeJson<T>(s: string): T | null {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** Constant-time compare of two base64url-encoded HMACs of equal expected length. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function makeToken(payload: object): string {
  const secret = getSecret();
  const payloadB64 = b64urlEncodeJson(payload);
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verify HMAC + structural shape; returns the decoded payload or null. Never throws. */
function openToken<T>(token: string | null | undefined): T | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null; // not configured → fail closed
  }
  const expected = sign(payloadB64, secret);
  if (!safeEqual(mac, expected)) return null;
  return b64urlDecodeJson<T>(payloadB64);
}

// ── Session token ─────────────────────────────────────────────────────────────

interface SessionPayload {
  /** wallet (base58 pubkey) */ w: string;
  /** Privy DID */ sub: string;
  /** issued-at, epoch ms */ iat: number;
  /** expires-at, epoch ms */ exp: number;
  /** version */ v: 1;
}

export interface SiwsSession {
  wallet: string;
  did: string;
  /** expires-at, epoch ms */
  exp: number;
}

/** Issue a 24h SIWS session for a proven wallet + Privy DID. */
export function issueSiwsSession(input: { wallet: string; did: string }): { token: string; exp: number } {
  const iat = Date.now();
  const exp = iat + SESSION_TTL_MS;
  const payload: SessionPayload = { w: input.wallet, sub: input.did, iat, exp, v: 1 };
  return { token: makeToken(payload), exp };
}

/** Verify a SIWS session token: HMAC + not-expired. Returns {wallet,did,exp} or null. */
export function verifySiwsSession(token: string | null | undefined): SiwsSession | null {
  const p = openToken<SessionPayload>(token);
  if (!p || p.v !== 1) return null;
  if (typeof p.w !== "string" || typeof p.sub !== "string" || typeof p.exp !== "number") return null;
  if (p.exp < Date.now()) return null;
  return { wallet: p.w, did: p.sub, exp: p.exp };
}

// ── Nonce token ───────────────────────────────────────────────────────────────

interface NoncePayload {
  /** wallet (base58 pubkey) */ w: string;
  /** Privy DID */ sub: string;
  /** issued-at, epoch ms */ iat: number;
  /** expires-at, epoch ms */ exp: number;
  /** unique id (single-use tracking) */ jti: string;
  /** discriminator — stops a nonce being replayed as a session */ t: "nonce";
}

export interface SiwsNonce {
  jti: string;
  wallet: string;
  did: string;
  /** issued-at, epoch ms */
  issuedAt: number;
  /** expires-at, epoch ms */
  expiresAt: number;
  /** the signed token string to hand to the client */
  token: string;
}

/** Mint a single-use, 5-min nonce bound to a wallet + Privy DID. */
export function issueNonce(input: { wallet: string; did: string }): SiwsNonce {
  const iat = Date.now();
  const exp = iat + NONCE_TTL_MS;
  const jti = randomUUID();
  const payload: NoncePayload = { w: input.wallet, sub: input.did, iat, exp, jti, t: "nonce" };
  return {
    jti,
    wallet: input.wallet,
    did: input.did,
    issuedAt: iat,
    expiresAt: exp,
    token: makeToken(payload),
  };
}

export interface VerifiedNonce {
  jti: string;
  wallet: string;
  did: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Verify a nonce token: HMAC + discriminator + not-expired. Does NOT consume it —
 * call consumeNonce(jti) after the signature check passes to enforce single-use.
 * Returns the decoded nonce fields or null.
 */
export function verifyNonce(token: string | null | undefined): VerifiedNonce | null {
  const p = openToken<NoncePayload>(token);
  if (!p || p.t !== "nonce") return null;
  if (
    typeof p.w !== "string" ||
    typeof p.sub !== "string" ||
    typeof p.exp !== "number" ||
    typeof p.iat !== "number" ||
    typeof p.jti !== "string"
  ) {
    return null;
  }
  if (p.exp < Date.now()) return null;
  return { jti: p.jti, wallet: p.w, did: p.sub, issuedAt: p.iat, expiresAt: p.exp };
}

// ── Single-use enforcement (in-memory, self-pruning) ──────────────────────────
// A jti is consumed at most once per process. The set is bounded because every
// entry carries the nonce's own 5-min expiry — prune drops expired entries on
// each consume. Multi-instance caveat: a nonce could be consumed once PER
// instance within its window; the wallet+did+exp binding caps the blast radius
// to the same user, so no privilege escalation. If strict cross-instance
// single-use is ever required, back this with a tiny `siwsNonces { jti, exp }`
// table (by_jti index) — a NEW table, never a field on an existing one.
const consumedJtis = new Map<string, number>(); // jti -> expiresAt (epoch ms)

function prune(now: number): void {
  if (consumedJtis.size === 0) return;
  for (const [jti, exp] of consumedJtis) {
    if (exp <= now) consumedJtis.delete(jti);
  }
}

/**
 * Mark a nonce consumed. Returns true if this is the FIRST consumption (proceed),
 * false if it was already used (reject as a replay). Pass the nonce's expiresAt so
 * the entry self-prunes.
 */
export function consumeNonce(jti: string, expiresAt: number): boolean {
  const now = Date.now();
  prune(now);
  if (consumedJtis.has(jti)) return false;
  consumedJtis.set(jti, expiresAt);
  return true;
}

/** Test-only: reset the consumed-jti set. */
export function __resetConsumedNoncesForTest(): void {
  consumedJtis.clear();
}

// ── Ed25519 message-signature verification ────────────────────────────────────
// Native WebCrypto Ed25519 (Node 24+). The wallet's public key is its base58
// address; PublicKey(...).toBytes() yields the 32-byte raw ed25519 key. Only the
// holder of the private key can produce a signature that verifies — this is what
// proves wallet control. Routes that call this MUST run on the nodejs runtime
// (Edge Ed25519 support is uncertain); /verify declares `runtime = "nodejs"`.

/**
 * Verify an Ed25519 signature over `message` (UTF-8) by `wallet` (base58 pubkey).
 * `signatureBase64` is the 64-byte ed25519 signature, base64-encoded. Returns
 * false on any malformed input or verification failure — never throws.
 */
export async function verifyWalletSignature(input: {
  wallet: string;
  message: string;
  signatureBase64: string;
}): Promise<boolean> {
  try {
    const pubBytes = new PublicKey(input.wallet).toBytes(); // 32 bytes
    if (pubBytes.length !== 32) return false;
    const sig = Buffer.from(input.signatureBase64, "base64");
    if (sig.length !== 64) return false;
    const msg = Buffer.from(input.message, "utf8");
    const key = await crypto.subtle.importKey(
      "raw",
      pubBytes as unknown as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sig as unknown as BufferSource,
      msg as unknown as BufferSource,
    );
  } catch {
    return false;
  }
}
