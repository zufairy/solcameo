import { describe, it, expect, vi } from "vitest";
import { transformCaptionWords, transformCaptionText, resolveDescriptionInstruction, generatePostCaption, isPlaceholderClipTitle, meaningfulBasis, SMART_CAPTION_DEFAULT_INSTRUCTION } from "./captionTransform";
import { planClipEdits } from "./clipEditPlanner";
import { validateEditPlan } from "./clipEditOps";
import { CLIP_SKILL_BY_ID } from "../builder/clipSkillsCatalog";
import type { TranscriptWord, ClipConfig, ClipMoment, TranscriptSegment } from "./clipTypes";

const words: TranscriptWord[] = [
  { word: "Hello", start: 0, end: 0.5 },
  { word: "World", start: 0.5, end: 1 },
];

describe("transformCaptionWords (deterministic fallback, no LLM key)", () => {
  it("lowercases for an 'all small caps' instruction, preserving timing + reports mode", async () => {
    const out = await transformCaptionWords(words, "make all small caps", "");
    expect(out.words.map((w) => w.word)).toEqual(["hello", "world"]);
    expect(out.words.map((w) => w.start)).toEqual([0, 0.5]);
    expect(out.words.map((w) => w.end)).toEqual([0.5, 1]);
    expect(out.mode).toBe("lowercase");
  });
  it("uppercases for an 'ALL CAPS' instruction", async () => {
    const out = await transformCaptionWords(words, "ALL CAPS please", "");
    expect(out.words.map((w) => w.word)).toEqual(["HELLO", "WORLD"]);
    expect(out.mode).toBe("uppercase");
  });
  it("leaves words unchanged + mode 'none' for a non-casing instruction with no LLM", async () => {
    const out = await transformCaptionWords(words, "translate to Malay", "");
    expect(out.words.map((w) => w.word)).toEqual(["Hello", "World"]);
    expect(out.mode).toBe("none");
  });
  it("no-ops (mode 'none') on empty words / blank instruction", async () => {
    const empty = await transformCaptionWords([], "lowercase", "");
    expect(empty.words).toEqual([]);
    expect(empty.mode).toBe("none");
    const blank = await transformCaptionWords(words, "   ", "");
    expect(blank.words.map((w) => w.word)).toEqual(["Hello", "World"]);
    expect(blank.mode).toBe("none");
  });
});

describe("transformCaptionText (post description, deterministic fallback)", () => {
  it("lowercases the post caption for an 'all lowercase' instruction", async () => {
    const r = await transformCaptionText("BTC Broke 70K", "all lowercase", "");
    expect(r.text).toBe("btc broke 70k");
    expect(r.mode).toBe("lowercase");
  });
  it("uppercases for an 'ALL CAPS' instruction", async () => {
    const r = await transformCaptionText("btc broke 70k", "ALL CAPS", "");
    expect(r.text).toBe("BTC BROKE 70K");
    expect(r.mode).toBe("uppercase");
  });
  it("leaves the caption unchanged (mode none) for a non-casing instruction with no LLM", async () => {
    const r = await transformCaptionText("BTC broke 70k", "translate to Malay", "");
    expect(r.text).toBe("BTC broke 70k");
    expect(r.mode).toBe("none");
  });
  it("no-ops on empty caption / blank instruction", async () => {
    expect((await transformCaptionText("", "lowercase", "")).mode).toBe("none");
    expect((await transformCaptionText("hi", "  ", "")).text).toBe("hi");
  });
});

describe("generatePostCaption (Smart Captions: compose the post caption)", () => {
  it("returns '' for an empty/blank instruction so the caller keeps its fallback", async () => {
    expect(await generatePostCaption({ instruction: "   " })).toBe("");
    expect(await generatePostCaption({ instruction: "" })).toBe("");
  });
});

describe("resolveDescriptionInstruction (Smart Captions: post-description resolution)", () => {
  it("a non-empty descriptionPrompt wins even when descFromCaption is false", () => {
    const out = resolveDescriptionInstruction({
      captionPrompt: "translate to Malay",
      descriptionPrompt: "1 punchy line + a question, in Malay",
      descFromCaption: false,
    });
    expect(out).toBe("1 punchy line + a question, in Malay");
  });

  it("falls back to captionPrompt (trimmed) when descriptionPrompt is empty and descFromCaption is true", () => {
    const out = resolveDescriptionInstruction({
      captionPrompt: "  translate to Malay  ",
      descriptionPrompt: "",
      descFromCaption: true,
    });
    expect(out).toBe("translate to Malay");
  });

  it("returns empty when descriptionPrompt is empty and descFromCaption is false", () => {
    const out = resolveDescriptionInstruction({
      captionPrompt: "translate to Malay",
      descriptionPrompt: "",
      descFromCaption: false,
    });
    expect(out).toBe("");
  });

  it("defaults descFromCaption to true (legacy behavior) when undefined, reusing captionPrompt", () => {
    const out = resolveDescriptionInstruction({
      captionPrompt: "translate to Malay",
      descriptionPrompt: undefined,
      descFromCaption: undefined,
    });
    expect(out).toBe("translate to Malay");
  });

  it("returns empty when everything is empty/undefined", () => {
    expect(resolveDescriptionInstruction({})).toBe("");
    expect(resolveDescriptionInstruction({ captionPrompt: "", descriptionPrompt: "", descFromCaption: false })).toBe("");
  });
});

describe("Smart Captions (clip.captionstyle) wiring", () => {
  const config: ClipConfig = {
    clipLength: { min: 20, max: 40 }, maxClipsPerSource: 3, captionsOn: false,
    captionStyle: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" },
    hookStyle: "cold_open", platforms: ["tiktok"], autoPost: false,
  };
  const moment: ClipMoment = { startSeconds: 0, endSeconds: 30, title: "x", reason: "x", viralScore: 80, captionText: "hi" };
  const window: TranscriptSegment[] = [{ start: 0, end: 30, text: "hello world" }];

  it("emits NO on-video subtitles op — Smart Captions writes the POST caption, not the on-screen captions (that is Dynamic Captions)", () => {
    const ops = CLIP_SKILL_BY_ID["clip.captionstyle"].floor!(
      { title: "x", captionText: "hi", startSeconds: 0, endSeconds: 30 },
      { captionsOn: false, captionStyle: config.captionStyle },
    );
    expect(ops.some((o) => o.op === "subtitles")).toBe(false);
    expect(ops).toEqual([]);
  });

  it("planClipEdits forces captions ON and attaches the operator prompt to the subtitles op", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [{ op: "reframe", mode: "crop" }] });
    const skills = [{ skillId: "clip.captionstyle", name: "Smart Captions", instructions: "captions", captionPrompt: "translate to Malay, all lowercase" }];
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    const sub = out.find((o) => o.op === "subtitles");
    if (!sub || sub.op !== "subtitles") throw new Error("captions not forced on");
    expect(sub.style.prompt).toBe("translate to Malay, all lowercase");
  });

  it("coerceCaptionStyle preserves the prompt through the clip route's re-validateEditPlan", () => {
    const out = validateEditPlan([
      { op: "subtitles", style: { mode: "karaoke", fontColor: "#fff", fontSize: 48, position: "bottom", prompt: "all caps" } },
    ]);
    const sub = out.find((o) => o.op === "subtitles");
    if (!sub || sub.op !== "subtitles") throw new Error("subtitles dropped");
    expect(sub.style.prompt).toBe("all caps");
  });
});

// THE BUG: Smart Captions installed but with no prompt typed resolved to "" —
// "don't rewrite" — so a post kept whatever it was handed. On a source with no
// usable transcript that was the row's placeholder label, and clips published as
// "Clip 1" / "Clip 2".
describe("Smart Captions — installed always writes a caption", () => {
  it("falls back to the persona default when installed with nothing typed", () => {
    expect(resolveDescriptionInstruction({}, { installed: true })).toBe(SMART_CAPTION_DEFAULT_INSTRUCTION);
  });

  it("stays OFF when the app is not installed", () => {
    expect(resolveDescriptionInstruction({}, { installed: false })).toBe("");
    expect(resolveDescriptionInstruction({})).toBe("");
  });

  it("a typed prompt still wins over the default", () => {
    expect(resolveDescriptionInstruction({ descriptionPrompt: "in Malay, 1 line" }, { installed: true })).toBe("in Malay, 1 line");
    expect(resolveDescriptionInstruction({ captionPrompt: "hype tone" }, { installed: true })).toBe("hype tone");
  });

  it("respects descFromCaption:false — the subtitle prompt is not reused as the description", () => {
    expect(resolveDescriptionInstruction({ captionPrompt: "hype tone", descFromCaption: false }, { installed: true }))
      .toBe(SMART_CAPTION_DEFAULT_INSTRUCTION);
  });
});

describe("placeholder clip titles never become post copy", () => {
  it("recognizes the analysis-unavailable labels", () => {
    for (const t of ["Clip 1", "clip 2", "  Clip 12  ", "Clip"]) {
      expect(isPlaceholderClipTitle(t), t).toBe(true);
    }
  });

  it("does not swallow a real title that merely mentions a clip", () => {
    for (const t of ["Clip of the year", "2 clips that changed everything", "Clipboard tips"]) {
      expect(isPlaceholderClipTitle(t), t).toBe(false);
    }
  });

  it("meaningfulBasis skips placeholders and blanks, keeping the first real text", () => {
    expect(meaningfulBasis("", "Clip 3", "how we cut costs")).toBe("how we cut costs");
    expect(meaningfulBasis("Clip 3")).toBe("");
    expect(meaningfulBasis(undefined, null)).toBe("");
  });
});
