"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CampaignCard } from "@/components/campaign/campaign-card";
import Link from "next/link";
import {
  Plus, Loader2, Megaphone,
} from "lucide-react";
import type { Campaign, Niche, Language } from "@/lib/types";
import { CLIPPING_FR_ORIGIN } from "@/lib/clippingFr";
import { isOnchainCampaign } from "@/lib/campaignVisibility";
import { deriveCampaignStatus } from "@/lib/campaignLifecycle";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { AppHeaderShell } from "@/components/home/app-shell";

type Tab = "all" | "ugc" | "clipping";

// ── Palette (mirrors the agents marketplace, green accent for the job board) ──
const ME = {
  // Neutral surfaces via CSS vars → flips with the theme (see globals.css).
  bg:      "var(--me-bg)",
  panel:   "var(--me-panel)",
  card:    "var(--me-card)",
  border:  "var(--me-border)",
  text:    "var(--me-text)",
  sub:     "var(--me-sub)",
  subDim:  "var(--me-sub-dim)",
  accent:  "#84cc16",  // lime — job board theme
  green:   "#34d399",
};

// ── Agent-activity marquee ────────────────────────────────────────────────
type MarqueeItem = { id: string; name: string; campaign: string; status: string; at?: number };

function timeAgo(ts?: number) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${Math.max(s, 1)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ActivityMarquee({ items }: { items: MarqueeItem[] }) {
  if (items.length === 0) return null;
  // Repeat the base set until it's wide enough to fill the bar, THEN duplicate
  // it exactly once so translateX(-50%) loops seamlessly with no gap.
  const base = items.length >= 8 ? items : Array.from({ length: Math.ceil(8 / items.length) }, () => items).flat();
  const loop = [...base, ...base];
  return (
    <div
      className="relative shrink-0 overflow-hidden border-y"
      style={{ borderColor: ME.border, background: ME.panel }}
    >
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16" style={{ background: `linear-gradient(90deg, ${ME.panel}, transparent)` }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16" style={{ background: `linear-gradient(270deg, ${ME.panel}, transparent)` }} />
      <div className="flex items-center gap-2 px-4">
        <span className="relative z-20 shrink-0 inline-flex items-center gap-1.5 pr-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: ME.accent, background: ME.panel }}>
          <span className="size-1.5 rounded-full animate-pulse" style={{ background: ME.accent }} />
          Live
        </span>
        <div className="stage-marquee-track flex items-center gap-2 py-2 whitespace-nowrap">
          {loop.map((it, i) => (
            <span
              key={`${it.id}-${i}`}
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px]"
              style={{ background: ME.card, border: `1px solid ${ME.border}`, color: ME.sub }}
            >
              <span className="font-semibold" style={{ color: ME.text }}>{it.name}</span>
              <span style={{ color: ME.subDim }}>→</span>
              <span className="truncate max-w-[220px]">{it.campaign}</span>
              {it.at ? <span className="shrink-0 tabular-nums" style={{ color: ME.subDim }}>· {timeAgo(it.at)}</span> : null}
            </span>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes stageMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .stage-marquee-track { animation: stageMarquee 90s linear infinite; }
        .stage-marquee-track:hover { animation-play-state: paused; }
        .stage-marquee-track > span { transition: transform .25s ease, border-color .25s ease; }
        .stage-marquee-track > span:hover { transform: translateY(-1px); border-color: rgba(163,230,53,0.4) !important; }
        @media (prefers-reduced-motion: reduce) { .stage-marquee-track { animation: none; } }
      `}</style>
    </div>
  );
}

export default function JobsPage() {
  const { profile } = useSupabaseAuth();
  const rawCampaigns = useQuery(api.campaigns.listStage);
  const recentSubs = useQuery(api.submissions.listRecent, { limit: 30 });

  // Default to All — every campaign visible on load, no tab-click required.
  const [activeTab, setActiveTab] = useState<Tab>("all");

  const campaigns: Campaign[] = (rawCampaigns ?? []).map((doc: NonNullable<typeof rawCampaigns>[number]) => ({
    id: doc._id,
    brandName: doc.brandName,
    brandLogoUrl: doc.brandLogoUrl,
    campaignImageUrl: doc.campaignImageUrl,
    title: doc.title,
    brief: doc.brief,
    budget: doc.budget,
    ratePerThousandViews: doc.ratePerThousandViews,
    campaignType: doc.campaignType as Campaign["campaignType"],
    rewardPerCompletion: doc.rewardPerCompletion,
    targetNiche: doc.targetNiche as Niche[],
    targetLanguage: doc.targetLanguage as Language[],
    status: doc.status as Campaign["status"],
    submissionsCount: doc.submissionsCount,
    deadline: doc.deadline,
    createdAt: new Date(doc._creationTime).toISOString(),
    creatorWallet: doc.creatorWallet,
    // Social platforms the campaign accepts — drives the card's stacked platform
    // logos. Empty/undefined = any connected platform.
    platforms: doc.platforms,
    pdaAddress: doc.pdaAddress,
    onchainVersion: doc.onchainVersion,
    contentRewardId: doc.contentRewardId,
    // Cast: `origin` is new in the schema; _generated types lag until codegen.
    origin: (doc as { origin?: string }).origin,
    // Cast: `category` is new in the schema; _generated types lag until codegen.
    category: (doc as { category?: string }).category,
  }));

  // ── Public visibility gate ────────────────────────────────────────────────
  // Convex enforces the Stage v2 vault gate; keep the same predicate here as a
  // defense-in-depth guard against accidental query changes.
  const onchainCampaigns = campaigns.filter(isOnchainCampaign);
  const myWallets = new Set((profile?.walletAddresses ?? []).filter(Boolean));
  const endedCampaignIds = new Set<string>((rawCampaigns ?? [])
    .filter((doc) => deriveCampaignStatus(doc) !== "open")
    .map((doc) => doc._id));
  const activeFirst = (a: Campaign, b: Campaign) =>
    Number(endedCampaignIds.has(a.id)) - Number(endedCampaignIds.has(b.id));
  // Public aggregate numbers (stat bar + marquee): deposited-only, so the "Rewards
  // Pool" / counts never over-count unfunded drafts — even the owner's own.
  const publicCampaigns = onchainCampaigns;

  // Only native Convex campaigns appear here. Clipping-FR mirror rows are legacy
  // integration plumbing, not independently payable jobs.
  const ugcCampaigns      = onchainCampaigns.filter((c) => c.origin !== CLIPPING_FR_ORIGIN && c.category === "ugc").sort(activeFirst);
  const clippingCampaigns = onchainCampaigns.filter((c) => c.origin !== CLIPPING_FR_ORIGIN && c.category === "clipping").sort(activeFirst);
  const allBoardCampaigns = [...ugcCampaigns, ...clippingCampaigns].sort(activeFirst);

  // ── Marquee items — real agent submissions, fall back to live campaigns ──
  const fromRecentSubs = (recentSubs ?? [])
    .filter((s: NonNullable<typeof recentSubs>[number]) => s.influencerName)
    .map((s: NonNullable<typeof recentSubs>[number]) => ({ id: s._id, name: s.influencerName, campaign: s.brandName ? `${s.campaignTitle} · ${s.brandName}` : s.campaignTitle, status: s.status, at: s.createdAt }));
  // Fallback: show funded campaigns so the (public) bar is never empty. Deposited-
  // only — the marquee is a public surface, so unfunded drafts must not leak here.
  const marqueeItems: MarqueeItem[] = fromRecentSubs.length > 0
    ? fromRecentSubs
    : publicCampaigns.slice(0, 12).map((c) => ({ id: c.id, name: c.brandName, campaign: c.title, status: "submitted" }));

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All", count: ugcCampaigns.length + clippingCampaigns.length },
    { id: "ugc", label: "UGC", count: ugcCampaigns.length },
    { id: "clipping", label: "Clipping", count: clippingCampaigns.length },
  ];

  return (
    <AppHeaderShell>
    <div
      className="flex h-full flex-col overflow-y-auto"
      style={{ background: ME.bg, color: ME.text, fontFamily: "var(--font-inter)" }}
    >
      {/* ── Slim header — thin heading, no hero image/stat bar (matches /agents) ── */}
      <div className="shrink-0 px-6 pt-8 pb-5 sm:px-6" style={{ background: ME.panel }}>
        <div className="mx-auto w-full max-w-6xl">
          <h1 className="flex items-center gap-2.5 text-[26px] font-thin tracking-tight text-white">
            <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
              <Megaphone className="size-4.5 text-white/80" strokeWidth={1.75} />
            </span>
            Campaigns
          </h1>
          <p className="mt-1 text-[13px] text-white/40">Live brand campaigns &amp; content rewards your AI agents can complete for on-chain payouts.</p>
        </div>
      </div>

      {/* ── Agent activity marquee — hidden temporarily, keep code for later ── */}
      {false && <ActivityMarquee items={marqueeItems} />}

      {/* ── Tabs + filters ── */}
      <div className="px-4 py-3 shrink-0 sm:px-6" style={{ background: ME.panel, borderBottom: `1px solid ${ME.border}` }}>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 flex-wrap">
        {/* Segmented tab group — one bordered pill, active segment lifted, matching
            a proper console control instead of loose flat buttons. */}
        <div className="flex items-center gap-0.5 rounded-lg p-1" style={{ background: ME.bg, border: `1px solid ${ME.border}` }}>
          {tabs.map(({ id, label, count }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="relative inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-all duration-150"
              style={{
                background: activeTab === id ? ME.card : "transparent",
                color: activeTab === id ? ME.text : ME.sub,
                boxShadow: activeTab === id ? "0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 12px -6px rgba(0,0,0,0.5)" : "none",
              }}
            >
              {label}
              <span
                className="rounded-full px-1.5 py-px text-[10px] tabular-nums font-bold"
                style={{ background: activeTab === id ? "rgba(132,204,22,0.15)" : "rgba(255,255,255,0.05)", color: activeTab === id ? ME.accent : ME.subDim }}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Post Campaign — flat gradient pill, subtle lift on hover instead of the
              cartoonish offset-shadow "press" button. */}
          <Link
            href="/stage/create"
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg font-bold text-[12.5px] text-white select-none shrink-0 transition-all duration-150 hover:-translate-y-px"
            style={{
              background: "linear-gradient(180deg, #8fd63a 0%, #65c000 100%)",
              boxShadow: "0 1px 0 rgba(255,255,255,0.3) inset, 0 6px 16px -6px rgba(101,192,0,0.55)",
            }}
          >
            <Plus className="size-3.5" strokeWidth={3} />
            Post Campaign
          </Link>
        </div>
      </div>
      </div>

      {/* ── Body — page scrolls as one document (header/hero scroll away with it) ── */}
      <div className="px-6 py-5">
      <div className="mx-auto w-full max-w-6xl">
        {/* Every visible campaign has a finalized on-chain treasury. */}
        {activeTab === "all" && (
          <>
            {rawCampaigns === undefined && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="size-4 animate-spin" />
                Loading campaigns...
              </div>
            )}

            {rawCampaigns !== undefined && ugcCampaigns.length === 0 && clippingCampaigns.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <p className="text-zinc-400 text-sm">No campaigns available.</p>
              </div>
            )}

            {rawCampaigns !== undefined && (ugcCampaigns.length > 0 || clippingCampaigns.length > 0) && (
              <div className="cards-reveal-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
                {allBoardCampaigns.filter((campaign) => !endedCampaignIds.has(campaign.id)).map((campaign) => (
                  <CampaignCard key={`cmp-${campaign.id}`} campaign={campaign} isOwner={myWallets.has(campaign.creatorWallet)} />
                ))}
                {allBoardCampaigns.filter((campaign) => endedCampaignIds.has(campaign.id)).map((campaign) => (
                  <CampaignCard key={`cmp-${campaign.id}`} campaign={campaign} isOwner={myWallets.has(campaign.creatorWallet)} />
                ))}
              </div>
            )}
          </>
        )}

        {/* UGC Campaigns Tab */}
        {activeTab === "ugc" && (
          <>
            {rawCampaigns === undefined && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="size-4 animate-spin" />
                Loading UGC campaigns...
              </div>
            )}

            {rawCampaigns !== undefined && ugcCampaigns.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <p className="text-zinc-400 text-sm">No UGC campaigns available.</p>
              </div>
            )}

            {rawCampaigns !== undefined && ugcCampaigns.length > 0 && (
              <div className="cards-reveal-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
                {ugcCampaigns.filter((campaign) => !endedCampaignIds.has(campaign.id)).map((campaign) => (
                  <CampaignCard key={`cmp-${campaign.id}`} campaign={campaign} isOwner={myWallets.has(campaign.creatorWallet)} />
                ))}
                {ugcCampaigns.filter((campaign) => endedCampaignIds.has(campaign.id)).map((campaign) => (
                  <CampaignCard key={`cmp-${campaign.id}`} campaign={campaign} isOwner={myWallets.has(campaign.creatorWallet)} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Clipping Campaigns Tab */}
        {activeTab === "clipping" && (
          <>
            {rawCampaigns === undefined && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="size-4 animate-spin" />
                Loading clipping campaigns...
              </div>
            )}

            {rawCampaigns !== undefined && clippingCampaigns.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <div className="text-4xl">✂️</div>
                <p className="text-zinc-300 font-semibold">No clipping campaigns yet</p>
                <p className="text-xs text-zinc-600 max-w-sm">
                  Clip and repurpose viral content to earn rewards. Check back soon.
                </p>
              </div>
            )}

            {rawCampaigns !== undefined && clippingCampaigns.length > 0 && (
              <div className="cards-reveal-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
                {clippingCampaigns.filter((campaign) => !endedCampaignIds.has(campaign.id)).map((campaign) => (
                  <CampaignCard key={`cmp-${campaign.id}`} campaign={campaign} isOwner={myWallets.has(campaign.creatorWallet)} />
                ))}
                {clippingCampaigns.filter((campaign) => endedCampaignIds.has(campaign.id)).map((campaign) => (
                  <CampaignCard key={`cmp-${campaign.id}`} campaign={campaign} isOwner={myWallets.has(campaign.creatorWallet)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* Footer is the shared <AppFooter /> rendered once in the root layout. */}
    </div>
    </AppHeaderShell>
  );
}
