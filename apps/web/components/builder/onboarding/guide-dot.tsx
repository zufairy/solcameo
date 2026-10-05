"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * The little guide that sits beside each step's eyebrow. A lime dot that bobs,
 * blinks, looks at your cursor, squash-and-stretches in from the side on each
 * new step and hops (with a smile) the moment the step is answered.
 */
export function GuideDot({ happy, dir, stepKey }: { happy: boolean; dir: number; stepKey: string }) {
  const reduce = useReducedMotion();
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (reduce) return;
    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      setLook({ x: Math.max(-1, Math.min(1, nx)) * 1.8, y: Math.max(-1, Math.min(1, ny)) * 1.4 });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduce]);

  return (
    <motion.span
      key={stepKey}
      aria-hidden
      className="relative inline-grid size-7 place-items-center"
      initial={reduce ? false : { x: dir * -46, opacity: 0, scaleX: 1.5, scaleY: 0.6 }}
      animate={{ x: 0, opacity: 1, scaleX: 1, scaleY: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 14, mass: 0.7 }}
    >
      {/* soft pulse ring */}
      {!reduce && (
        <motion.span
          className="absolute inset-0 rounded-full bg-[#A3E635]"
          animate={{ scale: [1, 1.9], opacity: [0.35, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <motion.svg
        viewBox="0 0 28 28"
        className="relative size-7 overflow-visible"
        animate={reduce ? undefined : happy ? { y: [0, -9, 0, -3, 0], scale: [1, 1.18, 0.92, 1.04, 1] } : { y: [0, -3, 0] }}
        transition={happy ? { duration: 0.7, ease: "easeOut" } : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        key={happy ? "happy" : "idle"}
      >
        <ellipse cx="14" cy="26" rx="6" ry="1.4" fill="#141413" opacity="0.12" />
        <circle cx="14" cy="14" r="11" fill="#A3E635" stroke="#141413" strokeWidth="1.6" />
        <ellipse cx="10" cy="9" rx="3.2" ry="1.7" fill="#fff" opacity="0.45" transform="rotate(-24 10 9)" />
        <g transform={`translate(${look.x} ${look.y})`}>
          <motion.g
            style={{ transformOrigin: "14px 12.5px" }}
            animate={reduce ? undefined : { scaleY: [1, 1, 1, 0.1, 1] }}
            transition={{ duration: 3.6, repeat: Infinity, times: [0, 0.9, 0.94, 0.97, 1] }}
          >
            <circle cx="10.2" cy="12.5" r="1.7" fill="#141413" />
            <circle cx="17.8" cy="12.5" r="1.7" fill="#141413" />
          </motion.g>
          {happy
            ? <path d="M9.6 16.4 Q14 21 18.4 16.4" fill="none" stroke="#141413" strokeWidth="1.6" strokeLinecap="round" />
            : <path d="M11.6 17.2 Q14 18.6 16.4 17.2" fill="none" stroke="#141413" strokeWidth="1.4" strokeLinecap="round" />}
        </g>
      </motion.svg>
    </motion.span>
  );
}
