"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { unionWalletAddresses } from "@/lib/solana/activeWallet";
import { AppHeaderShell } from "@/components/home/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select as ShadcnSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnalyticsShareX } from "@/components/analytics/AnalyticsShareX";
import {
  BarChart, Bar, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Eye, Film, Share2, TrendingUp, Wallet, Loader2,  RefreshCw, BarChart3, Users, Gem, Clapperboard, ExternalLink, Flame, MessageCircle, MessagesSquare, Send, Check } from "lucide-react";

type Agent = FunctionReturnType<typeof api.influencers.listByCreators>[number];
type FeedItem = FunctionReturnType<typeof api.clipJobs.videoFeedByMints>["items"][number];
type RosterAgent = FunctionReturnType<typeof api.influencers.listAll>[number];

const RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "All time", days: 0 },
] as const;

// The 4 line-chart series — 2 metrics (views / videos posted) × 2 production
// paths (UGC persona originals / repurposed clips), each its own hue so the
// legend reads as one system, not per-line arbitrary color.
const COLORS = {
  ugcViews: "#d7ff00",   // emerald
  clipViews: "#a1a1aa",  // sky
  ugcVideos: "#e4e4e7",  // amber
  clipVideos: "#9ebd39", // lime
} as const;

/** Platform identity — one fixed color + logo (simpleicons CDN, same source
 *  the /pricing page's integrations strip already uses) per platform, so a
 *  platform reads the same way everywhere on the site. "other" covers a clip
 *  posted before `platform` was tracked, or a state where it's unknown. */
const PLATFORM_META: Record<string, { label: string; color: string; slug: string | null }> = {
  tiktok: { label: "TikTok", color: "#84cc16", slug: "tiktok" },       // lime, per request
  facebook: { label: "Facebook", color: "#1877F2", slug: "facebook" }, // real FB blue
  instagram: { label: "Instagram", color: "#E1306C", slug: "instagram" },
  youtube: { label: "YouTube", color: "#FF0000", slug: "youtube" },
  x: { label: "X", color: "#e5e7eb", slug: "x" },
  other: { label: "Other", color: "rgba(255,255,255,0.25)", slug: null },
};
const PLATFORM_ORDER = ["tiktok", "instagram", "youtube", "facebook", "x", "other"] as const;
const platformKeyOf = (p: string | null | undefined) => (p && PLATFORM_META[p] ? p : "other");

const nf = (n: number) => n.toLocaleString("en-US");

function fmtDay(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type SurfaceTone = "lime" | "violet" | "sky" | "rose";
function GlassCard({ children, className = "", glow = "lime", as: Tag = "div" }: { children: React.ReactNode; className?: string; glow?: SurfaceTone; as?: "div" | "aside" }) {
  return <Card role={Tag === "aside" ? "complementary" : undefined} data-tone={glow} className={`glass3d gap-0 overflow-hidden rounded-xl py-0 text-white ring-0 ${className}`}>{children}</Card>;
}

function Kpi({ icon, label, value, sub, glow = "lime" }: { icon: React.ReactNode; label: string; value: string; sub: string; glow?: SurfaceTone }) {
  return (
    <GlassCard glow={glow} className="p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-white/45">
        <span className="grid size-5 place-items-center rounded-md border border-white/15 bg-white/[0.07] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">{icon}</span>
        {label}
      </div>
      <p className="mt-3 bg-gradient-to-b from-white to-white/70 bg-clip-text text-[24px] font-semibold tabular-nums leading-none text-transparent">{value}</p>
      <p className="mt-1.5 text-[11px] text-white/35">{sub}</p>
    </GlassCard>
  );
}

/** Ghost chart for empty ranges / brand-new accounts: the chart's shape at
 *  low opacity so the page reads as a real dashboard waiting for data. */
function EmptyChart({ height, label, cta }: { height: number; label: string; cta?: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl" style={{ height }}>
      <svg aria-hidden viewBox="0 0 400 120" preserveAspectRatio="none" className="absolute inset-0 size-full opacity-60">
        <defs>
          <linearGradient id="ghostFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(163,230,53,0.18)" />
            <stop offset="100%" stopColor="rgba(163,230,53,0)" />
          </linearGradient>
        </defs>
        {[24, 48, 72, 96].map((y) => <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 4" />)}
        <path d="M0 96 C 40 90, 70 70, 110 76 S 180 50, 220 58 S 290 30, 330 40 S 380 22, 400 26 L400 120 L0 120 Z" fill="url(#ghostFill)" />
        <path d="M0 96 C 40 90, 70 70, 110 76 S 180 50, 220 58 S 290 30, 330 40 S 380 22, 400 26" fill="none" stroke="rgba(163,230,53,0.35)" strokeWidth="1.5" strokeDasharray="5 4" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
        <p className="rounded-full border border-white/10 bg-black/30 px-3.5 py-1.5 text-[12.5px] text-white/55 backdrop-blur-md">{label}</p>
        {cta}
      </div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <ShadcnSelect value={value} onValueChange={v => { if (v !== null) onChange(v); }}><SelectTrigger className="h-8 rounded-md border-white/10 bg-white/5 text-xs text-white"><SelectValue>{options.find(o => o.value === value)?.label}</SelectValue></SelectTrigger><SelectContent className="border-white/10 bg-[#202326] text-white">{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></ShadcnSelect>;
}

/** Tooltip for the per-agent stacked-by-platform bar — lists every platform
 *  segment present in this bar (recharts hands one payload entry per <Bar>
 *  stacked at this category), skipping zero-view platforms. */
function PlatformBarTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey?: string; payload: { fullLabel?: string } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value > 0 && typeof p.dataKey === "string" && PLATFORM_META[p.dataKey]);
  const total = rows.reduce((s, p) => s + p.value, 0);
  return (
    <div className="rounded-lg border border-white/10 bg-[#0d0d10] px-3 py-2 text-[12px] shadow-xl">
      <p className="text-white/50">{payload[0].payload.fullLabel ?? label}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: PLATFORM_META[p.dataKey as string].color }} />
            <span className="text-white/60">{PLATFORM_META[p.dataKey as string].label}</span>
            <span className="ml-auto font-semibold tabular-nums text-white">{nf(p.value)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1 border-t border-white/10 pt-1 font-semibold text-white">{nf(total)} views total</p>
    </div>
  );
}

/** Custom <Bar shape> — draws the stacked segment's rect, plus the platform's
 *  logo centered inside it (only when the segment is wide/tall enough to fit
 *  a legible icon; a thin sliver just stays a plain color block). One shape
 *  fn per platform (closes over which platform this <Bar> instance is). */
function makePlatformBarShape(platformId: string) {
  return function PlatformBarShape(props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) {
    const { x = 0, y = 0, width = 0, height = 0, fill } = props;
    if (width <= 0 || height <= 0) return null;
    const meta = PLATFORM_META[platformId];
    const iconSize = Math.min(13, height - 6);
    const showIcon = meta.slug && width >= 18 && iconSize >= 8;
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={fill} />
        {showIcon && (
          <image
            href={`https://cdn.simpleicons.org/${meta.slug}/ffffff`}
            x={x + width / 2 - iconSize / 2}
            y={y + height / 2 - iconSize / 2}
            width={iconSize}
            height={iconSize}
            opacity={0.95}
          />
        )}
      </g>
    );
  };
}

/** One "Top performing posts" card — a playable clip, real view count, a
 *  button that opens the actual live post, and Vello AI's predicted virality
 *  score (0-100, the same score the clip pipeline computes when picking
 *  moments — lib/server/clipMomentSelector.ts — not a made-up number here). */
function TopPostCard({ post, rank }: { post: FeedItem; rank: number }) {
  const platformKey = post.platform ? platformKeyOf(post.platform) : null;
  const meta = platformKey ? PLATFORM_META[platformKey] : null;
  return (
    <div className="mx-auto flex w-full max-w-[200px] flex-col items-center">
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[22px] bg-black shadow-[0_20px_50px_-24px_rgba(0,0,0,0.8)]">
        <video
          src={post.videoUrl}
          poster={post.posterUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-md">
          #{rank}
        </span>
        {meta?.slug && (
          <span className="pointer-events-none absolute right-2.5 top-2.5 grid size-6 place-items-center rounded-full backdrop-blur-md" style={{ backgroundColor: meta.color }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://cdn.simpleicons.org/${meta.slug}/ffffff`} alt="" width={12} height={12} className="size-3" />
          </span>
        )}
      </div>
      <p className="mt-3 truncate text-[12.5px] text-white/45">{post.agentName}</p>
      <div className="mt-1 flex items-center gap-3">
        <span className="flex items-center gap-1 text-[13.5px] font-semibold tabular-nums text-white">
          <Eye className="size-3.5 text-white/40" strokeWidth={2} /> {nf(post.viewCount ?? 0)}
        </span>
        {typeof post.viralScore === "number" && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-orange-300" title="Vello AI's predicted virality score">
            <Flame className="size-3 shrink-0" strokeWidth={2} /> {Math.round(post.viralScore)}/100
          </span>
        )}
      </div>
      {post.postUrl && (
        <a
          href={post.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1 text-[12px] font-medium text-white/50 transition-colors hover:text-white"
        >
          Open post <ExternalLink className="size-3" strokeWidth={2} />
        </a>
      )}
    </div>
  );
}

/** Legend for the 4-series views/videos line chart — a colored dot + name per
 *  series, dashed swatch for the "videos posted" pair so the legend itself
 *  hints at which axis (solid = views/left, dashed = videos/right) a line
 *  belongs to. */
function SeriesLegend({ payload }: { payload?: { value: string; color: string; dataKey?: string }[] }) {
  if (!payload?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[11.5px]">
      {payload.map((entry) => {
        const dashed = String(entry.dataKey ?? "").toLowerCase().includes("video");
        return (
          <span key={entry.value} className="flex items-center gap-1.5 text-white/60">
            <span
              className="h-[2.5px] w-4 rounded-full"
              style={{ backgroundColor: entry.color, ...(dashed ? { backgroundImage: `repeating-linear-gradient(90deg, ${entry.color} 0 3px, transparent 3px 6px)`, backgroundColor: "transparent" } : {}) }}
            />
            {entry.value}
          </span>
        );
      })}
    </div>
  );
}

type MultiSeriesPoint = { fullLabel?: string; ugcViews: number; clipViews: number; totalViews: number; ugcVideos: number; clipVideos: number; totalVideos: number };
function MultiSeriesTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: MultiSeriesPoint }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="min-w-[168px] rounded-xl border border-white/10 bg-[#0d0d10] px-3.5 py-3 text-[12px] shadow-xl">
      <p className="text-white/50">{p.fullLabel ?? label}</p>
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-white/70"><span className="size-1.5 rounded-full" style={{ backgroundColor: COLORS.ugcViews }} />UGC views</span>
          <span className="font-semibold tabular-nums text-white">{nf(p.ugcViews)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-white/70"><span className="size-1.5 rounded-full" style={{ backgroundColor: COLORS.clipViews }} />Clips views</span>
          <span className="font-semibold tabular-nums text-white">{nf(p.clipViews)}</span>
        </div>
        <div className="my-1.5 border-t border-white/[0.08]" />
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-white/70"><span className="size-1.5 rounded-full" style={{ backgroundColor: COLORS.ugcVideos }} />UGC posted</span>
          <span className="font-semibold tabular-nums text-white">{nf(p.ugcVideos)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-white/70"><span className="size-1.5 rounded-full" style={{ backgroundColor: COLORS.clipVideos }} />Clips posted</span>
          <span className="font-semibold tabular-nums text-white">{nf(p.clipVideos)}</span>
        </div>
        <div className="my-1.5 border-t border-white/[0.08]" />
        <div className="flex items-center justify-between gap-4 font-semibold text-white">
          <span>Total views</span>
          <span className="tabular-nums">{nf(p.totalViews)}</span>
        </div>
      </div>
    </div>
  );
}

type Comment = {
  id: string;
  text: string;
  timestamp: string;
  username: string;
  platform: string;
  mintAddress: string;
  agentName: string;
  postUrl: string | null;
};

const AVATAR_COLORS = ["#3f3f46", "#52525b", "#454b42", "#343a33"];
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso || "");
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** One comment row — fallback initial avatar (no photo comes back from
 *  upload-post), platform badge, and a one-click inline reply box. The
 *  actual send/optimistic-state logic lives in the parent panel so a reply
 *  can flip this row to "Replied" without a full re-fetch. */
function CommentRow({
  comment, replying, onToggleReply, replyText, onReplyTextChange, onSend, sending, sent,
}: {
  comment: Comment;
  replying: boolean;
  onToggleReply: () => void;
  replyText: string;
  onReplyTextChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  sent: boolean;
}) {
  const meta = PLATFORM_META[platformKeyOf(comment.platform)];
  return (
    <div className="border-b border-white/[0.06] px-3.5 py-3 last:border-0">
      <div className="flex items-start gap-2.5">
        <span
          className="relative grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white"
          style={{ backgroundColor: colorFor(comment.username) }}
        >
          {comment.username.charAt(0).toUpperCase()}
          {meta?.slug && (
            <span className="absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full ring-2 ring-[#0d0d10]" style={{ backgroundColor: meta.color }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://cdn.simpleicons.org/${meta.slug}/ffffff`} alt="" width={7} height={7} className="size-[7px]" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[12.5px] font-semibold text-white">@{comment.username}</span>
            <span className="shrink-0 text-[10.5px] text-white/30">{fmtAgo(comment.timestamp)}</span>
          </div>
          <p className="mt-0.5 line-clamp-3 text-[12.5px] leading-snug text-white/65">{comment.text}</p>
          <p className="mt-1 truncate text-[10.5px] text-white/30">on {comment.agentName}</p>

          {sent ? (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-emerald-400">
              <Check className="size-3" /> Replied
            </p>
          ) : replying ? (
            <div className="mt-2 flex items-center gap-1.5">
              <Input
                autoFocus
                value={replyText}
                onChange={(e) => onReplyTextChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !sending && replyText.trim()) onSend(); }}
                placeholder="Write a reply…"
                className="h-8 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-3 text-[12px] text-white outline-none placeholder:text-white/30 focus:border-emerald-400/40"
              />
              <Button
                type="button"
                onClick={onSend}
                disabled={sending || !replyText.trim()}
                className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500 text-black transition-opacity hover:bg-emerald-400 disabled:opacity-40"
              >
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={onToggleReply}
              className="mt-1.5 text-[11px] font-medium text-white/40 transition-colors hover:text-white"
            >
              Reply
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Right-rail comments panel — latest comments across every connected
 *  platform for all of the operator's agents, one-click reply. Polls
 *  /api/social/comments every 20s (server-side short-cached) so it reads as
 *  live without hammering upload-post on every tick. */
function CommentsPanel({ getFreshToken, signedIn = true }: { getFreshToken: () => Promise<string | null>; signedIn?: boolean }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const token = await getFreshToken();
      if (!token) return;
      const res = await fetch("/api/social/comments", { headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) { setError(j.error || "Couldn't load comments"); return; }
      setConfigured(j.configured !== false);
      setComments(j.comments ?? []);
      setError(null);
    } catch {
      setError("Couldn't load comments");
    }
  }, [getFreshToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling hook; setState in a polled callback is intentional (mirrors usdcClient.ts)
    void load();
    const id = setInterval(() => { void load(); }, 20_000);
    // Re-sync when the operator comes back to this tab (e.g. switched away and
    // back) — "opening" the page shouldn't ever hand back a stale snapshot.
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const send = async (c: Comment) => {
    const message = replyText.trim();
    if (!message || sendingId) return;
    setSendingId(c.id);
    try {
      const token = await getFreshToken();
      if (!token) return;
      const res = await fetch("/api/social/comments/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mintAddress: c.mintAddress, platform: c.platform, commentId: c.id, message }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok !== false) {
        setSentIds((prev) => new Set(prev).add(c.id));
        setReplyingId(null);
        setReplyText("");
      } else {
        setError(j.error || "Reply failed");
      }
    } catch {
      setError("Reply failed");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <GlassCard glow="violet" className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
        <span className="relative grid size-6 place-items-center rounded-[8px] bg-gradient-to-b from-white/[0.22] to-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(0,0,0,0.4),0_3px_8px_-2px_rgba(0,0,0,0.6)] ring-1 ring-white/15">
          <MessagesSquare className="size-3 text-white" strokeWidth={2} />
        </span>
        <h2 className="text-[12px] font-semibold tracking-tight text-white">Comments</h2>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/60">
          <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" /><span className="relative size-1.5 rounded-full bg-emerald-400" /></span> Live
        </span>
      </div>

      {!signedIn && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <MessageCircle className="size-5 text-white/35" />
          </span>
          <p className="text-[12.5px] text-white/45">Comments from every connected platform land here — reply without leaving Vello.</p>
        </div>
      )}

      {signedIn && !configured && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-16 text-center">
          <MessageCircle className="size-6 text-white/20" />
          <p className="text-[12.5px] text-white/40">Connect a platform to see comments here.</p>
        </div>
      )}

      {signedIn && configured && comments === null && !error && (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-white/25" />
        </div>
      )}

      {signedIn && configured && error && comments === null && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-16 text-center">
          <p className="text-[12.5px] text-white/40">{error}</p>
        </div>
      )}

      {signedIn && configured && comments !== null && comments.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-16 text-center">
          <MessageCircle className="size-6 text-white/20" />
          <p className="text-[12.5px] text-white/40">No comments yet on Instagram, Facebook, YouTube, or LinkedIn posts.</p>
          <p className="text-[10.5px] text-white/25">TikTok and X don&apos;t expose a public comments API.</p>
        </div>
      )}

      {signedIn && configured && comments !== null && comments.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              replying={replyingId === c.id}
              onToggleReply={() => { setReplyingId(c.id); setReplyText(""); }}
              replyText={replyingId === c.id ? replyText : ""}
              onReplyTextChange={setReplyText}
              onSend={() => send(c)}
              sending={sendingId === c.id}
              sent={sentIds.has(c.id)}
            />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

export default function AnalyticsPage() {
  const { connected, publicKey } = useUnifiedSolanaWallet();
  const { profile, getFreshToken, login } = useSupabaseAuth();
  const address = connected && publicKey ? publicKey.toBase58() : null;
  const creatorWallets = useMemo(
    () => unionWalletAddresses(profile?.walletAddresses, address),
    [profile?.walletAddresses, address],
  );

  const agents = useQuery(
    api.influencers.listByCreators,
    creatorWallets.length ? { creatorWallets } : "skip",
  ) as Agent[] | undefined;

  const mintAddresses = useMemo(() => (agents ?? []).map((a) => a.mintAddress), [agents]);
  const feedResult = useQuery(
    api.clipJobs.videoFeedByMints,
    mintAddresses.length ? { mintAddresses } : "skip",
  ) as { items: FeedItem[] } | undefined;

  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // Determinate progress — {scanned, total} rows through the official
  // upload-post analytics API, streamed live from the server as each row
  // clears (see onProgress in lib/server/analyticsSync.ts). null = no bar.
  const [syncProgress, setSyncProgress] = useState<{ scanned: number; total: number } | null>(null);
  // Guards the background auto-poll from overlapping a manual click (or itself)
  // — a stalled upstream call must never stack a second in-flight request.
  // Holds the in-flight promise (not just a boolean) so a manual click that
  // lands mid-silent-poll can wait for it instead of silently no-op'ing —
  // previously a click during the on-mount/60s auto-poll produced zero
  // visible feedback at all, which read as "the button doesn't work."
  const syncInFlight = useRef<Promise<void> | null>(null);

  const syncViews = useCallback(async (opts?: { silent?: boolean }): Promise<void> => {
    // Flip the button to its disabled/spinning state SYNCHRONOUSLY, before any
    // await — including the in-flight wait below. Previously this only ran
    // AFTER waiting out a silent background poll (up to several seconds), so
    // a click landing mid-poll looked completely dead: no spinner, still
    // clickable, nothing until the wait finished. Re-running it on the
    // recursive call below is harmless (same values, already rendered).
    if (!opts?.silent) { setSyncing(true); setSyncNote(null); setSyncProgress(null); }
    if (syncInFlight.current) {
      if (opts?.silent) return; // background tick — never queue behind another
      await syncInFlight.current.catch(() => {});
      return syncViews(opts); // guard is clear now — run a fresh, visible sync
    }
    let release!: () => void;
    syncInFlight.current = new Promise<void>((resolve) => { release = resolve; });
    try {
      const token = await getFreshToken();
      if (!token) {
        if (!opts?.silent) setSyncNote("Sign in to sync");
        return;
      }
      // Client-side backstop — the route self-bounds to ~22s server-side, but a
      // stalled connection with no server response at all would otherwise hang
      // the button forever. 35s gives the server's own deadline room to fire
      // and return normally first.
      const doFetch = () => fetch("/api/analytics/refresh-views", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(35_000),
      });
      let res = await doFetch();
      // A 5xx here is the platform edge (Railway), not our route handler —
      // it can drop a request on a cold instance or mid-deploy. That's
      // transient, so retry once before surfacing it as a failure.
      if (!res.ok && res.status >= 500 && !opts?.silent) {
        await new Promise((r) => setTimeout(r, 1200));
        res = await doFetch();
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (!opts?.silent) setSyncNote(j.error || `Sync failed (${res.status})`);
        return;
      }

      // The route streams NDJSON — one `{type:"progress",...}` line per row
      // as it clears, then a final `{type:"done",...}` line. A body with no
      // reader (old cached response, or the plain-JSON short-circuit for "no
      // agents"/"not configured") falls back to a single parse.
      let final: { ok?: boolean; error?: string; scanned?: number; updated?: number } | null = null;
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const obj = JSON.parse(line);
            if (obj.type === "progress") {
              if (!opts?.silent) setSyncProgress({ scanned: obj.scanned, total: obj.total });
            } else {
              final = obj;
            }
          }
        }
        if (buf.trim()) { try { final = JSON.parse(buf); } catch { /* trailing partial — ignore */ } }
      } else {
        final = await res.json().catch(() => ({}));
      }

      if (opts?.silent) return; // background tick — Convex's own reactivity already reflects any change
      const j = final ?? {};
      setSyncNote(
        j.ok !== false
          ? (j.scanned ?? 0) > 0
            // Convex's viewCount is monotonic (write only on increase, see the
            // "not-newer" guard in clipJobs.recordViewCount) — 0 updated out of
            // N scanned means every one was ALREADY current (the background
            // cron got there first), not that the sync failed. Reporting it as
            // "Synced 0/N" reads as broken; say what actually happened instead.
            ? (j.updated ?? 0) > 0
              ? `Synced ${j.updated}/${j.scanned} video${j.scanned === 1 ? "" : "s"}`
              : `Up to date (checked ${j.scanned} video${j.scanned === 1 ? "" : "s"})`
            : "Nothing to sync yet"
          : j.error || "Sync failed",
      );
    } catch (e) {
      if (opts?.silent) return;
      setSyncNote(e instanceof Error && e.name === "TimeoutError" ? "Timed out, try again" : "Sync failed");
    } finally {
      syncInFlight.current = null;
      release();
      if (!opts?.silent) { setSyncing(false); setSyncProgress(null); }
    }
  }, [getFreshToken]);

  // Auto-refresh: the background cron already sweeps every ~5 min, but a
  // creator sitting on this page wants views to feel live, not dependent on a
  // manual click. Poll quietly in the background while the page is open —
  // Convex's reactive queries pick up any write immediately, so this just
  // triggers the write itself more often than the global cron would for this
  // one viewer's own agents.
  useEffect(() => {
    if (mintAddresses.length === 0) return;
    syncViews({ silent: true });
    const id = setInterval(() => syncViews({ silent: true }), 60_000);
    return () => clearInterval(id);
  }, [mintAddresses, syncViews]);

  const loading = connected && (agents === undefined || (mintAddresses.length > 0 && feedResult === undefined));
  // Signed-out visitors and brand-new accounts both get the full dashboard
  // with zeroed data + a banner for the one next step (sign in / create).
  const noAgents = !loading && (!connected || (agents?.length ?? 0) === 0);

  const scoped = useMemo(() => {
    const items = feedResult?.items ?? [];
    const since = rangeDays > 0 ? Date.now() - rangeDays * 86_400_000 : 0;
    return items.filter((v) => v.createdAt >= since && (agentFilter === "all" || v.mint === agentFilter));
  }, [feedResult, rangeDays, agentFilter]);

  const totalViews = useMemo(() => scoped.reduce((s, v) => s + (v.viewCount ?? 0), 0), [scoped]);
  const posted = useMemo(() => scoped.filter((v) => v.state === "posted"), [scoped]);
  const avgViews = posted.length ? Math.round(totalViews / posted.length) : 0;

  // mint → is-clipper, from the caller's own agent roster. Splits every
  // time-series metric into "UGC" (persona-generated originals) vs "Clips"
  // (repurposed footage) — the two production paths the platform actually has.
  const isClipperByMint = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const a of agents ?? []) m.set(a.mintAddress, a.agentType === "clipping");
    return m;
  }, [agents]);

  // Views + videos-posted by day, split UGC vs Clips — 4 series feeding the
  // dual-axis line chart. viewCount is a live snapshot (not a historical
  // growth curve), so each day's "views" bar is that day's videos' CURRENT
  // total, not a point-in-time reading.
  const byDay = useMemo(() => {
    type Bucket = { ts: number; ugcViews: number; clipViews: number; ugcVideos: number; clipVideos: number };
    const buckets = new Map<string, Bucket>();
    for (const v of scoped) {
      const d = new Date(v.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const cur = buckets.get(key) ?? { ts: dayStart, ugcViews: 0, clipViews: 0, ugcVideos: 0, clipVideos: 0 };
      const isClip = isClipperByMint.get(v.mint) ?? false;
      if (isClip) { cur.clipViews += v.viewCount ?? 0; cur.clipVideos += 1; }
      else { cur.ugcViews += v.viewCount ?? 0; cur.ugcVideos += 1; }
      buckets.set(key, cur);
    }
    return [...buckets.values()]
      .sort((a, b) => a.ts - b.ts)
      .map((b) => ({
        label: fmtDay(b.ts), fullLabel: fmtDay(b.ts),
        ugcViews: b.ugcViews, clipViews: b.clipViews,
        totalViews: b.ugcViews + b.clipViews,
        ugcVideos: b.ugcVideos, clipVideos: b.clipVideos,
        totalVideos: b.ugcVideos + b.clipVideos,
      }));
  }, [scoped, isClipperByMint]);

  // Per-agent breakdown — only meaningful when viewing "All agents". Agents
  // with zero views this range add noise, not signal — drop the row entirely
  // rather than show a name next to "0". Views are split by platform (one
  // key per PLATFORM_ORDER id) so the bar renders as a stack, not one flat color.
  const byAgent = useMemo(() => {
    if (agentFilter !== "all") return [];
    type Row = { name: string; views: number; videos: number } & Record<string, number | string>;
    const totals = new Map<string, Row>();
    for (const v of scoped) {
      const cur = totals.get(v.mint) ?? ({ name: v.agentName, views: 0, videos: 0, ...Object.fromEntries(PLATFORM_ORDER.map((p) => [p, 0])) } as Row);
      const views = v.viewCount ?? 0;
      cur.views += views;
      cur.videos += 1;
      const key = platformKeyOf(v.platform);
      cur[key] = (cur[key] as number) + views;
      totals.set(v.mint, cur);
    }
    return [...totals.values()]
      .filter((a) => a.views > 0)
      .sort((a, b) => b.views - a.views)
      .map((a) => ({ label: a.name, fullLabel: a.name, views: a.views, videos: a.videos, ...Object.fromEntries(PLATFORM_ORDER.map((p) => [p, a[p]])) }));
  }, [scoped, agentFilter]);

  // Which platforms actually have views in this scope — drives both the
  // legend and which <Bar> series get rendered (no empty-platform clutter).
  const activePlatforms = useMemo(
    () => PLATFORM_ORDER.filter((p) => byAgent.some((r) => ((r as unknown as Record<string, number>)[p] ?? 0) > 0)),
    [byAgent],
  );

  // Top 4 performing posts (by view count) in the current scope — playable
  // clips, real view counts, and Vello AI's predicted virality score.
  const topPosts = useMemo(() => {
    return [...posted]
      .filter((v) => (v.viewCount ?? 0) > 0)
      .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
      .slice(0, 4);
  }, [posted]);

  const agentOptions = [
    { value: "all", label: "All agents" },
    ...(agents ?? []).map((a) => ({ value: a.mintAddress, label: a.name })),
  ];

  const reportData = useMemo(() => {
    const selectedAgent = agentFilter === "all" ? null : (agents ?? []).find((agent) => agent.mintAddress === agentFilter);
    const singleAgentRows = selectedAgent ? [{ label: selectedAgent.name, views: totalViews, videos: scoped.length }] : [];
    return {
      scopeLabel: selectedAgent?.name ?? "All agents",
      periodLabel: RANGES.find((range) => range.days === rangeDays)?.label ?? "Selected period",
      totalViews,
      videosGenerated: scoped.length,
      videosPosted: posted.length,
      avgViewsPerPost: avgViews,
      postingRate: scoped.length ? (posted.length / scoped.length) * 100 : 0,
      agentCount: selectedAgent ? 1 : (agents?.length ?? 0),
      daily: byDay.map((day) => ({ label: day.label, totalViews: day.totalViews, totalVideos: day.totalVideos })),
      agents: agentFilter === "all" ? byAgent.map((agent) => ({ label: agent.label, views: agent.views, videos: agent.videos })) : singleAgentRows,
      topPosts: topPosts.map((post) => ({
        agentName: post.agentName,
        platform: PLATFORM_META[platformKeyOf(post.platform)].label,
        views: post.viewCount ?? 0,
        virality: typeof post.viralScore === "number" ? post.viralScore : undefined,
      })),
    };
  }, [agentFilter, agents, rangeDays, totalViews, scoped.length, posted.length, avgViews, byDay, byAgent, topPosts]);

  // ── Related agents (below-the-fold discovery cards) ──────────────────────
  // Public roster — used only to pick a handful of OTHER creators' agents to
  // showcase for reference; never joined into the user's own metrics above.
  const roster = useQuery(api.influencers.listAll, {}) as RosterAgent[] | undefined;
  const relatedMints = useMemo(() => {
    if (!roster) return [];
    const ownMints = new Set(mintAddresses);
    const ownNiches = new Set((agents ?? []).map((a) => a.niche));
    const candidates = roster.filter((r) => !ownMints.has(r.mintAddress) && !!r.avatarUrl);
    // Same niche as one of the operator's own agents ranks first — "related",
    // not just "other" — then top up with anything else so the section still
    // shows a useful minimum even for a brand-new niche with few peers.
    const inNiche = candidates.filter((r) => ownNiches.has(r.niche));
    const rest = candidates.filter((r) => !ownNiches.has(r.niche));
    return [...inNiche, ...rest].slice(0, 6).map((r) => r.mintAddress);
  }, [roster, mintAddresses, agents]);

  const relatedFeed = useQuery(
    api.clipJobs.videoFeedByMints,
    relatedMints.length ? { mintAddresses: relatedMints } : "skip",
  ) as { items: FeedItem[] } | undefined;

  const relatedAgents = useMemo(() => {
    if (!roster) return [];
    const rosterByMint = new Map(roster.map((r) => [r.mintAddress, r]));
    const stats = new Map<string, { views: number; videos: number }>();
    for (const item of relatedFeed?.items ?? []) {
      const cur = stats.get(item.mint) ?? { views: 0, videos: 0 };
      cur.views += item.viewCount ?? 0;
      cur.videos += 1;
      stats.set(item.mint, cur);
    }
    return relatedMints
      .map((mint) => {
        const r = rosterByMint.get(mint);
        if (!r) return null;
        const s = stats.get(mint) ?? { views: 0, videos: 0 };
        return { mintAddress: mint, name: r.name, handle: r.handle, avatarUrl: r.avatarUrl, isClipper: r.agentType === "clipping", views: s.views, videos: s.videos };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [roster, relatedMints, relatedFeed]);

  return (
    <AppHeaderShell>
      <div className="relative isolate min-h-full overflow-hidden bg-[#181a1c] text-white">
        <div className="mx-auto flex max-w-[1440px] items-start gap-6 px-4 pt-4 pb-12 sm:px-6">
        <div className="min-w-0 flex-1">
          {/* ── Header ── */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white">
                <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                  <BarChart3 className="size-4.5 text-white/80" strokeWidth={1.75} />
                </span>
                Analytics
              </h1>
            </div>
            {!loading && (
              <div className={`flex items-center gap-2 ${noAgents ? "pointer-events-none opacity-40" : ""}`} aria-disabled={noAgents}>
                <Select value={agentFilter} onChange={setAgentFilter} options={agentOptions} />
                <Select
                  value={String(rangeDays)}
                  onChange={(v) => setRangeDays(Number(v))}
                  options={RANGES.map((r) => ({ value: String(r.days), label: r.label }))}
                />
                <Button
                  type="button"
                  onClick={() => syncViews()}
                  disabled={syncing}
                  title="Sync view counts from the platforms"
                  className="flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-[13px] font-medium text-white backdrop-blur-xl transition-colors hover:bg-white/[0.08] disabled:opacity-50"
                >
                  <RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing…" : "Refresh"}
                </Button>
                <AnalyticsShareX data={reportData} disabled={noAgents || syncing} />
              </div>
            )}
          </div>
          {syncing && (
            <div className="mt-3 flex items-center justify-end gap-2.5">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-[width] duration-300 ease-out"
                  style={{
                    width: syncProgress && syncProgress.total > 0
                      ? `${Math.min(100, Math.round((syncProgress.scanned / syncProgress.total) * 100))}%`
                      // No total yet (due-lists still resolving) — show a
                      // small sliver so the bar isn't empty/dead-looking.
                      : "8%",
                  }}
                />
              </div>
              <p className="whitespace-nowrap text-[11.5px] tabular-nums text-white/45">
                {syncProgress && syncProgress.total > 0
                  ? `${syncProgress.scanned}/${syncProgress.total}`
                  : "Starting…"}
              </p>
            </div>
          )}
          {!syncing && syncNote && <p className="mt-2 text-right text-[11.5px] text-white/40">{syncNote}</p>}

          {loading && (
            <div className="flex items-center justify-center py-32">
              <Loader2 className="size-5 animate-spin text-white/30" />
            </div>
          )}

          {!loading && (
            <>
              {/* ── No agents yet: same dashboard, zeroed, with the way in ── */}
              {noAgents && (
                <GlassCard glow="lime" className="mt-8 p-5 sm:p-6">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="max-w-md">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/80">{connected ? "Get started" : "Preview"}</p>
                      <h2 className="mt-1.5 text-[18px] font-semibold text-white">{connected ? "Your analytics light up once an agent posts" : "Sign in to see your agents' analytics"}</h2>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">Create an agent and every view, post and comment across TikTok, Instagram and YouTube lands here automatically.</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {!connected ? (
                        <Button type="button" onClick={() => login()} className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-semibold text-zinc-950 shadow-[0_10px_30px_-12px_rgba(255,255,255,0.5)] transition-transform hover:-translate-y-0.5">
                          <Wallet className="size-4" /> Sign in
                        </Button>
                      ) : (
                        <>
                          <Link href="/builder?type=clipping" className="inline-flex h-10 items-center gap-2 rounded-full bg-[#d7ff00] px-4 text-[13px] font-semibold text-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_30px_-10px_rgba(0,0,0,0.3)] transition-transform hover:-translate-y-0.5">
                            <Clapperboard className="size-4" /> New AI Clipper
                          </Link>
                          <Link href="/studio/build" className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-4 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-xl transition-colors hover:bg-white/[0.12]">
                            <Gem className="size-4" /> New AI Influencer
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </GlassCard>
              )}

              {/* ── KPIs ── */}
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi glow="lime" icon={<Eye className="size-3" />} label="Total views" value={nf(totalViews)} sub={agentFilter === "all" ? "All agents" : "Selected agent"} />
                <Kpi glow="sky" icon={<Film className="size-3" />} label="Videos" value={nf(scoped.length)} sub="Generated in range" />
                <Kpi glow="violet" icon={<Share2 className="size-3" />} label="Posted" value={nf(posted.length)} sub="Live on a platform" />
                <Kpi glow="rose" icon={<TrendingUp className="size-3" />} label="Avg views / post" value={nf(avgViews)} sub="Posted videos only" />
              </div>

              {/* ── Views over time — Shopify-style dual-axis line chart ── */}
              <motion.div
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="mt-6"
              >
              <GlassCard glow="lime" className="p-5">
                <h2 className="text-[13.5px] font-semibold text-white">Views &amp; videos posted</h2>
                <p className="mt-0.5 text-[11.5px] text-white/35">Views are a live snapshot, summed by the day each video went out, split by production path.</p>
                <div className="mt-4">
                  {byDay.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <ComposedChart data={byDay} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                        <defs>
                          <linearGradient id="ugcViewsFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COLORS.ugcViews} stopOpacity={0.22} />
                            <stop offset="100%" stopColor={COLORS.ugcViews} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="clipViewsFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COLORS.clipViews} stopOpacity={0.18} />
                            <stop offset="100%" stopColor={COLORS.clipViews} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={20} />
                        <YAxis
                          yAxisId="views" allowDecimals={false}
                          tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} width={44}
                        />
                        <YAxis
                          yAxisId="videos" orientation="right" allowDecimals={false}
                          tick={{ fill: "rgba(255,255,255,0.28)", fontSize: 11 }} axisLine={false} tickLine={false} width={30}
                        />
                        <Tooltip cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }} content={<MultiSeriesTooltip />} />
                        <Legend content={<SeriesLegend />} />
                        <Area yAxisId="views" type="monotone" dataKey="ugcViews" name="UGC views" stroke={COLORS.ugcViews} strokeWidth={2.5} fill="url(#ugcViewsFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                        <Area yAxisId="views" type="monotone" dataKey="clipViews" name="Clips views" stroke={COLORS.clipViews} strokeWidth={2.5} fill="url(#clipViewsFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive animationDuration={1100} animationEasing="ease-out" animationBegin={100} />
                        <Line yAxisId="videos" type="monotone" dataKey="ugcVideos" name="UGC videos posted" stroke={COLORS.ugcVideos} strokeWidth={1.75} strokeDasharray="4 3" dot={false} activeDot={{ r: 3.5 }} isAnimationActive animationDuration={1100} animationEasing="ease-out" animationBegin={200} />
                        <Line yAxisId="videos" type="monotone" dataKey="clipVideos" name="Clips videos posted" stroke={COLORS.clipVideos} strokeWidth={1.75} strokeDasharray="4 3" dot={false} activeDot={{ r: 3.5 }} isAnimationActive animationDuration={1100} animationEasing="ease-out" animationBegin={300} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChart height={300} label={noAgents ? "Views appear here once your first agent posts." : "No videos in this range yet."} />
                  )}
                </div>
              </GlassCard>
              </motion.div>

              {/* ── Per-agent breakdown, stacked by platform ── */}
              {agentFilter === "all" && (
                <GlassCard glow="violet" className="mt-6 p-5">
                  <h2 className="text-[13.5px] font-semibold text-white">Views by agent</h2>
                  <p className="mt-0.5 text-[11.5px] text-white/35">Select an agent above to drill into just their videos. Each bar splits by platform.</p>
                  <div className="mt-4">
                    {byAgent.length > 0 ? (
                      <>
                        {/* Platform legend — icon + name + color, only platforms actually present. */}
                        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                          {activePlatforms.map((p) => {
                            const meta = PLATFORM_META[p];
                            return (
                              <span key={p} className="flex items-center gap-1.5 text-[11.5px] text-white/50">
                                <span className="grid size-4 place-items-center rounded-full" style={{ backgroundColor: meta.color }}>
                                  {meta.slug && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={`https://cdn.simpleicons.org/${meta.slug}/ffffff`} alt="" width={10} height={10} className="size-2.5" />
                                  )}
                                </span>
                                {meta.label}
                              </span>
                            );
                          })}
                        </div>

                        <ResponsiveContainer width="100%" height={Math.max(120, byAgent.length * 44)}>
                          <BarChart data={byAgent} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                            <XAxis type="number" allowDecimals={false} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis
                              type="category"
                              dataKey="label"
                              tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 12 }}
                              axisLine={false}
                              tickLine={false}
                              width={120}
                            />
                            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<PlatformBarTooltip />} />
                            {activePlatforms.map((p) => (
                              <Bar
                                key={p}
                                dataKey={p}
                                stackId="views"
                                fill={PLATFORM_META[p].color}
                                maxBarSize={22}
                                shape={makePlatformBarShape(p)}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>

                        {/* Text table — same numbers, for screen readers / at-a-glance scan. */}
                        <div className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
                          {byAgent.map((row) => (
                            <div key={row.label} className="flex items-center justify-between py-2 text-[12.5px]">
                              <span className="text-white/70">{row.label}</span>
                              <span className="flex items-center gap-3 text-white/40">
                                <span>{row.videos} video{row.videos === 1 ? "" : "s"}</span>
                                <span className="font-semibold tabular-nums text-white">{nf(row.views)} views</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <EmptyChart height={140} label={noAgents ? "Each agent gets a bar here, split by platform." : "No videos in this range yet."} />
                    )}
                  </div>
                </GlassCard>
              )}

              {/* ── Top 4 performing posts, one row ── */}
              {topPosts.length > 0 && (
                <div className="mt-10">
                  <h2 className="text-center text-[13.5px] font-semibold text-white">Top performing posts</h2>
                  <p className="mt-0.5 text-center text-[11.5px] text-white/35">Your best videos this range, ranked by real view count.</p>
                  <div className="mx-auto mt-6 grid max-w-4xl grid-cols-2 gap-6 sm:grid-cols-4">
                    {topPosts.map((post, i) => (
                      <TopPostCard key={post.id} post={post} rank={i + 1} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Related agents — discovery cards, min 3, click opens the
                 public agent page ── */}
          {connected && relatedAgents.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }} className="mt-10">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-white/40" />
                <h2 className="text-[14px] font-semibold text-white">Other agents you might like</h2>
              </div>
              <p className="mt-0.5 text-[11.5px] text-white/35">For reference, see how other creators&apos; agents are performing.</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
                {relatedAgents.map((a, i) => (
                  <motion.div key={a.mintAddress} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.14 + i * 0.06 }}>
                    <Link
                      href={`/market/${a.mintAddress}`}
                      className="glass3d group relative flex aspect-square flex-col overflow-hidden rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_24px_50px_-20px_rgba(0,0,0,0.25)]"
                    >
                      <div className="relative flex-1 overflow-hidden bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.avatarUrl} alt={a.name} className="size-full object-cover object-top transition-transform duration-200 group-hover:scale-105" />
                        <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-lg border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.06] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_3px_8px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                          {a.isClipper ? <Clapperboard className="size-3" /> : <Gem className="size-3" />}
                        </span>
                      </div>
                      <div className="p-2.5">
                        <p className="truncate text-[12.5px] font-medium text-white">{a.name}</p>
                        <p className="truncate text-[10.5px] text-white/35">@{a.handle}</p>
                        <div className="mt-1 flex items-center gap-2.5 text-[10.5px] text-white/45">
                          <span className="flex items-center gap-1"><Eye className="size-3" />{nf(a.views)}</span>
                          <span className="flex items-center gap-1"><Film className="size-3" />{nf(a.videos)}</span>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[20%] min-w-[300px] shrink-0 lg:block">
          <CommentsPanel getFreshToken={getFreshToken} signedIn={connected} />
        </aside>
        </div>
      </div>
    </AppHeaderShell>
  );
}
