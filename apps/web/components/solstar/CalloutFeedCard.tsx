"use client";
import { formatTradeSol } from "@/lib/solstar/calloutTrade";
/* eslint-disable @next/next/no-img-element -- hosted character portraits */
import { calloutStyle } from "@/lib/solstar/calloutStyle";
import { useState } from "react";
import { CalloutVisual } from "./CalloutVisual";
import type { CalloutCardData } from "@/lib/client/calloutCard";
import { compact } from "@/lib/client/calloutCard";
import { calloutTheme, formatCalloutMoney } from "@/lib/solstar/callout";

/** A dedicated 500 × 100 feed face. The social export keeps its full 16:9 scene. */
export function CalloutFeedCard({ data, bare = false }: { data: CalloutCardData; bare?: boolean }) {
  const [ready, setReady] = useState(false);
  const theme = calloutTheme(data.theme), metric = data.metric ?? "earnings";
  const value = metric === "views" ? data.views == null ? "—" : compact(data.views) : data.onchainTrade ? formatTradeSol(data.onchainTrade.pnlSol) : formatCalloutMoney(metric === "trade" ? data.tradePnlUsd : data.earningsUsd);
  const style = calloutStyle(data.theme);
  const negative = metric === "trade" && (data.onchainTrade?.pnlSol ?? data.tradePnlUsd ?? 0) < 0;
  return <div aria-label={`${data.name}, ${data.ticker}, ${value}, ${metric}`} className={`relative isolate flex h-[100px] w-[500px] items-center gap-2.5 overflow-hidden px-3 text-white ${bare ? "" : "max-w-full rounded-[3px] border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_6px_18px_-12px_rgba(0,0,0,0.6)]"}`} style={{ borderRadius: bare ? 0 : 3, background: `radial-gradient(ellipse at 100% 0%, ${theme.accent}20, transparent 65%), ${theme.background}` }}>
    <CalloutVisual compact data={data} onReady={setReady} />
    <img src={data.imageUrl || "/brand/solcameo-mark.png"} alt="" loading="lazy" className={`relative z-10 h-12 w-10 shrink-0 ${data.unselectedPreview ? "object-contain" : "rounded-[2px] bg-white/[0.035] object-contain ring-1 ring-white/15"}`} />
    <div className="relative z-10 min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5"><span className="truncate text-[12px]" style={{ fontFamily: style.family, fontWeight: style.weight, fontStyle: style.italic ? "italic" : "normal", letterSpacing: style.tracking / 5 }}>{data.name}</span><span className="rounded-[1px] bg-white px-1 py-0.5 text-[8px] font-bold leading-none text-black">{data.trader && !data.ticker ? "TRADER" : `$${data.ticker.toUpperCase()}`}</span></div>
      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-white/50">{data.body}</p>
      <p className="mt-1 text-[8px] uppercase tracking-[0.14em] text-white/40">Solcameo</p>
    </div>
    <div className="relative z-10 flex h-[76px] w-[40%] max-w-[190px] shrink-0 flex-col items-center justify-center rounded-[2px] border border-white/[0.06] bg-white/[0.03] px-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className="text-[8px] font-medium uppercase tracking-wider text-white/50">{metric === "views" ? "Tracked views" : metric === "trade" ? (data.onchainTrade || (data.trader && data.unselectedPreview)) ? "Position P&L · SOL" : "Trade P&L · USD" : "Earned · USD"}</p>
      <p className={`my-1 h-[26px] w-full whitespace-nowrap text-[20px] font-semibold leading-none tracking-tight tabular-nums ${ready ? "opacity-0" : ""}`} style={{ color: negative ? "#fb7185" : theme.accent }}>{value}</p>
      <p className="text-[9px] tabular-nums text-white/45">{metric === "views" ? `${data.videos ?? "—"} videos` : metric === "trade" ? data.onchainTrade ? `On-chain · ${data.onchainTrade.network}` : data.trader && data.unselectedPreview ? "Select a coin" : "User reported" : `${formatCalloutMoney(data.monthlyEarningsUsd)} / 30d`}</p>
    </div>
  </div>;
}
