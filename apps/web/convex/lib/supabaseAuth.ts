/**
 * Token verification for Convex actions — now backed by **Privy** (was Supabase).
 *
 * The browser calls Convex actions (e.g. users.whoami) directly with its Privy
 * access token, so Convex must verify the token itself. Privy issues ES256
 * (P-256) JWTs; we verify the signature against the app JWKS using WebCrypto,
 * then hydrate the user's linked accounts (Google email/name, Solana wallet)
 * from Privy's REST API with the app secret.
 *
 * The exported name/shape are unchanged (`verifyToken` → `SupabaseProfile`) so
 * every existing caller keeps working — `supabaseId` now holds the Privy DID,
 * which is the stable per-user identity. This logic mirrors the Next.js copy in
 * `lib/server/privyVerify.ts`; keep them in sync.
 *
 * Requires Convex env: PRIVY_APP_ID, PRIVY_APP_SECRET
 * (set with: npx convex env set PRIVY_APP_ID … / PRIVY_APP_SECRET …)
 */
export type SupabaseProfile = {
  /** Stable per-user identity. Holds the Privy DID (did:privy:…). */
  supabaseId: string;
  email?: string;
  name?: string;
  image?: string;
  /** The user's Solana wallet (embedded auto-created on login, or linked external). */
  walletAddress?: string;
};

import { isPasswordToken, verifyPasswordToken } from "./passwordAuth";

const APP_ID = (process.env.PRIVY_APP_ID ?? "").trim();
const APP_SECRET = (process.env.PRIVY_APP_SECRET ?? "").trim();

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

async function getSigningKey(kid: string | undefined): Promise<CryptoKey> {
  if (!APP_ID) throw new Error("Privy auth is not configured (missing PRIVY_APP_ID).");
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

type PrivyLinkedAccount = {
  type: string;
  email?: string;
  name?: string;
  address?: string;
  chain_type?: string;
  picture?: string;
};

export async function verifyToken(accessToken: string): Promise<SupabaseProfile> {
  // Email+password accounts (created via /login) carry a self-issued "pwv1."
  // token instead of a Privy JWT — verify and short-circuit before the
  // Privy-specific JWT parsing below.
  if (isPasswordToken(accessToken)) {
    const { sub, email } = await verifyPasswordToken(accessToken);
    return { supabaseId: sub, email };
  }

  const parts = accessToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid or expired session.");
  const [h, p, sig] = parts;
  const header = b64urlToJson<{ alg: string; kid?: string }>(h);
  const payload = b64urlToJson<{ iss?: string; aud?: string | string[]; sub?: string; exp?: number }>(p);

  if (header.alg !== "ES256") throw new Error("Invalid or expired session.");
  if (payload.iss !== "privy.io") throw new Error("Invalid or expired session.");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(APP_ID)) throw new Error("Invalid or expired session.");
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error("Invalid or expired session.");
  if (!payload.sub) throw new Error("Invalid or expired session.");

  const key = await getSigningKey(header.kid);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64urlToBytes(sig) as BufferSource,
    new TextEncoder().encode(`${h}.${p}`) as BufferSource,
  );
  if (!ok) throw new Error("Invalid or expired session.");

  const did = payload.sub;

  // Hydrate email/name/image from Privy's REST API. Best-effort: if the secret
  // isn't configured or the call fails, fall back to a DID-only profile so login
  // still succeeds (identity is the verified DID either way).
  if (!APP_SECRET) return { supabaseId: did };
  try {
    const basic = btoa(`${APP_ID}:${APP_SECRET}`);
    const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, {
      headers: { Authorization: `Basic ${basic}`, "privy-app-id": APP_ID },
    });
    if (!res.ok) return { supabaseId: did };
    const u = (await res.json()) as { linked_accounts?: PrivyLinkedAccount[] };
    const accounts = u.linked_accounts ?? [];
    const google = accounts.find((a) => a.type === "google_oauth");
    const email = accounts.find((a) => a.type === "email");
    const wallet = accounts.find(
      (a) => a.type === "wallet" && (a.chain_type === "solana" || a.chain_type == null),
    );
    return {
      supabaseId: did,
      email: google?.email ?? email?.address,
      name: google?.name,
      image: google?.picture,
      walletAddress: wallet?.address,
    };
  } catch {
    return { supabaseId: did };
  }
}
