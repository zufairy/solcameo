"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery } from "convex/react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { LiveValue } from "./MarketTable";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";

type Quote = { available: boolean; capSol: number | null; changeSinceLaunchPct?: number | null };
/** Shared coin tape with live RPC values and movement indicators. */
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
  return <section aria-label="Live market ticker" className="flex h-14 min-w-0 items-center gap-8 overflow-x-auto border-y border-white/10 bg-[#0b0c0e] px-5 text-sm">
    {rows === undefined ? <span className="text-zinc-600">Connecting to market…</span> : !rows.length ? <span className="text-zinc-600">Waiting for the first confirmed launch</span> : rows.slice(0,12).map(row => {
      const quote = quotes[row.characterId];
      const change = quote?.available ? quote.changeSinceLaunchPct : null;
      return <Link key={row.characterId} href={`/market/${row.characterId}`} className="group flex shrink-0 items-center gap-2.5 font-sans text-xl font-medium tracking-tight tabular-nums text-zinc-300 transition-colors hover:text-white">
        <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 text-xs font-semibold text-zinc-400">
          {row.imageUrl ? <Image src={row.imageUrl} alt="" width={32} height={32} unoptimized className="size-full object-cover" /> : row.ticker.slice(0, 1)}
        </span>
        <span className="uppercase">{row.ticker}</span>
        {quote?.available && quote.capSol != null ? <LiveValue value={String(Math.round(quote.capSol*1e9))} display={formatUsdEstimate(String(Math.round(quote.capSol*1e9)), usd)} /> : <span className="text-zinc-600">—</span>}
        {change != null && <span className={`flex items-center gap-0.5 text-xs ${change >= 0 ? "text-[#d7ff00]" : "text-red-400"}`} title="Change since launch">{change >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(change).toFixed(2)}%</span>}
      </Link>;
    })}
  </section>;
}
