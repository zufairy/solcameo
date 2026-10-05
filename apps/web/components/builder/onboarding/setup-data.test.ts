import { describe, expect, it } from "vitest";
import { buildBlueprint, nameProblem, nameReady, slugHandle, stepsFor, suggestNames } from "./setup-data";

describe("setup-data", () => {
  it("rejects generic names", () => {
    for (const n of ["New agent", "new_agent", "Agent", "AI Influencer", "test", "a"]) expect(nameReady(n)).toBe(false);
    expect(nameProblem("New Agent")).toBeTruthy();
    expect(nameReady("Aria Vale")).toBe(true);
  });
  it("derives handles", () => {
    expect(slugHandle("Aria Vale")).toBe("aria_vale");
    expect(slugHandle("Al")).toBeUndefined();
  });
  it("orders steps per type and can drop the type step", () => {
    expect(stepsFor("clipping")).toEqual(["type", "niche", "name", "clips", "look", "launch"]);
    expect(stepsFor("influencer", false)).toEqual(["niche", "name", "voice", "look", "launch"]);
  });
  it("suggests distinct, valid, stable names", () => {
    const a = suggestNames("clipping", "Finance & crypto", 1);
    expect(a).toEqual(suggestNames("clipping", "Finance & crypto", 1));
    expect(new Set(a).size).toBe(a.length);
    a.forEach((n) => expect(nameReady(n)).toBe(true));
    expect(suggestNames("influencer", "Fitness", 2).length).toBeGreaterThan(0);
  });
  it("builds a clip blueprint with chosen length and platforms", () => {
    const bp = buildBlueprint({ type: "clipping", name: "FinanceClips", niche: "Finance & crypto", language: "English", voice: "friend", clipLength: "long", platforms: ["youtube"], lookStyle: "critter", imageUrl: "https://x/y.png" });
    expect(bp.clipConfig?.clipLength).toEqual({ min: 60, max: 180 });
    expect(bp.clipConfig?.platforms).toEqual(["youtube"]);
    expect(bp.persona.handle).toBe("financeclips");
  });
});
