"use client";

import { motion, useInView } from "framer-motion";
import { useRef, type ReactNode } from "react";
import type { Citizen } from "./data";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/* ── LiveDot ──────────────────────────────────────────────────────────────── */
export function LiveDot({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const px = size === "sm" ? 6 : size === "lg" ? 12 : 8;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: px, height: px }}>
      <span className="absolute inset-0 rounded-full bg-[#00FF88] mach-pulse-live" />
      <span className="absolute inset-0 rounded-full bg-[#00FF88]" />
    </span>
  );
}

/* ── Corner brackets ──────────────────────────────────────────────────────── */
export function Bracket({ className = "" }: { className?: string }) {
  const c = "absolute w-3 h-3 border-[#00FFD1] transition-opacity duration-300";
  return (
    <span aria-hidden className={`pointer-events-none ${className}`}>
      <span className={`${c} top-0 left-0 border-l border-t`} />
      <span className={`${c} top-0 right-0 border-r border-t`} />
      <span className={`${c} bottom-0 left-0 border-l border-b`} />
      <span className={`${c} bottom-0 right-0 border-r border-b`} />
    </span>
  );
}

/* ── Button ───────────────────────────────────────────────────────────────── */
export function Button({
  children, variant = "primary", size = "md", href, onClick, trailing,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  href?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const pad = size === "lg" ? "px-9 py-4 text-[15px]" : "px-8 py-3.5 text-[14px]";
  const base = "group inline-flex items-center justify-center gap-2 font-medium select-none transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f]";
  const cls = variant === "primary"
    ? `${base} ${pad} text-[#0a0a0f] [background:linear-gradient(135deg,#00FFD1,#00CCAA)] shadow-[0_0_24px_rgba(0,255,209,0.35)] hover:brightness-110 hover:scale-[1.02] hover:shadow-[0_0_36px_rgba(0,255,209,0.5)]`
    : `${base} ${pad} text-white/70 hover:text-white`;
  const style = { fontFamily: "var(--font-space)" };
  const inner = (
    <>
      {variant === "secondary" ? <span className="border-b border-transparent group-hover:border-white/70 transition-colors">{children}</span> : children}
      {trailing && <span className="transition-transform duration-300 group-hover:translate-x-0.5">{trailing}</span>}
    </>
  );
  if (href) return <a href={href} className={cls} style={style}>{inner}</a>;
  return <button type="button" onClick={onClick} className={cls} style={style}>{inner}</button>;
}

/* ── ScrollReveal ─────────────────────────────────────────────────────────── */
export function ScrollReveal({ children, delay = 0, y = 28, className = "", once = true }: {
  children: ReactNode; delay?: number; y?: number; className?: string; once?: boolean;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once, margin: "-12% 0px -12% 0px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: 0.8, ease: EASE_OUT, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ── AgentCard ────────────────────────────────────────────────────────────── */
export function AgentCard({ agent, index }: { agent: Citizen; index: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  return (
    <motion.a
      ref={ref}
      href="/market"
      initial={{ opacity: 0, y: 30 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: EASE_OUT, delay: (index % 3) * 0.1 + Math.floor(index / 3) * 0.05 }}
      className="group/card relative flex flex-col gap-4 border border-[#2a2a3e] bg-[#1a1a2e] p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#00FFD1]/40 hover:bg-[#20203a]"
    >
      <Bracket className="opacity-30 group-hover/card:opacity-100" />

      <div className="flex items-start justify-between">
        <div className={`size-20 rounded-full bg-gradient-to-br ${agent.avatar} ring-1 ring-white/10`} />
        {agent.isLive && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[#00FF88]" style={{ fontFamily: "var(--font-jbmono)" }}>
            <LiveDot size="sm" /> Live
          </span>
        )}
      </div>

      <div>
        <h3 className="text-[24px] font-bold leading-none text-white" style={{ fontFamily: "var(--font-space)" }}>{agent.name}</h3>
        <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-[#00FFD1]" style={{ fontFamily: "var(--font-jbmono)" }}>{agent.type}</p>
      </div>

      <p className="text-[14px] leading-relaxed text-white/70 line-clamp-2">{agent.description}</p>

      <div className="mt-auto space-y-2 pt-2">
        {agent.stats.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between border-t border-[#2a2a3e]/70 pt-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-white/45" style={{ fontFamily: "var(--font-jbmono)" }}>{s.label}</span>
            <span className="text-[16px] font-semibold text-white" style={{ fontFamily: "var(--font-space)" }}>{s.value}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-[#2a2a3e] pt-3.5">
        <span className="text-[18px] font-bold text-[#FFD700]" style={{ fontFamily: "var(--font-jbmono)" }}>{agent.earnings}</span>
      </div>
      <span className="text-[13px] font-medium text-[#00FFD1] opacity-70 transition-opacity group-hover/card:opacity-100" style={{ fontFamily: "var(--font-space)" }}>
        Visit {agent.name} →
      </span>
    </motion.a>
  );
}
