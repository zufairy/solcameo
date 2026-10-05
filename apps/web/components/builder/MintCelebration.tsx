"use client";

import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface MintCelebrationProps {
  active: boolean;
  durationMs?: number;
  /** Center badge text. Defaults to the mint celebration; pass e.g.
   *  "VIDEO GENERATING ✦" to reuse the same burst + chime for other events. */
  label?: string;
}

// Plays a short major-chord arpeggio using Web Audio API — no asset needed.
export function playCelebrationChime() {
  if (typeof window === "undefined") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioCtx = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // C5 → E5 → G5 → C6 — bright major arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.08;
      const peak = 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.6);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 1200);
  } catch {
    /* audio not allowed — silent fail */
  }
}

const PARTICLE_COUNT = 80;
const COLORS = ["#10b981", "#a3e635", "#22d3ee", "#f59e0b", "#a78bfa", "#ec4899", "#ffffff"];

interface Particle {
  id: number;
  x: number;       // horizontal velocity component
  y: number;       // vertical velocity component
  color: string;
  size: number;
  rotate: number;
  delay: number;
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 240 + Math.random() * 380;
    return {
      id: i,
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed - 120, // bias upward
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 5 + Math.random() * 7,
      rotate: Math.random() * 720 - 360,
      delay: Math.random() * 0.15,
    };
  });
}

export default function MintCelebration({ active, durationMs = 2600, label = "MINTED ✦ ON SOLANA" }: MintCelebrationProps) {
  const particles = useMemo(() => (active ? makeParticles() : []), [active]);

  useEffect(() => {
    if (active) playCelebrationChime();
  }, [active]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="celebration-overlay"
          initial={{ opacity: 1, filter: "blur(0px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 1.04, filter: "blur(18px)" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed inset-0 z-[100] overflow-hidden"
          aria-hidden
        >
          {/* Center burst origin */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            {particles.map((p) => (
              <motion.div
                key={p.id}
                className="absolute rounded-sm shadow-[0_0_8px_currentColor]"
                style={{
                  background: p.color,
                  color: p.color,
                  width: p.size,
                  height: p.size * (0.4 + Math.random() * 0.8),
                  left: 0,
                  top: 0,
                }}
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
                animate={{
                  x: p.x,
                  y: p.y + 300, // gravity drag-down
                  opacity: 0,
                  rotate: p.rotate,
                  scale: 1,
                }}
                transition={{
                  duration: durationMs / 1000,
                  delay: p.delay,
                  ease: [0.16, 0.84, 0.44, 1],
                }}
              />
            ))}
          </div>

          {/* Central pulse ring */}
          <motion.div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-400/60"
            initial={{ width: 40, height: 40, opacity: 0.8 }}
            animate={{ width: 480, height: 480, opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
          <motion.div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-lime-300/40"
            initial={{ width: 40, height: 40, opacity: 0.6 }}
            animate={{ width: 720, height: 720, opacity: 0 }}
            transition={{ duration: 1.8, ease: "easeOut", delay: 0.15 }}
          />

          {/* "MINTED!" badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 240, damping: 18, delay: 0.05 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <div className="px-6 py-3 rounded-2xl bg-gradient-to-br from-emerald-400 via-lime-400 to-emerald-500 shadow-[0_0_60px_rgba(16,185,129,0.6)] border border-white/40">
              <span className="text-[20px] font-black text-zinc-950 tracking-tight">{label}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
