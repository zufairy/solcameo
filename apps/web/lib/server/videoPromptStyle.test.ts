/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { buildVideoStyleDirective, classifyVideoTemplate } from "./videoPromptStyle";

describe("classifyVideoTemplate", () => {
  it("detects cartoon episodic personas", () => {
    expect(classifyVideoTemplate({ description: "cartoon episode with recurring cast" })).toBe("cartoon_episode");
  });

  it("detects UGC handheld personas by default", () => {
    expect(classifyVideoTemplate({ description: "raw handheld creator vlog" })).toBe("ugc_handheld");
  });
});

describe("buildVideoStyleDirective", () => {
  it("defaults to imperfect human motion", () => {
    const directive = buildVideoStyleDirective({ description: "creator vlog" });
    expect(directive).toContain("slight camera shake");
    expect(directive).toContain("Unless the persona explicitly asks for polish");
  });

  it("softens the imperfection language for polished personas", () => {
    const directive = buildVideoStyleDirective({ description: "premium polished editorial launch" });
    expect(directive).toContain("polished");
    expect(directive).toContain("premium");
  });
});
