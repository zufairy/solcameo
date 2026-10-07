"use client";
/* eslint-disable @next/next/no-img-element -- agent avatars hosted on remote storage */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Film } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RenderCard, markSeen, useLiveRenders, useSmoothProgress } from "./live-renders";

const R = 9, C = 2 * Math.PI * R;

/**
 * Header status for videos being made, kept small and always there once you have made one. While something renders it
 * shows a progress ring and percent beside Deposit; a finished video you have not looked at adds a lime "Ready" and a
 * dot; otherwise it rests as a quiet film icon. It never disappears on click, so the list is always one tap away.
 */
export function RenderStatusChip() {
  const { jobs, active, unseen } = useLiveRenders();
  const lead = active[0];
  const smooth = useSmoothProgress(lead ?? { progress: 0, state: "queued" as const });
  // One running video shows its own smooth percent; several show their average.
  const pct = active.length > 1 ? Math.round(active.reduce((n, j) => n + j.progress, 0) / active.length) : smooth;
  const [open, setOpen] = useState(false);
  const ids = unseen.map((j) => j.id).join(",");
  // Having the list open counts as seeing whatever has finished.
  useEffect(() => { if (open && ids) markSeen(ids.split(",")); }, [open, ids]);

  const rendering = active.length > 0;
  const ready = !rendering && unseen.length > 0;
  const failedOnly = ready && unseen.every((j) => j.state === "failed");
  const list = jobs.slice(0, 6);
  if (!jobs.length) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={rendering ? `${active.length} ${active.length === 1 ? "video" : "videos"} rendering, ${Math.floor(pct)} percent` : ready ? (failedOnly ? "A video failed" : "Video ready") : "Your videos"}
        className={`relative flex h-8 items-center gap-1.5 rounded-md border px-2 text-[12px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/40 ${
          ready && !failedOnly ? "border-[#d7ff00]/70 bg-[#d7ff00]/10 text-[#d7ff00] hover:bg-[#d7ff00]/15" : failedOnly ? "border-rose-400/40 bg-rose-400/10 text-rose-200" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/25 hover:text-white"}`}
      >
        <span className="relative grid size-[22px] shrink-0 place-items-center">
          {rendering ? (
            <>
              <svg viewBox="0 0 22 22" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="11" cy="11" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
                <motion.circle cx="11" cy="11" r={R} fill="none" stroke="#d7ff00" strokeWidth="2" strokeLinecap="round" strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - pct / 100) }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
              </svg>
              {lead?.agentAvatar ? <img src={lead.agentAvatar} alt="" className="size-[13px] rounded-full object-cover" /> : <Film className="size-3 text-[#d7ff00]" />}
            </>
          ) : ready && !failedOnly ? <Check className="size-3.5" strokeWidth={3} /> : <Film className="size-3.5" />}
          {ready && <motion.span aria-hidden className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full ${failedOnly ? "bg-rose-400" : "bg-[#d7ff00]"}`} animate={{ scale: [1, 1.6, 1], opacity: [1, 0.5, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />}
        </span>
        {(rendering || ready) && (
          <span className="hidden whitespace-nowrap sm:inline">
            {rendering ? <><span className="tabular-nums">{Math.floor(pct)}%</span>{active.length > 1 && <span className="ml-1 text-white/45">· {active.length}</span>}</> : failedOnly ? "Failed" : unseen.length > 1 ? `${unseen.length} ready` : "Ready"}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,360px)] gap-0 rounded-[8px] border border-white/[0.14] bg-[#0f1113]/92 p-2.5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[12px] font-semibold text-white">{rendering ? "Making your videos" : "Your videos"}</p>
          <Link href="/generations" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#d7ff00] hover:underline">All generations <ArrowUpRight className="size-3" /></Link>
        </div>
        <div className="space-y-1.5">
          <AnimatePresence initial={false}>{list.map((job) => <RenderCard key={job.id} job={job} compact onOpen={() => setOpen(false)} />)}</AnimatePresence>
        </div>
      </PopoverContent>
    </Popover>
  );
}
