"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

type Market = FunctionReturnType<typeof api.solstarChain.openTrades>;
type Row = {
  wallet: string; size: number; valueSol: number; supplyPct: number; entry: number | null; unrealized: number | null;
  pnlPct: number | null; realized: number; lastAt: number | null; trades: number; tracked: boolean;
};

/** Wallets with an open position: holders (minus pool vaults) plus anyone whose swaps still leave tokens. */
export function countOpen(market: Market | undefined): number {
  if (!market) return 0;
  const wallets = new Set<string>(market.holders.filter((h) => !h.isPool && Number(h.units) > 0).map((h) => h.wallet));
  for (const p of market.positions) if (p.openTokens > 0 && !market.holders.some((h) => h.wallet === p.wallet && h.isPool)) wallets.add(p.wallet);
  return wallets.size;
}
const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(n >= 10 ? 0 : 2));
const solFmt = (n: number, signed = false) => {
  const a = Math.abs(n), text = a >= 100 ? a.toFixed(1) : a >= 1 ? a.toFixed(2) : a >= 0.001 ? a.toFixed(3) : a === 0 ? "0" : a.toPrecision(2);
  return `${n < 0 ? "−" : signed && n > 0 ? "+" : ""}${text}`;
};
const ago = (ms: number, now: number) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const tone = (n: number | null) => (n == null ? "text-zinc-500" : n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-zinc-300");

/** Live open positions for one coin, straight from Convex. Rows update in place the moment a swap lands. */
export function OpenTrades({ market, you, dev, usd, search, ticker, identity, explorer }: {
  market: Market | undefined; you?: string; dev?: string; usd: number | null; search: string; ticker: string;
  identity: (wallet: string) => ReactNode; explorer: (wallet: string) => string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const rows = useMemo(() => {
    if (!market?.state) return [] as Row[];
    const dec = market.state.decimals, price = market.state.priceSol, supply = Number(market.state.supplyRaw) / 10 ** dec || 1;
    const holders = new Map(market.holders.map((h) => [h.wallet, h]));
    const positions = new Map(market.positions.map((p) => [p.wallet, p]));
    const wallets = new Set<string>([...market.positions.filter((p) => p.openTokens > 0).map((p) => p.wallet), ...market.holders.filter((h) => !h.isPool).map((h) => h.wallet)]);
    const out: Row[] = [];
    for (const wallet of wallets) {
      const h = holders.get(wallet), p = positions.get(wallet);
      if (h?.isPool) continue;
      const size = h ? Number(h.units) / 10 ** dec : p?.openTokens ?? 0;
      if (size <= 0) continue;
      const open = p && p.openTokens > 0 ? p : null;
      const unrealized = open ? open.openTokens * price - open.costBasisSol : null;
      out.push({
        wallet, size, valueSol: size * price, supplyPct: h?.supplyPct ?? (size / supply) * 100,
        entry: open ? open.costBasisSol / open.openTokens : null, unrealized,
        pnlPct: open && open.costBasisSol > 0 && unrealized != null ? (unrealized / open.costBasisSol) * 100 : null,
        realized: p?.realizedSol ?? 0, lastAt: p?.lastAt ?? null, trades: p?.trades ?? 0, tracked: !!open,
      });
    }
    out.sort((a, b) => (a.wallet === you ? -1 : b.wallet === you ? 1 : b.valueSol - a.valueSol));
    return out;
  }, [market, you]);

  // Briefly tint a row when its size or P&L moves so changes are noticed without any refresh.
  const previous = useRef(new Map<string, string>());
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  useEffect(() => {
    const changes: Record<string, "up" | "down"> = {};
    for (const r of rows) {
      const key = `${r.size.toFixed(4)}|${(r.unrealized ?? 0).toFixed(6)}`, before = previous.current.get(r.wallet);
      if (before !== undefined && before !== key) changes[r.wallet] = (r.unrealized ?? 0) >= Number(before.split("|")[1]) ? "up" : "down";
      previous.current.set(r.wallet, key);
    }
    if (!Object.keys(changes).length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot highlight keyed off the data change
    setFlash(changes);
    const t = setTimeout(() => setFlash({}), 1300);
    return () => clearTimeout(t);
  }, [rows]);

  const money = (sol: number, signed = false) => (usd ? `${sol < 0 ? "−" : signed && sol > 0 ? "+" : ""}$${Math.abs(sol * usd) >= 100 ? Math.round(Math.abs(sol * usd)).toLocaleString("en-US") : Math.abs(sol * usd).toFixed(2)}` : `${solFmt(sol, signed)} SOL`);
  const shown = rows.filter((r) => r.wallet.toLowerCase().includes(search.trim().toLowerCase()));


  if (market === undefined || !market.state) {
    return (
      <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading open trades">
        <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="size-3.5 animate-spin" />{market === undefined ? "Connecting…" : "Syncing this market from Solana…"}</div>
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg bg-white/[0.05]" />)}
      </div>
    );
  }

  return (
    <div>
      <Table className="min-w-[640px] [&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
        <TableHeader>
          <TableRow className="border-white/[0.06] hover:bg-transparent">
            <TableHead className="h-9 text-[11px] font-medium text-zinc-500">Trader</TableHead>
            <TableHead className="h-9 text-right text-[11px] font-medium text-zinc-500">Holding</TableHead>
            <TableHead className="h-9 text-right text-[11px] font-medium text-zinc-500">Avg entry</TableHead>
            <TableHead className="h-9 text-right text-[11px] font-medium text-zinc-500">Unrealized</TableHead>
            <TableHead className="h-9 text-right text-[11px] font-medium text-zinc-500">Realized</TableHead>
            <TableHead className="h-9 text-right text-[11px] font-medium text-zinc-500">Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r, i) => (
            <TableRow key={r.wallet} className={`group border-white/[0.04] transition-colors duration-700 hover:bg-white/[0.035] ${flash[r.wallet] === "up" ? "bg-emerald-400/[0.09]" : flash[r.wallet] === "down" ? "bg-rose-400/[0.09]" : r.wallet === you ? "bg-[#d7ff00]/[0.045]" : ""}`}>
              <TableCell className="py-2.5">
                <div className="flex items-center gap-2">
                  <a href={explorer(r.wallet)} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-sans text-[12.5px] text-zinc-100 hover:text-[#d7ff00]">{identity(r.wallet)}<ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" /></a>
                  {r.wallet === you && <Badge variant="outline" className="h-4 rounded-[4px] border-[#d7ff00]/40 bg-[#d7ff00]/10 px-1.5 text-[9.5px] font-semibold text-[#d7ff00]">You</Badge>}
                  {r.wallet === dev && <Badge variant="outline" className="h-4 rounded-[4px] border-sky-300/30 bg-sky-300/10 px-1.5 text-[9.5px] font-semibold text-sky-200">Dev</Badge>}
                  {i === 0 && r.wallet !== you && shown.length > 3 && <span className="text-[10px] text-amber-300/80" title="Largest holder">★</span>}
                </div>
              </TableCell>
              <TableCell className="py-2.5 text-right">
                <p className="text-[12.5px] font-semibold tabular-nums text-white">{money(r.valueSol)}</p>
                <p className="text-[10.5px] tabular-nums text-zinc-500">{compact(r.size)} {ticker} · {r.supplyPct >= 0.01 ? r.supplyPct.toFixed(2) : "<0.01"}%</p>
                <span className="mt-1 ml-auto block h-[3px] w-20 overflow-hidden rounded-full bg-white/[0.07]"><motion.span className="block h-full rounded-full bg-[#d7ff00]/70" initial={false} animate={{ width: `${Math.min(100, r.supplyPct * 4)}%` }} transition={{ duration: 0.5 }} /></span>
              </TableCell>
              <TableCell className="py-2.5 text-right text-[12px] tabular-nums text-zinc-300">{r.entry != null ? <>{r.entry.toPrecision(3)}<span className="text-[10px] text-zinc-600"> SOL</span></> : <span className="text-zinc-600" title="Tokens received by transfer: no buy on record">n/a</span>}</TableCell>
              <TableCell className="py-2.5 text-right">
                {r.unrealized != null ? (
                  <span className={`inline-flex flex-col items-end ${tone(r.unrealized)}`}>
                    <span className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold tabular-nums">{r.unrealized >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{money(r.unrealized, true)}</span>
                    {r.pnlPct != null && <span className="text-[10.5px] tabular-nums opacity-80">{r.pnlPct >= 0 ? "+" : "−"}{Math.abs(r.pnlPct).toFixed(1)}%</span>}
                  </span>
                ) : <span className="text-zinc-600">—</span>}
              </TableCell>
              <TableCell className={`py-2.5 text-right text-[12px] tabular-nums ${r.trades ? tone(r.realized) : "text-zinc-600"}`}>{r.trades ? money(r.realized, true) : "—"}</TableCell>
              <TableCell className="py-2.5 text-right text-[11px] tabular-nums text-zinc-500">{r.lastAt ? <span title={`${r.trades} trade${r.trades === 1 ? "" : "s"}`}>{ago(r.lastAt, now)} ago</span> : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!shown.length && (
        <p className="px-4 py-12 text-center text-xs text-zinc-500">{search ? "No open trades match that wallet." : "No open trades yet. Positions appear here the moment someone buys."}</p>
      )}
      <p className="px-4 py-3 text-[10px] leading-4 text-zinc-600">Open trades are wallets that currently hold this coin. Size and share come from the largest token accounts; entry and P&amp;L follow each wallet&apos;s confirmed swaps at average cost. Pool vaults are left out. Updates live from Convex.</p>
    </div>
  );
}
