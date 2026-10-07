"use client";
/* eslint-disable @next/next/no-img-element -- agent avatars hosted on remote storage */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Film } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RenderCard, markSeen, useLiveRenders, useSmoothProgress } from "./live-renders";

const R = 11, C = 2 * Math.PI * R;

/**
 * Header status for videos being made. While something renders it shows a live progress ring and percent beside
 * Deposit; when a video finishes and has not been looked at it turns into a "Video ready" notification. Click for the
 * live list and a link to the full generations page. Renders nothing when there is nothing to report.
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
  const list = jobs.filter((j) => j.state !== "failed" || unseen.some((u) => u.id === j.id)).slice(0, 5);

  return (
    <AnimatePresence initial={false}>
      {(rendering || ready) && (
        <motion.div key="chip" initial={{ opacity: 0, scale: 0.85, x: 12 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              aria-label={rendering ? `${active.length} ${active.length === 1 ? "video" : "videos"} rendering, ${Math.floor(pct)} percent` : failedOnly ? "A video failed" : "Video ready"}
              className={`relative flex h-10 items-center gap-2 overflow-hidden rounded-lg border pl-1.5 pr-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/40 ${
                ready && !failedOnly ? "border-[#d7ff00] bg-[#d7ff00] text-black hover:bg-[#e4ff59]" : failedOnly ? "border-rose-400/40 bg-rose-400/10 text-rose-200" : "border-[#d7ff00]/35 bg-[#14161a] text-white hover:border-[#d7ff00]/60"}`}
            >
              {ready && !failedOnly && <motion.span aria-hidden className="absolute inset-0 rounded-lg border-2 border-[#d7ff00]" initial={{ opacity: 0.8, scale: 1 }} animate={{ opacity: 0, scale: 1.25 }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }} />}
              <span className="relative grid size-7 shrink-0 place-items-center">
                {rendering ? (
                  <>
                    <svg viewBox="0 0 28 28" className="absolute inset-0 -rotate-90" aria-hidden>
                      <circle cx="14" cy="14" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2.5" />
                      <motion.circle cx="14" cy="14" r={R} fill="none" stroke="#d7ff00" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - pct / 100) }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
                    </svg>
                    {lead?.agentAvatar ? <img src={lead.agentAvatar} alt="" className="size-[18px] rounded-full object-cover" /> : <Film className="size-3.5 text-[#d7ff00]" />}
                  </>
                ) : <span className="grid size-6 place-items-center rounded-full bg-black/85 text-[#d7ff00]"><Check className="size-3.5" strokeWidth={3} /></span>}
              </span>
              <span className="relative hidden whitespace-nowrap sm:inline">
                {rendering ? <>Rendering <span className="tabular-nums text-[#d7ff00]">{Math.floor(pct)}%</span>{active.length > 1 && <span className="ml-1 text-white/50">· {active.length}</span>}</> : failedOnly ? "Video failed" : unseen.length > 1 ? `${unseen.length} videos ready` : "Video ready"}
              </span>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={10} className="w-[min(92vw,380px)] gap-0 rounded-[8px] border border-white/[0.14] bg-[#0f1113]/90 p-3 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
              <div className="mb-2.5 flex items-center justify-between px-1">
                <p className="text-[13px] font-semibold text-white">{rendering ? "Making your videos" : "Your videos"}</p>
                <Link href="/generations" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#d7ff00] hover:underline">All generations <ArrowUpRight className="size-3.5" /></Link>
              </div>
              <div className="space-y-2">
                <AnimatePresence initial={false}>{list.map((job) => <RenderCard key={job.id} job={job} compact onOpen={() => setOpen(false)} />)}</AnimatePresence>
              </div>
            </PopoverContent>
          </Popover>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
