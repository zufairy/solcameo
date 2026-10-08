"use client";
/* eslint-disable @next/next/no-img-element -- remote posters */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronUp, Play, Volume2, VolumeX } from "lucide-react";

export type ReelVideo = { id: string; url: string; poster?: string | null; name: string; ticker?: string; cap?: string; xPostUrl?: string; characterId: string | null; at: number };

/** Only the active slide and its neighbours mount a <video>; the rest show the poster, so a long feed stays light. */
const MOUNT_RADIUS = 1;

function Slide({ v, active, mounted, muted, onToggleMute }: { v: ReelVideo; active: boolean; mounted: boolean; muted: boolean; onToggleMute: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);

  // The active slide plays; any other slide is held paused.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (active && !paused) {
      el.muted = muted;
      // Browsers can refuse sound before a tap: fall back to muted playback rather than a frozen frame.
      void el.play().catch(() => { el.muted = true; void el.play().catch(() => undefined); });
    } else {
      el.pause();
    }
  }, [active, paused, muted, mounted]);
  // Leaving a slide rewinds it so it starts fresh when scrolled back to.
  useEffect(() => {
    if (active) return;
    setPaused(false); // eslint-disable-line react-hooks/set-state-in-effect
    const el = video.current;
    if (el) el.currentTime = 0;
  }, [active]);

  return (
    <section className="relative size-full shrink-0 snap-start snap-always overflow-hidden bg-[#202326]" aria-label={v.name}>
      {v.poster && <img src={v.poster} alt="" className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${ready && active ? "opacity-0" : "opacity-100"}`} />}
      {mounted && (
        <video
          ref={video}
          src={v.url}
          loop
          muted={muted}
          playsInline
          preload={active ? "auto" : "metadata"}
          onLoadedData={() => setReady(true)}
          onTimeUpdate={(e) => { const el = e.currentTarget; if (bar.current && el.duration) bar.current.style.width = `${(el.currentTime / el.duration) * 100}%`; }}
          className="absolute inset-0 size-full object-cover"
        />
      )}

      {/* Tap anywhere to pause / resume. */}
      <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play video" : "Pause video"} className="absolute inset-0 z-10 size-full cursor-pointer" />
      {paused && <span className="pointer-events-none absolute left-1/2 top-1/2 z-20 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md"><Play className="ml-1 size-7" fill="currentColor" /></span>}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-2/5 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 pb-5">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#d7ff00]">{v.ticker ? `$${v.ticker}` : "AI creator"}</p>
        <h2 className="mt-1 break-words text-2xl font-semibold leading-tight tracking-[-0.03em] text-white">{v.name}</h2>
        <div className="pointer-events-auto mt-3 flex flex-wrap items-center gap-2">
          {v.cap && <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tabular-nums text-white backdrop-blur-md">MCap {v.cap}</span>}
          {v.characterId && <Link href={`/market/${v.characterId}`} className="inline-flex h-7 items-center gap-1 rounded-full bg-[#d7ff00] px-3 text-xs font-semibold text-black transition hover:bg-[#e4ff59]">Trade <ArrowUpRight className="size-3" /></Link>}
          {v.xPostUrl && <a href={v.xPostUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-full bg-white/15 px-3 text-xs font-medium text-white backdrop-blur-md transition hover:bg-white/25">View on X <ArrowUpRight className="size-3" /></a>}
        </div>
      </div>

      <button type="button" onClick={onToggleMute} aria-label={muted ? "Unmute" : "Mute"} className="absolute right-3 top-3 z-30 grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65">
        {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      </button>
      <div className="absolute inset-x-0 bottom-0 z-30 h-[3px] bg-white/20"><div ref={bar} className="h-full w-0 bg-[#d7ff00]" /></div>
    </section>
  );
}

/** TikTok-style feed: one video at a time, snap scrolling, autoplay on the focused clip, controls to the side on desktop. */
export function MakeReels({ videos }: { videos: ReelVideo[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const count = videos.length;

  // The slide that covers most of the scroller is the focused one.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setIndex(Number((e.target as HTMLElement).dataset.i));
    }, { root, threshold: 0.6 });
    root.querySelectorAll("[data-i]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [count]);

  const go = useCallback((to: number) => {
    const root = scroller.current;
    if (!root) return;
    const next = Math.max(0, Math.min(count - 1, to));
    root.scrollTo({ top: next * root.clientHeight, behavior: "smooth" });
  }, [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if ((t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); go(index + 1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); go(index - 1); }
      else if (e.key === "m") setMuted((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  const upNext = videos.slice(index + 1, index + 4);
  const frame = "h-[min(calc(100dvh-11rem),800px)] min-h-[420px]";

  return (
    <div className="flex items-start gap-6">
      <div ref={scroller} className={`${frame} aspect-[9/16] max-w-full shrink-0 snap-y snap-mandatory overflow-y-scroll overscroll-contain rounded-2xl bg-black ring-1 ring-white/10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:aspect-auto max-sm:w-full`}>
        {videos.map((v, i) => (
          <div key={v.id} data-i={i} className="h-full">
            <Slide v={v} active={i === index} mounted={Math.abs(i - index) <= MOUNT_RADIUS} muted={muted} onToggleMute={() => setMuted((m) => !m)} />
          </div>
        ))}
      </div>

      <aside className={`${frame} hidden w-64 shrink-0 flex-col justify-between lg:flex`}>
        <div className="flex gap-2">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous video" className="grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"><ChevronUp className="size-5" /></button>
          <button type="button" onClick={() => go(index + 1)} disabled={index >= count - 1} aria-label="Next video" className="grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"><ChevronDown className="size-5" /></button>
          <span className="ml-auto self-center font-mono text-xs tabular-nums text-zinc-500">{index + 1} / {count}</span>
        </div>

        {upNext.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Up next</p>
            <div className="grid grid-cols-3 gap-2">
              {upNext.map((v, i) => (
                <button key={v.id} type="button" onClick={() => go(index + 1 + i)} aria-label={`Go to ${v.name}`} className="relative aspect-[9/16] overflow-hidden rounded-lg bg-[#202326] ring-1 ring-white/10 transition hover:ring-white/40">
                  {v.poster && <img src={v.poster} alt="" loading="lazy" className="size-full object-cover" />}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] leading-5 text-zinc-600">Scroll or press <kbd className="rounded bg-white/10 px-1">↑</kbd> <kbd className="rounded bg-white/10 px-1">↓</kbd>. <kbd className="rounded bg-white/10 px-1">M</kbd> toggles sound. Tap a video to pause.</p>
      </aside>
    </div>
  );
}
