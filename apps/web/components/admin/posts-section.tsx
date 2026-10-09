"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  Loader2, RefreshCw, Eye, Search, ExternalLink, Play, X, CheckCircle2, AlertTriangle, Info,
  Clapperboard, TrendingUp, DollarSign, Film, Clock,
} from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { timeAgo } from "./util";
import { PostsOverview } from "./posts-overview";

const LIST_POSTED = makeFunctionReference<"query">("clipJobs:listAllPostedClips");

const PAGE = 50;

const fmtViews = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
};

const fmtCost = (n: number) => `$${n.toFixed(2)}`;

const fmtDate = (ms: number | null | undefined) => {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
};

const PLATFORM_META: Record<string, { label: string; color: string; bg: string }> = {
  tiktok:    { label: "TikTok",    color: "text-fuchsia-300", bg: "bg-fuchsia-500/10 border-fuchsia-500/25" },
  instagram: { label: "Instagram", color: "text-pink-300",    bg: "bg-pink-500/10 border-pink-500/25" },
  youtube:   { label: "YouTube",   color: "text-red-300",     bg: "bg-red-500/10 border-red-500/25" },
  facebook:  { label: "Facebook",  color: "text-blue-300",    bg: "bg-blue-500/10 border-blue-500/25" },
  x:         { label: "X",         color: "text-zinc-200",    bg: "bg-zinc-500/10 border-zinc-500/25" },
  threads:   { label: "Threads",   color: "text-zinc-300",    bg: "bg-zinc-500/10 border-zinc-400/25" },
  reddit:    { label: "Reddit",    color: "text-orange-300",  bg: "bg-orange-500/10 border-orange-500/25" },
  linkedin:  { label: "LinkedIn",  color: "text-sky-300",     bg: "bg-sky-500/10 border-sky-500/25" },
  bluesky:   { label: "Bluesky",   color: "text-sky-300",     bg: "bg-sky-500/10 border-sky-500/25" },
};

function PlatformBadge({ platform }: { platform: string | null }) {
  if (!platform) return <span className="text-zinc-600">—</span>;
  const p = platform.toLowerCase();
  const meta = PLATFORM_META[p];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${
        meta?.bg ?? "bg-zinc-500/10 border-zinc-600/30"
      } ${meta?.color ?? "text-zinc-300"}`}
    >
      {meta?.label ?? platform}
    </span>
  );
}

type SyncSummary = {
  ok: boolean;
  error?: string;
  scanned?: number;
  measured?: number;
  updated?: number;
};

type SyncProgress = { chunk: number; chunks: number; scanned: number; total: number; updated: number };

/** Streams /api/admin/posts/sync-views (NDJSON). Same engine as /analytics
 *  Refresh and the 5-min cron: upload-post analytics → clips.viewCount, so the
 *  reactive table below updates row by row while this runs. */
async function streamSyncAllViews(accessToken: string, onProgress: (p: SyncProgress) => void): Promise<SyncSummary & { agents?: number; errors?: number; note?: string }> {
  const res = await fetch("/api/admin/posts/sync-views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken }),
    signal: AbortSignal.timeout(295_000),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as SyncSummary;
    return { ok: false, error: data.error ?? `HTTP ${res.status}` };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", last: (SyncSummary & { agents?: number; errors?: number; note?: string }) | null = null, note: string | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const ln of lines) {
      if (!ln.trim()) continue;
      let ev: Record<string, unknown>;
      try { ev = JSON.parse(ln) as Record<string, unknown>; } catch { continue; }
      if (ev.type === "progress" || ev.type === "chunk") onProgress({ chunk: Number(ev.chunk ?? 0), chunks: Number(ev.chunks ?? 0), scanned: Number(ev.scanned ?? 0), total: Number(ev.total ?? 0), updated: Number(ev.updated ?? 0) });
      if (ev.type === "note") note = String(ev.note ?? "");
      if (ev.type === "done") last = { ok: ev.ok === true, error: ev.error as string | undefined, scanned: Number(ev.scanned ?? 0), measured: Number(ev.measured ?? 0), updated: Number(ev.updated ?? 0), errors: Number(ev.errors ?? 0), agents: Number(ev.agents ?? 0) };
    }
  }
  return last ? { ...last, note } : { ok: false, error: "Sync ended without a result" };
}

type PostedClip = {
  id: string;
  clipUrl: string | null;
  postUrl: string | null;
  platform: string | null;
  title: string;
  captionText: string;
  viralScore: number;
  mintAddress: string;
  postedAt: number | null;
  createdAt: number;
  views: number | null;
  cost: number;
  sourceUrl: string | null;
  agentName: string;
  agentAvatar: string;
  agentHandle: string;
};

function VideoPanel({ clip, onClose }: { clip: PostedClip; onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[420px] rounded-2xl border border-[#2a2a32] bg-[#0e0e12] shadow-2xl overflow-hidden mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e24]">
          <div className="flex items-center gap-2 min-w-0">
            {clip.agentAvatar && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={clip.agentAvatar}
                alt=""
                className="size-6 rounded-full object-cover border border-zinc-700 shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-white truncate">{clip.agentName}</p>
              {clip.agentHandle && (
                <p className="text-[10.5px] text-zinc-500">@{clip.agentHandle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Video */}
        {clip.clipUrl ? (
          <video
            src={clip.clipUrl}
            controls
            autoPlay
            className="w-full aspect-[9/16] bg-black object-contain"
          />
        ) : (
          <div className="w-full aspect-[9/16] bg-zinc-900 grid place-items-center text-zinc-600">
            <Clapperboard className="size-10" />
          </div>
        )}

        {/* Meta */}
        <div className="px-4 py-3 space-y-3 border-t border-[#1e1e24]">
          {clip.captionText && (
            <p className="text-[12px] text-zinc-300 leading-snug line-clamp-3">
              {clip.captionText}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Views",       value: fmtViews(clip.views),    cls: "text-white" },
              { label: "Viral Score", value: String(clip.viralScore), cls: "text-emerald-400" },
              { label: "Gen Cost",    value: fmtCost(clip.cost),      cls: "text-amber-300" },
              { label: "Platform",    value: clip.platform ?? "—",    cls: "text-white capitalize" },
            ].map(({ label, value, cls }) => (
              <div key={label} className="rounded-xl bg-zinc-900/60 border border-zinc-800 px-3 py-2">
                <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wide">{label}</p>
                <p className={`text-[15px] font-bold mt-0.5 ${cls}`}>{value}</p>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-zinc-600 space-y-1">
            <div className="flex items-center gap-1.5">
              <Clock className="size-3" />
              <span>Posted {fmtDate(clip.postedAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="size-3" />
              <span>Generated {fmtDate(clip.createdAt)}</span>
            </div>
            {clip.sourceUrl && (
              <div className="flex items-center gap-1.5 truncate">
                <Film className="size-3 shrink-0" />
                <a
                  href={clip.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:text-zinc-400 transition-colors"
                >
                  {clip.sourceUrl}
                </a>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {clip.postUrl && (
              <a
                href={clip.postUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[12.5px] font-bold transition-colors"
              >
                <ExternalLink className="size-3.5" /> View Post
              </a>
            )}
            {clip.clipUrl && (
              <a
                href={clip.clipUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white text-[12.5px] font-semibold transition-colors"
              >
                <Play className="size-3.5 fill-current" /> Raw Clip
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type ToastTone = "info" | "success" | "error";
type ToastState = {
  tone: ToastTone;
  title: string;
  detail?: string;
};

export function PostsSection() {
  const { accessToken } = useSupabaseAuth();
  const [queryLimit, setQueryLimit] = useState(PAGE);
  const [now] = useState(() => Date.now());
  const rawClips = useQuery(LIST_POSTED, { limit: queryLimit }) as PostedClip[] | undefined;

  const [busy, setBusy]         = useState<string | null>(null);
  const [msg, setMsg]           = useState<string | null>(null);
  const [toast, setToast]       = useState<ToastState | null>(null);
  const [q, setQ]               = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [preview, setPreview]   = useState<PostedClip | null>(null);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);

  const clips = useMemo(() => rawClips ?? [], [rawClips]);
  const loading = rawClips === undefined;
  const remoteHasMore = clips.length === queryLimit;

  const totalViews = useMemo(() => clips.reduce((a, c) => a + (c.views ?? 0), 0), [clips]);
  const totalCost  = useMemo(() => clips.reduce((a, c) => a + c.cost, 0), [clips]);

  const platformCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of clips) {
      const p = c.platform?.toLowerCase() ?? "unknown";
      m[p] = (m[p] ?? 0) + 1;
    }
    return m;
  }, [clips]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clips.filter((c) => {
      if (platformFilter !== "all" && (c.platform ?? "").toLowerCase() !== platformFilter)
        return false;
      if (!needle) return true;
      return (
        c.agentName.toLowerCase().includes(needle) ||
        c.captionText.toLowerCase().includes(needle) ||
        (c.postUrl ?? "").toLowerCase().includes(needle) ||
        c.mintAddress.toLowerCase().includes(needle)
      );
    });
  }, [clips, q, platformFilter]);

  const shown = filtered;

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (remoteHasMore) setQueryLimit((n) => n + PAGE);
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [remoteHasMore]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pushToast = useCallback((next: ToastState) => {
    setToast(next);
  }, []);

  // ── Sync callbacks ──────────────────────────────────────────────────────────
  const syncAllViews = useCallback(async () => {
    if (!accessToken) { setMsg("Not signed in"); return; }
    setBusy("all"); setMsg("Syncing views across every agent…");
    try {
      const r = await streamSyncAllViews(accessToken, (p) => {
        setMsg(`Syncing · agent group ${p.chunk}/${p.chunks} · ${p.scanned}/${p.total} posts checked · ${p.updated} updated so far`);
      });
      if (!r.ok) throw new Error(r.error ?? "Sync failed");
      const summary = `Synced ${r.agents ?? 0} agents · ${r.scanned ?? 0} posts checked · ${r.measured ?? 0} measured · ${r.updated ?? 0} updated` +
        ((r.errors ?? 0) > 0 ? ` · ${r.errors} errors` : "") + (r.note ? ` · ${r.note}` : "");
      setMsg(summary);
      pushToast({ tone: (r.errors ?? 0) > 0 || r.note ? "info" : "success", title: (r.errors ?? 0) > 0 ? "Views synced with warnings" : "Views synced", detail: summary });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Sync failed";
      setMsg(error);
      pushToast({ tone: "error", title: "Sync failed", detail: error });
    } finally {
      setBusy(null);
    }
  }, [accessToken, pushToast]);


  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
    <PostsOverview clips={clips} now={now} />
    <div className="relative rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">

      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-[#18181c] flex flex-col gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Posted Videos</h2>
          <p className="text-[11.5px] text-zinc-600 mt-0.5">
            {clips.length} posted clips · {fmtViews(totalViews)} total views · {fmtCost(totalCost)} gen cost ·
            click a row to preview
          </p>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/40 bg-emerald-500/5 px-3 py-1.5 text-[12px] font-semibold text-emerald-400">
            <Eye className="size-3.5" /> {fmtViews(totalViews)} views
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/40 bg-amber-500/5 px-3 py-1.5 text-[12px] font-semibold text-amber-300">
            <DollarSign className="size-3.5" /> {fmtCost(totalCost)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-800/40 bg-sky-500/5 px-3 py-1.5 text-[12px] font-semibold text-sky-300">
            <TrendingUp className="size-3.5" /> {clips.length} posts
          </span>
          {Object.entries(platformCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([p, n]) => (
              <span
                key={p}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold capitalize ${
                  PLATFORM_META[p]?.bg ?? "bg-zinc-500/10 border-zinc-600/30"
                } ${PLATFORM_META[p]?.color ?? "text-zinc-300"}`}
              >
                {PLATFORM_META[p]?.label ?? p} · {n}
              </span>
            ))}
        </div>

        {/* Sync controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={syncAllViews}
            disabled={busy !== null || !accessToken}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/60 hover:border-emerald-600 text-emerald-400 px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          >
            {busy === "all" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Sync all views
          </button>

          {/* Search + filter */}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-zinc-600 pointer-events-none" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search agent, caption…"
                className="h-8 w-[200px] bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2 text-[12px] text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
              />
            </div>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="h-8 bg-zinc-900 border border-zinc-800 rounded-lg px-2 text-[12px] text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              <option value="all">All platforms</option>
              {Object.keys(PLATFORM_META).map((p) => (
                <option key={p} value={p}>{PLATFORM_META[p].label}</option>
              ))}
            </select>
          </div>
        </div>

        {msg && <span className="text-[11px] text-zinc-400 leading-tight">{msg}</span>}
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
              <th className="py-3 px-4 text-left font-medium">Agent</th>
              <th className="py-3 px-4 text-left font-medium">Caption</th>
              <th className="py-3 px-4 text-left font-medium">Platform</th>
              <th className="py-3 px-4 text-right font-medium">Views</th>
              <th className="py-3 px-4 text-right font-medium">Viral</th>
              <th className="py-3 px-4 text-right font-medium">Cost</th>
              <th className="py-3 px-4 text-right font-medium">Posted</th>
              <th className="py-3 px-4 text-center font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="py-14 text-center text-zinc-700">
                  <Loader2 className="size-5 animate-spin inline" />
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-14 text-center text-zinc-600 text-[12px]">
                  No posted videos found
                </td>
              </tr>
            )}
            {shown.map((c) => (
              // Plain <tr> — motion.tr is invalid inside <tbody> in all browsers
              // and causes a React hydration crash. Use CSS transitions instead.
              <tr
                key={c.id}
                className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors duration-100"
                onClick={() => setPreview(c)}
              >
                {/* Agent */}
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5">
                    <div className="size-7 rounded-lg overflow-hidden border border-[#27272a] shrink-0 bg-zinc-900 flex items-center justify-center">
                      {c.agentAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.agentAvatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Clapperboard className="size-3.5 text-zinc-600" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white leading-tight truncate max-w-[140px]">
                        {c.agentName}
                      </p>
                      {c.agentHandle && (
                        <p className="text-[10px] text-zinc-600 truncate max-w-[140px]">
                          @{c.agentHandle}
                        </p>
                      )}
                    </div>
                  </div>
                </td>

                {/* Caption */}
                <td className="py-3 px-4">
                  <p className="text-zinc-300 leading-snug line-clamp-2 max-w-[220px] text-[11.5px]">
                    {c.captionText || c.title || "—"}
                  </p>
                </td>

                {/* Platform */}
                <td className="py-3 px-4">
                  <PlatformBadge platform={c.platform} />
                </td>

                {/* Views */}
                <td className="py-3 px-4 text-right font-mono">
                  <span className={c.views != null && c.views > 0 ? "text-emerald-400" : "text-zinc-600"}>
                    {fmtViews(c.views)}
                  </span>
                </td>

                {/* Viral score */}
                <td className="py-3 px-4 text-right font-mono">
                  <span
                    className={
                      c.viralScore >= 70
                        ? "text-emerald-400"
                        : c.viralScore >= 50
                        ? "text-amber-300"
                        : "text-zinc-500"
                    }
                  >
                    {c.viralScore}
                  </span>
                </td>

                {/* Cost */}
                <td className="py-3 px-4 text-right font-mono text-amber-300/80">
                  {fmtCost(c.cost)}
                </td>

                {/* Posted at */}
                <td className="py-3 px-4 text-right text-zinc-500 text-[11px] whitespace-nowrap">
                  {timeAgo(c.postedAt ?? null)}
                </td>

                {/* Actions */}
                <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-center gap-1">
                    {c.postUrl && (
                      <a
                        href={c.postUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open post"
                        className="p-1.5 rounded-lg border border-zinc-800 hover:border-emerald-600/60 text-zinc-500 hover:text-emerald-400 transition-colors"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    {c.clipUrl && (
                      <button
                        type="button"
                        onClick={() => setPreview(c)}
                        title="Preview video"
                        className="p-1.5 rounded-lg border border-zinc-800 hover:border-sky-600/60 text-zinc-500 hover:text-sky-400 transition-colors"
                      >
                        <Play className="size-3.5 fill-current" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {/* Infinite scroll sentinel */}
            {!loading && remoteHasMore && (
              <tr ref={sentinelRef}>
                <td colSpan={8} className="py-6 text-center text-zinc-600 text-[11.5px]">
                  <Loader2 className="size-3.5 animate-spin inline mr-2" />
                  Loading more…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 w-[320px] rounded-xl border border-[#26262c] bg-[#0d0d10] shadow-2xl overflow-hidden">
          <div className="flex items-start gap-3 px-4 py-3">
            <div
              className={`mt-0.5 rounded-full p-1.5 ${
                toast.tone === "success"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : toast.tone === "error"
                    ? "bg-rose-500/15 text-rose-400"
                    : "bg-sky-500/15 text-sky-400"
              }`}
            >
              {toast.tone === "success" ? <CheckCircle2 className="size-4" /> : toast.tone === "error" ? <AlertTriangle className="size-4" /> : <Info className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-white">{toast.title}</p>
              {toast.detail && <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">{toast.detail}</p>}
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-zinc-500 hover:text-white transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Video preview panel */}
      {preview && <VideoPanel clip={preview} onClose={() => setPreview(null)} />}
    </div>
    </>
  );
}
