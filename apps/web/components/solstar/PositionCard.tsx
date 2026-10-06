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
export function PositionCard({ mint, network }: { mint?: string; ticker: string; network: string }) {
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

  const shell = "mx-3 mt-3 overflow-hidden rounded-[4px] border border-white/[0.09] bg-[linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]";
  if (pos === undefined) return <div className={`${shell} flex items-center gap-2 px-3 py-2.5 text-[11.5px] text-zinc-500`}>{error ? error : <><Loader2 className="size-3.5 animate-spin" />Reading your position…</>}</div>;
  if (pos === null || (pos.tokens <= 0 && pos.trades.length === 0 && pos.heldTokens <= 0)) return null;

  const holding = pos.heldTokens > 0;
  const stats = [
    { l: "Holding", v: sol(pos.heldTokens, 2), s: `${sol(pos.valueSol)} SOL` },
    { l: "Avg entry", v: pos.avgEntrySol != null ? price(pos.avgEntrySol) : "n/a", s: `now ${price(pos.priceSol)}` },
    { l: "Unrealized", v: signed(pos.unrealizedSol, 3), s: `cost ${sol(pos.costBasisSol, 3)}`, c: tone(pos.unrealizedSol) },
  ];
  return (
    <div className={shell}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <p className="text-[11px] font-medium text-zinc-400">Your position</p>
        {!pos.verified && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-1.5 text-[9.5px] leading-4 text-amber-200" title="Your wallet holds a different amount than your trade history explains, for example tokens transferred in, so the entry price may be off.">unverified</span>}
        <p className={`ml-auto text-[13px] font-semibold tabular-nums ${tone(pos.pnlSol)}`}>{signed(pos.pnlSol, 3)} <span className="text-[10px] font-medium text-zinc-500">SOL</span>{pos.roiPct != null && <span className="ml-1.5 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10.5px]">{signed(pos.roiPct, 1)}%</span>}</p>
      </div>
      <dl className="mt-2 grid grid-cols-3 divide-x divide-white/[0.07] px-1 text-[12px]">
        {stats.map((x) => (
          <div key={x.l} className="min-w-0 px-2">
            <dt className="text-[10px] text-zinc-500">{x.l}</dt>
            <dd className={`truncate font-semibold tabular-nums ${x.c ?? "text-white"}`}>{x.v}</dd>
            <dd className="truncate text-[10px] tabular-nums text-zinc-500">{x.s}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2.5 flex items-center gap-1.5 border-t border-white/[0.06] px-3 py-2">
        {holding && [25, 50, 100].map((p) => (
          <button key={p} type="button" onClick={() => sell(p)} aria-label={p === 100 ? "Close position" : `Sell ${p}%`}
            className={`h-6 rounded-full border px-2.5 text-[11px] font-semibold tabular-nums transition-colors active:scale-[.97] ${p === 100 ? "border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/25 hover:text-white"}`}>
            {p === 100 ? "Close" : `${p}%`}
          </button>
        ))}
        {pos.trades.length > 0 && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ml-auto text-[11px] text-zinc-500 transition-colors hover:text-white">{open ? "Hide" : "History"} · {pos.trades.length}</button>
        )}
      </div>
      {open && (
        <ul className="space-y-1 border-t border-white/[0.06] px-3 py-2 text-[11px]">
          {pos.trades.slice(0, 12).map((t) => (
            <li key={t.signature} className="flex items-center justify-between gap-2 text-zinc-400">
              <span className={`w-20 shrink-0 ${t.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>{t.side === "buy" ? "Buy" : "Sell"} {sol(t.tokens, 2)}</span>
              <span className="min-w-0 flex-1 truncate text-right tabular-nums">{sol(t.sol)} SOL @ {price(t.priceSol)}</span>
              <a href={getTxExplorerUrl(t.signature)} target="_blank" rel="noreferrer" aria-label="View transaction" className="hover:text-white"><ExternalLink className="size-3" /></a>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="px-3 pb-2 text-[11px] text-amber-300">{error} Showing the last read.</p>}
    </div>
  );
}
