import { describe, expect, it } from "vitest";
import { audienceRequirement, requirementIdeas } from "./campaign-data";

describe("campaign-data", () => {
  it("builds a single audience line, or null when worldwide", () => {
    expect(audienceRequirement({ countries: [], ages: [], gender: "all" })).toBeNull();
    const line = audienceRequirement({ countries: ["MY", "SG"], ages: ["18-24"], gender: "women" });
    expect(line).toContain("Malaysia, Singapore");
    expect(line).toContain("ages 18-24");
    expect(line).toContain("mainly women");
  });
  it("suggests type-appropriate requirements", () => {
    expect(requirementIdeas("marketing", "clipping", "Wise").join(" ")).toContain("Wise");
    expect(requirementIdeas("bounty", "ugc", "").length).toBeGreaterThan(2);
    expect(requirementIdeas("marketing", "ugc", "Wise")[0]).toContain("Wise");
  });
});
