import { describe, it, expect } from "vitest";
import { resolveMemoryScope } from "./agentMemoryScope";

describe("resolveMemoryScope", () => {
  it("scopes by mint when a real mintAddress is present", () => {
    expect(resolveMemoryScope("MINT_A", "sess_1")).toEqual({ by: "mint", value: "MINT_A" });
    expect(resolveMemoryScope("MINT_A", undefined)).toEqual({ by: "mint", value: "MINT_A" });
  });

  it("falls back to the session when there is no mint yet (pre-mint project)", () => {
    expect(resolveMemoryScope("", "sess_1")).toEqual({ by: "session", value: "sess_1" });
    expect(resolveMemoryScope(undefined, "sess_1")).toEqual({ by: "session", value: "sess_1" });
  });

  it("NEVER scopes by an empty identity — the bug was pooling every project under \"\"", () => {
    // With no mint and no session, memory must resolve to NOTHING rather than the
    // shared empty-string bucket that leaked other projects' memories.
    expect(resolveMemoryScope("", "")).toEqual({ by: "none" });
    expect(resolveMemoryScope(undefined, undefined)).toEqual({ by: "none" });
    expect(resolveMemoryScope("   ", "  ")).toEqual({ by: "none" });
  });

  it("treats a whitespace-only mint as absent and uses the session", () => {
    expect(resolveMemoryScope("   ", "sess_1")).toEqual({ by: "session", value: "sess_1" });
  });
});
