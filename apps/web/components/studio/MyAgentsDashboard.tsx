"use client";

import { AgentAvatar } from "@/components/ui/agent-avatar";
import { useState, useMemo } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { unionWalletAddresses } from "@/lib/solana/activeWallet";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AppHeaderShell } from "@/components/home/app-shell";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectedPlatformStack } from "@/components/social/platform-icons";
import {
  Plus,
  Search,
  Wallet,
  Loader2,
  Trash2,
  AlertTriangle,
  Heart,
  ChevronDown,
  CalendarClock,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Eye,
  Medal,
  MessagesSquare,
} from "lucide-react";

/** Blur-in entrance shared by every element on the page — content arrives
 *  slightly blurred + lifted, settles crisp. `delay` staggers sections/cards. */
const blurIn = (delay = 0) => ({
  initial: { opacity: 0, y: 10, filter: "blur(10px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
});

type CreatorDoc = FunctionReturnType<typeof api.influencers.listByCreators>[number];

/** Relative time — "4hr ago", "5mins ago" — falls back to a date past 7d. */
/** Boxy glass button with a gloss sheen: translucent gradient, bright top edge, soft blur. */
const LEADERBOARD_BUTTON = "group relative h-9 gap-1.5 overflow-hidden rounded-md border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(255,255,255,0.72)_55%,rgba(255,255,255,0.84))] text-[13px] font-semibold text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-1px_0_rgba(0,0,0,0.08),0_8px_20px_-10px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-[background-color,border-color,transform] duration-200 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-1/2 before:bg-gradient-to-b before:from-white/70 before:to-transparent hover:bg-white active:scale-[0.98]";

function timeAgo(ts: number): string {
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

/** Agent card: the portrait on top, the details underneath. Whole card opens the agent; chat and delete float over the image. */
function AgentCard({ doc, lastPostAt, onDelete, onChat }: { doc: CreatorDoc; lastPostAt: number | null; onDelete: (mint: string, name: string) => void; onChat?: (mint: string) => void }) {
  const operateHref = `/builder?type=${doc.agentType || "influencer"}&mint=${doc.mintAddress}`;

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-[10px] border border-white/10 bg-[#121416] transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-[#171a1c]">
      <Link href={operateHref} aria-label={`Open ${doc.name}`} className="absolute inset-0 z-[1] rounded-[10px] focus-visible:outline-2 focus-visible:outline-[#d7ff00]" />

      <div className="pointer-events-none relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-white/5">
        <AgentAvatar url={doc.avatarUrl} name={doc.name} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" initialClassName="text-5xl" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#121416] via-[#121416]/40 to-transparent" />
        {doc.coinTicker && <span className="absolute left-2.5 top-2.5 rounded-[4px] border border-[#d7ff00]/30 bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-[#d7ff00] backdrop-blur-md">${doc.coinTicker}</span>}
        {doc.heartbeatEnabled && (
          <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-md" title="Heartbeat on">
            <Heart className="size-3 shrink-0 animate-pulse fill-pink-500 text-pink-500" aria-hidden /> Live
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(doc.mintAddress, doc.name); }}
        title="Delete agent"
        className="absolute right-2.5 top-2.5 z-10 grid size-7 place-items-center rounded-[6px] bg-black/55 text-white/60 opacity-0 backdrop-blur-md transition hover:bg-red-500/85 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
      {onChat && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChat(doc.mintAddress); }}
          title={`Chat with ${doc.name}`}
          className="absolute right-2.5 top-[calc(75%-2.5rem)] z-10 inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-xl transition hover:bg-white/20"
        >
          <MessagesSquare className="size-3" /> Chat
        </button>
      )}

      <div className="pointer-events-none relative z-[2] -mt-1 flex min-w-0 flex-1 flex-col gap-1.5 px-3.5 pb-3.5 pt-1">
        <p className="truncate text-[15px] font-semibold tracking-tight text-white">{doc.name}</p>
        {doc.description && <p className="line-clamp-2 text-[11.5px] leading-snug text-white/45">{doc.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1.5 text-[11.5px] text-white/45">
          <span className="min-w-0 truncate">{lastPostAt != null ? <>Last post <b className="font-semibold text-white/80">{timeAgo(lastPostAt)}</b></> : "No posts yet"}</span>
          <ConnectedPlatformStack platforms={doc.connectedPlatforms} badgeClassName="size-5" ringClassName="ring-[#131316]" />
        </div>
      </div>
    </div>
  );
}

/** Account health — thresholds fixed per operator spec:
 *  - "not-active": the last post is more than a week old (or there's never
 *    been one) — the account isn't posting, period. Checked FIRST and wins
 *    over the view-based grades below: a stale account isn't "bad content",
 *    it's not producing at all, a different problem. Sorts LOWEST/last in
 *    the list — nothing to action on content quality when nothing's posting.
 *  - "bad": posted within the last week, but at least ONE of the recent
 *    posts (not just the latest) is stuck under 100 views.
 *  - "good": posted within the last week, latest post cleared 200+ views,
 *    AND no recent post was stuck under 100 (a single good post after a run
 *    of dead ones still needs eyes, not a clean bill of health).
 *  - "monitor": posted within the last week, no post under 100, but the
 *    latest hasn't cleared 200 yet — worth watching, not yet a fire.
 *  `percent` scales 0-100% off the latest post's views against the 200-view
 *  "good" bar — a quick-glance number, the `status` carries the actual verdict. */
type HealthStatus = "good" | "monitor" | "bad" | "not-active";
const HEALTH_GOOD_VIEWS = 200;
const HEALTH_BAD_VIEWS = 100;
const STALE_AFTER_MS = 7 * 24 * 3600 * 1000;
function computeAccountHealth(recentViews: (number | null)[], lastPostAt: number | null): { status: HealthStatus; percent: number; latestViews: number | null } {
  if (lastPostAt == null || Date.now() - lastPostAt > STALE_AFTER_MS) {
    return { status: "not-active", percent: 0, latestViews: recentViews[0] ?? null };
  }
  const latestViews = recentViews[0] ?? 0;
  const percent = Math.max(0, Math.min(100, Math.round((latestViews / HEALTH_GOOD_VIEWS) * 100)));
  const hasLowRecent = recentViews.some((v) => (v ?? 0) < HEALTH_BAD_VIEWS);
  const status: HealthStatus =
    hasLowRecent ? "bad"
      : latestViews >= HEALTH_GOOD_VIEWS ? "good"
      : "monitor";
  return { status, percent, latestViews };
}
const HEALTH_META: Record<HealthStatus, { label: string; icon: typeof ShieldCheck; color: string; ring: string; bg: string }> = {
  good: { label: "Good", icon: ShieldCheck, color: "text-emerald-400", ring: "stroke-emerald-400", bg: "bg-emerald-400" },
  monitor: { label: "Monitor", icon: ShieldQuestion, color: "text-amber-400", ring: "stroke-amber-400", bg: "bg-amber-400" },
  bad: { label: "Bad", icon: ShieldAlert, color: "text-red-400", ring: "stroke-red-400", bg: "bg-red-400" },
  "not-active": { label: "Not active", icon: ShieldQuestion, color: "text-white/40", ring: "stroke-white/25", bg: "bg-white/25" },
};

/** Small ring gauge — circumference-based stroke-dashoffset, no chart lib. */
function HealthRing({ percent, status, size = 34 }: { percent: number; status: HealthStatus; size?: number }) {
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - percent / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        className={`${HEALTH_META[status].ring} transition-[stroke-dashoffset] duration-700 ease-out`}
        style={{ strokeDasharray: c, strokeDashoffset: offset }}
      />
    </svg>
  );
}

/** ~28%-width floating account-health sidebar — sticky alongside the agent
 *  grid. Per-agent verdict from computeAccountHealth (staleness first, then
 *  latest post's views + whether any recent post is also stuck low), sorted
 *  worst-first so the accounts that need attention are the first thing
 *  seen — "not-active" sorts LAST since a dormant account isn't a content
 *  problem to fix, just nothing happening. */
function AccountHealthPanel({
  agents, health, lastPostAtByMint,
}: {
  agents: AgentLite[];
  health: Map<string, { status: HealthStatus; percent: number; latestViews: number | null }>;
  lastPostAtByMint: Map<string, number | null>;
}) {
  const rows = useMemo(() => {
    const order: Record<HealthStatus, number> = { bad: 0, monitor: 1, good: 2, "not-active": 3 };
    return [...agents]
      .map((a) => ({
        agent: a,
        h: health.get(a.mintAddress) ?? { status: "not-active" as HealthStatus, percent: 0, latestViews: null },
        lastPostAt: lastPostAtByMint.get(a.mintAddress) ?? null,
      }))
      .sort((a, b) => order[a.h.status] - order[b.h.status]);
  }, [agents, health, lastPostAtByMint]);
  if (rows.length === 0) return null;
  const counts = rows.reduce((acc, r) => { acc[r.h.status] += 1; return acc; }, { good: 0, monitor: 0, bad: 0, "not-active": 0 } as Record<HealthStatus, number>);

  return (
    <motion.div {...blurIn(0.15)} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_30px_70px_-45px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg border border-white/15 bg-gradient-to-b from-white/[0.16] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
              <ShieldCheck className="size-3.5 text-white/80" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-white">Account Health</p>
              <p className="text-[10.5px] text-white/40">Latest post performance</p>
            </div>
          </div>

          {/* Fleet-wide summary strip */}
          <div className="mt-3.5 grid grid-cols-4 gap-1.5 border-t border-white/[0.06] pt-3">
            {(["good", "monitor", "bad", "not-active"] as const).map((s) => (
              <div key={s} className="rounded-lg bg-white/[0.03] px-1.5 py-1.5 text-center">
                <p className="text-[15px] font-bold tabular-nums text-white">{counts[s]}</p>
                <p className="text-[8.5px] uppercase leading-tight tracking-wide text-white/35">{HEALTH_META[s].label}</p>
              </div>
            ))}
          </div>

          {/* Per-agent rows, worst first — not-active sorts last */}
          <div className="mt-3.5 space-y-1 border-t border-white/[0.06] pt-3">
            {rows.map(({ agent, h, lastPostAt }) => {
              const meta = HEALTH_META[h.status];
              return (
                <Link
                  key={agent.mintAddress}
                  href={`/builder?type=influencer&mint=${agent.mintAddress}`}
                  className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-white/[0.05]"
                >
                  <div className="relative shrink-0">
                    <HealthRing percent={h.percent} status={h.status} />
                    <AgentAvatar url={agent.avatarUrl} name={agent.name} seed={agent.mintAddress} alt="" className="absolute inset-0 m-auto size-6 rounded-full object-cover" initialClassName="text-[10px]" />
                    <span className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[#131316] ${meta.bg}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-white/90">{agent.name}</p>
                    <p className="flex items-center gap-1 text-[10.5px] text-white/40">
                      <Eye className="size-2.5" />
                      {h.latestViews == null ? "no posts" : `${h.latestViews.toLocaleString()} views`}
                    </p>
                    <p className="truncate text-[10px] text-white/35">
                      Last post {lastPostAt == null ? "never" : timeAgo(lastPostAt)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[9.5px] font-semibold uppercase tracking-wide ${meta.color}`}>{meta.label}</span>
                </Link>
              );
            })}
          </div>
    </motion.div>
  );
}

type SchedRow = FunctionReturnType<typeof api.scheduledContent.listByMintsInRange>[number];
type AgentLite = { mintAddress: string; name: string; avatarUrl: string };

const DAY_MS = 86_400_000;
// The day is divided into 4 fixed quarters (bands), not a continuous 24h
// canvas — every scheduled row snaps into one of these, sorted by time and
// laid out LEFT-TO-RIGHT within its band (wrapping to a 2nd line only if a
// single 6h window gets crowded). That's what makes "same time" rows read as
// a clean row instead of colliding avatars stacked at slightly-different
// pixel heights.
function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** One scheduled row's avatar chip — its own hover scope (Tailwind's
 *  `group/chip`) so hovering ONE avatar in a crowded band only reveals ITS
 *  own tooltip card, not the whole band's. */
function ScheduleChip({ row, agent }: { row: SchedRow; agent: AgentLite | undefined }) {
  const time = new Date(row.scheduledFor).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <span className="group/chip relative">
      <span
        className={`block size-6 shrink-0 overflow-hidden rounded-full ring-2 transition-transform duration-150 group-hover/chip:z-30 group-hover/chip:scale-125 ${
          row.status === "failed"
            ? "ring-red-400/70"
            : row.status === "posting"
              ? "ring-lime-400/80"
              : "ring-white/10 group-hover/chip:ring-white/50"
        }`}
      >
        {agent ? (
          <AgentAvatar url={agent.avatarUrl} name={agent.name} seed={agent.mintAddress} className="size-full object-cover" initialClassName="text-[8px]" />
        ) : (
          <span className="grid size-full place-items-center bg-white/10 text-[8px] font-bold text-white/50">
            ?
          </span>
        )}
      </span>
      {/* Custom hover card — replaces the old native `title` tooltip, which
         can't be styled and pops up slowly/inconsistently across browsers. */}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-max max-w-[160px] -translate-x-1/2 rounded-lg border border-white/10 bg-[#17171b] px-2 py-1.5 text-left opacity-0 shadow-xl shadow-black/50 transition-opacity duration-150 group-hover/chip:opacity-100">
        <span className="block truncate text-[10.5px] font-semibold text-white">{agent?.name ?? "Agent"}</span>
        <span className="block text-[9.5px] text-white/45">{time}{row.status === "failed" ? " · failed" : row.status === "posting" ? " · posting" : ""}</span>
        {row.topic && <span className="mt-0.5 block truncate text-[9.5px] text-white/35">{row.topic}</span>}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[#17171b]" />
      </span>
    </span>
  );
}

/** Weekly schedule strip — 7 day-columns × 4 fixed time-quarter bands each
 *  (12–6a / 6–12p / 12–6p / 6–12a). Every scheduled drip row sorts into its
 *  band and lays out left-to-right as a small avatar chip, wrapping only if
 *  a band gets crowded — a real calendar grid instead of free-floating
 *  absolute-positioned circles that could collide at close-but-different
 *  pixel heights. Gives an at-a-glance "scheduled until when" read per agent. */
function WeeklyScheduleStrip({ mintAddresses, agentsByMint }: { mintAddresses: string[]; agentsByMint: Map<string, AgentLite> }) {
  const { startMs, endMs, days } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const end = start + 7 * DAY_MS;
    const days = Array.from({ length: 7 }, (_, i) => {
      const ts = start + i * DAY_MS;
      const d = new Date(ts);
      return {
        ts,
        key: dayKey(ts),
        weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
        date: d.getDate(),
        isToday: i === 0,
      };
    });
    return { startMs: start, endMs: end, days };
  }, []);

  const rows = useQuery(
    api.scheduledContent.listByMintsInRange,
    mintAddresses.length ? { mintAddresses, startMs, endMs } : "skip",
  ) as SchedRow[] | undefined;

  const [selected, setSelected] = useState(0);
  const selectedRows = (rows ?? []).filter(row => dayKey(row.scheduledFor) === days[selected].key).sort((a,b) => a.scheduledFor-b.scheduledFor);
  return <section aria-label="Weekly schedule" className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
    <div className="mb-3 flex items-center justify-between"><p className="flex items-center gap-2 text-xs font-medium text-white"><CalendarClock className="size-3.5 text-[#d7ff00]"/> This week</p><span className="text-[10px] text-zinc-500">{rows?.length ?? 0} scheduled</span></div>
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Choose schedule day">{days.map((day,index)=>{
      const count=(rows ?? []).filter(row=>dayKey(row.scheduledFor)===day.key).length;
      return <button key={day.key} onClick={()=>setSelected(index)} aria-pressed={selected===index} className={`relative flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] transition-colors ${selected===index ? "bg-[#d7ff00]/10 text-[#d7ff00] ring-1 ring-[#d7ff00]/20" : "text-zinc-500 hover:bg-white/5"}`}><span>{day.weekday}</span><span className="text-sm font-medium tabular-nums">{day.date}</span><span className={`size-1 rounded-full ${count ? "bg-[#d7ff00]" : "bg-white/10"}`}/></button>;
    })}</div>
    <div className="mt-3 flex min-h-7 flex-wrap items-center gap-2 border-t border-white/5 pt-2">{rows===undefined && mintAddresses.length>0 ? <Loader2 className="size-3 animate-spin text-zinc-500"/> : selectedRows.length ? selectedRows.slice(0,8).map(row=><Link key={row._id} href={`/builder?mint=${encodeURIComponent(row.mintAddress)}&tab=schedule`} className="flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-1"><ScheduleChip row={row} agent={agentsByMint.get(row.mintAddress)}/><span className="text-[10px] text-zinc-400">{new Date(row.scheduledFor).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</span></Link>) : <span className="text-[11px] text-zinc-500">No posts scheduled for {days[selected].isToday ? "today" : days[selected].weekday.toLowerCase()}.</span>}{selectedRows.length>8 && <span className="text-[10px] text-zinc-500">+{selectedRows.length-8} more</span>}</div>
  </section>;
}

/** Fanned portrait reel: the centre clip is largest and in front, each side steps down in size and sits behind it. */
const REEL = [
  { size: "h-[216px] w-[122px] sm:h-[266px] sm:w-[150px]", z: "z-0", hideSmall: true, shift: "" },
  { size: "h-[244px] w-[138px] sm:h-[300px] sm:w-[169px]", z: "z-10", hideSmall: false, shift: "-ml-5 sm:-ml-8" },
  { size: "h-[276px] w-[155px] sm:h-[340px] sm:w-[191px]", z: "z-20", hideSmall: false, shift: "-ml-5 sm:-ml-8" },
  { size: "h-[244px] w-[138px] sm:h-[300px] sm:w-[169px]", z: "z-10", hideSmall: false, shift: "-ml-5 sm:-ml-8" },
  { size: "h-[216px] w-[122px] sm:h-[266px] sm:w-[150px]", z: "z-0", hideSmall: true, shift: "-ml-5 sm:-ml-8" },
] as const;

function NoAgentsIllustration() {
  const reduced = useReducedMotion();
  const feed = useQuery(api.clipJobs.globalVideoFeed, { limit: 20, kind: "ugc" });
  const clips = (Array.isArray(feed) ? [] : feed?.items ?? []).filter(item => item.videoUrl).slice(0, REEL.length);
  return <div aria-hidden className="flex items-center justify-center pb-2 pt-2">
    {REEL.map((card, index) => {
      const clip = clips.length ? clips[index % clips.length] : undefined;
      return <motion.div
        key={index}
        initial={reduced ? false : { opacity: 0, y: 28, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, delay: Math.abs(index - 2) * 0.09, ease: [0.22, 1, 0.36, 1] }}
        className={`relative shrink-0 overflow-hidden rounded-[18px] border border-white/10 bg-[#1b1d20] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)] ${card.size} ${card.z} ${card.shift} ${card.hideSmall ? "hidden md:block" : ""}`}
      >
        {clip && <video
          src={clip.videoUrl}
          poster={clip.posterUrl ?? undefined}
          muted loop playsInline preload="metadata"
          autoPlay={!reduced}
          className="absolute inset-0 size-full object-cover"
        />}
      </motion.div>;
    })}
  </div>;
}

function EmptyDashboard() {
  return <motion.div {...blurIn(0.08)} className="flex w-full flex-col items-center justify-center text-center">
    <NoAgentsIllustration />
    <h2 className="mt-9 max-w-xl text-balance text-[2.1rem] font-black uppercase leading-[0.95] tracking-[-0.035em] text-white sm:text-5xl">Your influencers<br />start here</h2>
    <p className="mt-4 max-w-md text-balance text-[15px] leading-6 text-zinc-500">One character. One coin. One agent.</p>
    <Button nativeButton={false}
                render={<Link href="/create" />} className="mt-7 h-10 rounded-lg bg-[#d7ff00] px-5 text-sm font-semibold text-black shadow-none hover:bg-[#e4ff59]"><Plus className="size-4" /> Create AI influencer</Button>
  </motion.div>;
}

/** Plain wrapper used when the dashboard is embedded (e.g. /control) — the
 *  host page already owns the app header. */
function Embedded({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** The whole My Agents dashboard. Rendered full-page at /studio, and embedded
 *  as the /control panel's home view (no header, "Chat" on every card). */
export function MyAgentsDashboard({ embedded = false, onChat }: { embedded?: boolean; onChat?: (mint: string) => void } = {}) {
  const Shell = embedded ? Embedded : AppHeaderShell;
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  // Privy-aware: resolves the active address whether the user logged in with an
  // external wallet OR a Google login that minted an embedded Privy wallet.
  // Plain useWallet() misses the embedded case, so those owners' agents never
  // show. Mirrors app/studio/build/page.tsx.
  const { connected, publicKey } = useUnifiedSolanaWallet();
  const { setVisible } = useWalletModal();
  // IDENTITY: an agent is keyed to the wallet it was MINTED under, which for a
  // Privy/Google user is frequently NOT the active wallet resolved above. Union
  // the account's full linked-wallet set (profile.walletAddresses) with the
  // active wallet -- same fix as /wallet (app/wallet/page.tsx) -- otherwise
  // listByCreator (single wallet) returns [] for a multi-wallet operator even
  // though they own funded agents.
  const { profile, authenticated, loading: authLoading } = useSupabaseAuth();
  const address = connected && publicKey ? publicKey.toBase58() : null;
  const creatorWallets = useMemo(
    () => unionWalletAddresses(profile?.walletAddresses, address || profile?.walletAddress || null),
    [profile?.walletAddresses, profile?.walletAddress, address],
  );
  const [search, setSearch] = useState("");
  // Agent-type filter for the dropdown next to search.
  const [typeFilter, setTypeFilter] = useState<"all" | "coins" | "characters" | "active">("all");

  // Delete-agent flow. The route refunds the agent wallet's USDC to the owner,
  // frees the upload-post slot, and cascade-deletes the agent's data. Convex
  // reactivity drops the card from listByCreators once the row is gone.
  const [delTarget, setDelTarget] = useState<{ mint: string; name: string } | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [delDone, setDelDone] = useState<string | null>(null);
  const handleDelete = async () => {
    if (!delTarget) return;
    setDelBusy(true);
    setDelErr(null);
    try {
      // Owner auth (Privy Bearer + X-Siws-Session) is auto-attached by the global fetch interceptor.
      const res = await fetch("/api/agents/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress: delTarget.mint }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) {
        setDelErr(j.error || `Delete failed (${res.status})`);
        return;
      }
      const refunded = j.refund?.attempted ? ` Refunded $${Number(j.refund.amountUsdc ?? 0).toFixed(2)} USDC to your wallet.` : "";
      setDelDone(`Deleted ${delTarget.name}.${refunded}`);
      setDelTarget(null);
      window.dispatchEvent(new Event("agents-changed"));
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDelBusy(false);
    }
  };

  const rawDocs = useQuery(
    api.influencers.listByCreators,
    creatorWallets.length ? { creatorWallets, ...(embedded ? { liveNetwork: "mainnet" as const } : {}) } : "skip"
  ) as CreatorDoc[] | undefined;
  const docs = useMemo(() => rawDocs ?? [], [rawDocs]);

  const mintAddresses = useMemo(() => docs.map((d) => d.mintAddress), [docs]);
  const agentsByMint = useMemo(
    () => new Map(docs.map((d) => [d.mintAddress, { mintAddress: d.mintAddress, name: d.name, avatarUrl: d.avatarUrl }])),
    [docs],
  );
  const feedResult = useQuery(api.clipJobs.videoFeedByMints, mintAddresses.length ? { mintAddresses } : "skip") as
    | { items: { mint: string; createdAt: number; viewCount?: number | null }[] }
    | undefined;
  const agentStats = useMemo(() => {
    // `feedResult.items` arrives globally sorted newest-first (clipJobs.ts's
    // videoFeedByMints), so the first few items encountered per mint here ARE
    // that mint's most recent posts, in order — no extra sort needed.
    const RECENT_WINDOW = 5;
    const stats = new Map<string, { count: number; lastPostAt: number | null; recentViews: (number | null)[] }>();
    for (const item of feedResult?.items ?? []) {
      const cur = stats.get(item.mint) ?? { count: 0, lastPostAt: null, recentViews: [] };
      cur.count += 1;
      if (cur.lastPostAt == null || item.createdAt > cur.lastPostAt) cur.lastPostAt = item.createdAt;
      if (cur.recentViews.length < RECENT_WINDOW) cur.recentViews.push(item.viewCount ?? null);
      stats.set(item.mint, cur);
    }
    return stats;
  }, [feedResult]);
  const healthByMint = useMemo(() => {
    const m = new Map<string, { status: HealthStatus; percent: number; latestViews: number | null }>();
    for (const [mint, s] of agentStats) m.set(mint, computeAccountHealth(s.recentViews, s.lastPostAt));
    return m;
  }, [agentStats]);
  const lastPostAtByMint = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const [mint, s] of agentStats) m.set(mint, s.lastPostAt);
    return m;
  }, [agentStats]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return docs.filter((d) => {
      if (typeFilter === "coins" && !d.solstarTokenId) return false;
      if (typeFilter === "characters" && d.solstarTokenId) return false;
      if (typeFilter === "active" && !d.heartbeatEnabled) return false;
      if (!q) return true;
      return d.name.toLowerCase().includes(q) || d.handle.toLowerCase().includes(q) || d.niche.toLowerCase().includes(q);
    });
  }, [docs, search, typeFilter]);

  const hasAccount = authenticated || connected;
  const loading = authLoading || (creatorWallets.length > 0 && rawDocs === undefined);

  // No influencers yet: the empty state owns the whole pane, centred both ways (no header or side column).
  if (hasAccount && !loading && docs.length === 0) {
    return (
      <Shell>
        <div className={`flex min-h-[480px] flex-1 items-center justify-center px-6 py-10 text-white ${embedded ? "bg-[#202326]" : "bg-[#090a0b]"}`}>
          <EmptyDashboard />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className={`min-h-full text-white ${embedded ? "bg-[#202326]" : "bg-[#090a0b]"}`}>
        <div className="mx-auto flex max-w-7xl items-start gap-6 px-6 pt-4 pb-12">
        <div className="min-w-0 flex-1">
          {/* ── Header ── the Create Agent + Leaderboards buttons now live at
                 the top of the desktop sidebar (below), stacked above Account
                 Health; this row keeps a compact fallback pair so mobile (no
                 sidebar) still has both. ── */}
          <motion.div {...blurIn(0)} className="flex flex-wrap items-end justify-between gap-4 xl:min-h-16">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">My influencers</h1>
              <p className="mt-1.5 text-xs text-zinc-500">Create, chat, and manage your characters and their coins.</p>
            </div>
            <div className="flex items-center gap-2 xl:hidden">
              <Button
                className="h-9 gap-1.5 rounded-md bg-[#d7ff00] text-xs font-semibold text-black shadow-none hover:bg-[#e4ff59]"
                nativeButton={false}
                render={<Link href="/create" />}
              >
                <Plus className="size-3.5" />
                Create influencer
              </Button>
              <Button
                className={LEADERBOARD_BUTTON}
                nativeButton={false}
                render={<Link href="/tournament" />}
              >
                <Medal className="size-4 text-black" strokeWidth={1.9} />
                Leaderboards
              </Button>
            </div>
          </motion.div>

          {/* ── Search + type filter ── */}
          {hasAccount && docs.length > 0 && (
            <motion.div {...blurIn(0.08)} className="mt-5 flex flex-wrap items-center gap-2.5">
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
                <Input
                  placeholder="Search agents..."
                  className="h-9 rounded-full border-white/10 bg-white/[0.04] pl-9 text-[13px] text-white placeholder:text-white/30 backdrop-blur-xl focus-visible:ring-white/20"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="relative">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
                  title="Filter your influencers"
                  className="h-9 appearance-none rounded-full border border-white/10 bg-white/[0.04] pl-4 pr-8 text-[13px] text-white/80 backdrop-blur-xl outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-white/20 [&>option]:bg-neutral-900"
                >
                  <option value="all">All influencers</option>
                  <option value="coins">With a coin</option>
                  <option value="characters">Without a coin</option>
                  <option value="active">Autopilot enabled</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
              </div>
              <button
                type="button"
                aria-expanded={scheduleOpen}
                aria-controls="influencer-dashboard-schedule"
                onClick={() => setScheduleOpen(open => !open)}
                className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-[13px] font-medium backdrop-blur-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${scheduleOpen ? "border-white/25 bg-white/10 text-white" : "border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]"}`}
              >
                <CalendarClock className="size-3.5" />
                Schedule
                <ChevronDown className={`size-3 transition-transform motion-reduce:transition-none ${scheduleOpen ? "rotate-180" : ""}`} />
              </button>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {hasAccount && docs.length > 0 && scheduleOpen && (
              <motion.div
                key="dashboard-schedule"
                id="influencer-dashboard-schedule"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="pt-4">
                  <WeeklyScheduleStrip mintAddresses={mintAddresses} agentsByMint={agentsByMint} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Body ── */}
          <div className="mt-5">
            {!hasAccount && (
              <motion.div {...blurIn(0.08)} className="flex flex-col items-center justify-center gap-5 py-32 text-center">
                <div className="grid size-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl">
                  <Wallet className="size-7 text-white/40" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-lg font-medium text-white">Connect your wallet</h2>
                  <p className="max-w-xs text-[13px] text-white/40">Connect to view and manage your AI agents.</p>
                </div>
                <Button className="gap-2 rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-xl hover:bg-white/20" onClick={() => setVisible(true)}>
                  <Wallet className="size-4" />
                  Connect Wallet
                </Button>
              </motion.div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-32">
                <Loader2 className="size-5 animate-spin text-white/30" />
              </div>
            )}


            {hasAccount && !loading && filtered.length > 0 && (
              <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 2xl:grid-cols-3">
                {filtered.map((doc, i) => {
                  const stats = agentStats.get(doc.mintAddress);
                  return (
                    <motion.div key={doc._id} {...blurIn(0.14 + Math.min(i, 8) * 0.06)}>
                      <AgentCard
                        doc={doc}
                        lastPostAt={stats?.lastPostAt ?? null}
                        onDelete={(mint, name) => { setDelErr(null); setDelTarget({ mint, name }); }}
                        onChat={onChat}
                      />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Desktop sidebar — Create Agent + Leaderboards share the header's
            64px row (bottom-aligned with the subtitle), Account Health starts
            on the same line as the Weekly schedule (same mt-8). Both sticky
            together as one unit. */}
        <motion.aside {...blurIn(0.05)} className="hidden shrink-0 xl:block xl:w-[28%] xl:min-w-[300px] xl:max-w-[400px]">
          <div className="sticky top-6">
            <div className="flex h-16 items-end gap-2">
              <Button
                className="h-9 flex-1 gap-1.5 rounded-md bg-[#d7ff00] text-xs font-semibold text-black shadow-none hover:bg-[#e4ff59]"
                nativeButton={false}
                render={<Link href="/create" />}
              >
                <Plus className="size-3.5" />
                Create influencer
              </Button>
              <Button
                className={`flex-1 ${LEADERBOARD_BUTTON}`}
                nativeButton={false}
                render={<Link href="/tournament" />}
              >
                <Medal className="size-4 text-black" strokeWidth={1.9} />
                Leaderboards
              </Button>
            </div>
            {hasAccount && !loading && docs.length > 0 && (
              <div className="mt-5">
                <AccountHealthPanel
                  agents={docs.map((d) => ({ mintAddress: d.mintAddress, name: d.name, avatarUrl: d.avatarUrl }))}
                  health={healthByMint}
                  lastPostAtByMint={lastPostAtByMint}
                />
              </div>
            )}
          </div>
        </motion.aside>
        </div>

        {/* Delete confirm modal */}
        {delTarget && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => { if (!delBusy) setDelTarget(null); }}>
            <div className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-[#111114]/95 p-5 backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="size-5" />
                <h3 className="text-base font-bold text-white">Delete agent</h3>
              </div>
              <p className="text-sm text-white/60">
                Permanently delete <b className="text-white">{delTarget.name}</b>? This removes the agent and its clips, schedule, skills, and node graph, and <b className="text-white">frees its upload-post slot</b>. Any USDC in the agent wallet is <b className="text-white">refunded to the owner wallet</b> first. This can&apos;t be undone.
              </p>
              {delErr && <p className="rounded bg-red-950/40 p-2 text-xs text-red-300">{delErr}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button className="rounded-full bg-white/10 hover:bg-white/20" onClick={() => setDelTarget(null)} disabled={delBusy}>Cancel</Button>
                <Button className="gap-1.5 rounded-full bg-red-600 hover:bg-red-500" onClick={handleDelete} disabled={delBusy}>
                  {delBusy ? (<><Loader2 className="size-4 animate-spin" /> Deleting…</>) : "Delete + refund"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Success toast */}
        {delDone && (
          <button
            type="button"
            onClick={() => setDelDone(null)}
            className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-emerald-500/30 bg-emerald-950/80 px-4 py-3 text-left text-sm text-emerald-100 backdrop-blur-xl"
          >
            {delDone}
          </button>
        )}
      </div>
    </Shell>
  );
}
