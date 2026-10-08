"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { fundingReadiness } from "@/lib/explore/fundingReadiness";

type Funds = { sol: number; usdc: number };

/**
 * One line that says how this agent wallet will pay, before Generate is pressed: from USDC, from SOL (swapped for the
 * shortfall automatically, network fee included), or what is missing with a single Add funds button.
 */
export function AgentPayStatus({ wallet, mintAddress, priceUsd, onFund }: { wallet?: string | null; mintAddress?: string; priceUsd: number; onFund: () => void }) {
  const solUsd = useSolUsd();
  const account = useQuery(api.agentAccount.get, mintAddress ? { mintAddress } : "skip");
  const [funds, setFunds] = useState<Funds | null>(null);
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/agent-wallet-balance?wallet=${encodeURIComponent(wallet)}&fresh=1`, { cache: "no-store" });
        const data = (await res.json()) as { ok?: boolean; sol?: number; usdc?: number };
        if (live && data.ok) setFunds({ sol: data.sol ?? 0, usdc: data.usdc ?? 0 });
      } catch { /* keep the last figures */ }
    };
    void load();
    const timer = setInterval(() => void load(), 12_000);
    window.addEventListener("focus", load);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", load); };
  }, [wallet]);
  if (!wallet) return null;
  if (!funds) return <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-zinc-500"><Loader2 className="size-3 animate-spin" />Checking the wallet…</p>;
  // What the server will actually let this agent spend: on-chain USDC minus fees still waiting to be paid out.
  const spendable = account ? Math.max(0, account.escrowUsdc - Math.max(0, account.unsettledTabUsdc) - (account.generationReservedUsdc ?? 0)) : null;
  const waiting = account ? Math.max(0, funds.usdc - account.escrowUsdc) : 0;
  const usable = spendable === null ? funds.usdc : Math.min(funds.usdc, spendable);
  if (waiting >= 0.005 && funds.usdc >= priceUsd && usable < priceUsd) return (
    <p className="mt-3 flex items-start gap-1.5 rounded-[3px] border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[11.5px] text-amber-200"><AlertCircle className="mt-0.5 size-3.5 shrink-0" /><span>The wallet holds ${funds.usdc.toFixed(2)} USDC, but ${waiting.toFixed(2)} of it is waiting on earlier fees that need a network fee to settle. {funds.sol < 0.001 ? "Send about 0.005 SOL to this wallet to release it now. " : ""}It retries on its own every few minutes.</span></p>
  );
  const r = fundingReadiness({ priceUsd, usdc: usable, sol: funds.sol, solUsd });
  if (r.state === "ready") return <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-emerald-300"><CheckCircle2 className="size-3.5" />Wallet ready. Pays ${priceUsd.toFixed(2)} from its ${usable.toFixed(2)} USDC; the network fee is covered for you.</p>;
  if (r.state === "swap") return <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-emerald-300"><RefreshCw className="size-3.5" />Wallet ready. About {r.sol.toFixed(4)} SOL (${r.usd.toFixed(2)}) is swapped to USDC automatically at the best price, then it pays.</p>;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[3px] border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[11.5px] text-amber-200">
      <Wallet className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">Wallet is about ${r.needUsd.toFixed(2)} short. Add USDC <em>or</em> SOL, either works, and the rest is automatic.</span>
      <button type="button" onClick={onFund} className="rounded-[3px] bg-[#d7ff00] px-3 py-1 text-[11.5px] font-semibold text-black hover:bg-[#e4ff59]">Add funds</button>
    </div>
  );
}
