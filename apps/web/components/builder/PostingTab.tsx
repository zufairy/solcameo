"use client";

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { DRIP_STAGGER_MS, computeScheduleTimes, orderClips, existingPerDayFromRows, type PostOrder } from "@/lib/builder/dripStagger";
import { normalizeClipConfig } from "@/lib/builder/clipConfig";
import { effectivePostNowPlatforms } from "@/lib/builder/postNowPlatforms";
import {
  browserTimeZone,
  isValidTimeZone,
  zoneOffsetLabel,
  COMMON_TIMEZONES,
} from "@/lib/builder/timezone";
import SocialConnectionsPanel from "./SocialConnectionsPanel";
import PostingCalendar, { type CalendarEntry, type CalendarStatus } from "./PostingCalendar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Send,
  ExternalLink,
  Download,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  CircleDashed,
  Flame,
  Check,
  CalendarClock,
  MoreVertical,
  Trash2,
  History,
  ShieldAlert,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from "lucide-react";
import TabPageHeader from "./TabPageHeader";

// Same warm-dark "glass" background used across the builder (Home/Editor/
// Schedule) — a near-black base with two soft green glows, not flat black.
const GLASS_BG: React.CSSProperties = {
  background:
    "radial-gradient(120% 90% at 12% -10%, rgba(255,255,255,0.05), transparent 55%), " +
    "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.035), transparent 55%), " +
    "#050506",
};

/** Post-spacing grid: 15-min steps; floor is 1 min so testers can set a fast
 *  drip (sub-15-min snaps to whole minutes). Mirrors normalizeClipConfig. */
const STEP_MS = 15 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Max-per-day slider range (0 = OFF/unlimited). The config clamps to 48; the UI tops at 24. */
const MAX_PER_DAY_SLIDER = 24;

/** Friendly display label for a connected-platform id (falls back to a
 *  capitalized form for any id we don't have a special-case label for). */
const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  threads: "Threads",
  facebook: "Facebook",
};
function platformLabel(id: string): string {
  return PLATFORM_LABELS[id] ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : id);
}

/** Snap ms: 15-min grid at/above 15min, whole-minute grid below it (for the
 *  1-min test mode); clamped to [1min, 24h]. Mirrors normalizeClipConfig. */
function snapInterval(ms: number): number {
  const grid = ms < STEP_MS ? 60 * 1000 : STEP_MS;
  const snapped = Math.round(ms / grid) * grid;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, snapped));
}

/** Human-friendly spacing label, e.g. "2h", "45m", "1h 30m". */
function formatInterval(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Turn a setClipConfig failure into a human reason. The common one is the
 *  server's "Agent not found" — the agent isn't truly minted (no influencers
 *  row), so config can't be persisted yet. */
function saveErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/agent not found/i.test(raw)) {
    return "No saved record for this agent, its mint didn't complete, or the workspace is on an old id. Reopen the agent from your agents list (or re-mint), then set the schedule.";
  }
  return raw || "Couldn't save, try again.";
}

/**
 * Persist a clipConfig via the SIWS-owner-gated /api/agents/config route. The
 * underlying influencers.setClipConfig mutation is now secret-gated and can no
 * longer be called from the browser; auth (Privy Bearer + X-Siws-Session) is
 * auto-attached by the global fetch interceptor. Throws on failure with the
 * server's message (e.g. "Agent not found") so saveErrorMessage keeps working.
 */
async function saveClipConfig(mintAddress: string, clipConfig: unknown): Promise<void> {
  const res = await fetch("/api/agents/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mintAddress, kind: "clip", payload: clipConfig }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
}

/**
 * Builder "Posting" tab (clipper agents). TOP = social connect status + the
 * per-agent "Auto-post" ON/OFF toggle (default OFF — connecting a social is NOT
 * consent). BODY = the postingFeed: every clip (viralScore DESC, best first)
 * with its derived post-state badge.
 *
 * The toggle reads/writes the RAW clipConfig.autoPost field (undefined → OFF) so
 * a brand-new clipper defaults to download-only; it never routes through
 * normalizeClipConfig (whose default would flip it ON). It preserves all other
 * clipConfig fields by spreading the existing object on write.
 */
export default function PostingTab({
  mintAddress,
  sessionId,
  variant = "clipper",
  rightPane,
}: {
  mintAddress?: string;
  sessionId?: string;
  /** "influencer" reuses the whole scheduling surface (status strip, Auto-post
   *  toggle, schedule controls, connections) but swaps the clip-only right pane
   *  (Clips/History + clip-forecast calendar) for `rightPane` — influencers have
   *  generated videos (agentTasks), not clips, so the clip feed is empty for them.
   *  The clip-specific Preview count + Lock-in/Reschedule actions are also hidden. */
  variant?: "clipper" | "influencer";
  rightPane?: ReactNode;
}) {
  const isInfluencer = variant === "influencer";
  const username = mintAddress || sessionId || "";

  // Raw saved per-agent config — source of truth for the toggle. undefined →
  // OFF (default download-only). Do NOT normalize.
  const agent = useQuery(
    api.influencers.getByMint,
    mintAddress ? { mintAddress } : "skip",
  ) as { clipConfig?: Record<string, unknown> } | null | undefined;
  const autoPost = !!(agent?.clipConfig?.autoPost);

  // Spacing/cap for the auto-post drip. Read RAW (undefined → the shared default)
  // so brand-new clippers show the 2h baseline; the canvas + DripBar consume the
  // same fields via computeScheduleTimes. The slider edits are snapped/clamped to
  // the same grid normalizeClipConfig enforces server-side, so display == stored.
  const rawInterval = agent?.clipConfig?.postIntervalMs;
  const storedIntervalMs =
    typeof rawInterval === "number" && Number.isFinite(rawInterval) && rawInterval > 0
      ? snapInterval(rawInterval)
      : DRIP_STAGGER_MS;
  const rawMaxPerDay = agent?.clipConfig?.maxPerDay;
  const storedMaxPerDay =
    typeof rawMaxPerDay === "number" && Number.isFinite(rawMaxPerDay) && rawMaxPerDay > 0
      ? Math.floor(rawMaxPerDay)
      : 0;
  // Publish order (best/newest/oldest/random) + optional daily start time.
  const rawPostOrder = agent?.clipConfig?.postOrder;
  const storedPostOrder: PostOrder =
    rawPostOrder === "newest" || rawPostOrder === "oldest" || rawPostOrder === "random"
      ? rawPostOrder
      : "best";
  const rawStartHour = agent?.clipConfig?.dailyStartHour;
  const storedDailyHour =
    typeof rawStartHour === "number" && Number.isFinite(rawStartHour) ? Math.min(23, Math.max(0, Math.floor(rawStartHour))) : null;
  const rawStartMin = agent?.clipConfig?.dailyStartMinute;
  const storedDailyMinute =
    typeof rawStartMin === "number" && Number.isFinite(rawStartMin) ? Math.min(59, Math.max(0, Math.floor(rawStartMin))) : 0;
  // Posting channels — clipConfig.platforms is the source of truth. NON-EMPTY =
  // post ONLY to those; EMPTY [] = post to ALL connected ("post everywhere").
  // undefined is treated as [] (all). Read as a clean string[] for the chips.
  const rawPlatforms = agent?.clipConfig?.platforms;
  const storedPlatforms = useMemo<string[]>(
    () =>
      Array.isArray(rawPlatforms)
        ? rawPlatforms.filter((p): p is string => typeof p === "string")
        : [],
    [rawPlatforms],
  );
  // Scheduling timezone — clipConfig.timezone is the source of truth; when unset
  // (or an invalid id) the schedule + calendar follow the browser's zone. This
  // is the EFFECTIVE zone every wall-clock helper (computeScheduleTimes,
  // day-bucketing, the calendar) reads from.
  const rawTimezone = agent?.clipConfig?.timezone;
  const storedTimezone =
    typeof rawTimezone === "string" && isValidTimeZone(rawTimezone)
      ? rawTimezone
      : browserTimeZone();

  const [saving, setSaving] = useState(false);
  // Surfaced write feedback — setClipConfig used to fail SILENTLY (no catch), so
  // an un-minted agent (synthetic `vello_…` id with no influencers row → server
  // throws "Agent not found") showed "Saving…" then nothing. Now errors render.
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // LOCAL slider state — initialised from the stored clipConfig but driven live
  // by the sliders so the calendar can show a forecast at the CURRENT (possibly
  // unsaved) values. Re-sync whenever the stored values change (load / external
  // save) so display == stored once a commit lands. Snapped/clamped to the same
  // grid the server enforces.
  const [localIntervalMs, setLocalIntervalMs] = useState(storedIntervalMs);
  const [localMaxPerDay, setLocalMaxPerDay] = useState(storedMaxPerDay);
  const [localPostOrder, setLocalPostOrder] = useState<PostOrder>(storedPostOrder);
  // Daily start: an enable flag + hour/minute. Off = legacy "first post one
  // interval from now"; on = anchor each day's first post at this clock time.
  const [localDailyEnabled, setLocalDailyEnabled] = useState(storedDailyHour !== null);
  const [localDailyHour, setLocalDailyHour] = useState(storedDailyHour ?? 9);
  const [localDailyMinute, setLocalDailyMinute] = useState(storedDailyMinute);
  // Local posting-channels edit. [] = all connected ("post everywhere").
  const [localPlatforms, setLocalPlatforms] = useState<string[]>(storedPlatforms);
  // Local scheduling-timezone edit. Defaults to the stored/effective zone.
  const [localTimezone, setLocalTimezone] = useState<string>(storedTimezone);
  // Configure→save LOCK: sliders ship LOCKED (read-only) showing the saved
  // schedule. "Configure" unlocks them for editing; "Save" persists, "Cancel"
  // reverts — both re-lock. So a value can't be nudged by accident; you opt into
  // an edit, then commit it. While editing, an external stored change must NOT
  // clobber the in-progress edit, so the re-sync effects are gated on !editing.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setLocalIntervalMs(storedIntervalMs);
  }, [storedIntervalMs, editing]);
  useEffect(() => {
    if (!editing) setLocalMaxPerDay(storedMaxPerDay);
  }, [storedMaxPerDay, editing]);
  useEffect(() => {
    if (!editing) setLocalPostOrder(storedPostOrder);
  }, [storedPostOrder, editing]);
  useEffect(() => {
    if (!editing) {
      setLocalDailyEnabled(storedDailyHour !== null);
      if (storedDailyHour !== null) setLocalDailyHour(storedDailyHour);
      setLocalDailyMinute(storedDailyMinute);
    }
  }, [storedDailyHour, storedDailyMinute, editing]);
  useEffect(() => {
    if (!editing) setLocalPlatforms(storedPlatforms);
  }, [storedPlatforms, editing]);
  useEffect(() => {
    if (!editing) setLocalTimezone(storedTimezone);
  }, [storedTimezone, editing]);

  // Live connection check — drives the "connect first" gate so connecting a
  // social (without flipping ON) never implies consent, and ON with zero
  // connected can't silently post. Mirrors SocialConnectionsPanel's status call.
  const { accessToken } = useSupabaseAuth();
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);

  // Live connection state, re-checked on mount AND whenever the window regains
  // focus / becomes visible — connecting an account happens in the upload-post
  // popup/tab, so on return we re-poll instead of showing a stale "0 connected".
  const refreshStatus = useCallback(async () => {
    if (!username || !accessToken) {
      // No way to verify (no auth) → leave UNKNOWN (null), don't force "0
      // connected" which would wrongly gate the toggle while the panel auths.
      setConnectedCount((c) => c ?? null);
      return;
    }
    try {
      const res = await fetch(
        `/api/social/status?username=${encodeURIComponent(username)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return; // transient (502/limit), keep last known, never force 0
      const json = (await res.json()) as { connected?: Record<string, unknown>; ok?: boolean };
      if (json.ok === false) return; // route-level error, don't clobber to 0
      const conn = json.connected ?? {};
      setConnectedCount(Object.values(conn).filter(Boolean).length);
      setConnectedPlatforms(Object.keys(conn).filter((k) => Boolean(conn[k])));
    } catch {
      // Network blip — keep the last known count so the toggle doesn't flap to
      // disabled. Only a successful 200 with 0 connected actually gates it.
    }
  }, [username, accessToken]);

  useEffect(() => {
    void refreshStatus();
    const onFocus = () => void refreshStatus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshStatus]);

  const feed = useQuery(
    api.clipJobs.postingFeed,
    mintAddress ? { mintAddress } : "skip",
  );

  // Live scheduledContent rows — the lock-in uses them for the dedup Set + per-day
  // seeding (the same source the calendar uses for its solid "scheduled" chips).
  const scheduledRows = useQuery(
    api.scheduledContent.listByMint,
    mintAddress ? { mintAddress } : "skip",
  ) as { _id: string; videoUrl?: string; scheduledFor?: number; status?: string }[] | undefined;

  // LOCK IN: commit the dashed PREVIEW (forecast of unposted clips) into REAL
  // scheduledContent rows so the drip actually posts them. The clips the preview
  // forecasts = not_posted feed rows with a clipUrl; we skip any already in the
  // schedule (idempotent — /api/schedule/create has no dedup of its own).
  const [locking, setLocking] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);
  // RESCHEDULE-ALL: clears every active scheduled row then re-times the full
  // queued+pending set at the CURRENT config (the "flexible/editable" core).
  const [rescheduling, setRescheduling] = useState(false);
  const notPostedClips = useMemo(
    () => ((feed ?? []) as FeedRow[]).filter((c) => c.state === "not_posted" && c.clipUrl),
    [feed],
  );
  const unqueuedClips = useMemo(() => {
    const taken = new Set<string>();
    for (const r of scheduledRows ?? []) {
      if (r.videoUrl && r.status !== "cancelled" && r.status !== "failed") taken.add(r.videoUrl);
    }
    return notPostedClips.filter((c) => c.clipUrl && !taken.has(c.clipUrl));
  }, [notPostedClips, scheduledRows]);

  // ── Post now: publish the NEXT-UP clip to ALL connected accounts immediately ──
  const [postingNow, setPostingNow] = useState(false);
  const [postNowMsg, setPostNowMsg] = useState<string | null>(null);
  // The clip Post Now publishes. Prefer the drip's NEXT not-yet-posted clip (drip
  // order over the not-posted set). If nothing is queued as "not_posted" (e.g. every
  // clip is already scheduled/posted), FALL BACK to the newest generated clip that
  // has a rendered URL — so Post Now can always publish the latest video instead of
  // being disabled while content clearly exists. /api/social/post's claim guards a
  // genuine double-post (returns "already posted") and generates the persona caption.
  const nextToPost = useMemo<FeedRow | undefined>(() => {
    const next = (orderClips(notPostedClips, localPostOrder) as FeedRow[])[0];
    if (next) return next;
    const withUrl = ((feed ?? []) as FeedRow[]).filter((c) => c.clipUrl);
    return withUrl.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  }, [notPostedClips, localPostOrder, feed]);
  // The channels "Post now" will publish to: the configured set, else ALL connected.
  const postNowPlatforms = useMemo(
    () => effectivePostNowPlatforms(localPlatforms, connectedPlatforms),
    [localPlatforms, connectedPlatforms],
  );
  const handlePostNow = useCallback(async () => {
    if (!mintAddress || postingNow) return;
    const clip = nextToPost;
    if (!clip || !clip.clipUrl) { setPostNowMsg("No clip ready to post. Generate clips in the Clipping tab first."); return; }
    // No client-side connection gate: the connected-account poll can lag, so we let
    // the server resolve the agent's connected accounts (it falls back to the cached
    // list / live upload-post profile) and surface a clear error only if truly none.
    setPostingNow(true);
    setPostNowMsg("Posting the latest clip to your connected accounts…");
    try {
      const headers = { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
      // /api/social/post posts the video to every connected platform NOW, claims the
      // clip (ready→posting→posted) so the drip can't double-post it, and auto-submits
      // a campaign clip. The post caption is the clip's skill-generated hook title
      // (from the analysis of THIS video), so it's relevant + on-brand.
      // Post to the configured channels, else ALL connected ("post everywhere").
      // The server also re-resolves an empty list to the connected accounts, so a
      // stale/empty client list still posts instead of 400-ing.
      const platforms = postNowPlatforms;
      const res = await fetch("/api/social/post", {
        method: "POST",
        headers,
        body: JSON.stringify({
          username: mintAddress,
          platforms,
          type: "video",
          title: clip.title || "New clip",
          description: clip.title || "",
          mediaUrls: [clip.clipUrl],
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; posted?: string[]; skipped?: string[]; error?: string; alreadyPosted?: boolean };
      if (j.alreadyPosted) {
        setPostNowMsg("That clip was already posted.");
      } else if (res.ok && j.ok) {
        const where = (j.posted ?? connectedPlatforms).map((p) => platformLabel(p)).join(", ");
        setPostNowMsg(`✅ Posted "${(clip.title || "clip").slice(0, 40)}" to ${where}.`);
      } else {
        setPostNowMsg(`Post failed: ${j.error ?? `HTTP ${res.status}`}`);
      }
    } catch (e) {
      setPostNowMsg(`Post failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setPostingNow(false);
    }
  }, [mintAddress, postingNow, connectedPlatforms, postNowPlatforms, nextToPost, accessToken]);

  const lockInSchedule = useCallback(async () => {
    if (!mintAddress || locking || rescheduling || unqueuedClips.length === 0) return;
    if (connectedPlatforms.length === 0) { setLockMsg("Connect a social account first, there's nothing to post to."); return; }
    setLocking(true);
    setLockMsg(null);
    try {
      // Mirror the canvas auto-post path EXACTLY so the committed times == the
      // dashed preview: same order, same per-day seeding, same compute, same route.
      // orderClips' generic narrows to its sort constraint (viralScore/createdAt);
      // cast back so clipUrl/title stay accessible (mirrors the canvas auto-post path).
      const ordered = orderClips(unqueuedClips, localPostOrder) as FeedRow[];
      const nowMs = Date.now();
      const existingPerDay = existingPerDayFromRows(scheduledRows ?? [], nowMs, localTimezone);
      const times = computeScheduleTimes(ordered.length, {
        intervalMs: localIntervalMs,
        maxPerDay: localMaxPerDay,
        ...(localMaxPerDay > 0 ? { existingPerDay } : {}),
        now: nowMs,
        ...(localDailyEnabled ? { dailyStartHour: localDailyHour, dailyStartMinute: localDailyMinute } : {}),
        timeZone: localTimezone,
      });
      const headers = { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
      let queued = 0;
      for (let i = 0; i < ordered.length; i++) {
        const c = ordered[i];
        if (!c.clipUrl) continue;
        const res = await fetch("/api/schedule/create", {
          method: "POST",
          headers,
          body: JSON.stringify({
            mintAddress,
            sessionId,
            scheduledFor: times[i] ?? (nowMs + (i + 1) * localIntervalMs),
            topic: c.title || "Clip",
            caption: "", // post_content auto-generates the per-clip caption at post time
            platforms: localPlatforms,
            videoUrl: c.clipUrl,
          }),
        });
        if (res.ok) queued += 1;
      }
      setLockMsg(queued > 0 ? `Locked in, ${queued} clip${queued === 1 ? "" : "s"} scheduled. The drip will post them on your schedule.` : "Nothing new to schedule.");
    } catch (e) {
      setLockMsg(e instanceof Error ? `Couldn't schedule, ${e.message}` : "Couldn't schedule, try again.");
    } finally {
      setLocking(false);
    }
  }, [mintAddress, locking, rescheduling, unqueuedClips, connectedPlatforms, scheduledRows, localPostOrder, localIntervalMs, localMaxPerDay, localDailyEnabled, localDailyHour, localDailyMinute, localTimezone, localPlatforms, accessToken, sessionId]);

  // UNSCHEDULE one queued clip — cancels its active scheduledContent row WITHOUT
  // deleting the clip. The row → cancelled, so postingFeed re-derives the clip as
  // not_posted (re-schedulable). Finds the row by videoUrl === clip.clipUrl among
  // the active (scheduled|posting) rows. (Delete still hard-removes the clip.)
  const unscheduleClip = useCallback(async (clip: FeedRow) => {
    if (!mintAddress || !clip.clipUrl) return;
    // Cancel EVERY active row for this clip (normally exactly one — the slot-dedup
    // guarantees it — but loop so a rare double-row can't leave the clip partially
    // queued). filter, not find.
    const rows = (scheduledRows ?? []).filter(
      (r) => r.videoUrl === clip.clipUrl && (r.status === "scheduled" || r.status === "posting"),
    );
    if (rows.length === 0) return; // nothing active to free
    const headers = { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
    for (const row of rows) {
      const res = await fetch("/api/schedule/cancel", {
        method: "POST",
        headers,
        body: JSON.stringify({ id: row._id, mintAddress }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || j.ok === false) {
        throw new Error(j.error || `Unschedule failed (${res.status})`);
      }
    }
    // On ok the drip row is cancelled; the postingFeed + scheduledRows
    // subscriptions reconcile and the clip falls back to not_posted.
  }, [mintAddress, scheduledRows, accessToken]);

  // RESCHEDULE ALL — re-time everything at the CURRENT config. (a) AWAIT a cancel
  // for EVERY active row (so /api/schedule/create's by_mint_video dedup doesn't
  // see a still-active old row and return it — that would strand the new time);
  // THEN (b) re-create the full target set (queued + not_posted clips with a
  // clipUrl), ordered + timed at the current local settings (NO existingPerDay —
  // we just cleared everything). Change spacing/order/timezone → click → re-times.
  const rescheduleAll = useCallback(async () => {
    if (!mintAddress || rescheduling || locking) return;
    if (connectedPlatforms.length === 0) { setLockMsg("Connect a social account first, there's nothing to post to."); return; }
    const targets = ((feed ?? []) as FeedRow[]).filter(
      (c) => (c.state === "queued" || c.state === "not_posted") && c.clipUrl,
    );
    if (targets.length === 0) { setLockMsg("Nothing to reschedule yet."); return; }
    // Destructive: clears the live schedule + re-times everything. Confirm first.
    const activeCount = (scheduledRows ?? []).filter(
      (r) => r.videoUrl && (r.status === "scheduled" || r.status === "posting"),
    ).length;
    if (typeof window !== "undefined" && !window.confirm(
      `Reschedule all?\n\nThis cancels the ${activeCount} currently scheduled post${activeCount === 1 ? "" : "s"} and re-times ${targets.length} clip${targets.length === 1 ? "" : "s"} from now at your current settings (spacing, daily cap, order, daily-start, timezone).`,
    )) return;
    setRescheduling(true);
    setLockMsg(null);
    try {
      const headers = { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
      // (a) Clear every active scheduled row — AWAIT each so the cancel has
      // committed in Convex before we re-create (else dedup returns the old row).
      // CHECK the response per cancel (mirrors unscheduleClip): a SILENT cancel
      // failure would strand the old active row, so /api/schedule/create's
      // by_mint_video dedup returns it and the re-created post collides/dedups
      // onto the stale time. So ABORT before re-creating on any failure rather
      // than leaving a half-cleared schedule.
      const activeRows = (scheduledRows ?? []).filter(
        (r) => r.videoUrl && (r.status === "scheduled" || r.status === "posting"),
      );
      let cancelled = 0;
      for (const r of activeRows) {
        const res = await fetch("/api/schedule/cancel", {
          method: "POST",
          headers,
          body: JSON.stringify({ id: r._id, mintAddress }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || j.ok === false) {
          // Partial failure — surface what cleared vs. what's left and STOP. We
          // have NOT re-created anything yet, so the schedule is left intact
          // (minus whatever cancelled) instead of half-cleared + colliding.
          setLockMsg(
            `Couldn't reschedule, cancelling the current schedule failed after ${cancelled}/${activeRows.length} cleared (${j.error || `HTTP ${res.status}`}). Nothing was re-timed; try again.`,
          );
          return;
        }
        cancelled += 1;
      }
      // (b) Re-schedule the full target set at the CURRENT config — fresh times,
      // no existingPerDay seeding (the schedule was just cleared).
      const ordered = orderClips(targets, localPostOrder) as FeedRow[];
      const nowMs = Date.now();
      const times = computeScheduleTimes(ordered.length, {
        intervalMs: localIntervalMs,
        maxPerDay: localMaxPerDay,
        now: nowMs,
        ...(localDailyEnabled ? { dailyStartHour: localDailyHour, dailyStartMinute: localDailyMinute } : {}),
        timeZone: localTimezone,
      });
      let queued = 0;
      for (let i = 0; i < ordered.length; i++) {
        const c = ordered[i];
        if (!c.clipUrl) continue;
        const res = await fetch("/api/schedule/create", {
          method: "POST",
          headers,
          body: JSON.stringify({
            mintAddress,
            sessionId,
            scheduledFor: times[i] ?? (nowMs + (i + 1) * localIntervalMs),
            topic: c.title || "Clip",
            caption: "",
            platforms: localPlatforms,
            videoUrl: c.clipUrl,
          }),
        });
        if (res.ok) queued += 1;
      }
      setLockMsg(queued > 0 ? `Rescheduled, ${queued} clip${queued === 1 ? "" : "s"} re-timed at the current settings.` : "Couldn't reschedule, try again.");
    } catch (e) {
      setLockMsg(e instanceof Error ? `Couldn't reschedule, ${e.message}` : "Couldn't reschedule, try again.");
    } finally {
      setRescheduling(false);
    }
  }, [mintAddress, rescheduling, locking, connectedPlatforms, feed, scheduledRows, localPostOrder, localIntervalMs, localMaxPerDay, localDailyEnabled, localDailyHour, localDailyMinute, localTimezone, localPlatforms, accessToken, sessionId]);

  // The REAL write gate: setClipConfig patches an influencers row keyed by
  // mintAddress. `agent === undefined` = query still loading; `agent === null` =
  // loaded but NO row (un-minted draft / synthetic `vello_…` id) → every write
  // would throw "Agent not found". Gate config on row presence, not just a
  // truthy id, so the UI never offers a control that silently fails.
  const agentLoading = agent === undefined && !!mintAddress;
  const rowMissing = !mintAddress || agent === null;
  const noConnections = connectedCount === 0;
  const toggleDisabled = saving || rowMissing || agentLoading || noConnections;

  const onToggle = async (next: boolean) => {
    if (!mintAddress) return;
    setSaving(true);
    setWriteErr(null);
    try {
      // Normalize the MERGED config so the write always carries every required
      // field (a raw partial spread over an empty/partial clipConfig omits
      // required keys → the schema validator rejects it as a "Server Error").
      //
      // PIN THE SCHEDULING ZONE on enable. `scheduledFor` is stored as a bare
      // absolute epoch with no record of the zone it was computed in, and the
      // producers (canvas auto-post / manual drip) fall back to a LIVE
      // `browserTimeZone()` when clipConfig.timezone is unset — while the calendar
      // re-buckets by the VIEWER's live browser zone. Two independent
      // browserTimeZone() fallbacks over one bare epoch = a one-calendar-day
      // prior-cell shift when the producing host and the viewing browser differ.
      // Persisting the resolved zone here (storedTimezone already collapses the
      // unset case to a concrete IANA id) means every later stamp AND every render
      // read the SAME stored value, so the fallback can never fire on two sides.
      const patch: Record<string, unknown> = { ...(agent?.clipConfig ?? {}), autoPost: next };
      if (next && !(typeof rawTimezone === "string" && isValidTimeZone(rawTimezone))) {
        patch.timezone = storedTimezone;
      }
      await saveClipConfig(mintAddress, normalizeClipConfig(patch));
    } catch (e) {
      setWriteErr(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Persist a partial clipConfig patch (spacing / cap), preserving every other
  // field. The merged object is run through normalizeClipConfig HERE (the
  // mutation stores it verbatim — it does NOT normalize), so the write is always
  // a complete, schema-valid config. Throws on failure so the caller can surface
  // it (a silent throw used to hang the button on "Saving…").
  const patchConfig = async (patch: Record<string, unknown>) => {
    if (!mintAddress) throw new Error("This agent has no wallet/mint yet.");
    setSaving(true);
    try {
      // normalizeClipConfig fills EVERY required field from defaults, so even a
      // first-time write over an empty clipConfig is a complete, schema-valid
      // object (the strict-object validator used to reject partials).
      await saveClipConfig(
        mintAddress,
        normalizeClipConfig({ ...(agent?.clipConfig ?? {}), ...patch }),
      );
    } finally {
      setSaving(false);
    }
  };

  // Schedule edit lifecycle (the configure→save lock). `scheduleDirty` is true
  // once the local sliders diverge from the stored values, so Save can be a no-op
  // guard. Save persists BOTH fields in one patch then re-locks; Cancel reverts
  // local back to stored and re-locks.
  // Effective daily-start values for the current local edit (null hour = OFF).
  const effDailyHour = localDailyEnabled ? localDailyHour : null;
  // Channels are dirty if the SET differs (order-insensitive): same length and
  // every stored id present in the local selection.
  const platformsDirty =
    localPlatforms.length !== storedPlatforms.length ||
    storedPlatforms.some((p) => !localPlatforms.includes(p));
  const scheduleDirty =
    snapInterval(localIntervalMs) !== storedIntervalMs ||
    Math.max(0, Math.floor(localMaxPerDay)) !== storedMaxPerDay ||
    localPostOrder !== storedPostOrder ||
    effDailyHour !== storedDailyHour ||
    (effDailyHour !== null && localDailyMinute !== storedDailyMinute) ||
    localTimezone !== storedTimezone ||
    platformsDirty;
  const saveSchedule = async () => {
    // Cross-guard against an in-flight lock-in / reschedule (mirrors how those two
    // guard each other): persisting new spacing/order mid-schedule would re-seed
    // the cap from rows the other op is concurrently mutating.
    if (locking || rescheduling) return;
    setWriteErr(null);
    try {
      await patchConfig({
        postIntervalMs: snapInterval(localIntervalMs),
        maxPerDay: Math.max(0, Math.floor(localMaxPerDay)),
        postOrder: localPostOrder,
        // Daily start: send the hour/minute when enabled, else clear it (undefined
        // → normalizeClipConfig drops it → legacy "one interval from now").
        dailyStartHour: localDailyEnabled ? localDailyHour : undefined,
        dailyStartMinute: localDailyEnabled ? localDailyMinute : undefined,
        // Posting channels — [] = all connected ("post everywhere").
        platforms: localPlatforms,
        // Scheduling timezone — the wall-clock zone the drip + calendar follow.
        timezone: localTimezone,
      });
      setEditing(false);
      setSavedOk(true);
      window.setTimeout(() => setSavedOk(false), 2500);
    } catch (e) {
      // Stay in edit mode so the user can retry/cancel; show the real reason.
      setWriteErr(saveErrorMessage(e));
    }
  };
  const cancelSchedule = () => {
    setLocalIntervalMs(storedIntervalMs);
    setLocalMaxPerDay(storedMaxPerDay);
    setLocalPostOrder(storedPostOrder);
    setLocalDailyEnabled(storedDailyHour !== null);
    setLocalDailyHour(storedDailyHour ?? 9);
    setLocalDailyMinute(storedDailyMinute);
    setLocalPlatforms(storedPlatforms);
    setLocalTimezone(storedTimezone);
    setEditing(false);
  };

  // Right-pane tab (CockpitD "Pinned deck + tabbed right" layout). Calendar is
  // only meaningful when Auto-post is ON — when OFF the Calendar tab is hidden
  // and the pane defaults to Clips (see the effective-tab resolution below).
  const [rightTab, setRightTab] = useState<"calendar" | "clips" | "history">("calendar");

  // Status-strip stats. "scheduled" = live scheduledContent rows in an active
  // state; "preview" = ready-but-unposted clips (the same set the forecast
  // previews); the tz chip shows the effective local zone + its live offset.
  const scheduledCount = useMemo(
    () =>
      (scheduledRows ?? []).filter(
        (r) => r.status === "scheduled" || r.status === "posting" || r.status === "posted",
      ).length,
    [scheduledRows],
  );
  const previewCount = notPostedClips.length;
  const tzOffset = useMemo(() => zoneOffsetLabel(localTimezone, Date.now()), [localTimezone]);

  // Live clip counts for the tab badges (mirror ClipSections' own split).
  const liveClipCount = useMemo(
    () => ((feed ?? []) as FeedRow[]).filter((c) => c.state !== "posted").length,
    [feed],
  );
  const postedClipCount = useMemo(
    () => ((feed ?? []) as FeedRow[]).filter((c) => c.state === "posted").length,
    [feed],
  );

  // Calendar tab only exists when Auto-post is ON; otherwise resolve to Clips so
  // the pane never shows an empty/hidden tab.
  const effectiveTab = autoPost ? rightTab : rightTab === "calendar" ? "clips" : rightTab;

  return (
    <div
      className="min-h-full px-6 py-6"
      style={{ ...GLASS_BG, fontFamily: "var(--font-geist-sans, system-ui)" }}
    >
      <div className="mx-auto max-w-[1100px]">
        {/* ── Title ────────────────────────────────────────────────────── */}
        <TabPageHeader icon={Send} title="Posting" blurb="Connect socials, turn on Auto-post, done." />

        {/* ── STATUS STRIP, one wrapped row (toggle · counts · timezone) ── */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-white/[0.04] backdrop-blur-xl px-4 py-3">
          {/* Auto-post toggle (inline), same real handler + gating */}
          <div className="flex items-center gap-2.5 pr-1">
            <button
              type="button"
              role="switch"
              aria-checked={autoPost}
              aria-label="Auto-post"
              disabled={toggleDisabled}
              onClick={() => void onToggle(!autoPost)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-500 focus-visible:ring-offset-2 ${
                autoPost ? "bg-lime-500" : "bg-white/15"
              } ${toggleDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              <span
                className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform ${
                  autoPost ? "translate-x-[22px]" : "translate-x-[2px]"
                }`}
              />
            </button>
            <span className="text-[13px] font-bold tracking-tight text-white">
              Auto-post
            </span>
            <span
              className={`text-[10.5px] font-bold uppercase tracking-[0.08em] ${
                autoPost ? "text-lime-700" : "text-zinc-400"
              }`}
            >
              {autoPost ? "On" : "Off"}
            </span>
          </div>

          <span className="hidden h-6 w-px bg-white/10 sm:block" />

          {/* Next post hint */}
          <span className="inline-flex items-baseline gap-1.5 text-[12.5px]">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Next</span>
            <span className="font-bold text-white">
              {autoPost ? "on the drip" : "off"}
            </span>
          </span>

          {/* Scheduled (active scheduledContent rows) */}
          <span className="inline-flex items-baseline gap-1.5 text-[12.5px]">
            <span className="font-bold tabular-nums text-white">{scheduledCount}</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Scheduled</span>
          </span>

          {/* Preview (ready-but-unposted clips), clip-only, hidden for influencers */}
          {!isInfluencer && (
            <span className="inline-flex items-baseline gap-1.5 text-[12.5px]">
              <span className="font-bold tabular-nums text-lime-700">{previewCount}</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Preview</span>
            </span>
          )}

          {/* Timezone chip */}
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-[12px] font-semibold text-zinc-400">
            <span className="tabular-nums">{localTimezone}</span>
            <span className="rounded bg-white/10 px-1 text-[11px] tabular-nums text-zinc-500">
              {tzOffset}
            </span>
          </span>
        </div>

        {/* ── Status messaging (un-minted / loading / no-connections / write err) ── */}
        {rowMissing ? (
          <p className="mt-2 text-[12px] font-medium text-amber-400">
            No saved record for this agent (mint incomplete, or the workspace is
            on an old id), auto-post &amp; scheduling are off until it&apos;s
            minted. Connecting socials still works.
          </p>
        ) : agentLoading ? (
          <p className="mt-2 text-[12px] font-medium text-zinc-500">Loading agent…</p>
        ) : noConnections ? (
          <p className="mt-2 text-[12px] font-medium text-amber-400">
            Connect an account first, connecting alone never posts.
          </p>
        ) : null}
        {writeErr ? (
          <p className="mt-1.5 text-[12px] font-medium text-red-400">{writeErr}</p>
        ) : null}

        {/* ── BODY: 2 columns, LEFT pinned control / RIGHT tabbed pane ─── */}
        <div className="mt-3 grid items-start gap-3 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          {/* LEFT, pinned control column */}
          <div className="rounded-2xl bg-white/[0.04] backdrop-blur-xl p-4 lg:sticky lg:top-3">
            {/* Connected-platform chips */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-zinc-500">Channels</span>
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-400">
                {connectedPlatforms.length} connected
              </span>
            </div>
            {connectedPlatforms.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {connectedPlatforms.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-full border-2 border-lime-500 bg-lime-400/10 px-2 py-0.5 text-[12px] font-semibold text-lime-200"
                  >
                    {platformLabel(id)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11.5px] leading-snug text-zinc-400">
                No accounts connected yet.
              </p>
            )}

            {/* Connections, disclosure keeps SocialConnectionsPanel accessible
                to connect/disconnect without dominating the pinned column. */}
            <details className="group mt-3 border-t border-white/10 pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-semibold text-zinc-100">
                Connections
                <span className="ml-auto rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors group-hover:bg-emerald-600 group-open:hidden">
                  Show
                </span>
                <span className="ml-auto hidden rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition-colors group-hover:bg-white/15 group-open:inline">
                  Hide
                </span>
              </summary>
              <div className="mt-2">
                {username ? (
                  // variant="dark": this column is a dark surface — the paper
                  // theme rendered the platform names near-black/unreadable.
                  <SocialConnectionsPanel
                    username={username}
                    variant="dark"
                    bare
                    hideHeader
                  />
                ) : (
                  <p className="text-[12px] text-zinc-400">
                    Mint or save this agent to connect social accounts.
                  </p>
                )}
              </div>
            </details>

            {/* Scheduling controls + lock-in, ONLY when Auto-post is ON (OFF =
                clips just download, so there's nothing to schedule). */}
            {autoPost ? (
              <div className="mt-2">
                {/* Posting schedule: spacing + daily cap. As the operator DRAGS, the
                    local values update live (re-timing the calendar preview);
                    on release they persist to clipConfig, driving BOTH the canvas
                    auto-scheduler and the manual drip (via computeScheduleTimes). */}
                <ScheduleControls
                  intervalMs={localIntervalMs}
                  maxPerDay={localMaxPerDay}
                  postOrder={localPostOrder}
                  dailyEnabled={localDailyEnabled}
                  dailyHour={localDailyHour}
                  dailyMinute={localDailyMinute}
                  timeZone={localTimezone}
                  connectedPlatforms={connectedPlatforms}
                  platforms={localPlatforms}
                  disabled={!editing || saving || rowMissing}
                  onIntervalDraft={setLocalIntervalMs}
                  onMaxPerDayDraft={setLocalMaxPerDay}
                  onIntervalCommit={(ms) => setLocalIntervalMs(snapInterval(ms))}
                  onMaxPerDayCommit={(n) => setLocalMaxPerDay(Math.max(0, Math.floor(n)))}
                  onPostOrder={setLocalPostOrder}
                  onDailyEnabled={setLocalDailyEnabled}
                  onDailyTime={(h, m) => { setLocalDailyHour(h); setLocalDailyMinute(m); }}
                  onTimeZone={setLocalTimezone}
                  onPlatforms={setLocalPlatforms}
                />

                {/* Configure→save lock footer. LOCKED: a single "Configure schedule"
                    button unlocks the sliders. EDITING: Save persists both values +
                    re-locks, Cancel reverts. */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void saveSchedule()}
                        disabled={saving || rowMissing || !scheduleDirty || locking || rescheduling}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-lime-500 px-4 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-lime-400 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save schedule"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelSchedule}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] backdrop-blur-xl px-4 py-2 text-[13px] font-semibold text-zinc-300 transition hover:border-white/10 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      {writeErr ? (
                        <span className="ml-1 text-[12px] font-medium text-red-400">{writeErr}</span>
                      ) : scheduleDirty ? (
                        <span className="ml-1 text-[12px] font-medium text-amber-400">Unsaved changes</span>
                      ) : (
                        <span className="ml-1 text-[12px] text-zinc-500">No changes yet, drag a slider</span>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(true)}
                        disabled={rowMissing}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] backdrop-blur-xl px-4 py-2 text-[13px] font-semibold text-zinc-100 transition hover:border-white/10 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Configure schedule
                      </button>
                      {savedOk ? (
                        <span className="ml-1 inline-flex items-center gap-1 text-[12px] font-semibold text-lime-700">
                          Saved
                        </span>
                      ) : (
                        <span className="ml-1 inline-flex items-center gap-1 text-[12px] text-zinc-500">
                          Spacing: {formatInterval(localIntervalMs)}
                          {localMaxPerDay > 0 ? ` · max ${localMaxPerDay}/day` : ""}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Flexible schedule actions: Lock in (queue the unqueued) +
                    Reschedule all (clear + re-time everything at current config).
                    Rendered whenever there's something to queue OR something
                    already queued, so the schedule is never frozen. */}
                {!isInfluencer && mintAddress && (unqueuedClips.length > 0 || scheduledCount > 0) ? (
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {unqueuedClips.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => void lockInSchedule()}
                          disabled={locking || rescheduling || connectedPlatforms.length === 0}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-lime-500 px-4 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-lime-400 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {locking ? <Loader2 className="size-4 animate-spin" /> : null}
                          {locking ? "Scheduling…" : `Lock in schedule (${unqueuedClips.length} clip${unqueuedClips.length === 1 ? "" : "s"})`}
                        </button>
                      ) : null}
                      {scheduledCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => void rescheduleAll()}
                          disabled={rescheduling || locking || connectedPlatforms.length === 0}
                          title="Clear every queued post and re-time them all at the current spacing, order, and timezone."
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] backdrop-blur-xl px-4 py-2 text-[13px] font-bold text-zinc-100 transition hover:border-white/10 hover:bg-white/5 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {rescheduling ? <Loader2 className="size-4 animate-spin" /> : null}
                          {rescheduling ? "Rescheduling…" : "Reschedule all"}
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11.5px] leading-snug text-zinc-400">
                      {connectedPlatforms.length === 0
                        ? "Connect a social account first, then lock in to commit these previewed times into the real schedule."
                        : lockMsg ?? "Lock in schedules the unqueued clips at the previewed times. Reschedule all clears the queue and re-times everything at the current settings. Per-clip Unschedule frees one clip back to draft; Delete removes it entirely."}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 border-t border-white/10 pt-3 text-[11.5px] leading-snug text-zinc-500">
                Off, finished clips are saved as downloads only. Turn ON Auto-post
                above to schedule + preview the drip.
              </p>
            )}
          </div>

          {/* RIGHT, clipper: tabbed clip pane; influencer: the scheduled-videos pane */}
          <div className="rounded-2xl bg-white/[0.04] backdrop-blur-xl">
            {isInfluencer ? rightPane : (
            <>
            {/* Tab bar, Calendar tab hidden when Auto-post is OFF */}
            <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2.5">
              {autoPost ? (
                <TabButton
                  active={effectiveTab === "calendar"}
                  onClick={() => setRightTab("calendar")}
                  label="Calendar"
                  count={scheduledCount}
                />
              ) : null}
              <TabButton
                active={effectiveTab === "clips"}
                onClick={() => setRightTab("clips")}
                label="Clips"
                count={liveClipCount}
              />
              <TabButton
                active={effectiveTab === "history"}
                onClick={() => setRightTab("history")}
                label="History"
                count={postedClipCount}
              />
              {/* Post Now, publishes the next-up clip to ALL connected accounts
                  immediately (bypasses the drip schedule). Far right of the tab row,
                  with chips showing exactly WHICH connected platforms it'll post to. */}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {postNowPlatforms.length > 0 && (
                  <span className="hidden items-center gap-1 sm:flex" title={`Posts to: ${postNowPlatforms.map(platformLabel).join(", ")}`}>
                    {postNowPlatforms.map((p) => (
                      <span
                        key={p}
                        className="grid size-5 place-items-center overflow-hidden rounded-md bg-zinc-900"
                        title={platformLabel(p)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://cdn.simpleicons.org/${p === "twitter" ? "x" : p}/white`}
                          alt={platformLabel(p)}
                          width={11}
                          height={11}
                          loading="lazy"
                          className="size-[11px] object-contain"
                        />
                      </span>
                    ))}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handlePostNow}
                  disabled={postingNow || !mintAddress || !nextToPost}
                  title={
                    !nextToPost
                      ? "No clip generated yet, make a clip in the Clipping tab first"
                      : postNowPlatforms.length === 0
                        ? "Post the latest clip (resolves your connected accounts)"
                        : `Post "${(nextToPost.title || "the latest clip").slice(0, 40)}" now to ${postNowPlatforms.map(platformLabel).join(", ")}`
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-lime-500 px-3 py-1.5 text-[12px] font-extrabold uppercase tracking-wide text-white shadow-[0_3px_0_#4d7c0f] transition-[transform,box-shadow] duration-100 hover:brightness-105 active:translate-y-[2px] active:shadow-[0_1px_0_#4d7c0f] disabled:pointer-events-none disabled:opacity-40 disabled:shadow-[0_3px_0_#4d7c0f]"
                >
                  {postingNow ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  {postingNow ? "Posting…" : "Post now"}
                </button>
              </div>
            </div>
            {postNowMsg && (
              <div className="px-3 pt-2 text-[11.5px] font-medium text-zinc-400" role="status">{postNowMsg}</div>
            )}

            {/* Tab content (swaps in place) */}
            <div className="p-3">
              {effectiveTab === "calendar" && autoPost && mintAddress ? (
                <PostingCalendarSection
                  mintAddress={mintAddress}
                  feed={feed}
                  intervalMs={localIntervalMs}
                  maxPerDay={localMaxPerDay}
                  postOrder={localPostOrder}
                  dailyStartHour={localDailyEnabled ? localDailyHour : undefined}
                  dailyStartMinute={localDailyEnabled ? localDailyMinute : undefined}
                  timeZone={localTimezone}
                  accessToken={accessToken}
                  // Where clips will actually post: the configured channels, or ALL
                  // connected when none are pinned ("post everywhere"). Drives the
                  // calendar's per-post platform glyphs so they're DYNAMIC (X/YouTube/…)
                  // instead of a static default.
                  postingPlatforms={localPlatforms.length ? localPlatforms : connectedPlatforms}
                />
              ) : effectiveTab === "history" ? (
                <ClipSections
                  mode="history"
                  mintAddress={mintAddress}
                  feed={feed}
                  connectedPlatforms={connectedPlatforms}
                  configuredPlatforms={storedPlatforms}
                  accessToken={accessToken}
                />
              ) : (
                <ClipSections
                  mode="clips"
                  mintAddress={mintAddress}
                  feed={feed}
                  connectedPlatforms={connectedPlatforms}
                  configuredPlatforms={storedPlatforms}
                  accessToken={accessToken}
                  onUnschedule={unscheduleClip}
                />
              )}
            </div>
            </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Right-pane tab button — label + live count badge. */
function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-500 focus-visible:ring-offset-1 ${
        active
          ? "bg-lime-500 text-white shadow-sm"
          : "text-zinc-500 hover:bg-white/10 hover:text-zinc-100"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums ${
          active ? "bg-zinc-900/15 text-white" : "bg-white/10 text-zinc-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Renders the feed as TWO sections:
 *  - "Clips": every row whose state !== 'posted' (still in flight or download-only).
 *    These rows offer a kebab with Download + a destructive Delete.
 *  - "Posting history": rows whose state === 'posted', sorted by postedAt DESC,
 *    each showing the post time + platform + a link to the post. Download only,
 *    no Delete (history is preserved). Hidden entirely when there are 0 posted.
 *
 * `removed` is a local optimistic-delete set: a Delete hides the row immediately,
 * then the postingFeed subscription reconciles (the row is hard-deleted, so it
 * never reappears). Kept here (not in ClipRow) so it survives the row unmount.
 */
function ClipSections({
  mintAddress,
  feed,
  connectedPlatforms,
  configuredPlatforms,
  accessToken,
  onUnschedule,
  mode = "both",
}: {
  mintAddress?: string;
  feed: FeedRow[] | undefined;
  connectedPlatforms: string[];
  // Stored clipConfig.platforms — NON-EMPTY = post only to those; EMPTY = all
  // connected. "Post now" intersects this with the live connected set.
  configuredPlatforms: string[];
  accessToken: string | null;
  // Free ONE queued clip from the schedule (cancel its drip row) without deleting
  // it. Only wired/shown for queued clips in the Clips section.
  onUnschedule?: (clip: FeedRow) => void | Promise<void>;
  // Which sections to render. "both" (default) keeps the original stacked layout;
  // "clips"/"history" render just one section (the cockpit's tabbed right pane).
  mode?: "both" | "clips" | "history";
}) {
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const onRemoved = useCallback((clipId: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.add(clipId);
      return next;
    });
  }, []);

  const visible = useMemo(
    () => (feed ?? []).filter((c) => !removed.has(c.clipId)),
    [feed, removed],
  );
  const clips = useMemo(() => visible.filter((c) => c.state !== "posted"), [visible]);

  // Effective "Post now" channels — configured ∩ connected, falling back to ALL
  // connected when they don't overlap, so a manual post always works with whatever
  // social account IS connected (even if it isn't in the agent's configured set).
  const postPlatforms = useMemo(
    () => effectivePostNowPlatforms(configuredPlatforms, connectedPlatforms),
    [configuredPlatforms, connectedPlatforms],
  );
  const history = useMemo(
    () =>
      visible
        .filter((c) => c.state === "posted")
        // Newest post first; rows without a postedAt sort last (stable behind dated ones).
        .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0)),
    [visible],
  );

  // In single-section modes ("clips"/"history") the tabbed pane already supplies
  // the heading via its tab, so drop the extra top margin + section title.
  const tabbed = mode !== "both";

  return (
    <>
      {/* ── Live clips ─────────────────────────────────────────────────── */}
      {mode !== "history" ? (
        <div className={tabbed ? "" : "mt-8"}>
          {tabbed ? null : (
            <h3 className="text-lg font-extrabold tracking-tight text-white">Clips</h3>
          )}
          <div className={tabbed ? "" : "mt-4"}>
            {!mintAddress ? (
              <EmptyState text="Mint or save this agent to see its clips." />
            ) : feed === undefined ? (
              <div className="grid place-items-center py-16 text-zinc-500">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : clips.length === 0 ? (
              <EmptyState title="No clips yet" text="Run the clipper and fresh clips will land here." />
            ) : (
              <div className="space-y-2.5">
                {clips.map((c: FeedRow) => (
                  <ClipRow
                    key={c.clipId}
                    clip={c}
                    mintAddress={mintAddress}
                    platforms={postPlatforms}
                    accessToken={accessToken}
                    onRemoved={onRemoved}
                    onUnschedule={onUnschedule}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Posting history ──────────────────────────────────────────────
          "both": only when there's at least one posted clip (original rule).
          "history": always render (the tab shows its own empty state). */}
      {mode !== "clips" && (mode === "history" || history.length > 0) ? (
        <div className={tabbed ? "" : "mt-8"}>
          {tabbed ? null : (
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-extrabold tracking-tight text-white">Posting history</h3>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-zinc-400">
                {history.length}
              </span>
            </div>
          )}
          {history.length === 0 ? (
            <EmptyState text="No posts yet, posted clips will be archived here." />
          ) : (
            <div className={tabbed ? "space-y-2.5" : "mt-4 space-y-2.5"}>
              {history.map((c: FeedRow) => (
                <HistoryRow key={c.clipId} clip={c} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

type FeedRow = {
  clipId: string;
  title: string;
  clipUrl: string | null;
  viralScore: number;
  state: "not_posted" | "queued" | "posting" | "posted" | "failed" | "flagged";
  postUrl: string | null;
  platform: string | null;
  scheduledFor: number | null;
  error: string | null;
  // When the clip actually posted (epoch ms). From the postingFeed join
  // (clips.postedAt, else the matched scheduledContent.postedAt, else null).
  // Drives the Posting-history sort + post-time label.
  postedAt: number | null;
  // When the clip ROW was created (epoch ms, from clips.createdAt). The drip
  // order ("newest"/"oldest"/"best" tie-break) sorts on this, so the lock-in /
  // reschedule paths that re-run orderClips on feed rows order identically to
  // the server's postingFeed sort.
  createdAt: number;
};

/** Mini clip preview — hover-to-play with real controls (play/pause, mute),
 *  replacing a silent, non-interactive thumbnail. Clicking the video itself
 *  toggles play so the buttons are a convenience, not the only way in. */
function ClipThumbPlayer({ clipUrl }: { clipUrl?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);
  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  if (!clipUrl) {
    return (
      <div className="grid size-14 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/10 text-zinc-400">
        <Send className="size-4" />
      </div>
    );
  }

  return (
    <div
      className="group relative size-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-white/10 bg-black ring-0 transition-[box-shadow] hover:ring-2 hover:ring-lime-400/40"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        src={clipUrl}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="size-full object-cover"
      />
      {/* Play/pause glyph — shown at rest and on hover, fades out once playing
          and not hovered so it doesn't sit over the preview. */}
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity ${
          playing && !hovered ? "opacity-0" : "opacity-100"
        }`}
      >
        {playing ? <Pause className="size-4 fill-white text-white" /> : <Play className="size-4 translate-x-px fill-white text-white" />}
      </div>
      {/* Mute toggle — only worth showing once the operator has engaged (hover
          or already playing); a permanently-visible control on a 56px tile is
          just noise. */}
      {(hovered || playing) && (
        <button
          type="button"
          onClick={toggleMute}
          title={muted ? "Unmute" : "Mute"}
          className="absolute bottom-1 right-1 grid size-4.5 place-items-center rounded bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          {muted ? <VolumeX className="size-2.5" /> : <Volume2 className="size-2.5" />}
        </button>
      )}
    </div>
  );
}

function ClipRow({
  clip,
  mintAddress,
  platforms,
  accessToken,
  onRemoved,
  onUnschedule,
}: {
  clip: FeedRow;
  mintAddress?: string;
  platforms: string[];
  accessToken: string | null;
  onRemoved: (clipId: string) => void;
  // Free this clip from the schedule (cancel its drip row) without deleting it.
  // Only meaningful while the clip is queued.
  onUnschedule?: (clip: FeedRow) => void | Promise<void>;
}) {
  // "Post now" — immediate manual post of THIS clip to all connected platforms
  // (a test affordance; bypasses the drip schedule). Posts via /api/social/post.
  const [posting, setPosting] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [postErr, setPostErr] = useState<string | null>(null);
  // Delete lifecycle — POSTs /api/clips/delete (the route hard-deletes the clip +
  // cancels its non-terminal drip rows). On ok we optimistically hide the row via
  // onRemoved; the postingFeed subscription reconciles. Only offered on non-posted
  // (Clips) rows — the Posting-history rows preserve the record.
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  // Unschedule lifecycle — mirrors delete: frees the clip from the schedule
  // (cancels its drip row) WITHOUT deleting it. On ok the feed re-derives the
  // clip as not_posted. Only offered while the clip is queued.
  const [unscheduling, setUnscheduling] = useState(false);
  const [unscheduleErr, setUnscheduleErr] = useState<string | null>(null);
  const canPost =
    !!clip.clipUrl && !!mintAddress && platforms.length > 0 &&
    clip.state !== "posted" && clip.state !== "posting" && posting !== "done";

  const postNow = async () => {
    if (!canPost || posting === "busy") return;
    setPosting("busy");
    setPostErr(null);
    try {
      const res = await fetch("/api/social/post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          username: mintAddress,
          platforms,
          type: "video",
          title: clip.title || "",
          mediaUrls: [clip.clipUrl],
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || j.ok === false) {
        setPosting("error");
        setPostErr(j.error || `Post failed (${res.status})`);
        return;
      }
      setPosting("done");
    } catch (e) {
      setPosting("error");
      setPostErr(e instanceof Error ? e.message : "Post failed");
    }
  };

  const deleteClip = async () => {
    if (!mintAddress || deleting) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      // Plain fetch — the app's global fetch interceptor attaches Authorization +
      // X-Siws-Session (same as postNow above), so the route's requireInternalOrUserAuth
      // + requireOwnerWithSiws checks pass. The route hard-deletes the clip row and
      // cancels its non-terminal drip rows.
      const res = await fetch("/api/clips/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ clipId: clip.clipId, mintAddress }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || j.ok === false) {
        setDeleting(false);
        setDeleteErr(j.error || `Delete failed (${res.status})`);
        return;
      }
      // Optimistically drop the row; the postingFeed subscription reconciles.
      onRemoved(clip.clipId);
      setDeleting(false);
    } catch (e) {
      setDeleting(false);
      setDeleteErr(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const unschedule = async () => {
    if (!onUnschedule || unscheduling) return;
    setUnscheduling(true);
    setUnscheduleErr(null);
    try {
      await onUnschedule(clip);
      // The parent's scheduledContent.cancel + postingFeed subscriptions
      // reconcile — the clip falls back to not_posted (re-schedulable). No
      // optimistic removal: the clip stays in the list, just un-queued.
      setUnscheduling(false);
    } catch (e) {
      setUnscheduling(false);
      setUnscheduleErr(e instanceof Error ? e.message : "Unschedule failed");
    }
  };

  const postLabel =
    posting === "busy" ? "Posting…" : posting === "done" ? "Posted ✓" : posting === "error" ? "Retry" : "Post now";
  const postTitle =
    posting === "error" ? (postErr ?? "Post failed") :
    platforms.length === 0 ? "Connect a social account first" :
    !mintAddress ? "Mint or save the agent first" :
    `Post now to ${platforms.join(", ")}`;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] backdrop-blur-xl p-3">
      {/* Mini player — hover to preview, with real play/pause + mute controls
          instead of a silent, non-interactive thumbnail. */}
      <ClipThumbPlayer clipUrl={clip.clipUrl} />

      {/* Title + score */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-white">
          {clip.title || "Untitled clip"}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[12px]">
          <Flame className="size-3.5 fill-orange-500 text-orange-500" />
          <span className="font-semibold tabular-nums text-white">{Math.round(clip.viralScore ?? 0)}</span>
          <span className="text-zinc-400">virality</span>
        </div>
      </div>

      {/* State badge */}
      <StateBadge clip={clip} />

      {/* Post now, immediate manual post (test affordance) */}
      <button
        type="button"
        onClick={postNow}
        disabled={posting === "busy" || !canPost}
        title={postTitle}
        className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          posting === "done"
            ? "bg-emerald-600 text-white"
            : posting === "error"
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-white/10 text-white backdrop-blur-xl hover:bg-white/20"
        }`}
      >
        {posting === "busy" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        {postLabel}
      </button>

      {/* Delete — right beside Post now, always visible (not buried in the
          kebab menu). Same /api/clips/delete route as before: hard-deletes
          the clip AND cancels its non-terminal drip row, so it comes off the
          schedule too, not just the list. Confirmed first (destructive,
          irreversible). */}
      <button
        type="button"
        onClick={() => {
          if (window.confirm("Delete this clip? This also removes it from the posting schedule. This can't be undone.")) void deleteClip();
        }}
        disabled={deleting || unscheduling || !mintAddress}
        title="Delete — also cancels this clip's schedule"
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 text-[12px] font-semibold text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        {deleting ? "Deleting…" : "Delete"}
      </button>

      {/* Kebab, Download (native clip download) + Unschedule. Delete now lives
          as its own visible button above (Clips rows, never posted). */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              title="More"
              aria-label="More actions"
              disabled={deleting || unscheduling}
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting || unscheduling ? <Loader2 className="size-4 animate-spin" /> : <MoreVertical className="size-4" />}
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          {clip.clipUrl ? (
            <DropdownMenuItem
              render={
                <a href={clip.clipUrl} download>
                  <Download className="mr-2 size-4 text-zinc-500" />
                  Download
                </a>
              }
            />
          ) : (
            <DropdownMenuItem disabled>
              <Download className="mr-2 size-4 text-zinc-400" />
              Download
            </DropdownMenuItem>
          )}
          {/* Unschedule, free a QUEUED clip back to draft (keeps the clip).
              Only shown while queued; cancels the clip's active drip row. */}
          {clip.state === "queued" && onUnschedule ? (
            <DropdownMenuItem
              disabled={unscheduling || deleting || !mintAddress}
              onClick={(e) => {
                e.preventDefault();
                void unschedule();
              }}
            >
              <CalendarClock className="mr-2 size-4 text-zinc-500" />
              {unscheduling ? "Unscheduling…" : "Unschedule"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {deleteErr || unscheduleErr ? (
        <span
          role="alert"
          title={deleteErr ?? unscheduleErr ?? ""}
          className="max-w-[120px] shrink-0 truncate text-[11px] font-medium text-red-400"
        >
          {deleteErr ?? unscheduleErr}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A single Posting-history row (state === 'posted'). Shows the clip thumbnail +
 * title, the post time (postedAt), the platform, and a link to the live post when
 * one is recorded. Offers Download via a kebab (Download only — NO Delete: history
 * is preserved). When there's no clipUrl the kebab is still shown with a disabled
 * Download so the row layout matches the Clips rows.
 */
function HistoryRow({ clip }: { clip: FeedRow }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] backdrop-blur-xl p-3">
      {/* Thumbnail */}
      <div className="size-12 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/10">
        {clip.clipUrl ? (
          <video
            src={clip.clipUrl}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-zinc-400">
            <CheckCircle2 className="size-4" />
          </div>
        )}
      </div>

      {/* Title + post meta */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-white">
          {clip.title || "Untitled clip"}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-zinc-500">
          <CheckCircle2 className="size-3 text-lime-600" />
          <span title={absoluteTime(clip.postedAt)}>
            Posted {postedAgo(clip.postedAt)}
          </span>
          {clip.platform ? (
            <span className="capitalize text-zinc-400">· {clip.platform}</span>
          ) : null}
        </div>
      </div>

      {/* Link to the live post */}
      {clip.postUrl ? (
        <a
          href={clip.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open post"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ExternalLink className="size-4" />
        </a>
      ) : null}

      {/* Kebab, Download only (history preserved, no Delete) */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              title="More"
              aria-label="More actions"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <MoreVertical className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-40">
          {clip.clipUrl ? (
            <DropdownMenuItem
              render={
                <a href={clip.clipUrl} download>
                  <Download className="mr-2 size-4 text-zinc-500" />
                  Download
                </a>
              }
            />
          ) : (
            <DropdownMenuItem disabled>
              <Download className="mr-2 size-4 text-zinc-400" />
              Download
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function StateBadge({ clip }: { clip: FeedRow }) {
  const base =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold";

  if (clip.state === "posted") {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={`${base} bg-lime-100 text-lime-800`}>
          <CheckCircle2 className="size-3.5" />
          Posted
          {clip.platform ? (
            <span className="font-normal capitalize text-lime-700">
              · {clip.platform}
            </span>
          ) : null}
        </span>
        {clip.postUrl ? (
          <a
            href={clip.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open post"
            className="grid size-7 place-items-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
    );
  }

  if (clip.state === "posting") {
    return (
      <span className={`${base} bg-sky-100 text-sky-800`}>
        <Loader2 className="size-3.5 animate-spin" />
        Posting…
      </span>
    );
  }

  if (clip.state === "queued") {
    return (
      <span className={`${base} bg-amber-100 text-amber-300`} title={absoluteTime(clip.scheduledFor)}>
        <Clock className="size-3.5" />
        Queued
        {clip.scheduledFor ? (
          <span className="font-normal text-amber-400">
            · {relativeTime(clip.scheduledFor)}
          </span>
        ) : null}
      </span>
    );
  }

  if (clip.state === "failed") {
    // Surface the REAL reason (now carried on the sched row's error via the drip —
    // e.g. "X / Twitter: token expired — reconnect X / Twitter in the builder's
    // Connections panel") instead of a bare "Failed". The badge stays compact; the
    // reason renders under it (truncated, full text on hover) so the operator can
    // see WHY and what to do next.
    const reason = clip.error?.trim() || null;
    return (
      <div className="flex max-w-[220px] shrink-0 flex-col items-end gap-0.5">
        <span
          className={`${base} bg-red-100 text-red-800`}
          title={reason ?? "Posting failed"}
        >
          <XCircle className="size-3.5" />
          Failed
        </span>
        {reason ? (
          <span
            role="alert"
            className="max-w-[220px] truncate text-right text-[11px] font-medium leading-tight text-red-400"
            title={reason}
          >
            {reason}
          </span>
        ) : null}
      </div>
    );
  }

  if (clip.state === "flagged") {
    // Guardrails blocked this clip permanently — never auto-retried (see
    // convex/clipJobs.ts's "guardrail_rejected" state), so the operator needs to
    // see WHY and fix/regenerate rather than assume it'll post next cycle.
    const reason = clip.error?.trim() || null;
    return (
      <div className="flex max-w-[220px] shrink-0 flex-col items-end gap-0.5">
        <span
          className={`${base} bg-purple-100 text-purple-900`}
          title={reason ?? "Blocked by Guardrails"}
        >
          <ShieldAlert className="size-3.5" />
          Guardrails Blocked
        </span>
        {reason ? (
          <span
            role="alert"
            className="max-w-[220px] truncate text-right text-[11px] font-medium leading-tight text-purple-700"
            title={reason}
          >
            {reason}
          </span>
        ) : null}
      </div>
    );
  }

  // not_posted — ready clip with no drip/post row yet (auto-post off, or not queued).
  return (
    <span className={`${base} bg-white/10 text-zinc-400`}>
      <CircleDashed className="size-3.5" />
      Not posted
    </span>
  );
}

/** The four publish-order modes shown in the right column. */
const ORDER_OPTIONS: { id: PostOrder; label: string; desc: string }[] = [
  { id: "best", label: "Best first", desc: "Highest virality score goes out first." },
  { id: "newest", label: "Newest first", desc: "Most recently clipped first." },
  { id: "oldest", label: "Oldest first", desc: "Work through the backlog, oldest first." },
  { id: "random", label: "Shuffle", desc: "Randomize the order each run." },
];

/**
 * Split posting controls. LEFT = Scheduling (post spacing + a 1-min test button,
 * a max-per-day cap, and an optional daily start-time trigger). RIGHT = Posting
 * order (best/newest/oldest/shuffle). `*Draft` callbacks fire while dragging so
 * the parent's live calendar preview re-times; `*Commit`/`onPostOrder`/`onDaily*`
 * update the parent's local edit state (persisted on "Save schedule"). Displayed
 * values snap to the same grid normalizeClipConfig enforces.
 */
function ScheduleControls({
  intervalMs,
  maxPerDay,
  postOrder,
  dailyEnabled,
  dailyHour,
  dailyMinute,
  timeZone,
  connectedPlatforms,
  platforms,
  disabled,
  onIntervalDraft,
  onMaxPerDayDraft,
  onIntervalCommit,
  onMaxPerDayCommit,
  onPostOrder,
  onDailyEnabled,
  onDailyTime,
  onTimeZone,
  onPlatforms,
}: {
  intervalMs: number;
  maxPerDay: number;
  postOrder: PostOrder;
  dailyEnabled: boolean;
  dailyHour: number;
  dailyMinute: number;
  timeZone: string;
  connectedPlatforms: string[];
  platforms: string[];
  disabled: boolean;
  onIntervalDraft: (ms: number) => void;
  onMaxPerDayDraft: (n: number) => void;
  onIntervalCommit: (ms: number) => void;
  onMaxPerDayCommit: (n: number) => void;
  onPostOrder: (o: PostOrder) => void;
  onDailyEnabled: (on: boolean) => void;
  onDailyTime: (h: number, m: number) => void;
  onTimeZone: (tz: string) => void;
  onPlatforms: (next: string[]) => void;
}) {
  // Slider works in 15-min STEPS (1..96 = 15min..24h); sub-15-min "test" values
  // (e.g. 1 min) live in the typed box / quick button, not the grid slider.
  const stepCount = Math.max(1, Math.round(intervalMs / STEP_MS));
  const [customMin, setCustomMin] = useState<string>(String(Math.round(intervalMs / 60000)));
  useEffect(() => {
    setCustomMin(String(Math.round(intervalMs / 60000)));
  }, [intervalMs]);

  const commitCustom = () => {
    const mins = Number(customMin);
    if (!Number.isFinite(mins) || mins <= 0) {
      setCustomMin(String(Math.round(intervalMs / 60000)));
      return;
    }
    onIntervalCommit(mins * 60000);
  };

  const timeValue = `${String(dailyHour).padStart(2, "0")}:${String(dailyMinute).padStart(2, "0")}`;

  // Timezone options: the curated COMMON list, with the browser's own zone
  // prepended when it isn't already in the list (so the operator's local zone is
  // always selectable). Offsets are computed at the current instant so the chip
  // reflects the live DST state.
  const tzOptions = useMemo(() => {
    const now = Date.now();
    const ids = COMMON_TIMEZONES.map((o) => o.tz);
    const browser = browserTimeZone();
    const all = ids.includes(browser) ? ids : [browser, ...ids];
    return all.map((tz) => ({ tz, offset: zoneOffsetLabel(tz, now) }));
  }, []);
  const tzOffset = useMemo(() => zoneOffsetLabel(timeZone, Date.now()), [timeZone]);

  // Channels: empty selection = ALL connected ("post everywhere"). Toggling a
  // specific chip adds/removes it; the "All connected" chip clears to [].
  const allChannels = platforms.length === 0;
  const togglePlatform = (id: string) => {
    onPlatforms(
      platforms.includes(id)
        ? platforms.filter((p) => p !== id)
        : [...platforms, id],
    );
  };

  return (
    <div className="mt-3 space-y-4">
      {/* ── Posting order, collapsible (like Connections), placed right below
          Connections; no divider so it sits close. ───────────────────────── */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-semibold text-zinc-100">
          Posting order
          <span className="ml-2 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-400">
            {ORDER_OPTIONS.find((o) => o.id === postOrder)?.label ?? "Best first"}
          </span>
          <span className="ml-auto rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors group-hover:bg-emerald-600 group-open:hidden">
            Show
          </span>
          <span className="ml-auto hidden rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition-colors group-hover:bg-white/15 group-open:inline">
            Hide
          </span>
        </summary>
        <div className="mt-2 space-y-2">
          {ORDER_OPTIONS.map(({ id, label, desc }) => {
            const active = postOrder === id;
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => onPostOrder(id)}
                aria-pressed={active}
                className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "border-lime-400 bg-lime-400/10 ring-1 ring-lime-400/30"
                    : "bg-white/[0.04] backdrop-blur-xl hover:bg-white/[0.08]"
                }`}
              >
                <span className="min-w-0">
                  <span className={`block text-[13px] font-semibold ${active ? "text-lime-200" : "text-zinc-100"}`}>
                    {label}
                  </span>
                  <span className="block text-[11.5px] leading-snug text-zinc-500">{desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </details>

      {/* ── Scheduling ───────────────────────────────────────────────────── */}
      <div className="border-t border-white/10 pt-4">
        <div className="mb-3">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-zinc-500">Scheduling</span>
        </div>

        {/* Spacing */}
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-100">Post spacing</span>
          <span className="ml-auto rounded-md bg-white/10 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-zinc-300">
            {formatInterval(intervalMs)}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={MAX_INTERVAL_MS / STEP_MS}
            step={1}
            value={Math.min(stepCount, MAX_INTERVAL_MS / STEP_MS)}
            disabled={disabled}
            aria-label="Post spacing in 15-minute steps"
            onChange={(e) => onIntervalDraft(Number(e.target.value) * STEP_MS)}
            onPointerUp={(e) => onIntervalCommit(Number((e.target as HTMLInputElement).value) * STEP_MS)}
            onKeyUp={(e) => onIntervalCommit(Number((e.target as HTMLInputElement).value) * STEP_MS)}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-lime-600 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="flex shrink-0 items-center gap-1">
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={customMin}
              disabled={disabled}
              aria-label="Custom post spacing in minutes"
              onChange={(e) => setCustomMin(e.target.value)}
              onBlur={commitCustom}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-14 rounded-md bg-white/[0.04] backdrop-blur-xl px-2 py-1 text-right text-[13px] tabular-nums text-white focus:border-white/10 focus:outline-none disabled:opacity-50"
            />
            <span className="text-[12px] text-zinc-500">min</span>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onIntervalCommit(60_000)}
            title="Sets a permanent 1-minute spacing (not a temporary test). Save to keep it; change the slider any time to a longer interval."
            className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[12px] font-semibold text-amber-300 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Set 1 min
          </button>
          <span className="text-[11px] leading-snug text-zinc-500">
            Sets a permanent 1-min spacing. Cron drains every 5 min, so 1-min
            spacing batches on the next tick.
          </span>
        </div>

        {/* Daily cap */}
        <div className="mt-5 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-100">Max posts / day</span>
          <span className="ml-auto rounded-md bg-white/10 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-zinc-300">
            {maxPerDay === 0 ? "Off" : maxPerDay}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={MAX_PER_DAY_SLIDER}
          step={1}
          value={Math.min(maxPerDay, MAX_PER_DAY_SLIDER)}
          disabled={disabled}
          aria-label="Maximum posts per day (0 = off)"
          onChange={(e) => onMaxPerDayDraft(Number(e.target.value))}
          onPointerUp={(e) => onMaxPerDayCommit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => onMaxPerDayCommit(Number((e.target as HTMLInputElement).value))}
          className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-lime-600 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="mt-1.5 text-[12px] leading-snug text-zinc-500">
          {maxPerDay === 0
            ? "No daily cap, clips fill the drip back-to-back."
            : `Up to ${maxPerDay}/day; the rest roll to the next day.`}
        </p>

        {/* Daily start trigger */}
        <div className="mt-5 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-100">Daily start time</span>
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={dailyEnabled}
              disabled={disabled}
              onChange={(e) => onDailyEnabled(e.target.checked)}
              className="size-4 accent-lime-600 disabled:opacity-50"
            />
            <span className="text-[12px] text-zinc-400">{dailyEnabled ? "On" : "Off"}</span>
          </label>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="time"
            value={timeValue}
            disabled={disabled || !dailyEnabled}
            aria-label="Daily posting start time"
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map((x) => Number(x));
              if (Number.isFinite(h) && Number.isFinite(m)) onDailyTime(h, m);
            }}
            className="rounded-md bg-white/[0.04] backdrop-blur-xl px-2 py-1 text-[13px] tabular-nums text-white focus:border-white/10 focus:outline-none disabled:opacity-50"
          />
          <span className="text-[12px] text-zinc-500">in {timeZone}</span>
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-zinc-500">
          {dailyEnabled
            ? `Each day's posts begin at ${timeValue}, spaced by the interval above.`
            : "Off, the first post goes one interval from now."}
        </p>

        {/* Timezone, the wall-clock zone the daily-start time + day-bucketing
            (and the calendar below) follow. Default = the browser's zone. */}
        <div className="mt-5 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-100">Timezone</span>
          <span className="ml-auto rounded-md bg-white/10 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-zinc-300">
            {tzOffset}
          </span>
        </div>
        <select
          value={timeZone}
          disabled={disabled}
          aria-label="Scheduling timezone"
          onChange={(e) => onTimeZone(e.target.value)}
          className="mt-2 w-full rounded-md bg-white/[0.04] backdrop-blur-xl px-2 py-1.5 text-[13px] text-white focus:border-white/10 focus:outline-none disabled:opacity-50"
        >
          {tzOptions.map(({ tz, offset }) => (
            <option key={tz} value={tz}>
              {tz}  {offset}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[12px] leading-snug text-zinc-500">
          Daily start &amp; per-day spacing follow this zone, times shown in {timeZone} ({tzOffset}).
        </p>

        {/* Channels, which connected socials clips post to. EMPTY = all
            connected ("post everywhere"). NON-EMPTY = only the chosen ones. */}
        <div className="mt-5 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-100">Channels</span>
          <span className="ml-auto rounded-md bg-white/10 px-2 py-0.5 text-[12px] font-semibold text-zinc-300">
            {allChannels ? "All connected" : `${platforms.length} selected`}
          </span>
        </div>
        {connectedPlatforms.length === 0 ? (
          <p className="mt-2 text-[12px] leading-snug text-zinc-500">
            Connect a social account in Connections to choose channels.
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlatforms([])}
                aria-pressed={allChannels}
                className={`inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-1 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  allChannels
                    ? "border-lime-400 bg-lime-400/10 text-lime-200"
                    : "border-white/15 bg-white/[0.03] text-zinc-300 hover:border-white/25"
                }`}
              >
                All connected
              </button>
              {connectedPlatforms.map((id) => {
                const active = platforms.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={disabled}
                    onClick={() => togglePlatform(id)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-1 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      active
                        ? "border-lime-400 bg-lime-400/10 text-lime-200"
                        : "border-white/15 bg-white/[0.03] text-zinc-300 hover:border-white/25"
                    }`}
                  >
                    {active ? <Check className="size-3.5 text-lime-600" /> : null}
                    {platformLabel(id)}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-zinc-500">
              {allChannels
                ? "Posting to every connected channel."
                : `Posting only to ${platforms.map(platformLabel).join(", ")}.`}
            </p>
          </>
        )}
      </div>

    </div>
  );
}

type CalRow = {
  _id: string;
  scheduledFor: number;
  status: string;
  postedAt?: number;
  platforms?: string[];
  topic?: string;
  caption?: string;
  videoUrl?: string;
};

/** Normalise a scheduledContent.status string to a known calendar status. */
function toCalStatus(status: string): CalendarStatus {
  switch (status) {
    case "posted":
    case "posting":
    case "failed":
    case "cancelled":
      return status;
    default:
      return "scheduled";
  }
}

/**
 * Wires the real scheduledContent rows + a LIVE forecast (driven by the parent's
 * current slider values) into <PostingCalendar>.
 *
 *  - `scheduled` entries come from scheduledContent.listByMint, bucketed by their
 *    effective local time (postedAt for posted, else scheduledFor).
 *  - `preview` entries are computed from the CURRENT (possibly-unsaved) slider
 *    values via computeScheduleTimes(previewCount, { intervalMs, maxPerDay, now }).
 *    `previewCount` = the number of ready/not-yet-posted clips in the feed (zero
 *    unposted clips → zero preview, an empty calendar — no phantom slots). As the
 *    operator drags a slider, intervalMs/maxPerDay change and these entries
 *    re-time across the grid in real time. They render distinctly (dashed/tinted).
 *
 * `now` is captured once per mount so the forecast re-times purely from slider
 * changes rather than drifting with the wall clock on every render.
 */
function PostingCalendarSection({
  mintAddress,
  feed,
  intervalMs,
  maxPerDay,
  postOrder,
  dailyStartHour,
  dailyStartMinute,
  timeZone,
  accessToken,
  postingPlatforms,
}: {
  mintAddress: string;
  feed: FeedRow[] | undefined;
  intervalMs: number;
  maxPerDay: number;
  /** Publish order — the forecast must map clips onto slots in THIS order so the
   *  preview shows the same clip-per-slot that lock-in/reschedule will commit
   *  (both call orderClips(pending, postOrder) before stamping times). */
  postOrder: PostOrder;
  dailyStartHour?: number;
  dailyStartMinute?: number;
  /** Effective IANA zone the forecast + calendar follow. */
  timeZone: string;
  /** Bearer for the owner-gated /api/schedule/reschedule route (drag-and-drop). */
  accessToken: string | null;
  /** The channels a clip will actually post to (configured, else all connected) —
   *  drives the calendar's per-post platform glyphs so they reflect the CONNECTED
   *  accounts, not each clip's origin platform. */
  postingPlatforms: string[];
}) {
  const rows = useQuery(api.scheduledContent.listByMint, { mintAddress }) as
    | CalRow[]
    | undefined;

  // Optimistic reschedule overrides: rowId → new epoch-ms. A drop applies the new
  // time INSTANTLY (the chip flies to its cell) while the API call is in flight;
  // it's pruned once the live row's scheduledFor matches (server reconciled) or
  // reverted on failure. Keeps drag-and-drop feeling immediate over the round-trip.
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!rows) return;
    setOverrides((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, at] of Object.entries(prev)) {
        const row = rows.find((r) => r._id === id);
        // Keep the override only while the server hasn't caught up yet.
        if (row && row.scheduledFor !== at) next[id] = at;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const onReschedule = useCallback(
    async (rowId: string, newAt: number) => {
      setOverrides((p) => ({ ...p, [rowId]: newAt }));
      try {
        const res = await fetch("/api/schedule/reschedule", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify({ id: rowId, mintAddress, scheduledFor: newAt }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || j.ok === false) throw new Error(j.error || `Reschedule failed (${res.status})`);
      } catch {
        // Revert the optimistic move — the live rows re-place the chip on its old day.
        setOverrides((p) => { const n = { ...p }; delete n[rowId]; return n; });
      }
    },
    [accessToken, mintAddress],
  );

  // Delete the video behind a calendar card. Clip rows (matched by clipUrl) go
  // through /api/clips/delete, which also cancels their drip rows; a row with no
  // matching clip just has its schedule cancelled.
  const onDeleteEntry = useCallback(
    async (entry: CalendarEntry): Promise<string | null> => {
      const headers = { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
      const clip = entry.videoUrl ? (feed ?? []).find((c) => c.clipUrl === entry.videoUrl) : undefined;
      try {
        const res = clip
          ? await fetch("/api/clips/delete", { method: "POST", headers, body: JSON.stringify({ clipId: clip.clipId, mintAddress }) })
          : entry.rowId
            ? await fetch("/api/schedule/cancel", { method: "POST", headers, body: JSON.stringify({ id: entry.rowId, mintAddress }) })
            : null;
        if (!res) return "Nothing to delete for this card";
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        return !res.ok || j.ok === false ? j.error || `Delete failed (${res.status})` : null;
      } catch (e) {
        return e instanceof Error ? e.message : "Delete failed";
      }
    },
    [accessToken, mintAddress, feed],
  );

  // REAL-TIME clock: tick every 30s so the forecast slots, the "next post in …"
  // countdown, and the today-highlight stay accurate while the tab is open — the
  // schedule figures itself out from the CURRENT time, not a frozen mount-time.
  // (This section only mounts when Auto-post is ON, so the interval is scoped to it.)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Real scheduled/posted entries. The id is STABLE per row (`s_<_id>`, not keyed
  // on the time) so the drag-and-drop `layoutId` animation can fly the SAME chip
  // to its new date cell when a reschedule lands, instead of unmount/remount.
  const scheduled = useMemo<CalendarEntry[]>(() => {
    return (rows ?? [])
      .map((r): CalendarEntry | null => {
        // Hide cancelled rows — they're the leftovers of an Unschedule / Reschedule-all
        // and just clutter the calendar with struck-through ghosts.
        if (r.status === "cancelled") return null;
        const baseEff =
          r.status === "posted" && typeof r.postedAt === "number"
            ? r.postedAt
            : r.scheduledFor;
        // Optimistic override wins for placement while a drag-drop is in flight.
        const eff = overrides[r._id] ?? baseEff;
        if (typeof eff !== "number" || !Number.isFinite(eff)) return null;
        return {
          id: `s_${r._id}`,
          rowId: r._id,
          at: eff,
          status: toCalStatus(r.status),
          label: r.topic || r.caption || "Clip",
          // Real scheduled rows carry their target platforms; fall back to the
          // effective connected/configured set for older rows that saved none.
          platforms: Array.isArray(r.platforms) && r.platforms.length ? r.platforms : postingPlatforms,
          videoUrl: r.videoUrl ?? null,
        };
      })
      .filter((e): e is CalendarEntry => e !== null);
  }, [rows, overrides]);

  // The clips the forecast should preview: ONLY truly un-queued ones. A 'queued'
  // clip already has a REAL scheduled row (shown as a solid chip), so forecasting
  // it too would double-render it (dashed preview chip on top) + over-count. Also
  // exclude 'failed' (terminal). Posted/posting are likewise excluded.
  const pending = useMemo(
    () => (feed ?? []).filter((c) => c.state === "not_posted"),
    [feed],
  );
  // Forecast EXACTLY the clips that need posting — no phantom fallback. With zero
  // unposted clips the calendar shows nothing (no misleading "Upcoming clip" slots).
  const previewCount = pending.length;

  // Live forecast — re-timed whenever the sliders (intervalMs/maxPerDay) move.
  // Map the pending clips onto the computed times in orderClips(postOrder) order
  // (NOT raw feed order) so the previewed clip-per-slot matches what lock-in /
  // reschedule-all will actually commit — both order the SAME pending set with
  // orderClips before stamping the times. (orderClips narrows its generic to its
  // sort constraint; cast back so title/platform/clipUrl stay accessible.)
  const preview = useMemo<CalendarEntry[]>(() => {
    const ordered = orderClips(pending, postOrder) as FeedRow[];
    const times = computeScheduleTimes(previewCount, {
      intervalMs,
      maxPerDay,
      now,
      timeZone,
      ...(dailyStartHour !== undefined ? { dailyStartHour, dailyStartMinute } : {}),
    });
    return times.map((at, i): CalendarEntry => {
      const src = ordered[i];
      return {
        id: `p_${i}`,
        at,
        status: "scheduled",
        label: src?.title || "Upcoming clip",
        // Forecast the CONNECTED/configured channels this clip will post to (X /
        // YouTube / …) — NEVER the clip's origin `platform` (that's where it was
        // clipped FROM, not where it posts, and would wrongly show e.g. TikTok when
        // you're only connected to X + YouTube). Empty until connections resolve →
        // the chip simply shows no platform glyph rather than a wrong one.
        platforms: postingPlatforms,
        videoUrl: src?.clipUrl ?? null,
        preview: true,
      };
    });
  }, [previewCount, intervalMs, maxPerDay, postOrder, dailyStartHour, dailyStartMinute, timeZone, now, pending, postingPlatforms]);

  return (
    <PostingCalendar
      scheduled={scheduled}
      preview={preview}
      now={now}
      timeZone={timeZone}
      loading={rows === undefined}
      onReschedule={onReschedule}
      onDelete={onDeleteEntry}
    />
  );
}

function EmptyState({ text, title }: { text: string; title?: string }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      {/* Illustration: a fanned stack of 9:16 clip cards with a play glyph -
          reads instantly as "clips live here" without a wall of text. */}
      <svg width="120" height="92" viewBox="0 0 120 92" fill="none" aria-hidden className="mb-4">
        <rect x="18" y="14" width="34" height="60" rx="6" transform="rotate(-8 18 14)" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" />
        <rect x="70" y="10" width="34" height="60" rx="6" transform="rotate(8 70 10)" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" />
        <rect x="43" y="8" width="36" height="64" rx="7" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.28)" />
        <circle cx="61" cy="40" r="12" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.35)" />
        <path d="M58 34.5 L67 40 L58 45.5 Z" fill="rgba(255,255,255,0.85)" />
        <rect x="49" y="60" width="24" height="3.5" rx="1.75" fill="rgba(255,255,255,0.22)" />
        <rect x="53" y="66" width="16" height="3" rx="1.5" fill="rgba(255,255,255,0.12)" />
      </svg>
      {title && <p className="text-[14.5px] font-semibold text-zinc-200">{title}</p>}
      <div className={`max-w-[36ch] text-[12.5px] leading-relaxed text-zinc-500 ${title ? "mt-1" : ""}`}>{text}</div>
    </div>
  );
}

/** "in 2h", "in 35m", "now" — best-effort relative format for a future drip. */
function relativeTime(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `posts in ${mins}m`;
  const hrs = Math.round(diff / 3600000);
  return `posts in ${hrs}h`;
}

function absoluteTime(ts: number | null): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

/** Past-time label for the Posting-history rows: "just now", "5m ago", "2h ago",
 *  "3d ago", then a short calendar date (e.g. "Jun 18"). Returns "—" when there's
 *  no postedAt (an older posted row with no recorded time). */
function postedAgo(ts: number | null): string {
  if (!ts || !Number.isFinite(ts)) return "-";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now"; // clock skew / future-stamped, clamp.
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(diff / 3600000);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(diff / 86400000);
  if (days < 7) return `${days}d ago`;
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "-";
  }
}
