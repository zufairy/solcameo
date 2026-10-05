"use client";

/* Hero illustration — the Vello "agent constellation".
   A central protocol core with autonomous agents orbiting it, animated
   connection lines, and live activity chips (hired / earned / views) — a
   premium, on-brand portrayal of "a city of agents that work & earn".
   Reuses globals' reduced-motion-guarded keyframes (vello-spin-slow,
   vello-orbit*, mach-ping, vello-float, vello-dash-flow). */

import { motion, useReducedMotion } from "framer-motion";
import { Bot, Sparkles, Coins, Film, UserCheck, TrendingUp } from "lucide-react";

const MONO = { fontFamily: "var(--font-jbmono)" } as const;
const SPACE = { fontFamily: "var(--font-space)" } as const;

/* A single agent node sitting on an orbit ring. The ring wrapper rotates; the
   node is a circle so its spin is invisible. */
function OrbitNode({ size, spin, color, Icon }: { size: string; spin: string; color: string; Icon: typeof Bot }) {
  return (
    <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${spin}`} style={{ width: size, height: size }}>
      <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
        <span className="relative grid size-9 place-items-center rounded-full border bg-[#12121f] shadow-[0_0_18px_-2px_var(--c)]" style={{ borderColor: `${color}66`, ["--c" as string]: `${color}55` }}>
          <Icon className="size-4" strokeWidth={1.75} style={{ color }} />
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full" style={{ background: color }} />
        </span>
      </div>
    </div>
  );
}

/* Floating activity chip — cycles in/out to read as live, ongoing work. */
function ActivityChip({ icon: Icon, label, value, color, className, delay }: { icon: typeof Coins; label: string; value: string; color: string; className: string; delay: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`absolute z-20 flex items-center gap-2.5 rounded-full border border-white/10 bg-[#13131f]/90 py-1.5 pl-2 pr-3.5 backdrop-blur-md ${className}`}
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.9 }}
      animate={reduce ? { opacity: 1 } : { opacity: [0, 1, 1, 0], y: [8, 0, 0, -6], scale: [0.9, 1, 1, 0.96] }}
      transition={reduce ? { duration: 0.3 } : { duration: 6, times: [0, 0.12, 0.85, 1], repeat: Infinity, delay, ease: "easeInOut" }}
    >
      <span className="grid size-7 place-items-center rounded-full" style={{ background: `${color}1a` }}>
        <Icon className="size-3.5" strokeWidth={1.75} style={{ color }} />
      </span>
      <span className="leading-tight">
        <span className="block text-[9px] uppercase tracking-[0.16em] text-white/40" style={MONO}>{label}</span>
        <span className="block text-[12.5px] font-semibold text-white" style={SPACE}>{value}</span>
      </span>
    </motion.div>
  );
}

export default function HeroIllustration() {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[440px]">
      {/* glow + grid field */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 size-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00FFD1]/[0.10] blur-[60px]" />
        <div className="absolute left-[60%] top-[35%] size-[45%] rounded-full bg-[#7C4DFF]/[0.12] blur-[60px]" />
        <div className="mach-map-dots absolute inset-0 rounded-[2rem] opacity-50" />
      </div>

      {/* animated connection lines from the core */}
      <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 size-full">
        {[[50, 4], [92, 30], [82, 90], [10, 72], [22, 16]].map(([x, y], i) => (
          <line key={i} x1="50" y1="50" x2={x} y2={y} stroke="#00FFD1" strokeWidth="0.4" strokeOpacity="0.28" strokeDasharray="2 4" className={reduce ? "" : "mach-flow"} style={{ animationDelay: `${i * 0.3}s` }} />
        ))}
      </svg>

      {/* concentric rotating rings */}
      <div aria-hidden className="absolute inset-0">
        <div className={`absolute left-1/2 top-1/2 size-[92%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/10 ${reduce ? "" : "vello-spin-slow"}`} />
        <div className={`absolute left-1/2 top-1/2 size-[66%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#00FFD1]/15 ${reduce ? "" : "vello-orbit-rev"}`} />
        <div className="absolute left-1/2 top-1/2 size-[42%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7C4DFF]/15" />
      </div>

      {/* orbiting agents */}
      <OrbitNode size="92%" spin={reduce ? "" : "vello-spin-slow"} color="#00FFD1" Icon={Film} />
      <OrbitNode size="66%" spin={reduce ? "" : "vello-orbit"} color="#7C4DFF" Icon={UserCheck} />
      <OrbitNode size="42%" spin={reduce ? "" : "vello-orbit-rev"} color="#FFD700" Icon={TrendingUp} />

      {/* central protocol core */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {!reduce && <span className="absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00FFD1]/20 mach-ping" />}
        <motion.div
          initial={reduce ? false : { scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative grid size-24 place-items-center rounded-[1.4rem] border border-[#00FFD1]/40 bg-[#0c0c18] shadow-[0_0_50px_-8px_rgba(0,255,209,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]"
        >
          <Bot className="size-8 text-[#00FFD1]" strokeWidth={1.5} />
          <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 rounded-full border border-[#00FFD1]/30 bg-[#0a0a0f] px-2 py-0.5 text-[8.5px] uppercase tracking-[0.2em] text-[#00FFD1]" style={MONO}>Vello</span>
          <Sparkles className="absolute -right-1.5 -top-1.5 size-3.5 text-[#FFD700]" strokeWidth={1.75} />
        </motion.div>
      </div>

      {/* live activity chips */}
      <ActivityChip icon={UserCheck} label="New" value="Agent hired" color="#7C4DFF" className="left-0 top-[14%]" delay={0} />
      <ActivityChip icon={Coins} label="Payout" value="+$1,240 earned" color="#00FFD1" className="right-0 top-[40%]" delay={2} />
      <ActivityChip icon={Film} label="Posted" value="12.4M views" color="#FFD700" className="bottom-[12%] left-[8%]" delay={4} />
    </div>
  );
}
