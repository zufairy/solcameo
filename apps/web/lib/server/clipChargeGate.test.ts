import { describe, it, expect, vi } from "vitest";
import { decideSkillChargeGate, type SkillChargeResult } from "./clipChargeGate";

/**
 * C4 (fail-closed skill charge): the cloud clip path (convex/clipJobs.ts `process`)
 * charges every wired priced skill BEFORE rendering. A clean {ok:false} is the funding
 * gate (deny + refund). But a THROWN recordUsage — the reachable case is a mint with an
 * agent/clip context but NO agentAccount row (usage.ts:235 throws), also secret
 * misconfig / transient infra — was swallowed and the render PROCEEDED unbilled. This
 * gate must FAIL CLOSED on a throw (abort), mirroring /api/video/clip's #23 503 backstop.
 */
describe("decideSkillChargeGate", () => {
  it("proceeds when every wired skill charges cleanly", async () => {
    const charge = vi.fn(async (): Promise<SkillChargeResult> => ({ ok: true }));
    const gate = await decideSkillChargeGate(["clip.brainrot", "clip.hook"], charge);
    expect(gate).toEqual({ decision: "proceed" });
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it("proceeds with no wired skills (nothing to charge)", async () => {
    const charge = vi.fn(async (): Promise<SkillChargeResult> => ({ ok: true }));
    const gate = await decideSkillChargeGate([], charge);
    expect(gate).toEqual({ decision: "proceed" });
    expect(charge).not.toHaveBeenCalled();
  });

  // The core C4 assertion — RED on the swallow-and-continue behavior, GREEN after the fix.
  it("ABORTS (fail closed) when a skill charge THROWS — e.g. no agentAccount row", async () => {
    const charge = vi.fn(async (): Promise<SkillChargeResult> => {
      throw new Error("no agentAccount for mint");
    });
    const gate = await decideSkillChargeGate(["clip.brainrot"], charge);
    expect(gate).toEqual({ decision: "abort", skillId: "clip.brainrot", error: "no agentAccount for mint" });
  });

  it("aborts on the throwing skill and does NOT charge any later skill (stops the loop)", async () => {
    const charge = vi.fn()
      .mockResolvedValueOnce({ ok: true } as SkillChargeResult) // clip.brainrot charged
      .mockRejectedValueOnce(new Error("unauthorized")); // clip.hook throws (secret misconfig)
    const gate = await decideSkillChargeGate(["clip.brainrot", "clip.hook", "clip.sticker"], charge);
    expect(gate).toEqual({ decision: "abort", skillId: "clip.hook", error: "unauthorized" });
    // clip.sticker must NOT be charged after the abort.
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it("still DENIES (not abort) on a clean {ok:false} — funding gate unchanged", async () => {
    const charge = vi.fn(async (): Promise<SkillChargeResult> => ({ ok: false, reason: "needs_funding" }));
    const gate = await decideSkillChargeGate(["clip.brainrot"], charge);
    expect(gate).toEqual({ decision: "deny", skillId: "clip.brainrot", reason: "needs_funding" });
  });

  it("denies at the FIRST clean {ok:false} and stops (mid-loop daily_cap race)", async () => {
    const charge = vi.fn()
      .mockResolvedValueOnce({ ok: true } as SkillChargeResult)
      .mockResolvedValueOnce({ ok: false, reason: "daily_cap" } as SkillChargeResult);
    const gate = await decideSkillChargeGate(["clip.brainrot", "clip.hook", "clip.sticker"], charge);
    expect(gate).toEqual({ decision: "deny", skillId: "clip.hook", reason: "daily_cap" });
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it("normalizes a non-Error thrown value into the abort error string", async () => {
    const charge = vi.fn(async (): Promise<SkillChargeResult> => { throw "boom"; });
    const gate = await decideSkillChargeGate(["clip.title"], charge);
    expect(gate).toEqual({ decision: "abort", skillId: "clip.title", error: "boom" });
  });
});
