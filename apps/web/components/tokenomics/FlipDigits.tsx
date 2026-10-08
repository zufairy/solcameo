"use client";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Flip-clock digits, the way an old HTC weather clock drew them: each digit is a small card split along a hinge, and when the
 * number changes the top half folds down to reveal the new one. Only the changed digits move. Honours reduced motion.
 */
function Half({ digit, part }: { digit: string; part: "top" | "bottom" }) {
  return (
    <span className={`absolute inset-x-0 overflow-hidden ${part === "top" ? "top-0 h-1/2 rounded-t-[10px]" : "bottom-0 h-1/2 rounded-b-[10px]"}`} style={{ backfaceVisibility: "hidden" }}>
      <span className={`absolute inset-x-0 flex h-[200%] items-center justify-center ${part === "top" ? "top-0" : "-top-full"}`}>{digit}</span>
    </span>
  );
}

export function FlipDigit({ value, size = "lg" }: { value: string; size?: "sm" | "lg" }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const [prev, setPrev] = useState(value);
  const [flipping, setFlipping] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (value === last.current) return;
    const old = last.current;
    last.current = value;
    if (reduced) return; // no fold: the digit below simply shows the new value
    setPrev(old); setShown(value); setFlipping(true);
    const t = setTimeout(() => { setFlipping(false); setPrev(value); }, 620);
    return () => clearTimeout(t);
  }, [value, reduced]);
  const nowShown = reduced ? value : shown;
  const nowPrev = reduced ? value : prev;
  const dims = size === "lg" ? "h-[48px] w-[29px] text-[31px] min-[420px]:h-[56px] min-[420px]:w-[34px] min-[420px]:text-[36px] sm:h-[72px] sm:w-[46px] sm:text-[46px]" : "h-[40px] w-[30px] text-[26px] sm:h-[46px] sm:w-[34px] sm:text-[30px]";
  return (
    <span className={`relative inline-block ${dims} font-semibold leading-none tabular-nums text-[#f2f2ef] [perspective:420px]`} role="text" aria-label={value}>
      <span aria-hidden className="absolute inset-0 rounded-[10px] bg-gradient-to-b from-[#2b2e34] to-[#15171b] shadow-[0_8px_20px_-8px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.12)]" />
      {/* static halves: the new top, and the old bottom until the fold lands */}
      <Half digit={nowShown} part="top" />
      <Half digit={flipping ? nowPrev : nowShown} part="bottom" />
      {flipping && (
        <>
          <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 origin-bottom animate-[flip-top_0.31s_ease-in_forwards] bg-gradient-to-b from-[#2b2e34] to-[#202328]" style={{ borderRadius: "10px 10px 0 0", backfaceVisibility: "hidden" }}>
            <Half digit={prev} part="top" />
          </span>
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 origin-top animate-[flip-bottom_0.31s_0.31s_ease-out_both] bg-gradient-to-b from-[#1b1d21] to-[#15171b]" style={{ borderRadius: "0 0 10px 10px", backfaceVisibility: "hidden" }}>
            <Half digit={shown} part="bottom" />
          </span>
        </>
      )}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px -translate-y-1/2 bg-black/70 shadow-[0_1px_0_rgba(255,255,255,0.06)]" />
      <span aria-hidden className="pointer-events-none absolute -left-px top-1/2 z-10 size-[5px] -translate-y-1/2 rounded-full bg-black/70" />
      <span aria-hidden className="pointer-events-none absolute -right-px top-1/2 z-10 size-[5px] -translate-y-1/2 rounded-full bg-black/70" />
    </span>
  );
}

/** A row of flip digits for a whole number, left-padded to `min` digits and grouped with commas. */
export function FlipNumber({ value, min = 1, size = "lg", group = true }: { value: number; min?: number; size?: "sm" | "lg"; group?: boolean }) {
  const text = String(Math.max(0, Math.floor(value))).padStart(min, "0");
  const chars = [...text];
  return (
    <span className="inline-flex items-end gap-[4px] sm:gap-[6px]" role="text" aria-label={Math.floor(value).toLocaleString("en-US")}>
      {chars.map((ch, i) => {
        const fromRight = chars.length - 1 - i;
        return (
          <span key={i} className="inline-flex items-end gap-[4px] sm:gap-[6px]">
            <FlipDigit value={ch} size={size} />
            {group && fromRight > 0 && fromRight % 3 === 0 && <span aria-hidden className="mb-1 text-[22px] font-semibold leading-none text-white/30 sm:mb-2">,</span>}
          </span>
        );
      })}
    </span>
  );
}
