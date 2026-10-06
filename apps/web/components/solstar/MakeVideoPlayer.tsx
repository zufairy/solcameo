"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { X, ArrowUpRight, Play, Pause, Volume2, VolumeX, Maximize, Minimize } from "lucide-react";

const PAD = 16; // breathing room between the video and the screen edge
const glass = "border border-white/20 bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl";
const clock = (s: number) => { if (!Number.isFinite(s) || s < 0) s = 0; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };

/** Fit a w:h frame inside the viewport (minus padding) at the video's exact aspect ratio. */
function fit(ratio: number, vw: number, vh: number) {
  const maxW = Math.max(160, vw - PAD * 2), maxH = Math.max(160, vh - PAD * 2);
  const width = Math.min(maxW, maxH * ratio);
  return { width: Math.round(width), height: Math.round(width / ratio) };
}

export function MakeVideoPlayer({ video, onClose }: { video: { url: string; poster?: string | null; name: string; ticker?: string; cap?: string; characterId: string | null }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement>(null);
  const idle = useRef<number | undefined>(undefined);
  const reduced = useReducedMotion();
  const [ratio, setRatio] = useState(9 / 16); // replaced by the real size once metadata loads
  const [view, setView] = useState({ w: 0, h: 0 });
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { el?.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => {
    const measure = () => setView({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    const change = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => { if (media.current && !media.current.paused) setAwake(false); }, 2500);
  }, []);
  useEffect(() => { wake(); return () => window.clearTimeout(idle.current); }, [wake]);

  const toggle = () => { const m = media.current; if (!m) return; if (m.paused) void m.play().catch(() => undefined); else m.pause(); wake(); };
  const seek = (value: number) => { const m = media.current; if (m && duration) { m.currentTime = value; setTime(value); } wake(); };
  const setVol = (value: number) => { const m = media.current; if (!m) return; m.volume = value; m.muted = value === 0; setVolume(value); setMuted(value === 0); wake(); };
  const mute = () => { const m = media.current; if (!m) return; m.muted = !m.muted; setMuted(m.muted); wake(); };
  const expand = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void frame.current?.requestFullscreen?.().catch(() => undefined); wake(); };

  const size = view.w ? fit(ratio, view.w, view.h) : { width: 0, height: 0 };
  const pct = duration ? (time / duration) * 100 : 0;
  const shown = awake || !playing;

  return (
    <dialog ref={dialog} aria-label={`${video.name} video player`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 m-0 grid h-dvh max-h-none w-screen max-w-none place-items-center border-0 bg-black/55 p-0 text-white backdrop-blur-[3px] backdrop:bg-black/20">
      <motion.div ref={frame} initial={reduced ? false : { opacity: 0, scale: 0.94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: reduced ? 1 : 0.97 }} transition={{ type: "spring", stiffness: 280, damping: 30 }}
        onMouseMove={wake} onTouchStart={wake} style={full ? undefined : { width: size.width, height: size.height }}
        className={`group relative overflow-hidden bg-black shadow-[0_30px_120px_-20px_rgba(0,0,0,0.9)] ${full ? "h-full w-full" : "rounded-2xl ring-1 ring-white/15"}`}>
        <video ref={media} src={video.url} poster={video.poster ?? undefined} autoPlay playsInline onClick={toggle}
          onLoadedMetadata={e => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight); setDuration(v.duration); }}
          onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setAwake(true)}
          className="absolute inset-0 size-full cursor-pointer object-contain" />

        <div className={`pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-2 bg-gradient-to-b from-black/45 to-transparent p-3 transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}>
          {video.characterId && <Link href={`/market/${video.characterId}`} className={`pointer-events-auto flex h-10 items-center gap-1 rounded-full px-4 text-xs font-medium transition hover:bg-white/20 ${glass}`}>Market <ArrowUpRight className="size-3.5" /></Link>}
          <button autoFocus onClick={onClose} aria-label="Close video" className={`pointer-events-auto grid size-10 place-items-center rounded-full transition hover:bg-white/20 ${glass}`}><X className="size-5" /></button>
        </div>

        {!playing && (
          <button onClick={toggle} aria-label="Play" className={`absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition hover:scale-105 hover:bg-white/20 ${glass}`}><Play className="size-7 translate-x-0.5 fill-white" /></button>
        )}

        <div className={`absolute inset-x-3 bottom-3 transition-all duration-300 ${shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}>
          <div className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${glass}`}>
            <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-black transition hover:scale-105">{playing ? <Pause className="size-4 fill-black" /> : <Play className="size-4 translate-x-px fill-black" />}</button>
            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-white/80">{clock(time)}</span>
            <input type="range" min={0} max={duration || 0} step={0.05} value={time} onChange={e => seek(Number(e.target.value))} aria-label="Seek"
              style={{ background: `linear-gradient(to right, #d7ff00 ${pct}%, rgba(255,255,255,0.22) ${pct}%)` }}
              className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(255,255,255,0.18)]" />
            <span className="w-9 shrink-0 text-[11px] tabular-nums text-white/55">{clock(duration)}</span>
            <div className="hidden items-center gap-2 sm:flex">
              <button onClick={mute} aria-label={muted ? "Unmute" : "Mute"} className="text-white/85 transition hover:text-white">{muted || volume === 0 ? <VolumeX className="size-[18px]" /> : <Volume2 className="size-[18px]" />}</button>
              <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume} onChange={e => setVol(Number(e.target.value))} aria-label="Volume"
                style={{ background: `linear-gradient(to right, #fff ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.22) ${(muted ? 0 : volume) * 100}%)` }}
                className="h-1 w-16 cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:size-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white" />
            </div>
            <button onClick={expand} aria-label={full ? "Exit fullscreen" : "Fullscreen"} className="text-white/85 transition hover:text-white">{full ? <Minimize className="size-[18px]" /> : <Maximize className="size-[18px]" />}</button>
          </div>
        </div>
      </motion.div>
    </dialog>
  );
}
