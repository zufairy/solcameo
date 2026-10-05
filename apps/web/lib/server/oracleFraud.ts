/**
 * Pure fraud-scoring decision engine for the settlement oracle.
 *
 * Given one campaign submission's social analytics plus its peer submissions and
 * a set of thresholds, decide whether to approve / reject / defer / flag for
 * manual review, and report the view count to settle.
 *
 * This module is PURE: no fetch, no process.env, no Convex, no Date.now(). Every
 * input (including `nowMs` and all thresholds via `config`) arrives through the
 * function argument. A later Next route fetches data and calls `scoreSubmission`.
 * Keeping it pure mirrors `lib/builder/clipConfig.ts` and `lib/server/sourceKey.ts`
 * and makes the whole decision table unit-testable.
 */

export interface OracleThresholds {
  maturationHours: number; // below this age → defer (too fresh to measure)
  settleDeadlineHours: number; // past this age, stop deferring; unreadable → manual_review
  maxViewsPerHour: number; // velocity soft ceiling
  velocityMinViews: number; // velocity gate ignored below this many views
  velocityHardMultiple: number; // hard reject above maxViewsPerHour * this
  engagementMinViews: number; // engagement gate ignored below this many views
  engagementMinRatio: number; // engagement soft-flag below this ratio
  engagementHardViews: number; // zero-engagement hard reject needs at least this many views
  dupSourceClusterMax: number; // soft-flag when same-source clips from one wallet reach this count
}

export interface PostMetrics {
  // EVERY field optional; absent => undefined, NEVER coerce to 0
  views?: number;
  impressions?: number;
  plays?: number;
  reach?: number;
  score?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}

export type AnalyticsInput =
  | { status: "ok"; metrics: PostMetrics; platformPostId?: string; postUrl?: string }
  | { status: "error"; error: string }
  | { status: "unsupported" };

export interface PeerSubmission {
  submissionId: string;
  creationTimeMs: number;
  status: string; // peer's submission status
  platform?: string;
  platformPostId?: string;
  normalizedPostUrl?: string;
  submitterWallet: string;
  campaignSame: boolean; // peer belongs to the same campaign as the subject
  sourceKey?: string; // clip source identity (NOT content fingerprint)
}

export interface ScoreInput {
  platform: string;
  analytics: AnalyticsInput;
  postedAtMs?: number; // when the post went live (maturation anchor)
  nowMs: number;
  submissionId: string;
  submissionCreationTimeMs: number;
  submitterWallet: string;
  sourceKey?: string;
  normalizedPostUrl?: string; // THIS submission's normalized post url
  platformPostId?: string; // THIS submission's platform post id
  peers: PeerSubmission[];
  config: OracleThresholds;
}

export type ScoreDecision = "approved" | "rejected" | "defer" | "manual_review";

export interface ScoreSignals {
  viewField?: "views" | "impressions" | "plays" | "reach" | "score";
  ageHours?: number;
  viewsPerHour?: number;
  engagementRatio?: number;
  softFlags: string[];
  skips: string[];
  dupCheck?: string;
}

export interface ScoreResult {
  decision: ScoreDecision;
  reason?: string;
  viewCount: number; // the measured views to settle (0 for defer/manual_review)
  signals: ScoreSignals;
}

const HOUR_MS = 3_600_000;

/**
 * Identity-bearing query params, keyed by host. Some platforms put the post's
 * identity in the QUERY STRING (e.g. YouTube `?v=`, Facebook permalink
 * `?story_fbid=&id=`), so blindly stripping the query would collapse DISTINCT
 * posts into one canonical url and wrongly hard-reject the later one as a
 * duplicate. For every other host we keep NO query params (drop tracking/utm).
 * Inline allowlist only — stay pure (no node:crypto / sourceKey hashing).
 */
const IDENTITY_QUERY_PARAMS: Record<string, readonly string[]> = {
  "youtube.com": ["v"],
  "youtu.be": ["v"],
  "facebook.com": ["story_fbid", "id"],
};

function identityParamsForHost(host: string): readonly string[] {
  // Match the registrable-ish suffix so www./m. subdomains resolve too.
  for (const known of Object.keys(IDENTITY_QUERY_PARAMS)) {
    if (host === known || host.endsWith("." + known)) return IDENTITY_QUERY_PARAMS[known];
  }
  return [];
}

/**
 * Canonicalize a post URL for duplicate comparison: lowercase the host, drop the
 * fragment, drop a trailing slash, and canonicalize the query BY IDENTITY —
 * keeping only identity-bearing params for known query-keyed hosts (sorted for
 * determinism) and dropping everything else (utm/tracking). This collapses
 * tracking/trailing-slash variants of the SAME post while keeping two DISTINCT
 * query-keyed posts (e.g. youtube `?v=AAA` vs `?v=BBB`) from colliding.
 * Defensive — if `URL` parsing throws, return the trimmed lowercased input.
 * Mirrors the spirit of the `try { new URL(...) } catch` helpers in
 * `lib/server/sourceKey.ts`.
 */
export function normalizePostUrl(url: string): string {
  const raw = String(url ?? "").trim();
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";
    const allow = identityParamsForHost(u.hostname);
    const kept = allow
      .map((k) => [k, u.searchParams.get(k)] as const)
      .filter((pair): pair is readonly [string, string] => pair[1] !== null)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const search = new URLSearchParams();
    for (const [k, v] of kept) search.set(k, v);
    u.search = search.toString();
    let out = u.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return raw.toLowerCase();
  }
}

type ViewField = NonNullable<ScoreSignals["viewField"]>;

/**
 * Resolve the platform's view-like metric as the FIRST defined candidate. Returns
 * the chosen value, which field it came from, and whether it is a "proxy" metric
 * (reach / score — not a true view count). `impressions` is a real view-like
 * number (X's legitimate metric), never a proxy.
 */
function resolveViewLike(
  platform: string,
  m: PostMetrics,
): { value: number; field: ViewField } | undefined {
  const order = candidateOrder(platform);
  for (const field of order) {
    const v = m[field];
    if (v !== undefined) return { value: v, field };
  }
  return undefined;
}

function candidateOrder(platform: string): ViewField[] {
  switch (platform) {
    case "tiktok":
    case "youtube":
    case "instagram":
    case "threads":
      return ["views", "impressions", "plays"];
    case "x":
      return ["impressions", "views"];
    case "facebook":
    case "linkedin":
      return ["reach", "impressions"];
    case "reddit":
      return ["score"];
    default:
      return ["views", "impressions", "plays", "reach", "score"];
  }
}

function isProxy(field: ViewField): boolean {
  return field === "reach" || field === "score";
}

export function scoreSubmission(input: ScoreInput): ScoreResult {
  const { config } = input;
  const signals: ScoreSignals = { softFlags: [], skips: [] };

  // Age (maturation anchor) — only meaningful when postedAtMs is present.
  const hasAge = input.postedAtMs !== undefined;
  const ageHours = hasAge ? Math.max(0, (input.nowMs - (input.postedAtMs as number)) / HOUR_MS) : undefined;
  if (ageHours !== undefined) signals.ageHours = ageHours;
  const pastDeadline = ageHours !== undefined && ageHours > config.settleDeadlineHours;

  // ── 1. Missing / unsupported analytics (never silently approve) ───────────
  if (input.analytics.status === "unsupported") {
    return { decision: "manual_review", reason: "analytics_unsupported_platform", viewCount: 0, signals };
  }
  if (input.analytics.status === "error") {
    return pastDeadline
      ? { decision: "manual_review", reason: "analytics_unavailable_stale", viewCount: 0, signals }
      : { decision: "defer", reason: "analytics_unavailable", viewCount: 0, signals };
  }

  // status === "ok"
  const resolved = resolveViewLike(input.platform, input.analytics.metrics);
  if (resolved === undefined) {
    // No candidate metric present — treat like an error (defer within deadline,
    // else manual_review). NOTE: a PRESENT zero is a real zero, handled below.
    return pastDeadline
      ? { decision: "manual_review", reason: "analytics_unavailable", viewCount: 0, signals }
      : { decision: "defer", reason: "analytics_unavailable", viewCount: 0, signals };
  }
  const viewLike = resolved.value;
  const viewField = resolved.field;
  signals.viewField = viewField;
  const proxy = isProxy(viewField);

  // ── 2. Maturation ─────────────────────────────────────────────────────────
  if (ageHours === undefined) {
    signals.skips.push("maturation:no_postedAt");
  } else if (ageHours < config.maturationHours) {
    return { decision: "defer", reason: "immature", viewCount: 0, signals };
  }

  let hardRejectReason: string | undefined;
  const setHardReject = (reason: string) => {
    if (hardRejectReason === undefined) hardRejectReason = reason;
  };

  // ── 3. Duplicate gate (identity / metadata only) ──────────────────────────
  const myPostId = nonEmpty(input.platformPostId);
  const myUrl = nonEmpty(input.normalizedPostUrl);
  if (myPostId === undefined && myUrl === undefined) {
    signals.dupCheck = "insufficient_id";
  } else {
    for (const p of input.peers) {
      if (p.platform !== input.platform) continue; // cross-platform is NOT a duplicate
      const collidesById = myPostId !== undefined && nonEmpty(p.platformPostId) === myPostId;
      const collidesByUrl = myUrl !== undefined && nonEmpty(p.normalizedPostUrl) === myUrl;
      if (!collidesById && !collidesByUrl) continue;
      // This submission is the loser iff a colliding peer is EARLIER (by time,
      // or equal time with a lexicographically-smaller submissionId).
      const peerEarlier =
        p.creationTimeMs < input.submissionCreationTimeMs ||
        (p.creationTimeMs === input.submissionCreationTimeMs && p.submissionId < input.submissionId);
      if (peerEarlier) {
        setHardReject(collidesById ? "duplicate:platform_post_id" : "duplicate:post_url");
        break;
      }
    }
  }

  // Source-cluster soft flag (does NOT reject).
  if (nonEmpty(input.sourceKey) !== undefined) {
    let clusterCount = 0;
    for (const p of input.peers) {
      if (
        p.campaignSame === true &&
        p.submitterWallet === input.submitterWallet &&
        nonEmpty(p.sourceKey) === nonEmpty(input.sourceKey)
      ) {
        clusterCount += 1;
      }
    }
    if (clusterCount >= config.dupSourceClusterMax) {
      signals.softFlags.push("duplicate:shared_source_cluster");
    }
  }

  // ── 4. Velocity gate ──────────────────────────────────────────────────────
  if (proxy) {
    signals.skips.push("velocity:proxy_metric");
  } else if (ageHours === undefined) {
    signals.skips.push("velocity:no_age");
  } else {
    const viewsPerHour = viewLike / Math.max(ageHours, 1);
    signals.viewsPerHour = viewsPerHour;
    if (viewLike >= config.velocityMinViews && viewsPerHour > config.maxViewsPerHour) {
      if (viewsPerHour > config.maxViewsPerHour * config.velocityHardMultiple) {
        setHardReject("velocity:impossible_view_rate");
      } else {
        signals.softFlags.push("velocity:high_view_rate");
      }
    }
  }

  // ── 5. Engagement gate ────────────────────────────────────────────────────
  const m = input.analytics.metrics;
  const engagementFields: Array<keyof PostMetrics> = ["likes", "comments", "shares", "saves"];
  const presentEngagement = engagementFields.filter((f) => m[f] !== undefined);
  if (proxy) {
    signals.skips.push("engagement:proxy_metric");
  } else if (presentEngagement.length === 0) {
    signals.skips.push("engagement:fields_absent");
  } else if (viewLike >= config.engagementMinViews) {
    const engagementTotal = presentEngagement.reduce((sum, f) => sum + (m[f] as number), 0);
    const ratio = engagementTotal / viewLike;
    signals.engagementRatio = ratio;
    if (ratio < config.engagementMinRatio) {
      if (ratio === 0 && viewLike >= config.engagementHardViews) {
        setHardReject("engagement:zero_engagement");
      } else {
        signals.softFlags.push("engagement:low_ratio");
      }
    }
  }

  // ── 6. Final ──────────────────────────────────────────────────────────────
  if (hardRejectReason !== undefined) {
    return { decision: "rejected", reason: hardRejectReason, viewCount: viewLike, signals };
  }
  // A proxy metric (reach / score) is NOT a true view count and must not be
  // auto-priced at ratePerThousandViews. With no hard-reject, route it to a
  // human who prices reach/score (viewCount 0 so the oracle settles nothing).
  // This runs AFTER the duplicate/velocity/engagement gates so a duplicate
  // proxy post still hard-rejects above. Non-proxy metrics (views/impressions/
  // plays — including X's impressions) keep auto-approving.
  if (proxy) {
    return { decision: "manual_review", reason: "proxy_metric_review", viewCount: 0, signals };
  }
  return { decision: "approved", viewCount: viewLike, signals };
}

function nonEmpty(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s.length > 0 ? s : undefined;
}
