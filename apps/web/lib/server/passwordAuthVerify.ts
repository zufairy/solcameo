/**
 * Verify-only half of the email+password token scheme minted in
 * `convex/lib/passwordAuth.ts` (see that file for the format + mint logic).
 * Next.js API routes never mint these tokens — only Convex's `auth.passwordSignUp`
 * / `auth.passwordSignIn` do — this file just lets `requireAuth` accept them.
 * Keep in sync with the Convex copy.
 */

const SECRET = (process.env.PASSWORD_AUTH_SECRET ?? "").trim();
const TOKEN_PREFIX = "pwv1";

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
    ["verify"],
  );
}

export type PasswordTokenPayload = { sub: string; email: string; exp: number };

export function isPasswordToken(token: string): boolean {
  return token.startsWith(`${TOKEN_PREFIX}.`);
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
