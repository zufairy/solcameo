"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Target, Wallet, Clock, AlertTriangle, Sparkles, ChevronDown,
  DollarSign, Zap,
} from "lucide-react";
import type { AgentBlueprint, AgentGoal } from "@/lib/builder/agentTypes";
import { DEFAULT_REVENUE_SPLIT } from "@/lib/builder/agentTypes";

interface MissionCardProps {
  blueprint: AgentBlueprint;
  variant?: "paper" | "dark";
  onEditGoal?: () => void;
}

const METRIC_LABELS: Record<NonNullable<AgentGoal["metric"]>, { label: string; unit: string; symbol: string }> = {
  revenue_usdc:      { label: "Revenue Target",   unit: "USDC",    symbol: "$" },
  followers:         { label: "Followers",         unit: "follows", symbol: "" },
  subscribers:       { label: "Subscribers",       unit: "subs",    symbol: "" },
  trades_executed:   { label: "Trades",            unit: "trades",  symbol: "" },
  win_rate:          { label: "Win Rate",          unit: "%",       symbol: "" },
  customers_served:  { label: "Customers",         unit: "active",  symbol: "" },
  tasks_completed:   { label: "Tasks Done",        unit: "tasks",   symbol: "" },
  custom:            { label: "Custom Goal",       unit: "",        symbol: "" },
};

function RingProgress({ pct, size = 72, stroke = 5, color = "#10b981" }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <motion.circle
        cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - dash }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        style={{ filter: `drop-shadow(0 0 4px ${color})` }}
      />
    </svg>
  );
}

export default function MissionCard({ blueprint, variant = "dark", onEditGoal }: MissionCardProps) {
  const [showSplit, setShowSplit] = useState(false);
  const g = blueprint.goal;
  const w = blueprint.wallet;
  const split = blueprint.revenueSplit ?? DEFAULT_REVENUE_SPLIT;
  const isPaper = variant === "paper";

  let progressValue = 0;
  if (g) {
    if (g.metric === "revenue_usdc" && w) progressValue = w.earnings.lifetimeUsdc;
  }
  const progressPct = g && g.target > 0 ? Math.min(100, (progressValue / g.target) * 100) : 0;
  const metricMeta  = g ? METRIC_LABELS[g.metric] : null;
  const runwayWarning = w?.runwayDays != null && w.runwayDays < 7;
  const balance     = w?.balanceUsdc ?? 0;
  const runway      = w?.runwayDays;

  // ── Paper (light) variant — used by trader/worker ─────────────────────────
  if (isPaper) {
    return (
      <div className="duo-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="size-3.5 text-emerald-700" />
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-zinc-900">Mission</span>
          </div>
          {onEditGoal && (
            <button onClick={onEditGoal} className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-900">edit goal</button>
          )}
        </div>
        <div className="h-px bg-zinc-900/85 mx-4" />
        <div className="px-4 py-3">
          {g && metricMeta ? (
            <>
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">{metricMeta.label}</p>
                  <p className="font-serif text-[22px] font-bold leading-none tabular-nums text-zinc-900">
                    {metricMeta.symbol}{progressValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                  <p className="font-mono text-[10px] mt-0.5 text-zinc-500">of {metricMeta.symbol}{g.target.toLocaleString()} {metricMeta.unit}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">Progress</p>
                  <p className="font-mono text-[18px] font-bold tabular-nums text-zinc-900">{progressPct.toFixed(0)}%</p>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-200 overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${progressPct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} className="h-full bg-zinc-900" />
              </div>
            </>
          ) : (
            <div className="text-center py-2">
              <p className="text-[12.5px] text-zinc-500">No goal set. Tell the copilot what success looks like.</p>
              {onEditGoal && (
                <button onClick={onEditGoal} className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-md border border-zinc-300 bg-white text-zinc-900">
                  <Sparkles className="size-3" /> set a goal
                </button>
              )}
            </div>
          )}
        </div>
        <div className="h-px bg-zinc-900/85 mx-4" />
        <div className="px-4 py-3 grid grid-cols-2 gap-3">
          {[
            { label: "Wallet",  value: `$${balance.toFixed(2)}`,                                  good: balance > 0,   icon: <Wallet className="size-2.5" /> },
            { label: "Runway",  value: runway != null ? `${Math.floor(runway)}d` : "-",            warn: runwayWarning, icon: <Clock className="size-2.5" /> },
          ].map(({ label, value, good, warn, icon }: { label: string; value: string; good?: boolean; warn?: boolean; icon: ReactNode }) => (
            <div key={label}>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500 flex items-center gap-1">{icon}{label}</p>
              <p className={`font-mono text-[14px] font-bold tabular-nums mt-0.5 ${warn ? "text-rose-600" : good ? "text-emerald-700" : "text-zinc-900"}`}>{value}</p>
            </div>
          ))}
        </div>
        <div className="px-4 pb-3">
          <button onClick={() => setShowSplit(v => !v)} className="w-full flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-900">
            <span>Revenue split</span>
            <ChevronDown className={`size-3 transition-transform ${showSplit ? "" : "-rotate-90"}`} />
          </button>
          {showSplit && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.2 }} className="mt-2 grid grid-cols-5 gap-1.5">
              {[
                { label: "Operator", value: split.builderPct },
                { label: "Skills",   value: split.skillProvidersPct },
                { label: "Vello",    value: split.velloProtocolPct },
                { label: "Verify",   value: split.verifiersPct },
                { label: "Investors",value: split.investorPoolPct },
              ].map(s => (
                <div key={s.label} className="px-2 py-1.5 rounded-md bg-white border border-zinc-300 text-center">
                  <p className="font-mono text-[12px] font-bold tabular-nums text-zinc-900">{s.value}%</p>
                  <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-zinc-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </motion.div>
          )}
        </div>
      </div>
    );
  }

  // ── Dark premium influencer variant ─────────────────────────────────────────
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "linear-gradient(145deg, #0d1117 0%, #0f1520 50%, #0a0d12 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>

      {/* Top accent line */}
      <div className="h-[1px]" style={{ background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.55), transparent)" }} />

      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-5 rounded bg-emerald-500/15 flex items-center justify-center">
            <Target className="size-3 text-emerald-400" />
          </div>
          <span className="text-[11px] font-semibold text-zinc-300 tracking-wide">Mission Control</span>
        </div>
        {onEditGoal && (
          <button onClick={onEditGoal} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-emerald-400 transition-colors font-medium">
            <Zap className="size-2.5" /> Edit
          </button>
        )}
      </div>

      {/* Goal with ring */}
      <div className="px-4 pb-3">
        {g && metricMeta ? (
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <RingProgress pct={progressPct} size={68} stroke={4.5}
                color={progressPct >= 80 ? "#10b981" : progressPct >= 40 ? "#f59e0b" : "#6366f1"} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[13px] font-black text-white tabular-nums">{progressPct.toFixed(0)}%</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-0.5">{metricMeta.label}</p>
              <p className="text-[22px] font-black text-white tabular-nums leading-none">
                {metricMeta.symbol}{progressValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10.5px] text-zinc-600 mt-0.5">
                of <span className="text-zinc-400 font-semibold">{metricMeta.symbol}{g.target.toLocaleString()}</span> {metricMeta.unit}
              </p>
              {g.deadline && <p className="text-[9.5px] text-zinc-700 mt-1 flex items-center gap-1"><Clock className="size-2.5" /> by {g.deadline}</p>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center py-3 gap-2.5 text-center">
            <div className="size-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <Target className="size-5 text-zinc-700" />
            </div>
            <div>
              <p className="text-[12px] font-semibold text-zinc-400">No goal set</p>
              <p className="text-[10.5px] text-zinc-600 mt-0.5 leading-relaxed max-w-[200px]">
                Tell the copilot, e.g. &ldquo;earn $500/mo from brand deals&rdquo;
              </p>
            </div>
            {onEditGoal && (
              <button onClick={onEditGoal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold hover:bg-emerald-500/15 transition-all">
                <Sparkles className="size-3" /> Set a goal
              </button>
            )}
          </div>
        )}
      </div>

      {/* Wallet strip */}
      <div className="mx-3 mb-3 rounded-lg border border-white/[0.06] overflow-hidden" style={{ background: "rgba(255,255,255,0.025)" }}>
        <div className="grid grid-cols-2 divide-x divide-white/[0.05]">
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Wallet className="size-2.5 text-blue-400" />
              <span className="text-[8.5px] text-zinc-600 uppercase tracking-widest">Wallet</span>
            </div>
            <p className={`text-[15px] font-black tabular-nums leading-none ${balance > 0 ? "text-white" : "text-zinc-600"}`}>${balance.toFixed(2)}</p>
            <p className="text-[8px] text-zinc-700 mt-0.5">USDC balance</p>
          </div>
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Clock className={`size-2.5 ${runwayWarning ? "text-rose-400" : "text-zinc-500"}`} />
              <span className="text-[8.5px] text-zinc-600 uppercase tracking-widest">Runway</span>
            </div>
            <p className={`text-[15px] font-black tabular-nums leading-none ${runwayWarning ? "text-rose-400" : runway != null ? "text-white" : "text-zinc-600"}`}>
              {runway != null ? `${Math.floor(runway)}d` : "-"}
            </p>
            <p className="text-[8px] text-zinc-700 mt-0.5">remaining</p>
          </div>
        </div>
      </div>

      {/* Runway warning */}
      {runwayWarning && (
        <div className="mx-3 mb-3 px-3 py-2 rounded-lg bg-rose-500/[0.08] border border-rose-500/20 flex items-center gap-2">
          <AlertTriangle className="size-3 text-rose-400 shrink-0" />
          <p className="text-[10.5px] text-rose-300/80 leading-snug">Low runway, agent prioritizing high-EV tasks.</p>
        </div>
      )}

      {/* Revenue split */}
      <div className="px-4 pb-3">
        <button onClick={() => setShowSplit(v => !v)}
          className="w-full flex items-center justify-between text-[9.5px] text-zinc-600 hover:text-zinc-400 transition-colors">
          <span className="flex items-center gap-1.5 uppercase tracking-widest"><DollarSign className="size-2.5" /> Revenue split</span>
          <ChevronDown className={`size-3 transition-transform ${showSplit ? "" : "-rotate-90"}`} />
        </button>
        {showSplit && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.18 }}
            className="mt-2 grid grid-cols-5 gap-1">
            {[
              { label: "You",       value: split.builderPct },
              { label: "Skills",    value: split.skillProvidersPct },
              { label: "Vello",     value: split.velloProtocolPct },
              { label: "Verify",    value: split.verifiersPct },
              { label: "Investors", value: split.investorPoolPct },
            ].map(s => (
              <div key={s.label} className="rounded-lg bg-white/[0.03] border border-white/[0.06] py-2 text-center">
                <p className="text-[13px] font-black text-white tabular-nums">{s.value}%</p>
                <p className="text-[8px] text-zinc-600 uppercase tracking-wide mt-0.5">{s.label}</p>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
