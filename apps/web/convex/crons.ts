import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { KEEPER_INTERVAL_MS, REDEMPTION_KEEPER_INTERVAL_MS } from "../lib/economy/constants";
import { sendAlert } from "../lib/server/alert";
import { appFetch } from "./lib/appFetch";

/** Backlog thresholds (ORA-3): alert when a keeper reports at least this many
 *  unsettled/skipped rows in one tick — a persistent stall worth a human's eyes. */
const ORACLE_BACKLOG_ALERT = 5;

// Per-tick read bounds — keep the per-minute / hourly crons off a full-table scan
// as the influencers / agentAccount tables grow unbounded. Overflow drains on the
// next tick.
const MAX_HEARTBEAT_AGENTS_PER_TICK = 500;
const MAX_SETTLE_DUE_PER_TICK = 500;

interface AgentHeartbeat {
  mintAddress: string;
  heartbeatEnabled?: boolean;
  heartbeatCron?: string;
  heartbeatMarkdown?: string;
  heartbeatLastFiredAt?: number;
  heartbeatNextFireAt?: number;
  agentType?: string;
  niche?: string;
}

/** Pull the agents whose heartbeat slot is DUE (enabled + nextFireAt ≤ now), or
 *  not yet seeded (nextFireAt undefined sorts first in the index, so claimHeartbeat
 *  can seed it without firing), via by_heartbeat. Enabled-but-not-yet-due agents
 *  are skipped here — claimHeartbeat would no-op them anyway — so the per-minute
 *  read stays bounded instead of scanning the whole influencers table. */
export const getHeartbeatAgents = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<AgentHeartbeat[]> => {
    const influencers = await ctx.db
      .query("influencers")
      .withIndex("by_heartbeat", (q) => q.eq("heartbeatEnabled", true).lte("heartbeatNextFireAt", now))
      .take(MAX_HEARTBEAT_AGENTS_PER_TICK);
    return influencers.map((i) => ({
      mintAddress: i.mintAddress,
      heartbeatEnabled: i.heartbeatEnabled,
      heartbeatCron: i.heartbeatCron,
      heartbeatMarkdown: i.heartbeatMarkdown,
      heartbeatLastFiredAt: i.heartbeatLastFiredAt,
      heartbeatNextFireAt: i.heartbeatNextFireAt,
      agentType: i.agentType,
      niche: i.niche,
    }));
  },
});

/**
 * Internal action — runs every minute.
 * For each enabled agent, atomically claims its wall-clock heartbeat slot via
 * `claimHeartbeat` (compare-and-advance, so neither the cron nor an open client
 * page can double-fire). The winner runs `fireHeartbeatForAgent`, which plans +
 * creates tasks entirely inside Convex (no HTTP to Next) and schedules their
 * execution. Planning runs 24/7 regardless of whether the Next app is reachable.
 */
export const heartbeat = internalAction({
  args: {},
  handler: async (ctx): Promise<{ fired: number; totalAgents: number; dispatched: number }> => {
    const now = Date.now();
    let fired = 0;
    let totalAgents = 0;

    // ── Phase 1: SCHEDULE — claim due agents' slots + create their pending tasks.
    // Wrapped so a Phase-1 failure can never starve Phase 2 (the global, self-
    // healing pending-task dispatcher), which must run every tick.
    try {
      const agents: AgentHeartbeat[] = await ctx.runQuery(internal.crons.getHeartbeatAgents, { now });
      totalAgents = agents.length;
      await Promise.allSettled(
        agents.map(async (a) => {
          if (!a.heartbeatEnabled) return;
          const claim = await ctx.runMutation(api.influencers.claimHeartbeat, {
            mintAddress: a.mintAddress,
            now,
          });
          if (!claim?.claimed) return;
          fired += 1;
          await ctx.runAction(internal.agentAutonomy.fireHeartbeatForAgent, {
            mintAddress: a.mintAddress,
          });
        }),
      );
    } catch (e) {
      console.warn("[cron.heartbeat] phase 1 failed (phase 2 still runs):", e instanceof Error ? e.message : e);
    }

    // ── Phase 2: DISPATCH (global + self-healing) — execute ANY pending task,
    // not just the ones just claimed. A dispatch that failed on a previous tick
    // (transient network / a tab that wasn't open) is retried here every minute,
    // so work never strands until the agent's next slot. run-task atomically
    // claims pending→running, so this can't double-run with the per-agent fire.
    const { dispatched } = await ctx.runAction(internal.crons.dispatchAllPending, {});

    return { fired, totalAgents, dispatched };
  },
});

// Cap how many pending tasks we kick per tick so a backlog can't stampede the
// Next app; the rest drain on subsequent ticks (they stay pending until run).
const MAX_DISPATCH_PER_TICK = 25;

/**
 * Self-healing executor: POST every pending task (oldest first, capped) to the
 * Next `run-task` route, which owns the heavy work (KIE / ffmpeg / posting) and
 * atomically claims pending→running so a task is never run twice. Runs each tick.
 * Requires NEXT_PUBLIC_APP_URL (+ INTERNAL_CRON_SECRET) in the Convex env so it
 * can reach the deployed app — without the URL it logs and no-ops.
 */
export const dispatchAllPending = internalAction({
  args: {},
  handler: async (ctx): Promise<{ dispatched: number }> => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const secret = process.env.INTERNAL_CRON_SECRET;
    if (!appUrl) {
      console.warn("[cron.dispatchAllPending] NEXT_PUBLIC_APP_URL not set in Convex env — cannot execute tasks");
      return { dispatched: 0 };
    }
    const pending = await ctx.runQuery(api.agentTasks.listPendingAll, { limit: MAX_DISPATCH_PER_TICK });
    let dispatched = 0;
    await Promise.allSettled(
      (pending ?? []).map(async (t: { _id: string; mintAddress: string; type: string; title: string; input: string }) => {
        let input: Record<string, unknown> = {};
        try { input = t.input ? JSON.parse(t.input) : {}; } catch { input = {}; }
        try {
          const res = await appFetch(`/api/agents/run-task`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(secret ? { "X-Internal-Secret": secret } : {}),
            },
            body: JSON.stringify({
              mintAddress: t.mintAddress,
              taskType: t.type,
              title: t.title,
              input,
              triggeredBy: "cron_heartbeat",
              taskId: t._id,
            }),
          });
          if (res.ok) dispatched += 1;
          else console.warn(`[cron.dispatchAllPending] run-task ${res.status} for ${t._id} — stays pending, retries next tick`);
        } catch (e) {
          console.warn(`[cron.dispatchAllPending] dispatch failed for ${t._id} (retries next tick):`, e instanceof Error ? e.message : e);
        }
      }),
    );
    return { dispatched };
  },
});

export const getAgentAccountsDue = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ mintAddress: string }>> => {
    // Backstop the in-band per-run sweep (lib/economy/settleAgent.ts), which gates
    // on VELLO_SETTLE_THRESHOLD_USDC ?? 0.05. This cron MUST use the SAME threshold:
    // it previously used a hardcoded 5, so any tab in [0.05, 5) that failed in-band
    // (e.g. a transient "insufficient SOL for fees") was orphaned forever — the
    // recovery keeper only re-drives BOOKED feeSettlements rows, which an un-swept
    // tab never became. Now any positive tab at/above the in-band threshold is
    // retried hourly.
    const threshold = Number(process.env.VELLO_SETTLE_THRESHOLD_USDC ?? "0.05");
    // Range-read accounts at/above the threshold via by_unsettled_tab (largest tab
    // first, capped per tick) instead of scanning every account; any overflow
    // drains on later hourly ticks. The >0 guard keeps a threshold of 0 from
    // sweeping zero-tab accounts.
    const accounts = await ctx.db
      .query("agentAccount")
      .withIndex("by_unsettled_tab", (q) => q.gte("unsettledTabUsdc", threshold))
      .order("desc")
      .take(MAX_SETTLE_DUE_PER_TICK);
    return accounts
      .filter((a) => a.unsettledTabUsdc > 0)
      .map((a) => ({ mintAddress: a.mintAddress }));
  },
});

export const settleDueTabs = internalAction({
  args: {},
  handler: async (ctx): Promise<{ triggered: number }> => {
    const due: Array<{ mintAddress: string }> = await ctx.runQuery(internal.crons.getAgentAccountsDue, {});
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await Promise.allSettled(
      due.map((a: { mintAddress: string }) =>
        appFetch(`/api/economy/settle-tab`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
          },
          body: JSON.stringify({ mintAddress: a.mintAddress }),
        }).catch(() => null),
      ),
    );
    return { triggered: due.length };
  },
});

/**
 * RECOVERY KEEPER driver — mirrors the settleDueTabs cron→Next-route pattern.
 * POSTs to the internal-secret-gated `/api/economy/recover-settlements` route
 * (runtime=nodejs), which lists STRANDED fee settlements (booked but never paid:
 * crashed in-band settle / released pre-broadcast failure / unconfirmed transfer)
 * and re-drives each: re-claim the row, verify any confirm-step sig on-chain,
 * re-transfer + mark paid. Best-effort — the route returns 200 with per-row
 * outcomes; on a network error we no-op and the next tick retries.
 */
export const recoverStrandedSettlements = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await appFetch(`/api/economy/recover-settlements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => null);
    return { ok: !!res?.ok };
  },
});

/**
 * WITHDRAWAL RECOVERY KEEPER driver — mirrors the recoverStrandedSettlements
 * cron→Next-route pattern. POSTs to the internal-secret-gated
 * `/api/economy/recover-withdrawals` route (runtime=nodejs), which lists STRANDED
 * owner withdrawals (pending past the grace window) and, for those carrying a
 * confirm-ambiguous broadcast signature, verifies it on-chain and either marks it
 * paid or (once its blockhash provably expired) safely re-transfers. Best-effort —
 * on a network error we no-op and the next tick retries.
 */
export const recoverStrandedWithdrawals = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await appFetch(`/api/economy/recover-withdrawals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => null);
    return { ok: !!res?.ok };
  },
});

/**
 * REDEMPTION RECOVERY KEEPER driver — mirrors the recoverStrandedSettlements
 * cron→Next-route pattern. POSTs to the internal-secret-gated
 * `/api/economy/recover-redemptions` route (runtime=nodejs), which lists STRANDED
 * share redemptions (burn committed but the USDC payout never confirmed: the route
 * crashed pre-transfer, or a confirm-timeout left the outcome unknown) and re-drives
 * each — verifying any broadcast signature on-chain BEFORE re-transferring, or
 * reversing the burn when the payout provably never moved. Best-effort — on a network
 * error we no-op and the next tick retries.
 */
export const recoverStrandedRedemptions = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await appFetch(`/api/economy/recover-redemptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res) console.warn("[cron.recoverStrandedRedemptions] /api/economy/recover-redemptions unreachable — will retry next tick");
    else if (!res.ok) console.warn(`[cron.recoverStrandedRedemptions] returned ${res.status}`);
    return { ok: !!res?.ok };
  },
});

/**
 * SETTLEMENT ORACLE driver — mirrors the recoverStrandedSettlements cron→Next-route
 * pattern. POSTs to the internal-secret-gated `/api/oracle/run` route (runtime=nodejs),
 * which queries matured + unsettled submissions, reads each post's live view count
 * from upload-post, scores it through the fraud engine, and settles approved/rejected
 * via Convex. Best-effort — on a network error we no-op and the next tick retries.
 */
export const runDueOracle = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await appFetch(`/api/oracle/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res) {
      console.warn("[cron.runDueOracle] /api/oracle/run unreachable — will retry next tick");
      await sendAlert("oracle-run-unreachable", {}).catch(() => {});
      return { ok: false };
    }
    if (!res.ok) {
      console.warn(`[cron.runDueOracle] /api/oracle/run returned ${res.status}`);
      await sendAlert("oracle-run-http-error", { status: res.status }).catch(() => {});
      return { ok: false };
    }
    // ORA-3: surface the route's counters (previously discarded) — log every tick
    // and alert on a non-trivial settlement backlog so a v2 stall is visible.
    let body:
      | { due?: number; settled?: number; skippedV2?: number; reattested?: number }
      | null = null;
    try {
      body = await res.json();
    } catch {
      body = null; // non-JSON / empty body — counters are best-effort, never throw
    }
    if (body) {
      console.log("[cron.runDueOracle] counters", body);
      if ((body.skippedV2 ?? 0) >= ORACLE_BACKLOG_ALERT) {
        await sendAlert("oracle-skippedV2-backlog", body).catch(() => {});
      }
    }
    return { ok: true };
  },
});

/**
 * Analytics view-sync driver — mirrors the runDueOracle cron→Next-route
 * pattern. POSTs to the internal-secret-gated /api/analytics/sync-cron route,
 * which re-reads live view counts from upload-post's analytics API for every
 * minted agent's recent posts and writes them back onto clips/submissions.
 * The Analytics page's Convex queries are already reactive — this is what
 * closes the actual gap (view counts previously only refreshed when a human
 * opened /analytics and clicked "Refresh").
 */
export const runAnalyticsSync = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const res = await appFetch(`/api/analytics/sync-cron`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res) {
      console.warn("[cron.runAnalyticsSync] /api/analytics/sync-cron unreachable — will retry next tick");
      return { ok: false };
    }
    if (!res.ok) {
      console.warn(`[cron.runAnalyticsSync] /api/analytics/sync-cron returned ${res.status}`);
      return { ok: false };
    }
    const body = await res.json().catch(() => null);
    if (body) console.log("[cron.runAnalyticsSync] counters", body);
    return { ok: true };
  },
});

/** Per-minute driver for explore "Schedule": submits due renders and finishes completed ones. */
export const runScheduledRecreations = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const res = await appFetch(`/api/explore/schedule/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => null);
    return { ok: !!res?.ok };
  },
});

/**
 * CLAIM KEEPER driver — mirrors the runDueOracle cron→Next-route pattern. POSTs to
 * the internal-secret-gated `/api/oracle/claim` route (runtime=nodejs), which
 * lists approved+attested+not-fully-paid v2 submissions and cranks `claim_payout`
 * on-chain for each (signed by VELLO_CRANK_SECRET), then mirrors the paid amount +
 * credits the NAV on the net actually disbursed. Best-effort — the chain is the
 * idempotency source (a duplicate crank pays 0), so on a network error we no-op
 * and the next tick retries.
 */
export const runClaimPayouts = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await appFetch(`/api/oracle/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res) {
      console.warn("[cron.runClaimPayouts] /api/oracle/claim unreachable — will retry next tick");
      await sendAlert("claim-keeper-unreachable", {}).catch(() => {});
      return { ok: false };
    }
    if (!res.ok) {
      console.warn(`[cron.runClaimPayouts] /api/oracle/claim returned ${res.status}`);
      await sendAlert("claim-keeper-http-error", { status: res.status }).catch(() => {});
      return { ok: false };
    }
    // ORA-3: surface the route's counters (previously discarded) — log every tick
    // and alert on a non-trivial claim backlog (most single-tick skips are the
    // expected dispute-window reverts; a large skip count is a systemic stall).
    let body: { due?: number; claimed?: number; skipped?: number } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null; // non-JSON / empty body — counters are best-effort, never throw
    }
    if (body) {
      console.log("[cron.runClaimPayouts] counters", body);
      if ((body.skipped ?? 0) >= ORACLE_BACKLOG_ALERT) {
        await sendAlert("claim-backlog", body).catch(() => {});
      }
    }
    return { ok: true };
  },
});

/**
 * V1 PAYOUT RE-DRIVE KEEPER (E2E hunt #11) — self-heals dropped LEGACY off-chain
 * payouts. dueForDistribution lists verified+approved v1 (onchainVersion<2)
 * submissions with a positive payout and NO distributions row; each is POSTed to
 * the idempotent /api/agents/distribute-earnings, so a row that actually credited
 * is skipped and one whose scheduled dispatch dropped is re-credited next tick.
 * (v2 payouts self-heal via runClaimPayouts; this is the v1 analogue.)
 */
export const runV1Distributions = internalAction({
  args: {},
  handler: async (ctx): Promise<{ redriven: number }> => {
    const secret = process.env.INTERNAL_CRON_SECRET;
    if (!secret) return { redriven: 0 };
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const due = await ctx.runQuery(api.submissions.dueForDistribution, { authSecret: secret });
    let redriven = 0;
    await Promise.allSettled(
      (due ?? []).map(async (d) => {
        try {
          const res = await appFetch(`/api/agents/distribute-earnings`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Internal-Secret": secret },
            body: JSON.stringify({
              mintAddress: d.mintAddress,
              payoutUsdc: d.payoutUsdc,
              campaignId: d.campaignId,
              submissionId: d.submissionId,
            }),
          });
          if (res.ok) redriven += 1;
          else console.warn(`[cron.runV1Distributions] ${res.status} submission=${d.submissionId} — retries next tick`);
        } catch (e) {
          console.warn(`[cron.runV1Distributions] failed submission=${d.submissionId}:`, e instanceof Error ? e.message : e);
        }
      }),
    );
    return { redriven };
  },
});

/**
 * CLIPPER EARNINGS KEEPER — keeps content-reward (clipper/UGC) view counts AND the
 * agents' earnings fresh automatically, so the admin/agents/market pages show live
 * data without anyone clicking "Sync". Each tick: (1) refresh live views via the
 * upload-post analytics for TikTok/Instagram/YouTube, then (2) recompute every
 * submission's payout from its campaign reward × views and mirror it into the
 * agents' earnings (distributions → monthlyEarnings/lifetime/PnL/chart). The pages
 * are Convex subscriptions, so they update in realtime the moment this writes.
 * Best-effort — a failed leg just retries next tick.
 */
export const syncClipperEarnings = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const headers = {
      "Content-Type": "application/json",
      ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
    };
    // 1) Refresh live views per platform via upload-post analytics only.
    //    This avoids the proxy path entirely and keeps the cron stable.
    for (const platform of ["tiktok", "instagram", "youtube"]) {
      await appFetch(`/api/oracle/scrape-views`, {
        method: "POST",
        headers,
        body: JSON.stringify({ platform, mode: "analytics" }),
      }).catch(() => null);
    }
    // 2) Recompute payouts + credit agent earnings from the latest views.
    const res = await appFetch(`/api/admin/recalc-payout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ all: true }),
    }).catch(() => null);
    if (!res) console.warn("[cron.syncClipperEarnings] recalc-payout unreachable — retries next tick");
    else if (!res.ok) console.warn(`[cron.syncClipperEarnings] recalc-payout returned ${res.status}`);
    return { ok: !!res?.ok };
  },
});

/**
 * FIRST-SYNC for one freshly-posted content-reward clip. Scheduled (runAfter 1h)
 * by `contentRewardMeasurements.upsert` the moment a clip posts, so its permalink/
 * views backfill within an hour instead of waiting for the next 6h
 * `syncClipperEarnings` sweep. Only touches the ONE platform the clip posted to
 * (not all three) — cheap, best-effort, no-op if the app is unreachable.
 */
export const syncOnePlatformThenRecalc = internalAction({
  args: { platform: v.string() },
  handler: async (_ctx, { platform }): Promise<{ ok: boolean }> => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const headers = {
      "Content-Type": "application/json",
      ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
    };
    await appFetch(`/api/oracle/scrape-views`, {
      method: "POST",
      headers,
      body: JSON.stringify({ platform, mode: "analytics" }),
    }).catch(() => null);
    const res = await appFetch(`/api/admin/recalc-payout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ all: true }),
    }).catch(() => null);
    if (!res) console.warn(`[cron.syncOnePlatformThenRecalc] ${platform} unreachable`);
    return { ok: !!res?.ok };
  },
});

/**
 * CONNECTED-SOCIALS sync — mirrors the cron→Next-route pattern. POSTs to the
 * internal-secret-gated `/api/social/sync-connected` route, which reads EVERY
 * agent's connected upload-post platforms and caches them on the influencers row
 * so the public /agents cards can render the connected-account badges without an
 * owner-gated per-agent call. Best-effort — a network error no-ops until next tick.
 */
export const syncConnectedSocials = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await appFetch(`/api/social/sync-connected`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res) {
      console.warn("[cron.syncConnectedSocials] /api/social/sync-connected unreachable — will retry next tick");
      return { ok: false };
    }
    if (!res.ok) {
      console.warn(`[cron.syncConnectedSocials] returned ${res.status}`);
      return { ok: false };
    }
    return { ok: true };
  },
});

/**
 * FOLLOWER COUNTS driver — POSTs the internal-secret-gated /api/social/sync-followers
 * route, which refreshes the STALEST few agents' live follower counts from
 * upload-post profile analytics (rate-limited upstream, so it rotates through the
 * roster a few agents per tick). Best-effort; the next tick retries.
 */
export const runFollowerSync = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean }> => {
    const res = await appFetch(`/api/social/sync-followers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res) {
      console.warn("[cron.runFollowerSync] /api/social/sync-followers unreachable — will retry next tick");
      return { ok: false };
    }
    if (!res.ok) {
      console.warn(`[cron.runFollowerSync] returned ${res.status}`);
      return { ok: false };
    }
    const body = await res.json().catch(() => null);
    if (body) console.log("[cron.runFollowerSync]", { due: body.due, synced: body.synced, rateLimited: body.rateLimited });
    return { ok: true };
  },
});

const crons = cronJobs();

// Live follower counts on the public /agents cards (upload-post profile analytics).
crons.interval("sync follower counts", { minutes: 10 }, internal.crons.runFollowerSync, {});

// Keep every agent's connected-social badges fresh on the public /agents cards.
crons.interval("sync connected social accounts", { minutes: 30 }, internal.crons.syncConnectedSocials, {});

// Poll every minute — each agent only fires if its per-agent cron interval has elapsed
crons.interval(
  "agent heartbeat scheduler",
  { minutes: 1 },
  internal.crons.heartbeat,
  {}
);

crons.interval("settle due agent service tabs", { hours: 1 }, internal.crons.settleDueTabs, {});

// Recovery keeper — re-drive stranded fee settlements (booked but unpaid). Runs
// at KEEPER_INTERVAL_MS (~10m); GRACE_MS keeps it from racing the in-band settle.
crons.interval(
  "recover stranded fee settlements",
  { minutes: Math.round(KEEPER_INTERVAL_MS / 60_000) },
  internal.crons.recoverStrandedSettlements,
  {},
);

// Withdrawal recovery keeper — re-drive stranded owner withdrawals (pending past
// the grace window: verify a confirm-ambiguous sig on-chain, then mark paid or
// safely re-transfer once its blockhash provably expired). Same KEEPER_INTERVAL_MS
// cadence as the settlement keeper. Load-bearing: without it, a confirm-ambiguous
// withdrawal would strand a mint's per-withdrawal lock forever.
crons.interval(
  "recover stranded withdrawals",
  { minutes: Math.round(KEEPER_INTERVAL_MS / 60_000) },
  internal.crons.recoverStrandedWithdrawals,
  {},
);

// Redemption recovery keeper — finalize stranded share redemptions (burn committed
// but the USDC payout never confirmed). Verifies any broadcast sig on-chain before
// re-transferring; reverses the burn when the payout provably never moved.
crons.interval(
  "recover stranded share redemptions",
  { minutes: Math.round(REDEMPTION_KEEPER_INTERVAL_MS / 60_000) },
  internal.crons.recoverStrandedRedemptions,
  {},
);

// Drip-post pre-rendered clips whose scheduled time has arrived ("bulk clip,
// then slowly post"). Only handles scheduledContent rows WITH a videoUrl.
crons.interval("drip-post scheduled clips", { minutes: 5 }, internal.scheduledContent.drainDueClips, {});

// Reap orphaned clip jobs — a clipJobs.process action evicted/recycled before its
// try/catch could write status:'error' leaves the row stuck forever (canvas spins
// AND enqueue's dedup blocks re-running that source). Pure internalMutation, runs
// regardless of app reachability.
crons.interval("reap stale clip jobs", { minutes: 5 }, internal.clipJobs.reapStaleJobs, {});

// Same for source downloads: download-start runs in the Next process, so a
// restart mid-pull leaves the downloadJobs row "downloading" forever.
crons.interval("reap stale source downloads", { minutes: 10 }, internal.downloadJobs.reapStaleDownloads, {});

// Settlement oracle — score + settle matured campaign submissions (read live
// views from upload-post → fraud engine → approve/reject). Runs every 30 min.
crons.interval("settle matured campaign submissions", { minutes: 30 }, internal.crons.runDueOracle, {});

// Claim keeper — crank claim_payout on-chain for approved+attested v2 submissions
// (pays the agent's USDC vault, skims the protocol fee, credits NAV on the net).
// Runs every 10 min; the chain is idempotent so over-running is harmless.
crons.interval("claim matured campaign payouts", { minutes: 10 }, internal.crons.runClaimPayouts, {});

// v1 (legacy off-chain) payout re-drive — self-heals dropped dispatches (#11).
crons.interval("re-drive dropped v1 payouts", { minutes: 10 }, internal.crons.runV1Distributions, {});

// Clipper earnings keeper — refresh content-reward views (proxy scrape) + recompute
// payouts + credit agent earnings, so /admin/submissions, /agents and /market show
// live earnings automatically (no manual "Sync"). Runs every 6h to bound the
// residential-proxy yt-dlp scrape cost — the on-chain payout oracle (runDueOracle,
// upload-post API, every 30 min) and the claim crank are unaffected by this cadence.
// A fresh post doesn't wait for this sweep: contentRewardMeasurements.upsert
// schedules a one-off single-platform sync 1h after posting (see below), so
// /admin/submissions shows "posted" within an hour instead of up to 6h.
crons.interval("sync clipper views + earnings", { hours: 6 }, internal.crons.syncClipperEarnings, {});

// Analytics view-sync — refreshes clips/submissions.viewCount for every minted
// agent from upload-post's (cheap, non-proxy) analytics API, so /analytics
// stays current automatically instead of requiring a manual "Refresh" click.
// 5 min (was 20) for near-real-time freshness — each tick is a bounded, cheap
// upload-post GET-analytics sweep (not a scrape), so a tighter cadence doesn't
// meaningfully add load. Each tick processes mints in rotating chunks of 25
// (see sync-cron/route.ts, ROTATE_MS kept in lockstep with this interval) so
// coverage cycles through every agent over time instead of always refreshing
// only the newest ones.
crons.interval("sync analytics views", { minutes: 5 }, internal.crons.runAnalyticsSync, {});

// /agents hero totals (views, volume, videos) — full-table walk, so hourly.
crons.interval("scheduled explore recreations", { minutes: 1 }, internal.crons.runScheduledRecreations, {});
crons.interval("refresh platform stats", { hours: 1 }, internal.platformStats.refresh, {});

crons.interval("content control publishing", { minutes: 2 }, internal.contentControl.sweep, {});

crons.cron("community character replies", "1 * * * *", internal.communityChat.hourly, {});
crons.interval("DBC fee collection and content flywheel", { minutes: 2 }, internal.solstarFlywheel.sweep, {});

export default crons;
