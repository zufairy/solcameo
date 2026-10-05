import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { autoClipKey, chooseAutoClip, type AutoClipCandidate } from "../lib/server/autoClipSelect";
import { clipSkillRunCostWithOverrides, CLIP_SKILL_PRICE_USDC, isValidSkillPrice } from "../lib/economy/servicePrices";
import { effectiveSpendableUsdc } from "../lib/economy/nav";
import { hasClipModule } from "../lib/builder/clipPhase";
import { normalizeClipConfig } from "../lib/builder/clipConfig";
import { appFetch } from "./lib/appFetch";

/**
 * Autonomous clipping — ONE cycle for one agent (spec
 * 2026-07-03-autonomous-clipping-design.md). Wired off the daily heartbeat
 * (convex/agentAutonomy.fireHeartbeatForAgent) for toggle-ON clip agents.
 *
 * Money path (money-safe by construction — a broke/capped/no-new agent NEVER
 * charges or enqueues):
 *   1. Gate: clip agent + autoClipEnabled, else return { off/not_clip_agent }.
 *   2. Gather fit-matched + funded + restriction-safe candidates WITH expanded
 *      sources from the Next scout route (server-only Supabase + Drive + gates).
 *   3. Dedup: the (campaign, source-video) keys already clipped (autoClippedKeysForMint).
 *   4. Read spendable + daily-cap headroom (getWithNav + todaysSpendQuery).
 *   5. chooseAutoClip → { skip } (no charge) OR { source }.
 *   6. Charge the $0.10 scout fee (recordUsage clip.campaignscout, idempotent per
 *      (mint, source key)); a funds/cap denial stops here (no enqueue).
 *   7. enqueue the clip (sourceType "auto") — the existing pipeline clips →
 *      auto-posts → auto-submits. Its OWN funding gate + refund-on-failure backstop.
 * One clip per cycle. Idempotency: the recordUsage idemKey + the dedup query make a
 * same-cycle re-run a no-op.
 */
export const runAutoClipForMint = internalAction({
  args: { mintAddress: v.string() },
  handler: async (
    ctx,
    { mintAddress },
  ): Promise<{ clipped: boolean; sourceUrl?: string; reason?: string }> => {
    // globalThis.process: convex/clipJobs.ts exports an action named `process` that
    // shadows Node's global `process`; reach env consistently via globalThis here too.
    const secret = globalThis.process.env.INTERNAL_CRON_SECRET;
    if (!secret) return { clipped: false, reason: "no_secret" };

    // 1. Load agent + gate the toggle and clip-agent-ness.
    const agent = await ctx.runQuery(api.influencers.getByMint, { mintAddress });
    if (!agent) return { clipped: false, reason: "no_agent" };
    if (!agent.autoClipEnabled) return { clipped: false, reason: "off" };
    if (!agent.campaignWorkConsent) return { clipped: false, reason: "consent_required" };
    if (agent.agentType !== "clipping" || !hasClipModule(agent.agentType, agent.installedSkills)) return { clipped: false, reason: "not_clip_agent" };
    const posting = normalizeClipConfig(agent.clipConfig as Record<string, unknown> | undefined);
    if (!posting.autoPost) return { clipped: false, reason: "auto_post_off" };
    const connected = new Set((agent.connectedPlatforms ?? []).map((platform: string) => platform.toLowerCase()));
    if (connected.size === 0 || (posting.platforms.length > 0 && !posting.platforms.some((platform) => connected.has(platform)))) {
      return { clipped: false, reason: "no_connected_posting_account" };
    }

    // 2. Gather candidates (server-only work happens in the Next route).
    const appUrl = globalThis.process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) return { clipped: false, reason: "no_app_url" };
    let candidates: AutoClipCandidate[] = [];
    let scoutKieApiKey: string | undefined;
    try {
      const res = await appFetch(`/api/agents/auto-clip-scout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Secret": secret },
        body: JSON.stringify({ mintAddress }),
      });
      if (!res.ok) return { clipped: false, reason: `scout_${res.status}` };
      const bodyJson = (await res.json()) as { candidates?: AutoClipCandidate[]; kieApiKey?: string };
      candidates = Array.isArray(bodyJson.candidates) ? bodyJson.candidates : [];
      scoutKieApiKey = typeof bodyJson.kieApiKey === "string" ? bodyJson.kieApiKey : undefined;
    } catch {
      return { clipped: false, reason: "scout_unreachable" };
    }
    if (candidates.length === 0) return { clipped: false, reason: "no_new" };

    // 3. Already-clipped dedup keys (this agent).
    const clippedKeys = new Set<string>(
      (await ctx.runQuery(api.clipJobs.autoClippedKeysForMint, {
        mintAddress,
        authSecret: secret,
      })) as string[],
    );

    // 4. Funding + daily-cap headroom (mirrors the clipJobs.process precheck).
    const account = await ctx.runQuery(api.agentAccount.getWithNav, { mintAddress });
    if (!account) return { clipped: false, reason: "no_account" };
    if (account.status === "suspended") return { clipped: false, reason: "suspended" };
    const today = await ctx.runQuery(api.usage.todaysSpendQuery, { mintAddress });
    // Credits-first: recordUsage charges the owner's prepaid credit balance before
    // the agent's own USDC, so the auto-clip funding gate must see both pools or a
    // credit-funded agent never auto-clips (skip: "insufficient_funds" forever).
    const creditsBalance = await ctx.runQuery(api.userCredits.balanceForMint, { mintAddress });
    const spendable = effectiveSpendableUsdc(account, creditsBalance);
    const dailyRemaining =
      today.capUsdc > 0 ? +(today.capUsdc - today.spentTodayUsdc).toFixed(6) : Number.POSITIVE_INFINITY;

    // 5. Est run cost = scout fee + the agent's wired clip-skill fees (approx from
    //    installedSkills; clipJobs.process re-gates on the EXACT wired cost and
    //    refunds a 0-clip run, so a slight under/over-estimate is money-safe).
    //    Honor admin price overrides so the estimate matches what recordUsage
    //    (which reads the same override) charges. Best-effort — static on failure.
    let priceOverrides: Record<string, number> = {};
    try { priceOverrides = (await ctx.runQuery(api.adminPricing.effectiveSkillPrices, {})).overrides; }
    catch { /* fall back to static defaults; the actual scout charge re-reads the override */ }
    const scoutOverride = priceOverrides["clip.campaignscout"];
    const scoutFee = isValidSkillPrice(scoutOverride) ? scoutOverride : (CLIP_SKILL_PRICE_USDC["clip.campaignscout"] ?? 0.1);
    const wiredSkillIds = ((agent.installedSkills ?? []) as string[]).filter(
      (id: string) => id in CLIP_SKILL_PRICE_USDC,
    );
    const estCostUsdc = +(scoutFee + clipSkillRunCostWithOverrides(wiredSkillIds, priceOverrides)).toFixed(6);

    // 6. Decide — no charge unless we will enqueue.
    // Work tab cadence: clip runs started today vs clipConfig.clipsPerDay (0 = unlimited).
    const clipsPerDay = posting.clipsPerDay ?? 0;
    if (clipsPerDay > 0) {
      const startedToday = (await ctx.runQuery(api.clipJobs.jobsStartedTodayForMint, { mintAddress, authSecret: secret })) as number;
      if (startedToday >= clipsPerDay) return { clipped: false, reason: "daily_clip_cap" };
    }

    const choice = chooseAutoClip({
      candidates,
      clippedKeys,
      spendableUsdc: spendable,
      dailyRemainingUsdc: dailyRemaining,
      estCostUsdc,
    });
    if ("skip" in choice) return { clipped: false, reason: choice.skip };
    const source = choice.source;

    // 7. Charge the scout fee BEFORE enqueue. Idempotent per (mint, source key) so a
    //    same-cycle re-run returns the prior charge instead of double-billing.
    const idemKey = `autoclip:${mintAddress}:${autoClipKey(source.campaignId, source.contentRewardId, source.sourceUrl)}`;
    try {
      const charge = await ctx.runMutation(api.usage.recordUsage, {
        mintAddress,
        service: "clip.campaignscout",
        qty: 1,
        idemKey,
        authSecret: secret,
      });
      if (charge.ok === false) return { clipped: false, reason: charge.reason === "daily_cap" ? "cap" : "insufficient_funds" };
    } catch {
      return { clipped: false, reason: "charge_error" };
    }

    // 8. Enqueue — the existing pipeline clips → auto-posts → auto-submits. Forward
    //    the KIE key (Convex env has none; the scout route sourced it from Next env).
    await ctx.runMutation(api.clipJobs.enqueue, {
      mintAddress,
      sourceUrl: source.sourceUrl,
      sourceType: "auto",
      campaignId: source.campaignId,
      contentRewardId: source.contentRewardId,
      ownerWallet: agent.creatorWallet,
      kieApiKey: globalThis.process.env.KIE_API_KEY || scoutKieApiKey || undefined,
      appUrl,
      authSecret: secret,
    });
    return { clipped: true, sourceUrl: source.sourceUrl };
  },
});
