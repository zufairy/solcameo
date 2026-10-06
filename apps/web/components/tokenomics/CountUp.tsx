"use client";
import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

/** Smoothly tweens a number to its latest value. Plain tabular text, so it never shifts the layout. */
export function CountUp({ value, format, duration = 0.9, className }: { value: number; format: (n: number) => string; duration?: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(shown);
  useEffect(() => {
    const controls = animate(from.current, value, { duration: reduced ? 0 : duration, ease: [0.16, 1, 0.3, 1], onUpdate: (n) => { from.current = n; setShown(n); } });
    return () => controls.stop();
  }, [value, duration, reduced]);
  return <span className={`tabular-nums ${className ?? ""}`} aria-label={format(value)}>{format(shown)}</span>;
}
