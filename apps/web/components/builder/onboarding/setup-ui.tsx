"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Check, ChevronDown, Search } from "lucide-react";

/** Shared look for the guided setup: warm paper, near-black ink, one lime signal. */
export const INK = "#141413";
export const PAPER = "#F6F4F0";

const SPRING = { type: "spring", stiffness: 420, damping: 22 } as const;

/** Variants shared by Stagger children (cards, chips, tiles). */
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } },
};

/** Container that cascades its motion children in. */
export function Stagger({
  children, className = "", delay = 0.05, ...rest
}: { children: ReactNode; className?: string; delay?: number; role?: string; "aria-label"?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: delay } } }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Animated round check: pops in with a spring when selected. */
function CheckDot({ on, size = "size-5" }: { on: boolean; size?: string }) {
  return (
    <span className={`relative grid ${size} place-items-center rounded-full border transition-colors duration-200 ${on ? "border-[#141413] bg-[#141413]" : "border-black/25"}`} aria-hidden>
      <AnimatePresence>
        {on && (
          <motion.span initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={SPRING} className="grid place-items-center">
            <Check className="size-3 text-[#A3E635]" strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Selectable card with a round check, like a radio. */
export function OptionCard({
  selected, onClick, title, blurb, children, className = "", disabled = false,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  blurb?: string;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      variants={itemVariants}
      whileHover={disabled ? undefined : { y: -3 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={SPRING}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white/70 p-4 text-left transition-[border-color,box-shadow,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/60 ${
        selected
          ? "border-[#141413] bg-white shadow-[0_0_0_1px_#141413,0_14px_34px_-18px_rgba(20,20,19,0.5)]"
          : "border-black/10 hover:border-black/30 hover:bg-white"
      } ${disabled ? "opacity-50" : ""} ${className}`}
    >
      {selected && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#A3E635]/25 via-transparent to-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
      )}
      <span className="absolute right-3.5 top-3.5"><CheckDot on={selected} /></span>
      <span className="relative pr-7 text-[15px] font-semibold leading-tight text-[#141413]">{title}</span>
      {blurb && <span className="relative mt-1 pr-4 text-[13px] leading-snug text-[#141413]/55">{blurb}</span>}
      {children}
    </motion.button>
  );
}

/** Small toggle pill. */
export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.93 }}
      transition={SPRING}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/60 ${
        selected ? "border-[#141413] bg-[#141413] text-white" : "border-black/12 bg-white/70 text-[#141413]/75 hover:border-black/30 hover:bg-white"
      }`}
    >
      <AnimatePresence initial={false}>
        {selected && (
          <motion.span key="c" initial={{ width: 0, opacity: 0, scale: 0 }} animate={{ width: 12, opacity: 1, scale: 1 }} exit={{ width: 0, opacity: 0, scale: 0 }} transition={SPRING} className="grid place-items-center overflow-hidden">
            <Check className="size-3 shrink-0 text-[#A3E635]" strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
      {children}
    </motion.button>
  );
}

/** Searchable single-select dropdown. Keyboard: type to filter, Enter picks the
 *  first match, Esc closes. Closes on outside click. */
export function Select({
  value, onChange, options, placeholder = "Choose one", searchPlaceholder = "Search", label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  searchPlaceholder?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options;
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    const t = window.setTimeout(() => search.current?.focus(), 30);
    return () => { document.removeEventListener("mousedown", onDown); window.clearTimeout(t); };
  }, [open]);

  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-14 w-full items-center justify-between rounded-2xl border bg-white/80 px-5 text-left text-[16px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/60 ${
          open ? "border-[#141413]" : "border-black/12 hover:border-black/30"
        }`}
      >
        <span className={value ? "font-medium text-[#141413]" : "text-[#141413]/40"}>{value || placeholder}</span>
        <ChevronDown className={`size-4 text-[#141413]/50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          style={{ transformOrigin: "top" }}
          className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_24px_60px_-20px_rgba(20,20,19,0.35)]">
          <div className="flex items-center gap-2 border-b border-black/8 px-4">
            <Search className="size-4 text-[#141413]/40" />
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (filtered[0]) pick(filtered[0]); }
              }}
              placeholder={searchPlaceholder}
              className="h-12 w-full bg-transparent text-[14px] text-[#141413] outline-none placeholder:text-[#141413]/35"
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1.5">
            {filtered.length === 0 && <li className="px-5 py-3 text-[13px] text-[#141413]/45">No match</li>}
            {filtered.map((o) => (
              <li key={o} role="option" aria-selected={o === value}>
                <button
                  type="button"
                  onClick={() => pick(o)}
                  className={`flex w-full items-center justify-between px-5 py-2.5 text-left text-[14.5px] transition-colors hover:bg-[#141413]/5 ${
                    o === value ? "font-semibold text-[#141413]" : "text-[#141413]/80"
                  }`}
                >
                  {o}
                  {o === value && <Check className="size-4" />}
                </button>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
