"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { getAccountExplorerUrl } from "@/lib/solana/network";
import type { LiveTokenomics } from "@/app/api/tokenomics/live/route";
import { splitShares, type SplitKey } from "@/lib/tokenomics/liveMath";
import { CountUp } from "./CountUp";
import { FLOW_NODES } from "./flowNodes";
import { TRADING_FEE_BPS } from "@/lib/meteora/feePolicy";
import { marketPath } from "@/lib/solstar/marketSlug";

// Three.js is heavy and browser-only: load it after first paint.
const FeeFlowScene = dynamic(() => import("./FeeFlowScene").then((m) => m.FeeFlowScene), { ssr: false });

const LIME = "#d7ff00";
const POLL_MS = 4000;
const FEE_RATE = TRADING_FEE_BPS / 10_000; // the flat trading fee every coin charges (1.5%)
const panel = "rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]";
const mono = { fontFamily: "var(--font-geist-mono)" } as const;
const fmtSol = (n: number, d = 3) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2));

/** Live, on-chain tokenomics: every number is read from Solana RPC a few seconds ago, never from the database. */
export function TokenomicsLive({ afterHero, afterCoins }: { afterHero?: ReactNode; afterCoins?: ReactNode } = {}) {
  const reduced = useReducedMotion();
  const solUsd = useSolUsd();
  const [data, setData] = useState<LiveTokenomics | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const prev = useRef<Map<string, number>>(new Map());
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const [volume, setVolume] = useState(100);
  const [highlight, setHighlight] = useState<SplitKey | null>(null);
  const [labels, setLabels] = useState<Record<SplitKey, { x: number; y: number }> | null>(null);

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
  const { shares, live } = useMemo(() => splitShares(t ?? { creatorEarnedSol: 0, platformEarnedSol: 0, protocolSol: 0 }), [t]);
  const ageS = data ? Math.max(0, Math.round((now - data.fetchedAt) / 1000)) : 0;
  const usd = (n: number) => (mainnet && solUsd ? `≈ $${compact(n * solUsd)}` : "");
  const empty = !!t && t.coins === 0;
  const fee = volume * FEE_RATE;
  const owed: Record<SplitKey, number> = { creator: fee * shares.creator, content: fee * shares.content, platform: fee * shares.platform, meteora: fee * shares.meteora };
  const activity = !t ? 0.4 : empty ? 0.55 : Math.min(1, 0.35 + Math.log10(1 + t.feesSol * 100) / 3);

  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-16 pt-10 text-white sm:px-8 sm:pt-14">
      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <motion.div initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40" style={mono}>Coin tokenomics</p>
        <h1 className="mt-2 text-[34px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[56px]">Every trade pays a fee.<br /><span style={{ color: LIME }}>Watch where it goes.</span></h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-white/55">Buyers move SOL along a bonding curve and each trade pays a small fee. That fee is split four ways the moment it is taken, and every number on this page is read straight from Solana, not from our database.</p>
        <div className="mt-5 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[12px] text-white/70">
          <span className="relative flex size-2"><span className={`absolute inline-flex size-full rounded-full ${error || stale ? "bg-amber-400" : "animate-ping bg-emerald-400/60"}`} /><span className={`relative size-2 rounded-full ${error || stale ? "bg-amber-400" : "bg-emerald-400"}`} /></span>
          <span className="font-semibold text-white">{error ? "Reconnecting" : stale ? "Showing last read" : "Live"}</span>
          {data && <><span className="text-white/35">·</span><span>Solana {mainnet ? "mainnet" : "devnet"}</span><span className="text-white/35">·</span><span className="tabular-nums">slot {fmtInt(data.slot)}</span><span className="text-white/35">·</span><span className="tabular-nums">updated {ageS}s ago</span></>}
        </div>
        {error && !data && <p role="alert" className="mt-3 text-sm text-amber-300">{error}</p>}
        <nav aria-label="On this page" className="mt-5 flex flex-wrap gap-2 text-[12px]">
          {[["#how-it-works", "How it works"], ["#fee-flow", "Where fees go"], ["#on-chain", "On-chain now"], ["#platform-token", "Platform token and burns"]].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white">{label}</a>
          ))}
        </nav>
      </motion.div>

      {afterHero}

      {/* ── 3D fee flow ──────────────────────────────────────────────────────── */}
      <section id="fee-flow" className={`${panel} relative mt-10 overflow-hidden`} aria-label="How a trade fee is split">
        <div aria-hidden className="pointer-events-none absolute -left-24 top-0 size-[420px] rounded-full bg-lime-400/[0.07] blur-[110px]" />
        <div className="relative h-[330px] sm:h-[440px]">
          <FeeFlowScene shares={shares} activity={activity} highlight={highlight} onLabels={setLabels} className="absolute inset-0" />
          <div className="pointer-events-none absolute left-4 top-4 space-y-1 sm:left-6 sm:top-5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/40" style={mono}>1 · Buyers climb the curve</p>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/40" style={mono}>2 · A {+(FEE_RATE * 100).toFixed(2)}% fee is taken</p>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/40" style={mono}>3 · It fans out to four owners</p>
          </div>
          {labels && FLOW_NODES.map((n) => {
            const p = labels[n.key]; if (!p) return null;
            return (
              <div key={n.key} className="pointer-events-none absolute -translate-y-1/2 transition-opacity" style={{ left: `calc(${p.x * 100}% + 18px)`, top: `${p.y * 100}%`, opacity: highlight && highlight !== n.key ? 0.35 : 1 }}>
                <p className="text-[12px] font-semibold leading-none sm:text-[13px]" style={{ color: n.color }}>{(shares[n.key] * 100).toFixed(0)}%</p>
                <p className="mt-0.5 hidden text-[11px] leading-none text-white/65 sm:block">{n.label}</p>
              </div>
            );
          })}
          {!labels && <div className="absolute inset-0 grid place-items-center text-[12px] text-white/30">Loading the curve…</div>}
        </div>
        <div className="relative grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-4">
          {FLOW_NODES.map((n) => (
            <button key={n.key} type="button" onMouseEnter={() => setHighlight(n.key)} onMouseLeave={() => setHighlight(null)} onFocus={() => setHighlight(n.key)} onBlur={() => setHighlight(null)} onClick={() => setHighlight((h) => (h === n.key ? null : n.key))}
              className="bg-[#08090a] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:outline-none" aria-pressed={highlight === n.key}>
              <p className="flex items-center gap-2 text-[12px] font-semibold text-white"><span className="size-2 rounded-full" style={{ background: n.color }} />{n.label}<span className="ml-auto tabular-nums text-white/45">{(shares[n.key] * 100).toFixed(0)}%</span></p>
              <p className="mt-1 text-[11.5px] leading-4 text-white/45">{n.note}</p>
            </button>
          ))}
        </div>
        <p className="relative px-4 py-2.5 text-[11px] text-white/35 sm:px-5">{live ? "Shares are measured from every live pool." : "Showing the published policy until the first coin collects a fee."} Platform (30%) and content (10%) share the partner wallet&apos;s 40%, because the chain holds a single partner wallet.</p>
      </section>

      {/* ── Calculator ───────────────────────────────────────────────────────── */}
      <section className={`${panel} mt-4 p-5 sm:p-6`} aria-label="Fee calculator">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold">If {fmtInt(volume)} SOL gets traded…</h2>
            <p className="mt-1 text-[12.5px] text-white/45">An illustration at the {+(FEE_RATE * 100).toFixed(2)}% trading fee, using the split above. Not a forecast.</p>
          </div>
          <p className="text-[13px] text-white/55">a fee of <b className="tabular-nums text-white">{fmtSol(fee, fee < 1 ? 3 : 2)} SOL</b> {usd(fee) && <span className="text-white/35">{usd(fee)}</span>}</p>
        </div>
        <input type="range" min={10} max={5000} step={10} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Trading volume in SOL" className="mt-4 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[#d7ff00]" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FLOW_NODES.map((n) => (
            <div key={n.key} className="rounded-xl border border-white/[0.07] bg-black/30 p-3.5">
              <p className="flex items-center gap-2 text-[11px] text-white/50"><span className="size-1.5 rounded-full" style={{ background: n.color }} />{n.label}</p>
              <p className="mt-1.5 text-[20px] font-semibold tabular-nums" style={{ color: n.key === "creator" ? LIME : undefined }}>{fmtSol(owed[n.key], owed[n.key] < 1 ? 3 : 2)} <span className="text-[11px] font-medium text-white/40">SOL</span></p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live totals ──────────────────────────────────────────────────────── */}
      <section id="on-chain" className="mt-10" aria-label="Live totals">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] sm:text-[26px]">On-chain right now</h2>
          <p className="text-[12px] text-white/40">{t ? `${fmtInt(t.coins)} coin${t.coins === 1 ? "" : "s"} · ${t.graduated} graduated` : "Reading chain…"}</p>
        </div>

        {empty && (
          <div className={`${panel} mt-4 flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between`}>
            <div>
              <p className="text-[15px] font-semibold">No coins have launched on {mainnet ? "mainnet" : "this network"} yet.</p>
              <p className="mt-1 max-w-xl text-[13px] leading-6 text-white/50">Every counter below reads straight from the pools, so they sit at zero until the first coin trades. The moment it does, you will see its fees land here within a few seconds.</p>
            </div>
            <Link href="/create" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-[13px] font-bold text-black" style={{ background: LIME }}>Launch the first one <ArrowUpRight className="size-4" /></Link>
          </div>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {([
            { k: "paid", label: "Paid to creators", value: t?.creatorClaimedSol ?? 0, note: "Claimed out of the pools. Real SOL that left the curve and reached creators.", accent: true },
            { k: "fees", label: "Trading fees collected", value: t?.feesSol ?? 0, note: "Every buy and sell, counted by the pools themselves across all coins.", accent: false },
            { k: "reserve", label: "SOL in the curves", value: t?.reserveSol ?? 0, note: "What buyers have put in. It makes selling back possible and funds graduation.", accent: false },
          ]).map((s, i) => (
            <motion.div key={s.k} initial={reduced ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-30px" }} transition={{ delay: i * 0.06, duration: 0.45 }}
              className={`${panel} p-5 ${s.accent ? "!border-[#d7ff00]/25" : ""}`}>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45" style={mono}>{s.label}</p>
              <p className="mt-3 flex items-baseline gap-2 text-[40px] font-semibold leading-none tracking-[-0.03em] sm:text-[46px]" style={s.accent ? { color: LIME } : undefined}>
                {!data ? <span className="inline-block h-10 w-36 rounded bg-white/[0.06] motion-safe:animate-pulse" /> : <CountUp value={s.value} format={(n) => fmtSol(n)} />}
                <span className="text-[13px] font-medium tracking-normal text-white/45">SOL</span>
              </p>
              <p className="mt-1.5 h-4 text-[12px] tabular-nums text-white/40">{data ? usd(s.value) : ""}</p>
              <p className="mt-2 text-[12.5px] leading-5 text-white/50">{s.note}</p>
            </motion.div>
          ))}
        </div>

        {/* earned vs claimed */}
        <div className={`${panel} mt-3 p-5 sm:p-6`}>
          <h3 className="text-[15px] font-semibold">Earned versus claimed</h3>
          <p className="mt-1 text-[12.5px] text-white/45">Fees accrue inside each pool. Creators and the platform claim them out whenever they like.</p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {[
              { who: "Creators", earned: t?.creatorEarnedSol ?? 0, claimed: t?.creatorClaimedSol ?? 0, waiting: t?.creatorUnclaimedSol ?? 0, color: LIME },
              { who: "Platform and content", earned: t?.platformEarnedSol ?? 0, claimed: t?.platformClaimedSol ?? 0, waiting: t?.platformUnclaimedSol ?? 0, color: "#a78bfa" },
            ].map((r) => (
              <div key={r.who}>
                <div className="flex items-baseline justify-between text-[12.5px]"><span className="font-medium text-white">{r.who}</span><span className="tabular-nums text-white/45">{fmtSol(r.earned)} SOL earned</span></div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/[0.07]" role="img" aria-label={`${r.who}: ${fmtSol(r.claimed)} SOL claimed of ${fmtSol(r.earned)} earned`}>
                  <motion.div className="h-full rounded-full" style={{ background: r.color }} animate={{ width: `${r.earned > 0 ? (r.claimed / r.earned) * 100 : 0}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[11.5px] tabular-nums text-white/45"><span>{fmtSol(r.claimed)} claimed</span><span>{fmtSol(r.waiting)} waiting</span></div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.07] pt-4 sm:grid-cols-4">
            {[
              { l: "Meteora's share", v: `${fmtSol(t?.protocolSol ?? 0)} SOL` },
              { l: "Tokens burned", v: t ? (t.burnedTokens > 0 ? fmtInt(t.burnedTokens) : "None yet") : "…" },
              { l: "Supply per coin", v: "1,000,000,000" },
              { l: "Mint authority", v: "Revoked" },
            ].map((x) => <div key={x.l}><p className="text-[10.5px] uppercase tracking-[0.12em] text-white/35" style={mono}>{x.l}</p><p className="mt-1 text-[14px] font-semibold tabular-nums">{x.v}</p></div>)}
          </div>
        </div>
      </section>

      {/* ── Coin by coin ─────────────────────────────────────────────────────── */}
      <section className={`${panel} mt-6 overflow-hidden`} aria-label="Per-coin live data">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Coin by coin</h2>
          <span className="text-[11px] text-white/40">Refreshes every {POLL_MS / 1000}s</span>
        </div>
        {!data ? <div className="h-32 motion-safe:animate-pulse" /> : data.coins.length === 0 ? <p className="px-5 py-10 text-center text-sm text-white/45">Coins appear here as soon as they launch.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[13px]">
              <thead className="text-[10.5px] uppercase tracking-[0.12em] text-white/35"><tr>
                <th className="px-5 py-2.5 font-medium">Coin</th><th className="px-3 py-2.5 font-medium">Curve progress</th><th className="px-3 py-2.5 text-right font-medium">In curve</th><th className="px-3 py-2.5 text-right font-medium">Fees</th><th className="px-3 py-2.5 text-right font-medium">Paid to creator</th><th className="px-3 py-2.5 text-right font-medium">Burned</th><th className="px-5 py-2.5 text-right font-medium">Pool</th>
              </tr></thead>
              <tbody>
                {data.coins.map((c) => (
                  <tr key={c.characterId} className={`border-t border-white/[0.05] transition-colors duration-700 ${flash[c.characterId] === "up" ? "bg-[#d7ff00]/[0.08]" : flash[c.characterId] === "down" ? "bg-rose-400/[0.07]" : ""}`}>
                    <td className="px-5 py-3"><Link href={marketPath(c)} className="font-semibold text-white hover:underline">{c.name}</Link> <span className="text-white/40">${c.ticker}</span></td>
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

      {afterCoins}

      <section className="mt-6 grid gap-3 md:grid-cols-3" aria-label="How to read this">
        {[
          ["The curve", "Each coin trades on a bonding curve. Buyers put SOL in, sellers take SOL out, and the price moves along the curve. When it fills, the coin graduates into a pool with locked liquidity."],
          ["Creator fees", "Creators earn a share of every trade fee. Earned is what the pool has accrued. Paid is what has been claimed out of the pool already."],
          ["Supply and burns", "Every coin has a fixed supply of 1 billion and no more can be minted. Burned tokens are measured on-chain as fixed supply minus today's supply."],
        ].map(([h, p], i) => <div key={h} className={`${panel} p-5`}><span className="text-[11px] font-semibold tabular-nums" style={{ ...mono, color: LIME }}>0{i + 1}</span><h3 className="mt-2 text-[13.5px] font-semibold">{h}</h3><p className="mt-2 text-[12.5px] leading-6 text-white/50">{p}</p></div>)}
      </section>

      <p className="mt-6 text-[11.5px] leading-5 text-white/35">
        Source: Meteora Dynamic Bonding Curve pool accounts, pool configs and token mint accounts, read from Solana RPC with failover. Creator earned is the pool&apos;s fee counter (excluding Meteora&apos;s protocol cut) × the pool&apos;s creator share. Claimed is earned minus the pool&apos;s still-unclaimed balance for that side. After a coin graduates its fees accrue in its DAMM pool and are not counted here.
        {mainnet ? "" : " Devnet SOL has no monetary value."} <Link href="/docs/launch#fees" className="text-white/60 underline underline-offset-2">How fees work</Link>
      </p>
    </div>
  );
}
