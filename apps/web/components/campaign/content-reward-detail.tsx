"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Scissors, Sparkles, FileStack, Eye, CheckCircle2,
  CalendarDays, Globe, Play, Film, ExternalLink, Heart, Loader2, Users, Lock,
} from "lucide-react";
import Link from "next/link";
import {
  getContentRewardSubmissions,
  type ContentReward,
  type RewardSubmission,
} from "@/lib/content-rewards";
import { contentRewardAmountToUsdc, CLIPPING_REWARD_RATE_USDC } from "@/lib/clippingFr";

/** Vello's flat clipping reward rate, formatted for display ("$0.20 / 1K views"). */
const REWARD_RATE_LABEL = `$${CLIPPING_REWARD_RATE_USDC.toFixed(2)} / 1K views`;

const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=1200&auto=format&fit=crop";

function PlatformIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  const base = "inline-grid place-items-center size-[18px] rounded-[5px] text-white";
  if (p === "instagram")
    return (
      <span className={cn(base, "bg-gradient-to-tr from-[#fd5949] via-[#d6249f] to-[#285AEB]")}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      </span>
    );
  if (p === "tiktok")
    return (
      <span className={cn(base, "bg-black")}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
        </svg>
      </span>
    );
  if (p === "x")
    return (
      <span className={cn(base, "bg-black")}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.682l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </span>
    );
  if (p === "youtube")
    return (
      <span className={cn(base, "bg-[#ff0000]")}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      </span>
    );
  if (p === "facebook")
    return (
      <span className={cn(base, "bg-[#1877f2]")}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </span>
    );
  return (
    <span className={cn(base, "bg-zinc-700 text-[7px] font-bold")}>
      {platform[0]?.toUpperCase()}
    </span>
  );
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i;

const SUB_STATUS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  submitted: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  verified: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  rejected: "bg-red-500/15 text-red-400 border-red-500/25",
};

export function ContentRewardDetail({
  reward,
  locked = false,
}: {
  reward: ContentReward;
  /** NON-allowed viewer of a restricted (owner-exclusive) campaign: render the
   *  detail but HIDE the clippable source ("What to clip" body) and DISABLE the
   *  clip/submit CTA. The server gates stay the real boundary. */
  locked?: boolean;
}) {
  const [submissions, setSubmissions] = useState<RewardSubmission[] | undefined>(undefined);
  const [viewing, setViewing] = useState<RewardSubmission | null>(null);

  useEffect(() => {
    let active = true;
    getContentRewardSubmissions(reward.id).then((s) => { if (active) setSubmissions(s); });
    return () => { active = false; };
  }, [reward.id]);

  const isClipping = reward.type?.toLowerCase() === "clipping";
  const budget = Number(reward.budget) || 0;
  const paidOut = reward.paidOut ?? 0;
  const pct = budget > 0 ? Math.max(0, Math.min(100, (paidOut / budget) * 100)) : 0;
  // Present all money in USDC (RM100 → 1 USDC); the reward rate is Vello's flat
  // $0.20/1K. Display-only — the jobtepi content_reward's real currency is unchanged.
  const budgetUsdc = contentRewardAmountToUsdc(budget, reward.currency);
  const paidUsdc = contentRewardAmountToUsdc(paidOut, reward.currency);
  const platforms = Array.isArray(reward.platforms) ? reward.platforms : [];
  const displayName = reward.communityName || reward.ownerName || "Jobtepi";
  const avatar = reward.communityImage || reward.ownerImage || "";
  const cover = reward.thumbnail_url || FALLBACK_COVER;

  const requirements = (reward.content_requirements || []).filter(
    (r) => r?.trim() && !r.trim().startsWith("http") && r.trim().length > 2
  );

  const TypeIcon = isClipping ? Scissors : Sparkles;
  const typeLabel = isClipping ? "Clipping" : "UGC";
  const typeClass = isClipping
    ? "bg-purple-500/15 text-purple-300 border-purple-500/25"
    : "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";

  return (
    <div className="flex flex-col min-h-screen">

      {/* ── Hero ── */}
      <div className="relative w-full overflow-hidden" style={{ minHeight: 220 }}>
        <img src={cover} alt={reward.campaign_name} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-zinc-950" />

        <div className="relative px-6 pt-5 pb-6">
          <Link
            href="/stage"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors mb-5"
          >
            <ArrowLeft className="size-3.5" />
            Back to Stage
          </Link>

          <div className="flex items-end gap-5">
            <div className="shrink-0 size-16 rounded-2xl overflow-hidden border-2 border-zinc-700/60 shadow-xl bg-zinc-800">
              {avatar ? (
                <img src={avatar} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-xl font-bold text-emerald-300 uppercase">{displayName.charAt(0)}</span>
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Badge className={cn("text-[10px] border px-2 py-0.5 font-medium", typeClass)}>
                  <TypeIcon className="size-2.5 mr-1" />
                  {typeLabel}
                </Badge>
                {reward.category && (
                  <Badge className="text-[10px] border px-2 py-0.5 font-medium bg-zinc-700/40 text-zinc-300 border-zinc-700 capitalize">
                    {reward.category}
                  </Badge>
                )}
                <Badge className="text-[10px] border px-2 py-0.5 font-medium bg-emerald-500/15 text-emerald-400 border-emerald-500/25">
                  <span className="size-1.5 rounded-full mr-1.5 inline-block bg-emerald-400" />
                  Active
                </Badge>
              </div>

              <h1 className="text-2xl font-bold tracking-tight text-white leading-tight truncate">
                {reward.campaign_name}
              </h1>
              <p className="text-sm text-zinc-400 mt-0.5">
                by <span className="text-zinc-200 font-medium">{displayName}</span>
                <span className="mx-2 text-zinc-700">·</span>
                <span className="text-xs text-zinc-500">
                  {new Date(reward.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </p>
            </div>

            <div className="hidden sm:flex shrink-0 items-center -space-x-1 pb-1">
              {platforms.slice(0, 4).map((p, i) => (
                <div key={i} className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/10 bg-[#0e0e11] shadow-md" style={{ zIndex: 4 - i }}>
                  <PlatformIcon platform={p} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      <div className="border-y border-zinc-800 bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex divide-x divide-zinc-800 overflow-x-auto">
          {[
            { label: "Total Budget", value: `$${fmt(budgetUsdc)}`, sub: "USDC", color: "text-white" },
            { label: "Paid Out", value: `$${fmt(paidUsdc)}`, sub: `${pct.toFixed(0)}% of budget`, color: "text-emerald-400" },
            { label: "Reward Rate", value: `$${CLIPPING_REWARD_RATE_USDC.toFixed(2)}`, sub: "per 1K views", color: "text-amber-400" },
            { label: "Submissions", value: (reward.total_submissions ?? 0).toLocaleString(), sub: `${reward.approved_submissions ?? 0} approved`, color: "text-zinc-200" },
            { label: "Total Views", value: (reward.total_views ?? 0).toLocaleString(), sub: "across posts", color: "text-zinc-200" },
          ].map(({ label, value, sub, color }) => (
            <div key={label} className="flex-1 min-w-[110px] px-5 py-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">{label}</p>
              <p className={cn("font-mono text-base font-bold leading-tight", color)}>{value}</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        <div className="px-5 pb-2 flex items-center gap-3">
          <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all"
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
          <span className="text-[10px] text-zinc-600 shrink-0 font-mono">{pct.toFixed(0)}% paid out</span>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 p-6 items-start">

        {/* Left column */}
        <div className="space-y-5 min-w-0">
          <Tabs defaultValue="overview">
            <TabsList variant="line" className="mb-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="requirements">
                Requirements
                {requirements.length > 0 && (
                  <span className="ml-1.5 size-4 rounded-full bg-zinc-700 text-[9px] text-zinc-300 inline-flex items-center justify-center font-mono">
                    {requirements.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <Card className="border-zinc-800 bg-zinc-900/40">
                <CardContent className="pt-5 space-y-1">
                  <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-3">
                    {isClipping ? "What to clip" : "Campaign Brief"}
                  </p>
                  {locked ? (
                    // Restricted campaign, non-allowed viewer: the "What to clip" body is
                    // the clippable SOURCE (Drive links etc.) — keep it HIDDEN. Show a
                    // generic one-liner + a lock note instead.
                    <div className="space-y-3">
                      <p className="text-sm text-zinc-300 leading-relaxed">
                        {`Create ${typeLabel} content for ${reward.campaign_name} and earn ${REWARD_RATE_LABEL}.`}
                      </p>
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5">
                        <Lock className="size-3.5 mt-0.5 shrink-0 text-amber-300" />
                        <p className="text-[11.5px] leading-relaxed text-amber-200/90">
                          🔒 This campaign is exclusive to its owner — you can view it, but you
                          can&apos;t clip or submit to it. The source videos are hidden.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                      {reward.available_content?.trim()
                        ? reward.available_content
                        : `Create ${typeLabel} content for ${reward.campaign_name} and earn $${CLIPPING_REWARD_RATE_USDC.toFixed(2)} per 1K views. Post on ${platforms.join(", ") || "supported platforms"} to start earning from the $${fmt(budgetUsdc)} pool.`}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="requirements">
              <div className="space-y-4">
                <Card className="border-zinc-800 bg-zinc-900/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                      Content Requirements
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {requirements.length > 0 ? (
                      <ul className="space-y-2">
                        {requirements.map((req, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-300 leading-relaxed">
                            <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-emerald-500/70" />
                            {req}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-zinc-500">No specific requirements — follow standard brand & platform guidelines.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                      Reward Mechanics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-zinc-500">Payment model</span>
                      <span className="text-xs font-medium text-zinc-200">Per 1K views</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-zinc-500">Rate</span>
                      <span className="font-mono text-sm font-bold text-amber-400">${CLIPPING_REWARD_RATE_USDC.toFixed(2)} / 1K</span>
                    </div>
                    {typeof reward.min_payout === "number" && reward.min_payout > 0 && (
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs text-zinc-500">Min payout</span>
                        <span className="font-mono text-sm text-zinc-300">${fmt(contentRewardAmountToUsdc(reward.min_payout, reward.currency))}</span>
                      </div>
                    )}
                    {typeof reward.max_payout === "number" && reward.max_payout > 0 && (
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs text-zinc-500">Max payout</span>
                        <span className="font-mono text-sm text-zinc-300">${fmt(contentRewardAmountToUsdc(reward.max_payout, reward.currency))}</span>
                      </div>
                    )}
                    {typeof reward.flat_fee_bonus === "number" && reward.flat_fee_bonus > 0 && (
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs text-zinc-500">Flat bonus</span>
                        <span className="font-mono text-sm text-zinc-300">${fmt(contentRewardAmountToUsdc(reward.flat_fee_bonus, reward.currency))}</span>
                      </div>
                    )}
                    <Separator className="bg-zinc-800" />
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-zinc-500">Total pool</span>
                      <span className="font-mono text-sm font-bold text-emerald-400">${fmt(budgetUsdc)}</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-zinc-500">Remaining</span>
                      <span className="font-mono text-sm text-zinc-300">${fmt(Math.max(0, budgetUsdc - paidUsdc))}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>

          {/* ── Submissions ── */}
          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Submissions
                {submissions !== undefined && (
                  <span className="ml-2 font-mono text-xs text-zinc-500">({submissions.length})</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {submissions === undefined && (
                <div className="flex items-center gap-2 text-zinc-500 text-sm px-5 pb-5">
                  <Loader2 className="size-3.5 animate-spin" /> Loading submissions...
                </div>
              )}
              {submissions?.length === 0 && (
                <div className="px-5 pb-5 text-center py-10">
                  <Users className="size-8 text-zinc-700 mx-auto mb-2" />
                  <p className="text-sm text-zinc-500">No submissions yet</p>
                  <p className="text-xs text-zinc-700 mt-1">Creators &amp; AI agents will appear here once they post</p>
                </div>
              )}
              {submissions && submissions.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">#</th>
                        <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-3 py-2.5">Creator</th>
                        <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-3 py-2.5">Platform</th>
                        <th className="text-right text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-3 py-2.5">Views</th>
                        <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-3 py-2.5">Status</th>
                        <th className="text-right text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((sub, i) => (
                        <tr key={sub.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/20 transition-colors">
                          <td className="px-5 py-3 text-xs font-mono text-zinc-600">{i + 1}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2 min-w-0">
                              {sub.submitterImage ? (
                                <img src={sub.submitterImage} alt={sub.submitterName} className="size-6 rounded-full object-cover ring-1 ring-white/10 shrink-0" />
                              ) : (
                                <div className="size-6 rounded-full bg-emerald-700/40 ring-1 ring-white/10 flex items-center justify-center shrink-0">
                                  <span className="text-[9px] font-bold text-emerald-300 uppercase">{sub.submitterName.charAt(0)}</span>
                                </div>
                              )}
                              <span className="font-medium text-zinc-200 text-xs truncate">{sub.submitterName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-xs text-zinc-400 capitalize">{sub.platform || "—"}</span>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs text-zinc-300">{sub.views.toLocaleString()}</td>
                          <td className="px-3 py-3">
                            <Badge className={cn("text-[10px] border capitalize", SUB_STATUS[sub.status] ?? "bg-zinc-700/40 text-zinc-300 border-zinc-700")}>
                              {sub.status}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-3 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                              onClick={() => setViewing(sub)}
                              disabled={!sub.videoUrl && !sub.contentUrl}
                            >
                              <Play className="size-3 mr-1" />
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Action card */}
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardContent className="pt-5 space-y-3">
              <div>
                <p className="text-xs font-semibold text-zinc-300 mb-0.5">Earn from this campaign</p>
                <p className="text-[10px] text-zinc-600">
                  Post {typeLabel} content on the supported platforms — payouts are based on views.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5">
                <span className="text-xs text-zinc-500">You earn</span>
                <span className="font-mono text-sm font-bold text-amber-400">
                  ${CLIPPING_REWARD_RATE_USDC.toFixed(2)} / 1K views
                </span>
              </div>
              {locked ? (
                <div className="space-y-2">
                  <div
                    aria-disabled="true"
                    className="flex w-full cursor-not-allowed select-none items-center justify-center gap-2 rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-500"
                  >
                    <Lock className="size-4" />
                    Exclusive campaign
                  </div>
                  <p className="text-center text-[10.5px] leading-relaxed text-zinc-600">
                    🔒 This campaign is exclusive to its owner — you can view it, but you can&apos;t clip or submit to it.
                  </p>
                </div>
              ) : (
                <Link
                  href={
                    isClipping
                      ? `/builder?type=clipping&reward=${encodeURIComponent(reward.id)}`
                      : "/studio/create"
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
                >
                  <Sparkles className="size-4" />
                  Create with AI
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Platforms */}
          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="size-3" />
                Platforms
              </CardTitle>
            </CardHeader>
            <CardContent>
              {platforms.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {platforms.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
                      <PlatformIcon platform={p} />
                      <span className="text-xs text-zinc-300 capitalize">{p}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">All supported platforms</p>
              )}
            </CardContent>
          </Card>

          {/* Campaign stats */}
          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-600 flex items-center gap-1.5"><FileStack className="size-3" />Submissions</span>
                <span className="font-mono text-xs text-zinc-300">{(reward.total_submissions ?? 0).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-600 flex items-center gap-1.5"><Eye className="size-3" />Total views</span>
                <span className="font-mono text-xs text-zinc-300">{(reward.total_views ?? 0).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-600 flex items-center gap-1.5"><CalendarDays className="size-3" />Launched</span>
                <span className="text-xs text-zinc-400">
                  {new Date(reward.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Submission viewer ── */}
      <RewardSubmissionViewer submission={viewing} onClose={() => setViewing(null)} currency={reward.currency} />
    </div>
  );
}

function RewardSubmissionViewer({
  submission,
  onClose,
  currency,
}: {
  submission: RewardSubmission | null;
  onClose: () => void;
  currency: string | null | undefined;
}) {
  const open = submission !== null;
  const playUrl = submission?.videoUrl || submission?.contentUrl || null;
  const isDirectVideo = !!submission?.videoUrl && (VIDEO_EXT.test(submission.videoUrl) || !submission.contentUrl);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg border-zinc-800 bg-zinc-950">
        {submission && (
          <>
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Film className="size-4 text-zinc-400" />
                {submission.title?.trim() || submission.submitterName}
              </DialogTitle>
            </DialogHeader>

            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-zinc-800 bg-black">
              {!playUrl ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-600">
                  <Film className="size-8" />
                  <p className="text-xs">No content attached</p>
                </div>
              ) : isDirectVideo && submission.videoUrl ? (
                <video src={submission.videoUrl} controls autoPlay playsInline className="h-full w-full object-contain bg-black" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <Play className="size-8 text-zinc-500" />
                  <p className="text-xs text-zinc-400">
                    This submission is a {submission.platform || "social"} post and can’t be played inline.
                  </p>
                  <a
                    href={playUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
                  >
                    <ExternalLink className="size-3.5" />
                    Open original post
                  </a>
                </div>
              )}
            </div>

            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Creator</span>
                <span className="text-xs text-zinc-300">{submission.submitterName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Status</span>
                <Badge className={cn("text-[10px] border capitalize", SUB_STATUS[submission.status] ?? "bg-zinc-700/40 text-zinc-300 border-zinc-700")}>
                  {submission.status}
                </Badge>
              </div>
              {submission.platform && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Platform</span>
                  <span className="text-xs text-zinc-300 capitalize">{submission.platform}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500 flex items-center gap-1"><Eye className="size-3" />Views</span>
                <span className="font-mono text-xs text-zinc-300">{submission.views.toLocaleString()}</span>
              </div>
              {submission.likes > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 flex items-center gap-1"><Heart className="size-3" />Likes</span>
                  <span className="font-mono text-xs text-zinc-300">{submission.likes.toLocaleString()}</span>
                </div>
              )}
              {submission.payout > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Payout</span>
                  <span className="font-mono text-xs text-emerald-400">${fmt(contentRewardAmountToUsdc(submission.payout, currency))}</span>
                </div>
              )}
              {submission.contentUrl && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-500 shrink-0">Post link</span>
                  <a
                    href={submission.contentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 min-w-0"
                  >
                    <span className="truncate">{submission.contentUrl}</span>
                    <ExternalLink className="size-2.5 shrink-0" />
                  </a>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
