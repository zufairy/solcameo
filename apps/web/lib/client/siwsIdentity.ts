// Bridges the SIWS session token across React provider boundaries — mirrors
// lib/client/walletIdentity.ts. The auth provider's window.fetch interceptor sits
// ABOVE the wallet/SIWS hooks in the tree, so it can't call a hook directly. The
// useSiwsSession() hook writes the token here (in-memory) and the interceptor
// reads it SYNCHRONOUSLY to attach the X-Siws-Session header to every /api/ call.
//
// Persistence: the token is also mirrored into localStorage (keyed by wallet) so a
// reload, a new tab or a browser restart restores it until it expires — no repeat
// sign-in. (Older builds used sessionStorage; it is still read and migrated.)

const STORE_PREFIX = "vello.siws.session.";

let current: { wallet: string; token: string; exp: number } | null = null;

// The ACTIVE spending wallet — the wallet useUnifiedSolanaWallet() resolves to and
// the one ensureSiwsSession() mints a session FOR (creatorWallet on mint). This is
// tracked separately from getCurrentWalletAddress() (lib/client/walletIdentity),
// which is written from the wallet-ADAPTER pk and can resolve to a DIFFERENT wallet
// than the Privy login/spending wallet on a multi-wallet account. The interceptor
// reconciles the two so a session that IS valid for the active minting wallet is
// never dropped just because the adapter identity lags/differs. SiwsSessionBridge
// keeps this in sync with the unified wallet.
let activeWallet: string | null = null;

/** Record the active spending wallet (the one SIWS sessions are minted for). */
export function setActiveSiwsWallet(wallet: string | null): void {
  activeWallet = wallet;
}

/** The active spending wallet, or null when no wallet is connected. */
export function getActiveSiwsWallet(): string | null {
  return activeWallet;
}

function storageKey(wallet: string): string {
  return `${STORE_PREFIX}${wallet}`;
}

/** Synchronous read for the fetch interceptor. Returns null when expired/absent. */
export function getCurrentSiwsToken(): string | null {
  if (!current) return null;
  if (current.exp <= Date.now()) {
    clearSiwsSession();
    return null;
  }
  return current.token;
}

/** The wallet the active SIWS session is bound to, if any (and not expired). */
export function getCurrentSiwsWallet(): string | null {
  if (!current) return null;
  if (current.exp <= Date.now()) {
    clearSiwsSession();
    return null;
  }
  return current.wallet;
}

const stores = (): Storage[] => {
  if (typeof window === "undefined") return [];
  const out: Storage[] = [];
  try { out.push(window.localStorage); } catch { /* blocked */ }
  try { out.push(window.sessionStorage); } catch { /* blocked */ }
  return out;
};

/** Epoch ms when the current session expires, or null when none (used to renew it silently before expiry). */
export function getCurrentSiwsExp(): number | null {
  return current && current.exp > Date.now() ? current.exp : null;
}

/** Store a freshly-minted session (in memory + localStorage). */
export function setSiwsSession(wallet: string, token: string, exp: number): void {
  current = { wallet, token, exp };
  for (const store of stores()) {
    try { store.setItem(storageKey(wallet), JSON.stringify({ token, exp })); } catch { /* storage unavailable — in-memory still works */ }
  }
}

/** Clear the active SIWS session (sign-out, expiry, wallet switch). */
export function clearSiwsSession(): void {
  const wallet = current?.wallet;
  current = null;
  if (wallet) for (const store of stores()) { try { store.removeItem(storageKey(wallet)); } catch { /* ignore */ } }
}

/**
 * Restore a stored, non-expired session for `wallet` from sessionStorage into the
 * in-memory mirror. Returns the token if a valid one was restored, else null.
 * Call on mount / when the active wallet resolves.
 */
export function restoreSiwsSession(wallet: string): string | null {
  if (!wallet) return null;
  // Already in memory for this wallet and valid → use it.
  if (current && current.wallet === wallet && current.exp > Date.now()) {
    return current.token;
  }
  for (const store of stores()) {
    try {
      const raw = store.getItem(storageKey(wallet));
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { token?: string; exp?: number };
      if (!parsed?.token || typeof parsed.exp !== "number" || parsed.exp <= Date.now()) { store.removeItem(storageKey(wallet)); continue; }
      current = { wallet, token: parsed.token, exp: parsed.exp };
      return parsed.token;
    } catch { /* try the next store */ }
  }
  return null;
}

/** True when a valid SIWS session exists for `wallet` (in memory or restorable). */
export function hasValidSiwsSession(wallet: string | null | undefined): boolean {
  if (!wallet) return false;
  return restoreSiwsSession(wallet) !== null;
}

// ── Interceptor SIWS-attach decision ──────────────────────────────────────────
// Whether the fetch interceptor should attach the in-memory SIWS token to an
// /api/ request. The token is bound to `siwsWallet` (the wallet ensureSiwsSession
// minted it for = the active SPENDING wallet). It is safe to attach when that wallet
// is the one the request is acting as. We accept a match against EITHER identity
// source, because they can legitimately diverge on a multi-wallet Privy account:
//   • `walletAddress` — getCurrentWalletAddress(), written from the wallet-ADAPTER pk
//     (adapter-preferred, and only cleared on full sign-out), and
//   • `activeWallet`  — getActiveSiwsWallet(), the Privy-preferred spending wallet the
//     session was actually minted for.
// Matching activeWallet is what fixes the mint 401 loop: on divergence the token IS
// valid for the minting wallet (creatorWallet === activeWallet) even though the
// adapter identity points elsewhere. A token matching NEITHER is a genuinely stale
// cross-wallet token and is still dropped (preserves the campaign-finalize fix — the
// request then 401s siws_required and the interceptor re-mints for the active wallet).
export function shouldAttachSiws(params: {
  token: string | null;
  siwsWallet: string | null;
  walletAddress: string | null;
  activeWallet: string | null;
}): boolean {
  const { token, siwsWallet, walletAddress, activeWallet: active } = params;
  if (!token) return false;
  // No active wallet identity known → attach as before (back-compat / wallet-only).
  if (!walletAddress) return true;
  if (siwsWallet === walletAddress) return true;
  if (active && siwsWallet === active) return true;
  return false;
}

// ── Interceptor ↔ hook bridge ─────────────────────────────────────────────────
// The window.fetch interceptor sits ABOVE the wallet provider, so it can't call
// the useSiwsSession() hook directly. The hook registers its ensureSiwsSession()
// here; on a 401 `code:"siws_required"` the interceptor invokes it to mint a fresh
// session, then retries the request once. Registration is a no-op on the server.

type EnsureSiwsFn = () => Promise<string | null>;
const ensureSiwsFns = new Set<EnsureSiwsFn>();

/** Called by useSiwsSession() to expose its ensure() to the fetch interceptor. */
export function registerEnsureSiws(fn: EnsureSiwsFn | null): () => void {
  if (!fn) { ensureSiwsFns.clear(); return () => {}; }
  ensureSiwsFns.add(fn);
  // Unmounting a builder card must not unregister the root wallet bridge.
  return () => { ensureSiwsFns.delete(fn); };
}

/** Invoked by the interceptor on a siws_required 401. Returns a fresh token or null. */
export async function ensureSiwsViaRegistered(): Promise<string | null> {
  const ensureSiwsFn = [...ensureSiwsFns].at(-1);
  if (!ensureSiwsFn) return null;
  try {
    return await ensureSiwsFn();
  } catch {
    return null;
  }
}
