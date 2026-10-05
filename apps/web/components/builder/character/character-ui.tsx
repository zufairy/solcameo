"use client";
/* eslint-disable @next/next/no-img-element -- previews are small static/R2 images */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { MODELS } from "@/lib/character/spec";
import type { ModelChoice } from "@/lib/character/types";

export const LIME = "#d7ff00";
/** Higgsfield studio surfaces. */
export const SURFACE = { panel: "#1b1c1e", section: "#26272a", inner: "#18191b", ring: "#2c2d31" } as const;
export const DISPLAY_FONT = "Anton, 'Bebas Neue', 'Arial Narrow', Impact, 'Helvetica Neue', sans-serif";
export const SPRING = { type: "spring", stiffness: 420, damping: 26 } as const;

export const MODEL_OPTIONS: { id: ModelChoice; label: string; blurb: string }[] = [
  ...MODELS.map((m) => ({ id: m.id as ModelChoice, label: m.label, blurb: m.blurb })),
  { id: "both", label: "Soul + Soul 2", blurb: "Generate with both, then pick your favourite" },
];

export const RATIOS = [
  { id: "3:4", label: "3:4", w: 12, h: 16 },
  { id: "4:5", label: "4:5", w: 12, h: 15 },
  { id: "1:1", label: "1:1", w: 14, h: 14 },
  { id: "9:16", label: "9:16", w: 10, h: 17 },
  { id: "16:9", label: "16:9", w: 18, h: 10 },
] as const;

export function Soon() {
  return <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-400">Soon</span>;
}

export function Section({ title, count, dot, icon, open, onToggle, children }: {
  title: string; count?: number; dot?: number; icon?: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[22px]" style={{ background: SURFACE.section }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-lime-300/60">
        <span className="flex items-center gap-2.5 text-[14px] font-medium text-zinc-400">
          {icon && <span className="grid size-5 place-items-center text-white">{icon}</span>}
          <span>{title}{count !== undefined && <span className="text-zinc-500"> · {count}</span>}</span>
        </span>
        <span className="flex items-center gap-2.5 text-zinc-400">
          <AnimatePresence>
            {!!dot && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={SPRING} className="grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold leading-5 text-black" style={{ background: LIME }}>{dot}</motion.span>
            )}
          </AnimatePresence>
          <ChevronDown className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }} className="overflow-hidden">
            <div className="mx-1.5 mb-1.5 rounded-[18px] p-1.5" style={{ background: SURFACE.inner }}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Image option tile: square, thick dark ring, lime ring when selected (Higgsfield style). */
export function Card({ label, image, selected, onClick, soon, showLabel, order = 0 }: {
  label: string; image?: string; selected?: boolean; onClick?: () => void; soon?: boolean; showLabel?: boolean; order?: number;
}) {
  return (
    <motion.button
      type="button" disabled={soon} onClick={onClick} aria-pressed={!!selected} aria-label={label} title={label}
      initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING, delay: Math.min(order, 12) * 0.022 }}
      whileHover={soon ? undefined : { y: -2, scale: 1.02 }} whileTap={soon ? undefined : { scale: 0.96 }}
      className="group relative aspect-square overflow-hidden rounded-[14px] border-[2.5px] bg-white text-left outline-none transition-[border-color,box-shadow] duration-200 focus-visible:border-lime-300"
      style={{ borderColor: selected ? LIME : SURFACE.ring, boxShadow: selected ? `0 0 0 1px ${LIME}55, 0 10px 28px -10px ${LIME}88` : undefined }}
    >
      {image && <img src={image} alt="" loading="lazy" decoding="async" className={`size-full object-cover transition-transform duration-500 group-hover:scale-[1.05] ${soon ? "opacity-45 saturate-50" : ""}`} />}
      {soon && <span className="absolute inset-0 bg-black/45" />}
      {(showLabel || soon) && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent pb-1 pt-5 text-center text-[12.5px] font-semibold" style={{ color: selected ? LIME : "#fff" }}>{soon ? "Soon" : label}</span>
      )}
      {!showLabel && !soon && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-center text-[10.5px] font-semibold leading-tight text-white transition-transform duration-200 group-hover:translate-y-0">{label}</span>
      )}
    </motion.button>
  );
}

export function Swatch({ label, color, selected, onClick }: { label: string; color: string; selected: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button" title={label} aria-label={label} aria-pressed={selected} onClick={onClick}
      whileHover={{ scale: 1.14, y: -2 }} whileTap={{ scale: 0.88 }} transition={SPRING}
      className={`grid size-7 place-items-center rounded-full outline-none ring-2 ring-offset-2 ring-offset-[#18191b] focus-visible:ring-lime-400/70 ${selected ? "ring-[#D4F53C]" : "ring-white/10"}`}
      style={{ background: color }}
    >
      <AnimatePresence>{selected && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check className="size-4 text-white mix-blend-difference" strokeWidth={3} /></motion.span>}</AnimatePresence>
    </motion.button>
  );
}

export function Pill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button" aria-pressed={selected} onClick={onClick} whileTap={{ scale: 0.94 }} whileHover={{ y: -1 }}
      className={`rounded-full border-2 px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${selected ? "text-black" : "border-[#2c2d31] bg-[#222326] text-zinc-300 hover:border-white/30"}`}
      style={selected ? { background: LIME, borderColor: LIME } : undefined}
    >
      {label}
    </motion.button>
  );
}

/** Small popover used by the model and aspect-ratio pickers. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return { open, setOpen, root };
}

export function ModelSelect({ value, onChange, disabled }: { value: ModelChoice; onChange: (v: ModelChoice) => void; disabled?: boolean }) {
  const { open, setOpen, root } = usePopover();
  const cur = MODEL_OPTIONS.find((m) => m.id === value)!;
  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label="Image model" onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-xl border border-white/12 bg-white/[0.05] px-3 text-left transition-colors hover:border-white/25 disabled:opacity-50">
        <span className="min-w-0"><span className="block text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Model</span><span className="block truncate text-[13px] font-semibold text-white">{cur.label}</span></span>
        <ChevronDown className={`size-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul role="listbox" initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.98 }} transition={{ duration: 0.16 }}
            className="absolute bottom-full left-0 z-30 mb-2 w-[300px] max-w-[85vw] overflow-hidden rounded-2xl border border-white/12 bg-[#0c0c0e] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
            {MODEL_OPTIONS.map((m) => (
              <li key={m.id} role="option" aria-selected={m.id === value}>
                <button type="button" onClick={() => { onChange(m.id); setOpen(false); }} className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]">
                  <span><span className="block text-[13.5px] font-semibold text-white">{m.label}</span><span className="block text-[12px] leading-snug text-zinc-500">{m.blurb}</span></span>
                  {m.id === value && <Check className="mt-0.5 size-4 shrink-0 text-lime-400" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function RatioSelect({ value, onChange, disabled, exclude = [] }: { value: string; onChange: (v: string) => void; disabled?: boolean; exclude?: string[] }) {
  const { open, setOpen, root } = usePopover();
  const cur = RATIOS.find((r) => r.id === value) ?? RATIOS[0];
  return (
    <div ref={root} className="relative">
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label="Aspect ratio" onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-3 transition-colors hover:border-white/25 disabled:opacity-50">
        <span className="rounded-[3px] border border-zinc-300/80" style={{ width: cur.w, height: cur.h }} />
        <span className="text-[13px] font-semibold text-white">{cur.label}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul role="listbox" initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.98 }} transition={{ duration: 0.16 }}
            className="absolute bottom-full left-0 z-30 mb-2 w-36 overflow-hidden rounded-2xl border border-white/12 bg-[#0c0c0e] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
            {RATIOS.filter(r => !exclude.includes(r.id)).map((r) => (
              <li key={r.id} role="option" aria-selected={r.id === value}>
                <button type="button" onClick={() => { onChange(r.id); setOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium text-white transition-colors hover:bg-white/[0.07]">
                  <span className="grid w-5 place-items-center"><span className="rounded-[3px] border border-zinc-300/80" style={{ width: r.w, height: r.h }} /></span>
                  <span className="flex-1">{r.label}</span>
                  {r.id === value && <Check className="size-4 text-lime-400" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 1 / 4 images per model, like Higgsfield's batch toggle. */
export function CountToggle({ value, onChange, disabled }: { value: 1 | 4; onChange: (v: 1 | 4) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Images per model" className="relative flex h-9 items-center rounded-xl border border-white/12 bg-white/[0.05] p-0.5">
      {([1, 4] as const).map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} disabled={disabled} onClick={() => onChange(n)}
          className={`relative z-10 h-full w-10 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 ${value === n ? "text-black" : "text-zinc-400 hover:text-white"}`}>
          {value === n && <motion.span layoutId="count-pill" transition={SPRING} className="absolute inset-0 -z-10 rounded-lg" style={{ background: LIME }} />}
          {n}x
        </button>
      ))}
    </div>
  );
}
