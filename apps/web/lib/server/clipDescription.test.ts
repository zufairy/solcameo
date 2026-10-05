import { describe, it, expect, vi, beforeEach } from "vitest";

const generatePostCaption = vi.fn();
vi.mock("@/lib/server/captionTransform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/captionTransform")>();
  return { ...actual, generatePostCaption };
});

const { buildClipDescription, clipDescriptionInstruction, fallbackClipLabel } = await import("./clipDescription");

const smartCaptions = (extra: Record<string, unknown> = {}) => ({ skillId: "clip.captionstyle", ...extra });

beforeEach(() => {
  generatePostCaption.mockReset();
  generatePostCaption.mockResolvedValue("three ways we cut our AWS bill");
});

describe("clipDescriptionInstruction", () => {
  it("is empty when Smart Captions isn't wired — the row keeps its own text", () => {
    expect(clipDescriptionInstruction([{ skillId: "clip.captions" }])).toBe("");
    expect(clipDescriptionInstruction(undefined)).toBe("");
  });

  it("ignores a row whose canvas node was removed", () => {
    expect(clipDescriptionInstruction([smartCaptions({ wired: false, descriptionPrompt: "in Malay" })])).toBe("");
  });

  it("uses the typed prompt", () => {
    expect(clipDescriptionInstruction([smartCaptions({ descriptionPrompt: "in Malay, one line" })])).toBe("in Malay, one line");
  });

  // Installed-but-unconfigured must still write a caption — that silence is what
  // left clips labelled "Clip 2".
  it("falls back to a default when installed with nothing typed", () => {
    expect(clipDescriptionInstruction([smartCaptions()])).not.toBe("");
  });
});

describe("buildClipDescription", () => {
  it("returns '' when the app isn't wired, without calling the model", async () => {
    const out = await buildClipDescription({ skills: [], title: "Clip 1" });
    expect(out).toBe("");
    expect(generatePostCaption).not.toHaveBeenCalled();
  });

  it("writes a description from the clip's transcript", async () => {
    const out = await buildClipDescription({
      skills: [smartCaptions({ descriptionPrompt: "punchy, no hashtags" })],
      transcriptText: "we moved the workers off on-demand and the bill dropped",
      title: "Clip 3",
    });
    expect(out).toBe("three ways we cut our AWS bill");
    expect(generatePostCaption.mock.calls[0][0]).toMatchObject({ instruction: "punchy, no hashtags" });
  });

  // A placeholder label as the basis teaches the model the clip is about "clip 3".
  it("never passes a placeholder label as the basis", async () => {
    await buildClipDescription({ skills: [smartCaptions()], title: "Clip 3", captionText: "" });
    expect(generatePostCaption.mock.calls[0][0].basis).toBe("");
  });

  it("still writes one for an upload with no transcript at all", async () => {
    const out = await buildClipDescription({ skills: [smartCaptions()], title: "Upload 1" });
    expect(out).toBe("three ways we cut our AWS bill");
  });

  // A bad caption is worse than none: the card falls back to the title instead.
  it("returns '' when generation fails", async () => {
    generatePostCaption.mockRejectedValue(new Error("kie down"));
    expect(await buildClipDescription({ skills: [smartCaptions()], title: "x" })).toBe("");
  });
});

// "Untitled clip" is worse than useless in a gallery, and a random name is worse
// still — the label has to come from something the operator recognises.
describe("fallbackClipLabel", () => {
  it("names the campaign when the clip serves one", () => {
    expect(fallbackClipLabel({ index: 0, campaignTitle: "Solana Summer", agentName: "Vesper" })).toBe("Solana Summer — 1");
  });

  it("falls back to the persona", () => {
    expect(fallbackClipLabel({ index: 2, agentName: "Vesper" })).toBe("Vesper — 3");
  });

  it("then to the niche", () => {
    expect(fallbackClipLabel({ index: 0, niche: "fitness" })).toBe("fitness clip — 1");
  });

  it("is unique per clip in a run", () => {
    const labels = [0, 1, 2].map((index) => fallbackClipLabel({ index, agentName: "Vesper" }));
    expect(new Set(labels).size).toBe(3);
  });

  it("only says 'Clip N' when literally nothing is known", () => {
    expect(fallbackClipLabel({ index: 0 })).toBe("Clip 1");
  });

  it("trims a long campaign name so the counter survives", () => {
    const long = "A".repeat(120);
    expect(fallbackClipLabel({ index: 0, campaignTitle: long }).endsWith("— 1")).toBe(true);
  });
});
