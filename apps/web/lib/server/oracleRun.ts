/**
 * Pure mapping/threshold helpers for the settlement oracle's run loop.
 *
 * The worker route (`app/api/oracle/run/route.ts`) is thin IO glue: it queries
 * Convex for due submissions, reads each post's live analytics from upload-post,
 * scores it via `scoreSubmission` (lib/server/oracleFraud.ts), and settles via
 * Convex. Everything reusable + decidable WITHOUT network/Convex/env is extracted
 * here so it can be unit-tested. Mirrors the purity split in `oracleFraud.ts`.
 */

import crypto from "node:crypto";
import type { OracleThresholds, AnalyticsInput, PeerSubmission, PostMetrics } from "./oracleFraud";
import { normalizePostUrl } from "./oracleFraud";
import type { PostAnalyticsResult } from "./uploadPost";

/**
 * Resolve every oracle threshold from env, falling back to a tuned default when a
 * key is unset, empty, or non-numeric. An explicit "0" is honored.
 */
export function resolveOracleThresholds(env: NodeJS.ProcessEnv = process.env): OracleThresholds {
  const num = (k: string, d: number) => {
    const n = Number(env[k]);
    return Number.isFinite(n) && env[k] !== undefined && env[k] !== "" ? n : d;
  };
  return {
    maturationHours: num("ORACLE_MATURATION_HOURS", 48),
    settleDeadlineHours: num("ORACLE_SETTLE_DEADLINE_HOURS", 168),
    maxViewsPerHour: num("ORACLE_MAX_VIEWS_PER_HOUR", 500_000),
    velocityMinViews: num("ORACLE_VELOCITY_MIN_VIEWS", 50_000),
    velocityHardMultiple: num("ORACLE_VELOCITY_HARD_MULTIPLE", 4),
    engagementMinViews: num("ORACLE_ENGAGEMENT_MIN_VIEWS", 10_000),
    engagementMinRatio: num("ORACLE_ENGAGEMENT_MIN_RATIO", 0.001),
    engagementHardViews: num("ORACLE_ENGAGEMENT_HARD_VIEWS", 25_000),
    dupSourceClusterMax: num("ORACLE_DUP_SOURCE_CLUSTER_MAX", 5),
  };
}

/** The metric keys `scoreSubmission` understands; everything else is dropped. */
const METRIC_KEYS = ["views", "impressions", "plays", "reach", "score", "likes", "comments", "shares", "saves"] as const;

/** Narrow a loose upload-post metrics bag to the typed `PostMetrics` shape:
 *  keep only known keys whose value is a finite number; drop everything else.
 *  A present zero is a real zero and is preserved. */
export function toPostMetrics(metrics: Record<string, number>): PostMetrics {
  const out: PostMetrics = {};
  for (const k of METRIC_KEYS) {
    if (typeof metrics[k] === "number" && Number.isFinite(metrics[k])) (out as Record<string, number>)[k] = metrics[k];
  }
  return out;
}

/**
 * Map an upload-post analytics result to the `AnalyticsInput` `scoreSubmission`
 * consumes. `unsupported` → manual_review by the scorer; `not_found`/`not_ready`/
 * `error` all collapse to `status:"error"` (scorer defers until the deadline, then
 * manual_review). `ok` carries the filtered metrics + durable ids.
 */
export function toAnalyticsInput(r: PostAnalyticsResult): AnalyticsInput {
  if (r.ok) return { status: "ok", metrics: toPostMetrics(r.metrics), platformPostId: r.platformPostId, postUrl: r.postUrl };
  if (r.reason === "unsupported") return { status: "unsupported" };
  return { status: "error", error: r.reason }; // not_found / not_ready / error → scoreSubmission defers then manual_review
}

/**
 * Map a raw submission doc (from `listByCampaign`) to a `PeerSubmission` for the
 * subject's duplicate/cluster checks. null → undefined, postUrl is normalized for
 * url-collision comparison. `campaignSame` is true (peers come from the subject's
 * own campaign). No content fingerprint is available from a submission doc (MVP),
 * so `sourceKey` is left undefined.
 */
export function toPeer(sub: {
  _id: string;
  _creationTime: number;
  status: string;
  platform?: string | null;
  platformPostId?: string | null;
  postUrl?: string | null;
  submitterWallet: string;
}): PeerSubmission {
  return {
    submissionId: sub._id,
    creationTimeMs: sub._creationTime,
    status: sub.status,
    platform: sub.platform ?? undefined,
    platformPostId: sub.platformPostId ?? undefined,
    normalizedPostUrl: sub.postUrl ? normalizePostUrl(sub.postUrl) : undefined,
    submitterWallet: sub.submitterWallet,
    campaignSame: true,
    sourceKey: undefined, // no content-fingerprint source available from submission docs (MVP)
  };
}

/** Deterministic sha256 over the score signals — recorded on-chain/in Convex as a
 *  tamper-evident fingerprint of the decision inputs. */
export function signalsScoreHash(signals: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(signals)).digest("hex");
}
