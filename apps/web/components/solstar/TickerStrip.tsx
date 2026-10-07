"use client";
import { LIVE_NETWORK } from "@/lib/solstar/liveNetwork";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery } from "convex/react";
import { ArrowDownRight, ArrowUpRight, Star, Flame } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { LiveValue } from "./MarketTable";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";
import { useMarketWatchlist } from "./market-watchlist";
import { marketPath } from "@/lib/solstar/marketSlug";

type Quote = { available: boolean; capSol: number | null; changeSinceLaunchPct?: number | null };
/** Shared coin tape with live RPC values and movement indicators. */
export function TickerStrip() {
  const usd = useSolUsd();
  const rows = useQuery(api.solstarMarket.listMarket, { network: LIVE_NETWORK, liveOnly: true, sort: "volume" });
  const [mode, setMode] = useState<"trending" | "watchlist">("trending");
  const watch = useMarketWatchlist();
  const shown = rows === undefined ? undefined : (mode === "watchlist" ? rows.filter(r => watch.ids.includes(r.characterId)) : rows).slice(0, 12);
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
  const tabs = [["trending", Flame, "Trending"], ["watchlist", Star, "Watchlist"]] as const;
  const item = (row: NonNullable<typeof shown>[number], key: string, hidden = false) => {
    const quote = quotes[row.characterId];
    const change = quote?.available ? quote.changeSinceLaunchPct : null;
    return <Link key={key} href={marketPath(row)} aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined} className="group flex shrink-0 items-center gap-2 text-[13px] font-medium tracking-tight tabular-nums text-zinc-400 transition-colors hover:text-white">
      <span className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-white/5 text-[10px] font-semibold text-zinc-400 ring-1 ring-white/10 [clip-path:polygon(0_0,calc(100%-4px)_0,100%_4px,100%_100%,4px_100%,0_calc(100%-4px))]">
        {row.imageUrl ? <Image src={row.imageUrl} alt="" width={24} height={24} unoptimized className="size-full object-cover" /> : row.ticker.slice(0, 1)}
      </span>
      <span className="uppercase text-zinc-200">{row.ticker}</span>
      {quote?.available && quote.capSol != null ? <LiveValue value={String(Math.round(quote.capSol*1e9))} display={formatUsdEstimate(String(Math.round(quote.capSol*1e9)), usd)} /> : <span className="text-zinc-600">—</span>}
      {change != null && <span className={`flex items-center gap-0.5 text-[11px] ${change >= 0 ? "text-[#d7ff00]" : "text-red-400"}`} title="Change since launch">{change >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(change).toFixed(2)}%</span>}
    </Link>;
  };
  return <section aria-label="Live market ticker" className="ticker-bar flex h-10 min-w-0 items-stretch border-y border-white/[0.07]">
    <div role="tablist" aria-label="Ticker source" className="flex shrink-0 items-center gap-1 border-r border-white/[0.07] px-2">
      {tabs.map(([value, Icon, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} aria-label={label} title={label} onClick={() => setMode(value)} className={`grid size-7 place-items-center rounded-[3px] transition-colors ${mode === value ? "bg-white/10 text-white" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"}`}><Icon className={`size-4 ${mode === value && value === "watchlist" ? "fill-[#d7ff00] text-[#d7ff00]" : ""}`} strokeWidth={1.6} /></button>)}
    </div>
    <div className="group/tape relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_24px,#000_calc(100%-24px),transparent)]">
      {shown === undefined ? <span className="flex h-full items-center px-4 text-xs text-zinc-600">Connecting to market…</span> : !shown.length ? <span className="flex h-full items-center px-4 text-xs text-zinc-600">{mode === "watchlist" ? "Star a market to pin it here" : "Waiting for the first confirmed launch"}</span> :
        <div key={mode} className="vello-marquee flex h-full w-max items-center group-hover/tape:[animation-play-state:paused]" style={{ animationDuration: `${Math.max(24, shown.length * 7)}s` }}>
          {[0, 1].map(copy => <div key={copy} className="flex shrink-0 items-center gap-9 pr-9">{shown.map(row => item(row, `${copy}-${row.characterId}`, copy === 1))}</div>)}
        </div>}
    </div>
  </section>;
}
