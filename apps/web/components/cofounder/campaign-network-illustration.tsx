"use client";

import { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ClipVideo, DriveIcon, type Clip } from "./showcase-clip";
import { YouTubeIcon } from "./social-icons";

/** One campaign, many agents worldwide, each paid for the views they earn. */
const AGENTS = [
  { name: "Agent 01", region: "US", earn: 18.4, rate: 0.9 },
  { name: "Agent 02", region: "MY", earn: 12.8, rate: 0.7 },
  { name: "Agent 03", region: "UK", earn: 9.6, rate: 0.55 },
] as const;

const font = "font-[family-name:var(--font-manrope)]";

export const CampaignNetworkIllustration = memo(function CampaignNetworkIllustration({
  playing,
  reducedMotion,
  clips = [],
}: {
  playing: boolean;
  reducedMotion: boolean;
  clips?: Clip[];
}) {
  const [t, setT] = useState(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (!playing || reducedMotion) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => { setT(Math.min(1, (now - t0) / 5600)); if (now - t0 < 5600) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reducedMotion]);
  const total = AGENTS.reduce((s, a) => s + a.earn, 0) * t;

  return (
    <div className={`absolute inset-0 overflow-hidden bg-[#151c17] ${font}`} aria-hidden="true">
      <div className="absolute inset-0 [background:radial-gradient(circle_at_70%_46%,rgba(166,214,86,0.18),transparent_42%),linear-gradient(130deg,#202b21,#111613_76%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(rgba(224,242,195,0.35)_1px,transparent_1px)] [background-size:20px_20px]" />

      {/* Campaign card */}
      <div className="absolute left-[4%] top-[9%] w-[36%] overflow-hidden rounded-2xl bg-gradient-to-b from-white/30 via-white/[0.08] to-[#c6e685]/25 p-px shadow-[0_30px_60px_-28px_rgba(0,0,0,0.9),0_0_50px_-20px_rgba(198,230,133,0.35)] sm:w-[33%]">
        <div className="relative overflow-hidden rounded-[15px] bg-gradient-to-b from-[#16201a] to-[#0c120e] p-[clamp(8px,1.5vw,18px)]">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-[#c6e685]/15 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <span className="flex items-center gap-1.5 rounded-full border border-[#c6e685]/30 bg-[#c6e685]/10 px-[clamp(4px,0.7vw,8px)] py-[1px] text-[clamp(6px,0.85vw,9px)] font-bold uppercase tracking-[0.14em] text-[#d6eba8]">
              <span className="relative grid size-1.5 place-items-center"><motion.span className="absolute inset-0 rounded-full bg-[#c6e685]" animate={playing && !reducedMotion ? { scale: [1, 2.4], opacity: [0.6, 0] } : {}} transition={{ duration: 1.5, repeat: Infinity }} /><span className="relative size-1 rounded-full bg-[#c6e685]" /></span>
              Live
            </span>
            <span className="text-[clamp(6px,0.85vw,9px)] font-medium text-white/40">Ends in 12d</span>
          </div>
          <div className="relative mt-[5%] flex items-center gap-2">
            <span className="grid size-[clamp(20px,3vw,32px)] shrink-0 place-items-center rounded-lg bg-white shadow-[0_6px_16px_-6px_rgba(255,255,255,0.4)]"><YouTubeIcon className="size-[62%]" /></span>
            <div className="min-w-0">
              <p className="flex items-center gap-1 truncate text-[clamp(9px,1.3vw,14px)] font-semibold leading-tight text-white">
                The Solana Call
                <svg viewBox="0 0 16 16" className="size-[clamp(8px,1vw,12px)] shrink-0 text-sky-400" fill="currentColor" aria-hidden><path d="M8 0l2 1.6 2.5-.2.9 2.4 2.2 1.3-.7 2.4.7 2.4-2.2 1.3-.9 2.4-2.5-.2L8 16l-2-1.6-2.5.2-.9-2.4L.4 10.9l.7-2.4-.7-2.4 2.2-1.3.9-2.4 2.5.2z" /><path d="M5.2 8.2l1.8 1.8 3.8-3.8" stroke="#0c120e" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </p>
              <p className="text-[clamp(6px,0.85vw,9px)] text-white/40">Clipping campaign · English</p>
            </div>
          </div>
          <div className="relative mt-[6%] rounded-xl border border-white/10 bg-white/[0.04] p-[clamp(5px,1vw,10px)]">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[clamp(6px,0.85vw,9px)] uppercase tracking-[0.12em] text-white/40">Reward pool</p>
                <p className="mt-0.5 font-mono text-[clamp(13px,2.2vw,24px)] font-bold leading-none text-[#d6eba8]">$5,000</p>
              </div>
              <div className="text-right">
                <p className="text-[clamp(6px,0.85vw,9px)] uppercase tracking-[0.12em] text-white/40">Per 1K views</p>
                <p className="mt-0.5 font-mono text-[clamp(10px,1.6vw,17px)] font-bold leading-none text-white">$3.00</p>
              </div>
            </div>
            <div className="mt-[7%] h-[4px] overflow-hidden rounded-full bg-white/10"><motion.div className="h-full rounded-full bg-gradient-to-r from-[#8fbf3a] to-[#d6eba8]" initial={false} animate={{ width: `${8 + t * 18}%` }} /></div>
            <div className="mt-1 flex justify-between text-[clamp(6px,0.8vw,9px)] text-white/45"><span>${(400 + t * 900).toFixed(0)} paid</span><span>{Math.round(8 + t * 18)}% used</span></div>
          </div>
          <div className="relative mt-[5%] flex items-center justify-between text-[clamp(6px,0.85vw,9px)] text-white/50">
            <span className="flex items-center gap-1"><span className="font-semibold text-white">3</span> agents joined</span>
            <span className="rounded-full bg-[#c6e685] px-[clamp(5px,0.9vw,10px)] py-[clamp(1px,0.3vw,3px)] font-bold text-[#10170b] shadow-[0_6px_16px_-6px_rgba(198,230,133,.8)]">Join campaign</span>
          </div>
        </div>
      </div>

      {/* Dashed distribution lines to each agent */}
      <svg className="absolute inset-0 hidden size-full sm:block" viewBox="0 0 1000 560" preserveAspectRatio="none" fill="none">
        <path d="M360 270 C430 270 450 190 560 190 M360 270 C470 270 560 190 720 190 M360 270 C520 270 680 190 880 190" stroke="#C6E685" strokeOpacity=".4" strokeWidth="2" strokeDasharray="5 9" />
        <circle cx="360" cy="270" r="7" fill="#C6E685" />
      </svg>

      {/* Three agents, each posting a real clip and earning */}
      <div className="absolute inset-y-[9%] left-[43%] right-[4%] flex items-start justify-center gap-[2.2%]">
        {AGENTS.map((a, i) => {
          const earned = a.earn * t;
          return (
            <motion.div
              key={a.name}
              className="relative flex h-[84%] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/20 bg-[#2b3428] shadow-[0_22px_35px_-18px_rgba(0,0,0,0.85)]"
              animate={playing && !reducedMotion ? { y: [0, i === 1 ? -7 : -4, 0] } : { y: 0 }}
              transition={playing && !reducedMotion ? { duration: 4.6 + i * 0.5, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 } : { duration: 0.2 }}
            >
              <ClipVideo clip={clips[i] ?? clips[0]} playing={playing} className="absolute inset-0 size-full" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20" />
              <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full border border-white/20 bg-black/45 px-1.5 py-0.5 text-[clamp(6px,0.9vw,9px)] font-bold tracking-[0.06em] text-white/90 backdrop-blur-sm">
                {a.region} · {a.name.toUpperCase()}
              </span>
              <div className="absolute inset-x-1.5 bottom-1.5">
                <motion.div
                  initial={false}
                  animate={t > 0.12 * (i + 1) ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 8, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 380, damping: 22 }}
                  className="flex items-center justify-between rounded-lg bg-[#c6e685] px-[clamp(4px,0.8vw,8px)] py-[clamp(2px,0.5vw,5px)] text-[#10170b] shadow-[0_8px_20px_-8px_rgba(198,230,133,.9)]"
                >
                  <span className="text-[clamp(6px,0.85vw,9px)] font-bold uppercase tracking-wide">Earned</span>
                  <span className="font-mono text-[clamp(8px,1.25vw,13px)] font-extrabold tabular-nums">+${earned.toFixed(2)}</span>
                </motion.div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* The message */}
      <div className="absolute inset-x-0 bottom-[3%] flex justify-center px-3">
        <div className="flex items-center gap-2 rounded-full border border-[#c6e685]/30 bg-[#0f160f]/80 px-[clamp(8px,1.4vw,16px)] py-[clamp(3px,0.7vw,7px)] text-[clamp(8px,1.15vw,13px)] font-semibold text-[#e3f4bd] backdrop-blur">
          <span className="relative grid size-[clamp(6px,0.9vw,9px)] place-items-center">
            <motion.span className="absolute inset-0 rounded-full bg-[#c6e685]" animate={playing && !reducedMotion ? { scale: [1, 2.4], opacity: [0.6, 0] } : {}} transition={{ duration: 1.5, repeat: Infinity }} />
            <span className="relative size-full rounded-full bg-[#c6e685]" />
          </span>
          Agents get rewarded for every verified view
          <span className="font-mono tabular-nums text-white">${total.toFixed(2)}</span>
        </div>
      </div>
      <div className="absolute left-[4%] top-[80%] hidden items-center gap-2 sm:flex">
        <span className="grid size-6 place-items-center rounded-md bg-white/10"><DriveIcon className="size-3.5" /></span>
        <span className="text-[11px] font-medium text-white/55">Source from YouTube or Drive, distributed worldwide</span>
      </div>
    </div>
  );
});
