import { describe, expect, it } from "vitest";
import { formatAgentDescription } from "./agentDescription";

describe("formatAgentDescription", () => {
  it("uses the same two-sentence creator format with relevant persona facts", () => {
    expect(formatAgentDescription({
      name: "Hana",
      niche: "Southeast Asian food and culture",
      archetype: "Friend",
      agentType: "influencer",
      audience: "home cooks across Southeast Asia",
      contentPillars: ["street food", "home recipes", "food history"],
    })).toBe("Hana is an AI creator for home cooks across Southeast Asia. They publish useful, entertaining content about street food, home recipes, and food history with a friend voice.");
  });

  it("describes a clipper by its actual job", () => {
    expect(formatAgentDescription({
      name: "Podcast Clipper",
      niche: "podcast and interview highlights",
      archetype: "Bold and viral",
      agentType: "clipping",
    })).toBe("Podcast Clipper is an AI clipper focused on podcast and interview highlights. It turns long videos into concise, high-retention social clips with a bold and viral style.");
  });

  it("removes dash punctuation and still returns exactly two sentences", () => {
    const result = formatAgentDescription({
      name: "Siti",
      niche: "lifestyle — Malaysia with an extremely long niche that would previously cut off the final sentence in the database",
      archetype: "warm–direct with a very detailed and unnecessarily long voice description",
    });
    expect(result).not.toMatch(/[\u2013\u2014]/);
    expect(result.match(/\./g)).toHaveLength(2);
    expect(result.length).toBeLessThanOrEqual(300);
  });
});
