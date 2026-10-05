"use client";

import { createContext, useContext, type ReactNode } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import velloLogo from "@/assets/logoblack.png";
import { GuideDot } from "@/components/builder/onboarding/guide-dot";

/** Shared look for the campaign wizard: the builder onboarding's warm paper + ink. */
export const EASE = [0.32, 0.72, 0, 1] as const;

export const cInput =
  "h-14 w-full rounded-2xl border border-black/12 bg-white/80 px-5 text-[16px] text-[#141413] outline-none transition-colors placeholder:text-[#141413]/35 focus:border-[#141413]";
export const cInputBig =
  "h-16 w-full rounded-2xl border border-black/12 bg-white/80 px-5 text-[22px] font-medium tracking-tight text-[#141413] outline-none transition-colors placeholder:text-[#141413]/30 focus:border-[#141413]";
export const cTextarea =
  "w-full resize-none rounded-2xl border border-black/12 bg-white/80 px-5 py-4 text-[15px] leading-relaxed text-[#141413] outline-none transition-colors placeholder:text-[#141413]/35 focus:border-[#141413]";
export const cLabel = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#141413]/45";

const GuideCtx = createContext<{ happy: boolean; dir: number; stepKey: string }>({ happy: false, dir: 1, stepKey: "" });
export const GuideProvider = GuideCtx.Provider;

/** Step shell: eyebrow with the guide dot, headline, helper line, body. */
export function StepFrame({ eyebrow, title, hint, children }: { eyebrow: string; title: string; hint?: string; children: ReactNode }) {
  const g = useContext(GuideCtx);
  return (
    <div>
      <p className="flex items-center gap-2.5 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#141413]/60">
        <GuideDot happy={g.happy} dir={g.dir} stepKey={g.stepKey} />
        {eyebrow}
      </p>
      <motion.h1
        initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.5, ease: EASE, delay: 0.05 }}
        className="mt-3 text-balance text-[clamp(30px,4.6vw,48px)] font-semibold leading-[1.05] tracking-[-0.035em] text-[#141413]"
      >
        {title}
      </motion.h1>
      {hint && (
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: 0.14 }} className="mt-3 max-w-[580px] text-pretty text-[16px] leading-relaxed text-[#141413]/60">
          {hint}
        </motion.p>
      )}
      <div className="mt-8">{children}</div>
    </div>
  );
}

/** Labelled field: label above, error or hint below. */
export function CField({ label, htmlFor, hint, error, children }: { label: string; htmlFor?: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className={cLabel}>{label}</label>
      {children}
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p key="e" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[13px] text-red-600">{error}</motion.p>
        ) : hint ? (
          <motion.p key="h" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[13px] leading-relaxed text-[#141413]/45">{hint}</motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Soft inline notice (info / warn / error) on paper. */
export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  const cls = tone === "error" ? "border-red-300 bg-red-50 text-red-800" : tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-black/10 bg-white/70 text-[#141413]/75";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className={`rounded-2xl border px-4 py-3 text-[14px] leading-relaxed ${cls}`}>
      {children}
    </motion.div>
  );
}

export interface WizardShellProps {
  labels: string[];
  stepIdx: number;
  maxReached: number;
  dir: number;
  stepKey: string;
  happy: boolean;
  onJump: (i: number) => void;
  onClose: () => void;
  locked?: boolean;
  children: ReactNode;
  /** Right side of the header (e.g. restart). */
  headerExtra?: ReactNode;
}

/** Full-screen paper shell: header, step rail (desktop) / bar (mobile), animated main column. */
export function WizardShell({ labels, stepIdx, maxReached, dir, stepKey, happy, onJump, onClose, locked, children, headerExtra }: WizardShellProps) {
  const reduce = useReducedMotion();
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#F6F4F0] text-[#141413] [scrollbar-gutter:stable]">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-[#F6F4F0]/85 px-5 py-4 backdrop-blur-md sm:px-8">
        <div className="flex items-center gap-3">
          <Image src={velloLogo} alt="Vello" className="h-8 w-auto mix-blend-multiply" priority />
          <span className="hidden text-[12px] font-semibold uppercase tracking-[0.2em] text-[#141413]/45 sm:inline">Campaign</span>
        </div>
        <div className="flex items-center gap-2">
          {headerExtra}
          <button type="button" onClick={onClose} disabled={locked} aria-label="Close and go back to the stage" className="inline-flex items-center gap-1.5 rounded-full bg-black/6 px-3.5 py-2 text-[12px] font-bold uppercase tracking-[0.1em] text-[#141413] transition-colors hover:bg-black/10 disabled:opacity-40">
            <X className="size-3.5" /> Close
          </button>
        </div>
      </header>

      <nav aria-label="Campaign progress" className="fixed left-8 top-1/2 z-10 hidden -translate-y-1/2 lg:block">
        <ol className="relative flex flex-col gap-[18px]">
          <span className="absolute bottom-2 left-[5px] top-2 w-px bg-black/12" aria-hidden />
          <motion.span
            className="absolute left-[5px] top-2 w-px bg-[#141413]"
            initial={false}
            animate={{ height: `${labels.length > 1 ? (stepIdx / (labels.length - 1)) * 100 : 0}%` }}
            style={{ maxHeight: "calc(100% - 16px)" }}
            transition={{ duration: 0.4, ease: EASE }}
            aria-hidden
          />
          {labels.map((l, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            const reachable = i <= maxReached && !locked;
            return (
              <li key={l} aria-current={active ? "step" : undefined} className="relative">
                <button type="button" disabled={!reachable} onClick={() => reachable && onJump(i)} className="flex items-center gap-3.5 disabled:cursor-default">
                  <span className={`relative z-10 size-[11px] rounded-full border-2 transition-all duration-300 ${active ? "border-[#141413] bg-[#A3E635] shadow-[0_0_0_4px_rgba(163,230,53,0.3)]" : done ? "border-[#141413] bg-[#141413]" : "border-black/20 bg-[#F6F4F0]"}`} />
                  <span className={`text-[11.5px] font-semibold tracking-[0.12em] transition-colors ${active ? "text-[#141413]" : done ? "text-[#141413]/65 hover:text-[#141413]" : "text-[#141413]/35"}`}>{l}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="px-5 sm:px-8 lg:hidden" aria-hidden>
        <div className="flex gap-1.5">
          {labels.map((l, i) => <span key={l} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= stepIdx ? "bg-[#141413]" : "bg-black/12"}`} />)}
        </div>
        <p className="mt-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#141413]/45">Step {stepIdx + 1} of {labels.length} · {labels[stepIdx]}</p>
      </div>

      <main className="mx-auto w-full max-w-[760px] px-5 pb-24 pt-8 sm:px-8 sm:pt-14 lg:pl-16">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={stepKey}
            custom={dir}
            initial={reduce ? false : { opacity: 0, x: dir * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -28 }}
            transition={{ duration: 0.32, ease: EASE }}
          >
            <GuideProvider value={{ happy, dir, stepKey }}>{children}</GuideProvider>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

/** Back / primary buttons row. `primary` renders the main action. */
export function NavRow({
  canBack, onBack, backDisabled, primaryLabel, onPrimary, primaryDisabled, busy, type = "button", icon, hint,
}: {
  canBack: boolean; onBack: () => void; backDisabled?: boolean;
  primaryLabel: string; onPrimary?: () => void; primaryDisabled?: boolean; busy?: boolean;
  type?: "button" | "submit"; icon?: ReactNode; hint?: string;
}) {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-3">
      {canBack && (
        <button type="button" onClick={onBack} disabled={backDisabled} className="inline-flex h-14 items-center gap-1.5 rounded-2xl bg-black/6 px-6 text-[15px] font-semibold text-[#141413] transition-colors hover:bg-black/10 disabled:opacity-50">
          <ChevronLeft className="size-4" /> Back
        </button>
      )}
      <button
        type={type}
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="group inline-flex h-14 items-center gap-2.5 rounded-2xl bg-[#141413] pl-7 pr-5 text-[15px] font-semibold text-white transition-all hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#141413]/25 disabled:text-white/70"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {primaryLabel}
        <motion.span className="grid" animate={!primaryDisabled && !busy ? { x: [0, 4, 0] } : { x: 0 }} transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 1.2 }}>
          {icon ?? <ChevronRight className="size-4 text-[#A3E635]" />}
        </motion.span>
      </button>
      {hint && <span className="text-[13px] text-[#141413]/40">{hint}</span>}
    </div>
  );
}

/** Centered paper screen (connect gate, sign-in) without the step rail. */
export function PaperScreen({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#F6F4F0] text-[#141413]">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Image src={velloLogo} alt="Vello" className="h-8 w-auto mix-blend-multiply" priority />
        {onClose && (
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-full bg-black/6 px-3.5 py-2 text-[12px] font-bold uppercase tracking-[0.1em] hover:bg-black/10">
            <X className="size-3.5" /> Close
          </button>
        )}
      </header>
      <main className="mx-auto grid min-h-[70vh] w-full max-w-[560px] place-items-center px-5 pb-16">{children}</main>
    </div>
  );
}

/** Dismissible coach bubble: a pulsing lime dot and a short, friendly tip. */
export function CoachTip({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 26, delay: 0.25 }}
      className="mb-6 flex items-start gap-3 rounded-2xl border border-[#84CC16]/40 bg-[#A3E635]/15 px-4 py-3 text-[14px] leading-relaxed text-[#2f4a05]"
      role="note"
    >
      <span className="relative mt-1.5 grid size-2.5 shrink-0 place-items-center" aria-hidden>
        <motion.span className="absolute inset-0 rounded-full bg-[#84CC16]" animate={{ scale: [1, 2.2], opacity: [0.5, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />
        <span className="relative size-2.5 rounded-full bg-[#4d7c0f]" />
      </span>
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss tip" className="-mr-1 grid size-6 shrink-0 place-items-center rounded-full text-[#2f4a05]/60 hover:bg-black/5 hover:text-[#2f4a05]">
          <X className="size-3.5" />
        </button>
      )}
    </motion.div>
  );
}
