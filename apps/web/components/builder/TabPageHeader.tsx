"use client";

import type { LucideIcon } from "lucide-react";

/** Shared masthead for every builder tab — the same minimal treatment as the
 *  agents (Marketplace) page: a small glass icon chip, a thin 26px title, and
 *  ONE short muted line under it. Keep `blurb` under ~60 chars — anything the
 *  operator needs to know beyond that belongs in the tab body, not the header. */
export default function TabPageHeader({ icon: Icon, title, blurb, right }: {
  icon: LucideIcon;
  title: string;
  blurb: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-[26px] font-thin tracking-tight text-white">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
            <Icon className="size-[18px] text-white/80" strokeWidth={1.75} />
          </span>
          {title}
        </h1>
        <p className="mt-1 text-[13px] text-white/40">{blurb}</p>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
