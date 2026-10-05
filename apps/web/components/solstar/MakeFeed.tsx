"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowTopRightIcon, SpeakerOffIcon, SpeakerLoudIcon } from "@radix-ui/react-icons";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedPanel } from "./FeedPanel";
import { LiveValue } from "./MarketTable";
import { PanelErrorBoundary } from "./feedShared";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";

type Episode = FunctionReturnType<typeof api.solstarDiscovery.latestVideos>[number];
function VideoPost({ episode }: { episode: Episode }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void el.play().catch(() => {}); else el.pause(); }, {threshold: .65});
    observer.observe(el);
    return () => { observer.disconnect(); el.pause(); };
  }, []);
  return <article className="relative mx-auto aspect-[9/16] w-full max-w-[380px] snap-start overflow-hidden rounded-lg bg-black">
    <video ref={ref} src={episode.videoUrl} poster={episode.posterUrl} playsInline loop muted={muted} controls preload="metadata" className="size-full object-cover" aria-label={episode.title} />
    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-transparent to-black/30" />
    <span className="absolute left-3 top-3 rounded bg-black/50 px-2 py-1 text-[10px] text-white">{episode.sample ? "Sample video" : "Latest episode"} · {episode.network}</span>
    <Button variant="ghost" size="icon-sm" aria-label={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)} className="absolute right-3 top-3 rounded-full bg-black/50 text-white">{muted ? <SpeakerOffIcon /> : <SpeakerLoudIcon />}</Button>
    <div className="absolute bottom-8 left-4 right-4"><Link href={`/market/${episode.characterId}`} className="text-sm font-semibold text-white">@{episode.name} <span className="text-[#d7ff00]">${episode.ticker}</span></Link><p className="mt-2 text-xs leading-5 text-zinc-200">{episode.title}</p><Button nativeButton={false} render={<Link href={`/market/${episode.characterId}`} />} className="mt-3 h-8 w-full rounded-md bg-[#d7ff00] text-black hover:bg-[#e3ff5c]" size="sm">Open character market <ArrowTopRightIcon /></Button></div>
  </article>;
}
type Pool = {available:boolean; capSol?:number; appVolume24hLamports?:string};
function CoinBoard() {
  const rows = useQuery(api.solstarMarket.listMarket, {sort:"new",network:"devnet",liveOnly:true});
  const [pools, setPools] = useState<Record<string, Pool>>({});
  const rate = useSolUsd();
  const reduced = useReducedMotion();
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const observations = await Promise.all((rows ?? []).slice(0,30).map(async row => {
        try { const response = await fetch(`/api/meteora/pool?characterId=${row.characterId}`); return response.ok ? [row.characterId, await response.json()] as const : null; } catch { return null; }
      }));
      if (active) setPools(previous => ({...previous,...Object.fromEntries(observations.filter(x => x !== null))}));
    };
    void refresh(); const timer = setInterval(refresh,15000);
    window.addEventListener("solcameo:trade-confirmed",refresh);
    return () => {active=false;clearInterval(timer);window.removeEventListener("solcameo:trade-confirmed",refresh);};
  }, [rows]);
  const ranked = [...(rows ?? [])].sort((a,b) => Number(pools[b.characterId]?.appVolume24hLamports ?? 0)-Number(pools[a.characterId]?.appVolume24hLamports ?? 0)).slice(0,10);
  return <section className="border-t border-white/10"><div className="flex items-center justify-between px-4 py-3"><h2 className="text-sm font-semibold">Trending coins</h2><span className="text-[10px] text-[#d7ff00]">15s updates</span></div><div className="grid grid-cols-[1fr_80px_80px] gap-2 px-4 pb-2 font-mono text-[10px] uppercase text-zinc-500"><span>Coin</span><span className="text-right">MC USD</span><span className="text-right">App vol 24h</span></div>
    {rows === undefined ? <Skeleton className="mx-4 h-32 rounded" /> : !ranked.length ? <p className="p-4 text-xs text-zinc-500">Confirmed devnet launches will appear here after minting.</p> : <ol>{ranked.map((row,index) => {const pool=pools[row.characterId];const raw=pool?.available&&pool.capSol!=null?String(Math.round(pool.capSol*1e9)):null;const volume=pool?.appVolume24hLamports;return <motion.li key={row.characterId} layout={!reduced} transition={{duration:reduced?0:.25}}><Link href={`/market/${row.characterId}`} className="grid grid-cols-[1fr_80px_80px] items-center gap-2 border-t border-white/5 px-4 py-3 hover:bg-white/5"><span className="truncate text-xs"><span className="mr-2 font-mono text-zinc-600">{String(index+1).padStart(2,"0")}</span><strong>{row.ticker}</strong></span><span className="text-right font-mono text-xs text-[#d7ff00]">{raw?<LiveValue value={raw} display={formatUsdEstimate(raw,rate)} />:"—"}</span><span className="text-right font-mono text-xs">{volume?<LiveValue value={volume} display={formatUsdEstimate(volume,rate)} />:"—"}</span></Link></motion.li>;})}</ol>}
    <p className="p-4 text-[10px] text-zinc-600">Ranked by confirmed app trade volume. Devnet USD values are illustrative.</p>
  </section>;
}
function Content() {
  const episodes = useQuery(api.solstarDiscovery.latestVideos, {});
  return <main className="grid w-full grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,1fr)]"><section className="min-w-0 border-r border-white/10"><div className="flex h-11 items-center justify-between border-b border-white/10 px-5"><h1 className="text-sm font-semibold">Latest videos</h1><span className="text-[10px] text-[#d7ff00]">For you</span></div><div className="h-[calc(100dvh-170px)] min-h-[450px] snap-y snap-mandatory space-y-5 overflow-y-auto bg-[#111315] p-4">{episodes===undefined?<Skeleton className="mx-auto aspect-[9/16] max-w-[380px] rounded-lg" />:episodes.length?episodes.map(episode=><VideoPost key={episode.id} episode={episode}/>):<div className="p-8 text-center"><h2 className="text-lg">Your next character starts here</h2><p className="mt-2 text-sm text-zinc-500">Published character videos will appear here, newest first.</p><Button nativeButton={false} render={<Link href="/create" />} size="sm" className="mt-5 bg-[#d7ff00] text-black">Create an influencer</Button></div>}</div></section><aside className="min-w-0"><h2 className="flex h-11 items-center border-b border-white/10 px-5 text-sm font-semibold">Callouts</h2><FeedPanel compact /><CoinBoard /></aside></main>;
}
export function MakeFeed() { return <PanelErrorBoundary message="The feed is unavailable. Refresh to reconnect."><Content /></PanelErrorBoundary>; }
