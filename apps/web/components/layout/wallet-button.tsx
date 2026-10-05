"use client";

import { legacyUiEnabled } from "@/lib/flags";
import { useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets as usePrivySolanaWallets } from "@privy-io/react-auth/solana";
import { PublicKey } from "@solana/web3.js";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import flashAvatar from "@/assets/flash.jpeg";
import { ChevronDown, Copy, LogOut, ExternalLink, Wallet, Sparkles, Swords, CreditCard } from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useFullSignOut } from "@/providers/wallet-provider";
import { PRIVY_ENABLED } from "@/lib/privy";
import { selectActiveWallet, isEmbeddedWallet, getLoginWalletAddress } from "@/lib/solana/activeWallet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The Arena button shows in the header on every page EXCEPT the index (home) and
// the builder — where the header itself is hidden and the surface is focused.
const SHOW_ARENA_BUTTON = true;

function PointsButton() {
  const pathname = usePathname();
  if (!SHOW_ARENA_BUTTON || !legacyUiEnabled()) return null;
  // Explicitly hidden on the index and builder pages (belt-and-suspenders — the
  // header is already hidden there, but this keeps the rule correct regardless).
  if (pathname === "/" || pathname.startsWith("/builder")) return null;
  return (
    <Link
      href="/arena"
      aria-label="Open the Arena — top-earning agents leaderboard"
      className="relative block shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-transform hover:-translate-y-px"
      // The conic gradient is the element's OWN background (the 1.5px padding shows
      // it as a full, even border). No overflow-hidden, so nothing clips the ring,
      // and an outer box-shadow halo makes the whole thing illuminate outward.
      style={{
        padding: "1.5px",
        background: "conic-gradient(from var(--pts-angle, 0deg), #365314, #84cc16, #a3e635, #f7fee7, #84cc16, #365314)",
        animation: "pts-spin 2s linear infinite",
        boxShadow: "0 0 10px 0 rgba(132,204,22,0.50), 0 0 20px 0 rgba(132,204,22,0.22)",
      }}
    >
      <style>{`
        @property --pts-angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
        @keyframes pts-spin { to { --pts-angle: 360deg; } }
        @keyframes pts-glow { 0%,100% { opacity: 0.7; } 50% { opacity: 1; } }
      `}</style>

      {/* Inner — dark bg so the gradient padding reads as an even outline */}
      <div
        className="relative flex items-center gap-1.5 rounded-[6.5px] px-3 py-[5px]"
        style={{ background: "#0e0e10" }}
      >
        {/* Subtle inner gold glow */}
        <span
          className="absolute inset-0 rounded-[6px] pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 50% 120%, rgba(132,204,22,0.20) 0%, transparent 70%)",
            animation: "pts-glow 2s ease-in-out infinite",
          }}
        />
        <span
          className="relative text-[12.5px] font-bold tracking-wide"
          style={{ background: "linear-gradient(90deg, #a3e635, #84cc16)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
        >
          Arena
        </span>
        <Swords
          className="relative size-3.5"
          aria-hidden
          style={{ color: "#a3e635" }}
        />
      </div>
    </Link>
  );
}

/** Presentational connected-wallet pill + dropdown, shared by both variants. */
function ConnectedPill({
  address,
  balance,
  label,
  onDisconnect,
  disconnectLabel,
}: {
  address: string;
  balance: number | null;
  label: string;
  onDisconnect: () => void;
  disconnectLabel: string;
}) {
  const router = useRouter();
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
  const balanceStr = balance === null ? "···" : `${balance.toFixed(4)} SOL`;

  return (
    <div className="flex items-center gap-2">
      <PointsButton />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button className="flex items-center gap-2.5 h-9 pl-1.5 pr-2.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer">
              <div className="h-6 w-6 rounded-full bg-zinc-700 overflow-hidden shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={flashAvatar.src} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex flex-col items-start leading-none">
                <span className="text-[13px] font-bold text-white tabular-nums">{balanceStr}</span>
                <span className="text-[10.5px] text-zinc-500 font-mono mt-0.5">{short}</span>
              </div>
              <ChevronDown className="size-3.5 text-zinc-500 shrink-0" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-52 max-w-[calc(100vw-1.5rem)]">
          <div className="px-2 py-1.5">
            <p className="text-[11px] text-zinc-500 mb-0.5">{label}</p>
            <p className="text-xs font-mono text-zinc-300 truncate">{short}</p>
            {balance !== null && (
              <p className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">{balance.toFixed(6)} SOL</p>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/studio")}>
            <Sparkles className="size-3.5 mr-2 text-white" />
            My Agents
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/wallet")}>
            <Wallet className="size-3.5 mr-2 text-zinc-400" />
            Wallet
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/billing")}>
            <CreditCard className="size-3.5 mr-2 text-zinc-400" />
            Billing & credits
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigator.clipboard.writeText(address)}>
            <Copy className="size-3.5 mr-2 text-zinc-400" />
            Copy address
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open(`https://explorer.solana.com/address/${address}?cluster=devnet`, "_blank")}>
            <ExternalLink className="size-3.5 mr-2 text-zinc-400" />
            View on Explorer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-red-400 focus:text-red-400" onClick={onDisconnect}>
            <LogOut className="size-3.5 mr-2" />
            {disconnectLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ConnectButton({ onClick, label = "Connect wallet" }: { onClick: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={onClick}
        className="flex h-8 items-center gap-2 rounded-md border border-white/15 bg-[#d7ff00] px-4 text-xs font-semibold text-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] transition-colors hover:bg-[#e3ff5c]"
      >
        <Wallet className="size-4" />
        {label}
      </Button>
    </div>
  );
}

/** Shared live-balance hook for a given address. */
export function useSolBalance(address: string | null): number | null {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<number | null>(null);
  const pubkey = useMemo(() => {
    if (!address) return null;
    try { return new PublicKey(address); } catch { return null; }
  }, [address]);
  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    const load = () => {
      connection.getBalance(pubkey, "confirmed")
        .then((lamports) => { if (!cancelled) setBalance(lamports / 1e9); })
        .catch(() => { /* keep last value on transient RPC error */ });
    };
    load();
    const subscription = connection.onAccountChange(pubkey, info => { if (!cancelled) setBalance(info.lamports / 1e9); }, "confirmed");
    window.addEventListener("solcameo:trade-confirmed", load);
    const id = setInterval(load, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      void connection.removeAccountChangeListener(subscription);
      window.removeEventListener("solcameo:trade-confirmed", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pubkey, connection]);
  return pubkey ? balance : null;
}

/**
 * Privy-aware header wallet. Active wallet = wallet-adapter external wallet, else
 * the Privy Solana wallet (embedded auto-created on Google login, or external).
 * After a Google login that mints an embedded wallet, this shows the wallet +
 * balance instead of "Connect Wallet". Only rendered when Privy is configured.
 */
function PrivyWalletButton({ showConnect = false }: { showConnect?: boolean }) {
  const { publicKey, connecting } = useWallet();
  const { authenticated, user } = usePrivy();
  const { wallets: privyWallets } = usePrivySolanaWallets();
  const { loginError, signInWithGoogle } = useSupabaseAuth();
  const fullSignOut = useFullSignOut();

  const adapterAddress = publicKey?.toBase58() ?? null;
  // Show the wallet the user logged in with — the SAME one the builder/invest
  // flows spend from — by matching the login address against the Privy wallets.
  const loginAddress = getLoginWalletAddress(user);
  const privyWallet = selectActiveWallet(
    privyWallets as Array<{ address?: string; walletClientType?: string }> | undefined,
    loginAddress,
  ) ?? undefined;
  const privyAddress = privyWallet?.address ?? null;
  // Privy OWNS the login, so its wallet is the source of truth for *which* account
  // is connected. The wallet-adapter `publicKey` is only a mirror and can lag behind
  // on the PREVIOUS wallet after a re-login (the bridge won't re-grab while it still
  // reports `connected`), which made the pill show the old account. Prefer Privy and
  // fall back to the adapter only when there's no Privy wallet.
  // Gate on `authenticated`: after logout an external wallet can linger connected
  // to the page (wallet-standard level), so without this gate the pill would never
  // disappear. No Privy session → show "Connect Wallet", whatever wallets report.
  const address = authenticated ? (privyAddress ?? adapterAddress) : null;
  const isEmbedded = !!privyWallet && isEmbeddedWallet(privyWallet);
  const balance = useSolBalance(address);

  // When the user signed in with Google, the AccountButton owns the single
  // combined profile dropdown (wallet + SOL balance live there). Render only the
  // Arena button here so the header shows ONE dropdown, not two.
  const hasGoogleIdentity = useMemo(() => {
    const accts = (user?.linkedAccounts ?? []) as Array<{ type?: string }>;
    return accts.some((a) => a.type === "google_oauth" || a.type === "email");
  }, [user]);

  if (authenticated && hasGoogleIdentity) {
    return (
      <div className="flex items-center gap-2">
        <PointsButton />
      </div>
    );
  }

  if (connecting && !address) {
    return (
      <div className="flex items-center gap-2">
        <PointsButton />
        <div className="flex items-center gap-2 h-9 px-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 text-[13px] animate-pulse">
          <Wallet className="size-4" /> Connecting…
        </div>
      </div>
    );
  }

  if (address) {
    return (
      <ConnectedPill
        address={address}
        balance={balance}
        label={isEmbedded ? "Your wallet" : "Connected wallet"}
        onDisconnect={fullSignOut}
        disconnectLabel="Sign out"
      />
    );
  }

  // Surface the REAL Privy failure (set by useLogin's onError) so a failed wallet
  // login shows the concrete reason instead of just Privy's "retry" screen.
  const showError = loginError && loginError !== "exited_auth_flow";
  // The "Connect Wallet" pill is intentionally HIDDEN — sign-in happens via the
  // Sign In button (AccountButton). Only the Arena button shows here when there's
  // no connected wallet, keeping the header clean.
  return (
    <div className="relative">
      {showConnect ? (
        // Shell variant: the same Privy login the Sign In button opens, labelled for web3.
        <ConnectButton onClick={() => signInWithGoogle()} />
      ) : (
        <div className="flex items-center gap-2">
          <PointsButton />
        </div>
      )}
      {showError && (
        <p className="absolute right-0 mt-1 w-64 text-[11px] text-amber-400 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 z-50">
          Login failed: <span className="font-mono">{loginError}</span>
        </p>
      )}
    </div>
  );
}

/** Plain wallet-adapter button — used when Privy isn't configured (build safety). */
function LegacyWalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const address = publicKey?.toBase58() ?? null;
  const balance = useSolBalance(address);

  if (connecting) {
    return (
      <div className="flex items-center gap-2">
        <PointsButton />
        <div className="flex items-center gap-2 h-9 px-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 text-[13px] animate-pulse">
          <Wallet className="size-4" /> Connecting…
        </div>
      </div>
    );
  }
  if (address) {
    return (
      <ConnectedPill
        address={address}
        balance={balance}
        label="Connected wallet"
        onDisconnect={() => disconnect()}
        disconnectLabel="Disconnect"
      />
    );
  }
  return <ConnectButton onClick={() => setVisible(true)} />;
}

/** `showConnect` renders a "Connect wallet" button when signed out (used by the global shell). */
export function WalletButton({ showConnect = false }: { showConnect?: boolean } = {}) {
  return PRIVY_ENABLED ? <PrivyWalletButton showConnect={showConnect} /> : <LegacyWalletButton />;
}
