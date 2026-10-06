"use client";
/* eslint-disable @next/next/no-img-element -- saved character portrait */
import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export function MarketInfluencerAbout({ name, ticker, category, bio, imageUrl }: {
  name: string; ticker: string; category: string; bio: string; imageUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const reduced = useReducedMotion();
  return (
    <section className="mt-auto shrink-0 border-t border-white/10 bg-[#181a1c]">
      <AnimatePresence initial={false}>
        {open && <motion.div id={id} key="about" initial={{ height: 0, opacity: 0, y: reduced ? 0 : 12 }} animate={{ height: "auto", opacity: 1, y: 0 }} exit={{ height: 0, opacity: 0, y: reduced ? 0 : 12 }} transition={{ duration: reduced ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
          <div className="max-h-[40dvh] overflow-y-auto px-4 pt-4 pb-2">
            <div className="mb-3 flex items-center gap-3">
              {imageUrl && <img src={imageUrl} alt="" className="size-10 rounded-md object-cover" />}
              <div><p className="text-sm font-medium text-white">{name}</p><p className="mt-1 text-[10px] text-zinc-500">${ticker} · {category}</p></div>
            </div>
            <p className="text-xs leading-relaxed text-zinc-400">{bio}</p>
          </div>
        </motion.div>}
      </AnimatePresence>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="w-full px-4 py-3 text-left text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.03] hover:text-white focus-visible:outline-2 focus-visible:outline-[#d7ff00]">
        About the influencer
      </button>
    </section>
  );
}
