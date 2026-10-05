import { describe, it, expect } from "vitest";
import { inferAgentTypeFromPrompt, builderHrefForPrompt } from "./agentIntent";

describe("inferAgentTypeFromPrompt", () => {
  it("clip verb + YouTube link is a strong clipping intent", () => {
    expect(inferAgentTypeFromPrompt("Clip this video: https://www.youtube.com/watch?v=abc")).toEqual({ type: "clipping", strong: true });
  });
  it("a bare video link is clipping", () => {
    for (const u of ["https://youtu.be/x", "https://www.tiktok.com/@a/video/1", "https://drive.google.com/file/d/1/view", "https://cdn.x.com/a.mp4"]) {
      expect(inferAgentTypeFromPrompt(u).type).toBe("clipping");
    }
  });
  it("clip wording without a link is clipping", () => {
    expect(inferAgentTypeFromPrompt("make viral shorts from my podcast").type).toBe("clipping");
  });
  it("persona wording is influencer", () => {
    expect(inferAgentTypeFromPrompt("A fitness influencer who posts gym tips").type).toBe("influencer");
  });
  it("no signal → null", () => {
    expect(inferAgentTypeFromPrompt("hello there").type).toBeNull();
    expect(inferAgentTypeFromPrompt("").type).toBeNull();
  });
  it("builderHrefForPrompt routes a clip prompt to the clipper builder even from an influencer box", () => {
    expect(builderHrefForPrompt("Clip this video: https://www.youtube.com/watch?v=abc", "influencer")).toMatch(/^\/builder\?type=clipping&q=/);
    expect(builderHrefForPrompt("a skincare creator", "clipping")).toMatch(/^\/builder\?type=influencer/);
  });
});
