"use client";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";

export type LaunchPhase = 0 | 1 | 2 | 3;

const PHASES = [
  { emoji: "💾", short: "Save", title: "Saving your character", hint: "Locking in your name, ticker and portrait." },
  { emoji: "📜", short: "Curve", title: "Approve the curve", hint: "Your wallet is opening. Tap Approve to lock in your launch settings." },
  { emoji: "🪙", short: "Token", title: "Create your token", hint: "One more approval in your wallet to mint your coin and open its market." },
  { emoji: "🚀", short: "Live", title: "Going live", hint: "Your coin is on-chain. Opening your market…" },
] as const;

const noop = () => () => {};
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

/** Full-screen darkened guide shown from the moment the user taps Launch until the coin is live. */
export function LaunchOverlay({ open, phase, status, error, onClose }: {
  open: boolean;
  phase: LaunchPhase;
  status?: string;
  error?: string | null;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const mounted = useMounted();
  if (!mounted) return null;
  const current = PHASES[phase];
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="launch-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Launching your coin"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.35 }}
          className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-black/90 p-5 backdrop-blur-md"
        >
          {!reduced && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 size-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(215,255,0,0.16),transparent_62%)]"
              animate={{ scale: [1, 1.18, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <div className="relative flex w-full max-w-md flex-col items-center text-center">
            <ol aria-label="Launch progress" className="mb-10 flex w-full items-center">
              {PHASES.map((item, index) => {
                const done = index < phase || (phase === 3 && index === 3 && !error);
                const active = index === phase && !done;
                return (
                  <li key={item.short} aria-current={active ? "step" : undefined} className="relative flex flex-1 flex-col items-center gap-2">
                    {index > 0 && (
                      <span aria-hidden className="absolute right-1/2 top-[15px] h-px w-full bg-white/15">
                        <motion.span className="absolute inset-y-0 left-0 bg-[#d7ff00]" initial={false} animate={{ width: index <= phase ? "100%" : "0%" }} transition={{ duration: reduced ? 0 : 0.6 }} />
                      </span>
                    )}
                    <motion.span
                      initial={false}
                      animate={{ scale: active ? 1.15 : 1 }}
                      className={`relative z-10 grid size-8 place-items-center rounded-full border text-xs font-bold transition-colors duration-500 ${done ? "border-[#d7ff00] bg-[#d7ff00] text-black" : active ? "border-[#d7ff00] bg-black text-[#d7ff00]" : "border-white/20 bg-black text-white/40"}`}
                    >
                      {active && !reduced && !error && <span aria-hidden className="absolute inset-0 animate-ping rounded-full border border-[#d7ff00]/50" />}
                      {done ? <Check className="size-4" strokeWidth={3} /> : index + 1}
                    </motion.span>
                    <span className={`text-[11px] font-semibold uppercase tracking-wider transition-colors duration-500 ${done || active ? "text-white" : "text-white/35"}`}>{item.short}</span>
                  </li>
                );
              })}
            </ol>

            <AnimatePresence mode="wait">
              <motion.div
                key={error ? "error" : phase}
                initial={reduced ? false : { opacity: 0, y: 24, scale: 0.94, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={reduced ? undefined : { opacity: 0, y: -16, filter: "blur(6px)" }}
                transition={{ duration: reduced ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col items-center"
              >
                <motion.span
                  aria-hidden
                  className="text-7xl leading-none"
                  animate={reduced || error ? undefined : { y: [0, -10, 0], rotate: phase === 3 ? [0, -8, 8, 0] : 0 }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                >
                  {error ? "⚠️" : current.emoji}
                </motion.span>
                <h2 className="mt-6 text-2xl font-semibold tracking-tight text-white">{error ? "Launch needs attention" : current.title}</h2>
                <p role="status" aria-live="polite" className="mt-3 max-w-sm text-[15px] leading-6 text-zinc-300">
                  {error ?? (status && phase > 0 ? status : current.hint)}
                </p>
              </motion.div>
            </AnimatePresence>

            {error ? (
              <>
                <p className="mt-4 text-xs text-zinc-500">Your progress is saved. You can resume right where you left off.</p>
                <button type="button" onClick={onClose} className="mt-6 h-11 rounded-none border-2 border-black bg-white px-6 text-sm font-black uppercase tracking-tight text-black shadow-[4px_4px_0_0_#d7ff00] transition-transform hover:-translate-y-0.5 active:translate-y-0.5">
                  Back to launch
                </button>
              </>
            ) : (
              <p className="mt-8 text-xs text-zinc-500">Keep this tab open · Step {phase + 1} of {PHASES.length}</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
