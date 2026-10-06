"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getUsdcMint } from "@/lib/solana/network";
import { Loader2, RefreshCw, Wallet } from "lucide-react";
import { fetchWalletBalances } from "@/lib/solana/fundWallet";

/**
 * The agent's own wallet (a keypair we create for every agent, so it can receive x402 payments and earn).
 * Agents minted before wallets existed get theirs provisioned here, once, instead of hanging on "Provisioning…".
 */
export function AgentWalletBalance({ address, mintAddress, ready = true }: { address?: string; mintAddress?: string; /** False while the agent record is still loading, so a wallet that already exists is never "re-created". */ ready?: boolean }) {
  const { connection } = useConnection();
  const [provisioned, setProvisioned] = useState<{ mint: string; address: string } | null>(null);
  const [provisionState, setProvisionState] = useState<"idle" | "working" | "failed">("idle");
  const attempted = useRef<string | null>(null);
  const [provisionError, setProvisionError] = useState("");
  const [balance, setBalance] = useState<{ address: string; sol: number; usdc: number } | null>(null);
  const wallet = address ?? (provisioned && provisioned.mint === mintAddress ? provisioned.address : undefined);

  const provision = useCallback(async () => {
    if (!mintAddress) return;
    setProvisionState("working");
    try {
      const res = await fetch("/api/nft/backfill-wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; agentWallet?: string; error?: string };
      if (!res.ok || !data.ok || !data.agentWallet) throw new Error(data.error ?? `Request failed (${res.status})`);
      setProvisioned({ mint: mintAddress, address: data.agentWallet });
      setProvisionError("");
      setProvisionState("idle");
    } catch (e) {
      setProvisionError(e instanceof Error ? e.message : "Wallet setup failed");
      setProvisionState("failed");
    }
  }, [mintAddress]);

  useEffect(() => {
    if (!ready || wallet || !mintAddress || attempted.current === mintAddress) return;
    attempted.current = mintAddress;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off the one-time provisioning request
    void provision();
  }, [ready, wallet, mintAddress, provision]);

  useEffect(() => {
    if (!wallet) return;
    let live = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const funds = await fetchWalletBalances(connection, new PublicKey(wallet));
        if (live) setBalance({ address: wallet, ...funds });
      } catch { /* keep the last good balance; the poll below retries */ }
      finally { busy = false; }
    };
    void refresh();
    // Live: any change to the wallet's SOL or USDC account on chain refreshes the badge right away.
    const owner = new PublicKey(wallet);
    const subs: number[] = [];
    try { subs.push(connection.onAccountChange(owner, () => void refresh(), "confirmed")); } catch { /* polling covers it */ }
    void getAssociatedTokenAddress(new PublicKey(getUsdcMint()), owner)
      .then((ata) => { if (live) { try { subs.push(connection.onAccountChange(ata, () => void refresh(), "confirmed")); } catch { /* polling covers it */ } } })
      .catch(() => undefined);
    const timer = setInterval(() => void refresh(), 15_000);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("solcameo:trade-confirmed", refresh);
      for (const id of subs) void connection.removeAccountChangeListener(id).catch(() => undefined);
    };
  }, [wallet, connection]);

  const current = balance?.address === wallet ? balance : null;
  const failed = !wallet && provisionState === "failed";
  return (
    <div title={wallet || (failed ? `Wallet setup failed: ${provisionError}` : "Setting up the agent wallet")} className="relative flex h-9 items-center gap-2.5 overflow-hidden rounded-lg border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] pl-2 pr-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_22px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.12] to-transparent" />
      <span className="relative grid size-6 place-items-center rounded-md bg-white/10 ring-1 ring-white/15"><Wallet className="size-3.5 text-white/80" /></span>
      <div className="relative leading-none">
        <span className="block text-[9px] font-medium uppercase tracking-[0.14em] text-white/45">Wallet</span>
        <span className="mt-1 block text-[12px] font-semibold tabular-nums">
          {!ready && !wallet ? <span className="inline-block h-3 w-16 animate-pulse rounded bg-white/15 align-middle" /> : current
            ? `${current.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`
            : wallet
              ? "Balance unavailable"
              : failed
                ? "Setup failed"
                : <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" />Setting up</span>}
        </span>
      </div>
      {current && <span className="relative hidden border-l border-white/10 pl-2.5 text-[11px] tabular-nums text-white/55 md:inline">{current.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL</span>}
      {failed && (
        <button type="button" onClick={() => void provision()} aria-label="Retry wallet setup" title="Retry wallet setup" className="relative grid size-6 place-items-center rounded-md bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white">
          <RefreshCw className="size-3" />
        </button>
      )}
    </div>
  );
}
