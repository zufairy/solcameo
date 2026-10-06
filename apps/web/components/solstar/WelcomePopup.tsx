"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

const SEEN_KEY = "solcameo-welcome-launch-v2";

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
            aria-describedby="welcome-description"
            initial={reduced ? false : { opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[calc(100dvh-32px)] w-full max-w-[600px] overflow-y-auto rounded-2xl border border-white/10 bg-[#101214] shadow-[0_32px_100px_-24px_rgba(0,0,0,0.85)]"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-black/35 text-white/80 backdrop-blur-md transition-colors hover:bg-black/55 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="size-4" />
            </button>
            <div className="overflow-hidden bg-black" style={{ aspectRatio: "1350 / 760" }}>
              <video
                src="https://pub-558d21b4a9744345b66a8b9e97b25be6.r2.dev/brand/launch/solcameo-launch-3e2c893ed527f48f.mp4"
                poster="/media/launch-video-poster.jpg"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                controls={false}
                disablePictureInPicture
                disableRemotePlayback
                aria-label="Solcameo launch video"
                className="block size-full object-contain"
              />
            </div>
            <div className="px-6 py-6 sm:px-8">
              <motion.h2
                {...rise(0.16)}
                id="welcome-title"
                className="text-[24px] font-semibold leading-[1.2] tracking-tight text-white sm:text-[28px]"
                style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", var(--font-inter), system-ui, sans-serif' }}
              >
                Launch an AI influencer.
                <br />
                <span className="text-zinc-500">Bid on the viral ones.</span>
              </motion.h2>
              <motion.p {...rise(0.22)} id="welcome-description" className="mt-3 text-sm leading-6 text-zinc-400">
                Create your influencer, shape its story, and discover what’s trending.
              </motion.p>
              <motion.div {...rise(0.34)} className="mt-5 flex flex-wrap items-center gap-2">
                <Link
                  href="/create"
                  onClick={close}
                  className="inline-flex h-10 items-center rounded-lg bg-[#d7ff00] px-5 text-sm font-semibold text-black transition active:scale-[0.98] hover:bg-[#e4ff59]"
                >
                  Launch an influencer
                </Link>
                <Link
                  href="/market"
                  onClick={close}
                  className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-white"
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
