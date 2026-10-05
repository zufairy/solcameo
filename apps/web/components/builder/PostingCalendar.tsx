"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { createPortal } from "react-dom";
import { motion, MotionConfig } from "framer-motion";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import {
  Trash2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ImageOff,
  Play,
} from "lucide-react";
import { addLocalDays } from "@/lib/builder/dripStagger";
import { browserTimeZone, zonedParts, zonedTimeToEpoch, isValidTimeZone } from "@/lib/builder/timezone";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * A polished social-scheduler calendar for the Posting tab. It renders BOTH a
 * full month grid (weekday columns, every day of the month, scheduled clips per
 * cell) and a 7-day week row, with a Month|Week toggle and prev/next/Today
 * navigation that moves by month or week respectively.
 *
 * It is deliberately presentational: the parent (PostingTab) owns all data
 * fetching and the slider state. Two entry streams flow in:
 *
 *  - `scheduled`  — real scheduledContent rows (already-queued/posted clips).
 *  - `preview`    — a LIVE FORECAST of how the next clips WOULD be scheduled at
 *                   the parent's CURRENT (possibly-unsaved) slider values,
 *                   computed via computeScheduleTimes. Rendered distinctly
 *                   (dashed, tinted, lower opacity) so it reads as a forecast.
 *
 * All day/month/year bucketing + the per-entry time labels are computed in the
 * `timeZone` prop (default = the viewer's browser zone) so the calendar follows
 * the operator's chosen scheduling zone, not the host's. Each entry's `at`
 * epoch-ms maps to its day cell via that zone's wall-clock parts.
 */

export type CalendarStatus =
  | "scheduled"
  | "posting"
  | "posted"
  | "failed"
  | "cancelled";

export interface CalendarEntry {
  /** Stable key. */
  id: string;
  /** Effective epoch-ms for placement (postedAt for posted, else scheduledFor). */
  at: number;
  status: CalendarStatus;
  /** Topic / handle / caption shown on the card. */
  label: string;
  /** Platform ids, e.g. ["tiktok", "instagram"]. */
  platforms: string[];
  /** Optional clip video URL for the muted thumbnail. */
  videoUrl?: string | null;
  /** Forecast entry — rendered as a dashed, lower-opacity preview chip. */
  preview?: boolean;
  /** Real scheduledContent row id — present on live (non-preview) rows; enables
   *  drag-and-drop rescheduling. */
  rowId?: string;
}

type ViewMode = "month" | "week";

// ── Status palette (mirrors PostingTab's StateBadge colours) ────────────────
function chipClass(status: CalendarStatus, preview: boolean): string {
  if (preview) {
    // Forecast: lime-tinted, dashed, see-through so it reads as "not yet real".
    return "border-dashed border-lime-400/50 bg-lime-400/10 text-lime-200";
  }
  switch (status) {
    case "posted":
      return "border-lime-400/30 bg-lime-400/10 text-lime-200";
    case "posting":
      return "border-sky-400/30 bg-sky-400/10 text-sky-200";
    case "failed":
      return "border-red-400/30 bg-red-400/10 text-red-200";
    case "cancelled":
      return "border-white/10 bg-white/[0.04] text-zinc-500 line-through";
    default: // scheduled
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  }
}

// ── Platform glyphs — full set matching upload-post's UPLOAD_POST_PLATFORMS ────
const PLATFORM_TINT: Record<string, string> = {
  tiktok:          "bg-zinc-900",
  instagram:       "bg-gradient-to-br from-fuchsia-500 to-amber-400",
  youtube:         "bg-red-600",
  facebook:        "bg-blue-600",
  linkedin:        "bg-sky-700",
  x:               "bg-zinc-900",
  threads:         "bg-zinc-800",
  bluesky:         "bg-[#0A7AFF]",
  reddit:          "bg-[#FF4500]",
  pinterest:       "bg-[#E60023]",
  telegram:        "bg-[#229ED9]",
  discord:         "bg-[#5865F2]",
  google_business: "bg-[#4285F4]",
};
const PLATFORM_LABEL: Record<string, string> = {
  tiktok:          "TikTok",
  instagram:       "Instagram",
  youtube:         "YouTube",
  facebook:        "Facebook",
  linkedin:        "LinkedIn",
  x:               "X",
  threads:         "Threads",
  bluesky:         "Bluesky",
  reddit:          "Reddit",
  pinterest:       "Pinterest",
  telegram:        "Telegram",
  discord:         "Discord",
  google_business: "Google Biz",
};

// Inline SVGs for brands removed from the Simple Icons CDN (TikTok + Threads).
// Scales to the badge size via h-1/2 w-1/2 — safe at any rem.
const INLINE_GLYPH: Record<string, React.ReactNode> = {
  tiktok: (
    <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="currentColor" aria-hidden>
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
    </svg>
  ),
  threads: (
    <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="currentColor" aria-hidden>
      <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.781 3.631 2.695 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.668-1.614 1.643-3.602 1.104-4.818-.314-.709-.882-1.301-1.643-1.753-.189 1.344-.625 2.435-1.302 3.255-.905 1.094-2.184 1.69-3.804 1.77-1.226.06-2.401-.231-3.31-.818-1.075-.696-1.703-1.756-1.768-2.985-.063-1.196.408-2.301 1.328-3.111.876-.773 2.119-1.225 3.583-1.31a13.998 13.998 0 0 1 3.02.142c-.126-.742-.375-1.332-.745-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.99.232-2.721 1.32l-1.738-1.21c.98-1.452 2.568-2.252 4.478-2.252h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Z"/>
    </svg>
  ),
};

// Simple Icons CDN slug overrides (where our id ≠ the CDN slug).
const CDN_SLUG: Record<string, string> = {
  google_business: "google",
};



function PlatformGlyph({ id, size = "sm" }: { id: string; size?: "sm" | "xs" }) {
  const [broken, setBroken] = useState(false);
  const dim = size === "xs" ? "size-4 text-[8px]" : "size-5 text-[9px]";
  const img = size === "xs" ? "size-2.5" : "size-3";
  const label = PLATFORM_LABEL[id] ?? id;
  const inline = INLINE_GLYPH[id] as ReactNode | undefined;
  const slug = CDN_SLUG[id] ?? id;
  return (
    <span
      title={label}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ${dim} ${
        PLATFORM_TINT[id] ?? "bg-zinc-600"
      }`}
    >
      {inline ? (
        inline
      ) : !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://cdn.simpleicons.org/${slug}/white`}
          alt={label}
          className={`${img} object-contain`}
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="text-[0.65em] leading-none">{label.charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

// ── Date helpers (computed in the chosen `tz`, DST-correct) ─────────────────
// Every helper takes the zone explicitly so a day cell, the today-highlight, and
// the time labels all bucket by the SAME wall-clock zone (no host-local leftover).
function startOfDay(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return zonedTimeToEpoch(p.year, p.month, p.day, 0, 0, tz);
}
/** Zone day key for the day an instant falls in, e.g. "2026-6-16". */
function dayKey(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  // p.month is 1-based; subtract 1 to match the prior 0-based key format.
  return `${p.year}-${p.month - 1}-${p.day}`;
}
/** The zone weekday index (0 = Sun … 6 = Sat) for an instant. */
function zoneWeekday(ms: number, tz: string): number {
  // Intl gives the weekday name in the zone; map it to a 0..6 index.
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(ms);
  const idx = WEEKDAYS.indexOf(wd);
  return idx < 0 ? 0 : idx;
}
/** Sunday-start (US social schedulers) — column 0 = Sun. */
function startOfWeek(ms: number, tz: string): number {
  const sod = startOfDay(ms, tz);
  return addLocalDaysTz(sod, -zoneWeekday(sod, tz), tz);
}
/** Add `days` calendar days at the zone's midnight (DST-safe wall-clock walk). */
function addLocalDaysTz(ms: number, days: number, tz: string): number {
  return addLocalDays(ms, days, 0, 0, tz);
}
function startOfMonth(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return zonedTimeToEpoch(p.year, p.month, 1, 0, 0, tz);
}
function addMonths(ms: number, n: number, tz: string): number {
  const p = zonedParts(ms, tz);
  // month is 1-based; zonedTimeToEpoch handles month overflow via Date.UTC.
  return zonedTimeToEpoch(p.year, p.month + n, 1, 0, 0, tz);
}
/** Zone calendar-day-of-month for an instant. */
function zoneDayOfMonth(ms: number, tz: string): number {
  return zonedParts(ms, tz).day;
}
/** Zone month index (0-based) for an instant. */
function zoneMonth(ms: number, tz: string): number {
  return zonedParts(ms, tz).month - 1;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}
/** "in 2h 30m", "in 35m", "in 3d" — relative time to a future instant. */
function relFuture(ms: number, now: number): string {
  const diff = ms - now;
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const rem = mins % 60;
    return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
  }
  const days = Math.floor(hrs / 24);
  const remH = hrs % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}

export default function PostingCalendar({
  scheduled,
  preview,
  now,
  timeZone,
  loading = false,
  onReschedule,
  onDelete,
}: {
  scheduled: CalendarEntry[];
  preview: CalendarEntry[];
  /** Current epoch-ms (the parent's clock). */
  now: number;
  /** IANA zone the grid + labels bucket by. Default = the browser's zone. */
  timeZone?: string;
  loading?: boolean;
  /** Move a live scheduled row to a new day (drag-and-drop). Given the row id and
   *  the new epoch-ms (same time-of-day, new date). Absent → cards aren't draggable. */
  onReschedule?: (rowId: string, newAt: number) => void;
  /** Delete the video behind an entry (and its schedule). Resolves to an error
   *  string, or null on success. Absent → no delete option in the hover popup. */
  onDelete?: (entry: CalendarEntry) => Promise<string | null>;
}) {
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : browserTimeZone();
  const [view, setView] = useState<ViewMode>("month");
  // Drag-and-drop: the row currently being dragged + the day cell hovered over.
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragAtRef = useRef<number>(0); // the dragged entry's `at` (to preserve time-of-day)

  /** Drop the dragged row onto a day cell: keep its wall-clock time, change the date. */
  const dropOnDay = (cellMs: number) => {
    const rowId = draggingRowId;
    setDraggingRowId(null);
    setDragOverKey(null);
    if (!rowId || !onReschedule) return;
    const src = zonedParts(dragAtRef.current, tz);
    const tgt = zonedParts(cellMs, tz);
    const newAt = zonedTimeToEpoch(tgt.year, tgt.month, tgt.day, src.hour, src.minute, tz);
    // No-op if it landed on the same day it started (same date, same time already).
    if (zonedParts(dragAtRef.current, tz).day === tgt.day && dayKey(dragAtRef.current, tz) === dayKey(cellMs, tz)) return;
    onReschedule(rowId, newAt);
  };
  // Anchor: the month (month view) or week (week view) currently shown. We keep
  // a single epoch-ms cursor and derive the visible range from it + the view.
  const [cursor, setCursor] = useState<number>(() => startOfDay(now, tz));

  const entries = useMemo<CalendarEntry[]>(
    () => [...scheduled, ...preview],
    [scheduled, preview],
  );

  // Bucket every entry by its local day key (one pass).
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      if (!Number.isFinite(e.at)) continue;
      const k = dayKey(e.at, tz);
      const list = map.get(k);
      if (list) list.push(e);
      else map.set(k, [e]);
    }
    for (const list of map.values()) list.sort((a, b) => a.at - b.at);
    return map;
  }, [entries, tz]);

  // The visible day cells for the current view + cursor.
  const cells = useMemo<{ ms: number; inRange: boolean }[]>(() => {
    if (view === "week") {
      const ws = startOfWeek(cursor, tz);
      return Array.from({ length: 7 }, (_, i) => ({
        ms: addLocalDaysTz(ws, i, tz),
        inRange: true,
      }));
    }
    // Month grid: pad to whole weeks (Sun-start) so it's a clean rectangle.
    const monthStart = startOfMonth(cursor, tz);
    const month = zoneMonth(monthStart, tz);
    const gridStart = startOfWeek(monthStart, tz);
    const out: { ms: number; inRange: boolean }[] = [];
    // Up to 6 rows (42 cells) — trim trailing all-empty weeks below.
    for (let i = 0; i < 42; i++) {
      const ms = addLocalDaysTz(gridStart, i, tz);
      out.push({ ms, inRange: zoneMonth(ms, tz) === month });
    }
    // Drop a trailing 6th week if it's entirely out of the month.
    while (out.length > 35 && out.slice(-7).every((c) => !c.inRange)) {
      out.splice(-7, 7);
    }
    return out;
  }, [view, cursor, tz]);

  // Header label + the count of in-window scheduled posts (excludes preview).
  const { headerLabel, windowStart, windowEnd } = useMemo(() => {
    if (view === "week") {
      const ws = startOfWeek(cursor, tz);
      const we = addLocalDaysTz(ws, 6, tz);
      const aParts = zonedParts(ws, tz);
      const bParts = zonedParts(we, tz);
      const sameMonth = aParts.month === bParts.month;
      const monthLong = (ms: number) =>
        new Intl.DateTimeFormat(undefined, { timeZone: tz, month: "long" }).format(ms);
      const monthDay = (ms: number) =>
        new Intl.DateTimeFormat(undefined, { timeZone: tz, month: "short", day: "numeric" }).format(ms);
      const label = sameMonth
        ? `${monthLong(ws)} ${aParts.day}–${bParts.day}, ${bParts.year}`
        : `${monthDay(ws)} – ${monthDay(we)}, ${bParts.year}`;
      return { headerLabel: label, windowStart: ws, windowEnd: addLocalDaysTz(ws, 7, tz) };
    }
    const ms = startOfMonth(cursor, tz);
    return {
      headerLabel: new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        month: "long",
        year: "numeric",
      }).format(ms),
      windowStart: ms,
      windowEnd: addMonths(ms, 1, tz),
    };
  }, [view, cursor, tz]);

  const scheduledInWindow = useMemo(
    () =>
      scheduled.filter((e) => e.at >= windowStart && e.at < windowEnd).length,
    [scheduled, windowStart, windowEnd],
  );

  // Footer: next upcoming post (real OR preview) + platform tally across the
  // visible window.
  // * `nextPost`: the soonest future entry (real or preview).
  // * `tally`: per-platform count for REAL scheduled entries in the window.
  //   Entries with empty `platforms` (= "post to ALL connected accounts") are
  //   tallied separately as an "All accounts" bucket instead of falling through
  //   to a generic "?" badge — the previous fallback to ["other"] showed a grey
  //   question-mark pill for every user whose scheduled rows hadn't pinned specific
  //   channels, which was the 99% case.
  const nextPost = useMemo(() => {
    let best: CalendarEntry | null = null;
    for (const e of entries) {
      if (e.at <= now) continue;
      if (!best || e.at < best.at) best = e;
    }
    return best;
  }, [entries, now]);

  const tally = useMemo(() => {
    let allAccountsCount = 0;
    const counts = new Map<string, number>();
    for (const e of scheduled) {
      if (e.at < windowStart || e.at >= windowEnd) continue;
      if (!e.platforms.length) {
        // Empty platforms = "post to all connected". Bucket separately.
        allAccountsCount += 1;
      } else {
        for (const p of e.platforms) {
          counts.set(p, (counts.get(p) ?? 0) + 1);
        }
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { sorted, allAccountsCount };
  }, [scheduled, windowStart, windowEnd]);

  const step = (dir: -1 | 1) => {
    setCursor((c) =>
      view === "week"
        ? addLocalDaysTz(startOfWeek(c, tz), dir * 7, tz)
        : addMonths(startOfMonth(c, tz), dir, tz),
    );
  };
  const goToday = () => setCursor(startOfDay(now, tz));
  const todayKey = dayKey(now, tz);

  return (
    <MotionConfig reducedMotion="user">
    <div className="mt-8">
      {/* Title row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-zinc-300" />
          <h3 className="font-serif text-xl font-bold text-white">
            Schedule
          </h3>
        </div>
        {/* View toggle */}
        <div className="ml-auto inline-flex overflow-hidden rounded-lg bg-white/[0.04] backdrop-blur-xl">
          {(["month", "week"] as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`px-3 py-1.5 text-[13px] font-semibold capitalize transition-colors ${
                view === v
                  ? "bg-white/15 text-white"
                  : "text-zinc-400 hover:bg-white/5"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Header: navigation + month/range label + count */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-white/[0.04] backdrop-blur-xl px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={view === "week" ? "Previous week" : "Previous month"}
            className="grid size-8 place-items-center rounded-lg bg-white/[0.03] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={view === "week" ? "Next week" : "Next month"}
            className="grid size-8 place-items-center rounded-lg bg-white/[0.03] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="ml-1 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[13px] font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            Today
          </button>
        </div>

        <div className="min-w-0">
          <div className="truncate font-serif text-lg font-bold text-white">
            {headerLabel}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {preview.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-lime-400/40 bg-lime-400/10 px-2.5 py-1 text-[12px] font-semibold text-lime-200">
              <span className="size-1.5 rounded-full bg-lime-400" />
              {preview.length} preview
            </span>
          ) : null}
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-zinc-300">
            {scheduledInWindow} post{scheduledInWindow === 1 ? "" : "s"} scheduled
          </span>
        </div>
      </div>

      {loading ? (
        <div className="mt-3 grid place-items-center rounded-xl bg-white/[0.04] backdrop-blur-xl py-16 text-zinc-500">
          <CalendarDays className="size-6 animate-pulse" />
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl bg-white/[0.04] backdrop-blur-xl">
          {/* Weekday header */}
          <div className="grid grid-cols-7 border-b border-white/10 bg-white/5">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-zinc-500"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {cells.map(({ ms, inRange }) => {
              const k = dayKey(ms, tz);
              const dayEntries = byDay.get(k) ?? [];
              const isToday = k === todayKey;
              const tall = view === "week";
              const isDropTarget = !!draggingRowId && dragOverKey === k;
              return (
                <div
                  key={ms}
                  onDragOver={(e) => {
                    if (!draggingRowId) return;
                    e.preventDefault(); // allow drop
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverKey !== k) setDragOverKey(k);
                  }}
                  onDrop={(e) => { e.preventDefault(); dropOnDay(ms); }}
                  className={`relative min-h-[112px] border-b border-r border-white/10 p-1.5 transition-colors last:border-r-0 ${
                    tall ? "min-h-[260px]" : ""
                  } ${
                    isDropTarget
                      ? "bg-lime-400/10 ring-2 ring-inset ring-lime-400"
                      : inRange ? "" : "bg-black/20"
                  }`}
                >
                  {/* Day number / weekday */}
                  <div className="mb-1 flex items-center justify-between px-0.5">
                    <span
                      className={`grid size-6 place-items-center rounded-full text-[12px] font-semibold tabular-nums ${
                        isToday
                          ? "bg-lime-500 text-white"
                          : inRange
                            ? "text-zinc-300"
                            : "text-zinc-300"
                      }`}
                    >
                      {zoneDayOfMonth(ms, tz)}
                    </span>
                    {view === "week" ? (
                      <span className="text-[10px] font-semibold uppercase text-zinc-400">
                        {WEEKDAYS[zoneWeekday(ms, tz)]}
                      </span>
                    ) : null}
                  </div>

                  {/* Entries for this day */}
                  {dayEntries.length === 0 ? (
                    <div className="grid place-items-center py-3 text-[12px] text-zinc-300">
                      –
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {dayEntries.map((e) => (
                        <EntryCard
                          key={e.id}
                          entry={e}
                          compact={view === "month"}
                          tz={tz}
                          draggable={!!onReschedule && !e.preview && !!e.rowId && e.status === "scheduled"}
                          isDragging={draggingRowId === e.rowId}
                          onDragStart={() => { setDraggingRowId(e.rowId ?? null); dragAtRef.current = e.at; }}
                          onDragEnd={() => { setDraggingRowId(null); setDragOverKey(null); }}
                          onDelete={onDelete}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer: next post + platform tally */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-white/[0.04] backdrop-blur-xl px-4 py-3 text-[13px]">
        {/* Left: next post timer + platform badges for that post */}
        <div className="flex items-center gap-1.5 text-zinc-300">
          <Play className="size-3.5 fill-lime-500 text-lime-500" />
          <span className="font-semibold">Next post</span>
          {nextPost ? (
            <span className="text-zinc-400">
              in{" "}
              <span className="font-semibold tabular-nums text-white">
                {relFuture(nextPost.at, now)}
              </span>
              {nextPost.preview ? (
                <span className="ml-1 text-lime-700">(preview)</span>
              ) : null}
            </span>
          ) : (
            <span className="text-zinc-400">&mdash; nothing queued</span>
          )}
          {/* Platform icons for the next post's target accounts */}
          {nextPost && nextPost.platforms.length > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5">
              {nextPost.platforms.slice(0, 5).map((p) => (
                <PlatformGlyph key={p} id={p} size="xs" />
              ))}
              {nextPost.platforms.length > 5 && (
                <span className="ml-0.5 text-[10px] font-semibold text-zinc-500">+{nextPost.platforms.length - 5}</span>
              )}
            </span>
          )}
        </div>

        {/* Right: per-platform tally for the visible window */}
        {(tally.sorted.length > 0 || tally.allAccountsCount > 0) ? (
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            {tally.sorted.map(([p, n]) => (
              <span
                key={p}
                className="inline-flex items-center gap-1.5 text-zinc-400"
              >
                <PlatformGlyph id={p} />
                <span className="font-semibold tabular-nums text-white">{n}</span>
                <span className="capitalize">{PLATFORM_LABEL[p] ?? p}</span>
              </span>
            ))}
            {tally.allAccountsCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-zinc-400">
                <span className="grid size-5 place-items-center rounded-full bg-zinc-700 text-[8px] font-bold text-white">✦</span>
                <span className="font-semibold tabular-nums text-white">{tally.allAccountsCount}</span>
                <span>All accounts</span>
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
    </MotionConfig>
  );
}

/** A single scheduled/preview clip card: thumbnail · time · platform · label.
 *  Live scheduled rows are draggable (HTML5 DnD) to reschedule, and `layout` +
 *  `layoutId` make the chip fly to its new date cell when the drop commits. On
 *  hover it raises a video-preview bubble (portal) with play + caption + platforms. */
function EntryCard({
  entry,
  compact,
  tz,
  draggable = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
  onDelete,
}: {
  entry: CalendarEntry;
  onDelete?: (entry: CalendarEntry) => Promise<string | null>;
  compact: boolean;
  tz: string;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const plat = entry.platforms[0];
  const ref = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openBubble = () => { if (hideTimer.current) clearTimeout(hideTimer.current); setHovered(true); };
  // Small delay so moving the pointer from the chip INTO the bubble doesn't dismiss it.
  const closeBubble = () => { hideTimer.current = setTimeout(() => setHovered(false), 120); };

  return (
    <motion.div
      layout="position"
      layoutId={entry.id}
      transition={{ duration: 0.45, ease: EASE_OUT }}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div
        ref={ref}
        draggable={draggable}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart?.(); }}
        onDragEnd={() => onDragEnd?.()}
        onMouseEnter={openBubble}
        onMouseLeave={closeBubble}
        title={`${entry.label} · ${fmtTime(entry.at, tz)}${entry.preview ? " · forecast" : ` · ${entry.status}`}${draggable ? " · drag to reschedule" : ""}`}
        className={`flex items-center gap-1.5 overflow-hidden rounded-md border px-1.5 py-1 ${chipClass(
          entry.status,
          !!entry.preview,
        )} ${entry.preview ? "opacity-80" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""} transition-shadow hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.3)]`}
      >
        {/* Drag grip, only on reschedulable (live) rows. */}
        {draggable ? (
          <GripVertical className="size-3 shrink-0 opacity-40" aria-hidden="true" />
        ) : null}

        {/* Thumbnail (hidden in dense month cells to keep them tidy) */}
        {!compact ? (
          <div className="size-7 shrink-0 overflow-hidden rounded border border-black/10 bg-black/5">
            {entry.videoUrl ? (
              <video
                src={entry.videoUrl}
                muted
                playsInline
                preload="metadata"
                className="size-full object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center text-current/40">
                <ImageOff className="size-3" />
              </div>
            )}
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-bold tabular-nums">
              {fmtTime(entry.at, tz)}
            </span>
            {plat ? (
              <>
                <PlatformGlyph id={plat} size="xs" />
                {entry.platforms.length > 1 ? (
                  <span className="text-[10px] font-semibold opacity-70">+{entry.platforms.length - 1}</span>
                ) : null}
              </>
            ) : (
              // Empty platforms = posts to ALL connected accounts — show it so the
              // pill always indicates a destination.
              <span className="text-[10px] font-semibold opacity-70">All</span>
            )}
          </div>
          <div className="truncate text-[11px] font-medium leading-tight">
            {entry.label}
          </div>
        </div>
      </div>

      {/* Hover bubble, video preview + caption + platforms, raised above the chip.
          Suppressed while dragging so the ghost + bubble don't fight. */}
      {(hovered || confirmOpen) && !isDragging ? (
        <HoverPreview
          entry={entry}
          tz={tz}
          anchor={ref.current}
          onEnter={openBubble}
          onLeave={closeBubble}
          onRequestDelete={onDelete && entry.status !== "posted" ? () => { setDeleteErr(null); setConfirmOpen(true); } : undefined}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={confirmOpen}
        title="Delete this video?"
        description="This permanently removes the video and cancels its scheduled post. This can't be undone."
        busy={deleting}
        error={deleteErr}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          if (!onDelete) return;
          setDeleting(true);
          const e = await onDelete(entry);
          setDeleting(false);
          if (e) setDeleteErr(e); else { setConfirmOpen(false); setHovered(false); }
        }}
      />
    </motion.div>
  );
}

/** Floating video-preview bubble, portaled to <body> so the calendar's
 *  `overflow-hidden` can't clip it. Positioned above the anchor chip, clamped to
 *  the viewport. Muted autoplay on open; click to play with sound. */
function HoverPreview({
  entry,
  tz,
  anchor,
  onEnter,
  onLeave,
  onRequestDelete,
}: {
  entry: CalendarEntry;
  tz: string;
  anchor: HTMLElement | null;
  onEnter: () => void;
  onLeave: () => void;
  onRequestDelete?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  if (typeof document === "undefined" || !anchor) return null;

  const r = anchor.getBoundingClientRect();
  const WIDTH = 240;
  const GAP = 10;
  const EST_H = 420; // video (max-h-64) + caption/meta block
  // BESIDE the chip: right by default, flip left if it would overflow the viewport.
  const right = r.right + GAP + WIDTH <= window.innerWidth - 8;
  const left = right ? r.right + GAP : Math.max(8, r.left - GAP - WIDTH);
  // Vertically centered on the chip, clamped inside the viewport.
  const top = Math.max(8, Math.min(window.innerHeight - EST_H - 8, r.top + r.height / 2 - EST_H / 2));

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.muted = false; void v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0, x: right ? -8 : 8, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "fixed",
        left,
        top,
        width: WIDTH,
        zIndex: 60,
      }}
      className="pointer-events-auto overflow-hidden rounded-lg bg-[#141210]/90 backdrop-blur-2xl border border-white/10 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.6)]"
    >
      {/* Video (or placeholder) */}
      <div className="relative aspect-[9/16] max-h-64 w-full bg-zinc-950">
        {entry.videoUrl ? (
          <>
            { }
            <video
              ref={videoRef}
              src={entry.videoUrl}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              className="size-full object-contain"
            />
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause preview" : "Play preview with sound"}
              className="absolute inset-0 grid place-items-center bg-black/0 transition-colors hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-400"
            >
              {!playing ? (
                <span className="grid size-11 place-items-center rounded-full bg-white/90 text-zinc-900 shadow-lg backdrop-blur">
                  <Play className="size-5 translate-x-px fill-current" />
                </span>
              ) : null}
            </button>
          </>
        ) : (
          <div className="grid size-full place-items-center text-zinc-400">
            <ImageOff className="size-6" />
          </div>
        )}
      </div>

      {/* Caption + meta */}
      <div className="p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500">
          <span className="tabular-nums">{fmtTime(entry.at, tz)}</span>
          <span className="text-zinc-300">·</span>
          <span className="capitalize">{entry.preview ? "forecast" : entry.status}</span>
        </div>
        <p className="mt-1 line-clamp-3 text-[13px] font-medium leading-snug text-white">
          {entry.label}
        </p>
        {onRequestDelete ? (
          <button
            type="button"
            onClick={onRequestDelete}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-500/25 bg-rose-500/10 px-2 py-1.5 text-[11.5px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/20"
          >
            <Trash2 className="size-3.5" /> Delete video
          </button>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {entry.platforms.length > 0 ? (
            entry.platforms.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full bg-white/10 py-0.5 pl-0.5 pr-2 text-[11px] font-semibold text-zinc-300">
                <PlatformGlyph id={p} size="xs" />
                {PLATFORM_LABEL[p] ?? p}
              </span>
            ))
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-zinc-300">
              All connected
            </span>
          )}
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
