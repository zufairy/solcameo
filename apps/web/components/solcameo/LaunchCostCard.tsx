"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { formatSol, type CostItem } from "@/lib/meteora/launchCost";

type Cost = { items: CostItem[]; subtotalLamports: number; recommendedLamports: number; balanceLamports: number | null };

const sol = (lamports: number) => (lamports / 1e9).toFixed(4);

/** What the creator pays to launch, itemised, with their live wallet balance, shown above "Before you launch". */
export function LaunchCostCard() {
  const { publicKey } = useUnifiedSolanaWallet();
  const address = publicKey?.toBase58();
  const [cost, setCost] = useState<Cost | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/meteora/launch-cost${address ? `?wallet=${encodeURIComponent(address)}` : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error("unavailable");
        const data = (await res.json()) as Cost;
        if (active) { setCost(data); setFailed(false); }
      } catch { if (active) setFailed(true); }
    };
    void load();
    const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [address]);

  const balance = cost?.balanceLamports ?? null;
  const short = cost && balance !== null ? Math.max(0, cost.recommendedLamports - balance) : 0;
  const ready = !!cost && balance !== null && balance >= cost.recommendedLamports;

  return (
    <section aria-label="Launch cost" className="rounded-none border-2 border-black bg-white p-4 text-black shadow-[5px_5px_0_0_#d7ff00,5px_5px_0_2px_#000]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-black uppercase tracking-tight"><span aria-hidden className="mr-1.5">🧾</span>What you&apos;ll pay</p>
          <p className="mt-1 text-[12.5px] font-medium leading-5 text-black/70">One-time on-chain costs paid to Solana for the accounts that hold your coin. Solcameo takes no launch fee.</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-black/55">Total</p>
          <p className="text-xl font-black tabular-nums leading-none">{cost ? `≈ ${sol(cost.subtotalLamports)}` : "···"}<span className="ml-1 text-xs font-bold">SOL</span></p>
        </div>
      </div>

      <ul className="mt-3 divide-y-2 divide-black/10 border-y-2 border-black">
        {(cost?.items ?? []).map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="min-w-0"><span className="text-[13px] font-bold">{item.label}</span><span className="ml-2 hidden text-[11.5px] font-medium text-black/50 sm:inline">{item.note}</span></span>
            <span className="shrink-0 font-mono text-[12.5px] font-bold tabular-nums">{sol(item.lamports)}</span>
          </li>
        ))}
        {!cost && <li className="py-3 text-[12.5px] font-medium text-black/55">{failed ? "Could not load the cost breakdown. Retrying…" : "Reading live costs from Solana…"}</li>}
      </ul>

      <div className={`mt-3 flex items-center gap-2.5 border-2 border-black px-3 py-2 text-[12.5px] font-bold ${ready ? "bg-[#d7ff00]" : "bg-white"}`}>
        <span aria-hidden className="text-base leading-none">{ready ? "✅" : "⚠️"}</span>
        <span className="min-w-0 flex-1">
          {!address ? "Connect your wallet to check your balance."
            : balance === null ? "Checking your wallet balance…"
            : ready ? <>Your wallet has {sol(balance)} SOL. You&apos;re ready to launch.</>
            : <>Have at least {cost ? formatSol(cost.recommendedLamports) : "0.03"} SOL ready. Your wallet has {sol(balance)}; add {sol(short)} more first.</>}
        </span>
        {ready && <Check className="size-4 shrink-0" strokeWidth={3} />}
      </div>
      <p className="mt-2 text-[11.5px] font-medium leading-4 text-black/55">Includes a small safety buffer. If a launch is interrupted, press Launch again and it resumes without paying twice.</p>
    </section>
  );
}
