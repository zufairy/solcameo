"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery, useAction } from "convex/react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { makeFunctionReference } from "convex/server";
import {
  Loader2, RefreshCw, ArrowUpRight, Music2, Clapperboard, SquarePlay, Eye, EyeOff, Search,
  ChevronDown, ChevronUp, Coins, Zap,
} from "lucide-react";
import { getAllContentRewardSubmissions, type AdminRewardSubmission } from "@/lib/content-rewards";
import {
  mergeAdminSubmissions,
  type ConvexAdminSubmission,
  type HireAdminSubmission,
  type MergedAdminSubmission,
} from "@/lib/mergeAdminSubmissions";
import { fmtUsd, timeAgo, summarizeOracleRun, type OracleRunResult, type ClaimRunResult } from "./util";

// String refs so this typechecks before `npx convex deploy` regenerates types.
const GET_PROGRESS = makeFunctionReference<"query">("submissions:getSyncProgress");
const GET_ONCHAIN = makeFunctionReference<"query">("submissions:onchainByContentReward");
const GET_ALL_ADMIN = makeFunctionReference<"query">("submissions:listAllAdmin");
const GET_ALL_HIRE = makeFunctionReference<"query">("submissions:listAllHireAdmin");
const RUN_ORACLE_PAYOUT = makeFunctionReference<"action">("admin:runOraclePayout");

const ALL_PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

type SyncSummary = { ok: boolean; error?: string; scanned?: number; measured?: number; updated?: number; skipped?: number; errors?: number; capped?: boolean };

/** Call the same-origin scrape-views worker directly (works on localhost AND prod;
 *  no NEXT_PUBLIC_APP_URL / cloud-action round-trip). Admin-gated by the token.
 *  mode "analytics" → upload-post analytics only (stable, no proxy);
 *  mode "scrape" → residential-proxy scrape only. */
async function syncViews(platform: string, accessToken: string, mode: "analytics" | "scrape"): Promise<SyncSummary> {
  const res = await fetch("/api/oracle/scrape-views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, accessToken, mode }),
  });
  const data = (await res.json().catch(() => ({}))) as SyncSummary;
  if (!res.ok) return { ok: false, error: data.error ?? `worker returned ${res.status}` };
  return data;
}

/** Money formatter that respects the campaign currency (USD/USDC → $, else code-prefixed). */
function fmtMoney(amount: number, currency: string): string {
  const c = (currency || "USD").toUpperCase();
  if (c === "USD" || c === "USDC") return fmtUsd(amount);
  if (amount >= 1_000_000) return `${c} ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${c} ${(amount / 1_000).toFixed(1)}K`;
  return `${c} ${amount.toFixed(2)}`;
}

type SyncProgress = {
  platform: string;
  total: number;
  done: number;
  updated: number;
  running: boolean;
  startedAt: number;
  finishedAt: number | null;
  note: string | null;
};

const fmtViews = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
};

// Hostnames that are real social-post permalinks (the thing the platform button
// must open). Anything else — a Supabase/CDN storage URL, an .mp4, a KIE render
// link — is the raw clip/video, NOT a post, and must never open from this button.
const SOCIAL_POST_HOST =
  /(?:^|\.)(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|twitter\.com|x\.com)$/i;

/** True only for a real social-platform post permalink (not a media/clip URL). */
function isSocialPostUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return SOCIAL_POST_HOST.test(new URL(url.trim()).hostname);
  } catch {
    return false; // not even a valid absolute URL → definitely not a post link
  }
}

/**
 * The live post permalink for a submission, or null when it was never posted.
 * A submission counts as "posted" only when it carries a real platform permalink
 * — NOT the raw clip file. Historically the write side fell back to
 * `contentUrl = clipUrl` (== videoUrl) when no live permalink was captured, and
 * some rows store the video URL directly in content_url, so the button was
 * opening the video. We now require content_url to be a real social permalink;
 * we also accept video_url IF (and only if) it happens to be a social permalink.
 */
function getPostLink(r: MergedAdminSubmission): string | null {
  if (isSocialPostUrl(r.contentUrl)) return r.contentUrl;
  if (isSocialPostUrl(r.videoUrl)) return r.videoUrl;
  return null;
}

// content_rewards_submissions.platform is stored as a label ("TikTok", …).
// `slug` is the simpleicons brand-logo id (cdn.simpleicons.org/<slug>).
const PLATFORM_META: Record<string, { label: string; slug: string }> = {
  tiktok:    { label: "TikTok",    slug: "tiktok" },
  instagram: { label: "Instagram", slug: "instagram" },
  youtube:   { label: "YouTube",   slug: "youtube" },
  facebook:  { label: "Facebook",  slug: "facebook" },
  x:         { label: "X",         slug: "x" },
};

// The REAL TikTok mark — the two-tone cyan/magenta glitch logo, NOT the flat black
// simpleicons glyph. Rendered inline so it keeps its brand colours on the dark UI.
// (viewBox is padded so the ±offset glitch layers never clip at the edges.)
const TIKTOK_GLYPH =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="-1.5 -1.5 27 27" className={className} aria-hidden="true">
      <path d={TIKTOK_GLYPH} transform="translate(-1.1 -1.1)" fill="#25F4EE" />
      <path d={TIKTOK_GLYPH} transform="translate(1.1 1.1)" fill="#FE2C55" />
      <path d={TIKTOK_GLYPH} fill="#A855F7" />
    </svg>
  );
}

/** Brand logo for a platform. TikTok gets the real colour mark; the rest use the
 *  simpleicons brand glyph. */
function PlatformIcon({ pkey, pm, className }: { pkey: string; pm?: { label: string; slug: string }; className?: string }) {
  if (pkey === "tiktok") return <TikTokIcon className={className} />;
  if (!pm) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`https://cdn.simpleicons.org/${pm.slug}`} alt={pm.label} className={className} />;
}

// Lazy-load: render PAGE rows, reveal PAGE more when the sentinel scrolls into view.
const PAGE = 20;
// Row entrance — a rapid, subtle waterfall (per list-stagger guidance for dense
// table rows). Only the freshly-mounted batch animates (existing rows keep their
// keys and don't re-animate), so scrolling never re-cascades the whole table.
const ROW_ANIM = {
  stagger: 0.03,   // s between rows in a batch
  offsetY: 6,      // px each row rises from
  spring: { type: "spring" as const, stiffness: 320, damping: 30 },
};

// Source/type badge under the agent name — distinguishes the two submission
// stores (and clipping vs UGC among the Convex campaign rows).
type SourceBadgeKey = "content_reward" | "ugc" | "clipping" | "hire";
const SOURCE_BADGE: Record<SourceBadgeKey, { text: string; cls: string }> = {
  content_reward: { text: "Content reward", cls: "text-zinc-400 bg-zinc-500/10 border-zinc-600/30" },
  ugc:            { text: "UGC",            cls: "text-violet-300 bg-violet-500/10 border-violet-500/20" },
  clipping:       { text: "Campaign",       cls: "text-sky-300 bg-sky-500/10 border-sky-500/20" },
  hire:           { text: "Hire",           cls: "text-amber-300 bg-amber-500/10 border-amber-500/20" },
};

const STATUS_CLS: Record<string, string> = {
  approved: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  verified: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  paid:     "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  pending:  "text-amber-300 bg-amber-500/10 border-amber-500/20",
  requested:"text-sky-300 bg-sky-500/10 border-sky-500/20",
  rejected: "text-rose-300 bg-rose-500/10 border-rose-500/20",
};

export function SubmissionsSection() {
  const { accessToken } = useSupabaseAuth();

  const progress = (useQuery(GET_PROGRESS, {}) ?? []) as unknown as SyncProgress[];
  const onchain = (useQuery(GET_ONCHAIN, {}) ?? {}) as unknown as Record<string, { paid: number; owed: number; convexId?: string }>;
  // Convex campaign/UGC submissions (submissions.listAllAdmin) — the second store
  // the admin table merges in so UGC posts appear alongside content-reward rows.
  const convexSubs = useQuery(GET_ALL_ADMIN, { limit: 1500 }) as unknown as ConvexAdminSubmission[] | undefined;
  // Hire-per-video posts (pre-paid commissions) — a third source; see mergeAdminSubmissions.
  const hireSubs = useQuery(GET_ALL_HIRE, { limit: 1500 }) as unknown as HireAdminSubmission[] | undefined;
  const runOraclePayout = useAction(RUN_ORACLE_PAYOUT) as (a: { accessToken: string }) => Promise<{ ok: boolean; oracle: OracleRunResult; crank: ClaimRunResult }>;

  const [rows, setRows] = useState<AdminRewardSubmission[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  // Optional "posted only" view — hides rows with no live post permalink AND no
  // on-chain payout. Default OFF so every submission (latest + on-chain) shows,
  // matching the long-standing behaviour; the admin can opt into the filter.
  const [postedOnly, setPostedOnly] = useState(false);
  const [progressMin, setProgressMin] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Lazy-load: how many rows are currently rendered. Grows by PAGE as the sentinel
  // scrolls into view; resets to PAGE whenever the filter/search narrows the list.
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const prefersReduced = useReducedMotion();
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  // Re-read the content-rewards submissions from Supabase. Resolves after the
  // network round-trip, so the setState lands in a promise callback (not the
  // effect body) — and only if still mounted.
  const load = useCallback(() => {
    return getAllContentRewardSubmissions(1500).then((data) => {
      if (aliveRef.current) setRows(data);
    });
  }, []);

  // Initial load.
  useEffect(() => { void load(); }, [load]);

  // Realtime-ish: while a sync is running, re-read from Supabase every 3s so the
  // view counts visibly climb in the table as the worker writes them back.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  useEffect(() => {
    const t = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const loading = rows === null;
  // Merge the Supabase content-reward rows with the Convex campaign/UGC rows into
  // one newest-first list (dedup on contentRewardSubmissionId + normalized postUrl).
  const list = useMemo<MergedAdminSubmission[]>(
    () => mergeAdminSubmissions(rows ?? [], convexSubs ?? [], hireSubs ?? []),
    [rows, convexSubs, hireSubs],
  );

  const counts = useMemo(() => {
    const c = { tiktok: 0, instagram: 0, youtube: 0 };
    for (const r of list) {
      const p = (r.platform ?? "").toLowerCase();
      if (p === "tiktok") c.tiktok++;
      else if (p === "instagram") c.instagram++;
      else if (p === "youtube") c.youtube++;
    }
    return c;
  }, [list]);

  // A row has real on-chain presence (paid USDC on devnet/mainnet) — campaign rows
  // carry it inline as paidUsdc; content-reward rows look it up in the onchain map.
  // On-chain submissions are always shown, even under the "posted only" filter.
  const hasOnchain = useCallback(
    (r: MergedAdminSubmission) =>
      r.source === "campaign" ? (r.paidUsdc ?? 0) > 0 : (onchain[r.id]?.paid ?? 0) > 0,
    [onchain],
  );
  // Source-of-truth "was this actually published?": a live permalink, OR a durable
  // upload-post identity (platformPostId/uploadPostRequestId — set the moment the
  // post is accepted, even before Instagram/TikTok expose a URL), OR an on-chain
  // payout. This stops a genuinely-posted clip from showing "not posted" just
  // because its permalink hasn't resolved yet — the false-negative the operator saw.
  const isPosted = useCallback(
    (r: MergedAdminSubmission) => getPostLink(r) !== null || r.postedProof === true || hasOnchain(r),
    [hasOnchain],
  );
  // Rows the "posted only" toggle would hide: not published by any signal above.
  const notPostedCount = useMemo(
    () => list.filter((r) => !isPosted(r)).length,
    [list, isPosted],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((r) => {
      if (postedOnly && !isPosted(r)) return false;
      if (platformFilter !== "all" && (r.platform ?? "").toLowerCase() !== platformFilter) return false;
      if (!needle) return true;
      return (
        r.submitterName.toLowerCase().includes(needle) ||
        r.campaignName.toLowerCase().includes(needle) ||
        (r.contentUrl ?? "").toLowerCase().includes(needle) ||
        (r.title ?? "").toLowerCase().includes(needle)
      );
    });
  }, [list, q, platformFilter, postedOnly, isPosted]);

  // Lazy-load window: render only the first `visibleCount` rows; reveal PAGE more
  // as the sentinel scrolls into view. Reset to the first page when the filter,
  // search, or posted-only toggle narrows the list — done as setState-during-render
  // (React's supported reset-on-change pattern) so it doesn't cascade an effect.
  const filterKey = `${q}|${platformFilter}|${postedOnly}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(PAGE);
  }
  const shown = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleCount < filtered.length;
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setVisibleCount((c) => c + PAGE); },
      { rootMargin: "300px" }, // prefetch the next page before it's fully in view
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, shown.length]);

  const totalViews = useMemo(() => list.reduce((a, r) => a + (r.views || 0), 0), [list]);
  const campaignCount = useMemo(() => list.filter((r) => r.source === "campaign").length, [list]);

  async function runPlatform(platform: "tiktok" | "instagram" | "youtube") {
    if (!accessToken) { setMsg("Not signed in"); return; }
    setBusy(`p-${platform}`); setMsg(null);
    try {
      const r = await syncViews(platform, accessToken, "scrape");
      setMsg(
        r.ok
          ? `${PLATFORM_META[platform].label}: scanned ${r.scanned ?? 0} · ${r.measured ?? 0} fetched · ${r.updated ?? 0} updated${r.skipped ? ` · ${r.skipped} skipped` : ""}${r.errors ? ` · ${r.errors} errors` : ""}${r.capped ? " · more pending (click again)" : ""}`
          : `${PLATFORM_META[platform].label} sync failed: ${r.error ?? "unknown"}`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
      await load();
      await recalcPayouts(true); // views changed → keep payouts + agent earnings current
    }
  }

  // Recompute + persist payout for EVERY submission AND mirror it into each agent's
  // earnings (Convex distributions → monthlyEarnings/lifetime/PnL/chart). `silent`
  // runs it automatically after a view sync so earnings stay dynamic; the explicit
  // "Sync Payout" button runs it non-silently with status feedback.
  async function recalcPayouts(silent = false) {
    if (!accessToken) { if (!silent) setMsg("Not signed in"); return; }
    if (!silent) { setBusy("payout"); setMsg(null); }
    try {
      const res = await fetch("/api/admin/recalc-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, accessToken }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok: boolean; scanned?: number; updated?: number; earningsRecorded?: number; error?: string };
      if (!silent) setMsg(d.ok ? `Payout synced · ${d.updated ?? 0}/${d.scanned ?? 0} updated · ${d.earningsRecorded ?? 0} agents credited` : `Payout sync failed: ${d.error ?? "unknown"}`);
    } catch (e) {
      if (!silent) setMsg(e instanceof Error ? e.message : "Payout sync failed");
    } finally {
      if (!silent) setBusy(null);
      await load();
    }
  }
  const syncAllPayouts = () => recalcPayouts(false);

  // Force the on-chain campaign payout on demand: attest matured submissions
  // (record_performance / reject_clip) via /api/oracle/run, THEN crank
  // claim_payout via /api/oracle/claim — the two oracle crons, fired NOW from one
  // click through the admin-gated `runOraclePayout` action. Freshly-attested rows
  // are usually still inside the ~1h on-chain dispute window, so a claimed:0 crank
  // is EXPECTED — `summarizeOracleRun` renders that as a clear "run again after it
  // clears", never a silent no-op.
  async function runOracleNow() {
    if (!accessToken) { setMsg("Not signed in"); return; }
    setBusy("oracle"); setMsg(null);
    try {
      const r = await runOraclePayout({ accessToken });
      setMsg(summarizeOracleRun({ oracle: r.oracle, crank: r.crank }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Oracle run failed");
    } finally {
      setBusy(null);
    }
  }

  // Per-row "refresh payout": recompute this submission's payout from the campaign
  // reward rate × its current views, persist it, and update the row in place.
  async function refreshRow(id: string) {
    if (!accessToken) { setMsg("Not signed in"); return; }
    setRowBusy(id);
    try {
      const res = await fetch("/api/admin/recalc-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: id, accessToken }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok: boolean; views?: number; payout?: number; currency?: string; error?: string };
      if (d.ok) {
        setRows((prev) => (prev ?? []).map((r) =>
          r.id === id
            ? { ...r, views: d.views ?? r.views, supposedPayout: d.payout ?? r.supposedPayout, payout: d.payout ?? r.payout, currency: d.currency ?? r.currency }
            : r,
        ));
      } else {
        setMsg(`Recalc failed: ${d.error ?? "unknown"}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Recalc failed");
    } finally {
      setRowBusy(null);
    }
  }

  // Per-row "inject views" (devnet only): drives recordPerformanceTx on-chain then
  // settleFromOracle so the existing claim keeper pays the clipper's agentWallet.
  // Only shown for rows that have a Convex money-rail submission (convexId present).
  async function injectViews(contentRewardSubmissionId: string, convexId: string) {
    const viewsStr = window.prompt("Inject view count (devnet only):", "100000");
    if (!viewsStr) return;
    const views = parseInt(viewsStr, 10);
    if (!Number.isFinite(views) || views <= 0) { setMsg("Invalid view count"); return; }
    if (!accessToken) { setMsg("Not signed in"); return; }
    setRowBusy(contentRewardSubmissionId);
    try {
      const res = await fetch("/api/admin/inject-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: convexId, views, accessToken }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok: boolean; txSignature?: string; error?: string };
      if (d.ok) {
        setMsg(`Injected ${views.toLocaleString()} views · tx: ${(d.txSignature ?? "").slice(0, 20)}…`);
        await load();
      } else {
        setMsg(`Inject failed: ${d.error ?? "unknown"}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Inject failed");
    } finally {
      setRowBusy(null);
    }
  }

  // Sync ALL submissions across every platform via upload-post analytics only.
  // This avoids the residential proxy path entirely and is much more stable.
  async function runAll() {
    if (!accessToken) { setMsg("Not signed in"); return; }
    setBusy("all"); setMsg("Syncing all submissions…");
    let totMeasured = 0, totUpdated = 0;
    const fails: string[] = [];
    try {
      for (const platform of ALL_PLATFORMS) {
        const r = await syncViews(platform, accessToken, "analytics");
        if (!r.ok) { fails.push(`${platform}: ${r.error ?? "failed"}`); continue; }
        totMeasured += r.measured ?? 0;
        totUpdated += r.updated ?? 0;
      }
      setMsg(
        `Synced all · ${totMeasured} fetched · ${totUpdated} updated` +
        (fails.length ? ` · failures: ${fails.join("; ")}` : ""),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
      await load();
      await recalcPayouts(true); // views changed → keep payouts + agent earnings current
    }
  }

  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
      {/* Header + sync buttons */}
      <div className="px-6 py-4 border-b border-[#18181c] flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-white">Submissions</h2>
            <p className="text-[11.5px] text-zinc-600 mt-0.5">
              {list.length} vello-agent submissions{campaignCount > 0 ? ` (${campaignCount} campaign / UGC)` : ""} · {fmtViews(totalViews)} views tracked · click a platform to open the post
            </p>
          </div>
          <button
            onClick={() => load()}
            disabled={busy !== null}
            title="Reload submissions from the content-rewards database"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-white px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {/* 4 sync buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={runAll}
            disabled={busy !== null || !accessToken}
            title="Sync EVERY submission: upload-post analytics only (no residential proxy)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/60 hover:border-emerald-600 text-emerald-400 px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          >
            {busy === "all" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Sync all views
          </button>
          <button
            onClick={() => runPlatform("tiktok")}
            disabled={busy !== null || !accessToken}
            title="Fetch live TikTok view counts via vello's yt-dlp over the residential proxy"
            className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-800/50 hover:border-fuchsia-500 text-fuchsia-300 px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          >
            {busy === "p-tiktok" ? <Loader2 className="size-3.5 animate-spin" /> : <Music2 className="size-3.5" />}
            Sync TikTok <span className="text-fuchsia-500/70">· {counts.tiktok}</span>
          </button>
          <button
            onClick={() => runPlatform("instagram")}
            disabled={busy !== null || !accessToken}
            title="Fetch live Instagram Reels view counts via vello's yt-dlp over the residential proxy"
            className="inline-flex items-center gap-1.5 rounded-lg border border-pink-800/50 hover:border-pink-500 text-pink-300 px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          >
            {busy === "p-instagram" ? <Loader2 className="size-3.5 animate-spin" /> : <Clapperboard className="size-3.5" />}
            Sync Instagram <span className="text-pink-500/70">· {counts.instagram}</span>
          </button>
          <button
            onClick={() => runPlatform("youtube")}
            disabled={busy !== null || !accessToken}
            title="Fetch live YouTube Shorts view counts via vello's yt-dlp over the residential proxy"
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-800/50 hover:border-red-500 text-red-300 px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          >
            {busy === "p-youtube" ? <Loader2 className="size-3.5 animate-spin" /> : <SquarePlay className="size-3.5" />}
            Sync YouTube <span className="text-red-500/70">· {counts.youtube}</span>
          </button>
          <button
            onClick={syncAllPayouts}
            disabled={busy !== null || !accessToken}
            title="Recompute every submission's payout from its campaign reward rate × current views"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/50 hover:border-amber-500 text-amber-300 px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          >
            {busy === "payout" ? <Loader2 className="size-3.5 animate-spin" /> : <Coins className="size-3.5" />}
            Sync Payout
          </button>
          <button
            onClick={runOracleNow}
            disabled={busy !== null || !accessToken}
            title="Force the on-chain payout now: attest matured submissions, then crank claim_payout — instead of waiting for the 30-min / 10-min crons"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/60 hover:border-emerald-500 text-emerald-300 px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          >
            {busy === "oracle" ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
            Run oracle + crank
          </button>

          {/* Search + platform filter */}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setPostedOnly((v) => !v)}
              title={postedOnly
                ? `Showing posted submissions only — ${notPostedCount} not-posted hidden. Click to show all.`
                : "Showing all submissions. Click to hide submissions that were never posted."}
              className={`inline-flex items-center gap-1.5 h-8 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors ${
                postedOnly
                  ? "border-emerald-800/60 text-emerald-300 bg-emerald-500/5"
                  : "border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600"
              }`}
            >
              {postedOnly ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              Posted only{postedOnly && notPostedCount > 0 ? ` · ${notPostedCount} hidden` : ""}
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-zinc-600" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search agent, campaign, URL…"
                className="h-8 w-[220px] bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2 text-[12px] text-white focus:outline-none focus:border-zinc-600"
              />
            </div>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="h-8 bg-zinc-900 border border-zinc-800 rounded-lg px-2 text-[12px] text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              <option value="all">All platforms</option>
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
              <option value="facebook">Facebook</option>
              <option value="x">X</option>
            </select>
          </div>
        </div>

        <p className="text-[11px] text-zinc-600 leading-tight">
          <span className="text-zinc-500 font-medium">Run oracle + crank</span> attests views on-chain now; the crank pays out once each submission&apos;s ~1h dispute window has passed.
        </p>

        {msg && <span className="text-[11px] text-zinc-400 leading-tight">{msg}</span>}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
              <th className="py-3 px-4 text-left font-medium">Agent</th>
              <th className="py-3 px-4 text-left font-medium">Campaign</th>
              <th className="py-3 px-4 text-left font-medium">Platform</th>
              <th className="py-3 px-4 text-right font-medium">Views</th>
              <th className="py-3 px-4 text-left font-medium">Status</th>
              <th className="py-3 px-4 text-right font-medium">Payout</th>
              <th className="py-3 px-4 text-right font-medium">On-chain</th>
              <th className="py-3 px-4 text-right font-medium">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const pkey = (r.platform ?? "").toLowerCase();
              const pm = PLATFORM_META[pkey];
              const isCampaign = r.source === "campaign";
              const isHire = r.source === "hire";
              const srcLabel: SourceBadgeKey = isHire
                ? "hire"
                : isCampaign
                  ? (r.agentType === "clipping" ? "clipping" : "ugc")
                  : "content_reward";
              return (
                <motion.tr
                  key={r.id}
                  initial={prefersReduced ? false : { opacity: 0, y: ROW_ANIM.offsetY }}
                  animate={{ opacity: 1, y: 0 }}
                  // Stagger WITHIN the freshly-mounted batch (i % PAGE). Existing rows
                  // keep their keys and never re-animate on scroll or data refresh.
                  transition={{ ...ROW_ANIM.spring, delay: prefersReduced ? 0 : (i % PAGE) * ROW_ANIM.stagger }}
                  className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.015]">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="size-7 rounded-lg overflow-hidden border border-[#27272a] shrink-0 bg-zinc-900">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.submitterImage ? <img src={r.submitterImage} alt="" className="w-full h-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white leading-tight truncate max-w-[160px]">{r.submitterName}</p>
                        <span className={`inline-block mt-0.5 text-[9px] font-semibold rounded px-1 py-px border ${SOURCE_BADGE[srcLabel].cls}`}>
                          {SOURCE_BADGE[srcLabel].text}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <p className="text-zinc-300 leading-tight truncate max-w-[200px]">{r.campaignName || "—"}</p>
                    {r.title && <p className="text-[10.5px] text-zinc-600 truncate max-w-[200px]">{r.title}</p>}
                  </td>
                  <td className="py-3 px-4">
                    {(() => {
                    // Open the POSTED platform permalink — never the raw clip. `getPostLink`
                    // returns null when the row was never posted (see its doc comment).
                    const postLink = getPostLink(r);
                    return r.platform ? (
                      postLink ? (
                        <a
                          href={postLink}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open ${pm?.label ?? r.platform} post`}
                          className="group inline-flex items-center gap-2 rounded-lg border border-zinc-800 hover:border-emerald-600/60 bg-zinc-900/60 hover:bg-zinc-900 px-2.5 py-1.5 transition-colors"
                        >
                          <PlatformIcon pkey={pkey} pm={pm} className="size-4 shrink-0" />
                          <span className="text-[11.5px] font-medium text-zinc-300 group-hover:text-white">{pm?.label ?? r.platform}</span>
                          <ArrowUpRight className="size-3.5 text-zinc-600 group-hover:text-emerald-400" />
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-2.5 py-1.5 opacity-60">
                          <PlatformIcon pkey={pkey} pm={pm} className="size-4 shrink-0" />
                          <span className="text-[11.5px] font-medium text-zinc-500">{pm?.label ?? r.platform}</span>
                        </span>
                      )
                    ) : <span className="text-zinc-700">—</span>;
                    })()}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-white">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <Eye className="size-3 text-zinc-600" /> {fmtViews(r.views)}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {!isPosted(r) ? (
                      // Never posted (no permalink, NO durable upload-post id, and no on-chain
                      // payout) — the source-of-truth status, regardless of the DB approval
                      // status. A post accepted by upload-post carries a durable id (even
                      // before its permalink resolves), so it is NOT flagged here.
                      <span className="text-[10px] font-semibold rounded-md px-1.5 py-0.5 border text-rose-300 bg-rose-500/10 border-rose-500/20">
                        not posted
                      </span>
                    ) : (
                      <>
                        <span className={`text-[10px] font-semibold rounded-md px-1.5 py-0.5 border capitalize ${STATUS_CLS[r.status] ?? "text-zinc-400 bg-zinc-500/10 border-zinc-600/30"}`}>
                          {r.status}
                        </span>
                        {r.payoutStatus && r.payoutStatus !== r.status && (
                          <span className="ml-1 text-[9.5px] text-zinc-600">{r.payoutStatus}</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">
                    <span className={r.supposedPayout > 0 ? "text-amber-300" : "text-zinc-500"} title="Supposed payout = campaign reward rate × current views">
                      {fmtMoney(r.supposedPayout, r.currency)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono">
                    {(() => {
                      // Campaign + hire rows carry their paid amount inline (paidUsdc —
                      // a hire is pre-paid to the agent); content-reward rows look it up
                      // in the onchain map by reward id.
                      const oc = (isCampaign || isHire) ? (r.paidUsdc ?? 0) : (onchain[r.id]?.paid ?? 0);
                      return <span className={oc > 0 ? "text-emerald-400" : "text-zinc-600"} title={isHire ? "USDC pre-paid to the agent for this commissioned video" : "USDC actually transferred to the agent on-chain"}>{oc > 0 ? fmtUsd(oc) : "—"}</span>;
                    })()}
                  </td>
                  <td className="py-3 px-4 text-right text-zinc-500 text-[11px] whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      {timeAgo(r.submittedAt ? new Date(r.submittedAt).getTime() : null)}
                      {/* Per-row payout/inject actions need a Supabase submission id +
                          the content-rewards recalc endpoint — content-reward rows only.
                          Campaign/UGC + hire rows are display-only (own crons / pre-paid). */}
                      {!isCampaign && !isHire && (
                        <button
                          onClick={() => refreshRow(r.id)}
                          disabled={rowBusy === r.id || !accessToken}
                          title="Recalculate payout from the campaign reward rate × current views"
                          className="p-1 rounded-md border border-zinc-800 hover:border-emerald-600/60 text-zinc-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`size-3 ${rowBusy === r.id ? "animate-spin" : ""}`} />
                        </button>
                      )}
                      {!isCampaign && !isHire && onchain[r.id]?.convexId && (
                        <button
                          onClick={() => injectViews(r.id, onchain[r.id]!.convexId!)}
                          disabled={rowBusy === r.id || !accessToken}
                          title="Inject views on-chain — drives recordPerformanceTx + settleFromOracle (devnet only)"
                          className="p-1 rounded-md border border-zinc-800 hover:border-sky-600/60 text-zinc-500 hover:text-sky-400 transition-colors disabled:opacity-50"
                        >
                          <Zap className="size-3" />
                        </button>
                      )}
                    </span>
                  </td>
                </motion.tr>
              );
            })}
            {/* Sentinel — when it scrolls into view, reveal the next PAGE rows. */}
            {!loading && hasMore && (
              <tr ref={sentinelRef}>
                <td colSpan={8} className="py-6 text-center text-zinc-600 text-[11.5px]">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading more… <span className="text-zinc-700">{shown.length} of {filtered.length}</span>
                  </span>
                </td>
              </tr>
            )}
            {loading && (
              <tr><td colSpan={8} className="py-12 text-center text-zinc-700"><Loader2 className="size-5 animate-spin inline" /></td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="py-12 text-center text-zinc-700">No submissions match</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Live, minimizable sync progress bar (Convex subscription → realtime) */}
      {(() => {
        const PLABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
        // Only treat a platform as actively syncing if its progress row is BOTH
        // flagged running AND fresh. A scrape batch lasts ≤110s, so a row older than
        // 3 min is a STUCK row (the function died before writing running:false) — not
        // a live sync. Without this the phantom bar showed "Syncing views" on every
        // page open even though nothing was running (the "auto-sync on open" report).
        const SYNC_STALE_MS = 3 * 60 * 1000;
        const running = progress.filter((p) => p.running && clockNow - p.startedAt < SYNC_STALE_MS);
        const busyPlatform = busy?.startsWith("p-") ? busy.slice(2) : null;
        const allBusy = busy === "all";
        const showSynthetic = !!busyPlatform && !running.some((p) => p.platform === busyPlatform);
        // Show the progress bar ONLY for a view-sync the operator triggered THIS session
        // (Sync all / Sync <platform>). A background/cron sync, another admin's sync, or a
        // still-draining one runs SILENTLY — opening the page must never surface a sync the
        // user didn't start (that's what looked like "auto-sync on open"). The syncs still
        // run on their own via the cron + the buttons; we just don't render a phantom bar.
        const userTriggeredSync = busy === "all" || (typeof busy === "string" && busy.startsWith("p-"));
        if (!userTriggeredSync) return null;
        const totalDone = running.reduce((a, p) => a + p.done, 0);
        const totalAll = running.reduce((a, p) => a + p.total, 0);
        return (
          <div className="fixed bottom-4 right-4 z-50 w-[300px] rounded-xl border border-[#26262c] bg-[#0d0d10] shadow-2xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1b1b20]">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white">
                <Loader2 className="size-3.5 animate-spin text-emerald-400" />
                Syncing views{totalAll > 0 ? ` · ${totalDone}/${totalAll}` : ""}
              </span>
              <button onClick={() => setProgressMin((m) => !m)} className="text-zinc-500 hover:text-white" title={progressMin ? "Expand" : "Minimize"}>
                {progressMin ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            </div>
            {!progressMin && (
              <div className="px-3 py-2.5 space-y-2.5">
                {running.map((p) => {
                  const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
                  return (
                    <div key={p.platform}>
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-zinc-300 font-medium">{PLABEL[p.platform] ?? p.platform}</span>
                        <span className="text-zinc-500 font-mono">{p.done}/{p.total} · {p.updated} updated</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {showSynthetic && (
                  <div className="text-[11px] text-zinc-500 inline-flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin" /> Starting {PLABEL[busyPlatform!] ?? busyPlatform}…
                  </div>
                )}
                {allBusy && running.length === 0 && (
                  <div className="text-[11px] text-zinc-400 inline-flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin" /> Syncing all submissions…
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
