"use client";
/* eslint-disable @next/next/no-img-element -- remote avatars */
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Clapperboard, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type DirectorAgent = { mintAddress: string; name: string; avatarUrl?: string; coinTicker?: string };

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * "Become a director": choose which influencer to put in charge. Each pick opens that influencer's Director tab, where
 * its scenes, cast and style are set once and it then plans and makes videos on its own. With no influencer yet, the
 * same modal asks you to create the first one.
 */
export function DirectorPicker({ open, onOpenChange, agents }: { open: boolean; onOpenChange: (open: boolean) => void; agents: DirectorAgent[] | undefined }) {
  const reduced = useReducedMotion();
  const none = agents !== undefined && agents.length === 0;
  const rise = (i: number) => ({
    initial: { opacity: 0, y: reduced ? 0 : 14, scale: reduced ? 1 : 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: reduced ? 0 : 0.45, delay: reduced ? 0 : 0.08 + i * 0.05, ease: EASE },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="!max-w-md overflow-hidden rounded-[28px] border border-white/[0.14] bg-[linear-gradient(150deg,rgba(44,47,53,0.88),rgba(14,16,19,0.92))] p-0 text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_40px_120px_-20px_rgba(0,0,0,0.8)] backdrop-blur-3xl"
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-[#d7ff00]/20 blur-[90px]" aria-hidden />
        <div className="relative px-6 pb-6 pt-7">
          <motion.span {...rise(0)} className="grid size-11 place-items-center rounded-2xl border border-white/20 bg-white/[0.08] text-[#d7ff00] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-xl">
            <Clapperboard className="size-5" />
          </motion.span>
          <motion.div {...rise(1)}>
            <DialogTitle className="mt-4 text-[22px] font-semibold tracking-tight text-white">
              {none ? "Create your first influencer" : "Who will you direct?"}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-400">
              {none
                ? "A director needs someone in front of the camera. Create an influencer first, then set its scenes, cast and style once and let it run itself."
                : "Pick an influencer to put in charge. You set the scenes, cast and style once, and it plans, makes and posts videos on its own."}
            </DialogDescription>
          </motion.div>

          {none ? (
            <motion.div {...rise(2)} className="mt-6">
              <Link href="/create" className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/25 bg-[#d7ff00] text-[14px] font-semibold text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_12px_30px_-10px_rgba(215,255,0,0.55)] transition-transform active:scale-[0.98]">
                <Plus className="size-4" /> Create influencer
              </Link>
              <p className="mt-3 text-center text-[11.5px] text-zinc-500">Free, and it takes about a minute.</p>
            </motion.div>
          ) : agents === undefined ? (
            <div className="mt-6 space-y-2" aria-busy>
              {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />)}
            </div>
          ) : (
            <ul className="-mx-1 mt-6 max-h-[min(22rem,52vh)] space-y-2 overflow-y-auto overscroll-contain px-1 py-1">
              {agents.map((a, i) => (
                <motion.li key={a.mintAddress} {...rise(i + 2)}>
                  <Link
                    href={`/builder?type=influencer&mint=${encodeURIComponent(a.mintAddress)}&tab=director`}
                    onClick={() => onOpenChange(false)}
                    className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5 pr-3.5 transition-all hover:-translate-y-px hover:border-[#d7ff00]/40 hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-[#d7ff00]"
                  >
                    {a.avatarUrl
                      ? <img src={a.avatarUrl} alt="" className="size-12 shrink-0 rounded-xl object-cover ring-1 ring-white/15" />
                      : <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/10 text-base font-bold">{a.name.slice(0, 1).toUpperCase()}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-white">{a.name}</span>
                      {a.coinTicker && <span className="font-mono text-[11px] text-[#d7ff00]">${a.coinTicker}</span>}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-zinc-500 transition-colors group-hover:text-[#d7ff00]">
                      Direct <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
