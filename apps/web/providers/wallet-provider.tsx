"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalContext, WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets as usePrivySolanaWallets,
  useSolanaFundingPlugin,
} from "@privy-io/react-auth/solana";
import {
  setCurrentWalletAddress,
  beginSignOut,
  endSignOut,
  isSigningOut,
} from "@/lib/client/walletIdentity";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { clearSiwsSession, getCurrentSiwsExp, hasValidSiwsSession, restoreSiwsSession, setActiveSiwsWallet } from "@/lib/client/siwsIdentity";
import { PRIVY_ENABLED } from "@/lib/privy";
import { selectActiveWallet, getLoginWalletAddress } from "@/lib/solana/activeWallet";
import "@solana/wallet-adapter-react-ui/styles.css";
import { getRpcUrl } from "@/lib/solana/network";

const RPC_URL = getRpcUrl();

/**
 * Replaces wallet-adapter's `WalletModalProvider`. It supplies the SAME
 * `useWalletModal()` context shape ({ visible, setVisible }), but `setVisible(true)`
 * opens the **Privy** login/connect modal instead of the old wallet-adapter modal.
 * This routes EVERY existing `setVisible(true)` call site across the app (header,
 * studio, campaigns, hire flows, …) to Privy with no per-file changes.
 */
function PrivyWalletModalShim({ children }: { children: React.ReactNode }) {
  const { promptLogin } = useSupabaseAuth();
  const [visible, setVisibleState] = useState(false);
  const setVisible = useCallback(
    (open: boolean) => {
      setVisibleState(open);
      if (open) promptLogin(); // → Privy modal (Google + Solana wallet)
    },
    [promptLogin],
  );
  const ctx = useMemo(() => ({ visible, setVisible }), [visible, setVisible]);
  return <WalletModalContext.Provider value={ctx}>{children}</WalletModalContext.Provider>;
}

/**
 * Bridges a Privy-connected external Solana wallet back into the wallet-adapter
 * world so the existing `useWallet()`-based UI (header pill, connected state) and
 * on-chain signing keep working unchanged:
 *   1. writes the Privy wallet address into the walletIdentity bridge (so the
 *      X-Wallet-Address / wallet-as-login model resolves immediately), and
 *   2. mirrors the connection into wallet-adapter via select()+connect(). Because
 *      the browser extension is already authorized through Privy, connect() is
 *      silent (no second popup).
 */
function PrivyWalletBridge() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets: privyWallets } = usePrivySolanaWallets();
  const {
    wallets: adapters,
    select,
    connect,
    connected,
    connecting,
    publicKey,
    wallet,
  } = useWallet();

  // The active Privy Solana wallet = the one the user logged in with (matched by
  // address), so the wallet-as-login identity and the adapter mirror track the
  // exact wallet the user spends from.
  const privyWallet = selectActiveWallet(
    privyWallets as Array<{ address?: string; walletClientType?: string; meta?: { name?: string } }> | undefined,
    getLoginWalletAddress(user),
  ) ?? undefined;

  // Fall back to the linked wallet on the user object if no live connector wallet.
  const linkedWalletAddress = useMemo(() => {
    const accts = (user?.linkedAccounts ?? []) as Array<{
      type?: string;
      chainType?: string;
      address?: string;
    }>;
    const w = accts.find((a) => a.type === "wallet" && a.chainType === "solana");
    return w?.address;
  }, [user]);

  const privyAddress = privyWallet?.address ?? linkedWalletAddress ?? null;

  // (1) wallet-as-login identity: prefer wallet-adapter's own pk; else Privy's.
  useEffect(() => {
    if (publicKey) return; // WalletIdentitySync already mirrors the adapter pk
    setCurrentWalletAddress(privyAddress);
  }, [publicKey, privyAddress]);

  // (2) mirror Privy's live connection into wallet-adapter (best-effort, silent).
  useEffect(() => {
    // Never re-grab the wallet while a sign-out is in flight — otherwise the
    // disconnect() below flips `connected` and re-fires this effect before Privy's
    // `authenticated` flag has flipped, instantly reconnecting what we just dropped.
    if (isSigningOut()) return;
    if (!ready || !authenticated) return;
    if (!privyWallet?.address) return;
    if (connected || connecting) return;
    const clientType = (privyWallet.walletClientType ?? privyWallet.meta?.name ?? "").toLowerCase();
    if (!clientType) return;
    const match = adapters.find((a) => {
      const n = a.adapter.name.toLowerCase();
      return n.includes(clientType) || clientType.includes(n);
    });
    if (!match) return;
    if (wallet?.adapter.name !== match.adapter.name) {
      select(match.adapter.name);
    } else {
      connect().catch(() => { /* extension already authorized via Privy; ignore */ });
    }
  }, [ready, authenticated, privyWallet, connected, connecting, adapters, wallet, select, connect]);

  return null;
}

/**
 * The ONE true sign-out. Tears down every layer the wallet lives in, in an order
 * that can't race the auto-reconnect bridge:
 *   1. raise the sign-out guard (synchronously stops PrivyWalletBridge re-grabbing),
 *   2. disconnect the wallet-adapter wallet (clears `publicKey`),
 *   3. disconnect each Privy Solana wallet connector (clears `usePrivySolanaWallets`),
 *   4. Privy logout (flips `authenticated` → false, clears profile/token),
 *   5. clear the wallet-as-login identity,
 *   6. drop the guard once Privy state has settled.
 * Must be called from a component rendered INSIDE SolanaWalletProvider.
 */
export function useFullSignOut(): () => Promise<void> {
  const { disconnect } = useWallet();
  const { wallets: privyWallets } = usePrivySolanaWallets();
  const { signOut } = useSupabaseAuth();

  return useCallback(async () => {
    beginSignOut();
    try {
      try { await disconnect(); } catch { /* ignore */ }
      for (const w of privyWallets ?? []) {
        try { await w.disconnect(); } catch { /* not all clients support it; ignore */ }
      }
      try { await signOut(); } catch { /* ignore */ }
      setCurrentWalletAddress(null);
      setActiveSiwsWallet(null);
      clearSiwsSession();
    } finally {
      // Let Privy's `authenticated`/wallets state propagate before re-enabling the
      // bridge, so a late re-render can't reconnect a just-dropped wallet.
      setTimeout(endSignOut, 1500);
    }
  }, [disconnect, privyWallets, signOut]);
}

/**
 * Mounts useSiwsSession() so its ensureSiwsSession() is registered with the fetch
 * interceptor (for the siws_required 401 retry), and restores any stored SIWS
 * session into the in-memory mirror the moment the active wallet resolves — so the
 * interceptor can attach X-Siws-Session without a fresh signature after a reload.
 */
function SiwsSessionBridge() {
  // Registers ensureSiwsSession() with the interceptor bridge (side effect).
  const { ensureSiwsSession } = useSiwsSession();
  const { publicKey } = useUnifiedSolanaWallet();
  useEffect(() => {
    const wallet = publicKey?.toBase58() ?? null;
    // Record the active spending wallet so the fetch interceptor can attach a SIWS
    // session minted for THIS wallet even when the adapter identity
    // (getCurrentWalletAddress) resolves to a different/stale wallet — the mint
    // 401 siws_required loop root cause. Set on every change (incl. null on
    // disconnect) so the token is never attached for a wallet we're no longer using.
    setActiveSiwsWallet(wallet);
    if (!wallet) return;
    // Restore this wallet's stored session, or CLEAR the in-memory mirror when none
    // exists — so a token minted for a PREVIOUS wallet (multi-wallet Privy account)
    // is never left bound and attached to this wallet's API calls. Leaving it bound
    // made campaign finalize 403 (provenWallet=old ≠ creatorWallet=active) with no
    // self-heal (403, not the siws_required 401 the interceptor re-mints on). After
    // the clear, the next API call 401s siws_required and the interceptor re-mints
    // for the active wallet.
    if (!restoreSiwsSession(wallet)) clearSiwsSession();
    // Mint (or renew) the session in the background the moment the wallet resolves,
    // popup-free for Privy-linked wallets, so the first money/agent action never waits
    // on (or shows) a wallet-signature prompt. Re-check every 5 minutes and renew when
    // it has under 30 minutes left, so a long session never lapses mid-task.
    const renew = () => {
      const exp = getCurrentSiwsExp();
      if (exp && exp - Date.now() > 30 * 60_000) return;
      void ensureSiwsSession({ silent: true, force: true }).catch(() => undefined);
    };
    if (!hasValidSiwsSession(wallet)) void ensureSiwsSession({ silent: true }).catch(() => undefined);
    else renew();
    const timer = setInterval(renew, 5 * 60_000);
    return () => clearInterval(timer);
  }, [publicKey, ensureSiwsSession]);
  return null;
}

/**
 * Registers Privy's Solana funding plugin. `useFundWallet()` (the native fiat/card
 * on-ramp used by /wallet's Add-funds button and the campaign-form auto-fund) can
 * only build/simulate the funding transaction once this plugin is mounted once
 * inside PrivyProvider. Renders nothing.
 */
function SolanaFundingPluginMount() {
  useSolanaFundingPlugin();
  return null;
}

/** Mirrors the connected wallet address into the module bridge so the auth
 *  provider's fetch interceptor (which lives above this provider) can read it. */
function WalletIdentitySync() {
  const { publicKey } = useWallet();
  useEffect(() => {
    if (publicKey) setCurrentWalletAddress(publicKey.toBase58());
  }, [publicKey]);
  return null;
}

export function SolanaWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Empty on purpose. Phantom/Solflare/Backpack register themselves as Standard
  // Wallets, and @solana/wallet-adapter-react auto-detects those — it even warns
  // "The Wallet Adapter for X can be removed" if you pass the legacy adapters too.
  // Passing the legacy PhantomWalletAdapter/SolflareWalletAdapter created a SECOND
  // manager for the same wallet, which fought Privy's connector (Privy talks to the
  // Standard Wallet). Solflare especially returned 0 accounts to Privy in that race
  // → "Could not log in with wallet". Letting Privy own the connection fixes it; the
  // bridge below still finds the auto-detected Standard adapters for signing.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      {/* autoConnect is OFF on purpose: Privy owns the initial wallet connection
          (connect + Sign-In-With-Solana). If wallet-adapter auto-grabbed Phantom
          first, Privy's login would fail silently ("Could not log in with wallet",
          no popup). After Privy connects, PrivyWalletBridge mirrors the session
          into wallet-adapter (silently) so signing/UI keep working. */}
      <WalletProvider wallets={wallets} autoConnect={false}>
        {PRIVY_ENABLED ? (
          <PrivyWalletModalShim>
            <WalletIdentitySync />
            <PrivyWalletBridge />
            <SiwsSessionBridge />
            <SolanaFundingPluginMount />
            {children}
          </PrivyWalletModalShim>
        ) : (
          // No Privy configured — use the stock wallet-adapter modal. Nothing here
          // touches Privy hooks, so prerender/build can't crash.
          <WalletModalProvider>
            <WalletIdentitySync />
            {children}
          </WalletModalProvider>
        )}
      </WalletProvider>
    </ConnectionProvider>
  );
}
