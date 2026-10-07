"use client";
import type { CSSProperties, ReactNode } from "react";
import { Check, ChevronDown, Loader2, Wand2 } from "lucide-react";
import { formatRetailUsd } from "@/lib/pricing/retail";

/** One page background for Photo, Video and Carousel, so the three tabs and the switch above them never show a seam. */
export const GEN_PAGE_BG: CSSProperties = {
  background:
    "radial-gradient(120% 70% at 12% -10%, rgba(163,230,53,0.075), transparent 55%), " +
    "radial-gradient(90% 60% at 105% 8%, rgba(255,255,255,0.035), transparent 55%), #08090a",
  fontFamily: "var(--font-geist-sans, system-ui)",
};

/** Prompt panel shared by every generator: sharp corners, hairline border, deep surface. */
export const PANEL =
  "rounded-[10px] border border-white/[0.09] bg-[#101113]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl";

/** Raised "key" chip. The look the Video tab already had, now used everywhere. */
export const CHIP =
  "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-gradient-to-b from-white/[0.10] to-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_1px_3px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-150 hover:from-white/[0.15] hover:to-white/[0.05] active:translate-y-px active:shadow-[inset_0_1px_1px_rgba(0,0,0,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090a] disabled:cursor-not-allowed disabled:opacity-40";

export function ChipSelect({ value, onChange, options, title, className = "" }: {
  value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; title?: string; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} title={title} aria-label={title}
        className={`${CHIP} w-full cursor-pointer appearance-none pr-6`}>
        {options.map((o) => <option key={o.value} value={o.value} className="bg-[#141310] text-zinc-200">{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-zinc-500" />
    </div>
  );
}

export function ChipCheck({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <label title={title} className={`${CHIP} cursor-pointer`}>
      <span className={`relative flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${checked ? "border-lime-400/70 bg-lime-400/90 shadow-[0_0_0_2px_rgba(163,230,53,0.15)]" : "border-white/20 bg-black/30"}`}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        {checked && <Check className="size-2.5 text-black" strokeWidth={3} />}
      </span>
      {label}
    </label>
  );
}

/** Chunky lime Generate button that always shows what the click will cost. */
export function PriceButton({ onClick, disabled, busy, priceUsd, priceText, pending = 0, label = "Generate", icon, className = "", title }: {
  onClick: () => void; disabled?: boolean; busy?: boolean; priceUsd: number | null; priceText?: string; pending?: number; label?: string; icon?: ReactNode; className?: string; title?: string;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title}
      className={`relative inline-flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg bg-[#D4F53C] px-3 text-[12px] font-semibold tracking-tight text-black shadow-[0_6px_18px_-8px_rgba(212,245,60,0.6)] ring-1 ring-inset ring-black/10 transition-all hover:bg-[#dcf75a] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
      {busy ? <Loader2 className="size-3 animate-spin" /> : icon ?? <Wand2 className="size-3" />}
      {label}
      {(priceText || priceUsd !== null) && <span className="rounded-[5px] bg-black/[0.12] px-1.5 py-px text-[11px] font-semibold tabular-nums">{priceText ?? formatRetailUsd(priceUsd as number)}</span>}
      {pending > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] font-bold text-black"><Loader2 className="size-2.5 animate-spin" /> {pending}</span>
      )}
    </button>
  );
}

/** Headline for the results area of Photo, Video and Carousel: display type, a clear gap, then a one-line description. */
export function ResultHeading({ title, description, action, className = "" }: { title: string; description: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-[26px] font-black uppercase leading-none tracking-[-0.01em] text-white" style={{ fontFamily: "Anton, 'Bebas Neue', Impact, sans-serif" }}>{title}</h3>
        <p className="mt-2.5 max-w-[640px] text-[11.5px] leading-relaxed text-zinc-500">{description}</p>
      </div>
      {action}
    </div>
  );
}
