"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";

type Stage = "paying" | "rendering";
const STEPS = ["Queued", "Rendering", "Finishing"];
const EASE = [0.22, 1, 0.36, 1] as const;
/** How long "Payment confirmed" stays up, so it is clear the agent paid before the render starts. */
export const PAID_DWELL_MS = 2600;
/** Every state slides up out of a blur into place, and slides away up and out. */
const SLIDE = {
  initial: { opacity: 0, y: 26, filter: "blur(10px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -18, filter: "blur(8px)" },
  transition: { duration: 0.55, ease: EASE },
} as const;

/** Slow-drifting colour fields behind the glass: lime, cyan and violet, blurred into one living gradient. */
const BLOBS = [
  { color: "rgba(215,255,0,0.55)", size: 220, x: ["-10%", "55%", "10%", "-10%"], y: ["-20%", "10%", "55%", "-20%"], duration: 14 },
  { color: "rgba(56,189,248,0.45)", size: 260, x: ["60%", "5%", "50%", "60%"], y: ["40%", "-10%", "20%", "40%"], duration: 17 },
  { color: "rgba(167,139,250,0.45)", size: 240, x: ["25%", "70%", "-5%", "25%"], y: ["60%", "35%", "-15%", "60%"], duration: 19 },
];

/** The glass surface the three states share: hairline border, frosted fill, a bright top edge and sharp corners. */
const GLASS = "relative overflow-hidden rounded-[3px] border border-white/[0.14] bg-white/[0.045] backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_28px_70px_-34px_rgba(0,0,0,0.95)]";

function GradientField({ reduced, intensity = 1 }: { reduced: boolean | null; intensity?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity: intensity }}>
      {BLOBS.map((b, i) => (
        <motion.span key={i} className="absolute rounded-full blur-[58px]" style={{ width: b.size, height: b.size, background: b.color, left: 0, top: 0 }}
          animate={reduced ? undefined : { left: b.x, top: b.y }} transition={{ duration: b.duration, repeat: Infinity, ease: "easeInOut" }} initial={{ left: b.x[0], top: b.y[0] }} />
      ))}
      {/* A fine grain and a vignette keep the gradient looking like frosted glass instead of a flat wash. */}
      <span className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,transparent_40%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}

/**
 * What the person sees after pressing Generate: the wallet being charged, a short "payment confirmed" moment the instant
 * it lands, then a calm glass-and-gradient rendering state with a clear note that the video will be waiting in My agents.
 */
export function RenderProgress({ stage, amount, agentName, onClose, payer = "agent", note }: { stage: Stage; amount?: string; agentName?: string; poster?: string; onClose?: () => void; /** Whose wallet pays: the agent's own, or the viewer's (someone else's influencer, or none). */ payer?: "agent" | "you"; /** The live step while paying: "Swapping SOL to USDC with Jupiter…", "Confirming on Solana…". */ note?: string }) {
  const reduced = useReducedMotion();
  const [celebrate, setCelebrate] = useState(false);
  const [step, setStep] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const wasPaying = useRef(stage === "paying");

  useEffect(() => {
    if (stage === "paying") { wasPaying.current = true; return; }
    if (!wasPaying.current) return;
    wasPaying.current = false;
    setCelebrate(true);
    const timer = setTimeout(() => setCelebrate(false), PAID_DWELL_MS);
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
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <motion.div role="status" aria-live="polite" className={GLASS} initial={reduced ? false : { opacity: 0, y: 32, filter: "blur(12px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.6, ease: EASE }}>
      <GradientField reduced={reduced} intensity={view === "rendering" ? 1 : 0.55} />
      <div className="relative">
        <AnimatePresence mode="wait" initial={false}>
          {view === "paying" && (
            <motion.div key="paying" {...SLIDE} className="flex items-center gap-4 p-5">
              <span className="relative grid size-11 shrink-0 place-items-center border border-white/25 bg-black/30 backdrop-blur-md" aria-hidden>
                {!reduced && <motion.span className="absolute -inset-px border border-[#d7ff00]" animate={{ opacity: [0.9, 0.1, 0.9] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />}
                <svg viewBox="0 0 24 24" className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="square"><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0V6a2 2 0 0 1 2-2h12M16 14h2" /></svg>
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold tracking-tight text-white">{payer === "you" ? "Paying from your wallet" : <>Paying from {agentName ? `${agentName}’s` : "the agent"} wallet</>}</p>
                <p className="mt-0.5 text-[12px] text-white/60">{note ? note : amount ? `${amount} on-chain · usually a few seconds` : "Settling on-chain · usually a few seconds"}</p>
              </div>
            </motion.div>
          )}

          {view === "paid" && (
            <motion.div key="paid" {...SLIDE} className="flex items-center gap-4 p-5">
              <motion.span initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} className="grid size-11 shrink-0 place-items-center bg-[#d7ff00] text-black shadow-[0_0_40px_-4px_rgba(215,255,0,0.7)]" aria-hidden>
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="square" strokeLinejoin="miter">
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.08, ease: "easeOut" }} />
                </svg>
              </motion.span>
              <div>
                <p className="text-[13.5px] font-semibold tracking-tight text-white">Payment confirmed</p>
                <p className="mt-0.5 text-[12px] text-white/60">{amount ? `${amount} paid` : "Paid"} · starting your render</p>
              </div>
            </motion.div>
          )}

          {view === "rendering" && (
            <motion.div key="rendering" {...SLIDE} className="p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-white/70">
                  <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping bg-[#d7ff00] opacity-70" /><span className="relative inline-flex size-1.5 bg-[#d7ff00]" /></span>
                  Rendering
                </p>
                <span className="border border-white/20 bg-black/25 px-2 py-0.5 font-mono text-[11px] tabular-nums text-white/80 backdrop-blur-md">{clock}</span>
              </div>

              <p className="mt-5 text-[19px] font-semibold leading-tight tracking-[-0.02em] text-white">Your video is being made</p>
              <p className="mt-1.5 max-w-[34ch] text-[12.5px] leading-5 text-white/65">
                It will be ready in a few minutes. Close this window any time and find it in your <Link href="/agents" className="font-semibold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">My agents</Link> page.
              </p>

              {/* A bright highlight travels the rail; the three pips below mark where the render is. */}
              <div className="mt-6 h-px w-full bg-white/15" aria-hidden>
                <motion.span className="block h-px w-1/4 bg-gradient-to-r from-transparent via-[#d7ff00] to-transparent" animate={reduced ? undefined : { x: ["-100%", "400%"] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} />
              </div>
              <ol className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                {STEPS.map((label, i) => (
                  <li key={label} className={`flex items-center gap-1.5 ${i <= step ? "text-white" : "text-white/35"}`}>
                    <span className={`grid size-3.5 place-items-center border ${i < step ? "border-[#d7ff00] bg-[#d7ff00] text-black" : i === step ? "border-[#d7ff00] text-[#d7ff00]" : "border-white/25"}`}>
                      {i < step ? <Check className="size-2.5" strokeWidth={4} /> : i === step ? <span className="size-1 animate-pulse bg-[#d7ff00]" /> : null}
                    </span>
                    {label}
                  </li>
                ))}
              </ol>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Link href="/agents" className="inline-flex h-9 items-center gap-1.5 bg-[#d7ff00] px-4 text-[12.5px] font-semibold text-black transition-colors hover:bg-[#e4ff59]">Open My agents <ArrowRight className="size-3.5" /></Link>
                {onClose && <button type="button" onClick={onClose} className="inline-flex h-9 items-center border border-white/20 bg-white/[0.06] px-4 text-[12.5px] font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/[0.12]">Close</button>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
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
      transition={{ duration: 0.7, ease: EASE }}
      className={className}
    >
      <video src={src} poster={poster} controls playsInline autoPlay muted loop preload="auto" onLoadedData={() => setReady(true)} className="max-h-72 w-full rounded-[3px] bg-black object-contain" />
    </motion.div>
  );
}

/**
 * The same states as a card that fills a video tile (the builder's Videos grid): glass over the drifting gradient, the
 * agent paying, a held "Payment confirmed", then the render. `elapsed` is whole seconds since the card appeared.
 */
export function CardProgress({ paid, prompt, elapsed }: { paid: boolean; prompt?: string; elapsed: number }) {
  const reduced = useReducedMotion();
  const [showPaid, setShowPaid] = useState(false);
  const seenPaid = useRef(paid);
  useEffect(() => {
    if (!paid || seenPaid.current) return;
    seenPaid.current = true;
    setShowPaid(true);
    const timer = setTimeout(() => setShowPaid(false), PAID_DWELL_MS);
    return () => clearTimeout(timer);
  }, [paid]);
  const view = !paid ? "paying" : showPaid ? "paid" : "rendering";
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <div role="status" aria-live="polite" className={`${GLASS} absolute inset-0`}>
      <GradientField reduced={reduced} intensity={view === "rendering" ? 1 : 0.6} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} {...SLIDE} className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
          {view === "paying" && (<>
            <span className="relative grid size-9 place-items-center border border-white/25 bg-black/30 backdrop-blur-md" aria-hidden>
              {!reduced && <motion.span className="absolute -inset-px border border-[#d7ff00]" animate={{ opacity: [0.9, 0.1, 0.9] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />}
              <svg viewBox="0 0 24 24" className="size-4 text-white" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="square"><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0V6a2 2 0 0 1 2-2h12M16 14h2" /></svg>
            </span>
            <p className="text-[12px] font-semibold text-white">Paying from the agent wallet</p>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/55">On-chain · a few seconds</p>
          </>)}
          {view === "paid" && (<>
            <motion.span initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} className="grid size-9 place-items-center bg-[#d7ff00] text-black shadow-[0_0_36px_-4px_rgba(215,255,0,0.7)]" aria-hidden>
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="square"><motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.1 }} /></svg>
            </motion.span>
            <p className="text-[12px] font-semibold text-white">Payment confirmed</p>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/55">Starting your render</p>
          </>)}
          {view === "rendering" && (<>
            <p className="flex items-center gap-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.22em] text-white/75">
              <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping bg-[#d7ff00] opacity-70" /><span className="relative inline-flex size-1.5 bg-[#d7ff00]" /></span>
              Rendering
            </p>
            <p className="text-[13px] font-semibold tracking-tight text-white">Your video is being made</p>
            <span className="border border-white/20 bg-black/25 px-2 py-0.5 font-mono text-[10.5px] tabular-nums text-white/80 backdrop-blur-md">{clock}</span>
            {prompt && <p className="line-clamp-2 max-w-[22ch] text-[10.5px] leading-4 text-white/55">{prompt}</p>}
          </>)}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
