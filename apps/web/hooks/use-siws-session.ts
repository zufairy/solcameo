"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Sign-In-With-Solana session hook.
//
// Orchestrates the one-time wallet-proof flow: nonce → signMessage → verify →
// store. The resulting 24h session token is mirrored into lib/client/siwsIdentity
// (in-memory + sessionStorage) so the global fetch interceptor attaches it to
// every /api/ call as X-Siws-Session. Sign ONCE per session — ensureSiwsSession()
// is a no-op when a valid session already exists for the active wallet.
//
// Usage at a money/agent call site:
//   const { ensureSiwsSession } = useSiwsSession();
//   await ensureSiwsSession();   // signs only if needed
//   await fetch("/api/economy/set-cap", { ... });   // header auto-attached
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect } from "react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import {
  clearSiwsSession,
  hasValidSiwsSession,
  registerEnsureSiws,
  restoreSiwsSession,
  setSiwsSession,
} from "@/lib/client/siwsIdentity";
import { getE2eBypassSession } from "@/lib/client/e2eBypass";

/** Base64-encode raw bytes in the browser. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export interface UseSiwsSession {
  /**
   * Ensure a valid SIWS session exists for the active wallet, prompting a single
   * wallet signature only when one is missing/expired. Resolves to the session
   * token, or null if no wallet is connected / the user rejects the signature.
   * Safe to call before every money action — it short-circuits when already signed.
   */
  /** `silent`: only the popup-free path, never prompt. `force`: mint a fresh session even if one exists (renewal). */
  ensureSiwsSession: (opts?: { silent?: boolean; force?: boolean }) => Promise<string | null>;
  /** Drop the stored session (sign-out / wallet switch). */
  clearSiwsSession: () => void;
}

// Shared across hook instances: builder cards and the fetch bridge often run
// together. Scope by wallet so a wallet switch never reuses another signer.
const pendingSessions = new Map<string, Promise<string | null>>();

/** Popup-free session for wallets Privy has linked to the account (one request, no signature). Null when not eligible. */
async function mintAutoSession(wallet: string): Promise<{ session: string; exp: number } | null> {
  try {
    const res = await fetch("/api/auth/siws/auto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet }) });
    if (!res.ok) return null;
    const { session, exp } = (await res.json()) as { session?: string; exp?: number };
    return session && typeof exp === "number" ? { session, exp } : null;
  } catch { return null; }
}

export function useSiwsSession(): UseSiwsSession {
  const { publicKey, signMessage } = useUnifiedSolanaWallet();
  const ensureSiwsSession = useCallback(async (opts?: { silent?: boolean; force?: boolean }): Promise<string | null> => {
    // Dev-only E2E seam (null in prod): the server bypass sets provenWallet without
    // a real SIWS session, so short-circuit instead of prompting a (stubbed) signature
    // that the /verify route would correctly reject. Returns a non-null sentinel so
    // money call sites that gate on ensureSiwsSession() proceed.
    if (getE2eBypassSession()) return "e2e-bypass-session";
    const wallet = publicKey?.toBase58() ?? null;
    if (!wallet) return null;

    // Already have a valid session (in memory or restorable from sessionStorage).
    const existing = restoreSiwsSession(wallet);
    if (!opts?.force && existing && hasValidSiwsSession(wallet)) return existing;

    const flight = `${wallet}:${opts?.silent ? "silent" : "full"}:${opts?.force ? "force" : ""}`;
    const pending = pendingSessions.get(flight);
    if (pending) return pending;

    const run = (async (): Promise<string | null> => {
      try {
        // 0) Auto-approve: a wallet Privy already linked to this account needs no
        //    signature and no popup. Fall through to the signed flow only for
        //    wallets that are not linked (external adapter wallets).
        const auto = await mintAutoSession(wallet);
        if (auto) { setSiwsSession(wallet, auto.session, auto.exp); return auto.session; }
        if (opts?.silent) return null;
        // Privy is authenticated (we have a publicKey) but its signer isn't ready yet.
        // Surface it clearly instead of failing as a generic "sign-in required".
        if (!signMessage) {
          throw new Error("Your wallet isn't ready to sign yet. Give it a second, then try again.");
        }
        // 1) Request a nonce + the exact message to sign. The fetch interceptor
        //    attaches the Privy Bearer automatically.
        const nonceRes = await fetch("/api/auth/siws/nonce", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet }),
        });
        if (!nonceRes.ok) {
          throw new Error(`Could not start wallet sign-in (${nonceRes.status}). Please try again.`);
        }
        const { nonce, message } = (await nonceRes.json()) as { nonce: string; message: string };
        if (!nonce || !message) throw new Error("Wallet sign-in returned an invalid challenge. Please try again.");

        // 2) Sign the message verbatim with the active (Privy login) wallet.
        //    A rejected/failed signature is the most common cause — report it as
        //    such so the user knows to approve the prompt, not that they're signed out.
        let signatureBytes: Uint8Array;
        try {
          signatureBytes = await signMessage(new TextEncoder().encode(message));
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          throw new Error(
            /reject|denied|declined|cancel|user\s|closed/i.test(m)
              ? "You declined the signature. Approve the wallet prompt to mint."
              : `Your wallet couldn't sign the request: ${m}`,
          );
        }
        const signature = bytesToBase64(signatureBytes);

        // 3) Exchange the signature for a session token.
        const verifyRes = await fetch("/api/auth/siws/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet, signature, nonce }),
        });
        if (!verifyRes.ok) {
          throw new Error(`Wallet sign-in verification failed (${verifyRes.status}). Please try again.`);
        }
        const { session, exp } = (await verifyRes.json()) as { session: string; exp: number };
        if (!session || typeof exp !== "number") throw new Error("Wallet sign-in returned an invalid session. Please try again.");

        setSiwsSession(wallet, session, exp);
        return session;
      } finally {
        pendingSessions.delete(flight);
      }
    })();

    pendingSessions.set(flight, run);
    return run;
  }, [publicKey, signMessage]);

  // Expose ensure() to the fetch interceptor so a siws_required 401 can transparently
  // re-sign and retry. Mounted anywhere the provider tree includes this hook.
  useEffect(() => {
    return registerEnsureSiws(ensureSiwsSession);
  }, [ensureSiwsSession]);

  return { ensureSiwsSession, clearSiwsSession };
}
