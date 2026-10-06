"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, RefreshCw, Trophy, ShieldCheck } from "lucide-react";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { getNetwork } from "@/lib/solana/network";
import type { LeaderboardPeriod, LeaderboardResponse } from "@/lib/solstar/leaderboard";
const LogoParticles = dynamic(() => import("./LogoParticles"), { ssr: false });
const WINDOWS: { id: LeaderboardPeriod; label: string }[] = [{ id: "24h", label: "24H" }, { id: "7d", label: "7D" }, { id: "30d", label: "30D" }, { id: "all", label: "All time" }];
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
const short = (wallet: string) => `${wallet.slice(0, 5)}…${wallet.slice(-5)}`;

export function TraderTournamentBoard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  const [snapshot, setSnapshot] = useState<{ period: LeaderboardPeriod; data: LeaderboardResponse } | null>(null);
  const [error, setError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [retry, setRetry] = useState(0);
  const reduced = useReducedMotion();
  const solUsd = useSolUsd();
  const data = snapshot?.period === period ? snapshot.data : null;
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true; setSyncing(true);
      try {
        const response = await fetch(`/api/solstar/leaderboard?period=${period}&metric=realized`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("RPC unavailable");
        const result = await response.json() as LeaderboardResponse;
        if (!controller.signal.aborted) { setSnapshot({ period, data: result }); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { busy = false; if (!controller.signal.aborted) setSyncing(false); }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("solcameo:trade-confirmed", refresh); };
  }, [period, retry]);
  const verified = (data?.traders ?? []).filter(row => row.complete && row.pnlSol !== null && (row.closedTrades ?? 0) > 0);
  const pending = (data?.traders ?? []).length - verified.length;
  const total = verified.reduce((sum, row) => sum + Math.max(0, row.pnlSol ?? 0), 0);
  const network = data?.network ?? (getNetwork() === "mainnet-beta" ? "mainnet" : "devnet");
  const explorer = (wallet: string) => `https://solscan.io/account/${wallet}${network === "devnet" ? "?cluster=devnet" : ""}`;
  const dollars = (sol: number) => solUsd == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(sol * solUsd);
  return (
    <main className="min-h-full bg-[#181a1c] px-4 pb-20 pt-8 text-white sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-lime-300">Solcameo tournament</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">The traders. The wins.</h1></div><div role="group" aria-label="Leaderboard period" className="flex rounded-full border border-white/10 bg-white/5 p-1">{WINDOWS.map(window => <button key={window.id} aria-pressed={window.id === period} onClick={() => setPeriod(window.id)} className={`rounded-full px-3 py-2 text-xs font-medium transition ${window.id === period ? "bg-[#d7ff00] text-black" : "text-zinc-400 hover:text-white"}`}>{window.label}</button>)}</div></div>
        <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#202326] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="pointer-events-none absolute -right-12 -top-24 size-[500px] rounded-full bg-lime-400/10 blur-[100px]" />
          <div className="grid items-center md:grid-cols-2">
            <div className="relative z-10 p-6 sm:p-10"><span className="inline-flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[11px] text-lime-200"><ShieldCheck className="size-3.5" /> Confirmed swaps · {network}</span><p className="mt-7 text-xs text-zinc-400">Realized profit across ranked wallets</p><p className="mt-2 text-5xl font-semibold tracking-[-0.055em] sm:text-6xl">{data ? number(total) : "—"}<span className="ml-2 text-xl text-lime-300">SOL</span></p><p className="mt-2 text-sm tabular-nums text-zinc-400">{data ? dollars(total) : "—"} estimated USD</p><p className="mt-5 max-w-sm text-sm leading-6 text-zinc-400">Earn your rank through closed trades. Sale proceeds minus purchase cost and transaction fees, measured from confirmed Solcameo pool swaps.</p><div className="mt-6 flex gap-8"><div><p className="text-2xl font-semibold tabular-nums">{data ? verified.length : "—"}</p><p className="mt-1 text-xs text-zinc-500">Ranked traders</p></div><div><p className="text-2xl font-semibold tabular-nums">{data ? verified.reduce((sum, row) => sum + (row.closedTrades ?? 0), 0) : "—"}</p><p className="mt-1 text-xs text-zinc-500">Executed sells</p></div></div></div>
            <div className="relative h-[340px] sm:h-[420px]"><LogoParticles className="absolute inset-0" /></div>
          </div>
        </section>
        <section className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><Trophy className="size-4 text-lime-300" /> Top realized P&L</h2><p className="mt-1 text-xs text-zinc-500">Closed quantities only · FIFO cost basis · open holdings excluded</p></div><button onClick={() => setRetry(value => value + 1)} disabled={syncing} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-400 hover:text-white disabled:opacity-50"><RefreshCw className={`size-3 ${syncing && !reduced ? "animate-spin" : ""}`} />{syncing ? "Reading chain" : "Refresh"}</button></div>
          {(error || data?.errors.length || pending > 0) ? <p role="status" className="border-b border-white/5 bg-amber-300/[0.035] px-5 py-3 text-xs leading-5 text-amber-200/80">{error ? "RPC is temporarily unavailable. The last successful result is kept while we reconnect." : "Some trade histories could not be fully verified. Wallets with incomplete cost basis are excluded from ranking."}</p> : null}
          {!data ? <p className="px-5 py-12 text-center text-sm text-zinc-500">{error ? "Unable to load verified trades. Try refreshing." : "Verifying on-chain trading history…"}</p> : verified.length === 0 ? <p className="px-5 py-12 text-center text-sm text-zinc-500">No verified closed trades in this period yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead className="text-[10px] uppercase tracking-wider text-zinc-500"><tr><th className="px-5 py-3">Rank</th><th className="px-3 py-3">Trader</th><th className="px-3 py-3 text-right">Sells</th><th className="px-5 py-3 text-right">Realized P&L</th></tr></thead><tbody><AnimatePresence initial={false}>{verified.map((row, index) => <motion.tr key={row.wallet} layout={!reduced} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="border-t border-white/5 transition-colors hover:bg-white/[0.035]"><td className="px-5 py-4 text-sm tabular-nums text-zinc-500">{index < 3 ? <span className="grid size-7 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 font-semibold text-lime-300">{index + 1}</span> : index + 1}</td><td className="px-3 py-4"><a href={explorer(row.wallet)} target="_blank" rel="noopener noreferrer" title={row.wallet} className="inline-flex items-center gap-2 text-xs text-zinc-200 hover:text-lime-300"><AgentAvatar url={row.profileImage} name={row.profileName ?? short(row.wallet)} className="size-8 rounded-full" initialClassName="text-xs" /><span><span className="block font-medium">{row.profileName ?? short(row.wallet)}</span>{row.profileName && <span className="mt-0.5 block font-mono text-[10px] text-zinc-500">{short(row.wallet)}</span>}</span><ArrowUpRight className="size-3 text-zinc-500" /></a></td><td className="px-3 py-4 text-right text-xs tabular-nums text-zinc-400">{row.closedTrades}</td><td className="px-5 py-4 text-right"><p className={`whitespace-nowrap text-sm font-semibold tabular-nums ${(row.pnlSol ?? 0) >= 0 ? "text-lime-300" : "text-rose-300"}`}>{(row.pnlSol ?? 0) > 0 ? "+" : ""}{number(row.pnlSol ?? 0)} SOL</p><p className="mt-1 text-[11px] tabular-nums text-zinc-500">{dollars(row.pnlSol ?? 0)}</p></td></motion.tr>)}</AnimatePresence></tbody></table></div>}
          {data && <p className="border-t border-white/5 px-5 py-3 text-[10px] text-zinc-500">Last checked {new Date(data.checkedAt).toLocaleTimeString()} · {data.network} · refreshed every 30 seconds</p>}
        </section>
      </div>
    </main>
  );
}
