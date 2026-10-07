"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, Repeat, Volume2, VolumeX } from "lucide-react";

const RATES = [0.5, 1, 1.5, 2] as const;
const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const whole = Math.floor(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};
/** Short clips are only a few seconds long, so show tenths to make the scrubber readable. */
const fmtPrecise = (s: number, total: number) => (total < 10 ? `${s.toFixed(1)}s` : fmt(s));

/**
 * The reference viewer: a glass control bar over the video with play, a scrubber you can drag, the elapsed and
 * total time, loop, speed, sound and fullscreen. Opening the viewer is a click, so it plays WITH sound on a loop; if the browser still
 * blocks audio it falls back to muted playback and the sound button turns it on.
 */
export function ReferencePlayer({ src, poster, aspectRatio, className = "", onError, onMetadata }: {
  src: string;
  poster?: string;
  aspectRatio?: string;
  className?: string;
  onError?: () => void;
  onMetadata?: (info: { width: number; height: number; duration: number }) => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [scrubbing, setScrubbing] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2600);
  }, []);
  useEffect(() => () => { if (idleTimer.current) clearTimeout(idleTimer.current); }, []);

  useEffect(() => { if (video.current) video.current.playbackRate = rate; }, [rate, src]);
  // Start with sound. Browsers allow it because the viewer was opened by a click; if one blocks it anyway, play muted instead.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = false;
    void v.play().catch(() => { v.muted = true; setMuted(true); void v.play().catch(() => undefined); });
  }, [src]);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const seekTo = (clientX: number) => {
    const v = video.current, bar = track.current;
    if (!v || !bar || !duration) return;
    const { left, width } = bar.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - left) / width)) * duration;
    v.currentTime = t;
    setTime(t);
  };
  const progress = duration ? (time / duration) * 100 : 0;
  const button = "grid size-8 place-items-center rounded-[6px] text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50";

  return (
    <div
      ref={shell}
      onMouseMove={wake}
      onMouseLeave={() => playing && setIdle(true)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key.toLowerCase() === "k") { e.preventDefault(); toggle(); }
        else if (e.key === "ArrowRight" && video.current) video.current.currentTime = Math.min(duration, video.current.currentTime + 1);
        else if (e.key === "ArrowLeft" && video.current) video.current.currentTime = Math.max(0, video.current.currentTime - 1);
        else if (e.key.toLowerCase() === "m") setMuted((m) => !m);
        wake();
      }}
      tabIndex={0}
      aria-label="Reference video player"
      className={`group/player relative mx-auto overflow-hidden rounded-[10px] bg-black outline-none ring-1 ring-white/10 focus-visible:ring-2 focus-visible:ring-white/40 ${className}`}
      style={{ aspectRatio }}
    >
      <video
        ref={video}
        key={src}
        src={src}
        poster={poster}
        autoPlay
        muted={muted}
        loop={loop}
        playsInline
        preload="metadata"
        onClick={toggle}
        onError={onError}
        onPlay={() => { setPlaying(true); wake(); }}
        onPause={() => { setPlaying(false); setIdle(false); }}
        onTimeUpdate={(e) => { if (!scrubbing) setTime(e.currentTarget.currentTime); }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(Number.isFinite(v.duration) ? v.duration : 0);
          if (v.videoWidth > 0 && v.videoHeight > 0) onMetadata?.({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
        }}
        className="size-full cursor-pointer object-contain"
      />

      {/* Centre play button while paused. */}
      {!playing && (
        <button type="button" onClick={toggle} aria-label="Play" className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/45 text-white shadow-[0_10px_40px_-8px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <Play className="ml-0.5 size-6 fill-current" />
        </button>
      )}

      {/* Glass control bar. */}
      <div className={`absolute inset-x-2 bottom-2 rounded-[10px] border border-white/15 bg-black/45 px-2 pb-1.5 pt-2 shadow-[0_14px_40px_-12px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl transition-all duration-300 ${idle && playing ? "pointer-events-none translate-y-2 opacity-0" : "opacity-100"}`}>
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 10) / 10}
          aria-valuenow={Math.round(time * 10) / 10}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setScrubbing(true); seekTo(e.clientX); }}
          onPointerMove={(e) => { if (scrubbing) seekTo(e.clientX); }}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
          className="group/seek relative mx-1 flex h-4 cursor-pointer touch-none items-center"
        >
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/seek:h-[5px]">
            <div className="h-full rounded-full bg-white" style={{ width: `${progress}%` }} />
          </div>
          <span className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.18)] transition-transform group-hover/seek:scale-125" style={{ left: `${progress}%` }} />
        </div>
        <div className="mt-0.5 flex items-center gap-0.5">
          <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className={button}>
            {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
          </button>
          <span className="ml-1 text-[11px] font-medium tabular-nums text-white/85">
            {fmtPrecise(time, duration)} <span className="text-white/40">/ {fmtPrecise(duration, duration)}</span>
          </span>
          <span className="flex-1" />
          <button type="button" onClick={() => setRate((r) => RATES[(RATES.indexOf(r) + 1) % RATES.length])} aria-label={`Playback speed ${rate}x`} title="Playback speed"
            className={`${button} w-auto px-2 text-[11px] font-semibold tabular-nums`}>{rate}×</button>
          <button type="button" onClick={() => setLoop((l) => !l)} aria-pressed={loop} aria-label="Loop" title="Loop" className={`${button} ${loop ? "bg-white/15 !text-white" : ""}`}><Repeat className="size-4" /></button>
          <button type="button" onClick={() => setMuted((m) => !m)} aria-pressed={!muted} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"} className={button}>
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <button type="button" onClick={() => { const el = shell.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); }} aria-label="Fullscreen" title="Fullscreen" className={button}><Maximize2 className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}
