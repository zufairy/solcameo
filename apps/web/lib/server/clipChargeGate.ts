/**
 * Cloud clip path — the up-front "charge every wired priced skill, then proceed |
 * deny | abort" funding gate, factored out of convex/clipJobs.ts `process` so it is
 * pure + unit-testable (the action itself does heavy I/O and can't be driven in a
 * test). The caller injects `charge` = convex/usage.ts `recordUsage` (via
 * ctx.runMutation).
 *
 * recordUsage has THREE outcomes and they are NOT symmetric:
 *   - {ok:true}                      → charged (or idempotent-deduped) → keep going.
 *   - {ok:false, reason}             → a CLEAN denial (needs_funding / daily_cap /
 *                                      suspended). This is the funding GATE — the run
 *                                      stops and the caller refunds what it charged.
 *   - THROWS                          → the charge is UNRESOLVED (no agentAccount row,
 *                                      secret misconfig, transient Convex infra). A
 *                                      thrown recordUsage inserted no ledger row, so a
 *                                      caller that swallows it renders a wired skilled
 *                                      clip for $0 — a revenue leak. We must FAIL
 *                                      CLOSED, mirroring the /api/video/clip "#23"
 *                                      backstop (503 billing_unavailable).
 */

/** One skill's charge result — the shape convex/usage.ts recordUsage returns. */
export type SkillChargeResult = { ok: boolean; reason?: string };

/** The gate decision the cloud clip path must honour BEFORE any download/render. */
export type SkillChargeGate =
  /** every wired skill charged cleanly → render. */
  | { decision: "proceed" }
  /** a clean {ok:false} denial (funds / daily cap / suspended) → stop + refund. */
  | { decision: "deny"; skillId: string; reason?: string }
  /** a charge THREW → billing unavailable → fail closed (refund + terminal, no render). */
  | { decision: "abort"; skillId: string; error: string };

/**
 * Charge each wired priced skill up-front and decide whether the run may proceed.
 * Stops at the FIRST non-ok skill (no further charges) so the caller voids only what
 * was actually charged. Pure: all side effects (the charge, the refund, the status
 * write) live in the caller.
 */
export async function decideSkillChargeGate(
  wiredSkillIds: readonly string[],
  charge: (skillId: string) => Promise<SkillChargeResult>,
): Promise<SkillChargeGate> {
  for (const skillId of wiredSkillIds) {
    let r: SkillChargeResult;
    try {
      r = await charge(skillId);
    } catch (e) {
      // FAIL CLOSED: a thrown charge is UNRESOLVED (it inserted no ledger row, so
      // there is nothing to reverse and no proof it billed). Never fall through to
      // render — abort so the caller refunds what it charged and fails the job.
      return { decision: "abort", skillId, error: e instanceof Error ? e.message : String(e) };
    }
    if (r.ok === false) return { decision: "deny", skillId, reason: r.reason };
  }
  return { decision: "proceed" };
}
