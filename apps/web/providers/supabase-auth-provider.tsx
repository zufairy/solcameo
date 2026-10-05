"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Auth provider — backed by Privy (https://docs.privy.io). The file/hook names
// keep their historical "Supabase" spelling so the ~14 existing consumers and the
// root layout don't need to change; functionally this is 100% Privy now.
//
//   • Login methods: Google + Solana wallet (configured in the Privy dashboard).
//   • `accessToken` is the Privy access token; `getFreshToken()` mints a fresh one.
//   • `profile` comes from Convex `users.whoami`, which verifies the Privy token
//     server-side and upserts the account.
//   • A global fetch interceptor attaches the token to every /api/ call without
//     opening authentication dialogs from background requests.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider, usePrivy, useLogin } from "@privy-io/react-auth";
import { toSolanaWalletConnectors, useWallets as usePrivySolanaWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useAction } from "convex/react";
import { getCurrentWalletAddress } from "@/lib/client/walletIdentity";
import { ensureSiwsViaRegistered, getActiveSiwsWallet, getCurrentSiwsToken, getCurrentSiwsWallet, shouldAttachSiws } from "@/lib/client/siwsIdentity";
import { getRpcUrl, getRpcWsUrl } from "@/lib/solana/network";
import { api } from "@/convex/_generated/api";
import type { WhoAmI } from "@/convex/users";
import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from "@/lib/privy";
import {
  E2E_BYPASS_HEADER,
  E2E_DID_HEADER,
  E2E_WALLET_HEADER,
  getE2eBypassSession,
  type E2eBypassSession,
} from "@/lib/client/e2eBypass";

type AuthValue = {
  /** True once Privy reports an authenticated session. */
  authenticated: boolean;
  /** Convex-side profile (isAdmin, wallet links, …); null when signed out. */
  profile: WhoAmI;
  /** Whether the auth state is still initializing. */
  loading: boolean;
  /** Last-fetched Privy access token, or null when signed out. */
  accessToken: string | null;
  /** Open the Privy login modal (Google + Solana wallet). */
  login: () => void;
  /** Back-compat alias for `login` — opens the Privy modal. */
  signInWithGoogle: () => void;
  /** Create an email+password account (bypasses Privy entirely). Throws on
   *  duplicate email / weak password / server error — surface the message. */
  signUpWithPassword: (email: string, password: string, name?: string) => Promise<void>;
  /** Sign in with an existing email+password account. Throws on bad credentials. */
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Always returns a VALID access token (Privy refreshes transparently), or null
   *  when signed out. Prefer this over the cached `accessToken` for authed calls. */
  getFreshToken: () => Promise<string | null>;
  /** Open sign-in on explicit user action; preserves existing account sessions. */
  promptLogin: () => void;
  /** Human-readable reason the last login attempt failed (Privy error code +
   *  message), or null. Lets the UI show the REAL cause instead of a generic
   *  "retry" — e.g. wallet returned no accounts, signature rejected, etc. */
  loginError: string | null;
  /** Clear `loginError` (call before starting a new login attempt). */
  clearLoginError: () => void;
  /** Retained for source-compat with the old Supabase context; always null. */
  session: null;
};

const AuthContext = createContext<AuthValue | null>(null);

// Solana wallet connectors (Phantom, Solflare, …) for Privy's "connect wallet"
// login option. Built once at module scope.
const solanaConnectors = toSolanaWalletConnectors();

// Solana RPCs for BOTH mainnet + devnet. Without this Privy falls back to its
// default (mainnet-only) RPC plugin, so Sign-In-With-Solana on a devnet wallet
// fails with "Could not log in with wallet" (cluster mismatch). Declaring both
// clusters lets wallet login succeed regardless of the wallet's active network.
// `createSolanaRpc*` only stores the URL — no socket opens until used — so this is
// safe at module scope (matches `solanaConnectors` above).
const solanaRpcs = {
  "solana:mainnet": {
    rpc: createSolanaRpc(getRpcUrl("mainnet-beta")),
    rpcSubscriptions: createSolanaRpcSubscriptions(getRpcWsUrl("mainnet-beta")),
    blockExplorerUrl: "https://explorer.solana.com",
  },
  "solana:devnet": {
    rpc: createSolanaRpc(getRpcUrl("devnet")),
    rpcSubscriptions: createSolanaRpcSubscriptions(getRpcWsUrl("devnet")),
    blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
  },
} as const;

/** Outer provider: mounts Privy, then the auth state. Falls back to a no-op
 *  provider (app still renders) when the app id isn't configured yet. */
export function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    return <MissingConfigProvider>{children}</MissingConfigProvider>;
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#10b981",
          walletChainType: "solana-only",
          showWalletLoginFirst: false,
        },
        externalWallets: { solana: { connectors: solanaConnectors } },
        // RPCs for both clusters so SIWS verifies on mainnet AND devnet wallets.
        solana: { rpcs: solanaRpcs },
        // Give Google/email users a Solana wallet automatically (only if they
        // didn't connect an external one). This is the embedded wallet that shows
        // in the header and is auto-linked to their account server-side.
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          // Auto-approve: embedded wallets sign without a Privy confirmation modal.
          showWalletUIs: false,
        },
      }}
    >
      <AuthState>{children}</AuthState>
    </PrivyProvider>
  );
}

function AuthState({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  // Dev-only E2E test-auth seam (null in prod — the flag is compile-time inlined,
  // so this whole branch is dead code in a prod bundle). When a bypass session is
  // present we report a synthetic logged-in state instead of Privy's, skip the
  // whoami Convex round-trip, and the fetch interceptor attaches the X-E2E-* headers.
  // Resolved POST-MOUNT (useEffect → useState), mirroring how the real Privy session
  // also only resolves asynchronously after mount: starting at `null` keeps the first
  // client render identical to the server's (both unauthenticated), so hydration never
  // sees a mismatch; the effect then flips it before the app is considered idle.
  const [e2e, setE2e] = useState<E2eBypassSession | null>(null);
  useEffect(() => {
    setE2e(getE2eBypassSession());
  }, []);
  const [loginError, setLoginError] = useState<string | null>(null);
  const clearLoginError = useCallback(() => setLoginError(null), []);
  // Records a login event for admin analytics. This is the ONLY true "login"
  // signal (a fresh authentication) — distinct from `whoami`, which fires on
  // every page load and feeds the "active users" metric.
  const recordLoginEvent = useAction(api.analytics.recordLoginEvent);
  // Capture the REAL Privy failure code so the UI can show why login failed
  // instead of Privy's generic retry screen. (e.g. solflare on devnet returning
  // no accounts surfaces here as a concrete code we can act on.)
  const { login } = useLogin({
    onComplete: () => {
      setLoginError(null);
      // Fire-and-forget analytics — must never block or break the session.
      void (async () => {
        try {
          const tok = await getAccessToken();
          if (tok) await recordLoginEvent({ accessToken: tok });
        } catch {
          /* analytics is best-effort */
        }
      })();
    },
    onError: (code) => {
      // Closing the sign-in dialog is an expected choice, not a failed login.
      // Logging it as an error opens the Next.js development error overlay.
      if (code === "exited_auth_flow") {
        setLoginError(null);
        return;
      }
      console.error("[Privy login error]", code);
      setLoginError(typeof code === "string" ? code : "unknown_auth_error");
    },
  });
  const { wallets: privySolanaWallets } = usePrivySolanaWallets();
  const whoami = useAction(api.users.whoami);
  const passwordSignUpAction = useAction(api.auth.passwordSignUp);
  const passwordSignInAction = useAction(api.auth.passwordSignIn);

  // The user's Privy Solana wallet address (embedded auto-created on login, or
  // external). Used to re-resolve the profile once the wallet provisions so the
  // server-side auto-link reflects on the account without a re-login.
  const privyWalletAddress = (privySolanaWallets ?? [])[0]?.address ?? null;

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<WhoAmI>(null);

  // Email+password session token (self-issued by convex/auth.ts, NOT Privy) —
  // persisted in localStorage so a password-created account survives reloads
  // without a Privy session at all. Loaded post-mount (same hydration-safety
  // reasoning as the e2e bypass above: start null, flip in an effect).
  const [pwToken, setPwToken] = useState<string | null>(null);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("vello_pw_token");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setPwToken(stored);
    } catch {
      /* localStorage unavailable — password session just won't persist */
    }
  }, []);

  // Login is an explicit account action, never a wallet-connect fallback.
  // An authenticated account may still be provisioning its embedded wallet.
  const openAccountLogin = useCallback(() => {
    if (e2e || !ready || authenticated || pwToken) return;
    setLoginError(null);
    login();
  }, [e2e, ready, authenticated, pwToken, login]);
  const safeGoogleLogin = useCallback(() => {
    if (e2e || !ready || pwToken) return;
    if (!authenticated) { openAccountLogin(); return; }
    // Only an explicit click may recover an expired Privy session. A valid
    // session survives the click, and network failures never sign the user out.
    void (async () => {
      try {
        if (await getAccessToken()) return;
        await logout();
        login();
      } catch {
        setLoginError("Could not refresh your session. Please try again.");
      }
    })();
  }, [e2e, ready, pwToken, authenticated, openAccountLogin, getAccessToken, logout, login]);

  const loading = !ready;

  // Under the E2E bypass, present a fully logged-in state synthesized from the
  // stored session (skipping Privy + whoami). Off-bypass these pass straight
  // through, so the real path is unchanged. A password session (pwToken) counts
  // as authenticated independent of Privy's own `authenticated` flag.
  const effectiveAuthenticated = e2e ? true : (authenticated || !!pwToken);
  const effectiveLoading = e2e ? false : (pwToken ? false : loading);
  const effectiveProfile: WhoAmI = e2e
    ? {
        userId: e2e.did,
        isAdmin: e2e.isAdmin,
        status: "active",
        walletAddress: e2e.wallet,
        walletAddresses: [e2e.wallet],
      }
    : profile;

  // Always returns a valid token. A password session's token is used as-is
  // (self-issued, 30-day TTL, no refresh step); otherwise Privy handles
  // refresh/expiry internally.
  const getFreshToken = useCallback(async (): Promise<string | null> => {
    if (pwToken) return pwToken;
    if (!authenticated) return null;
    try {
      const tok = await getAccessToken();
      if (tok) setAccessToken(tok);
      return tok ?? null;
    } catch {
      return null;
    }
  }, [pwToken, authenticated, getAccessToken]);

  // Refs so the global fetch interceptor always calls the latest versions
  // without needing to reinstall on every token change.
  const getFreshTokenRef = useRef(getFreshToken);
  useEffect(() => {
    getFreshTokenRef.current = getFreshToken;
  });

  // ── Global authed-fetch interceptor ──────────────────────────────────────────
  // Wrap window.fetch so EVERY same-origin /api/ call (on any page) automatically
  // carries a fresh Privy token. Login dialogs require an explicit user action. Gated to /api/
  // only (Convex/RPC/3rd-party fetches untouched) and fully fail-safe.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const orig = window.fetch.bind(window);
    const wrapped: typeof window.fetch = async (input, init) => {
      try {
        const url =
          typeof input === "string" ? input
          : input instanceof URL ? input.href
          : (input as Request)?.url ?? "";
        const isApi = url.startsWith("/api/") || url.startsWith(window.location.origin + "/api/");
        if (!isApi) return orig(input, init);

        const buildHeaders = async (): Promise<Headers> => {
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
          );
          if (!headers.has("X-Internal-Secret")) {
            // Dev-only E2E seam: attach the triple-gate headers the server validates
            // (getE2eBypassSession is null in prod — the flag is compile-time inlined).
            const e2eSession = getE2eBypassSession();
            if (e2eSession) {
              headers.set(E2E_BYPASS_HEADER, e2eSession.secret);
              headers.set(E2E_WALLET_HEADER, e2eSession.wallet);
              headers.set(E2E_DID_HEADER, e2eSession.did);
            }
            const tok = await getFreshTokenRef.current();
            if (tok) headers.set("Authorization", `Bearer ${tok}`);
            // Identity hint only; server authorization verifies the account
            // token and wallet proof, never this client-supplied address.
            const wallet = getCurrentWalletAddress();
            if (wallet) headers.set("X-Wallet-Address", wallet);
            // SIWS: attach the wallet-proof session token ONLY when it was minted for
            // the ACTIVE wallet. The active wallet is resolved from TWO sources that can
            // diverge on a multi-wallet Privy account: the adapter identity (`wallet`,
            // getCurrentWalletAddress) and the Privy-preferred spending wallet the
            // session was actually minted for (getActiveSiwsWallet). shouldAttachSiws
            // attaches when the token matches EITHER — so a session valid for the wallet
            // being minted is never dropped just because the adapter identity lags —
            // while a token matching NEITHER (a genuinely stale cross-wallet token) is
            // skipped, making the request 401 siws_required so the retry below re-mints
            // for the active wallet. (No active wallet known → attach, for back-compat.)
            const siws = getCurrentSiwsToken();
            if (
              shouldAttachSiws({
                token: siws,
                siwsWallet: getCurrentSiwsWallet(),
                walletAddress: wallet,
                activeWallet: getActiveSiwsWallet(),
              })
            ) {
              headers.set("X-Siws-Session", siws as string);
            }
          }
          return headers;
        };

        const fire = async (headers: Headers): Promise<Response> =>
          input instanceof Request
            ? orig(new Request(input, { ...init, headers }))
            : orig(input, { ...init, headers });

        const headers = await buildHeaders();
        // Preserve the request body for the single authorized recovery attempt.
        const retryInput = input instanceof Request ? input.clone() : input;
        let res = await fire(headers);

        // siws_required → transparently (re)establish a SIWS session, then retry once.
        if (res.status === 401) {
          let needsSiws = false;
          try {
            needsSiws = ((await res.clone().json()) as { code?: string })?.code === "siws_required";
          } catch {
            needsSiws = false;
          }
          if (needsSiws) {
            const minted = await ensureSiwsViaRegistered();
            if (minted) {
              const retryHeaders = await buildHeaders();
              res = retryInput instanceof Request
                ? await orig(new Request(retryInput, { ...init, headers: retryHeaders }))
                : await orig(retryInput, { ...init, headers: retryHeaders });
            }
          }
        }

        // Background API failures must not open a modal or disconnect an account.
        // Sign-in remains available through the app's explicit sign-in buttons.
        return res;
      } catch (error) {
        // Never replay a failed POST: it may already have reached the server.
        throw error;
      }
    };
    window.fetch = wrapped;
    return () => { window.fetch = orig; };
  }, []);

  // Resolve the Convex profile whenever auth state changes. A password session
  // takes priority when present (it can coexist with a signed-out Privy state).
  const refreshProfile = useCallback(async () => {
    if (pwToken) {
      try {
        setProfile(await whoami({ accessToken: pwToken }));
      } catch {
        setProfile(null);
      }
      return;
    }
    if (!authenticated) {
      setProfile(null);
      setAccessToken(null);
      return;
    }
    let tok: string | null = null;
    try {
      tok = await getAccessToken();
    } catch {
      tok = null;
    }
    setAccessToken(tok);
    if (!tok) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await whoami({ accessToken: tok }));
    } catch {
      setProfile(null);
    }
  }, [pwToken, authenticated, getAccessToken, whoami]);

  useEffect(() => {
    if (ready) void refreshProfile();
  }, [ready, authenticated, pwToken, refreshProfile]);

  /** Persist + adopt a freshly-minted password session token, then resolve its profile. */
  const applyPasswordToken = useCallback(async (token: string) => {
    try {
      window.localStorage.setItem("vello_pw_token", token);
    } catch {
      /* best-effort persistence only */
    }
    setPwToken(token);
    setAccessToken(token);
    try {
      setProfile(await whoami({ accessToken: token }));
    } catch {
      setProfile(null);
    }
  }, [whoami]);

  const signUpWithPassword = useCallback(async (email: string, password: string, name?: string) => {
    const { accessToken: token } = await passwordSignUpAction({ email, password, name });
    await applyPasswordToken(token);
  }, [passwordSignUpAction, applyPasswordToken]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { accessToken: token } = await passwordSignInAction({ email, password });
    await applyPasswordToken(token);
  }, [passwordSignInAction, applyPasswordToken]);

  // When the Privy wallet provisions (or changes), re-resolve the profile so the
  // server auto-links it and `profile.walletAddresses` updates right away.
  useEffect(() => {
    if (ready && authenticated && privyWalletAddress) void refreshProfile();
  }, [ready, authenticated, privyWalletAddress, refreshProfile]);

  // Presence heartbeat — keeps `users.lastSeenAt` fresh while a session stays
  // OPEN. Previously lastSeenAt only moved on page load / auth change, so a user
  // who left a tab open for an hour still showed "1h ago" in admin. Now we bump
  // it periodically (whoami patches lastSeenAt = now) and immediately when the
  // tab regains focus — but ONLY while the tab is visible, so backgrounded tabs
  // don't spam writes or inflate "last seen" for someone who isn't really there.
  useEffect(() => {
    if (!ready || !authenticated) return;
    const HEARTBEAT_MS = 3 * 60_000; // every 3 min while the tab is in view
    const beat = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refreshProfile();
      }
    };
    const interval = setInterval(beat, HEARTBEAT_MS);
    // Re-check the moment the user comes back to the tab (cheap, gated on visible).
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [ready, authenticated, refreshProfile]);

  const signOut = useCallback(async () => {
    if (pwToken) {
      setPwToken(null);
      try {
        window.localStorage.removeItem("vello_pw_token");
      } catch {
        /* best-effort */
      }
    }
    if (authenticated) await logout();
    setProfile(null);
    setAccessToken(null);
  }, [pwToken, authenticated, logout]);

  const value = useMemo<AuthValue>(
    () => ({
      authenticated: effectiveAuthenticated,
      profile: effectiveProfile,
      loading: effectiveLoading,
      accessToken,
      login: safeGoogleLogin,
      signUpWithPassword,
      signInWithPassword,
      signInWithGoogle: safeGoogleLogin,
      signOut,
      refreshProfile,
      getFreshToken,
      promptLogin: safeGoogleLogin,
      loginError,
      clearLoginError,
      session: null,
    }),
    [effectiveAuthenticated, effectiveProfile, effectiveLoading, accessToken, safeGoogleLogin, signUpWithPassword, signInWithPassword, signOut, refreshProfile, getFreshToken, loginError, clearLoginError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Fallback when NEXT_PUBLIC_PRIVY_APP_ID isn't set — keeps the app rendering
 *  with a signed-out, no-op auth context and a visible warning. */
function MissingConfigProvider({ children }: { children: React.ReactNode }) {
  const warn = useCallback(() => {
    if (typeof window !== "undefined") {
      console.error("Missing NEXT_PUBLIC_PRIVY_APP_ID — set it in .env.local to enable login.");
    }
  }, []);
  const value: AuthValue = {
    authenticated: false,
    profile: null,
    loading: false,
    accessToken: null,
    login: warn,
    signInWithGoogle: warn,
    signUpWithPassword: async () => { warn(); throw new Error("Auth is not configured."); },
    signInWithPassword: async () => { warn(); throw new Error("Auth is not configured."); },
    signOut: async () => {},
    refreshProfile: async () => {},
    getFreshToken: async () => null,
    promptLogin: warn,
    loginError: null,
    clearLoginError: () => {},
    session: null,
  };
  return (
    <AuthContext.Provider value={value}>
      {children}
      <div className="fixed inset-x-3 bottom-3 z-[100] border border-amber-500/40 bg-amber-500/12 px-3 py-2 text-[11px] text-amber-100 shadow-lg backdrop-blur-sm sm:left-auto sm:right-3 sm:max-w-sm">
        Missing <code>NEXT_PUBLIC_PRIVY_APP_ID</code>. Add it to <code>.env.local</code> to enable Privy login.
      </div>
    </AuthContext.Provider>
  );
}

export function useSupabaseAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useSupabaseAuth must be used within SupabaseAuthProvider");
  return ctx;
}
