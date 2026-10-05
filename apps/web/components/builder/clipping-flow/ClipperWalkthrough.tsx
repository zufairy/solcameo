"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Link as LinkIcon, Palette, Share2, Rocket, PartyPopper, Check } from "lucide-react";
import type { BuilderPhase } from "@/lib/builder/agentTypes";

const STEPS: { phase: BuilderPhase; title: string; body: string; Icon: typeof LinkIcon }[] = [
  { phase: "clip_setup", title: "Source video", body: "Your link (and clip count) is already in, the agent will confirm it.", Icon: LinkIcon },
  { phase: "clip_style", title: "Clip style", body: "Your chosen style rides along, you can still tweak captions, hooks and effects.", Icon: Palette },
  { phase: "clip_platforms", title: "Platforms", body: "Pick where the clips post, TikTok, Reels, YouTube Shorts, or all three.", Icon: Share2 },
  { phase: "clip_mint", title: "Mint your agent", body: "One on-chain mint turns this into a real, always-on clipping agent.", Icon: Rocket },
  { phase: "clip_ready", title: "Live & clipping", body: "Your agent renders and posts the clips automatically from here.", Icon: PartyPopper },
];

/**
 * First-run walkthrough for the /home "Get clips" hand-off — a floating,
 * dismissible card (not a blocking modal, the chat underneath is still the
 * real interaction surface) that maps the SAME clip_* phases the sidebar's
 * compact dot-stepper already tracks (agentPhase) onto plain-English next
 * steps, so someone arriving fresh from /home knows what's about to happen
 * and what's left. Auto-dismisses once the agent goes live.
 */
export function ClipperWalkthrough({ agentPhase, onClose }: { agentPhase: BuilderPhase | null; onClose: () => void }) {
  const currentIdx = agentPhase ? STEPS.findIndex((s) => s.phase === agentPhase) : 0;
  const activeIdx = currentIdx >= 0 ? currentIdx : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
      className="pointer-events-auto fixed bottom-5 right-5 z-[90] w-[300px] overflow-hidden rounded-2xl border border-white/15 bg-neutral-950/95 shadow-[0_30px_90px_-25px_rgba(0,0,0,0.9)] backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <p className="text-[12px] font-semibold text-white/85">Setting up your clipper</p>
        <button onClick={onClose} aria-label="Dismiss" className="rounded-full p-1 text-white/35 transition-colors hover:bg-white/10 hover:text-white">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="space-y-0.5 p-2.5">
        {STEPS.map((s, i) => {
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
          return (
            <motion.div
              key={s.phase}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: state === "pending" ? 0.45 : 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className={`flex items-start gap-2.5 rounded-xl px-2 py-2 transition-colors ${state === "active" ? "bg-lime-400/[0.07]" : ""}`}
            >
              <span
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border transition-colors ${
                  state === "done"
                    ? "border-lime-400/40 bg-lime-400/15 text-lime-300"
                    : state === "active"
                      ? "border-lime-400/50 bg-lime-400/10 text-lime-300"
                      : "border-white/10 bg-white/[0.03] text-white/30"
                }`}
              >
                {state === "done" ? <Check className="size-3" strokeWidth={3} /> : <s.Icon className="size-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-[11.5px] font-semibold ${state === "pending" ? "text-white/45" : "text-white/90"}`}>{s.title}</p>
                <AnimatePresence>
                  {state === "active" && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className="mt-0.5 text-[10.5px] leading-snug text-white/45"
                    >
                      {s.body}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
