"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, Volume2, VolumeX } from "lucide-react";
import type { LiveVideo } from "./useLiveData";

const FALLBACK: LiveVideo = { id: "reel", url: "/hero-bg.mp4", name: "Solcameo", ticker: "", characterId: "", at: 0 };

/** Featured player: autoplays muted, advances when a chapter ends, sound is opt-in. */
export function FeaturedPlayer({ videos }: { videos: LiveVideo[] }) {
  const list = videos.length ? videos.slice(0, 8) : [FALLBACK];
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const current = list[index % list.length];
  const go = useCallback((d: number) => setIndex(i => (i + d + list.length) % list.length), [list.length]);
  useEffect(() => {
    const v = ref.current;
    if (!v || reduced) return;
    v.muted = muted;
    v.play().catch(() => { if (!v.muted) { setMuted(true); } });
  }, [current.url, muted, reduced]);
  const behind = [1, 2].map(k => list[(index + k) % list.length]).filter(b => list.length > 1 && b.poster);
  return <div className="relative mx-auto w-full max-w-[1400px] pt-10">
    {behind.map((b, k) => <div key={b.id} aria-hidden="true" className="absolute inset-x-0 top-0 mx-auto overflow-hidden rounded-[4px] border border-white/10 bg-cover bg-center blur-[1px]" style={{ width: `${94 - k * 7}%`, height: "calc(100% - 36px)", top: `${22 - k * 18}px`, backgroundImage: `url(${b.poster})`, opacity: 0.5 - k * 0.2, zIndex: 0 }}><div className="absolute inset-0 bg-black/55 backdrop-blur-md" /></div>)}
    <div className="relative z-10 aspect-[16/10] w-full overflow-hidden rounded-[4px] border border-white/10 bg-[#111] ring-1 ring-inset ring-white/[0.06] shadow-[0_50px_140px_-30px_rgba(215,255,0,0.22)]">
    <video ref={ref} key={current.url} src={current.url} poster={current.poster} muted={muted} playsInline autoPlay={!reduced} loop={list.length === 1} preload="metadata" onEnded={() => go(1)} className="absolute inset-0 size-full object-contain bg-black" />
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/80 to-transparent" />
    <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-6">
      <div className="min-w-0">
        {<Link href={current.characterId ? `/market/${current.characterId}` : "/explore"} className="group inline-flex max-w-full items-center gap-2 text-sm font-semibold text-white"><span className="truncate">{current.name}</span><span className="font-mono text-xs text-[#d7ff00]">{current.characterId ? "$" : ""}{current.ticker}</span><ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" /></Link>}
        {current.title && <p className="mt-0.5 truncate text-xs text-zinc-300">{current.title}</p>}
        {list.length > 1 && <div className="mt-3 flex gap-1.5" role="tablist" aria-label="Featured chapters">{list.map((v, i) => <button key={v.id} role="tab" aria-selected={i === index % list.length} aria-label={`Chapter ${i + 1}`} onClick={() => setIndex(i)} className={`h-1 rounded-full transition-all ${i === index % list.length ? "w-8 bg-[#d7ff00]" : "w-3 bg-white/30 hover:bg-white/60"}`} />)}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {list.length > 1 && <><button aria-label="Previous chapter" onClick={() => go(-1)} className="grid size-9 place-items-center rounded-full border border-white/15 bg-white/[0.1] text-white backdrop-blur-xl hover:bg-white/[0.18]"><ChevronLeft className="size-4" /></button><button aria-label="Next chapter" onClick={() => go(1)} className="grid size-9 place-items-center rounded-full border border-white/15 bg-white/[0.1] text-white backdrop-blur-xl hover:bg-white/[0.18]"><ChevronRight className="size-4" /></button></>}
        <button onClick={() => setMuted(m => !m)} aria-pressed={!muted} className="flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/[0.1] px-3.5 text-xs font-medium text-white backdrop-blur-xl hover:bg-white/[0.18]">{muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}{muted ? "Sound off" : "Sound on"}</button>
      </div>
    </div>
  </div></div>;
}

function Tile({ v, reduced }: { v: LiveVideo; reduced: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.play().catch(() => {}); else el.pause(); }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return <Link href={v.characterId ? `/market/${v.characterId}` : "/explore"} className="group relative block aspect-[9/16] w-[220px] shrink-0 snap-start overflow-hidden rounded-[3px] border border-white/10 bg-[#141414] sm:w-[260px]">
    <video ref={ref} src={v.url} poster={v.poster} muted loop playsInline preload="metadata" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
    <div className="absolute inset-x-2 bottom-2 rounded-[2px] border border-white/15 bg-white/[0.08] p-3 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"><p className="truncate text-sm font-bold uppercase tracking-wide text-white">{v.name}</p><p className="font-mono text-[11px] text-[#d7ff00]">{v.characterId ? "$" : ""}{v.ticker}</p></div>
  </Link>;
}

/** Horizontal snap carousel of live chapters. Tiles play only while in view. */
export function VideoCarousel({ videos, loading }: { videos: LiveVideo[]; loading: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const reduced = !!useReducedMotion();
  const scroll = (d: number) => track.current?.scrollBy({ left: d * 480, behavior: reduced ? "auto" : "smooth" });
  return <div>
    <div className="mb-5 flex items-center justify-end gap-2 px-6 md:px-12 lg:px-20">
      <button aria-label="Scroll videos left" onClick={() => scroll(-1)} className="grid size-9 place-items-center rounded-full border border-white/15 text-zinc-300 hover:bg-white/10"><ChevronLeft className="size-4" /></button>
      <button aria-label="Scroll videos right" onClick={() => scroll(1)} className="grid size-9 place-items-center rounded-full border border-white/15 text-zinc-300 hover:bg-white/10"><ChevronRight className="size-4" /></button>
    </div>
    <div ref={track} className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-6 px-6 pb-4 [scrollbar-width:none] md:scroll-px-12 md:px-12 lg:scroll-px-20 lg:px-20 [&::-webkit-scrollbar]:hidden">
      {loading ? [0, 1, 2, 3, 4, 5].map(i => <div key={i} className="aspect-[9/16] w-[200px] shrink-0 animate-pulse rounded-[3px] bg-white/[0.05] sm:w-[260px]" />)
        : videos.length ? videos.map(v => <Tile key={v.id} v={v} reduced={reduced} />)
        : <p className="py-10 text-sm text-zinc-500">The first chapters will appear here as characters publish.</p>}
    </div>
  </div>;
}
