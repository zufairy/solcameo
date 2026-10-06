"use client";
import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { APPLE_FONT } from "@/lib/format/appleNumber";

/**
 * A number that glides to each new value and tints green or red for a moment in the direction it moved, the way the
 * Stocks app does. Tabular digits keep it from jittering while it counts. The font is the system's San Francisco.
 */
export function LiveNumber({ value, format, className = "", flash = true }: { value: number; format: (n: number) => string; className?: string; flash?: boolean }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const from = useRef(value);

  useEffect(() => {
    if (from.current === value) return;
    const direction = value > from.current ? "up" : "down";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-shot tint tied to the value changing
    setDir(direction);
    const controls = animate(from.current, value, { duration: reduced ? 0 : 0.6, ease: [0.16, 1, 0.3, 1], onUpdate: (n) => { from.current = n; setShown(n); }, onComplete: () => { from.current = value; setShown(value); } });
    const timer = setTimeout(() => setDir(null), 1000);
    return () => { controls.stop(); clearTimeout(timer); };
  }, [value, reduced]);

  const tint = flash && dir ? (dir === "up" ? "!text-emerald-300" : "!text-rose-300") : "";
  return (
    <span aria-label={format(value)} className={`inline-block tabular-nums transition-colors duration-700 ${tint} ${className}`} style={{ fontFamily: APPLE_FONT, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.022em" }}>
      {format(shown)}
    </span>
  );
}
