"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { ExternalLink, Plus, RefreshCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { FundAgentDialog } from "@/components/builder/FundAgentDialog";
import { useSolUsd } from "@/lib/client/useSolUsd";

type Balance = { sol: number; usdc: number };
const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Carousel page: the agent's real wallet. Balances are read from the chain (SOL and USDC), the same wallet the builder
 * shows and the one generations are paid from. Funding opens the deposit dialog, which can send USDC, SOL, or swap SOL into USDC.
 */
export function AgentFundSlide({ mint, name }: { mint?: string; name: string }) {
  const agent = useQuery(api.influencers.getByMint, mint ? { mintAddress: mint } : "skip");
  const account = useQuery(api.agentAccount.getWithNav, mint ? { mintAddress: mint } : "skip");
  const solUsd = useSolUsd();
  const wallet = agent?.agentWallet as string | undefined;
  const [balance, setBalance] = useState<Balance | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async (fresh = false) => {
    if (!wallet) return;
    try {
      const res = await fetch(`/api/agent-wallet-balance?wallet=${encodeURIComponent(wallet)}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; sol?: number; usdc?: number };
      if (!data.ok) throw new Error("unavailable");
      setBalance({ sol: data.sol ?? 0, usdc: data.usdc ?? 0 }); setFailed(false);
    } catch { setFailed(true); }
  }, [wallet]);
  useEffect(() => {
    if (!wallet) return;
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    const onFunded = () => { void load(true); setTimeout(() => void load(true), 4000); };
    window.addEventListener("solcameo:trade-confirmed", onFunded);
    return () => { clearInterval(timer); window.removeEventListener("solcameo:trade-confirmed", onFunded); };
  }, [wallet, load]);

  const tab = account?.unsettledTabUsdc ?? 0;
  const solValue = balance && solUsd != null ? balance.sol * solUsd : null;
  const total = balance ? balance.usdc + (solValue ?? 0) : null;

  return (
    <div className="flex h-full flex-col justify-center gap-2.5 px-4 py-2">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] text-zinc-500">{name}’s wallet · on-chain</p>
          <p className="font-sans text-[26px] font-semibold leading-none tracking-tight tabular-nums text-white">{total != null ? usd(total) : failed ? "Unavailable" : "—"}</p>
          <p className="mt-1 text-[10px] tabular-nums text-zinc-500">
            {balance ? `${usd(balance.usdc)} USDC · ${balance.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL${solValue != null ? ` (${usd(solValue)})` : ""}` : failed ? "Could not read the chain. Retrying…" : "Reading the chain…"}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(true)} disabled={!wallet}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-[12.5px] font-semibold text-black transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30">
          <Plus className="size-3.5" strokeWidth={3} /> Fund
        </button>
      </div>
      <div className="flex items-center justify-between text-[10.5px] text-zinc-600">
        <span className="tabular-nums">{tab > 0 ? `Tally: ${usd(tab)} owed, settles on-chain shortly` : "Tally: nothing owed"}</span>
        <span className="flex items-center gap-2">
          <button type="button" onClick={() => void load(true)} aria-label="Refresh balance" className="text-zinc-500 hover:text-white"><RefreshCw className="size-3" /></button>
          {wallet && <a href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noreferrer" aria-label="View wallet on Solscan" className="text-zinc-500 hover:text-white"><ExternalLink className="size-3" /></a>}
        </span>
      </div>
      <FundAgentDialog open={open} onOpenChange={setOpen} agentWallet={wallet} agentName={name} />
    </div>
  );
}
