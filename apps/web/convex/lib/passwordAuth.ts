/**
 * Email+password auth primitives — mints/verifies our own HMAC-signed session
 * tokens and hashes passwords, entirely with WebCrypto (no native deps, matches
 * how verifyToken already does ES256 verification for Privy in this file's
 * sibling `supabaseAuth.ts`).
 *
 * Token format: "pwv1.<base64url(json payload)>.<base64url(hmac-sha256 sig)>"
 * Payload: { sub: "password:<uuid>", email, exp (ms epoch) }
 *
 * The VERIFY half is duplicated in `lib/server/passwordAuthVerify.ts` (Next.js
 * API routes verify the same tokens) — keep the two in sync. Requires Convex env
 * PASSWORD_AUTH_SECRET, and the SAME value set as PASSWORD_AUTH_SECRET in the
 * Next.js environment (not NEXT_PUBLIC_ — server-only secret in both places).
 */

const SECRET = (process.env.PASSWORD_AUTH_SECRET ?? "").trim();
const TOKEN_PREFIX = "pwv1";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITERATIONS = 100_000;

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  if (!SECRET) throw new Error("Password auth is not configured (missing PASSWORD_AUTH_SECRET).");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export type PasswordTokenPayload = { sub: string; email: string; exp: number };

export function isPasswordToken(token: string): boolean {
  return token.startsWith(`${TOKEN_PREFIX}.`);
}

export async function mintPasswordToken(sub: string, email: string): Promise<string> {
  const payload: PasswordTokenPayload = { sub, email, exp: Date.now() + TOKEN_TTL_MS };
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${TOKEN_PREFIX}.${payloadB64}`;
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput) as BufferSource);
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyPasswordToken(token: string): Promise<PasswordTokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) throw new Error("Invalid token");
  const [prefix, payloadB64, sigB64] = parts;
  const key = await hmacKey();
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sigB64) as BufferSource,
    new TextEncoder().encode(`${prefix}.${payloadB64}`) as BufferSource,
  );
  if (!ok) throw new Error("Invalid token signature");
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as PasswordTokenPayload;
  if (!payload.exp || payload.exp < Date.now()) throw new Error("Token expired");
  if (!payload.sub) throw new Error("Token missing subject");
  return payload;
}

// ── Password hashing (PBKDF2-SHA256) ─────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = b64urlDecode(parts[2]);
  const expected = parts[3];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  const actual = b64urlEncode(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
