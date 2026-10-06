"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { Play } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelErrorBoundary } from "./feedShared";

type Video = { id: string; url: string; poster?: string | null; name: string; characterId: string | null; at: number };

/** Stand-in while nothing has been published: this coin's episodes, so the page is never empty. */
const FALLBACK_CHARACTER = "sn7e3nb82dfcpep6sey2hqdc0n8fqz9w";
/** Masonry rhythm: a stable, mixed set of frame shapes so the wall isn't a uniform grid. */
const ASPECTS = ["9 / 16", "4 / 5", "9 / 16", "1 / 1", "3 / 4", "9 / 16"];
function aspectFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ASPECTS[h % ASPECTS.length];
}

/** True once the element has come within `margin` of the viewport; never flips back, so a loaded clip stays loaded. */
function useNearViewport<T extends Element>(margin = "600px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near] as const;
}

function VideoCard({ v, index }: { v: Video; index: number }) {
  const reduced = useReducedMotion();
  const [ref, near] = useNearViewport<HTMLElement>();
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState(false);
  const play = () => { setHover(true); const el = video.current; if (el) { el.preload = "auto"; void el.play().catch(() => undefined); } };
  const stop = () => { setHover(false); const el = video.current; if (el) { el.pause(); el.currentTime = 0.001; } };
  const frame = (
    <div className="relative size-full overflow-hidden bg-[#202326]">
      {/* Lazy: nothing is fetched until the card nears the screen; the poster covers the gap. */}
      {v.poster && (
        // eslint-disable-next-line @next/next/no-img-element -- remote poster, lazy
        <img src={v.poster} alt="" loading="lazy" className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${ready && hover ? "opacity-0" : "opacity-100"}`} />
      )}
      {!ready && <Skeleton className="absolute inset-0 rounded-none bg-white/[0.05]" />}
      {near && (
        <video
          ref={video}
          src={v.url}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={(e) => { setReady(true); const el = e.currentTarget; if (el.paused && el.currentTime === 0) el.currentTime = 0.001; }}
          className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
      )}
      {/* Info overlay: appears on hover. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-12 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="truncate text-[13px] font-bold uppercase tracking-wide text-white">{v.name}</span>
        <time dateTime={new Date(v.at).toISOString()} className="shrink-0 text-[10px] text-white/60">
          {new Date(v.at).toLocaleDateString([], { month: "short", day: "numeric" })}
        </time>
      </div>
      <span aria-hidden className={`pointer-events-none absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-[5px] bg-black/55 text-white backdrop-blur-sm transition-opacity duration-300 ${hover ? "opacity-0" : "opacity-100"}`}>
        <Play className="size-3 fill-current" />
      </span>
    </div>
  );
  const shell = "group relative mb-4 block break-inside-avoid overflow-hidden rounded-[6px] ring-1 ring-white/10 outline-none transition-[box-shadow,transform] duration-300 hover:ring-white/30 focus-visible:ring-2 focus-visible:ring-white/60";
  return (
    <motion.article
      ref={ref}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ type: "spring", stiffness: 300, damping: 28, delay: Math.min((index % 8) * 0.04, 0.3) }}
      onMouseEnter={play}
      onMouseLeave={stop}
      onFocus={play}
      onBlur={stop}
      style={{ aspectRatio: aspectFor(v.id) }}
      className={shell}
    >
      {v.characterId ? (
        <Link href={`/market/${v.characterId}`} aria-label={`${v.name} — open market`} className="absolute inset-0 block">{frame}</Link>
      ) : (
        <div className="absolute inset-0">{frame}</div>
      )}
    </motion.article>
  );
}

function Content() {
  const episodes = useQuery(api.solstarDiscovery.latestVideos, {});
  const created = useQuery(api.clipJobs.globalVideoFeed, { limit: 200, kind: "ugc" });
  const all: Video[] = [
    ...(episodes ?? [])
      .filter((e) => !e.sample)
      .map((e) => ({ id: String(e.id), url: e.videoUrl, poster: e.posterUrl, name: e.name, characterId: String(e.characterId), at: e.createdAt })),
    ...(created?.items ?? []).map((e) => ({ id: e.id, url: e.videoUrl, poster: e.posterUrl, name: e.agentName ?? "AI creator", characterId: null, at: e.createdAt })),
  ];
  const seen = new Set<string>();
  const videos = all.filter((v) => v.url && !seen.has(v.url) && !!seen.add(v.url)).sort((a, b) => b.at - a.at);
  const loaded = episodes !== undefined && created !== undefined;
  const fallback = useQuery(api.solstarMarket.terminal, loaded && videos.length === 0 ? { characterId: FALLBACK_CHARACTER as Id<"ssCharacters"> } : "skip");
  const fallbackVideos = useMemo<Video[]>(() => {
    if (!fallback) return [];
    return fallback.episodes
      .filter((e) => e.videoUrl)
      .map((e) => ({ id: `ep-${e._id}`, url: e.videoUrl, poster: e.posterUrl || null, name: fallback.character.name, characterId: String(fallback.character._id), at: e.createdAt }));
  }, [fallback]);
  const shown = videos.length ? videos : fallbackVideos;
  return (
    <main className="min-h-full bg-[#181a1c] px-4 py-6 lg:px-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-100">Videos</h1>
      {!loaded ? (
        <div className="columns-2 gap-4 md:columns-3 xl:columns-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} style={{ aspectRatio: ASPECTS[i % ASPECTS.length] }} className="mb-4 w-full rounded-[6px] bg-white/5" />
          ))}
        </div>
      ) : !shown.length ? (
        <p className="py-12 text-sm text-zinc-500">Created videos will appear here.</p>
      ) : (
        <div className="columns-2 gap-4 md:columns-3 xl:columns-4 2xl:columns-5">
          {shown.map((v, i) => (
            <VideoCard key={v.id} v={v} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
export function MakeFeed() {
  return (
    <PanelErrorBoundary message="The video feed is unavailable. Refresh to reconnect.">
      <Content />
    </PanelErrorBoundary>
  );
}
