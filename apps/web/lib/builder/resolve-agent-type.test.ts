import { describe, expect, it } from "vitest";
import { resolvePersistedAgentType } from "./resolve-agent-type";

describe("resolvePersistedAgentType", () => {
  it("keeps a legacy clipper in clipping mode when only clipConfig identifies it", () => {
    expect(resolvePersistedAgentType({ agentType: undefined, clipConfig: {} })).toBe("clipping");
  });

  it("continues promoting legacy campaign records to the influencer workspace", () => {
    expect(resolvePersistedAgentType({ agentType: "campaign" })).toBe("influencer");
  });
});
