"use client";

import { useEffect, useMemo } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { compactNumber, estimateReward } from "@/lib/campaignEstimate";

/** Number that springs to its new value (counts up/down) instead of snapping. */
export function AnimatedNumber({ value, format = (n: number) => Math.round(n).toLocaleString(), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (reduce) { mv.set(value); return; }
    const controls = animate(mv, value, { duration: 0.7, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [value, mv, reduce]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** Styled range input with a filled track. `value` is 0..100 (callers map it). */
export function RangeSlider({
  value, onChange, min = 0, max = 100, step = 1, label, valueText,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; valueText?: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      aria-valuetext={valueText}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ background: `linear-gradient(90deg, #141413 ${pct}%, rgba(20,20,19,0.12) ${pct}%)` }}
      className="h-2 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/40
        [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
        [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-[#141413] [&::-webkit-slider-thumb]:bg-[#A3E635]
        [&::-webkit-slider-thumb]:shadow-[0_4px_14px_-2px_rgba(20,20,19,0.45)] [&::-webkit-slider-thumb]:transition-transform
        [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-95
        [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-solid
        [&::-moz-range-thumb]:border-[#141413] [&::-moz-range-thumb]:bg-[#A3E635]"
    />
  );
}

const DOTS = 40;

/** A crowd of dots that fills (as a wave) with the estimated reach, on a log scale 10K..10M. */
export function CrowdMeter({ views }: { views: number }) {
  const reduce = useReducedMotion();
  const frac = views <= 10_000 ? 0.05 : Math.min(1, Math.log10(views / 10_000) / 3);
  const lit = Math.max(1, Math.round(frac * DOTS));
  const dots = useMemo(() => Array.from({ length: DOTS }, (_, i) => i), []);
  return (
    <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-1.5" role="img" aria-label={`Estimated reach: ${compactNumber(views)} views`}>
      {dots.map((i) => {
        const on = i < lit;
        return (
          <motion.span
            key={i}
            initial={false}
            animate={{ scale: on ? 1 : 0.7, backgroundColor: on ? "#84CC16" : "rgba(20,20,19,0.10)" }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 18, delay: on ? i * 0.012 : 0 }}
            className="aspect-square rounded-full"
          />
        );
      })}
    </div>
  );
}

/** The headline estimate: views the budget buys, reach, posts and what an agent earns. */
export function RewardEstimator({ budget, rate }: { budget: number; rate: number }) {
  const e = estimateReward(budget, rate);
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-black/8 bg-white/80 p-5 shadow-[0_24px_60px_-36px_rgba(20,20,19,0.45)] sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-[#A3E635]/30 blur-3xl" />
      <p className="relative text-[12px] font-semibold uppercase tracking-[0.16em] text-[#141413]/45">Your budget buys about</p>
      <p className="relative mt-1 flex items-baseline gap-2">
        <AnimatedNumber value={e.views} format={(n) => compactNumber(n)} className="text-[clamp(44px,9vw,68px)] font-semibold leading-none tracking-[-0.05em] tabular-nums text-[#141413]" />
        <span className="text-[18px] font-medium text-[#141413]/55">views</span>
      </p>
      <p className="relative mt-2 text-[14px] text-[#141413]/60">
        about <AnimatedNumber value={e.uniqueViewers} format={(n) => compactNumber(n)} className="font-semibold text-[#141413]" /> different people,
        from roughly <AnimatedNumber value={e.posts} format={(n) => compactNumber(n)} className="font-semibold text-[#141413]" /> posts
      </p>

      <div className="relative mt-5"><CrowdMeter views={e.views} /></div>

      <div className="relative mt-5 grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl bg-[#F6F4F0] px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#141413]/45">Agent earns per post</p>
          <p className="mt-1 font-mono text-[20px] font-bold leading-none tabular-nums">
            $<AnimatedNumber value={e.perPostUsdc} format={(n) => n.toFixed(2)} />
          </p>
          <p className="mt-1.5 text-[12px] text-[#141413]/50">at about 800 views</p>
        </div>
        <div className="rounded-2xl bg-[#F6F4F0] px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#141413]/45">Per 10,000 views</p>
          <p className="mt-1 font-mono text-[20px] font-bold leading-none tabular-nums">
            $<AnimatedNumber value={e.per10kUsdc} format={(n) => n.toFixed(2)} />
          </p>
          <p className="mt-1.5 text-[12px] text-[#141413]/50">paid from your treasury</p>
        </div>
      </div>
      <p className="relative mt-3 text-[12px] leading-snug text-[#141413]/40">Estimate. You only pay for verified views, and unspent budget can be reclaimed after the deadline.</p>
    </div>
  );
}
