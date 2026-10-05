"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import velloLogo from "@/assets/solcameo-dark.png";
import { playCelebrationChime } from "@/components/builder/MintCelebration";
import { PixelIcon } from "@/components/builder/onboarding/pixel-icons";
import { EASE } from "./wizard-ui";

const MintedScene = dynamic(() => import("@/components/builder/onboarding/MintedScene"), { ssr: false });

/** "Your campaign is live" moment: three.js burst behind a tilt-free summary card. */
export function CampaignLive({
  title, brand, budget, platforms, imageUrl, onContinue,
}: { title: string; brand: string; budget: number; platforms: string[]; imageUrl: string | null; onContinue: () => void }) {
  const reduce = useReducedMotion() ?? false;
  useEffect(() => { if (!reduce) playCelebrationChime(); }, [reduce]);
  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay: reduce ? 0 : delay, ease: EASE },
  } as const);

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#F6F4F0] text-[#141413]">
      <MintedScene />
      <header className="relative z-10 px-5 py-4 sm:px-8">
        <Image src={velloLogo} alt="Solcameo" className="h-8 w-auto " />
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-[520px] flex-col items-center px-5 pb-16 pt-10 text-center">
        <motion.span {...rise(0.1)} className="rounded-md bg-[#2BB67E] px-3 py-1.5 text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-[#06281b]">
          Campaign live
        </motion.span>
        <motion.h1 {...rise(0.25)} className="mt-5 text-balance text-[clamp(38px,8vw,60px)] font-semibold leading-[1.02] tracking-[-0.045em]">
          You are on the stage
        </motion.h1>
        <motion.p {...rise(0.38)} className="mt-3 text-[18px] text-[#141413]/65">Agents and creators can find your campaign now</motion.p>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 40, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 110, damping: 15, delay: reduce ? 0 : 0.5 }}
          className="mt-9 w-full max-w-[420px] rounded-[28px] bg-white/90 p-5 text-left shadow-[0_30px_70px_-30px_rgba(20,20,19,0.45)] ring-1 ring-black/5"
        >
          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[20px] bg-[#141413]">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center bg-gradient-to-br from-[#1c2410] to-[#0b0d0a]">
                <Image src={velloLogo} alt="" className="w-24 opacity-30 invert" />
              </div>
            )}
          </div>
          <p className="mt-4 truncate text-[22px] font-semibold tracking-[-0.03em]">{title}</p>
          <p className="truncate text-[14px] text-[#141413]/55">{brand}</p>
          <div className="mt-4 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[#141413]">
              {platforms.slice(0, 6).map((p) => <PixelIcon key={p} id={p} className="size-5" />)}
            </span>
            <span className="rounded-lg bg-[#A3E635]/40 px-3 py-1.5 font-mono text-[15px] font-bold">${budget.toLocaleString()} USDC</span>
          </div>
        </motion.div>

        <motion.button
          {...rise(1.0)}
          type="button"
          onClick={onContinue}
          className="group mt-8 inline-flex h-14 items-center gap-2.5 rounded-2xl bg-[#141413] pl-7 pr-5 text-[15px] font-semibold text-white transition-colors hover:bg-black"
        >
          See it on the stage
          <ArrowRight className="size-4 text-[#A3E635] transition-transform group-hover:translate-x-0.5" />
        </motion.button>
      </main>
    </div>
  );
}
