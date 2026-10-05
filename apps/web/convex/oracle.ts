import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { enqueueVideoMilestone } from "./contentControl";
import { bumpLiveViews } from "./platformStats";

export const payoutEventsByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const rows = await ctx.db.query("campaignPayoutEvents")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
    return rows.sort((a, b) => b.recordedAt - a.recordedAt).slice(0, 100);
  },
});

/**
 * Oracle settlement entry point. The oracle worker (a Next route holding
 * INTERNAL_CRON_SECRET) measures a matured submission's view count, then calls
 * this to settle it. This is a secret-gated PUBLIC mutation that forwards into
 * the INTERNAL `campaigns.markVerified` — keeping `markVerified` un-spoofable
 * (internal, not reachable from the public API) while giving the secret-holding
 * route a typed entry point. Returns markVerified's shape:
 * `{ alreadyProcessed, status, payoutAmountUsdc }` (idempotent on retries).
 */
export const settleFromOracle = mutation({
  args: {
    authSecret: v.string(),
    submissionId: v.id("submissions"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    viewCount: v.number(),
    scoreHash: v.optional(v.string()),
    attestationTx: v.optional(v.string()),
    // Non-blocking fraud signals from the scorer. On an APPROVED payout we persist
    // these to `reviewFlags` so a suspicious-but-paid submission keeps an audit
    // trail. The settlement itself is unchanged — markVerified still owns it.
    softFlags: v.optional(v.array(v.string())),
    // The live post link + native id the oracle RESOLVED while measuring this
    // post (upload-post analytics returns the permalink + platform_post_id). We
    // persist them so the per-post View modal can link to the actual post — set
    // only when non-empty, and never overwrite a good stored value with empty.
    postUrl: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { authSecret, submissionId, decision, viewCount, scoreHash, attestationTx, softFlags, postUrl, platformPostId },
  ): Promise<{ alreadyProcessed: boolean; status: string; payoutAmountUsdc: number } | { ok: false; skipped: string }> => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const res: { alreadyProcessed: boolean; status: string; payoutAmountUsdc: number } | { ok: false; skipped: string } =
      await ctx.runMutation(internal.campaigns.markVerified, { submissionId, decision, viewCount, scoreHash, attestationTx });
    // Persist the audit flags + resolved post link in ONE patch. Each field is set
    // only when meaningfully present, so an empty resolve never clobbers a good value.
    const patch: Record<string, unknown> = {};
    if (decision === "approved" && softFlags?.length) patch.reviewFlags = softFlags;
    if (postUrl && postUrl.length > 0) patch.postUrl = postUrl;
    if (platformPostId && platformPostId.length > 0) patch.platformPostId = platformPostId;
    if (Object.keys(patch).length > 0) await ctx.db.patch(submissionId, patch);
    return res;
  },
});

/**
 * Give the oracle's `manual_review` outcome a TERMINAL, admin-reviewable state.
 * When the scorer can't make an automated call (proxy metrics like Facebook/
 * LinkedIn reach, unsupported platforms, past-deadline-unreadable analytics) the
 * route can't approve or reject — but it MUST move the row off the "submitted"
 * scan, or `dueForVerification` re-returns it every tick forever, starving fresh
 * payable submissions out of the `limit` due slots. Setting `status:"needs_review"`
 * removes it from the `by_status:"submitted"` scan entirely; admins list these via
 * the `by_status` index. Secret-gated (same idiom as settleFromOracle).
 *
 * Idempotent: never overrides a row the oracle already settled
 * (`verificationDecision` set) or already moved to "needs_review".
 */
export const markForReview = mutation({
  args: {
    authSecret: v.string(),
    submissionId: v.id("submissions"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { authSecret, submissionId, reason }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const submission = await ctx.db.get(submissionId);
    if (!submission) return { ok: false as const };
    // Never override a settled row, and stay idempotent on re-marks.
    if (submission.verificationDecision !== undefined || submission.status === "needs_review") {
      return { ok: true as const, alreadyMarked: true };
    }
    await ctx.db.patch(submissionId, {
      status: "needs_review",
      ...(reason ? { reviewReason: reason } : {}),
    });
    return { ok: true as const };
  },
});

/**
 * Mirror an on-chain `claim_payout` result onto the submission. The claim keeper
 * (a Next route holding INTERNAL_CRON_SECRET) calls this AFTER claim_payout
 * confirms, recording how much USDC actually landed (`paidUsdc`, mirror of
 * ClaimRecord.paid), the claim tx signature, and optionally the ClaimRecord PDA.
 *
 * The on-chain claim is the real idempotency source (a duplicate crank pays 0);
 * this mutation just mirrors the latest cumulative paid amount, so re-calling it
 * with the same/greater paidUsdc is safe. Secret-gated (same idiom as
 * settleFromOracle). Returns `{ ok: false }` for an unknown submission so a
 * keeper race (submission deleted) doesn't throw.
 */
export const markPaidOnchain = mutation({
  args: {
    authSecret: v.string(),
    submissionId: v.id("submissions"),
    paidUsdc: v.number(),
    // Optional: a pure NAV-credit-RETRY tick (the row was already fully paid on a
    // prior tick but its credit lagged) has no NEW claim signature — omit it so the
    // prior signature is preserved rather than overwritten with a placeholder.
    payoutTxSignature: v.optional(v.string()),
    claimPda: v.optional(v.string()),
    // Terminal flag + cumulative net credited, advanced by the claim keeper from
    // computeClaimSettlement. Optional + conditionally patched so a caller that
    // omits them (or an old caller) never writes `undefined` over a real value.
    claimDone: v.optional(v.boolean()),
    navCreditedUsdc: v.optional(v.number()),
  },
  handler: async (ctx, { authSecret, submissionId, paidUsdc, payoutTxSignature, claimPda, claimDone, navCreditedUsdc }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const submission = await ctx.db.get(submissionId);
    if (!submission) return { ok: false as const };
    if (payoutTxSignature && paidUsdc > (submission.paidUsdc ?? 0)) {
      const existing = await ctx.db.query("campaignPayoutEvents")
        .withIndex("by_submission_paid", (q) => q.eq("submissionId", submissionId).eq("cumulativePaidUsdc", paidUsdc))
        .first();
      if (!existing) await ctx.db.insert("campaignPayoutEvents", {
        submissionId, mintAddress: submission.influencerMint, campaignId: submission.campaignId,
        txSignature: payoutTxSignature, grossDeltaUsdc: paidUsdc - (submission.paidUsdc ?? 0),
        cumulativePaidUsdc: paidUsdc, recordedAt: Date.now(),
      });
    }
    await ctx.db.patch(submissionId, {
      paidUsdc,
      ...(payoutTxSignature ? { payoutTxSignature } : {}),
      ...(claimPda ? { claimPda } : {}),
      ...(claimDone !== undefined ? { claimDone } : {}),
      ...(navCreditedUsdc !== undefined ? { navCreditedUsdc } : {}),
    });
    return { ok: true as const };
  },
});

/**
 * Record a fresh on-chain re-attestation signature for an approved-but-unpaid v2
 * submission. The oracle re-records `record_performance` with the SAME stored
 * `viewCount` every tick (a pure staleness-basis refresh — see
 * `submissions.dueForReattest`); when that re-record confirms, the keeper calls
 * this to advance `attestationTx` to the new signature so the mirror reflects the
 * latest on-chain attestation.
 *
 * Strictly a metadata refresh: it patches ONLY `attestationTx` (and
 * `verifiedAt`/`lastReattestAt` timestamps). It MUST NOT touch
 * `verificationDecision`, `status`, `payoutAmountUsdc`, `paidUsdc`, or any
 * settlement/payout field. Secret-gated (same idiom as `markPaidOnchain`).
 * Returns `{ ok: false }` for an unknown submission so a keeper race doesn't throw.
 */
export const refreshAttestation = mutation({
  args: {
    authSecret: v.string(),
    submissionId: v.id("submissions"),
    attestationTx: v.string(),
  },
  handler: async (ctx, { authSecret, submissionId, attestationTx }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const submission = await ctx.db.get(submissionId);
    if (!submission) return { ok: false as const };
    const now = Date.now();
    await ctx.db.patch(submissionId, {
      attestationTx,
      verifiedAt: now,
      lastReattestAt: now,
    });
    return { ok: true as const };
  },
});

/** Store the first growth sample without increasing payable views. */
export const recordGrowthSample = mutation({
  args: { authSecret: v.string(), submissionId: v.id("submissions"), candidateViews: v.number(), candidateAt: v.number() },
  handler: async (ctx, { authSecret, submissionId, candidateViews, candidateAt }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const s = await ctx.db.get(submissionId);
    if (!s || s.status !== "verified" || s.verificationDecision !== "approved") return { ok: false as const };
    await ctx.db.patch(submissionId, { growthCandidateViews: candidateViews, growthCandidateAt: candidateAt, lastGrowthMeasuredAt: Date.now() });
    return { ok: true as const };
  },
});

/** Mirror a confirmed on-chain growth attestation; the chain is the accrual truth. */
export const commitGrowth = mutation({
  args: {
    authSecret: v.string(), submissionId: v.id("submissions"), confirmedViews: v.number(),
    accruedUsdc: v.number(), attestationTx: v.string(), candidateViews: v.number(), candidateAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || args.authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const s = await ctx.db.get(args.submissionId);
    if (!s || s.status !== "verified" || s.verificationDecision !== "approved") return { ok: false as const };
    if (!Number.isSafeInteger(args.confirmedViews) || args.confirmedViews <= (s.viewCount ?? 0)) return { ok: true as const, alreadyRecorded: true };
    if (!Number.isFinite(args.accruedUsdc) || args.accruedUsdc < 0) throw new Error("invalid on-chain accrual");
    const campaign = await ctx.db.get(s.campaignId);
    if (!campaign || (campaign.onchainVersion ?? 1) < 2) throw new Error("on-chain campaign required");
    const oldPayout = s.payoutAmountUsdc ?? 0;
    const remaining = Math.max(0, campaign.budget - (campaign.spentUsdc ?? 0));
    const cap = campaign.maxPayoutUsdc ?? Number.POSITIVE_INFINITY;
    const payout = Math.max(oldPayout, Math.min(args.accruedUsdc, cap, oldPayout + remaining));
    const delta = Math.max(0, payout - oldPayout);
    await ctx.db.patch(args.submissionId, {
      viewCount: args.confirmedViews, payoutAmountUsdc: payout, attestationTx: args.attestationTx,
      claimDone: payout > (s.paidUsdc ?? 0) ? false : s.claimDone,
      growthCandidateViews: args.candidateViews, growthCandidateAt: args.candidateAt,
      lastGrowthMeasuredAt: Date.now(), lastReattestAt: Date.now(),
    });
    if (delta > 0) await ctx.db.patch(s.campaignId, { spentUsdc: (campaign.spentUsdc ?? 0) + delta });
    await bumpLiveViews(ctx, args.confirmedViews - (s.viewCount ?? 0)); // live hero counter
    if (s.postUrl) await enqueueVideoMilestone(ctx, {
      mintAddress: s.influencerMint, views: args.confirmedViews, key: `submission:${s._id}`, postUrl: s.postUrl,
      platform: s.platform, platformPostId: s.platformPostId,
    });
    return { ok: true as const, payoutAmountUsdc: payout, newOwedUsdc: delta };
  },
});
