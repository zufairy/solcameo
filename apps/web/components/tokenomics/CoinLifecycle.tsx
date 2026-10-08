"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { LIVE_NETWORK } from "@/lib/solstar/liveNetwork";
import { FEE_SPLIT_PERCENT, TRADING_FEE_BPS } from "@/lib/meteora/feePolicy";
import { CountUp } from "./CountUp";
import { CoinStageArt } from "./CoinStageArt";
import { useLiveTokenomics } from "./useLiveTokenomics";

const LIME = "#d7ff00";
const panel = "rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]";
const mono = { fontFamily: "var(--font-geist-mono)" } as const;
const fmt = (n: number, d = 3) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const int = (n: number) => Math.round(n).toLocaleString("en-US");

type Stat = { label: string; value: number; format: (n: number) => string };

/**
 * One coin's life in six steps, each beside the live number that proves it: the 3D scene lights up the part being
 * explained while the figures underneath are read from the market (Convex) and the pools (Solana).
 */
export function CoinLifecycle() {
  const reduced = useReducedMotion();
  const { data } = useLiveTokenomics();
  const pulse = useQuery(api.solstarChain.pulse, { network: LIVE_NETWORK });
  const [active, setActive] = useState(0);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (manual || reduced) return;
    const t = setInterval(() => setActive((a) => (a + 1) % 6), 5200);
    return () => clearInterval(t);
  }, [manual, reduced]);

  const t = data?.totals;
  const fee = TRADING_FEE_BPS / 10_000;
  // Average curve fill of coins still on the curve places the ball; the closest coin to graduating is called out.
  const onCurve = (data?.coins ?? []).filter((c) => !c.migrated);
  const avgFill = onCurve.length ? onCurve.reduce((n, c) => n + c.progress, 0) / onCurve.length : 0.35;
  const nearest = [...onCurve].sort((a, b) => b.progress - a.progress)[0];
  const vol = pulse?.volume24hSol ?? 0;

  const steps = useMemo<{ title: string; body: string; stats: Stat[]; link?: { href: string; label: string } }[]>(() => [
    { title: "A coin is born", body: "Each AI character gets its own coin on a Meteora Dynamic Bonding Curve. The supply is fixed at 1,000,000,000 and the mint authority is revoked, so nobody can mint more.",
      stats: [{ label: "Coins live", value: pulse?.coins ?? t?.coins ?? 0, format: int }, { label: "Graduated", value: pulse?.graduated ?? t?.graduated ?? 0, format: int }] },
    { title: "Traders buy and sell on the curve", body: "Trades happen against the curve itself with SOL, so there is always a price and always a buyer. Every quote is shown beside Jupiter's, so you can see you are not overpaying.",
      stats: [{ label: "SOL traded, 24h", value: vol, format: (n) => fmt(n, 2) }, { label: "Trades, 24h", value: pulse?.trades24h ?? 0, format: int }, { label: "Market cap, SOL", value: pulse?.marketCapSol ?? 0, format: (n) => fmt(n, 1) }] },
    { title: `Every trade pays ${(fee * 100).toFixed(1)}%`, body: `A flat ${(fee * 100).toFixed(1)}% fee is taken on each trade and split the moment it lands: ${FEE_SPLIT_PERCENT.meteora}% to Meteora, ${FEE_SPLIT_PERCENT.creator}% to the creator, ${FEE_SPLIT_PERCENT.platform}% to Solcameo and ${FEE_SPLIT_PERCENT.content}% to the character's content budget.`,
      stats: [{ label: "Fees from 24h volume", value: vol * fee, format: (n) => fmt(n, 4) }, { label: "Fees collected, all time", value: t?.feesSol ?? 0, format: (n) => fmt(n, 3) }] },
    { title: "Creators get paid, the character keeps posting", body: "The creator's 40% builds up inside the pool and they claim it in one click, paid in SOL. The 10% content budget funds the character's next videos, so trading volume turns directly into more content and more attention.",
      stats: [{ label: "Paid to creators", value: t?.creatorClaimedSol ?? 0, format: (n) => fmt(n, 3) }, { label: "Waiting to be claimed", value: t?.creatorUnclaimedSol ?? 0, format: (n) => fmt(n, 3) }] },
    { title: "Graduation to Meteora DAMM v2", body: "When the curve has collected its target SOL the coin graduates: its liquidity moves into a Meteora DAMM v2 pool and is locked. Trading carries on with deeper liquidity and the creator keeps earning pool fees.",
      stats: [{ label: nearest ? `Closest: $${nearest.ticker}` : "Average curve fill", value: (nearest?.progress ?? avgFill) * 100, format: (n) => `${n.toFixed(1)}%` }, { label: "SOL held in curves", value: t?.reserveSol ?? 0, format: (n) => fmt(n, 2) }],
      link: nearest ? { href: `/market/${nearest.characterId}`, label: `Watch $${nearest.ticker}` } : undefined },
    { title: "Supply only ever goes down", body: "Tokens that leave circulation are burned for good, and burns are measured on-chain as fixed supply minus today's supply. Separately, 30% of Solcameo's own revenue buys SOLCAMEO and half of that is burned each week.",
      stats: [{ label: "Coin tokens burned", value: t?.burnedTokens ?? 0, format: int }, { label: "Supply per coin", value: 1_000_000_000, format: int }],
      link: { href: "#platform-token", label: "See the platform token burn" } },
  ], [pulse, t, vol, fee, nearest, avgFill]);

  const pick = (i: number) => { setManual(true); setActive(i); };
  const step = steps[active];

  return (
    <section className="mt-10" aria-label="How a coin works" id="how-it-works">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40" style={mono}>How it works</p>
      <h2 className="mt-2 text-[28px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[40px]">The life of a coin, <span style={{ color: LIME }}>in six steps</span></h2>
      <p className="mt-3 max-w-2xl text-[14.5px] leading-7 text-white/55">Each step is drawn as a short animation. Pick one, or let it play. The numbers on the picture are live.</p>

      <div className="mt-6 grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className={`${panel} relative min-h-[320px] overflow-hidden lg:min-h-[520px]`}>
          <div aria-hidden className="pointer-events-none absolute -left-16 top-10 size-[380px] rounded-full bg-lime-400/[0.06] blur-[100px]" />
          <CoinStageArt stage={active} fill={avgFill} feePct={String(+(fee * 100).toFixed(2))} className="absolute inset-x-3 bottom-[108px] top-4 sm:inset-x-8" />
          <div className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/40" style={mono}>Step {active + 1} of 6</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">{step.title}</p>
            </div>
            <div className="flex gap-3">
              {step.stats.map((s) => (
                <div key={s.label} className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-right backdrop-blur-md">
                  <p className="text-[18px] font-semibold tabular-nums leading-none" style={{ color: LIME }}><CountUp value={s.value} format={s.format} /></p>
                  <p className="mt-1 text-[10.5px] text-white/50">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <ol className="space-y-2" onMouseLeave={() => setManual(false)}>
          {steps.map((s, i) => (
            <li key={s.title}>
              <button type="button" onClick={() => pick(i)} onMouseEnter={() => pick(i)} onFocus={() => pick(i)} aria-current={active === i ? "step" : undefined}
                className={`relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border p-3.5 text-left transition-colors ${active === i ? "border-[#d7ff00]/35 bg-[#d7ff00]/[0.06]" : "border-white/10 bg-white/[0.025] hover:bg-white/[0.05]"}`}>
                <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${active === i ? "text-black" : "bg-white/10 text-white/60"}`} style={active === i ? { background: LIME } : undefined}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-white">{s.title}</span>
                  <span className={`block overflow-hidden text-[12.5px] leading-relaxed text-white/60 transition-all duration-300 ${active === i ? "mt-1 max-h-40 opacity-100" : "max-h-0 opacity-0"}`}>
                    {s.body}
                    {s.link && <Link href={s.link.href} className="ml-1 font-medium underline underline-offset-2" style={{ color: LIME }}>{s.link.label}</Link>}
                  </span>
                </span>
                {active === i && !manual && !reduced && <motion.span aria-hidden className="absolute inset-x-0 bottom-0 h-px origin-left" style={{ background: LIME }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 5.2, ease: "linear" }} key={`bar-${active}`} />}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
