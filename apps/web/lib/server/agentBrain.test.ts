import { describe, expect, it } from "vitest";
import { buildAgentBrain } from "./agentBrain";

const KN = [
  { title: "Brand voice", content: "warm, witty, Malaysian context", tags: ["voice"] },
  { title: "Nasi lemak facts", content: "coconut rice dish", tags: ["food"] },
];
const MEM = [{ kind: "lesson", summary: "hooks under 3s win", importance: 80 }];
const SKILLS = [{ name: "Malay Voice", instructions: "use lah/kan, KL slang" }];

describe("buildAgentBrain", () => {
  it("always includes installed skills", () => {
    const b = buildAgentBrain({ topic: "anything", knowledge: KN, memories: MEM, skills: SKILLS });
    expect(b.skills).toHaveLength(1);
    expect(b.skills[0].name).toBe("Malay Voice");
  });

  it("ranks knowledge by topic relevance first", () => {
    const b = buildAgentBrain({ topic: "nasi lemak food", knowledge: KN, memories: MEM, skills: [] });
    expect(b.knowledge[0].title).toBe("Nasi lemak facts");
  });

  it("works with empty brain", () => {
    const b = buildAgentBrain({ topic: "x", knowledge: [], memories: [], skills: [] });
    expect(b.knowledge).toEqual([]);
    expect(b.skills).toEqual([]);
  });
});
