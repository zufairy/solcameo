"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Wallet } from "lucide-react";
import { fetchWalletBalances } from "@/lib/solana/fundWallet";

export function AgentWalletBalance({ address }: { address?: string }) {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<{ address: string; sol: number; usdc: number } | null>(null);
  useEffect(() => {
    if (!address) return;
    let live = true;
    const refresh = async () => {
      try {
        const funds = await fetchWalletBalances(connection, new PublicKey(address));
        if (live) setBalance({ address, ...funds });
      } catch { if (live) setBalance(null); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [address, connection]);
  const current = balance?.address === address ? balance : null;
  return (
    <div title={address || "Agent wallet is provisioning"} className="relative flex h-9 items-center gap-2.5 overflow-hidden rounded-lg border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] pl-2 pr-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_22px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.12] to-transparent" />
      <span className="relative grid size-6 place-items-center rounded-md bg-white/10 ring-1 ring-white/15"><Wallet className="size-3.5 text-white/80" /></span>
      <div className="relative leading-none">
        <span className="block text-[9px] font-medium uppercase tracking-[0.14em] text-white/45">Agent wallet</span>
        <span className="mt-1 block text-[12px] font-semibold tabular-nums">{current ? `${current.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC` : address ? "Balance unavailable" : "Provisioning…"}</span>
      </div>
      {current && <span className="relative hidden border-l border-white/10 pl-2.5 text-[11px] tabular-nums text-white/55 md:inline">{current.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL</span>}
    </div>
  );
}
