"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock, Film, X, CalendarDays } from "lucide-react";
import { RepostVideoButton } from "@/components/social/repost-video-button";
import TabPageHeader from "./TabPageHeader";

// Dark glassmorphism scheduler — same warm/green glow background + frosted
// glass surfaces as the rest of the builder (Home, Editor, Generations).
// Month + Week + Day(time-axis) views, hover preview popover, single lime
// accent (scheduled), zinc (posted), rose (failed).

// Same warm-dark "glass" background used across the builder (Home/Editor) —
// a near-black base with two soft green glows, not flat black.
const GLASS_BG: React.CSSProperties = {
  background:
    "radial-gradient(120% 90% at 12% -10%, rgba(255,255,255,0.05), transparent 55%), " +
    "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.035), transparent 55%), " +
    "#050506",
};

type ScheduledItem = {
  _id: string;
  scheduledFor: number;
  status: string;
  topic: string;
  caption?: string;
  platforms: string[];
  videoUrl?: string;
  storyboardImageUrl?: string;
  postUrl?: string;
  error?: string;
  postedAt?: number;
  source: "scheduled" | "generation";
  taskId?: string;
};

const STATUS: Record<string, { dot: string; chip: string; label: string }> = {
  scheduled: { dot: "bg-lime-400", chip: "border-lime-400/25 bg-lime-400/10 text-lime-200", label: "Scheduled" },
  posting:   { dot: "bg-amber-400", chip: "border-amber-400/25 bg-amber-400/10 text-amber-200", label: "Posting" },
  posted:    { dot: "bg-zinc-400", chip: "border-white/10 bg-white/[0.04] text-zinc-300", label: "Posted" },
  failed:    { dot: "bg-rose-400", chip: "border-rose-400/25 bg-rose-400/10 text-rose-200", label: "Failed" },
  generated: { dot: "bg-zinc-500", chip: "border-white/10 bg-white/[0.04] text-zinc-300", label: "Generated" },
  cancelled: { dot: "bg-zinc-600", chip: "border-white/5 bg-white/[0.02] text-zinc-600 line-through", label: "Cancelled" },
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
// Clear, readable hour label for the time axis: "12 AM", "9 AM", "6 PM".
const hourLabel = (h: number) => `${h === 0 ? 12 : h > 12 ? h - 12 : h} ${h < 12 ? "AM" : "PM"}`;

type View = "month" | "week" | "day";

export default function SchedulePanel({ mintAddress }: { mintAddress?: string }) {
  const rows = useQuery(api.scheduledContent.listByMint, mintAddress ? { mintAddress } : "skip");
  const tasks = useQuery(api.agentTasks.listByMint, mintAddress ? { mintAddress, limit: 120 } : "skip");
  // scheduledContent.cancel is now secret-gated — go through the authed,
  // ownership-scoped /api/schedule/cancel route with the operator's Privy token.
  const { getFreshToken } = useSupabaseAuth();
  const [err, setErr] = useState<string | null>(null);
  const cancel = async (id: string) => {
    if (!mintAddress) return;
    setErr(null);
    try {
      const token = await getFreshToken();
      const res = await fetch("/api/schedule/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id, mintAddress }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to cancel scheduled item");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    }
  };

  const [view, setView] = useState<View>("month");
  // Lazy init so we only read the clock once.
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [hovered, setHovered] = useState<ScheduledItem | null>(null);
  const [pinned, setPinned] = useState<ScheduledItem | null>(null);

  // Merge two sources so the calendar reflects REAL activity:
  //  1. scheduledContent — future/queued posts the agent will fire.
  //  2. create_video tasks that actually produced + posted a video (agentTasks) —
  //     placed on the day they completed. This is why yesterday's/today's posts
  //     now show up even though they were never "scheduled".
  const items: ScheduledItem[] = useMemo(() => {
    const scheduled: ScheduledItem[] = (rows ?? []).map((r: Doc<"scheduledContent">) => ({
      _id: r._id as string,
      scheduledFor: r.scheduledFor,
      status: r.status,
      topic: r.topic,
      caption: r.caption,
      platforms: r.platforms ?? [],
      videoUrl: r.videoUrl,
      storyboardImageUrl: r.storyboardImageUrl,
      postedAt: r.postedAt,
      error: r.error,
      taskId: r.taskId as string | undefined,
      source: "scheduled" as const,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generated: ScheduledItem[] = ((tasks ?? []) as any[])
      .filter((t) => t.type === "create_video" && t.status === "succeeded" && t.output)
      .map((t) => {
        let o: Record<string, unknown> = {};
        try { o = JSON.parse(t.output); } catch { /* skip */ }
        const post = (o.post ?? {}) as { status?: string; platforms?: string[]; url?: string; caption?: string; error?: string };
        const videoUrl = typeof o.videoUrl === "string" ? o.videoUrl : undefined;
        const storyboardImageUrl = typeof o.storyboardImageUrl === "string" ? o.storyboardImageUrl : undefined;
        if (!videoUrl && !storyboardImageUrl) return null;
        const script = (o.script ?? {}) as { caption?: string };
        return {
          _id: t._id as string,
          scheduledFor: (t.completedAt ?? t._creationTime) as number,
          status: post.status === "posted" ? "posted" : post.status === "failed" ? "failed" : "generated",
          topic: (typeof o.topic === "string" ? o.topic : t.title) as string,
          caption: post.caption ?? script.caption,
          platforms: Array.isArray(post.platforms) ? post.platforms : [],
          videoUrl, storyboardImageUrl,
          postUrl: typeof post.url === "string" ? post.url : undefined,
          error: post.error,
          postedAt: t.completedAt as number | undefined,
          source: "generation" as const,
        } as ScheduledItem;
      })
      .filter((x): x is ScheduledItem => x !== null);

    // The scheduled row owns the real publishing state, including retries/errors.
    const scheduledTaskIds = new Set(scheduled.map((s) => s.taskId).filter(Boolean));
    const scheduledUrls = new Set(scheduled.map((s) => s.videoUrl).filter(Boolean));
    return [...scheduled, ...generated.filter((g) => !scheduledTaskIds.has(g._id) && !scheduledUrls.has(g.videoUrl))];
  }, [rows, tasks]);

  const selectedPreview = pinned ?? hovered;
  const livePreview = selectedPreview
    ? items.find(item => item._id === selectedPreview._id || (!!selectedPreview.videoUrl && item.videoUrl === selectedPreview.videoUrl)) ?? selectedPreview
    : null;

  // Group items by day-key for fast cell lookup.
  const byDay = useMemo(() => {
    const map = new Map<string, ScheduledItem[]>();
    for (const it of items) {
      const d = new Date(it.scheduledFor);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.scheduledFor - b.scheduledFor);
    return map;
  }, [items]);
  const dayItems = (d: Date) => byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? [];

  const shift = (dir: 1 | -1) => {
    setCursor((c) => {
      if (view === "month") return new Date(c.getFullYear(), c.getMonth() + dir, 1);
      return addDays(c, dir * (view === "week" ? 7 : 1));
    });
  };

  const headerLabel = view === "month"
    ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
    : view === "day"
      ? cursor.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })
      : (() => { const s = addDays(cursor, -cursor.getDay()); const e = addDays(s, 6); return `${MONTHS[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${MONTHS[e.getMonth()].slice(0, 3)} ${e.getDate()}`; })();

  const scheduledCount = items.filter((i) => i.status === "scheduled").length;
  const postedCount = items.filter((i) => i.status === "posted").length;

  return (
    <section className="max-w-[1000px] mx-auto px-6 py-7 relative min-h-full" style={{ ...GLASS_BG, fontFamily: "var(--font-geist-sans, system-ui)" }}>
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-1">
        <div>
          <TabPageHeader icon={CalendarDays} title="Schedule" blurb="What posts when. It runs itself." />
          <p className="text-[12px] text-zinc-500 mt-1.5">
            <span className="text-lime-300 font-semibold">{scheduledCount}</span> scheduled · <span className="text-zinc-400 font-semibold">{postedCount}</span> posted
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* View toggle, frosted glass, no outline */}
          <div className="inline-flex rounded-md bg-white/[0.06] backdrop-blur-xl p-0.5">
            {(["month", "week", "day"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-colors ${view === v ? "bg-white/15 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => shift(-1)} className="size-7 rounded-md bg-white/[0.06] backdrop-blur-xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"><ChevronLeft className="size-4" /></button>
            <button onClick={() => setCursor(startOfDay(new Date()))} className="px-2.5 h-7 rounded-md bg-white/[0.06] backdrop-blur-xl text-[11px] font-semibold text-zinc-300 hover:text-white hover:bg-white/10 transition-colors">Today</button>
            <button onClick={() => shift(1)} className="size-7 rounded-md bg-white/[0.06] backdrop-blur-xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      </div>
      <div className="h-px bg-white/10 my-3.5" />

      {err && <p className="mb-3 text-[11.5px] text-rose-400">{err}</p>}

      {/* Period label */}
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="size-3.5 text-zinc-500" />
        <span className="text-[15px] font-bold text-zinc-200">{headerLabel}</span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={view + cursor.toISOString().slice(0, 10)}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        >
          {view === "month"
            ? <MonthGrid cursor={cursor} dayItems={dayItems} onHover={(item) => { if (item) setHovered(item); }} onPin={setPinned} onCancel={(id) => void cancel(id)} />
            : <TimeGrid days={view === "day" ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(addDays(cursor, -cursor.getDay()), i))} dayItems={dayItems} onHover={(item) => { if (item) setHovered(item); }} onPin={setPinned} onCancel={(id) => void cancel(id)} />}
        </motion.div>
      </AnimatePresence>

      {/* Preview popover, hover to peek, click to pin open */}
      <PreviewPopover item={livePreview} pinned={!!pinned} mintAddress={mintAddress} onClose={() => { setPinned(null); setHovered(null); }} />

      {items.length === 0 && rows !== undefined && (
        <div className="text-center py-14 text-zinc-500 text-[13px]">
          Nothing scheduled yet. Tell the copilot something like <span className="font-mono text-[12px] text-zinc-300">&ldquo;schedule a video about morning routines for tomorrow 9am and 6pm on tiktok&rdquo;</span>.
        </div>
      )}
    </section>
  );
}

// ─── Month grid ──────────────────────────────────────────────────────────────

function MonthGrid({ cursor, dayItems, onHover, onPin, onCancel }: {
  cursor: Date;
  dayItems: (d: Date) => ScheduledItem[];
  onHover: (i: ScheduledItem | null) => void;
  onPin: (i: ScheduledItem) => void;
  onCancel: (id: string) => void;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const today = startOfDay(new Date());
  // Standard 6-week grid (covers every month layout).
  const visible = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="rounded-lg overflow-hidden bg-white/[0.03] backdrop-blur-xl">
      <div className="grid grid-cols-7 border-b border-white/10">
        {DOW.map((d) => (
          <div key={d} className="px-2 py-1.5 text-center font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-zinc-500">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {visible.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          const its = dayItems(d);
          return (
            <div key={i} className={`min-h-[92px] border-b border-r border-white/[0.06] p-1.5 ${inMonth ? "" : "bg-black/20"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[11px] font-semibold tabular-nums ${isToday ? "size-5 rounded-full bg-lime-400 text-[#0b0906] flex items-center justify-center" : inMonth ? "text-zinc-300" : "text-zinc-700"}`}>{d.getDate()}</span>
                {its.length > 2 && <span className="text-[9px] font-mono text-zinc-500">{its.length}</span>}
              </div>
              <div className="space-y-1">
                {its.slice(0, 3).map((it) => <Chip key={it._id} item={it} onHover={onHover} onPin={onPin} onCancel={onCancel} />)}
                {its.length > 3 && <p className="text-[9px] text-zinc-500 pl-0.5">+{its.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Time grid (week / day) ──────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function TimeGrid({ days, dayItems, onHover, onPin, onCancel }: {
  days: Date[];
  dayItems: (d: Date) => ScheduledItem[];
  onHover: (i: ScheduledItem | null) => void;
  onPin: (i: ScheduledItem) => void;
  onCancel: (id: string) => void;
}) {
  const today = startOfDay(new Date());
  return (
    <div className="rounded-lg overflow-hidden bg-white/[0.03] backdrop-blur-xl">
      {/* Day headers */}
      <div className="grid border-b border-white/10" style={{ gridTemplateColumns: `66px repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((d, i) => (
          <div key={i} className={`px-2 py-2 text-center border-l border-white/[0.06] ${sameDay(d, today) ? "bg-lime-400/10" : ""}`}>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">{DOW[d.getDay()]}</p>
            <p className={`text-[14px] font-bold tabular-nums ${sameDay(d, today) ? "text-lime-300" : "text-zinc-300"}`}>{d.getDate()}</p>
          </div>
        ))}
      </div>
      {/* Hour rows */}
      <div className="max-h-[460px] overflow-y-auto">
        {HOURS.map((h) => (
          <div key={h} className="grid border-b border-white/[0.04]" style={{ gridTemplateColumns: `66px repeat(${days.length}, 1fr)` }}>
            <div className="py-2 pr-3 text-right font-mono text-[10.5px] font-semibold text-zinc-500 tabular-nums border-r border-white/[0.06]">{hourLabel(h)}</div>
            {days.map((d, di) => {
              const its = dayItems(d).filter((it) => new Date(it.scheduledFor).getHours() === h);
              return (
                <div key={di} className="min-h-[34px] border-l border-white/[0.06] p-1 space-y-1">
                  {its.map((it) => <Chip key={it._id} item={it} showTime onHover={onHover} onPin={onPin} onCancel={onCancel} />)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chip ────────────────────────────────────────────────────────────────────

function Chip({ item, showTime, onHover, onPin, onCancel }: {
  item: ScheduledItem;
  showTime?: boolean;
  onHover: (i: ScheduledItem | null) => void;
  onPin: (i: ScheduledItem) => void;
  onCancel: (id: string) => void;
}) {
  const s = STATUS[item.status] ?? STATUS.scheduled;
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.03, y: -1 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      onMouseEnter={() => onHover(item)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPin(item)}
      title={`${fmtTime(item.scheduledFor)} · ${item.topic}`}
      className={`group/chip w-full text-left rounded-md border px-2 py-1.5 flex items-center gap-1.5 cursor-pointer backdrop-blur-md transition-colors ${s.chip}`}
    >
      <span className={`size-2 rounded-full shrink-0 ${s.dot} ${item.status === "posting" ? "animate-pulse" : ""}`} />
      {showTime && <span className="text-[10px] font-mono font-bold tabular-nums shrink-0">{fmtTime(item.scheduledFor)}</span>}
      <span className="text-[10.5px] font-medium truncate flex-1 leading-tight">{item.topic}</span>
      {(item.videoUrl || item.storyboardImageUrl) && <Film className="size-2.5 shrink-0 opacity-50" />}
      {item.status === "scheduled" && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onCancel(item._id); }}
          className="opacity-0 group-hover/chip:opacity-100 transition-opacity shrink-0 hover:text-rose-400"
        >
          <X className="size-2.5" />
        </span>
      )}
    </motion.button>
  );
}

// ─── Hover preview popover ───────────────────────────────────────────────────

function PreviewPopover({ item, pinned, onClose, mintAddress }: { item: ScheduledItem | null; pinned: boolean; onClose: () => void; mintAddress?: string }) {
  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 6 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="fixed bottom-6 right-6 z-40 w-[300px] rounded-lg bg-[#141210]/90 backdrop-blur-2xl border border-white/10 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)] overflow-hidden"
          style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}
        >
          {(pinned || item) && (
            <button onClick={onClose} className="absolute top-2 right-2 z-10 size-7 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white flex items-center justify-center transition-colors">
              <X className="size-3.5" />
            </button>
          )}
          {(item.videoUrl || item.storyboardImageUrl) ? (
            item.videoUrl
              ? <video src={item.videoUrl} muted loop autoPlay playsInline preload="auto" className="w-full aspect-[9/16] max-h-[280px] object-cover bg-black" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={item.storyboardImageUrl} alt="" className="w-full aspect-video object-cover bg-white/[0.03]" />
          ) : (
            <div className="w-full h-24 bg-white/[0.03] flex items-center justify-center">
              <Film className="size-6 text-zinc-600" />
            </div>
          )}
          <div className="p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`size-2 rounded-full ${(STATUS[item.status] ?? STATUS.scheduled).dot}`} />
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-500">{(STATUS[item.status] ?? STATUS.scheduled).label}</span>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-mono font-bold text-zinc-300 tabular-nums"><Clock className="size-2.5" />{new Date(item.scheduledFor).toLocaleString("en", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
            </div>
            <p className="text-[14px] font-bold text-white leading-snug">{item.topic}</p>
            {item.caption && <p className="text-[11.5px] text-zinc-400 mt-1 leading-relaxed line-clamp-3">{item.caption}</p>}
            {item.status === "failed" && item.videoUrl && mintAddress && <RepostVideoButton mintAddress={mintAddress} videoUrl={item.videoUrl} title={item.topic} />}
            {item.error && <p className="text-[11.5px] text-rose-300 mt-1 leading-relaxed">{item.error}</p>}
            {item.platforms.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {item.platforms.map((p) => <span key={p} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9.5px] font-semibold text-zinc-300 capitalize">{p}</span>)}
              </div>
            )}
            <div className="flex items-center gap-3 mt-2.5">
              {item.postUrl && (
                <a href={item.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-lime-300 hover:text-lime-200 underline">
                  View live post
                </a>
              )}
              {item.videoUrl && (
                <a href={item.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-white underline">
                  Open video
                </a>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
