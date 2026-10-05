// Wall-clock budgeting for the chunked Veo render.
//
// The render-step route runs with `maxDuration = 300s` and renders ONE Veo clip
// per invocation. A single clip must be allowed to poll for (almost) that whole
// budget. The "veo(veo3_fast) timed out after 180s" failure came from a hard
// 180s poll cap that abandoned a task that was STILL processing (KIE returned
// code:200/success with a valid taskId) while ~100s of function budget remained —
// then a retry submitted a brand-new task from scratch, so the render never got
// a chance to finish.

/** Wall-clock budget (ms) for one clip's whole submit + poll cycle. Kept just
 *  under the route's 300s maxDuration so we return before the platform kills the
 *  function (leaving margin to persist state + fire the next step). */
export const CLIP_RENDER_BUDGET_MS = 270_000;

/**
 * How long a clip's poll may wait, given the invocation's wall-clock deadline:
 * the real remaining budget minus a small safety margin, floored so a late call
 * still polls a little rather than giving up instantly. Replaces the old hard
 * 180s cap — the poll now tracks the actual remaining budget.
 */
export function clipPollBudgetMs(deadlineMs: number, nowMs: number): number {
  return Math.max(45_000, deadlineMs - nowMs - 5_000);
}
