"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { LiveValue } from "./MarketTable";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";

type Quote = { available: boolean; capSol: number | null; changeSinceLaunchPct?: number | null };
/** Stock-tape layout: only confirmed devnet coins and actual RPC values. */
export function TickerStrip() {
  const usd = useSolUsd();
  const rows = useQuery(api.solstarMarket.listMarket, { network: "devnet", liveOnly: true, sort: "new" });
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy || !rows?.length || controller.signal.aborted) return;
      busy = true;
      try {
        for (let offset = 0; offset < Math.min(rows.length, 12); offset += 4) await Promise.allSettled(rows.slice(offset, offset+4).map(async row => {
          const response = await fetch(`/api/meteora/pool?characterId=${row.characterId}`, { signal: controller.signal });
          const quote: Quote = await response.json();
          if (!controller.signal.aborted) setQuotes(previous => ({ ...previous, [row.characterId]: quote }));
        }));
      } finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("solcameo:trade-confirmed", refresh); };
  }, [rows]);
  return <section aria-label="Live devnet market ticker" className="flex h-9 min-w-0 items-center gap-5 overflow-x-auto border-b border-white/[0.06] bg-transparent px-4 text-[11px]">
    <span className="flex shrink-0 items-center gap-2 text-zinc-500"><span className="size-1 rounded-full bg-[#d7ff00]" />DEVNET</span>
    {rows === undefined ? <span className="text-zinc-600">Connecting to market…</span> : !rows.length ? <span className="text-zinc-600">Waiting for the first confirmed devnet launch</span> : rows.slice(0,12).map(row => {
      const quote = quotes[row.characterId];
      const change = quote?.available ? quote.changeSinceLaunchPct : null;
      return <Link key={row.characterId} href={`/market/${row.characterId}`} className="flex shrink-0 items-center gap-2 border-r border-white/10 pr-5 font-mono tracking-tight tabular-nums transition-colors hover:text-white">
        <span className="font-sans text-xs font-semibold text-zinc-200">{row.ticker}</span><span className="text-[9px] text-zinc-500">MC USD</span>
        {quote?.available && quote.capSol != null ? <LiveValue value={String(Math.round(quote.capSol*1e9))} display={formatUsdEstimate(String(Math.round(quote.capSol*1e9)), usd)} /> : <span className="text-zinc-600">—</span>}
        {change != null && <span className={`flex items-center gap-1 ${change >= 0 ? "text-[#d7ff00]" : "text-red-400"}`} title="Change since launch">{change >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(change).toFixed(2)}%</span>}
      </Link>;
    })}
  </section>;
}
