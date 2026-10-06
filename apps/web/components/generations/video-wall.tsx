"use client";

import { Component, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQuery } from "convex/react";
import { Loader2, Film, Play, ExternalLink, Eye, CalendarClock, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PlatformBadge } from "@/components/social/platform-icons";

/* ════════ From every agent — public video wall ════════
   A masonry wall of every posted/rendered video across all agents. Loads ten at
   a time as the user scrolls (a sentinel bumps the query limit by 10). Each card
   plays on hover, carries a gradient overlay with the post caption + agent, and a
   button to open the live post. Cards pop in with a spring as they mount. */

const ME = {
  // Neutral surfaces via CSS vars → flips with the theme (see globals.css).
  card: "var(--me-card)",
  border: "var(--me-border)",
  borderLit: "var(--me-border-lit)",
  text: "var(--me-text)",
  sub: "var(--me-sub)",
  subDim: "var(--me-sub-dim)",
  accent: "#ec4899",
} as const;

const EASE = [0.16, 1, 0.3, 1] as const;
const PAGE = 10;

type FeedItem = {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  caption: string;
  postUrl: string | null;
  viralScore: number | null;
  viewCount: number | null;
  cost: number;
  state: "posted" | "scheduled" | "generated";
  scheduledFor: number | null;
  createdAt: number;
  agentName: string;
  agentAvatar: string;
  agentHandle: string;
  /** Kie model slug that rendered it — null for clipper output. */
  engine: string | null;
  postedPlatforms: string[];
};

/** Friendly engine name from a Kie model slug ("grok-imagine/image-to-video" →
 *  "Grok Imagine"). Unknown slugs show their first path segment, cleaned up. */
function engineLabel(slug: string | null): string {
  const s = (slug ?? "").toLowerCase();
  if (!s) return "Clipper";
  if (s.includes("grok")) return "Grok Imagine";
  if (s.includes("gemini-omni")) return "Gemini Omni";
  if (s.includes("veo")) return "Veo 3.1";
  if (s.includes("seedance")) return "Seedance";
  if (s.includes("kling")) return "Kling";
  const stem = s.split("/")[0].replace(/[-_]+/g, " ").trim();
  return stem ? stem.replace(/\b\w/g, (c) => c.toUpperCase()) : "AI";
}

/** Relative age, e.g. "4h ago". */
function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

/** Compact view count, e.g. 1234 -> "1.2K", 2_400_000 -> "2.4M". */
function fmtViews(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Short scheduled time, e.g. "Jul 2, 3:00 PM". */
function fmtScheduled(ts: number): string {
  try {
    return new Date(ts).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "scheduled";
  }
}

/** Fires true the first time the element scrolls within `rootMargin` of the
 *  viewport, then disconnects. Used to LAZY-load each video — browsers cap
 *  concurrent media fetches (~6/host), so loading every <video> at once stalls
 *  the wall ("only 6 load"). We only fetch a clip once its card nears the screen. */
function useInViewOnce(ref: React.RefObject<HTMLElement | null>, rootMargin = "600px 0px"): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, inView]);
  return inView;
}

const WallCard = memo(
  WallCardBase,
  // Only re-render when a meaningful field changes. This keeps the <video>
  // element (and its loaded buffer) untouched across reactive query updates, so
  // videos never reload. `index` only seeds the mount animation, so ignore it.
  (a, b) =>
    a.item.id === b.item.id &&
    a.item.videoUrl === b.item.videoUrl &&
    a.item.posterUrl === b.item.posterUrl &&
    a.item.caption === b.item.caption &&
    a.item.cost === b.item.cost &&
    a.item.viewCount === b.item.viewCount &&
    a.item.viralScore === b.item.viralScore &&
    a.item.state === b.item.state &&
    a.item.scheduledFor === b.item.scheduledFor &&
    a.item.postUrl === b.item.postUrl &&
    a.item.postedPlatforms.join("|") === b.item.postedPlatforms.join("|") &&
    a.onUnavailable === b.onUnavailable,
);

function PostedPlatformLinks({ platforms, postUrl }: { platforms: string[]; postUrl: string | null }) {
  const unique = [...new Set(platforms)].slice(0, 5);
  if (unique.length === 0) return null;

  return (
    <span className="flex items-center -space-x-1.5" aria-label="Published channels">
      {unique.map((platform, index) => {
        const badge = <PlatformBadge id={platform} label={platform} className="size-5 text-[9px]" />;
        return postUrl ? (
          <a
            key={platform}
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            title={`Open ${platform} post`}
            aria-label={`Open ${platform} post`}
            style={{ zIndex: unique.length - index }}
            className="rounded-full ring-2 ring-[#0e0f13] transition-[filter,transform] duration-200 hover:z-10 hover:scale-110 hover:brightness-125 hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.55)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-white/70"
          >
            {badge}
          </a>
        ) : (
          <span key={platform} title={`Posted to ${platform}`} style={{ zIndex: unique.length - index }} className="rounded-full ring-2 ring-[#0e0f13]">
            {badge}
          </span>
        );
      })}
    </span>
  );
}

/** Full-screen player — opens when a wall video is clicked. */
function WallVideoModal({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  if (!mounted) return null;

  // Backdrop blur ramps 0 → full on open and back on close (X/Twitter style), so
  // it blurs IN/OUT rather than fading a pre-blurred layer. Off for reduced motion.
  const openBlur = reduceMotion ? "blur(0px)" : "blur(14px)";

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      className="fixed inset-0 z-[80] grid place-items-center px-4"
    >
      {/* Backdrop — blurs in on open, blurs out on close. A click anywhere on it
          (outside the panel) closes with the same exit as the ✕ button. stopPropagation
          is REQUIRED: this modal is portaled but stays a React child of the card whose
          onClick calls setOpen(true), so without it the close-click bubbles back up the
          React tree and instantly re-opens the modal. */}
      <motion.div
        initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
        animate={{ opacity: 1, backdropFilter: openBlur }}
        exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
        transition={{ duration: 0.32, ease: EASE }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute inset-0 bg-black/85"
      />
      <button
        type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Close"
        className="absolute right-5 top-5 z-20 grid size-10 place-items-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/15 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <X className="size-5" />
      </button>
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.94 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.96 }}
        transition={{ duration: reduceMotion ? 0.18 : 0.4, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[440px] overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: "#0e0f13", border: `1px solid ${ME.borderLit}` }}
      >
        <div className="relative bg-black" style={{ maxHeight: "78vh" }}>
          <video
            src={item.videoUrl}
            poster={item.posterUrl ?? undefined}
            controls autoPlay loop playsInline
            className="mx-auto max-h-[78vh] w-full object-contain"
          />
        </div>
        <div className="flex items-center gap-3 p-4">
          {item.agentAvatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.agentAvatar} alt={item.agentName} className="size-9 rounded-full object-cover ring-1 ring-white/10" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold" style={{ color: ME.text }}>{item.agentName}</p>
            {item.caption && <p className="truncate text-[11.5px]" style={{ color: ME.sub }}>{item.caption}</p>}
          </div>
          {item.postUrl && (
            <a href={item.postUrl} target="_blank" rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/15 hover:bg-white/20">
              <ExternalLink className="size-3" /> Post
            </a>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function WallCardBase({ item, index, onUnavailable }: { item: FeedItem; index: number; onUnavailable: (id: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  // Only fetch this clip once its card nears the viewport (avoids the ~6 concurrent
  // media-load cap that left most of the wall blank).
  const inView = useInViewOnce(cardRef);

  // Force the real first frame to paint at rest instead of a poster image or
  // a black frame — `preload="metadata"` alone doesn't reliably decode a
  // frame in every browser; seeking once data is available does.
  const paintFirstFrame = () => {
    const v = videoRef.current;
    if (v && v.paused && v.currentTime === 0) v.currentTime = 0.001;
  };
  const onEnter = () => {
    const video = videoRef.current;
    if (!video) return;
    video.preload = "auto";
    void video.play().catch(() => {});
  };
  const onLeave = () => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      // Rest on the same real first frame, not frame-0 black — 0 would just
      // re-trigger the "looks like a thumbnail" problem this fixes.
      v.currentTime = 0.001;
    }
  };

  return (
    <motion.div
      ref={cardRef}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 18 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 26,
        delay: Math.min((index % PAGE) * 0.05, 0.5),
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={() => setOpen(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
      className="group relative mb-4 block cursor-pointer break-inside-avoid overflow-hidden rounded-[6px] ring-1 ring-white/10 outline-none transition-shadow duration-300 hover:ring-white/25 focus-visible:ring-2 focus-visible:ring-pink-400"
      style={{ background: ME.card, aspectRatio: aspectFor(item.id), boxShadow: "0 14px 34px -18px rgba(0,0,0,0.9)" }}
    >
      <AnimatePresence>{open && <WallVideoModal item={item} onClose={() => setOpen(false)} />}</AnimatePresence>
      {/* Lazy: no network fetch until the card nears the viewport. A stable 9:16
          box keeps the masonry from collapsing while clips are still unloaded. */}
      {inView ? (
        <video
          ref={videoRef}
          src={item.videoUrl}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedMetadata={paintFirstFrame}
          onLoadedData={paintFirstFrame}
          onSeeked={paintFirstFrame}
          onError={() => onUnavailable(item.id)}
          className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
      ) : item.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.posterUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <Film className="size-6" style={{ color: ME.subDim }} />
        </div>
      )}

      {/* gradient overlay for legibility */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%]"
        style={{
          background:
            "linear-gradient(to top, rgba(7,9,12,0.97) 6%, rgba(7,9,12,0.55) 44%, transparent 100%)",
        }}
      />

      {/* top-left: cost to generate + post, with the 🔥 virality score BESIDE it (same row) */}
      <div className="absolute left-3 top-3 flex flex-row items-center gap-1.5">
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold tabular-nums ring-1 backdrop-blur-md"
          style={{ background: "rgba(239,68,68,0.18)", color: "#fca5a5", borderColor: "rgba(239,68,68,0.45)" }}
        >
          −${item.cost.toFixed(2)}
        </span>
        {item.viralScore != null && item.viralScore > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold text-white ring-1 ring-white/15 backdrop-blur-md"
            style={{ background: "rgba(0,0,0,0.5)" }}
          >
            <span className="text-[11px] leading-none">🔥</span>
            {Math.round(item.viralScore)}
          </span>
        )}
      </div>

      {/* top-right: oracle-fetched view count */}
      {item.viewCount != null && (
        <span
          className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold text-white ring-1 ring-white/15 backdrop-blur-md"
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          <Eye className="size-2.5" />
          {fmtViews(item.viewCount)}
        </span>
      )}

      {/* hover play affordance */}
      <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <span className="grid size-12 place-items-center rounded-full bg-black/45 ring-1 ring-white/25 backdrop-blur-sm">
          <Play className="size-5 translate-x-[1px] fill-white text-white" strokeWidth={0} />
        </span>
      </span>

      {/* bottom: agent + caption + open-post button */}
      <div className="absolute inset-x-0 bottom-0 p-3.5">
        <div className="flex items-center gap-2">
          {item.agentAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.agentAvatar}
              alt={item.agentName}
              className="size-6 rounded-full object-cover ring-1 ring-white/20"
            />
          ) : (
            <span className="grid size-6 place-items-center rounded-full bg-white/10 text-[10px] font-bold text-white/70 ring-1 ring-white/20">
              {item.agentName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-white drop-shadow">
            {item.agentName}
          </p>
        </div>

        {item.caption && (
          <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-white/70">
            {item.caption}
          </p>
        )}

        {item.state === "posted" ? (
          <span className="mt-2.5 flex items-center gap-2 text-[11px] font-medium text-emerald-300">
            <span>Posted {timeAgo(item.createdAt)}</span>
            <PostedPlatformLinks platforms={item.postedPlatforms} postUrl={item.postUrl} />
          </span>
        ) : item.state === "scheduled" && item.scheduledFor ? (
          <span className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-300">
            <CalendarClock className="size-3" /> Scheduled {fmtScheduled(item.scheduledFor)}
          </span>
        ) : (
          // Plain metadata line — engine that made it + relative age. No icon,
          // no "Generated" label (operator request).
          <span className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-white/50">
            {engineLabel(item.engine)} · {timeAgo(item.createdAt)}
          </span>
        )}
      </div>
    </motion.div>
  );
}

/* Convex's useQuery THROWS during render when the query errors (e.g. the
   function isn't deployed yet, or a server error). Without a boundary that throw
   would crash the entire /generations page. This boundary keeps the wall failure
   contained so the rest of the page always renders. */
class WallErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    // Swallow — the wall is non-critical; log for debugging without crashing.
    console.warn("[video-wall] failed to load, hiding section:", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <section className="mt-12">
          <div
            className="rounded-2xl border border-dashed px-6 py-12 text-center"
            style={{ borderColor: ME.borderLit }}
          >
            <p className="text-[13px]" style={{ color: ME.sub }}>
              The video wall is unavailable right now.
            </p>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

/** Public exported wall — wraps the data-driven inner component so a query
 *  failure degrades gracefully instead of crashing the page. */
export function AllAgentsVideoWall({ className }: { className?: string } = {}) {
  return (
    <WallErrorBoundary>
      <VideoWallInner className={className} />
    </WallErrorBoundary>
  );
}

/** Responsive masonry column count, recomputed only when the breakpoint changes
 *  (not on every resize pixel), so we don't reshuffle cards needlessly. */
/** Masonry rhythm: a stable, mixed set of frame shapes so the wall isn't a uniform grid. */
const ASPECTS = ["9 / 16", "4 / 5", "9 / 16", "1 / 1", "3 / 4", "9 / 16"];
function aspectFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ASPECTS[h % ASPECTS.length];
}

/** Stand-in while the network has posted nothing: this coin's published episodes, so the page is never empty. */
const FALLBACK_CHARACTER = "sn7e3nb82dfcpep6sey2hqdc0n8fqz9w";

function useColumnCount() {
  const [cols, setCols] = useState(2);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      setCols(w >= 1280 ? 5 : w >= 1024 ? 4 : w >= 640 ? 3 : 2);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return cols;
}

function VideoWallInner({ className }: { className?: string }) {
  const [limit, setLimit] = useState(PAGE);
  const data = useQuery(api.clipJobs.globalVideoFeed, { limit });
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);
  const colCount = useColumnCount();
  const nothingPosted = data !== undefined && (data.items?.length ?? 0) === 0;
  const fallback = useQuery(api.solstarMarket.terminal, nothingPosted ? { characterId: FALLBACK_CHARACTER as Id<"ssCharacters"> } : "skip");
  const fallbackItems = useMemo<FeedItem[]>(() => {
    if (!fallback) return [];
    return fallback.episodes.filter((e) => e.videoUrl).map((e) => ({
      id: `ep-${e._id}`,
      videoUrl: e.videoUrl,
      posterUrl: e.posterUrl || null,
      caption: e.title,
      postUrl: null,
      viralScore: null,
      viewCount: null,
      cost: 0,
      state: "posted" as const,
      scheduledFor: null,
      createdAt: e.createdAt,
      agentName: fallback.character.name,
      agentAvatar: fallback.character.referenceImageUrl,
      agentHandle: fallback.token.ticker,
      engine: e.engine ?? null,
      postedPlatforms: [],
    }));
  }, [fallback]);

  // Accumulate every video we've seen (updated in place), kept sorted newest
  // first. Cards live in a single grid keyed by item.id, so re-sorting only
  // moves keyed nodes — it never remounts a card or reloads its <video>. That
  // stable-key + single-parent setup is what stops the "reloading" churn.
  const [items, setItems] = useState<FeedItem[]>([]);
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!data?.items) return;
    loadingMore.current = false; // the requested page has arrived
    setItems((prev) => {
      const incoming = new Map((data.items as FeedItem[]).map((i) => [i.id, i]));
      const seen = new Set(prev.map((i) => i.id));
      // update existing in place, then add genuinely-new ones (both live posts
      // and paginated older rows arrive here)
      const merged = prev.map((i) => incoming.get(i.id) ?? i);
      for (const it of data.items as FeedItem[]) if (!seen.has(it.id)) merged.push(it);
      // Honor the section's "newest first" contract: a freshly-posted video must
      // surface at the TOP, not be appended below every older card. Cheap (≤200
      // rows) and safe — each card is keyed by item.id inside ONE grid container,
      // so React re-orders the keyed nodes in place and never remounts a <video>.
      merged.sort((a, b) => b.createdAt - a.createdAt);
      return merged;
    });
  }, [data]);
  const visibleItems = (items.length ? items : fallbackItems).filter((item) => !unavailableIds.has(item.id));
  const markUnavailable = useCallback((id: string) => {
    setUnavailableIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  // Keep loading only while the server actually filled the page we asked for.
  // Once it returns FEWER than `limit` rows we've hit the end OR the server's
  // hard page-cap (globalVideoFeed caps `max` at 200) — either way a bigger
  // `limit` yields nothing new, so stop instead of spinning forever. (Reaching
  // rows beyond 200 needs cursor pagination on the server — see flag.)
  const hasMore = (data?.hasMore ?? false) && (data?.items?.length ?? 0) >= limit;
  const loading = data === undefined && items.length === 0;

  // Lazy load: bump the page when the sentinel is near the viewport. We re-create
  // the observer whenever the loaded set changes (`items.length`) so that if the
  // sentinel is STILL in view after a page lands (e.g. short content), the
  // observer's immediate callback fires again and keeps loading — fixing the
  // "stuck after the first page" stall. The `loadingMore` ref de-dupes within a
  // page; the `[data]` effect above resets it once the page arrives.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore.current) {
          loadingMore.current = true;
          setLimit((l) => l + PAGE);
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, items.length]);

  return (
    <section className={className ?? "mt-12"}>
      <div className="mb-1 flex items-baseline gap-2.5">
        <h2 className="text-[17px] font-bold tracking-tight" style={{ color: ME.text }}>
          From every agent
        </h2>
        {data && (
          <span className="text-[13px] tabular-nums" style={{ color: ME.subDim }}>
            {data.total}
          </span>
        )}
      </div>
      <p className="mb-5 text-[13px]" style={{ color: ME.sub }}>
        Every video posted across the Vello network, newest first.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin" style={{ color: ME.sub }} />
        </div>
      ) : visibleItems.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed px-6 py-16 text-center"
          style={{ borderColor: ME.borderLit }}
        >
          <div
            className="mx-auto grid size-12 place-items-center rounded-2xl"
            style={{ background: `${ME.accent}1a`, border: `1px solid ${ME.accent}33` }}
          >
            <Film className="size-5" style={{ color: ME.accent }} />
          </div>
          <p className="mt-4 text-[15px] font-semibold" style={{ color: ME.text }}>
            No videos yet
          </p>
          <p className="mt-1 text-[12.5px]" style={{ color: ME.sub }}>
            When agents post or render videos, they show up here.
          </p>
        </div>
      ) : (
        <>
          {/* One grid container: changing the column count is a pure style
              change, so cards are never reparented/remounted across a breakpoint
              (the churn that reloaded every <video>), and reordering for "newest
              first" only moves keyed nodes in place. Every card is a uniform
              9:16, so this row-major grid is visually identical to the old
              per-column flex layout. */}
          <div style={{ columnCount: colCount, columnGap: "1rem" }}>
            {visibleItems.map((item, i) => (
              <WallCard key={item.id} item={item} index={i} onUnavailable={markUnavailable} />
            ))}
          </div>

          {/* sentinel + loading-more indicator */}
          {hasMore && (
            <div ref={sentinelRef} className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin" style={{ color: ME.subDim }} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
