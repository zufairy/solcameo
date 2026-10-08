import { v } from "convex/values";
import { mutation, query, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { CLIP_SKILL_PRICE_USDC, CLIP_SOURCE_MINUTE_ID, clipSkillRunCostWithOverrides, SERVICE_PRICES } from "../lib/economy/servicePrices";
import { effectiveSpendableUsdc } from "../lib/economy/nav";
import { refundRunFeesTx } from "./usage";
import type { ClipMoment } from "../lib/server/clipTypes";
import { resolveWiredTrendingAudio } from "../lib/server/trendingAudioPack";
import { decideSkillChargeGate } from "../lib/server/clipChargeGate";
import { explainClipFailureLine } from "../lib/clip/failure";
import { isYoutubeCollection } from "../lib/clip/youtubeUrl";
import { makeFunctionReference } from "convex/server";
import { appFetch, appOrigins } from "./lib/appFetch";
import { boundCutWindow } from "../lib/clip/cutWindow";
import { prepareClipSource } from "../lib/clip/sourceMedia";
import { enqueueVideoMilestone } from "./contentControl";
import { bumpLiveViews } from "./platformStats";

// Refund the run's compute-tab fees on a 0-clip failure (convex/usage.ts). String
// ref so this file typechecks before `npx convex deploy` regenerates the api types
// for the `usage:refundRunFees` mutation (the makeFunctionReference-before-deploy
// pattern used across this file).
const USAGE_REFUND_RUN_FEES = makeFunctionReference<"mutation">("usage:refundRunFees");

/** A clip run delivered value iff at least one clip RENDERED (produced a clipUrl) or
 *  reached ready/posted. The refund-on-failure predicate: a terminally-failed run
 *  gets its compute-tab fees voided ONLY when NO clip succeeded (full failure). If any
 *  clip succeeded the charge is KEPT (partial value was delivered). Pure + exported so
 *  the same rule is shared by the action path (refundRunFeesIfNoClips) and the reaper,
 *  and is unit-testable. */
export function runHasSuccessfulClip(clips: ReadonlyArray<{ clipUrl?: string; status: string }>): boolean {
  return clips.some((c) => !!c.clipUrl || c.status === "ready" || c.status === "posted");
}

/** Void a terminally-failed clip run's per-skill compute-tab fees when it delivered
 *  ZERO successful clips (see runHasSuccessfulClip). The up-front funding GATE still
 *  charged (a broke/capped agent can't START a run), but a run that produces nothing
 *  must not keep the money. Idempotent + best-effort — safe to call from more than one
 *  terminal path (an early `process` failure, finalizeJob's all-failed branch, the
 *  reaper) because usage.refundRunFees no-ops once the rows are voided, and a refund
 *  error must never break the terminal-failure path it rides on. */
async function refundRunFeesIfNoClips(
  ctx: ActionCtx,
  jobId: Id<"clipJobs">,
  mintAddress: string,
  authSecret: string,
): Promise<void> {
  try {
    const clips: Doc<"clips">[] = await ctx.runQuery(api.clipJobs.getClipsForJob, { jobId });
    if (runHasSuccessfulClip(clips)) return; // partial value delivered — keep the charge
    await ctx.runMutation(USAGE_REFUND_RUN_FEES, { mintAddress, jobId, authSecret });
  } catch (e) {
    console.warn(`[clipJobs] refund-on-failure skipped for ${jobId}: ${e instanceof Error ? e.message : e}`);
  }
}

export const enqueue = mutation({
  args: {
    mintAddress: v.string(),
    sessionId: v.optional(v.string()),
    sourceUrl: v.string(),
    sourceType: v.string(),
    campaignId: v.optional(v.string()),
    contentRewardId: v.optional(v.string()),
    ownerWallet: v.optional(v.string()),
    // Master Videos "clip all" grouping — the N jobs from one folder/channel fan-out
    // share this so the UI can group them (flows straight into the inserted row below).
    batchId: v.optional(v.string()),
    // CROSS-VIDEO FILL pool — the sibling member videos of this job's collection (set
    // only on a multi-video fan-out). Flows into the inserted row; `process` uses it to
    // fill a short source. Absent → single-video default path unchanged.
    poolSourceUrls: v.optional(v.array(v.string())),
    holdForApproval: v.optional(v.boolean()),
    kieApiKey: v.optional(v.string()),
    appUrl: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // globalThis.process: this module exports an action named `process`, which
    // shadows Node's global `process` at module scope — reach the real env via globalThis.
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || args.authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    // Dedup: if an active (non-terminal) job for the SAME mint+sourceUrl already exists,
    // return it. Different source URLs for the same mint may run in parallel.
    const active = await ctx.db
      .query("clipJobs")
      .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress))
      .filter((q) =>
        q.and(
          q.eq(q.field("sourceUrl"), args.sourceUrl),
          q.neq(q.field("status"), "completed"),
          q.neq(q.field("status"), "error")
        )
      )
      .first();
    if (active) {
      // Dedup hit: the FIRST job's provenance wins, but a later enqueue may carry
      // campaign/reward provenance the first lacked (e.g. a campaign-sourced run
      // after a bare one). Backfill any missing non-null provenance so the cache
      // opt-in + reward auto-submit aren't lost.
      const patch: Record<string, unknown> = {};
      if (!active.campaignId && args.campaignId) patch.campaignId = args.campaignId;
      if (!active.contentRewardId && args.contentRewardId) patch.contentRewardId = args.contentRewardId;
      if (!active.ownerWallet && args.ownerWallet) patch.ownerWallet = args.ownerWallet;
      if (Object.keys(patch).length) await ctx.db.patch(active._id, { ...patch, updatedAt: Date.now() });
      return active._id;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip non-column args (auth + action-only) from the inserted row
    const { kieApiKey, appUrl, authSecret: _authSecret, ...row } = args;
    const now = Date.now();
    const jobId = await ctx.db.insert("clipJobs", { ...row, status: "queued", createdAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.clipJobs.process, { jobId, kieApiKey, appUrl });
    return jobId;
  },
});

export const setStatus = mutation({
  args: { jobId: v.id("clipJobs"), status: v.optional(v.string()), error: v.optional(v.string()),
          durationSeconds: v.optional(v.number()), transcript: v.optional(v.string()),
          clipsTotal: v.optional(v.number()), clipsReady: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { jobId, authSecret, ...patch }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    await ctx.db.patch(jobId, { ...patch, updatedAt: Date.now() });
  },
});

// Append one timestamped line to the job's live run log + denormalize the latest
// note/pct for cheap UI reflection. CRITICAL: it ALWAYS bumps `updatedAt`, so a
// long-running step that calls this each tick keeps the row "fresh" — the reaper
// (reapStaleJobs) no longer mistakes a live job for a dead one, and the user sees
// real progress instead of a frozen `status`. The log is bounded to the last 80
// entries so the doc stays ~10KB (well under Convex's 1MB limit).
export const appendLog = mutation({
  args: { jobId: v.id("clipJobs"), phase: v.string(), note: v.string(),
          pct: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { jobId, phase, note, pct, authSecret }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const job = await ctx.db.get(jobId);
    if (!job) return;
    const entry = { ts: Date.now(), phase, note, ...(pct != null ? { pct } : {}) };
    const log = [...(job.log ?? []), entry].slice(-80);
    await ctx.db.patch(jobId, {
      log,
      progressNote: note,
      ...(pct != null ? { progressPct: pct } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const insertClip = mutation({
  args: { jobId: v.id("clipJobs"), mintAddress: v.string(), title: v.string(), reason: v.string(),
          startSeconds: v.number(), endSeconds: v.number(), viralScore: v.number(), captionText: v.string(),
          // Variation provenance (per-moment variations that reach a high clip count):
          // which variation of its source moment this clip is + a display label
          // ("Moment 3 · v2"). Omitted for pristine, one-per-moment cuts.
          variationIndex: v.optional(v.number()), variationLabel: v.optional(v.string()),
          authSecret: v.string() },
  handler: async (ctx, { authSecret, ...args }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const now = Date.now();
    return await ctx.db.insert("clips", { ...args, status: "rendering", createdAt: now, updatedAt: now });
  },
});

export const setClip = mutation({
  args: { clipId: v.id("clips"), status: v.optional(v.string()), clipUrl: v.optional(v.string()),
          postUrl: v.optional(v.string()), platform: v.optional(v.string()), submissionId: v.optional(v.string()),
          captionText: v.optional(v.string()), uploadPostRequestId: v.optional(v.string()),
          platformPostId: v.optional(v.string()), failReason: v.optional(v.string()),
          // A UGC run has no cut window to derive length from — the renderer probes
          // the uploaded file and reports it here, so the queue shows a real duration
          // instead of "0s".
          endSeconds: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { clipId, authSecret, ...patch }) => {
    // globalThis.process: this module exports an action named `process`, which
    // shadows Node's global `process` at module scope — reach the real env via globalThis.
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    await ctx.db.patch(clipId, { ...patch, updatedAt: Date.now() });
  },
});

/**
 * Persist a finished CANVAS (local "demo run") batch to the relational tables.
 * The canvas already rendered the clips client-side and the mp4 BYTES live in
 * Convex file storage (clipUrl is a storage URL); only the `clips` ROWS are
 * missing — without them clips can't show in the builder ClipsQueue, can't sync
 * across devices, and (via Feature 2) can't surface on the public Creations tab.
 *
 * A `clips` row REQUIRES jobId: v.id("clipJobs"), so this first inserts ONE
 * synthetic clipJob (existing columns only — no new schema field) marked
 * "completed" so no scheduler/process() ever re-picks it up, then one `clips`
 * row per finished clip with status:"ready" + clipUrl. All inserts are atomic
 * (single mutation). Secret-gated like insertClip/setClip; the ownership check
 * lives in the calling route (/api/clips/record).
 *
 * globalThis.process: this module exports an action named `process`, which
 * shadows Node's global `process` at module scope — reach the real env via
 * globalThis (matches insertClip/setClip).
 */
export const recordCanvasClips = mutation({
  args: {
    mintAddress: v.string(),
    sourceUrl: v.string(),
    clips: v.array(
      v.object({
        title: v.string(),
        reason: v.string(),
        clipUrl: v.string(),
        viralScore: v.number(),
        captionText: v.string(),
        startSeconds: v.number(),
        endSeconds: v.number(),
      }),
    ),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, sourceUrl, clips, authSecret }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const now = Date.now();
    // IDEMPOTENT: skip clips whose clipUrl already exists for this agent. The
    // client-side localStorage `syncedToDb` flag is the only other guard and is
    // racy (two backfill passes / tabs / a re-run double-insert the same rendered
    // clip → duplicate feed rows). Dedup server-side against the existing clips.
    const existingClips = await ctx.db
      .query("clips")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    const seenUrls = new Set(existingClips.map((c) => c.clipUrl).filter(Boolean));
    const fresh = clips.filter((c) => c.clipUrl && !seenUrls.has(c.clipUrl));
    if (fresh.length === 0) return { jobId: null, clipIds: [] };
    // sourceType "canvas" marks provenance reusing the existing free-form
    // v.string() column (no new field). status "completed" is a terminal value
    // process() already writes, so the synthetic job is never re-scheduled.
    const jobId = await ctx.db.insert("clipJobs", {
      mintAddress,
      sourceUrl: sourceUrl || "canvas",
      sourceType: "canvas",
      status: "completed",
      clipsTotal: fresh.length,
      clipsReady: fresh.length,
      createdAt: now,
      updatedAt: now,
    });
    const clipIds: Id<"clips">[] = [];
    for (const c of fresh) {
      const id = await ctx.db.insert("clips", {
        jobId,
        mintAddress,
        title: c.title || "Clip",
        reason: c.reason || "",
        startSeconds: c.startSeconds,
        endSeconds: c.endSeconds,
        viralScore: c.viralScore,
        clipUrl: c.clipUrl,
        captionText: c.captionText || "",
        status: "ready",
        createdAt: now,
        updatedAt: now,
      });
      clipIds.push(id);
    }
    return { jobId, clipIds };
  },
});

/**
 * Mark a clip posted/posting/failed by (mint, clipUrl) — secret-gated.
 *
 * The drip queue (scheduledContent) has NO clipId column, so the ONLY link
 * between a scheduledContent row and its originating clips row is
 * `clips.clipUrl === scheduledContent.videoUrl` (the no-schema-field join). On a
 * successful drip post drainDueClips calls this to flip the clip's badge to
 * "posted" + the live permalink. The match is EXACT string equality: the
 * canvas auto-scheduler schedules videoUrl = the SAME storage URL recordCanvasClips
 * wrote as clips.clipUrl, so they line up. run-task re-hosts the media for the
 * actual post but leaves both URLs untouched, so the join still holds.
 *
 * NON-fatal on miss: a drip row whose clip was never persisted (e.g. a
 * draft-session run with no mint clips) returns {ok:false} rather than throwing —
 * the post itself must not fail just because there's no clip row to patch.
 *
 * Idempotent / monotonic: a clip already status:"posted" is only re-patched when
 * a better postUrl arrives (a cron retry can upgrade a pending link) — it never
 * regresses a posted clip back to posting/failed.
 *
 * globalThis.process: this module exports an action named `process`, which
 * shadows Node's global `process` at module scope — reach env via globalThis
 * (matches setClip/recordCanvasClips).
 */
export const markClipPostedByUrl = mutation({
  args: {
    mintAddress: v.string(),
    clipUrl: v.string(),
    postUrl: v.optional(v.string()),
    platform: v.optional(v.string()),
    status: v.optional(v.string()),
    // Why the clip is in this status when it's NOT a clean "posted" — currently
    // used for status:"guardrail_rejected" (see lib/server/guardrails.ts), so the
    // operator sees WHICH check blocked it instead of a bare "not posted".
    failReason: v.optional(v.string()),
    // Durable upload-post analytics handles. BUG FIX: /api/social/post has
    // always TRIED to pass these (they're on the clips schema), but this
    // validator never declared them — Convex rejects unknown args on the WHOLE
    // call, so every post whose response carried an id silently dropped this
    // patch entirely (postUrl included), which is why posted clips showed no
    // link and 0 views. Now actually persisted.
    uploadPostRequestId: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
    // The exact copy sent to the social platform. Persist it on the clip so the
    // public wall shows the published caption, not the analyzer's transcript
    // snippet/title that existed before posting.
    captionText: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, clipUrl, postUrl, platform, status, failReason, uploadPostRequestId, platformPostId, captionText, authSecret }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const rows = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    // EXACT clipUrl equality is the load-bearing join contract — see the doc above.
    const row = rows.find((r) => r.clipUrl === clipUrl);
    if (!row) return { ok: false, reason: "clip not found" };
    // Campaign provenance from the clip's job — lets the manual "Post now"
    // (/api/social/post) auto-submit a posted campaign clip to its Submissions
    // page, parity with the cloud auto-post. (campaignId XOR contentRewardId.)
    const job = await ctx.db.get(row.jobId);
    const provenance = {
      campaignId: job?.campaignId ?? null,
      contentRewardId: job?.contentRewardId ?? null,
      ownerWallet: job?.ownerWallet ?? null,
      // The clip's own row id — lets the drip/manual post paths call
      // submissions.submitClipToCampaign (which links clips.submissionId) without
      // re-querying the clip by URL. `row` is guaranteed defined here (early
      // return above on !row), so this is always a real Id<"clips">.
      clipId: row._id,
    };
    const nextStatus = status ?? "posted";
    // Monotonic guard: never regress an already-posted clip. Allow re-patching a
    // posted clip ONLY to upgrade its permalink (a pending/empty postUrl getting a
    // real link on a cron retry). A non-"posted" patch on a posted clip is ignored.
    if (row.status === "posted") {
      const patch: Record<string, unknown> = {};
      if (nextStatus === "posted" && postUrl && postUrl !== row.postUrl) patch.postUrl = postUrl;
      if (platform && !row.platform) patch.platform = platform;
      if (uploadPostRequestId && !row.uploadPostRequestId) patch.uploadPostRequestId = uploadPostRequestId;
      if (platformPostId && !row.platformPostId) patch.platformPostId = platformPostId;
      if (captionText?.trim() && captionText.trim() !== row.captionText) patch.captionText = captionText.trim();
      if (Object.keys(patch).length === 0) return { ok: true, noop: true, ...provenance };
      await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
      return { ok: true, upgraded: true, ...provenance };
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: nextStatus,
      ...(postUrl ? { postUrl } : {}),
      ...(platform ? { platform } : {}),
      ...(failReason ? { failReason } : {}),
      ...(uploadPostRequestId ? { uploadPostRequestId } : {}),
      ...(platformPostId ? { platformPostId } : {}),
      ...(captionText?.trim() ? { captionText: captionText.trim() } : {}),
      // Stamp the actual post time once (epoch ms), only on the posted transition
      // and only if not already set — survives a later scheduledContent cancel.
      ...(nextStatus === "posted" && row.postedAt == null ? { postedAt: now } : {}),
      updatedAt: now,
    });
    return { ok: true, ...provenance };
  },
});

/**
 * ATOMIC CROSS-PATH CLAIM: transition a clip "ready" → "posting" ONLY if it is
 * still "ready", returning whether THIS caller won the claim. Convex mutations
 * serialize, so the two auto-post producers — clipJobs.process (renders then
 * auto-posts inline) and drainDueClips (the drip cron, which claims the
 * scheduledContent row then posts) — can't BOTH post the same clip: whichever
 * one flips the clip badge to "posting" first wins, the loser skips. This is the
 * shared lock between the two paths (the clips row is the only thing they share;
 * the drip's claimForPosting only guards the scheduledContent row, not the clip).
 *
 * Keyed by clipId, which is unique per (mintAddress, clipUrl). Idempotent re-arm:
 * a clip already "posting" (e.g. a reaper reverted its sched row but the badge
 * lagged) is re-claimable so a genuine retry isn't wedged — only "posted"/inflight
 * by the OTHER path blocks. We block on "posted" (terminal) and treat "posting"
 * as a live claim that the same retry may re-take; the caller passes its own
 * winner semantics. Returns claimed:false for a missing/non-ready clip.
 *
 * globalThis.process: this module exports an action named `process`, which
 * shadows Node's global `process` at module scope — reach env via globalThis.
 */
export const claimClipForPosting = mutation({
  args: { clipId: v.id("clips"), authSecret: v.string() },
  handler: async (ctx, { clipId, authSecret }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const clip = await ctx.db.get(clipId);
    // Only a still-"ready" clip can be claimed. A clip already "posting"/"posted"
    // by the other path (or terminal "failed"/"skipped") is not ours to take.
    if (!clip || clip.status !== "ready") return { claimed: false };
    await ctx.db.patch(clipId, { status: "posting", updatedAt: Date.now() });
    return { claimed: true };
  },
});

/**
 * URL-keyed twin of claimClipForPosting for the DRIP path (drainDueClips), which
 * only knows the clip by its videoUrl (the no-schema-field join: clips.clipUrl ===
 * scheduledContent.videoUrl — see markClipPostedByUrl). Atomically claims a clip
 * "ready" → "posting" so the drip can't post a clip that clipJobs.process is
 * already posting inline (and vice-versa).
 *
 * Returns:
 *   { claimed:true }                       — we won; safe to post.
 *   { claimed:false, missing:true }        — no clips row for this URL (a draft-
 *                                            session drip); POST ANYWAY — there is
 *                                            no clip the inline path could double-post.
 *   { claimed:false, status:"posted" }     — the inline path already POSTED this
 *                                            clip → the caller should terminate its
 *                                            sched row "posted" (don't re-post).
 *   { claimed:false, status:<other> }      — a clips row exists but is NOT "ready"
 *                                            (the inline path is mid-posting it) →
 *                                            the caller defers (re-schedule + skip).
 *
 * globalThis.process: this module exports an action named `process`, which shadows
 * Node's global `process` at module scope — reach env via globalThis.
 */
export const claimClipForPostingByUrl = mutation({
  args: { mintAddress: v.string(), clipUrl: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, clipUrl, authSecret }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const rows = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    // EXACT clipUrl equality — the same load-bearing join contract as markClipPostedByUrl.
    const row = rows.find((r) => r.clipUrl === clipUrl);
    if (!row) return { claimed: false, missing: true };
    if (row.status !== "ready") return { claimed: false, status: row.status };
    await ctx.db.patch(row._id, { status: "posting", updatedAt: Date.now() });
    return { claimed: true };
  },
});

/**
 * STATUS-AWARE REVERT (secret-gated CAS): flip a clip "posting" → "ready" by the
 * videoUrl===clipUrl join, ONLY when the clip is CURRENTLY "posting". Any other
 * status — operator-"skipped", "failed", "posted", already-"ready" — is left
 * UNTOUCHED and the call is a no-op.
 *
 * WHY this exists (the bug it fixes): the drip's orphan-reconcile + the reaper's
 * clip-revert used to call markClipPostedByUrl({status:"ready"}), which flips ANY
 * non-"posted" clip to the passed status. A clip an operator deliberately SKIPPED
 * (or one that genuinely FAILED) would therefore be resurrected to "ready" on
 * every 5-min reconcile tick, forever. The reconcile/reaper only ever want to
 * un-strand a clip THEY left mid-flight on "posting" — so the CAS is gated on the
 * clip's CURRENT status being "posting". Skipped/failed/posted/ready clips win.
 *
 * Returns:
 *   { ok:true, reverted:true }   — was "posting", now "ready".
 *   { ok:true, noop:true, status } — clip exists but wasn't "posting" (left as-is).
 *   { ok:false, reason }         — no clips row for this (mint, url) — non-fatal.
 *
 * globalThis.process: this module exports an action named `process`, which shadows
 * Node's global `process` at module scope — reach env via globalThis.
 */
export const revertClipPostingByUrl = mutation({
  args: { mintAddress: v.string(), clipUrl: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, clipUrl, authSecret }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const rows = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    // EXACT clipUrl equality — the same load-bearing join contract as markClipPostedByUrl.
    const row = rows.find((r) => r.clipUrl === clipUrl);
    if (!row) return { ok: false, reason: "clip not found" };
    // CAS: only un-strand a clip WE left mid-flight on "posting". A skipped/failed/
    // posted/ready clip is deliberately left as-is (never resurrected to "ready").
    if (row.status !== "posting") return { ok: true, noop: true, status: row.status };
    await ctx.db.patch(row._id, { status: "ready", updatedAt: Date.now() });
    return { ok: true, reverted: true };
  },
});

/**
 * PUBLIC posting-feed for the builder "Posting" tab. Returns the agent's clips
 * (viralScore DESC, tie-break createdAt DESC — best first, LOCKED rule (3)),
 * each annotated with its derived post-state by JOINING scheduledContent on
 * `videoUrl === clipUrl` (the no-schema-field join — there is no clipId column).
 *
 * PUBLIC like listClipsByMint/listByMint — it only exposes the caller's own mint
 * data and the mint is itself public, so this is the same exposure model as the
 * existing public clip lists; ownership is implicitly mint-scoped.
 *
 * No new index: by_mint already exists on both tables and both .collect()s are
 * bounded per-agent.
 */
export const postingFeed = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const clips = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    clips.sort((a, b) => (b.viralScore - a.viralScore) || (b.createdAt - a.createdAt));
    // Collapse exact clipUrl DUPLICATES (a clip recorded twice — e.g. a 0-virality
    // copy beside the real one from before recordCanvasClips was made idempotent).
    // The sort puts the best row (highest viralScore, newest) first, so keep the
    // first per clipUrl; rows still rendering (no clipUrl) are all kept.
    const seenClipUrl = new Set<string>();
    const dedupedClips = clips.filter((c) => {
      if (!c.clipUrl) return true;
      if (seenClipUrl.has(c.clipUrl)) return false;
      seenClipUrl.add(c.clipUrl);
      return true;
    });

    const sched = await ctx.db.query("scheduledContent").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    // url -> scheduledContent row (the no-schema-field join key). When several rows
    // share a videoUrl prefer the most-recent non-cancelled one so a re-queued clip
    // reflects its latest drip attempt.
    const byUrl = new Map<string, Doc<"scheduledContent">>();
    for (const s of sched) {
      if (!s.videoUrl) continue;
      if (s.status === "cancelled") continue;
      const prev = byUrl.get(s.videoUrl);
      if (!prev || s.createdAt > prev.createdAt) byUrl.set(s.videoUrl, s);
    }

    return dedupedClips.map((c) => {
      const s = c.clipUrl ? byUrl.get(c.clipUrl) : undefined;
      // Derive a single post-state from the clip badge + the drip row. The clip
      // row is the authoritative "posted" signal (drainDueClips patches it on a
      // real post); the sched row carries queued/posting/failed + scheduledFor/error.
      let state: "not_posted" | "queued" | "posting" | "posted" | "failed" | "flagged";
      if (c.status === "posted" || s?.status === "posted") state = "posted";
      else if (c.status === "posting" || s?.status === "posting") state = "posting";
      // Guardrails blocked this clip (lib/server/guardrails.ts) — permanently
      // excluded from re-post attempts (see claimClipForPostingByUrl's "ready"-only
      // claim), distinct from a transient "failed" post so the operator can tell
      // "needs fixing/regenerating" apart from "retry next cycle".
      else if (c.status === "guardrail_rejected") state = "flagged";
      else if (c.status === "failed" || s?.status === "failed") state = "failed";
      else if (s?.status === "scheduled") state = "queued";
      else state = "not_posted";
      return {
        clipId: c._id,
        title: c.title,
        clipUrl: c.clipUrl ?? null,
        viralScore: c.viralScore,
        state,
        postUrl: c.postUrl ?? null,
        platform: c.platform ?? s?.platforms?.[0] ?? null,
        scheduledFor: s?.scheduledFor ?? null,
        // Actual post time: prefer the clip's own stamp (survives a sched cancel),
        // else the joined drip row's postedAt, else null. Drives Posting-history.
        postedAt: c.postedAt ?? s?.postedAt ?? null,
        // Clip-row creation time (epoch ms). The lock-in / reschedule paths re-run
        // orderClips on these feed rows, whose "newest"/"oldest"/"best" tie-break
        // sorts on createdAt — so without it those re-orders would all collapse to
        // 0 (insertion order). Carried straight from the clips row (LOCKED C2).
        createdAt: c.createdAt,
        error: c.failReason ?? s?.error ?? null,
      };
    });
  },
});

/** Public video wall — every posted/rendered video from EVERY agent, newest
 *  first, joined with the agent's profile. Powers the "From every agent" wall on
 *  /generations. Merges clipped videos (clips) and generated videos
 *  (scheduledContent), videos only, and supports a growing `limit` for lazy load
 *  (the client bumps it by 10 as the user scrolls). Scan is capped so the query
 *  stays cheap; `hasMore` tells the client whether to keep loading. */
export const globalVideoFeed = query({
  args: {
    limit: v.optional(v.number()),
    // Optional source filter: "clip" = clipper output, "ugc" = influencer-generated
    // videos (scheduled drips + raw renders). Omit for the mixed feed.
    kind: v.optional(v.union(v.literal("clip"), v.literal("ugc"))),
  },
  handler: async (ctx, { limit, kind }) => {
    const max = Math.min(Math.max(limit ?? 10, 1), 200);
    // Scan window per source SCALES with the requested page instead of a flat
    // 400: the merged newest-first top-`max` only needs the newest ~max rows
    // from each source (3x margin absorbs null-url rows + dedupe + kind
    // filtering). The landing page's limit:8/12 subscriptions drop from ~1,600
    // docs read per re-run to ~200 — and they re-run on EVERY write to any of
    // these four tables, so this is the single biggest bandwidth lever.
    const SCAN = Math.min(400, Math.max(60, max * 3));
    const GEN_COST = SERVICE_PRICES.render;       // cost to generate a video
    const POST_COST = SERVICE_PRICES.social_post; // cost to publish it

    type State = "posted" | "scheduled" | "generated";
    type Kind = "clip" | "ugc";
    type Row = {
      id: string;
      kind: Kind;
      videoUrl: string;
      posterUrl: string | null;
      caption: string;
      postUrl: string | null;
      mint: string;
      viralScore: number | null;
      createdAt: number;
      state: State;
      scheduledFor: number | null;
      submissionId: string | null;
      ownViewCount: number | null;
      /** Kie model slug that rendered it ("grok-imagine/…", "gemini-omni-video",
       *  "veo3_fast", …) — null for clipper output (no generation engine). */
      engine: string | null;
      /** Catalog format id (lib/builder/formatCatalog.ts) the video was
       *  templated from, when known — null for clips (no format concept) and
       *  legacy rows created before formatId was stamped. */
      formatId: string | null;
      /** Platform actually posted to — clips only (one post per clip). */
      platform: string | null;
      /** Platforms this UGC row targeted ([] = every connected account) —
       *  only meaningful once `state === "posted"`. */
      platforms: string[] | null;
      /** create_video task behind a UGC row — joined after slicing for the
       *  card's description (script caption/hook) + prompt (topic). */
      taskId: string | null;
      /** What the video was asked to be about, when the row itself knows. */
      prompt: string | null;
    };

    // Drip map first (videoUrl -> schedule/post state) so clips + renders can
    // read their scheduled time and posted state from the no-FK join key.
    const sched = await ctx.db.query("scheduledContent").order("desc").take(SCAN);
    const schedByUrl = new Map<string, { status: string; scheduledFor: number | null; caption: string | null; posterUrl: string | null; postUrl?: string; postPlatform?: string; viewCount?: number }>();
    for (const s of sched) {
      if (!s.videoUrl || s.status === "cancelled" || schedByUrl.has(s.videoUrl)) continue;
      schedByUrl.set(s.videoUrl, {
        status: s.status,
        scheduledFor: s.scheduledFor ?? null,
        caption: s.caption?.trim() || null,
        posterUrl: s.storyboardImageUrl ?? null,
        postUrl: s.postUrl, postPlatform: s.postPlatform, viewCount: s.viewCount,
      });
    }
    const stateFrom = (posted: boolean, schedStatus?: string): State => {
      if (posted || schedStatus === "posted") return "posted";
      if (schedStatus === "scheduled" || schedStatus === "posting") return "scheduled";
      return "generated";
    };

    // Views: the oracle records viewCount on the submission for a post. Join by
    // the live post URL (the reliable shared key) so any posted video can show
    // the already-fetched view count without re-scraping.
    const subs = await ctx.db.query("submissions").order("desc").take(SCAN);
    const viewsByPostUrl = new Map<string, number>();
    for (const su of subs) {
      if (!su.postUrl || su.viewCount == null) continue;
      const prev = viewsByPostUrl.get(su.postUrl);
      if (prev == null || su.viewCount > prev) viewsByPostUrl.set(su.postUrl, su.viewCount);
    }

    const rows: Row[] = [];
    const seen = new Set<string>();

    // Clipped videos.
    const clips = await ctx.db.query("clips").order("desc").take(SCAN);
    for (const c of clips) {
      if (!c.clipUrl || seen.has(c.clipUrl)) continue;
      seen.add(c.clipUrl);
      const sc = schedByUrl.get(c.clipUrl);
      rows.push({
        id: `clip:${c._id}`,
        kind: "clip",
        videoUrl: c.clipUrl,
        posterUrl: sc?.posterUrl ?? null,
        caption: sc?.caption || c.captionText || c.title || "",
        postUrl: c.postUrl ?? null,
        mint: c.mintAddress,
        viralScore: c.viralScore ?? null,
        createdAt: c.postedAt ?? c.createdAt,
        state: stateFrom(c.status === "posted" || !!c.postUrl, sc?.status),
        scheduledFor: sc?.scheduledFor ?? null,
        submissionId: c.submissionId ?? null,
        ownViewCount: c.viewCount ?? null,
        engine: null,
        formatId: null,
        platform: c.platform ?? null,
        platforms: null,
        taskId: null,
        prompt: null,
      });
    }

    // Render engine by videoUrl — lets the scheduled rows (which don't store the
    // model) inherit the engine from the render job that produced their video.
    const rendersForEngine = await ctx.db.query("videoRenderJobs").order("desc").take(SCAN);
    const engineByUrl = new Map<string, string>();
    for (const r of rendersForEngine) {
      if (r.videoUrl && r.kieModel && !engineByUrl.has(r.videoUrl)) engineByUrl.set(r.videoUrl, r.kieModel);
    }

    // Generated/UGC videos (scheduled rows) — carry caption + storyboard poster.
    for (const s of sched) {
      if (!s.videoUrl || s.status === "cancelled" || seen.has(s.videoUrl)) continue;
      seen.add(s.videoUrl);
      rows.push({
        id: `gen:${s._id}`,
        kind: "ugc",
        videoUrl: s.videoUrl,
        posterUrl: s.storyboardImageUrl ?? null,
        caption: s.caption || s.topic || "",
        postUrl: s.postUrl ?? null,
        mint: s.mintAddress,
        viralScore: null,
        // CREATION time, not postedAt: the influencer feed is "newest videos
        // first", and a days-old video that finally posted must not jump back
        // above the one generated a minute ago.
        createdAt: s.createdAt,
        state: stateFrom(false, s.status),
        scheduledFor: s.scheduledFor ?? null,
        submissionId: null,
        ownViewCount: s.viewCount ?? null,
        engine: engineByUrl.get(s.videoUrl) ?? null,
        formatId: s.formatId ?? null,
        platform: s.postPlatform ?? null,
        platforms: s.platforms ?? null,
        taskId: s.taskId ?? null,
        prompt: s.topic?.trim() || null,
      });
    }

    // Generated/UGC videos (raw renders) — create_video output never scheduled.
    // (Same fetch as the engine map above — one bounded scan, two uses.)
    const renders = rendersForEngine;
    for (const r of renders) {
      if (!r.videoUrl || r.phase === "failed" || seen.has(r.videoUrl)) continue;
      seen.add(r.videoUrl);
      const sc = schedByUrl.get(r.videoUrl);
      rows.push({
        id: `render:${r._id}`,
        kind: "ugc",
        videoUrl: r.videoUrl,
        posterUrl: r.storyboardImageUrl ?? null,
        caption: r.autoPost?.caption || r.videoNote || "",
        postUrl: sc?.postUrl ?? null,
        mint: r.mintAddress || r.cameoMint || "",
        viralScore: null,
        // _creationTime, not updatedAt: any later patch (an Editor re-burn,
        // a status write) bumped updatedAt and floated old renders back to
        // the top of the newest-first feed.
        createdAt: r._creationTime,
        state: stateFrom(false, sc?.status),
        scheduledFor: sc?.scheduledFor ?? null,
        submissionId: r.autoPost?.submissionId ?? null,
        ownViewCount: sc?.viewCount ?? null,
        engine: r.kieModel ?? null,
        formatId: r.formatId ?? null,
        platform: sc?.postPlatform ?? null,
        platforms: r.autoPost?.platforms ?? null,
        taskId: r.taskId ?? null,
        prompt: null,
      });
    }

    const agentCache = new Map<string, { name: string; avatarUrl: string; handle: string; connectedPlatforms: string[]; isClipper: boolean; creatorWallet: string; characterId: string | null } | null>();
    const getAgent = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const a = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
        .first();
      const lite = a ? {
        name: a.name,
        avatarUrl: a.avatarUrl,
        handle: a.handle,
        connectedPlatforms: a.connectedPlatforms ?? [],
        isClipper: a.agentType === "clipping",
        creatorWallet: a.creatorWallet,
        characterId: a.solstarCharacterId ?? null,
      } : null;
      agentCache.set(mint, lite);
      return lite;
    };

    let filtered = kind ? rows.filter((r) => r.kind === kind) : rows;
    // A clipping agent's clips also flow through scheduledContent /
    // videoRenderJobs (and clips older than the SCAN window aren't in `seen`),
    // so those rows get tagged "ugc". The ugc feed is AI-influencer only — drop
    // anything owned by a clipping agent.
    if (kind === "ugc") {
      const keep: Row[] = [];
      for (const r of filtered) {
        const a = await getAgent(r.mint);
        if (!a?.isClipper) keep.push(r);
      }
      filtered = keep;
    }
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    const sliced = filtered.slice(0, max);

    const items = [];
    for (const r of sliced) {
      const a = await getAgent(r.mint);

      const viewCount = r.ownViewCount ?? (r.postUrl ? viewsByPostUrl.get(r.postUrl) ?? null : null);

      // Description + prompt from the create_video task (only for the rows
      // actually returned — at most `max` point reads). Its output carries the
      // written script ({ script: { caption, hook } }); its input the topic.
      let description: string | null = null;
      let prompt = r.prompt;
      if (r.taskId) {
        const id = ctx.db.normalizeId("agentTasks", r.taskId);
        const task = id ? await ctx.db.get(id) : null;
        if (task) {
          try {
            const out = JSON.parse(task.output ?? "{}") as { script?: { caption?: unknown; hook?: unknown } | null };
            const cap = typeof out.script?.caption === "string" ? out.script.caption.trim() : "";
            const hook = typeof out.script?.hook === "string" ? out.script.hook.trim() : "";
            description = cap || hook || null;
          } catch { /* unparseable output — no description */ }
          if (!prompt) {
            try {
              const inp = JSON.parse(task.input ?? "{}") as { topic?: unknown; prompt?: unknown };
              const t = typeof inp.prompt === "string" ? inp.prompt : typeof inp.topic === "string" ? inp.topic : "";
              prompt = t.trim() || null;
            } catch { /* fall through to the title */ }
            prompt ??= task.title.replace(/^create video:\s*/i, "").trim() || null;
          }
        }
      }

      const published = r.state === "posted" || r.state === "scheduled";
      const cost = +(GEN_COST + (published ? POST_COST : 0)).toFixed(2);

      // Which platforms this video actually posted to, for the card's stacked
      // icon row — only meaningful once posted. Clips post to exactly one
      // platform; UGC rows target `platforms` ([] means every connected
      // account, so fall back to the agent's connected list).
      const postedPlatforms = r.state !== "posted" ? [] :
        r.platform ? [r.platform] :
        r.platforms && r.platforms.length > 0 ? r.platforms :
        a?.connectedPlatforms ?? [];

      items.push({
        id: r.id,
        kind: r.kind,
        mint: r.mint,
        videoUrl: r.videoUrl,
        posterUrl: r.posterUrl,
        caption: r.caption,
        postUrl: r.postUrl,
        viralScore: r.viralScore,
        viewCount,
        cost,
        state: r.state,
        scheduledFor: r.scheduledFor,
        createdAt: r.createdAt,
        agentName: a?.name ?? "Agent",
        agentAvatar: a?.avatarUrl ?? "",
        agentHandle: a?.handle ?? "",
        creatorWallet: a?.creatorWallet ?? null,
        characterId: a?.characterId ?? null,
        engine: r.engine,
        formatId: r.formatId,
        postedPlatforms,
        // The agent's OWN connected accounts, regardless of whether this
        // particular video was posted — the card shows these beside the
        // agent's name (the "who could post this" identity, not a per-video
        // history), separate from postedPlatforms above.
        agentConnectedPlatforms: a?.connectedPlatforms ?? [],
        description,
        prompt,
      });
    }

    return { items, total: filtered.length, hasMore: filtered.length > max };
  },
});

/** Every video (clip + UGC) produced by a set of the caller's OWN agents, with
 *  view counts — the data source for /analytics. Scoped per-mint via `by_mint`
 *  indexes (clips/scheduledContent/videoRenderJobs) and `by_influencer_mint`
 *  (submissions), so it reads only this operator's rows instead of scanning the
 *  platform-wide recent window globalVideoFeed is bounded to — an operator with
 *  older videos than the last 200 platform-wide wouldn't see them there. */
// Bounded per-mint, per-table scan. Convex aborts any query reading more than
// 16384 documents total (uncatchable — surfaces to the client as a bare
// "Server Error") — plain .collect() here blew that on any account with real
// history, since 4 tables x N mints has no cap. MINTS x TABLES x SCAN stays
// comfortably under the limit (25 x 4 x 120 = 12000) with margin for the
// per-mint agent/influencer lookup below.
const MINTS_CAP = 25;
const SCAN_PER_MINT = 120;

export const videoFeedByMints = query({
  args: { mintAddresses: v.array(v.string()) },
  handler: async (ctx, { mintAddresses }) => {
    const mints = [...new Set(mintAddresses)].slice(0, MINTS_CAP);
    if (mints.length === 0) return { items: [] };

    type Row = {
      id: string;
      videoUrl: string;
      posterUrl: string | null;
      caption: string;
      postUrl: string | null;
      /** Native platform post id (durable, captured even when the visible
       *  permalink couldn't be correlated yet — see pickCorrelatedPermalink).
       *  Callers needing to address "this exact post" on an API (e.g. fetching
       *  comments) should prefer this over postUrl when postUrl is null. */
      platformPostId: string | null;
      mint: string;
      createdAt: number;
      state: "posted" | "scheduled" | "generated";
      viewCount: number | null;
      /** The platform actually posted to (tiktok/instagram/youtube/x/facebook) —
       *  only known for real clip posts; scheduled/render rows haven't posted
       *  yet (only an intended `platforms[]`), so this stays undefined there. */
      platform: string | undefined;
      /** Vello AI's predicted virality score (0-100) — only computed for clips. */
      viralScore: number | undefined;
      /** Human title for the card (clip title / scheduled topic / task title). */
      title: string;
      /** Full caption / script caption — the "what is this video" context. */
      description: string;
      /** What the video was asked to be about (topic / prompt), when known. */
      prompt: string;
      /** create_video task behind a UGC row — enriched after sorting. */
      taskId: string | null;
    };
    const rows: Row[] = [];
    const seen = new Set<string>();

    for (const mint of mints) {
      const [clips, sched, renders, subs] = await Promise.all([
        ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).order("desc").take(SCAN_PER_MINT),
        ctx.db.query("scheduledContent").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).order("desc").take(SCAN_PER_MINT),
        ctx.db.query("videoRenderJobs").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).order("desc").take(SCAN_PER_MINT),
        ctx.db.query("submissions").withIndex("by_influencer_mint", (q) => q.eq("influencerMint", mint)).order("desc").take(SCAN_PER_MINT),
      ]);

      const viewsByPostUrl = new Map<string, number>();
      for (const su of subs) {
        if (!su.postUrl || su.viewCount == null) continue;
        const prev = viewsByPostUrl.get(su.postUrl);
        if (prev == null || su.viewCount > prev) viewsByPostUrl.set(su.postUrl, su.viewCount);
      }

      const schedByUrl = new Map<string, { status: string; postUrl?: string; platformPostId?: string; postPlatform?: string; viewCount?: number }>();
      for (const s of sched) {
        if (!s.videoUrl || s.status === "cancelled" || schedByUrl.has(s.videoUrl)) continue;
        schedByUrl.set(s.videoUrl, { status: s.status, postUrl: s.postUrl, platformPostId: s.platformPostId, postPlatform: s.postPlatform, viewCount: s.viewCount });
      }
      const stateFrom = (posted: boolean, schedStatus?: string): Row["state"] => {
        if (posted || schedStatus === "posted") return "posted";
        if (schedStatus === "scheduled" || schedStatus === "posting") return "scheduled";
        return "generated";
      };

      for (const c of clips) {
        if (!c.clipUrl || seen.has(c.clipUrl)) continue;
        seen.add(c.clipUrl);
        const sc = schedByUrl.get(c.clipUrl);
        rows.push({
          id: `clip:${c._id}`,
          videoUrl: c.clipUrl,
          posterUrl: null,
          caption: c.captionText || c.title || "",
          postUrl: c.postUrl ?? null,
          platformPostId: c.platformPostId ?? null,
          mint,
          createdAt: c.createdAt,
          title: (c.title ?? "").trim(),
          description: (c.captionText ?? "").trim(),
          prompt: "",
          taskId: null,
          state: stateFrom(c.status === "posted" || !!c.postUrl, sc?.status),
          // Prefer the clip's OWN synced viewCount (works for every organic
          // post) over the submissions-table join (campaign posts only).
          viewCount: c.viewCount ?? (c.postUrl ? viewsByPostUrl.get(c.postUrl) ?? null : null),
          platform: c.platform,
          viralScore: c.viralScore,
        });
      }
      for (const s of sched) {
        if (!s.videoUrl || s.status === "cancelled" || seen.has(s.videoUrl)) continue;
        seen.add(s.videoUrl);
        rows.push({
          id: `gen:${s._id}`,
          videoUrl: s.videoUrl,
          posterUrl: s.storyboardImageUrl ?? null,
          caption: s.caption || s.topic || "",
          postUrl: s.postUrl ?? null,
          platformPostId: s.platformPostId ?? null,
          mint,
          createdAt: s.createdAt,
          title: (s.topic ?? "").trim(),
          description: (s.caption ?? "").trim(),
          prompt: (s.topic ?? "").trim(),
          taskId: s.taskId ?? null,
          state: stateFrom(false, s.status),
          viewCount: s.viewCount ?? null,
          platform: s.postPlatform ?? undefined,
          viralScore: undefined,
        });
      }
      for (const r of renders) {
        if (!r.videoUrl || r.phase === "failed" || seen.has(r.videoUrl)) continue;
        seen.add(r.videoUrl);
        const sc = schedByUrl.get(r.videoUrl);
        rows.push({
          id: `render:${r._id}`,
          videoUrl: r.videoUrl,
          posterUrl: r.storyboardImageUrl ?? null,
          caption: r.autoPost?.caption || r.videoNote || "",
          postUrl: sc?.postUrl ?? null,
          platformPostId: sc?.platformPostId ?? null,
          mint,
          // Creation time — updatedAt moves on every re-burn and reorders old videos.
          createdAt: r._creationTime,
          title: "",
          description: (r.autoPost?.caption || r.videoNote || "").trim(),
          prompt: "",
          taskId: r.taskId ?? null,
          state: stateFrom(false, sc?.status),
          viewCount: sc?.viewCount ?? null,
          platform: sc?.postPlatform ?? undefined,
          viralScore: undefined,
        });
      }
    }

    rows.sort((a, b) => b.createdAt - a.createdAt);

    const agentCache = new Map<string, { name: string; avatarUrl: string } | null>();
    const getAgent = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const a = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).first();
      const lite = a ? { name: a.name, avatarUrl: a.avatarUrl } : null;
      agentCache.set(mint, lite);
      return lite;
    };

    // Full context for the newest videos (the ones chat cards actually show):
    // the create_video task's title, written script caption/hook and topic.
    // Capped so the per-mint scans above keep this query under the read limit.
    const ENRICH = 60;
    const items = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const a = await getAgent(r.mint);
      let { title, description, prompt } = r;
      if (i < ENRICH && r.taskId) {
        const id = ctx.db.normalizeId("agentTasks", r.taskId);
        const task = id ? await ctx.db.get(id) : null;
        if (task) {
          title ||= task.title.replace(/^create video:\s*/i, "").trim();
          try {
            const out = JSON.parse(task.output ?? "{}") as { script?: { caption?: unknown; hook?: unknown } | null };
            const cap = typeof out.script?.caption === "string" ? out.script.caption.trim() : "";
            const hook = typeof out.script?.hook === "string" ? out.script.hook.trim() : "";
            description ||= cap || hook;
          } catch { /* unparseable output */ }
          if (!prompt) {
            try {
              const inp = JSON.parse(task.input ?? "{}") as { topic?: unknown; prompt?: unknown };
              const t = typeof inp.prompt === "string" ? inp.prompt : typeof inp.topic === "string" ? inp.topic : "";
              prompt = t.trim();
            } catch { /* no input */ }
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- taskId is internal
      const { taskId: _t, ...pub } = r;
      items.push({ ...pub, title: title || description.split(/[.!?\n]/)[0].slice(0, 80), description, prompt, agentName: a?.name ?? "Agent", agentAvatar: a?.avatarUrl ?? "" });
    }

    return { items };
  },
});

// INTERNAL_CRON_SECRET gate — same secret/pattern as submissions.ts's gateSecret,
// duplicated here since Convex modules don't share private helpers. Reads via
// `globalThis.process` because this file already exports a top-level const
// named `process` (the video-render action below), which shadows the Node
// global for the whole module.
function gateSecret(authSecret: string) {
  const env = globalThis.process.env;
  if (!env.INTERNAL_CRON_SECRET || authSecret !== env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

/** Secret-gated due-list for the analytics "Refresh" button's clip pass — posted
 *  clips (own an upload-post handle) for the caller's OWN agent mints. This is
 *  the ONLY view-count path for a plain organic auto-post (no `submissions` row
 *  exists unless the clip was submitted to a campaign). */
export const dueForScrapeByMints = query({
  args: { authSecret: v.string(), mintAddresses: v.array(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { authSecret, mintAddresses, limit }) => {
    gateSecret(authSecret);
    const cap = Math.min(Math.max(1, limit ?? 200), 500);
    const mints = [...new Set(mintAddresses)].slice(0, 25);

    const rows: {
      _id: Id<"clips">;
      postUrl: string | null;
      platform: string;
      viewCount: number;
      uploadPostRequestId: string | null;
      platformPostId: string | null;
      mintAddress: string;
      postedAt: number | null;
    }[] = [];
    for (const mint of mints) {
      const clips = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).order("desc").take(150);
      for (const c of clips) {
        // Measurable directly (has a handle) OR posted-but-unhandled — the latter
        // is backfill-eligible via getCachedPostHistory (matched by postedAt), so
        // it must surface here too, not just the pre-existing-handle case.
        const hasHandle = !!c.postUrl || !!c.uploadPostRequestId || !!c.platformPostId;
        if (!hasHandle && c.status !== "posted") continue;
        rows.push({
          _id: c._id,
          postUrl: c.postUrl ?? null,
          platform: c.platform ?? "",
          viewCount: c.viewCount ?? 0,
          uploadPostRequestId: c.uploadPostRequestId ?? null,
          platformPostId: c.platformPostId ?? null,
          mintAddress: mint,
          postedAt: c.postedAt ?? null,
        });
      }
    }
    return rows.slice(0, cap);
  },
});

/** Secret-gated write-back for the clip pass above. Views never decrease
 *  (transient re-reads can under-count). */
export const recordViewCount = mutation({
  args: {
    authSecret: v.string(),
    id: v.id("clips"),
    viewCount: v.number(),
    // Backfill-only: the cached-post-history match resolves the real permalink
    // + native id for a clip that was posted before markClipPostedByUrl's
    // argument-validator bug was fixed (see that function's doc) and so never
    // got one captured at post time.
    postUrl: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
  },
  handler: async (ctx, { authSecret, id, viewCount, postUrl, platformPostId }) => {
    gateSecret(authSecret);
    const row = await ctx.db.get(id);
    if (!row) return { ok: false, updated: false };
    const patch: Record<string, unknown> = {};
    const next = Math.max(0, Math.floor(viewCount));
    if (next > (row.viewCount ?? 0)) patch.viewCount = next;
    if (row.status === "posted" || row.postedAt || postUrl || row.postUrl) await enqueueVideoMilestone(ctx, {
      mintAddress: row.mintAddress, views: Math.max(next, row.viewCount ?? 0), key: row.submissionId ? `submission:${row.submissionId}` : `clip:${id}`,
      postUrl: postUrl || row.postUrl, platform: row.platform, platformPostId: platformPostId || row.platformPostId, videoUrl: row.clipUrl,
    });
    if (postUrl && !row.postUrl) patch.postUrl = postUrl;
    if (platformPostId && !row.platformPostId) patch.platformPostId = platformPostId;
    if (Object.keys(patch).length === 0) return { ok: true, updated: false };
    await ctx.db.patch(id, patch);
    // Live hero counter. A clip linked to a submission is the same post the
    // submission's own view write counts — skip it so it isn't counted twice.
    if (patch.viewCount !== undefined && !row.submissionId) await bumpLiveViews(ctx, next - (row.viewCount ?? 0));
    return { ok: true, updated: true };
  },
});

/** Platform-wide count of every video produced across the network — the clipper's
 *  rendered clips PLUS the influencer pipeline's generated videos (raw create_video
 *  renders + scheduled drips). Reactive, so the market header number ticks up live
 *  as agents produce. Bounded scans per source (same guard as submissions.globalStats)
 *  keep it under Convex's per-query read limit; a produced video is one with a real
 *  media URL, and dedupe-by-URL prevents a clip counted twice via its schedule row. */
export const totalVideosProduced = query({
  args: {},
  handler: async (ctx) => {
    // Convex aborts a query that reads more than 16384 documents OR 8 MiB of
    // data, whichever comes first — and an over-limit abort is UNCATCHABLE, so a
    // single over-budget scan permanently blanks this stat to "—" on the market
    // page (exactly the bug this replaces).
    //
    // THE TRAP the earlier budgets kept falling into: the 8 MiB cap is on the
    // query's TOTAL bytes read, NOT per source. Tuning each scan to "look safe"
    // on its own (4000+2000+2000, then 3000+600+1500) still summed OVER 8 MiB
    // because `videoRenderJobs` rows are enormous — each carries the full
    // renderArgs / beats / segmentPrompts / standalonePrompts / refImages /
    // stitchClips JSON, routinely 10–20 KB per row. At 600 rows that heavy table
    // ALONE is ~12 MiB, so the query aborted before it ever returned a number.
    //
    // Fix: budget the WHOLE query by bytes with real headroom (target well under
    // ~6 MiB total). The two light tables (clips, scheduledContent — short string
    // fields) carry the count; the heavy render table is capped HARD because a
    // finished render's URL is almost always already present via its clip or
    // scheduledContent row, so its unique marginal contribution is tiny.
    //   clips              ~2000 × ~1.5 KB ≈ 3.0 MiB
    //   videoRenderJobs     ~120 × ~20  KB ≈ 2.4 MiB   ← the byte offender, capped
    //   scheduledContent   ~1000 × ~1.5 KB ≈ 1.5 MiB
    //   ────────────────────────────────────────────
    //   total                              ≈ 6.9 MiB   (< 8 MiB, uncatchable abort avoided)
    const seen = new Set<string>();

    // Clipper output — each rendered clip is one produced video (primary source).
    // Light docs (clipUrl + a few short strings); the dominant, cheapest source.
    const clips = await ctx.db.query("clips").order("desc").take(2000);
    for (const c of clips) {
      if (c.clipUrl) seen.add(c.clipUrl);
    }

    // Scheduled/drip UGC videos (their videoUrl is usually the render's URL, so it
    // dedupes against the render below). Moderate-weight docs, read before the
    // heavy table so the light bytes land first.
    const sched = await ctx.db.query("scheduledContent").order("desc").take(1000);
    for (const s of sched) {
      if (s.videoUrl && s.status !== "cancelled") seen.add(s.videoUrl);
    }

    // Influencer pipeline — raw create_video renders that finished with a video.
    // HEAVIEST table by far, so it's capped hard (see byte budget above). The
    // newest rows capture the handful of ad-hoc / hire renders that never got a
    // clip or scheduledContent row; older render URLs are already counted via
    // those tables and folded away by the dedupe set.
    const renders = await ctx.db.query("videoRenderJobs").order("desc").take(120);
    for (const r of renders) {
      if (r.videoUrl && r.phase !== "failed") seen.add(r.videoUrl);
    }

    return { total: seen.size };
  },
});

/** Resolve a clip's owning mint (secret-gated). Backs /api/clips/skip's ownership
 *  check — the route verifies clip→mint server-side instead of trusting the body. */
export const getClipMintServer = query({
  args: { clipId: v.id("clips"), authSecret: v.string() },
  handler: async (ctx, { clipId, authSecret }) => {
    // globalThis.process: this module exports an action named `process`, which
    // shadows Node's global `process` at module scope — reach the real env via globalThis.
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const clip = await ctx.db.get(clipId);
    return clip ? { mintAddress: clip.mintAddress, status: clip.status } : null;
  },
});

/**
 * HARD-delete a clip from the Posting tab (secret-gated). Backs
 * /api/clips/delete, which authenticates the operator + ownership-scopes the
 * mint before forwarding the internal secret (mirrors setClip / the skip route).
 *
 * Idempotent: a missing clip returns { ok: true }. Ownership is double-checked
 * here (clip.mintAddress === args.mintAddress) as defense-in-depth even though
 * the route already resolved clip→mint server-side.
 *
 * Cancels any NON-terminal drip rows for this clip first — the only link from a
 * scheduledContent row to its clip is videoUrl === clipUrl (the no-schema-field
 * join, see markClipPostedByUrl) — so deleting the clip doesn't leave an orphan
 * drip that posts a now-deleted clip. We do NOT delete the storage blob (clips
 * carry no storageId; that GC is deferred).
 *
 * globalThis.process: this module exports an action named `process`, which
 * shadows Node's global `process` at module scope — reach env via globalThis.
 */
export const deleteClip = mutation({
  args: { clipId: v.id("clips"), mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { clipId, mintAddress, authSecret }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const clip = await ctx.db.get(clipId);
    if (!clip) return { ok: true }; // idempotent — already gone
    if (clip.mintAddress !== mintAddress) throw new Error("forbidden");
    const clipUrl = clip.clipUrl;
    // Cancel non-terminal drip rows joined on videoUrl === clipUrl. A clip still
    // rendering (no clipUrl) has no drip rows to cancel.
    if (clipUrl) {
      const dripRows = await ctx.db
        .query("scheduledContent")
        .withIndex("by_mint_video", (q) => q.eq("mintAddress", mintAddress).eq("videoUrl", clipUrl))
        .collect();
      for (const row of dripRows) {
        if (row.status === "scheduled" || row.status === "posting") {
          await ctx.db.patch(row._id, { status: "cancelled" });
        }
      }
    }
    await ctx.db.delete(clipId);
    return { ok: true };
  },
});

// Reactive list for the builder Clips queue (newest first).
export const listClipsByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const rows = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listJobsByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const rows = await ctx.db.query("clipJobs").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Windows this agent ALREADY clipped from the same source in earlier jobs
 *  (anything not failed/skipped). A re-run must not cut — and post — the same
 *  moments again: the operator would rather get nothing new than duplicates. */
export const priorClipWindowsForSource = internalQuery({
  args: { mintAddress: v.string(), sourceUrl: v.string(), excludeJobId: v.id("clipJobs") },
  handler: async (ctx, { mintAddress, sourceUrl, excludeJobId }): Promise<Array<{ startSeconds: number; endSeconds: number }>> => {
    const jobs = await ctx.db.query("clipJobs").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).order("desc").take(200);
    const out: Array<{ startSeconds: number; endSeconds: number }> = [];
    for (const j of jobs) {
      if (j._id === excludeJobId || j.sourceUrl !== sourceUrl) continue;
      const clips = await ctx.db.query("clips").withIndex("by_job", (q) => q.eq("jobId", j._id)).collect();
      for (const c of clips) {
        if (c.status === "failed" || c.status === "skipped") continue;
        if (typeof c.startSeconds === "number" && typeof c.endSeconds === "number") out.push({ startSeconds: c.startSeconds, endSeconds: c.endSeconds });
      }
    }
    return out;
  },
});

export const getClipsForJob = query({
  args: { jobId: v.id("clipJobs") },
  handler: async (ctx, { jobId }) => ctx.db.query("clips").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect(),
});

// Rows scanned per auto-clip dedup read. Bounded like the reaper (take(200)) so a
// prolific agent can't blow the query read budget; 200 distinct sources is far more
// than autonomous clipping produces before a campaign is exhausted.
const AUTO_CLIPPED_ROW_CAP = 200;

// Bounded failed-source memory (fail-closed): a source that terminally FAILS with 0
// clips is normally re-clippable (refund-on-failure voids the run), but a GENUINELY
// broken source (deleted/private/unclippable/empty-transcript) fails that way EVERY
// cycle — so without a cap the auto-agent re-picks + re-enqueues it forever (unbounded
// re-download/re-transcribe) and never advances to its later sources. After this many
// terminal 0-clip runs for one (campaign|source) key we treat it as EXHAUSTED (count it
// as clipped) so pickNextAutoClipSource skips it. Small so a single transient failure
// still retries. Selection-only — never touches the scout charge / any money path.
const AUTO_CLIP_MAX_TERMINAL_FAILURES = 3;

/**
 * Dedup SOURCE OF TRUTH for autonomous clipping: the `(campaign, source-video)`
 * keys this agent has ALREADY clipped, derived straight from existing clipJobs rows
 * (no dedicated table — spec §Data model). Key = `${campaignId ?? contentRewardId ??
 * ""}|${sourceUrl}` — MUST stay byte-identical to lib/server/autoClipSelect.autoClipKey
 * (the string is inlined here, not imported, so lib/server never bundles into Convex).
 *
 * A `(campaign, source)` counts as "done" for any non-error terminal/in-flight row.
 * A run that terminally FAILED with ZERO clips (status "error" AND clipsReady falsy) is
 * normally EXCLUDED so the source stays eligible to retry — mirroring the refund-on-
 * failure rule (a voided 0-clip run should be re-clippable). BUT bounded failed-source
 * memory kicks in: once a single key accumulates AUTO_CLIP_MAX_TERMINAL_FAILURES such
 * 0-clip runs it is treated as EXHAUSTED (counted as clipped) so a genuinely broken
 * source stops re-enqueuing every cycle and later sources get worked. A status-"error"
 * run that still produced clips (partial value, charge kept) IS counted as clipped.
 * Secret-gated (matches this file's other functions; reached via ctx.runQuery from the
 * auto-clip action which holds INTERNAL_CRON_SECRET).
 */
export const autoClippedKeysForMint = query({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }): Promise<string[]> => {
    // globalThis.process: this module exports an action named `process`, which shadows
    // Node's global `process` at module scope — reach the real env via globalThis.
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const rows = await ctx.db
      .query("clipJobs")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .take(AUTO_CLIPPED_ROW_CAP);
    const keys = new Set<string>();
    const terminalFailures = new Map<string, number>();
    for (const row of rows) {
      if (!row.sourceUrl) continue;
      const key = `${row.campaignId ?? row.contentRewardId ?? ""}|${row.sourceUrl}`;
      // A terminally-failed 0-clip run is normally eligible to retry (NOT counted as
      // clipped) — but tally it per key: once it crosses the failure cap the source is
      // treated as exhausted (added to keys) so it stops re-enqueuing every cycle.
      if (row.status === "error" && !(row.clipsReady && row.clipsReady > 0)) {
        const n = (terminalFailures.get(key) ?? 0) + 1;
        terminalFailures.set(key, n);
        if (n >= AUTO_CLIP_MAX_TERMINAL_FAILURES) keys.add(key);
        continue;
      }
      keys.add(key);
    }
    return [...keys];
  },
});

/** How many clip jobs this agent started since UTC midnight (any source type) —
 *  the Work tab's "clips per day" cadence gate in autoClip. Secret-gated. */
export const jobsStartedTodayForMint = query({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }): Promise<number> => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const dayStart = new Date().setUTCHours(0, 0, 0, 0);
    const rows = await ctx.db
      .query("clipJobs")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(AUTO_CLIPPED_ROW_CAP);
    return rows.filter((r) => r.createdAt >= dayStart).length;
  },
});

export const getJob = query({
  args: { jobId: v.id("clipJobs") },
  handler: async (ctx, { jobId }) => ctx.db.get(jobId),
});

/**
 * Resolve a clip's campaign / content-reward PROVENANCE from its owning JOB, keyed
 * by the videoUrl === clipUrl join (the drip only knows the clip by its URL — there
 * is no clipId column on scheduledContent; see markClipPostedByUrl).
 *
 * The drip poster (scheduledContent.drainDueClips) uses this to forward
 * `contentRewardId` to post_content BEFORE posting, so a drip-posted content_reward
 * clip still gets the jobtepi brief's MANDATORY compliance tags (@mentions /
 * #hashtags) appended to its caption — parity with the inline finalize path this
 * replaced (the sched row only carries `campaignId`). Internal-only (never exposed);
 * non-fatal on a missing clip (a draft-session drip) → returns null.
 */
export const getPostProvenanceByUrl = internalQuery({
  args: { mintAddress: v.string(), clipUrl: v.string() },
  handler: async (ctx, { mintAddress, clipUrl }) => {
    const rows = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    // EXACT clipUrl equality — the same load-bearing join contract as markClipPostedByUrl.
    const row = rows.find((r) => r.clipUrl === clipUrl);
    if (!row) return null;
    const job = await ctx.db.get(row.jobId);
    return { campaignId: job?.campaignId ?? null, contentRewardId: job?.contentRewardId ?? null };
  },
});

/**
 * ADMIN: list all posted clips across the platform, newest-posted first.
 *
 * Uses the `by_status_postedAt` index so only truly "posted" rows are scanned
 * (no full-table scan). Returns at most `limit` rows (default 500, max 1000).
 * Joins agent name/avatar from `influencers` and sourceUrl from `clipJobs` so
 * the admin table can render a rich row without secondary queries.
 *
 * View counts are looked up from `submissions` by postUrl (same join strategy
 * as globalVideoFeed). Cost is the clip-render fee + social-post fee.
 */
export const listAllPostedClips = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    const max = Math.min(Math.max(limit ?? 500, 1), 1000);
    const GEN_COST = 0.40;   // SERVICE_PRICES.render
    const POST_COST = 0.05;  // SERVICE_PRICES.social_post

    // Efficient: only scan "posted" clips, newest postedAt first.
    const clips = await ctx.db
      .query("clips")
      .withIndex("by_status_postedAt", (q) => q.eq("status", "posted"))
      .order("desc")
      .take(max);

    // Agent cache: mintAddress → { name, avatarUrl, handle }.
    const agentCache = new Map<string, { name: string; avatarUrl: string; handle: string } | null>();
    const getAgent = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const a = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
        .first();
      const lite = a ? { name: a.name, avatarUrl: a.avatarUrl ?? "", handle: a.handle ?? "" } : null;
      agentCache.set(mint, lite);
      return lite;
    };

    // Job cache: jobId → { sourceUrl } for showing generation source.
    const jobCache = new Map<string, { sourceUrl: string | null } | null>();
    const getJob = async (jobId: string) => {
      if (jobCache.has(jobId)) return jobCache.get(jobId)!;
      const lite = await safeGetPostedClipJobLite(ctx, jobId);
      jobCache.set(jobId, lite);
      return lite;
    };

    const items = [];
    for (const c of clips) {
      const agent = await getAgent(c.mintAddress);
      const job = await getJob(c.jobId as string);
      // Views are synced separately via the oracle worker (admin Sync buttons).
      // Returning null here avoids an expensive full-table submissions scan
      // (no postUrl index exists on submissions, so .take(2000) exceeds the
      // Convex read budget on any real dataset and throws a server error).
      const cost = +(GEN_COST + POST_COST).toFixed(2);

      items.push({
        id: c._id,
        clipUrl: c.clipUrl ?? null,
        postUrl: c.postUrl ?? null,
        platform: c.platform ?? null,
        title: c.title ?? "",
        captionText: c.captionText ?? "",
        viralScore: c.viralScore,
        status: c.status,
        failReason: c.failReason ?? null,
        mintAddress: c.mintAddress,
        postedAt: c.postedAt ?? c.updatedAt,
        createdAt: c.createdAt,
        platformPostId: c.platformPostId ?? null,
        uploadPostRequestId: c.uploadPostRequestId ?? null,
        views: c.viewCount ?? null,  // oracle sync writes viewCount onto the clip row
        cost,
        sourceUrl: job?.sourceUrl ?? null,
        agentName: agent?.name ?? "Agent",
        agentAvatar: agent?.avatarUrl ?? "",
        agentHandle: agent?.handle ?? "",
      });
    }

    return items;
  },
});

export async function safeGetPostedClipJobLite(
  // `id: any` (not unknown) so the real QueryCtx.db.get — whose id param is the
  // narrower Id<TableName> — stays assignable to this structural type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { db: { get: (id: any) => Promise<unknown> } },
  jobId: unknown,
): Promise<{ sourceUrl: string | null } | null> {
  try {
    const job = await ctx.db.get(jobId);
    if (!job || typeof job !== "object") return null;
    const sourceUrl = (job as { sourceUrl?: unknown }).sourceUrl;
    return { sourceUrl: typeof sourceUrl === "string" ? sourceUrl : null };
  } catch {
    return null;
  }
}


// than finalizeJob's own action wall (~10m) AND the run-task post timeout (90s) so a
// legitimately in-flight inline post is never reaped mid-flight.
const CLIP_POSTING_TTL_MS = 20 * 60_000; // ~20m

/**
 * Reaper for orphaned clip jobs. A clipJobs.process action that was evicted /
 * recycled / OOM'd before its try/catch could write status:'error' leaves the row
 * stuck on a non-terminal status forever — the canvas spins AND enqueue's dedup
 * (which treats any non-terminal job as active) blocks re-running that source.
 * updatedAt is bumped on every setStatus, so a live job keeps resetting its clock;
 * anything past the budget with no progress is dead. Pure internalMutation (no HTTP),
 * so it runs 24/7 regardless of app reachability. Surface-only (never re-enqueues),
 * matching agentTasks.failStaleTasks, so it can't cause a compute death-spiral.
 *
 * ALSO reaps CLIP rows stranded on "posting" (M2): finalizeJob's inline auto-post
 * claims a clip "ready" → "posting", and on a run-task TIMEOUT it DELIBERATELY leaves
 * the clip "posting" (the post may have published server-side, so releasing it would
 * risk a double-post). Nothing else ever un-strands an inline clip — the drip reaper
 * only touches drip (scheduledContent) rows — so such a clip shows "posting" forever
 * and is wedged out of BOTH post paths' "ready"-only claim. Here, a clip stuck on
 * "posting" past CLIP_POSTING_TTL_MS is reverted to "ready" via a STATUS-AWARE CAS
 * (patched ONLY while still "posting" — a clip finalizeJob marked "posted"/"failed"
 * in the meantime is left untouched, so this never fights a concurrent successful
 * post), mirroring the drip reaper's revertClipPostingByUrl. Reverting to "ready"
 * (vs "failed") keeps the clip re-postable — the same bounded, rare double-post
 * tradeoff the drip reaper already makes for its own timeout case.
 */
export const reapStaleJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const NONTERMINAL = ["queued", "downloading", "transcribing", "analyzing", "clipping", "posting"] as const;
    const BUDGET_MS = 15 * 60_000; // > the Convex action wall-clock (~10m) so the action's own catch wins when merely slow
    let reaped = 0;
    for (const status of NONTERMINAL) {
      const rows = await ctx.db.query("clipJobs").withIndex("by_status", (q) => q.eq("status", status)).take(200);
      for (const j of rows) {
        if (now - (j.updatedAt ?? j._creationTime) < BUDGET_MS) continue;
        await ctx.db.patch(j._id, {
          status: "error",
          error: (j.error ? j.error + "\n" : "") + `Timed out — no progress for ${Math.round(BUDGET_MS / 60000)}m (stuck on '${status}'); auto-failed. Run it again to retry.`,
          updatedAt: now,
        });
        reaped++;
        // Refund the run's compute-tab fees for a stranded job that delivered 0 clips
        // (the funding gate charged up-front; a run that produced nothing must not keep
        // the money). Keep the charge if any clip rendered/posted (partial value).
        // Idempotent; this is a mutation so we call the tx helper directly (no runMutation).
        try {
          const jobClips = await ctx.db.query("clips").withIndex("by_job", (q) => q.eq("jobId", j._id)).take(200);
          if (!runHasSuccessfulClip(jobClips)) {
            await refundRunFeesTx(ctx, { mintAddress: j.mintAddress, jobId: j._id });
          }
        } catch (e) {
          console.warn(`[clipJobs] reaper refund skipped for ${j._id}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    // Inline clip-posting reaper (M2). by_status_postedAt is keyed ["status",
    // "postedAt"]; a "posting" clip has no postedAt, so an eq("status","posting")
    // scan returns them all (bounded by take). updatedAt is bumped by
    // claimClipForPosting + setClip, so a live post keeps its clock fresh.
    let clipsReaped = 0;
    const postingClips = await ctx.db
      .query("clips")
      .withIndex("by_status_postedAt", (q) => q.eq("status", "posting"))
      .take(200);
    for (const c of postingClips) {
      if (now - (c.updatedAt ?? c._creationTime) < CLIP_POSTING_TTL_MS) continue;
      // STATUS-AWARE CAS: within this one serializable mutation the snapshot status
      // is authoritative, so a clip that raced to "posted"/"failed" isn't here. Only
      // un-strand a clip WE (the inline path) left mid-flight on "posting".
      if (c.status !== "posting") continue;
      await ctx.db.patch(c._id, { status: "ready", updatedAt: now });
      clipsReaped++;
    }

    return { reaped, clipsReaped };
  },
});

// ── Chunked transcription (action-level fan-out for multi-hour sources) ──
// A single /api/video/transcribe-clip request cannot fit a 3-4h transcribe under
// the route's 300s maxDuration (≈60 sequential KIE chunks). So for long sources
// the action splits the audio into windows and fans out PARALLEL range requests
// (each well under 300s), then offsets+stitches the slice-local results itself.
const CHUNK_SECONDS = 720;        // 12-min windows → one comfortable transcribe request each
const OVERLAP_SECONDS = 5;        // each window (except the first) starts OVERLAP earlier so a word split at a boundary isn't lost; dedup on stitch
const MAX_CONCURRENCY = 4;        // bound simultaneous ffmpeg+STT load on the single Railway process + avoid provider rate-limit storms
const CHUNK_TIMEOUT_MS = 285_000; // just under the route's 300s maxDuration (mirrors the download call's 290s rationale)
const CHUNK_RETRIES = 2;          // action-level retries per chunk, ON TOP of the route's own 3 internal KIE retries
// Only fan out when the source is meaningfully longer than one window; at/under
// this the SHORT-video path runs the identical single call it does today.
const CHUNK_THRESHOLD_SECONDS = CHUNK_SECONDS + 120;

// Whole-source AUDIO via the async download path (off the request thread) for
// Drive sources. A multi-GB/multi-hour Drive campaign video can't finish the
// synchronous /api/video/download inside the route's ~300s, so a slow pull hit
// "timeout after 290000ms". We start the (audio-only) pull and poll until done.
const ASYNC_DL_POLL_MS = 4000;
const ASYNC_DL_MAX_MS = Number(globalThis.process?.env?.CLIP_ASYNC_DL_MAX_MS) || 25 * 60_000;

// ── Cut-stage poll/finalize (the clip CUT now runs OFF the action wall) ──
// process hands the whole batch to /api/video/clip-batch-start (one whole-source
// pull → ffmpeg input-seek per clip, in the persistent Railway process), then
// chains tiny cutPoll actions that heartbeat + watch the clip rows until all are
// terminal, then finalizeJob does the auto-post + completion.
const CLIP_CUT_POLL_MS = ASYNC_DL_POLL_MS;                                              // reuse the 4s cadence
const CLIP_CUT_MAX_MS = Number(globalThis.process?.env?.CLIP_CUT_MAX_MS) || 45 * 60_000; // whole-source pull + 30 renders headroom

/**
 * Shared per-job context derivation reused by BOTH `process` (the cut-stage
 * kickoff) and `finalizeJob` (the auto-post stage, which runs in a LATER chained
 * action and so must re-derive everything from the DB). Returns the agent, the
 * normalized clip config, the wired-skill rows + the planner-shaped `skills`
 * array, and the Smart-Captions prompt + its text transformer. No node-only
 * imports — V8-safe (the lib imports are dynamic + pure TS).
 */
/** Persona + campaign context the render uses to caption and label a clip that has
 *  no transcript of its own. Cheap, already-loaded fields only — no extra reads. */
function clipContextFor(
  agent: { name?: string; niche?: string } | null | undefined,
  job: { campaignId?: string | null; sourceUrl?: string },
): { agentName?: string; niche?: string; campaignId?: string; sourceUrl?: string } {
  return {
    ...(agent?.name ? { agentName: agent.name } : {}),
    ...(agent?.niche ? { niche: agent.niche } : {}),
    ...(job.campaignId ? { campaignId: job.campaignId } : {}),
    ...(job.sourceUrl ? { sourceUrl: job.sourceUrl } : {}),
  };
}

async function loadClipContext(ctx: ActionCtx, jobId: Id<"clipJobs">) {
  const { normalizeClipConfig } = await import("../lib/builder/clipConfig");
  const { resolveDescriptionInstruction } = await import("../lib/server/captionTransform");
  const job = await ctx.runQuery(api.clipJobs.getJob, { jobId });
  if (!job) return null;
  const agent = await ctx.runQuery(api.influencers.getByMint, { mintAddress: job.mintAddress });
  const skillFiles = await ctx.runQuery(api.agentSkillFiles.listByMint, { mintAddress: job.mintAddress });
  // Skill-leak-divergence (Fix A): honor the canvas-synced `wired` flag — skip
  // rows whose node was removed/never wired so a stale install no longer fires its
  // floor or gets billed. `wired === undefined` (legacy rows) is treated as wired.
  const wiredFiles = (skillFiles ?? []).filter((s: { wired?: boolean }) => s.wired !== false);
  // VIDEO POOLS live in TWO places — the last-compiled clipConfig and the skill row
  // the canvas syncs on every change. mergePoolConfig prefers the row (uploading
  // does not recompile the graph), which is what makes an app installed AFTER the
  // last run actually render.
  const { mergePoolConfig } = await import("../lib/builder/clipPools");
  const config = normalizeClipConfig(
    mergePoolConfig((agent?.clipConfig ?? {}) as Record<string, unknown>, wiredFiles) as Record<string, never>,
  );
  // Forward skillId + the per-node inspector config (synced from the canvas) so the
  // cloud path applies the SAME deterministic floors + caption/hook styling the
  // canvas Run does.
  const skills = wiredFiles.map((s: { skillId: string; title: string; markdown: string; config?: unknown }) => {
    const cfg = (s.config && typeof s.config === "object" ? s.config : {}) as Record<string, unknown>;
    return {
      skillId: s.skillId,
      name: s.title,
      instructions: s.markdown.replace(/^---[\s\S]*?---\s*/, "").trim(),
      // Pick the known per-node fields with concrete types (a raw spread would
      // type them as `unknown` and break the planClipEdits call).
      ...(typeof cfg.captionPreset === "string" ? { captionPreset: cfg.captionPreset } : {}),
      ...(cfg.captionAlign === "top" || cfg.captionAlign === "center" || cfg.captionAlign === "bottom" ? { captionAlign: cfg.captionAlign } : {}),
      ...(typeof cfg.captionYPct === "number" && Number.isFinite(cfg.captionYPct) ? { captionYPct: cfg.captionYPct } : {}),
      ...(typeof cfg.captionPrompt === "string" ? { captionPrompt: cfg.captionPrompt } : {}),
      ...(typeof cfg.descFromCaption === "boolean" ? { descFromCaption: cfg.descFromCaption } : {}),
      ...(typeof cfg.descriptionPrompt === "string" ? { descriptionPrompt: cfg.descriptionPrompt } : {}),
      ...(typeof cfg.hookDurationSec === "number" ? { hookDurationSec: cfg.hookDurationSec } : {}),
      ...(cfg.hookAlwaysOn === true ? { hookAlwaysOn: true } : {}),
      // Auto Hook "default design": the inspector SHOWS "Bold White"/5s as display-only
      // fallbacks but writes node config only when the operator moves a control, so an
      // accept-the-defaults node ships empty config → applyHookStyle's hookConfigured
      // gate fails → NO hook renders (and the LLM-down floor, whose job is "every wired
      // skill applies", also emits nothing). Mirror the shipped Brain Rot bgId:"random"
      // fix: a WIRED clip.hook with no explicit template defaults to "bold_white" so the
      // hook always renders. The wired!==false filter already drops stale/removed rows.
      ...(typeof cfg.hookTemplateId === "string"
        ? { hookTemplateId: cfg.hookTemplateId }
        : (s.skillId === "clip.hook" ? { hookTemplateId: "bold_white" } : {})),
      ...(cfg.hookPosition === "top" || cfg.hookPosition === "center" || cfg.hookPosition === "bottom" ? { hookPosition: cfg.hookPosition } : {}),
      ...(cfg.hookCustomDesign && typeof cfg.hookCustomDesign === "object" ? { hookCustomDesign: cfg.hookCustomDesign as Record<string, unknown> } : {}),
      // The operator's hook brief. Only the local canvas run forwarded it, so cloud
      // runs ignored the Auto Hook prompt and burned a generic first-words line.
      ...(typeof cfg.hookPrompt === "string" && cfg.hookPrompt.trim() ? { hookPrompt: cfg.hookPrompt.trim() } : {}),
      // The operator's Auto Hook language pick — same "cloud path forgot to
      // forward a per-node field" bug as hookPrompt above. Without it the
      // cloud run's hook generation only guessed the language from the
      // clip's caption, which forced English whenever that guess lost.
      ...(typeof cfg.hookLanguage === "string" && cfg.hookLanguage.trim() ? { hookLanguage: cfg.hookLanguage.trim() } : {}),
      ...(typeof cfg.framingMode === "string" ? { framingMode: cfg.framingMode as "auto" | "pan" | "zoom" | "full" } : {}),
      // Hook Title Card (clip.title): thread the picked slate design + hold duration +
      // the prompt-box idea so the operator's Breaking News (etc.) choice + custom hook
      // text actually reach applyTitleStyle. Without this the node's config was dropped
      // and every clip fell back to the default slate + first-6-words caption. A WIRED
      // clip.title with no explicit template defaults to "breaking_news" (same
      // accept-the-defaults pattern as Auto Hook / Viral Sticker).
      ...(typeof cfg.titleTemplateId === "string"
        ? { titleTemplateId: cfg.titleTemplateId }
        : (s.skillId === "clip.title" ? { titleTemplateId: "breaking_news" } : {})),
      ...(typeof cfg.titleDurationSec === "number" ? { titleDurationSec: cfg.titleDurationSec } : {}),
      ...(typeof cfg.titlePrompt === "string" ? { titlePrompt: cfg.titlePrompt } : {}),
      // Viral Sticker "default style": same accept-the-defaults class as Auto Hook —
      // a wired sticker node that never had a control moved ships empty config, so
      // applyStickerStyle's stickerConfigured gate fails and NO sticker renders (its
      // docs say "auto-written from the clip" with the Classic style). Mirror the Brain
      // Rot fix: a WIRED clip.sticker with no explicit style defaults to "classic".
      ...(typeof cfg.stickerStyleId === "string"
        ? { stickerStyleId: cfg.stickerStyleId }
        : (s.skillId === "clip.sticker" ? { stickerStyleId: "classic" } : {})),
      ...(typeof cfg.stickerPosition === "string" ? { stickerPosition: cfg.stickerPosition } : {}),
      ...(typeof cfg.stickerPrompt === "string" ? { stickerPrompt: cfg.stickerPrompt } : {}),
      ...(cfg.bgLayout === "vstack" || cfg.bgLayout === "hstack" ? { bgLayout: cfg.bgLayout } : {}),
      // Brain Rot "default Random": the skill is documented to default to a random
      // gameplay loop, but the planner's leak-guard skips composite_bg without a
      // bgId, so a wired-but-unconfigured node silently did nothing. The `wired`
      // filter above already drops stale/removed rows, so a WIRED clip.brainrot with
      // no explicit pick safely defaults to "random" (the rotating pool). Still a
      // no-op when GAMEPLAY_PACK_BASE_URL is unset (gameplayUrl → "").
      ...(typeof cfg.bgId === "string" && cfg.bgId
        ? { bgId: cfg.bgId }
        : (s.skillId === "clip.brainrot" ? { bgId: "random" } : {})),
      ...(typeof cfg.audioUrl === "string" ? { audioUrl: cfg.audioUrl } : {}),
      ...(typeof cfg.audioId === "string" ? { audioId: cfg.audioId } : {}),
      ...(typeof cfg.gainDb === "number" ? { gainDb: cfg.gainDb } : {}),
      ...(cfg.filterPreset === "vintage" || cfg.filterPreset === "warm" || cfg.filterPreset === "cool" || cfg.filterPreset === "bw" || cfg.filterPreset === "vivid" ? { filterPreset: cfg.filterPreset } : {}),
      ...(typeof cfg.filterSaturation === "number" ? { filterSaturation: cfg.filterSaturation } : {}),
      ...(typeof cfg.filterBrightness === "number" ? { filterBrightness: cfg.filterBrightness } : {}),
      ...(typeof cfg.sfxId === "string" ? { sfxId: cfg.sfxId } : {}),
      // Reaction-SFX pack pick (clip.memeaudio): the AI still auto-picks the sting
      // by emotion; this only swaps the pack. Unset ⇒ the Gen Z Meme default.
      ...(typeof cfg.sfxPackId === "string" ? { sfxPackId: cfg.sfxPackId } : {}),
      ...(typeof cfg.sfxAtSec === "number" ? { sfxAtSec: cfg.sfxAtSec } : {}),
      // Trending Audio: thread the picked track + default a bare WIRED node to
      // autoMusic:true (accept-the-defaults still adds a mood-matched bed). gainDb is
      // threaded generically above. Leak-safe: the wired!==false filter drops stale rows.
      ...resolveWiredTrendingAudio(s.skillId, cfg),
      // Overlay Image: thread the operator's uploaded image + placement so the floor
      // burns it onto the clip. A bare node (no image) stays inert in the floor.
      ...(typeof cfg.overlayImageUrl === "string" && cfg.overlayImageUrl.trim()
        ? { overlayImageUrl: cfg.overlayImageUrl.trim() } : {}),
      ...(cfg.overlayMode === "overlay" || cfg.overlayMode === "frame" ? { overlayMode: cfg.overlayMode } : {}),
      ...(cfg.overlayPosition === "overlay" || cfg.overlayPosition === "top" || cfg.overlayPosition === "bottom"
        ? { overlayPosition: cfg.overlayPosition } : {}),
      ...(typeof cfg.overlayOpacity === "number" ? { overlayOpacity: cfg.overlayOpacity } : {}),
      ...(typeof cfg.overlayScale === "number" ? { overlayScale: cfg.overlayScale } : {}),
    };
  });

  // Smart Captions: the POST DESCRIPTION follows its OWN resolved instruction —
  // descriptionPrompt when the operator set one, else captionPrompt when
  // descFromCaption is on (default true, so pre-split configs keep behaving the
  // same) — independent of the on-video SUBTITLE path below (clipEditPlanner
  // always reads captionPrompt, unchanged). Resolved once per job; applied per
  // clip below (fail-safe to the original).
  const captionStyleSkill = (skills as { skillId?: string; captionPrompt?: string; descriptionPrompt?: string; descFromCaption?: boolean }[])
    .find((s) => s.skillId === "clip.captionstyle");
  const descInstruction = resolveDescriptionInstruction(captionStyleSkill ?? {});
  const transformDesc = descInstruction
    ? (await import("../lib/server/captionTransform")).transformCaptionText
    : null;

  return { job, agent, config, wiredFiles, skills, descInstruction, transformDesc };
}

export const process = internalAction({
  args: { jobId: v.id("clipJobs"), kieApiKey: v.optional(v.string()), appUrl: v.optional(v.string()) },
  handler: async (ctx, { jobId, kieApiKey, appUrl }) => {
    // Every callback origin Convex can use, most-reliable first. `appUrl` is the
    // Next route reporting its OWN reachable origin (the *.up.railway.app host,
    // whose cert is Railway's wildcard) so it outranks the env guess. appFetch
    // falls through to the next origin on a TLS/connect failure — that is what
    // keeps a broken custom-domain cert from killing every clip run.
    const origins = appOrigins(appUrl);
    const baseUrl = origins[0] ?? "http://localhost:3000";
    // Moment selection + genre re-weight stay in process; planClipEdits now runs in
    // the batch route (off the action wall), orderClips moved to finalizeJob, and
    // normalizeClipConfig is owned by loadClipContext.
    const { selectClipMoments, expandMomentsToCount, shouldCrossVideoFill, snapEndToWordBoundary } = await import("../lib/server/clipMomentSelector");
    const { genreScore } = await import("../lib/builder/clipGenres");

    // The video routes (and now the gated clipJobs/usage mutations) authenticate
    // server-to-server with the internal secret. globalThis: this action is
    // exported as `process`, which shadows Node's global of the same name.
    const authSecret = globalThis.process.env.INTERNAL_CRON_SECRET ?? "";
    const set = (patch: Record<string, unknown>) =>
      ctx.runMutation(api.clipJobs.setStatus, { jobId, ...patch, authSecret } as { jobId: typeof jobId; status?: string; authSecret: string });
    // Live progress line → the run-log box. ALSO bumps updatedAt (reaper heartbeat),
    // so a long step (download poll, transcribe fan-out, clip loop) keeps the row
    // fresh and visible instead of looking dead. Best-effort: a log write must never
    // fail the run, so swallow errors.
    const logp = (phase: string, note: string, pct?: number) =>
      ctx.runMutation(api.clipJobs.appendLog, { jobId, phase, note, ...(pct != null ? { pct } : {}), authSecret })
        .catch((e) => { console.warn(`[clipJobs] appendLog failed: ${e instanceof Error ? e.message : e}`); });
    // FAIL-FAST on the #1 prod misconfig: if NEXT_PUBLIC_APP_URL is unset in the
    // CONVEX deployment env, baseUrl falls back to localhost and EVERY server-to-
    // server call below fails as a confusing "download failed"/timeout. Diagnose it
    // once, here, instead of fanning out doomed calls.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(String(baseUrl))) {
      await set({ status: "error", error: "NEXT_PUBLIC_APP_URL not set in the Convex deployment env — the cloud clip path needs a public URL Convex can call back to." });
      return null;
    }
    // HANG-VECTOR GUARD: every outbound hop carries an AbortController timeout so a
    // stalled route (transcribe, render, run-task) can NEVER hang the action and
    // strand the job on "transcribing"/"posting". On timeout (or any network error)
    // we resolve to the SAME {ok:false,error} shape the callers already branch on as
    // failure — so a timeout flows into the existing failure/release path, never a
    // hung state. timeoutMs is per-call (transcribe is long, auto-post is short).
    const DEFAULT_POST_TIMEOUT_MS = 120_000;
    const post = (path: string, body: unknown, timeoutMs: number = DEFAULT_POST_TIMEOUT_MS) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      return appFetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The video routes are auth-gated (requireInternalOrUserAuth) — this
          // server-to-server hop authenticates with the internal secret.
          // globalThis: the surrounding action is exported as `process`, which
          // shadows Node's global of the same name.
          ...(globalThis.process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": globalThis.process.env.INTERNAL_CRON_SECRET } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }, { preferredOrigin: appUrl })
        .then(async (r) => {
          // A non-OK upstream (proxy 502/504, gateway timeout) often returns a
          // NON-JSON body like "upstream error" — r.json() on that throws
          // "Unexpected token 'u', \"upstream error\" is not valid JSON", which then
          // becomes the job's confusing error. Read text first and surface a clean
          // message so the run card shows "upstream error (HTTP 502)…" instead.
          const text = await r.text();
          try { return JSON.parse(text); }
          catch {
            const snip = text.trim().slice(0, 120) || `HTTP ${r.status}`;
            return { ok: false, error: r.ok ? `non-JSON response from ${path}: ${snip}` : `upstream error (HTTP ${r.status}) from ${path}: ${snip}` };
          }
        })
        .catch((e) => {
          const aborted = e instanceof Error && (e.name === "AbortError" || controller.signal.aborted);
          return { ok: false, error: aborted ? `timeout after ${timeoutMs}ms calling ${path}` : (e instanceof Error ? e.message : String(e)) };
        })
        .finally(() => clearTimeout(timer));
    };

    // Whole-source AUDIO via the async download path (off the 290s request wall).
    // A Drive campaign source is multi-GB/multi-hour; the synchronous
    // /api/video/download is bounded by the route's ~300s + this action's 290s
    // AbortController, which a slow Drive pull blows past → "timeout after
    // 290000ms calling /api/video/download". download-start runs the (now
    // video-stripped, audio-only) pull in the persistent Node process; we poll
    // download-status until it finishes. No 290s wall, any source size.
    const downloadAudioAsync = async (
      sourceUrl: string,
      mintAddress?: string,
    ): Promise<{ ok: boolean; url?: string; durationSeconds?: number; storageId?: string; error?: string }> => {
      const started = await post("/api/video/download-start", { sourceUrl, mode: "audio", ...(mintAddress ? { mintAddress } : {}) }, 60_000);
      const dlJobId = (started as { jobId?: string }).jobId;
      if (!started.ok || !dlJobId) return { ok: false, error: started.error ?? "download-start failed to enqueue" };
      const headers: Record<string, string> = globalThis.process.env.INTERNAL_CRON_SECRET
        ? { "X-Internal-Secret": globalThis.process.env.INTERNAL_CRON_SECRET }
        : {};
      const deadline = Date.now() + ASYNC_DL_MAX_MS;
      for (;;) {
        await new Promise((r) => setTimeout(r, ASYNC_DL_POLL_MS));
        if (Date.now() > deadline) {
          return { ok: false, error: `audio download exceeded ${Math.round(ASYNC_DL_MAX_MS / 60000)} min — source too large/slow` };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        let st: { status?: string; url?: string; durationSeconds?: number; error?: string;
                  progress?: { pct: number; downloadedBytes: number; totalBytes: number; speed?: string } };
        try {
          const r = await appFetch(`/api/video/download-status?jobId=${encodeURIComponent(dlJobId)}`, { headers, signal: controller.signal }, { preferredOrigin: appUrl });
          const text = await r.text();
          try { st = JSON.parse(text); } catch { st = { status: "downloading" }; } // transient non-JSON → keep polling
        } catch {
          st = { status: "downloading" }; // a transient poll error is non-fatal — keep polling until the deadline
        } finally {
          clearTimeout(timer);
        }
        // Surface live download progress (and HEARTBEAT updatedAt) so a multi-GB pull
        // is visible second-by-second instead of a frozen "downloading". download-status
        // already returns `progress` (from download-start's setProgress) — previously discarded.
        const p = st.progress;
        await logp("downloading", p
          ? `Downloading ${Math.round(p.pct)}% (${(p.downloadedBytes / 1e6).toFixed(0)}/${(p.totalBytes / 1e6).toFixed(0)} MB${p.speed ? " @ " + p.speed : ""})`
          : "Downloading source…", p ? Math.round(p.pct) : undefined);
        if (st.status === "done" && st.url) return { ok: true, url: st.url, durationSeconds: st.durationSeconds };
        if (st.status === "error") return { ok: false, error: st.error ?? "download failed" };
        // else still "downloading" → poll again
      }
    };

    // DROPPED-EARNING surfacing: a post landed but its reward/campaign submission
    // failed (e.g. a swallowed 401/404). Log at ERROR level with the content link +
    // reason, and stamp a visible, append-only marker on the job's `error` field so
    // it's debuggable in the UI — WITHOUT touching the job status (the run is not
    // blocked; the clip is already posted). Best-effort: the marker write itself
    // never throws into the loop.
    const recordDroppedEarning = async (target: string, clipUrl: string, reason: string) => {
      const note = `dropped earning: ${target} submit failed for ${clipUrl} — ${reason}`;
      console.error(`[clipJobs] ${note}`);
      try {
        const cur = await ctx.runQuery(api.clipJobs.getJob, { jobId });
        const prev = cur?.error ? `${cur.error}\n` : "";
        await ctx.runMutation(api.clipJobs.setStatus, { jobId, status: cur?.status ?? "posting", error: `${prev}${note}`, authSecret });
      } catch { /* best-effort marker — never break the run */ }
    };
    // Positive twin of recordDroppedEarning: stamp a "submitted to campaign ✓" note
    // on the job's marker log (the same append-only `error` field — it's only shown
    // red when status==="error", which this never sets) so the canvas run log can
    // confirm the auto-submit landed. Best-effort.
    const recordSubmitted = async (target: string, clipUrl: string) => {
      // `target` already names the kind ("campaign <id>" / "content-reward <id>") —
      // don't hardcode "campaign" (that mislabeled content-reward submits).
      const note = `submitted to ${target} ✓ ${clipUrl}`;
      console.log(`[clipJobs] ${note}`);
      try {
        const cur = await ctx.runQuery(api.clipJobs.getJob, { jobId });
        const prev = cur?.error ? `${cur.error}\n` : "";
        await ctx.runMutation(api.clipJobs.setStatus, { jobId, status: cur?.status ?? "posting", error: `${prev}${note}`, authSecret });
      } catch { /* best-effort */ }
    };

    const job = await ctx.runQuery(api.clipJobs.getJob, { jobId });
    if (!job) return null;

    try {
      // Agent / config / wired-skill rows / planner-shaped skills (+ caption prompt
      // & transformer) — shared with finalizeJob (which re-derives them in a later
      // chained action). `skills` is shipped to the batch route for per-clip planning.
      const cc = await loadClipContext(ctx, jobId);
      if (!cc) return null; // job vanished between the outer get and here
      const { agent, config, wiredFiles, skills } = cc;

      // Publish the operator's requested count BEFORE download/transcription.
      // The UI can now render every requested clip as a live placeholder while
      // the analyzer is still selecting moments, rather than showing an empty
      // queue until the much later cut stage inserts the real clip rows.
      if (!config.autoPlan) {
        await set({
          clipsTotal: Math.max(1, Math.round(config.maxClipsPerSource || 1)),
          clipsReady: 0,
        });
      }

      // Per-skill load report → run log. Names each wired skill and FLAGS any that
      // will silently no-op because its node wasn't configured (the #1 "I wired it
      // but nothing happened" cause — e.g. Brain Rot with no background picked, which
      // the planner skips by design at clipEditPlanner.ts:242). Pure logging.
      if (skills.length) {
        await logp("downloading", `Loading ${skills.length} skill${skills.length === 1 ? "" : "s"}: ${skills.map((s: { name?: string; skillId: string }) => s.name || s.skillId).join(", ")}`);
        for (const s of skills) {
          const sk = s as { skillId: string; name?: string; bgId?: string; sfxId?: string; audioUrl?: string; stickerStyleId?: string; stickerPrompt?: string; musicTrackId?: string; autoMusic?: boolean };
          const nm = sk.name || sk.skillId;
          if (sk.skillId === "clip.brainrot" && !globalThis.process.env.GAMEPLAY_PACK_BASE_URL)
            await logp("downloading", `⚠ ${nm} won't apply — gameplay pack not configured (set GAMEPLAY_PACK_BASE_URL)`);
          else if (sk.skillId === "clip.memeaudio" && !sk.sfxId && !sk.audioUrl && !globalThis.process.env.REACTION_SFX_BASE_URL)
            await logp("downloading", `⚠ ${nm} won't apply — no sound configured + SFX pack unset (REACTION_SFX_BASE_URL)`);
          else if (sk.skillId === "clip.trendingaudio" && !globalThis.process.env.TRENDING_AUDIO_BASE_URL)
            await logp("downloading", `⚠ ${nm} won't apply — music pack not configured (set TRENDING_AUDIO_BASE_URL)`);
          else if (sk.skillId === "clip.trendingaudio" && !sk.musicTrackId && sk.autoMusic !== true)
            await logp("downloading", `⚠ ${nm} won't apply — no track picked and auto-pick is off`);
          else if (sk.skillId === "clip.sticker" && !sk.stickerStyleId && !sk.stickerPrompt)
            await logp("downloading", `⚠ ${nm} won't apply — no sticker style selected`);
          else
            await logp("downloading", `✓ ${nm} ready`);
        }
      }

      // Skills-only pricing: this run is billed once per installed+priced skill
      // (render + transcription compute is absorbed into that margin, not metered
      // separately). "Installed" is the cloud path's notion of "wired"; unknown /
      // unpriced ids fall out via the `in` filter and cost $0. clip.prompt is not
      // special-cased — its markdown is the active steering prompt and it's charged
      // like any other priced skill when installed.
      const wiredSkillIds = [...new Set(wiredFiles.map((s: { skillId: string }) => s.skillId).filter((id: string) => id in CLIP_SKILL_PRICE_USDC))];

      // Sync the escrow MIRROR to real on-chain USDC BEFORE the spendable gate. The
      // cloud path (run-task → enqueue) otherwise reads a $0 mirror for a freshly
      // on-chain-funded agent and false-denies "needs funding — available $0.00"
      // (the canvas clip-precheck reconciles; this path never did). Best-effort: a
      // failure falls through to the gate below, which is itself the money-safe backstop.
      await post("/api/economy/reconcile", { mintAddress: job.mintAddress }).catch(() => {});

      // Pre-validate the FULL run cost against spendable + daily headroom BEFORE
      // charging any skill. Otherwise a mid-loop denial (daily_cap reached after
      // skill 1, or spendable below the next fee) would bill the earlier skills for a
      // run that does ZERO clipping work. Mirrors the clip-precheck (canvas) gate.
      // Estimate the run cost honoring admin price overrides so the pre-flight
      // funding gate matches what the per-skill recordUsage charge (which reads
      // the same override) will actually bill. Best-effort: on a read failure fall
      // back to static defaults — recordUsage below re-gates authoritatively.
      let priceOverrides: Record<string, number> = {};
      try { priceOverrides = (await ctx.runQuery(api.adminPricing.effectiveSkillPrices, {})).overrides; }
      catch (e) { console.warn(`[clipJobs] price-override read failed (using static defaults): ${e instanceof Error ? e.message : e}`); }
      const estRunCostUsdc = clipSkillRunCostWithOverrides(wiredSkillIds as string[], priceOverrides);
      if (estRunCostUsdc > 0) {
        try {
          const account = await ctx.runQuery(api.agentAccount.getWithNav, { mintAddress: job.mintAddress });
          const today = await ctx.runQuery(api.usage.todaysSpendQuery, { mintAddress: job.mintAddress });
          // recordUsage spends the OWNER'S prepaid credits before the agent's own
          // USDC, so this gate must count both pools — gating on agent USDC alone
          // hard-denied every credit-funded run before a charge was ever tried.
          const creditsBalance = await ctx.runQuery(api.userCredits.balanceForMint, { mintAddress: job.mintAddress });
          if (account) {
            const spendable = effectiveSpendableUsdc(account, creditsBalance);
            const dailyRemaining = +(today.capUsdc - today.spentTodayUsdc).toFixed(6);
            const deny =
              account.status === "suspended" ? "agent suspended"
              : spendable < estRunCostUsdc ? `needs funding — run costs ~$${estRunCostUsdc.toFixed(2)}, available $${spendable.toFixed(2)}`
              : (today.capUsdc > 0 && dailyRemaining < estRunCostUsdc) ? `daily cap reached — run costs ~$${estRunCostUsdc.toFixed(2)}, $${dailyRemaining.toFixed(2)} left today`
              : null;
            if (deny) { await set({ status: "error", error: `${deny} — fund the agent or raise the daily cap` }); return null; }
          }
        } catch (e) {
          // Pre-check read failed — fall through to the per-skill charge loop, which is
          // itself money-safe (it denies before any heavy work).
          console.warn(`[clipJobs] run-cost precheck failed (continuing to per-skill gate): ${e instanceof Error ? e.message : e}`);
        }
      }

      // Charge once per job, BEFORE the heavy work, so a needs_funding/daily_cap
      // denial stops the run before any compute is spent. Idempotent per
      // (mintAddress, `${jobId}:skill:${skillId}`) so an action retry never
      // double-bills (a duplicate returns the prior charge). Mirrors clip-precheck.
      // FAIL CLOSED on an UNRESOLVED charge. recordUsage has two non-ok shapes and
      // they are NOT symmetric: a clean {ok:false} is a DENIAL (funds/cap/suspended);
      // a THROW is unresolved billing (no agentAccount row — usage.ts:235, reachable
      // because the run-cost precheck above SKIPS its deny when getWithNav is null —
      // plus secret misconfig / transient Convex infra). The old code swallowed the
      // throw and PROCEEDED, delivering a wired skilled render for $0. Mirror the
      // /api/video/clip #23 backstop (503 billing_unavailable): a thrown charge aborts
      // the render. decideSkillChargeGate stops at the first non-ok skill, so we void
      // only what was actually charged.
      const gate = await decideSkillChargeGate(wiredSkillIds as string[], (skillId) =>
        ctx.runMutation(api.usage.recordUsage, { mintAddress: job.mintAddress, service: skillId, qty: 1, idemKey: `${jobId}:skill:${skillId}`, authSecret }),
      );
      if (gate.decision === "deny") {
        // A mid-loop denial (e.g. a daily-cap race after skill 1) leaves the EARLIER
        // skills of this run charged for zero clipping work — void them.
        await set({ status: "error", error: `skill fee denied (${gate.reason}) — fund the agent or raise the daily cap` });
        await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
        return null;
      }
      if (gate.decision === "abort") {
        // The charge THREW → billing is unresolved. Fail closed: refund anything this
        // run already charged and mark the job terminal rather than render unbilled.
        // Worst case this blocks a legitimate run during a transient economy outage —
        // the correct fail-closed tradeoff for a paid render (the user retries).
        console.error(`[clipJobs] skill fee ${gate.skillId} threw (${gate.error}) — failing closed (billing_unavailable), not rendering`);
        await set({ status: "error", error: "billing unavailable — could not charge skill fees; fund the agent and retry" });
        await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
        return null;
      }

      // ── UGC RUN ("No clip / UGC needed") ────────────────────────────────────
      // The operator supplied the footage, so there is NOTHING to clip: skip the
      // source download, the transcription and the moment analysis outright, and go
      // straight to rendering one output per requested clip from the uploads. Doing
      // this here — after the skill charge, before any pull — is what makes the run
      // cheap and fast instead of paying to transcribe a source it never uses.
      // Every other app still applies: hook videos, captions, filters, CTA.
      if (config.mainOnly && (config.mainVideos?.length ?? 0) > 0) {
        const pool = config.mainVideos as string[];
        // Clip count still rules (the pool cycles to fill it); "Let AI decide" has no
        // analysis to decide from here, so it means "one per uploaded video".
        const { ugcOutputCount } = await import("../lib/builder/clipPools");
        const count = ugcOutputCount({ poolSize: pool.length, maxClipsPerSource: config.maxClipsPerSource, autoPlan: config.autoPlan, autoPlanMaxClips: config.autoPlanMaxClips });
        await logp("clipping", `No clip / UGC needed — using ${pool.length} uploaded video${pool.length === 1 ? "" : "s"} for ${count} post${count === 1 ? "" : "s"} (no source download, no transcription)`);
        await set({ status: "clipping", clipsTotal: count, clipsReady: 0 });

        const ugcClipIds: string[] = [];
        for (let i = 0; i < count; i++) {
          const id = await ctx.runMutation(api.clipJobs.insertClip, {
            jobId, mintAddress: job.mintAddress,
            title: `Upload ${i + 1}`,
            reason: "Uploaded main content (No clip / UGC needed)",
            // The real window is the uploaded file's own length, which only the
            // renderer can probe; 0..0 marks "whole file" for the batch route.
            startSeconds: 0, endSeconds: 0, viralScore: 50, captionText: "",
            authSecret,
          });
          ugcClipIds.push(id);
        }

        const ugcDeadline = Date.now() + CLIP_CUT_MAX_MS;
        // Poller first — it persists durably, so an evicted action still gets its
        // clips finalized (same ordering rationale as the normal cut stage).
        await ctx.scheduler.runAfter(CLIP_CUT_POLL_MS, internal.clipJobs.cutPoll, { jobId, kieApiKey, appUrl, deadlineMs: ugcDeadline });
        const ugcBatch = await post("/api/video/clip-batch-start", {
          jobId,
          // No source is pulled in this mode; the field stays populated so the batch's
          // shared validation (and the clip rows' provenance) are unchanged.
          sourceUrl: job.sourceUrl,
          kieApiKey,
          skills,
          config,
          context: clipContextFor(agent, job),
          segments: [],
          words: [],
          clips: ugcClipIds.map((clipId, i) => ({
            clipId,
            moment: { startSeconds: 0, endSeconds: 0, title: `Upload ${i + 1}`, reason: "Uploaded main content", viralScore: 50, captionText: "" },
          })),
          deadlineMs: ugcDeadline,
        }, 60_000);
        if (!ugcBatch.ok) await logp("clipping", `clip batch start: ${String(ugcBatch.error ?? "unknown").slice(0, 120)} — polling for results`);
        return null; // cutPoll + finalizeJob own the rest
      }

      // 1. Download AUDIO ONLY. The full-video pull times out on 3-4h sources (even
      // at 290s); the audio-only file is tiny and transcribes the whole source. Per-
      // clip VIDEO is pulled segment-by-segment in the clip loop below (mode:"segment").
      // The /api/video/download route's maxDuration is 300s, so give the call ~290s
      // (just under the route's hard cap so we surface a clean "timeout" rather than a
      // route kill) — audio of a 3-4h source can still be a slow yt-dlp pull. On
      // timeout the wrapper returns {ok:false,error:"timeout…"} → the failure branch.
      await set({ status: "downloading" });
      await logp("downloading", "Starting source download…", 0);
      // FAIL-FAST defense-in-depth: a YouTube CHANNEL/PLAYLIST link must NEVER reach the
      // single-video download rail below — yt-dlp would try to walk the whole collection
      // and the 290s synchronous audio pull aborts (the "1% · Starting source download"
      // hang). The enqueue boundary (app/api/agents/run-task) already expands a collection
      // to its top video via resolveSourceUrl, but guard here too so any other enqueue
      // path (or a job queued before that fix) fails cleanly instead of stalling. Uses the
      // pure, dependency-free classifier so no Node deps leak into this Convex bundle.
      if (isYoutubeCollection(job.sourceUrl)) {
        const emsg = "Contents not enough — a channel/playlist link can't be clipped directly; pick a single video.";
        await set({ status: "error", error: emsg });
        await logp("error", emsg);
        await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
        return null;
      }
      // Drive sources are multi-GB/multi-hour — pull the whole-source AUDIO off the
      // request thread (download-start + poll) so a slow pull can't hit the
      // synchronous route's ~300s wall ("timeout after 290000ms"). Other sources
      // keep the fast synchronous path (social audio is a tiny yt-dlp `ba` pull;
      // direct links are small).
      const isDriveSource = /^https?:\/\/(?:drive|docs)\.google\.com\//i.test(job.sourceUrl);
      const dl = await prepareClipSource({
        lookupFull: () => ctx.runQuery(api.downloadCache.getByKey, { sourceUrl: job.sourceUrl, mode: "full", sectionKey: "" }),
        onReuse: () => logp("downloading", "Using your downloaded video — skipping source download", 100),
        downloadAudio: () => isDriveSource
          ? downloadAudioAsync(job.sourceUrl, job.mintAddress)
          : post("/api/video/download", { sourceUrl: job.sourceUrl, mode: "audio", mintAddress: job.mintAddress }, 290_000),
      });
      if (!dl.ok) {
        // Map the raw yt-dlp/proxy/route error into an ACTIONABLE operator reason
        // (e.g. proxy out of bandwidth → top up / use Drive) instead of storing a
        // bare "download failed". The downloader's own rich "…Fix:…" messages are
        // preserved verbatim by the mapper (see lib/clip/failure.ts).
        const emsg = explainClipFailureLine(dl.error ?? "download failed");
        await set({ status: "error", error: emsg });
        await logp("error", emsg);
        await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
        return null;
      }
      // The AUDIO blob this job minted — deleted at the very end (after the clip
      // loop). Each job mints its own, so deleting it can't orphan another job.
      // (The async Drive path doesn't surface a storageId — its tiny mp3 is left to
      // best-effort GC rather than an explicit delete.)
      const audioStorageId = (dl as { storageId?: string }).storageId;

      // HARD DURATION CAP — a runaway-long source means unbounded transcription chunks +
      // render time (timeouts, 502s, cost) that can wedge the backend. Cap PASTED/UPLOADED
      // sources; CAMPAIGN + reward jobs are EXEMPT (vetted, business-critical, must always
      // run regardless of length). Env-tunable (MAX_SOURCE_SECONDS), default 3h.
      const MAX_SOURCE_SECONDS = Number(globalThis.process?.env?.MAX_SOURCE_SECONDS) || 3 * 3600;
      const isCampaignJob = !!job.campaignId || !!job.contentRewardId;
      if (!isCampaignJob && (dl.durationSeconds ?? 0) > MAX_SOURCE_SECONDS) {
        await set({ status: "error", error: `Source is ~${(dl.durationSeconds / 3600).toFixed(1)}h long — pasted/uploaded sources are capped at ${Math.round(MAX_SOURCE_SECONDS / 3600)}h to keep the pipeline reliable. Clip a shorter section, or use a Campaign source (no cap).` });
        await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
        return null;
      }

      await logp("downloading", `Source ready — ~${Math.round((dl.durationSeconds ?? 0) / 60)} min${isDriveSource ? ", Google Drive" : ""}${isCampaignJob ? ", campaign source" : ""}`);

      // Base clipping fee — priced by SOURCE LENGTH now that duration is known
      // (OpusClip-style; see CLIP_SOURCE_MINUTE_ID in servicePrices.ts). Charged
      // here, not in the up-front skill-fee loop above, because that loop runs
      // BEFORE the source is downloaded and durationSeconds isn't known yet.
      // Uses the identical charge/deny/abort machinery as a wired marketplace
      // skill (decideSkillChargeGate + the `:skill:` idemKey prefix) so this
      // fee is refunded automatically by refundRunFeesIfNoClips on a 0-clip run,
      // for free, via the exact same code path.
      {
        const minutes = Math.max(1, Math.ceil((dl.durationSeconds ?? 0) / 60));
        const durationGate = await decideSkillChargeGate([CLIP_SOURCE_MINUTE_ID], (skillId) =>
          ctx.runMutation(api.usage.recordUsage, {
            mintAddress: job.mintAddress, service: skillId, qty: minutes,
            idemKey: `${jobId}:skill:${skillId}`, authSecret,
          }),
        );
        if (durationGate.decision === "deny") {
          // Say it in the operator's terms (most are new, credit-funded accounts):
          // how long the video is, what it costs, what they have, what to do.
          const needCredits = Math.round(minutes * (CLIP_SKILL_PRICE_USDC[CLIP_SOURCE_MINUTE_ID] ?? 0.02) * 100);
          const haveCredits = await ctx.runQuery(api.userCredits.balanceForMint, { mintAddress: job.mintAddress }).catch(() => null);
          const why = durationGate.reason === "daily_cap"
            ? `This agent hit its daily spending cap. Raise the cap in the Budget settings, or try again tomorrow.`
            : `This video is ~${minutes} min, which costs ${needCredits} credits to clip${typeof haveCredits === "number" ? ` and you have ${haveCredits}` : ""}. Add credits, or clip a shorter video (or a shorter section of it).`;
          await set({ status: "error", error: why });
          await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
          return null;
        }
        if (durationGate.decision === "abort") {
          console.error(`[clipJobs] duration fee threw (${durationGate.error}) — failing closed (billing_unavailable), not rendering`);
          await set({ status: "error", error: "billing unavailable — could not charge the clip fee; fund the agent and retry" });
          await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
          return null;
        }
      }

      await ctx.runMutation(api.clipJobs.setStatus, { jobId, status: "transcribing", durationSeconds: dl.durationSeconds, authSecret });
      {
        const _td = dl.durationSeconds ?? 0;
        await logp("transcribing", _td > CHUNK_THRESHOLD_SECONDS
          ? `Transcribing ~${Math.round(_td / 60)} min source in ${Math.ceil(_td / CHUNK_SECONDS)} windows…`
          : "Transcribing…");
      }

      // 2. Transcribe
      // Transcription compute itself is absorbed into the per-minute clip fee
      // charged above — it is what that fee is actually pricing.
      // campaignSource (Feature E): a campaign- OR reward-driven job caches its
      // transcript in the shared master cache; an ad-hoc user job does not. Both
      // a Convex campaignId AND a Stage contentRewardId count (a reward-only job
      // was wrongly treated as non-cacheable → re-transcribed every run).
      // Transcription can be long (full-source STT) — give it 240s. On timeout the
      // wrapper returns {ok:false,error:"timeout…"} which falls into the existing
      // "no transcript" failure branch below → job goes to "error", never hung.
      //
      // SHORT path (source fits one window): the IDENTICAL single call as before —
      // same body, same 240s timeout, same {analysis} reuse. No extra latency.
      // LONG path (>~14 min): a single request can't finish a multi-hour transcribe
      // under the route's 300s maxDuration, so fan out PARALLEL range requests and
      // stitch here. See the CHUNK_* constants above.
      const campaignSource = !!job.campaignId || !!job.contentRewardId;
      type Seg = { start: number; end: number; text: string };
      type Word = { word: string; start: number; end: number };
      type SttResult = {
        ok: boolean; error?: string;
        segments?: Seg[]; words?: Word[]; durationSeconds?: number;
        analysis?: { moments?: ClipMoment[] } | unknown;
        /** ISO 639-1 the STT decoded (route detects it; see transcribe-clip). */
        language?: string;
      };
      let stt: SttResult;

      const totalDur = dl.durationSeconds ?? 0;
      if (totalDur <= CHUNK_THRESHOLD_SECONDS) {
        // ── SHORT path — byte-for-byte today's behavior ──
        stt = await post("/api/video/transcribe-clip", { sourceUrl: job.sourceUrl, audioUrl: dl.url, campaignSource }, 240_000);
      } else {
        // ── LONG path — fan-out → stitch → analyze → cache ──
        // 1) Cache probe (no transcribe). A 4h campaign source transcribed once is
        //    reused FREE by every agent — the whole point of the shared cache.
        let cacheHit: SttResult | null = null;
        if (campaignSource) {
          const probe = await post("/api/video/transcribe-clip", { sourceUrl: job.sourceUrl, audioUrl: dl.url, campaignSource, cacheOnly: true }, 60_000);
          if (probe.ok && probe.miss !== true && Array.isArray(probe.segments) && probe.segments.length > 0) {
            cacheHit = probe as SttResult; // full transcript + analysis, identical to the short path's shape
          }
        }
        if (cacheHit) {
          stt = cacheHit;
        } else {
          // 2) Build overlapping windows. Chunk i covers
          //    [i*CHUNK - (i>0?OVERLAP:0), min((i+1)*CHUNK, totalDur)].
          const chunkCount = Math.ceil(totalDur / CHUNK_SECONDS);
          const windows: { i: number; start: number; end: number }[] = [];
          for (let i = 0; i < chunkCount; i++) {
            const start = i === 0 ? 0 : i * CHUNK_SECONDS - OVERLAP_SECONDS;
            const end = Math.min((i + 1) * CHUNK_SECONDS, totalDur);
            if (end > start) windows.push({ i, start, end });
          }

          // 3) Fan out with bounded concurrency + per-chunk action-level retries.
          //    Each request: same dl.url audio, trimmed in-route to its window,
          //    returns SLICE-LOCAL timestamps (0 = window start).
          type ChunkResult = { i: number; ok: true; segments: Seg[]; words: Word[]; language?: string }
            | { i: number; ok: false; error: string };
          // LANGUAGE PIN (the Malay-captions fix): every window is a SEPARATE STT
          // request, so each one auto-detects on its own — a Malay source could come
          // back Malay for minutes 0-12, Indonesian for 12-24, and English (translated!)
          // for 24-36, stitched into captions that switch language mid-video. The first
          // window resolves the language; the rest are pinned to it.
          let pinnedLanguage = "";
          const transcribeWindow = async (w: { i: number; start: number; end: number }): Promise<ChunkResult> => {
            let lastErr = "unknown error";
            for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
              const r = await post("/api/video/transcribe-clip",
                { sourceUrl: job.sourceUrl, audioUrl: dl.url, campaignSource, range: { start: w.start, end: w.end },
                  ...(pinnedLanguage ? { languageCode: pinnedLanguage } : {}) },
                CHUNK_TIMEOUT_MS);
              if (r.ok && Array.isArray(r.segments) && r.segments.length > 0) {
                return { i: w.i, ok: true, segments: r.segments as Seg[], words: (r.words ?? []) as Word[], language: typeof r.language === "string" ? r.language : undefined };
              }
              lastErr = r.error ?? (r.ok ? "empty transcript for chunk" : "chunk request failed");
              if (attempt < CHUNK_RETRIES) await new Promise((rs) => setTimeout(rs, 5000 * (attempt + 1)));
            }
            return { i: w.i, ok: false, error: lastErr };
          };

          const results: ChunkResult[] = new Array(windows.length);
          // Window 0 runs ALONE first purely to resolve the language; the remaining
          // windows then fan out with it pinned. Costs one window of serialisation
          // (the first chunk had to run anyway) and buys a single-language transcript.
          results[0] = await transcribeWindow(windows[0]);
          const firstOk = results[0].ok ? results[0] : null;
          if (firstOk?.language) {
            pinnedLanguage = firstOk.language;
            if (windows.length > 1) console.log(`[clipJobs] transcript language ${pinnedLanguage} — pinned for the remaining ${windows.length - 1} window(s)`);
          }
          let next = 1;
          const worker = async () => {
            for (;;) {
              const idx = next++;
              if (idx >= windows.length) return;
              results[idx] = await transcribeWindow(windows[idx]);
            }
          };
          await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(0, windows.length - 1)) }, () => worker()));

          // 4) FAIL THE JOB if ANY chunk ultimately failed. A silent gap would
          //    produce mis-timed clips for that region and a misleading "success".
          //    (Alternative — proceed on the non-empty subset like the route's own
          //    okChunks — is intentionally NOT used here: paid auto-clipping must not
          //    ship clips cut from a gapped transcript.)
          //    Indexed by ARRAY POSITION (results[idx] ↔ windows[idx]) so it stays
          //    correct regardless of the window's `i` field.
          const failedIdx = results.findIndex((r) => !r.ok);
          if (failedIdx >= 0) {
            const fr = results[failedIdx] as { ok: false; error: string };
            const w = windows[failedIdx];
            const minX = Math.floor(w.start / 60), minY = Math.ceil(w.end / 60);
            await set({ status: "error", error: `transcription failed for chunk ${failedIdx + 1}/${windows.length} (minutes ${minX}–${minY}): ${fr.error} — re-run to retry` });
            await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
            return null;
          }

          // 5) Stitch: offset each slice-local result by its window start, dedup the
          //    overlap region (drop anything fully inside the already-accepted span,
          //    clamp a straddler). Mirrors the route's rebase+flatMap+sort, lifted
          //    here and made overlap-aware. The dedup boundary advances to each
          //    accepted window's real `end` (the last window keeps everything).
          const allSegments: Seg[] = [];
          const allWords: Word[] = [];
          let acceptedUpTo = 0;
          const lastIdx = windows.length - 1;
          for (let idx = 0; idx < windows.length; idx++) {
            const w = windows[idx];
            const r = results[idx];
            if (!r.ok) continue; // unreachable (fail-fast above), but keeps the type narrow
            const winStart = w.start;
            for (const s of r.segments) {
              let start = +(s.start + winStart).toFixed(3);
              const end = +(s.end + winStart).toFixed(3);
              if (end <= acceptedUpTo) continue;        // fully inside prev overlap → drop dup
              if (start < acceptedUpTo) start = acceptedUpTo; // straddles boundary → clamp
              allSegments.push({ ...s, start, end });
            }
            for (const word of r.words) {
              const start = Math.max(0, +(word.start + winStart).toFixed(3));
              const end = Math.max(0, +(word.end + winStart).toFixed(3));
              if (end <= acceptedUpTo) continue;        // dedup overlap word
              allWords.push({ ...word, start, end });
            }
            acceptedUpTo = Math.max(acceptedUpTo, idx === lastIdx ? Infinity : w.end);
          }
          allSegments.sort((a, b) => a.start - b.start);
          allWords.sort((a, b) => a.start - b.start);
          if (allSegments.length === 0) {
            await set({ status: "error", error: "no transcript (all chunks empty)" }); await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret); return null;
          }

          // 6) Analyze ONCE on the FULL stitched transcript (per-chunk analyses are
          //    per-slice and meaningless across chunks). Same module the route uses.
          const { analyzeTranscript } = await import("../lib/server/clipAnalysis");
          const stitched = { durationSeconds: totalDur, segments: allSegments, words: allWords };
          // targetCount lifts the analyzer's DISTINCT-moment ceiling toward the
          // operator's requested clip count (up to 60) on long sources, so the run
          // uses distinct moments before per-moment variations. autoPlan keeps the
          // natural ~30 ceiling.
          const analysis = await analyzeTranscript(stitched, {
            apiKey: kieApiKey,
            autoPlan: config.autoPlan === true,
            ...(config.autoPlan ? {} : { targetCount: Math.max(1, Math.round(config.maxClipsPerSource || 1)) }),
          });

          // 7) Cache the SINGLE full transcript+analysis row (campaign sources only).
          //    The Convex V8 isolate has no node:crypto → can't compute sourceKey or
          //    own the cache write, so hand the stitched result back to the route
          //    (which owns sourceKey + the cache mutations) for the one store.
          if (campaignSource && !analysis.fallback) {
            const stored = await post("/api/video/transcribe-clip",
              { sourceUrl: job.sourceUrl, audioUrl: dl.url, campaignSource, stitchedCachePut: { segments: allSegments, words: allWords, analysis, durationSeconds: totalDur, provider: "kie-gemini", ...(pinnedLanguage ? { language: pinnedLanguage } : {}) } },
              60_000);
            if (!stored.ok || stored.stored === false) {
              console.warn(`[clipJobs] stitched-transcript cache store skipped: ${stored.error ?? stored.reason ?? "unknown"}`);
            }
          }

          // Shape the result EXACTLY like a single route response so :793-817 below
          // are untouched (analysis reuse drives the emotion-aware moment selection).
          stt = { ok: true, segments: allSegments, words: allWords, durationSeconds: totalDur, analysis, ...(pinnedLanguage ? { language: pinnedLanguage } : {}) };
        }
      }

      if (!stt.ok || !Array.isArray(stt.segments) || stt.segments.length === 0) {
        await set({ status: "error", error: stt.error ?? "no transcript" }); await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret); return null;
      }
      const transcript = { durationSeconds: stt.durationSeconds || dl.durationSeconds, segments: stt.segments, words: stt.words ?? [] };
      await logp("transcribing", `Transcribed ${stt.segments.length} segment${stt.segments.length === 1 ? "" : "s"}${stt.words?.length ? `, ${stt.words.length} words` : ""}`);
      // Persist the full plain-text transcript on the job row (the schema field
      // already existed but nothing wrote it) so the Downloads tab can show it —
      // capped well under Convex's 1MB doc limit for a pathological source.
      const transcriptText = stt.segments.map((s: { text: string }) => s.text).join(" ").trim().slice(0, 300_000);
      if (transcriptText) await set({ transcript: transcriptText });

      // NO audio GC here any more: the audio blob is a SHARED downloadCache entry
      // (every download mode is cached per source URL), so deleting it after this
      // job left the cache row pointing at a dead file — every re-run / other agent
      // on the same source then failed "transcription failed … HTTP 404". The
      // mp3 is tiny (16 kHz mono 64 kbps); keeping it is what makes re-runs free.
      void audioStorageId;

      // 3. Select moments — REUSE the one-time cached analysis (stt.analysis) the
      // transcribe step already computed. Its per-moment `emotion` drives the
      // emotion-aware floors (MEME reaction SFX, etc.), and the agent's saved
      // genre/clipFeel re-weight + reorder — exactly what /api/video/plan-moments
      // does for the canvas. Re-running selectClipMoments from the bare transcript
      // (the old behavior) discarded all of that, so MEME SFX + Clip Feel silently
      // no-op'd on every CLOUD auto-clip. Fall back to a live selection only when
      // there is no analysis (e.g. an older cache miss).
      await set({ status: "analyzing" });
      const rawCfg = (agent?.clipConfig ?? {}) as Record<string, unknown>;
      const genre = String(rawCfg.genre ?? "auto").toLowerCase();
      const feel = String(rawCfg.clipFeel ?? "any").toLowerCase();
      const analysisMoments: ClipMoment[] = Array.isArray((stt.analysis as { moments?: ClipMoment[] } | undefined)?.moments)
        ? (stt.analysis as { moments: ClipMoment[] }).moments.filter(
            (m) => m && typeof m.startSeconds === "number" && typeof m.endSeconds === "number",
          )
        : [];
      // Reuse the cached analysis pool when it is healthy. Under autoPlan a SPARSE
      // cached pool (analyzer returned only 1-2 moments) would otherwise cap the run
      // at that count, so fall back to a fresh selectClipMoments (what plan-moments
      // does) whenever the pool is too small to honor "as many as the source supports".
      const wantMany = config.autoPlan === true;
      // The cached analysis is keyed per VIDEO, not per requested count — a pool
      // cached by an earlier 3-clip run (or an LLM-failure "Clip N" fallback) used to
      // be reused for a 15-clip run and padded with same-start "variations", i.e.
      // identical clips. Manual mode now needs the pool to cover the requested count;
      // when it doesn't, re-analyze asking for that many distinct moments.
      const poolTarget = wantMany ? 3 : Math.max(1, Math.round(config.maxClipsPerSource || 1));
      const cachedIsFallback = (stt.analysis as { fallback?: boolean } | undefined)?.fallback === true
        || (analysisMoments.length > 0 && analysisMoments.every((m) => /^Clip \d+$/.test(m.title ?? "")));
      let pool: ClipMoment[] = cachedIsFallback ? [] : analysisMoments;
      if (pool.length < poolTarget) {
        try {
          const { analyzeTranscript } = await import("../lib/server/clipAnalysis");
          const { dedupeOverlappingMoments } = await import("../lib/server/clipMomentSelector");
          await logp("analyzing", `Finding ${poolTarget} distinct moments (cached analysis had ${pool.length})…`);
          const fresh = await analyzeTranscript(transcript, {
            apiKey: kieApiKey,
            autoPlan: wantMany,
            clipLength: config.clipLength,
            // Ask for ~30% more than needed so the overlap prune still leaves enough.
            ...(wantMany ? {} : { targetCount: poolTarget, maxMoments: Math.min(60, Math.max(poolTarget + 3, Math.round(poolTarget * 1.3))) }),
          });
          if (!fresh.fallback) pool = dedupeOverlappingMoments([...pool, ...(fresh.moments as ClipMoment[])]);
        } catch (e) {
          console.warn(`[clipJobs] re-analysis for ${poolTarget} moments failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      let moments: ClipMoment[] = pool.length > 0
        ? [...pool].sort((a, b) => genreScore(b, genre) - genreScore(a, genre))
        : await selectClipMoments(transcript, config, { apiKey: kieApiKey, genre });
      // Clip Feel: moments matching the requested emotion rank FIRST (stable within
      // each group). "any"/unset = no reordering. Mirrors plan-moments.
      if (feel !== "any" && feel.length > 0) {
        const match = moments.filter((m) => (m.emotion ?? "").toLowerCase() === feel);
        if (match.length > 0) moments = [...match, ...moments.filter((m) => (m.emotion ?? "").toLowerCase() !== feel)];
      }

      // ── CROSS-VIDEO FILL (fill-short) ── When this source is genuinely too SHORT
      // to yield even one full (min-length) clip AND it belongs to a multi-video
      // collection, assemble ONE clip that LEADS with the whole short primary then
      // FILLS from sibling videos to reach a full clip. Gated on the short-trigger +
      // a non-empty pool, so a long-enough source (or a single-video job with no pool)
      // NEVER enters here — the default path below is byte-for-byte unchanged. A
      // fill that can't assemble (no usable sibling transcript) FALLS THROUGH to the
      // normal single-video path, so short-source clipping is never broken by this.
      const fillPool = ((job as { poolSourceUrls?: string[] }).poolSourceUrls ?? []).filter((u) => u && u !== job.sourceUrl);
      if (fillPool.length > 0 && shouldCrossVideoFill(transcript.durationSeconds, config)) {
        try {
          const { selectCrossVideoFill, retimeStitchedSegments } = await import("../lib/server/clipMomentSelector");
          const targetLen = Math.max(1, config.clipLength.min);
          const CROSS_FILL_MAX_POOL = Number(globalThis.process?.env?.CROSS_FILL_MAX_POOL) || 4;
          await logp("analyzing", `Source is short (~${Math.round(transcript.durationSeconds)}s) — combining with sibling videos to reach a full clip…`);
          // Transcribe pool members via the SAME cached transcribe route (no re-implemented
          // STT). Stop once we have enough runway to hit targetLen, bounded by the cap.
          type PoolMember = { sourceUrl: string; transcript: { durationSeconds: number; segments: Seg[]; words: Word[] } };
          const poolMembers: PoolMember[] = [];
          let runway = transcript.durationSeconds;
          for (const url of fillPool) {
            if (runway >= targetLen || poolMembers.length >= CROSS_FILL_MAX_POOL) break;
            const r = await post("/api/video/transcribe-clip", { sourceUrl: url, campaignSource }, 240_000);
            if (r.ok && Array.isArray(r.segments) && r.segments.length > 0) {
              const pdur = Number(r.durationSeconds) || (r.segments.at(-1)?.end ?? 0);
              if (pdur > 0.5) {
                poolMembers.push({ sourceUrl: url, transcript: { durationSeconds: pdur, segments: r.segments, words: r.words ?? [] } });
                runway += pdur;
              }
            }
          }
          if (poolMembers.length > 0) {
            const assembled = await selectCrossVideoFill(
              { sourceUrl: job.sourceUrl, transcript },
              poolMembers,
              targetLen,
              { apiKey: kieApiKey, genre },
            );
            // Need the primary lead + at least one fill for a genuine cross-video clip.
            if (assembled.subSegments.length >= 2) {
              // Attach each sub-window's OWN source-absolute transcript slice (words for
              // caption retiming; segments for the retimed edit-planning window).
              const byUrl = new Map(poolMembers.map((p) => [p.sourceUrl, p.transcript]));
              const withData = assembled.subSegments.map((ss) => {
                const src = ss.sourceUrl === job.sourceUrl
                  ? { segments: transcript.segments, words: transcript.words }
                  : byUrl.get(ss.sourceUrl) ?? { segments: [], words: [] };
                return {
                  sourceUrl: ss.sourceUrl, start: ss.start, end: ss.end,
                  words: (src.words ?? []).filter((w) => w.end > ss.start && w.start < ss.end),
                  segments: (src.segments ?? []).filter((s) => s.end > ss.start && s.start < ss.end),
                };
              });
              const stitchedSegments = retimeStitchedSegments(withData.map((s) => ({ start: s.start, end: s.end, segments: s.segments })));
              const totalLen = Math.round(withData.reduce((sum, s) => sum + (s.end - s.start), 0));
              const lead = moments[0];
              const title = lead?.title || "Cross-video clip";
              const reason = lead?.reason || "assembled from a short source + sibling videos";
              const viralScore = lead?.viralScore ?? 60;
              const captionText = lead?.captionText || "";
              // ONE assembled clip row. Its start/end are on the STITCHED timeline
              // (0..totalLen); the actual sub-windows ride the batch payload. Marked
              // via variationLabel (the same provenance field the variation feature uses).
              const clipId = await ctx.runMutation(api.clipJobs.insertClip, {
                jobId, mintAddress: job.mintAddress, title, reason,
                startSeconds: 0, endSeconds: totalLen, viralScore, captionText,
                variationLabel: "Cross-video fill",
                authSecret,
              });
              await set({ status: "clipping", clipsTotal: 1, clipsReady: 0 });
              await logp("clipping", `Filling the ${Math.round(transcript.durationSeconds)}s source to ~${totalLen}s from ${withData.length - 1} sibling video(s) — cutting…`, 0);
              const cutDeadline = Date.now() + CLIP_CUT_MAX_MS;
              // Schedule the poller FIRST (durable) — same ordering as the normal path.
              await ctx.scheduler.runAfter(CLIP_CUT_POLL_MS, internal.clipJobs.cutPoll, { jobId, kieApiKey, appUrl, deadlineMs: cutDeadline });
              const batch = await post("/api/video/clip-batch-start", {
                jobId, sourceUrl: job.sourceUrl, kieApiKey, skills, config, context: clipContextFor(agent, job),
                segments: transcript.segments, words: transcript.words,
                clips: [{
                  clipId,
                  moment: { startSeconds: 0, endSeconds: totalLen, title, reason, viralScore, captionText },
                  assembled: {
                    subSegments: withData.map((s) => ({ sourceUrl: s.sourceUrl, start: s.start, end: s.end, words: s.words })),
                    segments: stitchedSegments,
                  },
                }],
                deadlineMs: cutDeadline,
              }, 60_000);
              if (!batch.ok) await logp("clipping", `clip batch start: ${String(batch.error ?? "unknown").slice(0, 120)} — polling for results`);
              return null; // handled — cutPoll + finalizeJob own the rest
            }
          }
          // No usable fill assembled → fall through to the normal single-video path.
          await logp("analyzing", "Cross-video fill unavailable (no usable sibling transcript) — clipping the short source alone…");
        } catch (e) {
          console.warn(`[clipJobs] cross-video fill skipped: ${e instanceof Error ? e.message : e}`);
          // fall through to the normal single-video path
        }
      }

      // Reach the operator's requested clip count. autoPlan ("Let AI decide") = the
      // analyzer's natural DISTINCT moments, up to autoPlanMaxClips (default 30 —
      // unchanged for every existing/paid agent; /api/agents/config writes a
      // lower value here for free-plan accounts, since autoPlan otherwise had NO
      // cap at all tied to plan/credits — a clip run is priced by source duration
      // and charged once per run, so "let AI decide" on a free account could
      // pull far more clips than its trial credits were ever meant to cover).
      // Manual mode honors the "Number of clips" slider (up to 60, also clamped
      // lower for free accounts by that same route): when it EXCEEDS the
      // distinct-moment pool, expandMomentsToCount reuses each strong moment as
      // several VARIATIONS (rotated hook / caption / length / crop) rather than
      // padding with weaker distinct moments. When the count fits the pool it
      // returns the top-N distinct moments unchanged (identical to the
      // pre-feature slice). PER-SOURCE: this job clips ONE source, so a
      // K-source graph runs K jobs → up to N×K clips overall.
      const requestedCount = config.autoPlan
        ? Math.min(typeof config.autoPlanMaxClips === "number" && config.autoPlanMaxClips > 0 ? config.autoPlanMaxClips : 30, moments.length)
        : Math.max(1, Math.round(config.maxClipsPerSource || 1));
      // Still short of the requested count after re-analysis → add DISTINCT,
      // phrase-bounded windows from parts of the video no pick covers, instead of
      // letting expandMomentsToCount clone moments into same-start variations.
      if (!config.autoPlan && moments.length < requestedCount) {
        const { distinctGapMoments } = await import("../lib/server/clipMomentSelector");
        const extra = distinctGapMoments(moments, requestedCount - moments.length, transcript.segments, config.clipLength);
        if (extra.length > 0) {
          moments = [...moments, ...extra];
          await logp("analyzing", `Added ${extra.length} more distinct moment${extra.length === 1 ? "" : "s"} to reach ${requestedCount}`);
        }
      }
      // NO same-moment "variations": cloning a moment into rotated/re-trimmed
      // copies produced near-identical clips (e.g. 483-516s and 483-521s) that
      // both got POSTED. Operators would rather get fewer clips than repeats, so
      // a run makes at most as many clips as there are DISTINCT moments.
      void expandMomentsToCount;
      let expanded = moments.slice(0, requestedCount)
        .map((m) => ({ ...m, variationIndex: 0 })) as ReturnType<typeof expandMomentsToCount>;
      // Clamp each (variation) window to the operator's configured clip length —
      // parity with /api/video/plan-moments' clampWindow. selectClipMoments already
      // respects config, but REUSED analysis moments carry the analyzer's own 15-60s
      // window, so without this the configured clipLength.min/max is silently ignored
      // on the cloud path (the common cache-hit case). Also guards end > start.
      // Variation sub-windows are already within [min,max], so this is a no-op for them.
      const _durSec = transcript.durationSeconds || 0;
      const _minLen = Math.max(1, config.clipLength.min);
      const _maxLen = Math.max(_minLen, config.clipLength.max);
      const { snapStartToSegmentBoundary, snapEndToSegmentBoundary } = await import("../lib/server/clipMomentSelector");
      expanded = expanded.map((m) => {
        // Open on the first word of the phrase, not mid-sentence.
        let start = Math.max(0, Math.floor(snapStartToSegmentBoundary(transcript.segments, m.startSeconds)));
        let end = Math.ceil(m.endSeconds);
        if (!(end > start)) end = start + _minLen;
        if (end - start < _minLen) {
          end = _durSec > 1 ? Math.ceil(Math.min(_durSec, start + _minLen)) : start + _minLen;
          if (end - start < _minLen) start = Math.max(0, end - _minLen);
        }
        if (end - start > _maxLen) end = start + _maxLen;
        // This clamp is a blind TIME cut (REUSED analysis moments carry the
        // analyzer's own window, resized here to the operator's configured
        // length) — snap it onto a real word boundary so a resize never lands
        // mid-word, the same fix applied at selection time.
        // Finish the phrase (thought) first; fall back to the word-level snap when
        // the cut is already between phrases or the phrase can't fit.
        const phraseEnd = snapEndToSegmentBoundary(transcript.segments, end, { minEnd: start + _minLen, maxEnd: start + _maxLen });
        end = phraseEnd !== end
          ? Math.ceil(phraseEnd)
          : snapEndToWordBoundary(transcript.words, end, { minEnd: start + _minLen, maxEnd: start + _maxLen });
        return { ...m, ...boundCutWindow(start, end, _durSec, { min: _minLen, max: _maxLen }) };
      });
      // Final duplicate guards, AFTER the length clamp (clamping can pull two
      // nearby picks onto the same window):
      //  1. within this run — drop any window overlapping a stronger one by >50%;
      //  2. across runs — drop moments this agent already clipped from the same
      //     source (a re-run / retry of the same link must not re-post them).
      {
        const { dedupeOverlappingMoments } = await import("../lib/server/clipMomentSelector");
        const before = expanded.length;
        expanded = dedupeOverlappingMoments(expanded).sort((a, b) => a.startSeconds - b.startSeconds);
        const prior = await ctx.runQuery(internal.clipJobs.priorClipWindowsForSource, {
          mintAddress: job.mintAddress, sourceUrl: job.sourceUrl, excludeJobId: jobId,
        }).catch(() => [] as Array<{ startSeconds: number; endSeconds: number }>);
        const overlapsPrior = (m: { startSeconds: number; endSeconds: number }) => prior.some((p) => {
          const overlap = Math.min(p.endSeconds, m.endSeconds) - Math.max(p.startSeconds, m.startSeconds);
          const span = Math.max(1, Math.min(p.endSeconds - p.startSeconds, m.endSeconds - m.startSeconds));
          return overlap > 0 && overlap / span > 0.5;
        });
        const fresh = expanded.filter((m) => !overlapsPrior(m));
        const droppedPrior = expanded.length - fresh.length;
        expanded = fresh;
        if (before !== expanded.length) {
          await logp("analyzing", `Skipped ${before - expanded.length} duplicate moment${before - expanded.length === 1 ? "" : "s"}${droppedPrior ? ` (${droppedPrior} already clipped from this video before)` : ""}`);
        }
        if (expanded.length === 0) {
          const msg = prior.length
            ? "Nothing new to clip: every strong moment of this video was already clipped by this agent. Try a different video."
            : "No distinct moments found in this video.";
          await set({ status: "completed", error: msg });
          await logp("completed", msg);
          await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
          return null;
        }
      }
      const clipIds: string[] = [];
      for (const m of expanded) {
        const id = await ctx.runMutation(api.clipJobs.insertClip, {
          jobId, mintAddress: job.mintAddress, title: m.title, reason: m.reason,
          startSeconds: m.startSeconds, endSeconds: m.endSeconds, viralScore: m.viralScore, captionText: m.captionText,
          // Variation provenance so the UI can show "Moment 3 · v2". Only set for
          // actual variations (variationIndex>0) so pristine-cut rows stay identical.
          ...(m.variationIndex > 0 ? { variationIndex: m.variationIndex, variationLabel: m.variationLabel } : {}),
          authSecret,
        });
        clipIds.push(id);
      }

      // 4. CUT STAGE — handed off to the persistent Railway batch process. The
      // whole-source pull + all cuts run OFF the Convex action wall in
      // /api/video/clip-batch-start (ONE pull → ffmpeg input-seek per clip; the
      // per-clip planClipEdits LLM calls run THERE too, not here). This action only
      // inserted the clip rows above — now it kicks the batch, schedules the chained
      // poller, and returns, so no single action ever approaches the ~10min wall.
      await logp("clipping", `Found ${expanded.length} clip-worthy moment${expanded.length === 1 ? "" : "s"} — cutting…`);
      await set({ status: "clipping", clipsTotal: expanded.length, clipsReady: 0 });
      await logp("clipping", `Cutting ${expanded.length} clip${expanded.length === 1 ? "" : "s"} from one stored copy…`, 0);

      // Shared ABSOLUTE deadline for BOTH the batch route and cutPoll, so the batch
      // can't outlive cutPoll's straggler-fail. Pass the FULL transcript (segments +
      // words) + skills + config + kieApiKey so the batch computes each clip's edit
      // plan + cuts from ABSOLUTE windows (the canvas-identical render path).
      const cutDeadline = Date.now() + CLIP_CUT_MAX_MS;
      // Schedule cutPoll FIRST — ctx.scheduler.runAfter persists durably the instant
      // it's called, so even if `process` is evicted during the batch POST below, the
      // poller still runs (its deadline fails the still-"rendering" clips + finalizes).
      // This closes the stranding window where clips could sit "rendering" with no
      // poller. The first tick (+4s) just sees "rendering" and re-polls until results.
      await ctx.scheduler.runAfter(CLIP_CUT_POLL_MS, internal.clipJobs.cutPoll, { jobId, kieApiKey, appUrl, deadlineMs: cutDeadline });
      // Hand the whole batch to /api/video/clip-batch-start: ONE whole-source pull,
      // then cut every clip from that single local file (ffmpeg input-seek) OFF the
      // action wall. The batch computes each clip's edit plan + cuts from ABSOLUTE
      // windows (canvas-identical). A !ok here does NOT prove the batch never started
      // (the 202 may have been sent then the read timed out) — cutPoll covers both.
      const batch = await post("/api/video/clip-batch-start", {
        jobId,
        sourceUrl: job.sourceUrl,
        kieApiKey,
        skills,
        config,
        // Persona + campaign, so a clip with no transcript still gets a caption
        // about SOMETHING, and a label that isn't "Untitled clip".
        context: clipContextFor(agent, job),
        segments: transcript.segments,
        words: transcript.words,
        // Each clip carries a clean ClipMoment window + (for a variation) the per-clip
        // render override: hook/caption merge into ClipConfig, reframeMode forces the
        // reframe op's framing. The pristine cut (variationIndex 0) sends no override,
        // so it renders exactly as before.
        clips: expanded.map((m, i) => ({
          clipId: clipIds[i],
          moment: {
            startSeconds: m.startSeconds, endSeconds: m.endSeconds, title: m.title,
            reason: m.reason, viralScore: m.viralScore, captionText: m.captionText,
            ...(m.emotion ? { emotion: m.emotion } : {}),
          },
          ...(m.variation
            ? {
                configOverride: { hookStyle: m.variation.hookStyle, captionStyle: m.variation.captionStyle },
                reframeMode: m.variation.reframeMode,
              }
            : {}),
        })),
        deadlineMs: cutDeadline,
      }, 60_000);
      if (!batch.ok) {
        await logp("clipping", `clip batch start: ${String(batch.error ?? "unknown").slice(0, 120)} — polling for results`);
      }
      return null; // process ends here — frees the action wall; cutPoll + finalizeJob own the rest

    } catch (err) {
      // Any pipeline throw (download / transcribe / analyze) → map the raw error to
      // an actionable operator reason before it becomes the stored job error.
      await set({ status: "error", error: explainClipFailureLine(err instanceof Error ? err.message : String(err)) });
      // A throw anywhere in `process` (before the cut handoff) aborts the run — void
      // the up-front skill fees if it produced no clips. refundRunFeesIfNoClips no-ops
      // when nothing was charged or when a clip already succeeded.
      await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
    }
    return null;
  },
});

/**
 * cutPoll — chained heartbeat/poller for the off-wall cut stage (mirrors the
 * downloadAudioAsync loop shape: one tick per action, then reschedule). Reads the
 * clip rows the batch route writes back; HEARTBEATS updatedAt each tick so the
 * reaper never kills a live cut and the UI bar advances. When every clip is
 * terminal it hands off to finalizeJob; if the batch is still mid-flight past the
 * SHARED deadline it fails the stragglers then finalizes anyway. Dual backstop: if
 * the chain itself dies (action eviction → no reschedule), updatedAt goes stale and
 * reapStaleJobs (15min) errors the row — no infinite hang either way.
 */
export const cutPoll = internalAction({
  args: { jobId: v.id("clipJobs"), kieApiKey: v.optional(v.string()), appUrl: v.optional(v.string()), deadlineMs: v.number() },
  handler: async (ctx, { jobId, kieApiKey, appUrl, deadlineMs }) => {
    const authSecret = globalThis.process.env.INTERNAL_CRON_SECRET ?? "";
    const clips = await ctx.runQuery(api.clipJobs.getClipsForJob, { jobId });
    const total = clips.length;
    // A clip is TERMINAL once it has a clipUrl OR a failReason — don't trust the
    // status string alone (a swallowed setClip blip in the batch could leave a clip
    // on "rendering" while it actually produced a clipUrl). `pending` = genuinely
    // still rendering with no result yet.
    const isPending = (c: Doc<"clips">) => c.status === "rendering" && !c.clipUrl && !c.failReason;
    const pending = clips.filter(isPending).length;
    const ready = clips.filter((c: Doc<"clips">) => c.status === "ready" || !!c.clipUrl).length;
    // HEARTBEAT ONLY: setStatus bumps updatedAt (keeps the reaper off a live job and
    // advances the UI's clips counter). NO per-tick appendLog — the batch route already
    // appends "Cut N/total" per clip; duplicating it here every 4s floods the run log
    // (and overflowed the bounded log, which froze the UI's run-log stream).
    await ctx.runMutation(api.clipJobs.setStatus, { jobId, status: "clipping", clipsReady: ready, clipsTotal: total, authSecret }).catch(() => {});

    if (pending === 0) {
      await ctx.scheduler.runAfter(0, internal.clipJobs.finalizeJob, { jobId, kieApiKey, appUrl });
      return null;
    }
    if (Date.now() > deadlineMs) {
      // Batch crashed or is genuinely stuck → fail the stragglers, finalize the rest.
      for (const c of clips) {
        if (isPending(c)) {
          await ctx.runMutation(api.clipJobs.setClip, { clipId: c._id, status: "failed", failReason: "cut stage timed out (batch did not finish)", authSecret }).catch(() => {});
        }
      }
      await ctx.scheduler.runAfter(0, internal.clipJobs.finalizeJob, { jobId, kieApiKey, appUrl });
      return null;
    }
    await ctx.scheduler.runAfter(CLIP_CUT_POLL_MS, internal.clipJobs.cutPoll, { jobId, kieApiKey, appUrl, deadlineMs });
    return null;
  },
});

/**
 * finalizeJob — runs ONCE (scheduled by cutPoll) after every clip is terminal:
 * re-derives the per-job context (loadClipContext — it runs in a LATER chained
 * action so nothing from `process` is in scope), then, when auto-post is on,
 * ENQUEUES the top-N ready clips to the drip queue (scheduledContent) on the
 * configured cadence, and finally sets the job completed/error.
 *
 * It no longer posts inline. finalizeJob used to publish every ready clip
 * back-to-back in a tight loop, so an agent configured "Auto-post: one every 2h"
 * fired them all instantly (Bug B). Now it computes staggered `scheduledFor` via
 * the SAME computeScheduleTimes the canvas / Posting-tab schedulers use (so the
 * cloud path honors postIntervalMs / maxPerDay / dailyStartHour) and lets the
 * drip cron (scheduledContent.drainDueClips, every 5m) own the actual post + the
 * campaign / content-reward submission + the USDC bridge. The clip stays "ready"
 * until the drip claims it (claimClipForPostingByUrl), so the two producers can't
 * double-post. Its own action wall, separate from the cut stage.
 */
export const finalizeJob = internalAction({
  args: { jobId: v.id("clipJobs"), kieApiKey: v.optional(v.string()), appUrl: v.optional(v.string()) },
  // kieApiKey / appUrl stay in the validator (cutPoll still forwards them) but are
  // unused here now that finalizeJob makes no outbound HTTP calls of its own.
  handler: async (ctx, { jobId }) => {
    const authSecret = globalThis.process.env.INTERNAL_CRON_SECRET ?? "";
    // orderClips is the publish-order sort — finalizeJob imports it itself
    // (process's dynamic import is out of scope here).
    const { orderClips } = await import("../lib/builder/dripStagger");
    const set = (patch: Record<string, unknown>) =>
      ctx.runMutation(api.clipJobs.setStatus, { jobId, ...patch, authSecret } as { jobId: typeof jobId; status?: string; authSecret: string });
    const logp = (phase: string, note: string, pct?: number) =>
      ctx.runMutation(api.clipJobs.appendLog, { jobId, phase, note, ...(pct != null ? { pct } : {}), authSecret })
        .catch((e) => { console.warn(`[clipJobs] appendLog failed: ${e instanceof Error ? e.message : e}`); });

    try {
      const cc = await loadClipContext(ctx, jobId);
      if (!cc) return null;
      const { job, config } = cc;

      // 5. Auto-post the top-N ready clips (when enabled): STAGGER them through the
      // drip queue instead of posting inline (Bug B — the inline loop published
      // every clip at once, ignoring the "one every Nh" cadence). Compute the
      // staggered scheduledFor with the SAME computeScheduleTimes the canvas /
      // Posting-tab auto-schedulers use so postIntervalMs / maxPerDay /
      // dailyStartHour are honored; drainDueClips then posts each clip when due and
      // performs the campaign / content-reward submission + USDC bridge itself.
      // A control-panel mission job holds its clips for the owner's in-chat approval.
      if (config.autoPost && !job.holdForApproval) {
        const readyAll = (await ctx.runQuery(api.clipJobs.getClipsForJob, { jobId }))
          .filter((c: { status: string; clipUrl?: string }) => c.status === "ready" && c.clipUrl);
        // Publish in the operator's chosen order (best/newest/oldest/random), then
        // take the top maxClipsPerSource (or the analyzer's natural count when
        // autoPlan is on). orderClips' generic narrows the loosely-typed query rows
        // to its sort constraint; cast back so clipUrl/title stay accessible.
        const ready = (orderClips(readyAll, config.postOrder ?? "best") as typeof readyAll)
          .slice(0, config.autoPlan ? (typeof config.autoPlanMaxClips === "number" && config.autoPlanMaxClips > 0 ? config.autoPlanMaxClips : 30) : config.maxClipsPerSource);
        if (ready.length) {
          const { computeScheduleTimes, existingPerDayFromRows, DRIP_STAGGER_MS } = await import("../lib/builder/dripStagger");
          const now = Date.now();
          const posting = (job.campaignId || job.contentRewardId) && config.campaignPosting ? config.campaignPosting : config;
          const intervalMs = posting.postIntervalMs ?? DRIP_STAGGER_MS;
          // Seed the per-day cap from the agent's already-scheduled rows so a re-run
          // (or a second source) never exceeds maxPerDay — identical to the canvas /
          // Posting-tab auto-schedulers (existingPerDayFromRows + computeScheduleTimes).
          const existingRows = await ctx.runQuery(api.scheduledContent.listByMint, { mintAddress: job.mintAddress, limit: 400 });
          const existingPerDay = existingPerDayFromRows(
            (config.campaignPosting ? existingRows.filter((row) => !!row.campaignId === !!job.campaignId) : existingRows) as { scheduledFor?: number; status?: string }[],
            now,
            config.timezone,
          );
          const times = computeScheduleTimes(ready.length, {
            intervalMs,
            maxPerDay: posting.maxPerDay,
            existingPerDay,
            now,
            ...(typeof posting.dailyStartHour === "number" ? { dailyStartHour: posting.dailyStartHour, dailyStartMinute: posting.dailyStartMinute } : {}),
            ...(config.timezone ? { timeZone: config.timezone } : {}),
          });
          let queued = 0;
          for (let i = 0; i < ready.length; i++) {
            const c = ready[i];
            try {
              // scheduledContent.schedule dedups per (mint, videoUrl) active row and
              // guards slot collisions, so a re-fired finalize can't double-queue a
              // clip (→ double-post). campaignId rides along for the drip's
              // post_content compliance + submit; contentRewardId is recovered by the
              // drip from the clip's own job (getPostProvenanceByUrl).
              await ctx.runMutation(api.scheduledContent.schedule, {
                mintAddress: job.mintAddress,
                scheduledFor: times[i] ?? (now + (i + 1) * intervalMs),
                topic: c.title || "Clip",
                // The clip's OWN transcript-derived caption; post_content composes
                // Smart Captions + the mandatory compliance tags at post time
                // (skipAutoCaption). Empty = the source had nothing to transcribe →
                // post bare (never an invented generic caption).
                caption: c.captionText || "",
                platforms: config.platforms,
                ...(job.campaignId ? { campaignId: job.campaignId } : {}),
                videoUrl: c.clipUrl,
                authSecret,
              });
              queued++;
            } catch (e) {
              console.warn(`[clipJobs] finalizeJob enqueue failed for ${c.clipUrl}: ${e instanceof Error ? e.message : e}`);
            }
          }
          const everyMin = Math.max(1, Math.round(intervalMs / 60000));
          await logp("scheduled", `Auto-post ON — queued ${queued} clip${queued === 1 ? "" : "s"} to the drip (one every ~${everyMin} min)`);
        }
      }
      // Completion: rendered = clips that produced a clipUrl. 0 rendered (with clips
      // present) = every moment failed → mark error so the run card isn't a false
      // green "0 clips" success (the per-clip failReason explains each one).
      const finalClips = await ctx.runQuery(api.clipJobs.getClipsForJob, { jobId });
      const rendered = finalClips.filter((c: Doc<"clips">) => !!c.clipUrl).length;
      if (rendered === 0 && finalClips.length > 0) {
        // Surface the ACTUAL reason, not "open the clips to see why": prefer the
        // first clip's failReason (carries the ffmpeg/download detail), mapped to an
        // actionable operator message + fix hint, with the count kept as context.
        const firstFail = finalClips.find((c: Doc<"clips">) => c.failReason)?.failReason;
        const reason = explainClipFailureLine(firstFail);
        const errText = `All ${finalClips.length} clip${finalClips.length === 1 ? "" : "s"} failed: ${reason}`;
        await set({ status: "error", error: errText });
        await logp("error", errText);
        // Every clip failed to render (also the cut-timeout path: cutPoll fails the
        // stragglers then hands here) → 0 successful clips → void the run's skill fees.
        await refundRunFeesIfNoClips(ctx, jobId, job.mintAddress, authSecret);
      } else {
        await set({ status: "completed" });
        await logp("completed", `Done — ${rendered}/${finalClips.length} clip${finalClips.length === 1 ? "" : "s"} rendered`, 100);
      }
    } catch (err) {
      await ctx.runMutation(api.clipJobs.setStatus, { jobId, status: "error", error: err instanceof Error ? err.message : String(err), authSecret });
      // finalizeJob threw (`job` is scoped inside the try) — re-fetch the mint and void
      // the run's skill fees if it produced no clips. Predicate-guarded + idempotent.
      const jrow = await ctx.runQuery(api.clipJobs.getJob, { jobId });
      if (jrow) await refundRunFeesIfNoClips(ctx, jobId, jrow.mintAddress, authSecret);
    }
    return null;
  },
});
