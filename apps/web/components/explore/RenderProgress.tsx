"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Wallet } from "lucide-react";

type Stage = "paying" | "rendering";
const CONFETTI = Array.from({ length: 14 }, (_, i) => ({ angle: (i / 14) * Math.PI * 2, dist: 44 + (i % 3) * 16, size: 4 + (i % 3) * 2 }));
const STEPS = ["Queued", "Rendering", "Finishing"];

/**
 * What the person sees after pressing Generate: the wallet being charged, a short "payment confirmed" celebration the
 * moment it lands, then a calm rendering animation with a clear note that the video will be waiting in My agents.
 */
export function RenderProgress({ stage, amount, agentName, poster, onClose }: { stage: Stage; amount?: string; agentName?: string; poster?: string; onClose?: () => void }) {
  const reduced = useReducedMotion();
  const [celebrate, setCelebrate] = useState(false);
  const [step, setStep] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const wasPaying = useRef(stage === "paying");

  useEffect(() => {
    if (stage === "paying") { wasPaying.current = true; return; }
    if (!wasPaying.current) return;
    wasPaying.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the payment-confirmed moment once, then move on
    setCelebrate(true);
    const timer = setTimeout(() => setCelebrate(false), 1700);
    return () => clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== "rendering" || celebrate) return;
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 7000);
    return () => clearInterval(timer);
  }, [stage, celebrate]);

  // Elapsed time, so waiting never feels frozen.
  useEffect(() => {
    if (stage !== "rendering") return;
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [stage]);

  const view = stage === "paying" ? "paying" : celebrate ? "paid" : "rendering";
  return (
    <div role="status" aria-live="polite" className="relative overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5">
      <AnimatePresence mode="wait" initial={false}>
        {view === "paying" && (
          <motion.div key="paying" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="flex items-center gap-4">
            <span className="relative grid size-12 shrink-0 place-items-center">
              {!reduced && <motion.span aria-hidden className="absolute inset-0 rounded-full border border-[#d7ff00]/50" animate={{ scale: [1, 1.5], opacity: [0.7, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }} />}
              <span className="grid size-11 place-items-center rounded-full border border-white/15 bg-white/10"><Wallet className="size-5 text-white" /></span>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Paying from {agentName ? `${agentName}'s` : "the agent"} wallet…</p>
              <p className="mt-0.5 text-xs text-zinc-400">{amount ? `${amount} is being charged.` : "Charging the render."} This takes a few seconds.</p>
            </div>
          </motion.div>
        )}

        {view === "paid" && (
          <motion.div key="paid" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex items-center gap-4">
            <span className="relative grid size-12 shrink-0 place-items-center">
              {!reduced && CONFETTI.map((c, i) => (
                <motion.span key={i} aria-hidden className="absolute rounded-full bg-[#d7ff00]" style={{ width: c.size, height: c.size }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }} animate={{ x: Math.cos(c.angle) * c.dist, y: Math.sin(c.angle) * c.dist, opacity: 0, scale: 0.4 }} transition={{ duration: 0.9, ease: "easeOut", delay: 0.12 }} />
              ))}
              <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }} className="grid size-11 place-items-center rounded-full bg-[#d7ff00] text-black">
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.1, ease: "easeOut" }} />
                </svg>
              </motion.span>
            </span>
            <div>
              <p className="text-sm font-semibold text-white">Payment confirmed</p>
              <p className="mt-0.5 text-xs text-zinc-400">{amount ? `${amount} paid` : "Paid"}. Starting your render…</p>
            </div>
          </motion.div>
        )}

        {view === "rendering" && (
          <motion.div key="rendering" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <div className="flex items-center gap-4">
              <span className="relative block h-28 w-[4.25rem] shrink-0 overflow-hidden rounded-xl border border-white/15 bg-black/60 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.9)]" aria-hidden>
                {poster ? (
                  // The reference's first frame "develops" from heavy blur to sharp while the render runs.
                  <motion.img src={poster} alt="" className="absolute inset-0 size-full object-cover" initial={{ filter: reduced ? "blur(4px)" : "blur(22px)", scale: 1.15 }} animate={{ filter: "blur(4px)", scale: 1 }} transition={{ duration: 150, ease: [0.22, 1, 0.36, 1] }} />
                ) : (
                  <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(215,255,0,0.25),transparent_60%)]" />
                )}
                {!reduced && <motion.span className="absolute inset-y-0 w-full bg-[linear-gradient(110deg,transparent_20%,rgba(215,255,0,0.4)_50%,transparent_80%)]" initial={{ x: "-100%" }} animate={{ x: "100%" }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }} />}
                <span className="absolute inset-x-2 bottom-2 flex h-6 items-end justify-between gap-0.5">
                  {[0, 1, 2, 3].map((i) => (
                    <motion.span key={i} className="w-1.5 rounded-sm bg-[#d7ff00]" style={{ height: reduced ? 14 : undefined }} animate={reduced ? undefined : { height: [6, 22, 10, 18, 6] }} transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
                  ))}
                </span>
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Your video is rendering <span className="ml-1 font-mono text-xs font-normal tabular-nums text-zinc-500">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span></p>
                <p className="mt-0.5 text-xs leading-5 text-zinc-400">It will be ready in a few minutes. You can close this window. Find it any time in your <Link href="/agents" className="font-semibold text-[#d7ff00] underline underline-offset-2">My agents</Link> page.</p>
              </div>
            </div>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <motion.span className="block h-full w-1/3 rounded-full bg-[#d7ff00]" animate={reduced ? undefined : { x: ["-100%", "300%"] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
            </div>
            <ol className="mt-3 flex items-center gap-3 text-[11px]">
              {STEPS.map((label, i) => (
                <li key={label} className={`flex items-center gap-1.5 ${i <= step ? "text-white" : "text-zinc-600"}`}>
                  <span className={`grid size-4 place-items-center rounded-full ${i < step ? "bg-[#d7ff00] text-black" : i === step ? "border border-[#d7ff00] text-[#d7ff00]" : "border border-white/15"}`}>
                    {i < step ? <Check className="size-2.5" strokeWidth={4} /> : <span className={`size-1 rounded-full ${i === step ? "animate-pulse bg-[#d7ff00]" : "bg-transparent"}`} />}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href="/agents" className="inline-flex h-9 items-center gap-1.5 rounded-[3px] bg-[#d7ff00] px-4 text-[13px] font-semibold text-black transition-colors hover:bg-[#e4ff59]">Open My agents <ArrowRight className="size-3.5" /></Link>
              {onClose && <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-[3px] border border-white/15 bg-white/[0.05] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/10">Close</button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The finished video fades and un-blurs into place once its first frame is ready. */
export function BlurRevealVideo({ src, poster, className = "" }: { src: string; poster?: string; className?: string }) {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, filter: "blur(24px)", scale: 1.03 }}
      animate={ready || reduced ? { opacity: 1, filter: "blur(0px)", scale: 1 } : { opacity: 0.55, filter: "blur(24px)", scale: 1.03 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      <video src={src} poster={poster} controls playsInline autoPlay muted loop preload="auto" onLoadedData={() => setReady(true)} className="max-h-72 w-full rounded-lg bg-black object-contain" />
    </motion.div>
  );
}
