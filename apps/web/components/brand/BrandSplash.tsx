"use client";
/* eslint-disable @next/next/no-img-element -- static brand mark */
import { motion, useReducedMotion } from "framer-motion";

/** Full-screen loading state: the white Cameo mark breathing on a soft glow, with a calm blur-in. */
export function BrandSplash({ label = "Loading", fullscreen = true }: { label?: string; fullscreen?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <div
      role="status"
      aria-label={label}
      className={`flex flex-col items-center justify-center gap-5 bg-[#08090a] ${fullscreen ? "h-screen" : "min-h-[70vh]"}`}
    >
      <motion.div
        className="relative grid size-20 place-items-center"
        initial={reduced ? false : { opacity: 0, filter: "blur(14px)", scale: 0.92 }}
        animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {!reduced && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-white/10 blur-2xl"
            animate={{ opacity: [0.35, 0.8, 0.35], scale: [0.9, 1.15, 0.9] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <motion.img
          src="/brand/solcameo-mark.png"
          alt=""
          className="relative size-14 object-contain brightness-0 invert"
          animate={reduced ? undefined : { opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
      <motion.p
        className="text-[12px] font-medium tracking-wide text-white/35"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        {label}
      </motion.p>
    </div>
  );
}

/** Wraps a page so it fades and un-blurs into place once it mounts (use after a splash or a login redirect). */
export function BlurReveal({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, filter: "blur(18px)", scale: 1.012 }}
      animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
      transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
