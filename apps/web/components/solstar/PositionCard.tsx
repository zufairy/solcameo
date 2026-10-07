"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { getNetwork } from "@/lib/solana/network";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { APPLE_FONT, formatAmount, formatCompact, formatPercent } from "@/lib/format/appleNumber";
import { LiveNumber } from "@/components/ui/live-number";
import { Skeleton } from "@/components/ui/skeleton";

export const TRADE_PREFILL_EVENT = "solcameo:trade-prefill";
export type TradePrefill = { side: "sell"; percent: number };

/** Green or red by direction, but a value that shows as 0 stays neutral, so it never reads "-0" in red. */
const tone = (n: number) => (formatAmount(n) === "0" ? "text-white" : n > 0 ? "text-emerald-300" : "text-rose-300");
const shell = "mx-3 mt-3 overflow-hidden rounded-[6px] border border-white/[0.09] bg-white/[0.04] backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]";
/** Dollar amount from a USD value; "—" until the SOL price has loaded. */
const usdText = (n: number, rate: number | null, signed = false) => (rate == null ? "—" : `${n < 0 ? "−" : signed && formatAmount(n) !== "0" ? "+" : ""}$${formatAmount(Math.abs(n))}`);
const label = "text-[11px] font-medium text-white/45";

/**
 * Your position in this coin, read live from Convex: the market syncs the chain into Convex and this panel
 * subscribes, so every number moves the moment a trade lands and nothing here waits on an RPC call.
 * One-click sell presets fill the trade ticket; the wallet still approves every swap.
 */
export function PositionCard({ characterId, ticker, network }: { characterId: Id<"ssCharacters">; ticker: string; network: string }) {
  const { publicKey } = useUnifiedSolanaWallet();
  const wallet = publicKey?.toBase58();
  const compatible = network === (getNetwork() === "mainnet-beta" ? "mainnet" : getNetwork());
  const data = useQuery(api.solstarChain.positionOf, wallet && compatible ? { characterId, wallet } : "skip");
  const rate = useSolUsd();
  const fx = rate ?? 0;

  if (!wallet || !compatible) return null;
  const sell = (percent: number) => window.dispatchEvent(new CustomEvent<TradePrefill>(TRADE_PREFILL_EVENT, { detail: { side: "sell", percent } }));

  if (data === undefined) return <div className={`${shell} space-y-2 p-3.5`} aria-busy="true"><Skeleton className="h-3 w-24 bg-white/[0.06]" /><Skeleton className="h-8 w-40 bg-white/[0.06]" /><Skeleton className="h-9 w-full bg-white/[0.05]" /></div>;
  if (data === null) return <div className={`${shell} px-3.5 py-3 text-[12px] text-white/45`}>Syncing this market…</div>;

  const scale = 10 ** data.decimals;
  const pos = data.position;
  const held = data.heldUnits != null ? Number(data.heldUnits) / scale : pos?.openTokens ?? 0;
  if (!pos && held <= 0) return <div className={`${shell} px-3.5 py-3 text-[12px] leading-4 text-white/45`}>No position in ${ticker} yet. Your entry and P&amp;L show here after your first buy.</div>;

  const price = data.priceSol;
  const openTokens = pos?.openTokens ?? 0;
  const cost = pos?.costBasisSol ?? 0;
  const unrealized = openTokens > 0 ? openTokens * price - cost : 0;
  const realized = pos?.realizedSol ?? 0;
  const pnl = unrealized + realized;
  const roi = pos && pos.spentSol > 0 ? (pnl / pos.spentSol) * 100 : null;
  const entry = openTokens > 0 ? cost / openTokens : null;
  const verified = data.heldUnits == null || !pos || Math.abs(held - openTokens) <= Math.max(1, openTokens * 0.001);
  const holding = held > 0;

  return (
    <div className={shell} style={{ fontFamily: APPLE_FONT }}>
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <p className="text-[13px] font-semibold text-white/70">Your position</p>
        {!verified && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-1.5 text-[9.5px] leading-4 text-amber-200" title="Your wallet holds a different amount than your trade history explains, for example tokens transferred in, so the entry price may be off.">unverified</span>}
      </div>

      <div className="flex items-baseline gap-2 px-3.5 pt-1">
        <LiveNumber value={pnl * fx} format={(n) => usdText(n, rate, true)} className={`text-[28px] font-semibold leading-none ${tone(pnl)}`} />
        {roi != null && <LiveNumber value={roi} format={formatPercent} flash={false} className={`ml-auto rounded-[4px] bg-white/[0.07] px-2 py-0.5 text-[12px] font-semibold ${tone(roi)}`} />}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 px-3.5">
        <div className="min-w-0"><dt className={label}>Holding</dt><dd className="truncate text-[15px] font-semibold text-white"><LiveNumber value={held} format={formatCompact} flash={false} /></dd><dd className="truncate text-[11px] text-white/40"><LiveNumber value={held * price * fx} format={(n) => usdText(n, rate)} flash={false} /></dd></div>
        <div className="min-w-0"><dt className={label}>Avg entry</dt><dd className="truncate text-[15px] font-semibold text-white">{entry != null ? <LiveNumber value={entry * fx} format={(n) => usdText(n, rate)} flash={false} /> : "n/a"}</dd><dd className="truncate text-[11px] text-white/40">now {usdText(price * fx, rate)}</dd></div>
        <div className="min-w-0"><dt className={label}>Unrealized</dt><dd className={`truncate text-[15px] font-semibold ${tone(unrealized)}`}><LiveNumber value={unrealized * fx} format={(n) => usdText(n, rate, true)} /></dd><dd className="truncate text-[11px] text-white/40">cost {usdText(cost * fx, rate)}</dd></div>
      </dl>

      {holding && (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.06] px-3.5 py-3">
          {[25, 50, 100].map((p) => (
            <button key={p} type="button" onClick={() => sell(p)} aria-label={p === 100 ? "Close position" : `Sell ${p}%`}
              className={`h-9 rounded-[4px] border text-[13px] font-semibold tabular-nums backdrop-blur-xl transition-all active:scale-[.97] ${p === 100 ? "border-rose-300/30 bg-gradient-to-b from-rose-400/25 to-rose-500/[0.08] text-rose-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_6px_16px_-8px_rgba(244,63,94,0.5)] hover:from-rose-400/35" : "border-white/[0.16] bg-gradient-to-b from-white/[0.16] to-white/[0.04] text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_6px_16px_-10px_rgba(0,0,0,0.8)] hover:border-white/30 hover:from-white/[0.22] hover:text-white"}`}>
              {p === 100 ? "Close" : `${p}%`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
