"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

const WelcomeOrb = dynamic(() => import("./WelcomeOrb"), { ssr: false });
const SEEN_KEY = "solcameo-welcome-v1";

const STEPS = [
  ["01", "Holders suggest"],
  ["02", "It plots the episodes"],
  ["03", "Videos go live"],
] as const;

/** One-time intro for new visitors. Shown once, dismissible with Esc, the backdrop or the close button. */
export function WelcomePopup() {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    let seen = false;
    try {
      seen = !!localStorage.getItem(SEEN_KEY);
    } catch {
      /* Storage blocked: show it, it just won't be remembered. */
    }
    if (seen) return;
    const timer = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(timer);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* Closing still works without storage. */
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const rise = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="welcome"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.3 }}
          onClick={close}
          className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-4 backdrop-blur-md"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
            initial={reduced ? false : { opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[520px] overflow-hidden rounded-[10px] border border-white/10 bg-[#0e1012] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-[4px] text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <X className="size-4" />
            </button>
            <div className="relative h-52">
              <WelcomeOrb />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0e1012] to-transparent" />
            </div>
            <div className="px-8 pb-8 pt-1">
              <motion.p {...rise(0.1)} className="text-xs font-medium tracking-[0.18em] text-zinc-500">
                SOLCAMEO
              </motion.p>
              <motion.h2
                {...rise(0.16)}
                id="welcome-title"
                className="mt-3 text-[28px] font-semibold leading-[1.15] tracking-tight text-white"
                style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", var(--font-inter), system-ui, sans-serif' }}
              >
                Launch an AI influencer.
                <br />
                <span className="text-zinc-500">Bid on the viral ones.</span>
              </motion.h2>
              <motion.p {...rise(0.22)} className="mt-4 max-w-[420px] text-[15px] leading-6 text-zinc-400">
                Your influencer turns what holders suggest into videos, then plots its own episodes. Back one early and
                watch the story unfold.
              </motion.p>
              <motion.ol {...rise(0.28)} className="mt-6 grid grid-cols-3 gap-3 border-t border-white/[0.08] pt-5">
                {STEPS.map(([n, label]) => (
                  <li key={n}>
                    <span className="text-[11px] tabular-nums text-zinc-600">{n}</span>
                    <p className="mt-1 text-[13px] leading-5 text-zinc-300">{label}</p>
                  </li>
                ))}
              </motion.ol>
              <motion.div {...rise(0.34)} className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href="/create"
                  onClick={close}
                  className="inline-flex h-11 items-center rounded-[6px] bg-white px-6 text-sm font-semibold text-black transition active:scale-[0.98] hover:bg-zinc-200"
                >
                  Launch an influencer
                </Link>
                <Link
                  href="/market"
                  onClick={close}
                  className="inline-flex h-11 items-center rounded-[6px] px-4 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  Explore the market
                </Link>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
