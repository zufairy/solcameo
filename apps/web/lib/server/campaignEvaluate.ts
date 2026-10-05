/**
 * Evaluate every joinable Stage campaign for ONE clipping agent and persist the
 * agent's verdicts as campaignMemberships. Shared by:
 *  - the auto-clip scout (autonomous: the agent decides, then clips only from
 *    ACTIVE memberships), and
 *  - the Work tab's "Evaluate now" (same numbers the operator sees).
 * Server-only: needs Supabase (content_rewards), Drive (folder expansion) and
 * the restriction gates.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { resolveSourceUrl } from "@/lib/server/campaignSources";
import { isJoinableCampaign, isJoinableUgcCampaign } from "@/lib/campaignLifecycle";
import { gateRestrictedCampaignForOwner } from "@/lib/server/restrictedCampaignGates";
import { CLIP_SKILL_PRICE_USDC, clipSkillRunCostWithOverrides, isValidSkillPrice } from "@/lib/economy/servicePrices";
import { median, rankCampaigns, type FitAgent, type FitCampaign, type FitVerdict } from "@/lib/server/campaignFit";
import type { AutoClipCandidate } from "@/lib/server/autoClipSelect";

const MAX_SOURCES_PER_CANDIDATE = 12;
const MAX_CAMPAIGNS_EVALUATED = 40;

export type EvaluatedCampaign = Omit<FitVerdict, "campaignId"> & {
  /** campaignId ?? contentRewardId. */
  id: string;
  rail: "onchain" | "content_reward";
  title: string;
  campaignId?: string;
  contentRewardId?: string;
  ratePerThousandViews: number;
  budgetRemainingUsdc: number;
  deadlineAt?: number;
  sources: { sourceUrl: string; name: string }[];
  requiresProfileCta?: boolean;
  /** After persistence: what the membership row says (operator overrides win). */
  membership: "active" | "skipped" | "left";
  decidedBy: "agent" | "operator";
};

export async function buildFitAgent(cvx: ConvexHttpClient, mintAddress: string, secret: string): Promise<{ agent: FitAgent; ownerWallet: string; niche: string; agentType: string } | null> {
  const doc = (await cvx.query(api.influencers.getByMint, { mintAddress })) as
    | { niche?: string; creatorWallet: string; agentType?: string; installedSkills?: string[]; connectedPlatforms?: string[] }
    | null;
  if (!doc) return null;
  let overrides: Record<string, number> = {};
  try { overrides = (await cvx.query(api.adminPricing.effectiveSkillPrices, {})).overrides; } catch { /* static defaults */ }
  const scoutOverride = overrides["clip.campaignscout"];
  const scoutFee = isValidSkillPrice(scoutOverride) ? scoutOverride : (CLIP_SKILL_PRICE_USDC["clip.campaignscout"] ?? 0.1);
  const wired = (doc.installedSkills ?? []).filter((id) => id in CLIP_SKILL_PRICE_USDC);
  const estCostUsdc = +(scoutFee + clipSkillRunCostWithOverrides(wired, overrides)).toFixed(6);
  // Track record: median views over this agent's posted campaign submissions.
  let medianViews = 0, sampleCount = 0;
  try {
    const subs = (await cvx.query(api.submissions.listByInfluencer, { influencerMint: mintAddress })) as { viewCount?: number; status: string }[];
    const views = subs.filter((s) => s.status !== "pending" && s.status !== "rejected" && (s.viewCount ?? 0) > 0).map((s) => s.viewCount!);
    medianViews = median(views); sampleCount = views.length;
  } catch { /* no history */ }
  void secret;
  return {
    agent: { niche: doc.niche ?? "", connectedPlatforms: doc.connectedPlatforms ?? [], medianViews, sampleCount, estCostUsdc },
    ownerWallet: doc.creatorWallet,
    niche: (doc.niche ?? "").toLowerCase(),
    agentType: doc.agentType ?? "influencer",
  };
}

/** Gather every open campaign on both rails as FitCampaign + its sources. */
export async function gatherCampaigns(cvx: ConvexHttpClient, ownerWallet: string, consent?: { allowThirdPartySources: boolean; allowProfileCtaCampaigns: boolean }, agentType = "clipping"): Promise<(FitCampaign & { sources: { sourceUrl: string; name: string }[]; campaignId?: string; contentRewardId?: string })[]> {
  const out: (FitCampaign & { sources: { sourceUrl: string; name: string }[]; campaignId?: string; contentRewardId?: string })[] = [];
  try {
    const rows = (await cvx.query(api.campaigns.list, {})) as Doc<"campaigns">[];
    for (const c of rows) {
      if (out.length >= MAX_CAMPAIGNS_EVALUATED) break;
      const isClipper = agentType === "clipping";
      if (isClipper ? (c.category !== "clipping" || c.campaignType !== "marketing") : !isJoinableUgcCampaign(c)) continue;
      if (!isJoinableCampaign(c)) continue;
      const requiresProfileCta = c.requiresProfileCta === true || [...(c.requirements ?? []), c.brief].some((text) => /(?:link\s+in\s+(?:your\s+)?bio|(?:put|add|place|change|update).{0,45}(?:bio|profile).{0,35}(?:link|url)|(?:telegram|t\.me).{0,30}(?:bio|profile))/i.test(text));
      const blocked = !isClipper ? undefined : !c.sourceRightsConfirmed
        ? "campaign source rights not confirmed"
        : c.maxPayoutUsdc
          ? "on-chain per-post caps are not supported for autonomous clipping"
        : !(await gateRestrictedCampaignForOwner(c._id, ownerWallet))
        ? "restricted to invited agents"
        : c.creatorWallet !== ownerWallet && !consent?.allowThirdPartySources
          ? "third-party creator sources require owner consent"
          : requiresProfileCta && !consent?.allowProfileCtaCampaigns
            ? "profile or bio CTA requires owner consent"
            : undefined;
      const urls = [...(Array.isArray(c.contentLinks) ? c.contentLinks : []), ...(Array.isArray(c.contentFileUrls) ? c.contentFileUrls : [])];
      const sources: { sourceUrl: string; name: string }[] = [];
      if (!blocked && isClipper) {
        for (const url of urls) {
          if (sources.length >= MAX_SOURCES_PER_CANDIDATE) break;
          try {
            const { videos } = await resolveSourceUrl(url);
            for (const v of videos) { if (sources.length >= MAX_SOURCES_PER_CANDIDATE) break; sources.push({ sourceUrl: v.url, name: v.name }); }
          } catch { /* per-URL best-effort */ }
        }
      }
      const deadlineMs = Date.parse(c.deadline);
      out.push({
        id: c._id, campaignId: c._id, rail: "onchain", title: c.title,
        ratePerThousandViews: Number(c.ratePerThousandViews) || 0, maxPayoutUsdc: c.maxPayoutUsdc,
        budgetUsdc: Number(c.budget) || 0, budgetRemainingUsdc: Math.max(0, (Number(c.budget) || 0) - (Number(c.spentUsdc) || 0)),
        targetNiche: c.targetNiche ?? [], targetLanguage: c.targetLanguage, platforms: c.platforms,
        deadlineAt: Number.isFinite(deadlineMs) ? deadlineMs : undefined, blocked, sourceCount: isClipper ? sources.length : 1, sources, requiresProfileCta,
        workKind: isClipper ? "clipping" : "ugc",
      });
    }
  } catch { /* Convex campaigns unavailable → content_rewards only */ }
  return out;
}

/** Score every campaign, persist the agent's verdicts, return the merged view. */
export async function evaluateCampaignsForAgent(mintAddress: string, opts: { persist: boolean }): Promise<{ agent: FitAgent; results: EvaluatedCampaign[] } | null> {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!CONVEX_URL) return null;
  const cvx = new ConvexHttpClient(CONVEX_URL);
  const a = await buildFitAgent(cvx, mintAddress, secret);
  if (!a) return null;
  const agentDoc = await cvx.query(api.influencers.getByMint, { mintAddress });
  const campaigns = await gatherCampaigns(cvx, a.ownerWallet, agentDoc?.campaignWorkConsent, a.agentType);
  const ranked = rankCampaigns(a.agent, campaigns);
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const results: EvaluatedCampaign[] = [];
  for (const v of ranked) {
    const c = byId.get(v.campaignId)!;
    let membership: EvaluatedCampaign["membership"] = v.verdict === "join" ? "active" : "skipped";
    let decidedBy: EvaluatedCampaign["decidedBy"] = "agent";
    if (opts.persist && secret) {
      try {
        const r = await cvx.mutation(api.campaignMemberships.upsertAgentDecision, {
          mintAddress, authSecret: secret, campaignId: c.campaignId, contentRewardId: c.contentRewardId, rail: c.rail, title: c.title,
          verdict: agentDoc?.campaignWorkConsent?.autoJoin && !c.requiresProfileCta ? v.verdict : "skip", score: v.score, reasons: c.requiresProfileCta ? [...v.reasons, "Profile-link CTA: owner approval and a matching bio link required"] : v.reasons, expectedViews: v.expectedViews, expectedPayoutUsdc: v.expectedPayoutUsdc,
          netUsdc: v.netUsdc, ratePerThousandViews: c.ratePerThousandViews, budgetRemainingUsdc: c.budgetRemainingUsdc, deadlineAt: c.deadlineAt,
        });
        membership = r.status as EvaluatedCampaign["membership"]; decidedBy = r.decidedBy;
      } catch { /* persistence is best-effort; the verdict still drives this cycle */ }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drop the fit id, EvaluatedCampaign carries `id`
    const { campaignId: _fitId, ...verdict } = v;
    results.push({ ...verdict, id: c.id, rail: c.rail, title: c.title, campaignId: c.campaignId, contentRewardId: c.contentRewardId, ratePerThousandViews: c.ratePerThousandViews, budgetRemainingUsdc: c.budgetRemainingUsdc, deadlineAt: c.deadlineAt, sources: c.sources, requiresProfileCta: c.requiresProfileCta, membership, decidedBy });
  }
  return { agent: a.agent, results };
}

/** What the auto-clip loop may clip from: ACTIVE memberships with sources, best first. */
export function toAutoClipCandidates(results: EvaluatedCampaign[], max = 6, autoJoin = false): AutoClipCandidate[] {
  // A campaign the OPERATOR joined is always worked (their choice beats the
  // agent's fit score) and goes first; agent-joined ones still need a "join".
  return results
    .filter((r) => r.rail === "onchain" && r.membership === "active" && r.sources.length > 0 && (
      r.decidedBy === "operator" || (autoJoin && !r.requiresProfileCta && r.verdict === "join")
    ))
    .sort((a, b) => Number(b.decidedBy === "operator") - Number(a.decidedBy === "operator"))
    .slice(0, max)
    .map((r) => ({ campaignId: r.campaignId, contentRewardId: r.contentRewardId, title: r.title, sources: r.sources }));
}
