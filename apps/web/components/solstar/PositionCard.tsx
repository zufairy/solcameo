"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { getNetwork, getTxExplorerUrl } from "@/lib/solana/network";
import type { MarketPosition } from "@/lib/server/marketPosition";

export const TRADE_PREFILL_EVENT = "solcameo:trade-prefill";
export type TradePrefill = { side: "sell"; percent: number };

const sol = (n: number, d = 4) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const signed = (n: number, d = 4) => `${n >= 0 ? "+" : "−"}${sol(Math.abs(n), d)}`;
const tone = (n: number) => (n > 0 ? "text-emerald-300" : n < 0 ? "text-rose-300" : "text-white");
const price = (n: number) => (n >= 0.01 ? sol(n, 4) : n.toPrecision(3));

/**
 * Your position in this coin: how much you hold, what you paid on average, what it is worth and your profit or loss,
 * with one-click sell presets (25 / 50 / close). Presets fill the trade ticket; the wallet still approves every swap.
 */
export function PositionCard({ mint, ticker, network }: { mint?: string; ticker: string; network: string }) {
  const { publicKey } = useUnifiedSolanaWallet();
  const wallet = publicKey?.toBase58();
  const compatible = network === (getNetwork() === "mainnet-beta" ? "mainnet" : getNetwork());
  const [pos, setPos] = useState<MarketPosition | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async (fresh = false) => {
    if (!wallet || !mint || busy.current || document.hidden) return;
    busy.current = true;
    try {
      const res = await fetch(`/api/solstar/position?wallet=${wallet}&mint=${mint}${fresh ? "&refresh=1" : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Position unavailable");
      setPos(data.position); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Position unavailable"); }
    finally { busy.current = false; }
  }, [wallet, mint]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the wallet or coin changes
    setPos(undefined); setError("");
    if (!wallet || !mint || !compatible) return;
    void load();
    const timer = setInterval(() => void load(), 15_000);
    const confirmed = () => { setTimeout(() => void load(true), 2500); };
    window.addEventListener("solcameo:trade-confirmed", confirmed);
    return () => { clearInterval(timer); window.removeEventListener("solcameo:trade-confirmed", confirmed); };
  }, [wallet, mint, compatible, load]);

  if (!wallet || !mint || !compatible) return null;
  const sell = (percent: number) => window.dispatchEvent(new CustomEvent<TradePrefill>(TRADE_PREFILL_EVENT, { detail: { side: "sell", percent } }));

  if (pos === undefined) return <div className="flex items-center gap-2 border-b border-white/10 p-3 text-xs text-zinc-500">{error ? error : <><Loader2 className="size-3.5 animate-spin" />Reading your position…</>}</div>;
  if (pos === null || (pos.tokens <= 0 && pos.trades.length === 0 && pos.heldTokens <= 0)) return <div className="border-b border-white/10 p-3 text-xs text-zinc-500">No position in ${ticker} yet. Your entry price and P&amp;L appear here after your first buy.</div>;

  const holding = pos.heldTokens > 0;
  return (
    <div className="border-b border-white/10 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Your position</p>
        {!pos.verified && <span className="rounded border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[10px] text-amber-200" title="Your wallet holds a different amount than your trade history explains, for example tokens transferred in, so the entry price may be off.">unverified</span>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
        {[
          { l: "Holding", v: `${sol(pos.heldTokens, 2)} ${ticker}`, s: `${sol(pos.valueSol)} SOL` },
          { l: "Avg entry", v: pos.avgEntrySol != null ? `${price(pos.avgEntrySol)} SOL` : "n/a", s: `now ${price(pos.priceSol)} SOL` },
          { l: "Unrealized", v: `${signed(pos.unrealizedSol)} SOL`, s: `cost ${sol(pos.costBasisSol)} SOL`, c: tone(pos.unrealizedSol) },
          { l: "Total P&L", v: `${signed(pos.pnlSol)} SOL`, s: pos.roiPct != null ? `${signed(pos.roiPct, 1)}% · realized ${signed(pos.realizedSol)}` : "", c: tone(pos.pnlSol) },
        ].map((x) => (
          <div key={x.l} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">{x.l}</p>
            <p className={`mt-0.5 font-semibold tabular-nums ${x.c ?? "text-white"}`}>{x.v}</p>
            <p className="mt-0.5 truncate text-[10.5px] text-zinc-500">{x.s}</p>
          </div>
        ))}
      </div>
      {holding && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {[25, 50, 100].map((p) => <button key={p} type="button" onClick={() => sell(p)} className={`h-8 rounded-lg border text-[12px] font-semibold transition-colors ${p === 100 ? "border-rose-400/40 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/25 hover:text-white"}`}>{p === 100 ? "Close position" : `Sell ${p}%`}</button>)}
        </div>
      )}
      {pos.trades.length > 0 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-[11px] text-zinc-500 underline-offset-2 hover:text-white hover:underline">{open ? "Hide" : "Show"} your {pos.trades.length} trade{pos.trades.length === 1 ? "" : "s"}</button>
      )}
      {open && (
        <ul className="mt-1.5 space-y-1 text-[11.5px]">
          {pos.trades.slice(0, 12).map((t) => (
            <li key={t.signature} className="flex items-center justify-between text-zinc-400">
              <span className={t.side === "buy" ? "text-emerald-300" : "text-rose-300"}>{t.side === "buy" ? "Buy" : "Sell"} {sol(t.tokens, 2)}</span>
              <span className="tabular-nums">{sol(t.sol)} SOL @ {price(t.priceSol)}</span>
              <a href={getTxExplorerUrl(t.signature)} target="_blank" rel="noreferrer" aria-label="View transaction" className="hover:text-white"><ExternalLink className="size-3" /></a>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1.5 text-[11px] text-amber-300">{error} Showing the last read.</p>}
    </div>
  );
}
