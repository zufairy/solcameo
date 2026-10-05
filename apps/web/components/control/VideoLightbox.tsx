"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft, ChevronRight, ExternalLink, Gauge, Maximize, Minimize, Pause, PictureInPicture2, Play,
  RotateCcw, RotateCw, Volume1, Volume2, VolumeX, X,
} from "lucide-react";
import type { FeedItem } from "./store";
import { PLATFORM_LABEL } from "./store";
import { SPRING, StateBadge, formatWhen } from "./ui";

/* ════════ Video popup ════════
   Any video on /control (chat cards, the agent's screen, profile) opens here:
   an animated, blurred-backdrop popup with a custom player — play/pause, scrub
   with hover preview time, ±5s, volume, speed, picture-in-picture, fullscreen,
   prev/next through the list, and keyboard shortcuts. */

type Open = (videos: FeedItem[], index: number) => void;
const LightboxContext = createContext<Open>(() => {});
export const useVideoLightbox = () => useContext(LightboxContext);

export function VideoLightboxProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ videos: FeedItem[]; index: number } | null>(null);
  const open = useCallback<Open>((videos, index) => {
    if (videos.length) setState({ videos, index: Math.max(0, Math.min(index, videos.length - 1)) });
  }, []);
  return (
    <LightboxContext.Provider value={open}>
      {children}
      <AnimatePresence>
        {state && (
          <Lightbox
            key="lightbox"
            videos={state.videos}
            index={state.index}
            onIndex={(i) => setState((s) => (s ? { ...s, index: i } : s))}
            onClose={() => setState(null)}
          />
        )}
      </AnimatePresence>
    </LightboxContext.Provider>
  );
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

function Lightbox({ videos, index, onIndex, onClose }: {
  videos: FeedItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const v = videos[index];
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dir, setDir] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [flash, setFlash] = useState<{ id: number; icon: "play" | "pause" | "back" | "fwd" } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const go = useCallback((delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= videos.length) return;
    setDir(delta);
    onIndex(next);
  }, [index, videos.length, onIndex]);

  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!videoRef.current?.paused) setControls(false); }, 2600);
  }, []);

  const showFlash = (icon: "play" | "pause" | "back" | "fwd") => setFlash({ id: Date.now(), icon });

  const toggle = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { void el.play().catch(() => {}); showFlash("play"); } else { el.pause(); showFlash("pause"); }
    poke();
  }, [poke]);

  const seekBy = useCallback((s: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + s));
    showFlash(s < 0 ? "back" : "fwd");
    poke();
  }, [poke]);

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Apply volume / mute / speed to the element (also after switching video).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
    el.playbackRate = rate;
  }, [volume, muted, rate, v?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!videoRef.current) return;
      if (e.key === "Escape") { if (!document.fullscreenElement) onClose(); return; }
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight" && e.shiftKey) go(1);
      else if (e.key === "ArrowLeft" && e.shiftKey) go(-1);
      else if (e.key === "ArrowRight" || e.key === "l") seekBy(5);
      else if (e.key === "ArrowLeft" || e.key === "j") seekBy(-5);
      else if (e.key === "ArrowUp") { e.preventDefault(); setMuted(false); setVolume((x) => Math.min(1, +(x + 0.1).toFixed(2))); poke(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setVolume((x) => Math.max(0, +(x - 0.1).toFixed(2))); poke(); }
      else if (e.key === "m") { setMuted((x) => !x); poke(); }
      else if (e.key === "f") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seekBy, go, onClose, poke, toggleFullscreen]);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const timeAt = (clientX: number) => {
    const bar = barRef.current;
    if (!bar || !duration) return { x: 0, t: 0 };
    const r = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    return { x, t: (x / r.width) * duration };
  };
  const scrubTo = (clientX: number) => {
    const el = videoRef.current;
    if (el && duration) el.currentTime = timeAt(clientX).t;
  };

  const pct = duration ? (time / duration) * 100 : 0;
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const pipOk = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

  if (!v) return null;
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-3 backdrop-blur-xl md:p-8"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Video player"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 24, filter: "blur(12px)" }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.94, y: 12, filter: "blur(8px)" }}
        transition={{ ...SPRING, filter: { duration: 0.25 } }}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0e0e11] shadow-2xl shadow-black/70 md:flex-row"
      >
        {/* ── Stage ── */}
        <div
          ref={stageRef}
          onMouseMove={poke}
          onMouseLeave={() => { if (playing) setControls(false); }}
          className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black ${controls || !playing ? "" : "cursor-none"}`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.video
              key={v.id}
              ref={videoRef}
              src={v.videoUrl}
              poster={v.posterUrl ?? undefined}
              autoPlay
              playsInline
              initial={{ opacity: 0, x: dir * 60, filter: "blur(6px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: dir * -60, filter: "blur(6px)" }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              onClick={toggle}
              onDoubleClick={toggleFullscreen}
              onPlay={() => { setPlaying(true); poke(); }}
              onPause={() => { setPlaying(false); setControls(true); }}
              onTimeUpdate={(e) => { if (!scrubbing) setTime(e.currentTarget.currentTime); }}
              onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); setTime(0); setBuffered(0); }}
              onProgress={(e) => {
                const el = e.currentTarget;
                if (el.buffered.length && el.duration) setBuffered(el.buffered.end(el.buffered.length - 1) / el.duration);
              }}
              onEnded={() => { setPlaying(false); setControls(true); }}
              className={`w-full object-contain ${fullscreen ? "h-screen" : "aspect-[9/16] max-h-[62vh] md:h-[78vh] md:max-h-[78vh] md:w-auto"}`}
            />
          </AnimatePresence>

          {/* Centre feedback pulse */}
          <AnimatePresence>
            {flash && (
              <motion.div
                key={flash.id}
                initial={{ opacity: 0.9, scale: 0.7 }} animate={{ opacity: 0, scale: 1.25 }} transition={{ duration: 0.55 }}
                onAnimationComplete={() => setFlash(null)}
                className="pointer-events-none absolute grid size-16 place-items-center rounded-full bg-black/55 text-white backdrop-blur"
              >
                {flash.icon === "play" ? <Play className="size-7 fill-white" /> : flash.icon === "pause" ? <Pause className="size-7 fill-white" />
                  : flash.icon === "back" ? <RotateCcw className="size-7" /> : <RotateCw className="size-7" />}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {!playing && !flash && (
              <motion.button
                key="bigplay"
                initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={SPRING}
                onClick={toggle} aria-label="Play"
                className="absolute grid size-16 place-items-center rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/25"
              >
                <Play className="ml-1 size-7 fill-white" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* Prev / next / close */}
          {index > 0 && (
            <button onClick={() => go(-1)} aria-label="Previous video" className={`absolute left-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition-opacity hover:bg-black/70 ${controls ? "opacity-100" : "opacity-0"}`}>
              <ChevronLeft className="size-5" />
            </button>
          )}
          {index < videos.length - 1 && (
            <button onClick={() => go(1)} aria-label="Next video" className={`absolute right-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition-opacity hover:bg-black/70 ${controls ? "opacity-100" : "opacity-0"}`}>
              <ChevronRight className="size-5" />
            </button>
          )}
          <button onClick={onClose} aria-label="Close" className={`absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition-opacity hover:bg-black/70 md:hidden ${controls ? "opacity-100" : "opacity-0"}`}>
            <X className="size-4" />
          </button>

          {/* Control bar */}
          <motion.div
            animate={{ opacity: controls ? 1 : 0, y: controls ? 0 : 10 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-3 pt-10"
            style={{ pointerEvents: controls ? "auto" : "none" }}
          >
            <div
              ref={barRef}
              className="group/bar relative h-4 cursor-pointer touch-none"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setScrubbing(true); setTime(timeAt(e.clientX).t); scrubTo(e.clientX); }}
              onPointerMove={(e) => { const h = timeAt(e.clientX); setHover(h); if (scrubbing) { setTime(h.t); scrubTo(e.clientX); } }}
              onPointerUp={() => setScrubbing(false)}
              onPointerLeave={() => setHover(null)}
              role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}
            >
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/bar:h-1.5">
                <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${buffered * 100}%` }} />
                <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${pct}%` }} />
              </div>
              <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-white shadow transition-transform group-hover/bar:scale-100" style={{ left: `${pct}%` }} />
              {hover && duration > 0 && (
                <div className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[11px] text-white" style={{ left: hover.x }}>
                  {fmt(hover.t)}
                </div>
              )}
            </div>

            <div className="mt-1.5 flex items-center gap-1 text-white">
              <CtrlButton label={playing ? "Pause" : "Play"} onClick={toggle}>
                {playing ? <Pause className="size-[18px] fill-white" /> : <Play className="size-[18px] fill-white" />}
              </CtrlButton>
              <CtrlButton label="Back 5 seconds" onClick={() => seekBy(-5)}><RotateCcw className="size-4" /></CtrlButton>
              <CtrlButton label="Forward 5 seconds" onClick={() => seekBy(5)}><RotateCw className="size-4" /></CtrlButton>
              <div className="group/vol flex items-center">
                <CtrlButton label={muted ? "Unmute" : "Mute"} onClick={() => setMuted((m) => !m)}><VolIcon className="size-[18px]" /></CtrlButton>
                <input
                  type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
                  onChange={(e) => { const x = Number(e.target.value); setVolume(x); setMuted(x === 0); }}
                  aria-label="Volume"
                  className="h-1 w-0 cursor-pointer accent-white opacity-0 transition-all duration-200 focus:w-20 focus:opacity-100 group-hover/vol:w-20 group-hover/vol:opacity-100"
                />
              </div>
              <span className="ml-1 font-mono text-[12px] tabular-nums text-zinc-300">{fmt(time)} / {fmt(duration)}</span>
              <div className="flex-1" />
              <div className="relative">
                <CtrlButton label="Playback speed" onClick={() => setSpeedOpen((o) => !o)}>
                  <span className="flex items-center gap-1 text-[12px] font-semibold"><Gauge className="size-4" />{rate}x</span>
                </CtrlButton>
                <AnimatePresence>
                  {speedOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.95, filter: "blur(6px)" }}
                      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: 6, scale: 0.95, filter: "blur(6px)" }}
                      transition={SPRING}
                      style={{ originY: 1 }}
                      className="absolute bottom-10 right-0 w-24 rounded-xl border border-white/10 bg-[#1c1c20]/95 p-1 backdrop-blur"
                    >
                      {SPEEDS.map((s) => (
                        <button
                          key={s}
                          onClick={() => { setRate(s); setSpeedOpen(false); }}
                          className={`block w-full rounded-lg px-2 py-1 text-left text-[12.5px] ${s === rate ? "bg-white/15 text-white" : "text-zinc-300 hover:bg-white/5"}`}
                        >{s}x</button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {pipOk && (
                <CtrlButton label="Picture in picture" onClick={() => { void videoRef.current?.requestPictureInPicture?.().catch(() => {}); }}>
                  <PictureInPicture2 className="size-4" />
                </CtrlButton>
              )}
              <CtrlButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              </CtrlButton>
            </div>
          </motion.div>
        </div>

        {/* ── Details ── */}
        <div className="flex w-full shrink-0 flex-col border-t border-white/[0.07] md:w-72 md:border-l md:border-t-0">
          <div className="hidden items-center justify-between px-4 pt-4 md:flex">
            <span className="text-[12px] text-zinc-500">{index + 1} of {videos.length}</span>
            <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white">
              <X className="size-4" />
            </button>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={v.id}
              initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(4px)" }}
              transition={{ duration: 0.2 }}
              className="space-y-3 p-4"
            >
              <p className="text-[14px] leading-relaxed text-zinc-200">{v.caption || "Untitled"}</p>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
                <StateBadge state={v.state} />
                <span>{formatWhen(v.createdAt)}</span>
                {v.platform && <span>· {PLATFORM_LABEL[v.platform] ?? v.platform}</span>}
                {v.viewCount != null && <span>· {v.viewCount.toLocaleString()} views</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {v.postUrl && (
                  <a href={v.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12.5px] font-semibold text-black hover:bg-zinc-200">
                    View post <ExternalLink className="size-3" />
                  </a>
                )}
                <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[12.5px] text-zinc-200 hover:bg-white/5">
                  Open file <ExternalLink className="size-3" />
                </a>
              </div>
            </motion.div>
          </AnimatePresence>
          {videos.length > 1 && (
            <div className="hidden min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:block">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Up next</p>
              <div className="grid grid-cols-3 gap-1.5">
                {videos.map((x, i) => (
                  <button
                    key={x.id}
                    onClick={() => { setDir(i > index ? 1 : -1); onIndex(i); }}
                    aria-label={`Play ${x.caption || "video"}`}
                    className={`aspect-[9/16] overflow-hidden rounded-lg bg-black ring-1 transition ${i === index ? "ring-white/70" : "opacity-70 ring-white/5 hover:opacity-100 hover:ring-white/25"}`}
                  >
                    <video src={x.videoUrl} poster={x.posterUrl ?? undefined} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="hidden px-4 pb-3 text-[10.5px] leading-relaxed text-zinc-600 md:block">
            Space play · ←/→ 5s · Shift+←/→ prev/next · ↑/↓ volume · M mute · F fullscreen
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CtrlButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}
      onClick={onClick} aria-label={label} title={label}
      className="grid h-8 min-w-8 place-items-center rounded-full px-1.5 text-white/90 hover:bg-white/10 hover:text-white"
    >
      {children}
    </motion.button>
  );
}
