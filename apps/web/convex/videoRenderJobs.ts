import { enqueueVideoAnnouncement } from "./contentControl";
import { autoScheduleVideoToX } from "./scheduledContent";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Durable state for the chunked, Vercel-safe video render. See
// docs/superpowers/specs/2026-06-03-vercel-safe-agentic-video-render-design.md.

const autoPostValidator = v.object({
  platforms: v.array(v.string()),
  campaignId: v.optional(v.string()),
  submissionId: v.optional(v.string()),
  contentRewardId: v.optional(v.string()),
  ownerWallet: v.optional(v.string()),
  caption: v.optional(v.string()),
});

/** Create the render job at kickoff (run-task create_video). Phase starts at "storyboard". */
export const create = mutation({
  args: {
    taskId: v.id("agentTasks"),
    mintAddress: v.string(),
    sessionId: v.string(),
    driveToken: v.string(),
    kieModel: v.string(),
    renderArgs: v.string(),
    autoPost: v.optional(autoPostValidator),
    /** Idempotency key (e.g. a hire payment tx signature) — see schema. */
    renderKey: v.optional(v.string()),
    /** Catalog format id (lib/builder/formatCatalog.ts) this render was
     *  templated from — carried alongside renderArgs so the feed/feedback loop
     *  don't have to parse the renderArgs JSON to find it. */
    formatId: v.optional(v.string()),
    /** Explore cameo: the influencer shown in the video when the viewer (not the influencer's owner) paid. */
    cameoMint: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // SECRET-GATED: the sole caller is lib/server/kickoffVideoRender.ts (server).
    // Ungated, anyone could seed a render job (with an autoPost target) against any agent.
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    return await ctx.db.insert("videoRenderJobs", {
      taskId: args.taskId,
      mintAddress: args.mintAddress,
      sessionId: args.sessionId,
      driveToken: args.driveToken,
      kieModel: args.kieModel,
      phase: "storyboard",
      statusMessage: "Queued — writing the storyboard…",
      renderArgs: args.renderArgs,
      autoPost: args.autoPost,
      ...(args.renderKey ? { renderKey: args.renderKey } : {}),
      ...(args.formatId ? { formatId: args.formatId } : {}),
      ...(args.cameoMint ? { cameoMint: args.cameoMint } : {}),
      attempts: 0,
      updatedAt: Date.now(),
    });
  },
});

/** A render that hasn't advanced a phase in this long is treated as wedged, so it
 *  no longer blocks a retry of the same payment. A healthy render-step chain
 *  patches `updatedAt` every phase (well under a minute apart) and finishes in a
 *  few minutes, so 30m is comfortably past any live render. */
const RENDER_STALE_MS = 30 * 60 * 1000;

/** Lookup an existing render job by its idempotency key. Used by run-task to
 *  short-circuit a duplicate render dispatch (e.g. the hire modal's 3× retry) so
 *  the same payment never spends Kie tokens twice. Returns the LATEST job's
 *  taskId + phase + `stale` (whether it has wedged past the TTL), or null.
 *  run-task dedups only a live, non-failed, non-stale render. */
export const getByRenderKey = query({
  args: { renderKey: v.string(), authSecret: v.string() },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    if (!args.renderKey) return null;
    // Latest job for this key — a failed (or wedged) job may be retried, so we
    // judge the most recent one, not the oldest.
    const job = await ctx.db
      .query("videoRenderJobs")
      .withIndex("by_render_key", (q) => q.eq("renderKey", args.renderKey))
      .order("desc")
      .first();
    if (!job) return null;
    return {
      jobId: job._id,
      taskId: job.taskId,
      phase: job.phase,
      stale: Date.now() - job.updatedAt > RENDER_STALE_MS,
    };
  },
});

/** Patch render progress between phase invocations. */
export const patch = mutation({
  args: {
    id: v.id("videoRenderJobs"),
    phase: v.optional(v.string()),
    statusMessage: v.optional(v.string()),
    storyboardImageUrl: v.optional(v.string()),
    storyboardPrompt: v.optional(v.string()),
    beats: v.optional(v.string()),
    segmentPrompts: v.optional(v.string()),
    standalonePrompts: v.optional(v.string()),
    refImages: v.optional(v.string()),
    totalSegments: v.optional(v.number()),
    clipIndex: v.optional(v.number()),
    veoTaskId: v.optional(v.string()),
    veoSeed: v.optional(v.number()),
    stitchMode: v.optional(v.boolean()),
    stitchClips: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    seedanceState: v.optional(v.string()),
    rawVideoUrl: v.optional(v.string()),
    videoNote: v.optional(v.string()),
    attempts: v.optional(v.number()),
    error: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { id, authSecret, ...rest }) => {
    // SECRET-GATED: the sole caller is the /api/video/render-step server route.
    // Ungated, anyone could inject content (videoUrl/phase/etc.) into a render job
    // that then auto-posts. `authSecret` is destructured out so it never lands in the row.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    const before = await ctx.db.get(id);
    await ctx.db.patch(id, patch);
    // The render just finished: announce the new video (a coin's influencer only; best-effort, never blocks the render).
    if (before && rest.phase === "done" && before.phase !== "done") {
      const videoUrl = rest.videoUrl ?? before.videoUrl;
      if (videoUrl) {
        await enqueueVideoAnnouncement(ctx, { _id: id, mintAddress: before.mintAddress, videoUrl, videoNote: rest.videoNote ?? before.videoNote }).catch(() => undefined);
        // The agent's own X account: queue it into the automatic 3-a-day schedule (skipped when it posts itself).
        await autoScheduleVideoToX(ctx, { mintAddress: before.mintAddress, videoUrl, videoNote: rest.videoNote ?? before.videoNote, taskId: before.taskId, autoPost: before.autoPost }).catch(() => undefined);
      }
    }
  },
});

// A crashed/killed invocation must never wedge the job forever — the lease
// self-expires after this long, comfortably past render-step's own 300s
// function budget (see VIDEO_BUDGET_MS / maxDuration in route.ts).
const CLAIM_LEASE_MS = 280_000;

/**
 * Atomically claim the right to do real work on this job's CURRENT phase.
 * render-step calls this FIRST, before any Kie/storage work — refusing a
 * second concurrent invocation is what stops "one Generate click → 3 videos":
 * without this, two overlapping calls for the same job (a retried/duplicated
 * fire, a slow response the caller gave up on, etc.) would both render and
 * both post the SAME step. Returns { claimed: false } for the loser, which
 * render-step turns into an immediate no-op instead of duplicate work.
 */
export const claimStep = mutation({
  args: { id: v.id("videoRenderJobs"), authSecret: v.string() },
  handler: async (ctx, { id, authSecret }): Promise<{ claimed: boolean; phase?: string }> => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const job = await ctx.db.get(id);
    if (!job) return { claimed: false };
    const now = Date.now();
    if (job.processingStartedAt && now - job.processingStartedAt < CLAIM_LEASE_MS) {
      return { claimed: false, phase: job.phase };
    }
    await ctx.db.patch(id, { processingStartedAt: now });
    return { claimed: true, phase: job.phase };
  },
});

/** Release the lease once a step's work (success OR failure) has been
 *  recorded, so the NEXT phase's claim doesn't have to wait out the lease. */
export const releaseStep = mutation({
  args: { id: v.id("videoRenderJobs"), authSecret: v.string() },
  handler: async (ctx, { id, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    await ctx.db.patch(id, { processingStartedAt: undefined });
  },
});

/** Read a render job by id — used by the render-step route. */
export const get = query({
  args: { id: v.id("videoRenderJobs") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

/**
 * Latest render job for a task — reactive, drives the card's viewing place.
 * The card already has the task id from its mirrored agentTask.
 */
export const getByTask = query({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, { taskId }) => {
    return await ctx.db
      .query("videoRenderJobs")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("desc")
      .first();
  },
});
