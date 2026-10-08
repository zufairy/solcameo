"use client";
import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { MAX_DISCOUNT_PCT, TIERS, TOKEN_SYMBOL, discountedCost, tierFor } from "@/lib/tokenomics/platformToken";

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 2 : 0)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n));
const COLORS: Record<string, string> = { bronze: "#e0a373", silver: "#cfd5dc", gold: "#fcd34d", diamond: "#7dd3fc" };
const STEPS = TIERS.slice(1);
/** Slider position (0 to 1000) to a balance on a log scale, so every tier is easy to land on. */
const toTokens = (v: number) => (v === 0 ? 0 : Math.round(Math.exp(Math.log(50_000) + (v / 1000) * (Math.log(40_000_000) - Math.log(50_000)))));

/** The holder tiers as a staircase, plus a slider that shows the price of a $10 video at any balance. */
export function TierLadder() {
  const reduced = useReducedMotion();
  const [pos, setPos] = useState(0);
  const tokens = useMemo(() => toTokens(pos), [pos]);
  const tier = tierFor(tokens);
  const price = discountedCost(10, tier.discountPct);
  return (
    <div>
      <div className="flex items-end gap-2.5 sm:gap-3" aria-label="Holder tiers">
        {STEPS.map((t, i) => {
          const reached = tokens >= t.minTokens;
          return (
            <motion.div key={t.key} initial={reduced ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="flex-1">
              <div className={`relative flex flex-col justify-end overflow-hidden rounded-2xl border p-3 transition-colors duration-300 sm:p-4 ${reached ? "border-white/25 bg-white/[0.07]" : "border-white/[0.07] bg-white/[0.02]"}`} style={{ height: 118 + i * 38 }}>
                <div aria-hidden className="absolute inset-x-0 bottom-0 transition-[height] duration-500" style={{ height: reached ? "100%" : "0%", background: `linear-gradient(to top, ${COLORS[t.key]}22, transparent)` }} />
                <p className="relative font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">{t.label}</p>
                <p className="relative mt-1 text-[24px] font-semibold leading-none tabular-nums sm:text-[30px]" style={{ color: COLORS[t.key] }}>{t.discountPct}%</p>
                <p className="relative mt-1 text-[11px] leading-4 text-white/50">off generations</p>
                <p className="relative mt-2 text-[11px] tabular-nums text-white/70">hold {compact(t.minTokens)}+</p>
                <p className="relative text-[11px] tabular-nums text-white/45">rewards x{t.rewardWeight}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="tier-slider" className="text-[13px] font-semibold text-white">If you hold <span className="tabular-nums" style={{ color: "#d7ff00" }}>{tokens.toLocaleString("en-US")}</span> {TOKEN_SYMBOL}</label>
          <span className="text-[12px] text-white/50">{tier.key === "none" ? "No tier yet" : `${tier.label} tier`}</span>
        </div>
        <input id="tier-slider" type="range" min={0} max={1000} step={1} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[#d7ff00]" />
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-black/25 p-3"><p className="text-[10.5px] uppercase tracking-wider text-white/40">A $10 video costs</p><p className="mt-1 text-[20px] font-semibold tabular-nums text-white">${price.toFixed(2)}</p></div>
          <div className="rounded-xl bg-black/25 p-3"><p className="text-[10.5px] uppercase tracking-wider text-white/40">You save</p><p className="mt-1 text-[20px] font-semibold tabular-nums" style={{ color: "#d7ff00" }}>${(10 - price).toFixed(2)}</p></div>
          <div className="rounded-xl bg-black/25 p-3"><p className="text-[10.5px] uppercase tracking-wider text-white/40">Reward weight</p><p className="mt-1 text-[20px] font-semibold tabular-nums text-white">{tier.rewardWeight ? `x${tier.rewardWeight}` : "none"}</p></div>
        </div>
        <p className="mt-3 text-[11.5px] leading-5 text-white/40">The tier follows the balance of the wallet that owns the agent, read live. Nothing to stake or lock. The best discount is {MAX_DISCOUNT_PCT}%.</p>
      </div>
    </div>
  );
}
