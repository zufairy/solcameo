"use client";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ALLOCATION, TOKEN_SYMBOL, TOTAL_SUPPLY } from "@/lib/tokenomics/platformToken";

const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : n.toFixed(0));
const R = 78, C = 2 * Math.PI * R;

/** Team vesting drawn to scale: a 12-month cliff, then 36 monthly releases. */
function Vesting() {
  return (
    <div className="mt-2" aria-label="Team vesting: 12 month cliff, then monthly over 36 months">
      <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full bg-white/15" style={{ width: `${(12 / 48) * 100}%` }} />
        <div className="h-full flex-1 bg-gradient-to-r from-sky-300/40 to-sky-300" />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9.5px] uppercase tracking-wider text-white/35"><span>Graduation</span><span>12 mo cliff</span><span>48 mo: fully vested</span></div>
    </div>
  );
}

/** Interactive allocation donut: hover or focus a slice to see what it is, how many tokens and when they unlock. */
export function AllocationRing() {
  const reduced = useReducedMotion();
  const [key, setKey] = useState<string>(ALLOCATION[0].key);
  const active = ALLOCATION.find((a) => a.key === key) ?? ALLOCATION[0];
  const starts = ALLOCATION.map((_, i) => (ALLOCATION.slice(0, i).reduce((n, x) => n + x.pct, 0) / 100) * C);
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[220px_minmax(0,1fr)]">
      <div className="relative mx-auto size-[220px]">
        <svg viewBox="0 0 200 200" className="size-full -rotate-90" role="img" aria-label="Token allocation">
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="26" />
          {ALLOCATION.map((a, i) => {
            const len = (a.pct / 100) * C, start = starts[i];
            const isActive = a.key === key;
            return (
              <motion.circle key={a.key} cx="100" cy="100" r={R} fill="none" stroke={a.color} strokeLinecap="butt" tabIndex={0} aria-label={`${a.label}: ${a.pct}%`}
                strokeWidth={isActive ? 32 : 26} strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-start}
                initial={reduced ? false : { strokeDasharray: `0 ${C}` }} whileInView={{ strokeDasharray: `${Math.max(0, len - 2)} ${C}` }} viewport={{ once: true }} transition={{ duration: 0.9, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                style={{ cursor: "pointer", opacity: isActive ? 1 : 0.55, transition: "opacity 0.25s ease, stroke-width 0.25s ease", outline: "none" }}
                onMouseEnter={() => setKey(a.key)} onFocus={() => setKey(a.key)} onClick={() => setKey(a.key)} />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[38px] font-semibold leading-none tabular-nums text-white">{active.pct}<span className="text-[20px] text-white/50">%</span></p>
            <p className="mt-1 text-[12px] text-white/55">{compact((active.pct / 100) * TOTAL_SUPPLY)} {TOKEN_SYMBOL}</p>
          </div>
        </div>
      </div>
      <ul className="space-y-2" onMouseLeave={() => setKey(ALLOCATION[0].key)}>
        {ALLOCATION.map((a) => (
          <li key={a.key}>
            <button type="button" onMouseEnter={() => setKey(a.key)} onFocus={() => setKey(a.key)} onClick={() => setKey(a.key)} aria-pressed={a.key === key}
              className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors duration-200 ${a.key === key ? "border-white/25 bg-white/[0.06]" : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"}`}>
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5 text-[13.5px] font-semibold text-white"><i className="size-2.5 rounded-full" style={{ background: a.color }} />{a.label}</span>
                <span className="tabular-nums text-[13.5px] font-semibold" style={{ color: a.color }}>{a.pct}%</span>
              </span>
              {a.key === key && <span className="mt-1.5 block text-[12.5px] leading-5 text-white/55">{a.note}</span>}
              {a.key === key && a.key === "team" && <Vesting />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
