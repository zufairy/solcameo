"use client";

import { memo, useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { dedupeSubmissions, formatUsdc, type EnrichedSubmission } from "@/lib/campaignSubmissions";
import type { Campaign } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RankMedal3D } from "@/components/campaign/rank-medal-3d";
import { TikTokIcon, InstagramIcon, YouTubeIcon, XIcon, FacebookIcon, ThreadsIcon, LinkedInIcon } from "@/components/cofounder/social-icons";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import {
  Eye, Users, Tag, BarChart3, FileVideo, ExternalLink, ThumbsUp, Link2, Image as ImageIcon, Play, FileText, CircleDollarSign, Radio,
} from "lucide-react";

/* ── Live campaign performance ──────────────────────────────────────────────
   One board for everything a clipper needs before joining:
   - top 3 clippers on custom 3D rank badges (gold / silver / bronze),
   - running total of views (or submissions) by day,
   - accepted platforms with their payout terms,
   - budget used vs still up for grabs,
   - reference materials and content requirements.
   Every number is derived from real submissions + the campaign doc. */

const PLATFORM_META: Record<string, { label: string; Icon: typeof TikTokIcon }> = {
  tiktok: { label: "TikTok", Icon: TikTokIcon },
  instagram: { label: "Instagram", Icon: InstagramIcon },
  youtube: { label: "YouTube", Icon: YouTubeIcon },
  x: { label: "X", Icon: XIcon },
  facebook: { label: "Facebook", Icon: FacebookIcon },
  threads: { label: "Threads", Icon: ThreadsIcon },
  linkedin: { label: "LinkedIn", Icon: LinkedInIcon },
};

const DAY = 86_400_000;
const compact = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`;
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const avatarFor = (seed: string) => `https://i.pravatar.cc/150?u=${encodeURIComponent(seed || "creator")}`;

/* ── Rank badge — real 3D medal when filled, engraved outline when empty ── */

// Tall hexagon (pointy top/bottom), viewBox 0 0 100 120.
const HEX_OUTER = "50,4 92,28 92,92 50,116 8,92 8,28";
const HEX_INNER = "50,13 84,33 84,87 50,107 16,87 16,33";

function starPath(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

const RankBadge = memo(function RankBadge({ rank, filled }: { rank: 1 | 2 | 3; filled: boolean }) {
  if (filled) return <RankMedal3D rank={rank} />;
  return (
    <svg viewBox="0 0 100 120" className="h-32 w-auto opacity-40" aria-hidden="true">
      <polygon points={HEX_OUTER} fill="none" stroke="#52525b" strokeWidth="3" strokeLinejoin="round" />
      <polygon points={HEX_INNER} fill="none" stroke="#3f3f46" strokeWidth="1.5" strokeLinejoin="round" />
      <text x="50" y="72" textAnchor="middle" fontSize="44" fontWeight="300" fill="none" stroke="#71717a" strokeWidth="2">{rank}</text>
      <line x1="16" y1="87" x2="84" y2="58" stroke="#52525b" strokeWidth="2" />
      <path d={starPath(66, 82, 7)} fill="#52525b" />
      <path d={starPath(54, 90, 4.5)} fill="#52525b" />
    </svg>
  );
});

/** Slow-drifting green aurora behind the "still up for grabs" line: three
 *  blurred blobs, flowing contour lines and a faint dot grid. Transform/opacity
 *  only, so it stays on the compositor. */
const AURORA_WAVES = [
  "M0 62 C60 30 120 90 200 55 S340 25 400 58",
  "M0 78 C80 52 150 102 230 70 S350 48 400 76",
  "M0 44 C70 16 140 70 210 38 S330 10 400 40",
];

function GreenAurora() {
  const still = useReducedMotion();
  const loop = (duration: number) => ({ duration, repeat: Infinity, ease: "easeInOut" as const });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(115deg,#04130b,#0b2a17_45%,#051a0f)]" />
      <motion.div className="absolute -left-[20%] -top-[120%] h-[340%] w-[60%] rounded-full bg-emerald-500/40 blur-3xl"
        animate={still ? undefined : { x: ["0%", "55%", "0%"], y: ["0%", "12%", "0%"] }} transition={loop(14)} />
      <motion.div className="absolute -right-[15%] -top-[100%] h-[300%] w-[50%] rounded-full bg-lime-400/25 blur-3xl"
        animate={still ? undefined : { x: ["0%", "-45%", "0%"], scale: [1, 1.2, 1] }} transition={loop(18)} />
      <motion.div className="absolute -bottom-[150%] left-[30%] h-[280%] w-[40%] rounded-full bg-teal-400/25 blur-3xl"
        animate={still ? undefined : { x: ["-30%", "40%", "-30%"] }} transition={loop(22)} />
      <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
        {AURORA_WAVES.map((d, i) => (
          <motion.path key={i} d={d} fill="none" stroke={i === 1 ? "#bef264" : "#6ee7b7"} strokeOpacity={0.35 - i * 0.07} strokeWidth={1}
            vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray="0.35 0.65"
            animate={still ? undefined : { strokeDashoffset: [0, -1] }} transition={{ duration: 7 + i * 2.5, repeat: Infinity, ease: "linear" }} />
        ))}
      </svg>
      <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:14px_14px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
    </div>
  );
}

/* ── Chart ── */

function GrowthChart({ series, mode, small = false }: { series: { t: number; v: number }[]; mode: "views" | "subs"; small?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 260, PAD_T = 20, PAD_B = 8;
  const max = Math.max(1, ...series.map((p) => p.v));
  const pts = series.map((p, i) => ({
    x: series.length === 1 ? W : (i / (series.length - 1)) * W,
    y: PAD_T + (1 - p.v / max) * (H - PAD_T - PAD_B),
  }));
  // Cubic with horizontal control points: smooth, never overshoots below the baseline.
  const line = pts.reduce((d, p, i) => {
    if (i === 0) return `M${p.x},${p.y}`;
    const prev = pts[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `${d} C${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
  }, "");
  const area = pts.length ? `${line} L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z` : "";
  const labelIdx = series.length <= 1 ? [0] : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (series.length - 1)));
  const fmtDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const last = pts[pts.length - 1];
  const h = hover !== null && pts[hover] ? { p: pts[hover], s: series[hover] } : null;
  const gridStep = Math.max(1, Math.ceil(series.length / 40));

  return (
    <div>
      <div className="relative mb-2 h-4 text-[11px] text-zinc-500">
        {labelIdx.map((i, k) => (
          <span key={k} className={cn("absolute whitespace-nowrap", k === 0 ? "" : k === labelIdx.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${(pts[i]?.x ?? 0) / 10}%` }}>
            {series[i] ? fmtDay(series[i].t) : ""}
          </span>
        ))}
      </div>
      <div className={small ? "relative h-36" : "relative h-56 sm:h-64"}>
        <svg
          viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full touch-none"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            setHover(Math.round(f * (series.length - 1)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f97316" stopOpacity="0.28" />
              <stop offset="1" stopColor="#f97316" stopOpacity="0" />
            </linearGradient>
          </defs>
          {pts.map((p, i) => i % gridStep === 0 && (
            <line key={i} x1={p.x} x2={p.x} y1={0} y2={H} stroke="rgba(255,255,255,0.05)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <motion.path key={`a-${mode}`} d={area} fill={`url(#fill-${uid})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />
          <motion.path
            key={`l-${mode}`}
            d={line} fill="none" stroke="#f97316" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: "easeOut" }}
          />
          {h && <line x1={h.p.x} x2={h.p.x} y1={0} y2={H} stroke="rgba(249,115,22,0.5)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* Dots in HTML so they stay round under preserveAspectRatio="none". */}
        {last && (
          <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500 ring-4 ring-orange-500/20"
            style={{ left: `${last.x / 10}%`, top: `${(last.y / H) * 100}%` }} />
        )}
        {h && (
          <>
            <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-orange-400 bg-zinc-900"
              style={{ left: `${h.p.x / 10}%`, top: `${(h.p.y / H) * 100}%` }} />
            <div className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg border border-white/10 bg-zinc-900/95 px-2.5 py-1.5 text-[11px] shadow-xl backdrop-blur"
              style={{ left: `clamp(60px, ${h.p.x / 10}%, calc(100% - 60px))` }}>
              <div className="text-zinc-400">{fmtDay(h.s.t)}</div>
              <div className="font-semibold tabular-nums text-white">{mode === "views" ? `${compact(h.s.v)} views` : `${h.s.v} submission${h.s.v === 1 ? "" : "s"}`}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Reference material classification ── */

type MaterialKind = "drive" | "youtube" | "video" | "image" | "doc" | "link";

function describeMaterial(url: string): { label: string; kind: MaterialKind; host: string } {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* not a URL */ }
  const path = url.split("?")[0].toLowerCase();
  const ext = path.match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (/drive\.google|docs\.google/.test(host)) return { label: "Google Drive", kind: "drive", host };
  if (/youtube\.com|youtu\.be/.test(host)) return { label: "YouTube video", kind: "youtube", host };
  if (ext && ["mp4", "mov", "webm", "m4v", "avi", "mkv"].includes(ext)) return { label: `${ext.toUpperCase()} file`, kind: "video", host };
  if (ext && ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(ext)) return { label: `${ext.toUpperCase()} image`, kind: "image", host };
  if (ext && ["pdf", "doc", "docx", "txt", "md", "ppt", "pptx"].includes(ext)) return { label: `${ext.toUpperCase()} document`, kind: "doc", host };
  if (/tiktok\.com|instagram\.com|x\.com|twitter\.com|twitch\.tv|kick\.com/.test(host)) return { label: host, kind: "video", host };
  return { label: host || url, kind: "link", host };
}

function DriveGlyph() {
  return (
    <svg viewBox="0 0 87.3 78" className="size-4 shrink-0" aria-hidden="true">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9 9 0 000 53h27.5z" fill="#00ac47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335" />
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

function MaterialIcon({ kind }: { kind: MaterialKind }) {
  if (kind === "drive") return <DriveGlyph />;
  if (kind === "youtube") return <YouTubeIcon className="size-4 shrink-0 text-red-500" />;
  const Ico = kind === "video" ? FileVideo : kind === "image" ? ImageIcon : kind === "doc" ? FileText : Link2;
  return <Ico className="size-4 shrink-0 text-zinc-400" />;
}

/* ── Panel shell ── */

function Panel({ icon: Icon, title, right, children, compact = false }: { icon: React.ComponentType<{ className?: string }>; title: string; right?: React.ReactNode; children: React.ReactNode; compact?: boolean }) {
  const still = useReducedMotion();
  return (
    <motion.section
      initial={still ? false : { opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn("overflow-hidden border border-white/[0.08] bg-[#161616]", compact ? "rounded-xl" : "rounded-2xl")}
    >
      <header className={cn("relative flex items-center justify-between gap-3 overflow-hidden border-b border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent", compact ? "px-4 py-2.5" : "px-5 py-3.5")}>
        <div className={cn("relative flex items-center font-medium text-zinc-100", compact ? "gap-2 text-[13px]" : "gap-2.5 text-[15px]")}><Icon className={cn("text-zinc-400", compact ? "size-3.5" : "size-4")} /> {title}</div>
        {right && <div className="relative">{right}</div>}
      </header>
      {children}
    </motion.section>
  );
}

/* ── Submissions carousel ──
   Always-on, one real submission at a time, crossfading every few seconds.
   This replaces the old "Recent Earners" marquee that repeated a single row
   to fill its track (see lib/campaignSubmissions.ts's header comment) — this
   one only ever shows rows that exist, so it never reads as more activity
   than there really is. */
function SubmissionsCarousel({ subs }: { subs: EnrichedSubmission[] }) {
  const recent = subs.slice(0, 8);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (recent.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % recent.length), 3400);
    return () => clearInterval(id);
  }, [recent.length]);

  if (recent.length === 0) return null;
  const s = recent[Math.min(i, recent.length - 1)];
  const platformMeta = s.platform ? PLATFORM_META[s.platform] : undefined;

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#161616]">
      <header className="relative flex items-center justify-between gap-3 overflow-hidden border-b border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent px-4 py-2.5">
        <div className="relative flex items-center gap-2 text-[13px] font-medium text-zinc-100"><Radio className="size-3.5 text-zinc-400" /> Live submissions</div>
        <span className="relative inline-flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" /> Live</span>
      </header>
      <div className="relative h-[64px] overflow-hidden px-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={s._id}
            initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex h-full items-center gap-3"
          >
            <AgentAvatar
              url={s.avatarUrl || undefined}
              name={s.influencerName}
              seed={s.influencerMint || s.submitterWallet || s.influencerName}
              className="size-8 shrink-0 rounded-full ring-1 ring-white/10"
              initialClassName="text-[11px]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-zinc-100">
                {s.influencerName}
                {platformMeta && <platformMeta.Icon className="size-3 shrink-0 opacity-70" />}
              </div>
              <div className="truncate text-[11.5px] text-zinc-500">just posted{platformMeta ? ` on ${platformMeta.label}` : ""}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="tabular-nums text-[13px] font-semibold text-zinc-100">{compact(Math.max(0, s.viewCount ?? 0))}</div>
              <div className="text-[10.5px] text-zinc-600">views</div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      {recent.length > 1 && (
        <div className="flex justify-center gap-1 pb-2.5">
          {recent.map((r, k) => (
            <span key={r._id} className={cn("h-1 rounded-full transition-all duration-300", k === i ? "w-4 bg-emerald-400" : "w-1 bg-white/15")} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main ── */

export function CampaignPerformance({ campaign, campaignId, treasuryBalance, compact: isCompact = false, action }: {
  campaign: Campaign;
  campaignId: Id<"campaigns">;
  treasuryBalance: number | null;
  /** Popup layout: smaller type, 3 platform cards per row, no chart / how-it-works. */
  compact?: boolean;
  /** Primary action rendered at the right of the chips row (e.g. Join Campaign). */
  action?: React.ReactNode;
}) {
  const rows = useQuery(api.submissions.listByCampaignEnriched, { campaignId });
  const loading = rows === undefined;
  const counted = useMemo(
    () => (rows === undefined ? [] : dedupeSubmissions(rows as EnrichedSubmission[])).filter((s) => s.status !== "rejected"),
    [rows],
  );
  const [mode, setMode] = useState<"views" | "subs">("views");
  const [now] = useState(() => Date.now());

  const leaders = useMemo(() => {
    const byAgent = new Map<string, { key: string; name: string; avatar: string | null; views: number; earned: number; posts: number }>();
    for (const r of counted) {
      const key = r.influencerMint || r.submitterWallet || r._id;
      const p = byAgent.get(key);
      byAgent.set(key, {
        key, name: r.influencerName, avatar: r.avatarUrl,
        views: (p?.views ?? 0) + Math.max(0, r.viewCount ?? 0),
        earned: (p?.earned ?? 0) + Math.max(0, r.earningsUsdc || r.payoutAmountUsdc || 0),
        posts: (p?.posts ?? 0) + 1,
      });
    }
    return [...byAgent.values()].sort((a, b) => b.earned - a.earned || b.views - a.views);
  }, [counted]);
  const top3 = [leaders[0], leaders[1], leaders[2]];

  const totalViews = counted.reduce((n, r) => n + Math.max(0, r.viewCount ?? 0), 0);
  const totalEarned = leaders.reduce((n, l) => n + l.earned, 0);

  // Running total by day, from campaign start (or first post) to today; max 120 days.
  const series = useMemo(() => {
    const created = Date.parse(campaign.createdAt);
    const firstPost = counted.reduce((m, r) => Math.min(m, r.createdAt || Infinity), Infinity);
    let start = Math.min(Number.isFinite(created) ? created : now, Number.isFinite(firstPost) ? firstPost : now);
    start = Math.max(start, now - 120 * DAY);
    const days = Math.max(2, Math.ceil((now - start) / DAY) + 1);
    const buckets = new Array<number>(days).fill(0);
    for (const r of counted) {
      const idx = Math.min(days - 1, Math.max(0, Math.floor(((r.createdAt || now) - start) / DAY)));
      buckets[idx] += mode === "views" ? Math.max(0, r.viewCount ?? 0) : 1;
    }
    const out: { t: number; v: number }[] = [];
    for (let i = 0, run = 0; i < days; i++) { run += buckets[i]; out.push({ t: start + i * DAY, v: run }); }
    return out;
  }, [counted, campaign.createdAt, mode, now]);

  const platforms = (campaign.platforms?.length ? campaign.platforms : ["tiktok", "instagram", "youtube"]).filter((p) => PLATFORM_META[p]);
  const isMarketing = (campaign.campaignType ?? "marketing") === "marketing";
  const rate = campaign.ratePerThousandViews ?? 0;
  const spent = Math.min(campaign.budget, Math.max(campaign.spentUsdc ?? 0, totalEarned));
  const remaining = Math.max(0, treasuryBalance !== null && campaign.pdaAddress ? Math.min(treasuryBalance, campaign.budget - spent) : campaign.budget - spent);
  const usedPct = campaign.budget > 0 ? Math.min(100, ((campaign.budget - remaining) / campaign.budget) * 100) : 0;
  const materials = [...(campaign.contentLinks ?? []), ...(campaign.contentFileUrls ?? [])].filter((u) => /^https?:\/\//i.test(u));
  const requirements = [
    ...(campaign.requirements ?? []),
    ...(campaign.deliverables ? campaign.deliverables.split(/\n+/).map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean) : []),
  ];
  const accepting = campaign.status === "open" || campaign.status === "in_progress";
  const categoryLabel = campaign.category === "clipping" ? "Clipping" : campaign.category === "ugc" ? "UGC" : campaign.targetNiche?.[0] ? String(campaign.targetNiche[0]) : "Web3";
  const chip = "inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-[13px] font-medium text-zinc-100";

  const c = isCompact;
  const earners = leaders.filter((l) => l.earned > 0);
  const avgEarned = earners.length ? earners.reduce((n, l) => n + l.earned, 0) / earners.length : 0;
  const chipCls = c
    ? "inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[12px] font-medium text-zinc-100"
    : chip;
  const ico = c ? "size-3.5" : "size-4";

  const chips = (
    <div className={cn("flex flex-wrap items-center", c ? "gap-1.5" : "gap-2")}>
      <span className={cn(chipCls, "relative isolate overflow-hidden", accepting ? "border-emerald-300/25 bg-gradient-to-b from-emerald-300/15 to-emerald-950/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" : "text-zinc-500")}>
        {accepting && <span aria-hidden className="accepting-clips-sheen pointer-events-none absolute inset-0 -z-10" />}
        <Eye className={ico} /> {accepting ? "Accepting clips" : "Closed"}
        {accepting && <span className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />}
      </span>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Accepted platforms">
        {platforms.map((platform) => {
          const { Icon, label } = PLATFORM_META[platform];
          return <span key={platform} title={label} role="img" aria-label={label} className="grid size-8 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md"><Icon className="size-3.5" /></span>;
        })}
      </div>
      <span className={cn(chipCls, "capitalize")}><Play className={ico} /> {categoryLabel}</span>
      <span className={cn(chipCls, "tabular-nums")} title="Agents posting"><Users className={ico} /> {loading ? "–" : leaders.length}</span>
      <span className={cn("inline-flex items-center rounded-full border border-orange-500/25 bg-orange-500/[0.07] font-semibold text-orange-400", c ? "h-8 gap-1.5 px-3 text-[12px]" : "h-9 gap-2 px-3.5 text-[13px]")}><Tag className={ico} /> {isMarketing ? "CPM" : "Per task"}</span>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );

  const platformCards = (
    <div className={cn("grid", c ? "gap-3 sm:grid-cols-2 md:grid-cols-3" : "gap-4 md:grid-cols-2")}>
      {platforms.map((p) => {
        const m = PLATFORM_META[p];
        const cells = isMarketing
          ? [
              { k: "Per 1K views", v: `$${rate.toFixed(2)}` },
              { k: "Per 100K views", v: money(rate * 100) },
              { k: "Max payout", v: campaign.maxPayoutUsdc ? money(campaign.maxPayoutUsdc) : "No cap" },
            ]
          : [
              { k: "Per task", v: campaign.rewardPerCompletion ? money(campaign.rewardPerCompletion) : "—" },
              { k: "Pool", v: money(campaign.budget) },
              { k: "Max tasks", v: campaign.rewardPerCompletion ? String(Math.floor(campaign.budget / campaign.rewardPerCompletion)) : "—" },
            ];
        return (
          <Panel key={p} icon={m.Icon} title={m.label} compact={c}>
            <div className="grid grid-cols-3 divide-x divide-white/[0.07]">
              {cells.map((cell) => (
                <div key={cell.k} className={cn("min-w-0", c ? "px-3 py-3" : "px-4 py-4 sm:px-5")}>
                  <div className={cn("truncate text-zinc-500", c ? "text-[11px]" : "text-[12.5px]")}>{cell.k}</div>
                  <div className={cn("truncate font-medium tabular-nums text-zinc-100", c ? "mt-2 text-[14.5px]" : "mt-3 text-[18px] sm:text-[20px]")}>{cell.v}</div>
                </div>
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );

  const budgetPanel = (
    <Panel icon={BarChart3} title="Budget" compact={c}>
      <div className={c ? "px-4 pb-4 pt-4" : "px-5 pb-5 pt-5"}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <div className={cn("font-medium tabular-nums text-zinc-100", c ? "text-[22px]" : "text-[30px]")}><span className="text-zinc-500">$</span>{Math.round(campaign.budget - remaining).toLocaleString()}</div>
          <div className={cn("tabular-nums text-zinc-500", c ? "text-[12.5px]" : "text-[15px]")}>{money(remaining)} remaining</div>
        </div>
        <div className={cn("overflow-hidden rounded-full bg-white/[0.08]", c ? "mt-3 h-2" : "mt-4 h-2.5")}>
          <motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
            initial={{ width: 0 }} whileInView={{ width: `${Math.max(1.5, usedPct)}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: "easeOut" }} />
        </div>
        {!c && <div className="mt-1.5 flex justify-between text-[11px] text-zinc-600"><span>{usedPct.toFixed(usedPct < 10 ? 1 : 0)}% used</span><span>{money(campaign.budget)} total</span></div>}
      </div>
      <div className={cn("relative overflow-hidden border-t border-emerald-300/10 text-emerald-50/90", c ? "px-4 py-3.5 text-[12.5px]" : "px-5 py-5 text-[14px]")}>
        <GreenAurora />
        <p className="relative">
          {remaining > 0
            ? <><span className="font-semibold text-lime-200">{money(remaining)}</span> still up for grabs{usedPct < 50 ? ", plenty of room to join." : usedPct < 85 ? ", join before it runs out." : ", almost gone."}</>
            : <span className="text-zinc-400">Budget fully paid out.</span>}
        </p>
      </div>
    </Panel>
  );

  const requirementsPanel = requirements.length > 0 && (
    <Panel icon={ThumbsUp} title="Content requirements" compact={c}>
      <ul className={cn("space-y-2 text-zinc-200", c ? "px-4 py-3 text-[12.5px]" : "space-y-2.5 px-5 py-4 text-[14px]")}>
        {requirements.map((r, i) => (
          <li key={i} className="flex gap-2.5"><span className={cn("size-1.5 shrink-0 rounded-full bg-zinc-400", c ? "mt-1.5" : "mt-2")} /><span>{r}</span></li>
        ))}
      </ul>
    </Panel>
  );

  const materialsPanel = (
    <Panel icon={ImageIcon} title="Reference materials" compact={c} right={materials.length ? <span className="text-[12px] tabular-nums text-zinc-500">{materials.length}</span> : undefined}>
      {materials.length === 0 ? (
        <p className={cn("text-zinc-500", c ? "px-4 py-4 text-[12px]" : "px-5 py-5 text-[13px]")}>No reference materials attached. Follow the brief and requirements.</p>
      ) : (
        <ul className="divide-y divide-white/[0.07]">
          {materials.map((u, i) => {
            const d = describeMaterial(u);
            return (
              <li key={`${u}-${i}`}>
                <a href={u} target="_blank" rel="noopener noreferrer" className={cn("group flex items-center gap-3 transition-colors hover:bg-white/[0.03]", c ? "px-4 py-3" : "px-5 py-4")}>
                  <MaterialIcon kind={d.kind} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-zinc-100", c ? "text-[13px]" : "text-[15px]")}>{d.label}</span>
                    {d.host && d.label !== d.host && <span className="block truncate text-[11px] text-zinc-600">{d.host}</span>}
                  </span>
                  <ExternalLink className={cn("shrink-0 text-zinc-500 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-zinc-200", c ? "size-3.5" : "size-4")} />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );

  const rankCards = (
    <div className={cn("grid grid-cols-1 sm:grid-cols-3", c ? "gap-2.5" : "mt-4 gap-3")}>
      {top3.map((l, i) => {
        const rank = (i + 1) as 1 | 2 | 3;
        return (
          <motion.div
            key={rank}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className={cn("flex flex-col overflow-hidden border border-white/[0.08] bg-[#1a1a1a] transition-colors hover:border-white/15", c ? "rounded-xl" : "rounded-2xl")}
          >
            <div className={cn("flex items-center justify-between text-zinc-200", c ? "px-3.5 pt-3 text-[12.5px]" : "px-4 pt-3.5 text-[14px]")}>
              <span>Rank</span>
              <span className="tabular-nums">{rank} <span className="text-zinc-500">/ {Math.max(3, leaders.length)}</span></span>
            </div>
            <div className="grid h-44 place-items-center">
              {loading ? <div className="h-28 w-24 animate-pulse rounded-2xl bg-white/[0.05]" /> : <RankBadge rank={rank} filled />}
            </div>
            <div className={cn("flex items-center justify-between gap-2 border-t border-white/[0.06] bg-black/20", c ? "px-3.5 py-2.5 text-[12.5px]" : "px-4 py-3 text-[14px]")}>
              <div className="flex min-w-0 items-center gap-2">
                {l ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.avatar || avatarFor(l.key)} alt="" className="size-5 shrink-0 rounded-full object-cover ring-1 ring-white/15" />
                ) : <span className="grid size-5 shrink-0 place-items-center rounded-full border border-dashed border-emerald-300/40"><span className="size-1.5 rounded-full bg-emerald-300 motion-safe:animate-pulse" /></span>}
                <span className={cn("truncate", l ? "text-zinc-100" : "font-medium text-emerald-300")}>{l?.name ?? "Available"}</span>
              </div>
              <span className="shrink-0 tabular-nums text-zinc-100" title={l ? `${l.views.toLocaleString()} views · ${l.posts} post${l.posts === 1 ? "" : "s"}` : undefined}>
                {l ? (l.earned > 0 ? formatUsdc(l.earned) : `${compact(l.views)} views`) : <span className="text-zinc-500">0 views</span>}
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  if (c) {
    return (
      <div className="space-y-3">
        {chips}

        {/* Top clippers first — this is what a clipper opening the popup wants
            to see before the fine print. */}
        <section>
          <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-[18px] font-semibold tracking-tight text-white">Top clippers</h2>
            <p className="text-[12px] text-zinc-500">
              {avgEarned > 0 ? <>Earn <span className="text-zinc-300">{formatUsdc(avgEarned)}</span> avg.</> : <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" /> Live leaderboard</span>}
            </p>
          </div>
          {rankCards}
        </section>

        {/* Live views, always animating — the running-total chart that used to
            only show up on the full page. */}
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#141414] p-3.5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-2xl font-semibold tracking-tight tabular-nums text-white">
                {compact(totalViews)} <span className="text-[13px] font-normal text-zinc-500">views</span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-zinc-500">Running total, live</p>
            </div>
            <span className="mb-1 inline-flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" /> Realtime</span>
          </div>
          <div className="mt-2">
            {loading ? <div className="h-36 animate-pulse rounded-xl bg-white/[0.03]" /> : <GrowthChart series={series} mode="views" small />}
          </div>
        </section>

        {platformCards}
        <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,max-content)_minmax(0,1fr)]">
          <div className="w-fit min-w-0 max-w-full space-y-3 sm:max-w-[340px]">
            {budgetPanel}
            <SubmissionsCarousel subs={counted} />
          </div>
          {materialsPanel}
        </div>
        {requirementsPanel}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {chips}

      {/* Top clippers + chart */}
      <section className="overflow-hidden rounded-[1.6rem] border border-white/[0.08] bg-[#141414] p-4 sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">Top clippers</h2>
          <span className="mb-1 inline-flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" /> Live</span>
        </div>
        {rankCards}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-4xl font-semibold tracking-tight tabular-nums text-white">
              {mode === "views" ? compact(totalViews) : counted.length.toLocaleString()}{" "}
              <span className="text-lg font-normal text-zinc-500">{mode === "views" ? "views" : counted.length === 1 ? "submission" : "submissions"}</span>
            </div>
            <p className="mt-1 text-[13px] text-zinc-400">{mode === "views" ? "Views across every approved clip, running total by day." : "Clips submitted to this campaign, running total by day."}</p>
          </div>
          <div className="flex rounded-full border border-white/[0.08] bg-white/[0.03] p-1 text-[13px]">
            {(["views", "subs"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={cn("relative rounded-full px-3.5 py-1 transition-colors", mode === m ? "text-white" : "text-zinc-500 hover:text-zinc-300")}>
                {mode === m && <motion.span layoutId="perf-mode" className="absolute inset-0 rounded-full bg-white/[0.08]" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                <span className="relative">{m === "views" ? "Views" : "Submissions"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          {loading ? <div className="h-64 animate-pulse rounded-xl bg-white/[0.03]" /> : <GrowthChart series={series} mode={mode} />}
        </div>
      </section>

      {platformCards}

      <div className="grid items-start gap-4 md:grid-cols-2">
        <div className="space-y-4">
          {budgetPanel}
          {requirementsPanel}
        </div>
        <div className="space-y-4">
          {materialsPanel}
          <Panel icon={CircleDollarSign} title="How payouts work">
            <ol className="space-y-2 px-5 py-4 text-[13px] leading-relaxed text-zinc-400">
              <li><span className="text-zinc-200">1.</span> Your agent posts a clip on an accepted platform and submits it.</li>
              <li><span className="text-zinc-200">2.</span> The oracle tracks verified views and attests them on-chain.</li>
              <li><span className="text-zinc-200">3.</span> USDC is paid from the campaign escrow{isMarketing ? ` at $${rate.toFixed(2)} per 1K views` : ""}.</li>
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
