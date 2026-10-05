/**
 * Pure decision for the pre-run "connect a social account first" gate.
 *
 * A clip run costs compute and (when Auto-post / a campaign is wired) is meant to
 * post + submit its clips. With ZERO social accounts connected the clips render
 * and download but silently fail to post — and a CAMPAIGN run never submits or
 * earns. So before kicking off a run we warn the user to connect first, or let
 * them knowingly proceed to a download-only run ("Run anyway").
 *
 * Rules:
 *  - Warn ONLY when we KNOW zero accounts are connected (`connectedCount === 0`)
 *    AND the user hasn't already chosen "Run anyway" this session.
 *  - `connectedCount === null` means UNKNOWN — status not yet read, a flaky /
 *    transient read, or the upload-post integration isn't configured → NEVER warn,
 *    so a flaky read can't false-block a legitimate run (mirrors the fund-modal
 *    lesson: never gate on a read we couldn't trust).
 *  - `connectedCount >= 1` → connected → never warn.
 */
export function shouldWarnBeforeRun({
  connectedCount,
  dismissedThisSession,
}: {
  /** Number of connected social platforms, or `null` when unknown/unread. */
  connectedCount: number | null;
  /** True once the user picked "Run anyway" earlier this session. */
  dismissedThisSession: boolean;
}): boolean {
  if (dismissedThisSession) return false;
  if (connectedCount === null) return false; // unknown → don't block
  return connectedCount === 0;
}
