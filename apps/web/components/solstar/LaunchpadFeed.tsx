"use client";
/* eslint-disable @next/next/no-img-element -- character portraits hosted on remote storage */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowTopRightIcon, RocketIcon, VideoIcon, SpeakerLoudIcon, SpeakerOffIcon } from "@radix-ui/react-icons";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";
import { PanelErrorBoundary } from "./feedShared";
import type { MarketRow } from "./MarketTable";

type Pool = { available: boolean; capSol?: number; progress?: number; migrated?: boolean; appVolume24hLamports?: string };
function CharacterPost({ row }: { row: MarketRow }) {
  const terminal = useQuery(api.solstarMarket.terminal, { characterId: row.characterId });
  const rate = useSolUsd();
  const [pool, setPool] = useState<Pool | null>(null);
  useEffect(() => {
    if (!row.dbcPool) return;
    let active = true;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/meteora/pool?characterId=${encodeURIComponent(row.characterId)}`);
        if (res.ok && active) setPool(await res.json());
      } catch { /* Keep the last confirmed observation during a connection interruption. */ }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("solcameo:trade-confirmed", refresh); };
  }, [row.characterId, row.dbcPool]);
  const episode = terminal?.episodes[0];
  const episodeUrl = episode?.videoUrl;
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const el = video.current;
    if (!el || !episodeUrl || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void el.play().catch(() => {});
      else el.pause();
    }, { threshold: 0.65 });
    observer.observe(el);
    return () => { observer.disconnect(); el.pause(); };
  }, [episodeUrl]);
  const cap = row.network === "paper" ? formatUsdEstimate(row.marketCapLamports, rate) : pool?.available && pool.capSol != null ? formatUsdEstimate(String(Math.round(pool.capSol * 1e9)), rate) : "—";
  return <article className="relative mx-auto aspect-[9/16] w-full snap-start snap-always overflow-hidden bg-black">
    {episode ? <video ref={video} controls loop muted={muted} preload="metadata" playsInline src={episode.videoUrl} poster={episode.posterUrl} className="absolute inset-0 size-full object-cover" aria-label={`${row.name} latest episode`} /> : <img src={row.imageUrl} alt={row.name} className="absolute inset-0 size-full object-cover" />}
    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/10 to-black/40" />
    <div className="absolute left-4 right-4 top-4 flex items-center justify-between gap-2"><span className="rounded bg-black/50 px-2 py-1 text-[10px] text-white backdrop-blur">{row.network === "paper" ? "Unminted preview" : "Devnet · minted"}</span>{episode ? <Button size="icon-sm" variant="ghost" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute video" : "Mute video"} className="rounded-full bg-black/50 text-white">{muted ? <SpeakerOffIcon /> : <SpeakerLoudIcon />}</Button> : <span className="rounded bg-black/50 px-2 py-1 text-[10px] text-zinc-300">No episodes published yet</span>}</div>
    <div className="absolute bottom-36 right-3 flex flex-col items-center gap-3"><Link href={`/market/${row.characterId}`} aria-label={`Open ${row.name} market`} className="grid size-11 place-items-center rounded-full border-2 border-[#d7ff00] bg-black/40"><ArrowTopRightIcon className="size-5 text-[#d7ff00]" /></Link><span className="text-[10px] text-white">Market</span><div className="grid size-10 place-items-center rounded-full bg-white/10 text-white"><VideoIcon /></div><span className="text-[10px] text-white">{row.videosPosted} episodes</span></div>
    <div className="absolute bottom-0 left-0 right-0 space-y-3 p-5">
      <div className="flex items-center gap-2"><img src={row.imageUrl} alt="" className="size-8 rounded-full border border-white/30 object-cover" /><Link href={`/market/${row.characterId}`} className="text-sm font-semibold text-white hover:text-[#d7ff00]">@{row.name}</Link><span className="text-xs text-[#d7ff00]">${row.ticker}</span></div>
      <p className="line-clamp-2 pr-8 text-xs leading-5 text-zinc-200">{terminal?.character.bio || `Meet ${row.name}. Explore the character and follow its launch.`}</p>
      <div className="flex items-center gap-4 text-[11px] text-zinc-400"><span>MC <strong className="font-mono font-medium text-white">{cap} USD</strong></span><span>{row.followers} followers</span></div>
      {pool?.available && <div><div className="flex justify-between text-[10px] text-zinc-400"><span>{pool.migrated ? "Graduated" : "Bonding progress"}</span><span>{Math.round((pool.progress ?? 0) * 100)}%</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-white/20"><div className="h-full bg-[#d7ff00]" style={{width: `${Math.min(100, Math.max(0, (pool.progress ?? 0) * 100))}%`}} /></div></div>}
      <Button nativeButton={false} render={<Link href={`/market/${row.characterId}`} />} size="sm" className="h-8 w-full rounded-md bg-[#d7ff00] text-black hover:bg-[#e3ff5c]">{row.network === "paper" ? "View character" : "Open market"}<ArrowTopRightIcon /></Button>
    </div>
  </article>;

}
function Discovery() {
  const [tab, setTab] = useState("launches");
  const live = useQuery(api.solstarMarket.listMarket, { sort: "new", network: "devnet", liveOnly: true });
  const previews = useQuery(api.solstarMarket.listMarket, { sort: "new", network: "paper" });
  const source = tab === "previews" ? previews : live;
  const rows = tab === "episodes" ? source?.filter(r => r.videosPosted > 0) : source;
  return <>
    <div className="sticky top-0 z-10 flex gap-1 border-b border-white/10 bg-[#17191b] px-4 py-2" role="tablist" aria-label="Character discovery">
      {[["launches", "New launches"], ["episodes", "Episodes"], ["previews", "Previews"]].map(([value, label]) => <Button key={value} role="tab" aria-selected={tab === value} variant="ghost" size="sm" onClick={() => setTab(value)} className={`h-8 rounded-md text-xs ${tab === value ? "bg-[#d7ff00]/10 text-[#d7ff00]" : "text-zinc-500"}`}>{label}</Button>)}
    </div>
    <div role="tabpanel" aria-label={tab} className="max-h-[calc(100dvh-180px)] space-y-0 overflow-y-auto overscroll-contain snap-y snap-mandatory bg-[#181a1c]">
      {rows === undefined ? <div className="space-y-4 p-6">{[0,1,2].map(i => <Skeleton key={i} className="h-48 w-full rounded-md" />)}</div> : rows.length ? rows.slice(0, 20).map(row => <CharacterPost key={row.characterId} row={row} />) : <div className="px-6 py-12"><RocketIcon className="mb-4 size-6 text-[#d7ff00]" /><h2 className="text-lg font-semibold">{tab === "episodes" ? "The first episode starts here" : "Be part of the first launches"}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">{tab === "episodes" ? "Published episodes from confirmed devnet characters will appear here." : "Build a character, review its curve, and approve the on-chain launch from your wallet."}</p><Button nativeButton={false} render={<Link href="/create" />} size="sm" className="mt-5 h-8 rounded-md bg-[#d7ff00] text-black">Create an influencer <ArrowTopRightIcon /></Button></div>}
    </div>
    <p className="hidden px-6 py-4 text-[11px] text-zinc-500"><VideoIcon className="mr-1 inline" /> Watching is free. Devnet trades use test SOL; USD valuations are illustrative. Previews are unminted.</p>
  </>;
}
export function LaunchpadFeed() { return <PanelErrorBoundary message="Character discovery is unavailable. Refresh to reconnect."><Discovery /></PanelErrorBoundary>; }
