"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const COPY: Record<"clip" | "agent", string> = {
  clip: "Click here to clip your first video",
  agent: "Click here to build your first agent",
};

type Rect = { top: number; left: number; width: number; height: number };

/**
 * Post-onboarding spotlight — darkens the page and rings the real shortcut
 * button the operator chose (AI Clipping / AI Influencer, tagged via
 * `data-tour-id` in ShortcutRow), with a callout pointing at it. Purely a
 * visual guide: the darkening layer is pointer-events-none so the actual
 * button underneath stays clickable exactly as before, and clicking ANYWHERE
 * (the real target or elsewhere) dismisses it — it never blocks the page.
 */
export function OnboardingTour({ target, onDismiss }: { target: "clip" | "agent" | null; onDismiss: () => void }) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!target) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${target}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    // Any click anywhere ends the guide — it's a nudge, not a gate. Capture
    // phase so it fires even though the underlying Link also handles the click.
    const onClick = () => onDismiss();
    window.addEventListener("click", onClick, true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [target, onDismiss]);

  if (typeof document === "undefined" || !target) return null;

  return createPortal(
    <AnimatePresence>
      {rect && (
        <motion.div
          key="tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="pointer-events-none fixed inset-0 z-[190]"
        >
          {/* Spotlight ring — its own box-shadow paints the darkened page
              around it; the hole is simply this element's transparent
              interior, so the real button beneath stays visible and clickable. */}
          <motion.div
            initial={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, opacity: 0 }}
            animate={{ top: rect.top - 8, left: rect.left - 8, width: rect.width + 16, height: rect.height + 16, opacity: 1 }}
            transition={{ duration: 0.45, ease: EASE_OUT }}
            className="absolute rounded-[22px] ring-2 ring-lime-400/70"
            style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.72), 0 0 30px rgba(163,230,53,0.35)" }}
          />
          <Callout target={target} rect={rect} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const CALLOUT_WIDTH = 210;
const VIEWPORT_PAD = 12;

function Callout({ target, rect }: { target: "clip" | "agent"; rect: Rect }) {
  const below = rect.top < window.innerHeight * 0.6;
  const top = below ? rect.top + rect.height + 22 : rect.top - 22;

  // The bubble's own left edge is clamped to stay on-screen — a target near
  // the left/right viewport edge would otherwise center a 210px bubble
  // straight off the side. Clamping shifts the BUBBLE, so the arrow (which
  // must still point at the actual target center, not the bubble's) gets an
  // explicit horizontal offset instead of relying on the shared centering
  // transform, otherwise a clamped bubble drags the arrow off-target with it.
  const idealLeft = rect.left + rect.width / 2;
  const clampedLeft = Math.min(
    Math.max(idealLeft, VIEWPORT_PAD + CALLOUT_WIDTH / 2),
    window.innerWidth - VIEWPORT_PAD - CALLOUT_WIDTH / 2,
  );
  const arrowOffset = idealLeft - clampedLeft;

  return (
    <motion.div
      initial={{ opacity: 0, y: below ? -6 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.15, ease: EASE_OUT }}
      className="absolute flex flex-col items-center gap-2 text-center"
      style={{
        left: clampedLeft,
        top,
        width: CALLOUT_WIDTH,
        transform: below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      {below && (
        <span
          className="size-2.5 border-l border-t border-lime-400/40 bg-[#101208]"
          style={{ transform: `translate(${arrowOffset}px, -4px) rotate(45deg)` }}
        />
      )}
      <span className="rounded-2xl border border-lime-400/40 bg-[#101208]/95 px-3.5 py-2.5 text-[12.5px] font-medium leading-snug text-white shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        {COPY[target]}
      </span>
      {!below && (
        <span
          className="size-2.5 border-b border-r border-lime-400/40 bg-[#101208]"
          style={{ transform: `translate(${arrowOffset}px, 4px) rotate(45deg)` }}
        />
      )}
    </motion.div>
  );
}
