"use client";

import Link from "next/link";
import { ChevronRight, Clapperboard, ScanFace } from "lucide-react";

/* The two agent types you can create, with one theme each so the sidebar card, the "+" menu and the
   empty state always match: AI Clipper is brand lime, AI Influencer is violet to fuchsia. */
export const AGENT_TYPES = {
  clipper: {
    title: "New AI Clipper",
    short: "Long videos into viral shorts",
    href: "/builder?type=clipping",
    Icon: Clapperboard,
    tile: "border-lime-300/30 from-lime-300/35 to-lime-400/5 text-lime-300",
    glow: "bg-lime-400/25",
    hover: "hover:border-lime-300/40",
    badge: "bg-sky-500/15 text-sky-300",
  },
  influencer: {
    title: "New AI Influencer",
    short: "A persona with its own face and voice",
    href: "/create",
    Icon: ScanFace,
    tile: "border-fuchsia-300/30 from-fuchsia-400/35 to-violet-500/10 text-fuchsia-200",
    glow: "bg-fuchsia-500/25",
    hover: "hover:border-fuchsia-300/40",
    badge: "bg-fuchsia-400/15 text-fuchsia-300",
  },
} as const;

export type AgentTypeId = keyof typeof AGENT_TYPES;

/** One create-an-agent card: themed icon tile, title, one-line hint and an arrow that nudges on hover. */
export function AgentTypeLink({ type }: { type: AgentTypeId }) {
  if (type === "clipper") return null;
  const t = AGENT_TYPES[type];
  return (
    <Link
      href={t.href}
      className={`group relative flex items-center gap-3 overflow-hidden rounded-xl border border-white/[0.09] bg-white/[0.04] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.07] ${t.hover}`}
    >
      <span aria-hidden className={`pointer-events-none absolute -left-6 -top-8 size-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100 ${t.glow}`} />
      <span className={`relative grid size-10 shrink-0 place-items-center rounded-xl border bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${t.tile}`}>
        <t.Icon className="size-[18px]" strokeWidth={1.9} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-white">{t.title}</span>
        <span className="block truncate text-[11.5px] text-zinc-500">{t.short}</span>
      </span>
      <ChevronRight className="relative size-4 shrink-0 text-zinc-600 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-white/70" />
    </Link>
  );
}
