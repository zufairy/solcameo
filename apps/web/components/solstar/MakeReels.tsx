"use client";
/* eslint-disable @next/next/no-img-element -- remote posters */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronUp, Globe, Info, MessageCircle, Play, Volume2, VolumeX, X } from "lucide-react";
import { VideoChat } from "./VideoChat";

export type ReelCoin = { state: string; network: string; changeBps: number; volume?: string; holders: number | null; followers: number; videos: number; xUrl?: string; websiteUrl?: string; sparkline: string[] };
export type ReelVideo = { id: string; url: string; poster?: string | null; name: string; ticker?: string; cap?: string; xPostUrl?: string; characterId: string | null; at: number; coin?: ReelCoin };

/** Only the focused slide and its neighbours mount a <video>; the rest show the poster, so a long feed stays light. */
const MOUNT_RADIUS = 1;
const GAP = 12; // space between slides
const PEEK = 76; // how much of the next video shows under the focused one
const RAIL = 44; // up / down column between the video and the side panel
const DESKTOP = 1024;

/** Fit the stage to the screen: everything from its top edge to the bottom of the viewport. */
function useFit(ref: React.RefObject<HTMLDivElement | null>) {
  const [fit, setFit] = useState({ height: 640, desktop: true });
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setFit({ height: Math.max(460, Math.round(window.innerHeight - top - 16)), desktop: window.innerWidth >= DESKTOP });
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); };
  }, [ref]);
  return fit;
}

function Sparkline({ points, up }: { points: string[]; up: boolean }) {
  const nums = points.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return null;
  const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
  const d = nums.map((n, i) => `${(i / (nums.length - 1)) * 100},${26 - ((n - min) / span) * 24}`).join(" ");
  return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-8 w-full" aria-hidden><polyline points={d} fill="none" strokeWidth="1.6" vectorEffect="non-scaling-stroke" className={up ? "stroke-emerald-400" : "stroke-rose-400"} /></svg>;
}

/** Coin info for the focused video: who it is, where its price is, and the way to trade it. */
function CoinCard({ v }: { v: ReelVideo }) {
  const c = v.coin;
  const up = (c?.changeBps ?? 0) >= 0;
  const stats: [string, string, string?][] = [
    ["Market cap", v.cap ?? "—"],
    ["24h", c ? `${up ? "+" : ""}${(c.changeBps / 100).toFixed(1)}%` : "—", c ? (up ? "text-emerald-400" : "text-rose-400") : undefined],
    ["24h volume", c?.volume ?? "—"],
    ["Holders", c?.holders != null ? c.holders.toLocaleString() : "—"],
  ];
  return (
    <section aria-label="Coin info" className="shrink-0 rounded-2xl border border-white/[0.12] bg-[linear-gradient(160deg,rgba(255,255,255,0.1),rgba(255,255,255,0.03))] p-3.5 backdrop-blur-2xl">
      <div className="flex items-center gap-3">
        {v.poster ? <img src={v.poster} alt="" className="size-11 shrink-0 rounded-xl object-cover ring-1 ring-white/15" /> : <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 font-bold text-white">{v.name.slice(0, 1).toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight text-white">{v.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[#d7ff00]">
            {v.ticker ? `$${v.ticker}` : "AI creator"}
            {c && <span className="rounded bg-white/10 px-1.5 py-px text-[9.5px] font-semibold text-zinc-300">{c.network === "paper" ? "Paper" : c.state}</span>}
          </p>
        </div>
        {v.characterId && <Link href={`/market/${v.characterId}`} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-[#d7ff00] px-4 text-[13px] font-semibold text-black transition hover:bg-[#e4ff59]">Trade <ArrowUpRight className="size-3.5" /></Link>}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {stats.map(([label, value, tone]) => (
          <div key={label} className="min-w-0 rounded-lg bg-black/25 px-2 py-1.5">
            <p className="truncate text-[9.5px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
            <p className={`mt-0.5 truncate text-[13px] font-semibold tabular-nums ${tone ?? "text-white"}`}>{value}</p>
          </div>
        ))}
      </div>
      {c && c.sparkline.length > 1 && <div className="mt-2"><Sparkline points={c.sparkline} up={up} /></div>}
      {(c || v.xPostUrl) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-zinc-400">
          {c && <span>{c.followers.toLocaleString()} followers · {c.videos}{c.videos >= 10 ? "+" : ""} videos</span>}
          <span className="ml-auto flex items-center gap-3">
            {v.xPostUrl && <a href={v.xPostUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-white">This post <ArrowUpRight className="size-3" /></a>}
            {c?.xUrl && <a href={c.xUrl} target="_blank" rel="noopener noreferrer" aria-label="X profile" className="hover:text-white"><X className="size-3.5" /></a>}
            {c?.websiteUrl && <a href={c.websiteUrl} target="_blank" rel="noopener noreferrer" aria-label="Website" className="hover:text-white"><Globe className="size-3.5" /></a>}
          </span>
        </div>
      )}
    </section>
  );
}

function Slide({ v, active, next, mounted, muted, desktop, onToggleMute, onPanel }: { v: ReelVideo; active: boolean; next: boolean; mounted: boolean; muted: boolean; desktop: boolean; onToggleMute: () => void; onPanel: (tab: "chat" | "coin") => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);

  // The focused slide plays; any other slide is held paused.
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
    <section className={`relative size-full origin-top overflow-hidden rounded-2xl bg-[#202326] ring-1 transition-[opacity,transform] duration-300 ${active ? "opacity-100 ring-white/15" : "scale-[0.97] opacity-60 ring-white/5"}`} aria-label={v.name}>
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
      {next && <span className="pointer-events-none absolute left-3 top-3 z-20 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur-md">Up next</span>}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 pb-5">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#d7ff00]">{v.ticker ? `$${v.ticker}` : "AI creator"}</p>
        <h2 className="mt-0.5 break-words text-xl font-semibold leading-tight tracking-[-0.03em] text-white">{v.name}</h2>
        {v.cap && <p className="mt-1 text-xs font-medium tabular-nums text-white/70">MCap {v.cap}</p>}
      </div>

      {active && (
        <div className="absolute right-3 top-3 z-30 flex flex-col gap-2">
          <button type="button" onClick={onToggleMute} aria-label={muted ? "Unmute" : "Mute"} className="grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65">
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          {!desktop && (
            <>
              <button type="button" onClick={() => onPanel("chat")} aria-label="Open chat" className="grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"><MessageCircle className="size-5" /></button>
              <button type="button" onClick={() => onPanel("coin")} aria-label="Coin info" className="grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"><Info className="size-5" /></button>
            </>
          )}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 z-30 h-[3px] bg-white/20"><div ref={bar} className="h-full w-0 bg-[#d7ff00]" /></div>
    </section>
  );
}

/**
 * Focus feed: the page is one screen. The focused video autoplays at full height with the next one peeking underneath,
 * and beside it sit the coin's numbers and the live chat for exactly that video. On phones the panel is a sheet.
 */
export function MakeReels({ videos }: { videos: ReelVideo[] }) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const { height, desktop } = useFit(root);
  const [index, setIndex] = useState(0);
  const [chatIndex, setChatIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [sheet, setSheet] = useState<"chat" | "coin" | null>(null);
  const count = videos.length;
  const slideH = height - PEEK;

  // The slide that covers most of the scroller is the focused one.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setIndex(Number((e.target as HTMLElement).dataset.i));
    }, { root: el, threshold: 0.6 });
    el.querySelectorAll("[data-i]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [count]);

  // The chat follows the video after a short pause, so flicking through clips doesn't reconnect it on every one.
  useEffect(() => {
    const t = setTimeout(() => setChatIndex(index), 250);
    return () => clearTimeout(t);
  }, [index]);

  const go = useCallback((to: number) => {
    const el = scroller.current;
    const target = el?.querySelector<HTMLElement>(`[data-i="${Math.max(0, Math.min(count - 1, to))}"]`);
    if (el && target) el.scrollTo({ top: target.offsetTop - el.offsetTop, behavior: "smooth" });
  }, [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if ((t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); go(index + 1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); go(index - 1); }
      else if (e.key === "m") setMuted((m) => !m);
      else if (e.key === "Escape") setSheet(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  const focus = videos[index];
  const chatVideo = videos[chatIndex] ?? focus;
  const stageW = desktop ? Math.round((slideH * 9) / 16) : undefined;

  return (
    <div ref={root} className="flex items-start gap-3 lg:gap-4" style={{ height }}>
      <div className="relative min-w-0 shrink-0 max-lg:w-full" style={{ width: stageW }}>
        <div ref={scroller} className="relative snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ height }}>
          {videos.map((v, i) => (
            <div key={v.id} data-i={i} className="snap-start snap-always" style={{ height: slideH + GAP, paddingBottom: GAP }}>
              <Slide v={v} active={i === index} next={i === index + 1} mounted={Math.abs(i - index) <= MOUNT_RADIUS} muted={muted} desktop={desktop}
                onToggleMute={() => setMuted((m) => !m)} onPanel={setSheet} />
            </div>
          ))}
          <div aria-hidden style={{ height: PEEK }} />
        </div>
      </div>

      {desktop && (
        <>
          <div className="flex shrink-0 flex-col items-center justify-center gap-2 self-stretch" style={{ width: RAIL, paddingBottom: PEEK }}>
            <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous video" className="grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"><ChevronUp className="size-5" /></button>
            <span className="font-mono text-[11px] tabular-nums text-zinc-500">{index + 1}/{count}</span>
            <button type="button" onClick={() => go(index + 1)} disabled={index >= count - 1} aria-label="Next video" className="grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"><ChevronDown className="size-5" /></button>
          </div>
          <aside className="flex h-full min-w-0 max-w-[460px] flex-1 flex-col gap-3">
            {focus && <CoinCard v={focus} />}
            {chatVideo && <VideoChat key={chatVideo.url} videoKey={chatVideo.url} characterId={chatVideo.characterId} className="min-h-0 flex-1 rounded-2xl" />}
          </aside>
        </>
      )}

      {!desktop && sheet && focus && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setSheet(null)}>
          <div className="flex h-[72dvh] flex-col gap-3 rounded-t-3xl bg-[#14161a] p-3 pb-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={sheet === "chat" ? "Chat" : "Coin info"}>
            <div className="flex items-center gap-2">
              {(["chat", "coin"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setSheet(t)} className={`h-8 rounded-full px-4 text-xs font-semibold ${sheet === t ? "bg-white text-black" : "bg-white/10 text-zinc-300"}`}>{t === "coin" ? "Coin" : "Chat"}</button>
              ))}
              <button type="button" onClick={() => setSheet(null)} aria-label="Close" className="ml-auto grid size-8 place-items-center rounded-full bg-white/10 text-white"><X className="size-4" /></button>
            </div>
            {sheet === "coin" ? <CoinCard v={focus} /> : <VideoChat key={focus.url} videoKey={focus.url} characterId={focus.characterId} className="min-h-0 flex-1 rounded-2xl" />}
          </div>
        </div>
      )}
    </div>
  );
}
