import { describe, expect, it } from "vitest";
import { buildShirtPrompt, sanitizePoseId, sanitizeShirtDescription, sanitizeShirtMode } from "./shirt";

describe("shirt prompt", () => {
  it("locks identity and prints the supplied logo exactly", () => {
    const p = buildShirtPrompt({ mode: "logo", hasLogo: true });
    expect(p).toContain("IDENTITY LOCK");
    expect(p).toContain("SECOND image is the user's logo");
    expect(p).toContain("keep the exact same pose");
  });
  it("uses the description and adds a new pose when asked", () => {
    const p = buildShirtPrompt({ mode: "describe", hasLogo: false, description: "oversized red tee with a gold dragon", poseId: "wave" });
    expect(p).toContain("oversized red tee with a gold dragon");
    expect(p).toContain("waving");
    expect(p).not.toContain("SECOND image");
  });
  it("picks a concrete design when the AI chooses, deterministically per seed", () => {
    expect(buildShirtPrompt({ mode: "auto", hasLogo: false, seed: 1 })).toBe(buildShirtPrompt({ mode: "auto", hasLogo: false, seed: 1 }));
    expect(buildShirtPrompt({ mode: "auto", hasLogo: false, seed: 0 })).not.toBe(buildShirtPrompt({ mode: "auto", hasLogo: false, seed: 1 }));
  });
  it("sanitizes untrusted input", () => {
    expect(sanitizeShirtDescription("a <b>tee</b>`\n\n x".repeat(40)).length).toBeLessThanOrEqual(240);
    expect(sanitizeShirtDescription("<script>")).not.toContain("<");
    expect(sanitizePoseId("nope")).toBe("keep");
    expect(sanitizeShirtMode("x")).toBe("auto");
  });
});
