/**
 * Reconcile the Hook Videos / Main Content pools from the TWO places they live.
 *
 * - `clipConfig` carries whatever the graph held when it was last COMPILED.
 * - the skill ROW (agentSkillFiles, canvas-synced) carries the uploads as they are
 *   RIGHT NOW.
 *
 * Uploading to a pool does not recompile the graph, so the row is the fresher of
 * the two and wins. Without this an operator who installed the app and uploaded
 * after their last run got a render with neither the hook nor the main video, and
 * nothing in the run log said why.
 *
 * An installed-but-EMPTY pool also wins: clearing the uploads must stop them from
 * rendering, not fall back to a stale list.
 */

export interface PoolSkillRow {
  skillId: string;
  wired?: boolean;
  config?: { videoUrls?: unknown; mainOnly?: unknown } | null;
}

const HOOK_SKILL_ID = "clip.hookvideos";
const MAIN_SKILL_ID = "clip.maincontent";

function urlList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim()) : [];
}

/** The wired row for `skillId`, or undefined when the app is absent/unwired. */
function wiredRow(rows: readonly PoolSkillRow[], skillId: string): PoolSkillRow | undefined {
  // `wired === undefined` is a legacy row, treated as wired — same rule the render
  // path applies to every other clip skill.
  return rows.find((r) => r?.skillId === skillId && r.wired !== false);
}

/**
 * Merge pool state from the skill rows over a raw clip config. Returns a NEW object;
 * the input is left untouched. Fields are only touched when the app is installed, so
 * an agent without these apps is byte-identical to before.
 */
export function mergePoolConfig(
  rawConfig: Record<string, unknown>,
  rows: readonly PoolSkillRow[] | null | undefined,
): Record<string, unknown> {
  const out = { ...rawConfig };
  const all = rows ?? [];

  const hook = wiredRow(all, HOOK_SKILL_ID);
  if (hook) out.hookVideos = urlList(hook.config?.videoUrls);

  const main = wiredRow(all, MAIN_SKILL_ID);
  if (main) {
    out.mainVideos = urlList(main.config?.videoUrls);
    // mainOnly: the row wins when it carries an explicit boolean (canvas-synced
    // checkbox). When the row omits it — debounced sync lag, legacy rows — keep
    // the persisted clipConfig value. runReal writes mainOnly at kickoff; clearing
    // it here dropped the UGC bypass and sent the job down the download/transcribe
    // rail (appeared "stuck" at Starting source download).
    if (typeof main.config?.mainOnly === "boolean") {
      out.mainOnly = main.config.mainOnly;
    }
  }
  return out;
}

/**
 * How many posts a UGC run ("No clip / UGC needed") produces.
 *
 * The clip-count setting still rules and the pool cycles to fill it — upload two
 * videos, ask for five posts, get five. "Let AI decide" has no transcript analysis
 * to decide FROM in this mode (nothing is transcribed), so it means the honest
 * thing instead: one post per uploaded video.
 */
export function ugcOutputCount(args: { poolSize: number; maxClipsPerSource: number; autoPlan?: boolean; autoPlanMaxClips?: number }): number {
  const pool = Math.max(0, Math.trunc(args.poolSize));
  if (pool === 0) return 0;
  const requested = args.autoPlan ? pool : Math.trunc(args.maxClipsPerSource);
  // Same 1..60 bound the normal cut stage uses, so one mode can't out-produce the
  // other by accident. autoPlanMaxClips additionally caps the "let AI decide"
  // branch (which otherwise takes the WHOLE pool) — set by /api/agents/config
  // for free-plan accounts so a big uploaded pool can't out-produce their trial
  // credits any more than the transcript-analysis autoPlan path can (see
  // convex/clipJobs.ts's requestedCount, same field, same reasoning). Absent
  // for paid accounts, so this can't regress anyone already relying on
  // autoPlan's full-pool yield.
  const cap = args.autoPlan && typeof args.autoPlanMaxClips === "number" && args.autoPlanMaxClips > 0
    ? Math.min(60, args.autoPlanMaxClips) : 60;
  return Math.max(1, Math.min(cap, requested || 1));
}
