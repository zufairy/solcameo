import { spendableUsdc } from "../lib/economy/nav";
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { accrueTaskCost, todaysSpend, CREDITS_SETTLED_SENTINEL, refundRunFeesTx } from "./usage";
import { getOwnerWalletForMint } from "./userCredits";
import { getSkillPriceOverride } from "./adminPricing";
import { effectivePostCostUsdc } from "../lib/economy/servicePrices";
import { resolveMemoryScope } from "../lib/agentMemoryScope";

/**
 * Creates a new task for an agent — the universal entry point for any work the agent does.
 * The autonomy loop, manual triggers, and external systems all funnel through here.
 */
// Task `type` is an open string (matches the `agentTasks.type` table schema,
// which is `v.string()`). The authoritative allow-list lives at the application
// layer — the autonomy planner's ALLOWED_TASK_TYPES and the run-task executor's
// dispatch switch. A previous narrow union here SILENTLY rejected most real task
// types (create_video, campaign_submit, trader_buy, …) at the validation layer,
// so every heartbeat-planned task threw and the heartbeat appeared to do nothing.
const TASK_TYPE = v.string();

const TASK_STATUS = v.union(
  v.literal("pending"), v.literal("running"), v.literal("succeeded"),
  v.literal("failed"), v.literal("cancelled"),
);

export const create = mutation({
  args: {
    mintAddress: v.optional(v.string()),  // optional — pre-mint agents have no address yet
    sessionId: v.string(),
    type: TASK_TYPE,
    title: v.string(),
    input: v.optional(v.string()),
    triggeredBy: v.optional(v.string()),
    status: v.optional(TASK_STATUS),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // SECRET-GATED: writes a task row into any agent's economy/state. Ungated, anyone
    // with the Convex URL could fabricate tasks against any agent. Server callers only.
    const { authSecret } = args;
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    return await ctx.db.insert("agentTasks", {
      mintAddress: args.mintAddress ?? "",  // empty string for pre-mint
      sessionId: args.sessionId,
      type: args.type,
      title: args.title,
      input: args.input,
      triggeredBy: args.triggeredBy ?? "user",
      status: args.status ?? "pending",
    });
  },
});

/** Mark task as running — set startedAt and update status. */
export const start = mutation({
  args: { id: v.id("agentTasks"), authSecret: v.string() },
  handler: async (ctx, { id, authSecret }) => {
    // SECRET-GATED: the sole caller is the /api/agents/run-task server route. Ungated,
    // anyone could flip any agent's task to "running" and skew the reaper/dedup logic.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    await ctx.db.patch(id, { status: "running", startedAt: Date.now() });
  },
});

/**
 * Atomically claim a PENDING task for execution (pending → running). Returns
 * `{ claimed: false }` if it was already claimed/finished — so two dispatchers
 * (the Convex cron AND the client-side dispatcher) can both try and exactly one
 * wins. Convex mutations are serializable, so this is race-safe.
 */
export const claimPending = mutation({
  args: { id: v.id("agentTasks"), authSecret: v.string() },
  handler: async (ctx, { id, authSecret }) => {
    // SECRET-GATED: the sole caller is the /api/agents/run-task server route (which
    // proves ownership before dispatching). Ungated, anyone could claim/advance any
    // agent's pending task. Convex mutations are serializable so the claim stays race-safe.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const t = await ctx.db.get(id);
    if (!t || t.status !== "pending") return { claimed: false };
    await ctx.db.patch(id, { status: "running", startedAt: Date.now() });
    return { claimed: true };
  },
});

/**
 * Every still-pending task across all agents (newest first) with the fields a
 * dispatcher needs. The client-side dispatcher polls this and executes them via
 * the same-origin run-task route — the reliable path in local HTTPS dev, where
 * the Convex backend can't reach the self-signed Next server.
 */
export const listPendingAll = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    // Background dispatcher query (mounted on /agents). It must NEVER throw — a
    // server error here previously crashed the whole marketplace page via the
    // client useQuery. Degrade to an empty list on any failure so the dispatcher
    // simply no-ops that tick instead of taking down the page.
    try {
      const tasks = await ctx.db
        .query("agentTasks")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .take(limit ?? 20);
      return tasks
        .filter((t) => !!t.mintAddress)
        .map((t) => ({ _id: t._id, mintAddress: t.mintAddress, type: t.type, title: t.title, input: t.input ?? "" }));
    } catch (e) {
      console.error("[agentTasks.listPendingAll] failed — returning []:", e instanceof Error ? e.message : e);
      return [];
    }
  },
});

/**
 * Reap stuck tasks. A task left in "pending"/"running" past its budget is
 * almost certainly wedged — the run-task process died (serverless timeout) or a
 * reasoning call hung — so the success/failure handler never ran. We auto-fail
 * those so they stop showing "generating" forever AND stop blocking new tasks of
 * the same type (the autonomy dedup treats running/pending as in-flight).
 * Video renders are deferred and legitimately slow, so they get a longer budget.
 */
export const failStaleTasks = mutation({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }) => {
    // SECRET-GATED: the sole caller is the /api/agents/autonomy-loop server route.
    // Ungated, anyone could force-fail any agent's in-flight tasks (denial-of-work).
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const now = Date.now();
    const FAST_BUDGET_MS = 6 * 60_000;    // reasoning/instant tasks (run-task maxDuration is 5 min)
    const VIDEO_BUDGET_MS = 12 * 60_000;  // deferred render has a ~10-min budget
    const candidates = await ctx.db
      .query("agentTasks")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(40);
    let failed = 0;
    for (const t of candidates) {
      if (t.status !== "pending" && t.status !== "running") continue;
      const startedAt = t.startedAt ?? t._creationTime;
      const budget = t.type === "create_video" ? VIDEO_BUDGET_MS : FAST_BUDGET_MS;
      if (now - startedAt < budget) continue;
      await ctx.db.patch(t._id, {
        status: "failed",
        errorMessage: "Timed out — task exceeded its run budget and was auto-failed. Fire the heartbeat again to retry.",
        completedAt: now,
      });
      await releaseHold(ctx, t, 0);
      await releaseWalletHold(ctx, t);
      failed++;
    }
    return { failed };
  },
});

/* ── Up-front credit holds ────────────────────────────────────────────────────
   A paid task reserves its estimated cost from the payer's credits BEFORE any
   work starts. That's atomic (one Convex transaction), so N parallel starts can
   never spend more than the balance — the old charge-after-render path let a
   free account start many videos on 300 credits and render the extras unpaid. */

function payerFromInput(task: Doc<"agentTasks">): string | undefined {
  try {
    const inp = task.input ? (JSON.parse(task.input) as { payerWallet?: unknown }) : undefined;
    return typeof inp?.payerWallet === "string" && inp.payerWallet.trim() ? inp.payerWallet.trim() : undefined;
  } catch { return undefined; }
}

/** Set server-side by run-task when the agent's own wallet funds the run. */
function fundingFromInput(task: Doc<"agentTasks">): string | undefined {
  try {
    const inp = task.input ? (JSON.parse(task.input) as { fundingSource?: unknown }) : undefined;
    return inp?.fundingSource === "agent_wallet" ? "agent_wallet" : undefined;
  } catch { return undefined; }
}

/** Refund whatever part of a task's hold wasn't used, once. */
async function releaseHold(ctx: MutationCtx, task: Doc<"agentTasks">, usedCredits: number): Promise<void> {
  const hold = task.creditHold;
  if (!hold || hold.settled) return;
  const refund = Math.max(0, hold.credits - Math.max(0, usedCredits));
  await ctx.db.patch(task._id, { creditHold: { ...hold, settled: true } });
  if (refund > 0) {
    await ctx.runMutation(internal.userCredits.credit, {
      ownerWallet: hold.wallet, deltaCredits: refund, kind: "refund", relatedMintAddress: task.mintAddress,
    });
  }
}

/** Wallet reservations stay out of the settlement tab until work completes. */
async function releaseWalletHold(ctx: MutationCtx, task: Doc<"agentTasks">) {
  if (!task.walletHold || task.walletHold.settled) return;
  const account = await ctx.db.query("agentAccount").withIndex("by_mint", q => q.eq("mintAddress", task.mintAddress)).unique();
  if (account) await ctx.db.patch(account._id, { generationReservedUsdc: Math.max(0, (account.generationReservedUsdc ?? 0) - task.walletHold.amountUsdc), updatedAt: Date.now() });
  await ctx.db.patch(task._id, { walletHold: { ...task.walletHold, settled: true } });
}

/** Record that this task's cost was already charged and paid on-chain before the render started. */
export const markPrepaid = mutation({
  args: { id: v.id("agentTasks"), usdc: v.number(), runId: v.string(), authSecret: v.string() },
  handler: async (ctx, { id, usdc, runId, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const task = await ctx.db.get(id);
    if (!task) throw new Error("task not found");
    await ctx.db.patch(id, { prepaid: { usdc, runId } });
    // The prepayment replaces the reservation, so the same money is not held twice.
    await releaseWalletHold(ctx, task);
  },
});

export const holdWallet = mutation({
  args: { id: v.id("agentTasks"), amountUsdc: v.number(), authSecret: v.string() },
  handler: async (ctx, { id, amountUsdc, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) throw new Error("invalid amount");
    const task = await ctx.db.get(id);
    if (!task || !["pending", "running"].includes(task.status)) throw new Error("task is not active");
    if (task.walletHold) return { ok: !task.walletHold.settled, available: 0 };
    const account = await ctx.db.query("agentAccount").withIndex("by_mint", q => q.eq("mintAddress", task.mintAddress)).unique();
    const withdrawal = await ctx.db.query("agentWithdrawals").withIndex("by_mint_status", q => q.eq("mintAddress", task.mintAddress).eq("status", "pending")).first();
    if (withdrawal) return { ok: false, available: 0, reason: "wallet_busy" };
    const cap = account?.dailyCapUsdc ?? Number(process.env.VELLO_DAILY_SPEND_CAP_USDC ?? "10");
    if (Number.isFinite(cap) && cap > 0 && await todaysSpend(ctx, task.mintAddress) + (account?.generationReservedUsdc ?? 0) + amountUsdc > cap) return { ok: false, available: 0, reason: "daily_cap" };
    const available = account ? spendableUsdc(account) : 0;
    if (!account || account.status === "suspended" || available < amountUsdc) return { ok: false, available };
    await ctx.db.patch(account._id, { generationReservedUsdc: +( (account.generationReservedUsdc ?? 0) + amountUsdc).toFixed(6), updatedAt: Date.now() });
    await ctx.db.patch(id, { walletHold: { amountUsdc, settled: false } });
    return { ok: true, available: available - amountUsdc };
  },
});

export const holdCredits = mutation({
  args: { id: v.id("agentTasks"), credits: v.number(), authSecret: v.string() },
  handler: async (ctx, { id, credits, authSecret }): Promise<{ ok: boolean; wallet?: string; balanceCredits: number }> => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const task = await ctx.db.get(id);
    if (!task) throw new Error("task not found");
    if (task.creditHold) return { ok: true, wallet: task.creditHold.wallet, balanceCredits: -1 }; // idempotent
    const amount = Math.max(1, Math.ceil(credits));
    // Same payer order as the charge path: the SIWS-proven login wallet
    // (the balance the header shows), then the agent's creator wallet.
    const candidates = [...new Set([payerFromInput(task), await getOwnerWalletForMint(ctx, task.mintAddress)].filter((w): w is string => !!w))];
    let best = 0;
    for (const wallet of candidates) {
      const res: { ok: boolean; balanceCredits: number } = await ctx.runMutation(internal.userCredits.debit, {
        ownerWallet: wallet, deltaCredits: amount, relatedMintAddress: task.mintAddress,
      });
      if (res.ok) {
        await ctx.db.patch(id, { creditHold: { wallet, credits: amount, settled: false } });
        return { ok: true, wallet, balanceCredits: res.balanceCredits };
      }
      best = Math.max(best, res.balanceCredits);
    }
    return { ok: false, balanceCredits: best };
  },
});

/** Complete a task with success — record output, cost, revenue. */
export const succeed = mutation({
  args: {
    id: v.id("agentTasks"),
    output: v.optional(v.string()),
    cost: v.optional(v.number()),
    revenue: v.optional(v.number()),
    authSecret: v.string(),
  },
  handler: async (ctx, { id, output, cost, revenue, authSecret }) => {
    // SECRET-GATED: finalizes a task as succeeded + debits metered cost onto the
    // agent's tab. Ungated, anyone could poison the economy. Server callers only.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const task = await ctx.db.get(id);
    if (!task || task.status === "succeeded" || task.status === "failed" || task.status === "cancelled") return;
    await releaseWalletHold(ctx, task);
    // The auto-post fee (social_post) is admin-overridable via skillPriceOverrides.
    // The run-task post executor emits the STATIC social_post fee on a real publish;
    // re-price it HERE — the Convex charge mutation is THE place the override is
    // applied for the post path — to the effective (override ?? default) fee. A
    // failed/partial post emits a small floor cost (< the full fee), which
    // effectivePostCostUsdc preserves untouched. Store the SAME effective value on
    // the task so the display ledger (walletLedger sums task.cost) matches the tab.
    let effectiveCost = cost;
    if (task && task.type === "post_content" && typeof cost === "number") {
      const override = await getSkillPriceOverride(ctx, "social_post");
      effectiveCost = effectivePostCostUsdc(cost, override);
    }
    await ctx.db.patch(id, {
      status: "succeeded",
      output,
      cost: effectiveCost,
      revenue,
      completedAt: Date.now(),
    });
    // Debit the metered cost onto the agent's realtime tab (one chokepoint for
    // every task path). idemKey `task:${id}` makes a duplicate succeed (double-
    // clicked approve-trade, cron re-fire) a no-op — accrueTaskCost always records,
    // so without it a re-fire would double-charge the agent. Settlement out-of-band.
    if (task?.creditHold && !task.creditHold.settled) {
      // Prepaid: keep the actual cost out of the hold, refund the rest, and only
      // bill any overage (actual > estimate) through the normal charge path.
      const actualCredits = Math.round((effectiveCost ?? 0) * 100);
      const covered = Math.min(actualCredits, task.creditHold.credits);
      await releaseHold(ctx, task, covered);
      if (covered > 0) {
        await ctx.db.insert("usageLedger", {
          mintAddress: task.mintAddress,
          service: `task:${task.type}`,
          qty: 1,
          unitPriceUsdc: covered / 100,
          costUsdc: covered / 100,
          paidWith: "credits" as const,
          settledBatchId: CREDITS_SETTLED_SENTINEL,
          idemKey: `task:${id}`,
          at: Date.now(),
        });
      }
      const overage = (actualCredits - covered) / 100;
      if (overage > 0) {
        await accrueTaskCost(ctx, { mintAddress: task.mintAddress, service: `task:${task.type}`, costUsdc: overage, idemKey: `task:${id}:overage`, payerWallet: payerFromInput(task), fundingSource: fundingFromInput(task) });
      }
    } else if (task && effectiveCost && effectiveCost > 0 && effectiveCost - (task.prepaid?.usdc ?? 0) > 1e-9) {
      // Pay-first renders were already charged (and paid on-chain) before they started: bill only what the render cost
      // beyond that. A task with no prepayment bills its full cost, exactly as before.
      const billable = +(effectiveCost - (task.prepaid?.usdc ?? 0)).toFixed(6);
      // payerWallet (server-injected by run-task from the SIWS-proven login
      // wallet) routes the credits-first debit at the wallet whose balance the
      // header shows — even when it differs from the agent's creatorWallet.
      let payerWallet: string | undefined;
      try {
        const inp = task.input ? (JSON.parse(task.input) as { payerWallet?: unknown }) : undefined;
        if (typeof inp?.payerWallet === "string" && inp.payerWallet.trim()) payerWallet = inp.payerWallet.trim();
      } catch { /* unparseable input — creatorWallet fallback applies */ }
      await accrueTaskCost(ctx, { mintAddress: task.mintAddress, service: `task:${task.type}`, costUsdc: billable, idemKey: `task:${id}`, payerWallet, fundingSource: fundingFromInput(task) });
    }
  },
});

/** Record the post outcome separately from render success. */
export const updatePostResult = mutation({
  args: {
    id: v.id("agentTasks"),
    status: v.union(v.literal("posted"), v.literal("failed")),
    postUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { id, status, postUrl, error, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const task = await ctx.db.get(id);
    if (!task || task.type !== "create_video" || task.status !== "succeeded") return;
    let output: Record<string, unknown> = {};
    try { output = JSON.parse(task.output ?? "{}"); } catch { /* preserve a usable result */ }
    output.post = { status, ...(postUrl ? { url: postUrl } : {}), ...(error ? { error } : {}) };
    await ctx.db.patch(id, { output: JSON.stringify(output) });
  },
});

/**
 * Overwrite a succeeded create_video task's stored videoUrl — used by the
 * Editor tab's Apply/Apply-to-all: burning captions/hooks/music via
 * /api/video/overlay-burn produces a NEW video url, but that burn only ever
 * touched local editor state, never the task row the Marketplace/profile
 * pages actually read (`output.videoUrl` via listGenerations/generationStatus).
 * This patches the SAME output JSON in place so the burned result becomes
 * what gets served, without disturbing topic/caption/other output fields.
 */
export const updateVideoUrl = mutation({
  args: { id: v.id("agentTasks"), videoUrl: v.string() },
  handler: async (ctx, { id, videoUrl }) => {
    const task = await ctx.db.get(id);
    if (!task || task.type !== "create_video") throw new Error("Not a video task");
    let output: Record<string, unknown> = {};
    try { output = task.output ? JSON.parse(task.output) : {}; } catch { output = {}; }
    output.videoUrl = videoUrl;
    await ctx.db.patch(id, { output: JSON.stringify(output) });
  },
});

/** Mark task as failed with error context. Failed tasks are NOT billed — only
 *  successful work draws down the agent wallet. The optional `cost` arg is kept
 *  for call-site compatibility but is recorded as 0 and never debited, so a run
 *  of failures can't death-spiral the balance into the negative. */
export const fail = mutation({
  args: {
    id: v.id("agentTasks"),
    errorMessage: v.string(),
    cost: v.optional(v.number()),
    authSecret: v.string(),
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handler: async (ctx, { id, errorMessage, cost: _ignoredCost, authSecret }) => {
    // SECRET-GATED: finalizes a task as failed in any agent's state. Server callers only.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    await ctx.db.patch(id, {
      status: "failed",
      errorMessage,
      cost: 0,
      completedAt: Date.now(),
    });
    // A failed task never keeps the credits it reserved.
    const task = await ctx.db.get(id);
    if (task) { await releaseHold(ctx, task, 0); await releaseWalletHold(ctx, task); }
    // A pay-first charge is voided when the render fails, so the agent is not billed for work it never got.
    if (task?.prepaid) await refundRunFeesTx(ctx, { mintAddress: task.mintAddress, jobId: task.prepaid.runId });
  },
});

/** Operator-initiated stop — mark a running/pending task cancelled so it stops
 *  showing "working" and the card frees up to be re-run.
 *  RESIDUAL (left public, ungated): called directly from the operator's own
 *  AgentWorkspace (browser useMutation), so it cannot carry INTERNAL_CRON_SECRET.
 *  No SIWS/ownership proof is available at the Convex layer (Convex has no native
 *  auth), and the only impact is stopping a task (the reaper/re-fire self-heals a
 *  griefed cancel), so this is left open by design rather than break the workspace. */
export const cancel = mutation({
  args: { id: v.id("agentTasks") },
  handler: async (ctx, { id }) => {
    const task = await ctx.db.get(id);
    if (!task) return;
    if (task.status === "succeeded" || task.status === "failed") return; // already finished
    await ctx.db.patch(id, {
      status: "cancelled",
      errorMessage: "Stopped by the operator.",
      completedAt: Date.now(),
    });
    await releaseHold(ctx, task, 0);
    await releaseWalletHold(ctx, task);
  },
});

/** List tasks for an agent — for dashboard. */
export const listByMint = query({
  args: { mintAddress: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { mintAddress, limit }) => {
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(limit ?? 50);
    return tasks;
  },
});

/** Map a clip job onto the Activity-feed row's {status, title}. Clip jobs have
 *  their own lifecycle (queued→…→completed|error) — collapse it to the feed's
 *  succeeded|running|failed and a human title (with the clip count when known). */
function clipJobActivity(job: { status: string; clipsTotal?: number; clipsReady?: number }): { status: string; title: string } {
  const total = job.clipsTotal ?? 0;
  const ready = job.clipsReady ?? 0;
  if (job.status === "completed") return { status: "succeeded", title: total ? `Clipped a video → ${ready}/${total} clip${total === 1 ? "" : "s"}` : "Clipped a video" };
  if (job.status === "error") return { status: "failed", title: "Clip job failed" };
  const phase =
    job.status === "downloading" ? "downloading source"
    : job.status === "transcribing" ? "transcribing"
    : job.status === "analyzing" ? "finding moments"
    : job.status === "clipping" ? (total ? `cutting clips (${ready}/${total})` : "cutting clips")
    : job.status === "posting" ? "posting clips"
    : "queued";
  return { status: "running", title: `Clipping — ${phase}` };
}

/**
 * Live feed of the most recent activity ACROSS ALL agents — powers the realtime
 * "Activity" panel on the marketplace. Reactive: new rows stream in as agents
 * work. Unions agentTasks (trader/worker/autonomy) with clipJobs (the AI clipper)
 * so a clipper's runs show with their status, then resolves agent name + avatar.
 */
export const listRecentAll = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = limit ?? 60;
    const cache = new Map<string, { name: string; avatarUrl?: string; handle?: string } | null>();
    const resolveAgent = async (mint: string) => {
      if (!cache.has(mint)) {
        const inf = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).first();
        cache.set(mint, inf ? { name: inf.name, avatarUrl: inf.avatarUrl, handle: inf.handle } : null);
      }
      return cache.get(mint);
    };

    const tasks = await ctx.db.query("agentTasks").order("desc").take(cap);
    const jobs = await ctx.db.query("clipJobs").order("desc").take(cap);
    const out = [];
    for (const t of tasks) {
      if (!t.mintAddress) continue;
      const agent = await resolveAgent(t.mintAddress);
      out.push({
        _id: t._id,
        mintAddress: t.mintAddress,
        type: t.type,
        title: t.title,
        status: t.status,
        triggeredBy: t.triggeredBy,
        cost: t.cost,
        revenue: t.revenue,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        _creationTime: t._creationTime,
        // Surfaced so the Activity feed can show WHY a task failed.
        errorMessage: t.status === "failed" ? (t.errorMessage ?? undefined) : undefined,
        agentName: agent?.name ?? "Agent",
        agentHandle: agent?.handle,
        agentAvatar: agent?.avatarUrl,
      });
    }
    for (const j of jobs) {
      if (!j.mintAddress) continue;
      const agent = await resolveAgent(j.mintAddress);
      const act = clipJobActivity(j);
      out.push({
        _id: j._id,
        mintAddress: j.mintAddress,
        type: "clip",
        title: act.title,
        status: act.status,
        triggeredBy: "clip",
        cost: undefined as number | undefined,
        revenue: undefined as number | undefined,
        startedAt: j.createdAt,
        completedAt: j.status === "completed" || j.status === "error" ? j.updatedAt : undefined,
        _creationTime: j._creationTime,
        errorMessage: j.status === "error" ? (j.error ?? undefined) : undefined,
        agentName: agent?.name ?? "Agent",
        agentHandle: agent?.handle,
        agentAvatar: agent?.avatarUrl,
      });
    }
    out.sort((a, b) => b._creationTime - a._creationTime);
    return out.slice(0, cap);
  },
});

/** Aggregate cost/revenue stats for an agent. */
export const statsForMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    return {
      total: tasks.length,
      succeeded: tasks.filter((t) => t.status === "succeeded").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      running: tasks.filter((t) => t.status === "running" || t.status === "pending").length,
      totalCost: tasks.reduce((s, t) => s + (t.cost ?? 0), 0),
      totalRevenue: tasks.reduce((s, t) => s + (t.revenue ?? 0), 0),
    };
  },
});

/**
 * Batch: total compute COST (USDC consumed) per agent, split lifetime vs last-30d.
 * Mirrors submissions.earningsByAgent so the marketplace can show a Cost column
 * next to Total Earnings. BOUNDED scan (never `collect()` the whole table).
 */
export const costByAgent = query({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, { lifetime: number; monthly: number }> = {};
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const SCAN = 8000;
    for (const t of await ctx.db.query("agentTasks").order("desc").take(SCAN)) {
      const cost = typeof t.cost === "number" && t.cost > 0 ? t.cost : 0;
      if (!cost || !t.mintAddress) continue;
      const e = out[t.mintAddress] ?? (out[t.mintAddress] = { lifetime: 0, monthly: 0 });
      e.lifetime += cost;
      const ts = t.completedAt ?? t._creationTime;
      if (ts >= since) e.monthly += cost;
    }
    for (const k of Object.keys(out)) {
      out[k].lifetime = Math.round(out[k].lifetime * 100) / 100;
      out[k].monthly = Math.round(out[k].monthly * 100) / 100;
    }
    return out;
  },
});

/**
 * Wallet ledger — splits agent spend into three buckets so the UI can show
 * a real-time wallet picture:
 *   - spent: finalized cost of every completed task (succeeded OR failed)
 *   - reserved: estimated cost of in-flight tasks (pending + running)
 *   - revenue: USDC earned across all tasks
 * The client subtracts (spent + reserved) from the on-chain balance to get
 * the available USDC the agent can still spend.
 */
export const walletLedger = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    let spent = 0;
    let reserved = 0;
    let revenue = 0;
    let succeededCount = 0;
    let inFlightCount = 0;
    for (const t of tasks) {
      const cost = t.cost ?? 0;
      const rev = t.revenue ?? 0;
      revenue += rev;
      if (t.status === "pending" || t.status === "running" || t.status === "awaiting_approval") {
        // Estimate the reserved amount — most tasks have no cost set yet while
        // running, so we use a baseline by task type. create_video reserves
        // a small fallback only; the authoritative create-video reservation is
        // stored in creditHold by run-task from the selected model and duration.
        const ESTIMATED_BY_TYPE: Record<string, number> = {
          create_video:    0.20, // storyboard + small video estimate
          post_content:    0.05, // = SERVICE_PRICES.social_post (charged on success)
          analyze_trend:   0.012,
          research:        0.01,
          check_wallet:    0.001,
          find_jobs:       0.002,
          campaign_submit: 0.001,
          engage_comment:  0.006,
          self_reflect:    0.01,
        };
        const estimate = t.walletHold && !t.walletHold.settled ? t.walletHold.amountUsdc : cost > 0 ? cost : (ESTIMATED_BY_TYPE[t.type] ?? 0.01);
        reserved += estimate;
        inFlightCount++;
      } else if (t.status === "succeeded") {
        // ONLY successful work is billed to the wallet. Failed/cancelled tasks are
        // not charged — otherwise repeated failures death-spiral the balance into
        // the negative and block every future task ("out of money").
        spent += cost;
        succeededCount++;
      }
      // failed / cancelled → no spend accrued.
    }
    return {
      spent: Math.round(spent * 10000) / 10000,
      reserved: Math.round(reserved * 10000) / 10000,
      revenue: Math.round(revenue * 10000) / 10000,
      net: Math.round((revenue - spent) * 10000) / 10000,
      succeededCount,
      inFlightCount,
      totalTasks: tasks.length,
    };
  },
});

/** Episodic memory write — agent learns from a completed task. */
// Routine, low-value task outcomes (a healthy wallet check, an empty campaign
// scan, boilerplate "task X completed") must NOT become episodic memory — they
// bloat storage and, because recall + the graph are top-K by importance, they
// dilute the agent's genuinely useful lessons. Only memories at or above this bar
// are kept. buildMemory scores routine outcomes 35–45 and meaningful ones 55+, so
// 50 is the natural cut.
const MEMORY_IMPORTANCE_FLOOR = 50;

/** Normalise a memory into a dedup key: kind + summary with digits and runs of
 *  punctuation flattened, so near-identical memories saved every cycle
 *  ("Wallet: $5 USDC, healthy" vs "…$6…") collapse to ONE key and the duplicate is
 *  dropped. */
export function memoryDedupKey(kind: string, summary: string): string {
  const norm = summary.toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${kind.toLowerCase()}|${norm}`;
}

export const recordMemory = mutation({
  args: {
    mintAddress: v.optional(v.string()),  // optional — pre-mint agents
    sessionId: v.optional(v.string()),    // per-project id (kept so pre-mint memory is scoped, not pooled under "")
    kind: v.string(),
    summary: v.string(),
    context: v.optional(v.string()),
    importance: v.number(),
    sourceTaskId: v.optional(v.id("agentTasks")),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // SECRET-GATED: writes episodic memory into any agent's brain. Server callers only.
    const { authSecret, ...rest } = args;
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");

    // GATE 1 — importance floor: routine/low-value outcomes never become memory.
    if ((rest.importance ?? 0) < MEMORY_IMPORTANCE_FLOOR) {
      return { skipped: "low-importance" as const };
    }

    const mint = rest.mintAddress ?? "";
    const sess = rest.sessionId?.trim() || undefined;

    // GATE 2 — near-duplicate dedup: skip if a normalised (kind + summary) match
    // already exists among this agent's recent memories (e.g. the same lesson
    // re-derived every autonomy cycle). Mirrors agentKnowledge's localId dedup,
    // which agentMemory previously lacked entirely.
    const key = memoryDedupKey(rest.kind, rest.summary);
    const recent = mint
      ? await ctx.db.query("agentMemory").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).order("desc").take(80)
      : sess
        ? await ctx.db.query("agentMemory").withIndex("by_session_importance", (q) => q.eq("sessionId", sess)).order("desc").take(80)
        : [];
    if (recent.some((m) => memoryDedupKey(m.kind, m.summary) === key)) {
      return { skipped: "duplicate" as const };
    }

    return await ctx.db.insert("agentMemory", {
      ...rest,
      mintAddress: mint,
      // Stash the session so the memory stays attached to THIS project even before
      // the agent is minted (the graph + pre-mint recall read by session).
      sessionId: sess,
    });
  },
});

/** List only succeeded tasks with output that are generation types — for the Generations tab. */
export const listGenerations = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .collect();
    const GENERATION_TYPES = [
      "create_video",
      "post_content",
      "analyze_trend",
      "research",
      "check_wallet",
      "find_jobs",
      "campaign_submit",
    ];
    return tasks
      .filter(
        (t) =>
          t.status === "succeeded" &&
          t.output &&
          GENERATION_TYPES.includes(t.type)
      )
      .slice(0, 100);
  },
});

/** Content Swarm history for one user account. Swarm launches stamp every task
 *  with sessionId `swarm:<privy user id>`, so this lists ALL of a user's swarm
 *  videos (running + finished) across devices. Scoped to swarm sessions only —
 *  a builder sessionId can't be read through this. */
export const listSwarmBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    if (!sessionId.startsWith("swarm:")) return [];
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(300);
    const videoTasks = tasks.filter((t) => t.type === "create_video");

    // Join the agent's profile (avatar/name/connected platforms) so the library
    // card + fullscreen modal can show who posted it and where, without a
    // separate per-card lookup on the client.
    const mints = [...new Set(videoTasks.map((t) => t.mintAddress))];
    const agentByMint = new Map(
      (await Promise.all(mints.map((m) => ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", m)).first())))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => [a.mintAddress, a] as const),
    );

    return videoTasks.map((t) => {
      let videoUrl: string | undefined;
      let posterUrl: string | undefined;
      if (t.output) {
        try {
          const o = JSON.parse(t.output) as Record<string, unknown>;
          if (typeof o.videoUrl === "string") videoUrl = o.videoUrl;
          if (typeof o.storyboardImageUrl === "string") posterUrl = o.storyboardImageUrl;
        } catch { /* ignore */ }
      }
      const agent = agentByMint.get(t.mintAddress);
      return {
        _id: t._id,
        _creationTime: t._creationTime,
        title: t.title,
        status: t.status,
        mintAddress: t.mintAddress,
        videoUrl,
        posterUrl,
        error: t.errorMessage,
        agentName: agent?.name,
        agentHandle: agent?.handle,
        agentAvatarUrl: agent?.avatarUrl,
        connectedPlatforms: agent?.connectedPlatforms ?? [],
      };
    });
  },
});

/**
 * Lightweight status of one or more tasks by id — used by the /generations page
 * to poll the real video render started from the hire flow. Returns just what a
 * generation card needs: status, the parsed videoUrl/poster, and any error.
 *
 * SECURITY — FLAGGED FOR HUMAN (audit target #4): this is an UNAUTHENTICATED
 * public query that leaks ANY task's videoUrl / posterUrl / errorMessage to any
 * caller who can guess or enumerate an agentTasks _id. It is called directly from
 * the BROWSER via useQuery (app/generations/page.tsx → useRenderReconciler), so
 * it CANNOT simply be INTERNAL_CRON_SECRET-gated without breaking the client.
 * The correct fix is to add an owner gate by routing it through a SIWS-gated Next
 * endpoint (load each task → resolve its agent via influencers.getByMintServer →
 * requireOwnerWithSiws on the proven wallet) and have the page poll that endpoint
 * instead of subscribing to this query, OR scope the query to a caller-owned set.
 * Left intact here to avoid breaking the live polling UX. DO NOT gate in place.
 */
export const generationStatus = query({
  args: { ids: v.array(v.id("agentTasks")) },
  handler: async (ctx, { ids }) => {
    const out: Record<string, {
      status: string;
      videoUrl?: string;
      posterUrl?: string;
      /** Pipeline's non-fatal note (e.g. "Rendered 1/3 clips — shorter than 24s")
       *  — surfaced so the UI can explain a video that came out shorter/different
       *  than the estimate instead of leaving the operator guessing. */
      note?: string;
      error?: string;
      /** The render has been paid for (the agent wallet paid on-chain, or credits were held) and is under way. */
      paid?: boolean;
      _creationTime: number;
    }> = {};
    for (const id of ids) {
      const t = await ctx.db.get(id);
      if (!t) continue;
      let videoUrl: string | undefined;
      let posterUrl: string | undefined;
      let note: string | undefined;
      if (t.output) {
        try {
          const o = JSON.parse(t.output) as Record<string, unknown>;
          if (typeof o.videoUrl === "string") videoUrl = o.videoUrl;
          if (typeof o.storyboardImageUrl === "string") posterUrl = o.storyboardImageUrl;
          if (typeof o.videoNote === "string" && o.videoNote.trim()) note = o.videoNote.trim();
        } catch { /* ignore */ }
      }
      out[id] = { status: t.status, videoUrl, posterUrl, note, error: t.errorMessage, paid: !!t.prepaid || !!t.creditHold || t.status === "succeeded", _creationTime: t._creationTime };
    }
    return out;
  },
});

/** Retrieve top-K most important memories for an agent. */
export const recallMemories = query({
  // mintAddress OR sessionId — a real mint wins (post-mint); otherwise the builder
  // session (pre-mint project). An empty identity returns NOTHING instead of the
  // shared "" bucket that leaked other projects' memories into the graph.
  args: { mintAddress: v.optional(v.string()), sessionId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { mintAddress, sessionId, limit }) => {
    const scope = resolveMemoryScope(mintAddress, sessionId);
    const take = limit ?? 20;
    if (scope.by === "mint") {
      return await ctx.db
        .query("agentMemory")
        .withIndex("by_mint_importance", (q) => q.eq("mintAddress", scope.value))
        .order("desc")
        .take(take);
    }
    if (scope.by === "session") {
      return await ctx.db
        .query("agentMemory")
        .withIndex("by_session_importance", (q) => q.eq("sessionId", scope.value))
        .order("desc")
        .take(take);
    }
    // No identity → no memory (never the shared "" bucket).
    return [];
  },
});

/** Wipe every episodic memory for one agent — the Brain graph's "Delete All". */
export const deleteAllMemories = mutation({
  args: { mintAddress: v.optional(v.string()), sessionId: v.optional(v.string()) },
  handler: async (ctx, { mintAddress, sessionId }) => {
    const scope = resolveMemoryScope(mintAddress, sessionId);
    if (scope.by === "none") return { deleted: 0 };
    const rows = scope.by === "mint"
      ? await ctx.db.query("agentMemory").withIndex("by_mint_importance", (q) => q.eq("mintAddress", scope.value)).collect()
      : await ctx.db.query("agentMemory").withIndex("by_session_importance", (q) => q.eq("sessionId", scope.value)).collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
});


/** Hard-delete one generation (agentTasks row) from the Generations tab and
 *  cancel every non-terminal drip/schedule row that would still post it —
 *  joined by taskId AND by the rendered videoUrl (drip rows created from a
 *  finished render carry only the url). Posted/failed rows are kept as history.
 *  SECRET-GATED: reached through /api/generations/delete, which authenticates
 *  the operator and ownership-scopes the mint. */
export const deleteGeneration = mutation({
  args: { id: v.id("agentTasks"), mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { id, mintAddress, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const task = await ctx.db.get(id);
    if (!task) return { ok: true, cancelled: 0 }; // idempotent
    if (task.mintAddress !== mintAddress) throw new Error("forbidden");
    let videoUrl: string | undefined;
    try {
      const out = task.output ? JSON.parse(task.output) : {};
      if (typeof out.videoUrl === "string") videoUrl = out.videoUrl;
    } catch { /* unparseable output — join by taskId only */ }
    const rows = await ctx.db.query("scheduledContent").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    let cancelled = 0;
    for (const r of rows) {
      const linked = r.taskId === id || (!!videoUrl && r.videoUrl === videoUrl);
      if (linked && (r.status === "scheduled" || r.status === "posting")) {
        await ctx.db.patch(r._id, { status: "cancelled" });
        cancelled++;
      }
    }
    await ctx.db.delete(id);
    return { ok: true, cancelled };
  },
});
