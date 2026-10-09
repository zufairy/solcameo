"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { getAccountExplorerUrl, getTxExplorerUrl } from "@/lib/solana/network";
import { BUYBACK_SPLIT, REVENUE_SPLIT, TIERS, TOKEN_SYMBOL, TOTAL_SUPPLY } from "@/lib/tokenomics/platformToken";
import { AllocationRing } from "./AllocationRing";
import { TierLadder } from "./TierLadder";
import { usePlatformToken } from "./usePlatformToken";


const LIME = "#d7ff00";
const card = "rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]";
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));
const usd = (micro: number) => `$${(micro / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const PERKS: ReadonlyArray<{ name: string; status: "Live" | "Operator-run" | "Planned"; note: string }> = [
  { name: "Holder discount on generations", status: "Live", note: "Image, Explore and motion video, caption and hook generations are discounted by your tier, read from your wallet balance. Active once the token mint is configured." },
  { name: "Weekly revenue epochs", status: "Live", note: "Each closed week is frozen automatically from on-chain settled spend and shown below." },
  { name: "Buyback and burn", status: "Operator-run", note: "Burns are executed by the team from the treasury and every burn transaction is published here." },
  { name: "Holder rewards payout", status: "Planned", note: "Reward weight follows your tier. The distribution job is not live yet; no payout is promised until it is." },
  { name: `New creator coins paired with ${TOKEN_SYMBOL}`, status: "Planned", note: "Needs validation of Meteora custom quote tokens before any change." },
  { name: "Launch burn and extra agent slots", status: "Planned", note: "Spending tokens to launch a coin, and tier-based free agent slots." },
];

function Pill({ s }: { s: "Live" | "Operator-run" | "Planned" }) {
  const c = s === "Live" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : s === "Operator-run" ? "border-sky-400/40 bg-sky-400/10 text-sky-300" : "border-white/15 bg-white/5 text-white/50";
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c}`}>{s}</span>;
}

export function PlatformTokenSection() {
  const reduced = useReducedMotion();
  const { data, error } = usePlatformToken();

  const launched = !!data?.launched;
  const supply = data?.supply ?? TOTAL_SUPPLY;
  const burned = data?.burned ?? 0;
  const locked = (data?.locked?.team ?? 0) + (data?.locked?.treasury ?? 0) + (data?.locked?.rewards ?? 0);
  const circ = data?.circulating ?? 0;
  const parts = launched ? [
    { k: "Circulating", v: circ, c: LIME }, { k: "Team, treasury and rewards", v: locked, c: "#7dd3fc" }, { k: "Burned", v: burned, c: "#fb7185" },
  ] : [];

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-10 sm:px-6" aria-labelledby="platform-token">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-widest" style={{ borderColor: `${LIME}55`, color: LIME }}>Platform token</span>
        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${launched ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-amber-300/40 bg-amber-300/10 text-amber-200"}`}>{launched ? "Live on-chain" : data ? "Launching soon" : "Reading chain…"}</span>
        {data?.stale && <span className="text-[11px] text-amber-300">showing last good read</span>}
      </div>
      <h2 id="platform-token" className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">${TOKEN_SYMBOL}: the token the whole platform feeds</h2>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-white/60">Every creator coin pays fees to Solcameo, and every video and image an agent makes pays a margin. That money is counted in public each week, and 30% of it buys {TOKEN_SYMBOL}. The more the platform is used, the more is bought and burned, and the more a holder&apos;s tier is worth. Real revenue drives it, not emissions.</p>

      <h3 className="mt-12 text-lg font-semibold text-white">On-chain right now</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Total supply", v: launched ? compact(supply) : compact(TOTAL_SUPPLY), s: launched ? "read from the mint" : "fixed at launch" },
          { l: "Burned", v: launched ? compact(burned) : "0", s: launched ? `${(data?.burnedPct ?? 0).toFixed(3)}% of initial supply` : "burns start with the first epoch" },
          { l: "Circulating", v: launched ? compact(circ) : "n/a", s: "supply minus team, treasury and rewards wallets" },
          { l: "Revenue treasury", v: data?.revenue.usdc != null ? `$${fmt(data.revenue.usdc, 2)}` : "n/a", s: data?.revenue.sol != null ? `${fmt(data.revenue.sol, 3)} SOL for fees` : "USDC held by the platform" },
        ].map((x, i) => (
          <motion.div key={x.l} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={card}>
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">{x.l}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-white">{x.v}</p>
            <p className="mt-1 text-[11.5px] text-white/45">{x.s}</p>
          </motion.div>
        ))}
      </div>
      {error && <p className="mt-3 text-xs text-amber-300" role="status">{error}</p>}

      {launched && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className={card}>
            <p className="text-sm font-semibold text-white">Where the supply sits</p>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-white/5">
              {parts.map((p) => <div key={p.k} style={{ width: `${Math.max(0, (p.v / TOTAL_SUPPLY) * 100)}%`, background: p.c }} className="transition-all duration-700" title={`${p.k}: ${compact(p.v)}`} />)}
            </div>
            <ul className="mt-3 space-y-1.5 text-[12.5px] text-white/65">{parts.map((p) => <li key={p.k} className="flex items-center justify-between"><span className="flex items-center gap-2"><i className="size-2 rounded-full" style={{ background: p.c }} />{p.k}</span><span className="tabular-nums text-white">{compact(p.v)}</span></li>)}</ul>
            {data?.mint && <a href={getAccountExplorerUrl(data.mint)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-white/50 hover:text-white">Token mint {short(data.mint)} <ExternalLink className="size-3" /></a>}
          </div>
          <div className={card}>
            <p className="text-sm font-semibold text-white">Largest holders</p>
            <ul className="mt-3 space-y-2">
              {(data?.holders ?? []).slice(0, 8).map((h) => (
                <li key={h.owner} className="text-[12.5px]">
                  <div className="flex items-center justify-between gap-2 text-white/70">
                    <a href={getAccountExplorerUrl(h.owner)} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 hover:text-white">
                      <span className="font-mono">{short(h.owner)}</span>
                      <span className="truncate text-[10.5px] text-white/40">{h.label ?? (h.kind === "program" ? "pool or program" : TIERS.find((t) => t.key === h.tier)?.label)}</span>
                    </a>
                    <span className="tabular-nums text-white">{h.pct.toFixed(2)}%</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-white/5"><div className="h-1 rounded-full" style={{ width: `${Math.min(100, h.pct * 2)}%`, background: LIME }} /></div>
                </li>
              ))}
              {!(data?.holders ?? []).length && <li className="text-xs text-white/40">No holders to show yet.</li>}
            </ul>
          </div>
        </div>
      )}

      <h3 className="mt-12 text-lg font-semibold text-white">Weekly epochs</h3>
      <p className="mt-1 text-[13px] text-white/50">Each Monday the week that just ended is frozen from USDC that really settled to the treasury. Split: {REVENUE_SPLIT.buybackBps / 100}% buys {TOKEN_SYMBOL} ({BUYBACK_SPLIT.burnBps / 100}% of that burned, {BUYBACK_SPLIT.rewardsBps / 100}% to holder rewards), {REVENUE_SPLIT.opsBps / 100}% pays API and gas costs, {REVENUE_SPLIT.treasuryBps / 100}% goes to the treasury.</p>
      <div className={`${card} mt-4 overflow-x-auto p-0`}>
        <table className="w-full min-w-[640px] text-left text-[12.5px]">
          <thead className="text-[10.5px] uppercase tracking-wider text-white/40"><tr>{["Week of", "Settled spend", "Revenue", "Buyback", "Ops", "Treasury", "Burn"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody className="text-white/75">
            {(data?.epochs ?? []).map((e) => (
              <tr key={e.id} className="border-t border-white/5">
                <td className="px-4 py-2.5">{new Date(e.epochStart).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}{e.truncated ? " *" : ""}</td>
                <td className="px-4 py-2.5 tabular-nums">{usd(e.settledMicro)}</td><td className="px-4 py-2.5 tabular-nums">{usd(e.revenueMicro)}</td>
                <td className="px-4 py-2.5 tabular-nums" style={{ color: LIME }}>{usd(e.buybackMicro)}</td><td className="px-4 py-2.5 tabular-nums">{usd(e.opsMicro)}</td><td className="px-4 py-2.5 tabular-nums">{usd(e.treasuryMicro)}</td>
                <td className="px-4 py-2.5">{e.burnSig ? <a href={getTxExplorerUrl(e.burnSig)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-rose-300 hover:underline">{compact(Number(e.burnTokens ?? 0))} <ExternalLink className="size-3" /></a> : <span className="text-white/35">pending</span>}</td>
              </tr>
            ))}
            {!(data?.epochs ?? []).length && <tr><td colSpan={7} className="px-4 py-6 text-center text-white/40">The first epoch appears after the first full week of mainnet activity.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-14">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">Supply</p>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-white sm:text-[28px]">One billion tokens, five buckets</h3>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-white/50">Hover a slice to see what it is for and when it unlocks. These reserved allocations and vesting are planned; the platform fair-launch interface does not apply them yet. <Link href="/tokenomics/launch" className="underline underline-offset-2 hover:text-white">Launch details</Link></p>
        <div className={`${card} mt-5 sm:p-7`}><AllocationRing /></div>
      </div>

      <div className="mt-14">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">Holders</p>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-white sm:text-[28px]">Hold more, pay less, earn more</h3>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-white/50">Four tiers by balance. Drag the slider to see what a $10 video costs at any holding.</p>
        <div className="mt-5"><TierLadder /></div>
      </div>

      <h3 className="mt-12 text-lg font-semibold text-white">What is live and what is not</h3>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {PERKS.map((p) => <li key={p.name} className={card}><div className="flex items-start justify-between gap-3"><h4 className="text-sm font-semibold text-white">{p.name}</h4><Pill s={p.status} /></div><p className="mt-1.5 text-[12.5px] leading-relaxed text-white/55">{p.note}</p></li>)}
      </ul>
      <p className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-[12px] leading-relaxed text-white/45">Not investment advice. {TOKEN_SYMBOL} can lose value, and buybacks do not guarantee a price. Revenue depends on real usage and can be small or zero in a given week. Rewards are not promised until the payout job is live. Figures above come from Solana RPC and the platform ledger.</p>
    </section>
  );
}
