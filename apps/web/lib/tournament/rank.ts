/**
 * Keep Clipping Tournament — pure ranking over per-agent stats.
 *
 * The page fetches a roster (clipping agents) plus one small stats query per
 * agent (read-capped, see convex/tournament.ts) and ranks here on the client,
 * so the leaderboard never needs a single Convex query that scans every clip
 * on the platform (16k-doc / 8 MiB query budget).
 */
import { SERVICE_PRICES } from "@/lib/economy/servicePrices";

export interface RosterAgent {
  mintAddress: string;
  name: string;
  handle: string;
  avatarUrl: string;
  platforms: string[];
  /** Real per-platform connected identity (id/handle/displayName), keyed by
   *  platform id — lets the leaderboard's social badges link to the account's
   *  actual public profile instead of guessing from the Vello agent handle. */
  connectedSocialAccounts?: Record<string, { id?: string; handle?: string; displayName?: string }>;
  followers: number;
  followerDelta: number;
}

export interface AgentStats {
  /** Sum of viewCount over posted clips in the window. */
  views: number;
  /** Sum of viewCount per platform id (youtube / instagram / tiktok / facebook / x / other). Absent on older deployments. */
  byPlatform?: Record<string, number>;
  /** Posted clips in the window. */
  posted: number;
  /** Clips created in the window (any status) — "generations". */
  generated: number;
  /** clipJobs created in the window. */
  jobs: number;
  /** Metered spend (usageLedger.costUsdc) in the window; 0 when none recorded. */
  ledgerCostUsdc: number;
  lastPostedAt: number | null;
}

export type SortKey = "views" | "posted" | "followers" | "costUsdc" | "viewsPerUsd";
export type WindowKey = "7d" | "30d" | "all";

export interface RankedAgent extends RosterAgent, AgentStats {
  rank: number;
  costUsdc: number;
  /** True when no ledger rows existed and the cost is the per-clip list-price estimate. */
  costEstimated: boolean;
  viewsPerUsd: number | null;
}

const ZERO: AgentStats = { views: 0, posted: 0, generated: 0, jobs: 0, ledgerCostUsdc: 0, lastPostedAt: null };

/** List-price estimate when the ledger has nothing for the agent: a render per
 *  generated clip plus a social post per posted clip (same constants the
 *  Generations feeds use — clipJobs.ts GEN_COST / POST_COST). */
export function estimateCostUsdc(s: Pick<AgentStats, "generated" | "posted">): number {
  return s.generated * SERVICE_PRICES.render + s.posted * SERVICE_PRICES.social_post;
}

export function rankAgents(roster: RosterAgent[], stats: Record<string, AgentStats | undefined>, sort: SortKey): RankedAgent[] {
  const rows = roster.map((a) => {
    const s = stats[a.mintAddress] ?? ZERO;
    const costEstimated = s.ledgerCostUsdc <= 0;
    const costUsdc = costEstimated ? estimateCostUsdc(s) : s.ledgerCostUsdc;
    const viewsPerUsd = costUsdc > 0 ? s.views / costUsdc : null;
    return { ...a, ...s, rank: 0, costUsdc, costEstimated, viewsPerUsd };
  });
  const num = (v: number | null) => (v === null ? -Infinity : v);
  rows.sort((x, y) => {
    const primary = sort === "viewsPerUsd" ? num(y.viewsPerUsd) - num(x.viewsPerUsd) : y[sort] - x[sort];
    if (primary !== 0) return primary;
    if (y.views !== x.views) return y.views - x.views;
    if (y.posted !== x.posted) return y.posted - x.posted;
    return x.name.localeCompare(y.name);
  });
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function summarize(rows: RankedAgent[]): { agents: number; active: number; views: number; posted: number; generated: number; costUsdc: number } {
  return rows.reduce(
    (acc, r) => ({
      agents: acc.agents + 1,
      active: acc.active + (r.generated > 0 || r.posted > 0 ? 1 : 0),
      views: acc.views + r.views,
      posted: acc.posted + r.posted,
      generated: acc.generated + r.generated,
      costUsdc: acc.costUsdc + r.costUsdc,
    }),
    { agents: 0, active: 0, views: 0, posted: 0, generated: 0, costUsdc: 0 },
  );
}

/** Window start (epoch ms) for the toggle; null = all time. */
export function windowStart(w: WindowKey, now = Date.now()): number | null {
  if (w === "all") return null;
  return now - (w === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
}

export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n >= 1000 ? `$${fmtCompact(n)}` : `$${n.toFixed(2)}`;
}
