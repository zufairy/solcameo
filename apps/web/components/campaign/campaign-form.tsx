"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import velloLogo from "@/assets/solcameo-dark.png";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { buildEscrowProgram, createCampaignTx, checkVaultFunded, getCampaignPda } from "@/lib/escrow";
import { useWalletUsdc, useWalletSol, checkFunding } from "@/lib/client/usdcClient";
import { looksLikeDriveFolder, looksLikeYoutube, looksLikeYoutubeChannel, looksExpandableSource, mergeFolderVideos, hasClipSource } from "@/lib/client/driveFolder";
import { isBudgetSufficient, MIN_CAMPAIGN_BUDGET_USDC } from "@/lib/campaignBudget";
import { budgetFromSlider, sliderFromBudget } from "@/lib/campaignEstimate";
import { decideBeforeSign, decideAfterSignError, campaignDeadlineError, classifyLaunchError, describeSolShortfall, CAMPAIGN_MAX_DURATION_MS } from "@/lib/client/launchMachine";
import { useFundWallet } from "@privy-io/react-auth/solana";
import { getNetwork, isMainnet } from "@/lib/solana/network";
import { OptionCard, Chip, Stagger, itemVariants } from "@/components/builder/onboarding/setup-ui";
import { CampaignLive } from "./campaign-live";
import { PlatformBadge } from "@/components/social/platform-icons";
import { AnimatedNumber, RangeSlider, RewardEstimator } from "./reward-widgets";
import { AGE_GROUPS, COUNTRIES, GENDERS, audienceRequirement, requirementIdeas, type GenderId } from "./campaign-data";
import { CField, CoachTip, EASE, NavRow, Notice, PaperScreen, StepFrame, WizardShell, cInput, cLabel, cTextarea } from "./wizard-ui";
import { cn } from "@/lib/utils";
import {
  Loader2, Wallet, Shield, Megaphone, Trophy,
  Sparkles, Target, FlaskConical,
  TrendingUp, Code2, Globe2, MessageSquare, Wrench,
  Database, Link2, CheckSquare, Zap, Check, Rocket,
  ImagePlus, X, Plus, ExternalLink,
} from "lucide-react";

type CampaignType = "marketing" | "bounty" | "agent_task";

const CAMPAIGN_TYPES: {
  value: CampaignType;
  icon: React.ElementType;
  label: string;
  sublabel: string;
  description: string;
  ringColor: string;
  bgColor: string;
  iconColor: string;
  badgeClass: string;
  dotColor: string;
  gradient: string;
  glow: string;
}[] = [
  {
    value: "marketing",
    icon: Megaphone,
    label: "Marketing",
    sublabel: "Views & engagement",
    description: "AI Influencers create and distribute content. You pay per 1,000 views earned from your budget.",
    ringColor: "ring-sky-400/60",
    bgColor: "bg-sky-500/8 border-sky-500/30",
    iconColor: "text-sky-300",
    badgeClass: "bg-sky-500/15 text-sky-300 border-sky-500/25",
    dotColor: "bg-sky-400",
    gradient:
      "[background:radial-gradient(130%_130%_at_18%_-10%,rgba(56,189,248,0.40),transparent_55%),radial-gradient(120%_120%_at_110%_120%,rgba(20,184,166,0.32),transparent_55%),linear-gradient(135deg,#0a141f,#08080c)]",
    glow: "bg-sky-400/40",
  },
  {
    value: "bounty",
    icon: Trophy,
    label: "Bounty",
    sublabel: "Fixed reward per task",
    description: "Post a task with a fixed reward per accepted submission. Open to creators and AI agents, who submit proof of work.",
    ringColor: "ring-amber-400/60",
    bgColor: "bg-amber-500/8 border-amber-500/30",
    iconColor: "text-amber-300",
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    dotColor: "bg-amber-400",
    gradient:
      "[background:radial-gradient(130%_130%_at_18%_-10%,rgba(251,191,36,0.36),transparent_55%),radial-gradient(120%_120%_at_110%_120%,rgba(16,185,129,0.30),transparent_55%),linear-gradient(135deg,#17120a,#08080c)]",
    glow: "bg-amber-400/40",
  },
];

// Board tab the posted campaign is listed under on /stage. Display-only routing;
// normalized server-side to this same allow-list (fallback "clipping"). The Web3
// board has been removed, so it is no longer an option here.
type BoardCategory = "ugc" | "clipping";
const BOARD_CATEGORIES: { value: BoardCategory; label: string; hint: string }[] = [
  { value: "clipping", label: "Clipping", hint: "Clip & repurpose viral content" },
  { value: "ugc", label: "UGC", hint: "User-generated content" },
];

const AGENT_TASK_CATEGORIES = [
  { value: "content_creation", label: "Content Creation", icon: MessageSquare, desc: "Write posts, articles, scripts, or copy" },
  { value: "data_research", label: "Data Research & Analysis", icon: Database, desc: "Gather, analyze, and summarize information" },
  { value: "code_generation", label: "Code & Development", icon: Code2, desc: "Write, review, debug, or test code" },
  { value: "trading_defi", label: "Trading & DeFi Strategy", icon: TrendingUp, desc: "Execute strategies, LP management, yield ops" },
  { value: "web_scraping", label: "Web Scraping & Collection", icon: Link2, desc: "Collect structured data from websites" },
  { value: "social_media", label: "Social Media Management", icon: Globe2, desc: "Post, engage, and manage social accounts" },
  { value: "testing_qa", label: "Testing & QA", icon: FlaskConical, desc: "Test apps, report bugs, verify user flows" },
  { value: "onchain_actions", label: "On-chain Actions", icon: Zap, desc: "Mint, trade, or interact with protocols" },
  { value: "workflow_automation", label: "Workflow Automation", icon: Wrench, desc: "Automate multi-step processes or pipelines" },
  { value: "verification", label: "Verification & Auditing", icon: CheckSquare, desc: "Check, verify, or audit content or data" },
  { value: "custom", label: "Custom / Other", icon: Target, desc: "Define your own AI-executable task type" },
];

const NICHES = [
  "lifestyle", "tech", "fashion", "fitness",
  "food", "travel", "finance", "gaming",
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ms", label: "Malay" },
  { value: "id", label: "Indonesian" },
  { value: "ar", label: "Arabic" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
];

const BRIEF_HINTS: Record<CampaignType, { label: string; placeholder: string }> = {
  marketing: {
    label: "Content brief",
    placeholder: "Describe what the content should cover, tone of voice, key messages, platforms, and any restrictions.\n\nBe specific. AI Influencers follow this brief exactly when generating content.",
  },
  bounty: {
    label: "Task description & acceptance criteria",
    placeholder: "Describe exactly what must be delivered and how to verify it is complete.\n\nInclude: format, length, required elements, and how to submit. Clear criteria = faster payout.",
  },
  agent_task: {
    label: "Agent instructions",
    placeholder: "Write step-by-step instructions an AI agent can execute autonomously.\n\nBe precise: include inputs, expected outputs, verification steps, and edge cases. Agents follow this literally.",
  },
};

const campaignSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  brandName: z.string().min(2, "Brand name required"),
  brief: z.string().min(50, "Brief must be at least 50 characters"),
  budget: z.coerce.number().min(MIN_CAMPAIGN_BUDGET_USDC, `Minimum campaign budget is $${MIN_CAMPAIGN_BUDGET_USDC.toLocaleString()}`),
  ratePerThousandViews: z.coerce.number().min(0.5, "Minimum $0.50 per 1K views").optional(),
  // Optional MARKETING per-submission payout cap. Empty → no cap (undefined).
  maxPayoutUsdc: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().min(1, "Minimum $1").optional(),
  ),
  rewardPerCompletion: z.coerce.number().min(1, "Minimum $1 per completion").optional(),
  deliverables: z.string().optional(),
  agentTaskCategory: z.string().optional(),
  targetNiche: z.string().default("lifestyle"),
  targetLanguage: z.string().default("en"),
  deadline: z
    .string()
    .min(1, "Deadline required")
    // The on-chain program bounds the deadline to [now+6h, now+365d] and reverts
    // InvalidDeadline outside it. Enforce BOTH ends here (via the shared helper) so
    // the user gets a clear message instead of a wallet prompt that reverts on
    // simulation and shows a misleading "not enough SOL". superRefine reports the
    // exact reason (too soon vs too far).
    .superRefine((d, ctx) => {
      const err = campaignDeadlineError(new Date(d).getTime(), Date.now());
      if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
    }),
});

type CampaignFormInput = z.input<typeof campaignSchema>;
type CampaignFormValues = z.output<typeof campaignSchema>;

type Step =
  | "idle" | "resuming" | "creating-convex" | "preflight"
  | "funding-wallet" | "signing-escrow" | "verifying" | "finalizing" | "done";

function stepLabel(step: Step): string {
  switch (step) {
    case "resuming": return "Resuming draft...";
    case "creating-convex": return "Creating campaign...";
    case "preflight": return "Checking your balance...";
    case "funding-wallet": return "Funding wallet...";
    case "signing-escrow": return "Approve deposit in wallet...";
    case "verifying": return "Confirming deposit on-chain...";
    case "finalizing": return "Locking treasury...";
    default: return "Launch campaign";
  }
}

// ── Wizard scaffolding ──────────────────────────────────────────────────────



/** Platforms a campaign can accept submissions on. Matches the full set of
 *  networks Connect Socials (SocialConnectionsPanel) supports and that
 *  upload-post can post to + verify views on (UPLOAD_POST_PLATFORMS in
 *  lib/server/uploadPost.ts). The ids MUST match those consumers so the
 *  submission-acceptance + view-verification gate (convex/submissions.ts)
 *  keys off the same strings — X is stored as "x" (the gate normalizes
 *  "twitter" → "x"). Icons are the shared inline brand glyphs. */
const CAMPAIGN_PLATFORMS = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X / Twitter" },
  { id: "threads", label: "Threads" },
] as const;
const DEFAULT_PLATFORMS = CAMPAIGN_PLATFORMS.map((p) => p.id);

// ── Deadline presets ─────────────────────────────────────────────────────────
// On-chain campaigns must expire (escrow bounds it to [now+6h, now+365d]). A small
// preset dropdown is friendlier than a raw date picker. "Max (1 year)" is the
// program ceiling (365d) — there is no truly-forever on-chain, so it's labelled
// honestly. Each preset resolves to a YYYY-MM-DD date, clamped inside the bounds.
const DAY_MS = 86_400_000;
const DEADLINE_PRESETS = [
  { key: "2w", label: "2 weeks", days: 14 },
  { key: "1m", label: "1 month", days: 30 },
  { key: "3m", label: "3 months", days: 90 },
  { key: "max", label: "Max (1 year)", days: 365 },
] as const;
type DeadlinePresetKey = (typeof DEADLINE_PRESETS)[number]["key"];

/** Resolve a preset to a YYYY-MM-DD deadline, clamped inside the escrow bounds. */
function presetToDeadline(days: number): string {
  const target = Math.min(Date.now() + days * DAY_MS, Date.now() + CAMPAIGN_MAX_DURATION_MS);
  return new Date(target).toISOString().split("T")[0];
}

/** Wizard screens, in order. One question per screen. */
const SCREEN_LABELS = ["TYPE", "BASICS", "BRIEF", "SOURCE", "AUDIENCE", "REWARD", "LAUNCH"] as const;
const S = { type: 0, basics: 1, brief: 2, source: 3, audience: 4, reward: 5, review: 6 } as const;

/** Fields validated before advancing past each screen. */
const STEP_FIELDS: (keyof CampaignFormInput)[][] = [
  [],
  ["brandName", "title"],
  ["brief"],
  [],
  [],
  ["budget", "deadline"],
  [],
];

const MAX_CONTENT_IMAGES = 3;

const fmtViews = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);

/** One-row platform toggle: the real brand logo, dimmed until selected. */
function PlatformToggle({ id, label, on, onToggle }: { id: string; label: string; on: boolean; onToggle: () => void }) {
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      aria-label={label}
      variants={itemVariants}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 420, damping: 22 }}
      onClick={onToggle}
      className="group flex min-w-0 flex-1 flex-col items-center gap-2 rounded-2xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/50"
    >
      <span className="relative">
        <motion.span
          animate={on ? { scale: 1, opacity: 1, filter: "grayscale(0)" } : { scale: 0.92, opacity: 0.45, filter: "grayscale(1)" }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          className={cn("block rounded-full ring-offset-2 ring-offset-[#F6F4F0] transition-shadow", on ? "ring-2 ring-[#141413]" : "ring-0")}
        >
          <PlatformBadge id={id} label={label} className="size-12 sm:size-14 text-[14px]" />
        </motion.span>
        <AnimatePresence>
          {on && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 520, damping: 18 }} className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full border-2 border-[#F6F4F0] bg-[#A3E635] text-[#141413]">
              <Check className="size-3" strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className={cn("truncate text-[11.5px] font-medium transition-colors", on ? "text-[#141413]" : "text-[#141413]/45")}>{label.replace(" / Twitter", "")}</span>
    </motion.button>
  );
}

function SummaryEdit({ to, onEdit }: { to: number; onEdit: (screen: number) => void }) {
  return (
    <button type="button" onClick={() => onEdit(to)} className="text-[12px] font-semibold text-[#141413]/50 underline-offset-4 hover:text-[#141413] hover:underline">Edit</button>
  );
}

function SummaryStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-[#F6F4F0] px-4 py-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#141413]/45">{label}</p>
      <p className="mt-1 font-mono text-[20px] font-bold leading-none tabular-nums text-[#141413]">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-[#141413]/50">{sub}</p>}
    </div>
  );
}

/** Light review card shown on the last screen: what agents will see + what it costs. */
function CampaignSummary({
  campaignType, boardCategory, values, imageUrl, platforms, requirements, audience, onEdit,
}: {
  campaignType: CampaignType;
  boardCategory: BoardCategory;
  values: Partial<CampaignFormInput>;
  imageUrl: string | null;
  platforms: string[];
  requirements: string[];
  audience: string | null;
  onEdit: (screen: number) => void;
}) {
  const typeMeta = CAMPAIGN_TYPES.find((t) => t.value === campaignType) ?? CAMPAIGN_TYPES[0];
  const [now] = useState(() => Date.now());
  const days = values.deadline ? Math.ceil((new Date(values.deadline).getTime() - now) / 86400000) : null;
  const budget = Number(values.budget) || 0;
  const rateK = Number(values.ratePerThousandViews) || 0;
  const rewardPerCompletion = Number(values.rewardPerCompletion) || 0;
  const slots = rewardPerCompletion > 0 ? Math.floor(budget / rewardPerCompletion) : 0;
  const estViews = rateK > 0 ? Math.floor((budget / rateK) * 1000) : 0;
  const language = LANGUAGES.find((l) => l.value === values.targetLanguage)?.label;
  const niche = values.targetNiche ? values.targetNiche.charAt(0).toUpperCase() + values.targetNiche.slice(1) : "";
  const reqs = requirements.map((r) => r.trim()).filter(Boolean);
  return (
    <div className="overflow-hidden rounded-[28px] border border-black/8 bg-white/90 shadow-[0_24px_60px_-34px_rgba(20,20,19,0.4)]">
      <div className="relative aspect-[16/7] w-full bg-[#141413]">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center bg-gradient-to-br from-[#1c2410] to-[#0b0d0a]">
            <Image src={velloLogo} alt="" className="w-24 opacity-30" />
          </div>
        )}
        <span className="absolute left-3.5 top-3.5 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[#141413]">{typeMeta.label}</span>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[24px] font-semibold tracking-[-0.03em] text-[#141413]">{values.title || "Untitled campaign"}</p>
            <p className="truncate text-[14px] text-[#141413]/55">{values.brandName || "Your brand"} · {boardCategory === "clipping" ? "Clipping" : "UGC"}</p>
          </div>
          <SummaryEdit to={S.basics} onEdit={onEdit} />
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <SummaryStat label="Treasury" value={`$${budget.toLocaleString()}`} sub="USDC" />
          {campaignType === "marketing"
            ? <SummaryStat label="Pays" value={rateK > 0 ? `$${rateK.toFixed(2)}` : "-"} sub={estViews > 0 ? `per 1K · ~${fmtViews(estViews)} views` : "per 1K views"} />
            : <SummaryStat label="Pays" value={rewardPerCompletion > 0 ? `$${rewardPerCompletion}` : "-"} sub={slots > 0 ? `${slots} slots` : "per accepted"} />}
          <SummaryStat label="Runs" value={days !== null ? (days > 0 ? `${days}d` : "Ended") : "-"} sub="then you can reclaim the rest" />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between"><p className={cLabel}>Brief</p><SummaryEdit to={S.brief} onEdit={onEdit} /></div>
          <p className="line-clamp-3 whitespace-pre-line text-[14px] leading-relaxed text-[#141413]/70">{values.brief}</p>
          {reqs.length > 0 && <p className="mt-2 text-[13px] text-[#141413]/50">{reqs.length} requirement{reqs.length === 1 ? "" : "s"} agents must follow</p>}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between"><p className={cLabel}>Posts on</p><SummaryEdit to={S.audience} onEdit={onEdit} /></div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[#141413]">
            {platforms.map((p) => <PlatformBadge key={p} id={p} label={p} className="size-7 text-[11px]" />)}
            {niche && <span className="rounded-full bg-black/6 px-3 py-1 text-[12px] font-medium text-[#141413]/70">{niche}</span>}
            {language && <span className="rounded-full bg-black/6 px-3 py-1 text-[12px] font-medium text-[#141413]/70">{language}</span>}
          </div>
          {audience && <p className="mt-2.5 text-[13px] leading-relaxed text-[#141413]/55">{audience.replace(/ Create and post content for this audience\.$/, "")}</p>}
        </div>
      </div>
    </div>
  );
}

/** Stage rail shown under the Launch button while the on-chain create runs, so
 *  the operator sees WHERE they are (wallet prompt, confirmation, treasury lock)
 *  instead of one spinner label that keeps changing. */
const LAUNCH_STAGES: { ids: Step[]; label: string }[] = [
  { ids: ["resuming", "creating-convex"], label: "Create" },
  { ids: ["preflight", "funding-wallet"], label: "Check funds" },
  { ids: ["signing-escrow"], label: "Approve in wallet" },
  { ids: ["verifying"], label: "Confirm on-chain" },
  { ids: ["finalizing"], label: "Lock treasury" },
];
function LaunchProgress({ step }: { step: Step }) {
  const idx = LAUNCH_STAGES.findIndex((st) => st.ids.includes(step));
  return (
    <ol className="mt-6 grid grid-cols-5 gap-1.5" aria-label="Launch progress" aria-live="polite">
      {LAUNCH_STAGES.map((st, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "todo";
        return (
          <li key={st.label} className="flex flex-col gap-1.5">
            <span className={cn("h-1.5 rounded-full transition-colors duration-500", state === "done" ? "bg-[#141413]" : state === "active" ? "bg-[#84CC16] motion-safe:animate-pulse" : "bg-black/10")} />
            <span className={cn("text-[11.5px] leading-tight", state === "todo" ? "text-[#141413]/35" : state === "active" ? "font-semibold text-[#141413]" : "text-[#141413]/60")}>{st.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Main Form ─────────────────────────────────────────────────────────────────

export function CampaignForm() {
  const router = useRouter();
  // Privy-aware wallet: resolves the embedded wallet a Google login creates (which
  // never appears in wallet-adapter) and signs through the login wallet. Using the
  // raw wallet-adapter here showed "Connect Wallet" even when the header had the
  // user connected via Privy, and could fund from the wrong wallet.
  const { publicKey, signTransaction, connected, connecting } = useUnifiedSolanaWallet();
  // Binds the SIWS session to the ACTIVE wallet before the ownership-gated finalize
  // POST. With a multi-wallet Privy account the process-global SIWS token can be
  // bound to a DIFFERENT wallet than `publicKey` (the creator/funder), which made
  // /api/campaigns/set-pda 403 ("you do not own this resource") AFTER the deposit
  // landed. ensureSiwsSession() re-mints/binds to publicKey and short-circuits when
  // a valid session for it already exists (no extra signature).
  const { ensureSiwsSession } = useSiwsSession();
  const { promptLogin, accessToken } = useSupabaseAuth();
  const createCampaign = useMutation(api.campaigns.create);
  const generateUploadUrl = useMutation(api.campaigns.generateUploadUrl);

  // Live wallet balances (Task 6) drive the pre-flight gate + the balance line.
  const { usdc, refresh: refreshUsdc } = useWalletUsdc();
  const { sol, refresh: refreshSol } = useWalletSol();

  // Unfunded drafts (no PDA, v1, open) — powers the resume-on-reload banner.
  const drafts = useQuery(
    api.campaigns.listDraftsByCreator,
    publicKey ? { creatorWallet: publicKey.toBase58() } : "skip",
  );

  const [campaignType, setCampaignType] = useState<CampaignType>("marketing");
  // Which /stage board tab the posted campaign appears under (display-only).
  // Defaults to Clipping — the board's default tab now that Web3 has been removed.
  const [boardCategory, setBoardCategory] = useState<BoardCategory>("clipping");
  const [sourceRightsConfirmed, setSourceRightsConfirmed] = useState(false);
  const [requiresProfileCta, setRequiresProfileCta] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [escrowWarning, setEscrowWarning] = useState<string | null>(null);
  const [depositReview, setDepositReview] = useState<CampaignFormValues | null>(null);

  // Native Privy fiat/card on-ramp (Coinbase/MoonPay). fundWallet resolves on
  // modal EXIT (not on funds landing); onUserExited fires whenever the flow
  // closes — reset the launch step + refresh balances so the user can re-check
  // and click Launch again once USDC arrives. Requires <SolanaFundingPluginMount/>
  // mounted in the wallet provider.
  const { fundWallet } = useFundWallet({
    onUserExited: () => { setStep("idle"); void refreshUsdc(); void refreshSol(); },
  });

  // SINGLE source of truth for "which campaign row are we funding". Set when we
  // create a row (so a retry reuses it, never double-inserts) OR when the user
  // adopts an existing draft via Resume (which also hides the banner). Cleared
  // only on a fully successful launch.
  const [adoptedDraftId, setAdoptedDraftId] = useState<Id<"campaigns"> | null>(null);

  // Synchronous re-entrancy latch. React state (`adoptedDraftId`) and the derived
  // `submitting` flag update asynchronously, so two onSubmit calls fired within the
  // same render window would both see `adoptedDraftId === null` and both call
  // createCampaign → two rows → two PDAs → a double deposit (the on-chain init guard
  // can't help — different PDAs). This ref is checked-and-set before any await, so
  // overlapping invocations are rejected while sequential retries still work.
  const inFlightRef = useRef(false);

  // Wizard navigation: [active step index, direction of last move]
  const [[wizardStep, dir], setWizard] = useState<[number, number]>([0, 0]);
  const [maxReached, setMaxReached] = useState(0);

  // Cover picker the preview card opens (the card IS the upload affordance).
  const coverInputRef = useRef<HTMLInputElement>(null);
  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [, setImageStorageId] = useState<string | null>(null);

  // Content files state — image uploads (mockups / product shots), max 3.
  const [contentFiles, setContentFiles] = useState<{ file: File; storageId?: string; preview: string }[]>([]);

  // Content links state
  const [contentLinks, setContentLinks] = useState<string[]>([""]);
  // A clipping campaign (marketing type + Clipping board) MUST ship at least one
  // clippable video source, else it's hidden from the clip-canvas Source picker
  // and can never be clipped. Set by the launch/step gate, cleared on edit.
  const [sourceError, setSourceError] = useState<string | null>(null);

  // Google-Drive-FOLDER Reference links → their member videos, keyed by the exact
  // (trimmed) link so a link's preview follows its value (not its shifting index).
  // Resolved on blur/paste via /api/clip/resolve-source-url (the SAME route the
  // clipper Paste-URL pill uses). Non-folder links never round-trip. The `ready`
  // videos also seed contentFileUrls at launch so downstream clipping gets the
  // individual files. `folderInFlight` de-dupes overlapping resolves per URL.
  type FolderPreview = { status: "loading" | "ready" | "empty" | "error"; videos: { url: string; name: string }[] };
  const [folderPreviews, setFolderPreviews] = useState<Record<string, FolderPreview>>({});
  const folderInFlight = useRef<Set<string>>(new Set());

  const resolveFolderLink = async (raw: string) => {
    const trimmed = raw.trim();
    // Drive FOLDER or YouTube CHANNEL/PLAYLIST → expand server-side into member
    // videos. A single video / Drive file / .mp4 needs no round-trip.
    if (!looksExpandableSource(trimmed)) return;
    if (folderInFlight.current.has(trimmed)) return; // already resolving this exact URL
    const existing = folderPreviews[trimmed];
    if (existing && (existing.status === "ready" || existing.status === "empty")) return; // already resolved
    folderInFlight.current.add(trimmed);
    setFolderPreviews((prev) => ({ ...prev, [trimmed]: { status: "loading", videos: [] } }));
    try {
      const res = await fetch(`/api/clip/resolve-source-url?url=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        setFolderPreviews((prev) => ({ ...prev, [trimmed]: { status: "error", videos: [] } }));
        return;
      }
      const j = (await res.json().catch(() => ({}))) as {
        videos?: { url: string; name: string }[];
        isFolder?: boolean;
      };
      const videos = Array.isArray(j.videos)
        ? j.videos.filter((x): x is { url: string; name: string } => !!x && typeof x.url === "string")
        : [];
      if (j.isFolder && videos.length > 0) {
        setFolderPreviews((prev) => ({ ...prev, [trimmed]: { status: "ready", videos } }));
      } else {
        // Folder we reached but couldn't list (private / not shared / empty).
        setFolderPreviews((prev) => ({ ...prev, [trimmed]: { status: "empty", videos: [] } }));
      }
    } catch {
      setFolderPreviews((prev) => ({ ...prev, [trimmed]: { status: "error", videos: [] } }));
    } finally {
      folderInFlight.current.delete(trimmed);
    }
  };

  // Campaign requirements state (MANDATORY — agents obey every one on each post).
  const [requirements, setRequirements] = useState<string[]>([""]);
  const [requirementsError, setRequirementsError] = useState<string | null>(null);

  // AI writer + coaching state. The website is only used to draft copy; it is not
  // stored on the campaign unless the user adds it as a source link.
  const [siteUrl, setSiteUrl] = useState("");
  const [aiState, setAiState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [aiStatusIdx, setAiStatusIdx] = useState(0);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [tipsOff, setTipsOff] = useState<Record<string, boolean>>({});
  const aiTimers = useRef<number[]>([]);
  useEffect(() => () => { aiTimers.current.forEach((t) => window.clearTimeout(t)); aiTimers.current = []; }, []);

  // Audience demographics. Folded into one requirement line at launch (agents obey it).
  const [countries, setCountries] = useState<string[]>([]);
  const [ages, setAges] = useState<string[]>([]);
  const [gender, setGender] = useState<GenderId>("all");
  const [showAllCountries, setShowAllCountries] = useState(false);
  const audienceLine = audienceRequirement({ countries, ages, gender });

  // Platforms this campaign accepts submissions on (MANDATORY — at least one).
  const [platforms, setPlatforms] = useState<string[]>([...DEFAULT_PLATFORMS]);
  const [platformsError, setPlatformsError] = useState<string | null>(null);
  const togglePlatform = (id: string) => {
    setPlatformsError(null);
    setPlatforms((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Deadline preset (dropdown) — defaults to 1 month; resolves to a concrete date.
  const [deadlinePreset, setDeadlinePreset] = useState<DeadlinePresetKey>("1m");
  // Async crawl-validation of the reference link (marketing/ugc/clipping): we hit
  // /api/clip/resolve-source-url and only let the user continue once it returns a
  // clippable video. `null` = not checked, string = the last error.
  const [sourceValidating, setSourceValidating] = useState(false);

  async function uploadFile(file: File): Promise<string> {
    const uploadUrl = await generateUploadUrl();
    const result = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const { storageId } = await result.json();
    return storageId as string;
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const [file, ...extras] = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!file) return;
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImageStorageId(null); // reset — will upload on submit
    if (extras.length) {
      setContentFiles((prev) => [...prev, ...extras.slice(0, MAX_CONTENT_IMAGES - prev.length)
        .map((extra) => ({ file: extra, preview: URL.createObjectURL(extra) }))]);
    }
    e.target.value = "";
  }

  function handleContentFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    setContentFiles((prev) => {
      const room = MAX_CONTENT_IMAGES - prev.length;
      const next = picked.slice(0, Math.max(0, room)).map((f) => ({ file: f, preview: URL.createObjectURL(f) }));
      return [...prev, ...next];
    });
    e.target.value = ""; // allow re-selecting the same file after a remove
  }

  function removeContentFile(index: number) {
    setContentFiles((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.preview); // free the blob URL
      return prev.filter((_, i) => i !== index);
    });
  }

  function addLink() {
    setContentLinks((prev) => [...prev, ""]);
  }

  function updateLink(index: number, value: string) {
    setContentLinks((prev) => prev.map((l, i) => (i === index ? value : l)));
    if (sourceError) setSourceError(null);
  }

  function removeLink(index: number) {
    setContentLinks((prev) => prev.filter((_, i) => i !== index));
  }

  function addRequirement() {
    setRequirements((prev) => [...prev, ""]);
  }

  function updateRequirement(index: number, value: string) {
    setRequirements((prev) => prev.map((r, i) => (i === index ? value : r)));
    if (requirementsError) setRequirementsError(null);
  }

  function removeRequirement(index: number) {
    setRequirements((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [""];
    });
  }

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    trigger,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CampaignFormInput, unknown, CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    mode: "onTouched",
    defaultValues: {
      title: "",
      brandName: "",
      brief: "",
      budget: 2500,
      ratePerThousandViews: 3,
      rewardPerCompletion: 25,
      deadline: "",
      targetNiche: "lifestyle",
      targetLanguage: "en",
    },
  });

  // Seed the deadline from the default preset (1 month) on mount — the raw field
  // starts empty and the dropdown drives it thereafter.
  useEffect(() => {
    setValue("deadline", presetToDeadline(30), { shouldValidate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickDeadlinePreset = (key: DeadlinePresetKey) => {
    setDeadlinePreset(key);
    const preset = DEADLINE_PRESETS.find((p) => p.key === key) ?? DEADLINE_PRESETS[1];
    setValue("deadline", presetToDeadline(preset.days), { shouldValidate: true });
  };

  const formValues = watch();

  // ── AI writer ──
  function addRequirementText(text: string) {
    const t = text.trim();
    if (!t) return;
    setRequirements((prev) => {
      if (prev.some((r) => r.trim().toLowerCase() === t.toLowerCase())) return prev;
      const base = prev.length === 1 && !prev[0].trim() ? [] : prev;
      return [...base, t];
    });
    setRequirementsError(null);
  }

  /** Reveal the brief as if it is being typed, so the draft feels alive. */
  function typeBrief(text: string) {
    let i = 0;
    const tick = () => {
      i = Math.min(text.length, i + 8);
      setValue("brief", text.slice(0, i), { shouldValidate: true, shouldDirty: true });
      if (i < text.length) aiTimers.current.push(window.setTimeout(tick, 18));
    };
    tick();
  }

  async function runAiAssist(want: "all" | "requirements") {
    if (aiState === "working") return;
    setAiState("working");
    setAiNote(null);
    setAiStatusIdx(0);
    const statusTimer = window.setInterval(() => setAiStatusIdx((i) => i + 1), 1500);
    try {
      const v = getValues();
      const res = await fetch("/api/campaigns/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ url: siteUrl.trim() || undefined, brandName: v.brandName, title: v.title, brief: v.brief, campaignType, boardCategory, want }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; brandName?: string; title?: string; brief?: string; requirements?: string[]; niche?: string; language?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setAiState("error");
        setAiNote(data?.error ?? "The writer is busy. Try again, or use the quick suggestions below.");
        return;
      }
      if (!(v.brandName ?? "").trim() && data.brandName) setValue("brandName", data.brandName, { shouldDirty: true });
      if (!(v.title ?? "").trim() && data.title) setValue("title", data.title, { shouldDirty: true });
      if (data.niche) setValue("targetNiche", data.niche, { shouldDirty: true });
      if (data.language) setValue("targetLanguage", data.language, { shouldDirty: true });
      if (want === "all" && data.brief) typeBrief(data.brief);
      (data.requirements ?? []).forEach((r, i) => {
        aiTimers.current.push(window.setTimeout(() => addRequirementText(r), 350 + i * 260));
      });
      setAiState("done");
      setAiNote(want === "all" ? "Draft ready. Edit anything you like." : "Added. Remove or edit any of them.");
    } catch {
      setAiState("error");
      setAiNote("Couldn't reach the writer. Check your connection and try again.");
    } finally {
      window.clearInterval(statusTimer);
    }
  }

  // ── Wizard controls ──
  function goTo(next: number) {
    setWizard(([cur]) => [next, next >= cur ? 1 : -1]);
    setMaxReached((m) => Math.max(m, next));
  }

  // Crawl-check a reference link: hit the SAME resolver the clipper uses and
  // confirm it yields at least one downloadable video. Covers a single YouTube
  // video, a YouTube channel/playlist (top-N), a Drive video/folder (member files),
  // and direct .mp4s; a bare site / private folder / dead channel resolves to [].
  async function validateSourceLink(url: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/clip/resolve-source-url?url=${encodeURIComponent(url)}`);
      if (!res.ok) return false;
      const j = (await res.json().catch(() => ({}))) as { videos?: { url: string }[] };
      return Array.isArray(j.videos) && j.videos.length > 0;
    } catch {
      return false;
    }
  }

  async function goNext() {
    const fields = STEP_FIELDS[wizardStep];
    const valid = fields.length ? await trigger(fields) : true;
    if (!valid) return;
    // Requirements are MANDATORY: block leaving the brief step until ≥1 non-empty.
    if (wizardStep === S.brief) {
      const cleaned = requirements.map((r) => r.trim()).filter(Boolean);
      if (cleaned.length === 0) {
        setRequirementsError("Add at least one requirement agents must follow.");
        return;
      }
      setRequirementsError(null);
    }
    // Platforms are MANDATORY — at least one network.
    if (wizardStep === S.audience && platforms.length === 0) {
      setPlatformsError("Select at least one platform.");
      return;
    }
    if (wizardStep === S.source) {
      if (campaignType === "marketing" && boardCategory === "clipping" && !sourceRightsConfirmed) {
        setSourceError("Confirm you have permission for agents to clip and republish these videos.");
        return;
      }
      // A clippable VIDEO source is REQUIRED only for the CLIPPING board — agents
      // clip from it, so without a reachable video the campaign launches unusable.
      // Beyond "looks like a link", we CRAWL-VALIDATE it via the same resolver the
      // clipper uses, so a private Drive folder / dead channel / non-video URL is
      // caught HERE (before launch), not silently at clip time. UGC campaigns take
      // ANY website link (the agent crawls it for context), so they skip this gate
      // entirely — a bare brand URL must not be rejected as "not a video".
      if (campaignType === "marketing" && boardCategory === "clipping") {
        const firstLink = contentLinks.map((l) => l.trim()).find(Boolean);
        if (!firstLink) {
          setSourceError("Add a reference link — a YouTube video/channel, a Google Drive video/folder, or a direct video URL.");
          return;
        }
        setSourceValidating(true);
        setSourceError(null);
        try {
          const ok = await validateSourceLink(firstLink);
          if (!ok) {
            setSourceError("Couldn't fetch a video from this link. Use a PUBLIC YouTube link, a SHARED Google Drive video/folder, or a direct video URL — then try again.");
            return;
          }
        } finally {
          setSourceValidating(false);
        }
      }
      setSourceError(null);
    }
    // Money-safety mirror: never advance PAST the reward/budget step with an
    // unpayable budget (marketing budget < per-1K rate). The budget field lives on
    // the last step today (so this guards a Continue only if the wizard is ever
    // reordered), but keeping it keyed on STEP_FIELDS makes the invariant explicit.
    if (STEP_FIELDS[wizardStep].includes("budget")) {
      const rate = campaignType === "marketing" ? (Number(formValues.ratePerThousandViews) || 3) : 0;
      if (!isBudgetSufficient(Number(formValues.budget) || 0, rate, campaignType)) {
        setError(
          `Budget must be at least the rate ($${rate.toFixed(2)}/1K) — otherwise the campaign can't pay out.`,
        );
        return;
      }
    }
    if (wizardStep < SCREEN_LABELS.length - 1) goTo(wizardStep + 1);
  }

  function goBack() {
    if (wizardStep > 0) goTo(wizardStep - 1);
  }

  function onSubmit(values: CampaignFormValues) {
    if (campaignType !== "marketing") {
      setError("On-chain escrow and automatic payouts are available for Marketing campaigns only. Choose Marketing to launch on devnet.");
      return;
    }
    setError(null);
    setDepositReview(values);
  }

  async function launchCampaign(values: CampaignFormValues) {
    if (inFlightRef.current) return; // a launch is already in flight this render
    inFlightRef.current = true;
    try {
      if (!publicKey) return;
      setError(null);
      setEscrowWarning(null);

      // Platforms are MANDATORY — a campaign must accept at least one network.
      if (platforms.length === 0) {
        setPlatformsError("Select at least one platform.");
        setStep("idle");
        goTo(S.audience);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // A CLIPPING campaign MUST ship a clippable source, else it launches invisible
      // to the clip-canvas Source picker and can never be clipped. goNext already
      // gates + crawl-validates leaving the brief step, but the stepper lets a user
      // jump back past that check — re-assert here and bounce them to the source
      // input. UGC campaigns have no such requirement (any/no website link is fine).
      if (
        campaignType === "marketing" &&
        boardCategory === "clipping" &&
        !hasClipSource({ contentLinks })
      ) {
        setSourceError("Add a reference link — a YouTube video/channel, a Google Drive video/folder, or a direct video URL.");
        setError("Add a source before launching — open the Source step and paste a Google Drive folder or video link.");
        setStep("idle");
        goTo(S.source);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (campaignType === "marketing" && boardCategory === "clipping" && !sourceRightsConfirmed) {
        setError("Confirm that you have permission for agents to clip and republish the supplied video sources.");
        setStep("idle");
        goTo(S.source);
        return;
      }

      // MONEY-SAFETY: a marketing campaign whose budget can't cover even ONE
      // 1,000-view payout (budget < rate) would still take the user's USDC into a
      // treasury that can never pay out. Block HERE — upstream of the SIWS
      // signature, createCampaign row insert, AND the on-chain deposit tx — so no
      // funds move and no orphan row is created when the budget is unpayable.
      const guardRate = campaignType === "marketing" ? (values.ratePerThousandViews ?? 3) : 0;
      if (!isBudgetSufficient(values.budget, guardRate, campaignType)) {
        setError(
          `Budget must be at least the rate ($${guardRate.toFixed(2)}/1K) — otherwise the campaign can't pay out even one 1,000-view reward.`,
        );
        setStep("idle");
        goTo(S.reward);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // 0. Bind the SIWS session to the ACTIVE wallet up front, so the whole flow
      //    (create + the ownership-gated finalize below) is proven against the SAME
      //    wallet that funds the vault. Without this, a multi-wallet Privy account
      //    could finalize with a token bound to a DIFFERENT wallet and 403 AFTER the
      //    deposit landed, stranding the campaign. No-op when already signed in with
      //    this wallet; returns null if the user rejects/declines the signature.
      let siwsBound = false;
      // Capture the minted SIWS token so we can thread it into createCampaign below:
      // create's PAID pre-transcribe side-effect is gated on a live session (H09/
      // BUG-032). We already sign in here (before create), so the legit flow always
      // has a token to pass — a raw Convex client bypassing this form does not.
      let siwsToken: string | null = null;
      try {
        siwsToken = await ensureSiwsSession();
        siwsBound = siwsToken !== null;
      } catch {
        siwsBound = false;
      }
      if (!siwsBound) {
        setError("Please approve the wallet signature to continue — your campaign hasn't been created yet.");
        setStep("idle");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // 1. Reuse the campaign row we already created this session — or the draft the
      //    user adopted via Resume. `adoptedDraftId` is the SINGLE source of truth,
      //    so a retry NEVER inserts a second campaign (and reuses the same PDA).
      let convexId = adoptedDraftId;
      if (!convexId) {
        setStep("creating-convex");
        let campaignImageStorageId: string | undefined;
        const contentFileStorageIds: string[] = [];
        try {
          if (imageFile) campaignImageStorageId = await uploadFile(imageFile);
          for (const { file } of contentFiles) contentFileStorageIds.push(await uploadFile(file));
        } catch (err) {
          console.error("File upload failed:", err);
          setError("File upload failed. Check your connection and try again.");
          setStep("idle");
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        const validLinks = contentLinks.filter((l) => l.trim().length > 0);
        // Expand every Drive-FOLDER or YouTube CHANNEL/PLAYLIST Reference link we
        // successfully resolved into its member video URLs (de-duped) so downstream
        // clipping gets the individual files. The raw collection link stays in
        // contentLinks (provenance); single-video / non-expandable links contribute
        // nothing here. A link still resolving at launch simply yields no files —
        // the raw link remains and is re-expanded server-side.
        const resolvedFolderVideos: string[] = [];
        for (const l of validLinks) {
          const key = l.trim();
          if (!looksExpandableSource(key)) continue;
          const p = folderPreviews[key];
          if (p && p.status === "ready") for (const vid of p.videos) resolvedFolderVideos.push(vid.url);
        }
        const contentFileUrls = mergeFolderVideos([], resolvedFolderVideos);
        try {
          convexId = await createCampaign({
            creatorWallet: publicKey.toBase58(),
            brandName: values.brandName,
            title: values.title,
            brief: values.brief,
            budget: values.budget,
            ratePerThousandViews: campaignType === "marketing" ? (values.ratePerThousandViews ?? 3) : 0,
            // Per-submission payout cap — marketing only, and only when set (> 0).
            maxPayoutUsdc: campaignType === "marketing" && values.maxPayoutUsdc && values.maxPayoutUsdc > 0
              ? values.maxPayoutUsdc
              : undefined,
            campaignType,
            category: boardCategory,
            rewardPerCompletion: campaignType !== "marketing" ? values.rewardPerCompletion : undefined,
            agentTaskCategory: campaignType === "agent_task" ? values.agentTaskCategory : undefined,
            deliverables: campaignType === "bounty" ? values.deliverables : undefined,
            contentLinks: validLinks.length > 0 ? validLinks : undefined,
            sourceRightsConfirmed: boardCategory === "clipping" && sourceRightsConfirmed,
            requiresProfileCta: boardCategory === "clipping" && requiresProfileCta,
            contentFileUrls: contentFileUrls.length > 0 ? contentFileUrls : undefined,
            contentFileStorageIds: contentFileStorageIds.length > 0 ? contentFileStorageIds : undefined,
            campaignImageStorageId,
            targetNiche: [values.targetNiche],
            targetLanguage: [values.targetLanguage],
            requirements: [...requirements.map((r) => r.trim()).filter(Boolean), ...(audienceLine ? [audienceLine] : [])],
            platforms,
            deadline: new Date(values.deadline).toISOString(),
            // Live-session proof (H09/BUG-032): unlocks the paid pre-transcribe
            // side-effect for this legit, signed-in create. undefined for the
            // (E2E-bypass sentinel is still a non-null string, which is fine).
            sessionToken: siwsToken ?? undefined,
          });
        } catch (err) {
          console.error("Convex create failed:", err);
          setError(err instanceof Error ? err.message : "Failed to create campaign. Check your connection.");
          setStep("idle");
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        // Persist so a retry reuses THIS row + PDA and the resume banner hides.
        setAdoptedDraftId(convexId);
      }

      if (!convexId) {
        // Should be unreachable — step 1 either adopted an id or returned on
        // failure — but a hard guard beats a non-null assertion on a money path.
        setError("Draft id lost — click Launch again.");
        setStep("idle");
        return;
      }

      // The review gate above restricts this flow to view-priced marketing.
      // Never insert an off-chain campaign here as if it were escrow-funded.
      if (campaignType !== "marketing") throw new Error("On-chain launch requires a Marketing campaign.");

      // 2. Pre-flight: verify the vault ON-CHAIN FIRST (catches a prior deposit that
      //    landed but timed out on confirmation), then gate on wallet balances
      //    before ever prompting the wallet to pay.
      setStep("preflight");
      const [u, s] = await Promise.all([refreshUsdc(), refreshSol()]);
      let vaultFunded = false;
      try {
        vaultFunded = (await checkVaultFunded(convexId, publicKey, values.budget)).funded;
      } catch {
        /* vault ATA not created yet — treat as unfunded */
      }

      const funding = checkFunding({ usdc: u ?? usdc, sol: s ?? sol, budget: values.budget });
      const decision = decideBeforeSign({ vaultFunded, funding });

      if (decision.action === "fund-wallet") {
        if (decision.reason === "usdc" && isMainnet()) {
          setStep("funding-wallet");
          // Privy's native on-ramp. fundWallet resolves on modal EXIT, not on
          // funds landing — the useFundWallet onUserExited callback resets the
          // step + refreshes balances so the user can re-check and click Launch
          // again once USDC arrives. Await + catch so a failure to open never
          // strands the UI in "funding-wallet".
          try {
            await fundWallet({
              address: publicKey.toBase58(),
              options: {
                chain: isMainnet() ? "solana:mainnet" : "solana:devnet",
                asset: "USDC",
                amount: String(Math.ceil(funding.usdcShort)),
              },
            });
          } catch {
            setError("Couldn't open the funding window. Add USDC to your wallet and click Launch again — your draft is saved.");
            setStep("idle");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        } else {
          setError(
            decision.reason === "usdc"
              ? `You need ${funding.usdcShort.toFixed(2)} more USDC on ${getNetwork()}. Fund your wallet (devnet: faucet.circle.com) and click Launch again — we kept your draft.`
              // 0-SOL wallets can't pay gas: give the amount + address + how to get SOL
              // (the user pays gas; full platform sponsorship is a deferred follow-up).
              : describeSolShortfall({ network: getNetwork(), walletAddress: publicKey.toBase58() }),
          );
          setStep("idle");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
      }

      // 3. Fund the escrow (once) — or skip straight to finalize if the reused vault
      //    already holds the budget.
      let pdaAddress: string | undefined;
      if (decision.action === "skip-funding-finalize") {
        pdaAddress = getCampaignPda(convexId, publicKey)[0].toBase58();
      } else {
        setStep("signing-escrow");
        try {
          if (!signTransaction) throw new Error("Wallet not connected.");
          // Adapt the unified (Privy-aware) signer to Anchor's wallet shape. Signing
          // goes through Privy → the login wallet is prompted, funds escrow on-chain.
          const program = buildEscrowProgram({
            publicKey,
            signTransaction,
            signAllTransactions: async (txs) => {
              const signed = [];
              for (const t of txs) signed.push(await signTransaction(t));
              return signed;
            },
          });
          // Pass the REAL per-1k rate (USDC — createCampaignTx converts to base units
          // internally) and the campaign deadline (unix secs). Only marketing
          // campaigns price per-view; others lock rate 0 (no view payout).
          const ratePer1k = campaignType === "marketing" ? (values.ratePerThousandViews ?? 3) : 0;
          const deadlineUnix = Math.floor(new Date(values.deadline).getTime() / 1000);
          const res = await createCampaignTx(program, convexId, values.budget, ratePer1k, deadlineUnix);
          pdaAddress = res.pdaAddress;
        } catch (err) {
          // Verify ON-CHAIN before ever asking to pay again — a confirmation timeout
          // routinely fires even though the deposit landed. Re-read the SAME vault
          // (same reused PDA): funded → finalize with NO re-charge; empty → honest
          // error and KEEP the draft for a safe retry.
          console.error("[campaign-form] Escrow step threw; verifying on-chain:", err);
          setStep("verifying");
          let after = false;
          try {
            after = (await checkVaultFunded(convexId, publicKey, values.budget)).funded;
          } catch {
            /* keep false */
          }
          const post = decideAfterSignError({ vaultFundedAfter: after });
          if (post.action === "skip-funding-finalize") {
            pdaAddress = getCampaignPda(convexId, publicKey)[0].toBase58();
          } else {
            // A DETERMINISTIC constraint revert (bad deadline/amount) will fail the
            // same way on retry — tell the user to fix the input, not "click again".
            // Only a transient/timeout throw gets the retry-safe message (the deposit
            // may have landed; we re-read the vault, so a retry never double-charges).
            const cls = classifyLaunchError(err instanceof Error ? err.message : String(err));
            setError(
              cls.deterministic
                ? cls.message
                : "We couldn't confirm your deposit yet. If your wallet shows it was sent, click Launch again — " +
                    "we'll verify on-chain and never charge you twice. " +
                    (err instanceof Error ? err.message : ""),
            );
            setStep("idle");
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
        }
      }

      // 4. Finalize: mark the campaign v2 with the confirmed vault PDA.
      setStep("finalizing");
      try {
        if (!pdaAddress) throw new Error("No vault address after funding.");
        // Re-bind the SIWS session to the active wallet right before finalize (a
        // no-op when still valid) so the server proves ownership against THIS wallet
        // and never 403s on a stale cross-wallet token now that the deposit landed.
        if ((await ensureSiwsSession().catch(() => null)) === null) {
          throw new Error("Please approve the wallet signature to finalize.");
        }
        // Finalize via the SIWS-gated route (updateCampaignPda is secret-gated).
        // Persist the terms ACTUALLY locked on-chain so a retry that re-read live
        // form state can't leave the row diverged from the vault (#16).
        const finalizeResp = await fetch("/api/campaigns/set-pda", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId: convexId,
            pdaAddress,
            onchainVersion: 2,
            budget: values.budget,
            ratePerThousandViews: campaignType === "marketing" ? (values.ratePerThousandViews ?? 3) : 0,
            deadline: new Date(values.deadline).toISOString(),
          }),
        });
        if (!finalizeResp.ok) {
          throw new Error((await finalizeResp.json().catch(() => ({}))).error || "Finalize failed");
        }
      } catch (err) {
        setError(
          `Deposit confirmed but finalizing failed — click Launch again to retry (no re-charge). ${err instanceof Error ? err.message : ""}`,
        );
        setStep("idle");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      setAdoptedDraftId(null);
      setStep("done");
    } finally {
      // Clear on EVERY exit path (early returns + success) so sequential retries
      // work but overlapping invocations remain blocked.
      inFlightRef.current = false;
    }
  }

  function onValidationError(formErrors: typeof errors) {
    // Jump to the earliest step that still has an error so it's visible.
    const target = STEP_FIELDS.findIndex((fields) =>
      fields.some((f) => formErrors[f]),
    );
    if (target >= 0 && target !== wizardStep) goTo(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const submitting = step !== "idle" && step !== "done";
  const hasFieldErrors = Object.keys(errors).length > 0;

  if (step === "done") {
    return (
      <CampaignLive
        title={formValues.title ?? ""}
        brand={formValues.brandName ?? ""}
        budget={Number(formValues.budget) || 0}
        platforms={platforms}
        imageUrl={imagePreview}
        onContinue={() => router.push("/stage")}
      />
    );
  }

  if (!connected || !publicKey) {
    return (
      <PaperScreen onClose={() => router.push("/stage")}>
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="w-full text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-[#141413] text-[#A3E635]">
            {connecting ? <Loader2 className="size-6 animate-spin" /> : <Wallet className="size-6" />}
          </div>
          <h1 className="mt-6 text-[34px] font-semibold leading-tight tracking-[-0.035em]">{connecting ? "Checking your wallet…" : "Connect your wallet to begin"}</h1>
          <p className="mx-auto mt-3 max-w-sm text-[16px] leading-relaxed text-[#141413]/60">You will fund the campaign treasury once your details are ready. Nothing moves until you confirm.</p>
          {!connecting && (
            <button type="button" onClick={() => promptLogin()} className="mt-8 inline-flex h-14 items-center gap-2.5 rounded-2xl bg-[#141413] px-7 text-[15px] font-semibold text-white transition-colors hover:bg-black">
              <Wallet className="size-4 text-[#A3E635]" /> Connect wallet
            </button>
          )}
        </motion.div>
      </PaperScreen>
    );
  }

  // A marketing campaign filed under the Clipping board is clipped by AI agents
  // from the sources supplied here — so a source is REQUIRED (see the launch
  // gate). Other types (UGC/bounty) can have no clip source, so the field stays
  // an optional "Reference links" input for them.
  // Only the CLIPPING board needs a clippable VIDEO source (agents clip from it).
  // A UGC campaign takes any WEBSITE link — the agent crawls it for product context
  // (crawlPageForContext in run-task) — so it must NOT be video-validated or blocked.
  const requiresClipSource = campaignType === "marketing" && boardCategory === "clipping";
  const isUgcSource = campaignType === "marketing" && boardCategory === "ugc";

  // Live money-safety flag: a marketing budget that can't cover even one
  // 1,000-view payout (budget < per-1K rate). Drives the inline warning + the
  // disabled launch button below; the hard block lives in onSubmit (upstream of
  // any USDC move). Only surfaced once a positive budget is entered so the empty
  // field isn't flagged (the schema min-budget rule owns that case).
  const marketingRateK = campaignType === "marketing" ? (Number(formValues.ratePerThousandViews) || 3) : 0;
  const budgetNum = Number(formValues.budget) || 0;
  const budgetBelowRate =
    campaignType === "marketing" && budgetNum > 0 && !isBudgetSufficient(budgetNum, marketingRateK, campaignType);

  // Live clip-source flag: a Clipping campaign (marketing + Clipping board) that
  // ships no clippable video source launches INVISIBLE to the clip-canvas Source
  // picker (it filters on contentLinks ∪ contentFileUrls) and can never be
  // clipped — yet still takes the user's USDC. Drives the disabled Launch button
  // + the inline note below; the HARD block lives in goNext + onSubmit (upstream
  // of any USDC move). Uses the SAME hasClipSource check as those gates so the
  // button state and the block never disagree. Mirrors budgetBelowRate.
  const sourceMissing = requiresClipSource && !hasClipSource({ contentLinks });

  // Hydrate the form from the ORIGINAL draft values so the resumed launch funds
  // exactly what the draft was created with.
  function resumeDraft() {
    if (!drafts || drafts.length === 0) return;
    // Hydrate the form from the ORIGINAL draft values so the resumed
    // launch funds exactly what the draft was created with (the on-chain
    // deposit reads live form values; a blank reloaded form would let a
    // resume fund a DIFFERENT budget than the DB row records). Also
    // restores the type + all typed fields so the user needn't re-enter.
    const d = drafts[0];
    setCampaignType((d.campaignType as CampaignType) ?? "marketing");
    // Coerce a legacy/absent category (incl. the removed "web3") to a
    // valid remaining tab so the resumed draft re-files under one.
    const resumedCategory = (d as { category?: string }).category;
    setBoardCategory(
      resumedCategory === "ugc" || resumedCategory === "clipping"
        ? resumedCategory
        : "clipping",
    );
    reset({
      title: d.title,
      brandName: d.brandName,
      brief: d.brief,
      budget: d.budget,
      ratePerThousandViews: d.ratePerThousandViews,
      rewardPerCompletion: d.rewardPerCompletion,
      deliverables: d.deliverables,
      agentTaskCategory: d.agentTaskCategory,
      targetNiche: d.targetNiche?.[0] ?? "lifestyle",
      targetLanguage: d.targetLanguage?.[0] ?? "en",
      deadline: d.deadline
        ? new Date(d.deadline).toISOString().split("T")[0]
        : "",
    });
    setRequirements(d.requirements?.length ? d.requirements : [""]);
    setRequirementsError(null);
    setPlatforms(d.platforms?.length ? [...d.platforms] : [...DEFAULT_PLATFORMS]);
    setPlatformsError(null);
    // Restore the draft's saved source links so the clip-source gate
    // (onSubmit) sees the source the draft was created WITH — a reloaded
    // form has an empty contentLinks, so without this a resume of a
    // clipping draft that HAS a source would be wrongly blocked
    // ("add a source") and the user could never finish funding it.
    const draftLinks = (d as { contentLinks?: string[] }).contentLinks;
    setContentLinks(draftLinks?.length ? [...draftLinks] : [""]);
    setSourceError(null);
    setAdoptedDraftId(d._id);
    setError(null);
  }

  const readyByScreen = [
    true,
    (formValues.brandName ?? "").trim().length >= 2 && (formValues.title ?? "").trim().length >= 5,
    (formValues.brief ?? "").trim().length >= 50 && requirements.some((r) => r.trim()),
    !requiresClipSource || contentLinks.some((l) => l.trim()),
    platforms.length > 0,
    budgetNum > 0 && !budgetBelowRate,
    false,
  ];
  const stepKey = String(wizardStep);
  const dirNow = dir === 0 ? 1 : dir;
  const coverCount = (imagePreview ? 1 : 0) + contentFiles.length;

  const banners = (
    <div className="space-y-3 empty:hidden [&:not(:empty)]:mb-6">
      {drafts && drafts.length > 0 && !adoptedDraftId && wizardStep === S.type && (
        <Notice tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>You have an unfinished campaign deposit ({drafts[0].title}). Resume it instead of starting over?</span>
            <button type="button" className="rounded-full bg-[#141413] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-black" onClick={resumeDraft}>Resume</button>
          </div>
        </Notice>
      )}
      {error && (
        <Notice tone="error">
          <p className="font-semibold">Failed to post campaign</p>
          <p className="mt-0.5 text-[13px] opacity-90">{error}</p>
        </Notice>
      )}
      {escrowWarning && <Notice tone="warn">{escrowWarning}</Notice>}
      {hasFieldErrors && !error && <Notice tone="warn">Some fields need attention. We highlighted them.</Notice>}
    </div>
  );

  const screens: React.ReactNode[] = [];

  // 0 — TYPE
  screens[S.type] = (
    <StepFrame eyebrow="Campaign" title="What kind of campaign?" hint="Pick a type, and where it should list on the stage. You can change both before launch.">
      <Stagger role="radiogroup" aria-label="Campaign type" className="grid gap-3 sm:grid-cols-2">
        {CAMPAIGN_TYPES.map((t) => {
          const Icon = t.icon;
          return (
            <OptionCard key={t.value} selected={campaignType === t.value} onClick={() => setCampaignType(t.value)} title={t.label} blurb={t.sublabel} className="min-h-[190px]">
              <span className="relative mt-4 grid size-11 place-items-center rounded-xl bg-[#141413] text-[#A3E635]"><Icon className="size-5" /></span>
              <span className="relative mt-3 text-[13px] leading-snug text-[#141413]/55">{t.description}</span>
            </OptionCard>
          );
        })}
      </Stagger>
      <p className={cn(cLabel, "mb-2.5 mt-8")}>Lists under</p>
      <Stagger role="radiogroup" aria-label="Board" delay={0.25} className="grid gap-3 sm:grid-cols-2">
        {BOARD_CATEGORIES.map(({ value, label, hint }) => (
          <OptionCard key={value} selected={boardCategory === value} onClick={() => setBoardCategory(value)} title={label} blurb={hint} />
        ))}
      </Stagger>
    </StepFrame>
  );

  // 1 — BASICS
  screens[S.basics] = (
    <StepFrame eyebrow="Basics" title="Who is it for?" hint="Your brand and a title creators will recognise. Add a cover so it stands out on the stage.">
      <div className="grid gap-5 sm:grid-cols-2">
        <CField label="Brand name" htmlFor="brandName" error={errors.brandName?.message}>
          <input id="brandName" autoFocus placeholder="Northwind Studio, Wise, Notion..." className={cInput} {...register("brandName")} />
        </CField>
        <CField label="Campaign title" htmlFor="title" error={errors.title?.message}>
          <input id="title" placeholder="Raya 2026 product launch" className={cInput} {...register("title")} />
        </CField>
      </div>
      <p className={cn(cLabel, "mb-2.5 mt-8")}>Images <span className="normal-case tracking-normal text-[#141413]/35">· {coverCount}/4, first is the cover</span></p>
      <Stagger delay={0.15} className="grid max-w-[520px] grid-cols-2 gap-3 sm:grid-cols-4">
        <motion.div variants={itemVariants} className="relative aspect-square overflow-hidden rounded-2xl border border-black/12 bg-white/70">
          {imagePreview ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Campaign cover" className="size-full object-cover" />
              <button type="button" onClick={() => coverInputRef.current?.click()} aria-label="Replace campaign cover" className="absolute inset-0 grid place-items-center bg-black/55 text-xs font-semibold text-white opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100">Replace cover</button>
              <button type="button" onClick={() => { URL.revokeObjectURL(imagePreview); setImageFile(null); setImagePreview(null); }} aria-label="Remove campaign cover" className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/75 text-white hover:bg-red-600"><X className="size-4" /></button>
              <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white">Cover</span>
            </>
          ) : (
            <button type="button" onClick={() => coverInputRef.current?.click()} className="flex size-full flex-col items-center justify-center gap-2 border-2 border-dashed border-black/20 text-center transition-colors hover:border-[#141413] hover:bg-white">
              <ImagePlus className="size-6 text-[#141413]/60" />
              <span className="px-2 text-[12px] font-semibold text-[#141413]">Upload cover</span>
            </button>
          )}
        </motion.div>
        {Array.from({ length: MAX_CONTENT_IMAGES }).map((_, i) => {
          const item = contentFiles[i];
          return item ? (
            <motion.div key={i} variants={itemVariants} className="relative aspect-square overflow-hidden rounded-2xl border border-black/12 bg-white/70">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.preview} alt={`Reference ${i + 1}`} className="size-full object-cover" />
              <button type="button" onClick={() => removeContentFile(i)} aria-label={`Remove reference ${i + 1}`} className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/75 text-white hover:bg-red-600"><X className="size-4" /></button>
              <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-black/75 px-2 py-0.5 text-[10px] text-white">Ref {i + 1}</span>
            </motion.div>
          ) : i === contentFiles.length ? (
            <motion.label key={i} variants={itemVariants} className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-black/15 bg-white/40 text-center transition-colors hover:border-[#141413] hover:bg-white">
              <Plus className="size-5 text-[#141413]/50" />
              <span className="px-2 text-[11.5px] font-medium text-[#141413]/70">Add images</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only" onChange={handleContentFileSelect} />
            </motion.label>
          ) : (
            <motion.div key={i} variants={itemVariants} className="aspect-square rounded-2xl border-2 border-dashed border-black/8" />
          );
        })}
      </Stagger>
    </StepFrame>
  );

  // 2 — BRIEF
  screens[S.brief] = (
    <StepFrame
      eyebrow="Brief"
      title={campaignType === "bounty" ? "What needs to be done?" : campaignType === "agent_task" ? "What should the agent do?" : "What should the content say?"}
      hint={
        campaignType === "agent_task"
          ? "Agents read this verbatim. Be precise, and include everything they need to finish without asking."
          : campaignType === "bounty"
            ? "Spell out the task and how you will verify it. Clear criteria mean faster, dispute-free payouts."
            : "Describe the content, tone and any must-haves. Creators follow this brief exactly."
      }
    >
      <AnimatePresence>
        {!tipsOff.brief && (
          <CoachTip key="brief-tip" onDismiss={() => setTipsOff((t) => ({ ...t, brief: true }))}>
            Not sure what to write? Paste your website and I will draft the brief and the requirements for you. You can edit everything.
          </CoachTip>
        )}
      </AnimatePresence>

      <div className="relative mb-7 overflow-hidden rounded-[24px] border border-black/10 bg-white/80 p-4 shadow-[0_18px_44px_-30px_rgba(20,20,19,0.4)] sm:p-5">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-[#A3E635]/30 blur-3xl" />
        <p className="relative flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#141413]/55">
          <Sparkles className="size-3.5 text-[#4d7c0f]" /> Write it for me
        </p>
        <div className="relative mt-3 flex flex-col gap-2.5 sm:flex-row">
          <div className="flex h-12 flex-1 items-center gap-2.5 rounded-2xl border border-black/12 bg-white px-4 transition-colors focus-within:border-[#141413]">
            <Globe2 className="size-4 shrink-0 text-[#141413]/35" />
            <input
              type="url"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void runAiAssist("all"); } }}
              placeholder="https://yourbrand.com (optional)"
              aria-label="Your website"
              className="h-full flex-1 bg-transparent text-[15px] text-[#141413] outline-none placeholder:text-[#141413]/30"
            />
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => void runAiAssist("all")}
            disabled={aiState === "working" || (!siteUrl.trim() && !(formValues.brandName ?? "").trim() && !(formValues.title ?? "").trim())}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#141413] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {aiState === "working" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-[#A3E635]" />}
            {aiState === "working" ? "Writing…" : aiState === "done" ? "Write again" : "Write it"}
          </motion.button>
        </div>
        <div className="relative mt-2.5 min-h-5 text-[13px]" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {aiState === "working" ? (
              <motion.span key={`w${Math.min(aiStatusIdx, 3)}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="inline-flex items-center gap-2 text-[#141413]/60">
                <span className="inline-flex gap-1">{[0, 1, 2].map((d) => <motion.span key={d} className="size-1.5 rounded-full bg-[#84CC16]" animate={{ y: [0, -4, 0] }} transition={{ duration: 0.7, repeat: Infinity, delay: d * 0.12 }} />)}</span>
                {["Reading your site…", "Finding the angle…", "Writing the brief…", "Drafting requirements…"][Math.min(aiStatusIdx, 3)]}
              </motion.span>
            ) : aiNote ? (
              <motion.span key="note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={aiState === "error" ? "text-red-600" : "text-[#4d7c0f]"}>{aiNote}</motion.span>
            ) : (
              <motion.span key="hint" className="text-[#141413]/45">No website? Add your brand and title on the previous screen and I will use those.</motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      <CField label={BRIEF_HINTS[campaignType].label} htmlFor="brief" error={errors.brief?.message}>
        <textarea id="brief" rows={8} className={cn(cTextarea, "h-56 max-h-[26rem] min-h-[10rem] resize-y overflow-y-auto")} placeholder={BRIEF_HINTS[campaignType].placeholder} {...register("brief")} />
        <p className="-mt-0.5 text-right text-[12px] tabular-nums text-[#141413]/40" aria-live="polite">
          {(formValues.brief ?? "").length.toLocaleString()} characters · at least 50
        </p>
      </CField>

      <div className="mt-7">
        <CField label="Requirements" hint="Agents must follow every requirement on each post. At least one." error={requirementsError ?? undefined}>
          <div className="space-y-2.5">
            <AnimatePresence initial={false}>
              {requirements.map((req, i) => (
                <motion.div key={i} layout initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.22, ease: EASE }} className="flex items-center gap-2">
                  <div className="flex flex-1 items-center gap-2.5 rounded-2xl border border-black/12 bg-white/80 px-4 transition-colors focus-within:border-[#141413]">
                    <CheckSquare className="size-4 shrink-0 text-[#141413]/35" />
                    <input type="text" value={req} onChange={(e) => updateRequirement(i, e.target.value)} placeholder="clip along rocket videos from youtube, tag @alongrocket on tiktok" className="h-12 flex-1 bg-transparent text-[14.5px] text-[#141413] outline-none placeholder:text-[#141413]/30" />
                  </div>
                  {requirements.length > 1 && (
                    <button type="button" onClick={() => removeRequirement(i)} aria-label="Remove requirement" className="grid size-9 place-items-center rounded-full text-[#141413]/40 transition-colors hover:bg-red-50 hover:text-red-600"><X className="size-4" /></button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <button type="button" onClick={addRequirement} className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] font-medium text-[#141413]/60 transition-colors hover:bg-black/5 hover:text-[#141413]"><Plus className="size-4" /> Add requirement</button>
          </div>
        </CField>
      </div>

      {(() => {
        const used = new Set(requirements.map((r) => r.trim().toLowerCase()));
        const left = requirementIdeas(campaignType, boardCategory, formValues.brandName ?? "").filter((i) => !used.has(i.toLowerCase()));
        return (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className={cLabel}>Quick add</p>
              <button type="button" onClick={() => void runAiAssist("requirements")} disabled={aiState === "working"} className="inline-flex items-center gap-1.5 rounded-full bg-[#141413] px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-40">
                <Sparkles className="size-3.5 text-[#A3E635]" /> Suggest with AI
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <AnimatePresence initial={false}>
                {left.map((idea) => (
                  <motion.button
                    key={idea}
                    type="button"
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => addRequirementText(idea)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-black/20 bg-white/60 px-3.5 py-2 text-left text-[13px] text-[#141413]/75 transition-colors hover:border-[#141413] hover:bg-white hover:text-[#141413]"
                  >
                    <Plus className="size-3.5 shrink-0" /> {idea}
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          </div>
        );
      })()}

      {campaignType === "bounty" && (
        <div className="mt-7">
          <CField label="Deliverables and acceptance criteria" hint="Shown to claimants as the checklist they must meet. Optional but recommended.">
            <textarea rows={3} className={cTextarea} placeholder="Exactly what must be submitted: format, length, link type, verification steps..." {...register("deliverables")} />
          </CField>
        </div>
      )}

      {campaignType === "agent_task" && (
        <div className="mt-7">
          <p className={cn(cLabel, "mb-2.5")}>Task category</p>
          <Stagger className="grid gap-2.5 sm:grid-cols-2">
            {AGENT_TASK_CATEGORIES.map((cat) => {
              const CatIcon = cat.icon;
              return (
                <OptionCard key={cat.value} selected={formValues.agentTaskCategory === cat.value} onClick={() => setValue("agentTaskCategory", cat.value, { shouldDirty: true })} title={cat.label} blurb={cat.desc}>
                  <CatIcon className="absolute bottom-3 right-3.5 size-4 text-[#141413]/25" />
                </OptionCard>
              );
            })}
          </Stagger>
        </div>
      )}

      {campaignType === "marketing" && boardCategory === "clipping" && (
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-black/10 bg-white/60 p-4 text-[14px] leading-relaxed text-[#141413]/75">
          <input type="checkbox" checked={requiresProfileCta} onChange={(e) => setRequiresProfileCta(e.target.checked)} className="mt-1 size-4 accent-[#141413]" />
          <span>Participation requires a link in the clipper&apos;s profile or bio. Agents will need individual owner approval; Vello does not edit their profiles.</span>
        </label>
      )}
    </StepFrame>
  );

  // 3 — SOURCE
  screens[S.source] = (
    <StepFrame
      eyebrow="Source"
      title={requiresClipSource ? "What should agents clip?" : isUgcSource ? "Where can agents learn about it?" : "Any links to share?"}
      hint={
        requiresClipSource
          ? "Paste a Google Drive folder, a YouTube channel or playlist, or direct video links. Clippers cut from these, so a clipping campaign needs one."
          : isUgcSource
            ? "Paste your brand site, landing page, product page or docs. Agents read them to understand your product before creating content."
            : "Optional URLs agents can read: brand site, style guide, competitor, doc or video."
      }
    >
      <AnimatePresence>
        {!tipsOff.source && (
          <CoachTip key="source-tip" onDismiss={() => setTipsOff((t) => ({ ...t, source: true }))}>
            {requiresClipSource
              ? "Tip: a YouTube channel or a shared Google Drive folder gives agents lots of material. Make sure it is public."
              : "Tip: agents read these pages to understand your product. Your homepage and one product page is plenty."}
          </CoachTip>
        )}
      </AnimatePresence>
      <CField label={requiresClipSource ? "Source videos" : isUgcSource ? "Source websites" : "Reference links"} error={requiresClipSource ? (sourceError ?? undefined) : undefined}>
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {contentLinks.map((link, i) => {
              // A Drive FOLDER or YouTube CHANNEL/PLAYLIST link gets a live preview of
              // its member videos (resolved on blur/paste via the SAME resolver route).
              const linkKey = link.trim();
              const isDriveFolder = looksLikeDriveFolder(linkKey);
              const isYtChannel = looksLikeYoutubeChannel(linkKey);
              const isYtVideo = looksLikeYoutube(linkKey) && !isYtChannel;
              const isExpandable = isDriveFolder || isYtChannel;
              const preview = isExpandable ? folderPreviews[linkKey] : undefined;
              const looksLikeVideoSource =
                isExpandable ||
                looksLikeYoutube(linkKey) ||
                /drive\.google\.com/i.test(linkKey) ||
                /\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i.test(linkKey) ||
                /(?:\/\/|\.)(?:tiktok|instagram|vimeo)\.com\//i.test(linkKey);
              return (
                <motion.div key={i} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.22, ease: EASE }} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 items-center gap-2.5 rounded-2xl border border-black/12 bg-white/80 px-4 transition-colors focus-within:border-[#141413]">
                      <ExternalLink className="size-4 shrink-0 text-[#141413]/35" />
                      <input
                        type="url"
                        value={link}
                        onChange={(e) => updateLink(i, e.target.value)}
                        onBlur={(e) => void resolveFolderLink(e.target.value)}
                        onPaste={(e) => {
                          const t = e.clipboardData.getData("text").trim();
                          if (t && looksExpandableSource(t)) void resolveFolderLink(t);
                        }}
                        placeholder={requiresClipSource ? "https://youtube.com/@channel or a Drive folder" : "https://example.com/brand-guide"}
                        className="h-14 flex-1 bg-transparent text-[15px] text-[#141413] outline-none placeholder:text-[#141413]/30"
                      />
                    </div>
                    {contentLinks.length > 1 && (
                      <button type="button" onClick={() => removeLink(i)} aria-label="Remove link" className="grid size-9 place-items-center rounded-full text-[#141413]/40 transition-colors hover:bg-red-50 hover:text-red-600"><X className="size-4" /></button>
                    )}
                  </div>
                  {preview?.status === "loading" && <p className="flex items-center gap-1.5 px-2 text-[13px] text-[#141413]/55"><Loader2 className="size-3.5 animate-spin" /> Checking link…</p>}
                  {preview?.status === "ready" && (
                    <p className="rounded-xl border border-[#84CC16]/40 bg-[#A3E635]/15 px-3 py-2 text-[13px] leading-relaxed text-[#2f4a05]">
                      {isDriveFolder ? "Drive folder" : "YouTube channel"}: {preview.videos.length} {isDriveFolder ? "file" : "video"}{preview.videos.length === 1 ? "" : "s"} found. {preview.videos.map((v) => v.name).join(", ")}
                    </p>
                  )}
                  {preview?.status === "empty" && (
                    <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
                      {isDriveFolder ? "This Google Drive folder is empty or not shared with anyone who has the link. Make it public so agents can clip its videos." : "Could not list any videos on this YouTube channel or playlist. Check it is public and has uploads."}
                    </p>
                  )}
                  {preview?.status === "error" && <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">Could not check this link right now. It will be re-checked when the campaign launches.</p>}
                  {!preview && linkKey.length > 0 && (
                    isExpandable ? <p className="px-2 text-[13px] text-[#4d7c0f]">{isDriveFolder ? "Google Drive folder" : "YouTube channel"}. Checking when you leave the field…</p>
                    : isYtVideo ? <p className="px-2 text-[13px] text-[#4d7c0f]">YouTube video</p>
                    : looksLikeVideoSource ? <p className="px-2 text-[13px] text-[#4d7c0f]">Video link</p>
                    : requiresClipSource ? <p className="px-2 text-[13px] text-amber-700">Does not look like a YouTube, Drive or video link</p>
                    : null
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={addLink} className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] font-medium text-[#141413]/60 transition-colors hover:bg-black/5 hover:text-[#141413]"><Plus className="size-4" /> Add link</button>
            {!requiresClipSource && siteUrl.trim() && !contentLinks.some((l) => l.trim() === siteUrl.trim()) && (
              <motion.button type="button" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} whileTap={{ scale: 0.94 }} onClick={() => setContentLinks((prev) => [...prev.filter((l) => l.trim()), siteUrl.trim()])} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#84CC16] bg-[#A3E635]/15 px-3.5 py-1.5 text-[13px] font-medium text-[#2f4a05]">
                <Globe2 className="size-3.5" /> Use {siteUrl.trim().replace(/^https?:\/\//, "").slice(0, 30)}
              </motion.button>
            )}
          </div>
        </div>
      </CField>

      {requiresClipSource && (
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-black/10 bg-white/60 p-4 text-[14px] leading-relaxed text-[#141413]/75">
          <input type="checkbox" checked={sourceRightsConfirmed} onChange={(e) => setSourceRightsConfirmed(e.target.checked)} className="mt-1 size-4 accent-[#141413]" />
          <span>I own these source videos or have permission to let participating agents clip and republish them on their connected social accounts.</span>
        </label>
      )}
    </StepFrame>
  );

  // 4 — AUDIENCE
  const countryList = showAllCountries ? COUNTRIES : COUNTRIES.slice(0, 10);
  screens[S.audience] = (
    <StepFrame eyebrow="Audience" title="Who should see it, and where?" hint="Tell agents who you want to reach and which networks count. Skip anything you do not care about.">
      {(campaignType === "marketing" || campaignType === "bounty") && (
        <>
          <p className={cn(cLabel, "mb-2.5")}>Niche</p>
          <div className="flex flex-wrap gap-2">
            {NICHES.map((n) => (
              <Chip key={n} selected={formValues.targetNiche === n} onClick={() => setValue("targetNiche", n, { shouldDirty: true })}>{n.charAt(0).toUpperCase() + n.slice(1)}</Chip>
            ))}
          </div>
          <p className={cn(cLabel, "mb-2.5 mt-7")}>Language</p>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <Chip key={l.value} selected={formValues.targetLanguage === l.value} onClick={() => setValue("targetLanguage", l.value, { shouldDirty: true })}>{l.label}</Chip>
            ))}
          </div>

          <div className="mb-2.5 mt-7 flex items-baseline justify-between">
            <p className={cLabel}>Countries</p>
            <span className="text-[12px] text-[#141413]/45">{countries.length ? `${countries.length} selected` : "Worldwide"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip selected={countries.length === 0} onClick={() => setCountries([])}>Worldwide</Chip>
            {countryList.map((c) => (
              <Chip key={c.code} selected={countries.includes(c.code)} onClick={() => setCountries((prev) => (prev.includes(c.code) ? prev.filter((x) => x !== c.code) : [...prev, c.code]))}>{c.name}</Chip>
            ))}
            <button type="button" onClick={() => setShowAllCountries((v) => !v)} className="rounded-full px-3 py-2 text-[13px] font-medium text-[#141413]/55 underline-offset-4 hover:text-[#141413] hover:underline">
              {showAllCountries ? "Fewer" : `+${COUNTRIES.length - 10} more`}
            </button>
          </div>

          <div className="mt-7 grid gap-6 sm:grid-cols-2">
            <div>
              <p className={cn(cLabel, "mb-2.5")}>Age <span className="normal-case tracking-normal text-[#141413]/35">· any</span></p>
              <div className="flex flex-wrap gap-2">
                {AGE_GROUPS.map((a) => (
                  <Chip key={a} selected={ages.includes(a)} onClick={() => setAges((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))}>{a}</Chip>
                ))}
              </div>
            </div>
            <div>
              <p className={cn(cLabel, "mb-2.5")}>Mostly</p>
              <div className="flex flex-wrap gap-2">
                {GENDERS.map((g) => <Chip key={g.id} selected={gender === g.id} onClick={() => setGender(g.id)}>{g.label}</Chip>)}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="mb-3 mt-9 flex items-baseline justify-between">
        <p className={cLabel}>Platforms</p>
        <span className="text-[12px] text-[#141413]/45">Tap to turn on or off</span>
      </div>
      <Stagger delay={0.15} className="flex items-start justify-between gap-1.5 sm:gap-3">
        {CAMPAIGN_PLATFORMS.map((p) => (
          <PlatformToggle key={p.id} id={p.id} label={p.label} on={platforms.includes(p.id)} onToggle={() => togglePlatform(p.id)} />
        ))}
      </Stagger>
      {platformsError && <p role="alert" className="mt-3 text-[13px] text-red-600">{platformsError}</p>}
    </StepFrame>
  );

  // 5 — REWARD
  const budgetVal = Number(formValues.budget) || 0;
  const rateVal = Number(formValues.ratePerThousandViews) || 0;
  const rewardVal = Number(formValues.rewardPerCompletion) || 0;
  const setBudget = (v: number) => setValue("budget", v, { shouldValidate: true, shouldDirty: true });
  screens[S.reward] = (
    <StepFrame eyebrow="Reward" title="Set the reward and see the reach" hint="Move the sliders. The numbers below show roughly how many people you will reach and what agents earn.">
      <AnimatePresence>
        {!tipsOff.reward && (
          <CoachTip key="reward-tip" onDismiss={() => setTipsOff((t) => ({ ...t, reward: true }))}>
            Drag the budget slider. A higher rate per 1,000 views attracts more agents, a bigger budget buys more views. Minimum budget is ${MIN_CAMPAIGN_BUDGET_USDC.toLocaleString()}.
          </CoachTip>
        )}
      </AnimatePresence>

      {campaignType === "marketing" && <RewardEstimator budget={budgetVal} rate={rateVal || 3} />}

      <div className="mt-7 rounded-[24px] border border-black/8 bg-white/70 p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <label htmlFor="budget" className={cLabel}>Treasury (USDC)</label>
            <p className="mt-1 flex items-baseline font-mono text-[34px] font-bold leading-none tracking-tight tabular-nums">
              $<AnimatedNumber value={budgetVal} />
            </p>
          </div>
          <div className="relative w-32">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[#141413]/35">$</span>
            <input id="budget" type="number" min={MIN_CAMPAIGN_BUDGET_USDC} step={100} inputMode="decimal" aria-label="Exact budget" className={cn(cInput, "h-11 pl-6 pr-3 font-mono text-[14px]")} {...register("budget")} />
          </div>
        </div>
        <div className="mt-5">
          <RangeSlider label="Budget" value={sliderFromBudget(budgetVal)} onChange={(p) => setBudget(budgetFromSlider(p))} valueText={`$${budgetVal.toLocaleString()}`} />
          <div className="mt-2 flex justify-between text-[11.5px] tabular-nums text-[#141413]/40"><span>$1K</span><span>$5K</span><span>$20K</span><span>$50K</span></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[1000, 2500, 5000, 10000, 25000].map((v) => <Chip key={v} selected={budgetVal === v} onClick={() => setBudget(v)}>${v.toLocaleString()}</Chip>)}
        </div>
        {errors.budget?.message && <p role="alert" className="mt-3 text-[13px] text-red-600">{errors.budget.message}</p>}
      </div>

      {campaignType === "marketing" ? (
        <div className="mt-4 rounded-[24px] border border-black/8 bg-white/70 p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <label htmlFor="rateK" className={cLabel}>Agents earn per 1,000 views</label>
              <p className="mt-1 flex items-baseline font-mono text-[34px] font-bold leading-none tracking-tight tabular-nums">
                $<AnimatedNumber value={rateVal} format={(n) => n.toFixed(2)} />
              </p>
            </div>
            <div className="relative w-28">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[#141413]/35">$</span>
              <input id="rateK" type="number" min={0.5} step={0.5} inputMode="decimal" aria-label="Exact rate" className={cn(cInput, "h-11 pl-6 pr-3 font-mono text-[14px]")} {...register("ratePerThousandViews")} />
            </div>
          </div>
          <div className="mt-5">
            <RangeSlider label="Rate per 1,000 views" min={0.5} max={10} step={0.5} value={Math.min(10, Math.max(0.5, rateVal || 3))} onChange={(v) => setValue("ratePerThousandViews", v, { shouldValidate: true, shouldDirty: true })} valueText={`$${rateVal.toFixed(2)} per 1,000 views`} />
            <div className="mt-2 flex justify-between text-[11.5px] tabular-nums text-[#141413]/40"><span>$0.50</span><span>$2.50</span><span>$5</span><span>$10</span></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[1, 2, 3, 5].map((v) => <Chip key={v} selected={rateVal === v} onClick={() => setValue("ratePerThousandViews", v, { shouldValidate: true, shouldDirty: true })}>${v} / 1K</Chip>)}
          </div>
          {errors.ratePerThousandViews?.message && <p role="alert" className="mt-3 text-[13px] text-red-600">{errors.ratePerThousandViews.message}</p>}
        </div>
      ) : (
        <div className="mt-4 rounded-[24px] border border-black/8 bg-white/70 p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <label htmlFor="rewardPerCompletion" className={cLabel}>Reward per completion</label>
              <p className="mt-1 flex items-baseline font-mono text-[34px] font-bold leading-none tracking-tight tabular-nums">$<AnimatedNumber value={rewardVal} /></p>
            </div>
            <div className="relative w-28">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[#141413]/35">$</span>
              <input id="rewardPerCompletion" type="number" min={1} inputMode="decimal" aria-label="Exact reward" className={cn(cInput, "h-11 pl-6 pr-3 font-mono text-[14px]")} {...register("rewardPerCompletion")} />
            </div>
          </div>
          <div className="mt-5">
            <RangeSlider label="Reward per completion" min={5} max={500} step={5} value={Math.min(500, Math.max(5, rewardVal || 25))} onChange={(v) => setValue("rewardPerCompletion", v, { shouldValidate: true, shouldDirty: true })} valueText={`$${rewardVal}`} />
          </div>
          {errors.rewardPerCompletion?.message && <p role="alert" className="mt-3 text-[13px] text-red-600">{errors.rewardPerCompletion.message}</p>}
          {rewardVal > 0 && budgetVal > 0 && (
            <p className="mt-3 text-[14px] text-[#141413]/60">Funds up to <span className="font-mono font-semibold text-[#141413]"><AnimatedNumber value={Math.floor(budgetVal / rewardVal)} /></span> completions before the budget is used up.</p>
          )}
        </div>
      )}

      {campaignType === "marketing" && (
        <div className="mt-4 max-w-sm">
          <CField label="Max payout per submission (USDC)" htmlFor="maxPayoutUsdc" error={errors.maxPayoutUsdc?.message} hint="Optional. Caps what one submission can earn, however viral. Blank means no cap.">
            <input id="maxPayoutUsdc" type="number" min={1} inputMode="decimal" placeholder="No cap" className={cn(cInput, "font-mono")} {...register("maxPayoutUsdc")} />
          </CField>
        </div>
      )}

      {budgetBelowRate && (
        <div className="mt-4"><Notice tone="error">Budget must be at least the rate <span className="font-mono font-semibold">(${marketingRateK.toFixed(2)}/1K)</span>, otherwise the treasury cannot pay out even one 1,000-view reward.</Notice></div>
      )}

      <div className="mt-8">
        <div className="mb-2.5 flex items-baseline justify-between">
          <p className={cLabel}>Campaign runs for</p>
          {typeof formValues.deadline === "string" && formValues.deadline && (
            <span className="text-[12px] text-[#141413]/45">Ends {new Date(formValues.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
          )}
        </div>
        <Stagger role="radiogroup" aria-label="Duration" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DEADLINE_PRESETS.map((p) => (
            <OptionCard key={p.key} selected={deadlinePreset === p.key} onClick={() => pickDeadlinePreset(p.key)} title={p.label} blurb={new Date(presetToDeadline(p.days)).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
          ))}
        </Stagger>
        <p className="mt-2.5 text-[13px] text-[#141413]/45">After this, submissions close and you can reclaim any unspent treasury.</p>
        {errors.deadline?.message && <p role="alert" className="mt-2 text-[13px] text-red-600">{errors.deadline.message}</p>}
      </div>
    </StepFrame>
  );

  // 6 — LAUNCH
  screens[S.review] = (
    <StepFrame eyebrow="Launch" title="Ready to go live?" hint="One last look. Launching asks your wallet to sign one transaction that creates the treasury and deposits your budget.">
      <CampaignSummary campaignType={campaignType} boardCategory={boardCategory} values={formValues} imageUrl={imagePreview} platforms={platforms} requirements={requirements} audience={audienceLine} onEdit={goTo} />
      <div className="mt-5 space-y-3 empty:hidden">
        {budgetBelowRate && <Notice tone="error">Budget must be at least the rate <span className="font-mono font-semibold">(${marketingRateK.toFixed(2)}/1K)</span>. <button type="button" onClick={() => goTo(S.reward)} className="font-semibold underline underline-offset-2">Fix budget</button></Notice>}
        {sourceMissing && <Notice tone="error">This campaign has no source video yet. <button type="button" onClick={() => goTo(S.source)} className="font-semibold underline underline-offset-2">Add a source</button> so agents have something to clip.</Notice>}
        {campaignType === "marketing" && Number(formValues.budget) > 0 && (
          <p className="px-1 text-[13px] text-[#141413]/55">
            You hold <span className="font-mono text-[#141413]">{usdc === null ? "-" : `$${usdc.toFixed(2)}`} USDC</span> and <span className="font-mono text-[#141413]">{sol === null ? "-" : sol.toFixed(3)} SOL</span> for gas
            {usdc !== null && usdc < Number(formValues.budget) && <> <span className="font-semibold text-amber-700">{isMainnet() ? "You will be asked to fund your wallet." : "Add USDC before launching."}</span></>}
          </p>
        )}
      </div>
    </StepFrame>
  );

  const last = wizardStep === SCREEN_LABELS.length - 1;

  return (
    <>
      <WizardShell
        labels={[...SCREEN_LABELS]}
        stepIdx={wizardStep}
        maxReached={maxReached}
        dir={dirNow}
        stepKey={stepKey}
        happy={readyByScreen[wizardStep] && !last}
        onJump={goTo}
        onClose={() => router.push("/stage")}
        locked={submitting}
      >
        <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={handleImageSelect} aria-hidden tabIndex={-1} />
        <form
          onSubmit={handleSubmit(onSubmit, onValidationError)}
          onKeyDown={(e) => {
            // Enter advances screens instead of submitting early (textarea keeps newlines).
            const tag = (e.target as HTMLElement).tagName;
            if (e.key === "Enter" && !last && tag !== "TEXTAREA") {
              e.preventDefault();
              void goNext();
            }
          }}
        >
          {banners}
          {screens[wizardStep]}
          <NavRow
            canBack={wizardStep > 0}
            onBack={goBack}
            backDisabled={submitting}
            type={last ? "submit" : "button"}
            onPrimary={last ? undefined : () => void goNext()}
            primaryLabel={last ? (submitting ? stepLabel(step) : "Review deposit") : sourceValidating ? "Checking link…" : "Continue"}
            primaryDisabled={last ? submitting || budgetBelowRate || sourceMissing : sourceValidating}
            busy={sourceValidating || (last && submitting)}
            icon={last ? <Rocket className="size-4 text-[#A3E635]" /> : undefined}
          />
          {submitting && <LaunchProgress step={step} />}
        </form>
      </WizardShell>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {depositReview !== null && (
            <motion.div key="deposit" className="fixed inset-0 z-[90] grid place-items-center bg-black/45 px-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDepositReview(null)}>
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Confirm escrow deposit"
                initial={{ opacity: 0, y: 24, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-[28px] bg-[#F6F4F0] p-6 text-[#141413] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)]"
              >
                <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#141413]/60"><Shield className="size-4" /> Confirm deposit</p>
                <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.03em]">Sign one transaction</h2>
                <p className="mt-2 text-[14px] leading-relaxed text-[#141413]/60">Your wallet creates the campaign vault and transfers the deposit. Agents can join once it is confirmed on-chain.</p>
                <div className="mt-5 divide-y divide-black/8 rounded-2xl bg-white/80 px-4 text-[14px]">
                  <div className="flex justify-between gap-3 py-3"><span className="text-[#141413]/55">Campaign</span><span className="max-w-[55%] truncate font-medium">{depositReview.title}</span></div>
                  <div className="flex justify-between gap-3 py-3"><span className="text-[#141413]/55">Network</span><span className="font-medium capitalize">Solana {getNetwork()}</span></div>
                  <div className="flex justify-between gap-3 py-3"><span className="text-[#141413]/55">Deposit</span><span className="font-mono font-bold">{depositReview.budget.toFixed(2)} USDC</span></div>
                  <div className="flex justify-between gap-3 py-3"><span className="text-[#141413]/55">Reward rate</span><span className="font-mono">{(depositReview.ratePerThousandViews ?? 3).toFixed(2)} USDC / 1K views</span></div>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button type="button" onClick={() => setDepositReview(null)} className="h-12 rounded-2xl bg-black/6 px-5 text-[14px] font-semibold hover:bg-black/10">Cancel</button>
                  <button type="button" onClick={() => { const values = depositReview; setDepositReview(null); if (values) void launchCampaign(values); }} className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#141413] px-5 text-[14px] font-semibold text-white hover:bg-black"><Wallet className="size-4 text-[#A3E635]" /> Confirm and deposit</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
