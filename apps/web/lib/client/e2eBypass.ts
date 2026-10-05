// ─────────────────────────────────────────────────────────────────────────────
// SECURITY-CRITICAL: dev-only CLIENT half of the E2E test-auth seam.
//
// Mirrors the server triple-gate (lib/server/requireAuth.ts). This whole module is
// INERT in production: `NEXT_PUBLIC_E2E_AUTH_BYPASS` is inlined by Next at build
// time, so `!== "1"` folds to a constant `true` in a prod bundle and the
// localStorage read below is dead-code-eliminated — a prod build can never read a
// bypass session or attach a bypass header.
//
// Playwright arms an authenticated session by writing localStorage BEFORE the app
// boots:
//   localStorage["vello.e2e.session"] = JSON.stringify({ wallet, did, isAdmin?, secret })
// where `secret` must equal the server's E2E_AUTH_BYPASS_SECRET. The auth provider
// then reports a logged-in state and the fetch interceptor attaches the X-E2E-*
// headers the server seam validates.
// ─────────────────────────────────────────────────────────────────────────────

/** localStorage key Playwright writes the synthetic session to. */
export const E2E_BYPASS_STORAGE_KEY = "vello.e2e.session";

// Header names — kept in one place so client + server + specs never drift.
export const E2E_BYPASS_HEADER = "X-E2E-Bypass";
export const E2E_WALLET_HEADER = "X-E2E-Wallet";
export const E2E_DID_HEADER = "X-E2E-Did";

/** Fallback DID when the stored session omits one (mirrors the server fallback). */
const E2E_TEST_DID_FALLBACK = "did:e2e:test";

export interface E2eBypassSession {
  /** The wallet the E2E user acts as (becomes the server's provenWallet). */
  wallet: string;
  /** The synthetic Privy DID. */
  did: string;
  /** Whether the synthetic profile is an admin (for admin-only UI in E2E). */
  isAdmin: boolean;
  /** Shared secret — must equal the server's E2E_AUTH_BYPASS_SECRET. */
  secret: string;
}

/**
 * The dev-only E2E bypass session, or null. Returns null (and touches nothing) in
 * production, on the server, or when the localStorage entry is absent/malformed.
 * Cheap + synchronous so the fetch interceptor can call it per /api/ request.
 */
export function getE2eBypassSession(): E2eBypassSession | null {
  // Gate: the public flag is compile-time inlined; this is what makes the module
  // dead-code in production bundles.
  if (process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS !== "1") return null;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(E2E_BYPASS_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<E2eBypassSession>;
    if (!p || typeof p.wallet !== "string" || !p.wallet) return null;
    if (typeof p.secret !== "string" || !p.secret) return null;
    const did = typeof p.did === "string" && p.did ? p.did : E2E_TEST_DID_FALLBACK;
    return { wallet: p.wallet, did, isAdmin: !!p.isAdmin, secret: p.secret };
  } catch {
    return null;
  }
}
