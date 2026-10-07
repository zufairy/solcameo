"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { LIVE_NETWORK } from "@/lib/solstar/liveNetwork";
import { TRADING_FEE_BPS } from "@/lib/meteora/feePolicy";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { getTxExplorerUrl } from "@/lib/solana/network";
import { formatRelativeTime } from "@/lib/solstar/relativeTime";
import { CountUp } from "./CountUp";
import { useLiveTokenomics } from "./useLiveTokenomics";
import { marketPath } from "@/lib/solstar/marketSlug";

const LIME = "#d7ff00";
const panel = "rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]";
const mono = { fontFamily: "var(--font-geist-mono)" } as const;
const fmt = (n: number, d = 3) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const int = (n: number) => Math.round(n).toLocaleString("en-US");

function useNowEvery(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

/** Live trading pulse: four counters that move as the market syncs, and the latest swaps sliding in. */
export function LivePulse() {
  const reduced = useReducedMotion();
  const pulse = useQuery(api.solstarChain.pulse, { network: LIVE_NETWORK });
  const solUsd = useSolUsd();
  const now = useNowEvery(5000);
  const fee = TRADING_FEE_BPS / 10_000;
  const stats = [
    { label: "Traded, last 24h", value: pulse?.volume24hSol ?? 0, format: (n: number) => fmt(n, 2), unit: "SOL", sub: solUsd && pulse ? `≈ $${int(pulse.volume24hSol * solUsd)}` : "" },
    { label: "Trades, last 24h", value: pulse?.trades24h ?? 0, format: int, unit: "", sub: "buys and sells across every coin" },
    { label: "Fees from that", value: (pulse?.volume24hSol ?? 0) * fee, format: (n: number) => fmt(n, 4), unit: "SOL", sub: `${(fee * 100).toFixed(1)}% of volume` },
    { label: "Combined market cap", value: pulse?.marketCapSol ?? 0, format: (n: number) => fmt(n, 1), unit: "SOL", sub: solUsd && pulse ? `≈ $${int(pulse.marketCapSol * solUsd)}` : "" },
  ];
  return (
    <section className="mt-8" aria-label="Live trading pulse">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={`${panel} p-4`}>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45" style={mono}>{s.label}</p>
            <p className="mt-2.5 flex items-baseline gap-1.5 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
              {pulse === undefined ? <span className="inline-block h-7 w-24 rounded bg-white/[0.06] motion-safe:animate-pulse" /> : <CountUp value={s.value} format={s.format} />}
              {s.unit && <span className="text-[12px] font-medium tracking-normal text-white/45">{s.unit}</span>}
            </p>
            <p className="mt-1.5 h-4 text-[11.5px] text-white/40">{s.sub}</p>
          </motion.div>
        ))}
      </div>

      <div className={`${panel} mt-3 overflow-hidden`}>
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-2.5">
          <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" /><span className="relative inline-flex size-2 rounded-full bg-emerald-400" /></span>
          <p className="text-[13px] font-semibold">Latest trades</p>
          <p className="ml-auto text-[11px] text-white/40">{pulse?.syncedAt ? `synced ${formatRelativeTime(now, pulse.syncedAt)}` : ""}</p>
        </div>
        {pulse === undefined ? <div className="h-24 motion-safe:animate-pulse" /> : !pulse.tape.length ? (
          <p className="px-4 py-8 text-center text-[13px] text-white/45">Trades appear here the moment they happen.</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            <AnimatePresence initial={false}>
              {pulse.tape.slice(0, 7).map((t) => (
                <motion.li key={t.signature} layout initial={reduced ? false : { opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className={`w-10 shrink-0 rounded-[4px] px-1.5 py-0.5 text-center text-[10.5px] font-bold uppercase ${t.side === "buy" ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>{t.side}</span>
                  <Link href={marketPath(t)} className="font-semibold text-white hover:underline">${t.ticker}</Link>
                  <span className="tabular-nums text-white/70">{fmt(t.sol, t.sol < 1 ? 3 : 2)} SOL</span>
                  <span className="hidden text-white/35 sm:inline" style={mono}>{t.wallet}</span>
                  <a href={getTxExplorerUrl(t.signature)} target="_blank" rel="noreferrer" className="ml-auto text-[11.5px] tabular-nums text-white/40 hover:text-white">{formatRelativeTime(now, t.time)}</a>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}

type Integration = { name: string; tag: string; accent: string; what: string; live: string };

/** Every system the money and the data move through, with what it does here and a live reading from it. */
export function Integrations() {
  const { data } = useLiveTokenomics();
  const pulse = useQuery(api.solstarChain.pulse, { network: LIVE_NETWORK });
  const solUsd = useSolUsd();
  const t = data?.totals;
  const items: Integration[] = [
    { name: "Meteora Dynamic Bonding Curve", tag: "Launch and trade", accent: LIME, what: "Every coin is launched on a DBC pool. The curve sets the price, holds the SOL, counts every fee on-chain and decides when a coin graduates. This page reads those counters directly.", live: t ? `${t.coins} pools · ${fmt(t.reserveSol, 2)} SOL held` : "Reading pools…" },
    { name: "Meteora DAMM v2", tag: "After graduation", accent: "#a78bfa", what: "When a curve fills, liquidity moves into a DAMM v2 pool with locked liquidity. Trading continues and the creator keeps collecting pool fees.", live: t ? `${t.graduated} graduated` : "Reading pools…" },
    { name: "Jupiter", tag: "Swaps and price check", accent: "#38bdf8", what: "Each trade quote is compared with Jupiter's best route so you can see the price you get is fair. Agents that hold SOL but need USDC are topped up through one Jupiter swap, and the other way round for network fees.", live: solUsd ? `SOL $${solUsd.toFixed(2)}` : "Fetching price…" },
    { name: "Helius", tag: "RPC and priority fees", accent: "#fb923c", what: "Reads of pools and balances, transaction landing and priority-fee estimates all go through Helius, with a public fallback if it is ever slow.", live: data ? `slot ${int(data.slot)}` : "Connecting…" },
    { name: "Convex", tag: "Realtime sync", accent: "#34d399", what: "A sync copies each pool's price, swaps and holders into Convex, so prices, positions and the leaderboard update live in your browser without polling the chain.", live: pulse?.syncedAt ? `${pulse.coins} coins synced` : "Syncing…" },
    { name: "Privy and Solana wallets", tag: "Sign in and sign", accent: "#f472b6", what: "Sign in with email, Google or any Solana wallet. You approve every trade yourself; Solcameo never holds your coin balance.", live: "Non-custodial trading" },
    { name: "USDC on Solana", tag: "Pay for generation", accent: "#60a5fa", what: "Agents pay for videos and images in USDC, on-chain, before the work starts. That margin is the revenue that buys and burns the platform token.", live: "Paid on-chain" },
  ];
  return (
    <section className="mt-10" aria-label="Integrations">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40" style={mono}>Under the hood</p>
      <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.03em] sm:text-[34px]">What it is built on</h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-7 text-white/55">Nothing here is a black box. Each piece does one job, and the badge on each card is a live reading from it.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it, i) => (
          <motion.div key={it.name} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-30px" }} transition={{ delay: (i % 3) * 0.06 }} className={`${panel} group relative overflow-hidden p-5 transition-colors hover:border-white/20`}>
            <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full opacity-[0.12] blur-2xl transition-opacity group-hover:opacity-25" style={{ background: it.accent }} />
            <div className="relative flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-[8px] text-[13px] font-bold text-black" style={{ background: it.accent }}>{it.name[0]}</span>
              <div className="min-w-0"><p className="truncate text-[14px] font-semibold">{it.name}</p><p className="text-[11px] text-white/45">{it.tag}</p></div>
            </div>
            <p className="relative mt-3 text-[12.5px] leading-6 text-white/60">{it.what}</p>
            <p className="relative mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] tabular-nums text-white/70"><span className="size-1.5 rounded-full" style={{ background: it.accent }} />{it.live}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
