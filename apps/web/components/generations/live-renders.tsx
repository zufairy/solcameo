"use client";
/* eslint-disable @next/next/no-img-element -- agent avatars and storyboard frames hosted on remote storage */
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowUpRight, Check, Film } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

export type RenderJob = FunctionReturnType<typeof api.videoProgress.mine>[number];

/* ── which finished videos the viewer has already looked at (this browser) ─────────────────────────────────────── */
const SEEN_KEY = "solcameo:seen-videos";
const seenListeners = new Set<() => void>();
let seenCache: string | null = null;
const readSeen = () => { if (seenCache === null) { try { seenCache = window.localStorage.getItem(SEEN_KEY) ?? "[]"; } catch { seenCache = "[]"; } } return seenCache; };
const subscribeSeen = (l: () => void) => { seenListeners.add(l); return () => { seenListeners.delete(l); }; };
export function markSeen(ids: string[]) {
  if (!ids.length) return;
  let current: string[] = [];
  try { current = JSON.parse(readSeen()) as string[]; } catch { /* start fresh */ }
  const next = JSON.stringify([...new Set([...current, ...ids])].slice(-200));
  seenCache = next;
  try { window.localStorage.setItem(SEEN_KEY, next); } catch { /* the choice still holds for this visit */ }
  seenListeners.forEach((l) => l());
}

const STALE_MS = 2 * 24 * 3_600_000;

/** Every render of the signed-in account, live, plus which finished ones are still unseen. */
export function useLiveRenders() {
  const { authenticated, profile } = useSupabaseAuth();
  const wallets = useMemo(() => (profile?.walletAddresses ?? []).filter(Boolean), [profile?.walletAddresses]);
  const jobs = useQuery(api.videoProgress.mine, authenticated && wallets.length ? { creatorWallets: wallets } : "skip");
  const seenRaw = useSyncExternalStore(subscribeSeen, readSeen, () => "[]");
  const seen = useMemo(() => new Set<string>(JSON.parse(seenRaw) as string[]), [seenRaw]);
  // Re-checked once a minute so a tab left open overnight still drops what has gone stale.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(id); }, []);
  return useMemo(() => {
    // Anything older than two days is noise: a failed video nobody retried, or a render that never reported back.
    const cutoff = now - STALE_MS;
    const list = (jobs ?? []).filter((j) => (j.finishedAt ?? j.updatedAt ?? j.startedAt) > cutoff);
    const active = list.filter((j) => j.state === "queued" || j.state === "rendering");
    const unseen = list.filter((j) => (j.state === "done" || j.state === "failed") && !seen.has(j.id));
    return { jobs: list, active, unseen, loading: jobs === undefined && authenticated };
  }, [jobs, seen, authenticated, now]);
}

/**
 * The number on screen: jumps up to what the server reports, then keeps creeping so a long render never looks frozen.
 * It never passes a ceiling just above the reported value, so it can't promise more than has happened.
 */
export function useSmoothProgress(job: Pick<RenderJob, "progress" | "state">): number {
  const reduced = useReducedMotion();
  const target = job.state === "done" ? 100 : job.progress;
  const [shown, setShown] = useState(target);
  const ceiling = Math.min(96, target + 7);
  useEffect(() => {
    if (job.state === "done" || reduced) return;
    const id = window.setInterval(() => setShown((s) => (s < target ? Math.min(target, s + Math.max(1, (target - s) * 0.5)) : Math.min(ceiling, s + 0.3))), 1000);
    return () => window.clearInterval(id);
  }, [target, ceiling, job.state, reduced]);
  if (job.state === "done") return 100;
  return reduced ? target : Math.max(target, Math.min(shown, ceiling));
}

const STEPS = [["storyboard", "Storyboard"], ["video", "Rendering"], ["posting", "Finishing"]] as const;
const stepIndex = (job: RenderJob) => (job.state === "done" ? 3 : Math.max(0, STEPS.findIndex(([p]) => p === job.phase)));
const elapsed = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`; };

/** One shared clock for every elapsed timer on screen: a single interval no matter how many cards are rendering. */
const tickListeners = new Set<() => void>();
let tickNow = Date.now(), tickTimer: ReturnType<typeof setInterval> | undefined;
const subscribeTick = (l: () => void) => {
  tickListeners.add(l);
  if (!tickTimer) tickTimer = setInterval(() => { tickNow = Date.now(); tickListeners.forEach((fn) => fn()); }, 1000);
  return () => { tickListeners.delete(l); if (!tickListeners.size && tickTimer) { clearInterval(tickTimer); tickTimer = undefined; } };
};
const noopSubscribe = () => () => {};
function useTick(on: boolean) {
  return useSyncExternalStore(on ? subscribeTick : noopSubscribe, () => (on ? tickNow : 0), () => 0);
}

/** One render with its live bar, pipeline steps and status line. `compact` is the popover size. */
function RenderCardBase({ job, compact = false, onOpen }: { job: RenderJob; compact?: boolean; onOpen?: () => void }) {
  const pct = useSmoothProgress(job);
  const live = job.state === "queued" || job.state === "rendering";
  const now = useTick(live);
  const step = stepIndex(job);
  const failed = job.state === "failed", done = job.state === "done";
  return (
    <motion.article initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
      className={`relative overflow-hidden rounded-[6px] border border-white/[0.12] bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.025))] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] ${compact ? "p-3" : "p-4"}`}>
      <div className="relative flex items-center gap-3">
        <div className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[5px] bg-white/10 ring-1 ring-white/15 ${compact ? "size-11" : "size-14"}`}>
          {job.poster || job.agentAvatar ? <img src={(done && job.poster) || job.agentAvatar || job.poster || ""} alt="" className="size-full object-cover" /> : <Film className="size-5 text-white/40" />}
          {live && <span aria-hidden className="absolute inset-0 animate-pulse bg-[#d7ff00]/10" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-white">{job.title || "New video"}</p>
          <p className="truncate text-[12px] text-white/50">{job.agentName} · <span className={failed ? "text-rose-300" : done ? "text-[#d7ff00]" : ""}>{failed ? "Failed" : done ? "Ready" : job.message}</span></p>
        </div>
        <div className="shrink-0 text-right">
          {failed ? <AlertTriangle className="ml-auto size-5 text-rose-300" /> : done ? <span className="ml-auto grid size-6 place-items-center rounded-full bg-[#d7ff00] text-black"><Check className="size-3.5" strokeWidth={3} /></span> :
            <><p className="font-apple text-[20px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white">{Math.floor(pct)}<span className="text-[12px] text-white/50">%</span></p>
            <p className="mt-1 text-[11px] tabular-nums text-white/40">{elapsed(now - job.startedAt)}</p></>}
        </div>
      </div>
      {!failed && (
        <div className="relative mt-3">
          <div className="h-1.5 overflow-hidden rounded-[2px] bg-white/10">
            <div className={`h-full transition-[width] duration-1000 ease-linear ${done ? "bg-[#d7ff00]" : "bg-[linear-gradient(90deg,#9bbf00,#d7ff00)]"}`} style={{ width: `${pct}%` }} />
          </div>
          {!compact && (
            <ol className="mt-2.5 flex justify-between text-[11px] font-medium">
              {STEPS.map(([key, label], i) => (
                <li key={key} className={`flex items-center gap-1.5 ${i < step ? "text-white/70" : i === step && live ? "text-[#d7ff00]" : "text-white/35"}`}>
                  <span className={`size-1.5 rounded-full ${i < step ? "bg-white/70" : i === step && live ? "animate-pulse bg-[#d7ff00]" : "bg-white/25"}`} />{label}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {failed && <p className="relative mt-2 text-[12px] leading-5 text-rose-200/80">{job.message}</p>}
      {(done || failed) && onOpen && (
        <Link href="/generations" onClick={onOpen} className="relative mt-3 inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-white/[0.1] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-white/[0.18]">
          {done ? "Watch it" : "Details"} <ArrowUpRight className="size-3.5" />
        </Link>
      )}
    </motion.article>
  );
}

const sameJob = (a: RenderJob, b: RenderJob) => a.id === b.id && a.state === b.state && a.progress === b.progress && a.phase === b.phase && a.message === b.message && a.updatedAt === b.updatedAt && a.poster === b.poster;
/** Re-renders only when its own job actually changed, so a busy list stays cheap. */
export const RenderCard = memo(RenderCardBase, (p, n) => sameJob(p.job, n.job) && p.compact === n.compact && p.onOpen === n.onOpen);

/**
 * The live section at the top of /generations: everything rendering now, then what just finished. Opening the page
 * counts finished videos as seen, so the header notification clears.
 */
export function LiveRenders() {
  const { jobs, unseen } = useLiveRenders();
  const ids = unseen.map((j) => j.id).join(",");
  const clear = useCallback(() => markSeen(ids ? ids.split(",") : []), [ids]);
  useEffect(() => { const id = window.setTimeout(clear, 4000); return () => window.clearTimeout(id); }, [clear]);
  const shown = jobs.filter((j) => j.state !== "failed" || unseen.some((u) => u.id === j.id));
  if (!shown.length) return null;
  const active = shown.filter((j) => j.state === "queued" || j.state === "rendering").length;
  return (
    <section aria-label="Videos in progress" className="mb-8">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="relative flex size-2.5">{active > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#d7ff00] opacity-60" />}<span className={`relative inline-flex size-2.5 rounded-full ${active > 0 ? "bg-[#d7ff00]" : "bg-white/30"}`} /></span>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">{active > 0 ? `${active} ${active === 1 ? "video" : "videos"} rendering` : "Recently finished"}</h2>
        <span className="text-[12px] text-white/40">Updates live</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <AnimatePresence initial={false}>{shown.map((job) => <RenderCard key={job.id} job={job} onOpen={clear} />)}</AnimatePresence>
      </div>
    </section>
  );
}
