/**
 * Privy access-token verification for Next.js server routes.
 *
 * Privy issues ES256 (P-256) JWTs as access tokens. We verify the signature
 * locally against the app's JWKS (no per-request round-trip to Privy for the
 * signature check), then OPTIONALLY hydrate the user's linked accounts (Google
 * email/name, Solana wallet) from Privy's REST API using the app secret.
 *
 * Implemented with WebCrypto (globalThis.crypto.subtle) so the exact same logic
 * mirrors the Convex copy in `convex/lib/supabaseAuth.ts` — keep them in sync.
 *
 * Env:
 *   NEXT_PUBLIC_PRIVY_APP_ID (or PRIVY_APP_ID) — required for verification
 *   PRIVY_APP_SECRET                            — required to hydrate email/wallet
 */

import { isPasswordToken, verifyPasswordToken } from "./passwordAuthVerify";

// NO hardcoded fallback app id: a default would let this verifier accept tokens
// minted for the shipped default app on a misconfigured deploy, and would diverge
// from the Convex verifier (convex/lib/supabaseAuth.ts) which has none. Both layers
// now FAIL CLOSED (reject all tokens) when PRIVY_APP_ID is unset. PRIVY_APP_ID (or
// NEXT_PUBLIC_PRIVY_APP_ID) MUST be set in every environment.
const APP_ID =
  (process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || "").trim();
const APP_SECRET = (process.env.PRIVY_APP_SECRET || "").trim();

export type PrivyAuthUser = {
  /** Privy DID — stable per-user identity, e.g. did:privy:abc123. */
  id: string;
  email?: string;
  name?: string;
  image?: string;
  /** First linked Solana wallet, if any. */
  walletAddress?: string;
  /** ALL linked Solana wallet addresses (embedded + external). Used by SIWS to
   *  verify a signed wallet actually belongs to this Privy account. */
  walletAddresses?: string[];
};

// ── JWKS (cached) ────────────────────────────────────────────────────────────
type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

async function getSigningKey(kid: string | undefined): Promise<CryptoKey> {
  if (!APP_ID) throw new Error("Privy not configured (missing PRIVY_APP_ID / NEXT_PUBLIC_PRIVY_APP_ID).");
  if (!jwksCache || Date.now() - jwksCache.fetchedAt > JWKS_TTL_MS) {
    const res = await fetch(`https://auth.privy.io/api/v1/apps/${APP_ID}/jwks.json`);
    if (!res.ok) throw new Error("Failed to fetch Privy JWKS");
    const json = (await res.json()) as { keys: Jwk[] };
    jwksCache = { keys: json.keys ?? [], fetchedAt: Date.now() };
  }
  const jwk = kid
    ? jwksCache.keys.find((k) => k.kid === kid) ?? jwksCache.keys[0]
    : jwksCache.keys[0];
  if (!jwk) throw new Error("No Privy signing key available");
  return crypto.subtle.importKey(
    "jwk",
    { ...jwk, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

// ── base64url helpers ────────────────────────────────────────────────────────
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
}

/** Verify a Privy access token's signature + standard claims; returns the DID. */
export async function verifyPrivyToken(token: string): Promise<{ did: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [h, p, sig] = parts;
  const header = b64urlToJson<{ alg: string; kid?: string }>(h);
  const payload = b64urlToJson<{ iss?: string; aud?: string | string[]; sub?: string; exp?: number }>(p);

  if (header.alg !== "ES256") throw new Error("Unexpected token alg");
  if (payload.iss !== "privy.io") throw new Error("Unexpected token issuer");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(APP_ID)) throw new Error("Token audience mismatch");
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error("Token expired");
  if (!payload.sub) throw new Error("Token missing subject");

  const key = await getSigningKey(header.kid);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64urlToBytes(sig) as BufferSource,
    new TextEncoder().encode(`${h}.${p}`) as BufferSource,
  );
  if (!ok) throw new Error("Invalid token signature");
  return { did: payload.sub };
}

type PrivyLinkedAccount = {
  type: string;
  email?: string;
  name?: string;
  address?: string;
  chain_type?: string;
  picture?: string;
};

export function mapPrivyUser(did: string, raw: unknown): PrivyAuthUser {
  const accounts = ((raw as { linked_accounts?: PrivyLinkedAccount[] })?.linked_accounts) ?? [];
  const google = accounts.find((a) => a.type === "google_oauth");
  const email = accounts.find((a) => a.type === "email");
  const solanaWallets = accounts.filter(
    (a) => a.type === "wallet" && (a.chain_type === "solana" || a.chain_type == null),
  );
  const walletAddresses = solanaWallets
    .map((a) => a.address)
    .filter((addr): addr is string => typeof addr === "string" && addr.length > 0);
  return {
    id: did,
    email: google?.email ?? email?.address,
    name: google?.name,
    image: google?.picture,
    walletAddress: walletAddresses[0],
    walletAddresses,
  };
}

/** Fetch a Privy user's linked accounts via the REST API (needs the app secret). */
export async function fetchPrivyUser(did: string): Promise<PrivyAuthUser> {
  if (!APP_SECRET) throw new Error("Privy not configured (missing PRIVY_APP_SECRET).");
  const basic = btoa(`${APP_ID}:${APP_SECRET}`);
  const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, {
    headers: { Authorization: `Basic ${basic}`, "privy-app-id": APP_ID },
  });
  if (!res.ok) throw new Error("Failed to fetch Privy user");
  return mapPrivyUser(did, await res.json());
}

/**
 * Verify a token and resolve the full user. The signature check is authoritative;
 * if the REST hydration fails (e.g. secret not yet configured), we still return a
 * minimal authenticated user keyed by the DID so auth doesn't hard-fail.
 */
export async function verifyAndFetchPrivyUser(token: string): Promise<PrivyAuthUser> {
  // Email+password accounts (created via /login) carry a self-issued "pwv1."
  // token, not a Privy JWT — verify via the password-auth path instead.
  if (isPasswordToken(token)) {
    const { sub, email } = await verifyPasswordToken(token);
    return { id: sub, email };
  }
  const { did } = await verifyPrivyToken(token);
  try {
    return await fetchPrivyUser(did);
  } catch {
    return { id: did };
  }
}
