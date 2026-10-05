"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, Plus, Search, Users, X } from "lucide-react";
import { AGENT_TYPES } from "./agent-types";
import { type Agent, type Team, agentKind, createTeam } from "./store";
import { Avatar, ITEM, POP, SPRING, STAGGER, TeamAvatar } from "./ui";

const MENU_W = 300;
const MENU_H_ESTIMATE = 220; // ~3 options; only used to keep the menu from opening off the bottom edge

/** Where the "+" dropdown should render, in VIEWPORT coordinates (for a
 *  position:fixed portal) — prefers opening to the right of the button (the
 *  old desktop layout), falls back to below-right when there isn't room (the
 *  old mobile layout), and clamps to stay fully on screen either way. */
export function computeMenuPosition(btn: DOMRect): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 8;
  let left = btn.right + gap;
  let top = btn.top;
  if (left + MENU_W > vw - 8) {
    left = Math.max(8, Math.min(btn.right, vw - MENU_W - 8));
    top = btn.bottom + gap;
  }
  if (top + MENU_H_ESTIMATE > vh - 8) top = Math.max(8, vh - MENU_H_ESTIMATE - 8);
  return { top, left };
}

/* ════════ "+" — create an agent or assemble a team ════════ */

const OPTIONS = [
  { id: "influencer", title: AGENT_TYPES.influencer.title, body: "An original persona that makes and posts its own videos.", Icon: AGENT_TYPES.influencer.Icon, tint: `border ${AGENT_TYPES.influencer.tile}`, glow: AGENT_TYPES.influencer.glow, href: AGENT_TYPES.influencer.href },
  { id: "team", title: "Assemble a team", body: "Group AI Influencers into one chat that works together.", Icon: Users, tint: "border border-emerald-300/25 from-emerald-500/30 to-emerald-500/5 text-emerald-300", glow: "bg-emerald-500/20", href: "" },
] as const;

export function CreateMenu({ agents, onTeamCreated }: { agents: Agent[]; onTeamCreated: (team: Team) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The sidebar this button lives in scrolls its own content and clips
  // anything that overflows it (overflow-hidden, for the collapse/expand
  // animation) — an absolutely-positioned dropdown INSIDE that sidebar was
  // getting silently clipped the moment it opened past the sidebar's edge
  // (which it always does: it opens to the button's right or below it),
  // rendering nothing visible however high its z-index was. Portaling it to
  // document.body with position:fixed, coordinates computed from the
  // button's own screen position, escapes that clipping entirely.
  useEffect(() => {
    if (!open) return;
    const measure = () => { if (btnRef.current) setPos(computeMenuPosition(btnRef.current.getBoundingClientRect())); };
    measure();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <motion.button
        ref={btnRef}
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          // Compute position synchronously on click (not only in the effect
          // below) so the portal has real coordinates on its very first paint
          // — otherwise it opens one frame late, positioned at (0,0) briefly.
          if (btnRef.current) setPos(computeMenuPosition(btnRef.current.getBoundingClientRect()));
          setOpen((o) => !o);
        }}
        title="Create"
        aria-label="Create"
        aria-expanded={open}
        className={`grid size-10 place-items-center rounded-xl transition-colors ${open ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
      >
        <motion.span animate={{ rotate: open ? 135 : 0 }} transition={SPRING} className="grid place-items-center"><Plus className="size-5" /></motion.span>
      </motion.button>

      {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {open && pos && (
          <motion.div
            ref={menuRef}
            variants={POP} initial="hidden" animate="show" exit="exit"
            style={{ originX: 0, originY: 0, position: "fixed", top: pos.top, left: pos.left }}
            // Highest z-index on the page (dialogs here top out at z-[150]) — this
            // must always paint above everything, including the assemble-a-team
            // modal it can open underneath itself.
            className="z-[200] w-[min(300px,calc(100vw-16px))] rounded-2xl border border-white/10 bg-[#17171a]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl"
          >
            <motion.div variants={STAGGER} initial="hidden" animate="show">
              {OPTIONS.map((o) => (
                <motion.button
                  key={o.id}
                  variants={ITEM}
                  whileHover={{ x: 2 }}
                  onClick={() => {
                    setOpen(false);
                    if (o.id === "team") setTeamOpen(true);
                    else router.push(o.href);
                  }}
                  className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl p-2.5 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span aria-hidden className={`pointer-events-none absolute -left-6 -top-8 size-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100 ${o.glow}`} />
                  <span className={`relative grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] ${o.tint}`}><o.Icon className="size-[18px]" strokeWidth={1.9} /></span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-white">{o.title}</span>
                    <span className="block text-[12px] leading-snug text-zinc-500">{o.body}</span>
                  </span>
                  <ChevronRight className="relative size-4 shrink-0 text-zinc-600 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-white/70" />
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
      )}

      <AnimatePresence>
        {teamOpen && (
          <TeamBuilder
            agents={agents}
            onClose={() => setTeamOpen(false)}
            onCreate={(name, mints) => { const t = createTeam(name, mints); setTeamOpen(false); onTeamCreated(t); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

type Filter = "all" | "Influencer" | "Clipper";
const MAX_MEMBERS = 6;

function TeamBuilder({ agents, onClose, onCreate }: {
  agents: Agent[];
  onClose: () => void;
  onCreate: (name: string, memberMints: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = search.trim().toLowerCase();
  const list = agents.filter((a) =>
    (filter === "all" || agentKind(a) === filter) && (!q || a.name.toLowerCase().includes(q) || (a.niche ?? "").toLowerCase().includes(q)));
  const members = useMemo(() => picked.map((m) => agents.find((a) => a.mintAddress === m)).filter((a): a is Agent => !!a), [picked, agents]);
  const autoName = members.length ? `${members.slice(0, 2).map((m) => m.name).join(" & ")}${members.length > 2 ? ` +${members.length - 2}` : ""}` : "";
  const counts: Record<Filter, number> = {
    all: agents.length,
    Influencer: agents.filter((a) => agentKind(a) === "Influencer").length,
    Clipper: agents.filter((a) => agentKind(a) === "Clipper").length,
  };

  const toggle = (mint: string) =>
    setPicked((p) => (p.includes(mint) ? p.filter((x) => x !== mint) : p.length >= MAX_MEMBERS ? p : [...p, mint]));

  return (
    <motion.div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Assemble a team"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20, filter: "blur(12px)" }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.95, y: 10, filter: "blur(8px)" }}
        transition={{ ...SPRING, filter: { duration: 0.25 } }}
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#111114] shadow-2xl shadow-black/70"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <p className="text-[18px] font-bold text-white">Assemble a team</p>
            <p className="mt-0.5 text-[13px] text-zinc-500">Pick 2–{MAX_MEMBERS} agents. They share one chat, see each other&apos;s replies and hand work off.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
        </div>

        {/* Selected strip */}
        <div className="mx-5 mt-4 flex min-h-[64px] items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <TeamAvatar members={members} size={40} />
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            <AnimatePresence initial={false} mode="popLayout">
              {members.length === 0 && (
                <motion.span key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[13px] text-zinc-600">No one picked yet</motion.span>
              )}
              {members.map((m) => (
                <motion.button
                  key={m.mintAddress}
                  layout
                  initial={{ opacity: 0, scale: 0.6, filter: "blur(4px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 0.6 }}
                  transition={SPRING}
                  onClick={() => toggle(m.mintAddress)}
                  className="flex items-center gap-1.5 rounded-full bg-white/[0.08] py-0.5 pl-0.5 pr-2 text-[12px] text-white hover:bg-white/[0.12]"
                >
                  <Avatar agent={m} size={20} /> {m.name} <X className="size-3 text-zinc-400" />
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="mx-5 mt-3 flex items-center gap-2">
          <div className="flex rounded-xl border border-white/[0.07] p-0.5">
            {(["all", "Influencer"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className="relative rounded-lg px-2.5 py-1 text-[12px] font-medium">
                {filter === f && <motion.span layoutId="team-filter" transition={SPRING} className="absolute inset-0 rounded-lg bg-white/10" />}
                <span className={`relative ${filter === f ? "text-white" : "text-zinc-500"}`}>{f === "all" ? "All" : `${f}s`} <span className="text-zinc-600">{counts[f]}</span></span>
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents" className="h-8 w-full rounded-lg border border-white/[0.07] bg-transparent pl-8 pr-2 text-[12.5px] text-white outline-none placeholder:text-zinc-600 focus:border-white/20" />
          </div>
        </div>

        <motion.div key={filter} variants={STAGGER} initial="hidden" animate="show" className="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto px-5 pb-3 sm:grid-cols-3">
          {list.map((a) => {
            const on = picked.includes(a.mintAddress);
            const full = !on && picked.length >= MAX_MEMBERS;
            return (
              <motion.button
                key={a.mintAddress}
                variants={ITEM}
                whileHover={full ? undefined : { y: -2 }}
                whileTap={full ? undefined : { scale: 0.97 }}
                onClick={() => toggle(a.mintAddress)}
                disabled={full}
                aria-pressed={on}
                className={`relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-colors disabled:opacity-40 ${on ? "border-emerald-400/60 bg-emerald-500/[0.08]" : "border-white/[0.07] hover:border-white/20 hover:bg-white/[0.03]"}`}
              >
                <AnimatePresence>
                  {on && (
                    <motion.span
                      initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={SPRING}
                      className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-emerald-400 text-black"
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
                <Avatar agent={a} size={48} />
                <span className="w-full truncate text-[13px] font-semibold text-white">{a.name}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] ${agentKind(a) === "Clipper" ? AGENT_TYPES.clipper.badge : AGENT_TYPES.influencer.badge}`}>{agentKind(a)}</span>
              </motion.button>
            );
          })}
          {list.length === 0 && <p className="col-span-full py-8 text-center text-[13px] text-zinc-600">No agents here yet.</p>}
        </motion.div>

        <div className="flex items-center gap-2 border-t border-white/[0.07] p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={autoName || "Team name"}
            maxLength={60}
            className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[14px] text-white outline-none placeholder:text-zinc-500 focus:border-white/20"
          />
          <motion.button
            whileTap={{ scale: 0.95 }}
            disabled={members.length < 2}
            onClick={() => onCreate((name.trim() || autoName).slice(0, 60), picked)}
            className="h-10 shrink-0 rounded-xl bg-white px-4 text-[13.5px] font-semibold text-black transition-opacity hover:bg-zinc-200 disabled:opacity-30"
          >
            Create team{members.length >= 2 ? ` (${members.length})` : ""}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
