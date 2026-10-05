import { describe, expect, it } from "vitest";
import { motionReferenceFromBible } from "./motionSwap";
import { HIGGSFIELD_ENGINES, isHiggsfieldModel } from "@/lib/builder/higgsfieldEngines";
import { VIDEO_ENGINES, maxClipForModel, selectableVideoEngines } from "@/lib/builder/agentTypes";

describe("motionReferenceFromBible", () => {
  it("reads the chosen https reference from the motion-swap style", () => {
    const bible = { videoStyles: [{ id: "skit" }, { id: "motion-swap", tunables: { reference: "https://cdn.example.com/a.mp4" } }] };
    expect(motionReferenceFromBible(bible)).toBe("https://cdn.example.com/a.mp4");
  });
  it("rejects missing or non-https references", () => {
    expect(motionReferenceFromBible(null)).toBeNull();
    expect(motionReferenceFromBible({ videoStyles: [{ id: "motion-swap", tunables: { reference: "http://x/a.mp4" } }] })).toBeNull();
  });
});

describe("Higgsfield engines", () => {
  it("every provider=higgsfield render engine has an endpoint and clip limits (Genjutsu is format-only)", () => {
    for (const e of VIDEO_ENGINES.filter((x) => x.provider === "higgsfield" && !x.formatOnly)) {
      expect(isHiggsfieldModel(e.kieModel)).toBe(true);
      expect(maxClipForModel(e.kieModel)).toBe(HIGGSFIELD_ENGINES[e.kieModel].maxClipSeconds);
      expect(e.maxClipSeconds).toBe(HIGGSFIELD_ENGINES[e.kieModel].maxClipSeconds);
    }
  });
  it("hides the Genjutsu engine from dropdowns but offers the Higgsfield models", () => {
    const ids = selectableVideoEngines().map((e) => e.id);
    expect(ids).not.toContain("hf-genjutsu");
    expect(ids).toEqual(expect.arrayContaining(["hf-seedance-25", "hf-seedance-2", "hf-grok-video"]));
  });
  it("engine ids avoid the substrings the Kie pipeline branches on", () => {
    for (const id of Object.keys(HIGGSFIELD_ENGINES)) expect(id).not.toMatch(/seedance|grok|veo|kling|gemini/i);
  });
});
