"use client";
/* eslint-disable @next/next/no-img-element -- character portraits hosted on remote storage */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowTopRightIcon, RocketIcon, VideoIcon, SpeakerLoudIcon, SpeakerOffIcon } from "@radix-ui/react-icons";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatUsdEstimate } from "@/lib/solstar/usdc";
import { PanelErrorBoundary } from "./feedShared";
import type { MarketRow } from "./MarketTable";

type Pool = { available: boolean; capSol?: number; progress?: number; migrated?: boolean; changeSinceLaunchPct?: number | null; appVolume24hLamports?: string };
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
  const mirror = useRef<HTMLVideoElement>(null);
  const article = useRef<HTMLElement>(null);
  const [muted, setMuted] = useState(true);
  const reduced = useReducedMotion();
  const active = useInView(article, { amount: 0.65 });
  /** Move to the next character, wrapping to the first; replay when it is the only one. */
  const advance = useCallback(() => {
    const el = article.current;
    const next = el?.nextElementSibling ?? el?.parentElement?.firstElementChild;
    if (!el || !next || next === el) { const v = video.current; if (v) { v.currentTime = 0; void v.play().catch(() => {}); } return; }
    next.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [reduced]);
  useEffect(() => {
    const el = video.current, bg = mirror.current;
    if (!el || !episodeUrl) return;
    if (!active) { el.pause(); bg?.pause(); return; }
    void el.play().catch(() => {});
    void bg?.play().catch(() => {});
    // Keep the blurred backdrop locked to the main video.
    const sync = setInterval(() => { if (bg && Math.abs(bg.currentTime - el.currentTime) > 0.12) bg.currentTime = el.currentTime; if (bg && bg.paused !== el.paused) { if (el.paused) bg.pause(); else void bg.play().catch(() => {}); } }, 400);
    return () => { clearInterval(sync); el.pause(); bg?.pause(); };
  }, [active, episodeUrl]);
  useEffect(() => {
    if (!active || episodeUrl) return;
    const t = setTimeout(advance, 6000);
    return () => clearTimeout(t);
  }, [active, episodeUrl, advance]);
  const cap = row.network === "paper" ? formatUsdEstimate(row.marketCapLamports, rate) : pool?.available && pool.capSol != null ? formatUsdEstimate(String(Math.round(pool.capSol * 1e9)), rate) : "—";
  const change = pool?.available ? pool.changeSinceLaunchPct : null;
  const volume = pool?.appVolume24hLamports ? formatUsdEstimate(pool.appVolume24hLamports, rate) : "—";
  const progress = Math.min(100, Math.max(0, (pool?.progress ?? 0) * 100));
  return <article ref={article} className="relative flex h-[calc(100dvh-164px)] w-full snap-start snap-always items-center justify-center overflow-hidden bg-black [container-type:size]">
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {episode ? <video ref={mirror} muted loop playsInline preload="metadata" src={episode.videoUrl} poster={episode.posterUrl} className="absolute inset-0 size-full scale-125 object-cover opacity-80 blur-3xl saturate-[1.6]" /> : <img src={row.imageUrl} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-80 blur-3xl saturate-[1.6]" />}
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
    </div>
    <div className="relative overflow-hidden rounded-[3px] bg-black/20 shadow-[0_30px_90px_rgba(0,0,0,0.55)] ring-1 ring-white/15" style={{ width: "min(100cqw, calc(100cqh * 0.5625))", aspectRatio: "9 / 16" }}>
      {episode ? <video ref={video} controls muted={muted} preload="metadata" playsInline onEnded={advance} src={episode.videoUrl} poster={episode.posterUrl} className="absolute inset-0 size-full object-contain" aria-label={`${row.name} latest episode`} /> : <img src={row.imageUrl} alt={row.name} className={`absolute inset-0 size-full object-cover transition-transform ease-out ${active && !reduced ? "scale-[1.12] duration-[6000ms]" : "scale-100 duration-700"}`} />}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 to-transparent" />
      <div className="absolute left-3 right-3 top-3 flex items-center justify-between gap-2">
        {episode ? <span className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.12] py-1 pl-2 pr-2.5 text-[11px] font-medium tracking-tight text-white shadow-[0_4px_24px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-2xl backdrop-saturate-150"><span className="size-1.5 rounded-full bg-[#d7ff00] shadow-[0_0_8px_#d7ff00]" />{episode.engine ?? "AI video"}</span> : <span />}
        {episode && <Button size="icon-sm" variant="ghost" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute video" : "Mute video"} className="rounded-full border border-white/20 bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-2xl hover:bg-white/20">{muted ? <SpeakerOffIcon /> : <SpeakerLoudIcon />}</Button>}
      </div>
      <motion.div initial={reduced ? false : { opacity: 0, y: 28, filter: "blur(14px)" }} animate={active || reduced ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: 28, filter: "blur(14px)" }} transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: active ? 0.12 : 0 }} className="absolute inset-x-3 bottom-8">
        <Link href={`/market/${row.characterId}`} aria-label={`Open ${row.name} market`} className="block rounded-[3px] bg-[#d7ff00] px-4 py-4 text-[#10130a] shadow-[0_12px_40px_rgba(215,255,0,0.18)] transition-transform active:scale-[0.99]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5"><img src={row.imageUrl} alt="" className="size-[18px] shrink-0 rounded-[2px] object-cover" /><span className="truncate text-[12px] font-semibold tracking-tight">${row.ticker}</span><span className="text-[10px] font-medium text-[#10130a]/50">Market cap</span></div>
            {change != null && <span className="rounded-[2px] bg-[#10130a] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#d7ff00]">{change >= 0 ? "+" : "−"}{Math.abs(change).toFixed(2)}%</span>}
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="text-[32px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{cap}</div>
            <div className="grid shrink-0 grid-cols-3 gap-3 text-[9px] font-medium uppercase tracking-wide text-[#10130a]/50">
              <div>Vol 24h<div className="text-[12px] font-semibold normal-case tracking-tight tabular-nums text-[#10130a]">{volume}</div></div>
              <div>Followers<div className="text-[12px] font-semibold normal-case tracking-tight tabular-nums text-[#10130a]">{row.followers}</div></div>
              <div>{pool?.migrated ? "Graduated" : "Curve"}<div className="text-[12px] font-semibold normal-case tracking-tight tabular-nums text-[#10130a]">{pool?.available ? `${Math.round(progress)}%` : "—"}</div></div>
            </div>
          </div>
          {pool?.available && <div className="mt-3.5 h-[3px] overflow-hidden rounded-[1px] bg-[#10130a]/15"><div className="h-full bg-[#10130a]" style={{ width: `${progress}%` }} /></div>}
        </Link>
      </motion.div>
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
    <div role="tabpanel" aria-label={tab} className="max-h-[calc(100dvh-164px)] space-y-0 overflow-y-auto overscroll-contain snap-y snap-mandatory bg-[#181a1c]">
      {rows === undefined ? <div className="space-y-4 p-6">{[0,1,2].map(i => <Skeleton key={i} className="h-48 w-full rounded-md" />)}</div> : rows.length ? rows.slice(0, 20).map(row => <CharacterPost key={row.characterId} row={row} />) : <div className="px-6 py-12"><RocketIcon className="mb-4 size-6 text-[#d7ff00]" /><h2 className="text-lg font-semibold">{tab === "episodes" ? "The first episode starts here" : "Be part of the first launches"}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">{tab === "episodes" ? "Published episodes from confirmed devnet characters will appear here." : "Build a character, review its curve, and approve the on-chain launch from your wallet."}</p><Button nativeButton={false} render={<Link href="/create" />} size="sm" className="mt-5 h-8 rounded-md bg-[#d7ff00] text-black">Create an influencer <ArrowTopRightIcon /></Button></div>}
    </div>
    <p className="hidden px-6 py-4 text-[11px] text-zinc-500"><VideoIcon className="mr-1 inline" /> Watching is free. Devnet trades use test SOL; USD valuations are illustrative. Previews are unminted.</p>
  </>;
}
export function LaunchpadFeed() { return <PanelErrorBoundary message="Character discovery is unavailable. Refresh to reconnect."><Discovery /></PanelErrorBoundary>; }
