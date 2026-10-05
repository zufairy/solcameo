export const GROWTH_CONFIRM_MS = 30 * 60 * 1000;
export const MAX_GROWTH_VIEWS_PER_SYNC = 50_000;

/** A new high-water mark must survive two measurements before it can accrue. */
export function confirmViewGrowth(input: {
  verifiedViews: number;
  measuredViews: number;
  candidateViews?: number;
  candidateAt?: number;
  now: number;
}): { candidateViews: number; candidateAt: number; confirmedViews: number } {
  const verified = Math.max(0, Math.floor(input.verifiedViews));
  const measured = Math.max(0, Math.floor(input.measuredViews));
  if (measured <= verified) return { candidateViews: verified, candidateAt: input.now, confirmedViews: verified };
  const previous = input.candidateViews ?? verified;
  if (previous <= verified || measured < previous || !input.candidateAt) {
    return { candidateViews: measured, candidateAt: input.now, confirmedViews: verified };
  }
  const confirmedViews = input.now - input.candidateAt >= GROWTH_CONFIRM_MS
    ? Math.min(previous, verified + MAX_GROWTH_VIEWS_PER_SYNC)
    : verified;
  return {
    candidateViews: confirmedViews > verified ? measured : previous,
    candidateAt: confirmedViews > verified ? input.now : input.candidateAt,
    confirmedViews,
  };
}
