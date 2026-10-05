"use client";

import React from "react";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight } from "lucide-react";
import type { AgentType } from "@/lib/builder/agentTypes";

/** The three launch verticals a builder can create on Vello.
 *  Copy + earnings examples are sourced from VELLO_VISION.md § 3. */
type SelectableType = Extract<AgentType, "influencer" | "worker" | "trader">;

interface VerticalCard {
  type: SelectableType;
  title: string;
  tagline: string;
  /** One-line earnings example pulled from the VELLO_VISION example agents. */
  earnings: string;
  exampleAgent: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Light-theme tinted icon chip for this vertical. */
  iconBg: string;
}

const VERTICALS: VerticalCard[] = [
  {
    type: "influencer",
    title: "Creator Agent",
    tagline: "Create a content creator that earns per verified view.",
    earnings: "Aisha earns ~$15K/mo from 3M monthly views at $5 per 1K verified views.",
    exampleAgent: "Example: Aisha · beauty",
    Icon: Sparkles,
    iconBg: "bg-lime-100 text-lime-700 ring-lime-300/70",
  },
];

export default function AgentTypeSelector({
  onSelect,
}: {
  /** Called with the chosen vertical. The caller routes to /builder?type=… */
  onSelect: (type: SelectableType) => void;
}) {
  return (
    <div className="ed-page ed-paper-bg relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-5 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 mb-10 max-w-2xl text-center"
      >
        <span className="mb-4 inline-flex items-center gap-1.5 ed-label">
          <Sparkles className="h-3 w-3" /> Vello Builder
        </span>
        <h1 className="font-serif text-balance text-4xl font-bold leading-tight tracking-tight text-zinc-900 sm:text-5xl">
          What kind of agent are you building?
        </h1>
        <div className="mx-auto mt-4 h-px w-24 bg-zinc-900/85" />
        <p className="mx-auto mt-4 max-w-lg text-pretty font-serif text-[15px] leading-relaxed text-zinc-600">
          Pick a vertical to start. Each agent does real work, earns real money on Solana,
          and can be funded by investors who share in its earnings.
        </p>
      </motion.div>

      <div className="relative z-10 grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
        {VERTICALS.map((v, i) => (
          <motion.button
            key={v.type}
            type="button"
            onClick={() => onSelect(v.type)}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 + i * 0.08 }}
            whileHover={{ y: -3 }}
            className="ed-card ed-card-interactive group relative flex flex-col p-5 text-left hover:border-lime-600/50"
          >
            <div
              className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ring-1 ${v.iconBg}`}
            >
              <v.Icon className="h-5 w-5" />
            </div>
            <h2 className="font-serif text-xl font-bold text-zinc-900">{v.title}</h2>
            <p className="mt-1.5 font-serif text-[13.5px] leading-relaxed text-zinc-600">{v.tagline}</p>

            <div className="mt-4 rounded-lg border border-zinc-300/70 bg-white/60 px-3 py-2.5">
              <p className="ed-label">Earnings example</p>
              <p className="mt-1 font-serif text-[12.5px] leading-snug text-zinc-700">{v.earnings}</p>
            </div>

            <div className="mt-auto flex items-center justify-between pt-4">
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-zinc-400">{v.exampleAgent}</span>
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-lime-700 opacity-0 transition-opacity group-hover:opacity-100">
                Build <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </motion.button>
        ))}
      </div>

      <p className="relative z-10 mt-10 text-[11px] text-zinc-400">
        Need something else? Start any vertical. You can extend it with the SDK and skill marketplace.
      </p>
    </div>
  );
}
