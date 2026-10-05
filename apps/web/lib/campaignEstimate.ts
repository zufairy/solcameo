/**
 * Pure, client-safe reward math for the campaign form's live estimator.
 * Everything here is an ESTIMATE shown to the advertiser, never a promise:
 * the treasury pays `rate` USDC per 1,000 verified views, so the hard number
 * is how many views the budget can pay for; the rest uses stated averages.
 */

/** Assumed average verified views per agent post (matches the server's cold-start prior). */
export const AVG_VIEWS_PER_POST = 800;
/** Share of total views that are unique people (the rest are repeat views). */
export const UNIQUE_VIEWER_SHARE = 0.62;

export interface RewardEstimate {
  /** Views the treasury can pay for at this rate. */
  views: number;
  /** Estimated unique people behind those views. */
  uniqueViewers: number;
  /** Posts needed to reach those views at the average. */
  posts: number;
  /** What an agent earns for one average post. */
  perPostUsdc: number;
  /** What an agent earns per 10,000 views. */
  per10kUsdc: number;
}

export function estimateReward(budgetUsdc: number, ratePerThousandViews: number): RewardEstimate {
  const ok = Number.isFinite(budgetUsdc) && Number.isFinite(ratePerThousandViews) && budgetUsdc > 0 && ratePerThousandViews > 0;
  if (!ok) return { views: 0, uniqueViewers: 0, posts: 0, perPostUsdc: 0, per10kUsdc: 0 };
  const views = Math.floor((budgetUsdc / ratePerThousandViews) * 1000);
  return {
    views,
    uniqueViewers: Math.round(views * UNIQUE_VIEWER_SHARE),
    posts: Math.max(1, Math.round(views / AVG_VIEWS_PER_POST)),
    perPostUsdc: (AVG_VIEWS_PER_POST / 1000) * ratePerThousandViews,
    per10kUsdc: 10 * ratePerThousandViews,
  };
}

/** 1.2M / 840K / 950 */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${Math.round(n)}`;
}

// ── Budget slider mapping (log scale so $1K and $50K are both easy to hit) ──
export const BUDGET_SLIDER_MIN = 1000;
export const BUDGET_SLIDER_MAX = 50_000;

/** 0..100 slider position → a tidy USDC amount. */
export function budgetFromSlider(pos: number): number {
  const t = Math.min(100, Math.max(0, pos)) / 100;
  const raw = BUDGET_SLIDER_MIN * Math.pow(BUDGET_SLIDER_MAX / BUDGET_SLIDER_MIN, t);
  const step = raw < 5000 ? 100 : raw < 20_000 ? 500 : 1000;
  return Math.min(BUDGET_SLIDER_MAX, Math.max(BUDGET_SLIDER_MIN, Math.round(raw / step) * step));
}

/** Inverse of budgetFromSlider (clamped; amounts above the max pin to 100). */
export function sliderFromBudget(budget: number): number {
  const b = Math.min(BUDGET_SLIDER_MAX, Math.max(BUDGET_SLIDER_MIN, Number(budget) || BUDGET_SLIDER_MIN));
  return Math.round((Math.log(b / BUDGET_SLIDER_MIN) / Math.log(BUDGET_SLIDER_MAX / BUDGET_SLIDER_MIN)) * 100);
}
