"use client";
/* eslint-disable @next/next/no-img-element -- saved character portrait */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Camera, Clapperboard, MessageSquare, Pause, Play, ScanLine } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function MarketLiveCam({ characterId, name, imageUrl }: { characterId: Id<"ssCharacters">; name: string; imageUrl?: string }) {
  const live = useQuery(api.solstarLiveCam.state, { characterId });
  const reduced = useReducedMotion();
  const screen = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const inView = useInView(screen, { amount: 0.5 });
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [userPlay, setUserPlay] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string>();
  useEffect(() => {
    if (!live?.activity.until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live?.activity.until]);
  const expired = live?.activity.until && live.activity.until <= now;
  const kind = expired ? (live?.latestVideo ? "video" : "idle") : live?.activity.kind ?? (live === null ? "unavailable" : "loading");
  const label = expired ? (live?.latestVideo ? "Latest finished video" : "Waiting for the next task") : live?.activity.label ?? (live === null ? "Activity unavailable" : "Connecting to agent");
  const clip = live?.latestVideo;
  const playing = kind === "video" && inView && !paused && (!reduced || userPlay) && failedUrl !== clip?.url;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (playing) void element.play().catch(() => {});
    else element.pause();
  }, [playing, clip?.url]);
  return <div ref={screen} className="h-full px-3 pt-2 pb-1">
    <div className="relative h-full overflow-hidden rounded-lg border border-white/10 bg-[#121617] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
      <div className="absolute inset-0 opacity-25" style={{ backgroundImage: "linear-gradient(rgba(215,255,0,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(215,255,0,.12) 1px,transparent 1px)", backgroundSize: "18px 18px" }} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${kind}:${kind === "video" ? clip?.url : ""}`} initial={{ opacity: 0, y: reduced ? 0 : 6, filter: reduced ? "blur(0px)" : "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.25 }} className="absolute inset-0">
          {kind === "video" && clip && failedUrl !== clip.url ? <video ref={video} src={clip.url} poster={clip.poster ?? undefined} muted loop playsInline preload={inView ? "metadata" : "none"} onLoadedData={event => { if (playing) void event.currentTarget.play().catch(() => {}); }} onError={() => setFailedUrl(clip.url)} className="size-full object-cover" /> : kind === "reading" ? <div className="absolute inset-x-3 top-7 bottom-6 space-y-1 overflow-hidden">
            {(live?.messages.length ? live.messages : [{ id: "reading", role: "agent", body: "Reviewing community messages…" }]).map((message, index) => <motion.div key={message.id} initial={{ opacity: 0, x: reduced ? 0 : -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reduced ? 0 : index * 0.09 }} className="flex items-start gap-1.5 rounded bg-white/[0.045] px-2 py-1 text-[9px] text-zinc-300"><MessageSquare className="mt-0.5 size-2.5 shrink-0 text-[#d7ff00]/60" /><span className="line-clamp-1">{message.body}</span></motion.div>)}
            {!reduced && <motion.div animate={{ y: [0, 62, 0] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }} className="pointer-events-none absolute inset-x-0 top-0 h-5 border-b border-[#d7ff00]/35 bg-gradient-to-t from-[#d7ff00]/10 to-transparent" />}
          </div> : <div className="absolute inset-x-3 top-7 bottom-6 flex items-center gap-3">
            <div className="relative grid size-12 shrink-0 place-items-center rounded-xl border border-[#d7ff00]/20 bg-black/25">
              <img src={imageUrl || "/brand/solcameo-mark.png"} alt="" onError={event => { if (!event.currentTarget.src.endsWith("/brand/solcameo-mark.png")) event.currentTarget.src = "/brand/solcameo-mark.png"; }} className="size-10 rounded-lg object-cover" />
              {kind === "generating" && inView && !reduced && <motion.div animate={{ y: [-18, 18, -18] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} className="absolute inset-x-0 h-px bg-[#d7ff00] shadow-[0_0_9px_#d7ff00]" />}
            </div>
            <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium text-white">{name}</p><div className="mt-1.5 flex gap-1">{[0, 1, 2, 3, 4, 5].map(index => <motion.span key={index} animate={inView && !reduced && ["generating", "working", "loading"].includes(kind) ? { opacity: [0.2, 1, 0.2], scaleY: [0.5, 1, 0.5] } : { opacity: 0.25 }} transition={{ duration: 1.5, repeat: Infinity, delay: index * 0.14 }} className="h-3 w-2 rounded-sm bg-[#d7ff00]/70" />)}</div><p className="mt-1 text-[8px] text-zinc-500">{kind === "generating" ? "Building the next scene" : kind === "video" ? "Video unavailable" : "Agent workspace"}</p></div>
          </div>}
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/55" />
      <div className="absolute inset-x-2 top-1.5 flex items-center justify-between text-[8px] text-white/65"><span className="flex items-center gap-1"><Camera className="size-2.5" />Live Cam</span><span className="flex items-center gap-1"><span className={`size-1 rounded-full ${live ? "bg-[#d7ff00]" : "bg-zinc-500"}`} />{live ? "LIVE STATE" : live === null ? "UNAVAILABLE" : "CONNECTING"}</span></div>
      <div className="absolute inset-x-2 bottom-1.5 flex items-end gap-1.5"><span className="mb-0.5 text-[#d7ff00]">{kind === "generating" ? <Clapperboard className="size-3" /> : <ScanLine className="size-3" />}</span><p role="status" className="min-w-0 flex-1 truncate text-[9px] font-medium text-white">{label}</p><span className="text-[7px] text-white/40">Simulated view</span>{kind === "video" && clip && failedUrl !== clip.url && <button type="button" aria-label={playing ? "Pause latest video" : "Play latest video"} onClick={() => { setUserPlay(true); setPaused(playing); }} className="grid size-5 place-items-center rounded bg-white/10 text-white hover:bg-white/20">{!playing ? <Play className="size-2.5" /> : <Pause className="size-2.5" />}</button>}</div>
    </div>
  </div>;
}
