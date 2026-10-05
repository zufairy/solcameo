/**
 * Pure decision logic for PER-POST campaign submissions.
 *
 * A campaign agent used to keep ONE submission per (campaign, agent) — an upsert
 * that overwrote the post link on every new clip, so an agent that posted 6 clips
 * to a campaign only ever had ONE payable submission. This module turns each
 * DISTINCT post into its own submission row so the oracle attests + pays each clip
 * independently (each Convex submission `_id` is the on-chain `submission_id`, and
 * the escrow ClaimRecord PDA is seeded by `[b"claim", campaignPda, submission_id]`
 * — so per-post rows already map to independent, budget-capped on-chain payouts;
 * no program change is required).
 *
 * The logic is kept pure (no Convex/db) so it is fully unit-testable and the
 * mutation only performs the DB effects the decision dictates.
 */

/** The durable identity fields a posted deliverable can carry. */
export type PostIdentity = {
  uploadPostRequestId?: string | null;
  platformPostId?: string | null;
  postUrl?: string | null;
};

/** Minimal shape of an existing submission row the decision needs. */
export type SubmissionIdentityRow<TId = string> = PostIdentity & {
  _id: TId;
  status: string;
};

/** Trim + treat empty/whitespace as absent. */
function clean(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length ? t : null;
}

/**
 * The single durable identity value for a post — the first non-empty of
 * `uploadPostRequestId` → `platformPostId` → `postUrl`. Returns null when the call
 * carries no real post (a bare campaign "join"). This is the "post identity key".
 */
export function postIdentityKey(p: PostIdentity): string | null {
  return clean(p.uploadPostRequestId) ?? clean(p.platformPostId) ?? clean(p.postUrl);
}

/** True when the call carries a real, measurable post (any identity field set). */
export function hasRealPost(p: PostIdentity): boolean {
  return postIdentityKey(p) !== null;
}

/**
 * True when an existing row is the SAME post as the incoming one — matched on
 * whichever durable identity field(s) the incoming post carries. Any shared
 * non-empty field (uploadPostRequestId, platformPostId, or postUrl) is a match, so
 * a post recorded first under one id and re-sent with the same set still dedupes.
 */
export function submissionMatchesIncomingPost(
  row: PostIdentity,
  incoming: PostIdentity,
): boolean {
  const eq = (a: string | null | undefined, b: string | null | undefined) => {
    const ca = clean(a);
    return ca !== null && ca === clean(b);
  };
  return (
    eq(row.uploadPostRequestId, incoming.uploadPostRequestId) ||
    eq(row.platformPostId, incoming.platformPostId) ||
    eq(row.postUrl, incoming.postUrl)
  );
}

/**
 * What a `submitForCampaign` call should do, given the agent's existing rows for
 * this campaign and the incoming post identity:
 *  - `reuse-pending`     — bare join, a pending join row already exists → no new row
 *  - `create-pending`    — bare join, no pending row yet → insert one (counts)
 *  - `patch-duplicate`   — a real post already recorded → patch that row (the caller
 *                          applies the per-submission settled-guard)
 *  - `attach-to-pending` — the FIRST real post → fill the pending join row (no new
 *                          count; the join already counted)
 *  - `create-new`        — a SUBSEQUENT real post → its own new submission (counts)
 */
export type SubmitDecision<TId> =
  | { action: "reuse-pending"; id: TId }
  | { action: "create-pending" }
  | { action: "patch-duplicate"; id: TId }
  | { action: "attach-to-pending"; id: TId }
  | { action: "create-new" };

/**
 * Decide the submission action. Pure — all DB effects live in the caller.
 *
 * Note the settled-guard is NOT applied here: a settled post #1 is still a valid
 * dedupe target (so its re-send does not create a duplicate row), but it must NOT
 * block creating post #2's row — which this function guarantees, because a fresh
 * post that matches no existing identity always resolves to `create-new`
 * (or `attach-to-pending`) regardless of any other row's settled state.
 */
export function decideSubmission<TId>(
  rows: readonly SubmissionIdentityRow<TId>[],
  incoming: PostIdentity,
): SubmitDecision<TId> {
  const pending = rows.find((r) => r.status === "pending");
  if (!hasRealPost(incoming)) {
    return pending ? { action: "reuse-pending", id: pending._id } : { action: "create-pending" };
  }
  const dup = rows.find((r) => submissionMatchesIncomingPost(r, incoming));
  if (dup) return { action: "patch-duplicate", id: dup._id };
  if (pending) return { action: "attach-to-pending", id: pending._id };
  return { action: "create-new" };
}
