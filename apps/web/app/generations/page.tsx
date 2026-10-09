"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { SettingsShell, blurIn } from "@/components/settings/settings-shell";
import { motion } from "framer-motion";
import { useHireStore } from "@/lib/client/hireStore";
import { RepostVideoButton } from "@/components/social/repost-video-button";
import { LiveRenders } from "@/components/generations/live-renders";
import { Calendar, Download, Images, Layers, Play, X } from "lucide-react";

/* ════════ /generations — everything the account has generated ════════
   One feed across the whole account: agent videos, Content Swarm videos,
   Recreate videos, Photo Carousels (convex/userGenerations.ts) plus hired-agent
   creations (hireStore, this browser). Header matches /agents (glass icon badge
   + thin title); cards match the home page's video tiles (9:16 first frame,
   duration badge, hover play, modal player, action row, caption). */


type GenRow = {
  id: string;
  kind: "agent" | "swarm" | "recreate" | "carousel" | "hired" | "clip";
  title: string;
  videoUrl?: string;
  imageUrls?: string[];
  agentName?: string;
  createdAt: number;
  /** clip rows only: source video it was cut from. */
  sourceUrl?: string;
  mintAddress?: string;
  postStatus?: string;
  postError?: string;
};

const KIND_LABEL: Record<GenRow["kind"], string> = {
  agent: "Agent", swarm: "Swarm", recreate: "Recreate", carousel: "Carousel", hired: "Hired", clip: "Clip",
};

function fmtDate(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}hr${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

/** Full-screen player / carousel viewer. */
function GenModal({ item, onClose }: { item: GenRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm" onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Close"
        className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20">
        <X className="size-5" />
      </button>
      {item.videoUrl ? (
        <video src={item.videoUrl} controls autoPlay playsInline
          className="max-h-[88vh] max-w-[92vw] rounded-lg bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
          onClick={(e) => e.stopPropagation()} />
      ) : (
        <div className="flex max-w-[92vw] gap-3 overflow-x-auto rounded-lg p-2" onClick={(e) => e.stopPropagation()}>
          {(item.imageUrls ?? []).map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt={`Slide ${i + 1}`} className="max-h-[80vh] rounded-lg object-contain" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Mount-when-near-viewport gate. Every card used to mount a <video
 *  preload="metadata"> immediately — a big feed fired dozens of concurrent
 *  video-metadata fetches on page load. Cards now render a plain placeholder
 *  until they scroll within ~600px of the viewport, then mount the real media
 *  once (and stay mounted so scrolling back up doesn't refetch). */
function useNearViewport<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  // No IntersectionObserver (old browser/SSR edge) → just mount media eagerly.
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setNear(true); },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near];
}

/** Home-page-style tile: 9:16 first frame, duration badge, hover play, action
 *  row, caption. Carousels show the first slide plus a slide-count badge. */
function GenCard({ item, onOpen }: { item: GenRow; onOpen: (i: GenRow) => void }) {
  const [duration, setDuration] = useState<number | null>(null);
  const [cardRef, nearViewport] = useNearViewport<HTMLDivElement>();
  const download = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = item.videoUrl ?? item.imageUrls?.[0] ?? "#";
    a.download = `${item.title || "generation"}${item.videoUrl ? ".mp4" : ".png"}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  return (
    <div ref={cardRef} className="group flex flex-col">
      <button type="button" onClick={() => onOpen(item)} className="relative block aspect-[9/16] w-full overflow-hidden rounded-xl bg-neutral-900">
        {!nearViewport ? (
          <div className="absolute inset-0 animate-pulse bg-white/[0.03]" />
        ) : item.videoUrl ? (
          <video
            src={`${item.videoUrl}#t=0.001`}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            className="absolute inset-0 size-full object-cover opacity-95 transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrls?.[0]} alt={item.title} loading="lazy"
            className="absolute inset-0 size-full object-cover opacity-95 transition-transform duration-300 group-hover:scale-105" />
        )}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white/85 backdrop-blur-sm">
          {KIND_LABEL[item.kind]}{item.agentName ? ` · ${item.agentName}` : ""}
        </span>
        {item.videoUrl && duration != null && (
          <span className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white/90 backdrop-blur-sm">
            00:00 <span className="text-white/50">{fmtTime(duration)}</span>
          </span>
        )}
        {!item.videoUrl && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
            <Images className="size-3" /> {item.imageUrls?.length ?? 0}
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="grid size-10 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/20">
            <Play className="size-4 translate-x-px fill-current" />
          </span>
        </span>
      </button>

      <div className="mt-3 flex items-center justify-center gap-6 text-white/60">
        <span title={`Generated ${fmtDate(item.createdAt)}`} className="cursor-default"><Calendar className="size-[18px]" /></span>
        <button type="button" onClick={download} title="Download" className="transition-colors hover:text-white">
          <Download className="size-[18px]" />
        </button>
      </div>

      {item.mintAddress && item.videoUrl && !["posted", "posting", "scheduled"].includes(item.postStatus ?? "") && <RepostVideoButton mintAddress={item.mintAddress} videoUrl={item.videoUrl} title={item.title} failed={item.postStatus === "failed"} />}
      {item.postError && <p className="mt-1 text-xs text-rose-300">{item.postError}</p>}
      {item.postStatus && ["scheduled", "posting", "posted"].includes(item.postStatus) && <p className="mt-2 text-xs text-zinc-400">{item.postStatus === "scheduled" ? "Queued for X" : item.postStatus === "posting" ? "Posting…" : "Posted"}</p>}

      <p className="mt-3 line-clamp-2 text-[15px] font-medium leading-snug text-white" title={item.title}>
        {item.title}
      </p>
    </div>
  );
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "agent", label: "Agents" },
  { id: "clip", label: "Clips" },
  { id: "swarm", label: "Swarm" },
  { id: "recreate", label: "Recreate" },
  { id: "carousel", label: "Carousels" },
  { id: "hired", label: "Hired" },
] as const;

export default function GenerationsPage() {
  const { user, authenticated, login } = usePrivy();
  const { profile } = useSupabaseAuth();
  const wallets = useMemo(() => (profile?.walletAddresses ?? []).filter(Boolean), [profile?.walletAddresses]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [openItem, setOpenItem] = useState<GenRow | null>(null);

  const rows = useQuery(
    api.userGenerations.listForUser,
    authenticated && user?.id ? { creatorWallets: wallets, privyUserId: user.id } : "skip",
  ) as GenRow[] | undefined;

  // Hired-agent creations (HireGenerateModal) live in localStorage on this
  // browser — merged in so the modal's "View in Generations" link still lands
  // on its results.
  const hire = useHireStore();
  const hiredRows = useMemo<GenRow[]>(() => {
    return (hire.generations ?? [])
      .filter((g) => g.status === "done" && g.mediaUrl)
      .map((g) => ({
        id: `hire:${g.id}`,
        kind: "hired" as const,
        title: g.description || `${g.agentName} creation`,
        videoUrl: g.type === "video" ? g.mediaUrl : undefined,
        imageUrls: g.type === "image" ? [g.mediaUrl] : undefined,
        agentName: g.agentName,
        createdAt: g.createdAt,
      }));
  }, [hire.generations]);

  const visible = useMemo(() => {
    const seen = new Set<string>();
    const all = [...(rows ?? []), ...hiredRows]
      .filter((r) => {
        const key = r.videoUrl ?? r.imageUrls?.[0] ?? r.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return all.filter((r) => filter === "all" || r.kind === filter);
  }, [rows, hiredRows, filter]);

  const loading = authenticated && rows === undefined;

  return (
    <>
      <SettingsShell
        active="generations"
        icon={Layers}
        title="Generations"
        description="Everything your account has generated: agent videos, Content Swarm, Recreate, Photo Carousels, and hired creations."
      >
        {!authenticated ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <p className="text-[13.5px] text-white/60">Sign in to see everything you&apos;ve generated.</p>
            <button type="button" onClick={login} className="rounded-lg bg-white px-4 py-2 text-[13px] font-semibold text-black">Sign in</button>
          </div>
        ) : (
          <>
            <LiveRenders />
            {/* Kind filter pills */}
            <motion.div {...blurIn(0.04)} className="flex w-fit items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                  className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${filter === f.id ? "bg-white text-black" : "text-white/50 hover:text-white/80"}`}>
                  {f.label}
                </button>
              ))}
            </motion.div>

            {loading && (
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="aspect-[9/16] animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />
                ))}
              </div>
            )}

            {!loading && visible.length === 0 && (
              <p className="mt-16 text-center text-[13.5px] text-white/50">
                Nothing here yet. Generate videos with your agents, the Content Swarm, Recreate, or the Photo Carousel and they all land here.
              </p>
            )}

            {!loading && visible.length > 0 && (
              <motion.div {...blurIn(0.08)} className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {visible.map((r) => <GenCard key={r.id} item={r} onOpen={setOpenItem} />)}
              </motion.div>
            )}
          </>
        )}
      </SettingsShell>
      {openItem && <GenModal item={openItem} onClose={() => setOpenItem(null)} />}
    </>
  );
}
