"use client";
import { MAINNET_ONLY } from "@/lib/solstar/liveNetwork";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { MakeVideoPlayer } from "./MakeVideoPlayer";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelErrorBoundary } from "./feedShared";

type Video = { id: string; url: string; poster?: string | null; name: string; ticker?: string; cap?: string; xPostUrl?: string; characterId: string | null; at: number };

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

function VideoCard({ v, index, onOpen }: { v: Video; index: number; onOpen: () => void }) {
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[65%] bg-gradient-to-t from-[#c7ff39]/95 via-[#a3e635]/55 to-transparent" />
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 p-4 text-[#112008] sm:p-5 ${v.xPostUrl ? "pb-11 sm:pb-12" : ""}`}>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em]">{v.ticker ? `$${v.ticker}` : "AI creator"}</p>
        <h2 className="break-words text-[clamp(1.35rem,2.5vw,2.4rem)] font-semibold leading-[1.05] tracking-[-0.055em]">{v.name}</h2>
        <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-black/15 pt-2"><span className="text-[10px] font-semibold uppercase tracking-wider">Market cap</span><span className="text-sm font-bold tabular-nums sm:text-lg">{v.cap ?? "—"}</span></div>
      </div>
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
      <button type="button" onClick={() => { stop(); onOpen(); }} aria-label={`Play ${v.name} video`} className="absolute inset-0 block size-full text-left">{frame}</button>
      {v.xPostUrl && <a href={v.xPostUrl} target="_blank" rel="noopener noreferrer" aria-label={`View ${v.name} post on X`} className="absolute bottom-3 left-4 z-10 inline-flex items-center gap-1 text-[11px] font-medium text-[#112008]/80 underline decoration-black/30 underline-offset-4 transition hover:text-black focus-visible:rounded focus-visible:outline-2 focus-visible:outline-black sm:bottom-4 sm:left-5">View on X <ArrowUpRight className="size-3" /></a>}
    </motion.article>
  );
}

function Content() {
  const [selected, setSelected] = useState<Video | null>(null);
  const solUsd = useSolUsd();
  const mainnet = useQuery(api.solstarMarket.listMarket, { sort: "mcap", network: "mainnet" });
  const devnet = useQuery(api.solstarMarket.listMarket, MAINNET_ONLY ? "skip" : { sort: "mcap", network: "devnet" });
  const paper = useQuery(api.solstarMarket.listMarket, MAINNET_ONLY ? "skip" : { sort: "mcap", network: "paper" });
  const markets = useMemo(() => new Map([...(mainnet ?? []), ...(devnet ?? []), ...(paper ?? [])].map(row => [String(row.characterId), row])), [mainnet, devnet, paper]);
  const [caps, setCaps] = useState<Record<string, number>>({});
  const episodes = useQuery(api.solstarDiscovery.latestVideos, { network: "mainnet" });
  const created = useQuery(api.clipJobs.globalVideoFeed, { limit: 200, kind: "ugc" });
  const xPosts = new Map((created?.items ?? []).flatMap(item => {
    if (item.state !== "posted" || !item.postUrl) return [];
    try {
      const url = new URL(item.postUrl);
      return url.protocol === "https:" && ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) && /^\/[^/]+\/status\/\d+/.test(url.pathname) ? [[item.videoUrl, url.href] as const] : [];
    } catch { return []; }
  }));
  const all: Video[] = [
    ...(episodes ?? [])
      .filter((e) => !e.sample)
      .map((e) => ({ id: String(e.id), url: e.videoUrl, poster: e.posterUrl, name: e.name, ticker: e.ticker, characterId: String(e.characterId), at: e.createdAt })),
    ...(created?.items ?? []).filter((e) => e.characterId && markets.has(String(e.characterId))).map((e) => ({ id: e.id, url: e.videoUrl, poster: e.posterUrl, name: e.agentName ?? "AI creator", characterId: String(e.characterId), at: e.createdAt })),
  ];
  const seen = new Set<string>();
  const videos = all.filter((v) => v.url && !seen.has(v.url) && !!seen.add(v.url)).sort((a, b) => b.at - a.at);
  const loaded = episodes !== undefined && created !== undefined;
  const fallback = useQuery(api.solstarMarket.terminal, loaded && videos.length === 0 ? { characterId: FALLBACK_CHARACTER as Id<"ssCharacters"> } : "skip");
  const fallbackVideos = useMemo<Video[]>(() => {
    if (!fallback) return [];
    return fallback.episodes
      .filter((e) => e.videoUrl)
      .map((e) => ({ id: `ep-${e._id}`, url: e.videoUrl, poster: e.posterUrl || null, name: fallback.character.name, ticker: fallback.token.ticker, characterId: String(fallback.character._id), at: e.createdAt }));
  }, [fallback]);
  const shown = (videos.length ? videos : fallbackVideos).map(video => {
    const market = video.characterId ? markets.get(video.characterId) : undefined;
    const cap = video.characterId ? caps[video.characterId] : undefined;
    return { ...video, xPostUrl: xPosts.get(video.url), ticker: market?.ticker ?? video.ticker, cap: cap !== undefined ? formatUsdEstimate(String(Math.round(cap * 1e9)), solUsd) : market?.network === "paper" ? formatUsdEstimate(market.marketCapLamports, solUsd) : undefined };
  });
  const poolIds = [...new Set(shown.filter(video => video.characterId && markets.get(video.characterId)?.dbcPool).map(video => video.characterId!))].sort().join(",");
  useEffect(() => {
    if (!poolIds) return;
    const controller = new AbortController();
    const ids = new Set(poolIds.split(","));
    const seenMigrated = new Set<string>();
    let busy = false;
    let tick = 0;
    const put = (id: string, capSol: unknown) => { if (typeof capSol === "number" && Number.isFinite(capSol) && !controller.signal.aborted) setCaps(previous => previous[id] === capSol ? previous : { ...previous, [id]: capSol }); };
    // One batched Solana RPC read for every coin (shared 3s server cache), so caps move with the chain.
    const live = async () => {
      const response = await fetch("/api/tokenomics/live", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { coins?: { characterId: string; capSol: number | null; migrated: boolean }[] };
      for (const coin of data.coins ?? []) {
        if (!ids.has(coin.characterId)) continue;
        if (coin.migrated) seenMigrated.add(coin.characterId); else put(coin.characterId, coin.capSol);
      }
    };
    // Graduated coins trade on DAMM, which the batched read doesn't price: ask the pool route, but less often.
    const graduated = async () => {
      await Promise.allSettled([...seenMigrated].map(async id => {
        const response = await fetch(`/api/meteora/pool?characterId=${encodeURIComponent(id)}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (data.available) put(id, data.capSol);
      }));
    };
    const refresh = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        await live().catch(() => undefined);
        if (tick++ % 3 === 0) await graduated();
      } finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3_000);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("solcameo:trade-confirmed", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [poolIds]);
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
            <VideoCard key={v.id} v={v} index={i} onOpen={() => setSelected(v)} />
          ))}
        </div>
      )}
      <AnimatePresence>{selected && <MakeVideoPlayer key={selected.id} video={shown.find(video => video.id === selected.id) ?? selected} onClose={() => setSelected(null)} />}</AnimatePresence>
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
