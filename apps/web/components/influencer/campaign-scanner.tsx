"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Progress } from "@/components/ui/progress";
import {
  ScanSearch, CheckCircle2, DollarSign, Calendar, Loader2,
  Video, Zap, Star, Layers, Sparkles, X,
} from "lucide-react";
import type { AIInfluencer } from "@/lib/types";
import { getContentRewards, type ContentReward } from "@/lib/content-rewards";
import { isRestrictedCampaign, isAllowedRestrictedEmail } from "@/lib/restrictedCampaigns";
import { isJoinableCampaign, isJoinableUgcCampaign } from "@/lib/campaignLifecycle";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

const LANG: Record<string, string> = {
  en: "English", ms: "Malay", id: "Indonesian", ar: "Arabic",
  zh: "Chinese", hi: "Hindi", es: "Spanish", fr: "French",
};

const NICHE_RELATED: Record<string, string[]> = {
  lifestyle:  ["fashion", "travel", "food", "fitness"],
  tech:       ["gaming", "finance"],
  finance:    ["tech"],
  gaming:     ["tech", "lifestyle"],
  fashion:    ["lifestyle", "travel"],
  fitness:    ["lifestyle", "food"],
  food:       ["lifestyle", "fitness", "travel"],
  travel:     ["lifestyle", "food", "fashion"],
};

/* ── campaign type badge ─────────────────────────────────────────────── */
function CampaignTypeBadge({ type }: { type?: string }) {
  if (type === "agent_task")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[10px] font-semibold">
        <Zap className="size-2.5" />Agent Task
      </span>
    );
  if (type === "bounty")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-semibold">
        <Video className="size-2.5" />UGC Bounty
      </span>
    );
  if (type === "marketing")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/20 border border-orange-500/30 text-orange-300 text-[10px] font-semibold">
        <Star className="size-2.5" />Brand Marketing
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold">
      <Layers className="size-2.5" />UGC / Clipping
    </span>
  );
}

function MatchBadge({ score }: { score: number }) {
  const cls =
    score >= 80 ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300" :
    score >= 50 ? "bg-yellow-500/20 border-yellow-500/30 text-yellow-300" :
    "bg-zinc-700/50 border-zinc-700 text-zinc-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${cls}`}>
      {score}% match
    </span>
  );
}

/* ── types ───────────────────────────────────────────────────────────── */
type Campaign = FunctionReturnType<typeof api.campaigns.list>[number];
type BuilderCampaign = FunctionReturnType<typeof api.builder.listActiveCampaigns>[number];

interface MatchedCampaign {
  id: string;
  title: string;
  brandName: string;
  brandLogoUrl: string;
  brief?: string;
  campaignType?: string;
  budget: number;
  deadline: string;
  score: number;
  reasons: string[];
  source: "campaign" | "builder";
  // extra context passed to content generator
  ratePerThousandViews?: number;
  deliverables?: string;
  contentLinks?: string[];
  // rich campaign understanding → grounds the generated script in the real brand
  description?: string;
  requirements?: string[];
  websiteUrl?: string;
  audience?: string;
  brandKnowledge?: string;
  platforms?: string[];
  productImageUrl?: string;
}

// First real http(s) URL among a campaign's link fields — the brand site/app.
function firstUrl(...vals: (string | string[] | undefined)[]): string | undefined {
  for (const v of vals) {
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    for (const u of arr) {
      if (typeof u === "string" && /^https?:\/\/\S+\.\S+/i.test(u.trim())) return u.trim();
    }
  }
  return undefined;
}

interface GenerateResult {
  script: string;
  imageDataUri: string;          // storyboardImageUrl (kept name for back-compat)
  videoUrl?: string;             // final stitched Veo video
  storyboardImageUrl?: string;
  durationSeconds?: number;
  videoError?: string;
  storyboardError?: string;
  hashtags?: string[];
  caption?: string;
  async?: boolean;               // video renders in the background; appears in Creations when ready
  posting?: { status: string; platforms?: string[]; note?: string } | null;
  submission?: { status: string; note?: string; submissionId?: string } | null;
}

/* ── scoring ─────────────────────────────────────────────────────────── */
function scoreCampaign(c: Campaign, inf: AIInfluencer): { score: number; reasons: string[] } | null {
  const reasons: string[] = [];
  let score = 0;

  const type = (c.campaignType ?? "").toLowerCase();
  const targetNiches: string[] = c.targetNiche ?? [];
  const targetLangs: string[]  = c.targetLanguage ?? [];
  const related = NICHE_RELATED[inf.niche] ?? [];

  // UGC / bounty / agent_task / untyped → open to ALL AI agents
  const isUGC = type === "bounty" || type === "agent_task" || type === "ugc" || type === "";
  if (isUGC) {
    score += 35;
    reasons.push("Open to AI agents");
  }

  // Niche scoring — never a hard gate for UGC
  if (targetNiches.length === 0) {
    score += 20;
    reasons.push("Open to all niches");
  } else if (targetNiches.includes(inf.niche)) {
    score += 45;
    reasons.push(`${inf.niche} niche`);
  } else if (targetNiches.some((n) => related.includes(n))) {
    score += 20;
    const matched = targetNiches.find((n) => related.includes(n))!;
    reasons.push(`Related niche (${matched})`);
  } else if (isUGC) {
    score += 5; // UGC mismatch still eligible, just ranked lower
  } else {
    return null; // marketing campaign + wrong niche = hard skip
  }

  // Language bonus
  if (targetLangs.length === 0) {
    score += 10;
  } else if (targetLangs.includes(inf.language)) {
    score += 20;
    reasons.push(`${LANG[inf.language] ?? inf.language} speaker`);
  }

  // Minimum threshold — 35 = UGC base alone already passes
  if (score < 35) return null;

  return { score: Math.min(score, 100), reasons };
}

function scoreContentReward(cr: ContentReward, inf: AIInfluencer): { score: number; reasons: string[] } | null {
  let score = 40; // content rewards are always open to AI agents
  const reasons: string[] = ["Content reward — open to AI agents"];
  const related = NICHE_RELATED[inf.niche] ?? [];

  // Category match
  const cat = (cr.category ?? "").toLowerCase();
  if (cat === inf.niche) {
    score += 30; reasons.push(`${inf.niche} category`);
  } else if (related.some((r) => cat.includes(r) || r.includes(cat))) {
    score += 15; reasons.push(`Related category (${cr.category})`);
  } else if (cat === "" || cat === "general") {
    score += 10; reasons.push("General category");
  }

  // Platform bonus (AI agents can post to most platforms)
  if ((cr.platforms ?? []).length > 0) {
    score += 5; reasons.push(`${cr.platforms.slice(0, 2).join(", ")}`);
  }

  // Budget remaining
  if ((cr.budget_remaining ?? cr.budget) > 0) {
    score += 5; reasons.push("Budget available");
  }

  if (score < 35) return null;
  return { score: Math.min(score, 100), reasons };
}

function buildMatches(
  campaigns: Campaign[],
  builderCampaigns: BuilderCampaign[],
  contentRewards: ContentReward[],
  inf: AIInfluencer
): MatchedCampaign[] {
  const results: MatchedCampaign[] = [];

  // Brand campaigns — only FUNDED on-chain + LIVE ones are joinable (isJoinableCampaign
  // derives the real lifecycle since stored `status` is frozen at "open"). An AI
  // INFLUENCER is further limited to UGC campaigns; a clipping campaign is a clipper's
  // job. (This scanner is for influencer-family agents.)
  const isInfluencer = (inf.agentType ?? "influencer") === "influencer";
  for (const c of campaigns) {
    if (!(isInfluencer ? isJoinableUgcCampaign(c as Record<string, unknown>) : isJoinableCampaign(c as Record<string, unknown>))) continue;
    const result = scoreCampaign(c, inf);
    if (!result) continue;
    results.push({
      id: c._id as string,
      title: c.title,
      brandName: c.brandName,
      brandLogoUrl: c.brandLogoUrl,
      brief: c.brief,
      campaignType: c.campaignType,
      budget: c.budget,
      deadline: c.deadline,
      score: result.score,
      reasons: result.reasons,
      source: "campaign",
      ratePerThousandViews: c.ratePerThousandViews,
      deliverables: c.deliverables,
      contentLinks: c.contentLinks,
      description: c.brief,
      requirements: c.deliverables ? [c.deliverables] : undefined,
      websiteUrl: firstUrl(c.contentLinks),
      platforms: c.platforms,
      productImageUrl: c.campaignImageUrl ?? c.brandLogoUrl,
    });
  }

  // Content reward / builder campaigns — always eligible for AI agents
  for (const c of builderCampaigns) {
    if (c.status === "draft" && !c.budgetUsdc) continue;
    const workspace = c.workspace;
    if (!workspace) continue;
    const product = c.product;

    let score = 45;
    const reasons: string[] = ["Content reward"];
    const related = NICHE_RELATED[inf.niche] ?? [];

    if (c.campaignType === "bounty")     { score += 10; reasons.push("Open bounty"); }
    if (c.campaignType === "agent_task") { score += 15; reasons.push("Agent task"); }

    // Tag-based niche match
    const tags: string[] = (workspace.tags ?? []).map((t: string) => t.toLowerCase());
    if (tags.length === 0) {
      score += 10; reasons.push("Open to all niches");
    } else if (tags.includes(inf.niche)) {
      score += 20; reasons.push(`${inf.niche} niche`);
    } else if (tags.some((t) => related.includes(t))) {
      score += 10;
      reasons.push(`Related niche (${tags.find((t) => related.includes(t))})`);
    }

    // Keyword match in description / angle / audience
    const blob = [c.angle, workspace.audience, workspace.description]
      .filter(Boolean).join(" ").toLowerCase();
    if (blob.includes(inf.niche) && !reasons.some((r) => r.includes("niche"))) {
      score += 8; reasons.push(`${inf.niche} niche`);
    }

    results.push({
      id: c._id as string,
      title: c.name,
      brandName: workspace.name,
      brandLogoUrl: workspace.profileImageUrl ??
        `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(workspace.name)}&backgroundColor=1a1a2e`,
      brief: c.angle ?? product?.headline ?? workspace.description ?? undefined,
      campaignType: c.campaignType ?? undefined,
      budget: c.budgetUsdc ?? 0,
      deadline: "Ongoing",
      score: Math.min(score, 100),
      reasons,
      source: "builder",
      description: product?.description ?? workspace.description ?? undefined,
      requirements: Array.isArray(product?.deliverables) ? product!.deliverables : undefined,
      websiteUrl: firstUrl(product?.sourceUrl, workspace.sourceUrl),
      audience: workspace.audience ?? undefined,
      brandKnowledge: workspace.knowledgeBaseText ?? undefined,
      productImageUrl: product?.imageUrl ?? workspace.coverImageUrl ?? undefined,
    });
  }

  // Supabase content rewards
  for (const cr of contentRewards) {
    if (cr.status !== "active") continue;
    const result = scoreContentReward(cr, inf);
    if (!result) continue;
    results.push({
      id: `cr_${cr.id}`,
      title: cr.campaign_name,
      brandName: cr.communityName || cr.ownerName || "Jobtepi",
      brandLogoUrl: cr.communityImage || cr.ownerImage ||
        `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(cr.campaign_name)}&backgroundColor=1a1a2e`,
      brief: cr.content_requirements?.slice(0, 3).join("; ") || undefined,
      campaignType: "bounty",
      budget: Number(cr.budget) || 0,
      deadline: "Ongoing",
      score: result.score,
      reasons: result.reasons,
      source: "builder",
      ratePerThousandViews: Number(cr.reward_rate) || 0,
      description: cr.available_content || undefined,
      requirements: cr.content_requirements?.length ? cr.content_requirements : undefined,
      websiteUrl: firstUrl(cr.available_content),
      platforms: cr.platforms?.length ? cr.platforms : undefined,
      productImageUrl: cr.thumbnail_url || undefined,
    });
  }

  const seen = new Set<string>();
  return results
    .sort((a, b) => b.score - a.score)
    .filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

/* ── Generate button + result ────────────────────────────────────────── */
function GeneratePanel({ match, influencer }: { match: MatchedCampaign; influencer: AIInfluencer }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");

  async function handleGenerate() {
    setState("loading");
    try {
      const res = await fetch("/api/influencer/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ influencer, campaign: match }),
      });
      const data = await res.json() as {
        ok?: boolean; error?: string; async?: boolean;
        script?: string; imageDataUri?: string;
        videoUrl?: string; storyboardImageUrl?: string; durationSeconds?: number;
        videoError?: string; storyboardError?: string;
        caption?: string; hashtags?: string[];
        posting?: { status: string; platforms?: string[]; note?: string } | null;
        submission?: { status: string; note?: string; submissionId?: string } | null;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Generation failed");
      setResult({
        script: data.script ?? "",
        imageDataUri: data.storyboardImageUrl ?? data.imageDataUri ?? "",
        videoUrl: data.videoUrl,
        storyboardImageUrl: data.storyboardImageUrl,
        durationSeconds: data.durationSeconds,
        videoError: data.videoError,
        storyboardError: data.storyboardError,
        caption: data.caption,
        hashtags: data.hashtags,
        async: data.async,
        posting: data.posting,
        submission: data.submission,
      });
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setState("error");
    }
  }

  if (state === "idle")
    return (
      <button
        onClick={handleGenerate}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-semibold hover:bg-violet-500/20 transition-colors"
      >
        <Sparkles className="size-3" />
        Generate Content
      </button>
    );

  if (state === "loading")
    return (
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <Loader2 className="size-3.5 animate-spin text-violet-400" />
        Writing the script &amp; queuing the render…
      </div>
    );

  if (state === "error")
    return (
      <div className="flex items-center gap-2">
        <p className="text-[11px] text-red-400">{error}</p>
        <button onClick={() => setState("idle")} className="text-[10px] text-zinc-500 underline">Retry</button>
      </div>
    );

  // done
  return (
    <div className="mt-2 space-y-3 border-t border-zinc-800 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-violet-400">Generated Content</span>
        <button onClick={() => { setState("idle"); setResult(null); }} className="text-zinc-600 hover:text-zinc-400">
          <X className="size-3" />
        </button>
      </div>

      {/* Async render banner — the stitched, script-length video is produced in the
          background (same job as the builder) and lands in the Generations / Creations tab. */}
      {result?.async && !result?.videoUrl && (
        <div className="flex items-start gap-2 rounded-lg border border-violet-500/20 bg-violet-500/[0.07] px-3 py-2">
          <Loader2 className="size-3.5 mt-0.5 shrink-0 animate-spin text-violet-300" />
          <div>
            <p className="text-[11.5px] font-semibold text-violet-200">Rendering your video…</p>
            <p className="text-[10.5px] text-zinc-400 leading-relaxed mt-0.5">
              Stitched to your script length{result.durationSeconds ? ` (~${result.durationSeconds}s)` : ""}. It&apos;ll appear in the agent&apos;s <span className="text-zinc-300">Generations</span> tab when ready and auto-post to connected accounts.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        {/* Video player if rendered, else storyboard still */}
        {result?.videoUrl ? (
          <div className="shrink-0">
            <video
              src={result.videoUrl}
              controls
              playsInline
              className="w-32 h-[228px] object-cover rounded-lg border border-emerald-500/40"
            />
            <p className="text-[9px] text-emerald-400 mt-1 text-center font-semibold uppercase tracking-wider">
              Video · {result.durationSeconds ?? 8}s
            </p>
          </div>
        ) : result?.imageDataUri && (
          <div className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.imageDataUri}
              alt="Storyboard"
              className="w-32 h-[228px] object-cover rounded-lg border border-zinc-700"
            />
            <p className="text-[9px] text-zinc-600 mt-1 text-center">
              {result?.videoError ? "Storyboard (video failed)" : "Storyboard"}
            </p>
          </div>
        )}

        {/* Script + caption */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-2.5 max-h-52 overflow-y-auto">
            <pre className="text-[10px] text-zinc-300 leading-relaxed whitespace-pre-wrap font-sans">
              {result?.script}
            </pre>
          </div>
          {result?.videoError && (
            <p className="text-[10px] text-amber-400">⚠ Video step failed: {result.videoError.slice(0, 140)}</p>
          )}
          {result?.posting && (
            result.posting.status === "posted" ? (
              <p className="text-[10px] text-emerald-400">✓ Posted to {result.posting.platforms?.join(", ") || "connected accounts"}</p>
            ) : result.posting.status === "needs_connection" ? (
              <p className="text-[10px] text-amber-400">⚠ {result.posting.note ?? "Connect a social account to auto-post."}</p>
            ) : result.posting.status === "failed" ? (
              <p className="text-[10px] text-red-400">✗ Post failed: {(result.posting.note ?? "").slice(0, 140)}</p>
            ) : (
              <p className="text-[10px] text-zinc-500">{result.posting.note ?? "Posting skipped."}</p>
            )
          )}
          {result?.submission && (
            result.submission.status === "submitted" ? (
              <p className="text-[10px] text-emerald-400">✓ Submitted to campaign</p>
            ) : result.submission.status === "already_submitted" ? (
              <p className="text-[10px] text-zinc-500">Already submitted to this campaign</p>
            ) : result.submission.status === "failed" ? (
              <p className="text-[10px] text-red-400">✗ Submit failed: {(result.submission.note ?? "").slice(0, 120)}</p>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}

/* ── main component ──────────────────────────────────────────────────── */
interface CampaignScannerProps {
  influencer: AIInfluencer;
}

type ScanState = "idle" | "scanning" | "done";

export function CampaignScanner({ influencer }: CampaignScannerProps) {
  const campaigns        = useQuery(api.campaigns.list);
  const builderCampaigns = useQuery(api.builder.listActiveCampaigns);
  const { profile }      = useSupabaseAuth();
  const allowedRestricted = isAllowedRestrictedEmail(profile?.email);

  const [contentRewards, setContentRewards] = useState<ContentReward[]>([]);
  const [rewardsLoading, setRewardsLoading]  = useState(true);

  const [scanState, setScanState]         = useState<ScanState>("idle");
  const [matches, setMatches]             = useState<MatchedCampaign[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    getContentRewards().then((data) => {
      setContentRewards(data);
      setRewardsLoading(false);
    }).catch(() => setRewardsLoading(false));
  }, []);

  // Block until both primary sources are ready
  const isLoading = campaigns === undefined || rewardsLoading;

  useEffect(() => {
    if (scanState !== "scanning") return;
    if (matches.length === 0) { setScanState("done"); return; }
    const interval = setInterval(() => {
      setRevealedCount((prev) => {
        const next = prev + 1;
        if (next >= matches.length) { clearInterval(interval); setScanState("done"); }
        return next;
      });
    }, 220);
    return () => clearInterval(interval);
  }, [scanState, matches]);

  function handleScan() {
    if (!campaigns) return;
    // Restricted campaigns are only scannable/joinable by the allowed account's
    // agents (the server submit gate blocks the rest, but keep them out of the
    // agent's match list too so it never tries).
    const visibleRewards = allowedRestricted
      ? contentRewards
      : contentRewards.filter(
          (r) => !isRestrictedCampaign({ contentRewardId: r.id, title: r.campaign_name }),
        );
    const found = buildMatches(
      campaigns,
      builderCampaigns ?? [],
      visibleRewards,
      influencer
    );
    setMatches(found);
    setRevealedCount(0);
    setScanState("scanning");
  }

  const progress = matches.length > 0 ? Math.round((revealedCount / matches.length) * 100) : 100;
  const buttonLabel =
    scanState === "idle"     ? "Scan Available Campaigns" :
    scanState === "scanning" ? "Scanning…" :
    "Rescan Campaigns";

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleScan}
          disabled={isLoading || scanState === "scanning"}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[13px] font-semibold hover:bg-indigo-500/20 hover:text-indigo-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLoading || scanState === "scanning"
            ? <Loader2 className="size-3.5 animate-spin" />
            : <ScanSearch className="size-3.5" />}
          {isLoading ? "Loading…" : buttonLabel}
        </button>

        {scanState !== "idle" && (
          <span className="text-[11px] text-zinc-500">
            {scanState === "scanning"
              ? `Found ${revealedCount} of ${matches.length}…`
              : `${matches.length} campaign${matches.length !== 1 ? "s" : ""} eligible`}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {scanState === "scanning" && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-zinc-600">
            <span>Scanning campaigns + content rewards…</span>
            <span className="font-mono">{revealedCount}/{matches.length}</span>
          </div>
          <Progress value={progress} className="h-1 bg-zinc-800 [&>div]:bg-gradient-to-r [&>div]:from-indigo-500 [&>div]:to-emerald-500" />
        </div>
      )}

      {/* Results */}
      {(scanState === "scanning" || scanState === "done") && (
        <div className="space-y-2.5">
          {revealedCount === 0 && scanState === "scanning" && (
            <div className="py-4 text-center text-xs text-zinc-600">
              <Loader2 className="size-4 animate-spin mx-auto mb-2 text-zinc-700" />
              Crawling database…
            </div>
          )}

          {matches.slice(0, revealedCount).map((match) => (
            <div
              key={match.id}
              className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3.5 space-y-2.5 animate-in fade-in slide-in-from-bottom-1 duration-200"
            >
              {/* Top row */}
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={match.brandLogoUrl}
                  alt={match.brandName}
                  className="size-8 rounded-md border border-zinc-800 shrink-0 object-cover bg-zinc-900"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-zinc-100 truncate leading-tight">{match.title}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">{match.brandName}</p>
                    </div>
                    <MatchBadge score={match.score} />
                  </div>
                </div>
              </div>

              {match.brief && (
                <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2">{match.brief}</p>
              )}

              {/* Meta row */}
              <div className="flex items-center flex-wrap gap-2">
                <CampaignTypeBadge type={match.campaignType} />
                {match.budget > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                    <DollarSign className="size-3 text-emerald-500" />
                    ${match.budget.toLocaleString()}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
                  <Calendar className="size-3" />
                  {match.deadline}
                </span>
                {match.source === "builder" && (
                  <span className="text-[9px] text-zinc-600 border border-zinc-800 rounded px-1 py-0.5">content rewards</span>
                )}
              </div>

              {/* Match reasons */}
              <div className="flex flex-wrap gap-1.5">
                {match.reasons.map((r) => (
                  <span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700/60 text-zinc-400 text-[10px]">
                    <CheckCircle2 className="size-2.5 text-emerald-500 shrink-0" />
                    {r}
                  </span>
                ))}
              </div>

              {/* Generate panel */}
              <GeneratePanel match={match} influencer={influencer} />
            </div>
          ))}

          {scanState === "done" && matches.length === 0 && (
            <div className="py-10 text-center space-y-2 rounded-xl border border-dashed border-zinc-800">
              <ScanSearch className="size-7 text-zinc-700 mx-auto" />
              <p className="text-sm text-zinc-500 font-medium">No campaigns available right now</p>
              <p className="text-xs text-zinc-600 max-w-[260px] mx-auto">
                No open campaigns or content reward tasks found. Check back once new campaigns are published.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
