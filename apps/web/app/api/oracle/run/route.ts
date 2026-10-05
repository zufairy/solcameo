import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import {
  scoreSubmission,
  normalizePostUrl,
  type ScoreInput,
  type PeerSubmission,
} from "@/lib/server/oracleFraud";
import { getPostAnalytics, resolveUsername, type PostAnalyticsResult } from "@/lib/server/uploadPost";
import { resolveOracleThresholds, toAnalyticsInput, toPeer, signalsScoreHash } from "@/lib/server/oracleRun";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { buildServerEscrowProgram, loadKeypair } from "@/lib/server/escrowServer";
import { recordPerformanceTx, rejectClipTx, getClaimRecord, getCampaignPda, getClaimPda } from "@/lib/escrow";
import { updateContentRewardViews } from "@/lib/server/contentRewardApprove";
import { sendAlert } from "@/lib/server/alert";
import { confirmViewGrowth } from "@/lib/server/oracleGrowth";

export const maxDuration = 300;
export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** Minimum SOL the oracle signer must hold before we attempt to sign (ORA-4).
 *  Env-tunable via VELLO_MIN_SIGNER_SOL; defaults to 0.05 SOL. */
const MIN_SIGNER_SOL = Number(process.env.VELLO_MIN_SIGNER_SOL ?? "0.05");

/** Alert when at least this many v2 rows are skipped (unsettled) in one tick. */
const SKIPPED_V2_ALERT = 5;

/** Best-effort u64/BN/number → JS number (view counts fit well under 2^53). */
function toNum(raw: unknown): number {
  if (raw == null) return 0;
  const n = typeof raw === "number" ? raw : Number((raw as { toString(): string }).toString());
  return Number.isFinite(n) ? n : 0;
}

/** One row returned by `api.submissions.dueForVerification` (annotated locally so
 *  the route typechecks without regenerating Convex types). */
type DueSubmission = {
  _id: string;
  creationTimeMs: number;
  campaignId: string;
  influencerMint: string;
  submitterWallet: string;
  platform: string | null;
  postUrl: string | null;
  uploadPostRequestId: string | null;
  platformPostId: string | null;
  postedAt: number | null;
  // On-chain mirror joins (dueForVerification projection). v1 (onchainVersion
  // null/1) ignores these; v2 uses creatorWallet (campaign PDA seed) + agentWallet
  // (payout beneficiary) for the record_performance / reject_clip call.
  onchainVersion: number | null;
  creatorWallet: string | null;
  agentWallet: string | null;
  // When this submission mirrors a jobtepi/ryze content_rewards_submissions row,
  // its Supabase id — the oracle backfills the measured views onto it (display).
  contentRewardSubmissionId: string | null;
};

/** A 64-byte zero buffer for the `attest_tx` arg when there is no external
 *  attestation signature to anchor (the on-chain field is a fixed [u8; 64]). */
const ZERO_ATTEST_TX = Buffer.alloc(64);

/** A 32-byte zero buffer for the `score_hash` arg on a pure staleness-basis
 *  RE-record (the on-chain field is a fixed [u8; 32]). A re-attest re-records the
 *  SAME stored viewCount, so no new signals are scored — the hash is just
 *  refreshed metadata, not load-bearing. */
const ZERO_SCORE_HASH = Buffer.alloc(32);

/** One row returned by `api.submissions.dueForReattest` (annotated locally so the
 *  route typechecks without regenerating Convex types). Approved-but-unpaid v2
 *  rows whose on-chain `last_recorded_slot` we refresh this tick. */
type ReattestRow = {
  _id: string;
  campaignId: string;
  influencerMint: string;
  viewCount: number;
  payoutAmountUsdc: number;
  creatorWallet: string | null;
  agentWallet: string | null;
};

type GrowthRow = {
  _id: string; campaignId: string; influencerMint: string; submitterWallet: string;
  platform: string | null; postUrl: string | null; platformPostId: string | null;
  uploadPostRequestId: string | null; postedAt: number; viewCount: number;
  growthCandidateViews?: number; growthCandidateAt?: number;
  creatorWallet: string; agentWallet: string;
};

/** A raw submission doc returned by `api.submissions.listByCampaign` (the fields
 *  `toPeer` consumes). */
type PeerRow = {
  _id: string;
  _creationTime: number;
  status: string;
  platform?: string | null;
  platformPostId?: string | null;
  postUrl?: string | null;
  submitterWallet: string;
};

/**
 * The settlement-oracle worker tick (internal-secret ONLY; sole caller is the
 * `runDueOracle` cron in convex/crons.ts).
 *
 * Per tick: query Convex for matured, unsettled submissions → read each post's
 * live view count from upload-post → score it through the pure fraud engine
 * (`scoreSubmission`) → settle approved/rejected via `oracle.settleFromOracle`.
 * Each submission is scored in ISOLATION (`Promise.allSettled`) so one bad post
 * can never abort the batch. defer/manual_review are left for a later tick / a
 * human; only approved|rejected are written back.
 */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const secret = process.env.INTERNAL_CRON_SECRET ?? "";
    if (!CONVEX_URL || !secret) {
      return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });
    }

    const convex = new ConvexHttpClient(CONVEX_URL);
    const config = resolveOracleThresholds();
    const windowMs = config.maturationHours * 3_600_000;

    const due = await convex.query(api.submissions.dueForVerification, { authSecret: secret, windowMs });
    const now = Date.now();
    let settled = 0;
    let deferred = 0;
    let manualReview = 0;
    let flagged = 0;
    // v2 rows we deliberately did NOT settle this tick because the on-chain rail
    // isn't usable (oracle key unset / creator|agent wallet missing). They stay in
    // dueForVerification and retry next tick — counted so ops can see the backlog.
    let skippedV2 = 0;
    // Approved-but-unpaid v2 rows whose on-chain attestation basis we refreshed
    // this tick (slot refresh so claims never go AttestationStale).
    let reattested = 0;
    let growthAttested = 0;

    // ORA-4: oracle signer SOL exhaustion pre-flight. record_performance /
    // reject_clip / reattest all sign with VELLO_ORACLE_SECRET; a drained key makes
    // every on-chain call fail as a generic revert (looks like a normal retry),
    // silently stranding v2 settlements. Read the balance ONCE up front; if it's
    // low, alert with a DISTINCT reason and SKIP only the on-chain (v2) signing
    // paths this tick — v1/off-chain settlements still flow, and v2 rows stay in
    // dueForVerification to retry once the key is topped up. A failed balance READ
    // is fail-OPEN (a flaky RPC must not halt settlement).
    const runOracleKey = process.env.VELLO_ORACLE_SECRET;
    let oracleSolLow = false;
    if (runOracleKey) {
      try {
        const oracleKp = loadKeypair(runOracleKey);
        const lamports = await buildServerEscrowProgram(oracleKp).provider.connection.getBalance(oracleKp.publicKey);
        const sol = lamports / LAMPORTS_PER_SOL;
        if (sol < MIN_SIGNER_SOL) {
          oracleSolLow = true;
          await sendAlert("signer-low-sol", {
            signer: "oracle",
            pubkey: oracleKp.publicKey.toBase58(),
            balanceSol: sol,
            thresholdSol: MIN_SIGNER_SOL,
            note: "oracle skipped on-chain settlement this tick — top up VELLO_ORACLE_SECRET's wallet",
          });
          console.error(`[oracle.run] oracle signer low on SOL (${sol} < ${MIN_SIGNER_SOL}) — deferring v2 on-chain settle this tick`);
        }
      } catch (err) {
        console.warn("[oracle.run] SOL balance pre-flight read failed — proceeding (fail-open):", err instanceof Error ? err.message : err);
      }
    }

    // Memoize peers by campaignId for this tick: many due rows share a campaign,
    // and peers are read-only within a tick, so a campaign's submissions are
    // fetched (bounded) at most ONCE — instead of once per due row. Cache the
    // PROMISE (not the resolved rows) so concurrent rows of the same campaign in
    // `Promise.allSettled` share the single in-flight fetch instead of racing.
    const peerCache = new Map<string, Promise<PeerRow[]>>();
    const getPeers = (campaignId: string): Promise<PeerRow[]> => {
      const cached = peerCache.get(campaignId);
      if (cached) return cached;
      const p = convex
        .query(api.submissions.peersForVerification, {
          authSecret: secret,
          campaignId: campaignId as Id<"campaigns">,
        })
        .then((rows) => rows as PeerRow[]);
      peerCache.set(campaignId, p);
      return p;
    };

    await Promise.allSettled(
      (due as DueSubmission[]).map(async (s) => {
        // ── ATT-1: settle-only re-drive ───────────────────────────────────────
        // record_performance and the Convex settle are NOT atomic. When the settle
        // throws AFTER a successful on-chain record, the row is left unsettled and
        // re-enters dueForVerification. RE-scoring it here risks FLIPPING an
        // already-recorded approval to rejected/manual_review — which would freeze
        // the clip on-chain / orphan the accrued delta. So before scoring, probe the
        // on-chain ClaimRecord: if it already landed, skip the fraud re-score and
        // just re-affirm the settle from the committed on-chain state (idempotent +
        // monotonic; a re-record for a fresh attestation sig is a zero-delta no-op).
        const isV2Row = (s.onchainVersion ?? 1) >= 2;
        if (isV2Row && runOracleKey && !oracleSolLow && s.creatorWallet && s.agentWallet) {
          try {
            const program = buildServerEscrowProgram(loadKeypair(runOracleKey));
            const [campaignPda] = getCampaignPda(s.campaignId, s.creatorWallet);
            const [claimPda] = getClaimPda(campaignPda, s._id);
            const rec = await getClaimRecord(program, claimPda).catch(() => null);
            if (rec && !!rec.frozen) {
              // Already reject_clip'd on-chain — a fresh score must not un-reject it.
              await convex.mutation(api.oracle.settleFromOracle, {
                authSecret: secret,
                submissionId: s._id as Id<"submissions">,
                decision: "rejected",
                viewCount: toNum(rec.verifiedViews),
              });
              settled += 1;
              return;
            }
            if (rec && toNum(rec.verifiedViews) > 0) {
              // Already recorded approved on a prior tick — re-record the SAME
              // cumulative (monotonic no-op) for a fresh attestation sig, then
              // settle approved. NO re-score, so the decision can never flip.
              const recordedViews = toNum(rec.verifiedViews);
              const { txSignature } = await recordPerformanceTx(
                program,
                s.campaignId,
                s._id,
                s.creatorWallet,
                new PublicKey(s.agentWallet),
                recordedViews,
                ZERO_SCORE_HASH,
                ZERO_ATTEST_TX,
              );
              await convex.mutation(api.oracle.settleFromOracle, {
                authSecret: secret,
                submissionId: s._id as Id<"submissions">,
                decision: "approved",
                viewCount: recordedViews,
                attestationTx: txSignature,
              });
              settled += 1;
              return;
            }
          } catch (err) {
            // Probe failed (pre-IDL-regen the readers are runtime-dead, or a
            // transient RPC/Convex error). Fall through to the normal score path;
            // a re-record there is idempotent/monotonic on-chain, so no harm.
            console.warn(`[oracle.run] v2 settle-only probe failed submission=${s._id} — scoring normally:`, err instanceof Error ? err.message : err);
          }
        }

        const username = resolveUsername(s.influencerMint);
        const platform = s.platform ?? undefined;

        // Read live analytics by the durable handle the post was recorded under.
        let res: PostAnalyticsResult;
        if (s.platformPostId && platform) {
          res = await getPostAnalytics({ platformPostId: s.platformPostId, platform, username });
        } else if (s.uploadPostRequestId) {
          res = await getPostAnalytics({ requestId: s.uploadPostRequestId, platform });
        } else {
          // dueForVerification guarantees one of the two ids — defensive only.
          res = { ok: false, reason: "error" } as PostAnalyticsResult;
        }

        // The live post link + native id upload-post resolved while measuring —
        // persisted back onto the submission (below) so the per-post View modal can
        // link to the actual post. Only set when present; never clobbers a good value.
        const resolvedPostUrl = res.ok ? res.postUrl : undefined;
        const resolvedPlatformPostId = res.ok ? res.platformPostId : undefined;

        const peersRaw = await getPeers(s.campaignId);
        const peers: PeerSubmission[] = peersRaw.filter((p) => p._id !== s._id).map(toPeer);

        const input: ScoreInput = {
          platform: platform ?? "",
          analytics: toAnalyticsInput(res),
          postedAtMs: s.postedAt ?? s.creationTimeMs,
          nowMs: now,
          submissionId: s._id,
          submissionCreationTimeMs: s.creationTimeMs,
          submitterWallet: s.submitterWallet,
          sourceKey: undefined,
          normalizedPostUrl: s.postUrl ? normalizePostUrl(s.postUrl) : undefined,
          platformPostId: s.platformPostId ?? undefined,
          peers,
          config,
        };

        const result = scoreSubmission(input);

        if (result.decision === "approved" || result.decision === "rejected") {
          const scoreHashHex = signalsScoreHash(result.signals);
          // v2 campaigns settle THROUGH the on-chain program: the oracle posts
          // record_performance (approved) / reject_clip (rejected) first, then the
          // Convex mirror records the REAL on-chain signature. v1/legacy campaigns
          // (onchainVersion null/1) keep the exact off-chain behavior — no Solana.
          const isV2 = (s.onchainVersion ?? 1) >= 2;
          const oracleKey = runOracleKey;
          // On-chain rail usable for this row only when the oracle key is set AND
          // the signer isn't SOL-drained (ORA-4). When drained we defer the v2
          // signing paths (below) so v1 still flows and v2 retries next tick.
          const oracleUsable = !!oracleKey && !oracleSolLow;

          if (isV2 && oracleUsable && s.creatorWallet) {
            if (result.decision === "approved") {
              // Need a payout beneficiary to record on-chain. If the agent has no
              // provisioned wallet, the keeper can't pay it — skip + log, leaving
              // the row to retry once a wallet is set. NEVER settle the mirror for
              // an approved v2 row without an on-chain attestation (else dueForClaim
              // would never find it / the NAV credit would be unbacked).
              if (!s.agentWallet) {
                console.warn(`[oracle.run] v2 approved submission=${s._id} has no agentWallet — skipping on-chain record, will retry`);
                skippedV2 += 1;
                return;
              }
              // ATT-1/ATT-2: record and settle are SPLIT into two try blocks so a
              // settle failure AFTER a landed on-chain record is (a) labelled
              // correctly and (b) does NOT re-record. The row stays unsettled and is
              // recovered next tick by the settle-only probe at the top of this map
              // (which re-affirms WITHOUT re-scoring, so the decision can't flip).
              let recordSig: string;
              try {
                const program = buildServerEscrowProgram(loadKeypair(oracleKey!));
                const scoreHashBytes = Buffer.from(scoreHashHex, "hex");
                const rp = await recordPerformanceTx(
                  program,
                  s.campaignId,
                  s._id,
                  s.creatorWallet,
                  new PublicKey(s.agentWallet),
                  result.viewCount,
                  scoreHashBytes,
                  ZERO_ATTEST_TX,
                );
                recordSig = rp.txSignature;
              } catch (err) {
                // On-chain record failed — do NOT settle the mirror (an approved v2
                // row without an attestation is never claimable). Leave it to retry
                // next tick. record_performance is idempotent on-chain.
                console.warn(`[oracle.run] v2 record_performance failed submission=${s._id} — will retry:`, err instanceof Error ? err.message : err);
                await sendAlert("oracle-record-failed", { submissionId: s._id, campaignId: s.campaignId, message: err instanceof Error ? err.message : String(err) });
                return;
              }
              try {
                await convex.mutation(api.oracle.settleFromOracle, {
                  authSecret: secret,
                  submissionId: s._id as Id<"submissions">,
                  decision: "approved",
                  viewCount: result.viewCount,
                  scoreHash: scoreHashHex,
                  attestationTx: recordSig,
                  softFlags: result.signals.softFlags,
                  ...(resolvedPostUrl ? { postUrl: resolvedPostUrl } : {}),
                  ...(resolvedPlatformPostId ? { platformPostId: resolvedPlatformPostId } : {}),
                });
                settled += 1;
                if (result.signals.softFlags.length) flagged += 1;
                // Backfill the measured views onto the linked jobtepi/ryze display
                // submission (best-effort; the USDC already moved via the Convex
                // mirror + on-chain claim, so a failure here only lags the display).
                if (s.contentRewardSubmissionId) {
                  try {
                    const bf = await updateContentRewardViews({ submissionId: s.contentRewardSubmissionId, views: result.viewCount });
                    if (!bf.ok) console.warn(`[oracle.run] ryze views backfill skipped submission=${s._id}: ${bf.reason}`);
                  } catch (e) {
                    console.warn(`[oracle.run] ryze views backfill error submission=${s._id}:`, e instanceof Error ? e.message : e);
                  }
                }
              } catch (err) {
                // The on-chain record LANDED but the Convex mirror settle failed. Do
                // NOT re-record — the settle-only probe re-affirms it next tick from
                // the committed on-chain state (recordPerformance is monotonic, so
                // the re-record there is a no-op). Labelled as a SETTLE failure.
                console.warn(`[oracle.run] v2 settle FAILED after on-chain record landed submission=${s._id} — will re-affirm next tick:`, err instanceof Error ? err.message : err);
                await sendAlert("oracle-settle-after-record-failed", { submissionId: s._id, campaignId: s.campaignId, attestationTx: recordSig, message: err instanceof Error ? err.message : String(err) });
                return;
              }
            } else {
              // rejected: freeze the clip on-chain, then mirror the rejection.
              try {
                const program = buildServerEscrowProgram(loadKeypair(oracleKey!));
                const { txSignature } = await rejectClipTx(program, s.campaignId, s._id, s.creatorWallet);
                await convex.mutation(api.oracle.settleFromOracle, {
                  authSecret: secret,
                  submissionId: s._id as Id<"submissions">,
                  decision: "rejected",
                  viewCount: result.viewCount,
                  scoreHash: scoreHashHex,
                  attestationTx: txSignature,
                  softFlags: result.signals.softFlags,
                  ...(resolvedPostUrl ? { postUrl: resolvedPostUrl } : {}),
                  ...(resolvedPlatformPostId ? { platformPostId: resolvedPlatformPostId } : {}),
                });
                settled += 1;
              } catch (err) {
                // reject_clip failed — mirror the rejection anyway (no money moves on
                // a rejection, so an off-chain mirror is safe; the freeze retries via
                // a future reject path / is moot once budget refunds). Logged for ops.
                console.warn(`[oracle.run] v2 reject_clip failed submission=${s._id} — mirroring rejection off-chain:`, err instanceof Error ? err.message : err);
                await convex.mutation(api.oracle.settleFromOracle, {
                  authSecret: secret,
                  submissionId: s._id as Id<"submissions">,
                  decision: "rejected",
                  viewCount: result.viewCount,
                  scoreHash: scoreHashHex,
                  softFlags: result.signals.softFlags,
                  ...(resolvedPostUrl ? { postUrl: resolvedPostUrl } : {}),
                  ...(resolvedPlatformPostId ? { platformPostId: resolvedPlatformPostId } : {}),
                });
                settled += 1;
              }
            }
          } else if (isV2) {
            // v2 campaign but the on-chain rail isn't usable for this row: the
            // oracle key is unset OR the creator/agent wallet is missing. We must
            // NOT settle the mirror — a v2 settle skips distributions.dispatch
            // (campaigns.markVerified) AND, with no attestationTx, the row never
            // enters dueForClaim → it would pay via NEITHER rail and never retry.
            // SKIP entirely (no settle, no record): the row stays in
            // dueForVerification and is recovered next tick once the key/wallet is
            // provisioned. Count it so ops can see how many are waiting.
            const why = !oracleKey
              ? "VELLO_ORACLE_SECRET unset"
              : oracleSolLow
                ? "oracle signer low on SOL"
                : "no creatorWallet";
            console.warn(`[oracle.run] v2 submission=${s._id} not settled (${why}) — skipping, will retry once provisioned`);
            skippedV2 += 1;
          } else {
            // v1/legacy — EXACT current off-chain behavior. settleFromOracle owns
            // the payout (schedules distributions.dispatch).
            await convex.mutation(api.oracle.settleFromOracle, {
              authSecret: secret,
              submissionId: s._id as Id<"submissions">,
              decision: result.decision,
              viewCount: result.viewCount,
              scoreHash: scoreHashHex,
              softFlags: result.signals.softFlags,
              ...(resolvedPostUrl ? { postUrl: resolvedPostUrl } : {}),
              ...(resolvedPlatformPostId ? { platformPostId: resolvedPlatformPostId } : {}),
            });
            settled += 1;
            if (result.signals.softFlags.length) flagged += 1;
          }
        } else if (result.decision === "defer") {
          deferred += 1;
        } else {
          // manual_review: the scorer can't auto-decide. Move the row to the
          // TERMINAL "needs_review" state so it leaves dueForVerification's
          // "submitted" scan (otherwise it re-returns every tick forever and
          // starves fresh payable submissions out of the limited due slots).
          await convex.mutation(api.oracle.markForReview, {
            authSecret: secret,
            submissionId: s._id as Id<"submissions">,
            reason: result.reason,
          });
          manualReview += 1;
          console.warn(`[oracle.run] manual_review submission=${s._id} reason=${result.reason ?? "unknown"}`);
        }
      }),
    );

    // ── Staleness-basis refresh (BUG: AttestationStale strand) ────────────────
    // `record_performance` otherwise fires exactly ONCE per submission (the fresh
    // settle path above), then the approved row leaves dueForVerification forever
    // and on-chain `last_recorded_slot` freezes at that single attestation. If the
    // claim keeper misses the [dispute, staleness] window once, the clip becomes
    // permanently AttestationStale and the USDC strands. So every tick we RE-record
    // the SAME stored cumulative viewCount for approved-but-unpaid v2 clips: the
    // program accepts `verified_views == stored` and just refreshes
    // `last_recorded_slot` (zero delta, idempotent + monotonic on-chain — retries
    // are safe). This is a pure slot refresh: NO analytics re-fetch, NO re-score.
    // Skipped when the oracle signer is SOL-low (ORA-4) — the slot refresh signs
    // too, so it defers to the next tick rather than looping generic reverts.
    const oracleKey = runOracleKey;
    if (oracleKey && !oracleSolLow) {
      const reattestDue = (await convex.query(api.submissions.dueForReattest, {
        authSecret: secret,
      })) as ReattestRow[];
      await Promise.allSettled(
        reattestDue.map(async (s) => {
          // Need both PDA seed (creatorWallet) and beneficiary (agentWallet) to
          // re-record. Missing either → skip; the next tick retries once provisioned.
          if (!s.creatorWallet || !s.agentWallet) {
            console.warn(`[oracle.run] reattest submission=${s._id} missing creator/agent wallet — skipping`);
            return;
          }
          try {
            const program = buildServerEscrowProgram(loadKeypair(oracleKey));
            const { txSignature } = await recordPerformanceTx(
              program,
              s.campaignId,
              s._id,
              s.creatorWallet,
              new PublicKey(s.agentWallet),
              s.viewCount, // SAME stored cumulative views — refreshes the slot only
              ZERO_SCORE_HASH,
              ZERO_ATTEST_TX,
            );
            await convex.mutation(api.oracle.refreshAttestation, {
              authSecret: secret,
              submissionId: s._id as Id<"submissions">,
              attestationTx: txSignature,
            });
            reattested += 1;
          } catch (err) {
            // On-chain re-record failed — leave the prior attestation in place and
            // retry next tick (idempotent + monotonic on-chain, so retries are safe).
            console.warn(`[oracle.run] reattest record_performance failed submission=${s._id} — will retry:`, err instanceof Error ? err.message : err);
          }
        }),
      );
    }

    // Approved v2 posts keep earning while their campaign is live. A fresh
    // platform count is sampled twice before increasing the on-chain high-water;
    // one transient spike or analytics dip cannot trigger a payout.
    if (oracleKey && !oracleSolLow) {
      const growthDue = (await convex.query(api.submissions.dueForGrowth, { authSecret: secret, limit: 40 })) as GrowthRow[];
      await Promise.allSettled(growthDue.map(async (s) => {
        try {
          const platform = s.platform ?? undefined;
          const username = resolveUsername(s.influencerMint);
          if ((!s.platformPostId || !platform) && !s.uploadPostRequestId) return;
          const analytics = s.platformPostId && platform
            ? await getPostAnalytics({ platformPostId: s.platformPostId, platform, username })
            : await getPostAnalytics({ requestId: s.uploadPostRequestId!, platform });
          const score = scoreSubmission({
            platform: s.platform ?? "", analytics: toAnalyticsInput(analytics),
            postedAtMs: s.postedAt, nowMs: Date.now(), submissionId: s._id,
            submissionCreationTimeMs: s.postedAt, submitterWallet: s.submitterWallet,
            normalizedPostUrl: s.postUrl ? normalizePostUrl(s.postUrl) : undefined,
            platformPostId: s.platformPostId ?? undefined, peers: [], config: { ...config, maturationHours: 0 },
          });
          if (score.decision !== "approved" || score.signals.softFlags.length > 0) return;
          const next = confirmViewGrowth({
            verifiedViews: s.viewCount, measuredViews: score.viewCount,
            candidateViews: s.growthCandidateViews, candidateAt: s.growthCandidateAt, now: Date.now(),
          });
          if (next.confirmedViews <= s.viewCount) {
            await convex.mutation(api.oracle.recordGrowthSample, {
              authSecret: secret, submissionId: s._id as Id<"submissions">,
              candidateViews: next.candidateViews, candidateAt: next.candidateAt,
            });
            return;
          }
          const program = buildServerEscrowProgram(loadKeypair(oracleKey));
          const { txSignature } = await recordPerformanceTx(
            program, s.campaignId, s._id, s.creatorWallet, new PublicKey(s.agentWallet),
            next.confirmedViews, Buffer.from(signalsScoreHash(score.signals), "hex"), ZERO_ATTEST_TX,
          );
          const [campaignPda] = getCampaignPda(s.campaignId, s.creatorWallet);
          const [claimPda] = getClaimPda(campaignPda, s._id);
          const claim = await getClaimRecord(program, claimPda);
          if (!claim) throw new Error("on-chain claim record missing after growth attestation");
          await convex.mutation(api.oracle.commitGrowth, {
            authSecret: secret, submissionId: s._id as Id<"submissions">,
            confirmedViews: next.confirmedViews, accruedUsdc: toNum(claim.accrued) / 1_000_000,
            attestationTx: txSignature, candidateViews: next.candidateViews, candidateAt: next.candidateAt,
          });
          growthAttested += 1;
        } catch (err) {
          console.warn(`[oracle.run] growth sync failed submission=${s._id}:`, err instanceof Error ? err.message : err);
        }
      }));
    }

    // ORA-3: surface a non-trivial v2 settlement backlog. A few skips are normal
    // (a wallet just being provisioned); a large or total backlog means v2 payouts
    // are stalled system-wide (oracle key unset, SOL-drained, or a chain fault) and
    // needs eyes. Best-effort — never breaks the tick.
    if (skippedV2 >= SKIPPED_V2_ALERT) {
      await sendAlert("oracle-skippedV2-backlog", { due: due.length, settled, skippedV2, reattested }).catch(() => {});
    }

    return NextResponse.json({ ok: true, due: due.length, settled, deferred, manualReview, flagged, skippedV2, reattested, growthAttested });
  } catch (err) {
    console.error("[oracle.run]", err);
    await sendAlert("oracle-run-error", { message: err instanceof Error ? err.message : String(err) }).catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "Oracle run failed" }, { status: 500 });
  }
}
