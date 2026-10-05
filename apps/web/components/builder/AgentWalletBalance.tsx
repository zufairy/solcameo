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
    <div title={address || "Agent wallet is provisioning"} className="flex items-center gap-2.5 rounded-xl border border-white/20 bg-white/[0.08] px-3 py-1.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-xl">
      <Wallet className="size-4 text-white/60" />
      <div className="leading-tight">
        <span className="block text-[9px] font-medium uppercase tracking-[0.12em] text-white/45">Agent wallet</span>
        <span className="text-[12px] font-semibold tabular-nums">{current ? `${current.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC` : address ? "Balance unavailable" : "Provisioning…"}</span>
      </div>
      {current && <span className="hidden text-[11px] tabular-nums text-white/50 md:inline">{current.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL</span>}
    </div>
  );
}
