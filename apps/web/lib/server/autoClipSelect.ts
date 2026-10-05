/**
 * Pure selection + gating helpers for Autonomous Clipping (spec
 * 2026-07-03-autonomous-clipping-design.md). No IO, no `any` — so the "which
 * source next" and "can we afford it" decisions are unit-testable in isolation,
 * independent of Convex/Drive/Supabase. The action in convex/autoClip.ts wires
 * these to real candidates + balances.
 *
 * DEDUP KEY: a `(campaign, source-video)` pair is identified by
 * `${campaignId ?? contentRewardId ?? ""}|${sourceUrl}`. The SAME string is
 * rebuilt in convex/clipJobs.ts (autoClippedKeysForMint) from existing clipJobs
 * rows — the two MUST stay identical or dedup silently breaks. It is duplicated
 * (not imported) into Convex because this module lives under lib/server (may pull
 * server-only deps) and must not be bundled into the Convex isolate.
 */

/** One resolved, clippable source video belonging to a candidate campaign. */
export type AutoClipCandidateSource = {
  campaignId?: string;
  contentRewardId?: string;
  sourceUrl: string;
  title: string;
};

/** A fit-matched, funded, restriction-safe candidate campaign with its resolved
 *  source videos (Drive folders already expanded). The caller pre-filters — the
 *  selector assumes every candidate here is eligible to clip. */
export type AutoClipCandidate = {
  campaignId?: string;
  contentRewardId?: string;
  title: string;
  sources: { sourceUrl: string; name: string }[];
};

/** Stable `(campaign, source-video)` dedup key. Campaign is identified by its
 *  Convex campaignId, else its Stage contentRewardId, else "" (bare source).
 *  MUST match convex/clipJobs.ts autoClippedKeysForMint's inline key. */
export function autoClipKey(
  campaignId: string | undefined,
  contentRewardId: string | undefined,
  sourceUrl: string,
): string {
  return `${campaignId ?? contentRewardId ?? ""}|${sourceUrl}`;
}

/**
 * The next un-clipped source across candidates, in candidate order then source
 * order (per-source-video dedup + "one per cycle"): return the FIRST source whose
 * autoClipKey is NOT in `clippedKeys`. A campaign with a multi-video Drive folder
 * is worked ONE video per cycle before the campaign is done. Returns null when
 * every candidate source is already clipped (idle — no charge).
 */
export function pickNextAutoClipSource(
  candidates: AutoClipCandidate[],
  clippedKeys: Set<string>,
): AutoClipCandidateSource | null {
  for (const c of candidates) {
    for (const s of c.sources) {
      const key = autoClipKey(c.campaignId, c.contentRewardId, s.sourceUrl);
      if (clippedKeys.has(key)) continue;
      return { campaignId: c.campaignId, contentRewardId: c.contentRewardId, sourceUrl: s.sourceUrl, title: c.title };
    }
  }
  return null;
}

export type AutoClipChoice =
  | { source: AutoClipCandidateSource }
  | { skip: "no_new" | "insufficient_funds" | "cap" };

/**
 * The money-safe decision for one auto-clip cycle: pick the next un-clipped source
 * (pickNextAutoClipSource), THEN gate on funds so we NEVER charge the scout fee or
 * enqueue when the agent can't afford the run.
 *  - no un-clipped source            → { skip: "no_new" }        (no charge)
 *  - spendable < estimated run cost  → { skip: "insufficient_funds" }
 *  - daily cap headroom < est cost   → { skip: "cap" }
 *  - otherwise                       → { source }
 * `estCostUsdc` = scout fee ($0.10) + the agent's wired clip-skill fees. Both
 * balances are USDC. `dailyRemainingUsdc` is (cap − spentToday); pass Infinity
 * when the agent has no cap so the cap branch never trips. Restriction filtering
 * happens BEFORE this — candidates are already restriction-safe.
 */
export function chooseAutoClip(opts: {
  candidates: AutoClipCandidate[];
  clippedKeys: Set<string>;
  spendableUsdc: number;
  dailyRemainingUsdc: number;
  estCostUsdc: number;
}): AutoClipChoice {
  const source = pickNextAutoClipSource(opts.candidates, opts.clippedKeys);
  if (!source) return { skip: "no_new" };
  if (opts.spendableUsdc < opts.estCostUsdc) return { skip: "insufficient_funds" };
  if (opts.dailyRemainingUsdc < opts.estCostUsdc) return { skip: "cap" };
  return { source };
}
