"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Plus, X, Zap, Shield, Brain, Bell, Radio, AlertCircle, ExternalLink, Loader2, Search, FileText } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { AgentBlueprint } from "@/lib/builder/agentTypes";
import {
  TRADER_SKILLS_CATALOG, INFLUENCER_SKILLS_CATALOG,
  TRADER_CATEGORY_META, CATEGORY_META, getSkillsForAgent, estimateDailyBurn,
  type Skill, type TraderSkillCategory, type SkillCategory,
} from "@/lib/builder/skillsCatalog";

interface SkillStatus {
  keyPresent: boolean;
  keyMissing: string[];
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

interface SkillsMarketplaceCardProps {
  blueprint: AgentBlueprint;
  variant?: "paper" | "dark";
  onToggleSkill: (skillId: string, install: boolean) => void;
  /** Session id — lets the card show custom skills the copilot engineered (reactive). */
  sessionId?: string;
  /** Hide the in-card title/Browse header (the caller renders its own SectionHeading). */
  hideHeader?: boolean;
}

// ─── Trader Marketplace ───────────────────────────────────────────────────────

const TRADER_CATEGORY_ICONS: Record<TraderSkillCategory, React.ElementType> = {
  signals:      Radio,
  execution:    Zap,
  intelligence: Brain,
  risk:         Shield,
  alerts:       Bell,
};

const TRADER_CATEGORY_COLORS: Record<TraderSkillCategory, { active: string; ring: string; bg: string; dot: string }> = {
  signals:      { active: "text-cyan-300 border-cyan-500/50 bg-cyan-500/10",    ring: "ring-cyan-500/30",    bg: "bg-cyan-500/5",    dot: "bg-cyan-400" },
  execution:    { active: "text-emerald-300 border-emerald-500/50 bg-emerald-500/10", ring: "ring-emerald-500/30", bg: "bg-emerald-500/5", dot: "bg-emerald-400" },
  intelligence: { active: "text-violet-300 border-violet-500/50 bg-violet-500/10",   ring: "ring-violet-500/30",  bg: "bg-violet-500/5",  dot: "bg-violet-400" },
  risk:         { active: "text-amber-300 border-amber-500/50 bg-amber-500/10",   ring: "ring-amber-500/30",   bg: "bg-amber-500/5",   dot: "bg-amber-400" },
  alerts:       { active: "text-rose-300 border-rose-500/50 bg-rose-500/10",     ring: "ring-rose-500/30",    bg: "bg-rose-500/5",    dot: "bg-rose-400" },
};

function TraderSkillCard({ skill, installed, onToggle, status, statusLoading, required }: {
  skill: Skill; installed: boolean; onToggle: () => void;
  status?: SkillStatus; statusLoading?: boolean;
  /** True when the operator's current strategy spec depends on this skill. */
  required?: boolean;
}) {
  const cat = skill.category as TraderSkillCategory;
  const CatIcon = TRADER_CATEGORY_ICONS[cat] ?? Radio;

  const needsSetup = !status?.keyPresent && (skill.requires?.length ?? 0) > 0;
  const isLive     = status?.connected === true;
  const isOffline  = status?.keyPresent && status.connected === false;

  // Category icon tint (paper theme — use deeper saturated colors instead of bright neons)
  const iconTint =
    cat === "signals"      ? "bg-cyan-100 text-cyan-700"     :
    cat === "execution"    ? "bg-emerald-100 text-emerald-700" :
    cat === "intelligence" ? "bg-violet-100 text-violet-700" :
    cat === "risk"         ? "bg-amber-100 text-amber-700"   :
    cat === "alerts"       ? "bg-rose-100 text-rose-700"     :
    "bg-zinc-100 text-zinc-700";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      style={{ fontFamily: "var(--font-inter)" }}
      className={`relative flex flex-col rounded-2xl p-5 transition-all bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.05)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 ${
        installed
          ? "ring-2 ring-emerald-500/30 ring-offset-1 ring-offset-zinc-50"
          : required
            ? "ring-2 ring-cyan-500/50 ring-offset-1 ring-offset-zinc-50"
            : "border border-zinc-200/80"
      }`}
    >
      {/* Required-for-strategy ribbon */}
      {required && !installed && (
        <div className="absolute -top-2 left-4 px-2 py-0.5 rounded-md bg-cyan-600 text-white text-[9.5px] font-bold uppercase tracking-wider shadow">
          Required
        </div>
      )}

      {/* Top-right status pill */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        {statusLoading ? (
          <Loader2 className="size-3 text-zinc-400 animate-spin" />
        ) : isLive ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_4px_currentColor]" />
            <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Live</span>
            {status?.latencyMs !== undefined && status.latencyMs > 0 && (
              <span className="text-[9px] text-emerald-600/70 tabular-nums">{status.latencyMs}ms</span>
            )}
          </span>
        ) : isOffline ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200">
            <AlertCircle className="size-2.5 text-rose-600" />
            <span className="text-[10px] font-semibold text-rose-700 uppercase tracking-wide">Down</span>
          </span>
        ) : needsSetup ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200">
            <AlertCircle className="size-2.5 text-amber-600" />
            <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Setup</span>
          </span>
        ) : null}
      </div>

      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${iconTint}`}>
          <CatIcon className="size-5" strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0 pr-16">
          <h3 className="text-[15px] font-bold text-zinc-900 leading-tight tracking-tight">{skill.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-zinc-500 font-medium">{skill.provider}</span>
            {skill.apiTier && (
              <span className={`inline-block px-1.5 py-px rounded-md text-[9px] uppercase font-semibold tracking-wide ${
                skill.apiTier === "free"     ? "bg-emerald-100 text-emerald-700" :
                skill.apiTier === "freemium" ? "bg-sky-100 text-sky-700" :
                "bg-amber-100 text-amber-700"
              }`}>{skill.apiTier}</span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-[13px] text-zinc-600 leading-relaxed mb-4 line-clamp-2">
        {skill.description}
      </p>

      {/* Setup info, only shown if needs setup */}
      {needsSetup && (
        <div className="mb-4 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11.5px] text-amber-800 leading-snug">
                Needs <span className="font-mono text-amber-900 font-semibold">{status?.keyMissing.join(", ")}</span> set
              </p>
              {skill.setupUrl && (
                <a
                  href={skill.setupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900 font-semibold mt-1 transition-colors"
                >
                  Get API key <ExternalLink className="size-2.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer: pricing + install button */}
      <div className="mt-auto flex items-end justify-between gap-3 pt-2">
        <div>
          <p className="text-base font-bold text-zinc-900 tabular-nums leading-none">
            ${skill.pricePerUseUsdc.toFixed(skill.pricePerUseUsdc < 0.01 ? 3 : 3)}
            <span className="text-zinc-400 text-[11px] font-normal ml-0.5">/{skill.pricingUnit}</span>
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            ~{skill.avgUsesPerDay}/day · <span className="text-zinc-700 font-semibold">${(skill.pricePerUseUsdc * skill.avgUsesPerDay).toFixed(2)}</span> daily
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className={installed ? "duo-btn duo-btn-white duo-btn-sm" : "duo-btn duo-btn-emerald duo-btn-sm"}
        >
          {installed ? (
            <>
              <X className="size-3.5" strokeWidth={2.5} />
              Remove
            </>
          ) : (
            <>
              <Plus className="size-3.5" strokeWidth={2.5} />
              Install
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Map the operator's strategy spec to skills it depends on, so the marketplace
 * can highlight "Required for your strategy" cards. Keep the keyword list
 * in sync with the algo→skills mapping in TRADER_SYSTEM_PROMPT.
 */
function deriveRequiredSkillIds(blueprint: AgentBlueprint): Set<string> {
  const t = blueprint.trader;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = t?.strategy as any;
  if (!s) return new Set();
  const corpus = [
    String(t?.summary ?? ""),
    JSON.stringify(s.decisionRules ?? []),
    JSON.stringify(s.assetUniverse ?? []),
    String(s.mode ?? ""),
    String(s.binaryDirectional ? "binary directional" : ""),
  ].join(" ").toLowerCase();
  const out = new Set<string>();
  const has = (re: RegExp) => re.test(corpus);
  if (has(/sentiment|twitter|\bx\b|tweet/)) { out.add("x.sentiment"); out.add("ai.reasoning"); }
  if (has(/whale|big wallet|smart money/)) { out.add("onchain.whale"); out.add("onchain.flow"); }
  if (has(/news|headline|coindesk|cointelegraph/)) { out.add("news.feed"); out.add("ai.reasoning"); }
  if (has(/polymarket|prediction market/)) out.add("polymarket.signals");
  if (has(/swap|execute|live trade|real trade|jupiter/)) { out.add("jupiter.swap"); out.add("risk.guardian"); }
  if (has(/\bta\b|rsi|macd|technical|breakout|moving average/)) { out.add("ta.analysis"); out.add("birdeye.analytics"); }
  if (has(/dca|accumulator|rebalance|portfolio/)) { out.add("portfolio.rebalance"); out.add("dca.scheduler"); }
  if (has(/stop[- ]?loss|drawdown|circuit/)) { out.add("risk.guardian"); out.add("drawdown.guard"); }
  if (has(/telegram/)) out.add("telegram.alert");
  if (has(/discord/)) out.add("discord.alert");
  if (has(/copy[- ]?trade|mirror wallet|follow wallet/)) out.add("copy.trade");
  if (has(/funding rate|perp/)) out.add("funding.rate");
  if (has(/liquidation|liq cascade/)) out.add("liquidation.tracker");
  if (has(/yield|apy|lend|earn/)) out.add("yield.scanner");
  // Risk guardian is always recommended for any real-money strategy
  if (s.autonomy === "auto" && !s.paperTrade) out.add("risk.guardian");
  return out;
}

function TraderMarketplace({ blueprint, onToggleSkill }: { blueprint: AgentBlueprint; onToggleSkill: (id: string, install: boolean) => void }) {
  const [activeCategory, setActiveCategory] = useState<TraderSkillCategory | "all">("all");
  const installed = blueprint.installedSkills ?? [];
  const dailyBurn = estimateDailyBurn(installed);

  const requiredIds = useMemo(() => deriveRequiredSkillIds(blueprint), [blueprint]);
  const missingRequired = useMemo(
    () => Array.from(requiredIds).filter((id) => !installed.includes(id)),
    [requiredIds, installed],
  );

  // Live connection status — re-polls every 60s so users see when an API recovers
  const [statuses, setStatuses] = useState<Record<string, SkillStatus>>({});
  const [statusLoading, setStatusLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/trader/skill-status");
        if (!res.ok) return;
        const data = await res.json() as { ok: boolean; statuses: Record<string, SkillStatus> };
        if (!cancelled && data.ok) setStatuses(data.statuses);
      } catch { /* ignore */ }
      finally { if (!cancelled) setStatusLoading(false); }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const liveCount    = Object.values(statuses).filter((s) => s.connected).length;
  const setupNeeded  = TRADER_SKILLS_CATALOG.filter((s) => (s.requires?.length ?? 0) > 0 && !statuses[s.id]?.keyPresent).length;

  const categories = Object.keys(TRADER_CATEGORY_META) as TraderSkillCategory[];
  const filtered = useMemo(() => {
    const base = activeCategory === "all"
      ? TRADER_SKILLS_CATALOG
      : TRADER_SKILLS_CATALOG.filter((s) => s.category === activeCategory);
    // Sort: missing-required first, then required-installed, then everything else.
    return [...base].sort((a, b) => {
      const aReq = requiredIds.has(a.id), bReq = requiredIds.has(b.id);
      const aMissing = aReq && !installed.includes(a.id);
      const bMissing = bReq && !installed.includes(b.id);
      if (aMissing !== bMissing) return aMissing ? -1 : 1;
      if (aReq !== bReq) return aReq ? -1 : 1;
      return 0;
    });
  }, [activeCategory, requiredIds, installed]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-50" style={{ fontFamily: "var(--font-inter)" }}>
      {/* Black title bar, shrink-0 keeps it fixed at top */}
      <div className="shrink-0 bg-black text-white px-6 py-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Skills Marketplace</h2>
          <p className="text-[12px] text-zinc-400 mt-0.5">Add capabilities to your agent · Each skill is an API integration</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Live API connection summary */}
          <div className="hidden sm:flex items-center gap-3">
            <div className="text-right">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">APIs Live</p>
              <p className="text-sm font-mono font-bold flex items-center gap-1.5">
                {statusLoading ? (
                  <Loader2 className="size-3.5 text-zinc-500 animate-spin" />
                ) : (
                  <>
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_4px_currentColor]" />
                    {liveCount}/{TRADER_SKILLS_CATALOG.length}
                  </>
                )}
              </p>
            </div>
            {setupNeeded > 0 && (
              <div className="text-right">
                <p className="text-[10px] text-amber-500 uppercase tracking-wider">Setup</p>
                <p className="text-sm font-mono font-bold text-amber-400">{setupNeeded}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Burn rate strip */}
      <div className="shrink-0 bg-zinc-900 text-white px-6 py-2.5 flex items-center justify-between border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <span className="text-[12px] text-zinc-400">
            <span className="text-white font-semibold">{installed.length}</span> installed
          </span>
          {installed.length > 0 && (
            <span className="text-[12px] font-mono text-zinc-400">
              <span className="text-zinc-500">burn</span> <span className="text-emerald-400">${dailyBurn.toFixed(2)}</span>/day
              <span className="text-zinc-600 mx-1">·</span>
              <span className="text-zinc-300">${(dailyBurn * 30).toFixed(0)}/mo</span>
            </span>
          )}
        </div>
        {installed.length > 0 && (
          <div className="flex -space-x-1">
            {installed.slice(0, 6).map((id) => {
              const cat = (TRADER_SKILLS_CATALOG.find((s) => s.id === id)?.category ?? "signals") as TraderSkillCategory;
              const colors = TRADER_CATEGORY_COLORS[cat] ?? TRADER_CATEGORY_COLORS.signals;
              const Icon = TRADER_CATEGORY_ICONS[cat] ?? Radio;
              return (
                <div key={id} className={`size-6 rounded-full border-2 border-zinc-900 flex items-center justify-center bg-zinc-800`}>
                  <Icon className={`size-3 ${colors.active.split(" ")[0]}`} />
                </div>
              );
            })}
            {installed.length > 6 && (
              <div className="size-6 rounded-full border-2 border-zinc-900 bg-zinc-700 flex items-center justify-center">
                <span className="text-[9px] text-zinc-300">+{installed.length - 6}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category filter pills, sticky at top of scroll area */}
      <div className="shrink-0 bg-white px-5 py-3 flex gap-2 flex-wrap border-b border-zinc-200" style={{ fontFamily: "var(--font-inter)" }}>
        <button
          onClick={() => setActiveCategory("all")}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all border ${
            activeCategory === "all"
              ? "bg-zinc-900 border-zinc-900 text-white"
              : "border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:border-zinc-400 bg-white"
          }`}
        >
          All ({TRADER_SKILLS_CATALOG.length})
        </button>
        {categories.map((cat) => {
          const meta = TRADER_CATEGORY_META[cat];
          const Icon = TRADER_CATEGORY_ICONS[cat];
          const count = TRADER_SKILLS_CATALOG.filter((s) => s.category === cat).length;
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all border ${
                isActive
                  ? "bg-zinc-900 border-zinc-900 text-white"
                  : "border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:border-zinc-400 bg-white"
              }`}
            >
              <Icon className="size-3.5" strokeWidth={2.2} />
              {meta.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Category description */}
      {activeCategory !== "all" && (
        <div className="shrink-0 bg-white px-5 py-2.5 border-b border-zinc-200" style={{ fontFamily: "var(--font-inter)" }}>
          <p className="text-[12px] text-zinc-500">{TRADER_CATEGORY_META[activeCategory].description}</p>
        </div>
      )}

      {/* Skills grid, light surface, scrollable */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-5 bg-zinc-50 marketplace-scroll"
        style={{
          scrollBehavior: "smooth",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Required-for-your-strategy banner */}
        {missingRequired.length > 0 && (
          <div className="mb-4 rounded-2xl border border-cyan-300 bg-cyan-50 px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-cyan-900 uppercase tracking-wider">
                {missingRequired.length} skill{missingRequired.length > 1 ? "s" : ""} required for your strategy
              </p>
              <p className="text-[12.5px] text-cyan-800 mt-0.5 leading-snug">
                Your strategy spec references signals or execution paths that need these. Install all to make the agent self-sufficient.
              </p>
            </div>
            <button
              type="button"
              onClick={() => missingRequired.forEach((id) => onToggleSkill(id, true))}
              className="duo-btn duo-btn-emerald duo-btn-sm shrink-0"
            >
              Install all ({missingRequired.length})
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <AnimatePresence initial={false}>
            {filtered.map((skill) => (
              <TraderSkillCard
                key={skill.id}
                skill={skill}
                installed={installed.includes(skill.id)}
                required={requiredIds.has(skill.id)}
                onToggle={() => onToggleSkill(skill.id, !installed.includes(skill.id))}
                status={statuses[skill.id]}
                statusLoading={statusLoading}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 bg-white px-5 py-3 border-t border-zinc-200 flex items-center justify-between">
        <p className="text-[11px] text-zinc-500">
          Skill providers earn <span className="text-zinc-800 font-semibold">17.5%</span> of usage revenue
        </p>
        <p className="text-[11px] text-zinc-500">
          {TRADER_SKILLS_CATALOG.length} skills available
        </p>
      </div>
    </div>
  );
}

// ─── Influencer Skill Marketplace (modal) ────────────────────────────────────

const INFLUENCER_CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  distribution: { bg: "bg-violet-500/10", text: "text-violet-300", border: "border-violet-500/25", dot: "bg-violet-400" },
  content:      { bg: "bg-rose-500/10",   text: "text-rose-300",   border: "border-rose-500/25",   dot: "bg-rose-400" },
  messaging:    { bg: "bg-sky-500/10",    text: "text-sky-300",    border: "border-sky-500/25",    dot: "bg-sky-400" },
  data:         { bg: "bg-amber-500/10",  text: "text-amber-300",  border: "border-amber-500/25",  dot: "bg-amber-400" },
  intelligence: { bg: "bg-fuchsia-500/10",text: "text-fuchsia-300",border: "border-fuchsia-500/25",dot: "bg-fuchsia-400" },
  monetization: { bg: "bg-emerald-500/10",text: "text-emerald-300",border: "border-emerald-500/25",dot: "bg-emerald-400" },
  default:      { bg: "bg-zinc-500/10",   text: "text-zinc-300",   border: "border-zinc-500/25",   dot: "bg-zinc-400" },
};

// Tinted-paper category badge tones — match the cream theme
const PAPER_CATEGORY_TONES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  distribution: { bg: "bg-violet-100",  text: "text-violet-700",  border: "border-violet-300/70",  dot: "bg-violet-500" },
  content:      { bg: "bg-rose-100",    text: "text-rose-700",    border: "border-rose-300/70",    dot: "bg-rose-500" },
  messaging:    { bg: "bg-sky-100",     text: "text-sky-700",     border: "border-sky-300/70",     dot: "bg-sky-500" },
  data:         { bg: "bg-amber-100",   text: "text-amber-700",   border: "border-amber-300/70",   dot: "bg-amber-500" },
  intelligence: { bg: "bg-fuchsia-100", text: "text-fuchsia-700", border: "border-fuchsia-300/70", dot: "bg-fuchsia-500" },
  signals:      { bg: "bg-cyan-100",    text: "text-cyan-700",    border: "border-cyan-300/70",    dot: "bg-cyan-500" },
  execution:    { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300/70", dot: "bg-emerald-500" },
  risk:         { bg: "bg-amber-100",   text: "text-amber-700",   border: "border-amber-300/70",   dot: "bg-amber-500" },
  alerts:       { bg: "bg-rose-100",    text: "text-rose-700",    border: "border-rose-300/70",    dot: "bg-rose-500" },
  monetization: { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300/70", dot: "bg-emerald-500" },
  default:      { bg: "bg-zinc-100",    text: "text-zinc-700",    border: "border-zinc-300/70",    dot: "bg-zinc-500" },
};

function defaultTemplate(skill: { name: string; description: string }) {
  return `# ${skill.name}\n\n> ${skill.description}\n\n## Instructions\n\n## Examples\n\n## Notes\n\n`;
}

interface InfluencerSkillModalProps {
  blueprint: AgentBlueprint;
  onToggleSkill: (id: string, install: boolean) => void;
  onClose: () => void;
  sessionId?: string;
  mintAddress?: string;
  onOpenMd?: (skill: { id: string; label: string; desc: string }) => void;
}

function InfluencerSkillModal({ blueprint, onToggleSkill, onClose, sessionId, mintAddress, onOpenMd }: InfluencerSkillModalProps) {
  const agentType = (blueprint.agentType ?? "influencer") as "influencer" | "trader" | "worker";
  const installed = blueprint.installedSkills ?? [];
  const [filter, setFilter] = useState<SkillCategory | "all">("all");
  const [search, setSearch] = useState("");
  const skillsSorted = useMemo(() => getSkillsForAgent(agentType), [agentType]);
  const dailyBurn = estimateDailyBurn(installed);

  const upsertSkillFile = useMutation(api.agentSkillFiles.upsert);
  const skillFiles = useQuery(
    api.agentSkillFiles.listBySession,
    sessionId ? { sessionId } : "skip",
  ) as Array<{ skillId: string; title: string; markdown: string }> | undefined;
  const skillFileSet = useMemo(() => new Set((skillFiles ?? []).map((f) => f.skillId)), [skillFiles]);

  // ── Custom skill editor — let the user author their own MD skill ─────────────
  const [showCustom, setShowCustom] = useState(false);
  const [cName, setCName] = useState("");
  const [cMd, setCMd] = useState("");
  const [cSaving, setCSaving] = useState(false);
  const saveCustom = async () => {
    const name = cName.trim();
    if (!name || !sessionId) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "skill";
    const skillId = `custom.${slug}`;
    const markdown = cMd.trim() || `# ${name}\n\n> Custom skill authored by the operator.\n\n## Instructions\n1. Describe exactly what the agent should do here.\n`;
    setCSaving(true);
    try {
      await upsertSkillFile({ sessionId, mintAddress, skillId, title: name, markdown });
      onToggleSkill(skillId, true);
      setShowCustom(false); setCName(""); setCMd("");
    } catch { /* non-fatal */ }
    finally { setCSaving(false); }
  };

  const availableCategories = useMemo(() => {
    const cats = new Set(skillsSorted.map(s => s.category as SkillCategory));
    return Array.from(cats);
  }, [skillsSorted]);

  const filtered = useMemo(() => {
    let list = filter === "all" ? skillsSorted : skillsSorted.filter(s => s.category === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.provider.toLowerCase().includes(q));
    }
    return list;
  }, [filter, search, skillsSorted]);

  const handleInstall = async (skill: Skill) => {
    onToggleSkill(skill.id, true);
    if (sessionId) {
      try {
        await upsertSkillFile({
          sessionId,
          mintAddress,
          skillId: skill.id,
          title: skill.name,
          markdown: skill.markdownTemplate ?? defaultTemplate(skill),
        });
      } catch {
        // non-fatal — install still proceeded
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={onClose}
      style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-xl" />

      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        onClick={e => e.stopPropagation()}
        className="relative z-10 w-full max-w-[920px] rounded-xl overflow-hidden flex flex-col bg-[#fbfaf6] border border-zinc-300 shadow-2xl"
        style={{ maxHeight: "min(86vh, 720px)" }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-300/70 bg-[#f6f1e6] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-serif text-[22px] font-bold text-zinc-900 tracking-tight leading-none">Skills Marketplace</h2>
            <p className="text-[12px] text-zinc-600 mt-1.5">Install capabilities for your AI Influencer · Each skill becomes an MD-backed instruction file.</p>
          </div>
          <div className="flex items-center gap-3">
            {installed.length > 0 && (
              <div className="text-right">
                <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-mono">Daily burn</p>
                <p className="text-[14px] font-mono font-bold text-emerald-700 tabular-nums">${dailyBurn.toFixed(2)}</p>
              </div>
            )}
            <button onClick={onClose}
              className="flex size-8 items-center justify-center rounded-full bg-white border border-zinc-300 text-zinc-600 hover:text-zinc-900 hover:border-zinc-500 transition-all">
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Search + filters */}
        <div className="px-5 py-3 border-b border-zinc-300/70 bg-[#fbfaf6] flex items-center gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 h-8 rounded-lg border border-zinc-300 bg-white px-3 flex-1 min-w-[180px] max-w-[260px] focus-within:border-zinc-900 transition-colors">
            <Search className="size-3 text-zinc-500 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search skills…"
              className="flex-1 bg-transparent text-[12.5px] text-zinc-900 placeholder:text-zinc-400 outline-none" />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setFilter("all")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all ${
                filter === "all"
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-white border-zinc-300 text-zinc-700 hover:border-zinc-500 hover:text-zinc-900"
              }`}>
              All
            </button>
            {availableCategories.map(cat => {
              const meta = CATEGORY_META[cat];
              const isActive = filter === cat;
              return (
                <button key={cat} onClick={() => setFilter(cat)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all ${
                    isActive
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white border-zinc-300 text-zinc-700 hover:border-zinc-500 hover:text-zinc-900"
                  }`}>
                  <span>{meta?.icon}</span>{meta?.label}
                </button>
              );
            })}
          </div>
          {sessionId && (
            <button onClick={() => setShowCustom(v => !v)}
              className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border transition-all ${
                showCustom ? "bg-violet-600 text-white border-violet-600" : "bg-white border-zinc-300 text-zinc-700 hover:border-zinc-500 hover:text-zinc-900"
              }`}>
              <Plus className="size-3" strokeWidth={2.5} /> Write your own
            </button>
          )}
        </div>

        {/* Custom skill editor */}
        {showCustom && sessionId && (
          <div className="px-5 py-4 border-b border-zinc-300/70 bg-[#fbfaf6] shrink-0 space-y-2.5">
            <div className="flex items-center gap-2">
              <FileText className="size-3.5 text-violet-600" />
              <span className="text-[12px] font-bold text-zinc-900">Author a custom skill</span>
            </div>
            <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Skill name, e.g. Meme Caption Writer"
              className="w-full h-9 rounded-lg border border-zinc-300 bg-white px-3 text-[13px] text-zinc-900 outline-none focus:border-zinc-900" />
            <textarea value={cMd} onChange={e => setCMd(e.target.value)} rows={8}
              placeholder={"# My Skill\n\n> One line on what it does.\n\n## Instructions\n1. Step one\n2. Step two\n\n## Best practices\n- ..."}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[12.5px] font-mono leading-relaxed text-zinc-900 outline-none focus:border-zinc-900 resize-y" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-zinc-500">Saved as a Markdown instruction file your agent reads &amp; follows. Leave the body blank for a starter template.</span>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => { setShowCustom(false); }} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500">Cancel</button>
                <button onClick={saveCustom} disabled={!cName.trim() || cSaving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-zinc-900 text-white disabled:opacity-50">
                  {cSaving ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" strokeWidth={2.5} />} Save &amp; install
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Skills grid */}
        <div className="flex-1 overflow-y-auto p-5 bg-[#f6f1e6]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence initial={false}>
              {filtered.map(skill => {
                const isInstalled = installed.includes(skill.id);
                const hasMd = skillFileSet.has(skill.id);
                const tone = PAPER_CATEGORY_TONES[skill.category] ?? PAPER_CATEGORY_TONES.default;
                return (
                  <motion.div key={skill.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}
                    className={`relative flex flex-col rounded-xl p-4 transition-all ${
                      isInstalled
                        ? "bg-emerald-50/50 border border-emerald-400 ring-1 ring-emerald-300"
                        : "bg-white border border-zinc-300/70 hover:border-zinc-500 hover:shadow-md hover:-translate-y-0.5"
                    }`}>
                    {/* Installed check */}
                    {isInstalled && <CheckCircle2 className="absolute top-3 right-3 size-4 text-emerald-600" />}
                    {/* MD indicator (when file exists but not installed) */}
                    {hasMd && !isInstalled && (
                      <span className="absolute top-3 right-3 text-[11px]" title="MD instructions saved">📄</span>
                    )}

                    {/* Category badge */}
                    <div className={`inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-md text-[8.5px] font-bold uppercase tracking-widest mb-3 ${tone.bg} ${tone.text} border ${tone.border}`}>
                      <span className={`size-1.5 rounded-full ${tone.dot}`} />
                      {CATEGORY_META[skill.category as SkillCategory]?.label ?? skill.category}
                    </div>

                    {/* Name + provider */}
                    <p className="font-serif text-[15px] font-bold text-zinc-900 leading-tight">{skill.name}</p>
                    <p className="text-[10.5px] text-zinc-500 mt-0.5 font-mono">by {skill.provider}</p>

                    {/* Description */}
                    <p className="text-[12px] text-zinc-700 leading-relaxed mt-2 line-clamp-3 flex-1">{skill.description}</p>

                    {/* Footer */}
                    <div className="flex items-end justify-between mt-3 pt-3 border-t border-zinc-200/70 gap-2">
                      <div>
                        <p className="text-[13px] font-mono font-bold text-zinc-900 tabular-nums">
                          ${skill.pricePerUseUsdc.toFixed(skill.pricePerUseUsdc < 0.01 ? 3 : 2)}
                          <span className="text-[9.5px] text-zinc-500 font-normal ml-1">/{skill.pricingUnit}</span>
                        </p>
                        <p className="text-[9.5px] text-zinc-500 mt-0.5 font-mono">~${(skill.pricePerUseUsdc * skill.avgUsesPerDay).toFixed(2)}/day</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isInstalled && onOpenMd && (
                          <button
                            type="button"
                            onClick={() => onOpenMd({ id: skill.id, label: skill.name, desc: skill.description })}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10.5px] font-semibold border border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500 hover:text-zinc-900 transition-all"
                            title="View / edit MD instructions"
                          >
                            <FileText className="size-3" strokeWidth={2.2} />
                            View
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (isInstalled) onToggleSkill(skill.id, false);
                            else void handleInstall(skill);
                          }}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all active:scale-[0.97] ${
                            isInstalled
                              ? "bg-white border-zinc-300 text-zinc-700 hover:border-rose-400 hover:text-rose-700"
                              : "bg-emerald-600 border-emerald-700 text-white hover:bg-emerald-700"
                          }`}>
                          {isInstalled ? <><X className="size-3" strokeWidth={2.5} /> Remove</> : <><Plus className="size-3" strokeWidth={2.5} /> Install</>}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {filtered.length === 0 && (
              <div className="col-span-full py-12 text-center">
                <p className="text-zinc-500 text-[13px]">No skills match your search.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-300/70 bg-[#f6f1e6] flex items-center justify-between shrink-0">
          <p className="text-[10.5px] text-zinc-600">Skill providers earn <span className="text-zinc-900 font-semibold">17.5%</span> of usage revenue</p>
          <p className="text-[10.5px] text-zinc-600">{installed.length} installed · {INFLUENCER_SKILLS_CATALOG.length} available</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

export { InfluencerSkillModal };

function LegacyMarketplace({ blueprint, variant = "dark", onToggleSkill, sessionId, hideHeader }: SkillsMarketplaceCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const isPaper = variant === "paper";
  const agentType = (blueprint.agentType ?? "influencer") as "influencer" | "trader" | "worker";
  const installed = blueprint.installedSkills ?? [];
  const skillsSorted = useMemo(() => getSkillsForAgent(agentType), [agentType]);
  const dailyBurn = estimateDailyBurn(installed);

  // Custom skills the copilot engineered (stored as agentSkillFiles) — reactive,
  // so a freshly-built skill appears here in realtime.
  const skillFiles = useQuery(
    api.agentSkillFiles.listBySession,
    sessionId ? { sessionId } : "skip",
  ) as Array<{ skillId: string; title: string; markdown: string }> | undefined;
  const catalogIds = useMemo(() => new Set(skillsSorted.map((s) => s.id)), [skillsSorted]);
  const customById = useMemo(() => {
    const m = new Map<string, { name: string; description: string }>();
    for (const f of skillFiles ?? []) {
      if (catalogIds.has(f.skillId)) continue; // catalog skill markdown, not a custom skill
      const description = (f.markdown.match(/^description:\s*(.*)$/m)?.[1] ?? "").trim();
      m.set(f.skillId, { name: f.title || f.skillId, description });
    }
    return m;
  }, [skillFiles, catalogIds]);

  const t = isPaper
    ? { card: "nb-card", rule: "bg-zinc-900/85", sectionHeader: "text-zinc-900", labelMuted: "text-zinc-500", labelStrong: "text-zinc-900", priceText: "text-emerald-700", installedBg: "bg-emerald-50 border-emerald-200", installedText: "text-emerald-700", skillCard: "border-zinc-200 bg-white hover:border-zinc-400", chipActive: "bg-zinc-900 text-white border-zinc-900", chipIdle: "bg-white border-zinc-300 text-zinc-700 hover:border-zinc-500" }
    : { card: "rounded-xl border border-white/[0.08] bg-[#0c0f14]", rule: "bg-white/[0.08]", sectionHeader: "text-zinc-300", labelMuted: "text-zinc-500", labelStrong: "text-white", priceText: "text-emerald-400", installedBg: "bg-emerald-500/10 border-emerald-500/30", installedText: "text-emerald-300", skillCard: "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.18]", chipActive: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", chipIdle: "bg-white/[0.04] border-white/[0.08] text-zinc-400 hover:border-white/[0.18]" };

  return (
    <>
      {/* Compact connectors panel */}
      <div className={`${t.card} overflow-hidden`}>
        {/* Header row, hidden when the caller renders its own SectionHeading */}
        {!hideHeader && (
          <>
            <div className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className={`size-5 rounded flex items-center justify-center ${isPaper ? "bg-violet-100" : "bg-violet-500/15"}`}>
                  <Zap className={`size-3 ${isPaper ? "text-violet-700" : "text-violet-400"}`} />
                </div>
                <span className={`text-[12px] font-semibold ${t.sectionHeader}`}>Connectors</span>
                <span className={`text-[10px] font-mono ${t.labelMuted}`}>{installed.length}/{skillsSorted.length}</span>
              </div>
              <button onClick={() => setModalOpen(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                  isPaper
                    ? "bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-700"
                    : "bg-violet-500/15 border-violet-500/30 text-violet-300 hover:bg-violet-500/22 hover:border-violet-500/45"
                }`}>
                <Plus className="size-3" strokeWidth={2.5} /> Browse
              </button>
            </div>
            <div className={`h-px ${t.rule} mx-4`} />
          </>
        )}

        {/* Installed skills list or empty state */}
        {installed.length === 0 ? (
          <div className="px-4 py-5 text-center">
            <div className={`size-10 rounded-xl mx-auto mb-2.5 flex items-center justify-center ${isPaper ? "bg-zinc-100" : "bg-white/[0.03] border border-white/[0.06]"}`}>
              <Zap className={`size-5 ${isPaper ? "text-zinc-400" : "text-zinc-700"}`} />
            </div>
            <p className={`text-[12px] font-semibold ${t.labelMuted}`}>No connectors yet</p>
            <p className={`text-[10.5px] ${t.labelMuted} mt-0.5 opacity-70`}>Add connectors to extend your agent&apos;s reach</p>
            <button onClick={() => setModalOpen(true)}
              className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                isPaper ? "bg-zinc-900 text-white border-zinc-900" : "bg-white/[0.04] border-white/[0.1] text-zinc-300 hover:border-white/20"
              }`}>
              <Plus className="size-3" strokeWidth={2.5} /> Browse
            </button>
          </div>
        ) : (
          <div className="px-3 py-3 space-y-1.5">
            {installed.slice(0, 5).map(id => {
              const skill = skillsSorted.find(s => s.id === id);
              const custom = !skill ? customById.get(id) : undefined;
              if (!skill && !custom) return null;
              const col = skill ? (INFLUENCER_CATEGORY_COLORS[skill.category] ?? INFLUENCER_CATEGORY_COLORS.default) : INFLUENCER_CATEGORY_COLORS.default;
              const label = skill ? skill.name : custom!.name;
              return (
                <div key={id} title={custom?.description} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg ${isPaper ? "bg-white border border-zinc-200" : "bg-white/[0.025] border border-white/[0.06]"}`}>
                  <span className={`size-1.5 rounded-full shrink-0 ${isPaper ? "bg-emerald-500" : col.dot}`} />
                  <span className={`flex-1 text-[12px] font-medium truncate ${t.labelStrong}`}>{label}</span>
                  {skill ? (
                    <span className={`text-[10px] font-mono ${t.priceText}`}>${skill.pricePerUseUsdc.toFixed(2)}/{skill.pricingUnit}</span>
                  ) : (
                    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${isPaper ? "bg-violet-100 text-violet-700" : "bg-violet-500/15 text-violet-300"}`}>custom</span>
                  )}
                  <button onClick={() => onToggleSkill(id, false)}
                    aria-label={`Remove ${label}`}
                    className={`shrink-0 text-[9.5px] ${t.labelMuted} hover:text-rose-400 transition-colors`}>
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
            {installed.length > 5 && (
              <button onClick={() => setModalOpen(true)} className={`w-full text-center text-[10px] ${t.labelMuted} hover:${t.labelStrong} py-1`}>
                +{installed.length - 5} more · manage all
              </button>
            )}
          </div>
        )}

        {/* Burn rate footer */}
        {installed.length > 0 && (
          <div className={`px-4 py-2.5 border-t ${isPaper ? "border-zinc-200" : "border-white/[0.06]"} flex items-center justify-between`}>
            <span className={`text-[10px] ${t.labelMuted}`}>Daily burn</span>
            <span className={`text-[11px] font-mono font-bold ${t.priceText}`}>${dailyBurn.toFixed(2)}/day · ${(dailyBurn*30).toFixed(0)}/mo</span>
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {modalOpen && (
          <InfluencerSkillModal blueprint={blueprint} onToggleSkill={onToggleSkill} onClose={() => setModalOpen(false)} sessionId={sessionId} />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function SkillsMarketplaceCard({ blueprint, variant = "dark", onToggleSkill, sessionId, hideHeader }: SkillsMarketplaceCardProps) {
  if (blueprint.agentType === "trader") {
    return <TraderMarketplace blueprint={blueprint} onToggleSkill={onToggleSkill} />;
  }
  return <LegacyMarketplace blueprint={blueprint} variant={variant} onToggleSkill={onToggleSkill} sessionId={sessionId} hideHeader={hideHeader} />;
}
