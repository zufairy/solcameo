"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import TabPageHeader from "./TabPageHeader";
import velloLogo from "@/assets/solcameo-dark.png";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import {
  Upload,
  CheckCircle2,
  Circle,
  ExternalLink,
  Plus,
  Activity,
  Sparkles,
  Mic2,
  Users as UsersIcon,
  Film, FileText, TrendingUp, Home, Layers, Store, History as HistoryIcon, CalendarClock,
  Folder, ChevronLeft, MessageSquare, FileEdit,
  Loader2, Clock, ChevronDown, Copy, X, ArrowDownToLine, ArrowUpFromLine,
  Wallet, Briefcase, ChevronRight, Compass, RefreshCw, Search, ArrowUpRight,
  Settings, Trash2, DollarSign, GalleryHorizontal, Scissors, ImagePlus, Clapperboard, Video, BookOpen, Lightbulb,
  Lock, Rocket, ImageUp, Play,
  UserRound,
} from "lucide-react";
import { getAccountExplorerUrl } from "@/lib/solana/network";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import type { AgentBlueprint, VideoEngineId } from "@/lib/builder/agentTypes";
import { formatAgentDescription } from "@/lib/agentDescription";
import { VIDEO_ENGINES, DEFAULT_VIDEO_ENGINE, IDEAL_VIDEO_SECONDS, STANDARD_VIDEO_LENGTHS, videoCostForLength, videoCreditsForLength, clipsForLength, maxClipForModel } from "@/lib/builder/agentTypes";
import type { SkillDef } from "@/lib/builder/agentSkills";
import { buildSkillGuide } from "@/lib/builder/agentSkills";
import { estimateDailyBurn } from "@/lib/builder/skillsCatalog";
import { CLIP_SKILL_BY_ID, isWipClipSkill } from "@/lib/builder/clipSkillsCatalog";
import { clipSkillRunCostWithOverrides, effectiveUnitPrice } from "@/lib/economy/servicePrices";
import { MIN_SHARES_FOR_FLOOR } from "@/lib/economy/constants";
import { investEnabled } from "@/lib/flags";
import { formatUsdc6, formatSignedUsdc6 } from "@/lib/economy/format";
import type { TxHistoryRow } from "@/lib/economy/transactionHistory";
import { splitInstalledSkills, AGENT_SKILLS } from "@/lib/builder/skillSplit";
import tiktokLogo from "@/assets/logos/tiktok.svg";
import instagramLogo from "@/assets/logos/instagram.svg";
import youtubeLogo from "@/assets/logos/youtube.svg";
import xLogo from "@/assets/logos/x.svg";
import UsageDetailModal from "./UsageDetailModal";
import AgentChatCard from "./AgentChatCard";
import HeartbeatCard from "./HeartbeatCard";
import SkillsMarketplaceCard, { InfluencerSkillModal } from "./SkillsMarketplaceCard";
import SocialConnectionsPanel from "./SocialConnectionsPanel";
import ConnectSocialsPrompt, { isConnectPromptDismissed } from "./ConnectSocialsPrompt";
import PostingTab from "./PostingTab";
import SchedulePanel from "./SchedulePanel";
import AppStoreTab from "./AppStoreTab";
import VideoDirectorTab from "./VideoDirectorTab";
import NextVideoCard from "./NextVideoCard";
import IdeasPanel from "./IdeasPanel";
import { ClippingFlowCanvas } from "@/components/builder/clipping-flow/ClippingFlowCanvas";
import { wiredMarketplaceSkillIds } from "@/components/builder/clipping-flow/lib/compile-graph";
import type { VelloNode, VelloEdge } from "@/components/builder/clipping-flow/types/clipping";
import { MarketplacePanel } from "@/components/builder/clipping-flow/marketplace-panel";
import { PhotoCarouselTab } from "@/components/builder/carousel/PhotoCarouselTab";
import { SeriesTab } from "@/components/builder/series/SeriesTab";
import { VideosTab } from "@/components/builder/videos/VideosTab";
import { GenerateHub, type GenerateMode } from "@/components/builder/generate/GenerateHub";
import { LearnTab } from "@/components/builder/LearnTab";
import { WorkspaceRail } from "@/components/builder/WorkspaceRail";
import { CharacterTab } from "@/components/builder/character/CharacterTab";
import { VideoEditorTab } from "@/components/builder/video-editor/VideoEditorTab";
import dynamic from "next/dynamic";
// Heavy (preview iframes, transport, agent chat): only loaded when the tab opens.
const RenderStudioTab = dynamic(() => import("@/components/builder/render-studio/RenderStudioTab"), { ssr: false });
import { VideoFeedback } from "@/components/builder/onboarding/VideoFeedback";
import { InfluencerEditorTab } from "@/components/builder/video-editor/InfluencerEditorTab";
import { ClipHistory } from "@/components/builder/clipping-flow/history/clip-history";
import { backfillLocalClips } from "@/components/builder/clipping-flow/lib/backfillClips";
import { unsyncedClips } from "@/components/builder/clipping-flow/lib/clipHistoryStorage";
import { migrateClipNamespace } from "@/components/builder/clipping-flow/lib/clipGraphStorage";
import { ClipLibrary } from "@/components/builder/clipping-flow/library/clip-library";
import { DownloadsTab } from "@/components/builder/clipping-flow/library/downloads-tab";
import MonetizationCards from "./MonetizationCards";
import SkillMdModal from "./SkillMdModal";
import DepositModal from "./DepositModal";
import { WorkTab } from "./WorkTab";
import WithdrawModal from "./WithdrawModal";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ConfirmDeleteDialog, postDelete } from "@/components/ui/confirm-delete-dialog";
import ClipJobProgress from "./ClipJobProgress";

const CONTENT_TYPE_OPTIONS = [
  "GRWM",
  "Product Reviews",
  "Tips & Education",
  "Myth-busting",
  "Q&A with followers",
  "Unboxing",
  "Tutorials",
  "Day-in-the-life",
  "Trends",
];

interface KnowledgeEntryLike {
  id?: string;
  _id?: string;
  title: string;
  content?: string;
  tags?: string[];
  category?: string;
  _creationTime?: number;
}

interface AgentWorkspaceProps {
  blueprint: AgentBlueprint;
  skillDefs: SkillDef[];
  knowledgeEntries: KnowledgeEntryLike[];
  avatarUrls: string[];
  characterBible?: string;
  sessionId?: string;
  onEditField: (path: string) => void;
  onToggleContentType: (type: string) => void;
  onToggleSkill?: (skillId: string, install: boolean) => void;
  onHeartbeatChange?: (next: NonNullable<AgentBlueprint["heartbeat"]>) => void;
  onVideoEngineChange?: (engine: NonNullable<AgentBlueprint["videoEngine"]>) => void;
  onUploadKnowledge: () => void;
  onTestAgent: () => void;
  /** Deploy/mint CTA — drives the chat mint flow (the mint card is chat-gated). */
  onDeploy?: () => void;
  /** Open the wallet-connect modal (same action as the header button). */
  onConnectWallet?: () => void;
  /** Fire the heartbeat now — runs the autonomy loop (create tasks from persona+memory, then execute). */
  onFireHeartbeat?: () => void | Promise<void>;
  /** AUTO heartbeat fire (scheduler) — claim-gated so it can't double-fire with the cron. */
  onAutoFireHeartbeat?: () => void | Promise<void>;
  onOpenSkillsMarketplace?: () => void;
  externalTickToken?: number;
  forceTab?: "home" | "live" | "predict" | "research";
  /** Chat open_tab → switch to any tab that exists for THIS agent (post-mint). */
  forceWorkspaceTab?: { tab: string; nonce: number } | null;
  /** Bump to auto-switch a clipping agent's workspace to the Clipping tab
      (used by chat canvas_* actions so the operator sees the canvas change). */
  forceClipTab?: number;
  /** DEV screen-navigator (e.g. /dev/clipper): seed the initial active tab. */
  initialTab?: "home" | "work" | "tasks" | "generations" | "budget" | "director" | "ideas" | "schedule" | "appstore" | "clipping" | "editor" | "marketplace" | "library" | "history" | "posting" | "carousel" | "downloads" | "generate" | "series" | "videos" | "learn" | "character" | "renderstudio";
  /** DEV screen-navigator: receive the in-scope setActiveTab so an external
      overlay can drive ANY tab id, including ones hidden/gated for this agent. */
  onTabController?: (setTab: (id: "home" | "work" | "tasks" | "generations" | "budget" | "director" | "ideas" | "schedule" | "appstore" | "clipping" | "editor" | "marketplace" | "library" | "history" | "posting" | "carousel" | "downloads" | "generate" | "series" | "videos" | "learn" | "character" | "renderstudio") => void) => void;
}

// ─── Atoms ─────────────────────────────────────────────────────────────────────

/** "in 12m" / "in 3h" / "overdue" for a scheduledContent row's scheduledFor. */
function fmtCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return String(n);
}

// Warm dark "glass" background — a near-black base with two soft amber/maroon
// glows, matching the reference editor look (not flat black).
const WARM_GLASS_BG: React.CSSProperties = {
  background:
    "radial-gradient(120% 90% at 12% -10%, rgba(255,255,255,0.05), transparent 55%), " +
    "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.035), transparent 55%), " +
    "#050506",
};

const PLATFORM_LOGO: Record<string, string> = {
  tiktok: tiktokLogo.src,
  instagram: instagramLogo.src,
  youtube: youtubeLogo.src,
  x: xLogo.src,
  twitter: xLogo.src,
};

function WeeklyGrowthChart({ data }: { data: { label: string; views: number; posts: number }[] }) {
  const hasSignal = data.some((d) => d.views > 0 || d.posts > 0);
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl px-3 pt-3 pb-1">
      <div className="mb-1 flex items-center justify-between px-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Weekly growth</p>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[9.5px] font-medium text-zinc-400">
            <span className="size-1.5 rounded-full" style={{ background: "#65c000" }} /> Views
          </span>
          <span className="flex items-center gap-1 text-[9.5px] font-medium text-zinc-400">
            <span className="size-1.5 rounded-full bg-sky-400" /> Posts
          </span>
        </div>
      </div>
      {!hasSignal ? (
        <p className="px-1 pb-3 text-[11px] text-zinc-600">No activity yet this week.</p>
      ) : (
        <ResponsiveContainer width="100%" height={110}>
          <LineChart data={data} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <RTooltip
              contentStyle={{ background: "#0b0b0d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: 11 }}
              labelStyle={{ color: "rgba(255,255,255,0.6)" }}
            />
            <Line type="monotone" dataKey="views" stroke="#65c000" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="posts" stroke="#38bdf8" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function formatPostEta(scheduledFor: number): string {
  const diff = scheduledFor - Date.now();
  if (diff <= 0) return "posting now";
  if (diff < 3_600_000) return `in ${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff < 86_400_000) return `in ${Math.round(diff / 3_600_000)}h`;
  return `in ${Math.round(diff / 86_400_000)}d`;
}

function SectionHeading({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div className="mb-3">
      <h2 className={`text-[20px] font-semibold leading-tight tracking-[-0.025em] ${dark ? "font-sans text-white" : "font-serif text-zinc-900"}`}>{children}</h2>
    </div>
  );
}

function CategoryTag({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "amber" }) {
  // Boxy, thick-bordered monospace chips. Neutral = light outline; "amber" is the
  // lime accent highlight (e.g. TONIGHT) on the dark neobrutalist ground.
  const tones = {
    default: "nb-tag",
    amber:   "nb-tag nb-tag-accent",
  } as const;
  return (
    <span className={tones[tone]}>
      {children}
    </span>
  );
}

function PaperCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`nb-card ${className}`}>
      {children}
    </div>
  );
}

// Pull a one-line description out of a skill MD file's YAML frontmatter
// (`description: ...`), falling back to the first real content line. Used to
// label agent-authored (create_skill) skills that live only as skill files.
function parseSkillDescription(markdown: string): string {
  const fm = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const m = fm[1].match(/^description:\s*(.+)$/m);
    if (m && m[1].trim()) return m[1].trim().slice(0, 160);
  }
  const firstLine = markdown
    .replace(/^---[\s\S]*?---\s*/, "")
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0);
  return (firstLine ?? "Custom skill").slice(0, 160);
}

// ─── DocumentsManager — file-manager style folder browser ────────────────────
// Groups knowledge entries + skill files into folders (Q&A, References, Persona,
// Skills, Other). Click a folder to browse its files; click a file to open it.

type DocFile = { id: string; title: string; subtitle?: string; open: () => void };

function classifyDoc(entry: KnowledgeEntryLike): "qa" | "references" | "persona" | "other" {
  const tags = (entry.tags ?? []).map((t) => t.toLowerCase());
  const title = (entry.title ?? "").toLowerCase();
  const cat = (entry.category ?? "").toLowerCase();
  const has = (...words: string[]) => tags.some((t) => words.some((w) => t.includes(w)));
  if (has("qa", "conversation", "notes", "q&a") || title.includes("conversation notes") || title.includes("q&a")) return "qa";
  if (has("reference", "inspiration", "transcript", "video-reference") || title.includes("reference")) return "references";
  if (has("persona", "identity", "character-bible", "visual-identity") || title.includes("visual identity") || title.includes("identity") || cat === "core") return "persona";
  return "other";
}

function DocumentsManager({
  entries, skills, skillFileMap, onOpenDoc, onOpenSkill, onAdd,
}: {
  entries: KnowledgeEntryLike[];
  skills: SkillDef[];
  skillFileMap: Map<string, { markdown: string; updatedAt: number }>;
  onOpenDoc: (e: KnowledgeEntryLike) => void;
  onOpenSkill: (s: SkillDef) => void;
  onAdd: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const folders = useMemo(() => {
    const buckets: Record<string, DocFile[]> = { qa: [], references: [], persona: [], other: [] };
    for (const e of entries) {
      const f = classifyDoc(e);
      buckets[f].push({
        id: String(e._id ?? e.id),
        title: e.title,
        subtitle: e.tags?.slice(0, 3).map((t) => `#${t}`).join("  "),
        open: () => onOpenDoc(e),
      });
    }
    const skillFiles: DocFile[] = skills.map((s) => ({
      id: s.id,
      title: s.label,
      subtitle: skillFileMap.has(s.id) ? "edited" : "default template",
      open: () => onOpenSkill(s),
    }));
    return [
      { key: "qa",         label: "Q&A",        Icon: MessageSquare, files: buckets.qa },
      { key: "references", label: "References",  Icon: ExternalLink,  files: buckets.references },
      { key: "persona",    label: "Persona",     Icon: UsersIcon,     files: buckets.persona },
      { key: "skills",     label: "Skills",      Icon: Sparkles,      files: skillFiles },
      { key: "other",      label: "Other",       Icon: FileText,      files: buckets.other },
    ];
  }, [entries, skills, skillFileMap, onOpenDoc, onOpenSkill]);

  const visibleFolders = folders.filter((f) => f.files.length > 0);
  const current = openKey ? folders.find((f) => f.key === openKey) : null;

  // ── Folder detail view ──────────────────────────────────────────────────────
  if (current) {
    return (
      <PaperCard className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setOpenKey(null)} className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-900 transition-colors">
            <ChevronLeft className="size-3.5" /> Documents
          </button>
          <span className="text-zinc-300">/</span>
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-zinc-900"><current.Icon className="size-3.5 text-zinc-500" /> {current.label}</span>
          <span className="ml-auto text-[10.5px] font-mono text-zinc-400">{current.files.length} file{current.files.length === 1 ? "" : "s"}</span>
        </div>
        {current.files.length === 0 ? (
          <p className="text-[12px] text-zinc-500 px-1 py-3">This folder is empty.</p>
        ) : (
          <div className="space-y-1">
            {current.files.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={file.open}
                className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-white border border-transparent hover:border-zinc-200 transition-all group"
              >
                <FileText className="size-4 text-zinc-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-zinc-900 truncate">{file.title}</p>
                  {file.subtitle && <p className="text-[10px] text-zinc-400 font-mono truncate">{file.subtitle}</p>}
                </div>
                <FileEdit className="size-3.5 text-zinc-300 group-hover:text-zinc-600 transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
        {current.key !== "skills" && (
          <button onClick={onAdd} className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-zinc-700 hover:text-zinc-950 px-2.5 py-1.5 border border-zinc-300 rounded-md bg-white">
            <Plus className="size-3" /> Add to {current.label}
          </button>
        )}
      </PaperCard>
    );
  }

  // ── Folder grid view ──────────────────────────────────────────────────────
  return (
    <PaperCard className="p-3">
      {visibleFolders.length === 0 ? (
        <div className="px-1 py-2">
          <p className="text-[12.5px] text-zinc-600 mb-3">No documents yet. Upload .md guides (brand voice, hooks, facts), the agent reads these on every task.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 mb-2">
          {visibleFolders.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setOpenKey(f.key)}
              className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-zinc-200 bg-white hover:border-zinc-400 hover:shadow-sm transition-all text-left"
            >
              <span className="grid place-items-center size-9 rounded-lg bg-zinc-100 text-zinc-600 shrink-0">
                <Folder className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-zinc-900 truncate">{f.label}</p>
                <p className="text-[10.5px] text-zinc-400 font-mono">{f.files.length} file{f.files.length === 1 ? "" : "s"}</p>
              </div>
            </button>
          ))}
          {/* Add new tile */}
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-dashed border-zinc-300 bg-transparent hover:border-zinc-500 hover:bg-white transition-all text-left"
          >
            <span className="grid place-items-center size-9 rounded-lg bg-zinc-50 text-zinc-500 shrink-0">
              <Plus className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-zinc-700 truncate">Add new</p>
              <p className="text-[10.5px] text-zinc-400 font-mono">upload .md</p>
            </div>
          </button>
        </div>
      )}
      {visibleFolders.length === 0 && (
        <button onClick={onAdd} className="inline-flex items-center gap-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-zinc-800 hover:text-zinc-950 px-3 py-1.5 border border-zinc-300 rounded-md bg-white">
          <Upload className="size-3" /> Upload guide
        </button>
      )}
    </PaperCard>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  variant = "dark",
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  variant?: "dark" | "orange" | "neutral" | "glass";
  children: React.ReactNode;
}) {
  // "glass" (the Deploy CTA) breaks from the neobrutalist family on purpose —
  // that hard black-border/offset-shadow look plus solid orange read as a
  // static label, not a button, to first-time operators. This matches the
  // frosted-glass primary used across the rest of the app (e.g. /swarm's
  // "Match my swarm"): white gradient plate, inset top highlight, soft glow,
  // lifts on hover, presses on click — unmistakably clickable.
  if (variant === "glass") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full text-center font-mono text-[11.5px] font-bold tracking-[0.18em] uppercase px-4 py-3.5 rounded-xl bg-gradient-to-b from-white to-white/85 text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_22px_-8px_rgba(0,0,0,0.35),0_2px_6px_rgba(0,0,0,0.15)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_14px_30px_-10px_rgba(0,0,0,0.4),0_2px_6px_rgba(0,0,0,0.15)] active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
      >
        {children}
      </button>
    );
  }

  const styles = {
    dark:   "bg-zinc-900 hover:bg-zinc-800 text-white",
    orange: "bg-[#d56b3e] hover:bg-[#c75d31] text-white",
    neutral: "bg-white hover:bg-zinc-100 text-zinc-900",
  } as const;
  // Boxy neobrutalist primary — mirrors .nb-card (2px black border, hard offset
  // shadow, 5px radius) with the same hover-lift / press-down as nb-card-interactive.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-center font-mono text-[11.5px] font-bold tracking-[0.18em] uppercase px-4 py-3 rounded-[5px] border-2 border-[#1c1c1f] shadow-[4px_4px_0_0_#1c1c1f] transition-[transform,box-shadow,background-color] duration-100 hover:-translate-x-px hover:-translate-y-px hover:shadow-[6px_6px_0_0_#1c1c1f] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#1c1c1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

function Chip({
  text,
  active = false,
  onClick,
  tone = "default",
}: {
  text: string;
  active?: boolean;
  onClick?: () => void;
  tone?: "default" | "emerald" | "rose";
}) {
  const tones = active
    ? {
        default: "bg-zinc-900 text-white border-zinc-900",
        emerald: "bg-emerald-700 text-white border-emerald-700",
        rose:    "bg-rose-700 text-white border-rose-700",
      }
    : {
        default: "bg-transparent text-zinc-700 border-zinc-400/70 hover:border-zinc-900",
        emerald: "bg-emerald-50 text-emerald-800 border-emerald-300/80",
        rose:    "bg-rose-50 text-rose-800 border-rose-300/80",
      };
  const t = (tones as Record<string, string>)[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-medium transition-colors ${t} ${!onClick ? "cursor-default" : ""}`}
    >
      {text}
    </button>
  );
}

// Placeholder shown in place of the agent's profile photo before it's minted
// (no avatar exists yet) — the Vello mark instead of a bare grey tile, so an
// unminted agent still reads as "this app, in progress" rather than broken.
function BuildingPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-black relative overflow-hidden">
      <motion.div
        animate={{ opacity: [0.55, 1, 0.55], scale: [0.96, 1, 0.96] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="relative flex flex-col items-center gap-2"
      >
        <Image src={velloLogo} alt="" className="h-8 w-auto object-contain" />
        <span className="font-serif text-[10.5px] text-white/50 tracking-[0.2em] uppercase">Forming…</span>
      </motion.div>
    </div>
  );
}

// Deterministic initials avatar — shown for a MINTED agent whose stored
// avatarUrl is empty (e.g. the mint-time image upload failed, so no http URL was
// persisted). "Forming…" would wrongly imply the agent is still building; a
// minted agent always gets a real-looking face instead. Colour is hashed from
// the name so it's stable across reloads.
function AvatarFallback({ name }: { name: string }) {
  const clean = (name ?? "").trim();
  const initials =
    clean
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "AI";
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) % 360;
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: `linear-gradient(135deg, hsl(${h} 68% 54%), hsl(${(h + 42) % 360} 66% 44%))` }}
    >
      <span className="font-serif text-2xl font-bold tracking-wide text-white/95">{initials}</span>
    </div>
  );
}

function SafeProfileImage({ src, name }: { src?: string; name: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <AvatarFallback name={name} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`${name} profile`} className="h-full w-full object-cover" onError={() => setFailedSrc(src)} />;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AgentWorkspace(props: AgentWorkspaceProps) {
  const { blueprint, skillDefs, knowledgeEntries, avatarUrls, characterBible, sessionId, onToggleContentType, onUploadKnowledge, onTestAgent, onDeploy, onConnectWallet } = props;
  // Trader/worker verticals were removed from Vello; keep isTrader for the
  // downstream cockpit branches (it is always false now, so they render the
  // influencer/clipping path).
  const isTrader = blueprint.agentType === "trader";

  const p = blueprint.persona ?? {};
  const t = blueprint.trader ?? {};
  const isMinted = Boolean(blueprint.mintCompleted);
  // Trader "ready" gate: needs a name + at least one asset to backtest/mint
  const isReady = isTrader
    ? Boolean(t.name && t.strategy?.assetUniverse && t.strategy.assetUniverse.length > 0)
    : Boolean(p.name && p.niche);
  // Display name for both modes
  const displayName = isTrader ? (t.name ?? "Building Trader…") : (p.name ?? "Building Agent…");

  // Once minted, the body line describes THIS agent (its niche/role), not a
  // generic "learning every trade" — defined by what the chat built.
  const mintedTagline = isTrader
    ? "Minted on Solana, learning every trade"
    : p.niche
    ? `Live ${p.niche} agent on Solana, learning from every post`
    : "Live on Solana, learning from every interaction";
  const tagline = isMinted
    ? mintedTagline
    : avatarUrls.length > 0
    ? "Avatars locked, ready to mint"
    : isReady
    ? (isTrader ? "Strategy ready, design the avatar next" : "Persona ready, generate avatars next")
    : (isTrader ? "Building strategy in chat" : "Building identity in chat");

  const tasks = buildTaskFeed(blueprint);

  // Memory stats — drives the "Living Memory" card
  const knowledgeCount = knowledgeEntries.length;
  const conversationsLearned = knowledgeEntries.filter((k) => k.category === "knowledge" && k.tags?.includes("qa")).length;
  const lessonsRetained = knowledgeEntries.filter((k) => k.tags?.includes("auto_memory") || k.tags?.includes("auto_persona")).length;

  // Tab state
  const [activeTab, setActiveTab] = useState<"home" | "work" | "tasks" | "generations" | "budget" | "director" | "ideas" | "schedule" | "appstore" | "clipping" | "editor" | "marketplace" | "library" | "history" | "posting" | "carousel" | "downloads" | "generate" | "series" | "videos" | "learn" | "character" | "renderstudio">(props.initialTab ?? "home");
  // Tabs the user has opened this session — each stays mounted (keep-alive).
  const [visitedTabs, setVisitedTabs] = useState<Set<typeof activeTab>>(() => new Set([props.initialTab ?? "home"]));
  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);
  // Header "Clip" button (Editor tab): the real Clipping pipeline (moment
  // selection, same algo the Clipping canvas itself runs) needs
  // ClippingFlowCanvas mounted so its queued ops actually drain — but the
  // operator asked to CLIP, not to go look at the node canvas. Force-mount it
  // hidden (keep-alive, same mechanism as an actual visit) instead of
  // switching to it. Used to also jump straight to Generations, which hid the
  // Editor's own progress modal the instant it opened (keep-alive tabs are
  // hidden via CSS, not unmounted) — the operator now stays put and watches
  // the run finish in place; "View in Generations" (below) is what navigates.
  const runClippingInBackground = useCallback(() => {
    setVisitedTabs((prev) => (prev.has("clipping") ? prev : new Set(prev).add("clipping")));
  }, []);
  const [genMode, setGenMode] = useState<GenerateMode>("photo");
  const viewGenerations = useCallback(() => setActiveTab("generations"), []);
  // DEV screen-navigator: hand the in-scope setActiveTab to an external overlay
  // (setActiveTab is stable, so this registers once per controller identity).
  

  // Skill MD editor state
  const [editingSkill, setEditingSkill] = useState<{ id: string; label: string; desc: string; instructions?: string } | null>(null);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const skillFiles = useQuery(
    api.agentSkillFiles.listBySession,
    sessionId ? { sessionId } : "skip",
  ) as Array<{ skillId: string; title: string; markdown: string; updatedAt: number }> | undefined;
  const skillFileMap = useMemo(() => {
    const m = new Map<string, { markdown: string; updatedAt: number }>();
    (skillFiles ?? []).forEach((f) => m.set(f.skillId, { markdown: f.markdown, updatedAt: f.updatedAt }));
    return m;
  }, [skillFiles]);

  // The RIGHT-column "Skills" panel = the agent's own skill set (set by the user):
  // persona-derived skillDefs + skills the agent authored itself (create_skill →
  // agentSkillFiles). It deliberately does NOT list installed marketplace
  // integrations — those are the "Connectors" panel on the left. Newly
  // created/edited skills sort to the TOP by their saved-file timestamp.
  const mergedSkills = useMemo(() => {
    const fromDefs = skillDefs.map((s) => ({
      id: s.id,
      label: s.label,
      desc: s.desc,
      instructions: s.instructions ?? buildSkillGuide(s),
    }));
    // Agent-authored skills exist only as skill files (id `custom.*`); surface
    // any that aren't already covered by a persona def.
    const knownIds = new Set(fromDefs.map((s) => s.id));
    const fromCustom = (skillFiles ?? [])
      .filter((f) => !knownIds.has(f.skillId))
      .map((f) => ({
        id: f.skillId,
        label: f.title || f.skillId,
        desc: parseSkillDescription(f.markdown),
        instructions: f.markdown,
      }));
    const seen = new Set<string>();
    const merged = [...fromCustom, ...fromDefs].filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    // Latest-on-top: skills with a saved MD file rank by updatedAt desc; skills
    // without a file keep their natural order below (stable sort).
    return merged.sort((a, b) => {
      const ua = skillFileMap.get(a.id)?.updatedAt ?? 0;
      const ub = skillFileMap.get(b.id)?.updatedAt ?? 0;
      return ub - ua;
    });
  }, [skillDefs, skillFiles, skillFileMap]);

  // Live wallet data — fetched from on-chain agent wallet
  const [liveWallet, setLiveWallet] = useState<{ usdc: number; sol: number } | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  // Generations — fetch when minted and on generations tab
  const mintAddress = blueprint.mintAddress ?? "";
  // A REAL on-chain NFT mint is a base58 address. The legacy/fallback id is
  // `vello_<session>_<ts>` — used when the Metaplex mint failed (e.g. a dead
  // devnet RPC). Only the real one gets the "Live on Solana" claim + a working
  // explorer link.
  const isRealMint = !!mintAddress && !mintAddress.startsWith("vello_");

  // Carousel is a built-in tab for every agent kind. It used to be gated on
  // installing clip.carouselbuilder from the App Store — but the App Store tab
  // is hidden, so nothing could ever install it and the tab never appeared.

  // Pre-mint clips live under the sessionId/"draft" namespace; on mint the canvas
  // re-keys to mintAddress and would orphan that work. Migrate the graph + history
  // buckets BEFORE the child canvas hydrates — the parent render body runs before
  // children render, so this lands ahead of the canvas' hydration effect (an
  // effect-based migration would race AFTER it). Handles real AND vello_ pseudo
  // mints; ref-guarded to run once per mint; the migrate itself is idempotent.
  const migratedRef = useRef<string | null>(null);
  if (mintAddress && migratedRef.current !== mintAddress) {
    migratedRef.current = mintAddress;
    if (sessionId) migrateClipNamespace(sessionId, mintAddress);
    migrateClipNamespace("draft", mintAddress);
  }

  // Resolve agent wallet address from the minted influencer record.
  const influencerRecord = useQuery(
    api.influencers.getByMint,
    mintAddress ? { mintAddress } : "skip",
  );
  // The live Convex value wins after a settings update, while the builder's
  // original avatar remains the loading/pre-mint fallback.
  const gif = (influencerRecord as { avatarUrl?: string } | null | undefined)?.avatarUrl || avatarUrls[0];
  const mintRecordWallet = (influencerRecord as { agentWallet?: string } | null | undefined)?.agentWallet;
  // Fallback: a stale blueprint.mintAddress (e.g. a synthetic id from a first
  // mint attempt) makes getByMint miss → the wallet/Deposit row vanishes even
  // though the agent HAS a wallet. Resolve it among the connected creator's
  // agents by EXACT mintAddress so funding still works. (Name-equality matching
  // was removed: two same-named agents would resolve to the wrong wallet and
  // route a deposit to a different agent.) When unresolved, agentWallet stays
  // undefined and the Deposit UI + balance effect hide cleanly downstream.
  const { publicKey } = useUnifiedSolanaWallet();
  const creatorAgents = useQuery(
    api.influencers.listByCreator,
    !mintRecordWallet && publicKey ? { creatorWallet: publicKey.toBase58() } : "skip",
  ) as { mintAddress: string; name?: string; agentWallet?: string }[] | undefined;
  const fallbackAgent = !mintRecordWallet
    ? (creatorAgents ?? []).find((a) => a.mintAddress === mintAddress)
    : undefined;
  const agentWallet = mintRecordWallet ?? fallbackAgent?.agentWallet;
  const nftExplorerUrl = (influencerRecord as { nftExplorerUrl?: string } | null | undefined)?.nftExplorerUrl;
  const isClipping = blueprint.agentType === "clipping" || (influencerRecord as { agentType?: string } | null | undefined)?.agentType === "clipping";

  // CONNECT-SOCIALS NUDGE — TikTok + YouTube are the two required distribution
  // targets; either missing means the agent can't fully post. Poll the same
  // /api/social/status PostingTab uses, and surface a dismissible popup (below,
  // near the return) instead of leaving the operator to discover the Schedule
  // tab's Connect button on their own. Hides ONLY once BOTH are connected.
  const { accessToken: socialsAccessToken } = useSupabaseAuth();
  const [socialsConnected, setSocialsConnected] = useState<Record<string, boolean> | null>(null);
  const [connectPromptDismissedLocal, setConnectPromptDismissedLocal] = useState(false);
  const refreshSocialsStatus = useCallback(async () => {
    if (!mintAddress || !socialsAccessToken) return;
    try {
      const res = await fetch(`/api/social/status?username=${encodeURIComponent(mintAddress)}`, {
        headers: { Authorization: `Bearer ${socialsAccessToken}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { connected?: Record<string, unknown>; ok?: boolean };
      if (json.ok === false) return;
      const conn = json.connected ?? {};
      setSocialsConnected({ tiktok: Boolean(conn.tiktok), youtube: Boolean(conn.youtube) });
    } catch {
      // transient — keep last known state
    }
  }, [mintAddress, socialsAccessToken]);
  useEffect(() => {
    void refreshSocialsStatus();
    const onFocus = () => void refreshSocialsStatus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshSocialsStatus]);
  const requiredSocialsConnected = Boolean(socialsConnected?.tiktok && socialsConnected?.youtube);
  const showConnectPrompt =
    isMinted && isRealMint && socialsConnected !== null && !requiredSocialsConnected &&
    !connectPromptDismissedLocal && !isConnectPromptDismissed(mintAddress);

  // ON-CHAIN SELF-HEAL — an agent minted under a synthetic `vello_…` id (its real
  // Metaplex mint failed, e.g. the suspended Helius devnet RPC) is functional in
  // the app but has NO on-chain NFT. Prefer the authoritative on-chain mint from
  // the influencer record (nftMintAddress), and if none exists yet, auto-complete
  // the real mint in the background via /api/agents/complete-onchain-mint. This
  // turns a permanent "On-chain NFT mint pending" badge into a real mint + link.
  const nftLooksReal = (s: string | null | undefined) =>
    !!s && s.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s) && !s.startsWith("vello_");
  const recordNftMint = influencerRecord?.nftMintAddress ?? "";
  const [healMint, setHealMint] = useState<string | null>(null);
  const [healExplorer, setHealExplorer] = useState<string | null>(null);
  const [healing, setHealing] = useState(false);
  const [healError, setHealError] = useState<string | null>(null);
  const healRanRef = useRef<string | null>(null);
  // The on-chain mint that ACTUALLY exists: real blueprint mint, else a recorded
  // nftMintAddress, else the mint just completed by the self-heal.
  const onchainMint = isRealMint ? mintAddress : (healMint ?? (nftLooksReal(recordNftMint) ? recordNftMint : ""));
  const isOnchainMinted = isMinted && !!onchainMint;

  // Working explorer link to the real NFT (stored url if present, else built from
  // the real base58 mint). Null when no on-chain NFT exists (synthetic id).
  const nftLink = onchainMint
    ? (healExplorer ?? nftExplorerUrl ?? getAccountExplorerUrl(onchainMint))
    : null;

  // ON-CHAIN NFT SELF-HEAL — minted under a synthetic id (real mint failed, e.g.
  // the suspended Helius devnet RPC). Fire the real Metaplex mint ONCE per mount
  // and record it; on success the badge flips to "Live on Solana" with a working
  // explorer link. Idempotent server-side (skips when nftMintAddress already set),
  // and no-op when the agent is already on-chain.
  const heal = useCallback(async () => {
    if (!mintAddress) return;
    setHealing(true);
    setHealError(null);
    try {
      const res = await fetch("/api/agents/complete-onchain-mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; nftMintAddress?: string; explorerUrl?: string; error?: string };
      if (d?.ok && d.nftMintAddress) {
        setHealMint(d.nftMintAddress);
        setHealExplorer(d.explorerUrl ?? null);
      } else {
        setHealError(d?.error ?? "Could not complete the on-chain mint. Try again.");
      }
    } catch {
      setHealError("Could not complete the on-chain mint. Try again.");
    } finally {
      setHealing(false);
    }
  }, [mintAddress]);

  useEffect(() => {
    if (!isMinted || isOnchainMinted) return;
    if (healRanRef.current === mintAddress) return;
    healRanRef.current = mintAddress;
    void heal();
  }, [isMinted, isOnchainMinted, mintAddress, heal]);


  // Chat canvas_* actions bump forceClipTab → pull the operator to the canvas.
  // Guarded on isClipping: other agent types have no "clipping" tab to show.
  useEffect(() => {
    if (props.forceClipTab && isClipping) setActiveTab("editor");
  }, [props.forceClipTab, isClipping]);

  // AUTO-BACKFILL: old clips that only ever lived in this browser's localStorage
  // (predating the /api/clips/record write path) get pushed into the Convex
  // `clips` table the moment the owner opens their minted agent — no Sync button.
  // Idempotent: backfillLocalClips only POSTs entries lacking the `syncedToDb`
  // flag and stamps them after success, so once synced this is a no-op. The ref
  // pins per-mint to fire once per mount; cleared on failure so a later mount
  // (or a re-auth via the SIWS retry interceptor) can retry. historyKey for a
  // minted agent === mintAddress (see the ClipHistory call sites).
  const backfilledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isRealMint || !mintAddress) return;
    if (backfilledRef.current === mintAddress) return;
    if (unsyncedClips(mintAddress).length === 0) return;
    backfilledRef.current = mintAddress;
    backfillLocalClips(mintAddress, mintAddress).catch(() => {
      backfilledRef.current = null; // allow a retry on a later mount
    });
  }, [isRealMint, mintAddress]);

  // Live USDC + SOL balance fetch — refreshes every 30s
  useEffect(() => {
    if (!agentWallet) { setLiveWallet(null); return; }
    let cancelled = false;
    const fetchBalance = async () => {
      setWalletLoading(true);
      try {
        const res = await fetch(`/api/agent-wallet-balance?wallet=${agentWallet}`);
        const data = await res.json() as { ok?: boolean; usdc?: number; sol?: number };
        if (!cancelled && data.ok) setLiveWallet({ usdc: data.usdc ?? 0, sol: data.sol ?? 0 });
      } catch { /* silent */ }
      finally { if (!cancelled) setWalletLoading(false); }
    };
    void fetchBalance();
    const id = setInterval(fetchBalance, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [agentWallet]);

  // Token cost = daily skill burn rate
  const installedSkills = blueprint.installedSkills ?? [];
  const dailyTokenCost = useMemo(() => estimateDailyBurn(installedSkills), [installedSkills]);

  // Runway from LIVE wallet, not stale blueprint snapshot
  const onChainBalance = liveWallet?.usdc ?? blueprint.wallet?.balanceUsdc ?? 0;

  // Live wallet ledger from Convex — recomputes whenever any task changes status/cost
  const ledger = useQuery(
    api.agentTasks.walletLedger,
    mintAddress ? { mintAddress } : "skip",
  );
  // Service spend (clips + tasks) meters into usageLedger / the agent's tab — NOT
  // into agentTasks (clippers create no tasks), so read it directly. The Earnings
  // "Spent" row previously read agentTasks.walletLedger → $0 for clippers.
  const serviceSpend = useQuery(
    api.usage.serviceSpendQuery,
    mintAddress ? { mintAddress } : "skip",
  );
  // Agent economic account (+ derived NAV) — needed for the share-backed floor in
  // the withdraw safe-amount. null/0 shares for the common clipper case.
  const agentAccountNav = useQuery(
    api.agentAccount.getWithNav,
    mintAddress ? { mintAddress } : "skip",
  ) as { sharesOutstanding?: number; navPerShare?: number } | null | undefined;
  const reserved = ledger?.reserved ?? 0;
  const revenue = ledger?.revenue ?? 0;
  const unsettledTab = serviceSpend?.unsettledTabUsdc ?? 0;
  const settledToTreasury = serviceSpend?.settledToTreasuryUsdc ?? 0;
  // Booked-but-not-yet-swept fees (settleTab has zeroed the tab, but the on-chain
  // sweep hasn't landed) — still sitting in the wallet, so subtract from Available.
  const pendingSettlement = serviceSpend?.pendingSettlementUsdc ?? 0;
  // Lifetime metered spend (clips + tasks); fall back to the task ledger while the
  // service-spend query is loading.
  const spent = serviceSpend?.totalSpentUsdc ?? ledger?.spent ?? 0;
  // Available = real on-chain − the still-owed tab − booked-but-unswept fees
  // (settled fees already left the wallet, swept to the treasury) − in-flight
  // reservations. unsettledTab and pendingSettlement are disjoint (settleTab
  // zeroes the tab when it books the settlement), so no double-subtraction.
  const liveBalance = Math.max(0, onChainBalance - unsettledTab - pendingSettlement - reserved);
  // Safe WITHDRAWABLE = liveBalance minus the share-backed (investor+founder)
  // floor: pooled capital that backs NAV can't be withdrawn without breaking
  // redeemShares liquidity. The server recomputes this authoritatively (against a
  // fresh strict on-chain read via computeSafeWithdrawable) — this is only the
  // client-side max/enable gate, and it MUST match the server or the button lies.
  // The floor is 0 (mirrors the server) when EITHER:
  //   (1) Invest is globally OFF → zero external share buyers to protect, so nothing
  //       is share-backed. Without this the floor equalled the WHOLE escrow (because
  //       navPerShare = (escrow − tab)/shares) and disabled Withdraw for every solo
  //       clipper — the bug this fixes; or
  //   (2) sharesOutstanding is dust (< MIN_SHARES_FOR_FLOOR whole shares) → a founder
  //       earnings-credit artifact, not protectable capital.
  const sharesOutstanding = agentAccountNav?.sharesOutstanding ?? 0;
  const navPerShareVal = agentAccountNav?.navPerShare ?? 0;
  const shareFloorApplies = investEnabled() && sharesOutstanding >= MIN_SHARES_FOR_FLOOR;
  const shareBackedFloor = shareFloorApplies ? sharesOutstanding * navPerShareVal : 0;
  const safeWithdrawable = Math.max(0, onChainBalance - unsettledTab - pendingSettlement - reserved - shareBackedFloor);
  // Withdraw destination = the wallet that owns this agent (creatorWallet). Server
  // is the source of truth; this is display + a fallback to the connected wallet.
  const ownerWallet = (influencerRecord as { creatorWallet?: string } | null | undefined)?.creatorWallet ?? publicKey?.toBase58();
  const liveRunwayDays = dailyTokenCost > 0 ? liveBalance / dailyTokenCost : null;
  const runwayWarn = liveRunwayDays != null && liveRunwayDays < 7;
  const generations = useQuery(
    api.agentTasks.listGenerations,
    mintAddress ? { mintAddress } : "skip",
  );
  // Joined Vello campaigns + their submissions (reactive) — shown in Generations.
  const campaignSubmissions = useQuery(
    api.submissions.listByInfluencer,
    mintAddress ? { influencerMint: mintAddress } : "skip",
  );
  // Real-time Clipping pipeline output for the Generations tab — the header
  // "Clip" button (VideoEditorTab) kicks off a real clip_source run and lands
  // here; these rows go rendering → ready live via Convex reactivity, so the
  // freshly-clipped cards animate in instead of needing a page reload. Clips
  // live in their own table (not agentTasks — see convex/clipJobs.ts), so this
  // is a second, separate query merged into the panel below.
  const clipsForMint = useQuery(
    api.clipJobs.listClipsByMint,
    mintAddress ? { mintAddress } : "skip",
  );

  // Document editor state
  const [editingDoc, setEditingDoc] = useState<{ _id: string; title: string; content: string; tags: string[] } | null>(null);
  // Tasks list — show the 5 next-to-run by default, expand to all on demand.
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);
  // Copy-feedback for the agent wallet address in the Earnings card.
  const [copiedAddr, setCopiedAddr] = useState(false);

  // ── Classic Home (legacy) vs V2 cockpit Home (default for every agent) ───────
  // The V2 operator cockpit (black glass, Apple-minimal) is now the Home for
  // BOTH clipper and influencer agents — the old light-paper CLASSIC Home (Voice
  // & Tone, User Onboarding, Documents, "Talk to <agent>", visible Skills list)
  // is kept only as an escape hatch via ?home=classic / localStorage "vello.home",
  // never the default.
  const [homeClassic, setHomeClassic] = useState(false);
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("home") === "classic";
      const fromLs = window.localStorage.getItem("vello.home") === "classic";
      setHomeClassic(fromUrl || fromLs);
    } catch { /* SSR / no-DOM, keep the cockpit default */ }
  }, [isClipping]);
  // Usage-detail modal (opened from the Earnings panel's "Usage details" button).
  const [usageOpen, setUsageOpen] = useState(false);
  // Split the installed clip skills into the two Home buckets (editing effects vs
  // agent-side targeting/discovery). Skill-file titles improve the editing labels.
  const skillFileTitles = useMemo(() => {
    const out: Record<string, string> = {};
    (skillFiles ?? []).forEach((f) => { if (f.title) out[f.skillId] = f.title; });
    return out;
  }, [skillFiles]);
  const splitSkills = useMemo(
    () => splitInstalledSkills(installedSkills, skillFileTitles),
    [installedSkills, skillFileTitles],
  );
  // Runnable autonomous task cards for the V2 post-mint run-panel: drop the dead
  // non-runnable "Clip a video" pointer (runOrder 0 / no runnable), keep Scout /
  // Self-reflect / Research. buildTaskFeed already sorts by runOrder.
  const runnableTasks = useMemo(
    () => tasks.filter((t) => t.runnable && (t.runOrder ?? 0) > 0),
    [tasks],
  );

  // Live tasks (pending + running) — Convex auto-reacts so the UI updates
  // as the server marks each task as it progresses.
  const allTasks = useQuery(
    api.agentTasks.listByMint,
    mintAddress ? { mintAddress, limit: 20 } : "skip",
  );

  // Tick every 1s while any recently-completed task is still in the celebration
  // window. Without this, the useMemo doesn't re-evaluate after the 8s expires,
  // so done tasks linger forever until the next Convex push.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!allTasks) return;
    const now = Date.now();
    const hasCelebrating = allTasks.some((t: Doc<"agentTasks">) =>
      (t.status === "succeeded" || t.status === "failed") &&
      t.completedAt && (now - t.completedAt) < 8000
    );
    if (!hasCelebrating) return;
    const id = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(id);
  }, [allTasks]);

  const liveTasks = useMemo(() => {
    if (!allTasks) return [] as Array<{ _id: string; _creationTime: number; type: string; title: string; status: string; startedAt?: number; completedAt?: number; output?: string }>;
    const now = Date.now();
    // Cap: a "pending"/"running" task older than 15 min is almost certainly
    // a stuck/crashed task — hide it so the strip stays dynamic.
    const STALE_AFTER_MS = 15 * 60_000;
    return allTasks
      .filter((t: Doc<"agentTasks">) => {
        const inFlight = t.status === "pending" || t.status === "running" || t.status === "awaiting_approval";
        if (inFlight) {
          const age = now - (t.startedAt ?? t._creationTime);
          return age < STALE_AFTER_MS;
        }
        // Brief 5s celebration window for just-finished tasks, then they vanish.
        if ((t.status === "succeeded" || t.status === "failed") && t.completedAt && now - t.completedAt < 5000) {
          return true;
        }
        return false;
      })
      // `allTasks` arrives newest-first (listByMint orders desc). Re-sort ascending
      // so the strip reads in EXECUTION order — the first task the agent created
      // runs first and sits first ("above to below" / left-to-right).
      .sort((a: Doc<"agentTasks">, b: Doc<"agentTasks">) => a._creationTime - b._creationTime);
    // tick is intentional — re-run filter every second to drop expired entries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTasks, tick]);

  useEffect(() => {
    props.onTabController?.((id) => {
      if (!isClipping && (id === "videos" || id === "carousel")) { setGenMode(id === "videos" ? "video" : "carousel"); setActiveTab("generate"); return; }
      setActiveTab(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onTabController, isClipping]);

  const TABS = [
    { id: "home" as const,        label: "Home",                icon: Home },
    ...(isClipping ? [
      // Old node-canvas "Clipping" tab hidden — the Editor tab replaces it and
      // takes over the name (id stays "editor" so routing/deep links keep working).
      { id: "editor" as const,      label: "Clipping",    icon: Scissors },
      { id: "work" as const,        label: "Work",        icon: Briefcase },
      // App Store tab hidden per request — the marketplace route still exists.
      { id: "carousel" as const, label: "Carousel", icon: GalleryHorizontal },
      { id: "renderstudio" as const, label: "Render Studio", icon: Clapperboard },
      // Library + Downloads tabs hidden — clips are surfaced under Posting; raw
      // downloaded sources are reachable from the Editor's Videos panel instead.
      { id: "posting" as const,     label: "Schedule",    icon: CalendarClock },
    ] : []),
    // Director + Schedule are INFLUENCER-only. Director tunes Veo video styling;
    // Schedule holds the posting calendar + connect-socials (clippers have these
    // under their own Posting tab). Both are hidden for clipper agents.
    ...(isClipping ? [] : [
      { id: "character" as const, label: "Character", icon: UserRound },
      { id: "director" as const, label: "Director", icon: Film },
      { id: "ideas" as const, label: "Ideas", icon: Lightbulb },
      { id: "editor" as const, label: "Editor", icon: Scissors },
      { id: "generate" as const, label: "Generate", icon: ImagePlus },
      // Series + App Store tabs hidden per request; series data stays
      // reachable through the Director.
      { id: "learn" as const, label: "Learn", icon: BookOpen },
      { id: "schedule" as const, label: "Schedule", icon: CalendarClock },
    ]),
    // Tasks + Budget tabs hidden per request (still reachable via their
    // underlying data/components if a future request re-adds them).
    { id: "generations" as const, label: "Generations",          icon: Layers },
  ];

  // Chat open_tab → switch to any tab that EXISTS for this agent (post-mint; Home
  // always allowed). A hallucinated or pre-mint-locked id is ignored — it would
  // only show the lock panel. nonce in the dep re-fires even for a repeat tab.
  useEffect(() => {
    const ft = props.forceWorkspaceTab;
    if (!ft) return;
    // "schedule" is the influencer tab id; clippers hold the same posting
    // calendar under "posting" (labeled "Schedule" in their tab bar). Callers
    // that don't know the agent's type (e.g. /home's Recent Clips deep link)
    // always request "schedule" — alias it here so it lands correctly either way.
    let requested: string = ft.tab === "schedule" && isClipping ? "posting" : ft.tab;
    // Photos / Videos / Carousel are one "Generate" page for influencers.
    if (!isClipping && (requested === "videos" || requested === "carousel")) { setGenMode(requested === "videos" ? "video" : "carousel"); requested = "generate"; }
    const ids = TABS.map((t) => t.id) as string[];
    if (ids.includes(requested) && (isMinted || requested === "home")) setActiveTab(requested as typeof activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.forceWorkspaceTab]);

  // ── KEEP-ALIVE TAB CONTENT ──────────────────────────────────────────────
  // Every VISITED tab stays mounted and is merely hidden with CSS when
  // inactive, so typed text, selections and scroll positions survive tab
  // switches (the old AnimatePresence mode="wait" chain unmounted the whole
  // tab on every switch, wiping all local state). Un-visited tabs still
  // mount lazily on first open.
  const renderTabContent = (tab: typeof activeTab): React.ReactNode => (
    <>
        {(!isMinted && tab !== "home") ? (
          // Mint-first flow, BOTH agent types: every tab except Home is frozen
          // until the agent goes live. Persona setup + going live happen on
          // Home; tabs (+ the agentic copilot building them) unlock right after.
          <motion.div key="locked"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 text-center px-6"
          >
            <motion.div
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="grid size-16 place-items-center rounded-2xl border border-white/10 bg-white/5"
            >
              <Lock className="size-7 text-zinc-400" strokeWidth={1.75} />
            </motion.div>
            <div className="text-xl font-bold text-white">Go live to unlock {tab}</div>
            <p className="max-w-sm text-sm text-zinc-400">
              Finish setting up your agent&apos;s persona on the Home tab, then go live. Every other tab — including this one — unlocks the moment it&apos;s live.
            </p>

            {/* Mini walkthrough — the same 3 steps every agent takes to go
                live, each lighting up as it's actually completed (not just
                decorative), so a first-time operator knows exactly where
                they are and what's left. */}
            <div className="mt-1 flex items-center gap-2">
              {[
                { label: "Persona", done: isReady },
                { label: "Avatar", done: avatarUrls.length > 0 },
                { label: "Go live", done: false },
              ].map((step, i, arr) => (
                <div key={step.label} className="flex items-center gap-2">
                  <div className="flex flex-col items-center gap-1">
                    <motion.span
                      animate={step.done ? { scale: [1, 1.15, 1] } : {}}
                      transition={{ duration: 0.4 }}
                      className={`grid size-6 place-items-center rounded-full text-[10.5px] font-bold ${
                        step.done ? "bg-lime-400 text-lime-950" : "border border-white/15 bg-white/5 text-zinc-500"
                      }`}
                    >
                      {step.done ? <CheckCircle2 className="size-3.5" /> : i + 1}
                    </motion.span>
                    <span className={`text-[9.5px] font-medium uppercase tracking-wide ${step.done ? "text-lime-300" : "text-zinc-500"}`}>{step.label}</span>
                  </div>
                  {i < arr.length - 1 && <span className={`mb-3.5 h-px w-6 ${step.done ? "bg-lime-400/50" : "bg-white/10"}`} />}
                </div>
              ))}
            </div>

            <button type="button" onClick={() => setActiveTab("home")}
              className="mt-1 inline-flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-white px-5 py-2.5 rounded-lg transition-transform hover:-translate-y-0.5"
              style={{ background: "#65c000", boxShadow: "0 4px 0 #3d7a00" }}>
              <Rocket className="size-3.5" /> Go to Home → Go Live
            </button>
          </motion.div>
        ) : tab === "work" ? (
          <WorkTab
            mintAddress={mintAddress}
            agentType={isClipping ? "clipping" : "influencer"}
            wallet={{ onChainBalance, liveBalance, unsettledTab, safeWithdrawable, spent, revenue }}
            onDeposit={() => setDepositOpen(true)}
            onWithdraw={() => setWithdrawOpen(true)}
          />
        ) : tab === "clipping" ? (
          <motion.div key="clipping"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 min-h-0"
          >
            <ClippingFlowCanvas mintKey={mintAddress || sessionId || "draft"} mintAddress={mintAddress} sessionId={sessionId} onNavigateToPosting={() => setActiveTab("posting")} />
          </motion.div>
        ) : tab === "editor" ? (
          <motion.div key="editor"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="relative flex-1 min-h-0"
          >
            {isClipping ? (
              <VideoEditorTab mintAddress={mintAddress} sessionId={sessionId} onRunClipping={runClippingInBackground} onViewResults={viewGenerations} />
            ) : (
              <InfluencerEditorTab mintAddress={mintAddress} sessionId={sessionId} />
            )}
          </motion.div>
        ) : tab === "renderstudio" ? (
          <motion.div key="renderstudio"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="relative flex-1 min-h-0"
          >
            <RenderStudioTab mintAddress={mintAddress} agentName={displayName} avatarUrl={/^https:\/\//.test(gif ?? "") ? gif : undefined} />
          </motion.div>
        ) : tab === "marketplace" ? (
          <motion.div key="marketplace"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
          >
            <MarketplacePanel sessionId={sessionId} mintAddress={mintAddress} />
          </motion.div>
        ) : tab === "carousel" ? (
          <motion.div key="carousel"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            <PhotoCarouselTab mintAddress={isRealMint ? mintAddress : undefined} sessionId={sessionId} />
          </motion.div>
        ) : tab === "generate" ? (
          <motion.div key="generate"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            <GenerateHub mintAddress={isRealMint ? mintAddress : undefined} sessionId={sessionId} avatarUrl={gif} mode={genMode} onModeChange={setGenMode} />
          </motion.div>
        ) : tab === "videos" ? (
          <motion.div key="videos"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            <VideosTab mintAddress={isRealMint ? mintAddress : undefined} />
          </motion.div>
        ) : tab === "character" ? (
          <motion.div key="character"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            <CharacterTab mintAddress={isRealMint ? mintAddress : undefined} agentName={displayName} />
          </motion.div>
        ) : tab === "learn" ? (
          <motion.div key="learn"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            <LearnTab mintAddress={isRealMint ? mintAddress : undefined} sessionId={sessionId} />
          </motion.div>
        ) : tab === "series" ? (
          <motion.div key="series"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            <SeriesTab mintAddress={isRealMint ? mintAddress : undefined} />
          </motion.div>
        ) : tab === "history" ? (
          <motion.div key="history"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto nb-body"
          >
            {/* Clips are keyed by mintAddress in the DB regardless of whether the
                agent has a real on-chain mint yet (many run on a synthetic
                "vello_"-prefixed id), gating this on isRealMint hid every clip
                for those agents even though listClipsByMint resolves them fine. */}
            <ClipHistory historyKey={mintAddress || sessionId || "draft"} mintAddress={mintAddress || undefined} />
          </motion.div>
        ) : tab === "library" ? (
          <motion.div key="library"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto nb-body"
          >
            <ClipLibrary sessionId={sessionId} mintAddress={mintAddress} />
          </motion.div>
        ) : tab === "posting" ? (
          <motion.div key="posting"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            <PostingTab mintAddress={mintAddress} sessionId={sessionId} />
          </motion.div>
        ) : tab === "downloads" ? (
          <motion.div key="downloads"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto nb-body"
          >
            <DownloadsTab mintAddress={mintAddress} />
          </motion.div>
        ) : tab === "tasks" ? (
          <motion.div key="tasks"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto nb-body"
          >
            <TaskHistoryPanel tasks={allTasks ?? []} agentName={displayName} gif={gif} />
          </motion.div>
        ) : tab === "budget" ? (
          <motion.div key="budget"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto nb-body"
          >
            {isClipping ? (
              <ClipperBudgetPanel balance={liveBalance} mintAddress={mintAddress} sessionId={sessionId} />
            ) : (
              <BudgetProjectionsPanel
                balance={liveBalance}
                dailySkillCost={dailyTokenCost}
                currentEngineId={(blueprint.videoEngine ?? DEFAULT_VIDEO_ENGINE) as VideoEngineId}
              />
            )}
          </motion.div>
        ) : tab === "director" ? (
          <motion.div key="director"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            <VideoDirectorTab mintAddress={mintAddress} onOnboardingComplete={() => setActiveTab("ideas")} />
          </motion.div>
        ) : tab === "ideas" ? (
          <motion.div key="ideas"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            <IdeasPanel mintAddress={mintAddress} />
          </motion.div>
        ) : tab === "schedule" ? (
          <motion.div key="schedule"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            {/* Same structured posting surface as the clipper's Posting tab, status
                strip, Auto-post toggle, schedule controls (spacing/cap/order/timezone),
                channels + connect socials, but the right pane shows the influencer's
                scheduled/generated VIDEOS (SchedulePanel), since influencers have
                generated videos, not clips. */}
            <PostingTab
              mintAddress={mintAddress}
              sessionId={sessionId}
              variant="influencer"
              rightPane={<SchedulePanel mintAddress={mintAddress} />}
            />
          </motion.div>
        ) : tab === "appstore" ? (
          <motion.div key="appstore"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto nb-body"
          >
            <AppStoreTab
              installedSkills={installedSkills}
              onToggleSkill={(id, install) => props.onToggleSkill?.(id, install)}
              mintAddress={mintAddress}
            />
          </motion.div>
        ) : tab === "generations" ? (
          <motion.div key="generations"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
            style={WARM_GLASS_BG}
          >
            {isClipping ? (
              <section className="max-w-[1280px] mx-auto px-6 py-8" style={{ ...WARM_GLASS_BG, minHeight: "100%" }}>
                <div className="mb-4"><TabPageHeader icon={Layers} title="Clips" blurb="Every clip this agent has generated." /></div>
                {/* Live job monitor, only shows while a run is active/errored; a
                    finished job clears itself instead of leaving a stale "complete"
                    banner sitting above the gallery. */}
                <div className="mb-5 empty:hidden">
                  <ClipJobProgress mintAddress={mintAddress} variant="full" hideWhenIdle />
                </div>
                {/* Every generated clip, as the History grid. The per-clip ROW list
                    (ClipsQueue) used to sit above this and showed the same videos a
                    second time, one gallery, not two. Acting on a clip (post now,
                    skip, delete) lives in the Posting tab's feed, which is where an
                    operator goes to publish. */}
                <ClipHistory historyKey={mintAddress || sessionId || "draft"} mintAddress={mintAddress || undefined} agentName={displayName} />
              </section>
            ) : (
              <GenerationsPanel generations={generations} clips={clipsForMint} submissions={campaignSubmissions} agentName={displayName} gif={gif} mintAddress={mintAddress} />
            )}
          </motion.div>
        ) : (
          <motion.div key="home"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
          >
    {/* ── V2 OPERATOR COCKPIT (default) ───────────────────────────────────────
        The new two-column cockpit Home. Reuses the same in-scope state/handlers
        as the classic Home below. ?home=classic / localStorage "vello.home" flips
        to the preserved classic Home instead. */}
    {!homeClassic && (
      <ClipperHomeCockpit
        displayName={displayName}
        tagline={tagline}
        gif={gif}
        isMinted={isMinted}
        isReady={isReady}
        isOnchainMinted={isOnchainMinted}
        healing={healing}
        healError={healError}
        onHeal={() => void heal()}
        nftLink={nftLink}
        isClipping={isClipping}
        onDeploy={onDeploy}
        onTestAgent={onTestAgent}
        onConnectWallet={onConnectWallet}
        setActiveTab={setActiveTab}
        onStartClipping={() => setActiveTab("editor")}
        persona={p}
        agentWallet={agentWallet}
        onChainBalance={onChainBalance}
        liveBalance={liveBalance}
        spent={spent}
        revenue={revenue}
        reserved={reserved}
        settledToTreasury={settledToTreasury}
        unsettledTab={unsettledTab}
        pendingSettlement={pendingSettlement}
        dailyTokenCost={dailyTokenCost}
        liveRunwayDays={liveRunwayDays}
        runwayWarn={runwayWarn}
        walletLoading={walletLoading}
        liveWallet={liveWallet}
        copiedAddr={copiedAddr}
        setCopiedAddr={setCopiedAddr}
        depositOpen={depositOpen}
        setDepositOpen={setDepositOpen}
        withdrawOpen={withdrawOpen}
        setWithdrawOpen={setWithdrawOpen}
        safeWithdrawable={safeWithdrawable}
        ownerWallet={ownerWallet}
        setLiveWallet={setLiveWallet}
        mintAddress={mintAddress}
        installedSkills={installedSkills}
        splitSkills={splitSkills}
        knowledgeCount={knowledgeCount}
        lessonsRetained={lessonsRetained}
        conversationsLearned={conversationsLearned}
        onUploadKnowledge={onUploadKnowledge}
        onOpenSkillsBrowse={() => setMarketplaceOpen(true)}
        onOpenUsage={() => setUsageOpen(true)}
        runnableTasks={runnableTasks}
        blueprint={blueprint}
        allTasks={allTasks ?? []}
        liveTasks={liveTasks}
        socialConnected={installedSkills.includes("social.uploadpost")}
        sessionId={sessionId}
        characterBible={characterBible}
        onHeartbeatChange={props.onHeartbeatChange}
        onFireHeartbeat={props.onFireHeartbeat}
        onAutoFireHeartbeat={props.onAutoFireHeartbeat}
      />
    )}

    {/* ── CLASSIC HOME (preserved, byte-for-byte) ─────────────────────────────
        The original inline Home, kept untouched as the instant-restore backup.
        Wrapped in the homeClassic guard ONLY, nothing inside is altered. */}
    {homeClassic && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="w-full nb-body"
      style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}
    >
      <div className="max-w-[1280px] mx-auto px-6 py-8 grid grid-cols-12 gap-6">

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* COLUMN 1, Identity + Living Memory + Earnings                      */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        <section className="nb-reveal col-span-12 md:col-span-3 flex flex-col gap-6">
          {/* Identity hero */}
          <div>
            <SectionHeading>{displayName}</SectionHeading>

            <div className="flex gap-4 items-start">
              <div className="size-[88px] rounded-lg overflow-hidden bg-zinc-100 border border-zinc-300/70 shrink-0">
                {gif ? (
                  <SafeProfileImage src={gif} name={displayName} />
                ) : isMinted ? (
                  <AvatarFallback name={displayName} />
                ) : (
                  <BuildingPlaceholder />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-serif text-[20px] leading-[1.15] text-zinc-900">
                  {isOnchainMinted ? "Live on Solana" : isMinted ? "Live" : isReady ? "Ready to Go Live" : "Configuring"}
                </h3>
                <p className="text-[11.5px] text-zinc-500 leading-snug mt-1">{tagline}</p>
                {/* NFT explorer link hidden by request, on-chain minted shows nothing here */}
                {isOnchainMinted && nftLink ? null : isMinted ? (
                  // No real on-chain NFT recorded yet — the self-heal mints one in
                  // the background; give a live status + a manual retry so it never
                  // sits as a dead "pending" badge.
                  <span className="mt-1.5 inline-flex items-center gap-2 text-[11px] font-medium">
                    {healing ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin text-amber-600" />
                        <span className="text-amber-600">Going live on-chain…</span>
                      </>
                    ) : healMint ? (
                      <span className="text-emerald-700">◆ Live on Solana ✓</span>
                    ) : (
                      <>
                        <span className="text-amber-600">⚠ Not on-chain yet</span>
                        <button
                          type="button"
                          onClick={() => void heal()}
                          className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 hover:bg-amber-200 font-semibold transition-colors"
                        >
                          Go live now
                        </button>
                      </>
                    )}
                    {healError && <span className="text-rose-600">{healError}</span>}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-5">
              {!isMinted ? (
                // Mint is chat-gated (avatars → mint card) — this CTA kicks the
                // chat flow instead of being a dead button.
                <PrimaryButton variant="glass" disabled={!isReady} onClick={onDeploy}>
                  {isReady ? "Deploy Agent" : "Configure First"}
                </PrimaryButton>
              ) : (
                <button
                  type="button"
                  // Clippers don't do `create_video` — their work is the clip
                  // pipeline on the canvas. Send them to the Clipping tab; other
                  // agent types fire the test-task pipeline.
                  onClick={isClipping ? () => setActiveTab("editor") : onTestAgent}
                  className="w-full select-none font-mono text-[12px] font-black tracking-[0.18em] uppercase text-white py-3 transition-transform active:translate-y-[2px]"
                  style={{
                    background: "#65c000",
                    boxShadow: "0 4px 0 #3d7a00",
                    borderRadius: "10px",
                  }}
                  onMouseDown={e => (e.currentTarget.style.boxShadow = "0 2px 0 #3d7a00")}
                  onMouseUp={e => (e.currentTarget.style.boxShadow = "0 4px 0 #3d7a00")}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 4px 0 #3d7a00")}
                >
                  {isClipping ? "▶ START CLIPPING" : "▶ Run Agent"}
                </button>
              )}
            </div>
          </div>

          {/* Autonomous clipping, the money-spending self-run loop. Clip agents only. */}
          {isClipping && isMinted && (
            <AutoClipToggle
              mintAddress={mintAddress}
              enabled={(influencerRecord as { autoClipEnabled?: boolean } | null | undefined)?.autoClipEnabled ?? false}
            />
          )}

          {/* Earnings, moved here right after Run Agent button */}
          <div>
            <SectionHeading>Earnings</SectionHeading>
            {isMinted ? (
              <PaperCard className="divide-y divide-zinc-200/70">
                {/* Agent wallet address, copy to fund it directly */}
                {agentWallet && (
                  <div className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-[13px] text-zinc-500 w-4 text-center font-mono leading-none">⬡</span>
                        <span className="font-mono text-[12px] text-zinc-700 truncate" title={agentWallet}>
                          {agentWallet.slice(0, 6)}…{agentWallet.slice(-6)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(agentWallet);
                              setCopiedAddr(true);
                              setTimeout(() => setCopiedAddr(false), 1800);
                            } catch { /* ignore */ }
                          }}
                          title="Copy agent wallet address"
                          aria-label="Copy agent wallet address"
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 ${
                            copiedAddr ? "bg-emerald-100 text-emerald-700" : "border border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50"
                          }`}
                        >
                          {copiedAddr ? <><CheckCircle2 className="size-3" aria-hidden /> Copied</> : <><Copy className="size-3" aria-hidden /> Copy</>}
                        </button>
                        <a
                          href={getAccountExplorerUrl(agentWallet)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View on explorer"
                          aria-label="View agent wallet on explorer"
                          className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40"
                        >
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-1 pl-[26px] leading-snug">
                      Send USDC/SOL here to fund the agent, or just say “fund the wallet” in chat.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDepositOpen(true)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold py-2 transition-colors"
                      >
                        <ArrowDownToLine className="size-3.5" aria-hidden /> Deposit
                      </button>
                      <button
                        type="button"
                        onClick={() => setWithdrawOpen(true)}
                        disabled={safeWithdrawable <= 0}
                        title={safeWithdrawable <= 0 ? "Nothing available to withdraw yet" : "Withdraw to your wallet"}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 text-[12px] font-bold py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ArrowUpFromLine className="size-3.5" aria-hidden /> Withdraw
                      </button>
                    </div>
                    <DepositModal
                      open={depositOpen}
                      agentName={displayName}
                      agentWallet={agentWallet}
                      onClose={() => setDepositOpen(false)}
                      onFunded={(bal) => setLiveWallet(bal)}
                    />
                    <WithdrawModal
                      open={withdrawOpen}
                      agentName={displayName}
                      agentWallet={agentWallet}
                      ownerWallet={ownerWallet}
                      mintAddress={mintAddress}
                      safeWithdrawable={safeWithdrawable}
                      onClose={() => setWithdrawOpen(false)}
                      onWithdrawn={(bal) => setLiveWallet(bal)}
                    />
                  </div>
                )}
                {/* On-chain balance */}
                <div className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] text-zinc-500 w-4 text-center font-mono leading-none">◎</span>
                    <span className="text-[13px] text-zinc-800 font-medium">On-chain</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {walletLoading && !liveWallet && <span className="size-1.5 rounded-full bg-zinc-400 animate-pulse" />}
                    <span className={`text-[13px] font-mono font-bold tabular-nums ${onChainBalance > 0 ? "text-zinc-900" : "text-zinc-400"}`}>
                      ${formatUsdc6(onChainBalance)}
                    </span>
                  </div>
                </div>

                {/* Reserved (in-flight), animated when active */}
                {reserved > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="px-4 py-2.5 flex items-center justify-between bg-amber-50/40"
                  >
                    <div className="flex items-center gap-2.5">
                      <motion.span
                        className="text-[13px] text-amber-600 w-4 text-center font-mono leading-none"
                        animate={{ opacity: [1, 0.4, 1] }}
                        transition={{ duration: 1.4, repeat: Infinity }}
                      >⟳</motion.span>
                      <span className="text-[13px] text-zinc-800 font-medium">Reserved</span>
                    </div>
                    <span className="text-[13px] font-mono font-bold tabular-nums text-amber-700">−${formatUsdc6(reserved)}</span>
                  </motion.div>
                )}

                {/* Total spent (lifetime metered: clip renders, transcription, tasks) */}
                <div className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] text-rose-600 w-4 text-center font-mono leading-none">−</span>
                    <span className="text-[13px] text-zinc-800 font-medium">Spent</span>
                  </div>
                  <span className={`text-[13px] font-mono font-bold tabular-nums ${spent > 0 ? "text-rose-700" : "text-zinc-400"}`}>
                    ${formatUsdc6(spent)}
                  </span>
                </div>

                {/* Swept on-chain to the platform treasury (settled service fees) */}
                {settledToTreasury > 0 && (
                  <div className="px-4 py-2 flex items-center justify-between bg-violet-50/40">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[13px] text-violet-600 w-4 text-center font-mono leading-none">⟶</span>
                      <span className="text-[12px] text-zinc-700">Paid to treasury</span>
                    </div>
                    <span className="text-[12px] font-mono font-semibold tabular-nums text-violet-700">${formatUsdc6(settledToTreasury)}</span>
                  </div>
                )}
                {unsettledTab > 0 && (
                  <div className="px-4 py-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[11px] text-zinc-400 w-4 text-center font-mono leading-none">⟳</span>
                      <span className="text-[11px] text-zinc-500">Pending sweep to treasury</span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-zinc-500">${formatUsdc6(unsettledTab)}</span>
                  </div>
                )}
                {/* Booked-but-unswept fees, held back from Available so the
                    On-chain vs Available gap is never unexplained. */}
                {pendingSettlement > 0 && (
                  <div className="px-4 py-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[11px] text-zinc-400 w-4 text-center font-mono leading-none">⟳</span>
                      <span className="text-[11px] text-zinc-500">Pending settlement</span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-zinc-500">−${formatUsdc6(pendingSettlement)}</span>
                  </div>
                )}

                {/* Available, derived: on-chain - spent - reserved */}
                <motion.div
                  layout
                  className="px-4 py-2.5 flex items-center justify-between bg-emerald-50/40"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] text-emerald-700 w-4 text-center font-mono leading-none font-bold">=</span>
                    <span className="text-[13px] text-zinc-900 font-semibold">Available</span>
                  </div>
                  <motion.span
                    key={liveBalance.toFixed(2)}
                    initial={{ scale: 1.15, color: "#15803d" }}
                    animate={{ scale: 1, color: liveBalance > 0 ? "#15803d" : "#a3a3a3" }}
                    transition={{ duration: 0.4 }}
                    className="text-[14px] font-mono font-bold tabular-nums"
                  >
                    ${formatUsdc6(liveBalance)}
                  </motion.span>
                </motion.div>

                {liveWallet && liveWallet.sol > 0 && (
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[13px] text-zinc-500 w-4 text-center font-mono leading-none">◈</span>
                      <span className="text-[13px] text-zinc-800 font-medium">SOL (gas)</span>
                    </div>
                    <span className="text-[13px] font-mono font-bold tabular-nums text-zinc-700">
                      {liveWallet.sol.toFixed(4)}
                    </span>
                  </div>
                )}

                <div className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] text-zinc-500 w-4 text-center font-mono leading-none">⚡</span>
                    <span className="text-[13px] text-zinc-800 font-medium">Burn rate</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[13px] font-mono font-bold tabular-nums text-zinc-900">${dailyTokenCost.toFixed(2)}</span>
                    <span className="text-[10.5px] font-mono text-zinc-500 ml-1">/day</span>
                  </div>
                </div>

                <div className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={`text-[13px] w-4 text-center font-mono leading-none ${runwayWarn ? "text-rose-600" : "text-zinc-500"}`}>⏳</span>
                    <span className="text-[13px] text-zinc-800 font-medium">Runway</span>
                  </div>
                  <span className={`text-[13px] font-mono font-bold tabular-nums ${runwayWarn ? "text-rose-700" : liveRunwayDays != null ? "text-zinc-900" : "text-zinc-400"}`}>
                    {liveRunwayDays != null
                      ? liveRunwayDays > 365 ? "∞" : `${Math.floor(liveRunwayDays)}d`
                      : dailyTokenCost === 0 ? "∞" : "-"}
                  </span>
                </div>

                {/* Revenue earned */}
                <div className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] text-emerald-600 w-4 text-center font-mono leading-none">+</span>
                    <span className="text-[13px] text-zinc-800 font-medium">Revenue earned</span>
                  </div>
                  <span className={`text-[13px] font-mono font-bold tabular-nums ${revenue > 0 ? "text-emerald-700" : "text-zinc-400"}`}>
                    ${formatUsdc6(revenue)}
                  </span>
                </div>

                {mintAddress && <DailyCapControl mintAddress={mintAddress} />}

                {mintAddress && (
                  <RecentTxList mintAddress={mintAddress} onSeeAll={() => setUsageOpen(true)} />
                )}

                {runwayWarn && (
                  <div className="px-4 py-2 bg-rose-50/50">
                    <p className="text-[10.5px] text-rose-700 leading-snug">
                      Low runway, fund the agent wallet or remove expensive skills.
                    </p>
                  </div>
                )}
              </PaperCard>
            ) : (
              <>
                <p className="text-[13px] text-zinc-700 mb-1.5">
                  Lifetime revenue: <span className="font-mono font-bold text-zinc-900">$0.00</span>
                </p>
                <p className="text-[11px] text-zinc-500 mb-3">
                  From campaigns, brand deals, and audience subscriptions once {p.name ?? "the agent"} is live.
                </p>
                <div className="rounded-md border border-dashed border-zinc-400/70 p-3 text-center">
                  {/* Same action as the header wallet button (was a dead no-op). */}
                  <button
                    type="button"
                    onClick={onConnectWallet}
                    className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase text-zinc-800 hover:text-zinc-950 px-3 py-1.5 border border-zinc-300 rounded-md bg-white"
                  >
                    Connect Wallet
                  </button>
                  <p className="text-[10.5px] text-zinc-500 leading-snug mt-2">
                    Your wallet becomes {p.name ?? "the agent"}&apos;s builder wallet, it pays the mint
                    and automatically receives the builder&apos;s share of every payout.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Heartbeat, autonomous task scheduler. INFLUENCER-only: it runs the
              influencer autonomy planner (create_video tasks), which doesn't fit
              on-demand clipping, so it's hidden for clippers. */}
          {props.onHeartbeatChange && !isClipping && (
            <HeartbeatCard
              blueprint={blueprint}
              onHeartbeatChange={props.onHeartbeatChange}
              onTick={props.onFireHeartbeat ?? onTestAgent}
              onAutoTick={props.onAutoFireHeartbeat}
              mintAddress={blueprint.mintAddress}
              variant="paper"
              bare
              title="Heartbeat"
            />
          )}

          {/* Connectors, integrations the agent plugs into. Header styled like
              Earnings (SectionHeading + rule); the card renders headerless. */}
          {props.onToggleSkill && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <SectionHeading>Connectors</SectionHeading>
                <button
                  onClick={() => setMarketplaceOpen(true)}
                  className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-800 px-2.5 py-1 border border-zinc-300 rounded-full bg-white hover:bg-zinc-100 inline-flex items-center gap-1"
                >
                  <Plus className="size-3" /> Browse
                </button>
              </div>
              <SkillsMarketplaceCard
                blueprint={blueprint}
                variant="paper"
                onToggleSkill={props.onToggleSkill}
                sessionId={sessionId}
                hideHeader
              />
            </div>
          )}

          {/* Social Connections, panel renders its own title + refresh row (no box) */}
          {(mintAddress || sessionId) && (
            <SocialConnectionsPanel username={mintAddress || sessionId || ""} variant="paper" title="Connections" bare />
          )}

          {/* Monetization, editable cards from the Marketplace Hiring + Charge Per
              Video skills. Surface to clients on the Hire Agents page. */}
          <MonetizationCards blueprint={blueprint} mintAddress={mintAddress} />

          {/* Video Engine moved → Video Director tab (it sets the per-video price,
              so it lives next to length + budget). See VideoDirectorTab. */}

        </section>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* COLUMN 2, Build Tasks + Sample Output + Documents                  */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        <section className="nb-reveal col-span-12 md:col-span-5 flex flex-col gap-6">
          {/* Build Tasks, each runnable card hits /api/agents/run-task */}
          <div>
            <SectionHeading>{isMinted ? "Tasks" : "Build Tasks"}</SectionHeading>
            {isMinted && (
              <p className="text-[11.5px] text-zinc-600 mb-3 -mt-1">
                The agent runs these on schedule, soonest first. Run any now from its card.
              </p>
            )}
            <div className="space-y-4">
              {(showAllTasks ? tasks : tasks.slice(0, 5)).map((t) => (
                <TaskCardRunnable
                  key={t.id}
                  task={t}
                  blueprint={blueprint}
                  isMinted={isMinted}
                  recentTasks={allTasks ?? []}
                />
              ))}
            </div>
            {tasks.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllTasks((v) => !v)}
                aria-expanded={showAllTasks}
                className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-zinc-700 hover:text-zinc-950 px-3 py-1.5 border border-zinc-300 rounded-md bg-white hover:bg-zinc-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 focus-visible:ring-offset-1"
              >
                <ChevronDown className={`size-3 transition-transform duration-200 ${showAllTasks ? "rotate-180" : ""}`} />
                {showAllTasks ? "Show less" : `Show all ${tasks.length}`}
              </button>
            )}
          </div>

          {/* Sample Output / Strategy Spec, varies by agent type */}
          {isTrader ? (
            <TraderStrategySection blueprint={blueprint} sessionId={sessionId} />
          ) : (
            <div>
              <SectionHeading>User Onboarding</SectionHeading>
              <PaperCard className="p-5">
                <p className="text-[12.5px] text-zinc-600 leading-[1.55] mb-4">
                  The first message {p.name ?? "your agent"} sends to a new user. Set the tone, set expectations, and route them to the right service.
                </p>
                <div className="space-y-3">
                  {[
                    { step: "1", title: "Greeting", desc: `Hi 👋 I'm ${p.name ?? "your agent"}${p.handle ? ` (@${p.handle.replace(/^@/, "")})` : ""}, ${p.niche ? `your ${p.niche} ${p.voiceArchetype ?? "creator"}` : "happy to meet you"}.` },
                    { step: "2", title: "Value prop", desc: p.audience ? `I help ${p.audience} create scroll-stopping content and grow audiences.` : "Tell me what you're working on, I'll help you craft content that converts." },
                    { step: "3", title: "Call to action", desc: p.contentPillars?.length ? `Want me to make a ${p.contentPillars[0]} video? Just say the topic and I'll storyboard + generate it.` : "Try: 'make me a video about [topic]'." },
                  ].map(({ step, title, desc }) => (
                    <div key={step} className="flex items-start gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 w-5 shrink-0 mt-1">{step}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-serif text-[13px] font-bold text-zinc-900 leading-tight">{title}</p>
                        <p className="text-[12px] text-zinc-700 leading-[1.5] mt-0.5">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-zinc-200/70 flex items-center justify-between gap-3">
                  <p className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-zinc-500">
                    Auto-generated from persona
                  </p>
                  <button
                    onClick={() => props.onEditField("onboarding")}
                    className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase text-zinc-800 hover:text-zinc-950 px-3 py-1.5 border border-zinc-300 rounded-md bg-white hover:bg-zinc-50"
                  >
                    Edit flow
                  </button>
                </div>
              </PaperCard>
            </div>
          )}

          {/* Documents, file-manager style folder browser */}
          <div>
            <SectionHeading>Documents</SectionHeading>
            <DocumentsManager
              entries={knowledgeEntries}
              skills={skillDefs}
              skillFileMap={skillFileMap}
              onOpenDoc={(k) => setEditingDoc({ _id: String(k._id ?? k.id), title: k.title, content: k.content ?? "", tags: k.tags ?? [] })}
              onOpenSkill={(s) => setEditingSkill({ id: s.id, label: s.label, desc: s.desc, instructions: s.instructions ?? buildSkillGuide(s) })}
              onAdd={onUploadKnowledge}
            />
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* COLUMN 3, Voice, Standards, Skills, Channels                       */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        <section className="nb-reveal col-span-12 md:col-span-4 flex flex-col gap-6">
          {/* Voice & Tone, now includes Audience (merged) */}
          <div>
            <SectionHeading>Voice &amp; Tone</SectionHeading>
            <PaperCard className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Mic2 className="size-3.5 text-zinc-700" />
                <p className="font-serif text-[15px] font-bold text-zinc-900 capitalize">
                  {p.voiceArchetype ?? "Not set"}
                </p>
              </div>
              {p.catchphrase ? (
                <p className="text-[12.5px] italic text-zinc-700 leading-[1.5] border-l-2 border-zinc-900/40 pl-2.5">
                  &ldquo;{p.catchphrase}&rdquo;
                </p>
              ) : (
                <p className="text-[11.5px] text-zinc-500">Tell the agent its signature opening line.</p>
              )}

              {/* Audience (merged from its own section) */}
              <div className="mt-3 pt-3 border-t border-zinc-200/70">
                <div className="flex items-center gap-1.5 mb-1">
                  <UsersIcon className="size-3 text-zinc-500" aria-hidden />
                  <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500">Audience</p>
                </div>
                <p className="text-[12.5px] text-zinc-800 leading-[1.5]">
                  {p.audience || `Define who ${p.name ?? "this agent"} talks to, age, market, language. The clearer the audience, the sharper every post.`}
                </p>
                {p.language && (
                  <span className="mt-2 inline-block text-[11px] text-zinc-600 font-mono uppercase tracking-[0.15em]">{p.language}</span>
                )}
              </div>
            </PaperCard>
          </div>

          {/* Living Memory, container only (title removed), sits under Voice & Tone */}
          <div>
            <PaperCard className="divide-y divide-zinc-200/70">
              <LivingMemoryRow
                label="Knowledge"
                tooltip="Documents and references the agent has studied, uploaded guides, brand briefs, and pasted research. Used as context on every task."
              >
                <span className="text-[13px] font-mono font-bold tabular-nums text-zinc-900">{knowledgeCount}</span>
              </LivingMemoryRow>
              <LivingMemoryRow
                label="Lessons"
                tooltip="Things the agent has learned from running tasks, what worked, what failed, audience preferences. Auto-extracted after each completed task."
              >
                <span className="text-[13px] font-mono font-bold tabular-nums text-zinc-900">{lessonsRetained}</span>
              </LivingMemoryRow>
              <LivingMemoryRow
                label="Q&A"
                tooltip="Conversations with users that the agent remembers, questions asked, answers given. Stored as episodic memory and recalled on similar future asks."
              >
                <span className="text-[13px] font-mono font-bold tabular-nums text-zinc-900">{conversationsLearned}</span>
              </LivingMemoryRow>
              <LivingMemoryRow
                label="Teach"
                tooltip="Upload new markdown documents to the agent's knowledge base, brand voice, winning hooks, factual references. The agent reads these on every task."
              >
                <button
                  type="button"
                  onClick={onUploadKnowledge}
                  className="text-[11px] font-mono text-zinc-400 hover:text-zinc-900 transition-colors tracking-wide"
                >
                  Upload
                </button>
              </LivingMemoryRow>
            </PaperCard>
          </div>

          {/* Content Types, toggle */}
          <div>
            <SectionHeading>Content Types</SectionHeading>
            <p className="text-[11.5px] text-zinc-600 mb-3">
              What {p.name ?? "this agent"} will create. Click to toggle.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_TYPE_OPTIONS.map((t) => {
                const on = p.contentTypes?.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onToggleContentType(t)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                      on
                        ? "bg-zinc-900 text-white border-zinc-900"
                        : "bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500"
                    }`}
                  >
                    {on ? <CheckCircle2 className="size-2.5" /> : <Circle className="size-2.5" />}
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Standards */}
          <div>
            <SectionHeading>Standards</SectionHeading>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-700 mb-1.5">Will</p>
                <div className="flex flex-wrap gap-1.5">
                  {p.contentPillars?.length ? p.contentPillars.slice(0, 6).map((c) => (
                    <Chip key={c} text={c} tone="emerald" active />
                  )) : <p className="text-[11.5px] text-zinc-400">No pillars yet, tell the agent in chat.</p>}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-rose-700 mb-1.5">Won&apos;t</p>
                <div className="flex flex-wrap gap-1.5">
                  {p.avoidTopics?.length ? p.avoidTopics.slice(0, 6).map((c) => (
                    <Chip key={c} text={c} tone="rose" active />
                  )) : <p className="text-[11.5px] text-zinc-400">No avoid topics yet.</p>}
                </div>
              </div>
            </div>
          </div>

          {/* Skills */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <SectionHeading>Skills</SectionHeading>
              <button
                onClick={() => setMarketplaceOpen(true)}
                className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-800 px-2.5 py-1 border border-zinc-300 rounded-full bg-white hover:bg-zinc-100 inline-flex items-center gap-1"
              >
                <Plus className="size-3" /> Add
              </button>
            </div>
            {mergedSkills.length === 0 && (
              <div className="w-full rounded-md border border-dashed border-zinc-300 bg-white/60 px-3 py-4 text-center">
                <span className="block font-serif text-[13px] font-bold text-zinc-800">No skills yet</span>
                <span className="mt-0.5 block text-[11px] text-zinc-500">Skills appear here once the persona is set or you author one.</span>
              </div>
            )}
            <div className="space-y-1.5">
              {(showAllSkills ? mergedSkills : mergedSkills.slice(0, 5)).map((s) => {
                const file = skillFileMap.get(s.id);
                const hasMd = Boolean(file);
                const updatedAgo = file ? (() => {
                  const diff = Date.now() - file.updatedAt;
                  const min = Math.floor(diff / 60000);
                  if (min < 1) return "just now";
                  if (min < 60) return `${min}m ago`;
                  const h = Math.floor(min / 60);
                  if (h < 24) return `${h}h ago`;
                  return `${Math.floor(h / 24)}d ago`;
                })() : null;
                return (
                  <PaperCard
                    key={s.id}
                    className="px-3 py-2.5 cursor-pointer hover:translate-y-[-1px] hover:shadow-md hover:border-zinc-400 transition-all duration-150"
                  >
                    <button
                      type="button"
                      onClick={() => setEditingSkill({ id: s.id, label: s.label, desc: s.desc, instructions: s.instructions })}
                      className="w-full text-left flex items-start gap-2.5"
                    >
                      <span
                        className={`mt-1.5 inline-block size-2 rounded-full shrink-0 ${hasMd ? "bg-emerald-600" : "bg-zinc-300"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[12.5px] font-serif font-bold text-zinc-900 truncate">{s.label}</span>
                          {updatedAgo && (
                            <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500 shrink-0">edited {updatedAgo}</span>
                          )}
                        </span>
                        <span className="block text-[11px] text-zinc-500 truncate">{s.desc}</span>
                      </span>
                    </button>
                  </PaperCard>
                );
              })}
            </div>
            {mergedSkills.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllSkills((v) => !v)}
                aria-expanded={showAllSkills}
                className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-zinc-700 hover:text-zinc-950 px-3 py-1.5 border border-zinc-300 rounded-md bg-white hover:bg-zinc-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 focus-visible:ring-offset-1"
              >
                <ChevronDown className={`size-3 transition-transform duration-200 ${showAllSkills ? "rotate-180" : ""}`} />
                {showAllSkills ? "Show less" : `Show all ${mergedSkills.length}`}
              </button>
            )}
          </div>

          {/* Talk to the agent, premium direct chat */}
          {(isTrader ? t.name : p.name) && (
            <div>
              <SectionHeading>Talk to {isTrader ? t.name : p.name}</SectionHeading>
              <p className="text-[11.5px] text-zinc-600 mb-3 leading-snug">
                Chat directly with {isTrader ? t.name : p.name}. Replies use {isMinted ? "the persona locked in the NFT" : "your current draft persona"} + every knowledge file you&apos;ve added.
              </p>
              <AgentChatCard
                agentName={(isTrader ? t.name : p.name) as string}
                agentHandle={p.handle}
                avatarUrl={gif}
                mintAddress={blueprint.mintAddress}
                sessionId={sessionId}
                isMinted={isMinted}
                knowledgeCount={knowledgeEntries.length}
                voiceArchetype={isTrader ? t.strategy?.autonomy : p.voiceArchetype}
                language={p.language}
                personaSnapshot={isTrader ? {
                  name: t.name as string,
                  niche: t.strategy?.assetUniverse?.join(", "),
                  audience: "crypto investors",
                  voiceArchetype: t.strategy?.autonomy,
                  backstory: t.summary,
                  contentPillars: t.strategy?.assetUniverse,
                  characterBible: characterBible ?? t.aesthetic,
                  mintAddress: blueprint.mintAddress,
                } : {
                  name: p.name as string,
                  handle: p.handle,
                  niche: p.niche,
                  audience: p.audience,
                  language: p.language,
                  voiceArchetype: p.voiceArchetype,
                  backstory: p.backstory,
                  catchphrase: p.catchphrase,
                  traits: p.traits,
                  beliefs: p.beliefs,
                  contentPillars: p.contentPillars,
                  avoidTopics: p.avoidTopics,
                  dreamCollab: p.dreamCollab,
                  characterBible,
                  mintAddress: blueprint.mintAddress,
                }}
              />
            </div>
          )}

          {/* About Agent */}
          {(characterBible || p.backstory) && (
            <div>
              <SectionHeading>About Agent</SectionHeading>
              <PaperCard className="p-4">
                <p className="text-[12px] text-zinc-700 leading-[1.55] line-clamp-6">
                  {p.backstory || characterBible}
                </p>
              </PaperCard>
            </div>
          )}
        </section>

      </div>
    </motion.div>
    )}
          </motion.div>
        )}
    </>
  );

  return (
    // Root is DARK for both modes — AnimatePresence `mode="wait"` unmounts the
    // old tab before the new one mounts, and whatever this wrapper paints shows
    // through for that beat. It used to be .nb-body's warm beige, which read as
    // a white flash on every tab switch. Tabs that want the beige surface still
    // carry their own `nb-body` class.
    <div className="w-full h-full flex flex-col overflow-hidden bg-[#0b0b0d] text-zinc-100"
      style={{ ...(isClipping ? WARM_GLASS_BG : {}), fontFamily: "var(--font-geist-sans, system-ui)" }}
    >
      {/* Floating glass rail replaces the old top tab bar (icons only, labels on hover).
          Non-Home tabs stay locked until the agent is live. */}
      <WorkspaceRail tabs={TABS} active={activeTab} onSelect={setActiveTab} locked={!isMinted} />

      {/* Live task strip, always visible, dynamic via Convex reactivity */}
      <LiveTaskStrip tasks={liveTasks} />

      {/* Tab content — keep-alive: visited tabs stay mounted, hidden via CSS */}
      {Array.from(visitedTabs).map((vt) => (
        <div key={vt} className={vt === activeTab ? "ws-tab-enter flex-1 min-h-0 flex flex-col md:pl-[76px] max-md:pb-20" : "hidden"}>
          {renderTabContent(vt)}
        </div>
      ))}

      {editingSkill && (
        <SkillMdModal
          open
          skill={editingSkill}
          sessionId={sessionId ?? ""}
          mintAddress={blueprint.mintAddress}
          initialMarkdown={skillFileMap.get(editingSkill.id)?.markdown ?? editingSkill.instructions}
          onClose={() => setEditingSkill(null)}
        />
      )}

      <AnimatePresence>
        {marketplaceOpen && props.onToggleSkill && (
          <InfluencerSkillModal
            blueprint={blueprint}
            onToggleSkill={props.onToggleSkill}
            onClose={() => setMarketplaceOpen(false)}
            sessionId={sessionId}
            mintAddress={blueprint.mintAddress}
            onOpenMd={(s) => {
              setMarketplaceOpen(false);
              setEditingSkill(s);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingDoc && (
          <DocumentEditModal
            doc={editingDoc}
            onClose={() => setEditingDoc(null)}
          />
        )}
      </AnimatePresence>

      <ConnectSocialsPrompt
        open={showConnectPrompt}
        mintAddress={mintAddress}
        agentName={displayName || "Your agent"}
        agentType={isClipping ? "clipping" : "influencer"}
        tiktokConnected={Boolean(socialsConnected?.tiktok)}
        youtubeConnected={Boolean(socialsConnected?.youtube)}
        onClose={() => setConnectPromptDismissedLocal(true)}
        onOpenSchedule={() => setActiveTab(isClipping ? "posting" : "schedule")}
      />

      {/* Usage detail, opened from the V2 cockpit Earnings panel. Read-only. */}
      <UsageDetailModal
        open={usageOpen}
        onClose={() => setUsageOpen(false)}
        mintAddress={mintAddress || null}
        agentWallet={agentWallet}
        balanceUsdc={liveBalance}
        burnRatePerDay={dailyTokenCost}
        installedSkillIds={installedSkills}
      />
    </div>
  );
}

// ─── ClipperHomeCockpit — the V2 operator-cockpit Home ───────────────────────
//
// A two-column monitoring dashboard (mirrors components/builder/dev/HomeVariantTwo
// but wired to the REAL in-scope data/handlers, not the prototype's dummy data):
//
//   LEFT  — agent identity + the single green "Open Clipping Canvas" hero CTA, the
//           Earnings panel (reused as-is from the classic Home, plus a "Usage
//           details" button that opens UsageDetailModal), and ONE skills surface
//           split into "Editing skills" / "Agent skills", a compact "Connections"
//           row, and a single collapsed "Knowledge" surface.
//   RIGHT — the autonomous task run-panel (pre-mint onboarding checklist / post-mint
//           Scout · Self-reflect · Research run cards) + a slim recent-activity list
//           + "Full history → Tasks tab".
//
// Reuses the same in-scope state/handlers as the classic Home via props.

type CockpitTab =
  | "home" | "work" | "tasks" | "generations" | "budget" | "director" | "ideas" | "schedule" | "appstore"
  | "clipping" | "marketplace" | "library" | "history" | "posting" | "downloads";

// ─── Agent settings cog + dropdown (clipper cockpit only) ───────────────────
// A gear button on the identity card that opens a small dropdown of agent
// actions. Owner-scoped destructive/settings actions; the page is the owner's
// cockpit and the delete route re-verifies ownership server-side. Kept LOCAL to
// the clipper cockpit so the classic/influencer Home is untouched.
function ClipperSettingsItem({
  icon, label, onClick, disabled, soon, danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  soon?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "Coming soon" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] transition-colors ${
        disabled
          ? "cursor-not-allowed text-zinc-400"
          : danger
            ? "text-red-600 hover:bg-red-50"
            : "text-zinc-800 hover:bg-zinc-100"
      }`}
    >
      <span className={`shrink-0 ${danger ? "text-red-600" : disabled ? "text-zinc-300" : "text-zinc-500"}`}>{icon}</span>
      <span className="flex-1">{label}</span>
      {soon && (
        <span className="rounded-[5px] bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-amber-700">
          soon
        </span>
      )}
    </button>
  );
}

function AgentSettingsCog({
  agentName, onDelete, onDailyCap, onRename, onEditPersona, onChangeAvatar,
}: {
  agentName: string;
  onDelete: () => void;
  onDailyCap: () => void;
  onRename: () => void;
  onEditPersona: () => void;
  onChangeAvatar?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Agent settings"
        title="Agent settings"
        className="grid size-10 place-items-center rounded-xl border border-white/25 bg-white/[0.12] text-white shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.2] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <Settings className={`size-[18px] transition-transform duration-200 ${open ? "rotate-45" : ""}`} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -3 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-[46px] z-30 w-[248px] rounded-[11px] border-2 border-zinc-900 bg-white p-[5px] shadow-[5px_5px_0_0_#18181b]"
          >
            <p className="px-2.5 pb-1.5 pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Agent settings</p>
            <ClipperSettingsItem icon={<FileEdit className="size-4" />} label="Rename agent" onClick={() => { setOpen(false); onRename(); }} />
            {onChangeAvatar && <ClipperSettingsItem icon={<ImageUp className="size-4" />} label="Change profile image" onClick={() => { setOpen(false); onChangeAvatar(); }} />}
            <ClipperSettingsItem icon={<FileText className="size-4" />} label="Edit persona & knowledge" onClick={() => { setOpen(false); onEditPersona(); }} />
            <ClipperSettingsItem icon={<DollarSign className="size-4" />} label="Daily spend cap" onClick={() => { setOpen(false); onDailyCap(); }} />
            <div className="mx-1.5 my-[5px] h-px bg-zinc-200" />
            <ClipperSettingsItem danger icon={<Trash2 className="size-4" />} label="Delete agent" onClick={() => { setOpen(false); onDelete(); }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Center-crop to a square and cap at `size` px, as JPEG (PNG input with
 *  transparency keeps PNG). Rejects if the browser can't decode the image. */
function squareAvatarDataUrl(dataUrl: string, size = 768): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (!side) { reject(new Error("empty image")); return; }
      const out = Math.min(size, side);
      const canvas = document.createElement("canvas");
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("no canvas")); return; }
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
      resolve(dataUrl.startsWith("data:image/png") ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => reject(new Error("decode failed"));
    img.src = dataUrl;
  });
}

function AvatarImageModal({ open, onClose, mintAddress, agentName, currentUrl }: {
  open: boolean;
  onClose: () => void;
  mintAddress: string;
  agentName: string;
  currentUrl?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | undefined>(currentUrl);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Choose an image file."); return; }
    if (file.size > 12 * 1024 * 1024) { setError("Use an image smaller than 12 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { const value = String(reader.result ?? ""); setDataUrl(value); setPreview(value); setError(null); };
    reader.onerror = () => setError("This image could not be read.");
    reader.readAsDataURL(file);
  };
  const save = async () => {
    if (!dataUrl || busy) return;
    setBusy(true); setError(null);
    try {
      // Center-crop + downscale first: a raw phone photo is a multi-MB base64 body
      // that's slow to upload and far larger than any avatar slot renders.
      const squared = await squareAvatarDataUrl(dataUrl).catch(() => dataUrl);
      const upload = await fetch("/api/upload-ref", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64: squared }) });
      const uploaded = (await upload.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!upload.ok || !uploaded.url) throw new Error(uploaded.error || "Image upload failed");
      const saveRes = await fetch("/api/agents/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mintAddress, kind: "avatar", payload: { avatarUrl: uploaded.url } }) });
      const saved = (await saveRes.json().catch(() => ({}))) as { error?: string };
      if (!saveRes.ok) throw new Error(saved.error || "Profile image could not be saved");
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Profile image could not be saved"); }
    finally { setBusy(false); }
  };

  return (
    <AnimatePresence>
      {open && <motion.div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
        <motion.div role="dialog" aria-modal="true" aria-label="Change profile image" initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} className="w-full max-w-sm overflow-hidden rounded-[26px] border border-white/15 bg-zinc-950/90 p-5 text-white shadow-[0_30px_100px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-3xl">
          <div className="flex items-start justify-between gap-4"><div><h3 className="text-[17px] font-semibold tracking-[-0.02em]">Profile image</h3><p className="mt-1 text-[12px] text-zinc-400">Choose a clear square image for {agentName}.</p></div><button type="button" onClick={onClose} disabled={busy} className="grid size-8 place-items-center rounded-full bg-white/[0.07] text-zinc-400 hover:bg-white/[0.12] hover:text-white"><X className="size-4" /></button></div>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="group mx-auto mt-5 block size-40 overflow-hidden rounded-[32px] border border-white/15 bg-white/[0.06] shadow-[0_18px_50px_-24px_rgba(255,255,255,0.45)] transition hover:border-white/30">
            <SafeProfileImage src={preview} name={agentName} />
          </button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.07] py-2.5 text-[12px] font-medium hover:bg-white/[0.11]"><ImageUp className="size-4" /> Choose image</button>
          {error && <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-[11.5px] text-rose-200">{error}</p>}
          <button type="button" onClick={() => void save()} disabled={!dataUrl || busy} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-[12.5px] font-semibold text-black transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}{busy ? "Saving…" : "Save profile image"}</button>
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  );
}

// ─── Autonomous-clipping Home toggle ────────────────────────────────────────
// The ON/OFF switch that arms a clip agent's self-run loop: when ON, each daily
// scout (convex/agentAutonomy.fireHeartbeatForAgent) runs one auto-clip cycle —
// seek a fit-matched funded campaign, pick the next un-clipped source, gate on
// funds + daily cap, charge the $0.10 scout fee, and enqueue one clip (the
// pipeline then posts + submits). Off by default (money-spending → explicit opt-in).
// Saves through the SIWS-owner-gated /api/agents/config route (kind:"autoclip"),
// which injects INTERNAL_CRON_SECRET and calls influencers.setAutoClip. The Convex
// `enabled` prop (live subscription) is the source of truth; a local override gives
// optimistic feedback and reverts on error.
function AutoClipToggle({ mintAddress, enabled }: { mintAddress: string; enabled: boolean }) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the live query catches up to a save, drop the optimistic override.
  useEffect(() => { setOptimistic(null); }, [enabled]);
  const on = optimistic ?? enabled;

  const toggle = async () => {
    if (busy) return;
    const next = !on;
    setOptimistic(next); setBusy(true); setError(null);
    try {
      // Owner auth (Privy Bearer + X-Siws-Session) is auto-attached by the global
      // fetch interceptor — mirrors the other /api/agents/config saves.
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "autoclip", payload: { enabled: next } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Save failed");
      }
      // Leave the optimistic value in place; the Convex subscription confirms + clears it.
    } catch (e) {
      setOptimistic(null); // revert to the authoritative value
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHeading>Autonomous clipping</SectionHeading>
      <PaperCard>
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-zinc-800 leading-tight">Auto-seek &amp; clip campaigns</p>
            <p className="text-[11.5px] text-zinc-500 leading-snug mt-0.5">
              Finds a matched, funded campaign each day and clips it for you · ~$0.10/run + clip fees
            </p>
            {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Toggle autonomous clipping"
            disabled={busy}
            onClick={toggle}
            className={`relative shrink-0 mt-0.5 h-6 w-11 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-zinc-300"} ${busy ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`}
            />
          </button>
        </div>
      </PaperCard>
    </div>
  );
}

// ─── Delete-agent modal (type-to-confirm) ───────────────────────────────────
// Wired to the existing owner-safe POST /api/agents/delete, which refunds the
// agent wallet's USDC to the owner FIRST (aborting if that fails), frees the
// upload-post slot, then cascade-deletes the agent. Owner auth (Privy Bearer +
// X-Siws-Session) is auto-attached by the global fetch interceptor — mirrors
// the proven flow in app/studio/page.tsx.
function DeleteAgentModal({
  agentName, mintAddress, refundUsdc, onClose,
}: {
  agentName: string;
  mintAddress: string;
  refundUsdc: number | null;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = confirm.trim().toLowerCase() === agentName.trim().toLowerCase();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const doDelete = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/agents/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) {
        setError(j.error || `Delete failed (${res.status})`);
        setBusy(false);
        return;
      }
      // Agent no longer exists — leave the now-dead builder page for My Agents.
      window.location.href = "/studio";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(24,24,27,0.55)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-[360px] rounded-[14px] border-2 border-zinc-900 bg-white p-5 shadow-[6px_6px_0_0_#18181b]"
        style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}
      >
        <div className="mb-3 grid size-11 place-items-center rounded-[12px] bg-red-100 text-red-600">
          <Trash2 className="size-5" aria-hidden />
        </div>
        <h3 className="font-serif text-[21px] font-bold leading-tight text-zinc-900">Delete {agentName}?</h3>
        <p className="mt-1.5 text-[12.5px] leading-snug text-zinc-600">
          This permanently removes your agent and everything it made. <span className="font-semibold text-zinc-900">It can&apos;t be undone.</span>
        </p>
        <div className="mt-3.5 space-y-2.5 rounded-[10px] border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex items-start gap-2.5 text-[12px] text-zinc-700">
            <CheckCircle2 className="mt-px size-4 shrink-0 text-emerald-600" aria-hidden />
            <span>
              {refundUsdc != null && refundUsdc > 0
                ? <><span className="font-semibold text-zinc-900">${refundUsdc.toFixed(2)} USDC</span> refunded to your wallet first</>
                : "Any remaining USDC is refunded to your wallet first"}
            </span>
          </div>
          <div className="flex items-start gap-2.5 text-[12px] text-zinc-700">
            <Trash2 className="mt-px size-4 shrink-0 text-zinc-400" aria-hidden />
            <span>All clips, scheduled posts, tasks &amp; config deleted</span>
          </div>
        </div>
        <label className="mt-3.5 block text-[12px] text-zinc-600">
          Type <span className="font-serif font-semibold text-zinc-900">{agentName}</span> to confirm
        </label>
        <input
          autoFocus
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && ready) void doDelete(); }}
          placeholder={agentName}
          disabled={busy}
          className="mt-1.5 w-full rounded-[8px] border border-zinc-300 px-3 py-2.5 font-mono text-[13px] text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60"
        />
        {error && <p className="mt-2 text-[12px] font-medium text-red-700">{error}</p>}
        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-[9px] border-2 border-zinc-900 bg-white py-2.5 text-[13px] font-bold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void doDelete()}
            disabled={!ready || busy}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-[9px] border-2 border-red-800 bg-red-600 py-2.5 text-[13px] font-bold text-white shadow-[0_3px_0_0_#7f1d1d] transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:border-red-300 disabled:bg-red-300 disabled:shadow-none"
          >
            {busy ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Deleting…</> : "Delete agent"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Persona fields patched by influencers.update — a full-replace mutation, so
// every modal that changes ONE field still submits the whole snapshot
// (fetched live via getByMint, pre-filled once it loads).
type PersonaForm = {
  name: string;
  handle: string;
  avatarUrl: string;
  niche: string;
  language: string;
  archetype: string;
  description: string;
  personality: { warmth: number; humor: number; authority: number; boldness: number };
};

function usePersonaForm(mintAddress: string) {
  const agent = useQuery(api.influencers.getByMint, { mintAddress }) as
    | (PersonaForm & Record<string, unknown>)
    | null
    | undefined;
  const [form, setForm] = useState<PersonaForm | null>(null);
  useEffect(() => {
    if (!agent || form) return;
    setForm({
      name: agent.name, handle: agent.handle, avatarUrl: agent.avatarUrl,
      niche: agent.niche, language: agent.language, archetype: agent.archetype,
      description: agent.description, personality: agent.personality,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);
  return { agent, form, setForm };
}

async function savePersona(mintAddress: string, payload: PersonaForm, agentType?: string): Promise<void> {
  const standardized = {
    ...payload,
    description: formatAgentDescription({ ...payload, agentType }),
  };
  const res = await fetch("/api/agents/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mintAddress, kind: "persona", payload: standardized }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
}

/** Rename-only modal off the settings cog — a lighter, faster path than the
 *  full persona editor for the single-field case operators reach for most. */
function RenameAgentModal({ mintAddress, onClose }: { mintAddress: string; onClose: () => void }) {
  const { agent, form, setForm } = usePersonaForm(mintAddress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (form) inputRef.current?.focus(); }, [form]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const trimmed = form?.name.trim() ?? "";
  const dirty = !!agent && trimmed.length > 0 && trimmed !== agent.name;

  const doSave = async () => {
    if (!form || !dirty || busy) return;
    setBusy(true); setError(null);
    try {
      await savePersona(mintAddress, { ...form, name: trimmed }, typeof agent.agentType === "string" ? agent.agentType : undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(24,24,27,0.55)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.94, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 6, opacity: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className="w-full max-w-[360px] rounded-[14px] border-2 border-zinc-900 bg-white p-5 shadow-[6px_6px_0_0_#18181b]"
        style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}
      >
        <div className="mb-3 grid size-11 place-items-center rounded-[12px] bg-lime-100 text-lime-700">
          <FileEdit className="size-5" aria-hidden />
        </div>
        <h3 className="font-serif text-[21px] font-bold leading-tight text-zinc-900">Rename agent</h3>
        <p className="mt-1.5 text-[12.5px] leading-snug text-zinc-600">
          Give your agent a new display name. It updates everywhere instantly.
        </p>
        {!form ? (
          <div className="mt-5 grid place-items-center py-6">
            <Loader2 className="size-5 animate-spin text-zinc-400" aria-hidden />
          </div>
        ) : (
          <>
            <label className="mt-4 block text-[12px] font-semibold text-zinc-600">Agent name</label>
            <input
              ref={inputRef}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && dirty) void doSave(); }}
              maxLength={60}
              disabled={busy}
              className="mt-1.5 w-full rounded-[8px] border border-zinc-300 px-3 py-2.5 font-serif text-[15px] font-semibold text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60"
            />
          </>
        )}
        {error && <p className="mt-2 text-[12px] font-medium text-red-700">{error}</p>}
        <div className="mt-4 flex gap-2.5">
          <button
            type="button" onClick={onClose} disabled={busy}
            className="flex-1 rounded-[9px] border-2 border-zinc-900 bg-white py-2.5 text-[13px] font-bold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button" onClick={() => void doSave()} disabled={!dirty || busy}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-[9px] border-2 border-zinc-900 bg-lime-500 py-2.5 text-[13px] font-bold text-zinc-900 shadow-[0_3px_0_0_#3f6212] transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
          >
            {busy ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Saving…</> : "Save name"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const PERSONA_TRAITS = ["warmth", "humor", "authority", "boldness"] as const;
const PERSONA_TRAIT_COLOR: Record<(typeof PERSONA_TRAITS)[number], string> = {
  warmth: "bg-orange-500", humor: "bg-yellow-500", authority: "bg-blue-500", boldness: "bg-purple-500",
};
const PERSONA_NICHES = ["lifestyle", "tech", "fashion", "fitness", "food", "travel", "finance", "gaming", "viral short-form"];
const PERSONA_ARCHETYPES = ["creator", "educator", "entertainer", "analyst", "advocate", "curator"];

/** Full persona/knowledge editor off the settings cog — description, niche,
 *  archetype, and the 4 personality-trait sliders that steer chat/edit tone.
 *  Saves through the same SIWS-owner-gated influencers.update path the
 *  standalone /studio/agent/[id]/edit page uses. */
function EditPersonaModal({ mintAddress, onClose }: { mintAddress: string; onClose: () => void }) {
  const { agent, form, setForm } = usePersonaForm(mintAddress);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const doSave = async () => {
    if (!form || busy) return;
    setBusy(true); setError(null);
    try {
      await savePersona(mintAddress, form, typeof agent?.agentType === "string" ? agent.agentType : undefined);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(24,24,27,0.55)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.94, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 6, opacity: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className="max-h-[85vh] w-full max-w-[440px] overflow-y-auto rounded-[14px] border-2 border-zinc-900 bg-white p-5 shadow-[6px_6px_0_0_#18181b]"
        style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="mb-3 grid size-11 place-items-center rounded-[12px] bg-violet-100 text-violet-700">
              <FileText className="size-5" aria-hidden />
            </div>
            <h3 className="font-serif text-[21px] font-bold leading-tight text-zinc-900">Edit persona &amp; knowledge</h3>
            <p className="mt-1.5 text-[12.5px] leading-snug text-zinc-600">
              Tune how your agent describes itself and behaves in chat &amp; edits.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {!form ? (
          <div className="mt-6 grid place-items-center py-8">
            <Loader2 className="size-5 animate-spin text-zinc-400" aria-hidden />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-zinc-600">Marketplace description</label>
              <p className="mt-1.5 rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700">
                {formatAgentDescription({ ...form, agentType: typeof agent?.agentType === "string" ? agent.agentType : undefined })}
              </p>
              <p className="mt-1.5 text-[11px] leading-snug text-zinc-500">Generated from the agent&apos;s name, niche, type, and voice so every profile follows the same format.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-zinc-600">Niche</label>
                <select
                  value={form.niche}
                  onChange={(e) => setForm({ ...form, niche: e.target.value })}
                  disabled={busy}
                  className="mt-1.5 w-full rounded-[8px] border border-zinc-300 bg-white px-2.5 py-2 text-[13px] capitalize text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60"
                >
                  {[...new Set([form.niche, ...PERSONA_NICHES])].map((n) => (
                    <option key={n} value={n} className="capitalize">{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-zinc-600">Archetype</label>
                <select
                  value={form.archetype}
                  onChange={(e) => setForm({ ...form, archetype: e.target.value })}
                  disabled={busy}
                  className="mt-1.5 w-full rounded-[8px] border border-zinc-300 bg-white px-2.5 py-2 text-[13px] capitalize text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60"
                >
                  {[...new Set([form.archetype, ...PERSONA_ARCHETYPES])].map((a) => (
                    <option key={a} value={a} className="capitalize">{a}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3.5 rounded-[10px] border border-zinc-200 bg-zinc-50/60 p-3.5">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">Personality</p>
              {PERSONA_TRAITS.map((trait) => (
                <div key={trait}>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="flex items-center gap-1.5 font-medium capitalize text-zinc-800">
                      <span className={`size-1.5 rounded-full ${PERSONA_TRAIT_COLOR[trait]}`} />
                      {trait}
                    </span>
                    <span className="font-mono text-zinc-500">{form.personality[trait]}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={form.personality[trait]}
                    disabled={busy}
                    onChange={(e) => setForm({ ...form, personality: { ...form.personality, [trait]: Number(e.target.value) } })}
                    className="mt-1.5 w-full accent-zinc-900"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-[12px] font-medium text-red-700">{error}</p>}
        <div className="mt-4 flex gap-2.5">
          <button
            type="button" onClick={onClose} disabled={busy}
            className="flex-1 rounded-[9px] border-2 border-zinc-900 bg-white py-2.5 text-[13px] font-bold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button" onClick={() => void doSave()} disabled={!form || busy}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-[9px] border-2 border-zinc-900 bg-lime-500 py-2.5 text-[13px] font-bold text-zinc-900 shadow-[0_3px_0_0_#3f6212] transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
          >
            {busy ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Saving…</> : saved ? "✓ Saved" : "Save changes"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Compact newest-3 transaction preview for the Earnings card. Reuses the SAME
 *  api.agentAccount.transactionHistory the Usage modal reads (no second data
 *  source) and renders at 6-dp, so a dust campaign-reward payout is visible the
 *  instant it lands — with a "See all" that opens the full history modal. */
/** Fullscreen-capable clip lightbox for the Home tab's "Recent clips" — a
 *  clicked card springs open into a centered modal that autoplays the clip
 *  with controls; the expand button requests true browser fullscreen on the
 *  video element. Esc / backdrop click / ✕ all close. */
function ClipLightbox({ item, onClose }: { item: { url: string; title: string } | null; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Landscape (16:9) videos need the WIDE modal — the fixed 420px portrait
  // width squeezed them into a tiny letterboxed strip. Measured off the real
  // metadata, so any aspect self-corrects on load.
  const [landscape, setLandscape] = useState(false);
  useEffect(() => { setLandscape(false); }, [item?.url]);
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);
  const goFullscreen = () => {
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.requestFullscreen) void v.requestFullscreen().catch(() => v.webkitEnterFullscreen?.());
    else v.webkitEnterFullscreen?.(); // iOS Safari
  };
  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className={`relative w-full ${landscape ? "max-w-[min(92vw,1280px)]" : "max-w-[420px]"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <video
              ref={videoRef}
              src={item.url}
              controls
              autoPlay
              playsInline
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) setLandscape(v.videoWidth > v.videoHeight);
              }}
              className="max-h-[82vh] w-full rounded-2xl bg-black object-contain ring-1 ring-white/15 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-[13px] font-semibold text-white">{item.title}</p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={goFullscreen}
                  className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-white/[0.12]"
                >
                  Fullscreen
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="grid size-8 place-items-center rounded-lg border border-white/15 bg-white/[0.06] text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RecentTxList({ mintAddress, onSeeAll }: { mintAddress: string; onSeeAll: () => void }) {
  const rows = useQuery(
    api.agentAccount.transactionHistory,
    mintAddress ? { mintAddress } : "skip",
  ) as TxHistoryRow[] | undefined;
  // Hide "Swept to treasury" (kind: "sweep") rows — they redundantly re-settle
  // the same per-post fee already shown as its own "Spent · …" row (would
  // otherwise double-count one $0.05 post as −$0.10). Mirrors UsageDetailModal.
  const recent = (rows ?? []).filter((r) => r.kind !== "sweep").slice(0, 3);
  return (
    <div className="px-4 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-zinc-500">Recent activity</span>
        <button
          type="button"
          onClick={onSeeAll}
          className="inline-flex items-center gap-1 text-[10.5px] font-bold text-zinc-600 transition-colors hover:text-zinc-900"
        >
          <HistoryIcon className="size-3" aria-hidden /> See all
        </button>
      </div>
      {rows === undefined ? (
        <p className="py-1 text-[11px] text-zinc-400">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="py-1 text-[11px] text-zinc-400">No transactions yet.</p>
      ) : (
        <div className="space-y-1">
          {recent.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-[11.5px] text-zinc-600" title={r.label}>{r.label}</span>
              <span
                className={`shrink-0 font-mono text-[11.5px] font-bold tabular-nums ${
                  r.amountUsdc >= 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {formatSignedUsdc6(r.amountUsdc)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClipperHomeCockpit(props: {
  displayName: string;
  tagline: string;
  gif?: string;
  isMinted: boolean;
  isReady: boolean;
  isOnchainMinted: boolean;
  healing: boolean;
  healError: string | null;
  onHeal: () => void;
  nftLink: string | null;
  isClipping: boolean;
  onDeploy?: () => void;
  onTestAgent: () => void;
  onConnectWallet?: () => void;
  setActiveTab: (id: CockpitTab) => void;
  onStartClipping: () => void;
  persona: NonNullable<AgentBlueprint["persona"]>;
  agentWallet?: string;
  onChainBalance: number;
  liveBalance: number;
  spent: number;
  revenue: number;
  reserved: number;
  settledToTreasury: number;
  unsettledTab: number;
  pendingSettlement: number;
  dailyTokenCost: number;
  liveRunwayDays: number | null;
  runwayWarn: boolean;
  walletLoading: boolean;
  liveWallet: { usdc: number; sol: number } | null;
  copiedAddr: boolean;
  setCopiedAddr: (v: boolean) => void;
  depositOpen: boolean;
  setDepositOpen: (v: boolean) => void;
  withdrawOpen: boolean;
  setWithdrawOpen: (v: boolean) => void;
  safeWithdrawable: number;
  ownerWallet?: string;
  setLiveWallet: (v: { usdc: number; sol: number } | null) => void;
  mintAddress: string;
  installedSkills: string[];
  splitSkills: { editing: { id: string; label: string }[]; agent: { id: string; label: string }[] };
  knowledgeCount: number;
  lessonsRetained: number;
  conversationsLearned: number;
  onUploadKnowledge: () => void;
  onOpenSkillsBrowse: () => void;
  onOpenUsage: () => void;
  runnableTasks: TaskItem[];
  blueprint: AgentBlueprint;
  allTasks: Array<{ _id: string; _creationTime: number; type: string; status: string; startedAt?: number; completedAt?: number; output?: string; errorMessage?: string }>;
  liveTasks: LiveTask[];
  socialConnected: boolean;
  sessionId?: string;
  /** Character bible / aesthetic — fed into the agent-chat persona snapshot. */
  characterBible?: string;
  onHeartbeatChange?: (next: NonNullable<AgentBlueprint["heartbeat"]>) => void;
  onFireHeartbeat?: () => void | Promise<void>;
  onAutoFireHeartbeat?: () => void | Promise<void>;
}) {
  const {
    displayName, tagline, gif, isMinted, isReady, isOnchainMinted, healing, healError, onHeal, nftLink, isClipping,
    onDeploy, onTestAgent, onConnectWallet, setActiveTab, onStartClipping, persona: p, agentWallet,
    onChainBalance, liveBalance, spent, revenue, reserved, settledToTreasury,
    unsettledTab, pendingSettlement, dailyTokenCost, liveRunwayDays, runwayWarn, walletLoading,
    liveWallet, copiedAddr, setCopiedAddr, depositOpen, setDepositOpen, setLiveWallet,
    withdrawOpen, setWithdrawOpen, safeWithdrawable, ownerWallet,
    mintAddress, splitSkills, knowledgeCount, lessonsRetained,
    conversationsLearned, onUploadKnowledge, onOpenSkillsBrowse, onOpenUsage,
    runnableTasks, blueprint, allTasks, liveTasks, socialConnected, sessionId,
    characterBible, onHeartbeatChange, onFireHeartbeat, onAutoFireHeartbeat,
  } = props;

  // Knowledge surface starts collapsed (a count summary + one upload affordance).
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  // Heartbeat starts collapsed too — same reasoning as Knowledge, a status
  // summary is enough until the operator wants to change the schedule.
  const [heartbeatOpen, setHeartbeatOpen] = useState(false);
  // Delete-agent confirm modal (opened from the settings cog).
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Clip lightbox — a clicked "Recent clips" card opens here (modal + fullscreen).
  const [clipLightbox, setClipLightbox] = useState<{ url: string; title: string } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const totalSkills = splitSkills.editing.length + splitSkills.agent.length;

  // Slim recent-activity list — the most recent finished tasks (newest first).
  const recentActivity = useMemo(() => {
    return [...allTasks]
      .filter((t) => t.status === "succeeded" || t.status === "failed")
      .sort((a, b) => (b.completedAt ?? b._creationTime) - (a.completedAt ?? a._creationTime))
      .slice(0, 4);
  }, [allTasks]);

  // ── Recent Clips (Home tab, above Autonomous tasks) ────────────────────────
  // Slot 1 (when present): the soonest not-yet-posted drip row — joined the same
  // way the Posting tab joins them (scheduledContent has no clipId column).
  // Remaining slots: the latest rendered clips, newest first — max 8 total.
  const clipRows = useQuery(api.clipJobs.listClipsByMint, mintAddress ? { mintAddress } : "skip") as Doc<"clips">[] | undefined;
  const scheduledRows = useQuery(api.scheduledContent.listByMint, mintAddress ? { mintAddress, limit: 100 } : "skip") as
    Doc<"scheduledContent">[] | undefined;
  const nextScheduledPost = useMemo(() => {
    return (scheduledRows ?? [])
      .filter((r) => r.status === "scheduled")
      .sort((a, b) => a.scheduledFor - b.scheduledFor)[0] ?? null;
  }, [scheduledRows]);
  // Videos-tab generations (settled results the tab persists to localStorage —
  // same store the influencer Editor's sidebar reads) so "Recent clips" shows
  // EVERYTHING the agent recently produced, not just the clipping pipeline.
  // Server-side succeeded create_video tasks — queried HERE because this
  // cockpit is its own component; the identically-named query in
  // AgentWorkspace's body is out of scope.
  const generations = useQuery(
    api.agentTasks.listGenerations,
    mintAddress ? { mintAddress } : "skip",
  );
  const videoGenerations = useMemo(() => {
    if (typeof window === "undefined") return [] as { id: string; url: string; title: string; createdAt: number }[];
    try {
      const raw = window.localStorage.getItem(`vello.videos.${mintAddress || "draft"}`);
      const all = raw ? (JSON.parse(raw) as { id: string; url?: string; prompt?: string; createdAt: number }[]) : [];
      return all
        .filter((v) => v.url)
        .map((v) => ({ id: v.id, url: v.url!, title: v.prompt || "Generated video", createdAt: v.createdAt }));
    } catch {
      return [];
    }
  }, [mintAddress]);
  const recentClips = useMemo(() => {
    type RecentItem = { id: string; url: string; title: string; captionText?: string; createdAt: number; postedAt?: number };
    const out: RecentItem[] = [];
    const seen = new Set<string>();
    const push = (i: RecentItem) => { if (i.url && !seen.has(i.url)) { seen.add(i.url); out.push(i); } };
    (clipRows ?? [])
      .filter((c) => c.status === "ready" && c.clipUrl)
      .forEach((c) => push({ id: c._id as string, url: c.clipUrl!, title: c.title, captionText: c.captionText, createdAt: c.createdAt, postedAt: c.postedAt }));
    // Server-side Videos-tab generations (succeeded create_video tasks) — the
    // localStorage copy below only exists on the browser that generated them.
    for (const t of generations ?? []) {
      if (t.type !== "create_video" || !t.output) continue;
      try {
        const o = JSON.parse(t.output) as { videoUrl?: string; topic?: string; caption?: string };
        if (typeof o.videoUrl === "string") push({ id: t._id as string, url: o.videoUrl, title: o.topic || o.caption || "Generated video", createdAt: t._creationTime });
      } catch { /* skip unparseable */ }
    }
    videoGenerations.forEach((v) => push({ id: v.id, url: v.url, title: v.title, createdAt: v.createdAt }));
    return out
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, nextScheduledPost ? 7 : 8);
  }, [clipRows, generations, videoGenerations, nextScheduledPost]);

  // Quick stats — real per-agent numbers off the same clipRows query (no extra
  // fetch). viewCount is a cumulative total synced from upload-post analytics
  // (/api/analytics/refresh-views), so "this week" sums it for clips POSTED in
  // the last 7 days rather than a true week-over-week delta (that data isn't
  // tracked) — the same approximation the rest of the app uses for view stats.
  const homeStats = useMemo(() => {
    const rows = clipRows ?? [];
    const weekAgo = Date.now() - 7 * 86_400_000;
    const rendered = rows.filter((c) => c.status === "ready" && c.clipUrl);
    const posted = rows.filter((c) => !!c.postedAt);
    const postedThisWeek = posted.filter((c) => (c.postedAt ?? 0) >= weekAgo);
    const viewsThisWeek = postedThisWeek.reduce((s, c) => s + (c.viewCount ?? 0), 0);
    const totalViews = posted.reduce((s, c) => s + (c.viewCount ?? 0), 0);
    const topClip = posted.length
      ? posted.reduce((best, c) => ((c.viewCount ?? 0) > (best.viewCount ?? 0) ? c : best))
      : null;
    // 7-day trend, oldest → newest, for the weekly growth chart below the CTA.
    const dayMs = 86_400_000;
    const todayStart = Math.floor(Date.now() / dayMs) * dayMs;
    const weeklyTrend = Array.from({ length: 7 }, (_, i) => {
      const dayStart = todayStart - (6 - i) * dayMs;
      const dayEnd = dayStart + dayMs;
      const postsThatDay = posted.filter((c) => (c.postedAt ?? 0) >= dayStart && (c.postedAt ?? 0) < dayEnd);
      const viewsThatDay = postsThatDay.reduce((s, c) => s + (c.viewCount ?? 0), 0);
      return {
        label: new Date(dayStart).toLocaleDateString("en-US", { weekday: "short" }),
        views: viewsThatDay,
        posts: postsThatDay.length,
      };
    });
    return {
      totalVideos: rendered.length,
      postedThisWeek: postedThisWeek.length,
      viewsThisWeek,
      totalViews,
      topClip: topClip && (topClip.viewCount ?? 0) > 0 ? topClip : null,
      weeklyTrend,
    };
  }, [clipRows]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="w-full min-h-full"
      style={{ ...WARM_GLASS_BG, fontFamily: "var(--font-geist-sans, system-ui)" }}
    >
      <div className="max-w-[1280px] mx-auto px-6 py-8">
        {/* "Make next video", the one obvious action, on the SAME warm-glass
            surface as the rest of Home (it used to float above the cockpit on
            the outer dark background and read as a separate page). */}
        {!isClipping && isMinted && mintAddress && (
          <div className="mb-6">
            <NextVideoCard
              mintAddress={mintAddress}
              onOpenIdeas={() => setActiveTab("ideas")}
              onOpenSchedule={() => setActiveTab("schedule")}
            />
          </div>
        )}
      <div className="grid grid-cols-12 gap-6">

        {/* ══ LEFT RAIL, agent identity / hero CTA / funding & config ══════════ */}
        <aside className="nb-reveal col-span-12 md:col-span-4 self-start md:sticky md:top-4 flex flex-col gap-6">

          {/* Identity + the single green hero CTA */}
          <div>
            <div className="flex gap-4 items-start">
              <div className="size-[80px] rounded-lg overflow-hidden bg-white/10 border-2 border-white/20 shrink-0">
                {gif ? (
                  <SafeProfileImage src={gif} name={displayName} />
                ) : isMinted ? (
                  <AvatarFallback name={displayName} />
                ) : (
                  <BuildingPlaceholder />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-sans text-2xl font-semibold text-white leading-[1.05] truncate">{displayName}</h2>
                {p.handle && <p className="mt-0.5 font-sans text-[12.5px] text-zinc-500 truncate">@{p.handle.replace(/^@/, "")}</p>}
                {/* Description sits where the status pill used to lead, white text. */}
                <p className="mt-2 text-[12.5px] leading-snug text-white">{tagline}</p>
                {/* Status pill, the "Live on Solana" state shows NOTHING (hidden
                    per request); only in-progress states keep a pill. */}
                {!isOnchainMinted && (
                  <div className="mt-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      isMinted ? "bg-amber-100 text-amber-800" : isReady ? "bg-emerald-100 text-emerald-800" : "bg-white/10 text-zinc-600"
                    }`}>
                      <span className={`size-1.5 rounded-full ${isMinted ? "bg-amber-500" : isReady ? "bg-emerald-500" : "bg-zinc-400"}`} aria-hidden />
                      {isMinted ? "Live" : isReady ? "Ready to go live" : "Configuring"}
                    </span>
                  </div>
                )}
              </div>
              {/* Settings cog, minted agents only (Rename · Edit persona · Daily cap · Delete) */}
              {isMinted && (
                <AgentSettingsCog
                  agentName={displayName}
                  onDelete={() => setDeleteOpen(true)}
                  onDailyCap={() => document.getElementById("clipper-daily-cap")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  onRename={() => setRenameOpen(true)}
                  onEditPersona={() => setPersonaOpen(true)}
                  onChangeAvatar={isClipping ? () => setAvatarOpen(true) : undefined}
                />
              )}
            </div>
            {/* NFT explorer link hidden by request, on-chain minted shows nothing here */}
            {isOnchainMinted && nftLink ? null : isMinted ? (
              <span className="mt-1.5 inline-flex items-center gap-2 text-[11px] font-medium">
                {healing ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin text-amber-600" />
                    <span className="text-amber-600">Going live on-chain…</span>
                  </>
                ) : (
                  <>
                    <span className="text-amber-600">⚠ Not on-chain yet</span>
                    <button
                      type="button"
                      onClick={onHeal}
                      className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 hover:bg-amber-200 font-semibold transition-colors"
                    >
                      Go live now
                    </button>
                  </>
                )}
                {healError && <span className="text-rose-600">{healError}</span>}
              </span>
            ) : null}

            {/* Single green hero action */}
            <div className="mt-4">
              {!isMinted ? (
                <PrimaryButton variant="glass" disabled={!isReady} onClick={onDeploy}>
                  {isReady ? "Deploy Agent" : "Configure First"}
                </PrimaryButton>
              ) : (
                <button
                  type="button"
                  onClick={isClipping ? onStartClipping : onTestAgent}
                  className="group relative w-full overflow-hidden rounded-2xl border border-white/25 bg-gradient-to-b from-white/[0.16] to-white/[0.06] px-5 py-3.5 text-[13px] font-semibold tracking-[-0.01em] text-white shadow-[0_18px_42px_-24px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-2xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.14] hover:shadow-[0_22px_50px_-24px_rgba(255,255,255,0.65),inset_0_1px_0_rgba(255,255,255,0.24)] active:translate-y-0"
                >
                  <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.12] to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  <span className="relative inline-flex items-center justify-center gap-2.5">
                    <span className="grid size-7 place-items-center rounded-full border border-white/15 bg-black/20">{isClipping ? <Scissors className="size-3.5" /> : <Clapperboard className="size-3.5" />}</span>
                    {isClipping ? "Start clipping" : "Generate next video"}
                    <ArrowUpRight className="size-4 text-white/60 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </button>
              )}
            </div>

            {/* Quick stats, real numbers off this agent's own clips (no mock data). */}
            {isMinted && isClipping && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  { label: "Videos generated", value: fmtCompactNumber(homeStats.totalVideos) },
                  { label: "Views this week", value: fmtCompactNumber(homeStats.viewsThisWeek) },
                  { label: "Posted this week", value: fmtCompactNumber(homeStats.postedThisWeek) },
                  { label: "Total views", value: fmtCompactNumber(homeStats.totalViews) },
                ].map((s) => (
                  <div key={s.label} className="rounded-md bg-white/[0.06] backdrop-blur-xl px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]">
                    <p className="text-[17px] font-bold text-white leading-none">{s.value}</p>
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {isMinted && isClipping && <WeeklyGrowthChart data={homeStats.weeklyTrend} />}
          </div>

          {/* Wallet, deposit/withdraw, same funding surface as the classic Home's
              Earnings card (was cockpit-missing; restored for both Home modes). */}
          {isMinted && agentWallet && (
            <div>
              <div className="relative overflow-hidden rounded-lg border border-white/[0.12] bg-white/[0.055] p-4 backdrop-blur-2xl shadow-[0_18px_50px_-28px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.1)]">
                <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/25" />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/20 text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                      <Wallet className="size-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-white">Agent wallet</p>
                      <p className="truncate font-mono text-[10.5px] text-zinc-500" title={agentWallet}>
                        {agentWallet.slice(0, 6)}…{agentWallet.slice(-6)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(agentWallet);
                          setCopiedAddr(true);
                          setTimeout(() => setCopiedAddr(false), 1800);
                        } catch { /* ignore */ }
                      }}
                      title="Copy agent wallet address"
                      className={`grid size-8 place-items-center rounded-lg border text-zinc-300 transition-colors ${
                        copiedAddr ? "border-emerald-400/20 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-black/15 hover:border-white/20 hover:bg-white/10"
                      }`}
                    >
                      {copiedAddr ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                    </button>
                    <a
                      href={getAccountExplorerUrl(agentWallet)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View on explorer"
                      className="grid size-8 place-items-center rounded-lg border border-white/10 bg-black/15 text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
                    >
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </div>
                </div>
                <div className="mt-5 border-t border-white/[0.08] pt-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">Available balance</p>
                      <p className="mt-1 text-[26px] font-semibold leading-none tracking-normal text-white tabular-nums">
                        ${(liveWallet?.usdc ?? onChainBalance ?? 0).toFixed(2)}
                        <span className="ml-1.5 text-[11px] font-medium text-zinc-500">USDC</span>
                      </p>
                    </div>
                    <span className="mb-0.5 inline-flex items-center gap-1.5 text-[10px] text-zinc-500">
                      <span className={`size-1.5 rounded-full ${walletLoading ? "animate-pulse bg-amber-300" : "bg-emerald-400"}`} />
                      {walletLoading ? "Updating" : "Live"}
                    </span>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDepositOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white py-2.5 text-[12px] font-semibold text-zinc-950 shadow-[0_8px_24px_-12px_rgba(255,255,255,0.7)] transition-colors hover:bg-zinc-200"
                  >
                    <ArrowDownToLine className="size-3.5" aria-hidden /> Deposit
                  </button>
                  <button
                    type="button"
                    onClick={() => setWithdrawOpen(true)}
                    disabled={safeWithdrawable <= 0}
                    title={safeWithdrawable <= 0 ? "Nothing available to withdraw yet" : "Withdraw to your wallet"}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.07] py-2.5 text-[12px] font-semibold text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowUpFromLine className="size-3.5" aria-hidden /> Withdraw
                  </button>
                </div>
              </div>
              <DepositModal
                open={depositOpen}
                agentName={displayName}
                agentWallet={agentWallet}
                onClose={() => setDepositOpen(false)}
                onFunded={(bal) => setLiveWallet(bal)}
              />
              <WithdrawModal
                open={withdrawOpen}
                agentName={displayName}
                agentWallet={agentWallet}
                ownerWallet={ownerWallet}
                mintAddress={mintAddress}
                safeWithdrawable={safeWithdrawable}
                onClose={() => setWithdrawOpen(false)}
                onWithdrawn={(bal) => setLiveWallet(bal)}
              />
            </div>
          )}

          {/* Connections, compact social-connection row */}
          {(mintAddress || props.sessionId) && (
            <SocialConnectionsPanel username={mintAddress || props.sessionId || ""} variant="dark" title="Connections" bare />
          )}

          {/* Skills, hidden per request. */}
          {false && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <SectionHeading>Skills</SectionHeading>
              <button
                onClick={onOpenSkillsBrowse}
                className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-100 px-2.5 py-1 border border-white/15 rounded-full bg-zinc-900 hover:bg-white/10 inline-flex items-center gap-1"
              >
                <Plus className="size-3" /> Browse
              </button>
            </div>
            <PaperCard className="p-4 space-y-4">
              {/* Editing skills, installed clip editing effects */}
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-700 mb-2 flex items-center gap-1.5">
                  <Sparkles className="size-3" /> Editing skills
                  <span className="text-zinc-400">· {splitSkills.editing.length}</span>
                </p>
                {splitSkills.editing.length === 0 ? (
                  <p className="text-[11.5px] text-zinc-500">No editing effects installed, add some from the Marketplace to power up clips.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {splitSkills.editing.map((s) => {
                      // WIP skills (clip.brainrot / clip.memeaudio) are real but inert
                      // until their backing env is set — grey them out + badge "WIP".
                      const wip = isWipClipSkill(s.id);
                      return wip ? (
                        <span
                          key={s.id}
                          title="Work in progress, this effect is inert until its backing service is configured."
                          className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10.5px] font-medium text-zinc-400 opacity-70"
                        >
                          {s.label}
                          <span className="rounded-sm bg-white/10 px-1 py-px font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-zinc-600">WIP</span>
                        </span>
                      ) : (
                        <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-emerald-300/80 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-800">
                          {s.label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* Agent skills, autonomous behaviors + targeting clip skills */}
              <div className="border-t border-white/10/70 pt-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-200 mb-2 flex items-center gap-1.5">
                  <Compass className="size-3" /> Agent skills
                </p>
                <div className="space-y-1.5">
                  {AGENT_SKILLS.map((a) => {
                    // An autonomous behavior is "active" when its mirroring clip skill
                    // is installed (Scout ↔ clip.campaignscout / Research ↔ clip.prompt),
                    // otherwise it's an always-on built-in behavior.
                    const active =
                      a.id === "agent.scout" ? splitSkills.agent.some((s) => s.id === "clip.campaignscout")
                      : a.id === "agent.research" ? splitSkills.agent.some((s) => s.id === "clip.prompt")
                      : true;
                    return (
                      <div key={a.id} className="flex items-start gap-2.5">
                        <span className={`mt-1.5 inline-block size-2 rounded-full shrink-0 ${active ? "bg-emerald-600" : "bg-white/10"}`} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12.5px] font-serif font-bold text-white truncate">{a.label}</span>
                            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-500 shrink-0">{a.schedule}</span>
                          </div>
                          <p className="text-[11px] text-zinc-500 leading-snug line-clamp-2">{a.blurb}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </PaperCard>
            <p className="mt-2 text-[11px] text-zinc-500">{totalSkills} clip skill{totalSkills === 1 ? "" : "s"} installed.</p>
          </div>
          )}

          {/* Knowledge, hidden per request (upload still reachable via chat/tabs). */}
          {false && (
          <div>
            <SectionHeading dark>Knowledge</SectionHeading>
            <PaperCard className="overflow-hidden !bg-zinc-900/50 !border-white/10 backdrop-blur-xl">
              <button
                type="button"
                onClick={() => setKnowledgeOpen((v) => !v)}
                aria-expanded={knowledgeOpen}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-zinc-900/[0.03]"
              >
                <span className="grid place-items-center size-7 rounded-md bg-white/10 text-zinc-600 shrink-0"><FileText className="size-3.5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-serif text-[14px] font-bold text-white leading-tight">Knowledge</span>
                  <span className="block text-[11px] text-zinc-500 truncate">{knowledgeCount} doc{knowledgeCount === 1 ? "" : "s"} · {lessonsRetained} lesson{lessonsRetained === 1 ? "" : "s"} · {conversationsLearned} Q&amp;A</span>
                </span>
                <ChevronDown className={`size-4 text-zinc-500 shrink-0 transition-transform duration-200 ${knowledgeOpen ? "rotate-180" : ""}`} />
              </button>
              {knowledgeOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-white/10/70">
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { k: "Docs", v: knowledgeCount },
                      { k: "Lessons", v: lessonsRetained },
                      { k: "Q&A", v: conversationsLearned },
                    ].map(({ k, v }) => (
                      <div key={k} className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-center">
                        <p className="font-mono text-[16px] font-black tabular-nums text-white leading-none">{v}</p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">{k}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11.5px] text-zinc-600 mb-3 leading-snug">
                    Upload .md guides, brand voice, winning hooks, factual references. {p.name ?? "The agent"} reads these on every task.
                  </p>
                  <button
                    type="button"
                    onClick={onUploadKnowledge}
                    className="inline-flex items-center gap-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-zinc-100 hover:text-white px-3 py-1.5 border border-white/15 rounded-md bg-zinc-900 hover:bg-white/5"
                  >
                    <Upload className="size-3" /> Upload guide
                  </button>
                </div>
              )}
            </PaperCard>
          </div>
          )}

          {/* Heartbeat, ONE collapsed surface (on/off + cadence summary),
              same pattern as Knowledge above. Was missing from this Home
              cockpit entirely, it only lived on the older/dead "classic"
              Home block. Collapsed by default; the full HeartbeatCard
              (schedule, markdown, manual/auto tick) only mounts when opened. */}
          {onHeartbeatChange && !isClipping && (() => {
            const hb = blueprint.heartbeat;
            const hbOn = !!hb?.enabled;
            const cadence = (hb?.cron ?? "manual") === "manual"
              ? "only when you run it"
              : (hb?.cron ?? "").replace(/^every_/, "every ").replace(/_/g, " ");
            return (
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl">
              {/* Plain-language autopilot row: one toggle, one sentence, one
                  expand for the full schedule editor. */}
              <div className="flex items-center gap-3">
                <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${hbOn ? "bg-lime-400/15 text-lime-300" : "bg-white/[0.06] text-zinc-500"}`}>
                  <Activity className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-white">Autopilot</p>
                  <p className="truncate text-[11.5px] text-zinc-500">
                    {hbOn ? `Makes and posts videos on its own, ${cadence}` : "Paused. Videos only when you ask"}
                  </p>
                </div>
                {/* On/off switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={hbOn}
                  aria-label={hbOn ? "Turn autopilot off" : "Turn autopilot on"}
                  onClick={() => onHeartbeatChange({ markdown: "", cron: "daily" as const, ...(hb ?? {}), enabled: !hbOn })}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${hbOn ? "bg-lime-500" : "bg-white/15"}`}
                >
                  <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${hbOn ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
                <button
                  type="button"
                  onClick={() => void (onFireHeartbeat ?? onTestAgent)()}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-[11.5px] font-semibold text-zinc-200 transition-colors hover:bg-white/10"
                >
                  Run once now
                </button>
                <button
                  type="button"
                  onClick={() => setHeartbeatOpen((v) => !v)}
                  aria-expanded={heartbeatOpen}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-zinc-500 transition-colors hover:text-white"
                >
                  Schedule &amp; rules
                  <ChevronDown className={`size-3.5 transition-transform duration-200 ${heartbeatOpen ? "rotate-180" : ""}`} />
                </button>
              </div>
              {heartbeatOpen && (
                <div className="mt-3 border-t border-white/[0.06] pt-3">
                  <HeartbeatCard
                    blueprint={blueprint}
                    onHeartbeatChange={onHeartbeatChange}
                    onTick={onFireHeartbeat ?? onTestAgent}
                    onAutoTick={onAutoFireHeartbeat}
                    mintAddress={mintAddress}
                    variant="paper"
                    bare
                    title="Heartbeat"
                  />
                </div>
              )}
            </div>
            );
          })()}
        </aside>

        {/* ══ RIGHT, autonomous task run-panel + recent activity ═══════════════ */}
        <main className="nb-reveal col-span-12 md:col-span-8 flex flex-col gap-6">
          {/* Pre-creation walkthrough, Apple-minimal: no card chrome, just a
              quiet numbered path so a new operator knows the chat comes first. */}
          {!isMinted && (
            <div className="px-2 pt-4 md:pt-10">
              <div className="flex items-center gap-2.5">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime-400 opacity-50" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-lime-400" />
                </span>
                <p className="text-[12px] font-medium text-zinc-400">Your copilot is ready. Start in the chat.</p>
              </div>
              <h3 className="mt-4 text-[22px] font-semibold leading-tight tracking-tight text-white">
                Five steps to your first AI influencer
              </h3>
              <div className="mt-6 space-y-0">
                {[
                  { t: "Tell the copilot who your influencer is", d: "Describe the niche, vibe, and language in the chat. One message is enough to start." },
                  { t: "Pick the face", d: "The copilot designs the persona and generates looks. Choose the one you like, or upload your own photo." },
                  { t: "Create your agent", d: "One confirm and it exists. Free, up to 15 agents per account." },
                  { t: "Set the show plan", d: "A quick Director setup: formats, video length, voice, and how often it posts." },
                  { t: "Approve the sample", d: "Watch one sample video. Say yes and your influencer starts making videos on its own." },
                ].map((s, i, arr) => (
                  <div key={s.t} className="relative flex gap-4 pb-6 last:pb-0">
                    {i < arr.length - 1 && <span aria-hidden className="absolute left-[13px] top-8 bottom-0 w-px bg-white/10" />}
                    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 text-[12px] font-semibold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-[14px] font-semibold text-white">{s.t}</p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{s.d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Top clip, a small analytics highlight (real: the highest-viewed
              posted clip), only shows once there's real view data to report. */}
          {isMinted && homeStats.topClip && (
            <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.045] p-2.5 pr-4 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
              <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded-md bg-black ring-1 ring-white/10">
                {homeStats.topClip.clipUrl ? (
                  <video src={homeStats.topClip.clipUrl} muted playsInline preload="metadata" className="size-full object-cover" />
                ) : (
                  <div className="grid size-full place-items-center bg-white/[0.06]">
                    <Play className="size-4 fill-white/80 text-white/80" />
                  </div>
                )}
                <span className="absolute bottom-1 left-1 grid size-4 place-items-center rounded-full bg-black/70 backdrop-blur-sm">
                  <Play className="size-2 fill-white text-white" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Top clip</p>
                  {PLATFORM_LOGO[(homeStats.topClip.platform ?? "").toLowerCase()] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={PLATFORM_LOGO[(homeStats.topClip.platform ?? "").toLowerCase()]} alt={homeStats.topClip.platform ?? ""}
                      className="size-3 opacity-80" />
                  )}
                </div>
                <p className="truncate text-[12.5px] font-semibold text-white">{homeStats.topClip.title}</p>
              </div>
              <p className="shrink-0 text-[15px] font-bold text-lime-300">{fmtCompactNumber(homeStats.topClip.viewCount ?? 0)} <span className="text-[10px] font-medium text-zinc-500">views</span></p>
            </div>
          )}

          {/* Recent Clips, next scheduled post first, then the latest renders.
              Premium dark gradient cards at the clip's real aspect ratio (was a
              flat list with a 36px square thumbnail). */}
          {isMinted && (
            <div>
              <div className="mb-3 flex items-end justify-between">
                <SectionHeading dark>{isClipping ? "Recent clips" : "Recent videos"}</SectionHeading>
                <button
                  type="button"
                  onClick={() => setActiveTab("generations")}
                  className="pb-1 text-[12.5px] font-medium tracking-tight text-zinc-400 transition-colors hover:text-white"
                  style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" }}
                >
                  View all
                </button>
              </div>
              {!nextScheduledPost && recentClips.length === 0 ? (
                <PaperCard className="p-4 !bg-zinc-900/50 !border-white/10 backdrop-blur-xl">
                  <p className="text-[12.5px] text-zinc-500">Nothing yet, generate a video in the Videos tab or run the Clipping pipeline.</p>
                </PaperCard>
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4">
                  {nextScheduledPost && (
                    <div key={nextScheduledPost._id}
                      className="group relative aspect-[9/16] overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/10">
                      {nextScheduledPost.videoUrl ? (
                        <video src={nextScheduledPost.videoUrl} muted playsInline preload="metadata"
                          className="absolute inset-0 size-full object-cover blur-[3px] scale-105" />
                      ) : nextScheduledPost.storyboardImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={nextScheduledPost.storyboardImageUrl} alt=""
                          className="absolute inset-0 size-full object-cover blur-[3px] scale-105" />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/20 to-black/70" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-white/90">Next post</p>
                        <p className="text-[10px] text-white/70">{formatPostEta(nextScheduledPost.scheduledFor)}</p>
                      </div>
                      <p className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-5 text-[11px] font-semibold text-white">
                        {nextScheduledPost.topic || "Scheduled clip"}
                      </p>
                    </div>
                  )}
                  {recentClips.map((c) => {
                    const diff = Date.now() - c.createdAt;
                    const rel = diff < 60_000 ? "just now"
                      : diff < 3_600_000 ? `${Math.round(diff / 60_000)}m ago`
                      : diff < 86_400_000 ? `${Math.round(diff / 3_600_000)}h ago`
                      : `${Math.round(diff / 86_400_000)}d ago`;
                    return (
                      <div key={c.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Play ${c.title}`}
                        onClick={() => setClipLightbox({ url: c.url, title: c.title })}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setClipLightbox({ url: c.url, title: c.title }); } }}
                        className="group relative aspect-[9/16] cursor-pointer overflow-hidden rounded-lg bg-zinc-900 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.6)] ring-1 ring-white/10 transition-transform hover:-translate-y-0.5 hover:ring-white/20">
                        <video src={c.url} muted preload="metadata" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
                        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                          <VideoFeedback compact mintAddress={mintAddress} videoTitle={c.title} />
                        </div>
                        {c.postedAt && (
                          <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-lime-300 backdrop-blur-sm">
                            Posted
                          </span>
                        )}
                        <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-8">
                          <p className="line-clamp-1 text-[11.5px] font-semibold leading-snug text-white drop-shadow">{c.title}</p>
                          {c.captionText && c.captionText !== c.title && (
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-white/70">{c.captionText}</p>
                          )}
                          <p className="mt-1 text-[9.5px] text-white/50">{rel}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* "Build tasks" (pre-mint onboarding checklist), hidden per request. */}
          {false && !isMinted && (
          <div>
            <SectionHeading dark>Build tasks</SectionHeading>
            {isMinted ? (
              <>
                <p className="text-[11.5px] text-zinc-600 mb-3 -mt-1">
                  {displayName} runs these on its own, soonest first. Run any now from its card.
                </p>
                <div className="space-y-4">
                  {runnableTasks.length === 0 ? (
                    <PaperCard className="p-5 text-center !bg-zinc-900/50 !border-white/10 backdrop-blur-xl">
                      <p className="text-[12.5px] text-zinc-600">No autonomous tasks for this agent yet.</p>
                    </PaperCard>
                  ) : (
                    runnableTasks.map((t) => (
                      <TaskCardRunnable
                        key={t.id}
                        task={t}
                        blueprint={blueprint}
                        isMinted={isMinted}
                        recentTasks={allTasks}
                      />
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("tasks")}
                  className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-zinc-200 hover:text-white px-3 py-1.5 border border-white/15 rounded-md bg-zinc-900 hover:bg-white/5 transition-colors"
                >
                  <Activity className="size-3" /> Full history → Tasks tab
                </button>
              </>
            ) : (
              <>
                <p className="text-[11.5px] text-zinc-600 mb-3 -mt-1">
                  Finish these in chat to get {displayName} live on Solana.
                </p>
                <div className="space-y-4">
                  {/* Pre-mint onboarding checklist, the 3 build cards from buildTaskFeed. */}
                  {buildTaskFeed(blueprint).map((t) => (
                    <TaskCardRunnable
                      key={t.id}
                      task={t}
                      blueprint={blueprint}
                      isMinted={isMinted}
                      recentTasks={allTasks}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          )}
        </main>
      </div>
      </div>
      <AnimatePresence>
        {deleteOpen && isMinted && (
          <DeleteAgentModal
            agentName={displayName}
            mintAddress={mintAddress}
            refundUsdc={liveWallet?.usdc ?? onChainBalance}
            onClose={() => setDeleteOpen(false)}
          />
        )}
        {renameOpen && isMinted && (
          <RenameAgentModal mintAddress={mintAddress} onClose={() => setRenameOpen(false)} />
        )}
        {personaOpen && isMinted && (
          <EditPersonaModal mintAddress={mintAddress} onClose={() => setPersonaOpen(false)} />
        )}
        {avatarOpen && isMinted && isClipping && (
          <AvatarImageModal open onClose={() => setAvatarOpen(false)} mintAddress={mintAddress} agentName={displayName} currentUrl={gif} />
        )}
      </AnimatePresence>
      <ClipLightbox item={clipLightbox} onClose={() => setClipLightbox(null)} />
    </motion.div>
  );
}

// ─── LiveTaskStrip — real-time in-flight task cards ─────────────────────────
//
// Convex `listByMint` already re-runs whenever any agent task changes status,
// so all we do here is render. Each card animates in/out and shimmers while
// running. Completed tasks linger for ~8s before fading out so the operator
// catches the result.

type LiveTask = {
  _id: string;
  _creationTime: number;
  type: string;
  title: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  output?: string;
};

const TASK_TYPE_LABEL: Record<string, string> = {
  create_video:    "Video",
  post_content:    "Post",
  analyze_trend:   "Trend Scan",
  research:        "Research",
  check_wallet:    "Wallet Check",
  find_jobs:       "Job Scan",
  campaign_submit: "Campaign",
  engage_comment:  "Reply",
  reply_fan:       "Fan Reply",
  self_reflect:    "Reflection",
};

function TaskElapsed({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return null;
  const s = Math.floor((now - startedAt) / 1000);
  if (s < 60) return <span className="tabular-nums">{s}s</span>;
  return <span className="tabular-nums">{Math.floor(s / 60)}m {s % 60}s</span>;
}

function LiveTaskStrip({ tasks }: { tasks: LiveTask[] }) {
  // Force re-render every 1s so the "8s lingering" filter naturally drops cards.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (tasks.length === 0) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [tasks.length]);

  return (
    <AnimatePresence>
      {tasks.length > 0 && (
        <motion.div
          key="strip"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          className="shrink-0 border-b border-black/[0.06] bg-white/75 backdrop-blur-xl overflow-hidden"
        >
          <div className="px-5 py-1.5 flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full rounded-full bg-emerald-500/60 animate-ping" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="font-sans text-[11px] tracking-[-0.01em] text-zinc-500 font-medium">
                {tasks.length === 1 ? "Working" : `${tasks.length} running`}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
              <AnimatePresence mode="popLayout" initial={false}>
                {tasks.map(t => (
                  <LiveTaskCard key={t._id} task={t} />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function LiveTaskCard({ task }: { task: LiveTask }) {
  const label = TASK_TYPE_LABEL[task.type] ?? task.type.replace(/_/g, " ");

  // Parse output for pipeline errors — show partial-success cards as warnings
  let parsedOutput: Record<string, unknown> = {};
  try { parsedOutput = JSON.parse(task.output ?? "{}"); } catch { /* ignore */ }
  const pipelineError = (parsedOutput.pipelineError ?? parsedOutput.storyboardError ?? parsedOutput.videoError) as string | undefined;
  const partialMedia = Boolean(parsedOutput.storyboardImageUrl && !parsedOutput.videoUrl);

  const baseStatus = task.status;
  // Treat "succeeded with pipelineError" as a partial-failure warning
  const status = baseStatus === "succeeded" && pipelineError && !parsedOutput.videoUrl && !parsedOutput.storyboardImageUrl
    ? "failed"
    : baseStatus === "succeeded" && partialMedia
    ? "partial"
    : baseStatus;

  // Status visuals
  const isRunning = status === "running";
  const isApproval = status === "awaiting_approval";
  const isSuccess = status === "succeeded";
  const isFailed = status === "failed";
  const isPartial = status === "partial";

  const dotClass =
    isSuccess ? "bg-emerald-500" :
    isPartial ? "bg-amber-500" :
    isFailed  ? "bg-rose-500"    :
    isApproval ? "bg-blue-500" :
                "bg-zinc-300";

  const statusColor =
    isSuccess ? "text-emerald-600" :
    isPartial ? "text-amber-600" :
    isFailed  ? "text-rose-600" :
    isRunning ? "text-zinc-400" :
    isApproval ? "text-blue-600" :
                "text-zinc-400";

  const statusText =
    isSuccess ? "Done" :
    isPartial ? "Partial" :
    isFailed  ? "Failed" :
    isRunning ? "Running" :
    isApproval ? "Awaiting" :
                "Queued";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // On removal the card lifts up, fades, and collapses its width so the
      // neighbours glide over to fill the gap — slow + smooth, not a flick.
      exit={{
        opacity: 0,
        y: -28,
        scale: 0.94,
        marginLeft: 0,
        marginRight: -8,
        transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
      }}
      transition={{ type: "spring", stiffness: 360, damping: 26 }}
      className="relative flex items-center gap-2 pl-2 pr-2.5 py-1 rounded-[10px] border border-black/[0.06] bg-white/95 max-w-[260px] min-w-0 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_3px_10px_-3px_rgba(0,0,0,0.12)]"
    >
      {/* Status indicator — a soft 3D spinner ring while running, a flat dot otherwise */}
      <span className="relative grid place-items-center size-3.5 shrink-0">
        {isRunning ? (
          <span
            className="block size-3.5 rounded-full animate-spin"
            style={{
              background: "conic-gradient(from 90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 100%)",
              WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px))",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px))",
              filter: "drop-shadow(0 0.5px 0.5px rgba(0,0,0,0.18))",
              animationDuration: "0.85s",
            }}
          />
        ) : (
          <span className={`size-[5px] rounded-full ${dotClass}`} />
        )}
      </span>

      <div className="relative min-w-0 flex-1">
        <p className="font-sans text-[11.5px] text-zinc-900 font-medium truncate leading-tight tracking-[-0.01em]">{task.title}</p>
        <div className="flex items-center gap-1 mt-px">
          <span className="font-sans text-[10px] text-zinc-400 tracking-[-0.01em]">{label}</span>
          <span className="text-zinc-300 text-[10px]">·</span>
          <span className={`font-sans text-[10px] tracking-[-0.01em] ${statusColor}`}>{statusText}</span>
          {isRunning && task.startedAt && (
            <>
              <span className="text-zinc-300 text-[10px]">·</span>
              <span className="font-sans text-[10px] text-zinc-400 tabular-nums">
                <TaskElapsed startedAt={task.startedAt} />
              </span>
            </>
          )}
        </div>
      </div>

      {/* Live cost, pulses while reserved, settles when finalized */}
      {(isRunning || isSuccess || isFailed || isPartial) && (() => {
        const finalCost = typeof parsedOutput.cost === "number" ? parsedOutput.cost as number : null;
        const ESTIMATED: Record<string, number> = {
          create_video: 0.20, analyze_trend: 0.012, research: 0.01,
          check_wallet: 0.001, find_jobs: 0.002, campaign_submit: 0.001,
          post_content: 0.001, engage_comment: 0.006, reply_fan: 0.05, self_reflect: 0.01,
        };
        const displayCost = finalCost ?? ESTIMATED[task.type] ?? 0.01;
        const isEstimate = isRunning && finalCost === null;
        return (
          <motion.span
            key={`cost-${task._id}-${isEstimate ? "est" : "final"}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative font-sans text-[10.5px] font-medium text-zinc-500 tabular-nums shrink-0"
          >
            {isEstimate ? "~" : ""}−${displayCost.toFixed(3)}
          </motion.span>
        );
      })()}
    </motion.div>
  );
}

// ─── ClipperBudgetPanel — per-run skill cost → runway (clipping agents) ───────
function ClipperBudgetPanel({ balance, mintAddress, sessionId }: { balance: number; mintAddress?: string; sessionId?: string }) {
  // Effective per-run prices (admin override ?? static default) so the budget
  // matches what recordUsage bills.
  const priceOverrides = (useQuery(api.adminPricing.effectiveSkillPrices, {}) as
    | { overrides: Record<string, number> } | undefined)?.overrides ?? {};
  const effPrice = (id: string) => effectiveUnitPrice(id, priceOverrides[id]) ?? 0;

  // Per-run cost must reflect the REAL run charge, which bills the marketplace
  // skills WIRED into the clip graph (compile-graph.wiredMarketplaceSkillIds) —
  // NOT the agent's installed-skill list (a different, often-empty set). The
  // saved graph is the same source of truth the RunBar estimate + the
  // clip-precheck charge derive from, so the card can never disagree with the
  // bill. Mint-preferred, sessionId fallback (matches ClippingFlowCanvas).
  const canRemote = !!(mintAddress || sessionId);
  const savedGraph = useQuery(
    api.clipGraphs.getByKey,
    canRemote ? { mintAddress, sessionId: sessionId ?? "" } : "skip",
  ) as { nodes: VelloNode[]; edges: VelloEdge[]; updatedAt: number } | null | undefined;
  const graphLoading = canRemote && savedGraph === undefined;
  const wiredSkillIds = useMemo(() => {
    const nodes = (savedGraph?.nodes ?? []) as VelloNode[];
    const edges = (savedGraph?.edges ?? []) as VelloEdge[];
    return wiredMarketplaceSkillIds(nodes, edges);
  }, [savedGraph]);

  // Priced wired skills = the rows the run actually charges (drop $0/free ops
  // like clip.speed). costPerRun = the SAME helper the RunBar + precheck use, so
  // it equals the run's charge to the cent.
  const priced = wiredSkillIds.filter((id) => effPrice(id) > 0);
  const costPerRun = clipSkillRunCostWithOverrides(wiredSkillIds, priceOverrides);
  const runsPerDay = [1, 2, 3, 5, 10];
  return (
    <section className="max-w-[820px] mx-auto px-6 py-8">
      <h2 className="font-serif text-[20px] font-bold text-zinc-900 leading-none tracking-tight mb-1">Budget</h2>
      <div className="h-px bg-zinc-900/85 mb-5" />

      <PaperCard className="p-5 mb-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-zinc-600">Cost per run</span>
          <span className="font-mono text-[22px] font-bold text-zinc-900 tabular-nums">${formatUsdc6(costPerRun)}</span>
        </div>
        <p className="text-[11.5px] text-zinc-500 mt-1">Charged once per run for the paid skills wired into your clip pipeline (install is free; render + transcription compute is included). Matches what a run charges.</p>
        <div className="mt-3 space-y-1">
          {graphLoading ? (
            <p className="text-[12px] text-zinc-400">Loading your clip pipeline…</p>
          ) : priced.length === 0 ? (
            <p className="text-[12px] text-zinc-400">No paid skills wired into your pipeline, runs are free (render + transcription compute is included). Wire skills into the Clipping canvas to power up clips.</p>
          ) : priced.map((id) => (
            <div key={id} className="flex items-center justify-between text-[12px]">
              <span className="text-zinc-600">{CLIP_SKILL_BY_ID[id]?.name ?? id}</span>
              <span className="font-mono text-zinc-700 tabular-nums">${formatUsdc6(effPrice(id))}</span>
            </div>
          ))}
        </div>
      </PaperCard>

      <PaperCard className="p-5">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-[13px] font-semibold text-zinc-900">Runway</span>
          <span className="text-[11.5px] text-zinc-500">wallet ${balance.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-200/70">
          <span className="w-20">Runs / day</span><span>$ / day</span><span>Runway</span>
        </div>
        {runsPerDay.map((rpd) => {
          const perDay = +(costPerRun * rpd).toFixed(2);
          const days = perDay > 0 ? Math.floor(balance / perDay) : Infinity;
          return (
            <div key={rpd} className="flex items-center justify-between py-2 text-[13px] border-b border-zinc-200/40 last:border-0">
              <span className="text-zinc-700 tabular-nums w-20">{rpd}</span>
              <span className="font-mono text-zinc-700 tabular-nums">${perDay.toFixed(2)}</span>
              <span className={`font-mono font-bold tabular-nums ${Number.isFinite(days) && days < 3 ? "text-rose-700" : "text-zinc-900"}`}>
                {perDay === 0 || days > 365 ? "∞" : `${days}d`}
              </span>
            </div>
          );
        })}
        <p className="text-[11px] text-zinc-500 mt-3">Top up the agent wallet (Home tab) to extend runway. Spend is swept to the platform treasury.</p>
      </PaperCard>
    </section>
  );
}

// ─── BudgetProjectionsPanel — runway scenarios + engine comparison ───────────

function BudgetProjectionsPanel({ balance, dailySkillCost, currentEngineId }: {
  balance: number;
  dailySkillCost: number;
  currentEngineId: VideoEngineId;
}) {
  const currentEngine = VIDEO_ENGINES.find(e => e.id === currentEngineId) ?? VIDEO_ENGINES[0];
  const [videoSeconds, setVideoSeconds] = useState<number>(IDEAL_VIDEO_SECONDS);

  // Cost of ONE video at the current engine + selected length
  const costPerVideo = videoCostForLength(currentEngine, videoSeconds);
  const creditsPerVideo = videoCreditsForLength(currentEngine, videoSeconds);
  const clipsPerVideo = clipsForLength(currentEngine, videoSeconds);

  // Scenarios: video cadence per day
  const CADENCES = [
    { label: "Spark",     videosPerDay: 1 },
    { label: "Daily",     videosPerDay: 3 },
    { label: "High vol",  videosPerDay: 5 },
    { label: "Saturated", videosPerDay: 10 },
  ];

  const fmtUsd = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` :
    n >= 100  ? `$${n.toFixed(0)}` :
                `$${n.toFixed(2)}`;

  const fmtDays = (d: number) => {
    if (!isFinite(d) || d <= 0) return "-";
    if (d > 365 * 2) return "∞";
    if (d >= 30) return `${Math.floor(d / 30)}mo ${Math.floor(d % 30)}d`;
    return `${Math.floor(d)}d`;
  };

  // Compute scenario data with the operator's selected engine + length
  const scenarios = CADENCES.map(c => {
    const videoCostDaily = c.videosPerDay * costPerVideo;
    const totalDaily = videoCostDaily + dailySkillCost;
    const runwayDays = totalDaily > 0 ? balance / totalDaily : Infinity;
    const monthly = totalDaily * 30;
    const depositFor30 = Math.max(0, totalDaily * 30 - balance);
    return { ...c, videoCostDaily, totalDaily, monthly, runwayDays, depositFor30 };
  });

  // Engine comparison at fixed 3/day, length = selected
  const compareCadence = 3;
  const engineComparison = VIDEO_ENGINES.map(e => {
    const perVideo = videoCostForLength(e, videoSeconds);
    const videoCostDaily = compareCadence * perVideo;
    const totalDaily = videoCostDaily + dailySkillCost;
    const runwayDays = totalDaily > 0 ? balance / totalDaily : Infinity;
    return { ...e, perVideo, clips: clipsForLength(e, videoSeconds), videoCostDaily, totalDaily, runwayDays };
  }).sort((a, b) => b.runwayDays - a.runwayDays);

  const qualityTone: Record<string, string> = {
    premium:  "text-violet-700 bg-violet-100",
    high:     "text-emerald-700 bg-emerald-100",
    balanced: "text-amber-700 bg-amber-100",
    budget:   "text-zinc-700 bg-zinc-100",
  };

  // Maximum runway across all engines (for bar visualization)
  const maxRunway = Math.min(365, Math.max(...engineComparison.map(e => isFinite(e.runwayDays) ? e.runwayDays : 0), 1));

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-8 flex flex-col gap-6">

      {/* ── Video length selector ── */}
      <div>
        <SectionHeading>Target Video Length</SectionHeading>
        <PaperCard className="p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-[12px] text-zinc-600 leading-relaxed flex-1 min-w-[200px]">
              Each step is one 8-second Veo clip, <span className="font-bold text-zinc-900">{IDEAL_VIDEO_SECONDS}s</span> ({IDEAL_VIDEO_SECONDS / 8} clips) is a strong default. Longer videos chain more clips, each with its own distinct lines.
            </p>
            <div className="flex gap-1 shrink-0">
              {STANDARD_VIDEO_LENGTHS.map(s => {
                const active = videoSeconds === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setVideoSeconds(s)}
                    className={`px-3 py-1.5 rounded-md text-[12px] font-mono font-bold transition-all border ${
                      active
                        ? "bg-zinc-900 text-white border-zinc-900"
                        : "bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500"
                    }`}
                  >
                    {s}s
                  </button>
                );
              })}
            </div>
          </div>
        </PaperCard>
      </div>

      {/* ── Top stats ── */}
      <div>
        <SectionHeading>Current State · {videoSeconds}s Video</SectionHeading>
        <PaperCard className="grid grid-cols-2 md:grid-cols-4 divide-x divide-zinc-200/70">
          <div className="px-5 py-4">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500 mb-1">Wallet Balance</p>
            <p className={`font-serif text-[22px] font-bold tabular-nums ${balance > 0 ? "text-zinc-900" : "text-zinc-400"}`}>${balance.toFixed(2)}</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">USDC on agent wallet</p>
          </div>
          <div className="px-5 py-4">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500 mb-1">Credits / Video</p>
            <p className="font-serif text-[22px] font-bold tabular-nums text-zinc-900">{creditsPerVideo.toLocaleString()}</p>
            <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">{clipsPerVideo} clip{clipsPerVideo === 1 ? "" : "s"} × {currentEngine.maxClipSeconds}s on {currentEngine.label}</p>
          </div>
          <div className="px-5 py-4">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500 mb-1">Skill Burn</p>
            <p className={`font-serif text-[22px] font-bold tabular-nums ${dailySkillCost > 0 ? "text-amber-700" : "text-zinc-400"}`}>${dailySkillCost.toFixed(2)}</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">/day fixed cost</p>
          </div>
          <div className="px-5 py-4">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500 mb-1">Base Runway</p>
            <p className={`font-serif text-[22px] font-bold tabular-nums ${dailySkillCost === 0 ? "text-emerald-700" : "text-zinc-900"}`}>
              {dailySkillCost > 0 ? fmtDays(balance / dailySkillCost) : "∞"}
            </p>
            <p className="text-[10px] text-zinc-500 mt-0.5">if zero videos produced</p>
          </div>
        </PaperCard>
      </div>

      {/* ── Cadence scenarios ── */}
      <div>
        <SectionHeading>Cadence Scenarios · {currentEngine.label} · {videoSeconds}s</SectionHeading>
        <p className="text-[12px] text-zinc-600 mb-3">
          Runway at different posting cadences. Each {videoSeconds}s video on {currentEngine.label} uses {creditsPerVideo.toLocaleString()} credits, plus daily skill burn.
        </p>
        <PaperCard className="overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-100/60">
              <tr>
                {["Cadence", "Videos/day", "Video cost", "Skills", "Daily total", "Monthly", "Runway", "Deposit for 30d"].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-500 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/70">
              {scenarios.map(s => {
                const lowRunway = s.runwayDays < 7;
                const okRunway = s.runwayDays >= 30;
                return (
                  <tr key={s.label} className="hover:bg-white/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <p className="font-serif text-[14px] font-bold text-zinc-900">{s.label}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-zinc-700 tabular-nums">{s.videosPerDay}×</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-zinc-700 tabular-nums">${s.videoCostDaily.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-zinc-700 tabular-nums">${dailySkillCost.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] font-bold tabular-nums text-zinc-900">${s.totalDaily.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] font-bold tabular-nums text-zinc-900">{fmtUsd(s.monthly)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono text-[12.5px] font-bold tabular-nums ${lowRunway ? "text-rose-700" : okRunway ? "text-emerald-700" : "text-amber-700"}`}>
                      {fmtDays(s.runwayDays)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-zinc-700">
                      {s.depositFor30 === 0 ? <span className="text-emerald-700">✓ funded</span> : `+$${s.depositFor30.toFixed(2)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PaperCard>
        <div className="mt-2 flex items-center gap-4 text-[10.5px] font-mono uppercase tracking-[0.14em] text-zinc-500">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-600" /> ≥ 30 days</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" /> 7-30 days</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-600" /> &lt; 7 days</span>
        </div>
      </div>

      {/* ── Engine comparison ── */}
      <div>
        <SectionHeading>Engine Comparison · 3 × {videoSeconds}s videos/day</SectionHeading>
        <p className="text-[12px] text-zinc-600 mb-3">
          Same posting cadence and length, different video engines. Sorted by runway, longest first. Switch engines from the Video Director tab.
        </p>
        <PaperCard className="divide-y divide-zinc-200/70">
          {engineComparison.map(e => {
            const widthPct = (Math.min(e.runwayDays, maxRunway) / maxRunway) * 100;
            const isCurrent = e.id === currentEngineId;
            return (
              <div key={e.id} className={`px-4 py-3 ${isCurrent ? "bg-emerald-50/50" : ""}`}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-serif text-[13px] font-bold text-zinc-900">{e.label}</span>
                    <span className={`text-[8.5px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${qualityTone[e.quality]}`}>{e.quality}</span>
                    {isCurrent && <span className="text-[8.5px] font-mono uppercase tracking-widest text-emerald-700 font-bold">· selected</span>}
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-mono text-[10.5px] tabular-nums text-zinc-500">{e.clips} clip{e.clips === 1 ? "" : "s"}</span>
                    <span className="font-mono text-[11px] tabular-nums text-zinc-600">{videoCreditsForLength(e, videoSeconds).toLocaleString()} credits/vid</span>
                    <span className="font-mono text-[11px] tabular-nums text-zinc-700">${e.totalDaily.toFixed(2)}/day</span>
                    <span className={`font-mono text-[13px] font-bold tabular-nums ${e.runwayDays < 7 ? "text-rose-700" : e.runwayDays >= 30 ? "text-emerald-700" : "text-amber-700"}`}>
                      {fmtDays(e.runwayDays)}
                    </span>
                  </div>
                </div>
                {/* Visual bar */}
                <div className="h-1.5 rounded-full bg-zinc-200/70 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${widthPct}%` }}
                    transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
                    className={`h-full rounded-full ${
                      e.runwayDays < 7 ? "bg-rose-500" :
                      e.runwayDays >= 30 ? "bg-emerald-500" :
                                          "bg-amber-500"
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </PaperCard>
      </div>

      {/* ── Recommended deposit ── */}
      <div>
        <SectionHeading>Recommended Deposits</SectionHeading>
        <p className="text-[12px] text-zinc-600 mb-3">
          How much USDC to send to the agent wallet for a target runway at 3 × {videoSeconds}s videos/day on <span className="font-bold text-zinc-900">{currentEngine.label}</span> + current skill burn.
        </p>
        <PaperCard className="grid grid-cols-3 divide-x divide-zinc-200/70">
          {[
            { label: "7 days", days: 7, tone: "rose" },
            { label: "30 days", days: 30, tone: "amber" },
            { label: "90 days", days: 90, tone: "emerald" },
          ].map(target => {
            // Pick a moderate cadence — 3/day — as the baseline for deposit recommendation
            const baseline = scenarios.find(s => s.videosPerDay === 3) ?? scenarios[0];
            const need = Math.max(0, baseline.totalDaily * target.days - balance);
            return (
              <div key={target.label} className="px-5 py-4 text-center">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500 mb-1">{target.label}</p>
                <p className={`font-serif text-[26px] font-bold tabular-nums ${
                  need === 0 ? "text-emerald-700" :
                  target.tone === "rose" ? "text-rose-700" :
                  target.tone === "amber" ? "text-amber-700" :
                                            "text-zinc-900"
                }`}>
                  {need === 0 ? "✓" : `$${need.toFixed(2)}`}
                </p>
                <p className="text-[10.5px] text-zinc-500 mt-1">
                  {need === 0
                    ? "already funded"
                    : `at 3 videos/day`}
                </p>
              </div>
            );
          })}
        </PaperCard>
      </div>

      {/* ── Educational footer ── */}
      <div className="rounded-md border border-zinc-300/70 bg-zinc-100/40 px-4 py-3 space-y-2">
        <p className="text-[11.5px] text-zinc-700 leading-relaxed">
          <span className="font-bold">How generation credits work:</span> each model has a maximum segment length. A {videoSeconds}s video on {currentEngine.label} uses <span className="font-mono font-bold">{clipsPerVideo} segment{clipsPerVideo === 1 ? "" : "s"} × {currentEngine.maxClipSeconds}s</span> plus its storyboard = <span className="font-mono font-bold">{creditsPerVideo.toLocaleString()} credits</span>. Segments are generated separately and stitched together.
        </p>
        <p className="text-[11.5px] text-zinc-700 leading-relaxed">
          <span className="font-bold">Runway:</span> the agent wallet pays per video + a daily skill burn (memory, retrieval, planning). When the wallet hits $0 the agent pauses. Top up via the wallet card on the Home tab.
        </p>
      </div>
    </div>
  );
}

// ─── GenerationsPanel ─────────────────────────────────────────────────────────

type GenerationTask = {
  _id: string;
  _creationTime: number;
  type: string;
  title: string;
  output?: string;
  cost?: number;
  revenue?: number;
  completedAt?: number;
};

// Video-only, minimal — same premium treatment as the Home tab's "Recent
// clips" card: full-bleed media, dark gradient, just the caption. No label
// badge, timestamp, cost, or nested detail blocks.
/** Trash button + double-confirm for a Generations card. Removes the item and
 *  (server-side) cancels any schedule rows that would still post it. */
function CardTrash({ label, description, onDelete }: { label: string; description: string; onDelete: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button type="button" aria-label={label} title={label}
        onClick={(e) => { e.stopPropagation(); setErr(null); setOpen(true); }}
        onKeyDown={(e) => e.stopPropagation()}
        className="absolute right-1.5 top-1.5 z-20 grid size-7 place-items-center rounded-md bg-black/70 text-zinc-300 ring-1 ring-white/15 backdrop-blur-sm transition-all hover:bg-rose-500 hover:text-white hover:ring-rose-400">
        <Trash2 className="size-3.5" />
      </button>
      <ConfirmDeleteDialog open={open} title={label} description={description} busy={busy} error={err}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          const e = await onDelete();
          setBusy(false);
          if (e) setErr(e); else setOpen(false);
        }} />
    </>
  );
}

function GenerationVideoCard({ task, onOpen, mintAddress, postCaption }: { task: GenerationTask; onOpen: (item: { url: string; title: string }) => void; mintAddress?: string; postCaption?: string }) {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(task.output ?? "{}"); } catch {}

  const script = parsed.script as Record<string, unknown> | null;
  const caption = typeof script?.caption === "string" ? script.caption : null;
  const hook = typeof script?.hook === "string" ? script.hook : null;

  const videoUrl = parsed.videoUrl as string | undefined;
  const shownCaption = postCaption || caption || hook || task.title;
  const storyboardImageUrl = parsed.storyboardImageUrl as string | undefined;
  if (!videoUrl && !storyboardImageUrl) return null;

  return (
    <div
      role={videoUrl ? "button" : undefined}
      tabIndex={videoUrl ? 0 : undefined}
      onClick={() => videoUrl && onOpen({ url: videoUrl, title: shownCaption })}
      onKeyDown={(e) => { if (videoUrl && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen({ url: videoUrl, title: shownCaption }); } }}
      className={`group relative aspect-[9/16] overflow-hidden rounded-lg bg-zinc-900 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.6)] ring-1 ring-white/10 transition-transform hover:-translate-y-0.5 hover:ring-white/20 ${videoUrl ? "cursor-pointer" : ""}`}
    >
      {videoUrl ? (
        // No `poster` — the storyboard image is a multi-panel grid, not this
        // clip's actual first frame. Leaving poster unset makes the browser
        // decode and show the video's own first frame instead. This IS the
        // fully burned file (hook/captions/music) — the Editor's Apply button
        // patches this same output.videoUrl in place (agentTasks.updateVideoUrl).
        <video src={videoUrl} muted loop playsInline preload="metadata"
          className="absolute inset-0 size-full object-cover"
          onMouseEnter={(e) => { void e.currentTarget.play(); }}
          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={storyboardImageUrl} alt={task.title} className="absolute inset-0 size-full object-cover" />
      )}
      {mintAddress && (
        <CardTrash label="Delete this video?"
          description="This permanently removes the video and cancels any scheduled posts for it. This can't be undone."
          onDelete={() => postDelete("/api/generations/delete", { id: task._id, mintAddress })} />
      )}
      {videoUrl && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/25">
          <span className="grid size-10 scale-90 place-items-center rounded-full bg-black/60 opacity-0 ring-1 ring-white/25 transition-all group-hover:scale-100 group-hover:opacity-100">
            <Play className="size-4 translate-x-px fill-white text-white" />
          </span>
        </span>
      )}
      {/* Real billed cost, in credits (1 credit = $0.01) — task.cost is the
          exact amount agentTasks.succeed charged for THIS generation (video
          clips + storyboard/keyframe image floor included), so it scales with
          the requested length/engine dynamically instead of a flat label. */}
      {typeof task.cost === "number" && task.cost > 0 && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-lime-300 ring-1 ring-white/15 backdrop-blur-sm">
          ⚡ {Math.max(1, Math.round(task.cost * 100)).toLocaleString()}
        </span>
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5 pt-8">
        <p className="line-clamp-2 text-[11.5px] leading-snug text-white/80 drop-shadow">{shownCaption}</p>
      </div>
    </div>
  );
}

type CampaignSubmission = {
  _id: string;
  status: string;
  platform?: string;
  postUrl?: string;
  payoutAmountUsdc?: number;
  viewCount?: number;
  campaign?: { brandName?: string; title?: string; ratePerThousandViews?: number } | null;
};

// Tinted fills only — the boxy badge supplies its own black border (nb style).
const SUBMISSION_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: "Joined · awaiting post", cls: "bg-amber-100 text-amber-700" },
  submitted: { label: "Submitted",              cls: "bg-sky-100 text-sky-700" },
  verified:  { label: "Verified · paid",        cls: "bg-emerald-100 text-emerald-700" },
  approved:  { label: "Approved",               cls: "bg-emerald-100 text-emerald-700" },
  rejected:  { label: "Rejected",               cls: "bg-rose-100 text-rose-700" },
};

function CampaignSubmissionRow({ sub }: { sub: CampaignSubmission }) {
  const badge = SUBMISSION_BADGE[sub.status] ?? { label: sub.status, cls: "bg-zinc-100 text-zinc-600" };
  const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl flex items-center gap-3 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-white truncate">{sub.campaign?.brandName ?? "Campaign"}</p>
        <p className="text-[11px] text-zinc-500 truncate">{(sub.campaign?.title ?? "").slice(0, 70)}</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {sub.platform && <span className="text-[9.5px] font-mono uppercase tracking-wide text-zinc-500">{cap(sub.platform)}</span>}
          {sub.postUrl && (
            <a href={sub.postUrl} target="_blank" rel="noopener noreferrer" className="text-[10.5px] font-medium text-sky-400 hover:underline">View post ↗</a>
          )}
          {typeof sub.viewCount === "number" && sub.viewCount > 0 && (
            <span className="text-[10px] text-zinc-500 tabular-nums">{sub.viewCount.toLocaleString()} views</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={`rounded-[3px] border-[1.5px] border-black/40 px-2 py-0.5 text-[9.5px] font-semibold ${badge.cls}`}>{badge.label}</span>
        {typeof sub.payoutAmountUsdc === "number" && sub.payoutAmountUsdc > 0 && (
          <span className="font-mono text-[11px] font-bold text-lime-400 tabular-nums">+${sub.payoutAmountUsdc.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
}

function GenerationsPanel({ generations, clips, submissions, agentName, gif, mintAddress }: { generations: GenerationTask[] | undefined; clips?: Doc<"clips">[] | undefined; submissions: CampaignSubmission[] | undefined; agentName: string; gif?: string; mintAddress?: string }) {
  // Full-screen playback for any card in this tab (videos or clips) — same
  // ClipLightbox the Home tab's "Recent clips" strip uses, just its own
  // independent instance here since a click can come from either grid.
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);
  const grouped = useMemo(() => {
    if (!generations) return null;
    const vids  = generations.filter(g => g.type === "create_video");
    const posts = generations.filter(g => g.type === "post_content");
    const other = generations.filter(g => !["create_video", "post_content"].includes(g.type));
    return { vids, posts, other, all: generations };
  }, [generations]);

  // The caption each video is ACTUALLY going to post with = its scheduled drip
  // row's caption (set when it was queued), keyed by videoUrl / taskId. Beats the
  // clip's raw transcript snippet / title, which is what these cards showed before.
  const schedRows = useQuery(api.scheduledContent.listByMint, mintAddress ? { mintAddress } : "skip") as
    { status: string; caption?: string; videoUrl?: string; taskId?: string; createdAt: number }[] | undefined;
  const postCaptions = useMemo(() => {
    const byUrl = new Map<string, string>();
    const byTask = new Map<string, string>();
    for (const r of [...(schedRows ?? [])].sort((a, b) => a.createdAt - b.createdAt)) {
      if (r.status === "cancelled" || !r.caption?.trim()) continue;
      if (r.videoUrl) byUrl.set(r.videoUrl, r.caption);
      if (r.taskId) byTask.set(String(r.taskId), r.caption);
    }
    return { byUrl, byTask };
  }, [schedRows]);

  const subs = submissions ?? [];
  const campaignRevenue = subs.reduce((s, x) => s + (x.payoutAmountUsdc ?? 0), 0);

  // Clipping pipeline output (the header "Clip" button's real run lands here) —
  // newest first, "skipped" dropped (a deliberate operator removal, not a result
  // worth showing), capped so a long clip history doesn't flood the grid.
  const recentClips = useMemo(
    () => (clips ?? []).filter((c) => c.status !== "skipped").sort((a, b) => b.createdAt - a.createdAt).slice(0, 24),
    [clips],
  );

  if (!generations) {
    return (
      <div className="min-h-full flex items-center justify-center py-32 text-zinc-500 text-[13px]" style={WARM_GLASS_BG}>
        <span className="animate-pulse font-mono uppercase tracking-[0.18em]">Loading generations…</span>
      </div>
    );
  }

  if (generations.length === 0 && subs.length === 0 && recentClips.length === 0) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center py-32 gap-4 text-center px-8" style={WARM_GLASS_BG}>
        <div className="size-16 rounded-2xl overflow-hidden border border-white/15 shrink-0">
          {gif ? <img src={gif} alt={agentName} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/5 flex items-center justify-center"><Film className="size-7 text-zinc-500" /></div>}
        </div>
        <div>
          <p className="font-serif text-[17px] font-bold text-white">{agentName}</p>
          <p className="text-[12px] text-zinc-500 mt-1.5 max-w-xs leading-relaxed">
            No generations yet. Run the agent from the Home tab to produce videos and posts, or join a Vello campaign.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full px-6 py-6" style={{ ...WARM_GLASS_BG, fontFamily: "var(--font-geist-sans, system-ui)" }}>
      <div className="mb-5"><TabPageHeader icon={Layers} title="Generations" blurb="Everything this agent has produced." /></div>
      {/* Stats bar */}
      <div className="flex items-center gap-6 mb-6 pb-4 border-b border-white/10">
        <div>
          <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.18em]">Total</p>
          <p className="text-[22px] font-bold text-white tabular-nums">{generations.length}</p>
        </div>
        <div>
          <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.18em]">Videos</p>
          <p className="text-[22px] font-bold text-white tabular-nums">{grouped?.vids.length ?? 0}</p>
        </div>
        <div>
          <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.18em]">Campaigns</p>
          <p className="text-[22px] font-bold text-white tabular-nums">{subs.length}</p>
        </div>
        <div className="ml-auto">
          <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.18em]">Revenue</p>
          <p className="text-[22px] font-bold text-lime-400 tabular-nums font-mono">
            ${(generations.reduce((s, g) => s + (g.revenue ?? 0), 0) + campaignRevenue).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Joined campaigns + submissions */}
      {subs.length > 0 && (
        <div className="mb-7">
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.18em] mb-2.5">Campaigns · {subs.length}</p>
          <div className="flex flex-col gap-2">
            {subs.map(s => <CampaignSubmissionRow key={s._id} sub={s} />)}
          </div>
        </div>
      )}

      {/* Clipping pipeline runs — live rendering → ready, so a freshly-clicked
          "Clip" in the Editor tab animates its cards in here in real time. */}
      {recentClips.length > 0 && (
        <div className="mb-7">
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.18em] mb-2.5">Clips · {recentClips.length}</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4">
            <AnimatePresence initial={false}>
              {recentClips.map((c) => <ClipGenerationCard key={c._id} clip={c} onOpen={setLightbox} mintAddress={mintAddress} postCaption={c.clipUrl ? postCaptions.byUrl.get(c.clipUrl) : undefined} />)}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Videos only, same premium card treatment as the Home tab's "Recent clips". */}
      {(grouped?.vids.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4">
          {grouped!.vids.map(g => <GenerationVideoCard key={g._id} task={g} onOpen={setLightbox} mintAddress={mintAddress} postCaption={postCaptions.byTask.get(String(g._id))} />)}
        </div>
      )}

      <ClipLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

/** One card in the Clips section — a shimmering skeleton while `status` is
 *  still "rendering" (no clipUrl yet), a real playable card once it lands,
 *  or a compact failure card with the captured reason. Animates in/out via
 *  the parent's AnimatePresence so a fresh run's cards pop in smoothly
 *  instead of just appearing, and a card doesn't just vanish. */
function ClipGenerationCard({ clip, onOpen, mintAddress, postCaption }: { clip: Doc<"clips">; onOpen: (item: { url: string; title: string }) => void; mintAddress?: string; postCaption?: string }) {
  const shownCaption = postCaption || clip.captionText || clip.title;
  const rendering = !clip.clipUrl && clip.status !== "failed";
  const playable = !rendering && clip.status !== "failed" && !!clip.clipUrl;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      role={playable ? "button" : undefined}
      tabIndex={playable ? 0 : undefined}
      onClick={() => playable && onOpen({ url: clip.clipUrl!, title: shownCaption })}
      onKeyDown={(e) => { if (playable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen({ url: clip.clipUrl!, title: shownCaption }); } }}
      className={`group relative aspect-[9/16] overflow-hidden rounded-lg bg-zinc-900 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.6)] ring-1 ring-white/10 transition-transform hover:-translate-y-0.5 hover:ring-white/20 ${playable ? "cursor-pointer" : ""}`}
    >
      {rendering ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-gradient-to-br from-white/[0.06] to-transparent">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-lime-400/10 via-transparent to-transparent" />
          <Loader2 className="size-5 animate-spin text-lime-400/80" />
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">Clipping…</span>
        </div>
      ) : clip.status === "failed" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-rose-950/30 px-3 text-center">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-rose-400">Failed</span>
          {clip.failReason && <p className="line-clamp-3 text-[10px] leading-snug text-rose-300/80">{clip.failReason}</p>}
        </div>
      ) : (
        <video src={clip.clipUrl} muted loop playsInline preload="metadata"
          className="absolute inset-0 size-full object-cover"
          onMouseEnter={(e) => { void e.currentTarget.play(); }}
          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
      )}
      {mintAddress && (
        <CardTrash label="Delete this clip?"
          description="This permanently removes the clip and cancels any scheduled posts for it. This can't be undone."
          onDelete={() => postDelete("/api/clips/delete", { clipId: clip._id, mintAddress })} />
      )}
      {playable && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/25">
          <span className="grid size-10 scale-90 place-items-center rounded-full bg-black/60 opacity-0 ring-1 ring-white/25 transition-all group-hover:scale-100 group-hover:opacity-100">
            <Play className="size-4 translate-x-px fill-white text-white" />
          </span>
        </span>
      )}
      {!rendering && clip.status !== "failed" && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5 pt-8">
            <p className="line-clamp-2 text-[11.5px] leading-snug text-white/80 drop-shadow">{shownCaption}</p>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ─── Video Engine picker — dropdown of available Kie video models ────────────

// ─── Living Memory row — label + value + leftmost ? tooltip ─────────────────

function LivingMemoryRow({ label, tooltip, children }: { label: string; tooltip: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        {/* ? help button, leftmost */}
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onClick={() => setOpen(o => !o)}
            aria-label={`What is ${label}?`}
            className="flex items-center justify-center size-4 rounded-full bg-zinc-200 hover:bg-zinc-300 text-zinc-600 hover:text-zinc-900 text-[10px] font-bold transition-colors"
          >
            ?
          </button>
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: -2, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -2, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 top-full mt-2 z-30 w-[260px] rounded-lg bg-zinc-900 text-white px-3 py-2 shadow-xl"
                role="tooltip"
              >
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400 mb-1">{label}</p>
                <p className="text-[11.5px] leading-relaxed text-zinc-100">{tooltip}</p>
                {/* arrow */}
                <span className="absolute -top-1 left-2 size-2 bg-zinc-900 rotate-45" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <span className="text-[13px] text-zinc-800 font-medium">{label}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Document edit modal — edit / delete knowledge entries ──────────────────

function DocumentEditModal({ doc, onClose }: {
  doc: { _id: string; title: string; content: string; tags: string[] };
  onClose: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const [tagsRaw, setTagsRaw] = useState(doc.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateMutation = useMutation(api.agentKnowledge.updateEntry);
  const deleteMutation = useMutation(api.agentKnowledge.deleteEntry);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    try {
      const tags = tagsRaw.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateMutation({ id: doc._id as any, title: title.trim() || "Untitled", content, tags });
      onClose();
    } catch (e) {
      console.error("[doc-edit] save failed", e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await deleteMutation({ id: doc._id as any });
      onClose();
    } catch (e) {
      console.error("[doc-edit] delete failed", e);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xl"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[680px] max-h-[88vh] flex flex-col rounded-xl bg-[#fbfaf6] border border-zinc-300 shadow-2xl overflow-hidden"
        style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <div className="min-w-0">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-500">Edit Document</p>
            <p className="font-serif text-[17px] font-bold text-zinc-900 leading-tight mt-0.5 truncate">{doc.title}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900 transition-colors text-[15px]"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500 block mb-1.5">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full font-serif text-[15px] font-bold text-zinc-900 px-3 py-2 rounded-md border border-zinc-300 bg-white focus:border-zinc-500 outline-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500 block mb-1.5">Tags (comma-separated)</label>
            <input
              value={tagsRaw}
              onChange={e => setTagsRaw(e.target.value)}
              placeholder="brand, voice, hooks"
              className="w-full text-[13px] text-zinc-900 px-3 py-2 rounded-md border border-zinc-300 bg-white focus:border-zinc-500 outline-none font-mono"
            />
          </div>

          {/* Content */}
          <div>
            <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500 block mb-1.5">Content</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              spellCheck={false}
              className="w-full min-h-[260px] text-[12.5px] text-zinc-900 px-3 py-2 rounded-md border border-zinc-300 bg-white focus:border-zinc-500 outline-none font-mono leading-relaxed resize-y"
            />
            <p className="text-[10.5px] text-zinc-500 font-mono mt-1">{content.length} chars</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-200 bg-zinc-50">
          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-rose-700 font-mono uppercase tracking-wide">Delete?</span>
              <button
                onClick={remove}
                disabled={deleting}
                className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Confirm"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-900"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase px-3 py-1.5 rounded-md text-rose-700 border border-rose-300 hover:bg-rose-50"
            >
              Delete
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase px-3 py-1.5 rounded-md text-zinc-800 border border-zinc-300 bg-white hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase px-4 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-md bg-white/60 border border-zinc-200/70 px-2 py-2 text-center">
      <p className="font-serif text-[20px] font-bold text-zinc-900 leading-none">{value}{suffix ?? ""}</p>
      <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-500 mt-1">{label}</p>
    </div>
  );
}

interface TaskItem {
  id: string;
  title: string;
  description: string;
  category: string;
  status?: string;
  /** Human label for when this task is scheduled to run (e.g. "Runs daily"). */
  schedule?: string;
  /** Sort key — lower runs sooner. Drives the "top runs first" ordering. */
  runOrder?: number;
  /** When set, the card shows a Generate button that hits /api/agents/run-task */
  runnable?: {
    taskType: "create_video" | "analyze_trend" | "engage_comment" | "reply_fan" | "research" | "self_reflect" | "campaign_submit" | "post_content" | "find_jobs";
    buildInput: (blueprint: AgentBlueprint) => Record<string, unknown>;
    /** Optional cost preview shown on the button */
    estimatedCost?: number;
  };
}

function TaskCardRunnable({
  task, blueprint, isMinted, recentTasks,
}: {
  task: TaskItem;
  blueprint: AgentBlueprint;
  isMinted: boolean;
  recentTasks: Array<{ _id: string; _creationTime: number; type: string; status: string; startedAt?: number; completedAt?: number; output?: string; errorMessage?: string }>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [localResult, setLocalResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false); // collapsed by default, expand only when the toggle is clicked
  const reduceMotion = useReducedMotion();

  // Find the most recent real task of this type. The card mirrors its
  // live status so triggering the same task type from chat / autonomy / strip
  // is reflected here too. Convex reactivity keeps `recentTasks` fresh.
  const taskType = task.runnable?.taskType;
  const matchingTask = useMemo(() => {
    if (!taskType) return undefined;
    return recentTasks
      .filter(t => t.type === taskType)
      .sort((a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0))[0];
  }, [recentTasks, taskType]);

  // Tick while a task is in-flight (re-evaluate staleness) and during the brief
  // "just-finished" celebration window so the card self-heals without a refresh.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const inFlight = matchingTask?.status === "pending" || matchingTask?.status === "running";
    const justDone = !!matchingTask?.completedAt && Date.now() - matchingTask.completedAt < 12_000;
    if (!inFlight && !justDone) return;
    const id = setInterval(() => forceTick(x => x + 1), inFlight ? 3000 : 1000);
    return () => clearInterval(id);
  }, [matchingTask?.status, matchingTask?.completedAt, matchingTask?._id]);

  const now = Date.now();
  // A pending/running task older than its run budget is DEAD — a killed run-task,
  // an interrupted deploy, or a tab closed mid-run. The server's maxDuration is
  // 5 min, so anything past that is never coming back. Treat it as stale so the
  // card unblocks and can be re-run instead of spinning forever doing nothing.
  const staleBudgetMs = matchingTask?.type === "create_video" ? 12 * 60_000 : 6 * 60_000;
  const matchingIsStale =
    !!matchingTask &&
    (matchingTask.status === "pending" || matchingTask.status === "running") &&
    now - (matchingTask.startedAt ?? matchingTask._creationTime) > staleBudgetMs;

  const phase: "idle" | "running" | "celebrating" | "failed" = (() => {
    if (submitting) return "running";
    if (!matchingTask) return "idle";
    if ((matchingTask.status === "pending" || matchingTask.status === "running") && !matchingIsStale) return "running";
    if (matchingTask.status === "succeeded" && matchingTask.completedAt && now - matchingTask.completedAt < 10_000) return "celebrating";
    if (matchingTask.status === "failed" && matchingTask.completedAt && now - matchingTask.completedAt < 10_000) return "failed";
    return "idle";
  })();

  const liveOutput = useMemo(() => {
    if (localResult) return localResult;
    if (matchingTask?.status === "succeeded" && matchingTask.output) {
      try { return JSON.parse(matchingTask.output) as Record<string, unknown>; } catch { return null; }
    }
    return null;
  }, [matchingTask, localResult]);

  // Send the operator's Supabase token so "Run" is authorized in production
  // (run-task is auth-gated; local dev has a no-token bypass).
  const { accessToken } = useSupabaseAuth();
  // Stop a running/stuck task so the card frees up and can be re-run.
  const cancelTask = useMutation(api.agentTasks.cancel);
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    setStopping(true);
    try {
      if (matchingTask?._id) await cancelTask({ id: matchingTask._id as Id<"agentTasks"> });
    } catch { /* ignore */ }
    setSubmitting(false); setLocalResult(null); setErr(null); setStopping(false);
  };

  const run = async () => {
    if (!task.runnable || !blueprint.mintAddress || phase === "running") return;
    setSubmitting(true); setErr(null); setLocalResult(null);
    try {
      // Clear a dead/stale task of this type first so it doesn't linger as
      // "running" and so the autonomy in-flight dedup doesn't skip the new run.
      if (matchingIsStale && matchingTask?._id) {
        await cancelTask({ id: matchingTask._id as Id<"agentTasks"> }).catch(() => { /* best-effort */ });
      }
      const input = task.runnable.buildInput(blueprint);
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          mintAddress: blueprint.mintAddress,
          taskType: task.runnable.taskType,
          title: task.title,
          input,
          triggeredBy: "user_studio_card",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.message ?? data.error ?? "Task failed");
      setLocalResult(data.output ?? {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  // Border / background colour pulses by phase
  const ringClass = phase === "running"
    ? "ring-2 ring-amber-300/70 shadow-[0_0_18px_-4px_rgba(245,158,11,0.55)]"
    : phase === "celebrating"
      ? "ring-2 ring-emerald-400/80 shadow-[0_0_22px_-2px_rgba(16,185,129,0.55)]"
      : phase === "failed"
        ? "ring-2 ring-rose-300/70"
        : "";

  // Show the expander only when there's actually more to reveal: a result, or a
  // description long enough that the 2-line clamp hides part of it.
  // Expandable whenever there's something to watch in the viewing place — a live
  // run, a finished response, a failure, or a long description.
  const expandable = !!liveOutput || phase === "running" || phase === "failed" || (task.description?.length ?? 0) > 90;

  return (
    <motion.div
      // One-shot pop on completion only — no looping bob (jitter reads cheap).
      animate={phase === "celebrating" && !reduceMotion ? { scale: [1, 1.012, 1] } : {}}
      transition={{ duration: 0.45, ease: [0, 0, 0.2, 1] }}
    >
      <div className={`nb-card p-5 relative overflow-hidden transition-shadow duration-300 ${ringClass}`}>
        <AnimatePresence>
          {phase === "running" && (
            <motion.div
              key="running-fx"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
            >
              {/* Indeterminate progress bar, a calm, professional "working" signal */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] overflow-hidden bg-amber-500/15">
                {reduceMotion ? (
                  <div className="h-full w-1/3 rounded-full bg-amber-400/80" />
                ) : (
                  <motion.div
                    className="h-full w-1/3 rounded-full bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300"
                    initial={{ x: "-120%" }}
                    animate={{ x: "330%" }}
                    transition={{ duration: 1.3, repeat: Infinity, ease: [0.4, 0, 0.2, 1] }}
                  />
                )}
              </div>
              {/* Soft breathing glow, communicates activity without moving the card */}
              <motion.div
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-100/40 via-transparent to-transparent"
                animate={reduceMotion ? { opacity: 0.45 } : { opacity: [0.22, 0.55, 0.22] }}
                transition={reduceMotion ? { duration: 0.2 } : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.div>
          )}
          {phase === "celebrating" && (
            <motion.div
              key="celebrate"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.6, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.4 }}
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-100/60 via-transparent to-transparent"
            />
          )}
        </AnimatePresence>

        {/* Small circular collapse/expand toggle, top-right corner of the card */}
        {expandable && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            title={expanded ? "Collapse" : "Expand"}
            className="absolute top-3 right-3 z-20 size-7 rounded-full border border-zinc-200 bg-white/90 backdrop-blur-sm flex items-center justify-center text-zinc-400 hover:text-zinc-900 hover:border-zinc-400 transition-colors"
          >
            {/* Arrow always points down, collapse/expand state is conveyed by the
                card body, not by rotating the chevron. */}
            <ChevronDown className="size-4" />
          </button>
        )}

        <div className="relative">
          <h3 className="font-serif text-[17px] leading-[1.25] text-zinc-900 font-bold mb-1.5 pr-8">{task.title}</h3>
          <p className={`text-[13px] text-zinc-700 leading-[1.5] mb-4 ${expanded ? "" : "line-clamp-2"}`}>{task.description}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <CategoryTag>{task.category}</CategoryTag>
            {task.status && <CategoryTag tone="amber">{task.status}</CategoryTag>}
            {task.schedule && phase === "idle" && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.13em] text-zinc-500">
                <Clock className="size-2.5" aria-hidden />
                {task.schedule}
              </span>
            )}
            <AnimatePresence mode="wait">
              {phase === "running" && (
                <motion.span
                  key="running-pill"
                  initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }}
                  transition={{ duration: 0.18 }}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] border border-orange-500/70 bg-orange-50 text-orange-700 font-mono text-[10px] uppercase tracking-[0.14em] font-bold"
                >
                  <Loader2 className="size-2.5 animate-spin" aria-hidden />
                  {taskType === "create_video" ? "rendering in background" : "generating"}
                </motion.span>
              )}
              {phase === "celebrating" && (
                <motion.span
                  key="done-pill"
                  initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.25, ease: "backOut" }}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-mono text-[10px] uppercase tracking-[0.14em] font-bold"
                >
                  <CheckCircle2 className="size-2.5" />
                  done
                </motion.span>
              )}
              {phase === "failed" && (
                <motion.span
                  key="fail-pill"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-mono text-[10px] uppercase tracking-[0.14em] font-bold"
                >
                  failed
                </motion.span>
              )}
            </AnimatePresence>
            {/* While running: a Stop button to kill a stuck/unwanted run. */}
            {task.runnable && phase === "running" && (
              <button
                type="button"
                onClick={() => void stop()}
                disabled={stopping}
                className="duo-btn duo-btn-rose duo-btn-sm ml-auto"
                title="Stop this run"
              >
                {stopping ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <X className="size-3.5" />}
                {stopping ? "Stopping…" : "Stop"}
              </button>
            )}
            {task.runnable && phase !== "running" && (
              <button
                type="button"
                onClick={run}
                disabled={!isMinted}
                className="duo-btn duo-btn-emerald duo-btn-sm ml-auto"
                title={!isMinted ? "Mint the agent first" : `Estimated cost: $${task.runnable.estimatedCost?.toFixed(3) ?? "0.01"}`}
              >
                {phase === "celebrating" ? (
                  <>
                    <CheckCircle2 className="size-3.5" />
                    Run again
                    {task.runnable.estimatedCost != null && (
                      <span className="ml-1 rounded-md bg-black/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums">${task.runnable.estimatedCost.toFixed(2)}</span>
                    )}
                  </>
                ) : (
                  <>
                    <Activity className="size-3.5" />
                    Generate
                    {task.runnable.estimatedCost != null && (
                      <span className="ml-1 rounded-md bg-black/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums">${task.runnable.estimatedCost.toFixed(2)}</span>
                    )}
                  </>
                )}
              </button>
            )}
          </div>

          {/* ── Viewing place ── a scrollable container that shows what the agent
              is doing live, then the response it produced. Revealed when the card
              is expanded. */}
          <AnimatePresence>
            {expanded && (phase === "running" || phase === "failed" || liveOutput) && (
              <motion.div
                key="viewer"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-4 pt-4 border-t border-zinc-200"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                    {phase === "running" ? "Live · working" : phase === "failed" ? "Failed" : "Response"}
                  </p>
                  {phase === "running" && (
                    <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em] text-amber-600">
                      <Loader2 className="size-2.5 animate-spin" /> thinking
                    </span>
                  )}
                </div>

                {/* Scrollable feed/response box */}
                <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 text-[12px] leading-relaxed">
                  {phase === "running" ? (
                    <TaskRunningFeed taskType={taskType} title={task.title} description={task.description} />
                  ) : phase === "failed" ? (
                    <p className="text-rose-700">{err ?? matchingTask?.errorMessage ?? "Task failed."}</p>
                  ) : liveOutput ? (
                    <div className="space-y-3">
                      <TaskResultPreview taskType={task.runnable?.taskType} result={liveOutput} />
                      <details>
                        <summary className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-600">raw json</summary>
                        <pre className="mt-1.5 text-[10.5px] text-zinc-700 bg-zinc-50 p-2 rounded border border-zinc-200 whitespace-pre-wrap break-words">
                          {JSON.stringify(liveOutput, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {err && phase !== "failed" && (
            <p className="mt-3 text-[11.5px] text-rose-700">{err}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// What the agent is doing right now, per task type — an honest one-liner of the
// work in flight (we don't stream the model's tokens, so we describe the step
// rather than fake granular sub-steps).
const RUNNING_ACTIVITY: Record<string, string> = {
  research:       "Reading persona + memory, then researching and writing findings",
  analyze_trend:  "Scanning the niche for what's trending right now",
  create_video:   "Writing the script + storyboard, then rendering in the background",
  post_content:   "Drafting copy in voice and publishing to connected accounts",
  campaign_submit:"Preparing the deliverable and submitting to the campaign",
  find_jobs:      "Searching open campaigns that match the niche",
  check_wallet:   "Reading the on-chain balance and deciding the next move",
  self_reflect:   "Reviewing recent tasks and extracting lessons",
  engage_comment: "Reading the thread and writing a reply in voice",
  reply_fan: "Drafting a fan reply + rendering the reply video",
};

/** Live "working" feed shown inside the viewing place while a task runs. */
function TaskRunningFeed({ taskType, title, description }: { taskType?: string; title: string; description?: string }) {
  const activity = (taskType && RUNNING_ACTIVITY[taskType]) || "Thinking and working on this task";
  return (
    <div className="space-y-2">
      <p className="text-zinc-800 font-medium">{title}</p>
      <div className="flex items-start gap-2 text-zinc-600">
        <Loader2 className="size-3.5 animate-spin mt-0.5 text-amber-500 shrink-0" />
        <p className="leading-snug">
          {activity}
          <AnimatedEllipsis />
        </p>
      </div>
      {description && <p className="text-[11.5px] text-zinc-500 leading-snug">{description}</p>}
      <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-400 pt-1">
        Powered by Kie · the response appears here when ready
      </p>
    </div>
  );
}

/** A small animated "…" so the working state visibly breathes. */
function AnimatedEllipsis() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d % 3) + 1), 450);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono">{".".repeat(dots)}</span>;
}

/**
 * Per-task-type pretty renderer. For known shapes we render the key fields nicely;
 * for unknown shapes the raw JSON details fallback shows everything.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TaskResultPreview({ taskType, result }: { taskType?: string; result: any }) {
  if (!result) return null;

  if (taskType === "create_video" && result.script) {
    const s = result.script as Record<string, unknown>;
    return (
      <div className="space-y-2.5">
        {Boolean(s.hook) && (
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-700 mb-1">Hook</p>
            <p className="font-serif text-[15px] font-bold text-zinc-900 leading-snug">{String(s.hook)}</p>
          </div>
        )}
        {Boolean(s.script) && (
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500 mb-1">Script</p>
            <p className="text-[12.5px] text-zinc-800 leading-[1.55] whitespace-pre-wrap">{String(s.script)}</p>
          </div>
        )}
        {Boolean(s.caption) && (
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500 mb-1">Caption</p>
            <p className="text-[12.5px] text-zinc-700 italic">&ldquo;{String(s.caption)}&rdquo;</p>
          </div>
        )}
        {Array.isArray(s.hashtags) && s.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(s.hashtags as string[]).slice(0, 10).map((h) => (
              <span key={h} className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">{h.startsWith("#") ? h : `#${h}`}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (taskType === "analyze_trend" && result.trends?.trends) {
    const trends = result.trends.trends as Array<Record<string, unknown>>;
    return (
      <div className="space-y-3">
        {trends.slice(0, 3).map((t, i) => (
          <div key={i} className="border-l-2 border-zinc-900/30 pl-3">
            <p className="font-serif text-[14px] font-bold text-zinc-900 leading-tight">{String(t.topic ?? "-")}</p>
            <p className="text-[11.5px] text-zinc-600 leading-snug mt-1">{String(t.why_now ?? "")}</p>
            {Boolean(t.angle_for_me) && (
              <p className="text-[11.5px] text-emerald-700 italic mt-1">→ {String(t.angle_for_me)}</p>
            )}
          </div>
        ))}
        {result.trends.recommended_first_post && (
          <p className="text-[11.5px] text-zinc-800 bg-emerald-50 border border-emerald-200 rounded p-2 mt-2">
            <span className="font-bold">Ship today:</span> {String(result.trends.recommended_first_post)}
          </p>
        )}
      </div>
    );
  }

  if (taskType === "engage_comment" && result.reply?.reply) {
    return (
      <div className="space-y-1.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">Reply</p>
        <p className="text-[13px] text-zinc-900 italic">&ldquo;{String(result.reply.reply)}&rdquo;</p>
        {result.reply.tone && <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">tone: {String(result.reply.tone)}</p>}
      </div>
    );
  }

  if (taskType === "self_reflect" && result.lessons?.lessons) {
    const lessons = result.lessons.lessons as Array<Record<string, unknown>>;
    return (
      <div className="space-y-2">
        {lessons.map((l, i) => (
          <div key={i} className="flex items-start gap-2 text-[12px] text-zinc-800">
            <span className={`font-mono text-[9px] uppercase tracking-[0.16em] px-1 py-0.5 rounded mt-0.5 ${l.kind === "warning" ? "bg-amber-100 text-amber-800" : l.kind === "preference" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"}`}>
              {String(l.kind ?? "lesson")}
            </span>
            <span className="leading-snug">{String(l.summary ?? "")}</span>
          </div>
        ))}
      </div>
    );
  }

  if (taskType === "research" && result.findings) {
    const f = result.findings as Record<string, unknown>;
    return (
      <div className="space-y-2">
        <p className="text-[12.5px] text-zinc-800 leading-snug">{String(f.summary ?? "")}</p>
        {Array.isArray(f.key_facts) && (
          <ul className="space-y-1">
            {(f.key_facts as string[]).slice(0, 5).map((fact, i) => (
              <li key={i} className="text-[11.5px] text-zinc-700 flex gap-1.5"><span>·</span><span>{fact}</span></li>
            ))}
          </ul>
        )}
        {Boolean(f.how_i_use_this) && (
          <p className="text-[11.5px] text-emerald-700 italic">→ {String(f.how_i_use_this)}</p>
        )}
      </div>
    );
  }

  return <p className="text-[12px] text-zinc-700">Task completed, see raw JSON below.</p>;
}

// ─── Task history (the "Tasks" tab) — every task the agent has run, newest first.
function TaskHistoryPanel({ tasks, agentName, gif }: {
  tasks: Array<{ _id: string; _creationTime: number; type: string; title: string; status: string; completedAt?: number }>;
  agentName: string;
  gif?: string;
}) {
  if (!tasks.length) {
    // Mirrors the Generations tab empty state: agent image + name + plain copy.
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center px-8">
        <div className="size-16 overflow-hidden border-2 border-[#1c1c1f] rounded-[5px] shadow-[4px_4px_0_0_#1c1c1f] shrink-0 bg-zinc-100">
          {gif
            ? /* eslint-disable-next-line @next/next/no-img-element */
              <img src={gif} alt={agentName} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><Activity className="size-7 text-zinc-400" /></div>}
        </div>
        <div>
          <p className="font-serif text-[17px] font-bold text-zinc-900">{agentName}</p>
          <p className="text-[12px] text-zinc-500 mt-1.5 max-w-xs leading-relaxed">
            No tasks yet. Run a task from the Home tab or fire the heartbeat. The full history shows up here.
          </p>
        </div>
      </div>
    );
  }
  const sorted = [...tasks].sort((a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0));
  const statusColor: Record<string, string> = {
    succeeded: "text-emerald-700 bg-emerald-500/12",
    failed: "text-rose-700 bg-rose-500/12",
    running: "text-amber-700 bg-amber-500/12",
    pending: "text-zinc-600 bg-zinc-500/12",
    cancelled: "text-zinc-400 bg-zinc-400/12",
  };
  return (
    <section className="max-w-[900px] mx-auto px-6 py-8">
      <h2 className="font-serif text-[20px] font-bold text-zinc-900 leading-none tracking-tight mb-1">Task history</h2>
      <div className="h-px bg-zinc-900/85 mb-4" />
      <div className="flex flex-col gap-3">
        {sorted.map((t) => (
          <div key={t._id} className="nb-card flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-zinc-900 truncate">{t.title || t.type.replace(/_/g, " ")}</p>
              <p className="text-[11px] text-zinc-500">{t.type.replace(/_/g, " ")} · {new Date(t._creationTime).toLocaleString()}</p>
            </div>
            <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-[3px] border-[1.5px] border-[#1c1c1f] capitalize ${statusColor[t.status] ?? "text-zinc-500 bg-zinc-500/12"}`}>{t.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Per-agent daily spend cap — editable row in the Earnings card. Blank = global
 * default, 0 = no limit. Backs the same cap recordUsage enforces.
 */
function DailyCapControl({ mintAddress }: { mintAddress: string }) {
  const today = useQuery(api.usage.todaysSpendQuery, { mintAddress });
  // setDailyCap is now secret-gated — go through the authed, ownership-scoped
  // /api/economy/set-cap route with the operator's Privy token.
  const { getFreshToken } = useSupabaseAuth();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cap = today?.capUsdc ?? 10;
  const spent = today?.spentTodayUsdc ?? 0;

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const n = val.trim() === "" ? undefined : Math.max(0, Number(val));
      const token = await getFreshToken();
      const res = await fetch("/api/economy/set-cap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mintAddress, capUsdc: Number.isNaN(n as number) ? undefined : n }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save daily cap");
      }
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally { setSaving(false); }
  };

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] text-zinc-500 w-4 text-center font-mono leading-none">⛔</span>
          <span className="text-[13px] text-zinc-800 font-medium">Daily spend cap</span>
        </div>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-zinc-400">$</span>
            <input
              type="number"
              min={0}
              step={1}
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
              placeholder={String(cap)}
              className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[12px] text-right text-zinc-900 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
            <button type="button" onClick={() => void save()} disabled={saving} className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900">
              {saving ? "…" : "Save"}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => { setVal(""); setEditing(true); }} className="text-[13px] font-mono font-bold tabular-nums text-zinc-900 hover:text-violet-700" title="Edit daily cap">
            {cap > 0 ? `$${cap.toFixed(2)}` : "No limit"} ✎
          </button>
        )}
      </div>
      <div className="mt-0.5 pl-[26px] text-[10.5px] text-zinc-500">
        ${spent.toFixed(2)} spent today{cap > 0 ? ` · $${Math.max(0, cap - spent).toFixed(2)} left` : ""}. Blank = default, 0 = off.
      </div>
      {err && <p className="mt-1 pl-[26px] text-[10.5px] text-rose-700">{err}</p>}
    </div>
  );
}

function buildTaskFeed(blueprint: AgentBlueprint): TaskItem[] {
  const p = blueprint.persona ?? {};
  const name = p.name ?? "this agent";
  const niche = p.niche ?? "lifestyle";
  const pillar = p.contentPillars?.[0] ?? `${niche} content`;
  const isMinted = Boolean(blueprint.mintCompleted);

  if (!isMinted) {
    return [
      {
        id: "t-build-1",
        title: `Lock ${name}'s identity`,
        description: "Name, niche, audience, voice archetype, and visual avatar. Already started, finish in chat to unlock the next phase.",
        category: "Identity",
        status: p.name && p.niche ? "Done" : "In Progress",
      },
      {
        id: "t-build-2",
        title: "Train on style references",
        description: `Upload 2-3 example videos or .md guides that capture the energy and format ${name} should mimic. The agent will study these.`,
        category: "Knowledge",
        status: "Required",
      },
      {
        id: "t-build-3",
        title: "Go live on Solana",
        description: "Once persona + avatars are ready, go live to lock the character on-chain. $10 platform fee after the first two free launches.",
        category: "Deploy",
      },
    ];
  }

  // Clipper agents get a CLIPPING task pack, not the influencer video-gen feed:
  // the actual clip-a-video action lives in the Clipping canvas (it needs a
  // source + graph), so the scheduled tasks here are the autonomous loop —
  // scout campaigns, reflect, research — plus a pointer to the canvas.
  if (blueprint.agentType === "clipping") {
    const clipFeed: TaskItem[] = [
      {
        id: "t-clip-1",
        title: "Clip a video",
        description: `Open the Clipping tab, drop a source (URL or upload) into ${name}'s pipeline, and hit Run. Clips render, then auto-post / submit to campaigns if wired.`,
        category: "Content",
        schedule: "In the Clipping tab",
        runOrder: 0,
      },
      {
        id: "t-clip-2",
        title: `Scout brand campaigns`,
        description: `Scan open Vello campaigns and surface the ones ${name} fits, the clips it makes can auto-submit to these.`,
        category: "Campaigns",
        schedule: "Runs daily",
        runOrder: 1,
        runnable: { taskType: "find_jobs", buildInput: () => ({}), estimatedCost: 0.01 },
      },
      {
        id: "t-clip-3",
        title: `Self-reflect: extract lessons`,
        description: `Pull recent clip + campaign outcomes and write 1-3 sharp lessons into memory. Future runs apply these.`,
        category: "Learning",
        schedule: "Runs weekly",
        runOrder: 2,
        runnable: { taskType: "self_reflect", buildInput: () => ({}), estimatedCost: 0.01 },
      },
      {
        id: "t-clip-4",
        title: `Research: what's clipping well`,
        description: `Custom research question. Defaults to "what short-form formats and hooks are over-performing in ${niche} right now?".`,
        category: "Research",
        schedule: "On demand",
        runOrder: 3,
        runnable: {
          taskType: "research",
          buildInput: (b) => ({ question: `What short-form formats and hooks are over-performing in ${b.persona?.niche ?? niche} right now?` }),
          estimatedCost: 0.02,
        },
      },
    ];
    return clipFeed.sort((a, b) => (a.runOrder ?? 99) - (b.runOrder ?? 99));
  }

  const feed: TaskItem[] = [
    {
      id: "t-run-1",
      title: `Generate content drop for ${name}`,
      description: `Produce a ${IDEAL_VIDEO_SECONDS}-second short on "${pillar}" with hook, b-roll prompts, caption, and hashtags. Uses your knowledge files and past lessons.`,
      category: "Content",
      schedule: "Runs daily",
      runOrder: 1,
      runnable: {
        taskType: "create_video",
        // No explicit duration — the create_video resolver derives the length from
        // the agent's Video Director config (length range), so this respects the
        // operator's setting instead of a fixed 24s.
        buildInput: (b) => ({
          topic: b.persona?.contentPillars?.[0] ?? `${b.persona?.niche ?? "lifestyle"} update`,
        }),
        // 24s typical (3 Veo Fast 8s clips) + $0.04 storyboard = $1.24
        // Quality tier (3 × $2.00 + $0.04 = $6.04) — user picks via VIDEO_ENGINES.
        estimatedCost: 1.24,
      },
    },
    {
      id: "t-run-2",
      title: `Trend audit: ${niche} this week`,
      description: `Scan trending angles. Surface 3 angles ${name} can ride before they peak, phrased in your voice.`,
      category: "Research",
      schedule: "Runs daily",
      runOrder: 2,
      runnable: {
        taskType: "analyze_trend",
        buildInput: () => ({ window: "this week" }),
        estimatedCost: 0.015,
      },
    },
    {
      id: "t-run-4",
      title: `Self-reflect: extract lessons`,
      description: `Pull recent task outcomes and write 1-3 sharp lessons into memory. Future tasks will apply these.`,
      category: "Learning",
      schedule: "Runs weekly",
      runOrder: 3,
      runnable: {
        taskType: "self_reflect",
        buildInput: () => ({}),
        estimatedCost: 0.01,
      },
    },
    {
      id: "t-run-5",
      title: `Research: niche deep-dive`,
      description: `Custom research question. Defaults to "what's emerging in ${niche} right now that my audience hasn't seen?".`,
      category: "Research",
      schedule: "On demand",
      runOrder: 5,
      runnable: {
        taskType: "research",
        buildInput: (b) => ({
          question: `What's emerging in ${b.persona?.niche ?? "lifestyle"} right now that my audience hasn't seen?`,
        }),
        estimatedCost: 0.02,
      },
    },
  ];

  // "Reply To Fans Daily" skill — only surface the fan-reply task when installed.
  // It drafts a reply AND renders a talking-head reply video (taskType reply_fan).
  if ((blueprint.installedSkills ?? []).includes("social.fanreply")) {
    feed.push({
      id: "t-run-3",
      title: `Draft a fan reply`,
      description: `Reply to the most recent fan comment in ${name}'s voice (warm, specific, under 200 chars) and render a talking-head reply video to drive engagement.`,
      category: "Engagement",
      schedule: "Runs daily",
      runOrder: 4,
      runnable: {
        // No comment → auto-derives a representative top comment from the latest
        // video. (Paste a real comment via chat to reply to that exact one.)
        taskType: "reply_fan",
        buildInput: () => ({}),
        estimatedCost: 0.05,
      },
    });
  }

  // Top of the list is the one that runs soonest (daily → weekly → on demand).
  return feed.sort((a, b) => (a.runOrder ?? 99) - (b.runOrder ?? 99));
}

// ─── Trader-specific section ──────────────────────────────────────────────────

interface BacktestSummary {
  windowDays: number;
  signalsGenerated: number;
  tradesTriggered: number;
  buys: number;
  sells: number;
  approxReturnPct: number;
  winRate: number;
  notes: string[];
}

function TraderStrategySection({ blueprint, sessionId }: { blueprint: AgentBlueprint; sessionId?: string }) {
  const t = blueprint.trader ?? {};
  const s = t.strategy;
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const runBacktest = async () => {
    if (!sessionId) return;
    setRunning(true); setErr(null); setResult(null);
    try {
      const res = await fetch("/api/trader/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, spec: s }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Backtest failed");
      setResult(data.summary as BacktestSummary);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      {/* Strategy Spec */}
      <div>
        <SectionHeading>Strategy Spec</SectionHeading>
        <PaperCard className="p-5">
          {s ? (
            <div className="space-y-3">
              <p className="font-serif text-[15px] font-bold text-zinc-900 leading-snug">
                {t.summary ?? "Solana spot trader."}
              </p>
              <div className="text-[11.5px] text-zinc-700 leading-[1.55] space-y-1.5">
                <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-mono uppercase tracking-[0.12em] text-[10px]">Universe</dt><dd className="font-mono">{s.assetUniverse?.join(", ") || "-"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-mono uppercase tracking-[0.12em] text-[10px]">Schedule</dt><dd className="font-mono">{s.schedule ?? "-"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-mono uppercase tracking-[0.12em] text-[10px]">Autonomy</dt><dd className="font-mono">{s.autonomy ?? "-"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-mono uppercase tracking-[0.12em] text-[10px]">Max pos</dt><dd className="font-mono">{s.riskCaps?.maxPositionPct ?? "-"}%</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-mono uppercase tracking-[0.12em] text-[10px]">Stop-loss</dt><dd className="font-mono">{s.riskCaps?.stopLossPct ?? "-"}%</dd></div>
              </div>
              {s.decisionRules?.length ? (
                <details className="pt-1">
                  <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.16em] text-zinc-600">{s.decisionRules.length} decision rule{s.decisionRules.length === 1 ? "" : "s"}</summary>
                  <ul className="mt-2 space-y-1.5">
                    {s.decisionRules.map((r, i) => (
                      <li key={i} className="text-[11.5px] text-zinc-700 leading-[1.5]">
                        <span className="font-mono text-[10px] uppercase text-zinc-500">{r.then}</span> if <code className="text-zinc-900">{r.if}</code>{r.size ? ` (${r.size})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : (
            <p className="text-[12.5px] text-zinc-500">
              Strategy spec will appear here as you describe it in chat, assets, signals, decision rules, risk caps.
            </p>
          )}
        </PaperCard>
      </div>

      {/* Paper-trade backtest */}
      <div>
        <SectionHeading>Paper-Trade Backtest</SectionHeading>
        <PaperCard className="p-5">
          <p className="text-[12.5px] text-zinc-600 mb-3">
            Run a 7-day deterministic simulation. Same spec → same result, always. Use it to sanity-check rules before minting.
          </p>
          <button
            onClick={runBacktest}
            disabled={running || !s || !sessionId}
            className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-800 hover:text-zinc-950 px-3 py-2 border border-zinc-300 rounded-md bg-white hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? "Running…" : "Run 7-day backtest"}
          </button>

          {result && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Stat label="Signals" value={result.signalsGenerated} />
              <Stat label="Trades" value={result.tradesTriggered} />
              <Stat label="Return %" value={result.approxReturnPct} suffix={result.approxReturnPct >= 0 ? "↑" : "↓"} />
              <Stat label="Win rate" value={result.winRate} suffix="%" />
              <Stat label="Buys" value={result.buys} />
              <Stat label="Sells" value={result.sells} />
              {result.notes.length > 0 && (
                <div className="col-span-3 text-[11px] text-zinc-600 leading-snug mt-1">
                  {result.notes.map((n) => <p key={n} className="mb-0.5">• {n}</p>)}
                </div>
              )}
            </div>
          )}
          {err && <p className="mt-3 text-[11.5px] text-rose-700">{err}</p>}
        </PaperCard>
      </div>
    </>
  );
}
