"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, BadgeCheck, Check, Copy, Info, RefreshCw } from "lucide-react";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { getNetwork } from "@/lib/solana/network";
import type { LeaderboardPeriod, LeaderboardResponse, TraderCoin, TraderRank } from "@/lib/solstar/leaderboard";

// Three.js is heavy and browser-only — load it after first paint, never on the server.
const LogoParticles = dynamic(() => import("./LogoParticles"), { ssr: false });

const MONO = { fontFamily: "var(--font-geist-mono)" } as const;
const APPLE = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Helvetica Neue', Arial, sans-serif",
} as const;

const WINDOWS: { id: LeaderboardPeriod; label: string }[] = [
  { id: "24h", label: "24H" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "all", label: "All" },
];
const WINDOW_LABEL: Record<LeaderboardPeriod, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };

type Ranked = TraderRank & { rank: number; pnl: number };
type CoinTotal = TraderCoin & { traders: number; winners: number };

const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
const sol = (value: number, signed = false) => {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  const text = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(abs);
  return `${value < 0 ? "−" : signed && value > 0 ? "+" : ""}${text}`;
};

export function TraderTournamentBoard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  const [snapshot, setSnapshot] = useState<{ period: LeaderboardPeriod; data: LeaderboardResponse } | null>(null);
  const [error, setError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [retry, setRetry] = useState(0);
  const reduced = useReducedMotion();
  const solUsd = useSolUsd();
  const data = snapshot?.period === period ? snapshot.data : null;

  // Realized P&L is computed server-side from confirmed swaps in every
  // Solcameo-launched pool (bonding curve + graduated DAMM pool), read via RPC.
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    // A manual refresh bypasses the 30s server cache once; polling keeps using it.
    let force = retry > 0;
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true; setSyncing(true);
      try {
        const response = await fetch(`/api/solstar/leaderboard?period=${period}&metric=realized${force ? "&refresh=1" : ""}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("RPC unavailable");
        force = false;
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

  const rows = useMemo<Ranked[]>(() => (data?.traders ?? [])
    .filter((row) => row.complete && row.pnlSol !== null && (row.closedTrades ?? 0) > 0)
    .sort((a, b) => (b.pnlSol ?? 0) - (a.pnlSol ?? 0))
    .map((row, i) => ({ ...row, rank: i + 1, pnl: row.pnlSol ?? 0 })), [data]);
  const pending = (data?.traders ?? []).length - rows.length;
  const totals = useMemo(() => ({
    profit: rows.reduce((s, r) => s + Math.max(0, r.pnl), 0),
    net: rows.reduce((s, r) => s + r.pnl, 0),
    sells: rows.reduce((s, r) => s + (r.closedTrades ?? 0), 0),
    winners: rows.filter((r) => r.pnl > 0).length,
  }), [rows]);
  const coins = useMemo<CoinTotal[]>(() => {
    const byMint = new Map<string, CoinTotal>();
    for (const r of rows) for (const c of r.coins ?? []) {
      const t = byMint.get(c.mint) ?? { ...c, realizedSol: 0, closedTrades: 0, traders: 0, winners: 0 };
      t.realizedSol += c.realizedSol; t.closedTrades += c.closedTrades; t.traders++; if (c.realizedSol > 0) t.winners++;
      byMint.set(c.mint, t);
    }
    return [...byMint.values()].sort((a, b) => b.realizedSol - a.realizedSol);
  }, [rows]);

  const loading = !data && !error;
  const network = data?.network ?? (getNetwork() === "mainnet-beta" ? "mainnet" : "devnet");
  const explorer = (wallet: string) => `https://solscan.io/account/${wallet}${network === "devnet" ? "?cluster=devnet" : ""}`;
  const usd = (value: number) => solUsd == null ? null : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(value * solUsd) >= 1000 ? 0 : 2 }).format(value * solUsd);
  const podium = rows.length >= 3 && rows[0].pnl > 0;

  return (
    <div className="min-h-full bg-black text-white">
      <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-8 sm:px-8 sm:pt-10">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }} className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">Leaderboards</p>
            <h1 className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.035em] sm:text-[40px]" style={APPLE}>Trading Tournament</h1>
          </div>
          <Segmented ariaLabel="Time window" value={period} onChange={setPeriod} options={WINDOWS} />
        </motion.div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_430px]">
          {/* ── Left: logo hero + coins traded on Solcameo ─────────────────── */}
          <div className="min-w-0 space-y-5">
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }} className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0b0c]">
              <div aria-hidden className="hero-glow pointer-events-none absolute -right-24 -top-32 size-[460px] rounded-full bg-lime-400/[0.08] blur-[100px]" />
              <div className="relative grid min-h-[300px] items-center gap-4 sm:grid-cols-[1.05fr_1fr]">
                <div className="relative z-10 p-6 sm:p-8">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">Realized profit by traders</p>
                  <p className="mt-2 flex items-baseline gap-2 text-[44px] font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-[56px]" style={APPLE}>
                    {loading ? <span className="inline-block h-12 w-44 rounded bg-white/[0.06] motion-safe:animate-pulse" /> : data ? <><CountUp value={totals.profit} format={(v) => sol(v)} /><span className="text-[20px] font-medium tracking-[-0.02em] text-lime-300">SOL</span></> : "—"}
                  </p>
                  <p className="mt-2 h-5 text-[13px] tabular-nums text-white/45">{data && usd(totals.profit) ? `≈ ${usd(totals.profit)}` : ""}</p>
                  <div className="mt-5 grid grid-cols-3 gap-4">
                    <Stat label="Traders" value={data ? String(rows.length) : "—"} />
                    <Stat label="Sells" value={data ? String(totals.sells) : "—"} />
                    <Stat label="Coins" value={data ? String(coins.length) : "—"} />
                  </div>
                  <div className="mt-6 flex flex-wrap items-center gap-2 text-[11.5px] text-white/50">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${data && !error ? "border-white/15 bg-white/[0.05] text-white/80" : "border-white/10 text-white/40"}`}>
                      <span className="relative flex size-1.5">
                        {data && !error && !reduced && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />}
                        <span className={`relative size-1.5 rounded-full ${data && !error ? "bg-emerald-400" : "bg-white/30"}`} />
                      </span>
                      {data && !error ? `On-chain · ${network}` : error ? "RPC unavailable" : "Reading chain…"}
                    </span>
                    {data && <span className="tabular-nums">{totals.winners} in profit · net {sol(totals.net, true)} SOL</span>}
                  </div>
                </div>
                <div className="relative h-[240px] sm:h-full sm:min-h-[300px]">
                  <LogoParticles className="absolute inset-0" />
                </div>
              </div>
            </motion.section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">Most profitable coins</h2>
                <span className="text-[11px] text-white/35">{WINDOW_LABEL[period]} · launched on Solcameo</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {loading
                  ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[168px] rounded-xl bg-white/[0.04] motion-safe:animate-pulse" />)
                  : coins.length === 0
                    ? <p className="col-span-full rounded-xl border border-white/[0.08] bg-[#0b0b0c] px-4 py-10 text-center text-[13px] text-white/45">{error ? "Unable to read trades right now." : "No closed trades on Solcameo coins in this window yet."}</p>
                    : coins.slice(0, 8).map((c, i) => <CoinCard key={`${period}-${c.mint}`} coin={c} index={i} usd={usd(c.realizedSol)} />)}
              </div>
            </section>
          </div>

          {/* ── Right: leaderboard (podium on a small stage + ranked list) ── */}
          <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0b0c]">
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
                <div>
                  <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">Leaderboard</h2>
                  <p className="mt-0.5 text-[11.5px] text-white/35">Ranked by realized P&amp;L</p>
                </div>
                <button type="button" onClick={() => setRetry((v) => v + 1)} disabled={syncing}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[12px] text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
                  <RefreshCw className={`size-3.5 ${syncing && !reduced ? "animate-spin" : ""}`} aria-hidden />
                  {syncing ? "Reading" : "Refresh"}
                </button>
              </div>

              {(error && data) || (data && pending > 0) ? (
                <p role="status" className="border-b border-white/[0.06] bg-amber-300/[0.04] px-4 py-2.5 text-[11.5px] leading-5 text-amber-200/75">
                  {error ? "RPC hiccup — showing the last confirmed result while we reconnect." : `${pending} wallet${pending === 1 ? "" : "s"} excluded: cost basis couldn't be fully verified on-chain.`}
                </p>
              ) : null}

              {podium && (
                <div key={period} className="grid grid-cols-3 items-end gap-2 px-4 pt-5">
                  {[rows[1], rows[0], rows[2]].map((r) => <PodiumSlot key={r.wallet} r={r} href={explorer(r.wallet)} />)}
                </div>
              )}

              <ol className={`max-h-[calc(100vh-380px)] min-h-[200px] overflow-y-auto px-2 pb-2 ${podium ? "pt-0" : "pt-2"}`}>
                {loading
                  ? Array.from({ length: 7 }).map((_, i) => <li key={i} className="m-2 h-11 rounded-lg bg-white/[0.04] motion-safe:animate-pulse" />)
                  : rows.length === 0
                    ? <li className="px-4 py-12 text-center text-[13px] text-white/50">{error ? "Unable to load verified trades. Try refreshing." : <>No closed trades yet. <Link href="/market" className="text-white underline underline-offset-4">Trade a Solcameo coin</Link>.</>}</li>
                    : <AnimatePresence initial={false}>{(podium ? rows.slice(3) : rows).map((r, i) => <Row key={r.wallet} r={r} index={i} href={explorer(r.wallet)} usd={usd(r.pnl)} />)}</AnimatePresence>}
              </ol>
              {data && <p className="border-t border-white/[0.06] px-4 py-2.5 text-[10.5px] tabular-nums text-white/30">Checked {new Date(data.checkedAt).toLocaleTimeString()} · auto-refresh 30s</p>}
            </section>

            <p className="mt-3 flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-white/35">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>Only coins launched on Solcameo count. Realized P&amp;L = SOL received from sells minus FIFO purchase cost and network fees, read from confirmed swaps in each coin&apos;s pool on Solana. Open holdings don&apos;t count, and wallets whose balances moved outside tracked swaps are excluded.</span>
            </p>
          </aside>
        </div>
      </div>
      <style>{`
        @keyframes heroGlow { 0%,100% { transform: translate(0,0) scale(1); opacity: .8; } 50% { transform: translate(-30px,20px) scale(1.08); opacity: 1; } }
        .hero-glow { animation: heroGlow 12s ease-in-out infinite; }
        @keyframes podiumSweep { from { transform: translateX(0); } to { transform: translateX(400%); } }
        .podium-sweep { animation: podiumSweep 3.2s ease-in-out 1.4s infinite; }
        @media (prefers-reduced-motion: reduce) { .hero-glow, .podium-sweep { animation: none; } }
      `}</style>
    </div>
  );
}

function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const from = current.current, start = performance.now(), dur = 1100;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur), eased = 1 - Math.pow(1 - p, 3);
      current.current = from + (value - from) * eased;
      setShown(current.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <span>{format(reduced ? value : shown)}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-[0.12em] text-white/35">{label}</p>
      <p className="mt-1 text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-white sm:text-[22px]" style={APPLE}>{value}</p>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; ariaLabel: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="relative inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}
          className={`relative h-full rounded-md px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${value === o.id ? "text-white" : "text-white/55 hover:text-white"}`}>
          {value === o.id && (
            <motion.span layoutId="tournament-window" className="absolute inset-0 rounded-md bg-white/[0.12] ring-1 ring-white/15" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Coin card: a Solcameo coin and the realized P&L traders booked on it ── */
function CoinCard({ coin, index, usd }: { coin: CoinTotal; index: number; usd: string | null }) {
  const up = coin.realizedSol >= 0;
  const label = coin.ticker ? `$${coin.ticker}` : short(coin.mint);
  const body = (
    <>
      <span aria-hidden className={`absolute -right-10 -top-10 size-32 rounded-full blur-2xl transition-opacity duration-500 group-hover:opacity-100 ${up ? "bg-lime-400/15" : "bg-rose-400/10"} opacity-60`} />
      <span className="relative flex items-center gap-2.5">
        <AgentAvatar url={coin.imageUrl} name={coin.name ?? label} seed={coin.mint} className="size-10 shrink-0 rounded-xl ring-1 ring-white/10 transition-transform duration-500 group-hover:scale-105" initialClassName="text-sm" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-white">{coin.name ?? label}</span>
          <span className="block truncate text-[11px] text-white/40" style={MONO}>{label}</span>
        </span>
        {index === 0 && up && <span className="ml-auto shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-black">#1</span>}
      </span>
      <span className="relative mt-5 block">
        <span className="block text-[10.5px] uppercase tracking-[0.12em] text-white/35">Realized</span>
        <span className={`mt-1 block text-[20px] font-semibold tabular-nums tracking-[-0.02em] ${up ? "text-lime-300" : "text-rose-300"}`} style={MONO}>{sol(coin.realizedSol, true)} <span className="text-[12px] text-white/40">SOL</span></span>
        <span className="block h-4 text-[11px] tabular-nums text-white/35">{usd ?? ""}</span>
      </span>
      <span className="relative mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[11px] tabular-nums text-white/45">
        <span>{coin.traders} trader{coin.traders === 1 ? "" : "s"}</span>
        <span>{coin.closedTrades} sell{coin.closedTrades === 1 ? "" : "s"}</span>
      </span>
    </>
  );
  const cls = "group relative block overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0b0c] p-3.5 transition-colors hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50";
  const href = coin.marketUrl;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.05, ease: "easeOut" }} whileHover={{ y: -3 }}>
      {href ? (href.startsWith("http") ? <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{body}</a> : <Link href={href} className={cls}>{body}</Link>) : <div className={cls}>{body}</div>}
    </motion.div>
  );
}

/* ── Podium (small stage) ─────────────────────────────────────────────────────
   Stages rise 3rd → 2nd → 1st, then each trader settles on top. Re-keyed on
   the window so the ceremony replays on a switch. */
const STAGE = {
  1: { height: "h-[54px]", delay: 0.5, face: "from-amber-200/25 via-amber-300/[0.07] to-transparent", num: "from-amber-100 to-amber-400", edge: "bg-amber-200/60" },
  2: { height: "h-[40px]", delay: 0.25, face: "from-white/20 via-white/[0.05] to-transparent", num: "from-white to-zinc-400", edge: "bg-white/50" },
  3: { height: "h-[30px]", delay: 0, face: "from-orange-300/20 via-orange-400/[0.05] to-transparent", num: "from-orange-200 to-orange-500", edge: "bg-orange-300/50" },
} as const;

const traderName = (r: TraderRank) => r.profileName ?? short(r.wallet);

function Verified({ r }: { r: TraderRank }) {
  return (
    <span title={`${r.closedTrades} confirmed sell${r.closedTrades === 1 ? "" : "s"} · cost basis reconciled on-chain`} className="inline-flex shrink-0 text-emerald-400">
      <BadgeCheck className="size-3.5" aria-label="Verified on-chain" />
    </span>
  );
}

function PodiumSlot({ r, href }: { r: Ranked; href: string }) {
  const stage = STAGE[(r.rank as 1 | 2 | 3)] ?? STAGE[3];
  const first = r.rank === 1;
  return (
    <div className="flex min-w-0 flex-col">
      <motion.div initial={{ opacity: 0, y: -22 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 22, delay: stage.delay + 0.3 }} className="relative z-10 flex flex-col items-center pb-2 text-center">
        <a href={href} target="_blank" rel="noopener noreferrer" title={r.wallet} className="flex min-w-0 max-w-full flex-col items-center rounded-md focus-visible:ring-2 focus-visible:ring-white/40">
          <span className="relative">
            {first && <span aria-hidden className="absolute -inset-1.5 rounded-full bg-amber-300/25 blur-md motion-safe:animate-pulse" />}
            <AgentAvatar url={r.profileImage} name={traderName(r)} seed={r.wallet} className={`relative ${first ? "size-14" : "size-11"} rounded-full ring-2 ${first ? "ring-amber-300/70" : "ring-white/20"}`} initialClassName="text-base" />
          </span>
          <span className="mt-1.5 flex max-w-full items-center gap-1">
            <span className="truncate text-[12px] font-semibold text-white">{traderName(r)}</span>
            <Verified r={r} />
          </span>
        </a>
        <span className={`mt-0.5 text-[13px] font-semibold tabular-nums ${r.pnl >= 0 ? "text-lime-300" : "text-rose-300"}`} style={MONO}>{sol(r.pnl, true)} SOL</span>
      </motion.div>
      <motion.div initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ type: "spring", stiffness: 170, damping: 22, delay: stage.delay }} style={{ transformOrigin: "bottom" }}
        className={`relative overflow-hidden rounded-t-lg border border-b-0 border-white/[0.08] bg-gradient-to-b ${stage.face} ${stage.height}`}>
        <span aria-hidden className={`absolute inset-x-0 top-0 h-px ${stage.edge}`} />
        {first && <span aria-hidden className="podium-sweep absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />}
        <span className={`absolute inset-x-0 top-1 bg-gradient-to-b bg-clip-text text-center text-[22px] font-bold leading-none text-transparent ${stage.num}`}>{r.rank}</span>
      </motion.div>
    </div>
  );
}

function Row({ r, index, href, usd }: { r: Ranked; index: number; href: string; usd: string | null }) {
  const top = r.coins?.[0];
  const secondary = top?.ticker ? `${r.closedTrades} sell${r.closedTrades === 1 ? "" : "s"} · best $${top.ticker}` : `${r.closedTrades} sell${r.closedTrades === 1 ? "" : "s"}`;
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34, delay: Math.min(index, 12) * 0.025 }}>
      <div className="group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.04]">
        <span className="w-6 shrink-0 text-center text-[12px] tabular-nums text-white/40" style={MONO}>{r.rank}</span>
        <a href={href} target="_blank" rel="noopener noreferrer" title={r.wallet} className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
          <AgentAvatar url={r.profileImage} name={traderName(r)} seed={r.wallet} className="size-9 shrink-0 rounded-full" initialClassName="text-sm" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-white">{traderName(r)}</span>
              <Verified r={r} />
              <ArrowUpRight className="size-3 shrink-0 text-white/30 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </span>
            <span className="block truncate text-[11.5px] text-white/40">{secondary}</span>
          </span>
        </a>
        <span className="shrink-0 text-right">
          <span className={`block text-[13px] font-semibold tabular-nums ${r.pnl >= 0 ? "text-lime-300" : "text-rose-300"}`} style={MONO}>{sol(r.pnl, true)} SOL</span>
          <span className="block text-[11px] tabular-nums text-white/35">{usd ?? <CopyWallet address={r.wallet} />}</span>
        </span>
      </div>
    </motion.li>
  );
}

function CopyWallet({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title="Copy wallet" style={MONO} className="inline-flex items-center gap-1 text-[11px] text-white/35 transition-colors hover:text-white"
      onClick={async () => { try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ } }}>
      {short(address)}{copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
    </button>
  );
}
