"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppHeaderShell } from "@/components/home/app-shell";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { PlatformIcon } from "@/components/ui/content-reward-card";
import { TopUpModal } from "@/components/billing/TopUpModal";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import {
  Users, Link as LinkIcon, ImagePlus, Loader2, X, Sparkles, Rocket, Zap,
  CalendarClock, Clapperboard, XCircle, RotateCcw, Library,
  PenLine, Wand2, Send, Play, Plus,
} from "lucide-react";

// Rough estimate only — real cost is priced per-render server-side after
// matching. Keeps the slider "felt cost" in the same ballpark as an average
// swarm clip so the number isn't wildly off.
const CREDITS_PER_VIDEO_ESTIMATE = 8;

/* ════════ /swarm — Content Swarm ════════
   One product brief → AI casts the best-matching influencer agents from the
   live roster and fires 1-100 UNIQUE persona videos across them in one shot.
   Every task is stamped sessionId `swarm:<privy user id>`, so the library at
   the bottom is the user's permanent, cross-device swarm history. */

const MAX_PER_AGENT_PER_DAY = 3;

// Deep near-black canvas with two faint radial brand glows.
const BG: React.CSSProperties = {
  background:
    "radial-gradient(90% 60% at 15% -10%, rgba(163,230,53,0.06), transparent 60%), " +
    "radial-gradient(80% 50% at 110% 110%, rgba(163,230,53,0.04), transparent 55%), " +
    "#08080a",
};

const blurIn = (delay = 0) => ({
  initial: { opacity: 0, y: 12, filter: "blur(12px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] as const },
});

// Industry-grade primary: white gradient plate, inset top highlight, soft glow,
// lift on hover, press on click.
const PRIMARY_BTN =
  "group inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-white to-white/85 " +
  "px-6 py-3 text-[13.5px] font-semibold text-black " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_30px_-10px_rgba(255,255,255,0.35),0_2px_6px_rgba(0,0,0,0.4)] " +
  "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_40px_-12px_rgba(255,255,255,0.45),0_2px_6px_rgba(0,0,0,0.4)] " +
  "active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0";

// Frosted-glass secondary.
const GHOST_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 " +
  "bg-gradient-to-b from-white/[0.12] to-white/[0.05] px-3.5 py-2 text-[12.5px] font-medium text-white/80 " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-xl transition-all duration-200 " +
  "hover:-translate-y-px hover:bg-white/15 hover:text-white active:translate-y-0 active:scale-[0.98]";

const CARD =
  "rounded-[1.6rem] border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5 " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_30px_70px_-45px_rgba(0,0,0,0.9)]";

type CastAgent = {
  mintAddress: string; name: string; handle: string; avatarUrl: string;
  niche: string; archetype: string; language: string; reason: string;
  connectedPlatforms?: string[];
};
type PlanItem = { mintAddress: string; topic: string };
type Stage = "brief" | "matching" | "plan" | "running";
type SwarmHistoryRow = {
  _id: Id<"agentTasks">; _creationTime: number; title: string; status: string;
  mintAddress: string; videoUrl?: string; posterUrl?: string; error?: string;
  agentName?: string; agentHandle?: string; agentAvatarUrl?: string; connectedPlatforms?: string[];
};

/** What the fullscreen video modal needs — assembled from a running-stage card
 *  (cast + generationStatus) or a library card (listSwarmBySession's join). */
type ViewingVideo = {
  videoUrl: string;
  posterUrl?: string;
  title: string;
  agentName: string;
  agentHandle?: string;
  agentAvatarUrl?: string;
  time: number;
  platforms: string[];
};

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Stacked, ring-separated platform icon row — same visual pattern as the
 *  /home connected-accounts overlay. */
function PlatformStack({ platforms }: { platforms: string[] }) {
  if (platforms.length === 0) return null;
  return (
    <span className="flex shrink-0 -space-x-1.5">
      {platforms.slice(0, 4).map((p) => (
        <span key={p} className="rounded-[6px] ring-2 ring-[#0d0d10]" title={p}>
          <PlatformIcon platform={p} />
        </span>
      ))}
    </span>
  );
}

const MATCH_STEPS = [
  "Analyzing your product…",
  "Scanning the influencer roster…",
  "Matching personas to your audience…",
  "Writing one unique brief per video…",
];

/** The user's saved swarm generations (Convex, cross-device). Own component so
 *  its query lives inside an ErrorBoundary — see the render site. */
function SwarmLibrary({ sessionId, excludeIds, onOpen }: { sessionId: string; excludeIds: string[]; onOpen: (v: ViewingVideo) => void }) {
  const library = useQuery(api.agentTasks.listSwarmBySession, { sessionId }) as SwarmHistoryRow[] | undefined;
  const rows = useMemo(() => {
    const active = new Set(excludeIds);
    return (library ?? []).filter((r) => !active.has(r._id as string));
  }, [library, excludeIds]);
  if (rows.length === 0) return null;
  return (
    <motion.div {...blurIn(0.15)} className="mt-10">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-white/40">
        <Library className="size-3.5" /> Your swarm library
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
        {rows.map((r, i) => (
          <motion.div key={r._id} {...blurIn(0.18 + Math.min(i, 10) * 0.04)} whileHover={{ y: -2 }}
            onClick={() => r.videoUrl && onOpen({
              videoUrl: r.videoUrl, posterUrl: r.posterUrl, title: r.title,
              agentName: r.agentName ?? "Agent", agentHandle: r.agentHandle, agentAvatarUrl: r.agentAvatarUrl,
              time: r._creationTime, platforms: r.connectedPlatforms ?? [],
            })}
            className={`group overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:border-white/20 ${r.videoUrl ? "cursor-pointer" : ""}`}>
            <div className="relative flex aspect-video items-center justify-center bg-black/40">
              {r.videoUrl ? (
                <>
                  <video src={r.videoUrl} preload="metadata" muted loop playsInline poster={r.posterUrl} className="size-full object-cover" />
                  <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
                    <Play className="size-7 fill-white text-white opacity-0 drop-shadow-lg transition-opacity group-hover:opacity-100" />
                  </span>
                </>
              ) : r.status === "failed" ? (
                <XCircle className="size-5 text-red-400" />
              ) : (
                <>
                  <motion.span
                    className="absolute inset-0"
                    style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.05) 50%, transparent 65%)", backgroundSize: "220% 100%" }}
                    animate={{ backgroundPosition: ["130% 0%", "-130% 0%"] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                  />
                  <Loader2 className="size-4 animate-spin text-white/25" />
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-2">
              {r.agentAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.agentAvatarUrl} alt="" className="size-5 shrink-0 rounded-full object-cover ring-1 ring-white/15" />
              ) : (
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-bold text-white/50">
                  {(r.agentName ?? "?").charAt(0)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10.5px] font-medium text-white/70" title={r.title}>{r.agentName ?? "Agent"}</p>
                <p className="text-[9px] text-white/30">{timeAgo(r._creationTime)}</p>
              </div>
              <PlatformStack platforms={r.connectedPlatforms ?? []} />
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

/** Fullscreen video viewer — agent identity, post time, and which connected
 *  platforms it's posted to, alongside the playable video. */
function VideoModal({ v, onClose }: { v: ViewingVideo; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md sm:p-8"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[420px] flex-col overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#0c0c0e] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
      >
        <div className="relative flex max-h-[75vh] items-center justify-center bg-black">
          <video src={v.videoUrl} poster={v.posterUrl} controls autoPlay playsInline className="max-h-[75vh] w-full object-contain" />
          <button type="button" onClick={onClose}
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-white/15 bg-black/50 text-white/80 backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 p-4">
          {v.agentAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.agentAvatarUrl} alt="" className="size-11 shrink-0 rounded-2xl object-cover ring-1 ring-white/15" />
          ) : (
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10 text-[15px] font-bold text-white/60">
              {v.agentName.charAt(0)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[14px] font-semibold text-white">{v.agentName}</p>
              {v.agentHandle && <span className="truncate text-[11px] text-white/35">@{v.agentHandle.replace(/^@+/, "")}</span>}
            </div>
            <p className="truncate text-[11px] text-white/40">{timeAgo(v.time)} · {v.title.replace(/^Swarm: /, "")}</p>
          </div>
          <PlatformStack platforms={v.platforms} />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Springy count-up number for stat tiles. */
function StatNumber({ value }: { value: number | string }) {
  return (
    <motion.p
      key={String(value)}
      initial={{ scale: 1.3, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 20 }}
      className="mt-1.5 text-[24px] font-black tabular-nums text-white"
    >
      {value}
    </motion.p>
  );
}

const HOW_IT_WORKS = [
  { Icon: PenLine, title: "Brief", body: "Describe the product (or drop a link/photo)" },
  { Icon: Wand2, title: "Match", body: "AI casts the best-fit personas from the roster" },
  { Icon: Send, title: "Launch", body: "Every agent posts its own unique take" },
];

/** Compact credit balance readout for the header row — icon, live balance,
 *  and a + button opening the shared TopUpModal. Same balance source as
 *  CreditsBadge, styled to match this page's frosted-glass language. */
function CreditsPill({ ownerWallet }: { ownerWallet: string | null }) {
  const [topUpOpen, setTopUpOpen] = useState(false);
  const balance = useQuery(api.userCredits.getBalance, ownerWallet ? { ownerWallet } : "skip");
  const credits = balance === undefined ? null : (balance?.balanceCredits ?? 0);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] py-2 pl-3.5 pr-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-lime-400/25 bg-lime-400/10 text-lime-300">
          <Zap className="size-3.5" strokeWidth={2} />
        </span>
        <div className="leading-tight">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-white/35">Credits</p>
          {credits === null ? (
            <span className="mt-0.5 inline-block h-4 w-12 animate-pulse rounded bg-white/[0.12]" aria-hidden />
          ) : (
            <p className="text-[15px] font-black tabular-nums text-white">{credits.toLocaleString()}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setTopUpOpen(true)}
          title="Add credits"
          className="ml-1 grid size-7 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-white/70 transition-colors hover:bg-white/15 hover:text-white"
        >
          <Plus className="size-3.5" strokeWidth={2.25} />
        </button>
      </div>
      <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </>
  );
}

/** Floating side panel — live roster stat + a compact "how it works" strip.
 *  Sits beside the brief card on wide screens; hidden on mobile/tablet. */
function SwarmSidePanel({ agentsAvailable, agentAvatars }: { agentsAvailable: number | null; agentAvatars: string[] }) {
  return (
    <motion.aside {...blurIn(0.12)} className="hidden w-[240px] shrink-0 lg:block">
      <div className="sticky top-6 space-y-3">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_20px_45px_-30px_rgba(0,0,0,0.9)]">
          <div className="flex items-center gap-2 text-white/40">
            <Users className="size-3.5" />
            <span className="text-[10.5px] font-semibold uppercase tracking-wide">Agents available</span>
          </div>
          <p className="mt-1 text-[26px] font-black tabular-nums text-white">
            {agentsAvailable === null ? <Loader2 className="size-5 animate-spin text-white/25" /> : agentsAvailable}
          </p>
          <p className="mt-0.5 text-[10.5px] text-white/35">in the live roster, ready to cast</p>
          {agentAvatars.length > 0 && (
            <div className="mt-3 flex items-center -space-x-2.5">
              {agentAvatars.slice(0, 7).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src + i} src={src} alt="" className="size-7 shrink-0 rounded-full object-cover ring-2 ring-[#0d0d10]" />
              ))}
              {agentsAvailable !== null && agentsAvailable > 7 && (
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-bold text-white/60 ring-2 ring-[#0d0d10]">
                  +{agentsAvailable - 7}
                </span>
              )}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3">
            <div>
              <p className="text-[13px] font-bold tabular-nums text-white/85">100</p>
              <p className="text-[9.5px] uppercase tracking-wide text-white/30">Max videos</p>
            </div>
            <div>
              <p className="text-[13px] font-bold tabular-nums text-white/85">{MAX_PER_AGENT_PER_DAY}/day</p>
              <p className="text-[9.5px] uppercase tracking-wide text-white/30">Per agent cap</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/40">How it works</span>
          <div className="mt-3 space-y-3">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={s.title} className="flex gap-2.5">
                <div className="flex shrink-0 flex-col items-center">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-lime-400/25 bg-lime-400/[0.08] text-lime-300">
                    <s.Icon className="size-3" />
                  </span>
                  {i < HOW_IT_WORKS.length - 1 && <span className="mt-1 w-px flex-1 bg-white/[0.08]" />}
                </div>
                <div className="pb-1">
                  <p className="text-[12px] font-semibold text-white/85">{s.title}</p>
                  <p className="text-[10.5px] leading-snug text-white/40">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.aside>
  );
}

export default function SwarmPage() {
  const { user } = usePrivy();
  const swarmSessionId = user?.id ? `swarm:${user.id}` : null;
  const { connected, publicKey } = useUnifiedSolanaWallet();
  const ownerWallet = connected && publicKey ? publicKey.toBase58() : null;

  const [stage, setStage] = useState<Stage>("brief");
  const [prompt, setPrompt] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  // Link mode (mirrors Recreate/Carousel): what the link IS decides how the
  // server turns it into a KIE visual reference — web = site screenshot,
  // app = store screenshots (or phone-frame capture), product = crawled
  // product photo (vision-picked).
  const [linkMode, setLinkMode] = useState<"web" | "app" | "product">("web");
  // Reference resolved by /plan (screenshot / crawled product shot) — passed
  // to /launch so the storyboard + every clip render receives it.
  const [resolvedRefUrl, setResolvedRefUrl] = useState<string | null>(null);
  const [resolvedRefNote, setResolvedRefNote] = useState<string | null>(null);
  const [count, setCount] = useState(12);
  const [error, setError] = useState<string | null>(null);

  // Live roster count for the side panel — same eligibility filter as
  // /api/swarm/plan (persona agents with a usable face; clippers repurpose
  // existing footage and don't qualify for original swarm generations).
  const roster = useQuery(api.influencers.listAll, {}) as Array<{ agentType?: string; avatarUrl?: string }> | undefined;
  const eligibleAgents = useMemo(() => {
    if (!roster) return [];
    return roster.filter((d) => (d.agentType ?? "influencer") !== "clipping" && !!d.avatarUrl);
  }, [roster]);
  const agentsAvailable = roster ? eligibleAgents.length : null;
  const agentAvatars = useMemo(() => eligibleAgents.map((d) => d.avatarUrl!).filter(Boolean), [eligibleAgents]);

  // Product image upload (Convex storage, same flow as the carousel app).
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadProduct = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const url = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
      if (url) setProductImageUrl(url);
      else setError("Could not store the product image.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }, [generateUploadUrl, resolveStorageUrl]);

  // ── Matching ──────────────────────────────────────────────────────────────
  const [matchStep, setMatchStep] = useState(0);
  const [cast, setCast] = useState<CastAgent[]>([]);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [productSummary, setProductSummary] = useState("");
  useEffect(() => {
    if (stage !== "matching") return;
    setMatchStep(0);
    const id = setInterval(() => setMatchStep((s) => Math.min(s + 1, MATCH_STEPS.length - 1)), 4500);
    return () => clearInterval(id);
  }, [stage]);

  const findSwarm = useCallback(async () => {
    if (!prompt.trim()) return;
    setStage("matching");
    setError(null);
    try {
      const res = await fetch("/api/swarm/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          websiteUrl: websiteUrl.trim() || undefined,
          productImageUrl: productImageUrl || undefined,
          mode: linkMode,
          count,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; productSummary?: string; cast?: CastAgent[]; items?: PlanItem[];
        referenceImageUrl?: string | null; referenceNote?: string | null;
      };
      if (!res.ok || !j.ok || !j.cast?.length || !j.items?.length) {
        setError(j.error ?? `Matching failed (HTTP ${res.status})`);
        setStage("brief");
        return;
      }
      setCast(j.cast);
      setItems(j.items);
      setProductSummary(j.productSummary ?? "");
      setResolvedRefUrl(j.referenceImageUrl ?? null);
      setResolvedRefNote(j.referenceNote ?? null);
      setStage("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
      setStage("brief");
    }
  }, [prompt, websiteUrl, productImageUrl, count]);

  const distribution = useMemo(() => {
    const byMint = new Map<string, number>();
    for (const i of items) byMint.set(i.mintAddress, (byMint.get(i.mintAddress) ?? 0) + 1);
    const rows = cast.map((a) => ({ agent: a, n: byMint.get(a.mintAddress) ?? 0 })).filter((r) => r.n > 0);
    const maxPerAgent = rows.reduce((m, r) => Math.max(m, r.n), 0);
    return { rows, maxPerAgent, days: Math.max(1, Math.ceil(maxPerAgent / MAX_PER_AGENT_PER_DAY)) };
  }, [cast, items]);

  // ── Launch + live progress ───────────────────────────────────────────────
  const [taskIds, setTaskIds] = useState<Id<"agentTasks">[]>([]);
  const [launching, setLaunching] = useState(false);
  const launch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/swarm/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          // Uploaded product photo wins; else the /plan-resolved reference
          // (screenshot / crawled product shot) rides into every render.
          productImageUrl: productImageUrl || resolvedRefUrl || undefined,
          // Every persona script gets the real product grounding: the user's
          // own words + the AI's product summary.
          productContext: [prompt.trim(), productSummary].filter(Boolean).join(". "),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; taskIds?: string[] };
      if (!res.ok || !j.ok || !j.taskIds?.length) {
        setError(j.error ?? `Launch failed (HTTP ${res.status})`);
        return;
      }
      setTaskIds(j.taskIds as Id<"agentTasks">[]);
      setStage("running");
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setLaunching(false);
    }
  }, [items, productImageUrl, resolvedRefUrl, prompt, productSummary]);

  const statusMap = useQuery(
    api.agentTasks.generationStatus,
    taskIds.length > 0 ? { ids: taskIds } : "skip",
  ) as Record<string, { status: string; videoUrl?: string; posterUrl?: string; error?: string; _creationTime: number }> | undefined;

  const [viewing, setViewing] = useState<ViewingVideo | null>(null);

  const progress = useMemo(() => {
    let done = 0, failed = 0;
    for (const id of taskIds) {
      const s = statusMap?.[id]?.status;
      if (s === "succeeded") done += 1;
      else if (s === "failed") failed += 1;
    }
    return { done, failed, total: taskIds.length, running: taskIds.length - done - failed };
  }, [taskIds, statusMap]);

  const reset = useCallback(() => {
    setStage("brief"); setCast([]); setItems([]); setTaskIds([]); setError(null);
  }, []);

  const agentByMint = useMemo(() => new Map(cast.map((a) => [a.mintAddress, a])), [cast]);

  return (
    <AppHeaderShell>
      <div className="min-h-full px-6 py-10 text-white" style={BG}>
        <div className="mx-auto max-w-[1180px]">
          <motion.div {...blurIn(0)} className="flex items-center justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2.5 text-[28px] font-thin tracking-tight">
                <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                  <Zap className="size-4.5 text-white/80" strokeWidth={1.75} />
                </span>
                Content Swarm
              </h1>
              <p className="mt-1.5 text-[13px] text-white/40">
                One product brief → up to 100 unique videos across the best-matching AI influencers, in one shot.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <CreditsPill ownerWallet={ownerWallet} />
              {stage !== "brief" && (
                <button type="button" onClick={reset} className={GHOST_BTN}>
                  <RotateCcw className="size-3.5" /> New swarm
                </button>
              )}
            </div>
          </motion.div>

          {/* ── Stage: brief ── */}
          {stage === "brief" && (
          <div className="mt-6 flex items-start gap-5">
            <motion.div {...blurIn(0.08)} className={`min-w-0 flex-1 ${CARD}`}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Tell the swarm about your product: what it is, who it's for, what makes it good…"
                rows={3}
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-[14px] text-white placeholder:text-white/30 transition-colors focus:border-lime-400/40 focus:outline-none focus:ring-1 focus:ring-lime-400/20"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 transition-colors focus-within:border-lime-400/40">
                  <LinkIcon className="size-4 shrink-0 text-white/30" />
                  <input
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder={
                      linkMode === "app" ? "App Store / Play Store link (optional)"
                      : linkMode === "product" ? "Product page link (optional)"
                      : "Website link (optional)"
                    }
                    className="w-full min-w-0 bg-transparent text-[13.5px] text-white placeholder:text-white/30 focus:outline-none"
                  />
                  {/* What the link IS — decides the KIE visual reference: web =
                      site screenshot, app = store screenshots, product =
                      crawled product photo (same switch as Recreate). */}
                  <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
                    {(["web", "app", "product"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setLinkMode(m)}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold capitalize transition-colors ${
                          linkMode === m ? "bg-white text-neutral-900" : "text-white/45 hover:text-white/80"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                {productImageUrl ? (
                  <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    className="flex items-center gap-2 rounded-2xl border border-lime-400/25 bg-lime-400/[0.06] py-1.5 pl-1.5 pr-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={productImageUrl} alt="Product" className="size-9 rounded-xl object-cover ring-1 ring-white/20" />
                    <span className="text-[12.5px] text-white/75">Product photo attached</span>
                    <button type="button" onClick={() => setProductImageUrl(null)} className="rounded p-0.5 text-white/40 transition-colors hover:text-white">
                      <X className="size-3.5" />
                    </button>
                  </motion.div>
                ) : (
                  <label className={`${GHOST_BTN} cursor-pointer py-3`}>
                    {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                    {uploading ? "Uploading…" : "Product image"}
                    <input type="file" accept="image/*" className="hidden" disabled={uploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadProduct(f); e.target.value = ""; }} />
                  </label>
                )}
              </div>

              {/* ── Count slider + live plan estimate — compact single-row design ── */}
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10.5px] font-semibold uppercase tracking-widest text-white/40">How many contents?</span>
                  <motion.span key={count} initial={{ scale: 1.2, color: "#bef264" }} animate={{ scale: 1, color: "#ffffff" }}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                    className="text-[22px] font-black leading-none tabular-nums">
                    {count}
                  </motion.span>
                </div>
                <input
                  type="range" min={1} max={100} value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  style={{ background: `linear-gradient(90deg, #a3e635 ${count}%, rgba(255,255,255,0.08) ${count}%)` }}
                  className="mt-2.5 h-1 w-full cursor-pointer appearance-none rounded-full outline-none
                    [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(163,230,53,0.25),0_2px_6px_rgba(0,0,0,0.5)]
                    [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110
                    [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
                />
                <p className="mt-2 text-[10.5px] text-white/35">
                  ~{Math.min(12, count)} agents · ~{Math.ceil(count / Math.min(12, count))}/agent · ~{Math.max(1, Math.ceil(Math.ceil(count / Math.min(12, count)) / MAX_PER_AGENT_PER_DAY))}d timeline
                  <span className="text-white/20"> — max {MAX_PER_AGENT_PER_DAY}/agent/day, final split set after matching</span>
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-medium text-lime-300/80">
                  <Zap className="size-3" strokeWidth={2.25} />
                  ~<span className="tabular-nums">{(count * CREDITS_PER_VIDEO_ESTIMATE).toLocaleString()}</span> credits estimated for {count} video{count === 1 ? "" : "s"}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-end">
                <button type="button" disabled={!prompt.trim() || uploading} onClick={() => void findSwarm()} className={PRIMARY_BTN}>
                  <Sparkles className="size-4 transition-transform duration-300 group-hover:rotate-12" /> Match my swarm
                </button>
              </div>
              {error && <p className="mt-3 text-[12.5px] text-red-400">{error}</p>}
            </motion.div>
            <SwarmSidePanel agentsAvailable={agentsAvailable} agentAvatars={agentAvatars} />
          </div>
          )}

          {/* ── Stage: matching (animated loader) ── */}
          {stage === "matching" && (
            <motion.div {...blurIn(0)} className={`mt-6 ${CARD} relative overflow-hidden py-16 text-center`}>
              <motion.div
                className="pointer-events-none absolute inset-0"
                style={{ background: "linear-gradient(110deg, transparent 30%, rgba(190,255,120,0.08) 50%, transparent 70%)", backgroundSize: "220% 100%" }}
                animate={{ backgroundPosition: ["120% 0%", "-120% 0%"] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
              />
              <div className="relative mx-auto grid size-16 place-items-center rounded-full border border-lime-400/25 bg-lime-400/10 shadow-[0_0_40px_rgba(163,230,53,0.15)]">
                <Users className="size-7 text-lime-300" />
                {[0, 0.55, 1.1].map((d) => (
                  <motion.span key={d}
                    className="absolute inset-0 rounded-full border border-lime-400/40"
                    animate={{ scale: [1, 1.9], opacity: [0.6, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: d }}
                  />
                ))}
              </div>
              <AnimatePresence mode="wait">
                <motion.p key={matchStep}
                  initial={{ opacity: 0, y: 8, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(6px)" }} transition={{ duration: 0.35 }}
                  className="relative mt-5 text-[14px] font-medium text-white/80">
                  {MATCH_STEPS[matchStep]}
                </motion.p>
              </AnimatePresence>
              <p className="relative mt-1.5 text-[11.5px] text-white/35">Casting {count} unique contents across the roster…</p>
            </motion.div>
          )}

          {/* ── Stage: plan ── */}
          {stage === "plan" && (
            <div className="mt-6 space-y-4">
              {productSummary && (
                <motion.div {...blurIn(0)} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-4 text-[13px] leading-relaxed text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  {productSummary}
                </motion.div>
              )}

              {/* Visual reference riding into every storyboard + render */}
              {(productImageUrl || resolvedRefUrl) && (
                <motion.div {...blurIn(0.03)} className="flex items-center gap-2.5 rounded-2xl border border-lime-400/25 bg-lime-400/[0.06] py-2 pl-2 pr-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={productImageUrl || resolvedRefUrl!} alt="Reference" className="h-12 w-12 rounded-xl object-cover ring-1 ring-white/20" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-white/85">Visual reference locked</p>
                    <p className="truncate text-[11.5px] text-white/50">
                      {productImageUrl ? "Uploaded product photo" : (resolvedRefNote || "captured from your link")} — sent to KIE with every storyboard &amp; clip
                    </p>
                  </div>
                </motion.div>
              )}

              <motion.div {...blurIn(0.06)} className="grid grid-cols-3 gap-2.5">
                {[
                  { Icon: Clapperboard, label: "Contents", value: items.length },
                  { Icon: Users, label: "Agents matched", value: distribution.rows.length },
                  { Icon: CalendarClock, label: `Days (max ${MAX_PER_AGENT_PER_DAY}/agent/day)`, value: `~${distribution.days}` },
                ].map((s) => (
                  <div key={s.label} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] px-4 py-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                    <s.Icon className="mx-auto size-4 text-lime-300/70" />
                    <StatNumber value={s.value} />
                    <p className="text-[10px] uppercase tracking-wide text-white/35">{s.label}</p>
                  </div>
                ))}
              </motion.div>

              <div className="grid gap-3 sm:grid-cols-2">
                {distribution.rows.map(({ agent, n }, i) => (
                  <motion.div key={agent.mintAddress} {...blurIn(0.1 + i * 0.06)}
                    whileHover={{ y: -3 }}
                    className="group flex items-center gap-3.5 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_20px_45px_-30px_rgba(0,0,0,0.9)] transition-colors hover:border-lime-400/25">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={agent.avatarUrl} alt={agent.name}
                      className="size-14 shrink-0 rounded-2xl object-cover ring-1 ring-white/15 transition-all duration-300 group-hover:ring-lime-400/50" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <p className="truncate text-[13.5px] font-semibold">{agent.name}</p>
                        <span className="truncate text-[10.5px] text-white/35">@{agent.handle.replace(/^@+/, "")}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/45">{agent.reason || agent.niche}</p>
                    </div>
                    <div className="shrink-0 rounded-xl border border-lime-400/20 bg-lime-400/[0.08] px-2.5 py-1.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
                      <p className="text-[17px] font-black leading-none tabular-nums text-lime-300">{n}</p>
                      <p className="mt-0.5 text-[8.5px] uppercase tracking-wide text-white/40">videos</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              <motion.div {...blurIn(0.2)} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-4">
                <p className="text-[12px] text-white/45">
                  {items.length} unique briefs ready — every video gets its own angle and hook, in each agent&apos;s persona, grounded in your product.
                </p>
                <button type="button" onClick={() => void launch()} disabled={launching} className={PRIMARY_BTN}>
                  {launching ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />}
                  {launching ? "Launching…" : `Launch swarm (${items.length})`}
                </button>
              </motion.div>
              {error && <p className="text-[12.5px] text-red-400">{error}</p>}
            </div>
          )}

          {/* ── Stage: running ── */}
          {stage === "running" && (
            <div className="mt-6 space-y-4">
              <motion.div {...blurIn(0)} className={CARD}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[14px] font-semibold">
                    Swarm running · <span className="tabular-nums text-lime-300">{progress.done}/{progress.total}</span> done
                    {progress.failed > 0 && <span className="text-red-400"> · {progress.failed} failed</span>}
                  </p>
                  {progress.running > 0 && <Loader2 className="size-4 animate-spin text-lime-300" />}
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.06] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
                  <motion.div
                    className="relative h-full rounded-full bg-gradient-to-r from-lime-500 to-lime-300"
                    animate={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 24 }}
                  >
                    <motion.span
                      className="absolute inset-0"
                      style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)", backgroundSize: "180% 100%" }}
                      animate={{ backgroundPosition: ["150% 0%", "-150% 0%"] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                    />
                  </motion.div>
                </div>
                <p className="mt-2 text-[11px] text-white/35">
                  All {progress.total} videos are rendering in parallel — you can leave this page; everything lands in your swarm library below and on each agent&apos;s Generations.
                </p>
              </motion.div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                {taskIds.map((id, i) => {
                  const s = statusMap?.[id];
                  const item = items[i];
                  const agent = item ? agentByMint.get(item.mintAddress) : undefined;
                  return (
                    <motion.div key={id} {...blurIn(Math.min(i, 12) * 0.04)} whileHover={{ y: -2 }}
                      onClick={() => s?.status === "succeeded" && s.videoUrl && setViewing({
                        videoUrl: s.videoUrl, posterUrl: s.posterUrl, title: item?.topic ?? "",
                        agentName: agent?.name ?? "Agent", agentHandle: agent?.handle, agentAvatarUrl: agent?.avatarUrl,
                        time: s._creationTime, platforms: agent?.connectedPlatforms ?? [],
                      })}
                      className={`group overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:border-white/20 ${s?.status === "succeeded" && s.videoUrl ? "cursor-pointer" : ""}`}>
                      <div className="relative flex aspect-video items-center justify-center bg-black/40">
                        {s?.status === "succeeded" && s.videoUrl ? (
                          <>
                            <video src={s.videoUrl} preload="metadata" muted loop playsInline poster={s.posterUrl} className="size-full object-cover" />
                            <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
                              <Play className="size-7 fill-white text-white opacity-0 drop-shadow-lg transition-opacity group-hover:opacity-100" />
                            </span>
                          </>
                        ) : s?.status === "failed" ? (
                          <XCircle className="size-5 text-red-400" />
                        ) : (
                          <>
                            <motion.span
                              className="absolute inset-0"
                              style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.05) 50%, transparent 65%)", backgroundSize: "220% 100%" }}
                              animate={{ backgroundPosition: ["130% 0%", "-130% 0%"] }}
                              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                            />
                            <Loader2 className="size-4 animate-spin text-white/30" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-2">
                        {agent && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={agent.avatarUrl} alt="" className="size-5 shrink-0 rounded-full object-cover ring-1 ring-white/20" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[10px] font-medium text-white/60" title={item?.topic}>{agent?.name ?? "…"}</p>
                          {s?._creationTime && <p className="text-[9px] text-white/30">{timeAgo(s._creationTime)}</p>}
                        </div>
                        {s?.status === "succeeded" ? (
                          <PlatformStack platforms={agent?.connectedPlatforms ?? []} />
                        ) : null}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Swarm library — the user's saved generations (Convex, all devices).
                 Wrapped in an ErrorBoundary so an out-of-date backend (query not
                 deployed yet) degrades to "no library" instead of killing the page. ── */}
          {swarmSessionId && (
            <ErrorBoundary fallback={null}>
              <SwarmLibrary sessionId={swarmSessionId} excludeIds={taskIds as string[]} onOpen={setViewing} />
            </ErrorBoundary>
          )}
        </div>
        <AnimatePresence>
          {viewing && <VideoModal v={viewing} onClose={() => setViewing(null)} />}
        </AnimatePresence>
      </div>
    </AppHeaderShell>
  );
}
