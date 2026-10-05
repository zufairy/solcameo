"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Globe, Loader2, Lock, ShieldCheck, X, CreditCard } from "lucide-react";
import { LoginModal } from "@/components/auth/login-modal";

/** "Start free, 3 videos on us" lead-magnet modal.
 *  Flow: website input (full-bleed UGC video background) → animated analyze
 *  checklist → straight into the register modal. No fake teaser renders: the
 *  goal here is the signup, not previewing videos that don't exist yet. The
 *  analyze call still fires (stores the lead for the admin Leads page) but
 *  is fire-and-forget — the UI never waits on it or blocks the handoff to
 *  registering on it succeeding. */

type Phase = "input" | "analyzing";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const ANALYZE_STEPS = [
  "Reading your website",
  "Understanding your business",
  "Finding your audience hooks",
  "Drafting three video concepts",
];

function looksLikeSite(v: string): boolean {
  const s = v.trim();
  if (!s || /\s/.test(s)) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.includes(".");
  } catch {
    return false;
  }
}

function hostOf(v: string): string {
  try {
    return new URL(/^https?:\/\//i.test(v) ? v.trim() : `https://${v.trim()}`).hostname;
  } catch {
    return v.trim();
  }
}

export function LeadMagnetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("input");
  const [site, setSite] = useState("");
  const [stepIdx, setStepIdx] = useState(0);
  const [loginOpen, setLoginOpen] = useState(false);
  // Reset state on reopen WITHOUT an effect: track the previous `open` and
  // reset synchronously during render on the closed→open transition.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPhase("input");
      setSite("");
      setStepIdx(0);
    }
  }

  // Cycle the checklist, then hand off straight to registering. Timer-driven,
  // not tied to the analyze call finishing — a slow or failed lead-capture
  // request must never block the path to signing up.
  useEffect(() => {
    if (phase !== "analyzing") return;
    const stepTimer = setInterval(() => setStepIdx((i) => Math.min(i + 1, ANALYZE_STEPS.length - 1)), 550);
    const handoffTimer = setTimeout(() => {
      setLoginOpen(true);
      onClose();
    }, 550 * ANALYZE_STEPS.length + 350);
    return () => { clearInterval(stepTimer); clearTimeout(handoffTimer); };
  }, [phase, onClose]);

  const analyze = () => {
    if (!looksLikeSite(site)) return;
    setPhase("analyzing");
    setStepIdx(0);
    // Fire-and-forget — stores the lead for the admin Leads page. The
    // checklist above never waits on this.
    void fetch("/api/leads/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: site.trim() }),
    }).catch(() => {});
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Solid dark scrim, NO backdrop-blur: the hero carousel keeps
            // painting video frames behind the modal, and a full-viewport
            // backdrop blur over live video re-blurs every frame (main-thread
            // freeze observed in testing).
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
            onClick={onClose}
          >
            <style>{`
              @keyframes leadSheen { 0% { transform: translateX(-140%) skewX(-16deg); } 100% { transform: translateX(340%) skewX(-16deg); } }
              @keyframes leadBar { 0% { width: 4%; } 90% { width: 96%; } 100% { width: 96%; } }
              @media (prefers-reduced-motion: reduce) { .lead-anim * { animation: none !important; } }
            `}</style>
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.35, ease: EASE_OUT }}
              onClick={(e) => e.stopPropagation()}
              className="lead-anim relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/12 bg-[#0b0b0d] shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_40px_120px_-30px_rgba(0,0,0,0.95),0_0_80px_-30px_rgba(163,230,53,0.25)]"
              role="dialog"
              aria-modal="true"
              aria-label="Get 3 free videos"
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 top-4 z-20 grid size-8 place-items-center rounded-lg bg-black/40 text-zinc-400 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <X className="size-4" />
              </button>

              {phase === "input" && (
                <div className="relative">
                  {/* Full-bleed UGC video, no frame around it — it fills the
                      whole top of the card the way the copy sits on top of
                      it, not next to it in a separate boxed-off strip. */}
                  <video
                    aria-hidden
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    className="absolute inset-0 h-full w-full object-cover"
                    src="/cofounder-bg.mp4"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0d] via-[#0b0b0d]/75 to-black/10" />
                  <div className="relative flex min-h-[480px] flex-col justify-end p-6 pt-10 sm:p-7 sm:pt-10">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-lime-300">
                      3 free videos, no card
                    </p>
                    <h3 className="mt-2.5 text-[24px] font-bold leading-tight text-white">
                      Drop your website. Get 3 videos back.
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-300">
                      Paste your link. We&apos;ll study your business and hand you three scroll-stopping videos, ready to post today.
                    </p>
                    <form
                      className="mt-5"
                      // noValidate + type="text": browsers' native url validation
                      // rejects the bare "yourbusiness.com" everyone actually
                      // types (looksLikeSite() handles normalization).
                      noValidate
                      onSubmit={(e) => { e.preventDefault(); analyze(); }}
                    >
                      {/* Glass input capsule — lit top edge, lime focus glow. */}
                      <label htmlFor="lead-site" className="sr-only">Your website</label>
                      <div className="flex h-12 items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.06] pl-4 pr-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] transition-[border-color,box-shadow] focus-within:border-lime-400/50 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_0_0_3px_rgba(163,230,53,0.15)]">
                        <Globe className="size-4 shrink-0 text-zinc-500" />
                        <input
                          id="lead-site"
                          value={site}
                          onChange={(e) => setSite(e.target.value)}
                          placeholder="yourbusiness.com"
                          autoFocus
                          type="text"
                          inputMode="url"
                          autoComplete="url"
                          spellCheck={false}
                          className="h-full w-full bg-transparent text-[14px] text-white outline-none placeholder:text-zinc-600"
                        />
                        <button
                          type="submit"
                          disabled={!looksLikeSite(site)}
                          className="relative h-9 shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-lime-400 to-lime-500 px-4 text-[13px] font-bold text-black shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_6px_20px_-6px_rgba(163,230,53,0.6)] outline-none transition-[filter,transform] hover:brightness-105 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-lime-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span aria-hidden className="pointer-events-none absolute inset-y-0 w-1/3 bg-white/30" style={{ animation: "leadSheen 3.2s ease-in-out infinite" }} />
                          Get my 3 videos
                        </button>
                      </div>
                    </form>
                    {/* Trust row — why it's safe to paste a link. */}
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-zinc-500">
                      <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-lime-400/80" /> We only read public pages</span>
                      <span className="flex items-center gap-1.5"><CreditCard className="size-3.5 text-lime-400/80" /> No card needed</span>
                      <span className="flex items-center gap-1.5"><Lock className="size-3.5 text-lime-400/80" /> No spam, ever</span>
                    </div>
                  </div>
                </div>
              )}

              {phase === "analyzing" && (
                <div className="p-6 sm:p-7">
                  {/* Site chip — favicon proves we're looking at THEIR site. */}
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(site))}&sz=64`}
                        alt=""
                        className="size-5"
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-white">{hostOf(site)}</p>
                      <p className="text-[11.5px] text-zinc-500">Building your video plan</p>
                    </div>
                    <Loader2 className="ml-auto size-4 shrink-0 animate-spin text-lime-400" />
                  </div>

                  {/* Progress bar */}
                  <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-lime-400 to-lime-300" style={{ animation: "leadBar 7s cubic-bezier(0.3,0.6,0.4,1) forwards" }} />
                  </div>

                  {/* Step checklist — done steps lock in with a check. */}
                  <ul className="mt-5 space-y-2.5">
                    {ANALYZE_STEPS.map((label, i) => {
                      const done = i < stepIdx;
                      const active = i === stepIdx;
                      return (
                        <li
                          key={label}
                          className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors duration-300 ${
                            active
                              ? "border-lime-400/25 bg-lime-400/[0.06]"
                              : "border-white/[0.07] bg-white/[0.03]"
                          }`}
                        >
                          <span
                            className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] ${
                              done
                                ? "bg-lime-400 text-black"
                                : active
                                  ? "border border-lime-400/50 text-lime-300"
                                  : "border border-white/15 text-zinc-600"
                            }`}
                          >
                            {done ? <Check className="size-3" /> : active ? <Loader2 className="size-3 animate-spin" /> : i + 1}
                          </span>
                          <span className={`text-[13px] ${done ? "text-zinc-500 line-through decoration-white/20" : active ? "font-medium text-white" : "text-zinc-500"}`}>
                            {label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>,
    document.body,
  );
}
