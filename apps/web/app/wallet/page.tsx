"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Reveal } from "@/components/landing/reveal";
import AddFundsButton from "@/components/wallet/AddFundsButton";
import WalletReceiveModal from "@/components/wallet/WalletReceiveModal";
import {
  Plus, Copy, Check, ArrowUpRight, ArrowRight, ArrowDownToLine, Pencil,
  TrendingUp, Bot, Megaphone, RefreshCw, Sparkles,
} from "lucide-react";

const EASE = "cubic-bezier(0.32,0.72,0,1)";

type Agent = FunctionReturnType<typeof api.influencers.listByCreators>[number];
type Campaign = FunctionReturnType<typeof api.campaigns.listByCreators>[number];

/* ── helpers ──────────────────────────────────────────────────────────────── */
function fmtUsd(n: number, dec = 0) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(dec)}`;
}
function fmtUsdFull(n: number) {
  return `$${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function shortAddr(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/* ── on-chain wallet balance ──────────────────────────────────────────────── */
function useOnchainBalance(wallet: string | null) {
  const [sol, setSol] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // The route deliberately NEVER returns a confident $0 on an RPC error (429/
  // timeout) — it sends { ok:false }. Track that here so the UI shows "—"/retry
  // instead of a fake $0.00 that looks like an empty wallet.
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!wallet) return;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/agent-wallet-balance?wallet=${encodeURIComponent(wallet)}`);
      const data = (await res.json()) as { ok?: boolean; sol?: number; usdc?: number };
      if (data.ok) {
        setSol(data.sol ?? 0); setUsdc(data.usdc ?? 0); setUnavailable(false);
      } else {
        setUnavailable(true); // keep the last known sol/usdc rather than faking 0
      }
    } catch {
      setUnavailable(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
    const id = setInterval(() => void load(true), 20_000);
    return () => clearInterval(id);
  }, [load]);

  return { sol, usdc, loading, unavailable, refresh: () => load() };
}

/* ── primitives ───────────────────────────────────────────────────────────── */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-lime-400/[0.07] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-lime-200/90 ring-1 ring-lime-400/20 font-[family-name:var(--font-geist-mono)]">
      <span className="h-1 w-1 rounded-full bg-lime-300" />{children}
    </span>
  );
}

/** Double-bezel glass plate: outer shell + inner core with concentric radii. */
function Plate({ children, className = "", outerClassName = "" }: { children: React.ReactNode; className?: string; outerClassName?: string }) {
  return (
    <div className={`rounded-[1.6rem] p-1.5 bg-white/[0.04] ring-1 ring-white/[0.08] ${outerClassName}`}>
      <div className={`rounded-[calc(1.6rem-0.375rem)] bg-[#0d100b]/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] ${className}`}>
        {children}
      </div>
    </div>
  );
}

const MATURITY_STAGES = ["Seedling", "Growing", "Established", "Mature"];

function StatCard({ label, value, sub, accent, icon: Icon }: {
  label: string; value: string; sub?: string; accent?: boolean; icon: React.ElementType;
}) {
  return (
    <Plate className="h-full p-5">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#7c846f] font-[family-name:var(--font-geist-mono)]">{label}</span>
        <span className="grid size-7 place-items-center rounded-full bg-white/[0.05] text-lime-300/80"><Icon className="size-3.5" strokeWidth={1.5} /></span>
      </div>
      <p className={`mt-4 font-[family-name:var(--font-space)] text-[26px] font-semibold tabular-nums leading-none tracking-tight ${accent ? "text-lime-400" : "text-[#F4F6F0]"}`}>{value}</p>
      {sub && <p className="mt-1.5 text-[11.5px] text-[#7c846f]">{sub}</p>}
    </Plate>
  );
}

function IslandButton({ href, children, onClick }: { href?: string; children: React.ReactNode; onClick?: () => void }) {
  const cls = "group inline-flex items-center gap-2 rounded-full bg-lime-400 py-2.5 pl-5 pr-2 text-[13.5px] font-semibold text-[#0c1402] transition-transform duration-500 active:scale-[0.98] shadow-[0_0_30px_-8px_rgba(163,230,53,0.6)]";
  const inner = (
    <>
      {children}
      <span className="grid size-7 place-items-center rounded-full bg-black/15 transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105" style={{ transitionTimingFunction: EASE }}>
        <ArrowUpRight className="size-4" strokeWidth={2} />
      </span>
    </>
  );
  return href ? <Link href={href} className={cls} style={{ transitionTimingFunction: EASE }}>{inner}</Link>
    : <button onClick={onClick} className={cls} style={{ transitionTimingFunction: EASE }}>{inner}</button>;
}

/** Page shell — OLED canvas + ethereal mesh + grain. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#070809] text-zinc-100 font-[family-name:var(--font-geist-sans)]">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-1/4 left-[-10%] size-[55vw] rounded-full blur-[150px] opacity-[0.15]" style={{ background: "radial-gradient(circle,#a3e635 0%,transparent 70%)" }} />
        <div className="absolute top-1/3 right-[-12%] size-[50vw] rounded-full blur-[160px] opacity-[0.10]" style={{ background: "radial-gradient(circle,#10b981 0%,transparent 70%)" }} />
      </div>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-overlay" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
      <main className="relative z-10 mx-auto w-full max-w-[1180px] px-4 py-10 md:px-8 md:py-16">{children}</main>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */
export default function WalletPage() {
  // Privy-aware wallet: a Google login uses an embedded Privy wallet that never
  // appears in wallet-adapter, so the legacy useWallet() left `connected` false
  // and this page stayed on "Connect wallet" even after login. The unified hook
  // resolves the active Privy/external wallet the same way the header does.
  const { connected, publicKey } = useUnifiedSolanaWallet();
  const { promptLogin, profile } = useSupabaseAuth();
  const address = connected && publicKey ? publicKey.toBase58() : null;

  // IDENTITY: an agent/campaign is keyed to the wallet it was MINTED under, which
  // for a Privy/Google user is frequently NOT the embedded wallet resolved here.
  // Query the account's FULL linked-wallet set (profile.walletAddresses) ∪ the
  // active wallet — otherwise listByCreator returns [] and the whole dashboard
  // blanks to $0 even when the user owns funded agents.
  const creatorWallets = useMemo(() => {
    const set = new Set<string>();
    for (const w of profile?.walletAddresses ?? []) if (w) set.add(w);
    if (address) set.add(address);
    return [...set];
  }, [profile?.walletAddresses, address]);

  const myInfluencers = useQuery(api.influencers.listByCreators, creatorWallets.length ? { creatorWallets } : "skip");
  const myCampaigns = useQuery(api.campaigns.listByCreators, creatorWallets.length ? { creatorWallets } : "skip");
  const vault = useOnchainBalance(address);

  const [copied, setCopied] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [now] = useState(() => Date.now());   // stable timestamp for maturity calc
  const copy = () => { if (!address) return; navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  if (!address) {
    return (
      <Shell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
          <Eyebrow>Powered by Solana</Eyebrow>
          <h1 className="max-w-xl font-[family-name:var(--font-space)] text-[clamp(2rem,5vw,3.2rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-[#F4F6F0]">
            Connect to see your <span className="text-lime-400">portfolio.</span>
          </h1>
          <p className="max-w-sm text-[15px] leading-relaxed text-[#969E8C]">
            Track every agent NFT you own, your live on-chain balance, real earnings, and growth
            projections, all in one dashboard.
          </p>
          <IslandButton onClick={() => promptLogin()}>Connect wallet</IslandButton>
        </div>
      </Shell>
    );
  }

  // ── analytics ──
  const agents = myInfluencers ?? [];
  const campaigns = myCampaigns ?? [];
  const totalTvl = agents.reduce((s: number, i: Agent) => s + (i.tvl ?? 0), 0);
  const totalMonthly = agents.reduce((s: number, i: Agent) => s + (i.monthlyEarnings ?? 0), 0);
  const annual = totalMonthly * 12;
  const apr = totalTvl > 0 ? (annual / totalTvl) * 100 : 0;
  const submissions = campaigns.reduce((s: number, c: Campaign) => s + (c.submissionsCount ?? 0), 0);

  // Agent maturity — blend of age (up to 6mo), whether it's earning, and whether
  // it's funded. Averaged across all owned agents → a 0-100 maturity score.
  const maturity = agents.length === 0 ? 0 : Math.round(
    agents.reduce((acc: number, a: Agent) => {
      const ageMonths = (now - (a._creationTime ?? now)) / 2_592_000_000;
      const ageScore = Math.min(1, ageMonths / 6) * 35;
      const earnScore = (a.monthlyEarnings ?? 0) > 0 ? 35 : 0;
      const fundScore = (a.tvl ?? 0) > 0 ? 30 : 0;
      return acc + ageScore + earnScore + fundScore;
    }, 0) / agents.length
  );
  const stageIdx = maturity >= 75 ? 3 : maturity >= 50 ? 2 : maturity >= 25 ? 1 : 0;

  const usdc = vault.usdc ?? 0;
  const sol = vault.sol ?? 0;
  const netWorth = usdc + totalTvl;

  const projections = [
    { label: "1 month", v: totalMonthly },
    { label: "3 months", v: totalMonthly * 3 },
    { label: "6 months", v: totalMonthly * 6 },
    { label: "1 year", v: annual },
  ];
  const maxProj = Math.max(annual, 1);

  return (
    <Shell>
      {/* ── HERO: heading + virtual card ── */}
      <Reveal>
        <h1 className="font-[family-name:var(--font-space)] text-[clamp(2rem,5vw,3.1rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-[#F4F6F0]">
          Your Vello wallet
        </h1>
      </Reveal>

      <div className="mt-8 grid gap-5 lg:grid-cols-12">
        {/* Virtual card */}
        <Reveal className="lg:col-span-7">
          <div className="rounded-[2rem] p-1.5 bg-white/[0.05] ring-1 ring-white/[0.1]">
            <div className="relative aspect-[16/9] overflow-hidden rounded-[calc(2rem-0.375rem)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.18)]"
              style={{ background: "linear-gradient(135deg,#1b2410 0%,#0e1408 45%,#10221a 100%)" }}>
              {/* holographic panning sheen */}
              <div className="vello-reel-pan pointer-events-none absolute inset-0 opacity-40" style={{ background: "linear-gradient(115deg,transparent 30%,rgba(163,230,53,0.18) 50%,transparent 70%)" }} />
              <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-lime-400/20 blur-3xl" />

              <div className="relative flex h-full flex-col justify-between p-6 md:p-7">
                {/* top row */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center"><span className="size-3.5 rotate-45 rounded-[5px] bg-lime-400 shadow-[0_2px_0_0_#6ba80f]" /></span>
                    <span className="font-[family-name:var(--font-space)] text-[15px] font-semibold tracking-tight text-[#F4F6F0]">Vello</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* chip */}
                    <span className="h-6 w-9 rounded-md bg-gradient-to-br from-lime-300/80 to-lime-500/60 ring-1 ring-white/20" />
                    <span className="rounded-full bg-black/30 px-2.5 py-1 text-[9.5px] font-medium uppercase tracking-[0.16em] text-lime-200/80 font-[family-name:var(--font-geist-mono)] ring-1 ring-white/10">USDC · Solana</span>
                  </div>
                </div>

                {/* balance */}
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#869077] font-[family-name:var(--font-geist-mono)]">Available balance</p>
                  <div className="mt-1 flex items-end gap-3">
                    <p className="font-[family-name:var(--font-space)] text-[clamp(2.2rem,6vw,3.4rem)] font-semibold tabular-nums leading-none tracking-tight text-[#F4F6F0]">
                      {vault.loading ? "···" : vault.unavailable ? "—" : fmtUsdFull(usdc)}
                    </p>
                    <button onClick={vault.refresh} className="mb-1.5 grid size-7 place-items-center rounded-full bg-white/[0.06] text-[#aab39a] transition-colors hover:text-lime-300" aria-label="Refresh balance">
                      <RefreshCw className={`size-3.5 ${vault.loading ? "animate-spin" : ""}`} strokeWidth={1.5} />
                    </button>
                  </div>
                  <p className="mt-2 text-[12.5px] text-[#869077] font-[family-name:var(--font-geist-mono)] tabular-nums">◎ {vault.unavailable ? "—" : sol.toFixed(4)} SOL</p>
                </div>

                {/* address row */}
                <div className="flex items-center justify-between">
                  <button onClick={copy} className="group inline-flex items-center gap-2 rounded-full bg-black/25 px-3 py-1.5 text-[12px] font-[family-name:var(--font-geist-mono)] text-[#aab39a] ring-1 ring-white/10 transition-colors hover:text-[#F4F6F0]">
                    {shortAddr(address)}
                    {copied ? <Check className="size-3 text-lime-400" strokeWidth={2} /> : <Copy className="size-3 transition-transform group-hover:scale-110" strokeWidth={1.5} />}
                  </button>
                  <a href={`https://explorer.solana.com/address/${address}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] text-[#869077] transition-colors hover:text-lime-300">
                    Explorer <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Deposit + on-ramp actions */}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowReceive(true)}
              className="group inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-1.5 text-[12.5px] font-semibold text-[#dbe2d2] ring-1 ring-white/10 transition-colors hover:bg-white/[0.1]"
            >
              <ArrowDownToLine className="size-3.5" strokeWidth={2} /> Deposit
            </button>
            <AddFundsButton address={address} onRefresh={vault.refresh} />
          </div>
        </Reveal>

        {/* Net worth (flexes to fill) + agent-maturity meter beneath it */}
        <Reveal delay={0.06} className="lg:col-span-5">
          <div className="flex h-full flex-col gap-5">
            <Plate outerClassName="flex-1" className="flex h-full flex-col justify-between p-6">
              <div>
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#7c846f] font-[family-name:var(--font-geist-mono)]">Net worth</span>
                <p className="mt-2 font-[family-name:var(--font-space)] text-[34px] font-semibold tabular-nums leading-none tracking-tight text-[#F4F6F0]">{vault.unavailable ? "—" : fmtUsd(netWorth, 2)}</p>
                <p className="mt-2 text-[12.5px] text-[#969E8C]">Cash {vault.unavailable ? "—" : fmtUsd(usdc)} · Holdings {fmtUsd(totalTvl)}</p>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/[0.07] pt-5">
                <div>
                  <p className="font-[family-name:var(--font-space)] text-2xl font-semibold tabular-nums text-lime-400">{fmtUsd(totalMonthly)}</p>
                  <p className="mt-1 text-[10.5px] uppercase tracking-[0.14em] text-[#7c846f] font-[family-name:var(--font-geist-mono)]">monthly / mo</p>
                </div>
                <div>
                  <p className="font-[family-name:var(--font-space)] text-2xl font-semibold tabular-nums text-[#F4F6F0]">{apr.toFixed(1)}%</p>
                  <p className="mt-1 text-[10.5px] uppercase tracking-[0.14em] text-[#7c846f] font-[family-name:var(--font-geist-mono)]">est. apr</p>
                </div>
              </div>
            </Plate>

            {/* Agent maturity meter */}
            <Plate className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#7c846f] font-[family-name:var(--font-geist-mono)]">Agent maturity</span>
                <span className="rounded-full bg-lime-400/10 px-2.5 py-0.5 text-[10.5px] font-medium text-lime-300 ring-1 ring-lime-400/25">{MATURITY_STAGES[stageIdx]}</span>
              </div>
              <div className="mt-2.5 flex items-baseline gap-2">
                <span className="font-[family-name:var(--font-space)] text-[28px] font-semibold leading-none tabular-nums text-[#F4F6F0]">{maturity}<span className="text-[15px] text-[#7c846f]">%</span></span>
                <span className="text-[11.5px] text-[#7c846f]">avg · {agents.length} agent{agents.length === 1 ? "" : "s"}</span>
              </div>
              {/* meter track + glowing thumb */}
              <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.05] ring-1 ring-white/[0.05]">
                <div className="h-full rounded-full bg-gradient-to-r from-lime-500 via-lime-400 to-lime-300 transition-[width] duration-[900ms]" style={{ width: `${Math.max(3, maturity)}%`, transitionTimingFunction: EASE }} />
              </div>
              <div className="relative -mt-[7px] h-0">
                <span className="absolute top-0 size-3 -translate-x-1/2 -translate-y-px rounded-full bg-lime-300 shadow-[0_0_10px_2px_rgba(163,230,53,0.7)] transition-[left] duration-[900ms]" style={{ left: `${Math.max(3, maturity)}%`, transitionTimingFunction: EASE }} />
              </div>
              <div className="mt-3 flex justify-between font-[family-name:var(--font-geist-mono)] text-[9px] uppercase tracking-[0.1em]">
                {MATURITY_STAGES.map((s, i) => (
                  <span key={s} className={i <= stageIdx ? "text-lime-300/90" : "text-[#4f5448]"}>{s}</span>
                ))}
              </div>
            </Plate>
          </div>
        </Reveal>
      </div>

      {/* ── ANALYTICS BENTO ── */}
      <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-4">
        {[
          { label: "Portfolio value", value: fmtUsd(totalTvl), sub: "USDC locked in agents", icon: TrendingUp },
          { label: "AI agents", value: String(agents.length), sub: agents.length === 1 ? "1 NFT owned" : `${agents.length} NFTs owned`, icon: Bot },
          { label: "Campaigns", value: String(campaigns.length), sub: `${submissions} submissions`, icon: Megaphone },
          { label: "Annual projection", value: fmtUsd(annual), sub: "at current run-rate", icon: Sparkles, accent: true },
        ].map((s, i) => (
          <Reveal key={s.label} delay={0.04 + i * 0.04}>
            <StatCard {...s} />
          </Reveal>
        ))}
      </div>

      {/* ── EARNINGS PROJECTION ── */}
      <Reveal delay={0.05} className="mt-8">
        <Plate className="p-6 md:p-8">
          <div className="flex items-center justify-between">
            <div>
              <Eyebrow>Earnings projection</Eyebrow>
              <h2 className="mt-3 font-[family-name:var(--font-space)] text-2xl font-semibold tracking-tight text-[#F4F6F0]">If your agents keep this pace</h2>
            </div>
            <span className="hidden text-right text-[12px] text-[#7c846f] sm:block">Based on {fmtUsd(totalMonthly)}/mo<br />across {agents.length} agent{agents.length === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-4">
            {projections.map((p, i) => (
              <div key={p.label}>
                {/* growing bar */}
                <div className="flex h-28 items-end overflow-hidden rounded-xl bg-white/[0.03] p-1.5">
                  <div
                    className="w-full rounded-lg bg-gradient-to-t from-lime-500/40 to-lime-400 transition-[height] duration-[900ms]"
                    style={{ height: `${Math.max(8, (p.v / maxProj) * 100)}%`, transitionTimingFunction: EASE, transitionDelay: `${i * 90}ms` }}
                  />
                </div>
                <p className="mt-3 font-[family-name:var(--font-space)] text-xl font-semibold tabular-nums text-[#F4F6F0]">{fmtUsd(p.v)}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-[#7c846f] font-[family-name:var(--font-geist-mono)]">{p.label}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-[12px] text-[#5d6356]">Projections are estimates from current monthly run-rate, not a guarantee.</p>
        </Plate>
      </Reveal>

      {/* ── MY AGENTS (NFTs) ── */}
      <section className="mt-16">
        <Reveal>
          <div className="flex items-end justify-between gap-4">
            <div>
              <Eyebrow>Your agents</Eyebrow>
              <h2 className="mt-3 font-[family-name:var(--font-space)] text-[clamp(1.6rem,3vw,2.2rem)] font-semibold tracking-tight text-[#F4F6F0]">
                {agents.length} agent NFT{agents.length === 1 ? "" : "s"}
              </h2>
            </div>
            <IslandButton href="/studio/build">Launch agent</IslandButton>
          </div>
        </Reveal>

        {myInfluencers === undefined ? (
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-[1.6rem] bg-white/[0.03]" />)}
          </div>
        ) : agents.length === 0 ? (
          <Reveal delay={0.05}>
            <Plate className="mt-6 flex flex-col items-center gap-4 px-6 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.05] text-lime-300"><Bot className="size-6" strokeWidth={1.5} /></span>
              <p className="text-[15px] text-[#969E8C]">No agents yet. Launch your first autonomous agent.</p>
              <IslandButton href="/studio/build">Open the Builder</IslandButton>
            </Plate>
          </Reveal>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((inf: Agent, i: number) => {
              const aApr = inf.tvl > 0 ? (inf.monthlyEarnings * 12) / inf.tvl * 100 : 0;
              return (
                <Reveal key={inf._id} delay={0.03 + (i % 3) * 0.04}>
                  <div className="group rounded-[1.6rem] p-1.5 bg-white/[0.04] ring-1 ring-white/[0.08] transition-transform duration-500 hover:-translate-y-1" style={{ transitionTimingFunction: EASE }}>
                    <div className="overflow-hidden rounded-[calc(1.6rem-0.375rem)] bg-[#0d100b]/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                      <div className="flex items-center gap-3 p-4">
                        <span className="size-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={inf.avatarUrl} alt={inf.name} className="size-full object-cover" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-[family-name:var(--font-space)] text-[15px] font-semibold text-[#F4F6F0]">{inf.name}</p>
                          <p className="truncate text-[12px] text-[#7c846f] font-[family-name:var(--font-geist-mono)]">@{inf.handle}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white/[0.05] px-2.5 py-1 text-[10.5px] capitalize text-[#aab39a] ring-1 ring-white/10">{inf.niche}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-px bg-white/[0.05]">
                        {[
                          ["TVL", fmtUsd(inf.tvl)],
                          ["Monthly", inf.monthlyEarnings > 0 ? fmtUsd(inf.monthlyEarnings) : "—"],
                          ["APR", `${aApr.toFixed(0)}%`],
                        ].map(([l, v], k) => (
                          <div key={l} className="bg-[#0d100b] px-4 py-3">
                            <p className="text-[9.5px] uppercase tracking-[0.12em] text-[#5d6356] font-[family-name:var(--font-geist-mono)]">{l}</p>
                            <p className={`mt-1 font-[family-name:var(--font-space)] text-[15px] font-semibold tabular-nums ${k === 2 ? "text-lime-400" : "text-[#F4F6F0]"}`}>{v}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 p-3">
                        <Link href={`/market/${inf.mintAddress}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/[0.05] py-2 text-[12.5px] font-medium text-[#dbe2d2] transition-colors hover:bg-white/[0.09]">
                          View <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} />
                        </Link>
                        <Link href={`/studio/agent/${inf._id}/edit`} className="grid size-9 place-items-center rounded-full bg-white/[0.05] text-[#aab39a] transition-colors hover:bg-white/[0.09] hover:text-lime-300" aria-label="Edit agent">
                          <Pencil className="size-3.5" strokeWidth={1.5} />
                        </Link>
                      </div>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        )}
      </section>

      {/* ── MY CAMPAIGNS ── */}
      <section className="mt-16 pb-10">
        <Reveal>
          <div className="flex items-end justify-between gap-4">
            <div>
              <Eyebrow>Your campaigns</Eyebrow>
              <h2 className="mt-3 font-[family-name:var(--font-space)] text-[clamp(1.6rem,3vw,2.2rem)] font-semibold tracking-tight text-[#F4F6F0]">
                {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
              </h2>
            </div>
            <IslandButton href="/stage/create">Post campaign</IslandButton>
          </div>
        </Reveal>

        {myCampaigns === undefined ? (
          <div className="mt-6 space-y-3">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-[1.4rem] bg-white/[0.03]" />)}</div>
        ) : campaigns.length === 0 ? (
          <Reveal delay={0.05}>
            <Plate className="mt-6 flex flex-col items-center gap-4 px-6 py-14 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.05] text-lime-300"><Megaphone className="size-6" strokeWidth={1.5} /></span>
              <p className="text-[15px] text-[#969E8C]">No campaigns posted yet.</p>
              <IslandButton href="/stage/create"><Plus className="size-4" strokeWidth={2} /> Post a campaign</IslandButton>
            </Plate>
          </Reveal>
        ) : (
          <Reveal delay={0.05}>
            <Plate className="mt-6 divide-y divide-white/[0.06]">
              {campaigns.map((c: Campaign) => (
                <Link key={c._id} href={`/stage/${c._id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-[family-name:var(--font-space)] text-[15px] font-medium text-[#F4F6F0]">{c.title}</p>
                    <p className="mt-0.5 text-[12px] text-[#7c846f] font-[family-name:var(--font-geist-mono)]">{c.brandName} · {fmtUsd(c.budget)} treasury · {c.submissionsCount} submissions</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.1em] ring-1 ${c.status === "open" ? "bg-lime-400/10 text-lime-300 ring-lime-400/25" : "bg-white/[0.04] text-[#869077] ring-white/10"}`}>{c.status}</span>
                  <ArrowRight className="size-4 shrink-0 text-[#5d6356]" strokeWidth={1.5} />
                </Link>
              ))}
            </Plate>
          </Reveal>
        )}
      </section>

      <WalletReceiveModal
        open={showReceive}
        address={address}
        onClose={() => setShowReceive(false)}
        onFunded={() => vault.refresh()}
      />
    </Shell>
  );
}
