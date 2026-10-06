"use client";
import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, useVelocity } from "framer-motion";

/* Odometer-style rolling digits. Each digit is a strip of 0-9 twice over, translated by a motion value. A change
   always rolls FORWARD (7→2 goes 7,8,9,0,1,2 like a real odometer), eased with a long expo-out, with a
   velocity-driven blur while it spins. Columns stagger from the ones place. Digits are keyed from the RIGHT so
   existing columns keep their element when the number widens. */
const DIGIT_STRIP = Array.from({ length: 20 }, (_, i) => i % 10);
const ROLL_EASE = [0.16, 1, 0.3, 1] as const;

function FlipDigit({ digit, column }: { digit: number; column: number }) {
  const reduce = useReducedMotion();
  const pos = useMotionValue(0);
  const y = useTransform(pos, (v) => `${-v * 1.15}em`);
  const blur = useTransform(useVelocity(pos), (v) => `blur(${Math.min(Math.abs(v) * 0.09, 1.6).toFixed(2)}px)`);

  useEffect(() => {
    if (reduce) { pos.set(digit); return; }
    let from = pos.get() % 10;
    if (from < 0) from += 10;
    pos.set(from);
    const to = digit >= from ? digit : digit + 10;
    if (to === from) return;
    const controls = animate(pos, to, { duration: 0.9 + (to - from) * 0.045, ease: ROLL_EASE, delay: column * 0.05, onComplete: () => pos.set(digit) });
    return () => controls.stop();
  }, [digit, column, reduce, pos]);

  return (
    <motion.span
      aria-hidden
      className="relative inline-block h-[1.15em] overflow-hidden text-center"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: "0.62em", opacity: 1 }}
      transition={{ duration: 0.45, ease: ROLL_EASE }}
      style={{ maskImage: "linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)" }}
    >
      <motion.span className="absolute inset-x-0 top-0 flex flex-col will-change-transform" style={{ y, filter: blur }}>
        {DIGIT_STRIP.map((d, i) => <span key={i} className="block h-[1.15em] leading-[1.15em]">{d}</span>)}
      </motion.span>
    </motion.span>
  );
}

export function FlipCounter({ value, className = "" }: { value: string; className?: string }) {
  const chars = value.split("");
  return (
    <span className={`inline-flex items-start align-top leading-[1.15em] tabular-nums ${className}`}>
      <span className="sr-only">{value}</span>
      {chars.map((ch, i) => {
        const column = chars.length - 1 - i;
        const key = column + 1;
        return /\d/.test(ch)
          ? <FlipDigit key={key} digit={Number(ch)} column={column} />
          : <motion.span key={key} aria-hidden className="inline-block h-[1.15em] leading-[1.15em]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>{ch}</motion.span>;
      })}
    </span>
  );
}
