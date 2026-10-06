"use client";

import { InfluencerOnboarding } from "@/components/solcameo/InfluencerOnboarding";
import { AgentCreationGate } from "@/components/agents/agent-creation-gate";

import { inferAgentTypeFromPrompt } from "@/lib/builder/agentIntent";
import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowUp,
  Loader2,
  Zap,
  Plus,
  GitBranch,
  Workflow,
  ImageIcon,
  Paperclip,
  ImagePlus,
  Images,
  UploadCloud,
  Sparkles,
  Search,
  CornerDownLeft,
  ChevronDown,
  Check,
  PanelLeftClose,
  MessageCircle,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
// The modal context is the Privy shim (providers/wallet-provider.tsx): setVisible(true)
// opens the Privy login (Google + Solana wallet), not the old adapter modal.
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { PublicKey } from "@solana/web3.js";
import { sendFundingTransfer, confirmSignature, fetchWalletBalances, recommendFundingUsdc, type FundToken } from "@/lib/solana/fundWallet";
import { getTxExplorerUrl, getNetworkLabel, getUsdcFaucetUrl } from "@/lib/solana/network";

import { BUILDER_LOCAL_GOAL_PREVIEW_ID } from "@/lib/builder/builderCanvasConstants";
import type { IntelligentNode } from "@/lib/builder/intelligentNode";
import MindmapCanvas from "@/components/builder/MindmapCanvas";
import AgentWorkspace from "@/components/builder/AgentWorkspace";
import { useClippingStore, type ClipChatOp } from "@/components/builder/clipping-flow/store/clipping-store";
import { ClipperWalkthrough } from "@/components/builder/clipping-flow/ClipperWalkthrough";
import BuilderResultDrawer from "@/components/builder/BuilderResultDrawer";
import BuilderMcpPanel from "@/components/builder/BuilderMcpPanel";
import type { ToolCallAction } from "@/components/builder/BuilderMcpPanel";
import AvatarGifPlayer from "@/components/builder/AvatarGifPlayer";
import NftMintCard from "@/components/builder/NftMintCard";
import { LowBalanceBanner } from "@/components/billing/LowBalanceBanner";
import { BuilderAccount } from "@/components/builder/BuilderAccount";
import ClipJobProgress from "@/components/builder/ClipJobProgress";
import ClipRunNarrator from "@/components/builder/ClipRunNarrator";
import { uploadMediaFile } from "@/lib/client/uploadMedia";
import MintOverlay from "@/components/builder/MintOverlay";
import NewAgentEntry from "@/components/builder/onboarding/NewAgentEntry";
import { hasClipModule, CLIP_MODULE_SKILLS } from "@/lib/builder/clipPhase";
import MintCelebration from "@/components/builder/MintCelebration";
import type { CampaignBlueprint, ClientAction } from "@/lib/builder/campaignBlueprint";
import type { BuilderAgentChain } from "@/lib/builder/builderAgentChain";
import type { AgentType, AgentBlueprint, BuilderPhase } from "@/lib/builder/agentTypes";
import { getPhaseLabel, DEFAULT_REVENUE_SPLIT, STANDARD_VIDEO_LENGTHS, VIDEO_ENGINES } from "@/lib/builder/agentTypes";
import { resolvePersistedAgentType } from "@/lib/builder/resolve-agent-type";
import { deriveVideoDirectorIntent } from "@/lib/builder/videoDirector";
import { classifyChatTurn, mergeBullet, referenceBullet } from "@/lib/builder/secondBrain";
import { estimateDailyBurn, SKILLS_CATALOG_V1 } from "@/lib/builder/skillsCatalog";
import { evaluateCampaignEligibility } from "@/lib/builder/campaignEligibility";
import { isJoinableCampaign, isJoinableUgcCampaign } from "@/lib/campaignLifecycle";
import { generateAgentSkills, DEFAULT_SKILLS } from "@/lib/builder/agentSkills";
import type { SkillDef } from "@/lib/builder/agentSkills";
import { parseScriptDirective } from "@/lib/builder/scriptDirective";
import { parseDataUrlRef } from "@/lib/dataUrlRef";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import type { Doc, Id } from "@/convex/_generated/dataModel";

/** Slim, JSON-safe snapshot for API (avoids stringify failures). */
function sanitizeCanvasNodesForChat(nodes: IntelligentNode[]) {
  return nodes
    .filter((n) => n.id !== BUILDER_LOCAL_GOAL_PREVIEW_ID)
    .map((n) => ({
      id: String(n.id),
      label: n.label ?? "",
      category: n.category,
      description: typeof n.description === "string" ? n.description : "",
      status: n.status ?? "pending",
      sourceImageUrl: typeof n.sourceImageUrl === "string" ? n.sourceImageUrl : "",
      sourceCoverImageUrl: typeof n.sourceCoverImageUrl === "string" ? n.sourceCoverImageUrl : "",
      sourceProfileImageUrl: typeof n.sourceProfileImageUrl === "string" ? n.sourceProfileImageUrl : "",
      sourceUrl: typeof n.sourceUrl === "string" ? n.sourceUrl : "",
      x: typeof n.x === "number" && Number.isFinite(n.x) ? n.x : 0,
      y: typeof n.y === "number" && Number.isFinite(n.y) ? n.y : 0,
      dependencies: Array.isArray(n.dependencies) ? n.dependencies.map(String) : [],
      connectsTo: Array.isArray(n.connectsTo) ? n.connectsTo.map(String) : [],
    }));
}

interface AvatarVariant {
  label: string;
  style: string;
  prompt: string;
  url?: string | null;
}

interface Message {
  id: string;
  text: string;
  sender: "user" | "ai";
  timestamp: Date;
  imageUrl?: string;
  avatars?: AvatarVariant[];
  isGeneratingAvatars?: boolean;
  /** Label for the inline progress bar — defaults to the NFT copy when unset. */
  generatingLabel?: string;
  needsAvatarConfirm?: boolean;
  needsMint?: boolean;
  nftAvatarUrls?: string[];
  needsAvatarChoice?: boolean; // mint vs regenerate after 1-image preview
  needsAestheticChoice?: boolean; // trader: choose describe vs upload before image gen
  needsImageUpload?: boolean; // influencer: prompt user to upload reference photo(s)
  clipProgress?: boolean; // clipping: render the live ClipJobProgress monitor inline
  needsClipInstall?: string; // clipping: module not installed — value is the pending sourceUrl
  gifUrl?: string; // server-hosted animated GIF (Supabase) — used for reliable download
  videoScriptCard?: VideoScriptCardData; // influencer: script preview + confirm-to-render card
  videoUrl?: string;   // a finished generated video rendered inline in chat
  posterUrl?: string;  // storyboard image used as the <video> poster
  fundCard?: FundCardData; // influencer: in-chat agent-wallet funding card
  explorerUrl?: string; // mint success: clickable Solana explorer link to the real NFT
}

/** A transcript-friendly string for any chat message. Card / image / video-only
 *  turns carry empty `text`; without a synthesized label they'd be dropped from
 *  the admin conversation view and the thread would look one-sided. This keeps
 *  every user AND assistant turn in the mirrored transcript, in order. */
function summarizeMessageForTranscript(m: Message): string {
  const t = (m.text ?? "").trim();
  if (t) return t;
  if (m.videoScriptCard) {
    const hook = m.videoScriptCard.hook?.trim();
    return hook ? `[Video script] ${hook}` : "[Video script preview]";
  }
  if (m.fundCard) {
    const amt = m.fundCard.amount ? `${m.fundCard.amount} ` : "";
    return `[Funding request: ${amt}${m.fundCard.token}]`;
  }
  if (m.videoUrl) return "[Generated video]";
  if (m.gifUrl) return "[Animated GIF]";
  if (m.nftAvatarUrls?.length) return "[NFT avatar preview]";
  if (m.avatars?.length) return "[Generated avatar options]";
  if (m.imageUrl) return "[Image]";
  if (m.isGeneratingAvatars) return "[Generating avatar…]";
  if (m.clipProgress) return "[Clip render in progress]";
  if (m.needsAvatarConfirm || m.needsAvatarChoice) return "[Avatar preview — awaiting choice]";
  if (m.needsMint) return "[Mint prompt]";
  if (m.needsImageUpload) return "[Requested a reference photo upload]";
  if (m.needsAestheticChoice) return "[Aesthetic choice prompt]";
  if (m.needsClipInstall) return "[Clip module install prompt]";
  if (m.explorerUrl) return "[Mint successful]";
  return m.sender === "user" ? "[Message]" : "[Card]";
}

interface FundCardData {
  amount?: number;       // explicit amount the operator asked for (else recommended)
  token: FundToken;      // "USDC" | "SOL"
}

interface VideoScriptCardData {
  topic: string;
  hook: string;
  script: string;
  caption: string;
  raw: Record<string, unknown>;
  engineLabel: string;
  maxClipSeconds: number;
  estSeconds: number;   // model estimate of spoken length
  clipCount: number;    // clips needed at estSeconds on this engine
  /** The bible video style this script was written for (pinned into the render). */
  styleId?: string;
  styleName?: string;
}

type CanvasAction = {
  type: "ADD_NODE" | "UPDATE_NODE" | "DELETE_NODE" | "CONNECT_NODES" | "CLEAR_CANVAS";
  payload: Record<string, unknown>;
};

const AI_MULTI_BUBBLE_DELAY_MS = 240;

type PersistedBuilderSession = {
  messages: Array<{
    id: string;
    text: string;
    sender: "user" | "ai";
    timestamp: string;
    imageUrl?: string;
    avatars?: AvatarVariant[];
    isGeneratingAvatars?: boolean;
    needsAvatarConfirm?: boolean;
    needsMint?: boolean;
    nftAvatarUrls?: string[];
    needsAvatarChoice?: boolean;
    gifUrl?: string;
  }>;
  nodes: IntelligentNode[];
  projectName: string;
  clientActions: ClientAction[];
  campaignBlueprint: CampaignBlueprint;
  agentChain: BuilderAgentChain | null;
  websiteTitle: string;
  // The full agent blueprint — persona, installedSkills, and crucially the mint
  // fields (mintCompleted/mintAddress) — so a refresh never reverts a minted
  // agent back to its pre-mint state.
  agentBlueprint?: AgentBlueprint;
};

/**
 * Apply a server-returned blueprint without ever "un-minting" an agent. Once
 * mintCompleted is true locally, a later response that lacks the mint fields
 * (e.g. an AI-chat error fallback) can no longer wipe them — mint state is
 * sticky. This is the permanent guard against the "acts like I didn't mint" bug.
 */
function withStickyMint(prev: AgentBlueprint | undefined, next: AgentBlueprint): AgentBlueprint {
  // mintCompleted / mintAddress are ON-CHAIN truths set ONLY by the real mint
  // (handleMintComplete) or a DB-resume — NEVER by the AI-echoed blueprint. The
  // chat model (Haiku) routinely hallucinates "minted" and would otherwise flip
  // the UI to "Live on Solana" with no real mint and no DB row. Strip them from
  // the incoming blueprint, then re-apply from prev if the agent was genuinely
  // already minted.
  const { mintCompleted: _mc, mintAddress: _ma, ...cleanNext } = next;
  void _mc; void _ma;
  // installedSkills are managed by the Marketplace/Library + persisted — the
  // AI-echoed blueprint routinely returns an EMPTY/partial set and would clobber
  // them (silently disabling campaigns + auto-post, which autosave then persists).
  // Keep the incoming list only when it's non-empty; otherwise preserve prev's.
  const nextSkills = (cleanNext as AgentBlueprint).installedSkills;
  const stickySkills = Array.isArray(nextSkills) && nextSkills.length > 0
    ? nextSkills
    : (prev?.installedSkills ?? nextSkills);
  const merged = { ...cleanNext, installedSkills: stickySkills } as AgentBlueprint;
  if (prev?.mintCompleted) {
    return {
      ...merged,
      mintCompleted: true,
      mintAddress: prev.mintAddress,
      agentStatus: merged.agentStatus ?? prev.agentStatus,
    } as AgentBlueprint;
  }
  return merged;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Downscale + re-encode an image data URL to a bounded-size JPEG via canvas.
 * Full-res phone photos are several MB each; sending 3 of them as base64 in one
 * JSON body blew past the request-size limit on /api/generate-nft-images — the
 * body arrived TRUNCATED, so `req.json()` threw "Unterminated string in JSON …"
 * → 500 → "Avatar generation failed". Capping every reference to ~1280px JPEG
 * keeps each one a few hundred KB so the whole payload stays small. Also transcodes
 * webp/heic/avif, which nano-banana-pro rejects. Returns the original on any
 * failure (never blocks the upload). Non-data-URL / non-raster inputs pass through.
 */
async function compressImageDataUrl(dataUrl: string, maxDim = 1280, quality = 0.9): Promise<string> {
  if (typeof window === "undefined" || !/^data:image\//i.test(dataUrl)) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    // Nothing to gain if it's already small AND already a jpeg — skip re-encode.
    if (scale === 1 && /^data:image\/jpe?g/i.test(dataUrl) && dataUrl.length < 900_000) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.fillStyle = "#ffffff"; // JPEG has no alpha — white matte avoids black blobs
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

// Backend/status messages (timeouts, "Kie returned…") must never re-enter the
// conversation or feed intent detection — otherwise the video-intent heuristic
// scrapes their text and fires a paid create_video the user never asked for.
function isBackendErrorText(text: string | undefined | null): boolean {
  if (!text) return false;
  return /^⚠\s*(chat backend error|kie returned)/i.test(text.trim()) ||
    /\b(check terminal logs for the full kie response|kie_api_key)\b/i.test(text);
}

function buildBuilderSessionStorageKey(sessionId: string) {
  return `vello_builder_session_${sessionId}`;
}

// The builder copilot always chats on Gemini 3.6 Flash (Google direct, Kie as
// automatic fallback — see /api/ai/chat). Generations still run on Kie.
const CHAT_MODEL = "gemini-3-6-flash-openai";

function renderTextWithBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const isBold = part.startsWith("**") && part.endsWith("**") && part.length > 4;
    if (!isBold) return <React.Fragment key={index}>{part}</React.Fragment>;
    return <strong key={index}>{part.slice(2, -2)}</strong>;
  });
}

function splitAiIntoBubbles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const byParagraph = trimmed
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (byParagraph.length > 1) return byParagraph;
  if (trimmed.length <= 260) return [trimmed];

  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return [trimmed];

  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > 240 && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function LoadingBars({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-end ${compact ? "h-3 gap-0.5" : "h-4 gap-1"}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={`block rounded-full bg-white/90 ${compact ? "w-[3px]" : "w-1"}`}
          animate={{
            height: compact ? [3, 8, 4, 7, 3] : [4, 12, 6, 10, 4],
            opacity: [0.45, 1, 0.72, 1, 0.45],
          }}
          transition={{
            duration: 1.05,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.12,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Determinate-ish progress bar for NFT image generation. The 3 nano-banana-pro
 * renders take roughly 2 minutes, so we ease the fill toward 95% over `etaSeconds`
 * and let the caller's state flip (isGeneratingAvatars → false) remove the bar
 * once the real result lands. Lime-green Duolingo-ish theme.
 */
function GenerationProgress({ etaSeconds = 120, label = "Generating your NFT…" }: { etaSeconds?: number; label?: string }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      // Approach 95% asymptotically — never claim "done" before the result arrives.
      const next = 95 * (1 - Math.exp(-elapsed / (etaSeconds / 2.5)));
      setPct(next);
    }, 200);
    return () => clearInterval(id);
  }, [etaSeconds]);

  return (
    <div className="mt-2 w-full max-w-[260px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold text-lime-300">{label}</span>
        <span className="text-[10px] tabular-nums text-white/45">{Math.round(pct)}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full border border-lime-500/20 bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-lime-400 to-green-400 shadow-[0_0_10px_rgba(163,230,53,0.5)] transition-[width] duration-200 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[9.5px] text-white/35">This usually takes about 2 minutes — keeping the same person across all 3 poses.</p>
    </div>
  );
}

function applyCanvasActions(prev: IntelligentNode[], actions: CanvasAction[]): IntelligentNode[] {
  let next = [...prev];

  for (const action of actions) {
    switch (action.type) {
      case "ADD_NODE": {
        const node = action.payload?.node as IntelligentNode | undefined;
        if (node?.id && !next.some((p) => p.id === node.id)) {
          next = [...next, node];
        }
        break;
      }
      case "UPDATE_NODE": {
        const id = action.payload?.id as string | undefined;
        const updates = action.payload?.updates as Partial<IntelligentNode> | undefined;
        if (id && updates) {
          next = next.map((n) => (n.id === id ? { ...n, ...updates } : n));
        }
        break;
      }
      case "DELETE_NODE": {
        const id = action.payload?.id as string | undefined;
        if (id) next = next.filter((n) => n.id !== id);
        break;
      }
      case "CONNECT_NODES": {
        const fromId = action.payload?.fromId as string | undefined;
        const toId = action.payload?.toId as string | undefined;
        if (fromId && toId) {
          next = next.map((n) => {
            if (n.id === fromId) {
              const connectsTo = n.connectsTo || [];
              if (!connectsTo.includes(toId)) {
                return { ...n, connectsTo: [...connectsTo, toId] };
              }
            }
            if (n.id === toId) {
              const dependencies = n.dependencies || [];
              if (!dependencies.includes(fromId)) {
                return { ...n, dependencies: [...dependencies, fromId] };
              }
            }
            return n;
          });
        }
        break;
      }
      case "CLEAR_CANVAS":
        next = [];
        break;
      default:
        break;
    }
  }

  return next;
}

// ─── Aesthetic choice card — inline describe vs upload selector ──────────────

function AestheticChoiceCard({
  agentName,
  onPickPhoto,
  onGenerate,
  disabled,
}: {
  agentName: string;
  // Fired with the file-input change event when the operator picks a reference
  // photo. Wired to the SAME handler the composer paperclip uses so the uploaded
  // image flows into avatar generation as a reference.
  onPickPhoto: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onGenerate: (description: string) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = React.useState<"choice" | "describe">("choice");
  const [desc, setDesc] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  // The card owns its OWN always-enabled file input. It used to reach for the
  // distant composer input via a shared ref — but that input isn't rendered for
  // every agent type and is `disabled` once a reference already exists, so
  // clicking "Upload a photo" silently did nothing (a disabled input's .click()
  // is a no-op). Owning the input here makes the picker open reliably, right
  // inside the click gesture, regardless of the composer's state.
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (mode === "describe") setTimeout(() => textareaRef.current?.focus(), 80);
  }, [mode]);

  if (disabled) return null;

  if (mode === "choice") {
    return (
      <div className="mt-2.5 space-y-2">
        <p className="text-[11.5px] text-white/60">How should <span className="text-white/85 font-semibold">{agentName}</span>&apos;s NFT portrait look?</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("describe")}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.10] bg-white/[0.03] hover:bg-white/[0.07] hover:border-emerald-500/40 px-3 py-3 transition-all text-left"
          >
            <span className="text-lg">✏️</span>
            <span className="text-[11.5px] font-semibold text-white/80">Describe the look</span>
            <span className="text-[10px] text-white/35 text-center leading-snug">Tell me the vibe, style, or character</span>
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.10] bg-white/[0.03] hover:bg-white/[0.07] hover:border-violet-500/40 px-3 py-3 transition-all text-left"
          >
            <span className="text-lg">📷</span>
            <span className="text-[11.5px] font-semibold text-white/80">Upload a photo</span>
            <span className="text-[10px] text-white/35 text-center leading-snug">Match a reference image exactly</span>
          </button>
        </div>
        {/* Card-owned hidden input (sr-only, always enabled). Placed last so it
            never affects the visible layout; clicked synchronously from the
            "Upload a photo" button above so the file picker opens in-gesture. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onPickPhoto}
        />
      </div>
    );
  }

  return (
    <div className="mt-2.5 space-y-2">
      <p className="text-[11px] text-white/50">Describe <span className="text-white/70">{agentName}</span>&apos;s visual style:</p>
      <textarea
        ref={textareaRef}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder={`e.g. "glowing neon wolf, dark city background, cyberpunk style, green eyes" — or "sleek robotic fox in a suit, minimal, dark theme"`}
        className="w-full bg-white/[0.04] border border-white/[0.10] focus:border-emerald-500/50 rounded-xl p-3 text-[12px] text-white/80 placeholder-white/20 resize-none outline-none transition-colors leading-relaxed"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && desc.trim().length >= 5) {
            onGenerate(desc.trim());
          }
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setMode("choice"); setDesc(""); }}
          className="text-[11px] text-white/30 hover:text-white/60 transition-colors px-1"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={() => { if (desc.trim().length >= 5) onGenerate(desc.trim()); }}
          disabled={desc.trim().length < 5}
          className="flex-1 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-black font-semibold text-[12px] rounded-xl py-2 transition-all"
        >
          {desc.trim().length < 5 ? "Describe first…" : "Generate NFT Portrait →"}
        </button>
      </div>
      <p className="text-[10px] text-white/20 text-center">⌘+Enter to generate</p>
    </div>
  );
}

// ─── Reference-photo upload prompt — gives the user an obvious button to upload ──
// Shown when the influencer flow is asking for reference photos so the user
// never has to hunt for the small icon by the chat input.
/** Small illustrated dropzone hint — 2 overlapping photo cards behind a
 *  pulsing "+" badge, floating gently. Purely decorative (the click target is
 *  the whole button below it), but gives the upload step an obvious "this is
 *  a thing to click, and this is what it does" read instead of a bare icon. */
function UploadIllustration({ ready }: { ready: boolean }) {
  return (
    <motion.div
      animate={{ y: [0, -3, 0] }}
      transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      className="relative flex items-center justify-center"
    >
      <div className="relative size-14">
        <div className="absolute left-0 top-1.5 size-10 -rotate-6 rounded-lg border border-lime-400/25 bg-lime-500/[0.08]" />
        <div className="absolute right-0 top-1.5 size-10 rotate-6 rounded-lg border border-lime-400/25 bg-lime-500/[0.08]" />
        <div className="absolute inset-x-2 top-0 flex size-10 items-center justify-center rounded-lg border border-lime-400/40 bg-lime-500/[0.14] shadow-[0_4px_16px_-4px_rgba(163,230,53,0.35)]">
          {ready ? <ImagePlus className="size-4.5 text-lime-300" /> : <Images className="size-4.5 text-lime-300" />}
        </div>
      </div>
      {!ready && (
        <motion.span
          animate={{ scale: [1, 1.35, 1], opacity: [0.9, 0, 0.9] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-lime-400"
        >
          <Plus className="size-3 text-lime-950" strokeWidth={3} />
        </motion.span>
      )}
    </motion.div>
  );
}

function ImageUploadPrompt({
  count,
  target = 3,
  onUpload,
  onCreate,
}: {
  count: number;
  target?: number;
  onUpload: () => void;
  onCreate: () => void;
}) {
  const remaining = Math.max(0, target - count);
  const ready = count > 0;
  return (
    <div className="mt-2.5 space-y-2">
      <motion.button
        type="button"
        onClick={onUpload}
        whileHover={{ scale: 1.015 }}
        whileTap={{ scale: 0.985 }}
        className="group relative flex w-full flex-col items-center gap-2 overflow-hidden rounded-2xl border border-dashed border-lime-500/40 bg-gradient-to-b from-lime-500/[0.1] to-lime-500/[0.02] px-4 py-5 transition-colors hover:border-lime-400/70 hover:from-lime-500/[0.16]"
      >
        {/* Faint animated shine sweep — reinforces "clickable" without a static border alone */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(115deg, transparent 35%, rgba(163,230,53,0.16) 50%, transparent 65%)", backgroundSize: "220% 100%" }}
          animate={{ backgroundPosition: ["130% 0%", "-130% 0%"] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
        />
        <UploadIllustration ready={ready} />
        <span className="relative flex items-center gap-1.5 text-[12.5px] font-semibold text-white/90">
          <UploadCloud className="size-3.5 text-lime-300/80" />
          {ready ? "Click to add another photo" : "Click here to upload a photo"}
        </span>
        <span className="relative text-[10.5px] text-white/40 text-center leading-snug">
          {ready
            ? `${count}/${target} added${remaining > 0 ? ` · ${remaining} more for best results` : ""}`
            : "1 to 3 clear photos of the same person — front-facing works best"}
        </span>
      </motion.button>
      {ready && (
        <motion.button
          type="button"
          onClick={onCreate}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98, y: 2 }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-lime-400 hover:bg-lime-300 text-lime-950 font-bold text-[12px] py-2.5 shadow-[0_4px_0_0_#3f6212] transition-colors"
        >
          <Sparkles className="size-3.5" />
          Create ID with {count} photo{count === 1 ? "" : "s"}
        </motion.button>
      )}
    </div>
  );
}

// Script-first video confirm card — shows the written script + estimate and
// gates the (paid) render behind an explicit Generate tap.
function VideoScriptCard({
  data, selectedSeconds, status, rewriting, onLength, onGenerate, onEdit, onCancel,
}: {
  data: VideoScriptCardData;
  selectedSeconds: number;
  status: "idle" | "rendering" | "done" | "failed" | "cancelled";
  rewriting?: boolean;
  onLength: (seconds: number) => void;
  onGenerate: (seconds: number) => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  // Veo-aligned lengths (multiples of the 8s clip) so each pick is an exact clip count.
  const lengths = [...STANDARD_VIDEO_LENGTHS];
  const clipsAt = (s: number) => Math.ceil(s / data.maxClipSeconds);
  const words = data.script.trim().split(/\s+/).filter(Boolean).length;
  const clips = clipsAt(selectedSeconds);
  // `busy` blocks all controls during render; `locked` also blocks while the
  // script is being rewritten to match a newly-picked length.
  const busy = status === "rendering";
  const locked = busy || !!rewriting;
  const finished = status === "done" || status === "cancelled";
  return (
    <div className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.04] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.08] bg-white/[0.03]">
        <span className="text-[13px]">🎬</span>
        <span className="text-[12px] font-semibold text-white/85 truncate">Script ready — “{data.topic}”</span>
        {data.styleName && (
          <span className="ml-auto shrink-0 rounded-full border border-lime-400/40 bg-lime-400/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-lime-300" title="Show-bible video style driving this render">
            {data.styleName}
          </span>
        )}
      </div>
      <div className="px-3 py-2.5 space-y-2">
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-white/35">Hook</p>
          <p className="text-[12px] text-white/90 leading-snug">{data.hook}</p>
        </div>
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-white/35">Script · {words}w</p>
          <p className="text-[11.5px] text-white/75 leading-relaxed whitespace-pre-wrap">{data.script}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-white/50">
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5">~{selectedSeconds}s</span>
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5">{clips} clip{clips === 1 ? "" : "s"} on {data.engineLabel}</span>
          {clips > 1 && <span className="text-amber-300/80">stitched ({data.maxClipSeconds}s/clip)</span>}
        </div>
        {/* Length override chips */}
        {!finished && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-white/35">Length</span>
            {lengths.map((s) => (
              <button
                key={s}
                type="button"
                disabled={locked}
                onClick={() => onLength(s)}
                className={`rounded-md px-2 py-0.5 text-[10.5px] font-medium transition-colors disabled:opacity-40 ${selectedSeconds === s ? "bg-lime-400 text-lime-950" : "bg-white/[0.06] text-white/60 hover:text-white/90"}`}
              >
                {s}s
              </button>
            ))}
            {rewriting && <span className="text-[9.5px] text-lime-300/70 animate-pulse">✍️ rewriting for {selectedSeconds}s…</span>}
          </div>
        )}
        {/* Actions */}
        {!finished && (
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              disabled={locked}
              onClick={() => onGenerate(selectedSeconds)}
              className="flex items-center gap-1.5 rounded-lg bg-lime-400 hover:bg-lime-300 disabled:opacity-50 text-lime-950 font-bold text-[11.5px] px-3.5 py-1.5 transition-colors"
            >
              {busy ? <LoadingBars compact /> : "▶"} {busy ? "Rendering…" : "Generate video"}
            </button>
            <button type="button" disabled={locked} onClick={onEdit} className="rounded-lg border border-white/[0.10] text-white/60 hover:text-white/90 text-[11.5px] px-2.5 py-1.5 transition-colors disabled:opacity-40">✎ Edit</button>
            <button type="button" disabled={locked} onClick={onCancel} className="rounded-lg text-white/35 hover:text-white/70 text-[11.5px] px-2 py-1.5 transition-colors disabled:opacity-40">✕</button>
          </div>
        )}
        {status === "done" && <p className="text-[10.5px] text-lime-300/70 pt-0.5">Rendering started — the video lands here when ready.</p>}
        {status === "cancelled" && <p className="text-[10.5px] text-white/30 pt-0.5">Cancelled.</p>}
      </div>
    </div>
  );
}

// In-chat agent-wallet funding card. The operator's wallet signs the transfer to
// the agent's on-chain wallet — agentic in that the agent prepares the recipient
// + a recommended amount; the operator just approves the signature.
function FundWalletCard({ data, agentWallet, agentName, dailyBurn }: {
  data: FundCardData;
  agentWallet?: string;
  agentName: string;
  dailyBurn: number;
}) {
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const { connection } = useConnection();
  const [token, setToken] = useState<FundToken>(data.token);
  const [amount, setAmount] = useState<string>(data.amount ? String(data.amount) : "");
  const [step, setStep] = useState<"idle" | "approving" | "confirming" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const [opBal, setOpBal] = useState<{ sol: number; usdc: number } | null>(null);
  const [agentBal, setAgentBal] = useState<{ sol: number; usdc: number } | null>(null);
  const [recommended, setRecommended] = useState<number | null>(null);

  // Fetch operator + agent balances; if no explicit amount, recommend one (algo).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (publicKey) {
          const b = await fetchWalletBalances(connection, publicKey);
          if (!cancelled) setOpBal(b);
        }
        if (agentWallet) {
          const b = await fetchWalletBalances(connection, new PublicKey(agentWallet));
          if (cancelled) return;
          setAgentBal(b);
          if (!data.amount && token === "USDC") {
            const rec = recommendFundingUsdc(dailyBurn, b.usdc);
            setRecommended(rec);
            setAmount((prev) => prev || String(rec));
          }
        }
      } catch { /* ignore — card still usable */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentWallet, publicKey]);

  const presets = token === "USDC" ? [10, 25, 50, 100] : [0.05, 0.1, 0.25, 0.5];
  const isBusy = step === "approving" || step === "confirming";
  const num = parseFloat(amount);
  const needFaucet = token === "USDC" && getUsdcFaucetUrl() && opBal !== null && opBal.usdc < 1;

  const confirm = async () => {
    console.info("[fund-card] confirm clicked", { token, amount, num, hasPublicKey: !!publicKey, hasSignTx: !!signTransaction, agentWallet });
    if (!publicKey || !signTransaction) { setErrorMsg("Connect your wallet first."); setStep("error"); return; }
    if (!agentWallet) { setErrorMsg("Agent wallet not ready yet — try again in a moment."); setStep("error"); return; }
    if (!num || num <= 0) { setErrorMsg("Enter a positive amount."); setStep("error"); return; }
    if (opBal) {
      if (token === "USDC" && num > opBal.usdc) { setErrorMsg(`Insufficient USDC — you have $${opBal.usdc.toFixed(2)}.`); setStep("error"); return; }
      if (token === "SOL" && num > opBal.sol - 0.005) { setErrorMsg(`Insufficient SOL — you have ${opBal.sol.toFixed(4)} (need fees too).`); setStep("error"); return; }
    }
    setStep("approving"); setErrorMsg("");
    try {
      const { sig } = await sendFundingTransfer({ connection, publicKey, signTransaction, agentWallet, token, amount: num });
      setTxSig(sig); setStep("confirming");
      // Poll over HTTP instead of the flaky websocket confirmTransaction — never hangs.
      const status = await confirmSignature(connection, sig);
      if (status !== "confirmed") {
        // Submitted but never confirmed — DON'T fake a success. Surface the tx so
        // the operator can inspect it (this is the "signed but no deposit" case).
        setErrorMsg("Transaction submitted but not confirmed — open it on the explorer to check. If it failed on-chain, you likely need a little more devnet SOL for fees, then retry.");
        setStep("error");
        return;
      }
      setStep("done");
      // Refresh balances so the new agent balance shows immediately.
      void (async () => {
        try {
          if (publicKey) setOpBal(await fetchWalletBalances(connection, publicKey));
          if (agentWallet) setAgentBal(await fetchWalletBalances(connection, new PublicKey(agentWallet)));
        } catch { /* non-fatal */ }
      })();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transfer failed";
      console.error("[fund-card] transfer failed", e);
      // ONLY a genuine wallet rejection resets quietly. Everything else (broadcast
      // or on-chain failure) MUST be shown — never swallow a real failure as
      // "nothing happened" (the old /reject|cancel/ regex was too broad).
      if (/user rejected|user denied|rejected the request|request.*reject/i.test(msg)) { setStep("idle"); return; }
      setErrorMsg(msg); setStep("error");
    }
  };

  const shortAddr = agentWallet ? `${agentWallet.slice(0, 6)}…${agentWallet.slice(-6)}` : "setting up…";

  return (
    <div className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.04] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.08] bg-white/[0.03]">
        <span className="text-[12px] font-semibold text-white/85">💸 Fund {agentName}</span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/35">{getNetworkLabel()}</span>
      </div>
      <div className="px-3 py-2.5 space-y-2.5">
        {step === "done" ? (
          <div className="space-y-1">
            <p className="text-[12px] text-emerald-300 font-medium">✅ Sent {num} {token} to {agentName}&apos;s wallet.</p>
            {txSig && (
              <a href={getTxExplorerUrl(txSig)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10.5px] text-sky-300 hover:underline">
                View transaction ↗
              </a>
            )}
          </div>
        ) : (
          <>
            {/* Token toggle */}
            <div className="flex items-center gap-1.5">
              {(["USDC", "SOL"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={isBusy}
                  onClick={() => { setToken(t); setStep("idle"); }}
                  className={`rounded-md px-2.5 py-0.5 text-[10.5px] font-semibold transition-colors disabled:opacity-40 ${token === t ? "bg-lime-400 text-lime-950" : "bg-white/[0.06] text-white/60 hover:text-white/90"}`}
                >
                  {t}
                </button>
              ))}
              {recommended != null && !data.amount && (
                <span className="ml-auto text-[10px] text-white/45">
                  Recommended <button type="button" onClick={() => setAmount(String(recommended))} className="text-lime-300 hover:underline">${recommended}</button> · ~30d at ${dailyBurn.toFixed(2)}/day
                </span>
              )}
            </div>
            {/* Amount */}
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.10] bg-white/[0.03] px-2.5 py-1.5">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={token === "USDC" ? 5 : 0.05}
                value={amount}
                disabled={isBusy}
                onChange={(e) => setAmount(e.target.value)}
                aria-label={`Amount in ${token}`}
                className="flex-1 min-w-0 bg-transparent outline-none text-[15px] font-bold tabular-nums text-white/90 placeholder-white/25"
                placeholder="0"
              />
              <span className="text-[11px] font-mono text-white/40 shrink-0">{token}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={isBusy}
                  onClick={() => setAmount(String(p))}
                  className={`rounded-md px-2 py-0.5 text-[10.5px] font-medium transition-colors disabled:opacity-40 ${amount === String(p) ? "bg-white/20 text-white" : "bg-white/[0.06] text-white/55 hover:text-white/90"}`}
                >
                  {token === "USDC" ? `$${p}` : p}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between text-[10px] text-white/45">
              <span className="font-mono truncate" title={agentWallet}>→ {shortAddr}</span>
              <span className="tabular-nums">{agentBal ? `bal $${agentBal.usdc.toFixed(2)} · ${agentBal.sol.toFixed(3)} SOL` : ""}</span>
            </div>
            {publicKey && (
              <p className="text-[10px] text-white/40">
                Paying from <span className="font-mono text-white/55" title={publicKey.toBase58()}>{publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}</span>
                {opBal && <> · ${opBal.usdc.toFixed(2)} USDC · {opBal.sol.toFixed(4)} SOL</>}
              </p>
            )}
            {needFaucet && (
              <a href={getUsdcFaucetUrl() ?? "#"} target="_blank" rel="noopener noreferrer" className="inline-block text-[10.5px] text-amber-300 hover:underline">
                No test USDC — mint free {getNetworkLabel()} USDC at Circle&apos;s faucet ↗
              </a>
            )}
            {step === "error" && errorMsg && (
              <div className="space-y-1">
                <p className="text-[11px] text-rose-300">⚠ {errorMsg}</p>
                {txSig && (
                  <a href={getTxExplorerUrl(txSig)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10.5px] text-sky-300 hover:underline">
                    View transaction ↗
                  </a>
                )}
              </div>
            )}
            {publicKey && !agentWallet && <p className="text-[11px] text-amber-300">⏳ Setting up the agent wallet — it appears in a few seconds.</p>}
            {publicKey && agentWallet && !(num > 0) && <p className="text-[11px] text-amber-300">Enter an amount above.</p>}
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={isBusy || !publicKey || !agentWallet || !(num > 0)}
              className="flex items-center gap-1.5 rounded-lg bg-lime-400 hover:bg-lime-300 disabled:opacity-50 text-lime-950 font-bold text-[11.5px] px-3.5 py-1.5 transition-colors"
            >
              {!publicKey ? "Connect wallet to fund"
                : step === "approving" ? <><LoadingBars compact /> Confirm in wallet…</>
                : step === "confirming" ? <><LoadingBars compact /> Confirming…</>
                : `Confirm & send ${num > 0 ? `${num} ${token}` : token}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * BUILDER ENTRANCE STORYBOARD
 *
 * Each section slides DOWN into place, one after another, on a
 * slow soft spring so the workspace feels like it unfolds. The
 * top-bar tool buttons are held back until the unfold finishes.
 *
 *    0ms   blank — sections not yet visible
 *  120ms   top bar slides down (soft, slow)
 *  460ms   chat panel slides down
 *  820ms   canvas fades in (no transform — has fixed children)
 * 1300ms   top-bar tool buttons fade in last
 * ───────────────────────────────────────────────────────── */
const BUILDER_TIMING = {
  bar:    120,   // ms — top bar
  chat:   460,   // ms — left column
  canvas: 820,   // ms — center column
  tools:  1300,  // ms — header tool buttons appear last
};
// Soft, slow spring → a gentle "settle" rather than a snap.
const BUILDER_SPRING = { type: "spring" as const, stiffness: 150, damping: 24, mass: 1 };
const BUILDER_BAR = { offsetY: -18, spring: BUILDER_SPRING };
const BUILDER_CHAT = { offsetY: -24, spring: BUILDER_SPRING };

/* ── Apple-Spotlight-style command search ──────────────────────────────────
   A wide, glowing search field in the top bar. Focus (or ⌘K) opens a suggested
   panel of pages + builder actions; typing filters and highlights matches; a
   spring-driven pill slides between rows; Enter runs the active one. */
type SpotAction = {
  id: string;
  label: string;
  group: string;
  icon?: React.ComponentType<{ className?: string }>;
  run: () => void;
};

function highlightMatch(text: string, q: string): React.ReactNode {
  const query = q.trim();
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent font-semibold text-emerald-300">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function SpotlightSearch({ actions }: { actions: SpotAction[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? actions.filter((a) => a.label.toLowerCase().includes(q) || a.group.toLowerCase().includes(q))
      : actions;
    return list.slice(0, 8);
  }, [query, actions]);

  useEffect(() => { setActive(0); }, [query, open]);

  // ⌘K / Ctrl+K focuses the field from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (a?: SpotAction) => {
    const target = a ?? results[active];
    if (!target) return;
    target.run();
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(); }
    else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  };

  return (
    <div className="relative mx-4 hidden max-w-xl flex-1 md:mx-8 lg:block">
      <div
        className={`group relative flex h-8 items-center gap-2 rounded-[6px] border px-2.5 transition-all duration-200 ${
          open
            ? "border-white/30 bg-[#16181c] shadow-[0_0_0_3px_rgba(255,255,255,0.05),0_18px_40px_-14px_rgba(0,0,0,0.8)]"
            : "border-white/[0.09] bg-[#111316] hover:border-white/20"
        }`}
      >
        <Search className={`size-3.5 transition-colors ${open ? "text-white/85" : "text-white/40"}`} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setOpen(true); }}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
          onKeyDown={onKeyDown}
          placeholder="Search pages, actions, tools…"
          className="w-full bg-transparent text-[12.5px] text-white/90 outline-none placeholder-white/35"
        />
        <kbd className="hidden items-center rounded-[4px] border border-white/10 bg-white/[0.04] px-1.5 py-px text-[10px] font-medium text-white/40 md:flex">⌘K</kbd>
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[8px] border border-white/10 bg-[#121417]/95 p-1 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">Suggestions</p>
            {results.map((r, i) => {
              const Icon = r.icon;
              const isActive = i === active;
              return (
                <button
                  key={r.id}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); run(r); }}
                  className="relative flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 text-left"
                >
                  {isActive && (
                    <motion.span
                      layoutId="spotlight-active"
                      className="absolute inset-0 rounded-[5px] bg-white/[0.09] ring-1 ring-white/10"
                      transition={{ type: "spring", stiffness: 520, damping: 40 }}
                    />
                  )}
                  {Icon && <Icon className={`relative size-4 shrink-0 ${isActive ? "text-emerald-300" : "text-white/45"}`} />}
                  <span className="relative flex-1 truncate text-[13px] text-white/85">{highlightMatch(r.label, query)}</span>
                  <span className="relative text-[10px] uppercase tracking-wide text-white/30">{r.group}</span>
                  {isActive && <CornerDownLeft className="relative size-3 text-white/40" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const AGENT_VERTICALS: { type: "influencer" | "clipping" | "trader" | "worker"; label: string; icon: string }[] = [
  { type: "influencer", label: "Creator Agent", icon: "🎬" },
  { type: "clipping", label: "Shorts Agent", icon: "✂️" },
];

/**
 * The vertical label in the chat header, upgraded to a switcher: pick a different
 * agent type and we hard-navigate to a fresh builder of that type. (Switching
 * vertical means a different agent, so a clean start is the right behavior.)
 */
function AgentTypeSwitcher({ current }: { current: AgentType }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const currentLabel = AGENT_VERTICALS.find((v) => v.type === current)?.label ?? "AI Agent";
  const switchTo = (type: string) => {
    setOpen(false);
    if (type === current) return;
    // Hard navigate so the chosen vertical initializes cleanly from scratch.
    window.location.href = `/builder?type=${type}`;
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-white/40 transition-colors hover:text-white/70"
        title="Switch agent type"
      >
        {currentLabel}
        <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-lg border border-white/10 bg-[#1c1c22] py-1 shadow-xl">
          {AGENT_VERTICALS.map((v) => (
            <button
              key={v.type}
              type="button"
              onClick={() => switchTo(v.type)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.06] ${
                v.type === current ? "text-emerald-300" : "text-white/80"
              }`}
            >
              <span className="text-[13px] leading-none">{v.icon}</span>
              <span className="flex-1 normal-case tracking-normal">{v.label}</span>
              {v.type === current && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BuilderPageInner() {
  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();

  // Mount-entrance cascade — a single integer drives the one-by-one slide-down of
  // the top bar → chat panel → canvas → tool buttons. `stage >= N` so sections
  // stay put once shown.
  const [mountStage, setMountStage] = useState(0);
  useEffect(() => {
    if (reduceMotion) { setMountStage(4); return; }
    const timers = [
      setTimeout(() => setMountStage((s) => Math.max(s, 1)), BUILDER_TIMING.bar),
      setTimeout(() => setMountStage((s) => Math.max(s, 2)), BUILDER_TIMING.chat),
      setTimeout(() => setMountStage((s) => Math.max(s, 3)), BUILDER_TIMING.canvas),
      setTimeout(() => setMountStage((s) => Math.max(s, 4)), BUILDER_TIMING.tools),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduceMotion]);
  const router = useRouter();
  const { connected: isAuthenticated, connecting: authLoading, publicKey } = useUnifiedSolanaWallet();
  // Resolved once, used by both CreditsBadge and LowBalanceBanner below (was
  // duplicated inline at each mount point).
  const ownerWallet = isAuthenticated && publicKey ? publicKey.toBase58() : null;
  const { setVisible: openWalletModal } = useWalletModal();
  const { accessToken, authenticated: sessionAuthenticated, loading: sessionLoading, getFreshToken } = useSupabaseAuth();

  const initialQuery = searchParams.get("q") || "";
  const communityId = searchParams.get("c")?.trim() || "";
  const persistedSessionId = searchParams.get("s")?.trim() || "";
  const resumeMintAddress = searchParams.get("mint")?.trim() || "";
  // Deep-link to a workspace tab on resume — see the resumeBundle effect below,
  // which forwards this to AgentWorkspace via forceWorkspaceTab once the agent
  // is minted (e.g. /builder?mint=...&tab=schedule from /home's Recent Clips).
  const tabParam = searchParams.get("tab")?.trim() || "";
  // Stage content-reward handoff ("Create with AI" on a clipping content_reward):
  // /builder?type=clipping&reward=<supabase content_rewards.id>. Seeds the clipper
  // canvas with the reward's resolved videos + tags the Source with contentRewardId.
  // type=clipping is set alongside, so hasExplicitType is already true (no need to
  // add this to hasInboundContext).
  const rewardParam = searchParams.get("reward")?.trim() || "";
  const rawTypeParam = searchParams.get("type");
  // The landing hero labels the clipping vertical "clipper"; the canonical agent
  // type is "clipping". Accept both so a hero handoff (?type=clipper) opens the
  // clipping workspace instead of silently falling back to influencer.
  // Vello builds two kinds of agent: Shorts (clipping) and Creator (influencer).
  // Retired trader/worker links land on the Creator builder instead.
  const typeParam = rawTypeParam === "clipper" ? "clipping"
    : rawTypeParam === "trader" || rawTypeParam === "worker" ? "influencer"
    : rawTypeParam;
  const hasExplicitType =
    typeParam === "influencer" || typeParam === "worker" || typeParam === "trader" || typeParam === "clipping";
  // The legacy "campaign" builder mode is deprecated and merged into the
  // AI Influencer vertical (influencers are the agents that join brand
  // campaigns). New + legacy entry points (marketplace handoff via ?q=,
  // community deeplink via ?c=, mint resume) now resolve to "influencer"
  // instead of "campaign". A bare /builder with no type + no inbound context
  // shows the 3-card vertical selector. Persisted campaign sessions can still
  // rehydrate as "campaign" via the resume path (see resumeBundle effect) so
  // existing saved work keeps loading until those rows are migrated.
  // The inbound prompt decides when the URL is missing a type — and a clear clip
  // job ("Clip this video: <youtube url>") overrides a stale type=influencer
  // from an older link, so it never mints an AI Influencer. Resumed agents keep
  // their persisted type (the resumeBundle effect re-syncs the URL).
  const promptIntent = inferAgentTypeFromPrompt(initialQuery);
  const forceClipping = !resumeMintAddress && promptIntent.strong && typeParam !== "clipping";
  const agentType: AgentType = forceClipping
    ? "clipping"
    : hasExplicitType ? (typeParam as AgentType) : (!resumeMintAddress && promptIntent.type) || "influencer";

  // Gate: there is NO chat without an agent. Every visit that isn't resuming a
  // minted agent (?mint=) lands on the guided setup, whatever else is in the URL
  // (?q=, ?c=, ?s=, ?type=). A queued "Clip this video: <url>" rides along: the
  // user picks an existing clipper or creates one first, then the link is sent.
  const showSetupFlow = !resumeMintAddress;
  const clipQuery = promptIntent.type === "clipping" ? initialQuery : "";
  const setupInitialType: "influencer" | "clipping" | null =
    typeParam === "clipping" || clipQuery ? "clipping" : hasExplicitType ? "influencer" : null;
  // Keep ?type= in step with the inferred type so AgentWorkspace (which reads
  // the query param) and a reload agree with what the chat is building.
  useEffect(() => {
    if (resumeMintAddress || typeParam === agentType || (!forceClipping && hasExplicitType) || !initialQuery) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("type", agentType);
    router.replace(`/builder?${params.toString()}`);
  }, [agentType, typeParam, forceClipping, hasExplicitType, initialQuery, resumeMintAddress, router, searchParams]);

  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [inputText, setInputText] = useState("");
  const chatModel = CHAT_MODEL;
  const [nodes, setNodes] = useState<IntelligentNode[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [projectName, setProjectName] = useState("Business Workflow");
  const [clientActions, setClientActions] = useState<ClientAction[]>([]);
  const [campaignBlueprint, setCampaignBlueprint] = useState<CampaignBlueprint>({});
  const [agentChain, setAgentChain] = useState<BuilderAgentChain | null>(null);
  const [websiteTitle, setWebsiteTitle] = useState("");
  const [, setIsResultDrawerOpen] = useState(false);
  const [canvasViewMode, setCanvasViewMode] = useState<"workflow" | "mindmap">("workflow");
  // Copilot chat panel collapse — same transition-[width] convention as the
  // account sidebar (components/home/app-shell.tsx AppSidebar). Starts
  // CLOSED by default (was open) — reopened via the pulsing bottom-right FAB
  // (see copilotFabBubbleShown below) rather than taking up layout space
  // until the operator asks for it. Forced open pre-mint regardless (every
  // check below is `copilotCollapsed && agentBlueprint?.mintCompleted`) —
  // before a mint exists the chat IS the only way to build the agent, so it
  // can't be hidden.
  const [copilotCollapsed, setCopilotCollapsed] = useState(true);
  // First-appearance hint bubble next to the FAB ("Ask your copilot") —
  // shown once per mount, auto-dismisses after a few seconds.
  const [copilotFabBubbleShown, setCopilotFabBubbleShown] = useState(true);
  const [isMcpPanelOpen, setIsMcpPanelOpen] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCallAction[]>([]);
  const [agentBlueprint, setAgentBlueprint] = useState<AgentBlueprint>({
    agentType,
    // Mission defaults — protocol revenue split + zero-state wallet.
    // Goal stays unset until the operator names a target via chat.
    revenueSplit: DEFAULT_REVENUE_SPLIT,
    wallet: {
      balanceUsdc: 0,
      earnings: { lifetimeUsdc: 0, last30dUsdc: 0, last7dUsdc: 0 },
      burnRate: { dailyUsdc: 0 },
    },
    // Auto-install the right module per vertical so the agent works without
    // manual setup. Clipping agents get the full clip pipeline pre-installed
    // (download → transcribe → moment-select → cut → auto-post).
    installedSkills:
      agentType === "influencer" || agentType === "worker"
        ? ["kie.video.generate", "ai.reasoning"]
        : agentType === "clipping"
        ? ["video.clip", "video.transcribe", "moment.select", "auto.post", "ai.reasoning"]
        : [],
  });
  const [, setNftDraftId] = useState<string | null>(null);
  const [nftAvatarUrls, setNftAvatarUrls] = useState<string[]>([]);
  // multi-image reference collection for avatar NFT generation
  const [referenceImages, setReferenceImages] = useState<string[]>([]); // base64 data URLs
  const [latestUploadedUrl, setLatestUploadedUrl] = useState(""); // for Kie.ai vision
  const [avatarGenStage, setAvatarGenStage] = useState<"idle" | "collecting" | "confirming" | "generating" | "done">("idle");
  const [characterBible, setCharacterBible] = useState<string>("");
  const agentBlueprintRef = useRef<AgentBlueprint>(agentBlueprint);
  useEffect(() => { agentBlueprintRef.current = agentBlueprint; }, [agentBlueprint]);

  // Auto-dismiss the copilot FAB's hint bubble a few seconds after it
  // actually appears (minted + collapsed) — re-arms every time it
  // reappears (e.g. the operator closes the panel again later), not just
  // once ever per mount.
  useEffect(() => {
    if (!agentBlueprint?.mintCompleted || !copilotCollapsed) return;
    setCopilotFabBubbleShown(true);
    const t = setTimeout(() => setCopilotFabBubbleShown(false), 4500);
    return () => clearTimeout(t);
  }, [copilotCollapsed, agentBlueprint?.mintCompleted]);

  // Agent-config writes now route through the SIWS-owner-gated /api/agents/config
  // route — the underlying influencers.saveAgentConfig / setVideoConfig mutations
  // are secret-gated and can no longer be called from the browser. Auth (Privy
  // Bearer + X-Siws-Session) is auto-attached by the global fetch interceptor.
  // These wrappers keep the same call signatures the old useMutation hooks had so
  // every call site (autosave effect, copilot actions) stays unchanged.
  // Declared early so the autosave effect below can reference it.
  const saveAgentConfigEarly = useCallback(
    async (args: {
      mintAddress: string;
      installedSkills?: string[];
      heartbeatEnabled?: boolean;
      heartbeatCron?: string;
      heartbeatMarkdown?: string;
      videoEngine?: string;
    }) => {
      const { mintAddress, ...payload } = args;
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "agent", payload }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
      return json;
    },
    [],
  );
  // Atomic slot claim — the AUTO heartbeat path calls this first so an open
  // builder tab can't double-fire with the Convex cron (or another tab).
  const claimHeartbeat = useMutation(api.influencers.claimHeartbeat);
  // Lets the copilot change the Video Director config agentically (set_video_config).
  const setVideoConfigMut = useCallback(
    async (args: { mintAddress: string; videoConfig: Record<string, unknown> }) => {
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress: args.mintAddress, kind: "video", payload: args.videoConfig }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; videoConfig?: unknown };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
      return json;
    },
    [],
  );

  // ── Autosave installed skills + heartbeat to Convex (post-mint only) ──────
  // Debounced: every change resets a 600ms timer so rapid toggles batch into
  // one write. Skips pre-mint state because no influencer row exists yet.
  const skillsSerialized = JSON.stringify(agentBlueprint.installedSkills ?? []);
  const heartbeatSerialized = JSON.stringify(agentBlueprint.heartbeat ?? null);
  const lastSavedSkillsRef = useRef<string>("");
  const lastSavedHeartbeatRef = useRef<string>("");
  useEffect(() => {
    const mint = agentBlueprint.mintAddress;
    if (!mint || !agentBlueprint.mintCompleted) return;
    // Skip the initial restore-from-DB write (the values came from Convex already)
    if (lastSavedSkillsRef.current === "" && lastSavedHeartbeatRef.current === "") {
      lastSavedSkillsRef.current = skillsSerialized;
      lastSavedHeartbeatRef.current = heartbeatSerialized;
      return;
    }
    if (
      skillsSerialized === lastSavedSkillsRef.current &&
      heartbeatSerialized === lastSavedHeartbeatRef.current
    ) return;

    const timer = setTimeout(() => {
      const hb = agentBlueprint.heartbeat;
      // videoEngine is deliberately NOT included here — VideoDirectorTab.commitEngine()
      // writes it directly and immediately on change. Including a copy of
      // agentBlueprint.videoEngine in this unrelated autosave created a race: this
      // effect fires on skill/heartbeat changes with whatever stale engine value was
      // last synced into local state, silently clobbering a just-made Director engine
      // choice back to the old one.
      void saveAgentConfigEarly({
        mintAddress: mint,
        installedSkills: agentBlueprint.installedSkills ?? [],
        heartbeatEnabled: hb?.enabled,
        heartbeatCron: hb?.cron,
        heartbeatMarkdown: hb?.markdown,
      }).then(() => {
        lastSavedSkillsRef.current = skillsSerialized;
        lastSavedHeartbeatRef.current = heartbeatSerialized;
      }).catch(() => { /* non-blocking; will retry on next change */ });
    }, 600);
    return () => clearTimeout(timer);
  }, [skillsSerialized, heartbeatSerialized, agentBlueprint.mintAddress, agentBlueprint.mintCompleted, agentBlueprint.installedSkills, agentBlueprint.heartbeat, saveAgentConfigEarly]);

  // Client-only mount flag — gates components that depend on browser-only
  // state (wallet session restore) so we don't get a hydration mismatch
  // between server-rendered markup and the client's connected-state DOM.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setHasMounted(true); }, []);

  // Chat copilot → Live tab realtime wiring.
  // - `externalTickToken` bumps when chat fires `execute_tick`; TraderWorkspace
  //   reacts by running its real Execute button (cyan pulse + "executing…").
  // - `forceTab` lets chat actions auto-switch the workspace so the operator
  //   visually sees the trade fire instead of having to click over.
  const [externalTickToken, setExternalTickToken] = useState(0);
  const [forceTraderTab, setForceTraderTab] = useState<"home" | "live" | "predict" | "research" | undefined>(undefined);
  // Bumped by chat canvas_* actions → AgentWorkspace switches to the Clipping tab.
  const [forceClipTab, setForceClipTab] = useState(0);
  // Chat open_tab → switch the workspace to any tab (post-mint). nonce re-fires the
  // AgentWorkspace effect even when the same tab is requested again.
  const [forceWorkspaceTab, setForceWorkspaceTab] = useState<{ tab: string; nonce: number } | null>(null);
  const personaDeepDiveCount = useRef(0);
  const [agentPhase, setAgentPhase] = useState<BuilderPhase | null>(null);
  // /home "Get clips" hand-off — ?walkthrough=1 shows the step-by-step overlay
  // (ClipperWalkthrough) mapped onto the real clip_* phases below. Read once on
  // mount; dismissed manually or automatically once the agent goes live.
  const [showWalkthrough, setShowWalkthrough] = useState(() => searchParams.get("walkthrough") === "1");
  useEffect(() => {
    if (agentPhase === "clip_ready") setShowWalkthrough(false);
  }, [agentPhase]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Influencers need 3 reference photos (for the animated GIF); traders + clippers
  // need a single cover image.
  const maxRefImages = agentType === "influencer" ? 3 : 1;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasProcessedInitial = useRef(false);
  const hasProcessedIndexHandoff = useRef(false);
  const hasProcessedRewardHandoff = useRef(false);
  const hasRestoredPersistedSession = useRef(false);
  const sessionIdRef = useRef(persistedSessionId);
  // Hosted public URLs of the USER'S OWN uploaded likeness photos, captured
  // from /api/generate-nft-images' refImageUrls and persisted onto the draft
  // (save-draft) so the wizard's "Pick the face" step can offer + default to
  // the real photo.
  const hostedFaceRefsRef = useRef<string[]>([]);
  const conversationHistory = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const nodesRef = useRef<IntelligentNode[]>([]);
  const hasAutoSetupTriggered = useRef(false);
  const [isAutoSetupRunning, setIsAutoSetupRunning] = useState(false);
  const [builderPhase, setBuilderPhase] = useState<"goal_capture" | "context_building" | "campaign_ready" | null>(null);
  const [agentSkillDefs, setAgentSkillDefs] = useState<SkillDef[]>(DEFAULT_SKILLS);

  // Convex: knowledge persistence
  const saveKnowledge = useMutation(api.agentKnowledge.saveEntry);
  const deleteKnowledge = useMutation(api.agentKnowledge.deleteEntry);
  const deleteAllKnowledge = useMutation(api.agentKnowledge.deleteAllBySession);
  const deleteAllMemories = useMutation(api.agentTasks.deleteAllMemories);
  const upsertSkillFile = useMutation(api.agentSkillFiles.upsert);
  const dbKnowledge = useQuery(
    api.agentKnowledge.listBySession,
    persistedSessionId ? { sessionId: persistedSessionId } : "skip",
  );

  // ── Second Brain consolidation ────────────────────────────────────────────
  // Instead of spawning a knowledge node per chat turn, durable knowledge is
  // merged as deduped bullets into a small set of canonical per-session nodes
  // (References, Conversation Notes, …). Stable localIds make saveEntry upsert.
  const dbKnowledgeRef = useRef(dbKnowledge);
  dbKnowledgeRef.current = dbKnowledge;
  // Synchronous draft of each node's content, so several merges in one turn
  // build on each other before the Convex query refetches.
  const brainNodeDraftRef = useRef<Record<string, string>>({});
  const upsertBrainNode = useCallback(
    (opts: { sessionId: string; localId: string; title: string; category: string; tags: string[]; header: string; bullet: string }) => {
      const { sessionId, localId, title, category, tags, header, bullet } = opts;
      const fromQuery = dbKnowledgeRef.current?.find((e: Doc<"agentKnowledge">) => e.localId === localId)?.content;
      const current = brainNodeDraftRef.current[localId] ?? fromQuery ?? header;
      const { content, changed } = mergeBullet(current, bullet);
      if (!changed) return; // duplicate bullet — nothing new to persist
      brainNodeDraftRef.current[localId] = content;
      void saveKnowledge({ sessionId, title, content, tags, category, links: [], entryType: "auto_memory", localId }).catch(() => {});
    },
    [saveKnowledge],
  );

  // Episodic memories for the second-brain graph — scoped to THIS project: the
  // real mint once minted, otherwise the builder session (pre-mint). Never an
  // empty key, so the graph can't show other projects' memories.
  const agentMemories = useQuery(
    api.agentTasks.recallMemories,
    resumeMintAddress
      ? { mintAddress: resumeMintAddress, limit: 30 }
      : persistedSessionId
        ? { sessionId: persistedSessionId, limit: 30 }
        : "skip",
  );

  // Resume an existing minted agent — load persona + draft + knowledge from DB
  const resumeBundle = useQuery(
    api.nftAgents.resumeByMint,
    resumeMintAddress ? { mintAddress: resumeMintAddress } : "skip",
  );
  // Which mint's data is currently hydrated into state — NOT a one-shot
  // boolean. `/builder` is a single route instance: clicking a different
  // agent card from Studio only changes the `mint` query param and re-fires
  // `resumeBundle` (client-side nav, no remount), so a plain "have I ever
  // restored" flag stayed true forever after the FIRST agent opened in a
  // session and silently ignored every later mint switch — every other
  // agent kept showing whichever one was opened first. Keying off the
  // actual bundle's mint address lets the hydration effect re-fire whenever
  // resumeBundle resolves to a genuinely different agent.
  const hydratedMintRef = useRef<string | null>(null);

  useEffect(() => {
    if (sessionIdRef.current) return;
    const nextSessionId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `builder-${Date.now()}`;
    sessionIdRef.current = nextSessionId;
    const params = new URLSearchParams(searchParams.toString());
    params.set("s", nextSessionId);
    router.replace(`/builder?${params.toString()}`);
  }, [router, searchParams]);

  // Hydrate state from the minted-agent resume bundle (one-shot)
  useEffect(() => {
    if (!resumeBundle || hydratedMintRef.current === resumeBundle.influencer.mintAddress) return;
    hydratedMintRef.current = resumeBundle.influencer.mintAddress;
    const { influencer, draft, knowledge, sessionId: dbSessionId, strategy } = resumeBundle;

    // Detect agent type — drives blueprint shape + welcome copy + AI prompt.
    // Some clippers pre-date the agentType field, so their persisted clipConfig
    // is the authoritative legacy marker rather than the influencer default.
    const resolvedType = resolvePersistedAgentType(influencer);

    // Keep the URL's mode aligned with the saved agent. AgentWorkspace and the
    // surrounding builder both read this query param, so a legacy clipper that
    // was linked without `type=clipping` must be corrected before its settings
    // render. Adopt the saved session in the same navigation to avoid racing
    // two router.replace calls with different query strings.
    const params = new URLSearchParams(searchParams.toString());
    let shouldReplaceUrl = false;
    if (dbSessionId && dbSessionId !== sessionIdRef.current) {
      sessionIdRef.current = dbSessionId;
      params.set("s", dbSessionId);
      shouldReplaceUrl = true;
    }
    if (typeParam !== resolvedType) {
      params.set("type", resolvedType);
      shouldReplaceUrl = true;
    }
    if (shouldReplaceUrl) router.replace(`/builder?${params.toString()}`);

    // Rebuild persona blueprint from DB
    const q = draft?.questionnaire ?? {};
    const displayName = influencer.name?.trim() || "Your AI agent";

    // For traders, rehydrate the full strategy spec from traderStrategies so
    // the chat sees a complete blueprint and doesn't bounce back to phase 1.
    let traderBlock: AgentBlueprint["trader"] = undefined;
    if (resolvedType === "trader") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let strategySpec: any = undefined;
      try {
        strategySpec = strategy?.spec ? JSON.parse(strategy.spec) : undefined;
      } catch { strategySpec = undefined; }
      traderBlock = {
        name: displayName,
        summary: strategy?.summary ?? influencer.description ?? "",
        aesthetic: draft?.characterBible ?? "",
        strategy: strategySpec,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const persistedSkills = ((influencer as any).installedSkills ?? []) as string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inf = influencer as any;
    const restoredHeartbeat =
      inf.heartbeatEnabled !== undefined || inf.heartbeatCron || inf.heartbeatMarkdown
        ? {
            enabled: Boolean(inf.heartbeatEnabled),
            cron: (inf.heartbeatCron ?? "every_15m") as NonNullable<AgentBlueprint["heartbeat"]>["cron"],
            markdown: inf.heartbeatMarkdown ?? "",
            lastEditedAt: Date.now(),
          }
        : undefined;

    const restoredBlueprint: AgentBlueprint = {
      agentType: resolvedType,
      agentStatus: "ready",
      mintCompleted: true,
      mintAddress: influencer.mintAddress,
      avatarsGenerated: true,
      installedSkills: persistedSkills,
      persona: {
        name: displayName,
        handle: influencer.handle,
        niche: influencer.niche,
        language: influencer.language,
        voiceArchetype: influencer.archetype as AgentBlueprint["persona"] extends infer P ? P extends { voiceArchetype?: infer V } ? V : never : never,
        audience: q.audience,
        backstory: q.backstory,
        traits: q.traits,
        beliefs: q.beliefs,
        catchphrase: q.catchphrase,
        dreamCollab: q.dreamCollab,
        contentPillars: q.contentPillars,
        avoidTopics: q.avoidTopics,
      },
      ...(traderBlock ? { trader: traderBlock } : {}),
      ...(restoredHeartbeat ? { heartbeat: restoredHeartbeat } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((inf as any).videoEngine ? { videoEngine: (inf as any).videoEngine } : {}),
    };
    setAgentBlueprint(restoredBlueprint);
    // The agent's saved profile image comes FIRST — same source /control shows
    // (influencers.avatarUrl) — then any extra draft stills, de-duplicated. The
    // draft list used to win outright (its [0] wasn't necessarily the chosen
    // profile pic), and dropDeadMedia stripped every old Supabase-hosted avatar
    // even though that host serves them again.
    setNftAvatarUrls([...new Set([influencer.avatarUrl, ...(draft?.avatarUrls ?? [])].filter((u): u is string => typeof u === "string" && !!u))]);
    setCharacterBible(draft?.characterBible ?? "");
    setAvatarGenStage("done");
    setProjectName(displayName);

    // Generate unique skills for this agent immediately
    const uniqueSkills = generateAgentSkills(restoredBlueprint.persona);
    setAgentSkillDefs(uniqueSkills);

    // Type-aware welcome message + conversation seed
    const welcomeText = resolvedType === "trader"
      ? `**${displayName} is live.** Trader minted on Solana${knowledge.length > 0 ? ` · ${knowledge.length} knowledge entries loaded` : ""}. I can execute a tick now, scan Polymarket/binary markets, place a trade, adjust autonomy, install signal skills, or recall recent memories. What's the move?`
      : resolvedType === "worker"
      ? `**${displayName} is live.** Worker agent ready. I can take a job from the campaign board, scan opportunities, generate work output, or refine my knowledge base. What do you want me to handle?`
      : `**${displayName} is loaded.** Your minted AI agent is ready${knowledge.length > 0 ? ` · ${knowledge.length} knowledge entries in your second brain` : ""}. I can generate content, scan trending topics, apply to a campaign, or refine my knowledge. What's next?`;

    setMessages([
      {
        id: `${Date.now()}-resume`,
        text: welcomeText,
        sender: "ai" as const,
        timestamp: new Date(),
      },
    ]);

    const seedContext = resolvedType === "trader"
      ? `${displayName} is a minted AI Trader. Mint: ${influencer.mintAddress}. Strategy is locked. The operator is now in AGENTIC POST-MINT MODE — every message may be a config change or an action request. Use agentActions to execute on their behalf (execute_tick, set_autonomy, toggle_heartbeat, install_skill, etc.) and confirm in plain language.`
      : `${displayName} has been minted on Solana and resumed. Persona: ${influencer.archetype} in ${influencer.niche}. Operator is in POST-MINT MODE — they can ask for content generation, campaign joins, memory recall, or config changes. Use agentActions when they request action.`;
    conversationHistory.current = [{ role: "assistant", content: seedContext }];
    hasProcessedInitial.current = true;

    // Deep-link to a specific workspace tab (?tab=schedule / ?tab=editor / …)
    // — e.g. the Recent Clips calendar/scissor buttons on /home land straight
    // on this agent's Schedule or Editor tab instead of Home. Fired here (not
    // earlier) because AgentWorkspace's forceWorkspaceTab effect requires the
    // agent to already be minted, which restoredBlueprint just established.
    if (tabParam) setForceWorkspaceTab({ tab: tabParam, nonce: Date.now() });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeBundle]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const goalPulseRef = useRef(0);

  // Keep the chat at the TOP on load — only auto-scroll to the newest message
  // once the page has settled. This skips the restore + entrance burst that would
  // otherwise yank the panel down to the bottom card the moment the page opens.
  const allowAutoScrollRef = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { allowAutoScrollRef.current = true; }, 1600);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!allowAutoScrollRef.current) return;
    // Scroll ONLY the chat pane — scrollIntoView would also scroll every
    // scrollable ancestor (the page / workspace column), which is what yanked
    // the whole page to the bottom on load and on tab open.
    const anchor = messagesEndRef.current;
    const pane = anchor?.parentElement;
    if (pane) pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
  }, [messages, isProcessing]);

  useEffect(() => {
    if (typeof window === "undefined" || hasProcessedIndexHandoff.current || hasRestoredPersistedSession.current) return;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      const raw = localStorage.getItem(buildBuilderSessionStorageKey(sessionId));
      if (!raw) {
        hasRestoredPersistedSession.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as PersistedBuilderSession;
      // New-agent entry never restores a previous minted/deleted workspace.
      // Existing agents are opened explicitly through their owned ?mint= link.
      if (!resumeMintAddress && parsed.agentBlueprint?.mintCompleted) {
        const freshSessionId = crypto.randomUUID();
        sessionIdRef.current = freshSessionId;
        const params = new URLSearchParams(searchParams.toString());
        params.set("s", freshSessionId);
        router.replace(`/builder?${params.toString()}`);
        return;
      }
      const restoredMessages: Message[] = Array.isArray(parsed.messages)
        ? parsed.messages.map((message) => ({
            id: message.id,
            text: message.text,
            sender: message.sender,
            timestamp: new Date(message.timestamp),
            imageUrl: message.imageUrl,
            avatars: message.avatars,
            isGeneratingAvatars: false, // never restore an in-flight loader state
            needsAvatarConfirm: message.needsAvatarConfirm,
            needsMint: message.needsMint,
            nftAvatarUrls: message.nftAvatarUrls,
            needsAvatarChoice: message.needsAvatarChoice,
            gifUrl: message.gifUrl,
          }))
        : [];
      if (restoredMessages.length > 0) {
        setMessages(restoredMessages);
        conversationHistory.current = restoredMessages
          // Client-side error bubbles and empty card-only turns must NOT reach
          // the model — restored failure text ("Could not reach the assistant…")
          // compounds across turns and can tip safety-tuned models into
          // refusing the copilot role entirely.
          .filter((message) =>
            message.text.trim().length > 0 &&
            !/^(Could not reach the assistant|Could not continue \(|Image generation failed:)/.test(message.text))
          .map((message) => ({
            role: message.sender === "user" ? "user" : "assistant",
            content: message.text,
          }));
        // Restore the persistent NFT avatar URLs so the mint card has imagery
        const lastMintMsg = [...restoredMessages].reverse().find((m) => m.needsMint && m.nftAvatarUrls?.length);
        if (lastMintMsg?.nftAvatarUrls?.length) {
          // Merge, don't replace: if the saved agent already loaded, its real
          // profile image (influencers.avatarUrl) must stay first.
          const restored = lastMintMsg.nftAvatarUrls;
          setNftAvatarUrls((prev) => (prev.length ? [...new Set([...prev, ...restored])] : restored));
        }
        const lastAvatarsMsg = [...restoredMessages].reverse().find((m) => m.avatars?.length);
        if (lastAvatarsMsg?.avatars?.length) {
          setAvatarGenStage("done");
        }
      }
      if (Array.isArray(parsed.nodes)) {
        setNodes(parsed.nodes);
      }
      if (typeof parsed.projectName === "string" && parsed.projectName.trim()) {
        setProjectName(parsed.projectName);
      }
      if (Array.isArray(parsed.clientActions)) {
        setClientActions(parsed.clientActions);
      }
      if (parsed.campaignBlueprint && typeof parsed.campaignBlueprint === "object") {
        setCampaignBlueprint(parsed.campaignBlueprint);
      }
      if (parsed.agentChain && typeof parsed.agentChain === "object") {
        setAgentChain(parsed.agentChain);
      }
      // Restore the full blueprint (persona, installed skills, mint state) so a
      // minted agent stays minted across refreshes. This is a TRUSTED local
      // snapshot (persisted only after a real mint), NOT an AI echo — set it
      // directly so withStickyMint's mint-stripping doesn't wipe a real mint.
      if (parsed.agentBlueprint && typeof parsed.agentBlueprint === "object") {
        setAgentBlueprint(parsed.agentBlueprint as AgentBlueprint);
      }
      if (typeof parsed.websiteTitle === "string") {
        setWebsiteTitle(parsed.websiteTitle);
      }
      if (restoredMessages.length > 0) {
        hasProcessedInitial.current = true;
      }
    } catch {
      // Ignore corrupt persisted builder sessions.
    } finally {
      hasRestoredPersistedSession.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sessionId = sessionIdRef.current;
    if (!sessionId || !hasRestoredPersistedSession.current) return;
    const payload: PersistedBuilderSession = {
      messages: messages.map((message) => ({
        id: message.id,
        text: message.text,
        sender: message.sender,
        timestamp: message.timestamp.toISOString(),
        // Persist image-related fields so images reappear after refresh.
        // We DROP base64 data URIs (>1MB localStorage hit) and keep only http(s) URLs.
        imageUrl: message.imageUrl && !message.imageUrl.startsWith("data:") ? message.imageUrl : undefined,
        avatars: message.avatars?.map((a) => ({
          ...a,
          url: a.url && !a.url.startsWith("data:") ? a.url : undefined,
        })),
        needsAvatarConfirm: message.needsAvatarConfirm,
        needsMint: message.needsMint,
        nftAvatarUrls: message.nftAvatarUrls?.filter((u) => u && !u.startsWith("data:")),
        needsAvatarChoice: message.needsAvatarChoice,
        gifUrl: message.gifUrl && !message.gifUrl.startsWith("data:") ? message.gifUrl : undefined,
      })),
      nodes,
      projectName,
      clientActions,
      campaignBlueprint,
      agentChain,
      websiteTitle,
      agentBlueprint,
    };
    try {
      localStorage.setItem(buildBuilderSessionStorageKey(sessionId), JSON.stringify(payload));
    } catch {
      // Ignore storage quota and serialization issues.
    }
  }, [messages, nodes, projectName, clientActions, campaignBlueprint, agentChain, websiteTitle, agentBlueprint]);

  // ── Admin transcript sync ─────────────────────────────────────────────────
  // Mirrors the FULL chat — every user AND assistant turn, including card / image
  // / video-only replies (which carry empty `text`) — to Convex so the admin
  // Conversations tab reads the complete, continuous conversation. Sessions
  // without a connected wallet sync as "anonymous" and upgrade to the real
  // wallet on connect. Fire-and-forget: a sync failure must never affect UX.
  const syncBuilderSession = useMutation(api.builderSessions.sync);
  const builderSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const builderWallet = publicKey?.toBase58() ?? "anonymous";
  const builderMintAddress = agentBlueprint?.mintAddress || undefined;

  // Latest flush closure — kept in a ref so the unmount effect always sees
  // current wallet/agent/messages and can persist the last (debounced) batch.
  const flushBuilderSyncRef = useRef<() => void>(() => {});
  flushBuilderSyncRef.current = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || messagesRef.current.length === 0) return;
    const payload = messagesRef.current.map((m) => ({
      role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
      content: summarizeMessageForTranscript(m).slice(0, 2000),
      at: m.timestamp.getTime(),
    }));
    if (payload.length === 0) return;
    void syncBuilderSession({
      sessionId,
      wallet: builderWallet,
      agentType,
      projectName: projectName?.trim() ? projectName.trim() : undefined,
      mintAddress: builderMintAddress,
      messages: payload,
    }).catch(() => { /* never break the builder over telemetry */ });
  };

  useEffect(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || messages.length === 0) return;
    if (builderSyncTimer.current) clearTimeout(builderSyncTimer.current);
    // Keep the admin transcript close to real time. A short debounce still
    // collapses streaming-token updates while greatly reducing the chance that
    // a user navigates away before the final AI reply is persisted.
    builderSyncTimer.current = setTimeout(() => flushBuilderSyncRef.current(), 750);
    return () => { if (builderSyncTimer.current) clearTimeout(builderSyncTimer.current); };
  }, [messages, builderWallet, agentType, projectName, builderMintAddress]);

  // Flush any pending transcript once more when leaving the builder so the last
  // turn(s) within the debounce window still reach the admin view.
  useEffect(() => {
    const flush = () => flushBuilderSyncRef.current();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  // ── INFLUENCER agentic tools — search campaigns + submit on behalf of agent
  const allCampaigns = useQuery(api.campaigns.list, {});
  const submitToCampaign = useMutation(api.submissions.submit);
  // setPostLink is now secret-gated in Convex (browser can't call it directly).
  // Go through the authed server twin /api/submissions/set-link, which resolves the
  // submission's owning agent + SIWS-ownership-checks before forwarding the secret.
  // The global fetch interceptor attaches X-Siws-Session and retries on siws_required.
  const setSubmissionLink = useCallback(
    async (args: { submissionId: Id<"submissions">; influencerMint: string; postUrl: string; platform?: string }) => {
      const res = await fetch("/api/submissions/set-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ submissionId: args.submissionId, postUrl: args.postUrl, platform: args.platform }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        throw new Error(String((data as { error?: string }).error ?? `set-link failed (${res.status})`));
      }
      return (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string };
    },
    [accessToken],
  );
  // When a campaign post is live but no link came back automatically, we stash
  // the submission here so the operator can paste the post link to attach it.
  const pendingCampaignSubmissionRef = useRef<{ submissionId: Id<"submissions">; influencerMint: string; platform: string; brand: string } | null>(null);

  // ── Script-first video flow ───────────────────────────────────────────────
  // Per-card chosen length + render status (keyed by the card message id), plus
  // a watch map (render taskId → card message id) so the reactive task query can
  // drop the finished <video> into chat.
  const [videoCardLengths, setVideoCardLengths] = useState<Record<string, number>>({});
  const [videoCardStatus, setVideoCardStatus] = useState<Record<string, "idle" | "rendering" | "done" | "failed" | "cancelled">>({});
  // True while a card's script is being rewritten to match a newly-picked length.
  const [videoCardRewriting, setVideoCardRewriting] = useState<Record<string, boolean>>({});
  const videoTaskWatchRef = useRef<Map<string, string>>(new Map());
  const mintedVideoAddress = agentBlueprint?.mintAddress;
  const watchedVideoTasks = useQuery(
    api.agentTasks.listByMint,
    mintedVideoAddress ? { mintAddress: mintedVideoAddress, limit: 12 } : "skip",
  );
  // Most-recent successfully generated video URL — lets the agent POST the
  // "latest video" without regenerating it. Sourced from listGenerations (ALL
  // succeeded generations, newest-first) so it isn't truncated by a small window.
  const generationTasks = useQuery(
    api.agentTasks.listGenerations,
    mintedVideoAddress ? { mintAddress: mintedVideoAddress } : "skip",
  );
  const latestVideoUrlRef = useRef<string | undefined>(undefined);
  // Save the persona to the Second Brain only once — not on every post-mint turn.
  useEffect(() => {
    for (const t of (generationTasks ?? [])) {
      if (t.type !== "create_video") continue;
      try {
        const out = JSON.parse(t.output ?? "{}") as { videoUrl?: unknown };
        if (typeof out.videoUrl === "string" && out.videoUrl) { latestVideoUrlRef.current = out.videoUrl; return; }
      } catch { /* skip malformed */ }
    }
  }, [generationTasks]);
  // Render the finished video in chat the moment its task flips done/failed.
  useEffect(() => {
    if (!watchedVideoTasks || videoTaskWatchRef.current.size === 0) return;
    for (const t of watchedVideoTasks) {
      const cardId = videoTaskWatchRef.current.get(t._id);
      if (!cardId) continue;
      if (t.status !== "succeeded" && t.status !== "failed") continue;
      videoTaskWatchRef.current.delete(t._id);
      if (t.status === "succeeded") {
        let out: Record<string, unknown> = {};
        try { out = t.output ? JSON.parse(t.output) : {}; } catch { /* keep empty */ }
        const videoUrl = typeof out.videoUrl === "string" ? out.videoUrl : undefined;
        const posterUrl = typeof out.storyboardImageUrl === "string" ? out.storyboardImageUrl : undefined;
        const note = (out.videoNote ?? out.videoError) as string | undefined;
        setVideoCardStatus((s) => ({ ...s, [cardId]: "done" }));
        setMessages((prev) => [...prev, videoUrl
          ? { id: `${Date.now()}-vid-ready`, text: `✅ Video ready — **${String(out.topic ?? "your video")}**${note ? `\n\n_${String(note).slice(0, 160)}_` : ""}`, videoUrl, posterUrl, sender: "ai" as const, timestamp: new Date() }
          : { id: `${Date.now()}-vid-partial`, text: posterUrl ? `✅ Storyboard ready, but the video step didn't finish${out.videoError ? `: ${String(out.videoError).slice(0, 140)}` : ""}. The still is in your Generations tab.` : `⚠ The pipeline finished without a video. ${String(out.pipelineError ?? "").slice(0, 160)}`, posterUrl, sender: "ai" as const, timestamp: new Date() }
        ]);
      } else {
        setVideoCardStatus((s) => ({ ...s, [cardId]: "failed" }));
        setMessages((prev) => [...prev, { id: `${Date.now()}-vid-fail`, text: `⚠ Video failed: ${(t.errorMessage ?? "unknown").slice(0, 160)}. Tap **Generate** on the script card to retry.`, sender: "ai" as const, timestamp: new Date() }]);
      }
    }
  }, [watchedVideoTasks]);

  // Agent wallet address (for chat funding) + daily burn (for the funding algo).
  const influencerRecord = useQuery(
    api.influencers.getByMint,
    agentBlueprint?.mintAddress ? { mintAddress: agentBlueprint.mintAddress } : "skip",
  );
  const agentWalletAddress = (influencerRecord as { agentWallet?: string } | null | undefined)?.agentWallet;
  const agentDailyBurn = estimateDailyBurn(agentBlueprint?.installedSkills ?? []);

  const executeInfluencerActions = useCallback(async (actions: Array<{ type: string; [k: string]: unknown }>) => {
    // An AI INFLUENCER can only fulfil UGC campaigns (it films new content); a
    // clipper handles clipping campaigns. Gate the join list by agent type so an
    // influencer's "join a campaign" never surfaces a clipping campaign.
    const joinableFilter = (c: Record<string, unknown>) =>
      agentType === "influencer" ? isJoinableUgcCampaign(c) : isJoinableCampaign(c);
    const bp = agentBlueprintRef.current;
    const wallet = publicKey?.toBase58();

    for (const action of actions) {
      try {
        if (action.type === "search_campaigns") {
          const q = String(action.keywords ?? "").toLowerCase().trim();
          // Only funded on-chain + LIVE campaigns are joinable (excludes ended /
          // unfunded rows). For an influencer this is further limited to UGC
          // campaigns via joinableFilter — a clipping campaign is a clipper's job.
          const list = ((allCampaigns ?? []) as Array<{ _id: string; brandName?: string; title?: string; brief?: string; budget?: number; targetNiche?: string[]; deadline?: string }>).filter(
            (c) => joinableFilter(c as Record<string, unknown>),
          );
          const matches = q
            ? list.filter((c) => {
                const blob = `${c.brandName ?? ""} ${c.title ?? ""} ${c.brief ?? ""}`.toLowerCase();
                return q.split(/\s+/).some((w) => w && blob.includes(w));
              })
            : list;
          if (matches.length === 0) {
            setMessages((prev) => [...prev, {
              id: `${Date.now()}-camp-none`,
              text: `🔍 Searched **${q || "all open campaigns"}** — no live matches right now. I'll keep watching the board.`,
              sender: "ai" as const, timestamp: new Date(),
            }]);
          } else {
            const top = matches.slice(0, 4);
            const lines = top.map((c) => `• **${c.brandName ?? "?"}** — ${(c.title ?? "").slice(0, 60)} · $${c.budget ?? 0} budget · deadline ${c.deadline ?? "?"} \`id:${c._id.slice(-8)}\``).join("\n");
            setMessages((prev) => [...prev, {
              id: `${Date.now()}-camp-list`,
              text: `🔎 Found ${matches.length} campaign${matches.length === 1 ? "" : "s"} matching **${q || "your filter"}**:\n${lines}\n\nWant me to apply to one?`,
              sender: "ai" as const, timestamp: new Date(),
            }]);
          }
        } else if (action.type === "join_campaign") {
          const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
          const pushMsg = (id: string, text: string) =>
            setMessages((prev) => [...prev, { id: `${Date.now()}-${id}`, text, sender: "ai" as const, timestamp: new Date() }]);
          const rawId = String(action.campaignId ?? "");
          // The AI sometimes returns a short suffix — match against full IDs
          const list = (allCampaigns ?? []) as Array<{ _id: string; brandName?: string; title?: string; brief?: string; platforms?: string[] }>;
          const target = list.find((c) => c._id === rawId || c._id.endsWith(rawId));
          if (!target) {
            pushMsg("camp-404", `⚠ Couldn't find campaign \`${rawId}\` — it may have closed. Try \`/search-campaigns\` again.`);
            continue;
          }
          // Re-validate at join time: still funded on-chain AND not ended/exhausted,
          // and (for an influencer) still a UGC campaign — guards against joining a
          // stale or clipping id that slipped through between search and join.
          if (!joinableFilter(target as Record<string, unknown>)) {
            pushMsg("camp-ended", `⚠ **${target.brandName ?? "That campaign"}** isn't available to join (ended, unfunded, or not a UGC campaign). Try \`/search-campaigns\` for a live one.`);
            continue;
          }
          if (!bp.mintAddress) {
            pushMsg("camp-mint", `⚠ Go live with the agent first — I can't join campaigns on behalf of a persona that isn't live yet.`);
            continue;
          }
          if (!wallet) {
            pushMsg("camp-wallet", `⚠ Connect your Phantom wallet first so I can sign the submission.`);
            continue;
          }

          // ── Eligibility gate — Vello Campaigns + Social skills + a CONNECTED
          //    platform that matches THIS campaign's requirement. ───────────────
          let connectedPlatforms: string[] = [];
          try {
            // Must send the auth token — /api/social/status is auth-gated, and
            // without it the call 401s and the agent wrongly thinks nothing is
            // connected ("link a social account first") even when it is.
            const sres = await fetch(`/api/social/status?username=${encodeURIComponent(bp.mintAddress)}`, {
              headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            });
            const sdata = await sres.json() as { connected?: Record<string, unknown> };
            connectedPlatforms = Object.entries(sdata.connected ?? {}).filter(([, v]) => Boolean(v)).map(([k]) => k);
          } catch { /* treat as none connected */ }

          const elig = evaluateCampaignEligibility({
            installedSkills: bp.installedSkills,
            connectedPlatforms,
            campaignPlatforms: target.platforms,
          });
          if (!elig.eligible) {
            const brand = target.brandName ?? "This campaign";
            const guide: Record<string, string> = {
              need_campaigns_skill: `🔌 To join brand campaigns, install the **Vello Campaigns** skill in the Skills marketplace first.`,
              need_social_skill: `🔌 Joining a campaign means posting the deliverable — install the **Social Auto-Post (Upload-Post)** skill, then connect your accounts in **Connections**.`,
              need_connection: `🔗 Open the **Connections** panel and link a social account first — I can only join campaigns for platforms you've connected.`,
              need_platform: `🔗 **${brand}** accepts ${elig.requiredPlatforms.map(cap).join(" / ")}. Connect ${elig.missingPlatforms.map(cap).join(" or ")} in the **Connections** panel and I'll join it right away.`,
            };
            pushMsg("camp-gate", guide[elig.reason ?? "need_campaigns_skill"]);
            continue;
          }
          const platform = elig.eligiblePlatforms[0];
          const brand = target.brandName ?? "the campaign";

          pushMsg("camp-applying", `📨 Joining **${brand}** — *${(target.title ?? "").slice(0, 60)}*. Creating your video deliverable now…`);

          // 1) Create the submission (joined, pending — no link yet).
          let submissionId: Id<"submissions"> | null = null;
          try {
            submissionId = await submitToCampaign({
              campaignId: target._id as Id<"campaigns">,
              influencerMint: bp.mintAddress,
              influencerName: bp.persona?.name ?? "Vello agent",
              submitterWallet: wallet,
              platform,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Unknown error";
            pushMsg("camp-err", /already submitted/i.test(msg) ? `ℹ Already joined this campaign — nothing to do.` : `⚠ Join failed: ${msg}`);
            continue;
          }

          // 2) GENERATE the campaign video first. It renders in the background
          //    (minutes), and ONLY when it's done does the video job auto-post it
          //    to the matched platform — with a caption — and attach the live post
          //    link to this submission. We never post or claim "submitted" before
          //    the video exists. The Tasks + Generations panels show live progress.
          const sid = submissionId;
          void fetch("/api/agents/run-task", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mintAddress: bp.mintAddress,
              taskType: "create_video",
              title: `Campaign deliverable: ${target.title ?? brand}`,
              input: {
                topic: target.title ?? target.brief ?? `${bp.persona?.niche ?? ""} campaign`,
                niche: bp.persona?.niche,
                campaignBrief: target.brief,
                // Auto-post the finished video + record the submission link.
                autoPost: { platforms: [platform], campaignId: target._id, submissionId: sid },
              },
              triggeredBy: "campaign",
            }),
          }).then(async (res) => {
            const data = await res.json().catch(() => ({} as Record<string, unknown>));
            const errMsg = (data as { error?: string; message?: string }).message ?? (data as { error?: string }).error;
            if (!res.ok || errMsg) {
              if (sid) pendingCampaignSubmissionRef.current = { submissionId: sid, influencerMint: bp.mintAddress!, platform, brand };
              pushMsg("camp-joined-novideo", `✅ Joined **${brand}** — but I couldn't start the video${errMsg ? `: ${errMsg}` : ""}. Try \`make a video for this campaign\`, or paste a post link and I'll attach it.`);
              return;
            }
            pushMsg("camp-rendering", `✅ Joined **${brand}**! Your video is rendering now — I'll auto-post it to **${cap(platform)}** with a caption and record the submission link the moment it's ready. Track it in the **Tasks** and **Generations** panels.`);
          }).catch((e) => {
            if (sid) pendingCampaignSubmissionRef.current = { submissionId: sid, influencerMint: bp.mintAddress!, platform, brand };
            pushMsg("camp-video-catch", `✅ Joined **${brand}** — couldn't start the video (${(e as Error).message.slice(0, 100)}). Paste a post link and I'll attach it.`);
          });
        } else if (action.type === "check_agent_wallet") {
          // No-op — the snapshot is already injected for the next turn by the server
        } else if (action.type === "fund_wallet") {
          if (!bp.mintAddress) {
            setMessages((prev) => [...prev, {
              id: `${Date.now()}-fund-mint`,
              text: `⚠ Go live with the agent first — it needs an on-chain wallet before it can be funded.`,
              sender: "ai" as const, timestamp: new Date(),
            }]);
            continue;
          }
          const rawAmt = typeof action.amount === "number" ? action.amount : Number(action.amount);
          const amount = Number.isFinite(rawAmt) && rawAmt > 0 ? rawAmt : undefined;
          const token: FundToken = String(action.token ?? "").toUpperCase() === "SOL" ? "SOL" : "USDC";
          setMessages((prev) => [...prev, {
            id: `${Date.now()}-fund-card`,
            text: "",
            sender: "ai" as const, timestamp: new Date(),
            fundCard: { amount, token },
          }]);
        } else if (action.type === "create_video") {
          if (!bp.mintAddress) {
            setMessages((prev) => [...prev, {
              id: `${Date.now()}-vid-mint`,
              text: `⚠ Go live with the agent first — I can't generate a video without the on-chain identity.`,
              sender: "ai" as const, timestamp: new Date(),
            }]);
            continue;
          }
          const topic = String(action.topic ?? bp.persona?.contentPillars?.[0] ?? bp.persona?.niche ?? "lifestyle update");
          // Step 1 — write the SCRIPT (Claude, no wallet/task) and show it on a
          // confirm card. The render only fires when the operator taps Generate.
          const draftMsgId = `${Date.now()}-vid-drafting`;
          // Don't show the raw chat-invented topic here — for a bible-configured
          // agent it's reconciled against the Show Bible server-side (see
          // /api/agents/video-script) and can change entirely once resolved, so
          // narrating it now would show the wrong subject for a few seconds and
          // read as "ignored the bible" even when the final script didn't.
          setMessages((prev) => [...prev, {
            id: draftMsgId,
            text: `✍️ Writing the script…`,
            sender: "ai" as const, timestamp: new Date(), isGeneratingAvatars: true,
            generatingLabel: `Writing the script…`,
          }]);
          try {
            // A network-level failure here ("Failed to fetch") is almost always
            // transient — a cold start, a dev recompile, or a brief drop — because
            // the /api/ai/chat call that produced this action just succeeded. So we
            // give the request a timeout and retry ONCE on a network/abort error
            // before surfacing anything, which self-heals the common case.
            const doScriptFetch = async (): Promise<Response> => {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 70_000);
              try {
                return await fetch("/api/agents/video-script", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mintAddress: bp.mintAddress, topic }),
                  signal: controller.signal,
                });
              } finally {
                clearTimeout(timer);
              }
            };
            let res: Response;
            try {
              res = await doScriptFetch();
            } catch {
              await new Promise((r) => setTimeout(r, 1200));
              res = await doScriptFetch(); // one retry; a real failure throws to the catch below
            }
            const data = await res.json().catch(() => ({} as Record<string, unknown>));
            if (!res.ok || (data as { error?: string }).error) {
              const friendly = (data as { error?: string }).error ?? `HTTP ${res.status}`;
              setMessages((prev) => prev.map((m) => m.id === draftMsgId ? { ...m, isGeneratingAvatars: false, text: `⚠ Couldn't write the script: ${friendly}` } : m));
              continue;
            }
            const d = data as { topic: string; hook: string; script: string; caption: string; raw: Record<string, unknown>; estSeconds: number; clipCount: number; engine: { label: string; maxClipSeconds: number }; styleId?: string; styleName?: string };
            const card: VideoScriptCardData = {
              topic: d.topic, hook: d.hook, script: d.script, caption: d.caption, raw: d.raw,
              engineLabel: d.engine?.label ?? "Veo 3.1 Fast",
              maxClipSeconds: d.engine?.maxClipSeconds ?? 8,
              estSeconds: d.estSeconds, clipCount: d.clipCount,
              ...(d.styleId ? { styleId: d.styleId, styleName: d.styleName } : {}),
            };
            // Replace the "writing…" bubble with the script card.
            setMessages((prev) => prev.map((m) => m.id === draftMsgId
              ? { ...m, isGeneratingAvatars: false, text: "", videoScriptCard: card }
              : m));
          } catch (e) {
            const err = e as Error;
            const friendly = err?.name === "AbortError"
              ? "the script service took too long to respond"
              : /failed to fetch|networkerror|load failed/i.test(err?.message ?? "")
                ? "a network hiccup — the request didn't reach the server"
                : (err?.message ?? "unknown error").slice(0, 120);
            setMessages((prev) => prev.map((m) => m.id === draftMsgId ? { ...m, isGeneratingAvatars: false, text: `⚠ Couldn't write the script (${friendly}). Ask me to “write a video script for ${topic}” to try again.` } : m));
          }
        } else if (action.type === "post_to_social") {
          const pushMsg = (id: string, text: string) =>
            setMessages((prev) => [...prev, { id: `${Date.now()}-${id}`, text, sender: "ai" as const, timestamp: new Date() }]);
          const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

          // 1) Skill gate — auto-enable the (free) posting skill so the agent can act.
          if (!(bp.installedSkills ?? []).includes("social.uploadpost")) {
            setAgentBlueprint((prev) => {
              const cur = prev.installedSkills ?? [];
              return cur.includes("social.uploadpost") ? prev : { ...prev, installedSkills: [...cur, "social.uploadpost"] };
            });
            pushMsg("post-skill-on", `🔌 Turned on **Social Auto-Post** for ${bp.persona?.name ?? "your agent"}.`);
          }
          // 2) Needs a minted identity (the upload-post profile = mintAddress).
          if (!bp.mintAddress) {
            pushMsg("post-mint", `⚠ Go live with the agent first — posting runs under the agent's on-chain identity.`);
            continue;
          }
          const username = bp.mintAddress;

          // 3) Resolve platforms + content type.
          const norm = (p: string) => (p.toLowerCase() === "twitter" ? "x" : p.toLowerCase());
          const requested = [...new Set(
            (Array.isArray(action.platforms) ? action.platforms.map(String)
              : action.platform ? [String(action.platform)] : []).map(norm),
          )];
          if (requested.length === 0) {
            pushMsg("post-noplat", `Which platform should I post to? (TikTok, Instagram, YouTube, Facebook, LinkedIn, X, Threads)`);
            continue;
          }
          const content = String(action.content ?? action.text ?? "").trim();
          let mediaUrl = action.mediaUrl ? String(action.mediaUrl) : action.videoUrl ? String(action.videoUrl) : undefined;
          let contentType = String(action.contentType ?? "").toLowerCase();
          // "post the latest video" → attach the agent's most recent generated
          // video. NEVER generate a new one for this intent.
          if (!mediaUrl && (action.useLatestVideo === true || contentType === "video")) {
            // 1) Durable: newest succeeded create_video task. 2) In-session fallback:
            // the most recent video rendered into this chat.
            mediaUrl = latestVideoUrlRef.current;
            if (!mediaUrl) {
              const msgs = messagesRef.current ?? [];
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (typeof msgs[i].videoUrl === "string" && msgs[i].videoUrl) { mediaUrl = msgs[i].videoUrl; break; }
              }
            }
            if (!mediaUrl) {
              pushMsg("post-novid", `📭 ${bp.persona?.name ?? "Your agent"} hasn't generated a video yet, so there's nothing to post. Ask me to make a video first, then I'll post the latest one.`);
              continue;
            }
            contentType = "video";
          }
          if (!["text", "photo", "video"].includes(contentType)) {
            contentType = mediaUrl ? (/\.(mp4|mov|webm|m4v|avi)(\?|$)/i.test(mediaUrl) ? "video" : "photo") : "text";
          }

          // 4) Check live connection status — MUST send the auth token (the status
          //    route is auth-gated; without it the call 401s and the agent wrongly
          //    reports "not connected" even when accounts are linked).
          pushMsg("post-check", `🔗 Checking your ${requested.map(cap).join(", ")} connection…`);
          let connectedMap: Record<string, unknown> = {};
          let configured = true;
          let statusOk = false;
          try {
            const sres = await fetch(`/api/social/status?username=${encodeURIComponent(username)}`, {
              headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            });
            if (sres.ok) {
              const sdata = await sres.json() as { configured?: boolean; connected?: Record<string, unknown> };
              configured = sdata.configured !== false;
              connectedMap = sdata.connected ?? {};
              statusOk = true;
            }
          } catch { /* treat as unknown below */ }

          if (statusOk && !configured) {
            pushMsg("post-cfg", `⚠ Social posting isn't configured on the server yet (UPLOAD_POST_API_KEY). Once it's set, connect your accounts in **Connections**.`);
            continue;
          }
          const allConnected = Object.entries(connectedMap).filter(([, v]) => Boolean(v)).map(([k]) => k);
          // Prefer requested ∩ connected; if the requested platform isn't connected
          // but the agent IS connected elsewhere, post to a connected one instead of
          // dead-ending (e.g. asked for TikTok but only Instagram is linked).
          let connected = requested.filter((p) => allConnected.includes(p));
          const missing = requested.filter((p) => !allConnected.includes(p));
          if (connected.length === 0 && allConnected.length > 0) connected = allConnected;

          // 5) Block ONLY when we DEFINITIVELY confirmed zero connections. If the
          //    status check was inconclusive (auth/timeout), proceed and let the
          //    server's post_content gate decide (it does the real check + fallback).
          if (connected.length === 0) {
            if (statusOk) {
              pushMsg("post-guide", `🔌 You haven't connected any social account yet. Open the **Connections** panel on the right, hit **Connect**, finish the popup — then ask me again and I'll post it right away.`);
              continue;
            }
            connected = requested; // unknown — attempt; the server will gate + fall back to a connected platform
          }

          // 6) Post (creates a task → shows + animates in the strip, then publishes).
          const typeLabel = contentType === "text" ? "update" : contentType;
          pushMsg("post-go", `📤 Posting your ${typeLabel} to **${connected.map(cap).join(", ")}**…${missing.length && connected.length < requested.length ? ` _(skipping ${missing.map(cap).join(", ")} — not connected)_` : ""}`);
          void fetch("/api/agents/run-task", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mintAddress: username,
              taskType: "post_content",
              title: `Post to ${connected.join(", ")}`,
              input: { platforms: connected, contentType, text: content, mediaUrl, niche: bp.persona?.niche },
              triggeredBy: "copilot",
            }),
          }).then(async (res) => {
            const data = await res.json().catch(() => ({} as Record<string, unknown>));
            const out = (data as { output?: { status?: string; platforms?: string[]; note?: string; text?: string } }).output ?? {};
            const errMsg = (data as { error?: string; message?: string }).message ?? (data as { error?: string }).error;
            if (!res.ok || errMsg) {
              pushMsg("post-err", `⚠ ${errMsg ?? `Post failed (HTTP ${res.status})`}`);
            } else if (out.status === "posted") {
              pushMsg("post-ok", `✅ Posted to **${(out.platforms ?? connected).map(cap).join(", ")}**! 🎉${out.text ? `\n\n> ${out.text.slice(0, 200)}` : ""}`);
            } else if (out.status === "needs_connection") {
              pushMsg("post-need", `🔌 ${out.note ?? "Connect the account in the Connections panel, then try again."}`);
            } else if (out.status === "failed") {
              pushMsg("post-fail", `⚠ Posting failed${out.note ? `: ${out.note}` : ""}. Check the connection in the Connections panel.`);
            } else {
              pushMsg("post-info", `ℹ ${out.note ?? "Queued."}`);
            }
          }).catch((e) => {
            pushMsg("post-catch", `⚠ Post request error: ${(e as Error).message.slice(0, 120)}`);
          });
        } else if (action.type === "create_skill") {
          // The copilot acting as skills engineer: persist a new custom skill
          // (markdown instructions) to Convex and install it on the agent. The
          // Skills card renders it reactively (realtime).
          const pushMsg = (id: string, text: string) =>
            setMessages((prev) => [...prev, { id: `${Date.now()}-${id}`, text, sender: "ai" as const, timestamp: new Date() }]);
          const name = (String(action.name ?? action.title ?? "Custom Skill").trim() || "Custom Skill").slice(0, 60);
          const description = String(action.description ?? action.summary ?? "").trim().slice(0, 240);
          const tags = Array.isArray(action.tags)
            ? action.tags.map(String).map((t) => t.trim()).filter(Boolean).slice(0, 6)
            : [];
          const instructions = String(action.markdown ?? action.instructions ?? action.content ?? "").trim();
          if (!instructions) {
            pushMsg("skill-empty", `⚠ I couldn't build that skill yet — tell me a bit more about what it should do and I'll engineer it.`);
            continue;
          }
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
          const skillId = `custom.${slug || `skill-${Date.now().toString(36)}`}`;
          const fileMd = `---\nname: ${name}\ndescription: ${description}\ntags: ${tags.join(", ")}\ncustom: true\n---\n\n${instructions}`;
          try {
            await upsertSkillFile({
              sessionId: sessionIdRef.current ?? "",
              mintAddress: bp.mintAddress,
              skillId,
              title: name,
              markdown: fileMd,
            });
          } catch (e) {
            pushMsg("skill-save-err", `⚠ Built the skill but couldn't save it: ${(e as Error).message.slice(0, 120)}`);
            continue;
          }
          // Also feed the skill into the agent's knowledge base so it actually
          // shapes generation (chat, video scripts, posts) — not just a UI chip.
          try {
            await saveKnowledge({
              sessionId: sessionIdRef.current ?? "",
              title: `Skill: ${name}`,
              content: instructions,
              tags: tags.length ? tags : ["skill"],
              category: "skill",
              links: [],
              entryType: "auto_skill",
            });
          } catch { /* non-fatal — the skill file is the source of truth */ }
          setAgentBlueprint((prev) => {
            const current = prev.installedSkills ?? [];
            const next = Array.from(new Set([...current, skillId]));
            return { ...prev, installedSkills: next };
          });
          pushMsg("skill-created", `🧩 Built a new skill — **${name}**${description ? `: ${description}` : ""}. It's added to ${bp.persona?.name ?? "your agent"}'s Skills and will be used on every task. Open the Skills panel to view or edit it.`);
        } else if (action.type === "set_video_config") {
          // Agentic Video Director — apply one or more video settings to the
          // influencer's config (persists to Convex; the Director tab reflects it
          // reactively). This handler was missing from the influencer path, which
          // is exactly why chat changes silently did nothing.
          if (!bp.mintAddress) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-act-vid-nomint`, text: `⚠ Go live with the agent first, then I can change its video settings.`, sender: "ai" as const, timestamp: new Date() }]);
          } else {
            const raw = (action.videoConfig && typeof action.videoConfig === "object") ? action.videoConfig as Record<string, unknown> : {};
            const ALLOWED = ["minSeconds", "maxSeconds", "videosPerDay", "monthlyBudget", "maxBrandsPerDay", "aspectRatio", "styles", "customStyles", "hookStyles", "settings", "moods", "energy", "cameraStyle", "colorGrade", "voiceover", "cta", "ctaText", "customDirective", "avoid", "brandLogoUrl", "brandColor", "hookText", "captions"];
            const partial: Record<string, unknown> = {};
            for (const k of ALLOWED) if (raw[k] !== undefined) partial[k] = raw[k];
            if (Object.keys(partial).length > 0) {
              try {
                const res = await setVideoConfigMut({ mintAddress: bp.mintAddress, videoConfig: partial });
                if (res?.videoConfig) setAgentBlueprint((prev) => ({ ...prev, videoConfig: res.videoConfig as typeof prev.videoConfig }));
                setMessages((prev) => [...prev, { id: `${Date.now()}-act-vid`, text: `✓ Updated the Video Director (${Object.keys(partial).join(", ")}). Open the **Director** tab to see it.`, sender: "ai" as const, timestamp: new Date() }]);
              } catch (e) {
                setMessages((prev) => [...prev, { id: `${Date.now()}-act-vid-err`, text: `⚠ Couldn't update video settings: ${(e as Error).message.slice(0, 100)}`, sender: "ai" as const, timestamp: new Date() }]);
              }
            }
          }
        } else if (action.type === "set_video_engine") {
          // Agentic Video Director — switch the render engine (persists via saveAgentConfig).
          const engId = String(action.videoEngine ?? action.engine ?? "");
          const eng = VIDEO_ENGINES.find((e) => e.id === engId);
          if (!bp.mintAddress) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-act-eng-nomint`, text: `⚠ Go live with the agent first, then I can switch its video engine.`, sender: "ai" as const, timestamp: new Date() }]);
          } else if (!eng) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-act-eng-bad`, text: `⚠ I don't recognize that engine. Options: ${VIDEO_ENGINES.map((e) => e.label).join(", ")}.`, sender: "ai" as const, timestamp: new Date() }]);
          } else {
            try {
              await saveAgentConfigEarly({ mintAddress: bp.mintAddress, videoEngine: eng.id });
              setAgentBlueprint((prev) => ({ ...prev, videoEngine: eng.id }));
              setMessages((prev) => [...prev, { id: `${Date.now()}-act-eng`, text: `✓ Video engine → **${eng.label}**. Open the **Director** tab to see it.`, sender: "ai" as const, timestamp: new Date() }]);
            } catch (e) {
              setMessages((prev) => [...prev, { id: `${Date.now()}-act-eng-err`, text: `⚠ Couldn't switch engine: ${(e as Error).message.slice(0, 100)}`, sender: "ai" as const, timestamp: new Date() }]);
            }
          }
        }
      } catch (e) {
        setMessages((prev) => [...prev, {
          id: `${Date.now()}-infl-err`,
          text: `⚠ ${action.type} failed: ${(e as Error).message.slice(0, 120)}`,
          sender: "ai" as const, timestamp: new Date(),
        }]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCampaigns, publicKey, submitToCampaign, setSubmissionLink, agentType]);

  // ── Script-card actions ─────────────────────────────────────────────────────
  const regenerateVideoScriptCard = useCallback(async (cardId: string, card: VideoScriptCardData, seconds: number, refinement?: string) => {
    const bp = agentBlueprintRef.current;
    if (!bp?.mintAddress) return;
    setVideoCardLengths((s) => ({ ...s, [cardId]: seconds }));
    setVideoCardRewriting((s) => ({ ...s, [cardId]: true }));
    try {
      const res = await fetch("/api/agents/video-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress: bp.mintAddress, topic: card.topic, durationSeconds: seconds, refinement }),
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        const d = data as { hook: string; script: string; caption: string; raw: Record<string, unknown>; estSeconds: number; clipCount: number };
        setMessages((prev) => prev.map((m) => m.id === cardId && m.videoScriptCard
          ? { ...m, videoScriptCard: { ...m.videoScriptCard, hook: d.hook, script: d.script, caption: d.caption, raw: d.raw, estSeconds: d.estSeconds, clipCount: d.clipCount } }
          : m));
      }
    } catch {
      // Keep existing script; length still applies and render packs what's there.
    } finally {
      setVideoCardRewriting((s) => ({ ...s, [cardId]: false }));
    }
  }, []);

  const handleVideoCardLength = useCallback(async (cardId: string, card: VideoScriptCardData, seconds: number) => {
    if (seconds === card.estSeconds) {
      setVideoCardLengths((s) => ({ ...s, [cardId]: seconds }));
      return;
    }
    await regenerateVideoScriptCard(cardId, card, seconds);
  }, [regenerateVideoScriptCard]);
  const handleVideoCardEdit = useCallback((topic: string) => {
    setInputText(`make a video about ${topic} — `);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);
  const handleVideoCardCancel = useCallback((cardId: string) => {
    setVideoCardStatus((s) => ({ ...s, [cardId]: "cancelled" }));
  }, []);

  // Fire the heartbeat NOW — runs the autonomy loop: read the agent's persona +
  // memory + heartbeat manual, GENERATE the tasks it should run, then EXECUTE
  // them. New/running tasks stream into the Tasks panel in realtime (reactive
  // Convex queries), so the user sees the work happen live.
  const fireHeartbeatNow = useCallback(async (opts?: { auto?: boolean }) => {
    const bp = agentBlueprintRef.current;
    const mint = bp?.mintAddress;
    if (!mint) {
      if (opts?.auto) return; // auto path stays silent until the agent is minted
      setMessages((prev) => [...prev, { id: `${Date.now()}-hb-nomint`, text: "Go live with the agent first — the heartbeat runs under its on-chain identity.", sender: "ai" as const, timestamp: new Date() }]);
      return;
    }
    if (opts?.auto) {
      // Only proceed if THIS tab wins the shared wall-clock slot — the cron or
      // another open tab may have already claimed it. CAS prevents a double fire.
      try {
        const claim = await claimHeartbeat({ mintAddress: mint, now: Date.now() });
        if (!claim?.claimed) return;
      } catch { return; }
    }
    setMessages((prev) => [...prev, { id: `${Date.now()}-hb-fire`, text: `⚡ Heartbeat fired — ${bp?.persona?.name ?? "your agent"} is reading its persona + memory, creating tasks, and running them. Watch the **Tasks** panel for live updates.`, sender: "ai" as const, timestamp: new Date() }]);
    try {
      const res = await fetch("/api/agents/autonomy-loop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ mintAddress: mint, heartbeatMarkdown: bp?.heartbeat?.markdown, triggeredBy: "user_heartbeat" }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const err = (data as { error?: string }).error;
      const generated = Number((data as { generated?: number }).generated ?? 0);
      const ran = Number((data as { tasksRun?: number }).tasksRun ?? 0);
      const pending = Number((data as { pending?: number }).pending ?? 0);
      const name = bp?.persona?.name ?? "the agent";
      setMessages((prev) => [...prev, {
        id: `${Date.now()}-hb-done`,
        text: err
          ? `⚠ Heartbeat error: ${String(err).slice(0, 160)}`
          : generated === 0
            ? pending > 0
              ? `⏳ Heartbeat fired — ${name} still has **${pending}** task${pending === 1 ? "" : "s"} running, so it's finishing those first. Watch the **Tasks** panel.`
              : `✓ Heartbeat ran — nothing new to do right now (${name} is up to date).`
            : `✅ Heartbeat done — created **${generated}** task${generated === 1 ? "" : "s"} and ran ${ran}. They're running top-to-bottom in the **Tasks** panel.`,
        sender: "ai" as const, timestamp: new Date(),
      }]);
    } catch (e) {
      setMessages((prev) => [...prev, { id: `${Date.now()}-hb-err`, text: `⚠ Heartbeat request failed: ${(e as Error).message.slice(0, 120)}`, sender: "ai" as const, timestamp: new Date() }]);
    }
  }, [accessToken, claimHeartbeat]);
  const handleVideoCardGenerate = useCallback(async (cardId: string, card: VideoScriptCardData, seconds: number) => {
    const bp = agentBlueprintRef.current;
    if (!bp?.mintAddress) {
      setMessages((prev) => [...prev, { id: `${Date.now()}-vid-nomint`, text: `⚠ Go live with the agent first to render videos.`, sender: "ai" as const, timestamp: new Date() }]);
      return;
    }
    setVideoCardStatus((s) => ({ ...s, [cardId]: "rendering" }));
    setMessages((prev) => [...prev, { id: `${Date.now()}-vid-render`, text: `🎬 Rendering **${card.topic}** (~${card.clipCount > 1 ? "a few minutes" : "1 to 2 minutes"})… it'll appear right here and in Generations when ready.`, sender: "ai" as const, timestamp: new Date() }]);
    try {
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: bp.mintAddress,
          taskType: "create_video",
          title: `Video: ${card.topic}`,
          input: { topic: card.topic, durationSeconds: seconds, script: card.raw, hook: card.hook, scriptText: card.script, caption: card.caption, ...(card.styleId ? { styleId: card.styleId } : {}) },
          triggeredBy: "copilot",
        }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { error?: string }).error) {
        const dd = data as { error?: string; message?: string };
        const friendly = dd.message ?? dd.error ?? `HTTP ${res.status}`;
        setVideoCardStatus((s) => ({ ...s, [cardId]: "idle" }));
        setMessages((prev) => [...prev, { id: `${Date.now()}-vid-rerr`, text: `${res.status === 402 ? "💸" : "⚠"} ${friendly}`, sender: "ai" as const, timestamp: new Date() }]);
        return;
      }
      const taskId = (data as { taskId?: string }).taskId;
      if (taskId) videoTaskWatchRef.current.set(taskId, cardId);
      setVideoCardStatus((s) => ({ ...s, [cardId]: "done" }));
      // Synchronous (non-deferred) completion — render immediately if the server
      // returned the video inline. Otherwise the reactive watcher handles it.
      const sync = data as { async?: boolean; output?: { videoUrl?: string; storyboardImageUrl?: string } };
      const syncOut = sync.output;
      if (!sync.async && syncOut?.videoUrl) {
        if (taskId) videoTaskWatchRef.current.delete(taskId);
        setMessages((prev) => [...prev, { id: `${Date.now()}-vid-now`, text: `✅ Video ready — **${card.topic}**`, videoUrl: syncOut.videoUrl, posterUrl: syncOut.storyboardImageUrl, sender: "ai" as const, timestamp: new Date() }]);
      }
    } catch (e) {
      setVideoCardStatus((s) => ({ ...s, [cardId]: "idle" }));
      setMessages((prev) => [...prev, { id: `${Date.now()}-vid-rcatch`, text: `⚠ Render request error: ${(e as Error).message.slice(0, 120)}`, sender: "ai" as const, timestamp: new Date() }]);
    }
  }, []);

  // ── Agentic chat — execute tool calls the AI returns ────────────────────
  const executeAgentActions = useCallback(async (actions: Array<{ type: string; [k: string]: unknown }>) => {
    const bp = agentBlueprintRef.current;
    const sessionId = sessionIdRef.current;

    for (const action of actions) {
      try {
        if (action.type === "execute_tick") {
          // Switch to Live tab so the operator visually sees the Execute
          // button enter the cyan "executing…" state in realtime, then
          // bump the token so TraderWorkspace calls its real runTick().
          setForceTraderTab("live");
          setMessages((prev) => [...prev, { id: `${Date.now()}-act-tick`, text: "⚡ Firing the Execute button on the Live tab — watch the signals/decision panel light up.", sender: "ai" as const, timestamp: new Date() }]);
          // Small delay so the tab switch renders before runTick mutates state
          setTimeout(() => setExternalTickToken((n) => n + 1), 120);
        } else if (action.type === "set_autonomy") {
          const mode = String(action.mode ?? "");
          if (["approve", "auto", "signal_only"].includes(mode)) {
            const typedMode = mode as "approve" | "auto" | "signal_only";
            const newSpec = { ...(bp.trader?.strategy ?? {}), autonomy: typedMode };
            setAgentBlueprint((prev) => {
              const prevStrategy = prev.trader?.strategy;
              if (!prevStrategy) return prev;
              return {
                ...prev,
                trader: { ...(prev.trader ?? {}), strategy: { ...prevStrategy, autonomy: typedMode } },
              };
            });
            if (bp.mintAddress && sessionId) {
              await fetch("/api/trader/save-autonomy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, mintAddress: bp.mintAddress, autonomy: mode, spec: newSpec }),
              }).catch(() => {});
            }
            setMessages((prev) => [...prev, { id: `${Date.now()}-act-mode`, text: `✓ Autonomy switched to **${mode}**.`, sender: "ai" as const, timestamp: new Date() }]);
          }
        } else if (action.type === "toggle_heartbeat") {
          const enabled = Boolean(action.enabled);
          setAgentBlueprint((prev) => ({
            ...prev,
            heartbeat: {
              enabled,
              markdown: prev.heartbeat?.markdown ?? "",
              cron: prev.heartbeat?.cron ?? "every_15m",
              lastEditedAt: Date.now(),
            },
          }));
          setMessages((prev) => [...prev, { id: `${Date.now()}-act-hb`, text: `✓ Heartbeat ${enabled ? "started" : "paused"}.`, sender: "ai" as const, timestamp: new Date() }]);
        } else if (action.type === "set_heartbeat_cron") {
          const cron = String(action.cron ?? "every_15m");
          setAgentBlueprint((prev) => ({
            ...prev,
            heartbeat: {
              enabled: prev.heartbeat?.enabled ?? false,
              markdown: prev.heartbeat?.markdown ?? "",
              cron: cron as "manual" | "every_5m" | "every_15m" | "every_30m" | "every_1h" | "every_4h" | "every_12h" | "daily",
              lastEditedAt: Date.now(),
            },
          }));
          setMessages((prev) => [...prev, { id: `${Date.now()}-act-cron`, text: `✓ Heartbeat schedule → **${cron}**.`, sender: "ai" as const, timestamp: new Date() }]);
        } else if (action.type === "install_skill" || action.type === "uninstall_skill") {
          const skillId = String(action.skillId ?? "");
          if (!skillId) continue;
          const install = action.type === "install_skill";
          setAgentBlueprint((prev) => {
            const current = prev.installedSkills ?? [];
            const next = install ? Array.from(new Set([...current, skillId])) : current.filter((s) => s !== skillId);
            return { ...prev, installedSkills: next };
          });
          // Show the Home tab so the operator sees the skill chip appear in
          // the Installed Skills section in realtime.
          if (install) setForceTraderTab("home");
          setMessages((prev) => [...prev, { id: `${Date.now()}-act-skill`, text: `✓ ${install ? "Installed" : "Uninstalled"} skill **${skillId}** — visible in the Home tab Skills panel.`, sender: "ai" as const, timestamp: new Date() }]);
        } else if (action.type === "set_video_config") {
          // Agentic Video Director — the copilot tweaks one or more video settings
          // (length range, styles, captions, etc.) on the operator's behalf.
          if (!bp.mintAddress) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-act-vid-nomint`, text: `⚠ Go live with the agent first, then I can change its video settings.`, sender: "ai" as const, timestamp: new Date() }]);
          } else {
            const raw = (action.videoConfig && typeof action.videoConfig === "object")
              ? action.videoConfig as Record<string, unknown>
              : {};
            // Whitelist known keys so a hallucinated extra field can't fail the mutation validator.
            const ALLOWED = ["minSeconds", "maxSeconds", "videosPerDay", "aspectRatio", "styles", "customStyles", "hookStyles", "settings", "moods", "energy", "cameraStyle", "colorGrade", "voiceover", "cta", "ctaText", "customDirective", "avoid", "brandLogoUrl", "brandColor", "hookText", "captions"];
            const partial: Record<string, unknown> = {};
            for (const k of ALLOWED) if (raw[k] !== undefined) partial[k] = raw[k];
            if (Object.keys(partial).length === 0) continue;
            try {
              const res = await setVideoConfigMut({ mintAddress: bp.mintAddress, videoConfig: partial });
              if (res?.videoConfig) setAgentBlueprint((prev) => ({ ...prev, videoConfig: res.videoConfig as typeof prev.videoConfig }));
              const summary = Object.keys(partial).join(", ");
              setMessages((prev) => [...prev, { id: `${Date.now()}-act-vid`, text: `✓ Updated the Video Director (${summary}). Open the **Director** tab to see it.`, sender: "ai" as const, timestamp: new Date() }]);
            } catch (e) {
              setMessages((prev) => [...prev, { id: `${Date.now()}-act-vid-err`, text: `⚠ Couldn't update video settings: ${(e as Error).message.slice(0, 100)}`, sender: "ai" as const, timestamp: new Date() }]);
            }
          }
        } else if (action.type === "set_video_engine") {
          // Agentic Video Director — switch the render engine on the operator's behalf.
          const engId = String(action.videoEngine ?? action.engine ?? "");
          const eng = VIDEO_ENGINES.find((e) => e.id === engId);
          if (!bp.mintAddress) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-act-eng-nomint`, text: `⚠ Go live with the agent first, then I can switch its video engine.`, sender: "ai" as const, timestamp: new Date() }]);
          } else if (!eng) {
            const names = VIDEO_ENGINES.map((e) => e.label).join(", ");
            setMessages((prev) => [...prev, { id: `${Date.now()}-act-eng-bad`, text: `⚠ I don't recognize that engine. Options: ${names}.`, sender: "ai" as const, timestamp: new Date() }]);
          } else {
            try {
              await saveAgentConfigEarly({ mintAddress: bp.mintAddress, videoEngine: eng.id });
              setAgentBlueprint((prev) => ({ ...prev, videoEngine: eng.id }));
              setMessages((prev) => [...prev, { id: `${Date.now()}-act-eng`, text: `✓ Video engine → **${eng.label}**. Open the **Director** tab to see it.`, sender: "ai" as const, timestamp: new Date() }]);
            } catch (e) {
              setMessages((prev) => [...prev, { id: `${Date.now()}-act-eng-err`, text: `⚠ Couldn't switch engine: ${(e as Error).message.slice(0, 100)}`, sender: "ai" as const, timestamp: new Date() }]);
            }
          }
        } else if (action.type === "clip_source" || action.type === "join_clip_campaign") {
          // Clipping agents: kick off a clip job (download → transcribe → cut →
          // auto-post). The heavy work runs server-side; clips stream into the
          // Clips queue in the workspace as they render.
          const sourceUrl = String(action.sourceUrl ?? action.url ?? action.assetUrl ?? "");
          if (!bp.mintAddress) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-clip-mint`, text: `⚠ Go live with the clipper first — clipping needs an on-chain agent wallet.`, sender: "ai" as const, timestamp: new Date() }]);
            continue;
          }
          if (!/^https?:\/\//i.test(sourceUrl)) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-clip-url`, text: `⚠ Paste a direct video link (or a YouTube/TikTok URL) to clip.`, sender: "ai" as const, timestamp: new Date() }]);
            continue;
          }
          // Skill gate: a clipping agent always has the module; any other agent must
          // install it first. Guide them with a one-click install card.
          if (!hasClipModule(bp.agentType, bp.installedSkills)) {
            setMessages((prev) => [
              ...prev,
              { id: `${Date.now()}-clip-need`, text: `✂️ This agent can't clip yet — the clipping module isn't installed.`, sender: "ai" as const, timestamp: new Date() },
              { id: `${Date.now()}-clip-install`, text: "", sender: "ai" as const, timestamp: new Date(), needsClipInstall: sourceUrl },
            ]);
            continue;
          }
          // Clipping agents: a plain pasted link goes to the CLIPPING TAB (the
          // editor), not the background workflow run — the video downloads into
          // the Videos list and opens on the timeline, and the operator styles +
          // clips it there with one click (or uploads their own file instead).
          // Campaign clips (join_clip_campaign / campaign-tagged) keep the
          // server path: they need the campaign attribution on the job.
          const campaignTagged = action.type === "join_clip_campaign" || !!action.campaignId || !!action.contentRewardId;
          if (bp.agentType === "clipping" && !campaignTagged) {
            useClippingStore.getState().setEditorIntake({ sourceUrl });
            setForceClipTab((n) => n + 1);
            setMessages((prev) => [...prev, {
              id: `${Date.now()}-clip-editor`,
              text: [
                "✂️ Opened the **Clipping** tab — your video is downloading into **Videos** (left panel) and opens on the timeline when it lands.",
                "",
                "1. Style it: **Captions**, **Text Hook**, **Music** from the toolbar (the preview shows exactly what burns in).",
                "2. Hit **Clip** (top right) and pick how many clips — they render into your Clips queue.",
                "",
                "Got the file yourself? Click **Upload your own video** under the link box — no download needed, and it's the most reliable way to clip.",
              ].join("\n"),
              sender: "ai" as const,
              timestamp: new Date(),
            }]);
            continue;
          }
          setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-clip-go`, text: `✂️ On it — clipping that now. Watch the live progress below; clips stream into the Clips queue as they render.`, sender: "ai" as const, timestamp: new Date() },
            { id: `${Date.now()}-clip-progress`, text: "", sender: "ai" as const, timestamp: new Date(), clipProgress: true },
          ]);
          try {
            await fetch("/api/agents/run-task", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mintAddress: bp.mintAddress,
                taskType: action.type,
                title: `Clip: ${sourceUrl.slice(0, 60)}`,
                input: {
                  sourceUrl,
                  campaignId: action.campaignId,
                  contentRewardId: action.contentRewardId,
                },
                triggeredBy: "builder_chat",
              }),
            });
          } catch {
            setMessages((prev) => [...prev, { id: `${Date.now()}-clip-err`, text: `⚠ Couldn't start the clip job. Try again in a moment.`, sender: "ai" as const, timestamp: new Date() }]);
          }
        } else if (typeof action.type === "string" && action.type.startsWith("canvas_")) {
          // Clipping Flow canvas ops from chat. Queued into the canvas' zustand
          // store (drained once the canvas is mounted + hydrated) and the
          // workspace auto-switches to the Clipping tab so the change is visible.
          const t = action.type;
          let op: ClipChatOp | null = null;
          const CATALOG_KEYS = ["source", "broll", "crop", "publish"] as const;
          if (t === "canvas_set_source" && /^https?:\/\//i.test(String(action.sourceUrl ?? action.url ?? ""))) {
            op = { op: "set_source", sourceUrl: String(action.sourceUrl ?? action.url) };
          } else if (t === "canvas_set_clip_length" && (action.min !== undefined || action.max !== undefined)) {
            op = {
              op: "set_clip_length",
              min: Number.isFinite(Number(action.min)) ? Number(action.min) : undefined,
              max: Number.isFinite(Number(action.max)) ? Number(action.max) : undefined,
            };
          } else if (t === "canvas_set_max_clips" && Number.isFinite(Number(action.count))) {
            op = { op: "set_max_clips", count: Number(action.count) };
          } else if (t === "canvas_set_auto_plan" && typeof action.enabled === "boolean") {
            op = { op: "set_auto_plan", enabled: action.enabled };
          } else if (t === "canvas_set_genre" && action.genre) {
            op = { op: "set_genre", genre: String(action.genre) };
          } else if (t === "canvas_set_caption_preset" && action.preset) {
            op = { op: "set_caption_preset", preset: String(action.preset) };
          } else if (t === "canvas_add_node" && (CATALOG_KEYS as readonly string[]).includes(String(action.key))) {
            op = { op: "add_node", key: String(action.key) as (typeof CATALOG_KEYS)[number] };
          } else if (t === "canvas_add_skill" && action.skillId) {
            op = { op: "add_skill", skillId: String(action.skillId) };
          } else if (t === "canvas_apply_template" && ["podcast-clipper", "hormozi-bold", "campaign-hunter"].includes(String(action.templateId))) {
            op = { op: "apply_template", templateId: String(action.templateId) };
          } else if (t === "canvas_remove_node" && action.title) {
            op = { op: "remove_node", title: String(action.title) };
          } else if (t === "canvas_connect" && action.from && action.to) {
            op = { op: "connect", from: String(action.from), to: String(action.to) };
          } else if (t === "canvas_tidy") {
            op = { op: "tidy" };
          } else if (t === "canvas_run") {
            op = { op: "run" };
          }
          if (op) {
            useClippingStore.getState().queueChatOps([op]);
            setForceClipTab((n) => n + 1);
            const what = t.replace("canvas_", "").replace(/_/g, " ");
            setMessages((prev) => [...prev, { id: `${Date.now()}-canvas-${what}`, text: `🎛 Canvas updated — ${what}.`, sender: "ai" as const, timestamp: new Date() }]);
          }
        } else if (action.type === "open_clipping") {
          // "I want to clip my video" / "how do I upload" with no link — take the
          // operator to the Clipping tab; upload:true pops the file picker.
          useClippingStore.getState().setEditorIntake({ upload: action.upload === true });
          setForceClipTab((n) => n + 1);
          setMessages((prev) => [...prev, {
            id: `${Date.now()}-clip-open`,
            text: "✂️ Opened the **Clipping** tab. Click **Upload your own video** (left panel) to use your file, or paste a YouTube / Google Drive link in the box above it. Then style it and hit **Clip**.",
            sender: "ai" as const,
            timestamp: new Date(),
          }]);
        } else if (action.type === "open_tab" && typeof action.tab === "string") {
          // Switch the workspace to another tab so the operator sees it (post-mint).
          const tab = String(action.tab).toLowerCase();
          if (["home", "clipping", "marketplace", "library", "posting", "tasks", "generations", "budget", "director"].includes(tab)) {
            setForceWorkspaceTab({ tab, nonce: Date.now() });
          }
        } else if (action.type === "fund_wallet") {
          // FUND-from-chat: copilot opens the in-chat agent-wallet funding card.
          // Operator signs the transfer in their own wallet (FundWalletCard).
          // Same handler the influencer copilot uses — clipping just routes here
          // via executeAgentActions, so it must own its own copy.
          if (!bp.mintAddress) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-fund-mint`, text: `⚠ Go live with the clipper first — it needs an on-chain wallet before it can be funded.`, sender: "ai" as const, timestamp: new Date() }]);
            continue;
          }
          const rawAmt = typeof action.amount === "number" ? action.amount : Number(action.amount);
          const amount = Number.isFinite(rawAmt) && rawAmt > 0 ? rawAmt : undefined;
          const fToken: FundToken = String(action.token ?? "").toUpperCase() === "SOL" ? "SOL" : "USDC";
          setMessages((prev) => [...prev, { id: `${Date.now()}-fund-card`, text: "", sender: "ai" as const, timestamp: new Date(), fundCard: { amount, token: fToken } }]);
        } else if (action.type === "open_mint") {
          // MINT-from-chat: copilot opens the cover-image + mint flow (the same one
          // the Home Deploy button runs). The operator still signs the mint tx.
          if (bp.mintCompleted) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-mint-done`, text: `✅ ${bp.persona?.name ?? "This clipper"} is already minted — nothing to do. Paste a video URL and I'll start clipping.`, sender: "ai" as const, timestamp: new Date() }]);
            continue;
          }
          // Surface the Home tab so the mint card is visible, then run the shared flow.
          setForceWorkspaceTab({ tab: "home", nonce: Date.now() });
          triggerClipMintRef.current?.();
        } else if (action.type === "summarize_activity" || action.type === "recall_memories") {
          // The server already injected recent activity/memories into the system prompt
          // for the next turn — nothing to do here; the AI will reference them.
        } else if (action.type === "place_binary") {
          // Direct UP/DOWN bet on the in-house BTC/ETH/SOL oracle markets
          const asset = String(action.asset ?? "BTC").toUpperCase();
          const side = String(action.side ?? "UP").toUpperCase() as "UP" | "DOWN";
          const horizonMin = Number(action.horizonMin ?? 5);
          const stakeUsdc = Math.max(1, Math.min(250, Number(action.stakeUsdc ?? 5)));
          if (!bp.mintAddress) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-bin-mint`, text: `⚠ Go live with the trader first — can't place a bet without an on-chain agent wallet.`, sender: "ai" as const, timestamp: new Date() }]);
            continue;
          }
          // Auto-switch to Predict tab so the new position appears in-view
          setForceTraderTab("predict");
          setMessages((prev) => [...prev, { id: `${Date.now()}-bin-go`, text: `📈 Placing **${side} ${asset} ${horizonMin}m · $${stakeUsdc}** — opening Predict tab so you can watch it settle.`, sender: "ai" as const, timestamp: new Date() }]);
          try {
            // Pull live price first so we lock the reference at chat-time
            const priceRes = await fetch(`/api/trader/tick-price?asset=${asset}`);
            const priceData = await priceRes.json() as { ok?: boolean; price?: number };
            if (!priceData.ok || typeof priceData.price !== "number") {
              setMessages((prev) => [...prev, { id: `${Date.now()}-bin-price`, text: `⚠ Couldn't fetch live ${asset} price. Try again in a moment.`, sender: "ai" as const, timestamp: new Date() }]);
              continue;
            }
            const res = await fetch("/api/trader/place-binary", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mintAddress: bp.mintAddress,
                sessionId,
                asset, horizonMin, side,
                stakeUsdc,
                referencePrice: priceData.price,
                payoutMultiplier: 1.92,
              }),
            });
            const data = await res.json() as { ok?: boolean; potentialPayout?: number; potentialProfit?: number; error?: string };
            if (data.ok) {
              setMessages((prev) => [...prev, {
                id: `${Date.now()}-bin-ok`,
                text: `✅ Position open · ${side} ${asset} ${horizonMin}m @ $${priceData.price?.toFixed(2)} · stake $${stakeUsdc} → max payout $${(data.potentialPayout ?? 0).toFixed(2)} (+$${(data.potentialProfit ?? 0).toFixed(2)}). Settles in ${horizonMin}m.`,
                sender: "ai" as const, timestamp: new Date(),
              }]);
            } else {
              setMessages((prev) => [...prev, { id: `${Date.now()}-bin-err`, text: `⚠ Bet failed: ${data.error ?? "unknown"}`, sender: "ai" as const, timestamp: new Date() }]);
            }
          } catch (e) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-bin-thrw`, text: `⚠ ${(e as Error).message.slice(0, 120)}`, sender: "ai" as const, timestamp: new Date() }]);
          }
        } else if (action.type === "open_predict_url") {
          const url = String(action.url ?? "");
          setMessages((prev) => [...prev, {
            id: `${Date.now()}-pm-url`,
            text: `ℹ Polymarket runs on Polygon so I can't trade it directly from this wallet. I've mirrored the BTC UP/DOWN bet on our in-house oracle — settles from Birdeye/Jupiter at expiry. Open Polymarket: ${url}`,
            sender: "ai" as const, timestamp: new Date(),
          }]);
        }
      } catch (e) {
        setMessages((prev) => [...prev, {
          id: `${Date.now()}-act-err`,
          text: `⚠ Action ${action.type} failed: ${(e as Error).message.slice(0, 100)}`,
          sender: "ai" as const, timestamp: new Date(),
        }]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const messageText = text || inputText.trim();
    if (!messageText || isProcessing) return;
    // No chat before an agent exists (the guided setup owns creation).
    if (!resumeMintAddress) return;

    // ── Campaign post-link capture ───────────────────────────────────────────
    // If a campaign post is live but its link wasn't captured automatically, the
    // operator pastes the link — attach it to the pending submission and skip the
    // chat model entirely (this is a data action, not a conversation turn).
    const pendingSub = pendingCampaignSubmissionRef.current;
    const pastedUrl = messageText.match(/https?:\/\/[^\s]+/)?.[0];
    if (pendingSub && pastedUrl) {
      setInputText("");
      setMessages((prev) => [...prev, { id: `${Date.now()}-link-user`, text: messageText, sender: "user", timestamp: new Date() }]);
      try {
        await setSubmissionLink({ submissionId: pendingSub.submissionId, influencerMint: pendingSub.influencerMint, postUrl: pastedUrl, platform: pendingSub.platform });
        pendingCampaignSubmissionRef.current = null;
        setMessages((prev) => [...prev, { id: `${Date.now()}-link-ok`, text: `✅ Link attached to your **${pendingSub.brand}** submission. It's in the Generations tab now.\n\n🔗 ${pastedUrl}`, sender: "ai" as const, timestamp: new Date() }]);
      } catch (e) {
        setMessages((prev) => [...prev, { id: `${Date.now()}-link-err`, text: `⚠ Couldn't attach the link: ${(e as Error).message.slice(0, 120)}`, sender: "ai" as const, timestamp: new Date() }]);
      }
      return;
    }

    // ── Script length edit ──────────────────────────────────────────────────
    // If a script card already exists and the message is about its length
    // ("make it longer", "1 minute version", "shorter"), regenerate that card
    // for the new duration instead of routing to the campaign chat model.
    const lastScriptMsg = [...messages].reverse().find((m) => m.videoScriptCard);
    if (lastScriptMsg?.videoScriptCard) {
      const directive = parseScriptDirective(messageText, lastScriptMsg.videoScriptCard.estSeconds);
      if (directive.isLengthEdit) {
        setInputText("");
        setMessages((prev) => [...prev, { id: `${Date.now()}-len-user`, text: messageText, sender: "user", timestamp: new Date() }]);
        await regenerateVideoScriptCard(lastScriptMsg.id, lastScriptMsg.videoScriptCard, directive.seconds, directive.refinement || undefined);
        return;
      }
    }

    setIsProcessing(true);
    setInputText("");
    const latestRequestText = messageText;

    const userMsg: Message = {
      id: Date.now().toString(),
      text: messageText,
      sender: "user",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    conversationHistory.current.push({ role: "user", content: messageText });

    const trimmedGoal = latestRequestText.trim().slice(0, 2800);
    goalPulseRef.current += 1;
    const pulseTok = goalPulseRef.current;
    setNodes((prev) => {
      const withoutPreview = prev.filter((n) => n.id !== BUILDER_LOCAL_GOAL_PREVIEW_ID);
      const initialIdx = withoutPreview.findIndex((n) => n.category === "initial");
      if (initialIdx >= 0) {
        const cur = withoutPreview[initialIdx];
        if (trimmedGoal === (cur.description || "").trim()) {
          return prev;
        }
        return withoutPreview.map((node, i) =>
          i === initialIdx
            ? {
                ...node,
                description: trimmedGoal,
                status: "in_progress" as const,
                pulseToken: pulseTok,
                animation: { entrance: "bounce", delay: 0 },
              }
            : node,
        );
      }
      const local: IntelligentNode = {
        id: BUILDER_LOCAL_GOAL_PREVIEW_ID,
        label: "Marketing goal",
        description: trimmedGoal,
        category: "initial",
        status: "in_progress",
        x: 300,
        y: 240,
        dependencies: [],
        connectsTo: [],
        animation: { entrance: "bounce", delay: 0 },
        pulseToken: pulseTok,
      };
      return [...withoutPreview, local];
    });

    try {
      let body: string;
      try {
        body = JSON.stringify({
          messages: conversationHistory.current,
          currentNodes: sanitizeCanvasNodesForChat(nodesRef.current),
          communityId: communityId || undefined,
          agentType,
          agentBlueprint,
          uploadedImageUrl: latestUploadedUrl || undefined,
          chatModel,
          // Pre-mint project identity: lets the route store standing orders from this
          // conversation against THIS agent (never a shared bucket) before it's minted.
          sessionId: persistedSessionId || undefined,
        });
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-err`,
            text: "Could not send canvas state to the assistant. Try refreshing the page.",
            sender: "ai",
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      type ChatData = {
        message?: string; error?: string; actions?: unknown[];
        clientActions?: ClientAction[]; campaignBlueprint?: CampaignBlueprint;
        agentBlueprint?: AgentBlueprint; agentChain?: BuilderAgentChain;
        website?: { title?: string; siteName?: string } | null; builderPhase?: BuilderPhase;
        agentActions?: Array<{ type: string; [k: string]: unknown }>;
      };

      // Applies all state updates from a completed API response
      const applyData = (data: ChatData, finalText: string) => {
        setClientActions(Array.isArray(data.clientActions) ? data.clientActions : []);
        setCampaignBlueprint(data.campaignBlueprint && typeof data.campaignBlueprint === "object" ? data.campaignBlueprint : {});
        setAgentChain(data.agentChain && typeof data.agentChain === "object" ? data.agentChain : null);
        if (data.builderPhase) setAgentPhase(data.builderPhase);
        // (Removed) The persona used to be auto-duplicated into Second Brain here
        // with a "Persona saved to Second Brain" announcement. The persona already
        // lives on the draft/questionnaire that every generation reads — the extra
        // memory node was noise that polluted video-generation context, and the
        // announcement confused operators. savePersonaToBrain stays available for
        // any explicit save action.
        setBuilderPhase(data.builderPhase === "goal_capture" || data.builderPhase === "context_building" || data.builderPhase === "campaign_ready" ? data.builderPhase : null);
        if (data.agentBlueprint && typeof data.agentBlueprint === "object") {
          setAgentBlueprint((prev) => withStickyMint(prev, data.agentBlueprint as AgentBlueprint));
          const newBp = data.agentBlueprint as AgentBlueprint;
          // When trader enters aesthetic phase, inject the choice card (describe vs upload).
          // Never auto-generate — user must explicitly choose how their portrait looks.
          if (
            agentType === "trader" &&
            avatarGenStage === "idle" &&
            newBp.trader?.name &&
            !newBp.avatarsGenerated &&
            data.builderPhase === "trader_aesthetic"
          ) {
            setTimeout(() => {
              setMessages((prev) => {
                if (prev.some((m) => m.needsAestheticChoice)) return prev;
                return [...prev, {
                  id: `${Date.now()}-aesthetic-choice`,
                  text: "",
                  sender: "ai" as const,
                  timestamp: new Date(),
                  needsAestheticChoice: true,
                }];
              });
            }, 300);
          }
          // When the influencer reaches the reference-photo step, surface a clear
          // upload button card so the user knows exactly how to provide photos.
          if (
            agentType === "influencer" &&
            avatarGenStage === "idle" &&
            data.builderPhase === "aesthetic_upload" &&
            !newBp.avatarsGenerated &&
            referenceImages.length === 0
          ) {
            setTimeout(() => {
              setMessages((prev) => {
                if (prev.some((m) => m.needsImageUpload)) return prev;
                return [...prev, {
                  id: `${Date.now()}-image-upload`,
                  text: "",
                  sender: "ai" as const,
                  timestamp: new Date(),
                  needsImageUpload: true,
                }];
              });
            }, 300);
          }
          // Clipping mirrors the trader flow: one cover image, generated from a
          // typed idea OR an uploaded photo (no face/portrait pipeline). When the
          // AI marks the config ready (awaiting_mint), surface the describe-vs-upload
          // choice card; image-gen + the mint card follow (see triggerAvatarGeneration).
          if (
            agentType === "clipping" &&
            avatarGenStage === "idle" &&
            newBp.agentStatus === "awaiting_mint" &&
            !newBp.avatarsGenerated &&
            !newBp.mintCompleted
          ) {
            setTimeout(() => {
              setMessages((prev) => {
                if (prev.some((m) => m.needsAestheticChoice || m.needsMint)) return prev;
                const clippingName = (newBp as AgentBlueprint & { persona?: { name?: string } })?.persona?.name ?? "your clipper";
                return [
                  ...prev,
                  {
                    id: `${Date.now()}-clip-cover-intro`,
                    text: `**${clippingName} is configured.** Pick a cover image for the on-chain identity — describe the look or upload one — then mint on Solana — normally **$50**, **FREE** right now (launch promo) — to start clipping.`,
                    sender: "ai" as const,
                    timestamp: new Date(),
                  },
                  {
                    id: `${Date.now()}-clip-aesthetic`,
                    text: "",
                    sender: "ai" as const,
                    timestamp: new Date(),
                    needsAestheticChoice: true,
                  },
                ];
              });
            }, 300);
          }
        }
        if (data.agentBlueprint?.agentStatus === "ready" && agentType === "influencer") {
          const blueprint = (data.agentBlueprint ?? agentBlueprint) as AgentBlueprint;
          setAgentSkillDefs(generateAgentSkills(blueprint.persona));
          void saveAgentMemoryFiles(blueprint, sessionIdRef.current ?? "");
        }
        if (agentType === "influencer" && agentBlueprint?.mintCompleted && agentBlueprint?.mintAddress && sessionIdRef.current) {
          const latestPersona = (data.agentBlueprint as AgentBlueprint | undefined)?.persona ?? agentBlueprint.persona;
          void fetch("/api/builder/save-state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionIdRef.current, creatorWallet: publicKey?.toBase58(), agentType: "influencer", persona: latestPersona, avatarUrls: nftAvatarUrls, characterBible, mintAddress: agentBlueprint.mintAddress }) }).catch(() => {});
        }
        if (agentType === "influencer" && agentBlueprint?.mintCompleted && sessionIdRef.current && finalText.trim().length > 20) {
          const sid = sessionIdRef.current;
          const personaName = agentBlueprint?.persona?.name ?? "Agent";
          const niche = agentBlueprint?.persona?.niche ?? "influencer";
          const userAnswer = latestRequestText.trim();
          // Relevance gate: only durable knowledge is kept, and it's consolidated
          // into canonical nodes rather than spawning one node per chat turn.
          const turn = classifyChatTurn(userAnswer);

          if (turn.kind === "reference") {
            // Fold every link in the message into ONE "References" node (deduped).
            const allUrls = Array.from(userAnswer.matchAll(/https?:\/\/[^\s)\]}>"']+/gi), (m) => m[0]);
            for (const url of allUrls) {
              let host = url;
              try { host = new URL(url).hostname.replace("www.", ""); } catch { /* keep raw url */ }
              upsertBrainNode({
                sessionId: sid,
                localId: `refs-${sid}`,
                title: `${personaName} — References & Inspiration`,
                category: "knowledge",
                tags: ["references", "inspiration", niche],
                header: `# References & Inspiration\n_Links and videos ${personaName} studies for format and style._\n`,
                bullet: referenceBullet(url, host),
              });
            }
            // Video links still get a deep transcript node (already deduped per URL).
            const videoUrlPattern = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch[^\s]+|youtu\.be\/[^\s]+|tiktok\.com\/[^\s]+|instagram\.com\/(?:reel|p|tv)\/[^\s]+|vimeo\.com\/[^\s]+|twitter\.com\/[^\s]+\/status\/[^\s]+|x\.com\/[^\s]+\/status\/[^\s]+))/gi;
            for (const m of userAnswer.matchAll(videoUrlPattern)) {
              void fetch("/api/transcribe-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid, videoUrl: m[0], personaName }) }).catch(() => {});
            }
          } else if (turn.kind === "note") {
            // Durable fact / preference → one growing "Conversation Notes" node.
            upsertBrainNode({
              sessionId: sid,
              localId: `notes-${sid}`,
              title: `${personaName} — Conversation Notes`,
              category: "knowledge",
              tags: ["conversation", "notes", niche],
              header: `# Conversation Notes\n_Durable facts and preferences ${personaName} learned from chat._\n`,
              bullet: turn.text.slice(0, 280),
            });
          }
          // turn.kind === "skip" → acknowledgement / chit-chat, nothing saved.
        }
        setWebsiteTitle(typeof data.website?.siteName === "string" ? data.website.siteName : typeof data.website?.title === "string" ? data.website.title : "");
        if (data.agentChain?.interactionMode === "agency_agentic" && data.campaignBlueprint && typeof data.campaignBlueprint === "object" && ((data.campaignBlueprint as CampaignBlueprint).summary || (data.campaignBlueprint as CampaignBlueprint).community?.name || (data.campaignBlueprint as CampaignBlueprint).product?.name || (data.campaignBlueprint as CampaignBlueprint).campaign?.name)) {
          setIsResultDrawerOpen(true);
        }
        if (Array.isArray(data.actions) && data.actions.length > 0) {
          setNodes((prev) => {
            const localGoalNode = prev.find((node) => node.id === BUILDER_LOCAL_GOAL_PREVIEW_ID);
            const next = applyCanvasActions(prev.filter((n) => n.id !== BUILDER_LOCAL_GOAL_PREVIEW_ID), data.actions as CanvasAction[]);
            const clearsCanvas = (data.actions as CanvasAction[]).some((a) => a.type === "CLEAR_CANVAS");
            if (clearsCanvas || !localGoalNode || next.some((n) => n.category === "initial")) return next;
            return [localGoalNode, ...next];
          });
        }

        // ── EXECUTE AGENT ACTIONS — tool calls the AI returned ───────────────
        const aiActions = Array.isArray(data.agentActions) ? data.agentActions : [];

        // ── CLIENT-SIDE FALLBACK: detect video intent ─────────────────────────
        // Three paths to fire create_video without the LLM emitting the action:
        //  1. User's current message clearly asks for a video (verb + noun)
        //  2. User affirmed a video offer from the AI's PREVIOUS message
        //  3. The AI's current response describes video work it's "about to do"
        //     but forgot the action JSON
        // Never run intent fallbacks on a failed turn. When the backend timed out /
        // errored, data.message is an error string — scraping it was exactly what
        // fired a paid create_video about "the full kie response".
        const turnFailed = Boolean(data.error) || isBackendErrorText(data.message ?? finalText ?? "");
        if (agentType === "influencer" && agentBlueprint?.mintCompleted && !turnFailed) {
          const userText = latestRequestText.toLowerCase();

          // ── Disambiguate VIDEO SETTINGS vs. CONTENT (priority: settings) ──────
          // "make her videos commercial style / cinematic camera / moody grade" is
          // a Director CONFIG change, NOT a request to render a video. We detect it
          // BEFORE the create_video fallback so a phrase containing "videos"+"make"
          // doesn't fire a paid render and drop the settings. A request with an
          // explicit topic ("a video ABOUT x") is content, so it stays create_video.
          const vIntent = deriveVideoDirectorIntent(latestRequestText);
          // Topic markers that signal a CONTENT request ("a video about/of X").
          // Deliberately excludes "on"/"for" — those usually mark a platform/brand
          // ("for tiktok", "on instagram"), not a video topic.
          const vHasTopic = /\b(about|regarding|featuring|showing)\b\s+\S/.test(userText)
            || /\bvideo\s+of\s+\S/.test(userText);
          const vSettingVocab = /(commercial|\bugc\b|talking head|\bvlog\b|tutorial|ootd|asmr|b-?roll|cinematic|gimbal|handheld|selfie|tripod|moody|vibrant|colou?r ?grade|\bgrade\b|aspect|vertical|landscape|portrait|\bsquare\b|engine|\bveo\b|seedance|kling|grok|gemini ?omni|\bomni\b|\bstyle\b|camera|\blook\b|aesthetic|director|cadence|captions?|subtitles?|\bbudget\b|per day|videos? a day|\bseconds?\b)/i.test(latestRequestText);
          const isVideoSettingsRequest = !!(vIntent.videoConfig || vIntent.videoEngine) && vSettingVocab && !vHasTopic;

          // Most recent GENUINE AI prose — skip status/error/system bubbles (they
          // start with status emoji or are backend errors). A real video offer is
          // conversational text, never a "🎬 On it…" / "⚠ …" status line.
          const prevAiText = (() => {
            const msgs = messagesRef.current ?? [];
            for (let i = msgs.length - 1; i >= 0; i--) {
              const t = msgs[i].text ?? "";
              if (msgs[i].sender !== "ai" || t.length === 0) continue;
              if (isBackendErrorText(t)) continue;
              if (/^\s*[🎬💸⚠✅🔌🔍📨ℹ🔎📌]/u.test(t)) continue; // status bubble, not prose
              return t.toLowerCase();
            }
            return "";
          })();

          // A REAL video word MUST be present. "post"/"drop"/"do" alone are NOT
          // video — they are almost always social-post intents (that misfire bug
          // is exactly why "post something on threads" was making a video).
          // "tiktok" and "short" were REMOVED from this noun list — they're a
          // platform name and a generic adjective, not a content-request signal,
          // and paired with any of the broad verbs below they fired on completely
          // unrelated messages: "post budget for tiktok ads", "launch a new short
          // campaign", "drop tiktok in favor of instagram", "record a short survey
          // response" — none of these are video requests. This list now matches
          // the server system prompt's own (already-conservative) trigger-word set
          // (INFLUENCER_SYSTEM_PROMPT in lib/builder/agentTypes.ts: "video, reel,
          // clip, film, shoot, footage") — the two had drifted apart, and the
          // client fallback was the looser, over-firing one.
          const hasVideoNoun  = /\b(video|reel|clip|film|shoot|footage)\b/.test(userText);
          const hasVideoVerb  = /\b(make|create|generate|gen|drop|shoot|film|record|produce|launch|post)\b/.test(userText);
          // "post the latest/last/recent/existing video to X" = PUBLISH an already
          // generated video — never create a new one. This must override the
          // create-video heuristic (the word "video" is present, but the intent is
          // to post, not to make).
          const hasPostVerbEarly = /\b(post|share|publish|upload|put up|send|drop)\b/.test(userText);
          const refersExistingVideo =
            /\b(latest|last|recent|previous|existing|prior|that|this|my|the)\b[\s\w'’]{0,24}\b(video|reel|clip|short)\b/.test(userText) ||
            /\b(video|reel|clip)\b[\s\w'’]{0,16}\b(i|we|you)\s+(made|created|generated|posted|did|just)\b/.test(userText);
          const wantsPostExistingVideo = hasPostVerbEarly && refersExistingVideo;
          const userAskedForVideo = hasVideoNoun && hasVideoVerb && !wantsPostExistingVideo;

          // Confirmation detector — short affirmative reply after AI offered a video
          const isAffirmative = /^(yes|yeah|yep|yup|sure|ok|okay|go|do it|please|proceed|let's go|lets go|start|begin|make it|go ahead|sounds good)\b/i.test(latestRequestText.trim()) || /^\s*(y|do|go)\s*$/i.test(latestRequestText.trim());
          const prevAiOfferedVideo = /\b(video|reel|tiktok|clip|short)\b/.test(prevAiText) && /\b(make|create|generate|do|drop|build|shoot|film|want|should i|shall i|ready)\b/.test(prevAiText);

          const alreadyEmittedVideo = aiActions.some(a => a.type === "create_video");
          const alreadyEmittedPost  = aiActions.some(a => a.type === "post_to_social");

          // ── VIDEO fallback — fires ONLY on an explicit signal:
          //   1. the user's CURRENT message clearly asks for a video, or
          //   2. a short "yes" right after the AI's previous turn offered one.
          // We deliberately DROPPED the old "AI is describing video work" trigger —
          // the model merely mentioning a video (or echoing an error) must never
          // auto-spend the agent wallet. If the model wants a video it emits the
          // create_video action itself (handled above as alreadyEmittedVideo).
          if (!alreadyEmittedVideo && !isVideoSettingsRequest && (userAskedForVideo || (isAffirmative && prevAiOfferedVideo))) {
            const extract = (txt: string) => txt.match(/(?:about|on|of|for|on the topic of)\s+["'']?(.{3,80}?)["'']?(?:[.!?,]|$| with | using | now | today)/i)?.[1]?.trim();
            // Was slice(0, 80) on the whole-message fallback — silently mangled any
            // real idea/example/script the operator pasted into chat before it ever
            // became `topic`. generateFittedScript already treats `topic` as
            // HIGHEST PRIORITY operator direction and forbids the persona from
            // substituting a generic take (lib/server/videoScript.ts:237-238), and
            // it rides verbatim into the storyboard + KIE clip prompts' TOPIC line
            // (lib/server/kie-video-pipeline.ts) — so that steering already works
            // end-to-end. The 80-char cut here was the actual bottleneck, not the
            // script LLM: a pasted script/example never reached that pipeline
            // intact. Raised to a generous cap so a real script/example survives.
            // A substantial message (a pasted script, a worked example, a detailed
            // brief) is used WHOLE rather than run through `extract()` first — that
            // regex only grabs the phrase up to the first "." / "with" / "using",
            // so "about coffee, here's the script: <500 words>" was extracting just
            // "coffee" and dropping the actual script it was asked to follow.
            const longMessage = latestRequestText.trim().length > 150 ? latestRequestText.trim().slice(0, 1200) : undefined;
            const rawTopic =
              longMessage ??
              extract(userText) ??
              extract(prevAiText) ??
              (userAskedForVideo ? latestRequestText.trim().slice(0, 1200) : undefined);
            // Reject anything scraped from leaked error/system text as a topic.
            const topic = rawTopic && !isBackendErrorText(rawTopic) ? rawTopic : "the agent's content pillars";
            console.log(`[fallback] auto-dispatching create_video — topic="${topic}"`);
            aiActions.push({ type: "create_video", topic });
          }

          // ── VIDEO-DIRECTOR settings — apply the parsed config/engine. Takes
          // PRIORITY over create_video: if the model also emitted a create_video
          // for this settings phrase, strip it so we never start an unwanted render.
          if (isVideoSettingsRequest) {
            for (let i = aiActions.length - 1; i >= 0; i--) {
              if (aiActions[i].type === "create_video") aiActions.splice(i, 1);
            }
            const hasCfg = aiActions.some((a) => a.type === "set_video_config");
            const hasEng = aiActions.some((a) => a.type === "set_video_engine");
            if (vIntent.videoConfig && !hasCfg) aiActions.push({ type: "set_video_config", videoConfig: vIntent.videoConfig });
            if (vIntent.videoEngine && !hasEng) aiActions.push({ type: "set_video_engine", videoEngine: vIntent.videoEngine });
            if (vIntent.summary.length) console.log("[video-director]", vIntent.summary.join(" · "));
          }

          // ── POST fallback — social-post intent (no video word) → post_to_social.
          // Fires even when the model timed out / forgot the action. The post_content
          // executor WRITES the copy from the agent's knowledge when content is empty,
          // so the agent still posts on-brand text without the chat model.
          if (!alreadyEmittedVideo && !alreadyEmittedPost && !userAskedForVideo && !wantsPostExistingVideo) {
            const hasPostVerb = /\b(post|share|tweet|publish|upload|put up)\b/.test(userText);
            const platMatch = userText.match(/\b(threads?|tiktok|instagram|insta|ig|youtube|facebook|fb|linkedin|twitter|x)\b/);
            if (hasPostVerb && platMatch) {
              const map: Record<string, string> = { thread: "threads", threads: "threads", tiktok: "tiktok", instagram: "instagram", insta: "instagram", ig: "instagram", youtube: "youtube", facebook: "facebook", fb: "facebook", linkedin: "linkedin", twitter: "x", x: "x" };
              const platform = map[platMatch[1]] ?? platMatch[1];
              console.log(`[fallback] auto-dispatching post_to_social — platform="${platform}" (copy generated server-side)`);
              aiActions.push({ type: "post_to_social", platforms: [platform], contentType: "text", content: "" });
            }
          }

          // ── POST EXISTING VIDEO — "post the latest video to <platform>" ───────
          // Publish an already-generated video; never regenerate. Strip any
          // create_video the model wrongly emitted for this intent.
          if (wantsPostExistingVideo) {
            for (let i = aiActions.length - 1; i >= 0; i--) {
              if (aiActions[i].type === "create_video") aiActions.splice(i, 1);
            }
            if (!aiActions.some((a) => a.type === "post_to_social")) {
              const pm = userText.match(/\b(threads?|tiktok|instagram|insta|ig|youtube|facebook|fb|linkedin|twitter|x)\b/);
              const map: Record<string, string> = { thread: "threads", threads: "threads", tiktok: "tiktok", instagram: "instagram", insta: "instagram", ig: "instagram", youtube: "youtube", facebook: "facebook", fb: "facebook", linkedin: "linkedin", twitter: "x", x: "x" };
              const platform = pm ? (map[pm[1]] ?? pm[1]) : undefined;
              console.log(`[fallback] post latest video → platform="${platform ?? "(ask)"}"`);
              aiActions.push({ type: "post_to_social", platforms: platform ? [platform] : [], contentType: "video", useLatestVideo: true });
            }
          }

          // ── FUND fallback — "fund / top up / add $X to the wallet" → fund_wallet.
          // Fires only on a clear funding verb + a wallet/balance/token target, so
          // it never collides with post/video intents.
          const alreadyEmittedFund = aiActions.some(a => a.type === "fund_wallet");
          if (!alreadyEmittedFund) {
            const hasFundVerb = /\b(fund|top[\s-]?up|topup|deposit|recharge|load up|add (?:some |more )?(?:funds?|money|usdc|sol|balance))\b/.test(userText);
            const hasWalletTarget = /\b(wallet|balance|funds?|usdc|sol|runway|gas)\b/.test(userText);
            if (hasFundVerb && hasWalletTarget) {
              const amtMatch = userText.match(/(\d+(?:\.\d+)?)/);
              const token = /\bsol\b/.test(userText) ? "SOL" : "USDC";
              console.log(`[fallback] auto-dispatching fund_wallet — token=${token} amount=${amtMatch?.[1] ?? "(recommend)"}`);
              aiActions.push({ type: "fund_wallet", token, ...(amtMatch ? { amount: Number(amtMatch[1]) } : {}) });
            }
          }
        }

        // ── AI Clippers only clip: drop any original-video render the chat model
        // emitted for a clipper (run-task refuses it too). Clipping happens via
        // clip_source / join_clip_campaign below.
        if (agentType === "clipping") {
          for (let i = aiActions.length - 1; i >= 0; i--) {
            if (aiActions[i].type === "create_video") {
              console.log("[clipper] dropped create_video — clippers clip sources, they don't generate videos");
              aiActions.splice(i, 1);
            }
          }
        }

        // ── CLIP fallback — a minted clipping agent handed a video URL must clip,
        // regardless of what the chat model said. The real work is the server
        // pipeline (clip_source → run-task → clipJobs); the model frequently
        // refuses or forgets the action, so we never depend on it to start a job.
        if (agentType === "clipping" && agentBlueprint?.mintCompleted && !turnFailed) {
          const urlMatch = latestRequestText.match(/https?:\/\/[^\s)<>"']+/i);
          const alreadyClip = aiActions.some((a) => a.type === "clip_source" || a.type === "join_clip_campaign");
          if (urlMatch && !alreadyClip) {
            aiActions.push({ type: "clip_source", sourceUrl: urlMatch[0] });
          }
          // No link but a clear "clip / upload my video" ask → the Clipping tab.
          const lowered = latestRequestText.toLowerCase();
          const wantsClipping = !urlMatch && /\b(upload|clip|cut)\b/.test(lowered) && /\b(video|vid|file|podcast|footage|my own|mine)\b/.test(lowered);
          if (wantsClipping && !aiActions.some((a) => a.type === "open_clipping" || a.type === "clip_source")) {
            aiActions.push({ type: "open_clipping", upload: /\bupload\b/.test(lowered) });
          }
        }

        if (aiActions.length > 0) {
          if (agentType === "trader" || agentType === "clipping") void executeAgentActions(aiActions);
          else if (agentType === "influencer") void executeInfluencerActions(aiActions);
        }
      };

      // ── Streaming SSE path (Kie Gemini) ───────────────────────────────────────
      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        const streamMsgId = `${Date.now()}-ai-stream`;
        // Empty text = loading bars render in the message bubble (existing isGeneratingAvatars-style treatment)
        setMessages((prev) => [...prev, { id: streamMsgId, text: "", sender: "ai" as const, timestamp: new Date(), isGeneratingAvatars: true }]);

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accText = "";
        let sseBuffer = "";
        let firstToken = true;

        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              sseBuffer += decoder.decode(value, { stream: true });
              const lines = sseBuffer.split("\n");
              sseBuffer = lines.pop() ?? "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                try {
                  const event = JSON.parse(trimmed.slice(5).trim()) as { t?: string; done?: boolean; meta?: ChatData; err?: string };
                  if (event.t) {
                    if (firstToken) {
                      // First token arrived — stop showing loading state, start typing
                      firstToken = false;
                      setMessages((prev) => prev.map((m) => m.id === streamMsgId ? { ...m, isGeneratingAvatars: false } : m));
                    }
                    accText += event.t;
                    setMessages((prev) => prev.map((m) => m.id === streamMsgId ? { ...m, text: accText } : m));
                  } else if (event.done && event.meta) {
                    // meta.message is authoritative — snap the bubble to it (covers
                    // buffered-fallback turns where nothing streamed live, and any
                    // server-side post-processing that changed the text).
                    const finalMsg = typeof event.meta.message === "string" && event.meta.message.trim()
                      ? event.meta.message
                      : accText;
                    if (finalMsg && finalMsg !== accText) {
                      setMessages((prev) => prev.map((m) => m.id === streamMsgId ? { ...m, text: finalMsg } : m));
                    }
                    // Never feed backend-error bubbles back into the conversation —
                    // doing so let the video-intent heuristic scrape error text
                    // ("the full kie response") and fire a paid create_video.
                    if (!isBackendErrorText(finalMsg)) {
                      conversationHistory.current.push({ role: "assistant", content: finalMsg });
                    }
                    applyData(event.meta, isBackendErrorText(finalMsg) ? "" : finalMsg);
                  } else if (event.err) {
                    setMessages((prev) => prev.map((m) => m.id === streamMsgId ? {
                      ...m, isGeneratingAvatars: false, text: `Something went wrong: ${event.err}`
                    } : m));
                  }
                } catch { /* skip malformed SSE event */ }
              }
            }
          } finally {
            reader.releaseLock();
            // Ensure loading state is cleared even if stream ends without tokens
            setMessages((prev) => prev.map((m) => m.id === streamMsgId ? { ...m, isGeneratingAvatars: false } : m));
          }
        }
      } else {
        // ── JSON fallback (OpenAI) ───────────────────────────────────────────────
        const raw = await res.text();
        let data: ChatData = {};
        try { data = raw ? (JSON.parse(raw) as ChatData) : {}; } catch { data = {}; }

        const aiText =
          (typeof data.message === "string" && data.message.trim() ? data.message : null) ??
          (typeof data.error === "string" && data.error.trim() ? data.error : null) ??
          (!res.ok ? `Something went wrong (${res.status}). Please try again.` : "Let me help you build this.");

        const aiBlocks = splitAiIntoBubbles(aiText);
        if (aiBlocks.length > 1) {
          for (let i = 0; i < aiBlocks.length; i += 1) {
            setMessages((prev) => [...prev, { id: `${Date.now()}-ai-${i}`, text: aiBlocks[i], sender: "ai", timestamp: new Date() }]);
            if (i < aiBlocks.length - 1) await sleep(AI_MULTI_BUBBLE_DELAY_MS);
          }
        } else {
          setMessages((prev) => [...prev, { id: `${Date.now()}-ai`, text: aiText, sender: "ai", timestamp: new Date() }]);
        }
        if (!isBackendErrorText(aiText)) {
          conversationHistory.current.push({ role: "assistant", content: aiText });
        }
        applyData(data, isBackendErrorText(aiText) ? "" : aiText);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Network error";
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-err`,
          text: `Could not reach the assistant (${detail}). Check your connection and try again.`,
          sender: "ai",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsProcessing(false);
      // Scope the uploaded reference image to THIS single turn. It was captured
      // into the request body above (uploadedImageUrl: latestUploadedUrl) before
      // the await, so this turn still sees it — but clearing it now prevents the
      // full base64 image from being re-sent (and re-injected by
      // injectVisionIntoMessages) on every subsequent chat turn, which bloats the
      // request and corrupts the Claude content path ("returned empty content").
      // Avatar generation reads referenceImages / explicit args, not this value,
      // so it is unaffected.
      setLatestUploadedUrl("");
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
    }
  }, [inputText, isProcessing, communityId, agentType, agentBlueprint, latestUploadedUrl, agentChain?.interactionMode, nftAvatarUrls, messages, chatModel, setSubmissionLink, regenerateVideoScriptCard, resumeMintAddress]);

  const triggerAvatarGeneration = useCallback(async (imagesRaw: string[], aestheticOverride?: string) => {
    // Bound every reference photo to a small JPEG BEFORE it's sent to any image
    // API. Full-res uploads (or images restored from a session / the studio handoff)
    // can be several MB each; three of them overflow the request body limit on
    // /api/generate-nft-images, truncating the JSON body → "Unterminated string in
    // JSON" → 500 → "Avatar generation failed". Compressing here guarantees a small
    // payload no matter how the images entered state. Fail-open (keeps originals).
    const images = await Promise.all(imagesRaw.map((u) => compressImageDataUrl(u)));
    const genMsgId = `${Date.now()}-avgen`;
    // Always read from ref — avoids stale closure bugs for traders whose blueprint
    // updates frequently during the strategy chat before generation is triggered.
    const currentBlueprint = agentBlueprintRef.current;
    const persona = currentBlueprint?.persona;
    const trader = currentBlueprint?.trader;
    const isTrader = agentType === "trader";
    const isClipping = agentType === "clipping";
    // Both trader and clipper use the single-cover-image flow (1 image, describe
    // or upload — no 3-angle character bible).
    const isSingleImage = isTrader || isClipping;
    // Display name + niche source differs: trader keeps it on `trader`, the
    // clipper keeps it on `persona`.
    const singleName = isClipping ? (persona?.name ?? "your clipper") : (trader?.name ?? "your trader");

    setAvatarGenStage("generating");
    setMessages((prev) => [
      ...prev,
      {
        id: genMsgId,
        text: isSingleImage
          ? `Generating ${singleName}'s cover image…`
          : "Analyzing your photo and locking character consistency — your original + 2 generated angles…",
        sender: "ai" as const,
        timestamp: new Date(),
        isGeneratingAvatars: true,
      },
    ]);

    // ── SINGLE-IMAGE PATH (trader + clipper): one image, no character-bible, ship mint card fast.
    if (isSingleImage) {
      try {
        const refDataUrl = images[0];
        const parsedRef = parseDataUrlRef(refDataUrl);
        // aestheticOverride is the user's direct description from the choice card — always use it first
        const rawAesthetic = aestheticOverride ?? trader?.aesthetic ?? trader?.summary ?? "";
        const fallbackVibe = isClipping
          ? `${persona?.niche ?? "viral short-form"} clip producer — bold, energetic, modern`
          : `${trader?.strategy?.assetUniverse?.[0] ?? "Solana"} AI trading agent — sleek, confident, futuristic`;
        const aesthetic = rawAesthetic.trim().length >= 3 ? rawAesthetic.trim() : fallbackVibe;

        // Build ONE cover prompt from the aesthetic + agent context. The dedicated
        // trader image route (under app/api/trader) was DELETED with the trader
        // product, so this path used to 404 → an HTML error page → a raw `.json()`
        // crash ("Unexpected token '<'") on EVERY clip-agent avatar attempt. Reuse
        // the working, timeout-safe create+collect flow (/api/generate-nft-images)
        // that the influencer path uses. We only need one cover, so we omit
        // prompt_2 — the route then renders a single frame (one KIE task, not two).
        // Clippers get a richer, more "designful" art-directed prompt so the
        // generated PFP feels like a fun, collectible avatar built around the
        // operator's own description — not a generic stock portrait. Traders keep
        // the sleeker, more serious cover treatment.
        const coverPrompt = isClipping
          ? [
              `Design a vibrant, collectible profile-picture (PFP) style NFT avatar for "${singleName}", a ${persona?.niche ?? "viral short-form"} clip creator.`,
              `Character & vibe (make THIS the star — lean into every detail): ${aesthetic}.`,
              `Treat it like a premium, playful mascot/avatar you'd proudly set as your profile photo: one bold, expressive character with a strong readable silhouette, centered hero portrait, confident personality and a fun facial expression.`,
              `Art direction: punchy saturated color palette with 1-2 striking accent colors, dynamic rim + cinematic key lighting, soft glow and clean depth, subtle graphic/motion accents that hint at short-form video culture (sparkles, speed lines, halftone or gradient shapes) without cluttering the frame.`,
              `Polished poster-grade illustration, crisp edges, tasteful background that complements the character, eye-catching and instantly shareable.`,
              `Ultra-detailed, high quality, sharp focus. No text, no logos, no watermark, no borders.`,
            ].join(" ")
          : `NFT cover portrait for ${singleName}, a ${persona?.niche ?? "viral short-form"} trading agent. Visual style: ${aesthetic}. Bold, energetic, modern, cinematic lighting, ultra-detailed, high quality.`;

        // Every fetch is parsed DEFENSIVELY: a dead/HTML response (e.g. a 404 page)
        // must degrade to a friendly "service busy" message, never a raw
        // `Unexpected token '<'` JSON crash.
        const BUSY = "The image service is busy — please retry in a moment.";
        const readGenJson = async (r: Response): Promise<unknown> => {
          let raw = "";
          try { raw = await r.text(); } catch { return null; }
          const ct = r.headers.get("content-type") ?? "";
          if (!ct.includes("application/json") && !/^\s*[[{]/.test(raw)) return null;
          try { return JSON.parse(raw); } catch { return null; }
        };
        // Route is auth-gated (spends KIE credits) — attach the session bearer so
        // the logged-in operator passes requireInternalOrUserAuth.
        const genAuthHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        };

        // ── CREATE ── kick off the render task(s), return immediately with ids.
        const genCreateRes = await fetch("/api/generate-nft-images", {
          method: "POST",
          headers: genAuthHeaders,
          body: JSON.stringify({
            // prompt_2 intentionally omitted — single-image render (1 KIE task).
            prompt_1: coverPrompt,
            // Send the uploaded reference photo if the operator provided one.
            ...(parsedRef
              ? {
                  referenceImages: [{ data: parsedRef.base64, mimeType: parsedRef.mimeType }],
                  referenceImageBase64: parsedRef.base64,
                  referenceImageMime: parsedRef.mimeType,
                }
              : {}),
          }),
        });
        const genCreated = (await readGenJson(genCreateRes)) as
          | { ok?: boolean; tasks?: Array<{ taskId: string; label: string }>; refImageUrls?: string[]; error?: string }
          | null;
        if (!genCreateRes.ok || !genCreated) {
          throw new Error(genCreated?.error ?? (genCreateRes.status >= 500 ? BUSY : `Image generation failed (${genCreateRes.status})`));
        }
        if (genCreated.error) throw new Error(genCreated.error);
        const genTasks = genCreated.tasks ?? [];
        if (genTasks.length === 0) throw new Error("No render task was created — please retry.");
        const genRefUrls = genCreated.refImageUrls ?? [];
        if (genRefUrls.length) hostedFaceRefsRef.current = genRefUrls;

        // ── COLLECT (poll) ── every few seconds until the first image is ready or
        // the ~4-min client deadline elapses. Defensive parse → HTML/5xx proxy
        // blips just retry instead of crashing.
        type SingleGenResult = {
          ok: boolean;
          images?: Array<{ url: string; rawUrl?: string; label: string }>;
          error?: string;
        };
        const genDeadline = Date.now() + 4 * 60 * 1000;
        let resolvedCoverUrl: string | undefined;
        while (Date.now() < genDeadline) {
          await new Promise((r) => setTimeout(r, 4000));
          const genCollectRes = await fetch("/api/generate-nft-images/collect", {
            method: "POST",
            headers: genAuthHeaders,
            body: JSON.stringify({ tasks: genTasks, refImageUrls: genRefUrls }),
          });
          const genCollected = (await readGenJson(genCollectRes)) as (SingleGenResult & { pending?: boolean }) | null;
          if (!genCollectRes.ok || !genCollected) {
            // HTML/5xx proxy blip → keep polling until the deadline; don't crash.
            setMessages((prev) => prev.map((m) => m.id === genMsgId ? { ...m, text: `Still generating ${singleName}'s cover image…` } : m));
            continue;
          }
          if (genCollected.error || genCollected.ok === false) {
            throw new Error(genCollected.error ?? "Image generation failed");
          }
          const first = genCollected.images?.[0];
          if (first && (first.url || first.rawUrl)) { resolvedCoverUrl = first.url || first.rawUrl; break; }
          // pending → keep waiting
          setMessages((prev) => prev.map((m) => m.id === genMsgId ? { ...m, text: `Still generating ${singleName}'s cover image…` } : m));
        }
        if (!resolvedCoverUrl) throw new Error("Image generation is taking longer than expected — please retry.");
        // const alias so the setTimeout / save-draft closures below see a narrowed
        // `string` rather than the mutable `let` (which TS widens back to string|undefined).
        const coverUrl: string = resolvedCoverUrl;

        // Save the URL into state so the mint card can use it
        setNftAvatarUrls([coverUrl]);
        setAvatarGenStage("done");

        // Mark avatars as generated so server-side phase detection advances → mint
        setAgentBlueprint((prev) => ({
          ...prev,
          avatarsGenerated: true,
          agentStatus: "awaiting_mint",
        }));

        // Update the generation message to show the image
        setMessages((prev) => prev.map((m) => m.id === genMsgId ? {
          ...m,
          isGeneratingAvatars: false,
          text: `**${singleName}'s cover is ready.** Review it below — mint to lock identity on-chain (normally $50, FREE during launch promo).`,
          avatars: [{ label: isClipping ? "Clipper" : "Trader", style: agentType, url: coverUrl, prompt: "" }],
        } : m));

        // Save draft (single avatar URL) — non-blocking
        const sessionId = sessionIdRef.current ?? "";
        if (sessionId && singleName) {
          void fetch("/api/nft/save-draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              creatorWallet: publicKey?.toBase58(),
              name: singleName,
              handle: undefined,
              niche: isClipping ? (persona?.niche ?? "clipping") : (trader?.strategy?.assetUniverse?.[0] ?? "trading"),
              characterBible: aesthetic,
              avatarDataUris: [coverUrl],
              referencePhotoUrls: hostedFaceRefsRef.current,
            }),
          }).catch(() => undefined);
        }

        // Inject Mint card + Regenerate option — same UX as influencer
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-mint-intro`,
              text: isClipping
                ? `If you like the look, mint ${singleName} on Solana — normally **$50**, **FREE** right now (launch promo). After mint, paste a video URL and it starts clipping.`
                : `If you like the look, mint ${singleName} on Solana — normally **$50**, **FREE** right now (launch promo) — to lock the identity on-chain. After mint, we'll wire up the trading signals.`,
              sender: "ai" as const,
              timestamp: new Date(),
            },
            {
              id: `${Date.now()}-mint-card`,
              text: "",
              sender: "ai" as const,
              timestamp: new Date(),
              needsMint: true,
              needsAvatarChoice: true,
              nftAvatarUrls: [coverUrl],
            },
          ]);
        }, 150);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        setMessages((prev) => prev.map((m) => m.id === genMsgId ? {
          ...m,
          isGeneratingAvatars: false,
          text: `Image generation failed: ${msg}. Try a different aesthetic description or upload a reference photo.`,
        } : m));
        setAvatarGenStage("confirming");
        return;
      }
    }

    // ── INFLUENCER PATH: 3 images + character bible + GIF
    try {
      // Parse the uploaded photos ONCE — these ALWAYS go to Kie as references
      // (works for 1, 2, or 3 images), independent of the analysis step.
      const parsedRefs = images
        .map((dataUrl) => {
          const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          return m ? { data: m[2], mimeType: m[1] } : null;
        })
        .filter((v): v is { data: string; mimeType: string } => v !== null);

      // Best-effort analysis. Gemini vision can time out / error; that must NOT
      // abort generation, because the reference image_input still locks the
      // person. On failure we fall back to deterministic prompts. (This was the
      // root cause of "it generated without my photo / nothing happened".)
      type AnalyzeData = {
        ok?: boolean; character_bible?: string; detected_niche?: string; detected_vibe?: string;
        prompt_1?: string; prompt_2?: string;
        referenceImages?: Array<{ data: string; mimeType?: string }>;
        referenceImageBase64?: string; referenceImageMime?: string; error?: string;
      };
      let analyzeData: AnalyzeData = {};
      try {
        const analyzeRes = await fetch("/api/analyze-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: parsedRefs }),
        });
        if (analyzeRes.ok) {
          const d = (await analyzeRes.json()) as AnalyzeData;
          if (!d.error) analyzeData = d;
        } else {
          console.warn(`[avatar] analyze-images HTTP ${analyzeRes.status} — using fallback prompts`);
        }
      } catch (e) {
        console.warn("[avatar] analyze-images failed — using fallback prompts:", e);
      }

      if (analyzeData.character_bible) setCharacterBible(analyzeData.character_bible);

      // Final prompts: the analyzer's locked prompts when present, else deterministic
      // fallbacks (the image_input reference still locks the actual person).
      const prompt1 = analyzeData.prompt_1 || "NFT portrait of the EXACT person in the reference photos — confident dynamic 3/4 angle, studio key + rim light, cinematic, ultra-detailed, same face and hair.";
      const prompt2 = analyzeData.prompt_2 || "NFT portrait of the SAME person — high top-side camera angle, subject looking up at the camera, dramatic lighting, premium editorial style, identical facial features.";
      // References ALWAYS sent: the analyzer's echoed copy, else the raw uploads.
      const refsForKie = (analyzeData.referenceImages && analyzeData.referenceImages.length > 0)
        ? analyzeData.referenceImages
        : parsedRefs;
      console.log(`[avatar] generating with ${refsForKie.length} reference image(s)`);

      setMessages((prev) => prev.map((m) =>
        m.id === genMsgId
          ? { ...m, text: "Generating 2 NFT shots in parallel (dynamic · top-side)…" }
          : m
      ));

      // Step 2: Generate 3 images with nano-banana-pro — ALWAYS with the uploaded refs.
      // Route is auth-gated (spends KIE credits) — attach the session bearer so
      // the logged-in operator passes requireInternalOrUserAuth.
      // Two-phase to dodge the Railway request-timeout (holding one request open
      // for the whole ~4-min render returned an HTML error page → "Unexpected token
      // '<'"): CREATE kicks off the render task(s) and returns immediately, then we
      // poll /collect until the images are ready. Every fetch is parsed defensively.
      const BUSY = "The image service is busy — please retry in a moment.";
      const readGenJson = async (r: Response): Promise<unknown> => {
        let raw = "";
        try { raw = await r.text(); } catch { return null; }
        const ct = r.headers.get("content-type") ?? "";
        if (!ct.includes("application/json") && !/^\s*[[{]/.test(raw)) return null;
        try { return JSON.parse(raw); } catch { return null; }
      };
      const genAuthHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      };

      // ── CREATE ──
      const genCreateRes = await fetch("/api/generate-nft-images", {
        method: "POST",
        headers: genAuthHeaders,
        body: JSON.stringify({
          prompt_1: prompt1,
          prompt_2: prompt2,
          referenceImages: refsForKie,
          referenceImageBase64: refsForKie[0]?.data ?? analyzeData.referenceImageBase64,
          referenceImageMime: refsForKie[0]?.mimeType ?? analyzeData.referenceImageMime ?? "image/jpeg",
        }),
      });
      const genCreated = (await readGenJson(genCreateRes)) as
        | { ok?: boolean; tasks?: Array<{ taskId: string; label: string }>; refImageUrls?: string[]; error?: string }
        | null;
      if (!genCreateRes.ok || !genCreated) {
        throw new Error(genCreated?.error ?? (genCreateRes.status >= 500 ? BUSY : `Generation failed (${genCreateRes.status})`));
      }
      if (genCreated.error) throw new Error(genCreated.error);
      const genTasks = genCreated.tasks ?? [];
      if (genTasks.length === 0) throw new Error("No render tasks were created — please retry.");
      const genRefUrls = genCreated.refImageUrls ?? [];
        if (genRefUrls.length) hostedFaceRefsRef.current = genRefUrls;

      // ── COLLECT (poll) ──
      type NftGenResult = {
        ok: boolean;
        gifUrl?: string | null;
        images?: Array<{ url: string; rawUrl?: string; label: string }>;
        refImageUrls?: string[];
        error?: string;
      };
      const genDeadline = Date.now() + 4 * 60 * 1000;
      let genResolved: NftGenResult | null = null;
      while (Date.now() < genDeadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const genCollectRes = await fetch("/api/generate-nft-images/collect", {
          method: "POST",
          headers: genAuthHeaders,
          body: JSON.stringify({ tasks: genTasks, refImageUrls: genRefUrls }),
        });
        const genCollected = (await readGenJson(genCollectRes)) as (NftGenResult & { pending?: boolean }) | null;
        if (!genCollectRes.ok || !genCollected) {
          // HTML/5xx proxy blip → keep polling until the deadline; don't crash.
          setMessages((prev) => prev.map((m) => m.id === genMsgId ? { ...m, text: "Still generating your NFT images…" } : m));
          continue;
        }
        if (genCollected.error || genCollected.ok === false) {
          throw new Error(genCollected.error ?? "Generation failed");
        }
        if (genCollected.images?.length) { genResolved = genCollected; break; }
        // pending → keep waiting
        setMessages((prev) => prev.map((m) => m.id === genMsgId ? { ...m, text: "Still generating your NFT images…" } : m));
      }
      if (!genResolved) throw new Error("Generation is taking longer than expected — please retry.");
      // const alias so the closures below see a narrowed, non-null value.
      const genData = genResolved;

      // Observable confirmation: how many of the user's uploads Kie actually
      // referenced. 0 with uploads present means hosting failed (check Supabase).
      console.log(`[avatar] Kie used ${genData.refImageUrls?.length ?? 0}/${parsedRefs.length} reference image(s):`, genData.refImageUrls);

      const validAvatars = (genData.images ?? [])
        .filter((img) => img.url)
        .map((img) => ({
          label: img.label,
          style: img.label.toLowerCase().replace(/\s+/g, "_"),
          url: img.url,
          prompt: "",
        }));

      // Update message with avatars + animated GIF preview
      const detectedVibe = analyzeData.detected_vibe ?? "";
      const summaryText = [
        `**Your original photo + 2 generated poses — combined into an animated GIF** — ${detectedVibe ? `vibe: *${detectedVibe}*. ` : ""}`,
        genData.gifUrl
          ? "The GIF will be your minted NFT — animated, multi-angle, indistinguishable from real photos."
          : "Character locked — your original photo, a dynamic shot, and a top-side angle.",
      ].join("");

      setMessages((prev) =>
        prev.map((m) =>
          m.id === genMsgId
            ? { ...m, text: summaryText, isGeneratingAvatars: false, avatars: validAvatars, gifUrl: genData.gifUrl ?? undefined }
            : m,
        ),
      );

      setAvatarGenStage("done");
      personaDeepDiveCount.current = 0;

      // Mark avatars as generated in blueprint — drives server-side phase detection
      const updatedBlueprint: AgentBlueprint = {
        ...agentBlueprint,
        avatarsGenerated: true,
        agentStatus: "awaiting_mint",
      };
      setAgentBlueprint(updatedBlueprint);

      // Auto-save NFT draft to database — GIF goes first so it's the primary NFT image.
      // IMPORTANT: data URIs are kept ONLY for in-UI display; before anything is sent to Convex
      // we filter to only http(s) URLs. Convex rejects fields > 1 MiB and data URIs blow past that.
      const sessionId = sessionIdRef.current ?? "";
      // This branch only runs for influencer (trader path returned early above)
      const personaData = agentBlueprint?.persona;
      const frameDataUris: string[] = validAvatars.filter((a) => a.url).map((a) => a.url as string);
      // savedUrls is what the mint card displays — GIF + frames (data URIs ok for display)
      let savedUrls: string[] = genData.gifUrl ? [genData.gifUrl, ...frameDataUris] : frameDataUris;
      if (sessionId && personaData?.name && validAvatars.length > 0) {
        try {
          const res = await fetch("/api/nft/save-draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              creatorWallet: publicKey?.toBase58(),
              name: personaData.name ?? "AI Agent",
              handle: personaData.handle,
              niche: personaData.niche ?? "lifestyle",
              characterBible: characterBible || undefined,
              avatarDataUris: frameDataUris,
              referencePhotoUrls: hostedFaceRefsRef.current,
            }),
          });
          if (res.ok) {
            const data = await res.json() as { draftId?: string; avatarUrls?: string[] };
            if (data.draftId) setNftDraftId(data.draftId);
            if (data.avatarUrls?.length) {
              // Merge: prefer GIF first, then the supabase-hosted frames
              const merged = genData.gifUrl
                ? [genData.gifUrl, ...data.avatarUrls.filter((u) => u !== genData.gifUrl)]
                : data.avatarUrls;
              setNftAvatarUrls(merged);
              savedUrls = merged;
            }
          }
        } catch { /* silent — draft save is non-blocking */ }
      }

      // ── BONUS: 7-pose turnaround grid (BACKGROUND, fire-and-forget) ─────────
      // The grid is a single 2K image that is NEVER shown in the UI — it's only
      // saved to the database for a potential future grid view. So it must NOT
      // block the GIF/mint flow or the perceived "done" state. We launch it in the
      // background: the 2 NFT shots + GIF above are the source of truth and paint
      // immediately; the grid quietly generates and saves to Convex afterwards.
      // (This is the slow, redundant 3rd Kie generation that used to be awaited.)
      const gridSnapshotUrls = savedUrls;
      void (async () => {
        try {
          const gridImagesPayload = images
            .map((dataUrl) => {
              const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
              return m ? { mimeType: m[1], data: m[2] } : null;
            })
            .filter((v): v is { mimeType: string; data: string } => v !== null)
            .slice(0, 3);
          if (gridImagesPayload.length === 0) return;
          // Two-phase (CREATE → poll /collect): the grid render can take minutes,
          // and holding the request open times out on Railway (returns an HTML
          // error page). Auth is auto-attached to /api/ calls by the global fetch
          // interceptor. This is a fire-and-forget bonus that is never shown in the
          // UI, so every fetch is parsed DEFENSIVELY and any failure bails quietly.
          const readJson = async (r: Response): Promise<unknown> => {
            let raw = "";
            try { raw = await r.text(); } catch { return null; }
            const ct = r.headers.get("content-type") ?? "";
            if (!ct.includes("application/json") && !/^\s*[[{]/.test(raw)) return null;
            try { return JSON.parse(raw); } catch { return null; }
          };

          const gridCreateRes = await fetch("/api/generate-character-grid", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              images: gridImagesPayload,
              characterBible: analyzeData.character_bible,
              name: personaData?.name,
            }),
          });
          const gridCreateData = (await readJson(gridCreateRes)) as
            | { ok?: boolean; taskId?: string; error?: string }
            | null;
          if (!gridCreateRes.ok || !gridCreateData?.taskId) {
            console.warn("[builder] grid create failed:", gridCreateRes.status, gridCreateData?.error);
            return;
          }
          const gridTaskId = gridCreateData.taskId;

          // Poll /collect until the grid image is ready or the deadline elapses.
          const gridDeadline = Date.now() + 4 * 60 * 1000;
          let resolvedGridUrl: string | undefined;
          while (Date.now() < gridDeadline) {
            await new Promise((r) => setTimeout(r, 5000));
            const gridCollectRes = await fetch("/api/generate-character-grid/collect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ taskId: gridTaskId }),
            });
            const gridCollectData = (await readJson(gridCollectRes)) as
              | { ok?: boolean; pending?: boolean; gridImageUrl?: string; error?: string }
              | null;
            if (!gridCollectRes.ok || !gridCollectData) continue; // HTML/5xx blip → retry
            if (gridCollectData.error || gridCollectData.ok === false) {
              console.warn("[builder] grid generation failed:", gridCollectData.error);
              return;
            }
            if (gridCollectData.gridImageUrl) { resolvedGridUrl = gridCollectData.gridImageUrl; break; }
            // pending → keep waiting
          }
          if (!resolvedGridUrl) return; // gave up — skip the bonus metadata
          // const alias so the closures below (setNftAvatarUrls/setAgentBlueprint)
          // see a narrowed `string`, not the mutable `let` (which TS widens).
          const gridImageUrl = resolvedGridUrl;
          // Append grid URL as the LAST entry on avatarUrls. It stays at the end and
          // the mint flow always puts the GIF first, so the grid never alters what
          // the user sees or mints — it's purely stored metadata.
          setNftAvatarUrls((prev) => (prev.includes(gridImageUrl) ? prev : [...prev, gridImageUrl]));
          setAgentBlueprint((prev) => ({ ...prev, gridImageUrl }));
          // Persist to Convex via save-state (http-only filter applied server-side).
          if (sessionId) {
            const httpOnly = [...gridSnapshotUrls, gridImageUrl].filter((u) => /^https?:\/\//i.test(u));
            void fetch("/api/builder/save-state", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId,
                creatorWallet: publicKey?.toBase58(),
                agentType: "influencer",
                persona: personaData,
                avatarUrls: httpOnly,
                characterBible: characterBible || undefined,
              }),
            }).catch(() => { /* non-blocking */ });
          }
        } catch (gridErr) {
          console.warn("[builder] grid generation threw:", gridErr);
        }
      })();

      // Auto-save visual identity (character bible) to knowledge base
      if (sessionId && analyzeData.character_bible && personaData?.name) {
        void saveKnowledge({
          sessionId,
          title: `${personaData.name} — Visual Identity (Character Bible)`,
          content: [
            `# ${personaData.name} — Visual Identity`,
            ``,
            `## Character Bible (locked across all NFT frames)`,
            analyzeData.character_bible,
            ``,
            analyzeData.detected_vibe ? `**Detected Vibe:** ${analyzeData.detected_vibe}` : "",
            analyzeData.detected_niche ? `**Detected Niche:** ${analyzeData.detected_niche}` : "",
            ``,
            `## NFT Avatar Set`,
            genData.gifUrl ? `- **Animated GIF (minted NFT):** ${genData.gifUrl}` : "",
            // Only persist http(s) frame URLs in the brain — data URIs would blow past Convex's 1 MiB cap
            ...savedUrls.filter((u) => /^https?:\/\//i.test(u)).map((url, i) => `- Frame ${i + 1}: ${url}`),
          ].filter(Boolean).join("\n"),
          tags: ["visual-identity", "character-bible", "nft", personaData.niche ?? "influencer"],
          category: "knowledge",
          links: [],
          entryType: "auto_persona",
          localId: `visual-identity-${sessionId}`,
        }).catch(() => { /* non-blocking */ });
      }

      // Warm the browser cache for the GIF NOW so the mint card paints it instantly
      // when it mounts (the player above only renders in-memory data-URI frames, so
      // without this the card would have to download the GIF from scratch).
      if (typeof window !== "undefined" && genData.gifUrl) {
        const pre = new window.Image();
        pre.src = genData.gifUrl;
      }

      // Inject Mint vs Regenerate choice card — user decides next step.
      // The mint API requires http(s) URLs only (Supabase-hosted): data URIs would
      // slip into influencer.avatarUrl = "" → broken on /agents. So http URLs go FIRST
      // (the GIF, which becomes the minted image). We also append the frame data URIs
      // purely so the card can show an instant poster while the GIF loads — persistence
      // strips data URIs and the mint POST re-filters to http-only, so both stay safe.
      const httpUrls = savedUrls.filter((u) => /^https?:\/\//i.test(u));
      const displayUrls = httpUrls.length > 0 ? [...httpUrls, ...frameDataUris] : savedUrls;
      const personaName = personaData?.name ?? "Your AI agent";
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-mint-intro`,
            text: `**${personaName}'s avatar is locked in.** Time to go live on Solana — normally **$50**, but it's ~~$50~~ **FREE** right now with the launch promo. Hit Deploy Agent below to lock the identity on-chain. If you'd rather tweak the look, upload a different reference photo and I'll regenerate.`,
            sender: "ai" as const,
            timestamp: new Date(),
          },
          {
            id: `${Date.now()}-mint-card`,
            text: "",
            sender: "ai" as const,
            timestamp: new Date(),
            needsMint: true,
            needsAvatarChoice: true,
            nftAvatarUrls: displayUrls,
          },
        ]);
      }, 150);

    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === genMsgId
            ? {
                ...m,
                text: `Avatar generation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                isGeneratingAvatars: false,
              }
            : m,
        ),
      );
      setAvatarGenStage("confirming");
    }
  // agentBlueprintRef.current always reflects latest state — no blueprint deps needed here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentType, sendMessage, publicKey, characterBible]);

  /**
   * UPLOAD PATH (clippers): the operator's own uploaded photo BECOMES the minted
   * NFT image verbatim — we do NOT spend KIE credits generating a stylized version
   * (that's the "Describe the look" path). We only host the data URL on the public
   * bucket so it's a mint-safe https URL (the mint route + Convex reject base64
   * data URIs), then drop straight to the mint card. Mirrors the tail of
   * triggerAvatarGeneration's single-image success path.
   */
  const useUploadedImageAsCover = useCallback(async (dataUrl: string) => {
    const genMsgId = `${Date.now()}-avgen`;
    const currentBlueprint = agentBlueprintRef.current;
    const persona = currentBlueprint?.persona;
    const singleName = persona?.name ?? "your clipper";

    setAvatarGenStage("generating");
    setMessages((prev) => [
      ...prev,
      {
        id: genMsgId,
        text: `Setting your uploaded image as ${singleName}'s cover…`,
        sender: "ai" as const,
        timestamp: new Date(),
        isGeneratingAvatars: true,
      },
    ]);

    try {
      // Host the uploaded photo as a public .png URL — the mint route filters out
      // base64 data URIs (Convex rejects fields > 1 MiB), so a data URL would
      // silently drop and mint a blank/fallback avatar.
      const hostRes = await fetch("/api/upload-ref", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ base64: dataUrl }),
      });
      const hostJson = (await hostRes.json().catch(() => null)) as { url?: string; error?: string } | null;
      const coverUrl = hostJson?.url;
      if (!hostRes.ok || !coverUrl) {
        throw new Error(hostJson?.error ?? "Couldn't save your uploaded image — please retry.");
      }

      setNftAvatarUrls([coverUrl]);
      setAvatarGenStage("done");
      setAgentBlueprint((prev) => ({
        ...prev,
        avatarsGenerated: true,
        agentStatus: "awaiting_mint",
      }));

      setMessages((prev) => prev.map((m) => m.id === genMsgId ? {
        ...m,
        isGeneratingAvatars: false,
        text: `**${singleName}'s cover is set from your upload.** Review it below — mint to lock identity on-chain (normally $50, FREE during launch promo).`,
        avatars: [{ label: "Clipper", style: agentType, url: coverUrl, prompt: "" }],
      } : m));

      // Save draft (single avatar URL) — non-blocking
      const sessionId = sessionIdRef.current ?? "";
      if (sessionId && singleName) {
        void fetch("/api/nft/save-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            creatorWallet: publicKey?.toBase58(),
            name: singleName,
            handle: undefined,
            niche: persona?.niche ?? "clipping",
            characterBible: "uploaded",
            avatarDataUris: [coverUrl],
              referencePhotoUrls: hostedFaceRefsRef.current,
          }),
        }).catch(() => undefined);
      }

      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-mint-intro`,
            text: `If you like it, mint ${singleName} on Solana — normally **$50**, **FREE** right now (launch promo). After mint, paste a video URL and it starts clipping.`,
            sender: "ai" as const,
            timestamp: new Date(),
          },
          {
            id: `${Date.now()}-mint-card`,
            text: "",
            sender: "ai" as const,
            timestamp: new Date(),
            needsMint: true,
            needsAvatarChoice: true,
            nftAvatarUrls: [coverUrl],
          },
        ]);
      }, 150);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setMessages((prev) => prev.map((m) => m.id === genMsgId ? {
        ...m,
        isGeneratingAvatars: false,
        text: `Couldn't use your image: ${msg}. Try uploading again, or use "Describe the look" to generate one.`,
      } : m));
      setAvatarGenStage("confirming");
    }
  // agentBlueprintRef.current always reflects latest state

  }, [agentType, accessToken, publicKey]);

  /** Saves multiple unique MD memory files to Convex DB for the agent */
  const saveAgentMemoryFiles = useCallback(async (blueprint: AgentBlueprint, sessionId: string) => {
    if (!sessionId || !blueprint.persona?.name) return;
    const p = blueprint.persona;
    const files: Array<{ title: string; content: string; tags: string[]; category: string; localId: string }> = [
      {
        localId: `persona-core-${sessionId}`,
        title: `${p.name} — Core Identity`,
        category: "knowledge",
        tags: ["persona", "identity", p.niche ?? "influencer"],
        content: [
          `# ${p.name} — Core Identity`,
          ``,
          `- **Niche:** ${p.niche ?? "—"}`,
          p.handle ? `- **Handle:** @${p.handle}` : "",
          `- **Target Audience:** ${p.audience ?? "—"}`,
          `- **Language:** ${p.language ?? "—"}`,
          `- **Voice Archetype:** ${p.voiceArchetype ?? "—"}`,
          p.backstory ? `\n## Backstory\n${p.backstory}` : "",
          p.catchphrase ? `\n## Catchphrase\n> "${p.catchphrase}"` : "",
        ].filter(Boolean).join("\n"),
      },
      {
        localId: `persona-content-${sessionId}`,
        title: `${p.name} — Content Strategy`,
        category: "marketing",
        tags: ["content", "strategy", "pillars"],
        content: [
          `# ${p.name} — Content Strategy`,
          ``,
          p.contentPillars?.length ? `## Content Pillars\n${p.contentPillars.map((c) => `- ${c}`).join("\n")}` : "",
          p.videoFormats?.length ? `\n## Video Formats\n${p.videoFormats.map((f) => `- ${f}`).join("\n")}` : "",
          p.avoidTopics?.length ? `\n## Topics to Avoid\n${p.avoidTopics.map((t) => `- ${t}`).join("\n")}` : "",
          p.dreamCollab ? `\n## Dream Collaboration\n${p.dreamCollab}` : "",
        ].filter(Boolean).join("\n"),
      },
      {
        localId: `persona-traits-${sessionId}`,
        title: `${p.name} — Character Traits`,
        category: "knowledge",
        tags: ["traits", "character", "beliefs"],
        content: [
          `# ${p.name} — Character Traits`,
          ``,
          p.traits?.length ? `## Core Traits\n${p.traits.map((t) => `- ${t}`).join("\n")}` : "",
          p.beliefs?.length ? `\n## Beliefs & Values\n${p.beliefs.map((b) => `- ${b}`).join("\n")}` : "",
        ].filter(Boolean).join("\n"),
      },
    ];

    for (const file of files) {
      if (!file.content.trim() || file.content.replace(/^#.*$/gm, "").trim().length < 10) continue;
      try {
        await saveKnowledge({
          sessionId,
          title: file.title,
          content: file.content,
          tags: file.tags,
          category: file.category,
          links: [],
          entryType: "auto_memory",
          localId: file.localId,
        });
      } catch { /* non-blocking */ }
    }
  }, [saveKnowledge]);

  /** Compiles the current agentBlueprint.persona into a markdown file and saves to second brain localStorage */
  const savePersonaToBrain = useCallback((bible: string) => {
    const p = agentBlueprint?.persona;
    if (!p?.name) return;

    const md = [
      `# ${p.name} — AI Influencer Agent Profile`,
      ``,
      `## Identity`,
      `- **Name:** ${p.name}`,
      p.handle ? `- **Handle:** @${p.handle}` : "",
      `- **Niche:** ${p.niche ?? "—"}`,
      `- **Target Audience:** ${p.audience ?? "—"}`,
      `- **Language:** ${p.language ?? "—"}`,
      ``,
      `## Aesthetic & Visual Identity`,
      `- **Aesthetic:** ${p.aesthetic ?? "—"}`,
      `- **Voice Archetype:** ${p.voiceArchetype ?? "—"}`,
      bible ? `\n### Character Bible (from reference images)\n${bible}` : "",
      ``,
      `## Character`,
      p.backstory ? `### Backstory\n${p.backstory}` : "",
      p.traits?.length ? `### Core Traits\n${p.traits.map((t) => `- ${t}`).join("\n")}` : "",
      p.beliefs?.length ? `### Beliefs\n${p.beliefs.map((b) => `- ${b}`).join("\n")}` : "",
      p.catchphrase ? `### Signature Catchphrase\n> "${p.catchphrase}"` : "",
      p.dreamCollab ? `### Dream Collaboration\n${p.dreamCollab}` : "",
      ``,
      `## Content Strategy`,
      p.contentPillars?.length ? `### Content Pillars\n${p.contentPillars.map((c) => `- ${c}`).join("\n")}` : "",
      p.videoFormats?.length ? `### Video Formats\n${p.videoFormats.map((f) => `- ${f}`).join("\n")}` : "",
      p.avoidTopics?.length ? `### Avoid Topics\n${p.avoidTopics.map((t) => `- ${t}`).join("\n")}` : "",
      ``,
      `---`,
      `*Generated by Vello AI Influencer Architect on ${new Date().toLocaleDateString()}*`,
    ].filter((l) => l !== "").join("\n");

    const entry = {
      id: `persona-${p.name?.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      title: `${p.name} — Agent Profile`,
      content: md,
      tags: ["persona", p.niche ?? "influencer", "agent-profile"].filter(Boolean),
      category: "knowledge" as const,
      links: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Save to the SAME per-agent scoped key MindmapCanvas reads
    // (`vello_second_brain_v2:<sessionId>`). Writing the un-scoped global key was
    // half of the "graph shows every agent's nodes" bug — persona nodes from every
    // agent pooled into one bucket. Skip when there's no session (no shared bucket).
    try {
      const sid = sessionIdRef.current?.trim();
      if (sid) {
        const key = `vello_second_brain_v2:${sid}`;
        const raw = localStorage.getItem(key);
        const existing = raw ? (JSON.parse(raw) as typeof entry[]) : [];
        // Replace if exists, else append
        const filtered = existing.filter((e) => !e.id.startsWith(`persona-${p.name?.toLowerCase().replace(/\s+/g, "-")}`));
        localStorage.setItem(key, JSON.stringify([...filtered, entry]));
      }
    } catch { /* quota */ }
  }, [agentBlueprint?.persona]);

  // ── Clipper chat attachment: upload a video/image straight to R2 (streamed
  //    via /api/media/upload-stream — never Convex), live % in the chat, then
  //    hand it to the Clipping tab's Uploads + timeline, ready to Clip.
  const chatMediaInputRef = useRef<HTMLInputElement>(null);
  const [chatUploading, setChatUploading] = useState(false);
  const handleChatMediaUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setChatUploading(true);
    try {
      for (const file of files) {
        const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-chat-upload`;
        const line = (pct: number) => `⬆️ Uploading **${file.name}** — ${pct}%`;
        setMessages((prev) => [...prev, { id: msgId, text: line(0), sender: "ai" as const, timestamp: new Date() }]);
        let lastPct = -1;
        try {
          const up = await uploadMediaFile(file, {
            accessToken,
            onProgress: (pct) => {
              if (pct === lastPct || (pct - lastPct < 3 && pct < 99)) return; // throttle re-renders
              lastPct = pct;
              setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, text: line(pct) } : m)));
            },
          });
          if (up.kind === "audio") throw new Error("Audio files go in the Clipping tab → Music → Upload track.");
          useClippingStore.getState().setEditorIntake({ asset: { url: up.url, name: up.name, kind: up.kind } });
          setForceClipTab((n) => n + 1);
          setMessages((prev) => prev.map((m) => (m.id === msgId ? {
            ...m,
            text: up.kind === "video"
              ? `✅ **${file.name}** uploaded — it's in the **Clipping** tab under **Uploads** and open on the timeline.\n\nStyle it (Captions, Text Hook, Music), then hit **Clip** (top right) to cut it into shorts.`
              : `✅ **${file.name}** uploaded — it's in the **Clipping** tab under **Uploads**.`,
          } : m)));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Upload failed";
          setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, text: `⚠ Couldn't upload **${file.name}**: ${msg}` } : m)));
        }
      }
    } finally {
      setChatUploading(false);
    }
  }, [accessToken]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || avatarGenStage === "generating" || avatarGenStage === "done") return;
    // Traders + clippers only need 1 reference image (single cover, not a GIF). Influencers need 3.
    const isSingleCover = agentType === "trader" || agentType === "clipping";
    const maxRefImages = isSingleCover ? 1 : 3;
    // Single-cover agents REPLACE their one cover on every pick, so re-selecting a
    // photo always works — e.g. after one was seeded from the /studio/build handoff,
    // or when the operator picks a different image. Only the 3-photo influencer flow
    // hits a hard cap.
    if (!isSingleCover && referenceImages.length >= maxRefImages) return;

    /**
     * Kie/nano-banana-pro doesn't reliably accept webp/heic/tiff/avif inputs.
     * Decode the file in the browser via <img>+canvas, then re-encode as JPEG
     * so we always send a known-good format to the API.
     */
    const needsConversion = /image\/(webp|heic|heif|tiff|avif)/i.test(file.type) || /\.(webp|heic|heif|tiff|avif)$/i.test(file.name);

    const useDataUrl = (dataUrl: string, displayName: string) => {
      const isTrader = isSingleCover;
      // Clippers use the uploaded photo AS-IS for the NFT (no KIE render); only
      // the "Describe the look" path generates. Traders still stylize via KIE.
      const isClipUpload = agentType === "clipping";
      // Single-cover agents overwrite the one cover; influencers append toward 3.
      const newCount = isTrader ? 1 : referenceImages.length + 1;
      const singleName = agentType === "clipping"
        ? (agentBlueprint?.persona?.name ?? "your clipper")
        : (agentBlueprint?.trader?.name ?? "your trader");
      const target = isTrader ? 1 : 3;
      const msgId = `${Date.now()}-img`;
      setLatestUploadedUrl(dataUrl);
      setReferenceImages((prev) => (isTrader ? [dataUrl] : [...prev, dataUrl].slice(0, target)));

      const userMsg: Message = {
        id: msgId,
        text: `[Uploaded reference image: ${displayName}]`,
        sender: "user",
        timestamp: new Date(),
        imageUrl: dataUrl,
      };

      let aiMsg: Message;
      if (newCount < target) {
        aiMsg = {
          id: `${msgId}-status`,
          text: `**${newCount}/${target} reference photo${target === 1 ? "" : "s"} captured.** ${target - newCount} more needed.`,
          sender: "ai",
          timestamp: new Date(),
        };
        setAvatarGenStage("collecting");
      } else {
        aiMsg = {
          id: `${msgId}-confirm`,
          text: isClipUpload
            ? `**Reference photo captured.** Using it as ${singleName}'s cover — no AI generation needed.`
            : isTrader
            ? `**Reference photo captured.** Generating ${singleName}'s cover image…`
            : `**All 3 references captured!** Ready to generate 2 NFT poses and combine them with your photo into an animated avatar GIF.`,
          sender: "ai",
          timestamp: new Date(),
          // Trader: auto-trigger immediately; influencer: show confirm button
          needsAvatarConfirm: !isTrader,
        };
        setAvatarGenStage(isTrader ? "generating" : "confirming");
      }
      setMessages((p) => [...p, userMsg, aiMsg]);

      // Single-cover auto-start: clippers use the upload verbatim (no KIE), traders
      // stylize the reference through KIE.
      if (isTrader && newCount >= target) {
        if (isClipUpload) {
          setTimeout(() => void useUploadedImageAsCover(dataUrl), 200);
        } else {
          setTimeout(() => void triggerAvatarGeneration([dataUrl]), 200);
        }
      }
    };

    if (needsConversion) {
      // Convert webp/heic/avif/etc → JPEG via canvas
      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        // White background — JPEG can't carry alpha, prevents black blobs from transparent PNG/webp
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);
        URL.revokeObjectURL(objectUrl);
        const displayName = file.name.replace(/\.(webp|heic|heif|tiff|avif)$/i, ".jpg");
        useDataUrl(jpegDataUrl, displayName);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        // Fallback: send the original — server-side will likely reject, but at least we tried
        const reader = new FileReader();
        reader.onload = (ev) => useDataUrl(ev.target?.result as string, file.name);
        reader.readAsDataURL(file);
      };
      img.src = objectUrl;
    } else {
      // Standard path (jpg/png) — still DOWNSCALE via the shared compressor so a
      // full-res phone photo doesn't bloat React state or overflow the request body
      // (three raw photos truncated the /api/generate-nft-images JSON → 500). Fail
      // open to the raw read.
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const raw = ev.target?.result as string;
        const small = await compressImageDataUrl(raw).catch(() => raw);
        useDataUrl(small, file.name);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarGenStage, referenceImages.length, agentBlueprint?.trader?.name, triggerAvatarGeneration, useUploadedImageAsCover]);

  // Pick up a reference image attached on the /studio/build entry screen.
  // It's stored as a downscaled JPEG data URL in sessionStorage; seed it as the
  // first reference photo and show it in the chat so the user sees it carried over.
  const hasProcessedHandoffImage = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || hasProcessedHandoffImage.current) return;
    hasProcessedHandoffImage.current = true;
    try {
      const raw = sessionStorage.getItem("vello_index_builder_image");
      if (!raw) return;
      sessionStorage.removeItem("vello_index_builder_image");
      const parsed = JSON.parse(raw) as { dataUrl?: string; name?: string };
      const dataUrl = typeof parsed?.dataUrl === "string" ? parsed.dataUrl : "";
      if (!dataUrl.startsWith("data:image/")) return;
      const target = agentType === "trader" || agentType === "clipping" ? 1 : 3;
      setLatestUploadedUrl(dataUrl);
      setReferenceImages((prev) => (prev.length ? prev : [dataUrl]).slice(0, target));
      setAvatarGenStage((s) => (s === "idle" ? "collecting" : s));
      setMessages((prev) => [
        ...prev,
        {
          id: `handoff-img-${Date.now()}`,
          text: `[Uploaded reference image: ${parsed?.name || "photo"}]`,
          sender: "user",
          timestamp: new Date(),
          imageUrl: dataUrl,
        },
      ]);
    } catch {
      /* ignore corrupt handoff image */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || hasProcessedIndexHandoff.current) return;
    try {
      const raw = sessionStorage.getItem("vello_index_builder_handoff");
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const rows = Array.isArray(parsed.messages) ? parsed.messages : [];
      if (rows.length === 0) return;
      sessionStorage.removeItem("vello_index_builder_handoff");
      hasProcessedIndexHandoff.current = true;
      hasProcessedInitial.current = true;

      const uiMessages: Message[] = [];
      conversationHistory.current = [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (row.role !== "user" && row.role !== "assistant") continue;
        const content = typeof row.content === "string" ? row.content : "";
        if (!content.trim()) continue;
        const role = row.role === "user" ? "user" : "ai";
        uiMessages.push({
          id: `handoff-${i}-${Date.now()}`,
          text: content,
          sender: role,
          timestamp: new Date(),
        });
        conversationHistory.current.push({
          role: row.role === "user" ? "user" : "assistant",
          content,
        });
      }
      if (uiMessages.length > 0) {
        setMessages(uiMessages);
        const lastUser = [...rows].reverse().find((r) => r.role === "user");
        const goal = typeof lastUser?.content === "string" ? lastUser.content.trim().slice(0, 2800) : "";
        if (goal) {
          goalPulseRef.current += 1;
          const pulseTok = goalPulseRef.current;
          setNodes([
            {
              id: BUILDER_LOCAL_GOAL_PREVIEW_ID,
              label: "Marketing goal",
              description: goal,
              category: "initial",
              status: "in_progress",
              x: 300,
              y: 240,
              dependencies: [],
              connectsTo: [],
              animation: { entrance: "bounce", delay: 0 },
              pulseToken: pulseTok,
            },
          ]);
        }
        setProjectName("From marketplace chat");
      }
    } catch {
      /* ignore corrupt handoff */
    }
  }, []);

  // Stage content-reward handoff (?reward=<id> + type=clipping): resolve the
  // reward's clippable videos via /api/clip/campaign-sources, then SEED the
  // clipping canvas Source node with the first video + the reward's
  // contentRewardId (so the cloud run sets it on the clip job → Supabase
  // auto-submit, and transcribe caches it). The seed rides the existing
  // pendingChatOps queue (drained post-hydration by ClippingFlowCanvas) so it
  // never races the localStorage graph load. One-shot per mount.
  useEffect(() => {
    if (!rewardParam || agentType !== "clipping" || hasProcessedRewardHandoff.current) return;
    hasProcessedRewardHandoff.current = true;
    let active = true;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const res = await fetch(`/api/clip/campaign-sources?rewardId=${encodeURIComponent(rewardParam)}`, { headers });
        if (!res.ok) {
          if (active)
            setMessages((prev) => [...prev, {
              id: `${Date.now()}-reward-err`,
              text: "⚠ Couldn't load that Stage campaign — open the Source node and paste a video URL to start clipping.",
              sender: "ai" as const, timestamp: new Date(),
            }]);
          return;
        }
        const data = (await res.json()) as { contentRewardId?: string; title?: string; videos?: { url: string; name: string }[] };
        if (!active) return;
        const videos = Array.isArray(data.videos) ? data.videos : [];
        const contentRewardId = String(data.contentRewardId ?? rewardParam);
        const title = String(data.title ?? "Stage campaign");
        // Queue the seed op + switch to the Clipping tab. Even with zero videos
        // we still tag the Source so a pasted URL inherits the reward (the user
        // can fill it manually when the Drive folder couldn't be expanded).
        useClippingStore.getState().queueChatOps([{ op: "seed_reward_source", contentRewardId, title, videos }]);
        setForceClipTab((n) => n + 1);
        setMessages((prev) => [...prev, {
          id: `${Date.now()}-reward-seed`,
          text: videos.length > 0
            ? `🎬 Seeded "${title}": ${videos.length} clip${videos.length > 1 ? "s" : ""} available — pick which to clip in the Source node, then Run.`
            : `🎬 Opened "${title}". Its source couldn't be auto-loaded (private Drive folder or no Drive key) — paste a video URL in the Source node to start clipping.`,
          sender: "ai" as const, timestamp: new Date(),
        }]);
      } catch {
        /* network error — the canvas still opens; the user can fill the Source */
      }
    })();
    return () => { active = false; };
  }, [rewardParam, agentType, accessToken]);

  useEffect(() => {
    // preventScroll: the input sits at the BOTTOM of the chat pane — a plain
    // focus() on mount scrolls it into view and yanks the whole page down.
    if (hasProcessedIndexHandoff.current) {
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    inputRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs when auth settles; the ref guard makes the send fire once
  }, [sessionLoading, sessionAuthenticated]);

  // A queued "Clip this video: <url>" (from /home, the landing page or the agent
  // chooser) reaches the agent only once it exists: resumed (minted + hydrated),
  // signed in, and past the welcome screen. `q` is stripped right after so a
  // refresh never re-sends it.
  const sentQueuedRef = useRef(false);
  useEffect(() => {
    if (sentQueuedRef.current || !resumeMintAddress || !initialQuery) return;
    if (!agentBlueprint?.mintCompleted || searchParams.get("welcome") === "1") return;
    if (sessionLoading || isProcessing) return;
    sentQueuedRef.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    router.replace(`/builder?${params.toString()}`);
    if (inferAgentTypeFromPrompt(initialQuery).type !== "clipping") return; // only clip jobs are auto-sent
    void (async () => {
      try { if (sessionAuthenticated) await getFreshToken(); } catch { /* the interceptor retries */ }
      void sendMessage(initialQuery);
    })();
  }, [resumeMintAddress, initialQuery, agentBlueprint?.mintCompleted, searchParams, sessionLoading, isProcessing, sessionAuthenticated, getFreshToken, sendMessage, router]);

  const handleWorkspaceCreated = useCallback(
    (createdCommunityId: string, _createdCampaignId: string) => {
      const normalized = createdCommunityId.trim();
      if (normalized) {
        const params = new URLSearchParams(searchParams.toString());
        if (params.get("c") !== normalized) {
          params.set("c", normalized);
          router.replace(`/builder?${params.toString()}`);
        }
      }
      setNodes((prev) =>
        prev.map((node) => {
          if (node.category === "foundation") {
            return {
              ...node,
              status: "completed" as const,
              ctaLabel: "Open workspace",
              ctaHref: `/studio?workspace=${normalized}`,
            };
          }
          if (node.category === "marketing") {
            return { ...node, status: "completed" as const };
          }
          if (node.category === "milestone") {
            return { ...node, status: "in_progress" as const };
          }
          return node;
        }),
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-workspace-ready`,
          text: `Workspace created. Community, product, and content rewards campaign are all saved. Now connect your Phantom wallet and deposit USDC to activate the campaign.`,
          sender: "ai" as const,
          timestamp: new Date(),
        },
      ]);
    },
    [router, searchParams],
  );

  const performAutoSetup = useCallback(async () => {
    if (hasAutoSetupTriggered.current) return;
    hasAutoSetupTriggered.current = true;
    setIsAutoSetupRunning(true);

    try {
      const userId = publicKey?.toString() || "";

      if (!userId) {
        setIsResultDrawerOpen(true);
        hasAutoSetupTriggered.current = false;
        return;
      }

      const currentBlueprint = campaignBlueprint;
      const currentCommunityId = communityId;
      const knowledgeNode = nodesRef.current.find(
        (n) => n.category === "foundation" && /knowledge/i.test(n.label),
      );
      const knowledgeText = typeof knowledgeNode?.description === "string" ? knowledgeNode.description : "";
      const communityImageUrl =
        currentBlueprint.community?.imageUrl ||
        nodesRef.current.find((n) => n.category === "foundation")?.sourceCoverImageUrl ||
        "";

      const res = await fetch("/api/builder/community-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          communityId: currentCommunityId || undefined,
          userId,
          campaignBlueprint: currentBlueprint,
          knowledgeBaseText: knowledgeText,
          communityImageUrl,
          campaignImageUrl: currentBlueprint.campaign?.imageUrl || communityImageUrl,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error((data?.error as string) || `Server error ${res.status}`);

      const community = data?.community as Record<string, unknown> | undefined;
      const campaign = data?.campaign as Record<string, unknown> | undefined;
      const newCommunityId = typeof community?.id === "string" ? community.id : "";
      const newCampaignId = typeof campaign?.id === "string" ? campaign.id : "";

      if (newCommunityId) {
        handleWorkspaceCreated(newCommunityId, newCampaignId);
        setIsResultDrawerOpen(true);
      }
    } catch (err) {
      hasAutoSetupTriggered.current = false;
      const detail = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-setup-err`,
          text: `Auto-setup encountered an issue: ${detail}. Use the plan panel on the right to try again.`,
          sender: "ai" as const,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsAutoSetupRunning(false);
    }
  }, [publicKey, campaignBlueprint, communityId, handleWorkspaceCreated]);

  useEffect(() => {
    if (
      hasAutoSetupTriggered.current ||
      isAutoSetupRunning ||
      !isAuthenticated ||
      agentChain?.interactionMode !== "agency_agentic" ||
      builderPhase !== "campaign_ready" ||
      !campaignBlueprint.community?.name ||
      !campaignBlueprint.campaign?.name ||
      messages.length === 0
    )
      return;
    const timer = setTimeout(() => void performAutoSetup(), 1800);
    return () => clearTimeout(timer);
  }, [isAuthenticated, agentChain, campaignBlueprint, isAutoSetupRunning, messages.length, builderPhase, performAutoSetup]);

  // Reserved for the Mindmap view if it ever needs to push node updates back to state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleNodeUpdate = useCallback((nodeId: string, updates: Partial<IntelligentNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)));
  }, []);

  /**
   * Trigger the AI to respond next without showing a fake "user" message in the chat.
   * The hidden trigger is added to conversationHistory only — the user sees just the AI's reply.
   */
  const triggerAiContinue = useCallback(async (hiddenContext: string, overrideBlueprint?: AgentBlueprint) => {
    if (isProcessing || !resumeMintAddress) return;
    setIsProcessing(true);
    try {
      // Push hidden turn into history (sent to AI) but NOT into the visible messages list
      conversationHistory.current.push({ role: "user", content: hiddenContext });

      const bp = overrideBlueprint ?? agentBlueprint;
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationHistory.current,
          currentNodes: sanitizeCanvasNodesForChat(nodesRef.current),
          communityId: communityId || undefined,
          agentType,
          agentBlueprint: bp,
        }),
      });
      const raw = await res.text();
      let data: { message?: string; agentBlueprint?: AgentBlueprint } = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
      // A clipper doesn't film persona videos — it clips a source and posts.
      // Branch the fallback first-message copy on agent type.
      const isClipFallback = (bp?.agentType ?? agentType) === "clipping";
      const fallbackFirstMessage = isClipFallback
        ? "I'm live! To start clipping, paste a source video URL (YouTube, TikTok, or Google Drive) — or join a Clipping campaign — and I'll turn it into short viral clips. Want me to walk you through picking a source and your clip style (length, captions, auto-post)?"
        : "I'm live! Before I start producing, let's lock in my persona and content style. First up: what kind of videos should I make — product reviews, tips, GRWM, day-in-the-life? Pick a couple (or tell me your own), then we'll set my wills & won'ts.";
      const aiText = (typeof data.message === "string" && data.message.trim())
        ? data.message
        : fallbackFirstMessage;
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-ai-trigger`, text: aiText, sender: "ai" as const, timestamp: new Date() },
      ]);
      conversationHistory.current.push({ role: "assistant", content: aiText });
      if (data.agentBlueprint && typeof data.agentBlueprint === "object") {
        setAgentBlueprint((prev) => withStickyMint(prev, data.agentBlueprint as AgentBlueprint));
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown";
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-trigger-err`, text: `Could not continue (${detail}).`, sender: "ai" as const, timestamp: new Date() },
      ]);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, agentBlueprint, agentType, communityId]);

  /** Called from AestheticChoiceCard when user submits a text description */
  const handleGenerateWithDescription = useCallback((description: string) => {
    if (!description.trim() || avatarGenStage === "generating" || avatarGenStage === "done") return;
    // Store aesthetic in ref immediately so triggerAvatarGeneration reads it
    agentBlueprintRef.current = {
      ...agentBlueprintRef.current,
      trader: {
        ...(agentBlueprintRef.current.trader ?? {}),
        aesthetic: description.trim(),
      },
    };
    setAgentBlueprint((prev) => ({
      ...prev,
      trader: { ...(prev.trader ?? {}), aesthetic: description.trim() },
    }));
    setAvatarGenStage("generating");
    // Trigger with no reference images, passing description as override
    void triggerAvatarGeneration([], description.trim());
  }, [avatarGenStage, triggerAvatarGeneration]);

  /** Install the clipping module on a non-clipping agent, then run the pending clip. */
  const handleInstallClipModule = useCallback((sourceUrl: string) => {
    const merge = (cur: string[] | undefined) => Array.from(new Set([...(cur ?? []), ...CLIP_MODULE_SKILLS]));
    // Write the ref synchronously so executeAgentActions' gate sees the module immediately.
    agentBlueprintRef.current = { ...agentBlueprintRef.current, installedSkills: merge(agentBlueprintRef.current.installedSkills) };
    setAgentBlueprint((prev) => ({ ...prev, installedSkills: merge(prev.installedSkills) }));
    setMessages((prev) => [
      ...prev.filter((m) => !m.needsClipInstall),
      { id: `${Date.now()}-clip-installed`, text: "✓ Clipping module installed — starting your clip now.", sender: "ai" as const, timestamp: new Date() },
    ]);
    if (sourceUrl) void executeAgentActions([{ type: "clip_source", sourceUrl }]);
  }, [executeAgentActions]);

  const handleRegenerateAvatar = useCallback(() => {
    // Reset to collecting state — user uploads new photo, we redo image gen
    setReferenceImages([]);
    setLatestUploadedUrl("");
    setAvatarGenStage("idle");
    setNftAvatarUrls([]);
    setNftDraftId(null);
    setCharacterBible("");
    setAgentBlueprint((prev) => ({
      ...prev,
      avatarsGenerated: false,
      agentStatus: "configuring",
    }));
    // Clear the mint-card + intro from chat so the regenerate flow is clean
    setMessages((prev) => prev.filter((m) => !m.needsMint && !m.needsAvatarChoice));
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-regen`,
        text: "**Let's try a different look.** Upload a new reference photo and I'll regenerate the NFT avatar.",
        sender: "ai" as const,
        timestamp: new Date(),
      },
    ]);
    setTimeout(() => imageInputRef.current?.click(), 200);
  }, []);

  const handleMintComplete = useCallback((mintAddr: string) => {
    const isTrader = agentBlueprint?.agentType === "trader";
    const isClipping = (agentBlueprint?.agentType ?? agentType) === "clipping";
    const personaName = isTrader
      ? (agentBlueprint?.trader?.name ?? "Your trader")
      : (agentBlueprint?.persona?.name ?? "Your agent");
    const personaNiche = agentBlueprint?.persona?.niche?.trim() || "";
    // Update blueprint — server uses this for phase detection
    const nextBlueprint: AgentBlueprint = {
      ...(agentBlueprint ?? { agentType }),
      mintCompleted: true,
      mintAddress: mintAddr,
      agentStatus: "mint_complete",
    };
    setAgentBlueprint(nextBlueprint);

    // Stamp the mint address into the URL so a refresh resolves identity via
    // resumeByMint (DB-backed) instead of relying solely on the per-sessionId
    // localStorage snapshot, which is best-effort and orphaned by a fresh tab/
    // bookmark with no `s` param. Root cause of "Director selection reverts on
    // refresh": without this, a refresh right after minting had no reliable
    // way back to this agent's Convex doc.
    const mintParams = new URLSearchParams(searchParams.toString());
    if (mintParams.get("mint") !== mintAddr) {
      mintParams.set("mint", mintAddr);
      router.replace(`/builder?${mintParams.toString()}`);
    }

    // Fire celebration overlay (confetti + chime + "MINTED!" badge)
    setShowMintCelebration(true);
    setTimeout(() => setShowMintCelebration(false), 2800);

    // Inject a celebratory AI message — in the agent's own voice, the moment it
    // comes alive on-chain. Kept short; the onboarding question follows.
    // Honesty gate: a real on-chain NFT mint is a base58 address. The synthetic
    // fallback `vello_<session>_<ts>` means the Metaplex mint didn't run (e.g.
    // NFT_MINT_AUTHORITY_SECRET unset) — don't claim "on-chain" or show a link
    // to an address that doesn't exist.
    const isRealMint = !mintAddr.startsWith("vello_");
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-mint-success`,
        text: isRealMint
          ? `🎉 **${personaName} is live on Solana.** I'm officially on-chain (\`${mintAddr.slice(0, 6)}…${mintAddr.slice(-6)}\`) and ready to get to work.`
          : `🎉 **${personaName} is minted.** My on-chain NFT is still finalizing — I'm ready to start clipping in the meantime.`,
        sender: "ai" as const,
        timestamp: new Date(),
        ...(isRealMint ? { explorerUrl: `https://explorer.solana.com/address/${mintAddr}?cluster=devnet` } : {}),
      },
    ]);

    // After a short pause, kick straight into persona setup — the agent
    // introduces itself and immediately asks what kind of videos to make,
    // then collects wills/won'ts, audience/voice, and cadence over next turns.
    setTimeout(() => {
      const nextPrompt = isTrader
        ? `[APP EVENT — automated message from the Vello app, not typed by the user] The user just successfully minted ${personaName} as an NFT AI Trader on Solana. Mint address: ${mintAddr}. Phase has advanced to signal_setup. Congratulate them briefly, then ask which signals ${personaName} should watch — X keywords, on-chain whale activity, news feeds, or Polymarket markets.`
        : isClipping
        ? `[APP EVENT — automated message from the Vello app, not typed by the user] The user just minted ${personaName} as a live on-chain AI clipping agent on Solana. Mint address: ${mintAddr}. Phase has advanced to clip_setup. Speak in FIRST PERSON as ${personaName} — warm, excited, ready to work. In a few short sentences: (1) introduce yourself in one line tied to your ${personaNiche || "clipping"} niche; (2) say that you turn existing source videos into short viral clips and auto-post them. Then START the setup immediately with ONE question: ask them to paste a SOURCE VIDEO URL (YouTube, TikTok, or Google Drive) — or join a Clipping campaign — so you can start clipping, and offer to walk them through picking a source and clip style. Over the FOLLOWING turns (one question per turn), collect: (a) the SOURCE — a video URL or a Clipping campaign to pull from, (b) clip LENGTH and how many clips per source, (c) CAPTION style — on-screen subtitles + the post description, (d) which PLATFORMS to auto-post to and how often. Save every answer into the blueprint clip config. Keep it tight and conversational, and END this message with that ONE first question about the source video / campaign to clip. Do NOT ask about influencer persona, "what kind of videos to make", GRWM, product reviews, or day-in-the-life — this agent CLIPS existing videos, it does not film original persona content.`
        : `[APP EVENT — automated message from the Vello app, not typed by the user] The user just minted ${personaName} as a live on-chain AI agent on Solana. Mint address: ${mintAddr}. Phase has advanced to persona_setup. Speak in FIRST PERSON as ${personaName} — warm, excited, ready to work. In a few short sentences: (1) introduce yourself in one line tied to your ${personaNiche || "persona's"} niche; (2) say that before you start producing you need your persona + content style locked in, then START the setup immediately with ONE question: what kind of VIDEOS should you make — offer 3-4 concrete content types drawn from your niche (e.g. GRWM, product reviews, tips, myth-busts, day-in-the-life) plus a length/pacing suggestion they can just say yes to. Over the FOLLOWING turns (one question per turn), collect: (a) your WILLS — brand categories + topics you'll happily cover (willTopics), (b) your WON'TS — topics and brand types you must refuse (avoidTopics), (c) target audience + voice/tone, (d) posting cadence per week. Save every answer into the blueprint persona fields (contentTypes, videoLength, pacing, willTopics, avoidTopics, audience, voiceArchetype, postsPerWeek). Keep it tight and conversational, and END this message with that ONE first question about videos. Do NOT ask about skills or autonomous tasks yet — persona and content style come first.`;
      void triggerAiContinue(nextPrompt, nextBlueprint);
    }, 1600);
  }, [agentBlueprint, agentType, triggerAiContinue, router, searchParams]);

  const handleSend = useCallback(() => {
    void sendMessage();
  }, [sendMessage]);

  const handleClientAction = useCallback((href: string) => {
    if (!href || typeof window === "undefined") return;
    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  const handleCommunityResolved = useCallback(
    (nextCommunityId: string) => {
      const normalized = nextCommunityId.trim();
      if (!normalized) return;
      const params = new URLSearchParams(searchParams.toString());
      if (params.get("c") === normalized) return;
      params.set("c", normalized);
      router.replace(`/builder?${params.toString()}`);
    },
    [router, searchParams],
  );

  const handleComposerSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (inputText.trim() && !isProcessing) handleSend();
    },
    [handleSend, inputText, isProcessing],
  );

  const handleToolCallApprove = useCallback(async (call: ToolCallAction) => {
    setPendingToolCalls((prev) =>
      prev.map((c) => (c.id === call.id ? { ...c, status: "running" as const } : c)),
    );
    try {
      const res = await fetch("/api/builder/tool-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", toolId: call.toolId, campaignBlueprint, ...call.params }),
      });
      const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
      const resultText = res.ok ? (data.result || "Done.") : (data.error || "Error");
      setPendingToolCalls((prev) =>
        prev.map((c) =>
          c.id === call.id ? { ...c, status: res.ok ? ("done" as const) : ("error" as const), result: resultText } : c,
        ),
      );
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-tool`, text: `[${call.label}] ${resultText}`, sender: "ai" as const, timestamp: new Date() },
      ]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown";
      setPendingToolCalls((prev) =>
        prev.map((c) => (c.id === call.id ? { ...c, status: "error" as const, result: detail } : c)),
      );
    }
  }, [campaignBlueprint]);

  const handleToolCallDismiss = useCallback((callId: string) => {
    setPendingToolCalls((prev) => prev.filter((c) => c.id !== callId));
  }, []);

  const hasSaveableAgent = Boolean(agentBlueprint?.persona?.name || agentBlueprint?.persona?.niche);
  const canSaveAgent = hasSaveableAgent;
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [savedAgentAt, setSavedAgentAt] = useState<number | null>(null);
  const [showMintCelebration, setShowMintCelebration] = useState(false);
  // The mint card shows in a premium full-screen overlay; this collapses it to a
  // chip in chat so the operator can dismiss and reopen it.
  const [mintOverlayCollapsed, setMintOverlayCollapsed] = useState(false);

  const handleSaveAgent = useCallback(async (silent = false) => {
    if (!sessionIdRef.current || isSavingAgent) return;
    setIsSavingAgent(true);
    try {
      const res = await fetch("/api/builder/save-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          creatorWallet: publicKey?.toBase58(),
          agentType,
          persona: agentBlueprint?.persona,
          avatarUrls: nftAvatarUrls,
          characterBible,
          mintAddress: agentBlueprint?.mintAddress,
        }),
      });
      const data = await res.json() as { ok?: boolean; draftId?: string; updatedInfluencer?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Save failed");
      setSavedAgentAt(Date.now());
      if (!silent) setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-saved`,
          text: `**Agent saved.** ${data.updatedInfluencer ? "Influencer NFT persona record updated. " : ""}Working state synced to the database — you can close this tab and pick up where you left off.`,
          sender: "ai" as const,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown";
      if (!silent) setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-save-err`, text: `Save failed: ${detail}`, sender: "ai" as const, timestamp: new Date() },
      ]);
    } finally {
      setIsSavingAgent(false);
    }
  }, [agentType, agentBlueprint, nftAvatarUrls, characterBible, publicKey, isSavingAgent]);

  // Autosave: whenever the persona, avatars, bible or type change, save quietly a few seconds later.
  // The first snapshot is only recorded, never saved, so opening the builder does not write anything.
  const autosaveSignature = useMemo(
    () => JSON.stringify([agentType, agentBlueprint?.persona, nftAvatarUrls, characterBible, agentBlueprint?.mintAddress]),
    [agentType, agentBlueprint?.persona, nftAvatarUrls, characterBible, agentBlueprint?.mintAddress],
  );
  const lastSavedSignature = useRef<string | null>(null);
  useEffect(() => {
    if (!hasSaveableAgent) return;
    if (lastSavedSignature.current === null) { lastSavedSignature.current = autosaveSignature; return; }
    if (lastSavedSignature.current === autosaveSignature) return;
    const timer = setTimeout(() => {
      lastSavedSignature.current = autosaveSignature;
      void handleSaveAgent(true);
    }, 3500);
    return () => clearTimeout(timer);
  }, [autosaveSignature, hasSaveableAgent, handleSaveAgent]);

  const walletAddress = publicKey?.toString();
  const displayName = walletAddress
    ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
    : "there";

  // Spotlight command palette — IN-BUILDER ONLY. Searches the builder's own
  // views/tools; it never navigates out of the page.
  const spotlightActions: SpotAction[] = useMemo(() => [
    { id: "view-studio", label: "Studio view", group: "View", icon: Workflow, run: () => setCanvasViewMode("workflow") },
    { id: "view-graph", label: "Graph view", group: "View", icon: GitBranch, run: () => setCanvasViewMode("mindmap") },
    { id: "tool-mcp", label: "AI Tools & MCP", group: "Tools", icon: Plus, run: () => setIsMcpPanelOpen(true) },
  ], []);

  // Shared mint trigger: Home 'Deploy' button AND the chat `open_mint` action both
  // call this. Deterministic (no reliance on the chat model emitting awaiting_mint).
  const triggerClipMintFlow = useCallback(() => {
    const name = agentBlueprint?.persona?.name?.trim();
    const isClip = (agentBlueprint?.agentType ?? agentType) === "clipping";
    // Resurface guard: a second trigger while the cover/mint cards are already up is a no-op.
    if (messages.some((m) => m.needsAestheticChoice || m.needsMint)) return;
    if (isClip && name && !agentBlueprint?.mintCompleted) {
      setAgentBlueprint((prev) => withStickyMint(prev, { ...(prev ?? { agentType: "clipping" }), agentStatus: "awaiting_mint" } as AgentBlueprint));
      setMessages((prev) => {
        if (prev.some((m) => m.needsAestheticChoice || m.needsMint)) return prev;
        return [
          ...prev,
          { id: `${Date.now()}-clip-cover-intro`, text: `**${name} is configured.** Pick a cover image for the on-chain identity — describe the look or upload one — then mint on Solana (FREE right now, launch promo) to start clipping.`, sender: "ai" as const, timestamp: new Date() },
          { id: `${Date.now()}-clip-aesthetic`, text: "", sender: "ai" as const, timestamp: new Date(), needsAestheticChoice: true },
        ];
      });
    } else {
      void sendMessage("Go live with my agent now — generate the avatars if they aren't ready yet.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentBlueprint, agentType, messages]);

  // Ref so the []-deps executeAgentActions can reach the latest triggerClipMintFlow
  // without re-creating the callback (avoids a stale closure on open_mint).
  const triggerClipMintRef = useRef<(() => void) | null>(null);
  triggerClipMintRef.current = triggerClipMintFlow;


  return (
    <div className="h-screen flex flex-col bg-[#1a1a1a] text-white overflow-hidden">
      {showSetupFlow && (
        <NewAgentEntry
          initialType={setupInitialType}
          clipQuery={clipQuery}
          walkthrough={searchParams.get("walkthrough") === "1"}
        />
      )}
      <MintCelebration active={showMintCelebration} />

      {/* Premium mint moment — all agent types. The card lives here in a centered
          overlay; chat shows a "Ready to mint" chip when collapsed. */}
      {(() => {
        const mintMsg = messages.find((m) => m.needsMint);
        const showOverlay = !!mintMsg && !agentBlueprint?.mintCompleted && !mintOverlayCollapsed;
        return (
          <MintOverlay open={showOverlay} onClose={() => setMintOverlayCollapsed(true)}>
            <div className="space-y-2">
              <NftMintCard
                avatarUrls={mintMsg?.nftAvatarUrls ?? nftAvatarUrls}
                agentBlueprint={agentBlueprint ?? { agentType: "influencer" }}
                sessionId={sessionIdRef.current ?? ""}
                onMintComplete={handleMintComplete}
              />
              {mintMsg?.needsAvatarChoice && !agentBlueprint?.mintCompleted && (
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={handleRegenerateAvatar}
                    className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-[11.5px] font-semibold text-white/75 shadow-lg shadow-black/30 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.12] hover:text-white active:translate-y-0"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    Regenerate avatar
                  </button>
                </div>
              )}
            </div>
          </MintOverlay>
        );
      })()}
      <motion.header
        initial={{ opacity: 0, y: BUILDER_BAR.offsetY }}
        animate={{ opacity: mountStage >= 1 ? 1 : 0, y: mountStage >= 1 ? 0 : BUILDER_BAR.offsetY }}
        transition={BUILDER_BAR.spring}
        className="relative h-12 bg-black border-b border-white/10 flex items-center justify-between px-3.5 flex-shrink-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="p-1.5 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Link href="/" className="shrink-0 opacity-90 hover:opacity-100 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/solcameo-dark.png" alt="Solcameo" width={150} height={30} className="h-[22px] w-auto object-contain" />
          </Link>
          <div className="hidden sm:flex items-center gap-2 text-sm text-white/70 min-w-0">
            <span className="text-white/30">/</span>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              // Max width tracks the pinned copilot toggle's left edge (clamp(...)
              // minus the back/logo/slash run before this input) so long names
              // ellipsize instead of running under the toggle button.
              className="truncate bg-transparent border-none outline-none text-white/90 focus:text-white transition-colors min-w-[55px] max-w-[calc(clamp(260px,22vw,340px)-205px)]"
              placeholder="Project name"
            />
          </div>
        </div>

        <SpotlightSearch actions={spotlightActions} />

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          {/* Top-bar tools — held back until the entrance unfold finishes. */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: mountStage >= 4 ? 1 : 0, y: mountStage >= 4 ? 0 : -8 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            style={{ pointerEvents: mountStage >= 4 ? "auto" : "none" }}
            className="flex items-center gap-2 md:gap-3"
          >
          {/* View mode toggle — icons + label bumped 2px larger */}
          <div className="hidden sm:flex items-center rounded-md border border-white/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setCanvasViewMode("workflow")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] transition-colors ${canvasViewMode === "workflow" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
              title="Studio (cards)"
            >
              <Workflow className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Studio</span>
            </button>
            <button
              type="button"
              onClick={() => setCanvasViewMode("mindmap")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] transition-colors ${canvasViewMode === "mindmap" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
              title="Mindmap / second brain"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Graph</span>
            </button>
          </div>

          {/* MCP tools button hidden per request — panel still reachable elsewhere. */}
          </motion.div>

          {authLoading ? (
            <span className="inline-block h-[30px] w-[7.5rem] shrink-0 animate-pulse rounded-md bg-white/[0.08]" aria-hidden />
          ) : isAuthenticated ? (
            <>
            {/* One control for the profile and both balances: the swap button flips between your wallet and the agent's. */}
            <BuilderAccount agentWalletAddress={agentWalletAddress} mintAddress={agentBlueprint?.mintAddress} agentName={agentBlueprint?.persona?.name} ready={influencerRecord !== undefined} />
            {/* Everything saves itself; this only reports it. */}
            {hasSaveableAgent && (
              <span className="hidden text-[10.5px] text-white/35 xl:inline" aria-live="polite">
                {isSavingAgent ? "Saving…" : savedAgentAt ? `Saved ${new Date(savedAgentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
              </span>
            )}
            </>
          ) : hasMounted ? (
            <button
              type="button"
              onClick={() => openWalletModal(true)}
              style={{
                height: "32px",
                fontSize: "12px",
                fontWeight: 800,
                padding: "0 16px",
                backgroundColor: "#58cc02",
                border: "2px solid transparent",
                borderRadius: "12px",
                color: "#ffffff",
                boxShadow: "0 4px 0 0 #46a302, inset 0 -1px 0 rgba(0,0,0,0.05)",
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              Connect Wallet
            </button>
          ) : (
            // SSR placeholder — matches the connect button's box dimensions
            // so the header doesn't reflow when the real button mounts.
            <div
              aria-hidden="true"
              style={{
                height: "32px",
                width: "132px",
                borderRadius: "12px",
                backgroundColor: "#58cc02",
                boxShadow: "0 4px 0 0 #46a302",
              }}
            />
          )}
        </div>
      </motion.header>

      <LowBalanceBanner ownerWallet={ownerWallet} />

      {/* Reopen-copilot FAB — only once there's actually something to reopen
          (minted agent, panel collapsed); pre-mint the panel is forced open
          so this never shows then. Pulsing ring + a one-time hint bubble
          ("bubble to open it") so a brand-new collapse state doesn't read as
          "the copilot disappeared". */}
      <AnimatePresence>
        {agentBlueprint?.mintCompleted && copilotCollapsed && (
          <motion.div
            key="copilot-fab"
            initial={{ opacity: 0, scale: 0.5, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: 24 }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
            className="fixed bottom-6 right-6 z-[130] flex items-end gap-2.5"
          >
            <AnimatePresence>
              {copilotFabBubbleShown && (
                <motion.button
                  type="button"
                  onClick={() => setCopilotCollapsed(false)}
                  initial={{ opacity: 0, scale: 0.85, x: 8 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.85, x: 8 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="mb-1 whitespace-nowrap rounded-2xl rounded-br-sm bg-white px-3.5 py-2 text-[12px] font-semibold text-zinc-900 shadow-[0_10px_28px_-8px_rgba(0,0,0,0.5)] transition-transform hover:scale-[1.03]"
                >
                  Ask your copilot
                </motion.button>
              )}
            </AnimatePresence>
            <motion.button
              type="button"
              onClick={() => setCopilotCollapsed(false)}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              aria-label="Open copilot"
              title="Open copilot"
              className="relative grid size-14 place-items-center overflow-visible rounded-full text-white shadow-[0_14px_34px_-10px_rgba(132,204,22,0.6)] ring-1 ring-black/5"
              style={{ background: "linear-gradient(135deg,#a3e635,#84cc16)" }}
            >
              {/* Pulsing ring — the "animated pulsing" ask. Two staggered
                  rings so the pulse reads continuously, not once per cycle. */}
              <motion.span
                className="absolute inset-0 rounded-full"
                style={{ background: "rgba(163,230,53,0.55)" }}
                animate={{ scale: [1, 1.7], opacity: [0.6, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.span
                className="absolute inset-0 rounded-full"
                style={{ background: "rgba(163,230,53,0.55)" }}
                animate={{ scale: [1, 1.7], opacity: [0.6, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: 0.9 }}
              />
              <MessageCircle className="relative z-10 size-6" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pre-mint, the copilot chat IS how the agent gets built — it can never
          be hidden (see `copilotCollapsed && agentBlueprint?.mintCompleted`
          below). Once minted, the operator's collapse choice (default:
          collapsed, see the state comment above) takes over. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* ── Agent Chat Panel (Cursor-like) ──────────────────────────────── */}
        <motion.aside
          initial={{ opacity: 0, y: BUILDER_CHAT.offsetY }}
          animate={{ opacity: mountStage >= 2 ? 1 : 0, y: mountStage >= 2 ? 0 : BUILDER_CHAT.offsetY }}
          transition={BUILDER_CHAT.spring}
          className={`flex min-h-0 flex-col bg-[#141414] overflow-hidden transition-[width,max-height,opacity,border-width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:h-full md:max-h-none ${
            copilotCollapsed && agentBlueprint?.mintCompleted
              ? "w-0 max-h-0 opacity-0 pointer-events-none md:w-0 md:min-w-0 md:max-w-0 border-r-0"
              : "w-full shrink-0 max-h-[min(44vh,560px)] h-[min(44vh,560px)] opacity-100 md:w-[22%] md:min-h-0 md:min-w-[260px] md:max-w-[340px] md:border-r border-white/[0.07]"
          }`}
        >

          {/* Phase stepper header — only while there's an actual phase to show;
              otherwise (no agentPhase) this was rendering as an empty padded
              bar with just a bottom-border divider and nothing in it. */}
          {agentType !== "campaign" && agentPhase && (
            <div className="shrink-0 border-b border-white/[0.07] px-3 py-2.5">
              <div className="flex items-center justify-end mb-2">
                <span className="text-[9px] text-emerald-400/70 font-mono">{getPhaseLabel(agentPhase)}</span>
              </div>
              {/* Compact phase dots */}
              {agentPhase && (
                <div className="flex items-center gap-1.5">
                  {(agentType === "influencer"
                    ? ["persona_discovery","aesthetic_upload","nft_mint","knowledge_building","agent_ready"]
                    : agentType === "trader"
                    ? ["strategy_discovery","trader_aesthetic","trader_mint","signal_setup","decision_rules","trader_ready"]
                    : agentType === "clipping"
                    ? ["clip_setup","clip_style","clip_platforms","clip_mint","clip_ready"]
                    : ["business_context","capability_mapping","knowledge_config","deployment_ready"]
                  ).map((p, i, arr) => {
                    const currentIdx = arr.indexOf(agentPhase);
                    const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
                    return (
                      <React.Fragment key={p}>
                        <div className={`h-1.5 rounded-full transition-all duration-500 ${
                          state === "done" ? "bg-emerald-400 flex-1" :
                          state === "active" ? "bg-lime-400 flex-1 shadow-[0_0_6px_rgba(163,230,53,0.6)]" :
                          "bg-white/10 flex-1"
                        }`} />
                        {i < arr.length - 1 && <div className="w-px h-1 bg-white/10 shrink-0" />}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
              {/* Reference images row (influencer only) */}
              {(agentType === "influencer" || agentType === "trader" || agentType === "clipping") && referenceImages.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  {referenceImages.map((url, i) => (
                    <div key={i} className="relative w-7 h-7 rounded overflow-hidden border border-emerald-400/40 shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`ref${i+1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                  {referenceImages.length < 3 && Array.from({ length: 3 - referenceImages.length }).map((_, i) => (
                    <div key={i} className="w-7 h-7 rounded border border-dashed border-white/15 flex items-center justify-center text-white/20 text-[8px] shrink-0">
                      +
                    </div>
                  ))}
                  <span className="text-[9px] text-white/30 ml-0.5">{referenceImages.length}/3</span>
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-2 [scrollbar-gutter:stable] scrollbar-thin scrollbar-thumb-white/10">

            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="mt-2 px-1"
              >
                <div className="mb-2">
                  <span className="text-[11px] font-semibold text-white/70">Vello Agent</span>
                </div>
                <p className="text-[12px] leading-relaxed text-white/75">
                  {agentType === "influencer"
                    ? "Let's build your AI Influencer! Just tell me 3 things: their niche (e.g. fitness, tech, beauty), their personality, and who the audience is. I'll turn that into a full persona — then we mint it on Solana and it starts creating content."
                    : agentType === "worker"
                    ? "Let's configure your AI Worker. What business is it for, and what's the primary task?"
                    : agentType === "trader"
                    ? "Let's build your AI Trader. What assets should it trade and what's the core thesis? We'll mint it as an NFT on Solana before locking the trading rules."
                    : agentType === "clipping"
                    ? "Let's build your AI Clipper! Just tell me 3 things: what kind of long videos it should clip (e.g. podcasts, streams, YouTube videos), how long each clip should be, and which platforms to post to (TikTok, Reels, Shorts). Once we mint it on Solana, it'll start turning long videos into viral shorts automatically."
                    : `Hi ${displayName}. What are you building today?`}
                </p>
              </motion.div>
            )}

            {agentType === "clipping" && agentBlueprint?.mintCompleted && (
              <ClipRunNarrator
                mintAddress={agentBlueprint?.mintAddress}
                onStage={(key, text) => {
                  const id = `clipstage-${key}`;
                  // Idempotent: the stage key is embedded in the id, so a re-render/re-mount
                  // never double-posts the same stage line.
                  setMessages((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, { id, text, sender: "ai" as const, timestamp: new Date() }]));
                }}
              />
            )}

            {messages.map((message, index) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1], delay: Math.min(index * 0.01, 0.1) }}
                className={`flex flex-col ${message.sender === "user" ? "items-end" : "items-start"}`}
              >
                {message.sender === "ai" ? (
                  <div className="w-full">
                    <div className="flex items-start">
                      <div className="flex-1 min-w-0">
                        {message.isGeneratingAvatars && !message.text ? (
                          <div className="flex items-center gap-2 py-1">
                            <LoadingBars />
                            <span className="text-[11px] text-white/40">Thinking…</span>
                          </div>
                        ) : message.isGeneratingAvatars ? (
                          <div className="py-1">
                            {/* When the progress bar shows its own label (e.g. the
                                script writer), don't ALSO show the text line above
                                it — that was the duplicated copy. */}
                            {!message.generatingLabel && (
                              <div className="flex items-center gap-2">
                                <LoadingBars />
                                <span className="text-[11px] text-white/50">{message.text}</span>
                              </div>
                            )}
                            <GenerationProgress label={message.generatingLabel} />
                          </div>
                        ) : message.needsAestheticChoice || (message.needsImageUpload && !message.text) || (message.videoScriptCard && !message.text) || (message.fundCard && !message.text) ? null : (
                          <p className="text-[11.5px] leading-relaxed text-white/80 whitespace-pre-wrap break-words">
                            {renderTextWithBold(message.text)}
                          </p>
                        )}

                        {/* Mint success — clickable link to the real NFT on the Solana explorer */}
                        {message.explorerUrl && (
                          <a
                            href={message.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 hover:underline"
                          >
                            ◆ View your NFT on Solana ↗
                          </a>
                        )}

                        {/* Influencer: script-first video confirm card */}
                        {message.videoScriptCard && (
                          <VideoScriptCard
                            data={message.videoScriptCard}
                            selectedSeconds={videoCardLengths[message.id] ?? message.videoScriptCard.estSeconds}
                            status={videoCardStatus[message.id] ?? "idle"}
                            rewriting={videoCardRewriting[message.id] ?? false}
                            onLength={(s) => void handleVideoCardLength(message.id, message.videoScriptCard as VideoScriptCardData, s)}
                            onGenerate={(s) => void handleVideoCardGenerate(message.id, message.videoScriptCard as VideoScriptCardData, s)}
                            onEdit={() => handleVideoCardEdit(message.videoScriptCard!.topic)}
                            onCancel={() => handleVideoCardCancel(message.id)}
                          />
                        )}

                        {/* Influencer: in-chat agent-wallet funding card */}
                        {message.fundCard && (
                          <FundWalletCard
                            data={message.fundCard}
                            agentWallet={agentWalletAddress}
                            agentName={agentBlueprint?.persona?.name ?? "your agent"}
                            dailyBurn={agentDailyBurn}
                          />
                        )}

                        {/* Finished generated video, rendered inline in chat */}
                        {message.videoUrl ? (
                          <video
                            src={message.videoUrl}
                            preload="metadata"
                            controls
                            playsInline
                            className="mt-2 w-full max-w-[260px] rounded-xl border border-white/[0.12] bg-black"
                          />
                        ) : message.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={message.posterUrl} alt="storyboard" className="mt-2 w-full max-w-[260px] rounded-xl border border-white/[0.12]" />
                        ) : null}

                        {/* Trader: aesthetic choice card (describe vs upload) */}
                        {message.needsAestheticChoice && (
                          <AestheticChoiceCard
                            agentName={agentType === "clipping" ? (agentBlueprint?.persona?.name ?? "your clipper") : (agentBlueprint?.trader?.name ?? "your trader")}
                            disabled={avatarGenStage === "generating" || avatarGenStage === "done"}
                            onPickPhoto={handleImageUpload}
                            onGenerate={handleGenerateWithDescription}
                          />
                        )}

                        {/* Influencer: reference-photo upload prompt with a clear button */}
                        {message.needsImageUpload && agentType !== "trader" && agentType !== "clipping" && avatarGenStage !== "generating" && avatarGenStage !== "done" && (
                          <ImageUploadPrompt
                            count={referenceImages.length}
                            onUpload={() => imageInputRef.current?.click()}
                            onCreate={() => triggerAvatarGeneration(referenceImages)}
                          />
                        )}

                        {/* Influencer: confirm → generate button (after reference photo upload) */}
                        {message.needsAvatarConfirm && avatarGenStage === "confirming" && agentType !== "trader" && agentType !== "clipping" && (
                          <motion.button
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            onClick={() => triggerAvatarGeneration(referenceImages)}
                            className="mt-2.5 flex items-center gap-2 rounded-lg bg-zinc-950 hover:bg-zinc-900 active:bg-black text-white font-semibold text-[11.5px] px-4 py-2 transition-all shadow-lg shadow-black/40 border border-white/10"
                          >
                            <Sparkles className="size-3" />
                            Create ID
                          </motion.button>
                        )}
                        {/* Animated GIF player */}
                        {message.avatars && message.avatars.length > 0 && (
                          <div className="mt-2 w-full max-w-[220px]">
                            <AvatarGifPlayer
                              images={message.avatars.filter((a) => a.url).map((a) => ({
                                url: a.url as string,
                                label: a.label,
                                style: a.style,
                              }))}
                              gifUrl={message.gifUrl}
                              personaName={agentBlueprint?.persona?.name ?? agentBlueprint?.trader?.name}
                            />
                          </div>
                        )}
                        {/* NFT Mint Card */}
                        {/* The mint card itself lives in the full-screen MintOverlay;
                            here we show a chip to (re)open it once collapsed. */}
                        {message.needsMint && !agentBlueprint?.mintCompleted && mintOverlayCollapsed && (
                          <button
                            type="button"
                            onClick={() => setMintOverlayCollapsed(false)}
                            className="mt-2 inline-flex items-center gap-2 rounded-full bg-lime-400/[0.06] px-3.5 py-2 text-[12px] font-semibold text-lime-200 ring-1 ring-lime-400/25 transition-colors hover:bg-lime-400/[0.12]"
                          >
                            <Sparkles className="size-3.5" /> Ready to go live — open
                          </button>
                        )}

                        {/* Clipping: live job monitor inline in the chat */}
                        {message.clipProgress && (
                          <div className="mt-2">
                            <ClipJobProgress mintAddress={agentBlueprint?.mintAddress} variant="compact" />
                          </div>
                        )}

                        {/* Clipping: one-click module install gate */}
                        {message.needsClipInstall !== undefined && (
                          <div className="mt-2 rounded-xl border border-lime-400/25 bg-lime-400/[0.05] p-3">
                            <p className="text-[12px] font-semibold text-white">Clipping module required</p>
                            <p className="mt-1 text-[10.5px] text-zinc-400">download · transcribe · find moments · cut · auto-post</p>
                            <button
                              type="button"
                              onClick={() => handleInstallClipModule(message.needsClipInstall ?? "")}
                              className="mt-2.5 w-full rounded-lg bg-lime-400 hover:bg-lime-300 active:translate-y-px text-lime-950 text-[12px] font-bold py-2 transition-all"
                            >
                              Install module &amp; clip
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-[88%]">
                    {message.imageUrl && (
                      <img
                        src={message.imageUrl}
                        alt="Reference"
                        className="w-full max-h-40 object-cover rounded-lg mb-1 border border-white/10"
                      />
                    )}
                    {(!message.imageUrl || message.text.replace(/^\[Uploaded reference image: [^\]]+\]/, "").trim()) && (
                      <div className="rounded-lg bg-white/[0.08] border border-white/[0.10] px-2.5 py-1.5">
                        <p className="text-[11.5px] text-white/85 whitespace-pre-wrap break-words">
                          {message.text.replace(/^\[Uploaded reference image: [^\]]+\]\s*/, "")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ))}

            {isProcessing && (
              <div className="flex items-center gap-2">
                <LoadingBars />
                <span className="text-[10.5px] text-white/40">thinking…</span>
              </div>
            )}
            {isAutoSetupRunning && !isProcessing && (
              <div className="flex items-center gap-2">
                <LoadingBars />
                <span className="text-[10.5px] text-lime-300/60">Building workspace…</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Cursor-style input bar ─────────────────────────────────────── */}
          <div className="shrink-0 border-t border-white/[0.07] bg-[#141414] px-3 py-1.5">
            <form onSubmit={handleComposerSubmit}>
              <div className="flex items-center gap-2 rounded-lg border border-white/[0.10] bg-white/[0.04] px-2.5 py-1 focus-within:border-white/[0.18] transition-colors">
                {/* Left actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {(agentType === "influencer" || agentType === "trader" || agentType === "clipping") && avatarGenStage !== "done" && (
                    <>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        aria-label="Upload reference photo"
                        className="sr-only"
                        onChange={handleImageUpload}
                        disabled={avatarGenStage === "generating" || referenceImages.length >= maxRefImages}
                      />
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={avatarGenStage === "generating" || referenceImages.length >= maxRefImages}
                        title={referenceImages.length >= maxRefImages ? `${maxRefImages} ref${maxRefImages === 1 ? "" : "s"} captured` : `Add reference photo ${referenceImages.length + 1}/${maxRefImages}`}
                        className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${
                          referenceImages.length >= maxRefImages
                          ? "text-emerald-400/50 cursor-default"
                          : "text-white/40 hover:text-white/70 hover:bg-white/5"
                        } disabled:opacity-30`}
                      >
                        <ImageIcon className="w-3 h-3" />
                        {referenceImages.length > 0 && (
                          <span className={referenceImages.length >= maxRefImages ? "text-emerald-400/80" : "text-white/40"}>
                            {referenceImages.length}/{maxRefImages}
                          </span>
                        )}
                      </button>
                    </>
                  )}
                  {agentType === "clipping" && agentBlueprint?.mintCompleted && (
                    <>
                      <input
                        ref={chatMediaInputRef}
                        type="file"
                        accept="video/*,image/*"
                        multiple
                        aria-label="Upload a video to clip"
                        className="sr-only"
                        onChange={(e) => void handleChatMediaUpload(e)}
                      />
                      <button
                        type="button"
                        onClick={() => chatMediaInputRef.current?.click()}
                        disabled={chatUploading}
                        title="Upload a video to clip — it opens in the Clipping tab"
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white/40 transition-all hover:bg-white/5 hover:text-white/70 disabled:opacity-40"
                      >
                        {chatUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                        <span>Video</span>
                      </button>
                    </>
                  )}
                </div>

                {/* Text input */}
                <input
                  type="text"
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    agentType === "influencer" ? "Message AI Influencer Architect…"
                    : agentType === "worker" ? "Message AI Worker Architect…"
                    : agentType === "trader" ? "Message AI Trader Architect…"
                    : agentType === "clipping" ? "Message AI Clipper Architect…"
                    : "Message Vello Agent…"
                  }
                  className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px] text-white/90 placeholder-white/25 leading-tight resize-none h-6"
                />

                {/* Send */}
                <motion.button
                  type="submit"
                  disabled={isProcessing || !inputText.trim()}
                  aria-label="Send message"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all ${
                    inputText.trim() && !isProcessing
                      ? "bg-lime-400 text-zinc-950 hover:bg-lime-300 shadow-md"
                      : "bg-white/[0.06] text-white/20 cursor-not-allowed"
                  }`}
                  whileHover={{ scale: inputText.trim() && !isProcessing ? 1.05 : 1 }}
                  whileTap={{ scale: 0.93 }}
                >
                  {isProcessing ? <LoadingBars compact /> : <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.5} />}
                </motion.button>
              </div>
            </form>
          </div>
        </motion.aside>

        <motion.main
          initial={{ opacity: 0 }}
          animate={{ opacity: mountStage >= 3 ? 1 : 0 }}
          /* opacity-only (no transform): the canvas has position:fixed descendants
             that a lingering ancestor transform would break. Slow, soft fade. */
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 relative overflow-hidden bg-[#ece5d6] min-h-0"
        >
          {canvasViewMode === "workflow" ? (
            <AgentWorkspace
              blueprint={agentBlueprint ?? { agentType: "influencer" }}
              skillDefs={agentSkillDefs}
              sessionId={sessionIdRef.current ?? undefined}
              knowledgeEntries={(dbKnowledge ?? []).map((e: Doc<"agentKnowledge">) => ({
                id: e.localId ?? e._id,
                _id: e._id,
                title: e.title,
                content: e.content,
                tags: e.tags,
                category: e.category,
                _creationTime: e._creationTime,
              }))}
              avatarUrls={nftAvatarUrls}
              characterBible={characterBible}
              externalTickToken={externalTickToken}
              forceTab={forceTraderTab}
              forceClipTab={forceClipTab}
              forceWorkspaceTab={forceWorkspaceTab}
              onFireHeartbeat={() => fireHeartbeatNow()}
              onAutoFireHeartbeat={() => fireHeartbeatNow({ auto: true })}
              onEditField={(path) => {
                // Nudge the user to chat — assistant will pick this up via the next turn
                setInputText(`Help me update ${path}`);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              onToggleContentType={(t) => {
                setAgentBlueprint((prev) => {
                  const current = prev?.persona?.contentTypes ?? [];
                  const nextList = current.includes(t)
                    ? current.filter((x) => x !== t)
                    : [...current, t];
                  return { ...prev, persona: { ...(prev?.persona ?? {}), contentTypes: nextList } };
                });
              }}
              onToggleSkill={(skillId, install) => {
                setAgentBlueprint((prev) => {
                  const current = prev?.installedSkills ?? [];
                  const nextSkills = install
                    ? Array.from(new Set([...current, skillId]))
                    : current.filter((id) => id !== skillId);
                  // Recompute burn rate + runway from the new skill set
                  const newDailyBurn = estimateDailyBurn(nextSkills);
                  const balance = prev?.wallet?.balanceUsdc ?? 0;
                  const newRunway = newDailyBurn > 0 ? balance / newDailyBurn : undefined;
                  return {
                    ...prev,
                    installedSkills: nextSkills,
                    wallet: {
                      ...(prev?.wallet ?? { balanceUsdc: 0, earnings: { lifetimeUsdc: 0, last30dUsdc: 0, last7dUsdc: 0 }, burnRate: { dailyUsdc: 0 } }),
                      burnRate: { dailyUsdc: newDailyBurn },
                      runwayDays: newRunway,
                    },
                  };
                });
                // Surface the change in the chat — keeps the copilot in the loop
                const skill = SKILLS_CATALOG_V1.find((s) => s.id === skillId);
                if (skill) {
                  setMessages((m) => [...m, {
                    id: `${Date.now()}-skill`,
                    text: install
                      ? `**${skill.name}** installed. Adds ~$${(skill.pricePerUseUsdc * skill.avgUsesPerDay).toFixed(2)}/day to burn rate.`
                      : `**${skill.name}** uninstalled.`,
                    sender: "ai" as const,
                    timestamp: new Date(),
                  }]);
                }
              }}
              onHeartbeatChange={(heartbeat) => {
                setAgentBlueprint((prev) => ({ ...prev, heartbeat }));
              }}
              onVideoEngineChange={(videoEngine) => {
                setAgentBlueprint((prev) => ({ ...prev, videoEngine }));
                // Persist to Convex if already minted
                const mint = agentBlueprint?.mintAddress;
                if (mint) {
                  void saveAgentConfigEarly({ mintAddress: mint, videoEngine });
                }
              }}
              onUploadKnowledge={() => {
                // Switch to graph view so user can use the existing knowledge upload UI
                setCanvasViewMode("mindmap");
              }}
              onConnectWallet={() => openWalletModal(true)}
              onDeploy={() => triggerClipMintFlow()}
              onTestAgent={() => {
                const mintAddr = agentBlueprint?.mintAddress;
                if (!mintAddr) {
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `${Date.now()}-test-block`,
                      text: "Go live with the agent first before running a test task — testing requires an on-chain agent address.",
                      sender: "ai" as const,
                      timestamp: new Date(),
                    },
                  ]);
                  return;
                }
                void fetch("/api/agents/run-task", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    mintAddress: mintAddr,
                    taskType: "create_video",
                    title: "Test video",
                    input: { topic: agentBlueprint?.persona?.contentPillars?.[0] ?? "intro" },
                    triggeredBy: "user",
                  }),
                }).catch(() => undefined);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-test-start`,
                    text: `Running a test task for ${agentBlueprint?.persona?.name ?? "your agent"} — generating a sample video plan…`,
                    sender: "ai" as const,
                    timestamp: new Date(),
                  },
                ]);
              }}
            />
          ) : (
            <MindmapCanvas
              nodes={nodes}
              skillDefs={agentSkillDefs}
              sessionId={sessionIdRef.current ?? undefined}
              memories={(agentMemories ?? []).map((m: Doc<"agentMemory">) => ({
                _id: m._id,
                kind: m.kind,
                summary: m.summary,
                importance: m.importance,
                mintAddress: m.mintAddress,
              }))}
              dbEntries={dbKnowledge?.map((e: Doc<"agentKnowledge">) => ({
                id: e.localId ?? e._id,
                title: e.title,
                content: e.content,
                tags: e.tags,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                category: e.category as any,
                links: e.links,
                createdAt: e._creationTime,
                updatedAt: e._creationTime,
              }))}
              onKnowledgeSave={(entry) => {
                // Save to Convex DB
                const sessionId = sessionIdRef.current ?? "";
                if (sessionId) {
                  void saveKnowledge({
                    sessionId,
                    title: entry.title,
                    content: entry.content,
                    tags: entry.tags,
                    category: entry.category,
                    links: entry.links,
                    entryType: "user_added",
                    localId: entry.id,
                  });
                }
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-brain`,
                    text: `**"${entry.title}"** added to your Second Brain and saved to the database. It's now linked to the relevant skill nodes in the graph.`,
                    sender: "ai" as const,
                    timestamp: new Date(),
                  },
                ]);
              }}
              onKnowledgeDelete={(localId) => {
                // Delete from Convex DB if we have the _id
                const dbEntry = dbKnowledge?.find((e: Doc<"agentKnowledge">) => e.localId === localId || e._id === localId);
                if (dbEntry) {
                  void deleteKnowledge({ id: dbEntry._id });
                }
              }}
              onDeleteAll={() => {
                const sessionId = sessionIdRef.current ?? "";
                if (sessionId) void deleteAllKnowledge({ sessionId });
                void deleteAllMemories({
                  mintAddress: agentBlueprint?.mintAddress,
                  sessionId: sessionId || undefined,
                });
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-brain-wipe`,
                    text: "Cleared this agent's Second Brain — every knowledge entry and memory is gone. Starting fresh from here.",
                    sender: "ai" as const,
                    timestamp: new Date(),
                  },
                ]);
              }}
            />
          )}
          <BuilderResultDrawer
            open={false}
            onClose={() => setIsResultDrawerOpen(false)}
            campaignBlueprint={campaignBlueprint}
            clientActions={clientActions}
            communityId={communityId || undefined}
            websiteTitle={websiteTitle}
            canvasNodes={nodes}
            onNavigate={handleClientAction}
            onCommunityResolved={handleCommunityResolved}
            onWorkspaceCreated={handleWorkspaceCreated}
          />
          <BuilderMcpPanel
            open={isMcpPanelOpen}
            onClose={() => setIsMcpPanelOpen(false)}
            campaignBlueprint={campaignBlueprint}
            pendingToolCalls={pendingToolCalls}
            onToolCallApprove={handleToolCallApprove}
            onToolCallDismiss={handleToolCallDismiss}
            onMessage={(text) =>
              setMessages((prev) => [
                ...prev,
                { id: `${Date.now()}-mcp`, text, sender: "ai" as const, timestamp: new Date() },
              ])
            }
          />
        </motion.main>
      </div>

      <footer className="h-10 bg-[#1a1a1a] border-t border-white/10 flex items-center justify-center gap-6 text-xs text-white/50 flex-shrink-0">
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white transition-colors"
        >
          Read Documentation
        </a>
        <a
          href="https://discord.gg/EPqfhEdEb"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white transition-colors"
        >
          Join our Community
        </a>
        <a
          href={`mailto:syakir@vello.gg?subject=${encodeURIComponent(
            "Request: Managed agent setup",
          )}&body=${encodeURIComponent(
            "Hi Vello team,\n\nI'd like a manager to help create and operate AI agents on my behalf. Please set up and run agents for me end to end (persona, content, posting, and campaigns).\n\nHere's a bit about what I'm looking for:\n- Goal / niche:\n- Platforms to post on:\n- Anything specific you want the agents to do:\n\nThanks!",
          )}`}
          className="hover:text-white transition-colors"
        >
          Ask For Manager
        </a>
      </footer>

      <AnimatePresence>
        {agentType === "clipping" && showWalkthrough && (
          <ClipperWalkthrough agentPhase={agentPhase} onClose={() => setShowWalkthrough(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function BuilderSplash() {
  return (
    <div className="flex h-screen items-center justify-center bg-black flex-col gap-4">
      <motion.div
        className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-[0_0_50px_rgba(59,130,246,0.35)]"
        animate={{
          scale: [1, 1.05, 1],
          boxShadow: [
            "0 0 30px rgba(59,130,246,0.25)",
            "0 0 55px rgba(99,102,241,0.45)",
            "0 0 30px rgba(59,130,246,0.25)",
          ],
        }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <Zap className="w-8 h-8 text-white" fill="currentColor" />
      </motion.div>
      <div className="flex items-center gap-2 text-sm text-white/40">
        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
        Loading builder...
      </div>
    </div>
  );
}

/** Reads `?mint=` and keys <BuilderPageInner> by it, so switching agents from
 *  Studio (a client-side nav that only changes the query string, same route
 *  instance) forces a full remount instead of reusing the previous agent's
 *  component tree. The manual mint-keyed hydration below (hydratedMintRef,
 *  sessionIdRef re-adoption, etc.) was built to patch that reuse in place,
 *  but effect-ordering with the mount-only localStorage-restore effect left
 *  a window where the FIRST agent opened in a tab kept winning on every
 *  later switch — a remount sidesteps that whole class of bug by resetting
 *  every ref/state to its initial value for each agent, same as a hard nav
 *  would, with none of the reload cost. */
function BuilderPageKeyed() {
  const searchParams = useSearchParams();
  const mintKey = searchParams.get("mint")?.trim() || "new";
  if (mintKey === "new") return <InfluencerOnboarding />;
  return <AgentCreationGate allowResume><BuilderPageInner key={mintKey} /></AgentCreationGate>;
}

export default function BuilderPage() {
  return (
    <Suspense fallback={<BuilderSplash />}>
      <BuilderPageKeyed />
    </Suspense>
  );
}
