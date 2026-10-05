"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Connection } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import {
  dedupeSubmissions,
  submissionStatusPill,
  formatUsdc,
  type EnrichedSubmission,
} from "@/lib/campaignSubmissions";
import { agentNetUsdc } from "@/lib/economy/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { TikTokIcon, InstagramIcon, YouTubeIcon, XIcon, FacebookIcon, ThreadsIcon, LinkedInIcon } from "@/components/cofounder/social-icons";
import {
  Users, CheckCircle2, XCircle,
  Loader2, Wallet, Shield, ExternalLink,
  Megaphone, Trophy, Bot, ArrowLeft, Link2,
  Copy, Check, AlertCircle, CalendarDays, Play, Film, Pencil, Maximize2, ImagePlus, Plus, X,
  Landmark, BadgeCheck,
} from "lucide-react";
import {
  buildEscrowProgram, topUpCampaignTx, getEscrowBalance, refundRemainingTx,
} from "@/lib/escrow";
import { SOL_GAS_FLOOR } from "@/lib/client/usdcClient";
import { getAccountExplorerUrl, getTxExplorerUrl, getReadRpcUrl } from "@/lib/solana/network";
import { isOwnerWallet } from "@/lib/solana/activeWallet";
import { canReclaim, reclaimUnlockMs, type ReclaimBlockedReason } from "@/lib/campaignReclaim";
import { canMigrate } from "@/lib/campaignMigrate";
import { MigrateVaultModal } from "@/components/campaign/migrate-vault-modal";
import { JoinCampaignDialog } from "@/components/campaign/join-campaign-dialog";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { CampaignPerformance } from "@/components/campaign/campaign-performance";
import type { Campaign } from "@/lib/types";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

const NOW = Date.now();

/** Realistic profile photo (pravatar), seeded so each creator keeps the same face.
 *  Used for submission/creator avatars instead of a text initial. */
const personAvatar = (seed: string) =>
  `https://i.pravatar.cc/150?u=${encodeURIComponent(seed || "creator")}`;

/** Platforms a campaign can accept submissions on (upload-post ids). */
const CAMPAIGN_PLATFORM_META = [
  { id: "tiktok", label: "TikTok", Icon: TikTokIcon },
  { id: "instagram", label: "Instagram", Icon: InstagramIcon },
  { id: "youtube", label: "YouTube", Icon: YouTubeIcon },
  { id: "x", label: "X", Icon: XIcon },
  { id: "facebook", label: "Facebook", Icon: FacebookIcon },
  { id: "threads", label: "Threads", Icon: ThreadsIcon },
  { id: "linkedin", label: "LinkedIn", Icon: LinkedInIcon },
] as const;

/** A colorful brand image (DiceBear "shapes"), used for the campaign/brand logo
 *  when none is set OR when the stored logo is a text "initials" avatar — so the
 *  campaign always shows an image, never letters. */
const brandImageFallback = (seed: string) =>
  `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(seed || "brand")}`;
const brandImage = (logoUrl: string | undefined, seed: string) =>
  !logoUrl || /\/initials\//.test(logoUrl) ? brandImageFallback(seed) : logoUrl;
const brandOnError = (seed: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
  const fb = brandImageFallback(seed);
  if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
};
const isUsableImageUrl = (url?: string | null) => !!url && /^(https?:|data:image\/)/i.test(url.trim());

/** Display font for premium numerals + titles. */
const DISPLAY = "font-[family-name:var(--font-space)]";

// Keyed by `string` (not the strict union) + a fallback, because the admin
// campaigns editor can write statuses outside the union (active/pending/expired);
// an unmapped value must never crash the detail page (`statusCfg.class` @930).
const STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  open: { label: "Open", class: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  active: { label: "Active", class: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  in_progress: { label: "In Progress", class: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  pending: { label: "Pending", class: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  completed: { label: "Completed", class: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25" },
  expired: { label: "Expired", class: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25" },
  cancelled: { label: "Cancelled", class: "bg-red-500/15 text-red-400 border-red-500/25" },
};
const FALLBACK_STATUS_CFG = { label: "—", class: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25" };

const TYPE_CONFIG = {
  marketing: { icon: Megaphone, label: "Marketing", class: "bg-blue-500/15 text-blue-300 border-blue-500/25" },
  bounty: { icon: Trophy, label: "Bounty", class: "bg-amber-500/15 text-amber-300 border-amber-500/25" },
  agent_task: { icon: Bot, label: "Agent Task", class: "bg-violet-500/15 text-violet-300 border-violet-500/25" },
};

interface Props {
  campaign: Campaign;
  campaignDocId: Id<"campaigns">;
  /** "modal" = inside the /stage popup: no full-viewport height, no back link. */
  variant?: "page" | "modal";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

// The "Submit with your AI" panel is hidden on the campaign detail page — agents
// submit through the builder flow instead. Flip to `true` to restore it.
const SHOW_SUBMIT_PANEL = false;

// The "Fund Campaign" (lock USDC in escrow) panel is hidden — funding happens
// elsewhere and the input read as noise on the detail page. Flip to restore it.
const SHOW_FUND_PANEL = false;

/** Compact "how long ago" label for a submission timestamp. */
function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/** Full-width submissions TABLE — parity with the content-reward detail page
 *  (# · Creator · Platform · Views · Status · View). Replaced the old auto-scroll
 *  marquee, which repeated rows and read "way off". */
function CampaignSubmissionsTable({
  campaignId,
  onView,
}: {
  campaignId: Id<"campaigns">;
  onView: (s: EnrichedSubmission) => void;
}) {
  const rows = useQuery(api.submissions.listByCampaignEnriched, { campaignId });
  const list = rows === undefined ? undefined : dedupeSubmissions(rows as EnrichedSubmission[]);

  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">
          Submissions
          {list !== undefined && (
            <span className="ml-2 font-mono text-xs text-zinc-500">({list.length})</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {list === undefined && (
          <div className="flex items-center gap-2 px-5 pb-5 text-sm text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" /> Loading submissions…
          </div>
        )}
        {list?.length === 0 && (
          <div className="px-5 pb-8 pt-6 text-center">
            <Users className="mx-auto mb-2 size-8 text-zinc-700" />
            <p className="text-sm text-zinc-500">No submissions yet</p>
            <p className="mt-1 text-xs text-zinc-700">Creators &amp; AI agents appear here once they post.</p>
          </div>
        )}
        {list && list.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="px-5 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-zinc-500">#</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-zinc-500">Creator</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-zinc-500">Platform</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-zinc-500">Views</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-zinc-500">Status</th>
                  <th className="px-5 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-zinc-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map((sub, i) => (
                  <tr key={sub._id} className="border-b border-zinc-800/60 transition-colors hover:bg-zinc-800/20">
                    <td className="px-5 py-3 font-mono text-xs text-zinc-600">{i + 1}</td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <AgentAvatar
                          url={sub.avatarUrl || undefined}
                          alternateUrls={[personAvatar(sub.submitterWallet || sub.influencerName)]}
                          name={sub.influencerName}
                          seed={sub.influencerMint || sub.submitterWallet || sub.influencerName}
                          className="size-6 shrink-0 rounded-full ring-1 ring-white/10"
                          initialClassName="text-[10px]"
                        />
                        <span className="truncate text-xs font-medium text-zinc-200">{sub.influencerName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs capitalize text-zinc-400">{sub.platform || "—"}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-zinc-300">{(sub.viewCount ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-3">
                      <Badge className={`border text-[10px] capitalize ${submissionStatusPill(sub.status)}`}>{sub.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        onClick={() => onView(sub)}
                      >
                        <Play className="mr-1 size-3" />
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
  );
}

/** Per-submission payout figure: the oracle-credited `payoutAmountUsdc` when the
 *  query projects it, else the resolved paid/accrued `earningsUsdc` (present today).
 *  So the card works before the backend adds the explicit field. */
const submissionPayout = (s: EnrichedSubmission): number =>
  (typeof s.payoutAmountUsdc === "number" ? s.payoutAmountUsdc : undefined) ?? s.earningsUsdc ?? 0;

/** On-chain payouts — a live table of the real USDC payments disbursed to agents
 *  for this campaign. One row per submission that carries an on-chain payout tx
 *  (newest first): agent, net amount, wallet, and a Solscan link. Reuses the SAME
 *  `listByCampaignEnriched` subscription (Convex dedupes it) so it stays realtime. */
function PayoutHistoryCard({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const rows = useQuery(api.submissions.listByCampaignEnriched, { campaignId });
  const list = rows === undefined ? undefined : dedupeSubmissions(rows as EnrichedSubmission[]);
  // Only genuine on-chain disbursements — a row is "paid" once it carries a
  // payout tx signature. Newest first so the latest payment leads.
  const payouts = (list ?? [])
    .filter((s) => !!s.payoutTxSignature && submissionPayout(s) > 0)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  // Header total is the NET-to-agent sum (after the 10% protocol fee) — what
  // actually landed in agent wallets, not the gross vault outflow.
  const total = payouts.reduce((sum, s) => sum + agentNetUsdc(submissionPayout(s)), 0);

  return (
    <div className="relative h-full overflow-hidden rounded-[1.6rem] border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_24px_60px_-34px_rgba(0,0,0,0.9)] backdrop-blur-md">
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-44 rounded-full bg-emerald-400/10 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
            </span>
            On-chain payouts
          </p>
          <p className={cn("mt-2 text-[26px] font-bold leading-none tabular-nums text-white", DISPLAY)}>
            {list === undefined ? "…" : formatUsdc(total)}
          </p>
          <p className="mt-1 text-[11.5px] text-zinc-500">
            {payouts.length ? `net to agents · ${payouts.length} payment${payouts.length === 1 ? "" : "s"}` : "paid to agents, in USDC"}
          </p>
        </div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10.5px] font-medium text-emerald-300">Solana</span>
      </div>
      <div className="relative px-3 pb-3 pt-4">
        {list === undefined ? (
          <div className="space-y-2 px-2">
            {[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-white/[0.04]" />)}
          </div>
        ) : payouts.length === 0 ? (
          <div className="mx-2 rounded-2xl border border-dashed border-white/10 px-4 py-5 text-center">
            <p className="text-[12.5px] text-zinc-400">No payouts yet</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-600">Rewards stream here once the oracle verifies a post&apos;s views.</p>
          </div>
        ) : (
          <ul className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
            {payouts.map((s) => (
              <li key={s._id} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-white/15 hover:bg-white/[0.06]">
                <AgentAvatar
                  url={s.avatarUrl || undefined}
                  alternateUrls={[personAvatar(s.submitterWallet || s.influencerName)]}
                  name={s.influencerName}
                  seed={s.influencerMint || s.submitterWallet || s.influencerName}
                  className="size-8 shrink-0 rounded-full ring-1 ring-white/10"
                  initialClassName="text-xs"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-100">{s.influencerName}</p>
                  <p className="flex items-center gap-1 font-mono text-[10.5px] text-zinc-500">
                    {s.submitterWallet ? <>{s.submitterWallet.slice(0, 4)}…{s.submitterWallet.slice(-4)} <CopyButton text={s.submitterWallet} /></> : "wallet pending"}
                    {s.createdAt ? <span className="ml-1 font-sans text-zinc-600">· {timeAgo(s.createdAt)}</span> : null}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[13px] font-bold text-emerald-300">+{formatUsdc(agentNetUsdc(submissionPayout(s)))}</p>
                  <a href={getTxExplorerUrl(s.payoutTxSignature!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10.5px] text-zinc-500 transition-colors hover:text-sky-300">
                    Tx <ExternalLink className="size-2.5" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Live roster of agents actively working this campaign (campaignMemberships,
 *  status "active"). Reactive: a join/leave anywhere updates it instantly,
 *  before the agent has posted anything. */
function AgentsWorkingCard({ campaignId }: { campaignId: string }) {
  const data = useQuery(api.campaignMemberships.joinedByCampaign, { campaignId, limit: 24 });
  const agents = data?.agents ?? [];
  const ago = (ts: number) => {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
  };
  return (
    <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-md">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Agents working</p>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" /> Live
        </span>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-white">
        {data === undefined ? "–" : data.total}
        <span className="ml-1.5 text-sm font-normal text-zinc-500">{data?.total === 1 ? "agent" : "agents"}</span>
      </p>
      {data !== undefined && agents.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-zinc-500">No agents yet. Be the first to join.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          <AnimatePresence initial={false}>
            {agents.slice(0, 6).map((a) => (
              <motion.li
                key={a.mint}
                layout
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="flex items-center gap-2.5"
              >
                <AgentAvatar url={a.avatarUrl} name={a.name} seed={a.mint} className="size-7 shrink-0 overflow-hidden rounded-full" initialClassName="text-[11px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-100">{a.name}</p>
                  <p className="text-[11px] text-zinc-500">{a.agentType === "clipping" ? "AI Clipper" : "AI Influencer"} · joined {ago(a.joinedAt)}</p>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {data && data.total > 6 && <p className="mt-2 text-[11.5px] text-zinc-500">+{data.total - 6} more working</p>}
    </div>
  );
}

/* ── Popup (/stage card click) ─────────────────────────────────────────────
   Compact campaign view inside the intercepted-route overlay: a banner with
   the campaign art + round glass controls, brand + title on the image, then
   the compact performance board with Join Campaign on the chips row. */

function ModalJoinButton({ campaign, campaignId }: { campaign: Campaign; campaignId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center rounded-full bg-orange-500 px-4 text-[12.5px] font-semibold text-white shadow-[0_8px_24px_-10px_rgba(249,115,22,0.8)] transition-[background-color,transform] hover:bg-orange-400 active:scale-[0.97]"
      >
        Join Campaign
      </button>
      <JoinCampaignDialog campaign={campaign} campaignId={campaignId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function RoundGlassButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-full bg-white text-zinc-900 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)] transition-transform hover:scale-105 active:scale-95"
    >
      {children}
    </button>
  );
}

function CampaignModalView({ campaign, campaignDocId, heroImageUrl, treasuryBalance, canManage }: {
  campaign: Campaign;
  campaignDocId: Id<"campaigns">;
  heroImageUrl: string | null | undefined;
  treasuryBalance: number | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const path = `/stage/${campaign.id}`;
  const verified = !!campaign.pdaAddress;
  const brandSrc = brandImage(campaign.brandLogoUrl, campaign.brandName || campaign.creatorWallet);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — nothing to do */ }
  };

  return (
    <div className="font-[family-name:var(--font-geist-sans)]">
      <div className="relative h-[190px] overflow-hidden sm:h-[220px]">
        {heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroImageUrl} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brandSrc} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-md" />
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#141414] via-black/25 to-black/20" />

        <div className="absolute left-4 top-4">
          <RoundGlassButton onClick={() => router.back()} label="Back"><ArrowLeft className="size-4" /></RoundGlassButton>
        </div>
        <div className="absolute right-4 top-4 flex gap-2">
          <RoundGlassButton onClick={() => window.location.assign(path)} label="Open full page"><Maximize2 className="size-4" /></RoundGlassButton>
          <RoundGlassButton onClick={copyLink} label={copied ? "Link copied" : "Copy link"}>
            {copied ? <Check className="size-4 text-emerald-600" /> : <Link2 className="size-4" />}
          </RoundGlassButton>
        </div>

        <div className="absolute inset-x-5 bottom-4">
          <div className="flex items-center gap-2 text-[12.5px] text-white/85">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brandSrc} alt="" onError={brandOnError(campaign.brandName || campaign.creatorWallet)} className="size-5 rounded-md object-cover ring-1 ring-white/20" />
            <span className="truncate">{campaign.brandName}</span>
            {verified && <BadgeCheck className="size-4 shrink-0 text-amber-300" aria-label="Verified on-chain escrow" />}
          </div>
          <h2 className="mt-1.5 line-clamp-2 text-[22px] font-semibold leading-tight tracking-tight text-white sm:text-[24px]">{campaign.title}</h2>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <CampaignPerformance
          campaign={campaign}
          campaignId={campaignDocId}
          treasuryBalance={treasuryBalance}
          compact
          action={canManage ? (
            <button
              type="button"
              onClick={() => window.location.assign(path)}
              className="inline-flex h-8 items-center rounded-full border border-white/15 bg-white/[0.06] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-white/[0.12]"
            >
              Manage campaign
            </button>
          ) : (
            <ModalJoinButton campaign={campaign} campaignId={String(campaignDocId)} />
          )}
        />
      </div>
    </div>
  );
}

/** 3D "Duolingo-style" call-to-action shown to non-owners in place of the payout
 *  history: a chunky pressable button that hands off to the builder, seeding the
 *  AI-Influencer workspace with this campaign so the agent can join + create. */
function JoinWithAgentButton({ campaign, campaignId }: { campaign: Campaign; campaignId: string }) {
  // Right agent for the campaign: a CLIPPING campaign is worked by an AI Clipper
  // (clips the brand's source videos); every other campaign by an AI Influencer
  // (creates original videos). The dialog only offers the matching kind.
  const isClipping = (campaign as { category?: string }).category === "clipping";
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-md">
        <span aria-hidden className="pointer-events-none absolute -left-12 -top-12 size-40 rounded-full bg-emerald-400/10 blur-2xl" />
        <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Join this campaign</p>
        <p className="relative mb-4 mt-1.5 text-[12.5px] leading-relaxed text-zinc-500">
          {isClipping
            ? "Send your AI Clippers: they clip this campaign's videos, post them, and earn USDC on every verified view."
            : "Send your AI Influencers: they create original videos for this campaign and earn USDC on every verified post."}
        </p>
        <button type="button" onClick={() => setOpen(true)} className="group relative block w-full select-none">
          <span className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3.5 text-[15px] font-extrabold uppercase tracking-wide text-white shadow-[0_5px_0_0_#15803d] transition-all duration-75 will-change-transform group-hover:bg-emerald-400 group-active:translate-y-[4px] group-active:shadow-[0_1px_0_0_#15803d]">
            <Bot className="size-5" strokeWidth={2.5} />
            Join with Agent
          </span>
        </button>
      </div>
      <JoinCampaignDialog campaign={campaign} campaignId={campaignId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Short "in 5h 12m" / "12m 03s" countdown for the reclaim grace hint. */
function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Human date-time for the "available after" hint. */
function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Precise, actionable copy for a disabled reclaim button. */
function reclaimBlockedHint(reason: ReclaimBlockedReason, deadlineMs: number, nowMs: number): string {
  switch (reason) {
    case "not-creator":
      return "Only the campaign creator's wallet can reclaim.";
    case "not-funded":
      return "This campaign has no on-chain escrow to reclaim.";
    case "before-deadline":
      return `Available 6h after the deadline (${fmtDateTime(reclaimUnlockMs(deadlineMs))}).`;
    case "grace-active":
      return `Reclaim unlocks in ${formatCountdown(reclaimUnlockMs(deadlineMs) - nowMs)} (dispute grace).`;
    case "nothing-left":
      return "Nothing left to reclaim.";
    default:
      return "";
  }
}

/** Map a thrown refund_remaining error to a clear, actionable message — never a
 *  raw Anchor/RPC string. Mirrors the classes in the on-chain program. */
function reclaimErrorMessage(raw: string): string {
  const m = (raw || "").toLowerCase();
  // Grace not elapsed / campaign still active (defensive — the UI time-gate
  // normally prevents sending before deadline + 6h).
  if (/refundgraceactive|campaignstillactive|grace|still active/.test(m)) {
    return "Not yet — reclaim unlocks 6h after the deadline.";
  }
  // Wrong wallet / not the creator: has_one/seeds fail, or the PDA derived from a
  // non-creator wallet was never initialized.
  if (/unauthorized|has[_ ]?one|accountnotinitialized|account not initialized|constraint|seeds|not the creator|0x1770/.test(m)) {
    return "Only the campaign creator's wallet can reclaim.";
  }
  // Not enough SOL to pay network gas.
  if (/insufficient|debit an account|no record of a prior credit|lamports|for rent|prior credit/.test(m)) {
    return "You need a little SOL for the network fee.";
  }
  // Transient RPC / confirmation problems — safe to retry.
  if (/blockhash|timeout|timed out|failed to fetch|fetch|rate limit|429|503|network|expired|not confirmed/.test(m)) {
    return "Network busy — try again.";
  }
  return "Reclaim failed — please try again.";
}

export function CampaignDetail({ campaign, campaignDocId, variant = "page" }: Props) {
  const inModal = variant === "modal";
  const daysLeft = Math.ceil((new Date(campaign.deadline).getTime() - NOW) / 86400000);

  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  // Privy-aware wallet for ALL money actions (Fund, Reclaim) + submit — signs with
  // the login wallet even for embedded/Google (email) logins that never appear in
  // wallet-adapter, so those owners aren't dead-ended at an external-wallet modal
  // they can't satisfy. The raw wallet-adapter publicKey is null for them.
  const unified = useUnifiedSolanaWallet();
  const { ensureSiwsSession } = useSiwsSession();

  const submit = useMutation(api.submissions.submit);

  // Brand ownership must resolve from the Privy-aware unified wallet — the raw
  // wallet-adapter publicKey is null for embedded-wallet (Google/email) logins,
  // so those owners would fail isBrand ⇒ canManage=false and could not manage
  // their OWN campaign (same class as BUG-005). Mirrors `activeIsCreator` below.
  const isBrand = isOwnerWallet(unified.publicKey?.toBase58(), campaign.creatorWallet);

  // ── Admin edit (only while the escrow is NOT yet funded on-chain) ──────────
  const { profile, accessToken } = useSupabaseAuth();
  const isAdmin = profile?.isAdmin === true;
  const escrowLocked = !!campaign.pdaAddress; // escrow PDA created/recorded on-chain
  const canEditDraft = (isBrand || isAdmin) && !escrowLocked;
  // Who may see the Submissions tab + Fund panel: the campaign owner OR a platform admin.
  const canManage = isBrand || isAdmin;
  const adminUpdate = useAction(api.campaigns.adminUpdate);
  const generateUploadUrl = useMutation(api.campaigns.generateUploadUrl);
  const getStorageUrl = useMutation(api.campaigns.getStorageUrl);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Image edits: cover + up to 3 content images. Uploaded straight to Convex
  // storage so we save plain URLs (same shape the create flow stores).
  const [coverUrl, setCoverUrl] = useState<string | null>(campaign.campaignImageUrl ?? null);
  const [contentUrls, setContentUrls] = useState<string[]>(campaign.contentFileUrls ?? []);
  const [uploading, setUploading] = useState<"cover" | "content" | null>(null);
  const MAX_CONTENT = 3;
  const [editForm, setEditForm] = useState({
    brandName: campaign.brandName,
    title: campaign.title,
    brief: campaign.brief,
    budget: String(campaign.budget ?? ""),
    rewardPerCompletion: String(campaign.rewardPerCompletion ?? ""),
    ratePerThousandViews: String(campaign.ratePerThousandViews ?? ""),
    deliverables: campaign.deliverables ?? "",
    deadline: (campaign.deadline ?? "").slice(0, 10),
  });

  /** Upload one image to Convex storage → return its public URL. */
  async function uploadImage(file: File): Promise<string> {
    const url = await generateUploadUrl();
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
    const { storageId } = await res.json();
    const publicUrl = await getStorageUrl({ storageId });
    if (!publicUrl) throw new Error("Upload failed");
    return publicUrl;
  }

  async function onPickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setUploading("cover"); setEditError(null);
    try { setCoverUrl(await uploadImage(file)); }
    catch { setEditError("Cover image upload failed."); }
    finally { setUploading(null); }
  }

  async function onPickContent(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";
    if (files.length === 0) return;
    setUploading("content"); setEditError(null);
    try {
      const room = MAX_CONTENT - contentUrls.length;
      const urls = await Promise.all(files.slice(0, Math.max(0, room)).map(uploadImage));
      setContentUrls((prev) => [...prev, ...urls].slice(0, MAX_CONTENT));
    } catch { setEditError("Image upload failed."); }
    finally { setUploading(null); }
  }

  function openEdit() {
    setEditError(null);
    setCoverUrl(campaign.campaignImageUrl ?? null);
    setContentUrls(campaign.contentFileUrls ?? []);
    setEditForm({
      brandName: campaign.brandName,
      title: campaign.title,
      brief: campaign.brief,
      budget: String(campaign.budget ?? ""),
      rewardPerCompletion: String(campaign.rewardPerCompletion ?? ""),
      ratePerThousandViews: String(campaign.ratePerThousandViews ?? ""),
      deliverables: campaign.deliverables ?? "",
      deadline: (campaign.deadline ?? "").slice(0, 10),
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    setEditSaving(true);
    setEditError(null);
    try {
      const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
      const patch = {
          brandName: editForm.brandName.trim() || undefined,
          title: editForm.title.trim() || undefined,
          brief: editForm.brief.trim() || undefined,
          budget: num(editForm.budget),
          rewardPerCompletion: campaign.campaignType === "marketing" ? undefined : num(editForm.rewardPerCompletion),
          ratePerThousandViews: campaign.campaignType === "marketing" ? num(editForm.ratePerThousandViews) : undefined,
          deliverables: campaign.campaignType === "bounty" ? (editForm.deliverables.trim() || undefined) : undefined,
          deadline: editForm.deadline || undefined,
          campaignImageUrl: coverUrl ?? undefined,
          contentFileUrls: contentUrls,
      };
      if (isBrand) {
        if ((await ensureSiwsSession()) === null) throw new Error("Approve the wallet signature to edit this campaign.");
        const response = await fetch("/api/campaigns/update-draft", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: campaignDocId, patch }),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Could not save campaign");
      } else {
        if (!accessToken) throw new Error("Sign in as an admin to edit.");
        await adminUpdate({ accessToken, id: campaignDocId, patch });
      }
      setEditOpen(false); // Convex query is reactive — the page updates itself
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to save changes");
    } finally {
      setEditSaving(false);
    }
  }

  const myInfluencers = useQuery(
    api.influencers.listByCreator,
    unified.publicKey ? { creatorWallet: unified.publicKey.toBase58() } : "skip"
  );

  // Total agents participating — distinct influencers (by mint, then wallet) that
  // have submitted to this campaign. Shares the same enriched-submissions
  // subscription as the tables below (Convex dedupes it). `null` while loading.
  const allSubmissions = useQuery(api.submissions.listByCampaignEnriched, { campaignId: campaignDocId });
  const participantCount = useMemo(() => {
    if (allSubmissions === undefined) return null;
    const deduped = dedupeSubmissions(allSubmissions as EnrichedSubmission[]);
    const agents = new Set<string>();
    for (const s of deduped) agents.add(s.influencerMint || s.submitterWallet || s._id);
    return agents.size;
  }, [allSubmissions]);

  const [selectedMint, setSelectedMint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [viewingSub, setViewingSub] = useState<EnrichedSubmission | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const firstContentImage = (campaign.contentFileUrls ?? []).find(isUsableImageUrl);
  const heroImageUrl = isUsableImageUrl(campaign.campaignImageUrl) ? campaign.campaignImageUrl : firstContentImage;
  const sourceUrl = (campaign.contentLinks ?? []).find((link) => /^https?:\/\//i.test(link)) ?? null;
  const [pageFeaturedImage, setPageFeaturedImage] = useState<{ sourceUrl: string; imageUrl: string } | null>(null);
  const creatorImageUrl = (pageFeaturedImage?.sourceUrl === sourceUrl ? pageFeaturedImage.imageUrl : null)
    || heroImageUrl
    || brandImage(campaign.brandLogoUrl, campaign.brandName || campaign.creatorWallet);

  // Esc closes the image lightbox; lock body scroll while it's open.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [lightbox]);

  useEffect(() => {
    if (!sourceUrl) return;
    let active = true;
    fetch(`/api/campaigns/featured-image?url=${encodeURIComponent(sourceUrl)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { imageUrl?: string | null } | null) => {
        if (active && isUsableImageUrl(data?.imageUrl)) setPageFeaturedImage({ sourceUrl, imageUrl: data!.imageUrl! });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [sourceUrl]);
  const [treasuryBalance, setTreasuryBalance] = useState<number | null>(null);
  const [fundAmount, setFundAmount] = useState("50");
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [fundSuccess, setFundSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!campaign.pdaAddress) return;
    getEscrowBalance(connection, campaign.pdaAddress)
      .then(setTreasuryBalance)
      .catch(() => setTreasuryBalance(0));
  }, [connection, campaign.pdaAddress]);

  async function handleSubmit() {
    const pk = unified.publicKey;
    if (!unified.connected || !pk) { setVisible(true); return; }
    if (!selectedMint) return;
    const inf = myInfluencers?.find((i: NonNullable<typeof myInfluencers>[number]) => i.mintAddress === selectedMint);
    if (!inf) return;
    setSubmitting(true); setSubmitError(null);
    try {
      await submit({ campaignId: campaignDocId, influencerMint: selectedMint, influencerName: inf.name, submitterWallet: pk.toBase58() });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally { setSubmitting(false); }
  }

  async function handleFund() {
    // Sign with the Privy-aware unified wallet so embedded (Google/email) owners can
    // fund too — the raw wallet-adapter is null for them, which popped an external
    // wallet modal = dead-end. Capture the locals while narrowed (property narrowing
    // on `unified` would be lost across the awaits below). Mirrors handleReclaim.
    const pk = unified.publicKey;
    const signTx = unified.signTransaction;
    if (!unified.connected || !pk || !signTx) { setVisible(true); return; }
    const amount = parseFloat(fundAmount);
    if (!amount || amount <= 0) return;
    setFunding(true); setFundError(null); setFundSuccess(null);
    try {
      const program = buildEscrowProgram({
        publicKey: pk,
        signTransaction: signTx,
        signAllTransactions: async (txs) => {
          const signed = [];
          for (const t of txs) signed.push(await signTx(t));
          return signed;
        },
      });
      // Derive the campaign PDA from the CREATOR (its seed), not the connected
      // funder — an admin funding another creator's campaign would otherwise derive
      // their own (nonexistent) PDA and the tx reverts AccountNotInitialized with a
      // cryptic wallet error. The funder still pays; only the seed must be the creator.
      const { txSignature } = await topUpCampaignTx(program, campaignDocId, amount, campaign.creatorWallet);
      // Top up via the deposit-verified route (topUpBudget is secret-gated). The
      // funderWallet MUST be the wallet that actually signed/sent — the route verifies
      // the on-chain transfer's sender against it — so report the unified signer's pk.
      const topUpResp = await fetch("/api/campaigns/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaignDocId, amount, txSignature, funderWallet: pk.toBase58() }),
      });
      if (!topUpResp.ok) {
        throw new Error((await topUpResp.json().catch(() => ({}))).error || "Top-up failed");
      }
      setFundSuccess(`+$${amount} USDC locked in escrow`);
      setFundAmount("50");
      if (campaign.pdaAddress) setTreasuryBalance(await getEscrowBalance(connection, campaign.pdaAddress));
    } catch (err) {
      setFundError(err instanceof Error ? err.message : "Top-up failed");
    } finally { setFunding(false); }
  }

  // ── Reclaim remaining (creator sweeps unspent escrow after expiry) ──────────
  const [reclaiming, setReclaiming] = useState(false);
  const reclaimInFlight = useRef(false); // hard double-submit guard (survives re-render)
  const [reclaimError, setReclaimError] = useState<string | null>(null);
  const [reclaimTx, setReclaimTx] = useState<string | null>(campaign.refundTxSignature ?? null);
  // Tick a clock so the "unlocks in <countdown>" hint stays live.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const activeAddr = unified.publicKey?.toBase58() ?? null;
  const myWallets = useMemo(
    () => new Set((profile?.walletAddresses ?? []).filter(Boolean)),
    [profile?.walletAddresses],
  );
  // The active SIGNING wallet must be the creator — the on-chain PDA seed binds it,
  // so refund_remaining can ONLY be signed by the original creator wallet.
  const activeIsCreator = !!activeAddr && activeAddr === campaign.creatorWallet;
  // Owner of the campaign via the active wallet OR any server-linked wallet (so a
  // multi-wallet Privy user still sees the action, with a "switch wallet" hint).
  const ownsCampaign = activeIsCreator || myWallets.has(campaign.creatorWallet);
  // Only a FUNDED on-chain vault (v2) has escrow to reclaim.
  const isFundedV2 = !!campaign.pdaAddress && (campaign.onchainVersion ?? 1) >= 2;
  const showReclaim = ownsCampaign && isFundedV2;
  const alreadyReclaimed = !!reclaimTx;

  // ── Migrate to on-chain vault (escrow-ify an existing OFF-CHAIN campaign) ────
  // Shown ONLY when the campaign has no funded vault yet (mutually exclusive with
  // Reclaim) AND the caller owns it or is a platform admin. Signing still requires
  // the creator wallet (enforced in the modal) — the vault binds to the signer.
  const [migrateOpen, setMigrateOpen] = useState(false);
  const showMigrate = canMigrate({
    pdaAddress: campaign.pdaAddress,
    onchainVersion: campaign.onchainVersion,
    isOwner: ownsCampaign || isAdmin,
  });

  const deadlineMs = new Date(campaign.deadline).getTime();
  const reclaimGate = canReclaim({
    isCreator: activeIsCreator,
    pdaAddress: campaign.pdaAddress,
    onchainVersion: campaign.onchainVersion,
    deadlineMs,
    nowMs,
    escrowUsdc: treasuryBalance,
  });

  // Keep the countdown live only while the reclaim card is shown and still locked.
  useEffect(() => {
    if (!showReclaim || alreadyReclaimed || reclaimGate.ok) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showReclaim, alreadyReclaimed, reclaimGate.ok]);

  async function handleReclaim() {
    if (reclaimInFlight.current) return;
    // Capture the wallet locals while narrowed (property narrowing on `unified`
    // would be lost across the awaits below).
    const pk = unified.publicKey;
    const signTx = unified.signTransaction;
    if (!unified.connected || !pk || !signTx) { setVisible(true); return; }
    // Must sign with the creator wallet (owner via a different linked wallet → switch).
    if (!activeIsCreator) { setReclaimError("Only the campaign creator's wallet can reclaim."); return; }
    if (!reclaimGate.ok) {
      setReclaimError(reclaimBlockedHint(reclaimGate.blocked, deadlineMs, nowMs));
      return;
    }
    reclaimInFlight.current = true;
    setReclaiming(true);
    setReclaimError(null);
    try {
      // Pre-flight SOL for gas — only block on a CONFIRMED low balance. A failed
      // READ must NOT false-block (fund-modal lesson); let the tx surface the truth.
      try {
        const lamports = await new Connection(getReadRpcUrl(), "confirmed").getBalance(pk, "confirmed");
        if (lamports / 1e9 < SOL_GAS_FLOOR) {
          setReclaimError("You need a little SOL for the network fee.");
          return;
        }
      } catch {
        /* balance read failed — do not false-block; the tx will surface any real error */
      }

      const program = buildEscrowProgram({
        publicKey: pk,
        signTransaction: signTx,
        signAllTransactions: async (txs) => {
          const signed = [];
          for (const t of txs) signed.push(await signTx(t));
          return signed;
        },
      });
      // refund_remaining sweeps the ACTUAL vault balance to the creator; the PDA is
      // derived from (creator wallet + campaignId), so this only succeeds for the
      // original creator. campaignDocId is the same id used as the on-chain campaignId.
      const { txSignature } = await refundRemainingTx(program, campaignDocId);
      setReclaimTx(txSignature);
      setTreasuryBalance(0); // reflect $0 immediately
      // Re-read the vault from chain (best-effort — success already recorded).
      if (campaign.pdaAddress) {
        getEscrowBalance(connection, campaign.pdaAddress).then(setTreasuryBalance).catch(() => {});
      }
      // Best-effort: mirror the refund into Convex so the admin history + a reload
      // reflect the reclaim. The money ALREADY moved on-chain, so a failure here must
      // never undo or block it — fully fire-and-forget + swallowed.
      void (async () => {
        try {
          if ((await ensureSiwsSession().catch(() => null)) === null) return;
          await fetch("/api/campaigns/reclaim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ campaignId: campaignDocId, refundTxSignature: txSignature }),
          });
        } catch {
          /* best-effort mirror only */
        }
      })();
    } catch (err) {
      setReclaimError(reclaimErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      reclaimInFlight.current = false;
      setReclaiming(false);
    }
  }

  // Live views + submissions for the stats bar — same subscription the
  // submissions table / performance chart use (Convex dedupes it); views are the
  // freshest of the oracle count and the agents' synced clip analytics.
  const liveSubs = useQuery(api.submissions.listByCampaignEnriched, { campaignId: campaignDocId });
  const liveList = liveSubs === undefined ? undefined : dedupeSubmissions(liveSubs as EnrichedSubmission[]);
  const liveViews = liveList?.reduce((n, r) => n + Math.max(0, r.viewCount ?? 0), 0);

  const statusCfg = STATUS_CONFIG[campaign.status] ?? FALLBACK_STATUS_CFG;
  const typeCfg = campaign.campaignType ? TYPE_CONFIG[campaign.campaignType] : TYPE_CONFIG.marketing;
  const TypeIcon = typeCfg.icon;

  const rewardLabel = campaign.campaignType === "marketing"
    ? `$${campaign.ratePerThousandViews}/K views`
    : campaign.rewardPerCompletion
    ? `$${campaign.rewardPerCompletion} / task`
    : `$${campaign.budget.toLocaleString()} pool`;

  const maxCompletions = campaign.rewardPerCompletion && campaign.rewardPerCompletion > 0
    ? Math.floor(campaign.budget / campaign.rewardPerCompletion)
    : null;

  const escrowFunded = treasuryBalance !== null && treasuryBalance > 0;
  const budgetPct = campaign.budget > 0 && treasuryBalance !== null
    ? Math.min(100, (treasuryBalance / campaign.budget) * 100)
    : 0;

  if (inModal) {
    return (
      <CampaignModalView
        campaign={campaign}
        campaignDocId={campaignDocId}
        heroImageUrl={heroImageUrl}
        treasuryBalance={treasuryBalance}
        canManage={canManage}
      />
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col pb-10 font-[family-name:var(--font-geist-sans)]">

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-5xl px-6 pt-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link
            href="/stage"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Back to Stage
          </Link>

          {canEditDraft && (
            <button
              type="button"
              onClick={openEdit}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[12.5px] font-medium text-zinc-100 transition-colors hover:border-emerald-300/40 hover:bg-emerald-400/10 focus-visible:outline-2 focus-visible:outline-emerald-400"
              title="Edit this draft before funding its escrow"
            >
              <Pencil className="size-3.5 text-emerald-300" strokeWidth={2} /> Edit draft
            </button>
          )}
        </div>

        {/* 16:9 campaign image */}
        {heroImageUrl && (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-[0_30px_80px_-44px_rgba(0,0,0,0.9)]">
            <img
              src={heroImageUrl}
              alt={campaign.title}
              className="h-full w-full object-cover"
            />
        </div>
        )}

        {/* Title row below the image */}
        <div className="mt-5 flex items-end gap-5">
          <div className="shrink-0 size-20 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04] shadow-[0_12px_30px_-12px_rgba(0,0,0,0.8)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={brandImage(campaign.brandLogoUrl, campaign.brandName || campaign.creatorWallet)}
              alt={campaign.brandName}
              onError={brandOnError(campaign.brandName || campaign.creatorWallet)}
              className="h-full w-full object-cover"
            />
          </div>

          <div className="flex-1 min-w-0 pb-1">
            <h1 className={cn("text-3xl font-bold leading-[1.1] tracking-tight text-white", DISPLAY)}>
              {campaign.title}
            </h1>
            <p className="mt-1.5 text-[15px] text-zinc-400">
              by <span className="font-medium text-zinc-200">{campaign.brandName}</span>
              <span className="mx-2 text-zinc-700">·</span>
              <span className="font-mono text-[13px] text-zinc-500">
                {campaign.creatorWallet.slice(0, 6)}…{campaign.creatorWallet.slice(-4)}
              </span>
              <CopyButton text={campaign.creatorWallet} />
              <span className="mx-2 text-zinc-700">·</span>
              <span className="text-[13px] text-zinc-500">
                {new Date(campaign.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ── Stats Bar (centered glass panel) ─────────────────────────────────── */}
      <div className="sticky top-4 z-10 mx-auto mt-6 w-full max-w-5xl px-6">
        <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.045] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md">
        <div className="grid grid-cols-2 gap-px bg-white/[0.06] sm:grid-cols-3 lg:grid-cols-6">
          {([
            {
              label: "Total Budget",
              value: `$${campaign.budget.toLocaleString()}`,
              sub: "USDC",
              color: "text-white",
            },
            {
              label: "On-chain Escrow",
              value: treasuryBalance !== null
                ? `$${treasuryBalance.toFixed(2)}`
                : campaign.pdaAddress ? "…" : "—",
              sub: treasuryBalance !== null ? "USDC locked" : campaign.pdaAddress ? "loading" : "no escrow",
              color: escrowFunded ? "text-emerald-400" : "text-zinc-400",
              // Click through to verify the locked-USDC treasury account on Solscan
              // (network-aware). Only present once the escrow PDA exists on-chain.
              href: campaign.pdaAddress ? getAccountExplorerUrl(campaign.pdaAddress) : undefined,
            },
            {
              label: campaign.campaignType === "marketing" ? "Rate" : "Per Task",
              value: rewardLabel,
              sub: campaign.campaignType === "marketing" ? "per 1K views" : maxCompletions ? `max ${maxCompletions}` : "fixed",
              color: "text-amber-400",
            },
            {
              label: "Views",
              value: liveViews === undefined ? "…" : liveViews >= 1_000_000 ? `${(liveViews / 1_000_000).toFixed(1)}M` : liveViews >= 10_000 ? `${(liveViews / 1000).toFixed(1)}K` : liveViews.toLocaleString(),
              sub: "live, across all posts",
              color: "text-sky-300",
            },
            {
              label: "Submissions",
              value: (liveList?.length ?? campaign.submissionsCount).toString(),
              sub: "posts received",
              color: "text-zinc-200",
            },
            {
              label: "Time Left",
              value: daysLeft > 0 ? `${daysLeft}d` : "Ended",
              sub: `ends ${new Date(campaign.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
              color: daysLeft <= 3 ? "text-red-400" : daysLeft <= 7 ? "text-amber-400" : "text-zinc-200",
            },
          ] as Array<{ label: string; value: string; sub: string; color: string; href?: string }>).map(({ label, value, sub, color, href }) => (
            <div key={label} className="bg-[#0c0c10]/70 px-4 py-4 backdrop-blur-md">
              <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-zinc-500">{label}</p>
              <p className={cn("text-xl font-bold leading-tight tabular-nums", DISPLAY, color)}>{value}</p>
              <p className="mt-0.5 text-[11.5px] text-zinc-600">{sub}</p>
              {href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-400 transition-colors hover:text-blue-300"
                >
                  View on Solscan
                  <ExternalLink className="size-2.5" />
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Budget progress bar */}
        {campaign.pdaAddress && treasuryBalance !== null && (
          <div className="flex items-center gap-3 bg-[#0c0c10]/70 px-4 py-3 backdrop-blur-md">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all"
                style={{ width: `${budgetPct}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-[11px] text-zinc-500">
              {budgetPct.toFixed(0)}% funded
            </span>
          </div>
        )}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 items-start gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_320px]">

        <div className="min-w-0 xl:col-span-2">

          {/* Tabs: Overview / Requirements / Materials */}
          <Tabs defaultValue="overview" className="gap-0">
            <TabsList variant="line" className="mb-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="requirements">Requirements</TabsTrigger>
              {((campaign.contentLinks?.length ?? 0) > 0 || (campaign.contentFileUrls?.length ?? 0) > 0) && (
                <TabsTrigger value="materials">
                  Materials
                  <span className="ml-1.5 size-4 rounded-full bg-zinc-700 text-[9px] text-zinc-300 inline-flex items-center justify-center font-mono">
                    {(campaign.contentLinks?.length ?? 0) + (campaign.contentFileUrls?.length ?? 0)}
                  </span>
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="overview">
              <div className="space-y-4">
                <CampaignPerformance campaign={campaign} campaignId={campaignDocId} treasuryBalance={treasuryBalance} />
                <div className="grid items-stretch gap-4 md:grid-cols-2">
                  <Card className="h-full rounded-[1.6rem] border border-white/10 bg-white/[0.035] py-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-sm">
                    <CardContent className="space-y-3 px-5 py-5">
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                        {campaign.campaignType === "agent_task" ? "Agent Instructions" :
                         campaign.campaignType === "bounty" ? "Task Description" : "Campaign Brief"}
                      </p>
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-200">
                        {campaign.brief}
                      </p>
                    </CardContent>
                  </Card>
                  <PayoutHistoryCard campaignId={campaignDocId} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="requirements">
              <div className="space-y-4">
                {/* Type + status */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn("text-[10px] border px-2 py-0.5 font-medium", typeCfg.class)}>
                    <TypeIcon className="size-2.5 mr-1" />
                    {typeCfg.label}
                  </Badge>
                  <Badge className={cn("text-[10px] border px-2 py-0.5 font-medium", statusCfg.class)}>
                    <span className={cn("size-1.5 rounded-full mr-1.5 inline-block",
                      campaign.status === "open" ? "bg-emerald-400" :
                      campaign.status === "in_progress" ? "bg-blue-400" : "bg-zinc-400"
                    )} />
                    {statusCfg.label}
                  </Badge>
                </div>

                {/* The requirements the campaign owner set — explicit deliverables
                    for bounties, else the brief (so it always shows). */}
                {campaign.deliverables && (
                  <Card className="border-zinc-800 bg-zinc-900/40">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        {campaign.campaignType === "bounty" ? "Deliverables & Acceptance Criteria" : "Requirements"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {/* Checklist — every requirement the campaign owner set, one
                          checkmark per line (falls back to the whole brief as a
                          single item when it isn't line-separated). */}
                      <ul className="space-y-2.5">
                        {(campaign.deliverables || "")
                          .split(/\r?\n/)
                          .map((s) => s.replace(/^\s*[-*•]\s*/, "").trim())
                          .filter(Boolean)
                          .map((req, i) => (
                            <li key={i} className="flex items-start gap-2.5">
                              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                              <span className="text-sm leading-relaxed text-zinc-300">{req}</span>
                            </li>
                          ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* MANDATORY structured requirements (@mentions / #hashtags / brand /
                    tone) the owner set at creation — stored + enforced server-side but
                    previously never displayed. Surface them so what was entered shows. */}
                {campaign.requirements && campaign.requirements.length > 0 && (
                  <Card className="border-zinc-800 bg-zinc-900/40">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        Mandatory Requirements
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2.5">
                        {campaign.requirements.map((req, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                            <span className="text-sm leading-relaxed text-zinc-300">{req}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Targeting */}
                <Card className="rounded-[1.6rem] border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold uppercase tracking-[0.13em] text-zinc-300">
                      Targeting & Eligibility
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wide mb-2">Niche</p>
                        <div className="flex flex-wrap gap-1.5">
                          {campaign.targetNiche.map((n) => (
                            <span key={n} className="rounded-md px-2 py-0.5 text-xs bg-zinc-800 text-zinc-300 capitalize border border-zinc-700">{n}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wide mb-2">Language</p>
                        <div className="flex flex-wrap gap-1.5">
                          {campaign.targetLanguage.map((l) => (
                            <span key={l} className="rounded-md px-2 py-0.5 text-xs bg-zinc-800 text-zinc-300 uppercase border border-zinc-700">{l}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    {campaign.agentTaskCategory && (
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wide mb-2">Agent Task Type</p>
                        <span className="rounded-md px-2.5 py-1 text-xs bg-violet-500/15 text-violet-300 border border-violet-500/25 capitalize">
                          {campaign.agentTaskCategory.replace(/_/g, " ")}
                        </span>
                      </div>
                    )}
                    {/* Accepted platforms — an agent must have one of these connected to submit. */}
                    <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-md sm:p-5">
                      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold tracking-tight text-zinc-100">Platforms</p>
                          <p className="mt-1 text-[11px] text-zinc-500">Publish on any accepted social channel</p>
                        </div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300/70">Accepted channels</span>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {CAMPAIGN_PLATFORM_META.filter(
                          (p) => campaign.platforms?.length ? campaign.platforms.includes(p.id) : ["tiktok", "instagram", "youtube"].includes(p.id),
                        ).map((p) => (
                          <span
                            key={p.id}
                            className="inline-flex items-center gap-2.5 rounded-2xl border border-white/15 bg-white/[0.06] py-2 pl-2.5 pr-4 text-xs font-semibold tracking-tight text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_20px_-14px_rgba(0,0,0,0.8)] backdrop-blur-sm transition-[transform,background-color,border-color] duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.1]"
                          >
                            <span className="grid size-7 place-items-center rounded-xl border border-white/15 bg-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                              <p.Icon className="size-4" />
                            </span>
                            {p.label}
                          </span>
                        ))}
                      </div>
                      <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
                        Agents must have at least one of these social accounts connected to submit.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Reward mechanics */}
                <Card className="border-zinc-800 bg-zinc-900/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                      Reward Mechanics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {campaign.campaignType === "marketing" ? (
                      <>
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs text-zinc-500">Payment model</span>
                          <span className="text-xs font-medium text-zinc-200">Per 1,000 views (CPM)</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs text-zinc-500">Rate</span>
                          <span className="font-mono text-sm font-bold text-amber-400">${campaign.ratePerThousandViews} USDC / 1K</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs text-zinc-500">Est. total views</span>
                          <span className="font-mono text-sm text-zinc-300">
                            {campaign.ratePerThousandViews > 0
                              ? `~${Math.floor((campaign.budget / campaign.ratePerThousandViews) * 1000).toLocaleString()}`
                              : "—"}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs text-zinc-500">Payment model</span>
                          <span className="text-xs font-medium text-zinc-200">Fixed per completion</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs text-zinc-500">Per completion</span>
                          <span className="font-mono text-sm font-bold text-amber-400">
                            {campaign.rewardPerCompletion ? `$${campaign.rewardPerCompletion} USDC` : "See brief"}
                          </span>
                        </div>
                        {maxCompletions && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs text-zinc-500">Max completions</span>
                            <span className="font-mono text-sm text-zinc-300">{maxCompletions}</span>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {((campaign.contentLinks?.length ?? 0) > 0 || (campaign.contentFileUrls?.length ?? 0) > 0) && (
              <TabsContent value="materials">
                <Card className="border-zinc-800 bg-zinc-900/40">
                  <CardContent className="pt-5 space-y-5">
                    {/* ── Creator Videos — every reference link, each opens in a new tab ── */}
                    {(campaign.contentLinks?.length ?? 0) > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                          Creator Videos
                        </p>
                        <div className="space-y-2.5">
                          {campaign.contentLinks!.map((link, i) => (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 p-3 rounded-lg border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/40 transition-all group"
                            >
                              <div className="size-8 rounded-md bg-zinc-800 flex items-center justify-center shrink-0">
                                <Link2 className="size-3.5 text-zinc-400" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs text-zinc-300 truncate">{link}</p>
                                <p className="text-[10px] text-zinc-600 mt-0.5">Reference link · Opens in new tab</p>
                              </div>
                              <ExternalLink className="size-3.5 text-zinc-600 group-hover:text-zinc-400 shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Images — only real uploaded images. Empty/invalid URLs are
                        filtered out, and any that fail to load hide themselves, so
                        broken-image placeholders never render. ── */}
                    {(() => {
                      const imgs = (campaign.contentFileUrls ?? []).filter(
                        (u) => typeof u === "string" && /^(https?:|data:image\/)/i.test(u.trim()),
                      );
                      if (imgs.length === 0) return null;
                      return (
                        <div className="space-y-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                            Images
                          </p>
                          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                            {imgs.map((url, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setLightbox(url)}
                                className="group relative block aspect-square cursor-zoom-in overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-zinc-600"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={url}
                                  alt={`Campaign image ${i + 1}`}
                                  onError={(e) => {
                                    // A URL that won't load isn't a real upload — hide its tile.
                                    const btn = e.currentTarget.closest("button");
                                    if (btn) btn.style.display = "none";
                                  }}
                                  className="h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105"
                                />
                                <span className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                                <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/50 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
                                  <Maximize2 className="size-3 text-white" />
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

          </Tabs>

        </div>

        <div className="min-w-0 space-y-5">
          {/* Submissions — full-width table (parity with the content-reward page). */}
          <CampaignSubmissionsTable campaignId={campaignDocId} onView={setViewingSub} />
        </div>

        {/* ── Right sidebar ── */}
        <div className="space-y-4">

          {/* Action card */}
          {(showMigrate || showReclaim || (SHOW_FUND_PANEL && canManage && campaign.status === "open") || (SHOW_SUBMIT_PANEL && !isBrand) || isBrand) && (
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardContent className="pt-5 space-y-4">
              {/* Migrate to on-chain vault — give an existing OFF-CHAIN campaign a
                  real USDC payout vault with only a deposit + rate (metadata intact).
                  Only shown when there's no funded vault yet (opposite of Reclaim). */}
              {showMigrate && (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-zinc-300 mb-0.5">Migrate to on-chain vault</p>
                    <p className="text-[10px] text-zinc-600">
                      Add a real USDC escrow vault so clippers get paid on-chain per 1,000 views. Keeps every detail — you only set a deposit &amp; rate.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setMigrateOpen(true)}
                    className="w-full h-9 bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    <Landmark className="mr-2 size-3.5" />
                    Migrate to on-chain vault
                  </Button>
                  <Separator className="bg-zinc-800" />
                </div>
              )}

              {/* Reclaim remaining — the creator sweeps unspent escrow USDC back to
                  their wallet after the campaign expires (6h dispute grace). Only
                  shown to the owner of a FUNDED on-chain (v2) vault. */}
              {showReclaim && (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-zinc-300 mb-0.5">Reclaim remaining</p>
                    <p className="text-[10px] text-zinc-600">
                      Return the unspent escrow USDC to your wallet after the campaign expires.
                    </p>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                    <span className="text-[11px] text-zinc-500">Reclaimable</span>
                    <span className={cn("font-mono text-sm font-bold tabular-nums", DISPLAY,
                      alreadyReclaimed || treasuryBalance === 0 ? "text-zinc-500" : "text-emerald-400")}>
                      {alreadyReclaimed
                        ? "$0.00"
                        : treasuryBalance === null ? "…" : `$${treasuryBalance.toFixed(2)}`}
                    </span>
                  </div>

                  {alreadyReclaimed ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                        <CheckCircle2 className="size-4 shrink-0" />
                        Reclaimed ✓
                      </div>
                      {reclaimTx && (
                        <a
                          href={getTxExplorerUrl(reclaimTx)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400 transition-colors hover:text-blue-300"
                        >
                          View refund on Solscan <ExternalLink className="size-2.5" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        onClick={handleReclaim}
                        disabled={reclaiming || !reclaimGate.ok || treasuryBalance === null}
                        className="w-full h-9 bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60"
                      >
                        {reclaiming
                          ? <><Loader2 className="mr-2 size-3.5 animate-spin" /> Reclaiming…</>
                          : "Reclaim remaining"}
                      </Button>

                      {/* Precise disabled hint (loading / wrong wallet / time / amount). */}
                      {!reclaiming && treasuryBalance === null ? (
                        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <Loader2 className="size-3 animate-spin" /> Checking escrow balance…
                        </p>
                      ) : !reclaiming && !reclaimGate.ok ? (
                        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <AlertCircle className="size-3 shrink-0" />
                          {reclaimGate.blocked === "not-creator" && ownsCampaign && !activeIsCreator
                            ? `Switch to the creator wallet (${campaign.creatorWallet.slice(0, 4)}…${campaign.creatorWallet.slice(-4)}) to reclaim.`
                            : reclaimBlockedHint(reclaimGate.blocked, deadlineMs, nowMs)}
                        </p>
                      ) : null}

                      {reclaimError && <p className="text-xs text-destructive">{reclaimError}</p>}
                    </>
                  )}

                  <Separator className="bg-zinc-800" />
                </div>
              )}

              {/* Fund panel — only the campaign owner or a platform admin can fund. */}
              {SHOW_FUND_PANEL && canManage && campaign.status === "open" && (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-zinc-300 mb-0.5">Fund Campaign</p>
                    <p className="text-[10px] text-zinc-600">Lock USDC in on-chain escrow. Deducted from your wallet.</p>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 focus-within:border-zinc-500 transition-colors">
                      <span className="text-xs text-zinc-600 font-mono">$</span>
                      <input
                        type="number" min={1} step={1} value={fundAmount}
                        onChange={(e) => setFundAmount(e.target.value)}
                        className="flex-1 bg-transparent py-2 text-sm font-mono text-zinc-200 outline-none w-0 min-w-0"
                        placeholder="50"
                      />
                      <span className="text-[10px] text-zinc-600">USDC</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleFund}
                      disabled={funding || !parseFloat(fundAmount)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white shrink-0 h-9"
                    >
                      {funding ? <Loader2 className="size-3.5 animate-spin" /> : "Fund"}
                    </Button>
                  </div>
                  {fundError && <p className="text-xs text-destructive">{fundError}</p>}
                  {fundSuccess && (
                    <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5" />{fundSuccess}
                    </p>
                  )}
                  <Separator className="bg-zinc-800" />
                </div>
              )}

              {/* Submit section — influencer (hidden; see SHOW_SUBMIT_PANEL) */}
              {SHOW_SUBMIT_PANEL && !isBrand && (
                <>
                  {submitted ? (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                      <CheckCircle2 className="size-4 shrink-0" />
                      Submitted successfully!
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-zinc-300">Submit with your AI</p>
                      {!unified.connected && (
                        <Button className="w-full gap-2" onClick={() => setVisible(true)}>
                          <Wallet className="size-4" />
                          Connect Wallet
                        </Button>
                      )}
                      {unified.connected && myInfluencers?.length === 0 && (
                        <p className="text-xs text-zinc-500 text-center py-2">
                          No AI Influencers yet.{" "}
                          <Link href="/studio/create" className="text-blue-400 hover:text-blue-300">Create one →</Link>
                        </p>
                      )}
                      {unified.connected && myInfluencers && myInfluencers.length > 0 && (
                        <>
                          <select
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
                            value={selectedMint}
                            onChange={(e) => setSelectedMint(e.target.value)}
                          >
                            <option value="">Select AI Influencer...</option>
                            {myInfluencers.map((inf: NonNullable<typeof myInfluencers>[number]) => (
                              <option key={inf.mintAddress} value={inf.mintAddress}>
                                {inf.name}
                              </option>
                            ))}
                          </select>
                          <Button
                            className="w-full"
                            onClick={handleSubmit}
                            disabled={!selectedMint || submitting}
                          >
                            {submitting && <Loader2 className="size-4 animate-spin mr-2" />}
                            Submit for Campaign
                          </Button>
                        </>
                      )}
                      {submitError && <p className="text-xs text-destructive text-center">{submitError}</p>}
                    </div>
                  )}
                </>
              )}

              {isBrand && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-800/60 border border-zinc-700">
                  <Shield className="size-4 text-zinc-400 shrink-0" />
                  <p className="text-xs text-zinc-400">You created this campaign. Review submissions in the table.</p>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {/* Owner → the live on-chain payouts table for this campaign.
              Everyone else → a 3D "Join with Agent" CTA that opens the builder. */}
          <AgentsWorkingCard campaignId={String(campaignDocId)} />
          {!canManage && <JoinWithAgentButton campaign={campaign} campaignId={campaignDocId} />}

          {/* On-chain info */}
          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">On-chain Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Network", value: "Solana Devnet", mono: false },
                { label: "Protocol", value: "Vello Escrow v1", mono: false },
                { label: "USDC Mint", value: "4zMMC9…ncDU", mono: true },
              ].map(({ label, value, mono }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-600">{label}</span>
                  <span className={cn("text-xs text-zinc-300", mono && "font-mono")}>{value}</span>
                </div>
              ))}
              {campaign.pdaAddress && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-600">Escrow PDA</span>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={getAccountExplorerUrl(campaign.pdaAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      {campaign.pdaAddress.slice(0, 6)}…{campaign.pdaAddress.slice(-4)}
                      <ExternalLink className="size-2.5" />
                    </a>
                    <CopyButton text={campaign.pdaAddress} />
                  </div>
                </div>
              )}
              {!campaign.pdaAddress && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/20">
                  <AlertCircle className="size-3.5 text-amber-500 shrink-0" />
                  <p className="text-[10px] text-amber-400/80">Escrow not yet deployed. Run <code className="font-mono text-amber-300">bash deploy.sh</code> to activate.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Creator info */}
          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Campaign Creator</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex items-center gap-3">
                {/* Realistic creator profile photo (seeded so the same creator
                    always keeps the same face) instead of an abstract logo. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={creatorImageUrl}
                  alt={campaign.brandName}
                  onError={(e) => {
                    const fb = brandImage(campaign.brandLogoUrl, campaign.brandName || campaign.creatorWallet);
                    if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                  }}
                  className="size-10 rounded-xl border border-white/10 object-cover"
                />
                <div>
                  <p className="text-sm font-semibold text-zinc-200">{campaign.brandName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-mono text-[10px] text-zinc-600">
                      {campaign.creatorWallet.slice(0, 8)}…{campaign.creatorWallet.slice(-6)}
                    </span>
                    <CopyButton text={campaign.creatorWallet} />
                    <a
                      href={`https://explorer.solana.com/address/${campaign.creatorWallet}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="size-2.5 text-zinc-700 hover:text-zinc-400" />
                    </a>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-600 flex items-center gap-1">
                  <CalendarDays className="size-3" />
                  Posted
                </span>
                <span className="text-[10px] text-zinc-400">
                  {new Date(campaign.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-600 flex items-center gap-1">
                  <Users className="size-3" />
                  Total Participated
                </span>
                <span className="text-[10px] font-semibold text-zinc-300 tabular-nums">
                  {participantCount === null ? "…" : `${participantCount} ${participantCount === 1 ? "agent" : "agents"}`}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Submission viewer ── */}
      <SubmissionViewer
        submission={viewingSub}
        onClose={() => setViewingSub(null)}
      />

      {/* ── Migrate to on-chain vault ── */}
      {migrateOpen && (
        <MigrateVaultModal
          campaignId={String(campaignDocId)}
          creatorWallet={campaign.creatorWallet}
          title={campaign.title}
          existingDeadline={campaign.deadline}
          onClose={() => setMigrateOpen(false)}
        />
      )}

      {/* ── Owner or admin edit (only while escrow unfunded) ── */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="z-[120] max-h-[92vh] overflow-hidden border-white/10 bg-[#101416] p-0 text-white shadow-2xl shadow-black/70 sm:max-w-3xl">
          <DialogHeader>
            <div className="border-b border-white/10 px-5 py-4">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">Unfunded draft</p>
              <DialogTitle className="text-lg font-semibold text-white">Edit campaign</DialogTitle>
              <p className="mt-1 text-xs text-zinc-400">Review your campaign details before locking the budget in escrow.</p>
            </div>
          </DialogHeader>

          <div className="space-y-4 px-5 pb-5">
            <div className="flex items-start gap-2 rounded-lg border border-emerald-300/15 bg-emerald-400/[0.05] px-3 py-2.5 text-[12px] text-zinc-300">
              <Shield className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
              Economic terms lock after the wallet deposit. Changes here do not move funds.
            </div>

            {/* Two columns: media (left) · details (right) */}
            <div className="grid max-h-[58vh] gap-5 overflow-y-auto pr-1 md:grid-cols-2">

              {/* ── Left: cover + content images ── */}
              <div className="space-y-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-zinc-400">Cover image</span>
                  <label className="group relative block aspect-video cursor-pointer overflow-hidden rounded-xl border border-dashed border-white/15 bg-white/[0.02] transition-colors hover:border-emerald-500/50">
                    {coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverUrl} alt="Cover" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-zinc-500">
                        <ImagePlus className="size-6" />
                        <span className="text-[11px]">Upload cover</span>
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="rounded-full border border-white/20 bg-black/50 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-md">
                        {coverUrl ? "Change cover" : "Upload"}
                      </span>
                    </div>
                    {uploading === "cover" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60"><Loader2 className="size-5 animate-spin text-white" /></div>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={onPickCover} />
                  </label>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-zinc-400">Content images <span className="text-zinc-600">({contentUrls.length}/{MAX_CONTENT})</span></span>
                  <div className="grid grid-cols-3 gap-2">
                    {contentUrls.map((u, i) => (
                      <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-zinc-900">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt={`Content ${i + 1}`} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setContentUrls((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-red-500/80 group-hover:opacity-100"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                    {contentUrls.length < MAX_CONTENT && (
                      <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 bg-white/[0.02] text-zinc-500 transition-colors hover:border-emerald-500/50 hover:text-zinc-300">
                        {uploading === "content" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        <span className="text-[10px]">Add</span>
                        <input type="file" accept="image/*" multiple className="hidden" onChange={onPickContent} />
                      </label>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Right: text fields ── */}
              <div className="space-y-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-zinc-400">Title</span>
                  <Input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} className="border-white/10 bg-white/[0.02]" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-zinc-400">Brand name</span>
                  <Input value={editForm.brandName} onChange={(e) => setEditForm((f) => ({ ...f, brandName: e.target.value }))} className="border-white/10 bg-white/[0.02]" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-zinc-400">Brief</span>
                  <Textarea
                    value={editForm.brief}
                    onChange={(e) => setEditForm((f) => ({ ...f, brief: e.target.value }))}
                    className="h-32 resize-none overflow-y-auto border-white/10 bg-white/[0.02] leading-relaxed"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-zinc-400">Budget (USDC)</span>
                    <Input type="number" value={editForm.budget} onChange={(e) => setEditForm((f) => ({ ...f, budget: e.target.value }))} className="border-white/10 bg-white/[0.02] font-mono" />
                  </label>
                  {campaign.campaignType === "marketing" ? (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-zinc-400">Rate / 1K views</span>
                      <Input type="number" value={editForm.ratePerThousandViews} onChange={(e) => setEditForm((f) => ({ ...f, ratePerThousandViews: e.target.value }))} className="border-white/10 bg-white/[0.02] font-mono" />
                    </label>
                  ) : (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-zinc-400">Reward / completion</span>
                      <Input type="number" value={editForm.rewardPerCompletion} onChange={(e) => setEditForm((f) => ({ ...f, rewardPerCompletion: e.target.value }))} className="border-white/10 bg-white/[0.02] font-mono" />
                    </label>
                  )}
                </div>

                {campaign.campaignType === "bounty" && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-zinc-400">Deliverables</span>
                    <Textarea value={editForm.deliverables} onChange={(e) => setEditForm((f) => ({ ...f, deliverables: e.target.value }))} className="h-20 resize-none overflow-y-auto border-white/10 bg-white/[0.02]" />
                  </label>
                )}

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-zinc-400">Deadline</span>
                  <Input type="date" value={editForm.deadline} onChange={(e) => setEditForm((f) => ({ ...f, deadline: e.target.value }))} className="w-48 border-white/10 bg-white/[0.02]" />
                </label>
              </div>
            </div>

            {editError && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="size-3.5" />
                {editError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
              <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={editSaving} className="text-zinc-400 hover:text-white">
                Cancel
              </Button>
              <Button onClick={() => void saveEdit()} disabled={editSaving || uploading !== null} className="bg-emerald-400 text-emerald-950 hover:bg-emerald-300">
                {editSaving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Check className="mr-1.5 size-4" />}
                Save draft
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Image lightbox ── */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-0 z-[200] flex cursor-zoom-out items-center justify-center bg-black/80 p-6 backdrop-blur-sm sm:p-10"
            onClick={() => setLightbox(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 8 }}
              transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.7 }}
              className="relative max-h-[88vh] max-w-5xl cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox}
                alt="Campaign image"
                className="max-h-[88vh] w-auto rounded-2xl border border-white/10 object-contain shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]"
              />
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Close"
                className="absolute -right-3 -top-3 flex size-9 items-center justify-center rounded-full border border-white/15 bg-zinc-900/90 text-zinc-200 backdrop-blur-md transition-all duration-300 hover:scale-105 hover:text-white"
              >
                <XCircle className="size-5" strokeWidth={1.75} />
              </button>
              <a
                href={lightbox}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] font-medium text-zinc-200 backdrop-blur-md transition-colors hover:text-white"
              >
                Open original <ExternalLink className="size-3" />
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i;

function SubmissionViewer({
  submission,
  onClose,
}: {
  submission: EnrichedSubmission | null;
  onClose: () => void;
}) {
  const open = submission !== null;
  const postUrl = submission?.postUrl;
  const isDirectVideo = !!postUrl && VIDEO_EXT.test(postUrl);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg border-zinc-800 bg-zinc-950">
        {submission && (
          <>
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Film className="size-4 text-zinc-400" />
                {submission.influencerName}
              </DialogTitle>
            </DialogHeader>

            {/* Media */}
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-zinc-800 bg-black">
              {!postUrl ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-600">
                  <Film className="size-8" />
                  <p className="text-xs">No post submitted yet</p>
                  <p className="text-[10px] text-zinc-700">This influencer joined but hasn’t published the deliverable.</p>
                </div>
              ) : isDirectVideo ? (
                <video
                  src={postUrl}
                  controls
                  autoPlay
                  playsInline
                  className="h-full w-full object-contain bg-black"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <Play className="size-8 text-zinc-500" />
                  <p className="text-xs text-zinc-400">
                    This submission is a {submission.platform || "social"} post and can’t be played inline.
                  </p>
                  <a
                    href={postUrl}
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

            {/* Meta */}
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Creator</span>
                <span className="text-xs text-zinc-300 truncate max-w-[65%] text-right">{submission.influencerName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Status</span>
                <Badge className={cn("text-[10px] border capitalize", submissionStatusPill(submission.status))}>
                  {submission.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Submitter</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-zinc-300">
                    {submission.submitterWallet.slice(0, 6)}…{submission.submitterWallet.slice(-4)}
                  </span>
                  <CopyButton text={submission.submitterWallet} />
                </div>
              </div>
              {submission.platform && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Platform</span>
                  <span className="text-xs text-zinc-300 capitalize">{submission.platform}</span>
                </div>
              )}
              {typeof submission.viewCount === "number" && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Views</span>
                  <span className="font-mono text-xs text-zinc-300">{submission.viewCount.toLocaleString()}</span>
                </div>
              )}
              {postUrl ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-500 shrink-0">Post link</span>
                  <a
                    href={postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 min-w-0"
                  >
                    <span className="truncate">{postUrl}</span>
                    <ExternalLink className="size-2.5 shrink-0" />
                  </a>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-zinc-500 shrink-0">Post link</span>
                  <span className="text-[11px] leading-relaxed text-zinc-500 text-right max-w-[70%]">
                    Post link pending — the oracle attaches it after it verifies the post.
                  </span>
                </div>
              )}
              {submission.payoutTxSignature && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Payout tx</span>
                  <a
                    href={`https://explorer.solana.com/tx/${submission.payoutTxSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    {submission.payoutTxSignature.slice(0, 8)}…
                    <ExternalLink className="size-2.5" />
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
