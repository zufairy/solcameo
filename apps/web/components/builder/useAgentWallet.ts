"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getUsdcMint } from "@/lib/solana/network";


export type AgentFunds = { address: string; sol: number; usdc: number };

/**
 * The agent's own wallet (a keypair we create for every agent, so it can receive x402 payments and earn),
 * with live balances. Agents minted before wallets existed get theirs provisioned once, instead of hanging.
 * `ready` is false while the agent record is still loading, so an existing wallet is never "re-created".
 */
export function useAgentWallet({ address, mintAddress, ready = true }: { address?: string; mintAddress?: string; ready?: boolean }) {
  const { connection } = useConnection();
  const [provisioned, setProvisioned] = useState<{ mint: string; address: string } | null>(null);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [error, setError] = useState("");
  const attempted = useRef<string | null>(null);
  const [funds, setFunds] = useState<AgentFunds | null>(null);
  const wallet = address ?? (provisioned && provisioned.mint === mintAddress ? provisioned.address : undefined);

  const provision = useCallback(async () => {
    if (!mintAddress) return;
    setState("working");
    try {
      const res = await fetch("/api/nft/backfill-wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; agentWallet?: string; error?: string };
      if (!res.ok || !data.ok || !data.agentWallet) throw new Error(data.error ?? `Request failed (${res.status})`);
      setProvisioned({ mint: mintAddress, address: data.agentWallet });
      setError("");
      setState("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet setup failed");
      setState("failed");
    }
  }, [mintAddress]);

  useEffect(() => {
    if (!ready || wallet || !mintAddress || attempted.current === mintAddress) return;
    attempted.current = mintAddress;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off the one-time provisioning request
    void provision();
  }, [ready, wallet, mintAddress, provision]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    let busy = false;
    let queued = false;
    const refresh = async () => {
      if (busy) { queued = true; return; }
      queued = false;
      busy = true;
      setRefreshing(true);
      try {
        const response = await fetch(`/api/agent-wallet-balance?wallet=${encodeURIComponent(wallet)}&fresh=1`, { cache: "no-store" });
        const next = await response.json() as { ok?: boolean; sol?: number; usdc?: number };
        if (!response.ok || !next.ok || typeof next.sol !== "number" || typeof next.usdc !== "number") throw new Error("Balance unavailable");
        if (live) setFunds({ address: wallet, sol: next.sol, usdc: next.usdc });
      } catch { /* keep the last good balance; the poll below retries */ }
      finally {
        busy = false;
        if (live) { setRefreshing(false); if (queued) void refresh(); }
      }
    };
    refreshRef.current = refresh;
    void refresh();
    // Live: any change to the wallet's SOL or USDC account on chain refreshes the balance right away.
    const owner = new PublicKey(wallet);
    const subs: number[] = [];
    try { subs.push(connection.onAccountChange(owner, () => void refresh(), "confirmed")); } catch { /* polling covers it */ }
    void getAssociatedTokenAddress(new PublicKey(getUsdcMint()), owner)
      .then((ata) => { if (live) { try { subs.push(connection.onAccountChange(ata, () => void refresh(), "confirmed")); } catch { /* polling covers it */ } } })
      .catch(() => undefined);
    const timer = setInterval(() => void refresh(), 5_000);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("solcameo:trade-confirmed", refresh);
      for (const id of subs) void connection.removeAccountChangeListener(id).catch(() => undefined);
    };
  }, [wallet, connection]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return {
    wallet,
    funds: funds?.address === wallet ? funds : null,
    setupFailed: !wallet && state === "failed",
    settingUp: !wallet && state !== "failed",
    error,
    retry: provision,
    refreshing,
    refresh,
  };
}
