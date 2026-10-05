import { describe, it, expect } from "vitest";
import { buildTasteUpdatePrompt } from "./tasteProfile";

describe("buildTasteUpdatePrompt", () => {
  it("carries old prose and weighted events", () => {
    const { system, user } = buildTasteUpdatePrompt({
      oldProse: "loves courtroom absurdity",
      events: [
        { kind: "idea_down", detail: "Generic motivation monday", weight: 2 },
        { kind: "video_high_views", detail: "Supreme court AI ruling react — 40k views", weight: 3 },
      ],
    });
    expect(system.toLowerCase()).toContain("taste");
    expect(user).toContain("loves courtroom absurdity");
    expect(user).toContain("Generic motivation monday");
    expect(user).toContain("40k views");
    expect(user).toContain("weight 3");
  });
});
