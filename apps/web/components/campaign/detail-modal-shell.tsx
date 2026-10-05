"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

/**
 * Overlay chrome for a campaign/reward detail opened via an intercepted route
 * (app/stage/@modal/...) — the /stage grid stays mounted behind it, and
 * closing (backdrop click, X, ESC, or back-nav) just goes back to /stage
 * instead of swapping the whole page. Card clicks feel like they "stay in
 * place" instead of a hard navigation.
 */
export function DetailModalShell({ children, hideClose = false }: { children: React.ReactNode; /** Content renders its own back/close controls. */ hideClose?: boolean }) {
  const router = useRouter();
  const still = useReducedMotion();
  const close = () => router.back();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: still ? 0 : 0.3, ease: "easeOut" }}
        className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-sm backdrop-saturate-150 sm:p-6"
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        role="dialog"
        aria-modal="true"
      >
        <motion.div
          initial={still ? false : { opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: still ? 0 : 10, scale: still ? 1 : 0.99 }}
          transition={{ duration: still ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative my-auto w-full max-w-[840px] overflow-hidden rounded-[22px] border border-white/10 bg-[#141414] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.06)]"
        >
          {!hideClose && <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute top-3 right-3 z-20 inline-flex size-8 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/80 backdrop-blur-md transition-colors hover:border-white/30 hover:bg-black/75 hover:text-white"
          >
            <X className="size-4" />
          </button>}
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
