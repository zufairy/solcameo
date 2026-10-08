"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink, Flame } from "lucide-react";
import { getTxExplorerUrl } from "@/lib/solana/network";
import { BUYBACK_SPLIT, REVENUE_SPLIT, TOKEN_SYMBOL, TOTAL_SUPPLY } from "@/lib/tokenomics/platformToken";
import { FlipDigit, FlipNumber } from "./FlipDigits";
import { usePlatformToken } from "./usePlatformToken";

const LIME = "#d7ff00";
const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));

/** Epochs close every Monday 00:00 UTC; that is when the buyback runs and the burn follows. */
function nextEpoch(now: number) {
  const d = new Date(now);
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add);
}
/** The current time, or null until the page has mounted, so the server and the first browser render agree. */
function useNow(ms: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t0 = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [ms]);
  return now;
}

/** Scales its content down (never up) so it always fits the width it is given: nine flip digits with commas are wider than a phone. */
function FitWidth({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });
  useEffect(() => {
    const o = outer.current, n = inner.current;
    if (!o || !n) return;
    const measure = () => { const scale = Math.min(1, o.clientWidth / Math.max(1, n.scrollWidth)); setFit({ scale, height: n.scrollHeight * scale }); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(o); ro.observe(n);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className={`w-full overflow-hidden ${className}`} style={{ height: fit.height || undefined }}>
      <div ref={inner} className="inline-block w-max origin-top-left" style={{ transform: `scale(${fit.scale})` }}>{children}</div>
    </div>
  );
}

function Unit({ value, label }: { value: number; label: string }) {
  const [a, b] = String(Math.min(99, value)).padStart(2, "0");
  return (
    <span className="flex flex-col items-center gap-1.5">
      <span className="inline-flex gap-[3px]"><FlipDigit value={a} size="sm" /><FlipDigit value={b} size="sm" /></span>
      <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-white/40">{label}</span>
    </span>
  );
}

/** The hero's right-hand side: a flip-clock counter of SOLCAMEO burned forever, read from the mint, with the countdown to the next burn. */
export function BurnFlipCard() {
  const reduced = useReducedMotion();
  const { data, error } = usePlatformToken();
  const now = useNow(1000);
  const launched = !!data?.launched;
  const burned = Math.floor(data?.burned ?? 0);
  const pct = Math.min(100, ((data?.burnedPct ?? 0)));
  const lastBurn = (data?.epochs ?? []).find((e) => e.burnSig);
  const left = now === null ? 0 : Math.max(0, nextEpoch(now) - now);
  const [just, setJust] = useState<number | null>(null);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!data) return;
    if (seen.current !== null && burned > seen.current) { const gained = burned - seen.current; setJust(gained); const t = setTimeout(() => setJust(null), 6000); seen.current = burned; return () => clearTimeout(t); }
    seen.current = burned;
  }, [burned, data]);

  return (
    <motion.aside initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="relative min-w-0" aria-label={`${TOKEN_SYMBOL} burned forever`}>
      <div aria-hidden className="pointer-events-none absolute -right-10 top-0 size-56 rounded-full bg-rose-500/[0.14] blur-[90px]" />
      <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="flex items-center gap-2.5 text-[13px] font-semibold tracking-[-0.01em] text-white">
          <motion.span animate={reduced ? undefined : { scale: [1, 1.14, 1], rotate: [0, -6, 4, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} className="grid size-8 place-items-center rounded-full bg-gradient-to-b from-rose-500 to-orange-500 shadow-[0_0_24px_-4px_rgba(251,113,133,0.8)]"><Flame className="size-4 text-white" /></motion.span>
          {TOKEN_SYMBOL} burned forever
        </p>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-white/55">
          <span className="relative flex size-1.5"><span className={`absolute inline-flex size-full rounded-full ${error ? "bg-amber-400" : "animate-ping bg-emerald-400/70"}`} /><span className={`relative size-1.5 rounded-full ${error ? "bg-amber-400" : "bg-emerald-400"}`} /></span>
          {error ? "Reconnecting" : launched ? "Read from the mint" : data ? "Counter ready" : "Reading chain"}
        </span>
      </div>

      <FitWidth className="relative mt-5"><FlipNumber value={burned} min={9} /></FitWidth>

      <div className="relative mt-4 h-1 overflow-hidden rounded-full bg-white/[0.09]" role="progressbar" aria-valuenow={Number(pct.toFixed(4))} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the initial supply burned">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-rose-500 via-orange-400 to-amber-300" initial={{ width: 0 }} animate={{ width: `${Math.max(pct, burned > 0 ? 0.6 : 0)}%` }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} />
      </div>
      <p className="relative mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-white/50">
        <span><b className="tabular-nums text-white">{pct.toFixed(pct < 1 ? 3 : 2)}%</b> of the {compact(TOTAL_SUPPLY)} supply</span>
        <AnimatePresence>
          {just ? <motion.span key="just" initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200">+{compact(just)} just burned</motion.span> : null}
        </AnimatePresence>
      </p>

      <div className="relative mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[12px] font-medium text-white/55">Next buyback and burn</p>
          <div className="mt-2 flex items-end gap-2 sm:gap-2.5">
            <Unit value={Math.floor(left / 86_400_000)} label="Days" />
            <span aria-hidden className="mb-6 text-lg text-white/25">:</span>
            <Unit value={Math.floor((left / 3_600_000) % 24)} label="Hours" />
            <span aria-hidden className="mb-6 text-lg text-white/25">:</span>
            <Unit value={Math.floor((left / 60_000) % 60)} label="Min" />
            <span aria-hidden className="mb-6 text-lg text-white/25">:</span>
            <Unit value={Math.floor((left / 1000) % 60)} label="Sec" />
          </div>
        </div>
        <p className="max-w-[17rem] text-[12px] leading-5 text-white/50">
          Every Monday {REVENUE_SPLIT.buybackBps / 100}% of the week&apos;s revenue buys {TOKEN_SYMBOL}. <span style={{ color: LIME }}>{BUYBACK_SPLIT.burnBps / 100}% of what is bought is burned</span>, the rest funds holder rewards.
        </p>
      </div>
      {lastBurn?.burnSig && (
        <a href={getTxExplorerUrl(lastBurn.burnSig)} target="_blank" rel="noreferrer" className="relative mt-3 inline-flex items-center gap-1.5 text-[12px] text-white/55 transition-colors hover:text-white">
          Last burn: <b className="tabular-nums text-rose-300">{compact(Number(lastBurn.burnTokens ?? 0))}</b> tokens <ExternalLink className="size-3" />
        </a>
      )}
      {!launched && data && <p className="relative mt-3 text-[11.5px] leading-5 text-white/45">{TOKEN_SYMBOL} is not on-chain yet, so the counter waits at zero. The moment the first burn lands, it counts up here.</p>}
    </motion.aside>
  );
}
