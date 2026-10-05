"use client";

import { AgentAvatar } from "@/components/ui/agent-avatar";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { resolveIntervalMs, nextHeartbeatFireAt } from "@/lib/builder/heartbeatSchedule";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { motion, AnimatePresence, animate, useMotionValue, useReducedMotion, useTransform, useVelocity } from "framer-motion";
import HireGenerateModal from "@/components/agents/HireGenerateModal";
import LiveChatWidget from "@/components/support/LiveChatWidget";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { ConnectedPlatformStack, PlatformBadge } from "@/components/social/platform-icons";
import Link from "next/link";
import Image from "next/image";
import {
  Search, LayoutGrid, List, RefreshCw,
  TrendingUp, Users, X, ChevronDown,
  Check, Cpu, ExternalLink, BadgeCheck,
  Zap, CheckCircle2, XCircle, Clock, Loader2,
  BookOpen, Layers, Activity,
  Sparkles, ArrowRight, ArrowLeft, MoreHorizontal, Maximize2,
  Tag,
  Film, Heart, Gem, Clapperboard, Eye, UserPlus, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { AllAgentsVideoWall } from "@/components/generations/video-wall";
import { AppHeaderShell } from "@/components/home/app-shell";
import { formatAgentDescription } from "@/lib/agentDescription";
import { socialProfileUrl } from "@/lib/socialProfileUrl";
import { useAgentCap } from "@/lib/client/useAgentCap";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";
import { ChangePill } from "@/components/solstar/MarketTable";
import { olderAgentVideos } from "@/lib/olderAgentVideos";

// ── Reference palette (matches the marketplace screenshot exactly) ────────────
// Hardcoded hex on purpose — the operator gave an explicit visual source of truth
// (the screenshot), so these ARE the design tokens for this page.
const ME = {
  // Neutral surfaces are CSS variables so the whole page flips with the light/dark
  // theme toggle (values defined in globals.css :root / html.light). Accents below
  // stay literal — brand colours that read on both themes.
  bg:        "var(--me-bg)",
  panel:     "var(--me-panel)",
  card:      "var(--me-card)",
  cardHover: "var(--me-card-hover)",
  border:    "var(--me-border)",
  borderLit: "var(--me-border-lit)",
  text:      "var(--me-text)",
  sub:       "var(--me-sub)",
  subDim:    "var(--me-sub-dim)",
  accent:    "#ec4899",   // pink — active tab, Connect Wallet, ME mark
  accentDim: "#9d2467",
  green:     "#34d399",
  greenDim:  "#10b981",
  lime:      "#a3e635",   // lime-green CTA theme for the feature tiles
  limeText:  "#16210a",
};

// ─── Types ───────────────────────────────────────────────────────────────────

type SortKey = "views-desc" | "views-asc" | "followers-desc" | "trending" | "newest";
type ViewMode = "grid" | "list";
type AgentMarketMetrics = {
  views: number;
  todayViews: number;
  yesterdayViews: number;
  followers: number;
  followerDelta: number;
};

const NICHES = ["All","Lifestyle","Tech","Fashion","Fitness","Food","Travel","Finance","Gaming","Beauty","Crypto"];
const LANGUAGES = ["All","Manglish","Bahasa Malaysia","English","Bahasa Indonesia","Tagalog","Mandarin","Arabic"];
const AGENT_TYPES = ["AI Influencer"];

// Map niche → one of the 2 canonical agent types (fallback only — prefer stored agent.agentType)
const NICHE_TO_TYPE: Record<string, string> = {
  finance: "AI Clippers", crypto: "AI Clippers", trading: "AI Clippers",
  tech: "AI Clippers", gaming: "AI Clippers",
  lifestyle: "AI Influencer", fashion: "AI Influencer", fitness: "AI Influencer",
  food: "AI Influencer", travel: "AI Influencer", beauty: "AI Influencer",
  support: "AI Clippers", sales: "AI Influencer", operations: "AI Clippers",
};

// Canonical agentType string → display label. Legacy trader/worker types fold
// into AI Clippers; only AI Clippers + AI Influencer are surfaced now.
const TYPE_LABEL: Record<string, string> = {
  influencer: "AI Influencer",
  clipper: "AI Clippers",
  trader: "AI Clippers",
  worker: "AI Clippers",
};

/** Resolve the display type for an agent — prefer stored agentType, fall back to niche lookup. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveAgentType(agent: any): string {
  if (typeof agent?.agentType === "string" && TYPE_LABEL[agent.agentType]) {
    return TYPE_LABEL[agent.agentType];
  }
  return NICHE_TO_TYPE[agent.niche?.toLowerCase()] ?? "AI Clippers";
}

// Sorts use the SAME live metrics each card shows (views + followers) — not
// share price / TVL, which the cards don't display.
const SORT_LABELS: Record<SortKey, string> = {
  "views-desc": "Views: High to Low",
  "views-asc": "Views: Low to High",
  "followers-desc": "Followers: High to Low",
  "trending": "Trending Today",
  "newest": "Recently Added",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === "succeeded") return <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />;
  if (status === "failed") return <XCircle className="size-3 text-red-400 shrink-0" />;
  if (status === "running") return <Loader2 className="size-3 text-amber-400 animate-spin shrink-0" />;
  return <Clock className="size-3 text-zinc-500 shrink-0" />;
}

const MEMORY_KIND_ICON: Record<string, React.ReactNode> = {
  lesson:      <BookOpen className="size-2.5 text-sky-400" />,
  performance: <TrendingUp className="size-2.5 text-emerald-400" />,
  preference:  <Sparkles className="size-2.5 text-amber-400" />,
  relationship:<Users className="size-2.5 text-fuchsia-400" />,
  warning:     <Zap className="size-2.5 text-red-400" />,
};

// ─── Agent modal ──────────────────────────────────────────────────────────────

// Element type of the aggregated cap-table rows returned by investments.listByMint.
type Owner = { investorWallet: string; sharesBought: number; usdcAmount: number; investedAt: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AgentModal({ agent, index, onClose, agents = [], onNavigate, onHire, metrics }: { agent: any; index: number; onClose: () => void; agents?: any[]; onNavigate?: (i: number) => void; onHire?: (agent: any) => void; metrics?: AgentMarketMetrics }) {
  const [modalNow] = useState(() => Date.now());
  const [mtab, setMtab] = useState<"traits" | "owners" | "transactions" | "tasks" | "activity" | "knowledge" | "videos">("traits");
  const [videoNow, setVideoNow] = useState(() => Date.now());
  const taskStats    = useQuery(api.agentTasks.statsForMint,   { mintAddress: agent.mintAddress });
  const recentTasks  = useQuery(api.agentTasks.listByMint,     { mintAddress: agent.mintAddress, limit: 5 });
  const memories     = useQuery(api.agentTasks.recallMemories, { mintAddress: agent.mintAddress, limit: 3 });
  const knowledgeStat= useQuery(api.agentKnowledge.statsByMint,{ mintAddress: agent.mintAddress });
  const owners       = useQuery(api.investments.listByMint,    { mintAddress: agent.mintAddress });
  const transactions = useQuery(api.agentAccount.transactionHistory, { mintAddress: agent.mintAddress });
  const videoFeed = useQuery(api.clipJobs.videoFeedByMints,
    mtab === "videos" && agent.mintAddress ? { mintAddresses: [agent.mintAddress] } : "skip");
  useEffect(() => {
    if (mtab !== "videos") return;
    const timer = window.setInterval(() => setVideoNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [mtab]);
  const olderVideos = olderAgentVideos(videoFeed?.items ?? [], videoNow);
  const connectedSocials = [...new Set((agent.connectedPlatforms ?? []) as string[])]
    .map((platform) => ({
      platform,
      account: agent.connectedSocialAccounts?.[platform],
      url: socialProfileUrl(platform, agent.connectedSocialAccounts?.[platform] ?? {}),
    }));

  // Live on-chain wallet balance
  const [walletData, setWalletData] = useState<{ usdc: number; sol: number } | null>(null);
  useEffect(() => {
    if (!agent.agentWallet) return;
    fetch(`/api/agent-wallet-balance?wallet=${agent.agentWallet}`)
      .then(r => r.json())
      .then((d: { ok?: boolean; usdc?: number; sol?: number }) => {
        if (d.ok) setWalletData({ usdc: d.usdc ?? 0, sol: d.sol ?? 0 });
      })
      .catch(() => {});
  }, [agent.agentWallet]);

  const corpusBytes = knowledgeStat?.totalChars ?? 0;
  const corpusKb    = corpusBytes / 1024;
  const corpusLabel = corpusKb >= 1024 ? `${(corpusKb / 1024).toFixed(2)} MB`
                    : corpusKb >= 1    ? `${corpusKb.toFixed(1)} KB`
                                       : `${corpusBytes} B`;
  const corpusPct   = Math.min(100, (corpusKb / 500) * 100);

  const personality        = (agent.personality ?? {}) as Record<string, number>;
  const personalityEntries = Object.entries(personality);

  const agentType = resolveAgentType(agent);
  const ageMs       = modalNow - (agent._creationTime ?? modalNow);
  const ageDays     = Math.floor(ageMs / 86400000);
  const ageLabel    = ageDays < 1 ? "today" : ageDays < 30 ? `${ageDays}d` : `${Math.floor(ageDays / 30)}mo`;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const netPnl = taskStats ? taskStats.totalRevenue - taskStats.totalCost : 0;
  const apr = agent.tvl > 0 ? (agent.monthlyEarnings * 12) / agent.tvl * 100 : 0;
  const cardCls = "rounded-xl border border-zinc-800/80 bg-white/[0.025]";
  const labelCls = "text-[10.5px] font-bold uppercase tracking-[0.14em] text-zinc-500";

  // ── Equity cap table ────────────────────────────────────────────────────
  // The creator mints `totalShares` and retains every share that hasn't been
  // sold (tracked by `availableShares`). Investors hold the rest. We derive the
  // creator's stake as totalShares − Σ(investor shares) so the cap table always
  // sums to exactly 100%, regardless of any drift in `availableShares`. With no
  // sales, the creator is the sole (100%) equity owner.
  const totalShares = agent.totalShares ?? 0;
  const investorShares = (owners ?? []).reduce((s: number, o: Owner) => s + o.sharesBought, 0);
  const creatorShares = Math.max(0, totalShares - investorShares);
  const pctOf = (shares: number) => (totalShares > 0 ? (shares / totalShares) * 100 : 0);
  const equityHolders: Array<{ wallet: string; shares: number; usdc: number; pct: number; role: "Creator" | "Investor" }> = [
    ...(owners ?? []).map((o: Owner) => ({ wallet: o.investorWallet, shares: o.sharesBought, usdc: o.usdcAmount, pct: pctOf(o.sharesBought), role: "Investor" as const })),
    ...(creatorShares > 0 && agent.creatorWallet
      ? [{ wallet: agent.creatorWallet, shares: creatorShares, usdc: creatorShares * (agent.sharePrice ?? 0), pct: pctOf(creatorShares), role: "Creator" as const }]
      : []),
  ].sort((a, b) => b.shares - a.shares);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.97, opacity: 0, y: 8 }}
        transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.55 }}
        onClick={e => e.stopPropagation()}
        className="relative z-10 w-full max-w-[1320px] h-[92vh] rounded-2xl overflow-hidden text-zinc-100 ring-1 ring-white/10"
        style={{ background: ME.bg, boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.45)" }}
      >
        <div className="flex flex-col h-full">
          {/* ── Top bar: thumbnail nav + actions ── */}
          <div className="shrink-0 flex items-center gap-2 px-3 h-14 border-b" style={{ borderColor: ME.border }}>
            <button type="button" onClick={() => onNavigate?.(index - 1)} disabled={!onNavigate || index <= 0}
              className="flex items-center justify-center size-9 rounded-lg shrink-0 transition-colors disabled:opacity-30 hover:bg-white/5" style={{ border: `1px solid ${ME.border}`, color: ME.sub }} aria-label="Previous agent">
              <ArrowLeft className="size-4" />
            </button>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {agents.slice(Math.max(0, index - 3), index + 5).map((a, k) => {
                const realIdx = Math.max(0, index - 3) + k;
                const active = realIdx === index;
                return (
                  <button key={a._id} type="button" onClick={() => onNavigate?.(realIdx)}
                    className="size-9 rounded-lg overflow-hidden shrink-0 transition-all" aria-label={a.name}
                    style={{ border: active ? `2px solid ${ME.accent}` : `1px solid ${ME.border}`, opacity: active ? 1 : 0.55 }}>
                    <AgentAvatar url={a.avatarUrl} name={a.name} seed={a.mintAddress} className="w-full h-full object-cover object-top" initialClassName="text-[10px]" />
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => onNavigate?.(index + 1)} disabled={!onNavigate || index >= agents.length - 1}
              className="flex items-center justify-center size-9 rounded-lg shrink-0 transition-colors disabled:opacity-30 hover:bg-white/5" style={{ border: `1px solid ${ME.border}`, color: ME.sub }} aria-label="Next agent">
              <ArrowRight className="size-4" />
            </button>
            <div className="flex-1" />
            <button type="button" className="flex items-center justify-center size-9 rounded-lg hover:bg-white/5 transition-colors" style={{ color: ME.sub }} aria-label="Refresh"><RefreshCw className="size-4" /></button>
            <button type="button" className="flex items-center justify-center size-9 rounded-lg hover:bg-white/5 transition-colors" style={{ color: ME.sub }} aria-label="More"><MoreHorizontal className="size-4" /></button>
            <a href={`/market/${agent.mintAddress}`} className="flex items-center justify-center size-9 rounded-lg hover:bg-white/5 transition-colors" style={{ color: ME.sub }} aria-label="Open full page"><ExternalLink className="size-4" /></a>
            <button type="button" onClick={onClose} className="flex items-center justify-center size-9 rounded-lg hover:bg-white/5 transition-colors" style={{ color: ME.sub }} aria-label="Close"><X className="size-4" /></button>
          </div>

          {/* ── Body: image + info ── */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col lg:flex-row gap-6 p-5">
            {/* Left: image */}
            <div className="lg:w-[44%] shrink-0">
              <div className="relative w-full aspect-square rounded-2xl overflow-hidden" style={{ background: "#211a3a" }}>
                <AgentAvatar url={agent.avatarUrl} name={agent.name} seed={agent.mintAddress} className="w-full h-full object-cover object-top" initialClassName="text-6xl" />
                <a href={`/market/${agent.mintAddress}`} className="absolute top-3 right-3 flex items-center justify-center size-8 rounded-lg bg-black/40 hover:bg-black/60 text-white/80 transition-colors" aria-label="Expand"><Maximize2 className="size-4" /></a>
                <a href={`/market/${agent.mintAddress}`} className="absolute bottom-3 right-3 flex items-center justify-center size-8 rounded-lg bg-black/40 hover:bg-black/60 text-white/80 transition-colors" aria-label="Open"><ExternalLink className="size-4" /></a>
              </div>
            </div>

            {/* Right: info */}
            <div className="flex-1 min-w-0 flex flex-col gap-4">
              {/* Title + meta */}
              <div>
                <h2 className="flex items-center gap-2 text-[26px] font-bold tracking-tight" style={{ color: ME.text }}>
                  {agent.name}
                  <HeartbeatHeart agent={agent} className="size-4" />
                </h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[13px] font-medium" style={{ color: ME.sub }}>{agentType.replace("AI ", "")} Agent</span>
                  <BadgeCheck className="size-4" style={{ color: ME.accent }} aria-label="Verified" />
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ background: "#14532d", color: "#86efac" }}>R {index + 1}</span>
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ background: "#14532d", color: "#86efac" }}>{apr.toFixed(0)}% APR</span>
                  <span className="ml-auto text-[12px]" style={{ color: ME.sub }}>Owned by: <span style={{ color: ME.text }}>{agent.creatorWallet ? `${agent.creatorWallet.slice(0, 4)}…${agent.creatorWallet.slice(-4)}` : "—"}</span></span>
                </div>
              </div>

              {/* Performance uses the same live metrics as the marketplace cards. */}
              <div className="rounded-xl border p-4" style={{ background: ME.card, borderColor: ME.border }}>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[12px]" style={{ color: ME.sub }}><Eye className="size-3.5" /> Total views</p>
                    <p className="mt-1 text-[28px] font-bold leading-none tabular-nums" style={{ color: ME.text }}>{(metrics?.views ?? 0).toLocaleString()}</p>
                    <p className="mt-1.5 text-[11px]" style={{ color: ME.sub }}>Across tracked videos</p>
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[12px]" style={{ color: ME.sub }}><TrendingUp className="size-3.5" /> Today</p>
                    <p className="mt-1 text-[28px] font-bold leading-none tabular-nums" style={{ color: ME.text }}>{(metrics?.todayViews ?? 0).toLocaleString()}</p>
                    <p className="mt-1.5 text-[11px]" style={{ color: ME.sub }}>Views on today&apos;s videos</p>
                  </div>
                  <div className="min-w-0 col-span-2 sm:col-span-1">
                    <p className="flex items-center gap-1.5 text-[12px]" style={{ color: ME.sub }}><UserPlus className="size-3.5" /> Followers</p>
                    <p className="mt-1 text-[28px] font-bold leading-none tabular-nums" style={{ color: ME.text }}>{(metrics?.followers ?? 0).toLocaleString()}</p>
                    <p className={`mt-1.5 text-[11px] tabular-nums ${(metrics?.followerDelta ?? 0) > 0 ? "text-emerald-400" : (metrics?.followerDelta ?? 0) < 0 ? "text-red-400" : "text-zinc-500"}`}>
                      {(metrics?.followerDelta ?? 0) > 0 ? "+" : ""}{metrics?.followerDelta ?? 0} vs yesterday
                    </p>
                  </div>
                </div>
                {connectedSocials.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                    <span className="mr-1 text-[11px]" style={{ color: ME.sub }}>Connected socials</span>
                    {connectedSocials.map(({ platform, account, url }) => url ? (
                      <a key={platform} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open connected ${platform} account in a new tab`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[11px] capitalize text-white/80 transition-colors hover:border-white/25 hover:bg-white/5">
                        <PlatformBadge id={platform} label={platform} className="size-4" /> {account?.handle ? `@${String(account.handle).replace(/^@/, "")}` : platform} <ExternalLink className="size-3 text-white/40" />
                      </a>
                    ) : (
                      <span key={platform} title="This connection has no public profile URL yet" className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[11px] capitalize text-white/50">
                        <PlatformBadge id={platform} label={platform} className="size-4" /> {platform}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Primary actions — 3 side-by-side, 3D "duolingo" buttons (press to depress) */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <button type="button" onClick={() => window.location.href = `/market/${agent.mintAddress}`}
                  className="inline-flex min-w-0 items-center justify-center gap-2 h-12 px-3 rounded-xl text-[13px] sm:text-[14px] font-bold transition-[transform,box-shadow] duration-100 active:translate-y-[3px] shadow-[0_4px_0_#1d2027] active:shadow-[0_1px_0_#1d2027] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  style={{ background: ME.card, color: ME.text, border: `1px solid ${ME.borderLit}` }}>
                  View Profile
                </button>
                <button type="button" onClick={() => onHire?.(agent)}
                  className="inline-flex min-w-0 items-center justify-center gap-2 h-12 px-3 rounded-xl text-[13px] sm:text-[14px] font-extrabold text-white transition-[transform,box-shadow] duration-100 active:translate-y-[3px] shadow-[0_4px_0_#9d2467] active:shadow-[0_1px_0_#9d2467] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-300"
                  style={{ background: "linear-gradient(180deg,#ec4899 0%,#be185d 100%)", textShadow: "0 1px 1px rgba(0,0,0,0.35)" }}>
                  <Sparkles className="size-[16px]" strokeWidth={2.8} /> Hire Agent
                </button>
                <button type="button" onClick={() => window.location.href = `/market/${agent.mintAddress}`}
                  className="col-span-2 inline-flex min-w-0 items-center justify-center gap-2 h-12 rounded-xl text-[14px] sm:col-span-1 sm:text-[15px] font-extrabold text-white transition-[transform,box-shadow] duration-100 active:translate-y-[3px] shadow-[0_4px_0_#3f6212] active:shadow-[0_1px_0_#3f6212] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
                  style={{ background: "linear-gradient(180deg,#84cc16 0%,#65a30d 100%)", textShadow: "0 1px 1px rgba(0,0,0,0.35)" }}>
                  <TrendingUp className="size-[17px]" strokeWidth={2.8} /> Invest in Agent
                </button>
              </div>

              {/* Tabs — sticky header so they stay visible while the panel scrolls.
                  No overflow-x-auto here (it would clip the underline + break sticky);
                  labels wrap on narrow widths instead. */}
              <div className="sticky top-0 z-20 -mx-5 px-5 flex flex-wrap items-center gap-x-5 gap-y-1 border-b" style={{ borderColor: ME.border, background: ME.bg }}>
                {([
                  { id: "traits", label: "Traits" },
                  { id: "owners", label: "Equity Owners" },
                  { id: "transactions", label: "Transactions" },
                  { id: "tasks", label: "Tasks" },
                  { id: "activity", label: "Activity" },
                  { id: "knowledge", label: "Knowledge" },
                  { id: "videos", label: "Videos" },
                ] as const).map(t => (
                  <button key={t.id} type="button" onClick={() => setMtab(t.id)} className="relative py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors" style={{ color: mtab === t.id ? ME.text : ME.sub }}>
                    {t.label}
                    {mtab === t.id && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full" style={{ background: ME.accent }} />}
                  </button>
                ))}
              </div>

              {/* Tab content — the previous section containers, now as tab panels */}
              <div className="pb-2">
                {mtab === "traits" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {[
                        { label: "Wallet", value: walletData ? (walletData.usdc >= 1000 ? `$${(walletData.usdc / 1000).toFixed(1)}K` : `$${walletData.usdc.toFixed(2)}`) : "···", sub: walletData ? `${walletData.sol.toFixed(3)} SOL` : "loading" },
                        { label: "Tasks Done", value: taskStats === undefined ? "···" : taskStats.succeeded.toLocaleString(), sub: taskStats ? `of ${taskStats.total} total` : "—" },
                        { label: "Database", value: knowledgeStat === undefined ? "···" : corpusLabel, sub: `${knowledgeStat?.count ?? 0} entries` },
                        { label: "Monthly", value: agent.monthlyEarnings > 0 ? `$${agent.monthlyEarnings}` : "—", sub: "earnings" },
                      ].map(({ label, value, sub }) => (
                        <div key={label} className={`${cardCls} px-3.5 py-3`}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">{label}</p>
                          <p className="text-[20px] font-bold text-white tabular-nums leading-none tracking-tight">{value}</p>
                          <p className="text-[10.5px] text-zinc-500 mt-1 tabular-nums">{sub}</p>
                        </div>
                      ))}
                    </div>
                    {personalityEntries.length > 0 && (
                      <section className={`${cardCls} p-4`}>
                        <h3 className={`${labelCls} mb-3`}>Personality</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                          {personalityEntries.map(([key, val]) => (
                            <div key={key} className="flex items-center gap-2.5">
                              <span className="text-[12.5px] text-zinc-400 w-20 shrink-0 capitalize">{key}</span>
                              <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-zinc-800">
                                <div className="h-full rounded-full" style={{ width: `${val}%`, background: "linear-gradient(90deg,#059669,#34d399)" }} />
                              </div>
                              <span className="text-[12px] font-semibold text-white font-mono tabular-nums w-7 text-right">{val}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
                {mtab === "transactions" && (
                  <section className={`${cardCls} overflow-hidden`}>
                    <div className="border-b border-white/10 px-4 py-3">
                      <h3 className="text-[13px] font-semibold text-white">Transaction history</h3>
                      <p className="mt-0.5 text-[11px] text-zinc-500">Agent ledger activity. On-chain entries link to Solscan.</p>
                    </div>
                    {transactions === undefined ? (
                      <div className="flex justify-center p-8"><Loader2 className="size-4 animate-spin text-zinc-500" /></div>
                    ) : transactions.length === 0 ? (
                      <p className="px-4 py-8 text-center text-[12px] text-zinc-500">No transactions yet.</p>
                    ) : (
                      <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.06]">
                        {transactions.map((tx) => (
                          <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                            <span className={`grid size-8 shrink-0 place-items-center rounded-md ${tx.amountUsdc >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-zinc-400"}`}>
                              {tx.amountUsdc >= 0 ? <ArrowDownRight className="size-4" /> : <ArrowUpRight className="size-4" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-medium text-white/80">{tx.label}</p>
                              <p className="mt-0.5 text-[10px] text-zinc-500">{new Date(tx.ts).toLocaleString()}{tx.status && tx.status !== "paid" ? ` · ${tx.status}` : ""}</p>
                            </div>
                            <span className={`shrink-0 text-[12px] font-semibold tabular-nums ${tx.amountUsdc >= 0 ? "text-emerald-400" : "text-white/75"}`}>
                              {tx.amountUsdc >= 0 ? "+" : "−"}${Math.abs(tx.amountUsdc).toFixed(4)}
                            </span>
                            {tx.txSignature && (
                              <a href={`https://solscan.io/tx/${encodeURIComponent(tx.txSignature)}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-zinc-400 hover:text-white" aria-label="View transaction on Solscan">
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}
                {mtab === "owners" && (
                  owners === undefined ? (
                    <p className="text-[13px]" style={{ color: ME.sub }}>Loading cap table…</p>
                  ) : equityHolders.length === 0 ? (
                    <div className="rounded-xl px-4 py-8 text-center" style={{ border: `1px dashed ${ME.border}` }}>
                      <Users className="size-6 mx-auto mb-2" style={{ color: ME.subDim }} />
                      <p className="text-[13px]" style={{ color: ME.sub }}>No equity issued yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {/* Summary line — total supply + how much is investor-held vs creator-held */}
                      <div className="flex items-center justify-between text-[12px]" style={{ color: ME.sub }}>
                        <span>{equityHolders.length} holder{equityHolders.length === 1 ? "" : "s"} · {totalShares.toLocaleString()} shares</span>
                        <span><span style={{ color: ME.green }}>{pctOf(investorShares).toFixed(1)}%</span> investor-held</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {equityHolders.map((h, i) => {
                          const isTop = i === 0;
                          return (
                            <div key={h.wallet} className={`${cardCls} p-3 flex items-center gap-3`} style={isTop ? { borderColor: ME.greenDim, background: "rgba(52,211,153,0.05)" } : undefined}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(h.wallet)}&backgroundColor=15171d`} alt="" className="size-9 rounded-lg shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-[12.5px] font-mono truncate" style={{ color: ME.text }}>{h.wallet.slice(0, 6)}…{h.wallet.slice(-6)}</p>
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0" style={h.role === "Creator" ? { background: "#3b1d4d", color: "#e9b8ff" } : { background: "#14532d", color: "#86efac" }}>{h.role}</span>
                                  {isTop && <span className="text-[9px] font-bold uppercase tracking-wider shrink-0" style={{ color: ME.green }} title="Largest equity owner">★ Main</span>}
                                </div>
                                <p className="text-[10.5px] tabular-nums mt-0.5" style={{ color: ME.sub }}>{h.shares.toLocaleString()} shares · ${h.usdc >= 1000 ? `${(h.usdc / 1000).toFixed(1)}K` : h.usdc.toFixed(0)}</p>
                              </div>
                              <span className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: isTop ? ME.green : ME.text }}>{h.pct.toFixed(1)}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
                )}
                {mtab === "tasks" && (
                  taskStats ? (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {[
                        { label: "Total", value: taskStats.total.toString(), color: "text-white" },
                        { label: "Done", value: taskStats.succeeded.toString(), color: "text-emerald-400" },
                        { label: "Running", value: taskStats.running.toString(), color: taskStats.running > 0 ? "text-amber-400" : "text-zinc-500" },
                        { label: "Failed", value: taskStats.failed.toString(), color: taskStats.failed > 0 ? "text-rose-400" : "text-zinc-500" },
                        { label: "Net P&L", value: `${netPnl >= 0 ? "+" : "−"}$${Math.abs(netPnl).toFixed(0)}`, color: netPnl >= 0 ? "text-emerald-400" : "text-rose-400" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className={`${cardCls} rounded-lg px-2.5 py-2.5 text-center`}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">{label}</p>
                          <p className={`text-[18px] font-bold tabular-nums leading-none tracking-tight ${color}`}>{value}</p>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-[13px]" style={{ color: ME.sub }}>No task data yet.</p>
                )}
                {mtab === "activity" && (
                  recentTasks === undefined || recentTasks.length === 0 ? (
                    <div className="rounded-xl px-4 py-6 text-center" style={{ border: `1px dashed ${ME.border}` }}>
                      <p className="text-[13px]" style={{ color: ME.sub }}>No tasks yet.</p>
                    </div>
                  ) : (
                    <div className={`${cardCls} overflow-hidden divide-y divide-zinc-800`}>
                      {recentTasks.map((task: NonNullable<typeof recentTasks>[number]) => {
                        // Surface WHY a task failed: the stored errorMessage, else
                        // any pipeline/video error tucked into the JSON output.
                        const failReason = task.status === "failed"
                          ? (task.errorMessage
                              || (() => { try { const o = JSON.parse(task.output ?? "{}"); return o.pipelineError || o.error || o.videoError || ""; } catch { return ""; } })()
                              || "Task failed, no reason recorded.")
                          : "";
                        return (
                          <div key={task._id} className="flex items-start gap-3 px-4 py-3">
                            <span className="mt-0.5"><TaskStatusIcon status={task.status} /></span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] text-white font-medium truncate">{task.title}</p>
                              <p className="text-[11px] text-zinc-500 capitalize mt-0.5">{task.type.replace(/_/g, " ")}</p>
                              {failReason && (
                                <p className="mt-1.5 rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1.5 text-[11px] leading-snug text-rose-300/90 break-words">
                                  <span className="font-semibold text-rose-300">Why it failed: </span>{failReason}
                                </p>
                              )}
                            </div>
                            <span className="text-[11px] text-zinc-500 font-mono shrink-0">{task.startedAt ? timeAgo(task.startedAt) : timeAgo(task._creationTime)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
                {mtab === "knowledge" && (
                  <div className="space-y-4">
                    {agent.description && (
                      <section>
                        <h3 className={`${labelCls} mb-2`}>About</h3>
                        <p className="text-[13.5px] leading-relaxed text-zinc-300">{agent.description}</p>
                      </section>
                    )}
                    <section className={`${cardCls} p-4`}>
                      <h3 className={`${labelCls} mb-3`}>Training Corpus</h3>
                      <div className="flex items-baseline justify-between mb-2.5">
                        <span className="text-[20px] font-bold text-white tabular-nums tracking-tight">{corpusLabel}</span>
                        <span className="text-[11.5px] text-zinc-500">{knowledgeStat?.categories?.length ?? 0} domains</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden bg-zinc-800">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(corpusPct > 0 ? 3 : 0, corpusPct)}%`, background: "linear-gradient(90deg,#059669,#10b981,#34d399)" }} />
                      </div>
                      {knowledgeStat && knowledgeStat.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {knowledgeStat.categories.slice(0, 6).map((cat: string) => (
                            <span key={cat} className="text-[10.5px] px-1.5 py-0.5 rounded text-zinc-300 bg-white/5 border border-white/10">{cat}</span>
                          ))}
                        </div>
                      )}
                    </section>
                    {memories !== undefined && memories.length > 0 && (
                      <section>
                        <h3 className={`${labelCls} mb-3`}>Memory</h3>
                        <div className="space-y-2">
                          {memories.map((mem: NonNullable<typeof memories>[number]) => (
                            <div key={mem._id} className={`${cardCls} flex items-start gap-3 px-4 py-3`}>
                              <div className="mt-1 shrink-0">{MEMORY_KIND_ICON[mem.kind] ?? <Sparkles className="size-3 text-zinc-500" />}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] text-zinc-200 leading-relaxed">{mem.summary}</p>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className="text-[10px] px-1.5 py-0.5 rounded text-zinc-300 bg-white/5 border border-white/10 capitalize">{mem.kind}</span>
                                  <span className="text-[10px] text-zinc-500">importance {mem.importance}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
                {mtab === "videos" && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-[13px] font-semibold text-white">Videos</h3>
                        <p className="mt-0.5 text-[11px] text-zinc-500">Only videos created more than 3 days ago are shown. Newer content stays hidden.</p>
                      </div>
                      {videoFeed && <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-zinc-400">{olderVideos.length} older videos</span>}
                    </div>
                    {videoFeed === undefined ? (
                      <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 p-8 text-[12px] text-zinc-400"><Loader2 className="size-4 animate-spin" /> Loading videos…</div>
                    ) : olderVideos.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
                        <Film className="mx-auto mb-2 size-6 text-zinc-600" />
                        <p className="text-[13px] text-zinc-300">No videos older than 3 days yet</p>
                        <p className="mt-1 text-[11px] text-zinc-500">New uploads will appear here once they pass the 3-day mark.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {olderVideos.map((video) => (
                          <article key={video.id} className={`${cardCls} overflow-hidden`}>
                            <video src={video.videoUrl} poster={video.posterUrl ?? undefined} controls preload="metadata"
                              className="aspect-video w-full bg-black object-contain" aria-label={video.title || "Agent video"} />
                            <div className="space-y-2 p-3">
                              <p className="line-clamp-2 text-[12px] font-semibold text-zinc-200">{video.title || video.description || "Untitled video"}</p>
                              <div className="flex items-center justify-between gap-2 text-[10.5px] text-zinc-500">
                                <span>{new Date(video.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} · {video.state}</span>
                                {video.postUrl && <a href={video.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-pink-300 hover:text-pink-200">View post <ExternalLink className="size-3" /></a>}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </div>

          {/* ── Bottom stats bar ── */}
          <div className="shrink-0 flex items-center gap-5 px-5 h-12 border-t overflow-x-auto text-[12.5px] whitespace-nowrap" style={{ borderColor: ME.border, background: ME.panel, color: ME.sub }}>
            <span className="font-semibold" style={{ color: ME.text }}>{agentType.replace("AI ", "")}</span>
            <span>Share: <span className="font-semibold tabular-nums" style={{ color: ME.text }}>${(agent.sharePrice ?? 0).toFixed(2)}</span></span>
            <span>TVL: <span className="font-semibold tabular-nums" style={{ color: ME.text }}>{agent.tvl > 0 ? `$${agent.tvl.toLocaleString()}` : "—"}</span></span>
            <span>APR: <span className="font-semibold tabular-nums" style={{ color: apr >= 0 ? ME.green : "#f87171" }}>{apr.toFixed(1)}%</span></span>
            <span>Monthly: <span className="font-semibold tabular-nums" style={{ color: ME.text }}>{agent.monthlyEarnings > 0 ? `$${agent.monthlyEarnings}` : "—"}</span></span>
            <span>Tasks: <span className="font-semibold tabular-nums" style={{ color: ME.text }}>{taskStats ? taskStats.succeeded : "—"}</span></span>
            <span className="ml-auto">Age: <span className="font-semibold" style={{ color: ME.text }}>{ageLabel}</span></span>
          </div>
        </div>

      </motion.div>
    </motion.div>
  );
}

// ─── Premium agent-type mark ───────────────────────────────────────────────
// ─── Agent NFT card ───────────────────────────────────────────────────────────

// Pink marketplace mark — stands in for the "ME" glyph in the reference next to
// every price.
function MeMark() {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-[3px] shrink-0"
      style={{ width: 13, height: 13, background: ME.accent, boxShadow: `0 0 6px ${ME.accent}55` }}
    >
      <Sparkles className="size-2 text-white" strokeWidth={2.6} />
    </span>
  );
}

// Always-present card description — the agent's own bio, or a generic
// fallback so the line never disappears and cards stay a consistent height.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function agentDescription(agent: any): string {
  return agent.description || formatAgentDescription(agent);
}

function compactMetric(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString("en-US");
}

function trendTone(current: number, previous: number) {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

function AgentMetricPill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: "up" | "down" | "flat";
}) {
  const TrendIcon = tone === "down" ? ArrowDownRight : ArrowUpRight;
  const color = tone === "down" ? "#f87171" : tone === "up" ? ME.green : "rgba(255,255,255,0.38)";
  const bg = tone === "down" ? "rgba(248,113,113,0.09)" : tone === "up" ? "rgba(52,211,153,0.09)" : "rgba(255,255,255,0.04)";
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1"
      style={{ borderColor: tone === "down" ? "rgba(248,113,113,0.22)" : tone === "up" ? "rgba(52,211,153,0.22)" : "rgba(255,255,255,0.08)", background: bg }}
      title={`${label}: ${value.toLocaleString("en-US")}`}
    >
      <Icon className="size-3 shrink-0" style={{ color }} />
      <span className="min-w-0 text-[10px] uppercase tracking-wide text-white/35">{label}</span>
      <span className="text-[11.5px] font-semibold tabular-nums text-white">
        <FlipCounter value={compactMetric(value)} />
      </span>
      <TrendIcon className="size-3 shrink-0" style={{ color }} />
    </span>
  );
}

// Hover overlay — frosted/darkened layer over the WHOLE card. Top: name.
// Middle: the agent's description (fills the card). Bottom: knowledge progress.
// The knowledge query is gated on `hovered` ("skip" until then) so we never fan
// out a query for every card.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CardHoverInfo({ agent, onClick }: { agent: any; hovered?: boolean; onClick?: () => void }) {
  const desc = agentDescription(agent);
  return (
    <div
      // Overlay covers the SQUARE IMAGE only (top-0 + aspect-square) — never the text
      // container below. Blur + fade animate in smoothly on hover (transition covers
      // both opacity and backdrop-filter). pointer-events flip on so the description
      // can actually be scrolled when it's long; onWheel is contained so scrolling the
      // overlay doesn't also scroll the page behind it. When `onClick` is supplied the
      // overlay forwards the click to open the detail modal — otherwise, once hover
      // makes it pointer-events-auto, it would swallow clicks meant for the card.
      className={`card-hover-overlay pointer-events-none absolute inset-x-0 top-0 z-20 flex aspect-square flex-col overflow-y-auto p-3.5 opacity-0 backdrop-blur-0 transition-[opacity,backdrop-filter] duration-300 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-hover:backdrop-blur-md${onClick ? " cursor-pointer" : ""}`}
      style={{ background: "rgba(8,10,14,0.74)" }}
      onWheel={(e) => e.stopPropagation()}
      onClick={onClick}
      aria-hidden
    >
      <p className="text-[11.5px] leading-relaxed text-white/90">{desc}</p>
    </div>
  );
}

// Abstract 8bit pixel-scatter, top-right corner — same lime-green accent as
// /studio's My Agents cards. Crisp squares (no anti-aliasing) read as "8bit";
// density thins out away from the corner so it fades into the card.
function PixelCorner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 80 80"
      className="pointer-events-none absolute -right-2 -top-2 z-0 size-24 opacity-70 transition-opacity duration-300 group-hover:opacity-100 sm:size-28"
      style={{ shapeRendering: "crispEdges" }}
    >
      <rect x="60" y="4" width="10" height="10" fill="#a3e635" opacity="0.9" />
      <rect x="48" y="4" width="6" height="6" fill="#84cc16" opacity="0.55" />
      <rect x="66" y="18" width="7" height="7" fill="#bef264" opacity="0.7" />
      <rect x="54" y="16" width="5" height="5" fill="#65a30d" opacity="0.4" />
      <rect x="34" y="6" width="4" height="4" fill="#84cc16" opacity="0.3" />
      <rect x="70" y="32" width="5" height="5" fill="#a3e635" opacity="0.5" />
      <rect x="44" y="22" width="4" height="4" fill="#bef264" opacity="0.35" />
      <rect x="58" y="30" width="4" height="4" fill="#65a30d" opacity="0.3" />
      <rect x="22" y="2" width="3" height="3" fill="#a3e635" opacity="0.2" />
      <rect x="66" y="44" width="3" height="3" fill="#84cc16" opacity="0.25" />
    </svg>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AgentCard({ agent, index, onClick, metrics }: { agent: any; index: number; onClick: () => void; videos?: number; metrics?: AgentMarketMetrics }) {
  const [hovered, setHovered] = useState(false);
  const agentType = resolveAgentType(agent);
  const tvl = agent.tvl ?? 0;
  const tvlLabel = tvl >= 1000 ? `$${(tvl / 1000).toFixed(1)}K` : `$${tvl.toFixed(0)}`;
  const ticker: string | undefined = agent.coinTicker ?? agent.ticker;
  const cap = useAgentCap(agent.solstarCharacterId);
  const solUsd = useSolUsd();
  const capLabel = cap?.capSol != null && solUsd ? formatUsdEstimate(String(Math.round(cap.capSol * 1e9)), solUsd) : null;
  const open = (e: React.KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    // A div, not a <button>: the connected-account badges inside are real links
    // that open the social profile in a new tab, and links can't nest in buttons.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={open}
      title={agent.name}
      className="group relative flex h-40 cursor-pointer items-stretch overflow-hidden rounded-[10px] border border-white/10 bg-[#131316] text-left transition-[background-color,border-color,transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-[#1a1a1e] hover:shadow-[0_14px_30px_-14px_rgba(0,0,0,0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 motion-reduce:transition-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative h-full w-32 shrink-0 overflow-hidden bg-white/5 sm:w-36">
        <AgentAvatar url={agent.avatarUrl} name={agent.name} seed={agent.mintAddress} className="size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04]" initialClassName="text-5xl" />
      </div>

      <PixelCorner />

      {/* Agent-type indicator — pinned to the card's actual top-right corner. */}
      <span
        title={agentType}
        className="absolute right-2 top-2 z-10 grid size-7 shrink-0 place-items-center rounded-[8px] border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.06] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.4),0_3px_8px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      >
        {agentType === "AI Clippers" ? <Clapperboard className="size-3.5" /> : <Gem className="size-3.5" />}
      </span>

      <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col justify-between px-4 py-3 pr-10">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[15px] font-bold uppercase tracking-wide text-white">{agent.name || "Agent"}</p>
            {ticker && (
              <span className="shrink-0 rounded-[5px] bg-white px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-wide text-black">
                {ticker.toUpperCase()}
              </span>
            )}
            <HeartbeatHeart agent={agent} />
          </div>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-white/50">{agentDescription(agent)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AgentMetricPill icon={Eye} label="Views" value={metrics?.views ?? 0} tone={trendTone(metrics?.todayViews ?? 0, metrics?.yesterdayViews ?? 0)} />
            <AgentMetricPill icon={UserPlus} label="Followers" value={metrics?.followers ?? 0} tone={trendTone(metrics?.followerDelta ?? 0, 0)} />
          </div>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">{capLabel ? "Market cap" : "TVL"}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-[17px] font-semibold leading-none tracking-tight text-white tabular-nums">
                {capLabel ?? tvlLabel}
              </span>
              {capLabel && <ChangePill value={cap?.changePct} />}
            </div>
          </div>
          <ConnectedPlatformStack
            platforms={agent.connectedPlatforms}
            accounts={agent.connectedSocialAccounts}
            badgeClassName="size-6"
            ringClassName="ring-[#131316]"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Hire card — optimized around Total Profit + Wallet Balance ───────────────
// Compact countdown to the agent's next heartbeat fire (server cron interval).
function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60), min = m % 60;
  return `${h}h ${min}m`;
}

/** Live-heartbeat marker — a pulsing heart shown right after the agent's name
 *  wherever that name is rendered. Absent = the agent's heartbeat is paused. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HeartbeatHeart({ agent, className = "size-3" }: { agent: any; className?: string }) {
  if (!agent?.heartbeatEnabled) return null;
  return (
    <Heart
      className={`${className} shrink-0 animate-pulse`}
      style={{ color: ME.accent, fill: ME.accent }}
      aria-label="Heartbeat on"
      role="img"
    >
      <title>Heartbeat on</title>
    </Heart>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function NextHeartbeat({ agent }: { agent: any }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Single source of truth = the persistent, per-account, wall-clock-aligned slot
  // stored on the agent (heartbeatNextFireAt). Reading it means the countdown is
  // identical on every reload and staggered per account — no mount-time anchor.
  // Brand-new agents the cron hasn't seeded yet fall back to the SAME pure math
  // the server uses, so the UI still matches exactly.
  const intervalMs = resolveIntervalMs(agent.heartbeatCron);
  let target: number = agent.heartbeatNextFireAt ?? 0;
  if (intervalMs > 0 && (target <= 0 || target <= now)) {
    target = nextHeartbeatFireAt(now, intervalMs, agent.mintAddress ?? agent.name ?? "");
  }
  const remaining = intervalMs > 0 ? Math.max(0, target - now) : 0;

  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold tabular-nums whitespace-nowrap" style={{ color: ME.accent }} title="Time to next heartbeat">
      <span className="size-1.5 rounded-full animate-pulse" style={{ background: ME.accent }} />
      {fmtCountdown(remaining)}
    </span>
  );
}

// Shared on-chain wallet balance fetch — module-cached + in-flight-deduped so the
// grid (many cards) never refetches on re-render or duplicates calls for the same
// wallet. The detail modal fetches the same endpoint; here we surface it on the card.
const _walletBalCache = new Map<string, { usdc: number; sol: number }>();
const _walletBalInflight = new Map<string, Promise<{ usdc: number; sol: number } | null>>();
function useAgentWalletBalance(wallet?: string): { usdc: number; sol: number } | null {
  // Cache hits seed initial state here (no setState-in-effect); the effect only
  // fetches on a miss and updates asynchronously.
  const [bal, setBal] = useState<{ usdc: number; sol: number } | null>(
    () => (wallet ? _walletBalCache.get(wallet) ?? null : null),
  );
  useEffect(() => {
    if (!wallet || _walletBalCache.has(wallet)) return; // unset, or already cached → initial state covers it
    let alive = true;
    let pr = _walletBalInflight.get(wallet);
    if (!pr) {
      pr = fetch(`/api/agent-wallet-balance?wallet=${wallet}`)
        .then((r) => r.json())
        .then((d: { ok?: boolean; usdc?: number; sol?: number }) => {
          if (d?.ok) { const v = { usdc: d.usdc ?? 0, sol: d.sol ?? 0 }; _walletBalCache.set(wallet, v); return v; }
          return null;
        })
        .catch(() => null)
        .finally(() => { _walletBalInflight.delete(wallet); });
      _walletBalInflight.set(wallet, pr);
    }
    pr.then((v) => { if (alive && v) setBal(v); });
    return () => { alive = false; };
  }, [wallet]);
  return bal;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HireCard({ agent, onClick, videos, metrics }: { agent: any; index: number; onClick: () => void; videos?: number; metrics?: AgentMarketMetrics }) {
  const agentType = resolveAgentType(agent);
  const [hovered, setHovered] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);

  // Hiring pricing from the agent's "Charge Per Video" + "Marketplace Hiring"
  // skills (Convex influencers.monetization). Falls back to "—" when unset.
  const mon = agent.monetization ?? {};
  // Only agents that installed the "Charge Per Video" (hire-per-task) skill are
  // open for hire — gate the Hire CTA on it so we never offer hiring for an agent
  // the operator hasn't set up for commissions.
  const openForHire = (agent.installedSkills ?? []).includes("monetize.pervideo");
  const perVideo = typeof mon.costPerVideo === "number" && mon.costPerVideo > 0 ? mon.costPerVideo : null;
  const monthlyRate = typeof mon.monthlyRate === "number" && mon.monthlyRate > 0 ? mon.monthlyRate : null;

  return (
    <div
      title={agent.name}
      className="group relative flex h-36 items-stretch overflow-hidden rounded-lg border border-white/10 bg-[#131316] transition-colors hover:bg-[#1a1a1e]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <PixelCorner />

      {/* Agent-type indicator — same mark as /studio's My Agents cards
          (clapperboard for AI Clippers, gem for AI Influencers), pinned to
          the card's actual top-right corner (not the text column). */}
      <span
        title={agentType}
        className="absolute right-2 top-2 z-20 grid size-7 shrink-0 place-items-center rounded-xl border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.06] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.4),0_3px_8px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      >
        {agentType === "AI Clippers" ? <Clapperboard className="size-3.5" /> : <Gem className="size-3.5" />}
      </span>

      {/* Avatar — opens the agent detail (where hiring is completed) */}
      <button
        type="button" onClick={onClick} tabIndex={-1} aria-hidden
        className="relative h-full w-32 shrink-0 overflow-hidden bg-white/5 sm:w-36"
      >
        <AgentAvatar url={agent.avatarUrl} name={agent.name} seed={agent.mintAddress} className="size-full object-cover object-top" initialClassName="text-5xl" />
      </button>

      <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col justify-between gap-2 px-4 py-3">
        {/* Name (+ heartbeat + connected accounts) and a 3-line description —
            clickable, opens the agent detail. */}
        <button
          type="button" onClick={onClick}
          className="min-w-0 pr-7 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/60"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="truncate text-[15px] font-light text-white">{agent.name || "Agent"}</p>
            <HeartbeatHeart agent={agent} />
            <ConnectedPlatformStack platforms={agent.connectedPlatforms} badgeClassName="size-5" ringClassName="ring-[#131316]" />
          </div>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-white/50">{agentDescription(agent)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AgentMetricPill icon={Eye} label="Views" value={metrics?.views ?? 0} tone={trendTone(metrics?.todayViews ?? 0, metrics?.yesterdayViews ?? 0)} />
            <AgentMetricPill icon={UserPlus} label="Followers" value={metrics?.followers ?? 0} tone={trendTone(metrics?.followerDelta ?? 0, 0)} />
          </div>
        </button>

        {/* One row: heartbeat countdown · price-or-videos · Hire / Details. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center text-[11.5px] text-white/45">
            {agent.heartbeatEnabled && resolveIntervalMs(agent.heartbeatCron) > 0 && <NextHeartbeat agent={agent} />}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Agents set up for hire show their PRICE; everyone else shows
                total videos generated. */}
            {perVideo != null ? (
              <div className="flex items-baseline gap-1 text-[12px] text-white/45" title="Price per generated video">
                <span className="text-[14px] font-medium text-white">${perVideo}</span>
                <span>/ video</span>
                {monthlyRate != null && <span>· ${monthlyRate}/mo</span>}
              </div>
            ) : (
              <p className="whitespace-nowrap text-[12px] tabular-nums text-white/45" title="Total videos this agent has generated">
                {(videos ?? 0).toLocaleString()} video{videos === 1 ? "" : "s"}
              </p>
            )}
            {/* Hire CTA only shows when the agent installed the per-task hiring skill. */}
            {openForHire && (
              <button
                type="button" onClick={(e) => { e.stopPropagation(); setHireOpen(true); }}
                className="h-7 rounded-md px-3 text-[11.5px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"
                style={{ background: ME.accent }}
              >
                Hire
              </button>
            )}
            <button
              type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
              className="h-7 rounded-md border border-white/15 px-3 text-[11.5px] font-medium text-white/70 transition-colors hover:bg-white/10"
            >
              Details
            </button>
          </div>
        </div>
      </div>

      {hireOpen && (
        <HireGenerateModal
          agent={{
            mint: agent.mintAddress ?? agent._id,
            name: agent.name ?? "Agent",
            avatarUrl: agent.avatarUrl ?? "",
            niche: agent.niche ?? "lifestyle",
            agentType,
          }}
          onClose={() => setHireOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Purchase card — buy-focused: price + supply ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PurchaseCard({ agent, index, onClick, metrics }: { agent: any; index: number; onClick: () => void; videos?: number; metrics?: AgentMarketMetrics }) {
  const [hovered, setHovered] = useState(false);
  const agentType = resolveAgentType(agent);
  const price = agent.sharePrice ?? 0;
  const total = agent.totalShares ?? 0;
  const avail = agent.availableShares ?? 0;
  const availPct = total > 0 ? Math.max(0, Math.min(100, (avail / total) * 100)) : 0;

  return (
    <button
      type="button" onClick={onClick} title={agent.name}
      className="group relative flex h-36 items-stretch overflow-hidden rounded-lg border border-white/10 bg-[#131316] text-left transition-colors hover:bg-[#1a1a1e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/60"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative h-full w-32 shrink-0 overflow-hidden bg-white/5 sm:w-36">
        <AgentAvatar url={agent.avatarUrl} name={agent.name} seed={agent.mintAddress} className="size-full object-cover object-top" initialClassName="text-5xl" />
      </div>

      <PixelCorner />

      {/* Agent-type indicator — pinned to the card's actual top-right corner. */}
      <span
        title={agentType}
        className="absolute right-2 top-2 z-10 grid size-7 shrink-0 place-items-center rounded-xl border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.06] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.4),0_3px_8px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      >
        {agentType === "AI Clippers" ? <Clapperboard className="size-3.5" /> : <Gem className="size-3.5" />}
      </span>

      {/* Name + description stacked at top; price/supply + connected accounts
          pinned bottom-right so the card reads name → description → detail. */}
      <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col justify-between px-4 py-3 pr-9">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="truncate text-[15px] font-light text-white">{agent.name || "Agent"}</p>
            <HeartbeatHeart agent={agent} />
            <ConnectedPlatformStack platforms={agent.connectedPlatforms} badgeClassName="size-5" ringClassName="ring-[#131316]" />
          </div>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-white/50">{agentDescription(agent)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AgentMetricPill icon={Eye} label="Views" value={metrics?.views ?? 0} tone={trendTone(metrics?.todayViews ?? 0, metrics?.yesterdayViews ?? 0)} />
            <AgentMetricPill icon={UserPlus} label="Followers" value={metrics?.followers ?? 0} tone={trendTone(metrics?.followerDelta ?? 0, 0)} />
          </div>
        </div>
        <div className="flex items-end justify-end gap-3">
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex items-baseline gap-1.5 text-[14px] font-medium text-white">
              <span className="tabular-nums">${price.toFixed(2)}</span>
              <MeMark />
              <span className="text-[11.5px] text-white/45">/ share</span>
            </div>
            {/* Supply — available shares with a progress bar (bar empties as shares sell) */}
            <div className="flex w-32 flex-col gap-1" title="Shares available">
              <div className="flex items-center justify-between text-[11px] tabular-nums text-white/45">
                <span className="inline-flex items-center gap-1"><Layers className="size-3 shrink-0" aria-hidden /> {avail.toLocaleString()} / {total.toLocaleString()}</span>
                <span style={{ color: ME.green }}>{availPct.toFixed(0)}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden bg-white/10">
                <div className="h-full transition-[width] duration-500" style={{ width: `${availPct}%`, background: ME.green }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Agents hero actions — the same mascot in two purposeful poses ───────────
function AgentHeroActionCard({ href, title, art }: {
  href: string;
  title: string;
  /** Slow looping GIF that plays across the whole button. */
  art: string;
}) {
  return (
    <Link
      href={href}
      className="group relative isolate flex h-[50px] min-w-0 items-center overflow-hidden rounded-[10px] bg-[#16201c] px-4 text-left text-white transition-[transform,filter] duration-500 ease-out hover:-translate-y-0.5 hover:brightness-125 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:h-[54px] sm:w-[214px]"
      style={{ fontFamily: "var(--font-geist-sans)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- animated GIF background */}
      <img
        src={art}
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
      />
      <span className="relative block text-[13px] font-semibold leading-[1.16] tracking-[-0.02em] sm:text-[14px]">{title}</span>
    </Link>
  );
}

// ─── Feature tile — the "Create New Agent" / "Instant Sell" hero cells ────────
// Animated background: the hero image + a looping CSS light-sweep (no gif asset
// exists in the repo, so this stands in for one and respects reduced-motion).
function FeatureTile({
  icon: Icon, label, value, button, onButton, sub, onSub, bg = "/market-hero.jpg", bgVideo,
  bigLabel = false, smallButton = false,
}: {
  icon: React.ElementType;
  label: string;
  value?: string;
  button: string;
  onButton: () => void;
  sub?: string;
  onSub?: () => void;
  bg?: string;
  /** Looping muted video, layered over `bg` (used as the poster) — a real
   *  moving background instead of the static-image + CSS-sheen stand-in. */
  bgVideo?: string;
  bigLabel?: boolean;
  smallButton?: boolean;
}) {
  return (
    <div className="me-tile group relative flex min-h-[128px] flex-col items-center justify-center overflow-hidden rounded-lg border border-white/10 p-3 text-center sm:min-h-[136px]">
      {/* Background — looping video when supplied, else the static image. */}
      {bgVideo ? (
        <video
          className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
          src={bgVideo}
          poster={bg}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden
        />
      ) : (
        <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105" style={{ backgroundImage: `url('${bg}')` }} aria-hidden />
      )}
      {/* Animated lime light-sweep — a fast diagonal shine plus a slower pulsing glow ring */}
      <div className="me-sheen absolute inset-0 pointer-events-none" aria-hidden />
      <div className="me-pulse-ring pointer-events-none absolute inset-0" aria-hidden />
      {/* Scrim for text contrast */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,10,14,0.4), rgba(8,10,14,0.82))" }} aria-hidden />

      <div className="relative z-10 flex flex-col items-center gap-1 w-full">
        <Icon className="me-icon-pulse size-6 mb-0.5" style={{ color: ME.lime, filter: `drop-shadow(0 0 8px ${ME.lime}66)` }} aria-hidden />
        <p className={`font-semibold text-white leading-tight ${bigLabel ? "text-[16px]" : "text-[12px]"}`}>{label}</p>
        {value && <p className="text-[18px] font-bold tabular-nums text-white">{value}</p>}
        <button
          type="button"
          onClick={onButton}
          className={`mt-2 font-bold transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${smallButton ? "h-6 px-3.5 text-[11px]" : "h-6 w-full text-[12px]"}`}
          style={{ background: ME.lime, color: ME.limeText, boxShadow: `0 0 14px ${ME.lime}55` }}
        >
          {button}
        </button>
        {sub && (
          <button type="button" onClick={onSub} className="mt-1.5 text-[11px] text-white/70 hover:text-white transition-colors">
            {sub}
          </button>
        )}
      </div>

      <style>{`
        @keyframes meSheen { 0% { background-position: 220% 0; } 100% { background-position: -80% 0; } }
        .me-tile .me-sheen {
          background: linear-gradient(115deg, transparent 30%, rgba(163,230,53,0.3) 48%, rgba(255,255,255,0.18) 53%, transparent 72%);
          background-size: 260% 100%;
          animation: meSheen 2.2s linear infinite;
        }
        @keyframes mePulseRing {
          0%, 100% { box-shadow: inset 0 0 0 1px rgba(163,230,53,0.15), inset 0 0 24px rgba(163,230,53,0.06); }
          50% { box-shadow: inset 0 0 0 1.5px rgba(163,230,53,0.4), inset 0 0 36px rgba(163,230,53,0.16); }
        }
        .me-tile .me-pulse-ring { animation: mePulseRing 2.4s ease-in-out infinite; }
        @keyframes meIconPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
        .me-tile .me-icon-pulse { animation: meIconPulse 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .me-tile .me-sheen, .me-tile .me-pulse-ring, .me-tile .me-icon-pulse { animation: none; }
        }
      `}</style>
    </div>
  );
}

// ─── List row ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AgentRow({ agent, index, onClick }: { agent: any; index: number; onClick: () => void }) {
  const apr = agent.tvl > 0 ? ((agent.monthlyEarnings * 12) / agent.tvl) * 100 : 0;
  return (
    <div onClick={onClick} className="grid grid-cols-[40px_48px_1fr_100px_100px_100px_100px_80px] items-center gap-3 px-4 py-2.5 border-b border-[#27272a] hover:bg-white/[0.03] cursor-pointer transition-colors">
      <span className="text-zinc-600 text-[11px] tabular-nums">#{String(index + 1).padStart(4, "0")}</span>
      <div className="h-10 w-10 rounded-lg overflow-hidden bg-zinc-800 shrink-0">
        <AgentAvatar
          url={agent.avatarUrl}
          name={agent.name}
          className="w-full h-full object-cover"
          initialClassName="text-lg"
        />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-white text-[13px] truncate">{agent.name}</p>
        <p className="text-[11px] text-zinc-500">{agent.niche} · {agent.language}</p>
      </div>
      <span className="text-[13px] font-bold text-white tabular-nums">${agent.sharePrice.toFixed(2)}</span>
      <span className={`text-[13px] font-bold tabular-nums ${apr >= 20 ? "text-emerald-400" : apr >= 10 ? "text-amber-400" : "text-zinc-400"}`}>
        {apr > 0 ? `${apr.toFixed(1)}%` : "—"}
      </span>
      <span className="text-[13px] text-zinc-300 tabular-nums">${agent.tvl.toLocaleString()}</span>
      <span className="text-[13px] text-zinc-300 tabular-nums">${agent.monthlyEarnings.toLocaleString()}</span>
      <span className="text-zinc-600 text-[11px]">—</span>
    </div>
  );
}

// ─── Filter group ─────────────────────────────────────────────────────────────

/** Compact toolbar filter dropdown — same look as the Sort control beside it.
 *  `isOpen` is controlled by the caller so only one toolbar dropdown is ever
 *  open at a time. */
function ToolbarDropdown({ label, value, options, isOpen, onToggle, onSelect }: {
  label: string; value: string; options: string[]; isOpen: boolean; onToggle: () => void; onSelect: (v: string) => void;
}) {
  return (
    <div className="relative isolate shrink-0">
      <button onClick={onToggle} className="flex items-center gap-2 h-8 px-3 rounded-md text-[12.5px]" style={{ border: `1px solid ${value !== "All" ? ME.accentDim : ME.border}`, background: "#15171d", color: value !== "All" ? ME.accent : ME.text }}>
        {value === "All" ? label : value} <ChevronDown className="size-3.5" style={{ color: ME.sub }} />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 rounded-lg py-1 shadow-2xl z-[999] backdrop-blur-md" style={{ border: `1px solid ${ME.border}`, background: "rgba(21,23,29,0.95)" }}>
          {options.map((opt) => (
            <button key={opt} onClick={() => onSelect(opt)}
              className="w-full text-left px-3 py-1.5 text-[12.5px] transition-colors"
              style={{ color: value === opt ? ME.text : ME.sub, background: value === opt ? "rgba(255,255,255,0.06)" : "transparent" }}>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Live actions feed (all agents, realtime via Convex) ───────────────────────
const ACTION_LABEL: Record<string, string> = {
  create_video: "Created a video", post_content: "Posted content", analyze_trend: "Analyzed trends",
  research: "Researched", campaign_submit: "Submitted to campaign", check_wallet: "Checked wallet",
  find_jobs: "Scouted campaigns", trader_tick: "Ran a trade cycle", binary_scan: "Scanned binaries",
  settle_bets: "Settled bets", self_reflect: "Reflected", engage_comment: "Engaged a comment",
  clip: "Clipped a video",
};

type AgentsPanel = "browse" | "activity" | "chart" | "videos";

/** Activity / Videos switch. `compact` = the mobile icon-only pill (segmented,
 *  sliding highlight); otherwise labelled buttons for sm and up. Tapping the
 *  active one returns to the agent grid. */
function PanelSwitch({ panel, setPanel, compact }: { panel: AgentsPanel; setPanel: (fn: (p: AgentsPanel) => AgentsPanel) => void; compact?: boolean }) {
  const items = [
    { id: "activity", label: "Activity", Icon: Activity },
    { id: "videos", label: "Videos", Icon: Film },
  ] as const;
  if (compact) {
    return (
      <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-black/40 p-0.5 backdrop-blur-md">
        {items.map(({ id, label, Icon }) => {
          const active = panel === id;
          return (
            <button key={id} type="button" aria-label={label} aria-pressed={active} title={label}
              onClick={() => setPanel((p) => (p === id ? "browse" : id))}
              className={`relative grid size-8 place-items-center rounded-full transition-colors ${active ? "text-white" : "text-white/45 active:text-white/80"}`}>
              {active && <motion.span layoutId="agents-panel-pill" className="absolute inset-0 rounded-full bg-white/15" transition={{ type: "spring", stiffness: 420, damping: 32 }} />}
              <Icon className="relative size-3.5" />
              {id === "activity" && <span className={`absolute right-1.5 top-1.5 size-1.5 rounded-full bg-emerald-400 ${active ? "animate-pulse" : "opacity-70"}`} />}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {items.map(({ id, label, Icon }) => {
        const active = panel === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setPanel((p) => (p === id ? "browse" : id))}
            aria-pressed={active}
            // Same glass pill as the header's Upgrade button.
            className={`inline-flex h-9 items-center gap-1.5 rounded-xl border bg-[linear-gradient(145deg,rgba(255,255,255,0.13),rgba(255,255,255,0.035)_52%,rgba(105,170,43,0.08))] px-3.5 text-[13px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_6px_18px_rgba(0,0,0,0.25)] backdrop-blur-2xl transition-all duration-200 hover:border-lime-300/30 hover:bg-white/[0.12] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_22px_rgba(0,0,0,0.3)] ${active ? "border-lime-300/40 text-white" : "border-white/[0.18] text-white/75 hover:text-white"}`}
          >
            {id === "activity" && <span className={`size-1.5 rounded-full bg-emerald-400 ${active ? "animate-pulse" : "opacity-70"}`} />}
            <Icon className="size-3.5" /> {label}
          </button>
        );
      })}
    </div>
  );
}

type ActivityFilter = "all" | "running" | "succeeded" | "failed";

function LiveActivity() {
  const tasks = useQuery(api.agentTasks.listRecentAll, { limit: 60 });
  type RecentTask = NonNullable<typeof tasks>[number];
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const all = tasks ?? [];
  const counts = {
    all: all.length,
    running: all.filter((t: RecentTask) => t.status === "running").length,
    succeeded: all.filter((t: RecentTask) => t.status === "succeeded").length,
    failed: all.filter((t: RecentTask) => t.status === "failed").length,
  };
  const agentsActive = new Set(all.map((t: RecentTask) => t.agentName)).size;
  const earned = all.reduce((n: number, t: RecentTask) => n + (typeof t.revenue === "number" && t.revenue > 0 ? t.revenue : 0), 0);
  const shown = filter === "all" ? all : all.filter((t: RecentTask) => t.status === filter);
  const FILTERS: { id: ActivityFilter; label: string; dot: string }[] = [
    { id: "all", label: "All", dot: "bg-white/40" },
    { id: "running", label: "Running", dot: "bg-sky-400" },
    { id: "succeeded", label: "Done", dot: "bg-emerald-400" },
    { id: "failed", label: "Failed", dot: "bg-rose-400" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 sm:px-5">
        <div className="relative overflow-hidden rounded-2xl" style={{ border: `1px solid ${ME.border}`, background: ME.panel }}>
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(70% 120% at 0% 0%, rgba(52,211,153,0.10), transparent 60%)" }} />
          <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-center gap-3">
              <div className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-400/25 bg-emerald-400/10">
                <Activity className="size-[18px] text-emerald-300" />
                <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
                  <span className="relative size-2.5 rounded-full border-2 border-[var(--me-panel)] bg-emerald-400" />
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-tight sm:text-[16px]" style={{ color: ME.text }}>Live Agent Activity</h2>
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider text-emerald-300">Live</span>
                </div>
                <p className="mt-0.5 text-[11.5px]" style={{ color: ME.sub }}>
                  {tasks === undefined ? "Connecting to the agent network…" : "Every task agents run across Vello, in real time."}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 sm:flex sm:gap-2.5">
              {[
                { k: "Running", v: tasks === undefined ? "–" : String(counts.running), c: "text-sky-300" },
                { k: "Agents", v: tasks === undefined ? "–" : String(agentsActive), c: "" },
                { k: "Earned", v: tasks === undefined ? "–" : `$${earned.toFixed(2)}`, c: "text-emerald-300" },
              ].map((m) => (
                <div key={m.k} className="rounded-xl px-3 py-2 sm:min-w-[84px]" style={{ background: ME.card, border: `1px solid ${ME.border}` }}>
                  <dt className="text-[10px] font-medium uppercase tracking-wider" style={{ color: ME.subDim }}>{m.k}</dt>
                  <dd className={`mt-0.5 text-[15px] font-semibold tabular-nums ${m.c}`} style={m.c ? undefined : { color: ME.text }}>{m.v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative flex items-center gap-1 overflow-x-auto border-t px-3 py-2 scrollbar-none sm:px-4" style={{ borderColor: ME.border }}>
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                  className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors ${active ? "text-white" : "text-white/45 hover:text-white/75"}`}>
                  {active && <motion.span layoutId="activity-filter" className="absolute inset-0 rounded-lg bg-white/[0.08]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  <span className={`relative size-1.5 rounded-full ${f.dot}`} />
                  <span className="relative">{f.label}</span>
                  <span className="relative tabular-nums text-white/35">{tasks === undefined ? "" : counts[f.id]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 min-h-0 overflow-y-auto scroll-black px-4 py-3">
        {tasks === undefined ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: ME.card, border: `1px solid ${ME.border}` }} />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-2">
            <Activity className="size-7" style={{ color: ME.subDim }} />
            <p className="text-[13px]" style={{ color: ME.sub }}>{filter === "all" ? "No agent activity yet." : `No ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} tasks right now.`}</p>
          </div>
        ) : (
          <div className="reveal-stagger space-y-1.5">
            {shown.map((t: RecentTask) => (
              <div key={t._id} className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors" style={{ background: ME.card, border: `1px solid ${ME.border}` }}>
                <AgentAvatar url={t.agentAvatar} name={t.agentName} className="size-8 rounded-lg shrink-0" initialClassName="text-[11px]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-semibold truncate" style={{ color: ME.text }}>{t.agentName}</span>
                    <span className="text-[11.5px] shrink-0" style={{ color: ME.subDim }}>{ACTION_LABEL[t.type] ?? t.type.replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-[11.5px] truncate" style={{ color: ME.sub }}>{t.title}</p>
                  {t.status === "failed" && (
                    <p className="mt-1.5 rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1.5 text-[11px] leading-snug text-rose-300/90 break-words">
                      <span className="font-semibold text-rose-300">Why it failed: </span>{t.errorMessage || "Task failed, no reason recorded."}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {typeof t.revenue === "number" && t.revenue > 0 ? <span className="text-[11px] font-mono font-bold" style={{ color: ME.green }}>+${t.revenue.toFixed(2)}</span> : null}
                  <TaskStatusIcon status={t.status} />
                  <span className="text-[10.5px] tabular-nums w-12 text-right" style={{ color: ME.subDim }}>
                    {timeAgo(t.startedAt ?? t.completedAt ?? t._creationTime)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Solana price chart (TradingView advanced widget) ──────────────────────────
function SolanaChart() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    host.appendChild(widget);
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: "BINANCE:SOLUSDT",
      interval: "60",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      allow_symbol_change: true,
      hide_side_toolbar: false,
      backgroundColor: "rgba(10,11,14,1)",
      gridColor: "rgba(255,255,255,0.05)",
      support_host: "https://www.tradingview.com",
    });
    host.appendChild(script);
    return () => { host.innerHTML = ""; };
  }, []);
  return (
    <div className="h-full w-full overflow-hidden rounded-2xl" style={{ border: `1px solid ${ME.border}`, background: ME.bg }}>
      <div ref={ref} className="tradingview-widget-container h-full w-full" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Client-side heartbeat dispatcher. The Convex cron creates the planned tasks but
 * dispatches them by fetching the Next server over HTTP — which fails in local
 * HTTPS dev (self-signed cert) so tasks get stuck on "pending". While this page is
 * open, we poll the still-pending tasks and execute them via the SAME-ORIGIN
 * run-task route (the browser trusts its own cert), exactly like the builder does.
 * `claimPending` makes this race-safe against the Convex dispatcher in production.
 * Renders nothing.
 */
function HeartbeatDispatcher() {
  const pending = useQuery(api.agentTasks.listPendingAll, { limit: 20 });
  type PendingTask = NonNullable<typeof pending>[number];
  const dispatched = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!pending || pending.length === 0) return;
    // Cap concurrency — run-task returns quickly (heavy work is deferred), so the
    // rest drain on the next reactive tick as these flip to "running".
    const fresh = pending.filter((t: PendingTask) => !dispatched.current.has(t._id)).slice(0, 3);
    for (const t of fresh) {
      dispatched.current.add(t._id);
      let input: Record<string, unknown> = {};
      try { input = t.input ? JSON.parse(t.input) : {}; } catch { input = {}; }
      void fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: t.mintAddress,
          taskType: t.type,
          title: t.title,
          input,
          triggeredBy: "client_dispatch",
          taskId: t._id,
        }),
      }).catch(() => { dispatched.current.delete(t._id); /* network error → allow retry */ });
    }
  }, [pending]);
  return null;
}

/* ── Flip counter — odometer-style rolling digits for the live hero stats ──
   Each digit is a strip of 0–9 twice over, translated by a motion value. A
   change always rolls FORWARD (7→2 goes 7,8,9,0,1,2 like a real odometer, never
   back down), eased with a long expo-out so the landing is soft, with a
   velocity-driven motion blur while it spins. Columns stagger from the ones
   place, the strip fades out at its top/bottom edge, and a column that appears
   when the number grows a digit slides open instead of popping. Digits are
   keyed from the RIGHT so existing columns keep their element (and position)
   when the number widens. First paint rolls up from 0. */
const DIGIT_STRIP = Array.from({ length: 20 }, (_, i) => i % 10);
const ROLL_EASE = [0.16, 1, 0.3, 1] as const;

function FlipDigit({ digit, column }: { digit: number; column: number }) {
  const reduce = useReducedMotion();
  const pos = useMotionValue(0);
  const y = useTransform(pos, (v) => `${-v * 1.15}em`);
  const blur = useTransform(useVelocity(pos), (v) => `blur(${Math.min(Math.abs(v) * 0.09, 1.6).toFixed(2)}px)`);

  useEffect(() => {
    if (reduce) {
      pos.set(digit);
      return;
    }
    // Resume from wherever the strip is (a fresh value can land mid-roll),
    // normalised into the first 0–9 run so the target is always ahead of it.
    let from = pos.get() % 10;
    if (from < 0) from += 10;
    pos.set(from);
    const to = digit >= from ? digit : digit + 10;
    if (to === from) return;
    const controls = animate(pos, to, {
      duration: 0.9 + (to - from) * 0.045,
      ease: ROLL_EASE,
      delay: column * 0.05,
      onComplete: () => pos.set(digit), // back onto the first run, same glyph
    });
    return () => controls.stop();
  }, [digit, column, reduce, pos]);

  return (
    <motion.span
      aria-hidden
      className="relative inline-block h-[1.15em] overflow-hidden text-center"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: "0.62em", opacity: 1 }}
      transition={{ duration: 0.45, ease: ROLL_EASE }}
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)",
      }}
    >
      <motion.span className="absolute inset-x-0 top-0 flex flex-col will-change-transform" style={{ y, filter: blur }}>
        {DIGIT_STRIP.map((d, i) => (
          <span key={i} className="block h-[1.15em] leading-[1.15em]">{d}</span>
        ))}
      </motion.span>
    </motion.span>
  );
}

function FlipCounter({ value }: { value: string }) {
  const chars = value.split("");
  return (
    // items-start, not baseline: an overflow-hidden inline-block's baseline is its
    // bottom edge, which dropped separators ("," "." "$") below the digits. Every
    // column is exactly 1.15em tall, so top-aligning lines the glyphs up.
    <span className="inline-flex items-start align-top leading-[1.15em] tabular-nums">
      <span className="sr-only">{value}</span>
      {chars.map((ch, i) => {
        const column = chars.length - 1 - i; // 0 = rightmost
        const key = column + 1; // right-anchored key
        return /\d/.test(ch) ? (
          <FlipDigit key={key} digit={Number(ch)} column={column} />
        ) : (
          <motion.span
            key={key}
            aria-hidden
            className="inline-block h-[1.15em] leading-[1.15em]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {ch}
          </motion.span>
        );
      })}
    </span>
  );
}

// ─── Hero rotating headline — "We build <role>" ───────────────────────────────
// Flip-counter, like the hero stats: each letter slot rolls up out of view and
// the next word's letter rolls in from below, staggered left→right with a
// touch of motion blur. Same face, size and line box as "We build", so the
// role sits on the exact same baseline. Slot widths glide between letters;
// the invisible longest role holds the headline width so nothing reflows.
const HERO_ROLES = ["AI Influencers", "Storytellers", "Cartoons", "Drama", "Commentators", "AI Slop", "Genjutsu"];
const HERO_ROLE_MS = 2800;
const ROLE_SLOTS = Math.max(...HERO_ROLES.map((r) => r.length));

function RotatingRole() {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    // Background tabs keep timers but skip paint — don't advance while hidden.
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setIdx((i) => (i + 1) % HERO_ROLES.length);
    }, HERO_ROLE_MS);
    return () => clearInterval(id);
  }, []);
  const word = HERO_ROLES[idx];

  return (
    <span className="relative mt-1 inline-grid align-top leading-[inherit] text-[#d7ff00] sm:mt-0">
      <span className="sr-only" aria-live="polite">{word}</span>
      <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">{HERO_ROLES.reduce((a, b) => (b.length > a.length ? b : a))}</span>
      <span aria-hidden className="col-start-1 row-start-1 inline-flex items-start whitespace-pre">
        {Array.from({ length: ROLE_SLOTS }, (_, i) => {
          const ch = word[i] ?? "";
          return (
            <motion.span key={i} layout={!reduce} transition={{ layout: { duration: 0.45, ease: ROLL_EASE } }} className="relative inline-grid overflow-hidden">
              <AnimatePresence initial={false} mode="popLayout">
                {ch !== "" && (
                  <motion.span
                    key={`${idx}-${i}`}
                    className="col-start-1 row-start-1 inline-block"
                    initial={reduce ? { opacity: 0 } : { y: "95%", opacity: 0, filter: "blur(3px)" }}
                    animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                    exit={reduce ? { opacity: 0 } : { y: "-95%", opacity: 0, filter: "blur(3px)" }}
                    transition={{ duration: reduce ? 0.2 : 0.55, ease: ROLL_EASE, delay: reduce ? 0 : i * 0.035 }}
                  >
                    {ch === " " ? "\u00A0" : ch}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.span>
          );
        })}
      </span>
    </span>
  );
}

export default function AgentsPage() {
  const rawAgents = useQuery(api.influencers.listAll);
  // Stable reference so the filter/stat memos don't recompute every render.
  const agents = useMemo(() => rawAgents ?? [], [rawAgents]);
  const stats = useQuery(api.influencers.getMarketStats);
  // Mixed clipper + UGC video feed (most-recent first) — drives the "24h Gens"
  // stat: every video generated/posted across all agents in the last 24h.
  const recentVideoFeed = useQuery(api.clipJobs.globalVideoFeed, { limit: 200 });
  // All-time platform totals for the hero stat row — realtime (hourly
  // baseline + live delta, see convex/platformStats.ts). null until the
  // first refresh has run.
  const platformTotals = useQuery(api.platformStats.live);
  // Videos produced per agent — counted client-side from the already-loaded video
  // feed (clips + UGC), so the hire cards that aren't for-hire can show a real
  // "videos generated" number instead of an empty rate. No extra query. The feed
  // items expose `agentName` (not the mint), which comes from the same influencer
  // doc as `agent.name`, so we key by name. Counts reflect the recent feed window.
  const videosByAgentName = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of ((recentVideoFeed?.items ?? []) as Array<{ agentName?: string }>)) {
      if (v.agentName) m[v.agentName] = (m[v.agentName] ?? 0) + 1;
    }
    return m;
  }, [recentVideoFeed]);
  const [metricClock] = useState(() => Date.now());
  const agentMetrics = useMemo(() => {
    const dayStart = new Date(metricClock);
    dayStart.setHours(0, 0, 0, 0);
    const todayStart = dayStart.getTime();
    const yesterdayStart = todayStart - 86_400_000;
    const byMint: Record<string, AgentMarketMetrics> = {};
    const ensure = (mint: string): AgentMarketMetrics => {
      byMint[mint] ??= { views: 0, todayViews: 0, yesterdayViews: 0, followers: 0, followerDelta: 0 };
      return byMint[mint];
    };
    for (const v of ((recentVideoFeed?.items ?? []) as Array<{ mint?: string; viewCount?: number | null; createdAt?: number | null }>)) {
      if (!v.mint) continue;
      const views = Math.max(0, Math.floor(v.viewCount ?? 0));
      const bucket = ensure(v.mint);
      bucket.views += views;
      const createdAt = v.createdAt ?? 0;
      if (createdAt >= todayStart) bucket.todayViews += views;
      else if (createdAt >= yesterdayStart && createdAt < todayStart) bucket.yesterdayViews += views;
    }
    for (const a of agents as Array<Record<string, unknown>>) {
      const mint = typeof a.mintAddress === "string" ? a.mintAddress : "";
      if (!mint) continue;
      const bucket = ensure(mint);
      const followerValue = [a.followers, a.followerCount, a.socialFollowers, a.audienceFollowers]
        .map((n) => (typeof n === "number" ? n : Number(n)))
        .find((n) => Number.isFinite(n) && n > 0);
      const followerDelta = [a.followersDelta24h, a.followerDelta24h, a.followersDelta, a.followerDelta]
        .map((n) => (typeof n === "number" ? n : Number(n)))
        .find((n) => Number.isFinite(n));
      bucket.followers = Math.max(0, Math.floor(followerValue ?? 0));
      bucket.followerDelta = Math.trunc(followerDelta ?? 0);
    }
    return byMint;
  }, [agents, metricClock, recentVideoFeed]);

  const [search, setSearch] = useState("");
  // Always visible from `sm` up, so this only gates the small-screen layout.
  const [sort, setSort] = useState<SortKey>("views-desc");
  const [view, setView] = useState<ViewMode>("grid");
  const [niche, setNiche] = useState("All");
  const [language, setLanguage] = useState("All");
  const [agentTypeFilter, setAgentTypeFilter] = useState("AI Influencer");
  // Which toolbar dropdown is open — at most one at a time.
  const [openDropdown, setOpenDropdown] = useState<"sort" | "agentType" | "niche" | "language" | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selected, setSelected] = useState<{ agent: any; index: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hireTarget, setHireTarget] = useState<any | null>(null);
  // Tab switcher removed from the UI — the marketplace is always on "hire".
  const [tab] = useState<"hire" | "purchase" | "invest">("hire");
  // Main-panel view: the agent browser (grid/list), the live actions feed, or the SOL chart.
  const [panel, setPanel] = useState<AgentsPanel>("browse");
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const filtered = useMemo(() => {
    let list = [...agents];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a => a.name.toLowerCase().includes(q) || a.handle.toLowerCase().includes(q) || a.niche.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q));
    }
    if (niche !== "All") list = list.filter(a => a.niche?.toLowerCase() === niche.toLowerCase());
    if (language !== "All") list = list.filter(a => a.language === language);
    list = list.filter(a => resolveAgentType(a) === "AI Influencer");
    const m = (a: { mintAddress: string }) => agentMetrics[a.mintAddress];
    const views = (a: { mintAddress: string }) => m(a)?.views ?? 0;
    const followers = (a: { mintAddress: string }) => m(a)?.followers ?? 0;
    const newest = (a: { _creationTime?: number }, b: { _creationTime?: number }) => (b._creationTime ?? 0) - (a._creationTime ?? 0);
    switch (sort) {
      case "views-desc":     list.sort((a, b) => views(b) - views(a) || followers(b) - followers(a) || newest(a, b)); break;
      case "views-asc":      list.sort((a, b) => views(a) - views(b) || followers(a) - followers(b) || newest(a, b)); break;
      case "followers-desc": list.sort((a, b) => followers(b) - followers(a) || views(b) - views(a) || newest(a, b)); break;
      case "trending":       list.sort((a, b) => (m(b)?.todayViews ?? 0) - (m(a)?.todayViews ?? 0) || views(b) - views(a) || newest(a, b)); break;
      case "newest":         list.sort(newest); break;
    }
    return list;
  }, [agents, search, sort, niche, language, agentTypeFilter, agentMetrics]);

  const hasActiveFilters = niche !== "All" || language !== "All";
  const clearFilters = () => { setNiche("All"); setLanguage("All"); setAgentTypeFilter("AI Influencer"); };
  const loading = rawAgents === undefined;

  // Compact formatters for the collection stat bar.
  const fmt$ = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(n < 100 ? 2 : 0)}`;
  const fmtN = (n: number) => n >= 1e3 ? `${(n / 1e3).toFixed(2)}K` : `${n}`;

  // Collection-level metrics — mapped onto the marketplace stat bar in the reference.
  const coll = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prices = agents.map((a: any) => a.sharePrice ?? 0).filter((p: number) => p > 0);
    const floor = prices.length ? Math.min(...prices) : 0;
    const top = prices.length ? Math.max(...prices) : 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalTvl = stats?.totalTvl ?? agents.reduce((s: number, a: any) => s + (a.tvl ?? 0), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monthly = stats?.totalMonthlyEarnings ?? agents.reduce((s: number, a: any) => s + (a.monthlyEarnings ?? 0), 0);
    const dayVol = monthly / 30;
    // 24h-new count needs the wall clock; the memo only re-runs when agents change.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, react-hooks/purity
    const dayNew = agents.filter((a: any) => Date.now() - (a._creationTime ?? 0) < 86_400_000).length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const owners = new Set(agents.map((a: any) => a.creatorWallet).filter(Boolean)).size || agents.length;
    const avgApr = stats?.avgApr ?? 0;
    // Total connected social accounts across every agent (sum of each agent's
    // connectedPlatforms) — surfaced as the "Socials" stat.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connectedSocials = agents.reduce((s: number, a: any) => s + (Array.isArray(a.connectedPlatforms) ? a.connectedPlatforms.length : 0), 0);
    // Videos generated/posted in the last 24h — clippers + UGC, every account,
    // mixed. globalVideoFeed is sorted newest-first so the 24h slice is a prefix.
    const dayAgo = metricClock - 86_400_000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feedItems = (recentVideoFeed?.items ?? []) as any[];

    const gens24h = feedItems.filter((v) => (v.createdAt ?? 0) >= dayAgo).length;
    return { floor, top, totalTvl, monthly, dayVol, dayNew, owners, avgApr, connectedSocials, gens24h };
  }, [agents, stats, recentVideoFeed, metricClock]);


  // Hero stat row — all-time, platform-wide totals. Full digits (not
  // compact "3.4M") so every live increase visibly rolls the counter.
  const heroStat = (pick: (t: NonNullable<typeof platformTotals>) => string) =>
    platformTotals ? pick(platformTotals) : null;
  const heroStats = [
    { label: "Total Views Generated", value: heroStat((t) => t.totalViews.toLocaleString("en-US")) },
    { label: "Total Volume", value: heroStat((t) => `$${t.totalVolumeUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) },
    { label: "Videos Generated", value: heroStat((t) => t.videosGenerated.toLocaleString("en-US")) },
  ];

  return (
    <AppHeaderShell>
    <div className="flex min-h-full flex-col overflow-x-clip bg-transparent text-white" style={{ fontFamily: "var(--font-inter)" }}>
      {/* Executes cron-created tasks that would otherwise sit stuck on "pending".
          Isolated in its own boundary: it's a non-essential background worker, so
          a transient Convex error in its query must NEVER white-screen the whole
          marketplace (it previously did — listPendingAll threw → root boundary). */}
      <ErrorBoundary fallback={null}>
        <HeartbeatDispatcher />
      </ErrorBoundary>
      {/* ── Not full-bleed — matches /studio's constrained container. The WHOLE
          page scrolls now (no nested scroll regions) — AppHeaderShell's own
          overflow-y-auto container handles it, hero included. ── */}
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
      {/* ── Hero — Meteora-style: big headline + two CTAs left, all-time
          platform totals right, over a soft dark-lime glow (brand theme). ── */}
      <section className="relative shrink-0 px-4 pb-1 pt-6 sm:px-6 sm:pt-8">
        <div className="absolute right-4 top-6 z-10 sm:hidden"><PanelSwitch panel={panel} setPanel={setPanel} compact /></div>
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <motion.div
            className="pr-20 sm:pr-0"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            <h1
              className="text-[27px] font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-[34px]"
              style={{ fontFamily: "var(--font-geist-sans)" }}
            >
              Invest in <RotatingRole />
            </h1>
            <p
              className="mt-2.5 text-[14px] font-normal tracking-[-0.005em] text-white/45 sm:text-[15px]"
              style={{ fontFamily: "var(--font-geist-sans)" }}
            >
              For Creators, Brands, and Agencies
            </p>
          </motion.div>

          <div className="flex flex-col gap-3 lg:items-end">
            <motion.dl
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 30, delay: 0.08 }}
              className="flex divide-x divide-white/10"
            >
              {heroStats.map(({ label, value }, i) => (
                <div key={label} className="flex flex-col gap-1.5 px-4 first:pl-0 last:pr-0 sm:px-6 lg:items-end">
                  <dt className="flex items-center gap-1.5 text-[12px] text-white/45 sm:text-[14px]">
                    {i === 0 && (
                      <span className="relative flex size-1.5" aria-label="Live">
                        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
                        <span className="relative size-1.5 rounded-full bg-emerald-400" />
                      </span>
                    )}
                    {label}
                  </dt>
                  <dd className="text-[17px] font-semibold text-white sm:text-[20px]">
                    {value === null ? (
                      <span className="inline-block h-[1.15em] w-24 animate-pulse rounded bg-white/[0.07] align-middle" />
                    ) : (
                      <FlipCounter value={value} />
                    )}
                  </dd>
                </div>
              ))}
            </motion.dl>
          </div>
        </div>
        {/* Distinct mascot action cards. On mobile they stay in a two-column grid,
            with copy protected on the left and the illustration on the right. */}
        <div className="relative mt-8 flex items-center justify-between gap-2.5">
            <div className="grid w-full grid-cols-2 gap-2.5 sm:w-auto sm:gap-3 md:flex">
              <AgentHeroActionCard href="/docs/start" title="New? Start Here!" art="/brand/agents-cta-start.gif" />
              <AgentHeroActionCard href="/home" title="Launch your agent" art="/brand/agents-cta-launch.gif" />
            </div>
            {/* Activity & Videos — labelled buttons from sm up (mobile uses the icon pill above). */}
            <div className="hidden sm:block"><PanelSwitch panel={panel} setPanel={setPanel} /></div>
        </div>
      </section>

      {/* ── Toolbar — glass, rounded panel directly below hero ── */}
      {panel === "browse" && (
      <div className="relative z-40 mx-4 mt-1.5 flex flex-wrap items-center gap-2.5 rounded-2xl px-4 py-2 shrink-0 backdrop-blur-md sm:mx-5 sm:flex-nowrap sm:px-5" style={{ background: "rgba(15,17,23,0.7)", border: `1px solid ${ME.border}` }}>
        <div className="flex items-center rounded-md overflow-hidden shrink-0" style={{ border: `1px solid ${ME.border}` }}>
          <button onClick={() => setView("grid")} className="flex items-center justify-center size-9 transition-colors sm:size-8" style={{ background: view === "grid" ? "#23262f" : "transparent", color: view === "grid" ? ME.text : ME.sub }} aria-label="Grid view">
            <LayoutGrid className="size-3.5" />
          </button>
          <button onClick={() => setView("list")} className="flex items-center justify-center size-9 transition-colors sm:size-8" style={{ background: view === "list" ? "#23262f" : "transparent", color: view === "list" ? ME.text : ME.sub }} aria-label="List view">
            <List className="size-3.5" />
          </button>
        </div>
        {/* Search — its own full-width row on top on mobile, inline from sm up. */}
        <div className="order-first flex h-9 w-full items-center gap-2 rounded-lg px-3 sm:order-none sm:h-8 sm:w-auto sm:flex-1 sm:rounded-md" style={{ border: `1px solid ${ME.border}`, background: ME.bg }}>
          <Search className="size-3.5 shrink-0" style={{ color: ME.sub }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items"
            className="flex-1 bg-transparent text-[13px] outline-none" style={{ color: ME.text }} />
          {search && <button onClick={() => setSearch("")} aria-label="Clear search"><X className="size-3.5" style={{ color: ME.sub }} /></button>}
        </div>

        {/* Filters — Agent Type / Niche / Language, plus Sort, all inline
            (sidebar removed). Only one of these dropdowns is open at a time. */}
        <ToolbarDropdown label="Agent Type" value={agentTypeFilter} options={AGENT_TYPES} isOpen={openDropdown === "agentType"} onToggle={() => setOpenDropdown(o => o === "agentType" ? null : "agentType")} onSelect={(v) => { setAgentTypeFilter(v); setOpenDropdown(null); }} />
        <ToolbarDropdown label="Niche" value={niche} options={NICHES} isOpen={openDropdown === "niche"} onToggle={() => setOpenDropdown(o => o === "niche" ? null : "niche")} onSelect={(v) => { setNiche(v); setOpenDropdown(null); }} />
        <ToolbarDropdown label="Language" value={language} options={LANGUAGES} isOpen={openDropdown === "language"} onToggle={() => setOpenDropdown(o => o === "language" ? null : "language")} onSelect={(v) => { setLanguage(v); setOpenDropdown(null); }} />

        {/* Sort — isolate() pins this as its own stacking context so the z-index
            below is guaranteed to win against every sibling (grid cards);
            this is what was rendering the menu "behind". */}
        <div className="relative isolate shrink-0">
          <button onClick={() => setOpenDropdown(o => o === "sort" ? null : "sort")} className="flex items-center gap-2 h-8 px-3 rounded-md text-[12.5px]" style={{ border: `1px solid ${ME.border}`, background: "#15171d", color: ME.text }}>
            {SORT_LABELS[sort]} <ChevronDown className="size-3.5" style={{ color: ME.sub }} />
          </button>
          {openDropdown === "sort" && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg py-1 shadow-2xl z-[999] backdrop-blur-md" style={{ border: `1px solid ${ME.border}`, background: "rgba(21,23,29,0.95)" }}>
              {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([key, label]) => (
                <button key={key} onClick={() => { setSort(key); setOpenDropdown(null); }}
                  className="w-full text-left px-3 py-1.5 text-[12.5px] transition-colors"
                  style={{ color: sort === key ? ME.text : ME.sub, background: sort === key ? "rgba(255,255,255,0.06)" : "transparent" }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={clearFilters} className="flex items-center justify-center size-9 rounded-md shrink-0 transition-colors sm:size-8" style={{ border: `1px solid ${hasActiveFilters ? ME.accentDim : ME.border}`, color: hasActiveFilters ? ME.accent : ME.sub }} title="Reset filters">
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      )}

      {/* ── Body — page itself scrolls (AppHeaderShell owns the scroll
          container), no nested scroll regions. ── */}
      <div className="flex flex-1 flex-col">
        <div className="flex min-w-0 flex-1 flex-col">
         {panel === "chart" ? (
           <div className="p-3"><SolanaChart /></div>
         ) : panel === "activity" ? (
           <LiveActivity />
         ) : panel === "videos" ? (
           /* Masonry wall of every video generated across all agents. Padded like the
              other panels (no giant top margin in the tab context). */
           <div><AllAgentsVideoWall className="p-4 sm:p-6" /></div>
         ) : (
         <div className="p-3 sm:p-4">
          {view === "list" && !loading && filtered.length > 0 && (
            <div className="grid min-w-[680px] grid-cols-[40px_48px_1fr_100px_100px_100px_100px_80px] gap-3 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider mb-1 border-b" style={{ color: ME.subDim, borderColor: ME.border }}>
              <span>#</span><span /><span>Agent</span><span>Price</span><span>APR</span><span>TVL</span><span>Earnings/mo</span><span>Status</span>
            </div>
          )}

          {loading && (
            <div className={view === "grid" ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2.5" : "flex flex-col"}>
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className={`animate-pulse rounded-lg ${view === "grid" ? "aspect-[4/5]" : "h-14"}`} style={{ background: ME.card, border: `1px solid ${ME.border}` }} />
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 text-center gap-3">
              <div className="h-16 w-16 rounded-full flex items-center justify-center" style={{ background: ME.card }}>
                <Users className="h-7 w-7" style={{ color: ME.subDim }} />
              </div>
              <p className="font-medium" style={{ color: ME.sub }}>No agents found</p>
              <p className="text-sm max-w-xs" style={{ color: ME.subDim }}>
                {hasActiveFilters || search ? "Try adjusting your filters or search." : "No agents created yet. Be the first builder."}
              </p>
              {(hasActiveFilters || search) && (
                <button onClick={() => { clearFilters(); setSearch(""); }} className="text-sm transition-colors" style={{ color: ME.accent }}>
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {!loading && filtered.length > 0 && view === "grid" && (
            // key includes tab + active filters → the grid remounts on tab switch
            // OR any filter change, so the blur-stagger reveal replays each time.
            <div key={`${tab}-${niche}-${language}-${agentTypeFilter}`} className="cards-reveal-grid grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Invest tab → Instant Buy hero cell */}
              {tab === "invest" && (
                <FeatureTile
                  icon={Zap}
                  label="Instant Buy"
                  value={coll.floor > 0 ? fmt$(coll.floor) : "—"}
                  button="Buy Now"
                  onButton={() => { if (!connected) setVisible(true); }}
                />
              )}
              {filtered.map((agent, i) => {
                // Swapped per request: Purchase shows the invest-style tile, Invest shows the purchase-style tile.
                const Card = tab === "hire" ? HireCard : tab === "purchase" ? AgentCard : PurchaseCard;
                return <Card key={agent._id} agent={agent} index={i} videos={videosByAgentName[agent.name]} metrics={agentMetrics[agent.mintAddress]} onClick={() => setSelected({ agent, index: i })} />;
              })}
            </div>
          )}

          {!loading && filtered.length > 0 && view === "list" && (
            <div key={`${tab}-${niche}-${language}-${agentTypeFilter}`} className="cards-reveal-grid flex min-w-[680px] flex-col">
              {filtered.map((agent, i) => (
                <AgentRow key={agent._id} agent={agent} index={i} onClick={() => setSelected({ agent, index: i })} />
              ))}
            </div>
          )}
         </div>
         )}
        </div>
      </div>
      </div>

      {/* Footer is the shared <AppFooter /> rendered once in the root layout. */}

      {/* ── Agent modal ── */}
      <AnimatePresence>
        {selected && (
          <AgentModal
            agent={selected.agent}
            metrics={agentMetrics[selected.agent.mintAddress]}
            index={selected.index}
            agents={filtered}
            onNavigate={(i) => { if (filtered[i]) setSelected({ agent: filtered[i], index: i }); }}
            onClose={() => setSelected(null)}
            onHire={(a) => { setSelected(null); setHireTarget(a); }}
          />
        )}
      </AnimatePresence>

      {/* ── Hire & Generate modal (opened from a card's detail) ── */}
      {hireTarget && (
        <HireGenerateModal
          agent={{
            mint: hireTarget.mintAddress ?? hireTarget._id,
            name: hireTarget.name ?? "Agent",
            avatarUrl: hireTarget.avatarUrl ?? "",
            niche: hireTarget.niche ?? "lifestyle",
            agentType: resolveAgentType(hireTarget),
          }}
          onClose={() => setHireTarget(null)}
        />
      )}

      {/* Site-wide live chat — the hero "chat" icon opens it via a window event. */}
      <LiveChatWidget />
    </div>
    </AppHeaderShell>
  );
}
