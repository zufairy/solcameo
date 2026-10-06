"use client";
/* eslint-disable @next/next/no-img-element -- character portraits hosted on remote storage */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";
import { marketCapLamports } from "@/lib/solstar/market";
import { PAPER_VIRTUAL_TOKENS } from "@/lib/solstar/economics";
import { countOpen } from "@/components/solstar/OpenTrades";
import { useChainMarket } from "@/components/solstar/useChainMarket";
import { CountUp } from "@/components/tokenomics/CountUp";

const DAY = 86_400_000;
const INK = "#10130a";

/** Smooth line through the values, scaled into the box. A flat series is drawn through the middle. */
function linePath(values: number[], w: number, h: number, pad = 3) {
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo;
  const xy = values.map((v, i) => [
    pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2),
    span === 0 ? h / 2 : h - pad - ((v - lo) / span) * (h - pad * 2),
  ] as const);
  let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) {
    const [px, py] = xy[i - 1], [x, y] = xy[i], cx = (px + x) / 2;
    d += ` C${cx.toFixed(1)},${py.toFixed(1)} ${cx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  }
  const last = xy[xy.length - 1];
  return { d, last, area: `${d} L${last[0].toFixed(1)},${h} L${xy[0][0].toFixed(1)},${h} Z` };
}

/** The coin's market card for the control screen: the home feed's lime overlay, with a live market-cap line beside the value. */
export function AgentMarketCard({ mint, className = "" }: { mint: string; className?: string }) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const rate = useSolUsd();
  const route = useQuery(api.solstarMarket.characterForRoute, { id: mint });
  const characterId = route?.characterId;
  const terminal = useQuery(api.solstarMarket.terminal, characterId ? { characterId } : "skip");
  const token = terminal?.token;
  const onChain = !!token?.mint && token.network !== "paper" && !!token.dbcPool;
  // Convex live queries: price, swaps and holders arrive by push, so the card moves the instant a trade lands.
  const { market, swaps } = useChainMarket(characterId as NonNullable<typeof characterId>, onChain && !!characterId);

  const view = useMemo(() => {
    if (!token) return null;
    let capSol: number | null = null, series: number[] = [], volumeSol = 0, trades = 0, holders: number | null = null;
    if (onChain) {
      const state = market?.state;
      const supply = state ? Number(state.supplyRaw) / 10 ** state.decimals : 0;
      if (state && supply) {
        capSol = state.priceSol * supply;
        const asc = [...(swaps ?? [])].sort((a, b) => a.time - b.time);
        series = [...asc.map((s) => s.priceSol * supply), capSol];
        const recent = asc.filter((s) => s.time >= now - DAY);
        volumeSol = recent.reduce((n, s) => n + s.sol, 0);
        trades = recent.length;
        holders = countOpen(market);
      }
    } else {
      const pool = { solReserve: BigInt(token.solReserve), tokenReserve: BigInt(token.tokenReserve) };
      capSol = Number(marketCapLamports(pool, PAPER_VIRTUAL_TOKENS)) / 1e9;
      holders = terminal?.stats?.holders.length ?? null;
    }
    const change = series.length > 1 && series[0] > 0 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : null;
    return { capSol, series, change, volumeSol, trades, holders };
  }, [token, onChain, market, swaps, terminal?.stats, now]);

  if (!route || !terminal || !token || !view) return null;
  const W = 124, H = 44;
  const line = view.series.length > 1 ? linePath(view.series, W, H) : null;
  const capUsd = view.capSol != null && rate ? view.capSol * rate : null;
  const gradient = `mc-${route.characterId}`;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 22, filter: "blur(12px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className={`absolute inset-x-2.5 bottom-2.5 ${className}`}
    >
      <Link href={`/market/${route.characterId}`} aria-label={`Open ${terminal.character.name} market`} className="block rounded-[3px] bg-[#d7ff00] px-3.5 py-3 text-[#10130a] shadow-[0_12px_40px_rgba(215,255,0,0.18)] transition-transform active:scale-[0.99]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <img src={terminal.character.referenceImageUrl} alt="" className="size-[18px] shrink-0 rounded-[2px] object-cover" />
            <span className="truncate text-[12px] font-semibold tracking-tight">${token.ticker}</span>
            {onChain && <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[#10130a]/55"><span className="relative flex size-1.5"><span className={`absolute inline-flex size-full rounded-full bg-[#10130a]/50 ${reduced ? "" : "animate-ping"}`} /><span className="relative size-1.5 rounded-full bg-[#10130a]" /></span>Live</span>}
          </div>
          {view.change != null && <span className="rounded-[2px] bg-[#10130a] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#d7ff00]">{view.change >= 0 ? "+" : "−"}{Math.abs(view.change).toFixed(2)}%</span>}
        </div>
        <div className="mt-2.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-wide text-[#10130a]/50">Market cap</p>
            <div className="text-[30px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
              {capUsd != null
                ? <CountUp value={capUsd} duration={0.6} format={(n) => `$${new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: n >= 10000 ? 2 : 0 }).format(n)}`} />
                : view.capSol != null ? `${view.capSol.toFixed(1)} SOL` : "—"}
            </div>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${token.ticker} market cap over recent trades, live`} className="shrink-0 overflow-visible">
            <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={INK} stopOpacity="0.28" /><stop offset="1" stopColor={INK} stopOpacity="0" /></linearGradient></defs>
            {line ? (
              <>
                <path d={line.area} fill={`url(#${gradient})`} style={{ transition: reduced ? undefined : "d 0.6s ease" }} />
                <path d={line.d} fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transition: reduced ? undefined : "d 0.6s ease" }} />
                <circle cx={line.last[0]} cy={line.last[1]} r="3" fill={INK} />
                {!reduced && <circle cx={line.last[0]} cy={line.last[1]} r="3" fill={INK} opacity="0.4"><animate attributeName="r" values="3;9;3" dur="1.8s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.4;0;0.4" dur="1.8s" repeatCount="indefinite" /></circle>}
              </>
            ) : <line x1="3" x2={W - 3} y1={H / 2} y2={H / 2} stroke={INK} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 4" />}
          </svg>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-3 border-t border-[#10130a]/15 pt-2 text-[9px] font-medium uppercase tracking-wide text-[#10130a]/50">
          <div>Vol 24h<div className="text-[12px] font-semibold normal-case tracking-tight tabular-nums text-[#10130a]">{onChain ? (rate ? formatUsdEstimate(String(Math.round(view.volumeSol * 1e9)), rate) : `${view.volumeSol.toFixed(2)} SOL`) : "—"}</div></div>
          <div>Holders<div className="text-[12px] font-semibold normal-case tracking-tight tabular-nums text-[#10130a]">{view.holders ?? "—"}</div></div>
          <div>Trades 24h<div className="text-[12px] font-semibold normal-case tracking-tight tabular-nums text-[#10130a]">{onChain ? view.trades : "—"}</div></div>
        </div>
      </Link>
    </motion.div>
  );
}
