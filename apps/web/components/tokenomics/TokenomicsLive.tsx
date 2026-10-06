"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { getAccountExplorerUrl } from "@/lib/solana/network";
import type { LiveTokenomics } from "@/app/api/tokenomics/live/route";
import { FlipCounter } from "./FlipCounter";

const LIME = "#d7ff00";
const POLL_MS = 4000;
const fmtSol = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2));

type Stat = { key: string; label: string; value: string; unit: string; explain: string; usd?: number; accent?: boolean };

/** Live, on-chain tokenomics: every number is read from Solana RPC a few seconds ago, never from the database. */
export function TokenomicsLive() {
  const reduced = useReducedMotion();
  const solUsd = useSolUsd();
  const [data, setData] = useState<LiveTokenomics | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const prev = useRef<Map<string, number>>(new Map());
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const pull = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/tokenomics/live", { signal: ctrl.signal, cache: "no-store" });
        const json = (await res.json()) as LiveTokenomics & { ok: boolean; error?: string; stale?: boolean };
        if (!alive) return;
        if (!json.ok) { setError(json.error ?? "RPC unavailable"); return; }
        // flash rows whose fees or reserve moved since the last read
        const changes: Record<string, "up" | "down"> = {};
        for (const c of json.coins) {
          const k = c.characterId, last = prev.current.get(k), cur = c.feesSol + c.reserveSol;
          if (last !== undefined && Math.abs(cur - last) > 1e-9) changes[k] = cur > last ? "up" : "down";
          prev.current.set(k, cur);
        }
        setData(json); setError(""); setStale(!!json.stale);
        if (Object.keys(changes).length) { setFlash(changes); setTimeout(() => alive && setFlash({}), 1400); }
      } catch { if (alive && !ctrl.signal.aborted) setError("RPC unavailable. Retrying…"); }
    };
    void pull();
    const t = setInterval(pull, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; ctrl.abort(); clearInterval(t); clearInterval(tick); };
  }, []);

  const mainnet = data?.network === "mainnet-beta";
  const t = data?.totals;
  const stats: Stat[] = useMemo(() => !t ? [] : [
    { key: "paid", label: "Paid to creators", value: fmtSol(t.creatorClaimedSol), unit: "SOL", usd: t.creatorClaimedSol, accent: true, explain: "Creator fees already claimed out of the pools. This is real money that left the curve and reached creators." },
    { key: "earned", label: "Creator fees earned", value: fmtSol(t.creatorEarnedSol), unit: "SOL", usd: t.creatorEarnedSol, explain: `Creators' share of every trade fee so far. ${fmtSol(t.creatorUnclaimedSol)} SOL is waiting to be claimed.` },
    { key: "fees", label: "Trading fees collected", value: fmtSol(t.feesSol), unit: "SOL", usd: t.feesSol, explain: "Every buy and sell pays a small fee. This is the total collected across all coins, counted by the pools themselves." },
    { key: "reserve", label: "SOL in the curves", value: fmtSol(t.reserveSol), unit: "SOL", usd: t.reserveSol, explain: "SOL that buyers have put into live curves. It is what makes selling back possible, and it funds graduation." },
    { key: "burn", label: "Tokens burned", value: fmtInt(t.burnedTokens), unit: "tokens", explain: t.burnedTokens > 0 ? "Tokens permanently destroyed, measured as the fixed supply minus today's supply on-chain." : "None yet. Supply is fixed and nothing is minted, and a buyback and burn policy is only proposed so far." },
    { key: "coins", label: "Coins live", value: fmtInt(t.coins), unit: `${t.graduated} graduated`, explain: "Characters with a launched coin. Graduated coins have moved into a pool with permanently locked liquidity." },
  ], [t]);

  const total = t ? Math.max(1e-12, t.creatorEarnedSol + t.platformEarnedSol + t.protocolSol) : 1;
  const split = t ? [
    { k: "Creators", v: t.creatorEarnedSol, c: LIME },
    { k: "Platform and content", v: t.platformEarnedSol, c: "#7C4DFF" },
    { k: "Meteora", v: t.protocolSol, c: "#00FFD1" },
  ] : [];
  const ageS = data ? Math.max(0, Math.round((now - data.fetchedAt) / 1000)) : 0;

  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-24 pt-10 text-white sm:px-8 sm:pt-14">
      <motion.div initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">Tokenomics</p>
        <h1 className="mt-2 text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[52px]">Every fee. Every coin.<br /><span style={{ color: LIME }}>Live on Solana.</span></h1>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-white/55">These numbers are read straight from the Solana blockchain every few seconds. Nothing is estimated from a database, so what you see is what the pools hold right now.</p>
        <div className="mt-5 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[12px] text-white/70">
          <span className="relative flex size-2"><span className={`absolute inline-flex size-full rounded-full ${error || stale ? "bg-amber-400" : "animate-ping bg-emerald-400/60"}`} /><span className={`relative size-2 rounded-full ${error || stale ? "bg-amber-400" : "bg-emerald-400"}`} /></span>
          <span className="font-semibold text-white">{error ? "Reconnecting" : stale ? "Showing last read" : "Live"}</span>
          {data && <><span className="text-white/35">·</span><span>Solana {mainnet ? "mainnet" : "devnet"}</span><span className="text-white/35">·</span><span className="tabular-nums">slot {fmtInt(data.slot)}</span><span className="text-white/35">·</span><span className="tabular-nums">updated {ageS}s ago</span></>}
        </div>
        {error && !data && <p role="alert" className="mt-3 text-sm text-amber-300">{error}</p>}
      </motion.div>

      <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Live totals">
        {!data ? Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[176px] rounded-xl bg-white/[0.04] motion-safe:animate-pulse" />) : stats.map((s, i) => (
          <motion.div key={s.key} initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.45 }}
            className={`glass3d relative overflow-hidden rounded-xl p-5 ${s.accent ? "ring-1 ring-[#d7ff00]/25" : ""}`}>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">{s.label}</p>
            <p className="mt-3 flex items-baseline gap-2 text-[40px] font-semibold tracking-[-0.03em] sm:text-[44px]" style={s.accent ? { color: LIME } : undefined}>
              <FlipCounter value={s.value} /><span className="text-[13px] font-medium tracking-normal text-white/45">{s.unit}</span>
            </p>
            {mainnet && s.usd !== undefined && solUsd ? <p className="mt-1 text-[12px] tabular-nums text-white/40">≈ ${compact(s.usd * solUsd)}</p> : <p className="mt-1 h-[18px]" />}
            <p className="mt-2 text-[12.5px] leading-5 text-white/50">{s.explain}</p>
          </motion.div>
        ))}
      </section>

      {t && (
        <section className="glass3d mt-6 rounded-xl p-5 sm:p-6" aria-label="Fee split">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Where every trading fee goes</h2>
            <p className="text-[12px] text-white/40">Split measured from the pools, not assumed</p>
          </div>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label="Fee split between creators, platform and Meteora">
            {split.map((s) => <motion.div key={s.k} animate={{ width: `${(s.v / total) * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} style={{ background: s.c }} />)}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {split.map((s) => (
              <div key={s.k}>
                <p className="flex items-center gap-2 text-[12px] text-white/55"><span className="size-2 rounded-full" style={{ background: s.c }} />{s.k}<span className="tabular-nums text-white/35">{((s.v / total) * 100).toFixed(0)}%</span></p>
                <p className="mt-1 text-[22px] font-semibold tabular-nums">{fmtSol(s.v)} <span className="text-[12px] font-medium text-white/40">SOL</span></p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12px] leading-5 text-white/40">Platform and content together are the second 40%: half pays for each character&apos;s next videos, half runs Solcameo. Meteora&apos;s share is read from the pool&apos;s own protocol fee counter.</p>
        </section>
      )}

      <section className="glass3d mt-6 overflow-hidden rounded-xl" aria-label="Per-coin live data">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Coin by coin</h2>
          <span className="text-[11px] text-white/40">Refreshes every {POLL_MS / 1000}s</span>
        </div>
        {!data ? <div className="h-40 motion-safe:animate-pulse" /> : data.coins.length === 0 ? <p className="px-5 py-10 text-center text-sm text-white/45">No coins have launched yet. <Link href="/create" className="text-white underline underline-offset-4">Launch the first one</Link>.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[13px]">
              <thead className="text-[10.5px] uppercase tracking-[0.12em] text-white/35"><tr>
                <th className="px-5 py-2.5 font-medium">Coin</th><th className="px-3 py-2.5 font-medium">Curve progress</th><th className="px-3 py-2.5 text-right font-medium">In curve</th><th className="px-3 py-2.5 text-right font-medium">Fees</th><th className="px-3 py-2.5 text-right font-medium">Paid to creator</th><th className="px-3 py-2.5 text-right font-medium">Burned</th><th className="px-5 py-2.5 text-right font-medium">Pool</th>
              </tr></thead>
              <tbody>
                {data.coins.map((c) => (
                  <tr key={c.characterId} className={`border-t border-white/[0.05] transition-colors duration-700 ${flash[c.characterId] === "up" ? "bg-[#d7ff00]/[0.08]" : flash[c.characterId] === "down" ? "bg-rose-400/[0.07]" : ""}`}>
                    <td className="px-5 py-3"><Link href={`/market/${c.characterId}`} className="font-semibold text-white hover:underline">{c.name}</Link> <span className="text-white/40">${c.ticker}</span></td>
                    <td className="px-3 py-3"><div className="flex items-center gap-2"><div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10"><motion.div className="h-full rounded-full" style={{ background: LIME }} animate={{ width: `${c.progress * 100}%` }} transition={{ duration: 0.8 }} /></div><span className="w-16 text-[11px] tabular-nums text-white/50">{c.migrated ? "Graduated" : `${(c.progress * 100).toFixed(1)}%`}</span></div></td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtSol(c.reserveSol)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtSol(c.feesSol)}</td>
                    <td className="px-3 py-3 text-right tabular-nums" style={{ color: c.creatorClaimedSol > 0 ? LIME : undefined }}>{fmtSol(c.creatorClaimedSol)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-white/60">{fmtInt(c.burnedTokens)}</td>
                    <td className="px-5 py-3 text-right"><a href={getAccountExplorerUrl(c.pool)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-white/45 hover:text-white">{c.pool.slice(0, 4)}…{c.pool.slice(-4)}<ExternalLink className="size-3" /></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-3" aria-label="How to read this">
        {[
          ["The curve", "Each coin trades on a bonding curve. Buyers put SOL in, sellers take SOL out, and the price moves along the curve. When it fills, the coin graduates into a pool with locked liquidity."],
          ["Creator fees", "Creators earn a share of every trade fee. Earned is what the pool has accrued. Paid is what has been claimed out of the pool already."],
          ["Supply and burns", "Every coin has a fixed supply of 1 billion and no more can be minted. Burned tokens are measured on-chain as fixed supply minus today's supply."],
        ].map(([h, p]) => <div key={h} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5"><h3 className="text-[13px] font-semibold">{h}</h3><p className="mt-2 text-[12.5px] leading-6 text-white/50">{p}</p></div>)}
      </section>

      <p className="mt-6 text-[11.5px] leading-5 text-white/35">
        Source: Meteora Dynamic Bonding Curve pool accounts, pool configs and token mint accounts, read from Solana RPC with failover. Creator earned is the pool&apos;s fee counter (excluding Meteora&apos;s protocol cut) × the pool&apos;s creator share. Paid is earned minus the pool&apos;s unclaimed creator balance. After a coin graduates its fees accrue in its DAMM pool and are not counted here.
        {mainnet ? "" : " Devnet SOL has no monetary value."} <Link href="/docs/launch#fees" className="text-white/60 underline underline-offset-2">How fees work</Link>
      </p>
    </div>
  );
}
