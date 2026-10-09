import { videoLaunchCaption, cleanMarketingText } from "../lib/marketingCaption";
import { marketPath } from "../lib/solstar/marketSlug";
import { enqueueVideoMilestone } from "./contentControl";
import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation, internalAction, type MutationCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { dripContentRewardSubmitBody, durablePostIdsFromOutput } from "../lib/server/dripContentRewardSubmit";
import { makeFunctionReference } from "convex/server";
import { normalizeClipConfig } from "../lib/builder/clipConfig";
import { allocatePostingSlot } from "../lib/builder/campaignPosting";
import { appFetch } from "./lib/appFetch";

// Resolve a drip clip's campaign/content-reward provenance from its owning job
// (the sched row only carries campaignId). String ref so this file typechecks
// before `npx convex deploy` regenerates the api types for the new
// clipJobs.getPostProvenanceByUrl query (the makeFunctionReference-before-deploy
// pattern used in clipJobs.ts). Lets the drip forward contentRewardId to
// post_content so a drip-posted content_reward clip keeps its mandatory
// compliance tags — parity with the inline finalize path.
const CLIP_PROVENANCE = makeFunctionReference<"query">("clipJobs:getPostProvenanceByUrl");

// Scheduled content for the Schedule tab. See schema `scheduledContent`.

/** Queue a piece of content for a future time. Secret-gated: callers reach it
 *  through /api/schedule/create, which authenticates the operator (Privy) +
 *  ownership-scopes the mint before forwarding the internal secret. */
export const schedule = mutation({
  args: {
    mintAddress: v.string(),
    sessionId: v.optional(v.string()),
    scheduledFor: v.number(),
    topic: v.string(),
    script: v.optional(v.string()),
    caption: v.optional(v.string()),
    platforms: v.optional(v.array(v.string())),
    campaignId: v.optional(v.string()),
    /** Pre-rendered clip URL — drip-posting posts the finished clip directly
        (no create_video render step). */
    videoUrl: v.optional(v.string()),
    taskId: v.optional(v.id("agentTasks")),
    /** Catalog format id (lib/builder/formatCatalog.ts) the source render was
     *  templated from, when the caller has one (e.g. forwarded from the
     *  originating videoRenderJobs row). Optional — no backfill. */
    formatId: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    // Defense-in-depth: reject a non-finite scheduledFor (NaN/Infinity) — a zombie
    // row the cron can never drain. (The route also range-checks.)
    if (!Number.isFinite(args.scheduledFor)) throw new Error("scheduledFor must be a finite number");
    // DB-LEVEL DEDUP: a pre-rendered clip (videoUrl) gets at most ONE active drip
    // row per agent. The canvas auto-scheduler + manual DripBar both attempt
    // client-side dedup against a possibly-stale snapshot, so a reopen / back-to-
    // back run could double-queue (→ double-post). Authoritative guard here:
    // return the existing row if this clip is already scheduled/posting/posted.
    if (args.videoUrl) {
      const dup = await ctx.db
        .query("scheduledContent")
        .withIndex("by_mint_video", (q) => q.eq("mintAddress", args.mintAddress).eq("videoUrl", args.videoUrl))
        .collect();
      const active = dup.find((r) => r.status === "scheduled" || r.status === "posting" || r.status === "posted");
      if (active) return active._id;
    }
    const agent = await ctx.db.query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress)).first();
    const config = normalizeClipConfig(agent?.clipConfig);
    const rows = await ctx.db.query("scheduledContent")
      .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress)).collect();
    const scheduledFor = allocatePostingSlot(args.scheduledFor, rows, args.campaignId, config);
    return await ctx.db.insert("scheduledContent", {
      mintAddress: args.mintAddress,
      sessionId: args.sessionId,
      scheduledFor,
      status: "scheduled",
      topic: args.topic.slice(0, 200),
      script: args.script,
      caption: args.caption,
      platforms: args.platforms ?? [],
      campaignId: args.campaignId,
      videoUrl: args.videoUrl,
      taskId: args.taskId,
      ...(args.formatId ? { formatId: args.formatId } : {}),
      createdAt: Date.now(),
    });
  },
});

/** All scheduled/posted content for an agent — drives the calendar. */
export const listByMint = query({
  args: { mintAddress: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { mintAddress, limit }) => {
    return await ctx.db
      .query("scheduledContent")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(limit ?? 400);
  },
});

/** Upcoming drip rows across several agents within a time window — powers the
 *  Studio weekly-schedule strip ("scheduled until when" at a glance). One
 *  per-mint indexed scan each (same SCAN-per-mint fan-out pattern as
 *  clipJobs.videoFeedByMints), filtered to the window client-side since there
 *  is no compound (mint-set × time) index — the per-mint row count here is
 *  small (a week's worth of drip rows), so this stays cheap. */
export const listByMintsInRange = query({
  args: { mintAddresses: v.array(v.string()), startMs: v.number(), endMs: v.number() },
  handler: async (ctx, { mintAddresses, startMs, endMs }) => {
    if (mintAddresses.length === 0) return [];
    const perMint = await Promise.all(
      mintAddresses.map((mintAddress) =>
        ctx.db
          .query("scheduledContent")
          .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
          .order("desc")
          .take(150),
      ),
    );
    return perMint
      .flat()
      .filter((r) => r.scheduledFor >= startMs && r.scheduledFor <= endMs && r.status !== "cancelled");
  },
});

/**
 * Public landing-page showcase — recently posted/rendered videos joined with
 * their creator agent (name, avatar, archetype). Drives the "Most Popular
 * Creator Types" masonry. Only returns rows that have something to show
 * (a rendered video or a storyboard poster image).
 */
export const listShowcase = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("scheduledContent")
      .order("desc")
      .take(200);

    const withMedia = rows.filter((r) => r.videoUrl || r.storyboardImageUrl);

    // Cache influencer lookups by mint so we don't refetch per row.
    const agentCache = new Map<string, { name: string; avatarUrl: string; archetype: string; agentType?: string } | null>();
    const getAgent = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const a = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
        .first();
      const lite = a ? { name: a.name, avatarUrl: a.avatarUrl, archetype: a.archetype, agentType: a.agentType } : null;
      agentCache.set(mint, lite);
      return lite;
    };

    const out: {
      name: string;
      role: string;
      avatarUrl: string;
      description: string;
      posterUrl: string;
      videoUrl?: string;
      platform: string;
      caption?: string;
    }[] = [];

    for (const r of withMedia) {
      const agent = await getAgent(r.mintAddress);
      if (!agent) continue;
      out.push({
        name: agent.name,
        role: `The ${(agent.agentType || agent.archetype || "creator").toLowerCase()}`,
        avatarUrl: agent.avatarUrl,
        description: r.topic,
        posterUrl: r.storyboardImageUrl || agent.avatarUrl,
        videoUrl: r.videoUrl,
        platform: r.platforms?.[0] || "instagram",
        caption: r.caption,
      });
      if (out.length >= (limit ?? 12)) break;
    }

    return out;
  },
});

/** Cancel a scheduled item. Secret-gated and mint-scoped: callers reach it
 *  through /api/schedule/cancel, which authenticates the operator (Privy) +
 *  ownership-scopes `expectedMintAddress`. We re-assert the row's mintAddress
 *  matches `expectedMintAddress` server-side so a caller can't cancel another
 *  agent's row by guessing its id. */
export const cancel = mutation({
  args: { id: v.id("scheduledContent"), expectedMintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { id, expectedMintAddress, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const row = await ctx.db.get(id);
    if (!row || row.status === "posted") return;
    if (row.mintAddress !== expectedMintAddress) throw new Error("forbidden — row belongs to a different agent");
    await ctx.db.patch(id, { status: "cancelled" });
  },
});

/** Move a scheduled item to a new time (calendar drag-and-drop). Secret-gated and
 *  mint-scoped like `cancel`: the /api/schedule/reschedule route authenticates the
 *  operator + ownership-scopes `expectedMintAddress`, and we re-assert the row's
 *  mintAddress here so a caller can't move another agent's row by guessing its id.
 *  A posted/posting row is left alone (already firing/fired). Re-arms a cancelled/
 *  failed row back to `scheduled` so a drop re-queues it for the drip poster. */
export const reschedule = mutation({
  args: { id: v.id("scheduledContent"), scheduledFor: v.number(), expectedMintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { id, scheduledFor, expectedMintAddress, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    // Reject a non-finite target (NaN/Infinity → a zombie row the cron can never drain).
    if (!Number.isFinite(scheduledFor)) throw new Error("scheduledFor must be a finite number");
    const row = await ctx.db.get(id);
    if (!row || row.status === "posted" || row.status === "posting") return;
    if (row.mintAddress !== expectedMintAddress) throw new Error("forbidden — row belongs to a different agent");
    await ctx.db.patch(id, { scheduledFor, status: "scheduled" });
  },
});

/** Explicit owner-authorized retry: reuse the video and the existing publication key. */
export const repostVideo = mutation({
  args: { mintAddress: v.string(), videoUrl: v.string(), title: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, videoUrl, title, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const rows = await ctx.db.query("scheduledContent").withIndex("by_mint_video", q => q.eq("mintAddress", mintAddress).eq("videoUrl", videoUrl)).collect();
    const active = rows.find(row => ["posted", "posting", "scheduled"].includes(row.status));
    if (active) return { id: active._id, status: active.status };
    const agent = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", mintAddress)).first();
    if (!agent) throw new Error("Agent not found");
    // Older inline publications have no schedule row: honor their saved receipt too.
    const tasks = await ctx.db.query("agentTasks").withIndex("by_mint", q => q.eq("mintAddress", mintAddress)).order("desc").take(200);
    for (const task of tasks) {
      if (task.type !== "create_video") continue;
      try {
        const output = JSON.parse(task.output ?? "{}");
        if (output.videoUrl === videoUrl && ["posted", "posting"].includes(output.post?.status)) return { status: output.post.status as string };
      } catch { /* Older tasks may not have structured output. */ }
    }
    const clips = await ctx.db.query("clips").withIndex("by_mint", q => q.eq("mintAddress", mintAddress)).collect();
    const clip = clips.find(row => row.clipUrl === videoUrl);
    if (clip?.status === "posted" || clip?.status === "posting") return { status: clip.status };
    // A failed clip must be ready again for the shared posting claim to succeed.
    if (clip?.status === "failed") await ctx.db.patch(clip._id, { status: "ready", failReason: undefined, updatedAt: Date.now() });
    const previous = rows.sort((a, b) => b._creationTime - a._creationTime)[0];
    let id;
    if (previous) {
      id = previous._id;
      await ctx.db.patch(id, { status: "scheduled", scheduledFor: Date.now(), retryCount: 0, error: undefined, postingStartedAt: undefined, platforms: ["x"] });
    } else {
      id = await ctx.db.insert("scheduledContent", { mintAddress, videoUrl, topic: title.slice(0, 200), caption: await autoCaption(ctx, agent, title), platforms: ["x"], auto: !clip, status: "scheduled", scheduledFor: Date.now(), createdAt: Date.now() });
    }
    await ctx.scheduler.runAfter(0, internal.scheduledContent.drainDueClips, {});
    return { id, status: "scheduled" };
  },
});

// ─── Cron runner support ─────────────────────────────────────────────────────

/** Due, not-yet-fired scheduled content (scheduledFor <= now, status scheduled). */
export const listDue = internalQuery({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { now, limit }) => {
    const scheduled = await ctx.db
      .query("scheduledContent")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .take(200);
    return scheduled.filter((s) => s.scheduledFor <= now).slice(0, limit ?? 25);
  },
});

/** Due PRE-RENDERED clips only (videoUrl present). Separate from listDue so a
 *  backlog of legacy create_video rows can never starve the drip poster. */
export const listDueClips = internalQuery({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { now, limit }) => {
    // Compound index: fetch ONLY due scheduled rows (scheduledFor <= now),
    // earliest first — so a big backlog of FUTURE rows can't starve genuinely-due
    // clips (the old by_status scan ordered by creation time + .take(500) could
    // hide due rows created later). Small buffer covers interleaved create_video
    // rows (no videoUrl) before the videoUrl filter + slice.
    const due = await ctx.db
      .query("scheduledContent")
      .withIndex("by_status_scheduledFor", (q) => q.eq("status", "scheduled").lte("scheduledFor", now))
      .order("asc")
      .take(100);
    return due
      .filter((s) => typeof s.videoUrl === "string" && s.videoUrl.length > 0)
      .slice(0, limit ?? 10);
  },
});

/** Rows stuck on "posting" past a TTL — a cron tick that died mid-post. The drip
 *  reaper reverts these to "scheduled" so they aren't stranded forever. */
export const listStalePosting = internalQuery({
  args: { olderThan: v.number() },
  handler: async (ctx, { olderThan }) => {
    const rows = await ctx.db
      .query("scheduledContent")
      .withIndex("by_status", (q) => q.eq("status", "posting"))
      .take(50);
    return rows.filter((r) => (r.postingStartedAt ?? r.createdAt) < olderThan);
  },
});

/**
 * ORPHANED-CLIP RECONCILE candidates: the cancel-mid-post strand. When an operator
 * CANCELS a drip row while drainDueClips has already flipped the originating clip
 * badge to "posting" (clips.status === "posting"), markStatus terminalizes the
 * sched row to "cancelled" but the clip is left "posting" forever — no later tick
 * touches it, because the reaper only reaps sched rows stuck on "posting" (this
 * one went terminal), and the success/failure paths never run (the row was
 * cancelled before posting). The clip badge is then stranded on "posting".
 *
 * Returns the distinct (mintAddress, videoUrl) pairs of CANCELLED rows past the
 * TTL whose videoUrl has NO active (scheduled|posting) sched row — i.e. nothing is
 * legitimately posting that clip anymore, so the caller can safely revert the clip
 * badge off "posting". BOUNDED by `limit` (like REAP_MAX) so it can never run
 * unbounded. The join is the no-schema-field videoUrl===clipUrl contract (see
 * clipJobs.markClipPostedByUrl); we only emit the URL+mint the caller needs.
 *
 * NOTE: this query can only DETECT the orphan from the sched side. Reverting the
 * actual clips row is the caller's job via clipJobs.markClipPostedByUrl (the only
 * cross-table writer reachable from here); a fuller fix that reads/scopes by the
 * clip's own status needs a clipJobs query/index (owned by clipJobs.ts).
 */
export const listOrphanReconcileCandidates = internalQuery({
  args: { olderThan: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { olderThan, limit }) => {
    // Recently-cancelled rows (bounded). A cancel that orphaned a clip is recent;
    // the by_status index keeps this a bounded scan of cancelled rows only.
    const cancelled = await ctx.db
      .query("scheduledContent")
      .withIndex("by_status", (q) => q.eq("status", "cancelled"))
      .order("desc")
      .take(100);
    const out: { mintAddress: string; videoUrl: string }[] = [];
    const seen = new Set<string>();
    const cap = limit ?? 5;
    for (const r of cancelled) {
      if (out.length >= cap) break;
      if (!r.videoUrl) continue;
      // Only consider rows whose cancel/creation is past the TTL — gives an inline
      // or just-cancelled post time to settle before we reconcile (mirrors the
      // reaper's postingStartedAt/createdAt < olderThan gate).
      if ((r.postingStartedAt ?? r.createdAt) >= olderThan) continue;
      const key = `${r.mintAddress} ${r.videoUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Skip if ANY active (scheduled|posting) sched row still owns this videoUrl —
      // then the clip's "posting" badge is legitimate (a live drip / re-queue), not
      // orphaned. by_mint_video is the dedup index; one .collect() per pair is
      // bounded (≤ a handful of rows per agent+clip).
      const rowsForUrl = await ctx.db
        .query("scheduledContent")
        .withIndex("by_mint_video", (q) => q.eq("mintAddress", r.mintAddress).eq("videoUrl", r.videoUrl))
        .collect();
      const hasActive = rowsForUrl.some((x) => x.status === "scheduled" || x.status === "posting");
      // A "posted" sibling means the clip was published — its badge is handled by
      // the success path / markClipPostedByUrl's monotonic guard; don't touch it.
      const hasPosted = rowsForUrl.some((x) => x.status === "posted");
      if (hasActive || hasPosted) continue;
      out.push({ mintAddress: r.mintAddress, videoUrl: r.videoUrl });
    }
    return out;
  },
});

/**
 * DRIP POSTER (cron, every 5 min): posts due PRE-RENDERED clips (rows with a
 * videoUrl) through the existing /api/agents/run-task post_content flow —
 * "bulk clip, then slowly post". Rows WITHOUT a videoUrl are the create_video
 * flow and are intentionally left untouched. Requires NEXT_PUBLIC_APP_URL in
 * the Convex env (same requirement as the heartbeat dispatcher).
 */
export const drainDueClips = internalAction({
  args: {},
  handler: async (ctx): Promise<{ posted: number; failed: number; skipped: number; retried: number; reaped: number; reconciled: number }> => {
    // INTERNAL_CRON_SECRET is required to reach the secret-gated clip-mark mutation.
    const authSecret = process.env.INTERNAL_CRON_SECRET ?? "";
    // REAPER: rows stuck on "posting" past the TTL (a cron tick that died mid-post)
    // go back to "scheduled" so the next tick retries — but BOUNDED by the same
    // retry cap so a row that keeps dying mid-post can't loop reposting forever;
    // and the originating clip's badge is reverted off "posting" (else it shows
    // "posting" forever).
    const POSTING_TTL_MS = 10 * 60 * 1000;
    const REAP_MAX = 3;
    let reaped = 0;
    const stale: Doc<"scheduledContent">[] = await ctx.runQuery(internal.scheduledContent.listStalePosting, { olderThan: Date.now() - POSTING_TTL_MS });
    for (const r of stale) {
      const attempts = (r.retryCount ?? 0) + 1;
      const giveUp = attempts > REAP_MAX;
      await ctx.runMutation(internal.scheduledContent.markStatus, giveUp
        ? { id: r._id, status: "failed", error: "stuck on posting — gave up after reaper retries" }
        : { id: r._id, status: "scheduled", scheduledFor: Date.now(), retryCount: attempts });
      if (authSecret && r.videoUrl) {
        try {
          if (giveUp) {
            // Terminal: the row gave up → flip the clip "failed" too (markClipPostedByUrl
            // is fine here — a terminal mark is the intended state for this clip).
            await ctx.runMutation(api.clipJobs.markClipPostedByUrl, {
              mintAddress: r.mintAddress, clipUrl: r.videoUrl, status: "failed", authSecret,
            });
          } else {
            // RETRY: un-strand the clip's badge off "posting" → "ready" via the
            // STATUS-AWARE CAS, so a clip an operator SKIPPED (or one that genuinely
            // failed) is NOT resurrected to "ready" — only a clip still "posting" is
            // reverted. (markClipPostedByUrl would have flipped any non-posted clip.)
            await ctx.runMutation(api.clipJobs.revertClipPostingByUrl, {
              mintAddress: r.mintAddress, clipUrl: r.videoUrl, authSecret,
            });
          }
        } catch { /* best-effort */ }
      }
      reaped++;
    }
    // RECONCILE the cancel-mid-post strand: a clip left status="posting" while its
    // sched row went terminal "cancelled" (the operator cancelled after the badge
    // flipped to "posting") is orphaned — the reaper above only reaps sched rows
    // still on "posting", not the clip. Revert such clips' badge to "ready" via the
    // videoUrl join. BOUNDED by RECONCILE_MAX like the reaper so it can't run
    // unbounded. listOrphanReconcileCandidates already excludes any URL with an
    // active (scheduled|posting) or posted sibling, so this only touches genuinely
    // stranded clips.
    //
    // STATUS-AWARE CAS (the FIX): use revertClipPostingByUrl, NOT
    // markClipPostedByUrl({status:"ready"}). The old call flipped ANY non-posted
    // clip to "ready" — so a clip an operator deliberately SKIPPED, or one that
    // genuinely FAILED, was resurrected to "ready" on every 5-min tick forever
    // (the candidate query keys on the cancelled SCHED row, which has no idea the
    // clip is skipped/failed). The CAS reverts ONLY a clip still on "posting";
    // skipped/failed/posted/ready clips are left untouched (no-op).
    const RECONCILE_MAX = 5;
    let reconciled = 0;
    if (authSecret) {
      const orphans: { mintAddress: string; videoUrl: string }[] = await ctx.runQuery(
        internal.scheduledContent.listOrphanReconcileCandidates,
        { olderThan: Date.now() - POSTING_TTL_MS, limit: RECONCILE_MAX },
      );
      for (const o of orphans) {
        try {
          const r = await ctx.runMutation(api.clipJobs.revertClipPostingByUrl, {
            mintAddress: o.mintAddress, clipUrl: o.videoUrl, authSecret,
          });
          // Count only a genuine "posting" → "ready" revert (not a missing clip or
          // a no-op on a skipped/failed/posted clip).
          if (r?.reverted) reconciled++;
        } catch { /* best-effort — a later tick retries */ }
      }
    }
    const clipRows: Doc<"scheduledContent">[] = await ctx.runQuery(internal.scheduledContent.listDueClips, { now: Date.now(), limit: 10 });
    if (clipRows.length === 0) return { posted: 0, failed: 0, skipped: 0, retried: 0, reaped, reconciled };
    let posted = 0, failed = 0, retried = 0;
    // PACING: at most ONE post per agent per 5-min tick. A backlog (cron hiccup,
    // retries re-queued at "now", slots bunched together) used to publish
    // several of one agent's posts in the same minute. Extra due rows simply
    // stay "scheduled" and go out on the following ticks, in order.
    const mintsThisTick = new Set<string>();
    for (const row of clipRows) {
      if (mintsThisTick.has(row.mintAddress)) continue;
      // ATOMIC CLAIM before any posting work: another overlapping 5-min tick (or
      // an operator cancel) may have taken/killed this row since listDueClips read
      // it. claimForPosting transitions scheduled→posting only if still scheduled.
      const claim = await ctx.runMutation(internal.scheduledContent.claimForPosting, { id: row._id });
      if (!claim.claimed) continue;
      mintsThisTick.add(row.mintAddress);
      // PUBLISH-ONCE GUARD (checked here in Convex, before any network call): a
      // previous attempt for this exact schedule row may have PUBLISHED even
      // though its caller timed out (slow uploads took >90s → the reaper
      // re-queued the row → the same video went out 3-4 times, 15 min apart).
      // Every attempt carries idempotencyKey sched:<rowId> in its task input.
      {
        const { decidePostIdempotency } = await import("../lib/server/postIdempotency");
        const prior = await ctx.runQuery(internal.scheduledContent.recentPostTasks, { mintAddress: row.mintAddress });
        const decision = decidePostIdempotency(prior, `sched:${row._id}`);
        if (decision.kind === "already_posted") {
          const out = decision.output as { postUrl?: string; postPlatform?: string };
          await ctx.runMutation(internal.scheduledContent.markStatus, { id: row._id, status: "posted", postedAt: Date.now() });
          if (authSecret && row.videoUrl) {
            try {
              await ctx.runMutation(api.clipJobs.markClipPostedByUrl, {
                mintAddress: row.mintAddress, clipUrl: row.videoUrl, status: "posted",
                ...(out.postUrl ? { postUrl: out.postUrl } : {}),
                ...(out.postPlatform ? { platform: out.postPlatform } : {}),
                authSecret,
              });
            } catch { /* best-effort badge */ }
          }
          console.warn(`[drip] ${row.videoUrl} already published by an earlier attempt — marked posted, NOT re-posting`);
          continue;
        }
        if (decision.kind === "in_progress") {
          // Earlier attempt still uploading — keep the row "posting"; the reaper
          // re-checks later and this guard then marks it posted.
          continue;
        }
      }
      // CROSS-PATH ATOMIC CLAIM on the originating clip (the no-schema-field join
      // on videoUrl===clipUrl): clipJobs.process may also auto-post this exact clip
      // inline at render time. Both producers share the clip row's status as the
      // lock — claim "ready" → "posting" here too. If the inline path already holds
      // it (clip exists but not "ready"), REVERT our sched-row claim back to
      // "scheduled" so a later tick can retry once the clip is free, and skip — so
      // the clip is never posted twice. A clip with NO row (draft-session drip,
      // missing:true) has no inline twin → post anyway. Setting "posting" here also
      // drives the Posting-tab badge before the join derives it from the sched row.
      if (authSecret && row.videoUrl) {
        let clipClaim: { claimed: boolean; missing?: boolean; status?: string };
        try {
          clipClaim = await ctx.runMutation(api.clipJobs.claimClipForPostingByUrl, {
            mintAddress: row.mintAddress, clipUrl: row.videoUrl, authSecret,
          });
        } catch {
          // FAIL-CLOSED: a THROW from the cross-path claim call (mutation error /
          // economy not deployed / transient) leaves the clip's true state UNKNOWN —
          // the inline path may already hold it. Treating this like "missing" would
          // POST ANYWAY and double-post a clip the inline path is publishing. So
          // treat it like the "mid-posting" defer branch: release our sched-row claim
          // back to "scheduled" (CAS-safe — a cancelled/posted row isn't resurrected)
          // with BACKOFF so a persistently-broken claim dependency doesn't re-fire
          // every 5-min tick; cap → failed (reaper-style bound).
          const ca = (row.retryCount ?? 0) + 1;
          await ctx.runMutation(internal.scheduledContent.markStatus, ca > 3
            ? { id: row._id, status: "failed", error: "cross-path claim call kept failing" }
            : { id: row._id, status: "scheduled", scheduledFor: Date.now() + 5 * 60 * 1000 * ca, retryCount: ca });
          continue;
        }
        if (!clipClaim.claimed && !clipClaim.missing) {
          if (clipClaim.status === "posted") {
            // The inline path already PUBLISHED this clip — terminate the sched row
            // "posted" so it stops cycling (don't re-post). CAS-safe via markStatus.
            await ctx.runMutation(internal.scheduledContent.markStatus, { id: row._id, status: "posted", postedAt: Date.now() });
          } else {
            // The inline path is mid-posting this clip — release our sched-row claim
            // back to "scheduled" (CAS-safe; a cancelled/posted row isn't resurrected)
            // so a later tick retries once the clip is free, and skip this tick.
            await ctx.runMutation(internal.scheduledContent.markStatus, { id: row._id, status: "scheduled" });
          }
          continue;
        }
      }
      // Recover the clip's content-reward provenance from its OWNING JOB (the sched
      // row only carries campaignId) so post_content can enforce the jobtepi brief's
      // MANDATORY compliance tags (@mentions / #hashtags) on a drip-posted
      // content_reward clip — parity with the inline finalize path that used to post
      // these clips. Best-effort: a draft-session drip (no clip row) or a transient
      // error leaves it undefined, and campaign compliance still rides on campaignId.
      let provContentRewardId: string | undefined;
      if (row.videoUrl) {
        try {
          const prov = (await ctx.runQuery(CLIP_PROVENANCE, { mintAddress: row.mintAddress, clipUrl: row.videoUrl })) as
            | { campaignId: string | null; contentRewardId: string | null }
            | null;
          if (prov?.contentRewardId) provContentRewardId = prov.contentRewardId;
        } catch { /* best-effort — compliance still applies for a campaignId row */ }
      }
      try {
        // TIMEOUT: a hung run-task (network stall, upstream wedge) must never hang
        // the whole action — Convex actions have a hard wall-clock budget and a
        // stuck fetch would block every other due row in this tick. Bound it with
        // an AbortController (the repo's fetch-timeout pattern — see
        // lib/server/kie-claude.ts / downloader.ts). 90s is generous for a post
        // (re-host + multi-platform upload). On abort the fetch throws "aborted",
        // which the catch below classifies TRANSIENT (regex) → retry/backoff, so
        // the row is retried/reaped rather than stranded or hung.
        const POST_TIMEOUT_MS = 90 * 1000;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
        let res: Response;
        try {
          res = await appFetch(`/api/agents/run-task`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Same internal-auth pattern as the heartbeat dispatcher — without
              // this the route's requireInternalOrUserAuth 401s the cron.
              ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
            },
            body: JSON.stringify({
              mintAddress: row.mintAddress,
              taskType: "post_content",
              // platforms: row.platforms ?? [] — empty array means run-task post_content
              // fans out to ALL connected platforms (the platform-resolution contract).
              input: {
                platforms: row.platforms ?? [],
                contentType: "video",
                mediaUrl: row.videoUrl,
                // The clip's OWN caption only (never the topic/"Clip N" placeholder).
                // Empty = nothing to transcribe → post BARE; skipAutoCaption stops
                // post_content from inventing a generic caption.
                text: row.caption || "",
                // The clip's title — used ONLY as X's tweet text when there's no
                // caption (X rejects a repeated "New video" tweet). post_content
                // never turns it into the caption for other platforms.
                ...(row.topic ? { topic: row.topic } : {}),
                skipAutoCaption: true,
                ...(row.auto && !row.campaignId && !provContentRewardId ? { generateInfluencerCaption: true } : {}),
                campaignId: row.campaignId,
                // contentRewardId (recovered from the clip's job above) makes
                // post_content resolve + append the content_reward brief's mandatory
                // compliance tags — so a drip-posted content_reward clip is compliant.
                ...(provContentRewardId ? { contentRewardId: provContentRewardId } : {}),
                // IDEMPOTENCY: one publish per schedule row, ever. A post that runs
                // past POST_TIMEOUT_MS still publishes server-side; the reaper then
                // re-queued the row and each retry published AGAIN (the "same video
                // posted 3-4 times" bug). run-task returns the earlier result for a
                // key it has already posted (or "in_progress" while one is running).
                idempotencyKey: `sched:${row._id}`,
              },
              triggeredBy: "drip_scheduler",
            }),
            signal: ctrl.signal,
          });
        } catch (fetchErr) {
          // Normalize an AbortError into an explicit "timeout" message so it can't be
          // mistaken for a permanent failure (it's already transient via /aborted/i,
          // but be explicit + future-proof the classifier).
          if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
            throw new Error(`run-task timeout after ${POST_TIMEOUT_MS}ms`);
          }
          throw fetchErr;
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) {
          // Capture the response BODY, not just the status — otherwise the failure
          // reason stored on scheduledContent.error (and shown on the Posting tab's
          // "Failed" badge) is an unactionable "run-task HTTP 500". The body carries
          // the real cause (auth, plan limit, bad media, upstream message).
          const body = await res.text().catch(() => "");
          throw new Error(`run-task HTTP ${res.status}${body ? `: ${body.trim().slice(0, 160)}` : ""}`);
        }
        // post_content returns output.{status,postUrl,postPlatform,note}. A 200 does
        // NOT mean it published: status is "posted" only on a real publish, else
        // "skipped"/"needs_connection"/"error"/"failed" (no connected account,
        // UPLOAD_POST_API_KEY unset, re-host failed, …). Treat anything but "posted"
        // as a FAILURE so the feed never shows a false "Posted" with no permalink.
        let postUrl: string | undefined;
        let postPlatform: string | undefined;
        let outStatus: string | undefined;
        let outNote: string | undefined;
        // Durable upload-post identities run-task returns in its output. These are
        // what make the submission PAYABLE — dueForVerification only measures a row
        // carrying uploadPostRequestId || platformPostId (postUrl alone never pays).
        // Forward them into the submit calls below, else a drip-posted content_reward
        // clip is stranded: posted + submitted but never attested/claimed.
        let platformPostId: string | undefined;
        let uploadPostRequestId: string | undefined;
        try {
          const j = await res.json();
          if (typeof j?.output?.status === "string") outStatus = j.output.status;
          if (typeof j?.output?.note === "string") outNote = j.output.note;
          if (typeof j?.output?.postUrl === "string" && j.output.postUrl) postUrl = j.output.postUrl;
          if (typeof j?.output?.postPlatform === "string" && j.output.postPlatform) postPlatform = j.output.postPlatform;
          ({ platformPostId, uploadPostRequestId } = durablePostIdsFromOutput(j?.output));
        } catch { /* non-JSON body — no failure sentinel, fall through to posted */ }
        // An earlier attempt for this row is still publishing — leave the row on
        // "posting" (the reaper re-checks; the idempotent re-run returns its result).
        if (outStatus === "in_progress") {
          console.warn(`[drip] post for ${row.videoUrl} already in progress (earlier attempt) — waiting, not re-posting`);
          continue;
        }
        if (outStatus && outStatus !== "posted") {
          throw new Error((outNote || `not posted (${outStatus})`).slice(0, 200));
        }
        await ctx.runMutation(internal.scheduledContent.markStatus, { id: row._id, status: "posted", postedAt: Date.now(), ...(postUrl ? { postUrl } : {}), ...((postPlatform || row.platforms?.[0]) ? { postPlatform: postPlatform || row.platforms[0] } : {}), ...(platformPostId ? { platformPostId } : {}), ...(uploadPostRequestId ? { uploadPostRequestId } : {}) });
        // Patch the originating clip → posted (+ permalink + platform) via the join.
        // The post GENUINELY PUBLISHED (we passed the outStatus check above), so the
        // clip's posted truth must be stamped REGARDLESS of whether the sched row
        // accepted "posted": if the operator cancelled the sched row mid-post AFTER
        // upload-post already published, markStatus returns applied:false (the row
        // stays "cancelled"), but the clip WAS posted — so we still stamp it "posted"
        // (+ permalink) here so the post isn't silently mislabeled. clips.postedAt is
        // stamped once and survives a later cancel; markClipPostedByUrl's monotonic
        // guard keeps this idempotent. (The sched row staying "cancelled" is fine —
        // the clip badge is the authoritative "posted" signal the feed reads first.)
        if (authSecret && row.videoUrl) {
          try {
            const marked = (await ctx.runMutation(api.clipJobs.markClipPostedByUrl, {
              mintAddress: row.mintAddress, clipUrl: row.videoUrl, status: "posted",
              ...(postUrl ? { postUrl } : {}),
              ...(postPlatform ? { platform: postPlatform } : (row.platforms?.[0] ? { platform: row.platforms[0] } : {})),
              authSecret,
            })) as { campaignId?: string | null; contentRewardId?: string | null; ownerWallet?: string | null; clipId?: Id<"clips"> } | null;
            const submitPlatform = postPlatform || row.platforms?.[0];
            // Agent name/avatar → the submission/jobtepi user shows under the AGENT's
            // name (best-effort; else "Vello Creator …"). Fetched ONCE and reused by
            // both the Convex-campaign submit and the content-reward submit below.
            let ownerName: string | undefined, ownerAvatar: string | undefined;
            try {
              const agent = await ctx.runQuery(api.influencers.getByMintServer, { mintAddress: row.mintAddress, authSecret });
              ownerName = agent?.name ?? undefined;
              ownerAvatar = agent?.avatarUrl ?? undefined;
            } catch { /* best-effort — the name is cosmetic; the submit still lands */ }

            // CONVEX-CAMPAIGN recovery (server-authoritative): a campaign clip
            // scheduled via the Posting tab drops row.campaignId, so recover the
            // campaign from the clip's JOB provenance (the mark's return) and submit
            // here — parity with the inline finalizeJob + manual Post-now paths, and
            // independent of whether the sched row carried campaignId. Upserts per
            // (campaign, mint) so it's safe even though post_content may have also
            // fired submitForCampaign for the same pair (incrementSubmissions is
            // guarded by the !existing branch → no double count). Also links
            // clips.submissionId, which the drip path otherwise never sets.
            if (marked?.campaignId && marked?.ownerWallet && marked?.clipId) {
              try {
                await ctx.runMutation(api.submissions.submitClipToCampaign, {
                  clipId: marked.clipId, campaignId: marked.campaignId, influencerMint: row.mintAddress,
                  influencerName: ownerName ?? "Vello agent", submitterWallet: marked.ownerWallet,
                  ...(postUrl ? { postUrl } : {}), ...(submitPlatform ? { platform: submitPlatform } : {}),
                  ...(platformPostId ? { platformPostId } : {}),
                  ...(uploadPostRequestId ? { uploadPostRequestId } : {}),
                  postedAt: Date.now(), authSecret,
                });
              } catch { /* best-effort — the clip is already posted; a later tick can re-link */ }
            }

            // GAP #2: the drip forwards only campaignId to post_content (Convex campaigns
            // submit there). A DRIP-posted CONTENT-REWARD clip would otherwise never reach
            // its /stage/reward page — the scheduledContent row has no contentRewardId. The
            // mark's provenance return recovers it from the clip's JOB → submit here, parity
            // with the inline finalizeJob path. (Same mark the inline/manual paths use.)
            const crBody = dripContentRewardSubmitBody(marked, {
              postUrl, clipUrl: row.videoUrl, platform: submitPlatform,
              // Forward the durable proof + mint so the submit route can register a
              // measurement handle — without these the sync worker never resolves
              // the real permalink/views for a drip-posted content-reward clip.
              platformPostId, uploadPostRequestId, mintAddress: row.mintAddress,
            });
            if (crBody) {
              try {
                await appFetch(`/api/content-rewards/submit`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "X-Internal-Secret": authSecret },
                  body: JSON.stringify({ ...crBody, ...(ownerName ? { ownerName } : {}), ...(ownerAvatar ? { ownerAvatar } : {}) }),
                });
              } catch { /* best-effort — the clip is already posted; a missed display submit isn't fatal */ }
            }

            // BRIDGE → USDC rail (decoupled from the display submit above; parity with
            // the inline finalizeJob bridge). If this content_reward has a FUNDED
            // on-chain v2 vault linked, mirror a Convex submission so the oracle reads
            // on-chain views + the claim keeper pays the agent USDC. Runs ONLY for a
            // content-reward clip with NO direct campaignId (campaign clips submitted
            // above — the inline path gates its bridge the same way, avoiding a double
            // row). The mutation is funded-vault-gated (never credits unbacked NAV) and
            // idempotent via the submitClipToCampaign upsert.
            if (marked?.contentRewardId && marked?.clipId && marked?.ownerWallet && !marked?.campaignId) {
              try {
                await ctx.runMutation(api.submissions.bridgeContentRewardToCampaign, {
                  clipId: marked.clipId, contentRewardId: marked.contentRewardId, influencerMint: row.mintAddress,
                  influencerName: ownerName ?? "Vello agent", submitterWallet: marked.ownerWallet,
                  ...(postUrl ? { postUrl } : {}), ...(submitPlatform ? { platform: submitPlatform } : {}),
                  ...(platformPostId ? { platformPostId } : {}),
                  ...(uploadPostRequestId ? { uploadPostRequestId } : {}),
                  postedAt: Date.now(), authSecret,
                });
              } catch { /* best-effort — the clip is posted; a later tick can re-link the USDC rail */ }
            }
          } catch { /* best-effort — the join still derives posted from the clip badge */ }
        }
        posted++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "post failed";
        // TIMEOUT = UNKNOWN OUTCOME: the request reached run-task (we gave up waiting
        // after POST_TIMEOUT_MS), so upload-post may have PUBLISHED server-side. Do
        // NOT revert the clip to "ready" + reschedule now — that would let the next
        // 5-min tick re-claim + re-post a clip the server already published (double-
        // post). Leave BOTH the sched row and the clip on "posting" and let the 10-min
        // reaper own recovery (bounded by REAP_MAX) — same as a hung post before the
        // timeout existed. (Fast retry is only safe for failures that definitely did
        // NOT publish — handled by the transient branch below.)
        if (/run-task timeout/i.test(msg)) {
          console.warn(`[drip] post timed out (outcome unknown) for ${row.videoUrl} — left "posting" for the reaper, not re-queued`);
          continue;
        }
        // Transient (network/5xx/429/not-yet-connected) → retry with backoff up to a
        // cap, rather than stranding the clip on terminal "failed" for one blip. These
        // are fast-fail (connection refused / 5xx) so the post did NOT publish → safe
        // to retry. Permanent errors (4xx auth, bad media) go straight to failed.
        const transient = /HTTP 5\d\d|HTTP 429|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|needs_connection/i.test(msg);
        const attempts = (row.retryCount ?? 0) + 1;
        const MAX_RETRIES = 3;
        if (transient && attempts <= MAX_RETRIES) {
          await ctx.runMutation(internal.scheduledContent.markStatus, {
            id: row._id, status: "scheduled",
            scheduledFor: Date.now() + 5 * 60 * 1000 * attempts, // 5/10/15-min backoff
            retryCount: attempts,
            error: `retry ${attempts}/${MAX_RETRIES}: ${msg.slice(0, 160)}`,
          });
          // Revert the clip badge off "posting" (we set it before the attempt) so it
          // doesn't show "posting" for the whole backoff window.
          if (authSecret && row.videoUrl) {
            try {
              await ctx.runMutation(api.clipJobs.markClipPostedByUrl, {
                mintAddress: row.mintAddress, clipUrl: row.videoUrl, status: "ready", authSecret,
              });
            } catch { /* best-effort */ }
          }
          retried++;
        } else {
          await ctx.runMutation(internal.scheduledContent.markStatus, {
            id: row._id, status: "failed", error: msg.slice(0, 200),
          });
          // Redundant signal: also flip the clip → failed so its badge is accurate
          // even without the join. Non-fatal; a draft clip with no row is a no-op.
          if (authSecret && row.videoUrl) {
            try {
              await ctx.runMutation(api.clipJobs.markClipPostedByUrl, {
                mintAddress: row.mintAddress, clipUrl: row.videoUrl, status: "failed", authSecret,
              });
            } catch { /* best-effort */ }
          }
          failed++;
        }
      }
    }
    console.log(`[drip] posted=${posted} failed=${failed} retried=${retried} reaped=${reaped} reconciled=${reconciled}`);
    return { posted, failed, skipped: 0, retried, reaped, reconciled };
  },
});

/** Recent post_content tasks for an agent (newest first) — the publish-once
 *  guard in drainDueClips reads these to see whether a schedule row's earlier
 *  attempt already published. */
export const recentPostTasks = internalQuery({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const tasks = await ctx.db.query("agentTasks").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).order("desc").take(150);
    return tasks
      .filter((t) => t.type === "post_content")
      .map((t) => ({ _id: t._id as string, type: t.type, status: t.status, input: t.input, output: t.output, startedAt: t.startedAt, _creationTime: t._creationTime }));
  },
});

/** Mark a scheduled item's status (claimed before firing, then posted/failed).
 *  Compare-and-set: a row the operator CANCELLED (or one already POSTED) is
 *  terminal — an in-flight drip completing afterward must NOT resurrect it to
 *  posting/posted (that silently undid the cancel). */
export const markStatus = internalMutation({
  args: {
    id: v.id("scheduledContent"),
    status: v.string(),
    taskId: v.optional(v.id("agentTasks")),
    postedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    postUrl: v.optional(v.string()),
    postPlatform: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
    uploadPostRequestId: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, taskId, postedAt, error, scheduledFor, retryCount, postUrl, postPlatform, platformPostId, uploadPostRequestId }) => {
    const row = await ctx.db.get(id);
    if (!row) return { applied: false };
    // Terminal states (cancelled / posted) reject ANY non-self transition — an
    // in-flight drip OR the transient-retry path completing afterward must never
    // resurrect the row to scheduled/posting/posted (that silently undid an
    // operator cancel, or re-posted an already-posted clip). Returns applied:false
    // so the caller can skip side-effects (e.g. the clip-posted badge patch) when
    // the row was cancelled mid-post.
    if ((row.status === "cancelled" || row.status === "posted") && status !== row.status) return { applied: false };
    const patch: Record<string, unknown> = { status };
    if (taskId !== undefined) patch.taskId = taskId;
    if (postedAt !== undefined) patch.postedAt = postedAt;
    if (error !== undefined) patch.error = error;
    if (scheduledFor !== undefined) patch.scheduledFor = scheduledFor;
    if (retryCount !== undefined) patch.retryCount = retryCount;
    if (postUrl) patch.postUrl = postUrl;
    if (postPlatform) patch.postPlatform = postPlatform;
    if (platformPostId) patch.platformPostId = platformPostId;
    if (uploadPostRequestId) patch.uploadPostRequestId = uploadPostRequestId;
    // Stamp when a row enters "posting" so the reaper can revert it if a cron
    // tick dies mid-post.
    if (status === "posting") patch.postingStartedAt = Date.now();
    await ctx.db.patch(id, patch);
    return { applied: true };
  },
});

/** ATOMIC CLAIM: transition scheduled→posting ONLY if the row is still
 *  "scheduled", returning whether THIS caller won the claim. Convex mutations
 *  serialize, so two overlapping cron ticks (or a tick racing an operator cancel)
 *  can't both claim the same row → no double-post. The drip must claim before it
 *  fetches run-task; if claimed=false it skips the row. */
export const claimForPosting = internalMutation({
  args: { id: v.id("scheduledContent") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "scheduled") return { claimed: false };
    await ctx.db.patch(id, { status: "posting", postingStartedAt: Date.now() });
    return { claimed: true };
  },
});

/* ── Automatic X schedule ───────────────────────────────────────────────────── */

/** Three posts a day: one every 8 hours. */
export const AUTO_X_GAP_MS = 8 * 3_600_000;
const isXConnected = (agent: Doc<"influencers">) =>
  (agent.connectedPlatforms ?? []).some((p) => p === "x" || p === "twitter") || !!agent.connectedSocialAccounts?.x;

/**
 * A video was just rendered for an agent with X connected: queue it to post on X, three a day, newest first. The first slot
 * is right away when nothing went out in the last 8 hours; each later slot is 8 hours after the one before. When several
 * videos wait, the freshest takes the nearest slot, so the feed always leads with the latest content. Videos that already
 * post themselves (autoPost) and clips already queued are left alone.
 */
export async function autoScheduleVideoToX(ctx: MutationCtx, job: { mintAddress: string; videoUrl: string; videoNote?: string; taskId?: Id<"agentTasks">; autoPost?: unknown }) {
  const postConfig = job.autoPost as { platforms?: string[] } | undefined;
  if (postConfig && (!postConfig.platforms?.length || postConfig.platforms.some(p => p === "x" || p === "twitter"))) return;
  const task = job.taskId ? await ctx.db.get(job.taskId) : null;
  let taskInput: Record<string, unknown> = {};
  try { taskInput = JSON.parse(task?.input ?? "{}"); } catch { /* Legacy task inputs may not be JSON. */ }
  if (taskInput.holdForApproval === true || taskInput.sample === true) return;
  const agent = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", job.mintAddress)).first();
  if (!agent || !isXConnected(agent)) return;
  const rows = await ctx.db.query("scheduledContent").withIndex("by_mint", (q) => q.eq("mintAddress", job.mintAddress)).order("desc").take(300);
  if (rows.some((r) => r.videoUrl === job.videoUrl && ["scheduled", "posting", "posted", "cancelled", "failed"].includes(r.status))) return;
  const now = Date.now();
  const xRows = rows.filter((r) => r.platforms.includes("x"));
  // The last X post that went out or is going out: the next slot is a full gap after it.
  const lastOut = Math.max(0, ...xRows.filter((r) => r.status === "posting" || r.status === "posted").map((r) => r.postedAt ?? r.scheduledFor));
  const firstSlot = Math.max(now + 2 * 60_000, lastOut + AUTO_X_GAP_MS);
  const contentTopic = typeof taskInput.topic === "string" ? taskInput.topic : job.videoNote ?? "";
  const topic = contentTopic.trim().slice(0, 200) || `New video from ${agent.name}`;
  const id = await ctx.db.insert("scheduledContent", {
    mintAddress: job.mintAddress, scheduledFor: firstSlot, status: "scheduled", topic, platforms: ["x"], videoUrl: job.videoUrl,
    taskId: job.taskId, auto: true, createdAt: now,
    caption: await autoCaption(ctx, agent, contentTopic.trim()),
  });
  // Newest content first: re-deal the waiting automatic rows into the slots, freshest to the earliest.
  const waiting = [...xRows.filter((r) => r.status === "scheduled" && r.auto === true), (await ctx.db.get(id))!].sort((a, b) => (b.createdAt - a.createdAt) || (b._creationTime - a._creationTime));
  for (let i = 0; i < waiting.length; i++) {
    const at = firstSlot + i * AUTO_X_GAP_MS;
    if (waiting[i].scheduledFor !== at) await ctx.db.patch(waiting[i]._id, { scheduledFor: at });
  }
}

async function autoCaption(ctx: MutationCtx, agent: Doc<"influencers">, topic: string) {
  const token = agent.solstarCharacterId ? await ctx.db.query("ssTokens").withIndex("by_character", (q) => q.eq("characterId", agent.solstarCharacterId!)).first() : null;
  if (token?.ticker) return videoLaunchCaption({ name: token.name || agent.name, ticker: token.ticker, bio: agent.description, topic, url: `https://solcameo.com${marketPath({ characterId: String(token.characterId), ticker: token.ticker })}` });
  return cleanMarketingText(topic ? `${topic} ${agent.name}` : `new video from ${agent.name}`).slice(0, 270);
}

/** Posted rows whose live views are due a refresh (oldest synced first), for the analytics sync. */
export const dueForViewSyncByMints = query({
  args: { authSecret: v.string(), mintAddresses: v.array(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { authSecret, mintAddresses, limit }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const out: Doc<"scheduledContent">[] = [];
    for (const mint of mintAddresses.slice(0, 25)) {
      const rows = await ctx.db.query("scheduledContent").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).order("desc").take(120);
      out.push(...rows.filter((r) => r.status === "posted" && (r.postUrl || r.uploadPostRequestId) && Date.now() - (r.viewsSyncedAt ?? 0) > 4 * 60_000));
    }
    return out.sort((a, b) => (a.viewsSyncedAt ?? 0) - (b.viewsSyncedAt ?? 0)).slice(0, limit ?? 60)
      .map((r) => ({ _id: r._id, mintAddress: r.mintAddress, postUrl: r.postUrl ?? null, platform: r.postPlatform ?? r.platforms[0] ?? "x", viewCount: r.viewCount ?? 0, uploadPostRequestId: r.uploadPostRequestId ?? null, platformPostId: r.platformPostId ?? null }));
  },
});

/** Store a fresh live view count (never lower than what was seen) and feed the 100k milestone check. */
export const recordViews = mutation({
  args: { authSecret: v.string(), id: v.id("scheduledContent"), viewCount: v.number(), postUrl: v.optional(v.string()), platformPostId: v.optional(v.string()) },
  handler: async (ctx, { authSecret, id, viewCount, postUrl, platformPostId }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const row = await ctx.db.get(id);
    if (!row) return { ok: false, updated: false };
    const next = Math.max(row.viewCount ?? 0, Math.max(0, Math.floor(viewCount)));
    await ctx.db.patch(id, { viewCount: next, viewsSyncedAt: Date.now(), ...(postUrl && !row.postUrl ? { postUrl } : {}), ...(platformPostId && !row.platformPostId ? { platformPostId } : {}) });
    await enqueueVideoMilestone(ctx, { mintAddress: row.mintAddress, views: next, key: `sched:${id}`, postUrl: row.postUrl, platform: row.postPlatform, platformPostId: row.platformPostId, videoUrl: row.videoUrl });
    return { ok: true, updated: next !== (row.viewCount ?? 0) };
  },
});

/**
 * Catch-up for generated videos that never got posted although the influencer has X connected (videos made before X was
 * connected, or by a flow that missed the hook). Oldest first, so the newest ends up with the earliest slot: the freshest
 * goes out right away and the rest follow every 8 hours. Videos the owner already posted by hand are left alone.
 */
export const autoScheduleBacklog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db.query("videoRenderJobs").order("desc").take(400);
    const cutoff = Date.now() - 30 * 86_400_000;
    const seen = new Set<string>();
    let queued = 0, checked = 0;
    for (const job of [...jobs].reverse()) {
      if (checked >= 60) break;
      if (job.phase !== "done" || !job.videoUrl || !job.mintAddress || job._creationTime < cutoff || seen.has(job.videoUrl)) continue;
      seen.add(job.videoUrl);
      checked++;
      const task = await ctx.db.get(job.taskId);
      const raw = (task as { output?: unknown } | null)?.output;
      let out: { post?: { status?: string } } | null = null;
      try { out = typeof raw === "string" ? JSON.parse(raw) : (raw as typeof out) ?? null; } catch { /* unreadable output: treat as not posted */ }
      if (out?.post?.status === "posted") continue;
      if (job.autoPost && out?.post?.status !== "failed") continue;
      const before = (await ctx.db.query("scheduledContent").withIndex("by_mint_video", (q) => q.eq("mintAddress", job.mintAddress).eq("videoUrl", job.videoUrl)).collect()).length;
      await autoScheduleVideoToX(ctx, { mintAddress: job.mintAddress, videoUrl: job.videoUrl, videoNote: job.videoNote, taskId: job.taskId });
      const after = (await ctx.db.query("scheduledContent").withIndex("by_mint_video", (q) => q.eq("mintAddress", job.mintAddress).eq("videoUrl", job.videoUrl)).collect()).length;
      if (after > before) queued++;
    }
    // Explore completions use another render table, but share this same queue.
    const recreations = await ctx.db.query("scheduledRecreations").withIndex("by_status_runAt", q => q.eq("status", "completed")).order("desc").take(100);
    for (const row of recreations) {
      if (!row.autoPost || !row.resultUrl || row.postStatus === "posted" || row._creationTime < cutoff) continue;
      const before = await ctx.db.query("scheduledContent").withIndex("by_mint_video", q => q.eq("mintAddress", row.mintAddress).eq("videoUrl", row.resultUrl)).first();
      if (before) continue;
      await autoScheduleVideoToX(ctx, { mintAddress: row.mintAddress, videoUrl: row.resultUrl, videoNote: row.referenceTitle });
      const after = await ctx.db.query("scheduledContent").withIndex("by_mint_video", q => q.eq("mintAddress", row.mintAddress).eq("videoUrl", row.resultUrl)).first();
      if (after) queued++;
    }
    return { checked, queued };
  },
});

/** Rewrites the caption of automatic posts that are still waiting, so improvements to the wording reach what is already queued. */
export const refreshAutoCaptions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const waiting = await ctx.db.query("scheduledContent").withIndex("by_status", (q) => q.eq("status", "scheduled")).take(200);
    let updated = 0;
    for (const row of waiting) {
      if (!row.auto) continue;
      const agent = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", row.mintAddress)).first();
      if (!agent) continue;
      const job = row.videoUrl ? (await ctx.db.query("videoRenderJobs").order("desc").take(300)).find((j) => j.videoUrl === row.videoUrl) : undefined;
      await ctx.db.patch(row._id, { caption: await autoCaption(ctx, agent, (job?.videoNote ?? "").trim()) });
      updated++;
    }
    return { updated };
  },
});
