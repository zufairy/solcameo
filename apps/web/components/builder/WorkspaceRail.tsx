"use client";

import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import { motion } from "framer-motion";

export interface RailTab<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

/**
 * Floating glass navigation rail: icons only, the label slides out on hover/focus.
 * Vertical on the left for md+, a floating dock along the bottom on phones.
 * Tabs are locked (dimmed + small lock) until the agent is live; clicking one bounces to Home.
 */
export function WorkspaceRail<Id extends string>({ tabs, active, onSelect, locked }: {
  tabs: RailTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  /** True while the agent isn't live yet: every tab but the first is locked. */
  locked: boolean;
}) {
  return (
    <nav
      aria-label="Workspace"
      className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center md:inset-x-auto md:bottom-auto md:left-4 md:top-1/2 md:-translate-y-1/2 md:justify-start"
    >
      <motion.ul
        initial={{ opacity: 0, y: 24, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.1 }}
        className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-1 overflow-x-auto rounded-[26px] border border-white/[0.14] bg-white/[0.07] p-1.5 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-2xl [scrollbar-width:none] md:max-w-none md:flex-col md:overflow-visible md:p-2"
      >
        {tabs.map((t, i) => {
          const isLocked = locked && i > 0;
          const on = active === t.id;
          return (
            <li key={`${t.id}-${t.label}`} className="relative shrink-0">
              <motion.button
                type="button"
                onClick={() => onSelect(isLocked ? tabs[0].id : t.id)}
                aria-label={isLocked ? `${t.label} (locked)` : t.label}
                aria-current={on ? "page" : undefined}
                whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                transition={{ type: "spring", stiffness: 500, damping: 26 }}
                className="peer group relative grid size-11 place-items-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70"
              >
                {on && (
                  <motion.span
                    layoutId="ws-rail-active"
                    className="absolute inset-0 rounded-2xl border border-white/20 bg-gradient-to-b from-white/[0.22] to-white/[0.08] shadow-[0_0_24px_-4px_rgba(212,245,60,0.55),inset_0_1px_0_rgba(255,255,255,0.35)]"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <t.icon
                  className={`relative size-[19px] transition-colors duration-200 ${isLocked ? "text-zinc-600" : on ? "text-[#D4F53C]" : "text-zinc-400 group-hover:text-white"}`}
                  strokeWidth={on ? 2.1 : 1.75}
                />
                {isLocked && <Lock className="absolute bottom-1.5 right-1.5 size-2.5 text-zinc-500" strokeWidth={2.5} />}
                {on && <span aria-hidden className="absolute -left-0.5 hidden h-4 w-[3px] rounded-full bg-[#D4F53C] md:block" />}
              </motion.button>
              {/* Hover label: slides out to the right (desktop) / pops above (phone). */}
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-xl border border-white/[0.14] bg-[#101012]/85 px-3 py-1.5 text-[12.5px] font-semibold text-white opacity-0 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.9)] backdrop-blur-xl transition-all duration-200 ease-out peer-hover:translate-y-0 peer-hover:opacity-100 peer-focus-visible:translate-y-0 peer-focus-visible:opacity-100 md:bottom-auto md:left-[calc(100%+12px)] md:top-1/2 md:-translate-x-2 md:-translate-y-1/2 md:peer-hover:translate-x-0 md:peer-hover:-translate-y-1/2 md:peer-focus-visible:translate-x-0 md:peer-focus-visible:-translate-y-1/2"
              >
                {t.label}
                {isLocked && <span className="ml-2 font-medium text-zinc-500">Go live to unlock</span>}
              </span>
            </li>
          );
        })}
      </motion.ul>
    </nav>
  );
}
