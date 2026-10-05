import { describe, it, expect } from "vitest";
import { parseAnalysis } from "./analyzeWebsite";

const concepts = [
  { format: "review", title: "R", idea: "review idea", hookText: "" },
  { format: "reaction", title: "X", idea: "reaction idea", hookText: "she really did that" },
  { format: "cartoon", title: "C", idea: "cartoon idea", hookText: "" },
];

describe("parseAnalysis", () => {
  it("orders concepts reaction/cartoon/review and keeps the identity the model wrote", () => {
    const out = parseAnalysis({
      productSummary: "A habit tracker.",
      concepts,
      identity: { agentName: "Habit Hana", handle: "@Habit Hana", niche: "productivity", language: "English", audience: "busy founders", pillars: ["streaks", "focus"] },
    }, "https://habitloop.app");
    expect(out.concepts.map((c) => c.format)).toEqual(["reaction", "cartoon", "review"]);
    expect(out.identity).toEqual({ agentName: "Habit Hana", handle: "habit_hana", niche: "productivity", language: "English", audience: "busy founders", pillars: ["streaks", "focus"] });
  });
  it("falls back to the domain identity when the model omits it", () => {
    const out = parseAnalysis({ productSummary: "x", concepts }, "https://www.habitloop.app/");
    expect(out.identity.agentName).toBe("Habitloop");
    expect(out.identity.handle).toBe("habitloop_vello");
    expect(out.identity.niche).toBe("lifestyle");
    expect(out.identity.language).toBe("English");
  });
  it("throws when a concept is missing (analysis incomplete)", () => {
    expect(() => parseAnalysis({ productSummary: "x", concepts: concepts.slice(0, 2) }, "https://a.com")).toThrow(/incomplete/);
  });
});
