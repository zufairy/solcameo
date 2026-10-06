"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatRelativeTime } from "@/lib/solstar/relativeTime";

const SLIDE_MS = 6000;
const WORKING = new Set(["generating", "working", "reading", "attention"]);

/** The agent's real output: a timed slideshow of what it generated, with its actual task status on top. */
export function MarketLiveCam({ characterId, name, imageUrl }: { characterId: Id<"ssCharacters">; name: string; imageUrl?: string }) {
  const live = useQuery(api.solstarLiveCam.state, { characterId });
  const reduced = useReducedMotion();
  const screen = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const inView = useInView(screen, { amount: 0.4 });
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const slides = (live?.media?.length ? live.media : imageUrl ? [{ kind: "image" as const, url: imageUrl, poster: null, title: name, createdAt: 0 }] : []).filter(m => !failed.includes(m.url));
  const current = slides.length ? slides[index % slides.length] : null;
  const working = !!live && WORKING.has(live.activity.kind);
  const advancing = inView && !paused && slides.length > 1;

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!advancing) return;
    const t = setTimeout(() => setIndex(i => (i + 1) % slides.length), SLIDE_MS);
    return () => clearTimeout(t);
  }, [advancing, index, slides.length]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (inView && !paused && !reduced) void el.play().catch(() => undefined); else el.pause();
  }, [inView, paused, reduced, current?.url]);

  const status = !live ? (live === null ? "Unavailable" : "Connecting") : live.activity.label;
  const age = current?.createdAt ? formatRelativeTime(now, current.createdAt) : null;
  return <div ref={screen} className="h-full px-3 pb-1 pt-2">
    <div className="relative h-full overflow-hidden rounded-2xl border border-white/10 bg-[#0c0e10] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_30px_-18px_rgba(0,0,0,0.9)]">
      <AnimatePresence initial={false}>
        {current && <motion.div key={`${current.url}:${index}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.7 }} className="absolute inset-0">
          {current.kind === "video"
            ? <video ref={video} src={current.url} poster={current.poster ?? undefined} muted loop playsInline preload={inView ? "auto" : "none"} onError={() => setFailed(f => [...f, current.url])} className="size-full object-cover" />
            : <motion.img src={current.url} alt="" onError={() => setFailed(f => [...f, current.url])} initial={{ scale: 1 }} animate={{ scale: reduced ? 1 : 1.08 }} transition={{ duration: SLIDE_MS / 1000 + 1, ease: "linear" }} className="size-full object-cover" />}
        </motion.div>}
      </AnimatePresence>
      {!current && <div className="absolute inset-0 grid place-items-center text-[11px] text-zinc-500">{live === undefined ? "Connecting to agent…" : "No media generated yet"}</div>}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-black/55" />

      <div className="absolute inset-x-2.5 top-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur-md">
          <span className="relative flex size-1.5">{working && !reduced && <span className="absolute inset-0 animate-ping rounded-full bg-[#d7ff00]/70" />}<span className={`relative size-1.5 rounded-full ${working ? "bg-[#d7ff00]" : live ? "bg-white/60" : "bg-white/25"}`} /></span>
          {working ? "Live" : "Latest"}
        </span>
        {slides.length > 1 && <button type="button" onClick={() => setPaused(p => !p)} aria-label={paused ? "Resume slideshow" : "Pause slideshow"} className="pointer-events-auto grid size-6 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-black/70">{paused ? <Play className="size-2.5 fill-current" /> : <Pause className="size-2.5 fill-current" />}</button>}
      </div>

      <div className="absolute inset-x-2.5 bottom-2">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p role="status" className="truncate text-[11px] font-semibold leading-tight text-white">{status}</p>
            <p className="mt-0.5 truncate text-[9px] text-white/60">{[current?.title && current.title !== "Latest finished video" ? current.title : null, age].filter(Boolean).join(" · ") || name}</p>
          </div>
          {live?.recent?.length ? <div className="flex shrink-0 gap-1">{live.recent.slice(0, 3).map(task => <span key={task.id} title={`${task.label} · ${task.status}`} className={`rounded-md border px-1.5 py-0.5 text-[8px] font-medium backdrop-blur-md ${task.status === "running" ? "border-[#d7ff00]/40 bg-[#d7ff00]/15 text-[#d7ff00]" : task.status === "failed" ? "border-rose-400/30 bg-rose-500/10 text-rose-300" : "border-white/15 bg-black/40 text-white/70"}`}>{task.label}</span>)}</div> : null}
        </div>
        {slides.length > 1 && <div className="mt-1.5 flex gap-1" aria-hidden>{slides.map((s, i) => <span key={s.url} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/20">{i === index % slides.length && <motion.span key={`${index}:${paused}`} initial={{ width: i < index % slides.length ? "100%" : 0 }} animate={{ width: paused || !inView ? undefined : "100%" }} transition={{ duration: SLIDE_MS / 1000, ease: "linear" }} className="block h-full bg-[#d7ff00]" />}{i < index % slides.length && <span className="block h-full w-full bg-white/60" />}</span>)}</div>}
      </div>
    </div>
  </div>;
}
