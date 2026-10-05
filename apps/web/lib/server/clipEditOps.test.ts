import { describe, it, expect } from "vitest";
import { validateEditPlan, type EditOp } from "./clipEditOps";

describe("validateEditPlan", () => {
  it("keeps well-formed ops and forces reframe first", () => {
    const raw: EditOp[] = [
      { op: "subtitles", style: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" } },
      { op: "reframe", mode: "crop" },
    ];
    const out = validateEditPlan(raw);
    expect(out[0]).toEqual({ op: "reframe", mode: "crop" });
    expect(out.some((o) => o.op === "subtitles")).toBe(true);
  });

  it("prepends a default reframe when none is present", () => {
    const out = validateEditPlan([{ op: "subtitles", style: { mode: "line", fontColor: "#fff", fontSize: 40, position: "bottom" } }]);
    expect(out[0]).toEqual({ op: "reframe", mode: "crop" });
  });

  it("drops unknown / malformed ops", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "explode_video" } as unknown as EditOp,
      { op: "text_overlay", text: "", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 40, bold: true } },
      { op: "text_overlay", text: "POV", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 40, bold: true } },
    ]);
    expect(out.find((o) => (o as { op: string }).op === "explode_video")).toBeUndefined();
    const overlays = out.filter((o) => o.op === "text_overlay");
    expect(overlays).toHaveLength(1);
    expect((overlays[0] as { text: string }).text).toBe("POV");
  });

  it("drops a subtitles op whose style.mode is invalid", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "subtitles", style: { mode: "neon", fontColor: "#fff", fontSize: 40, position: "bottom" } },
    ]);
    expect(out.some((o) => o.op === "subtitles")).toBe(false);
  });
});

describe("validateEditPlan — text_overlay length (hook truncation)", () => {
  it("preserves the editor's exact dragged position and selected font", () => {
    const out = validateEditPlan([
      { op: "text_overlay", text: "STOP SCROLLING", position: "top", yPct: 63.4, startSec: 0, endSec: 4, style: { fontColor: "#fff", fontSize: 82, bold: false, font: "anton" } },
    ]);
    const hook = out.find((o) => o.op === "text_overlay");
    expect(hook).toMatchObject({ yPct: 63.4, style: { fontSize: 82, font: "anton", bold: false } });
  });

  it("keeps a full hook-length phrase — was blunt-sliced to 40 chars, cutting 'MONEY' to 'M'", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "text_overlay", text: "ELON MUSK JUST CALLED ASKING TO BORROW MONEY", position: "top", startSec: 0, endSec: 3, style: { fontColor: "#fff", fontSize: 56, bold: true } },
    ]);
    const ov = out.find((o) => o.op === "text_overlay") as { text: string };
    // 44 chars — must survive intact; wrapDrawtext (not a blunt slice) fits it on-canvas.
    expect(ov.text).toBe("ELON MUSK JUST CALLED ASKING TO BORROW MONEY");
  });

  it("word-boundary-trims an absurdly long overlay instead of cutting mid-word", () => {
    const longText = Array.from({ length: 40 }, () => "word").join(" "); // ~199 chars
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "text_overlay", text: longText, position: "top", startSec: 0, endSec: 3, style: { fontColor: "#fff", fontSize: 56, bold: true } },
    ]);
    const ov = out.find((o) => o.op === "text_overlay") as { text: string };
    expect(ov.text.length).toBeLessThanOrEqual(101);
    expect(ov.text.endsWith("…")).toBe(true);
    // every token before the ellipsis is a WHOLE "word" — never a "wor" fragment.
    expect(ov.text.replace(/…$/, "").trim().split(/\s+/).every((w) => w === "word")).toBe(true);
  });
});

describe("validateEditPlan — composite_bg (Brain Rot)", () => {
  it("keeps a well-formed vstack composite, defaulting clipPos to top", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4" },
    ]);
    const op = out.find((o) => o.op === "composite_bg");
    expect(op).toEqual({ op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" });
  });

  it("defaults an unknown layout to vstack and a cross-axis clipPos to a valid one", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      // layout invalid → vstack; clipPos "left" is an hstack value → invalid for vstack → top
      { op: "composite_bg", layout: "wacky", bgUrl: "https://cdn/x.mp4", clipPos: "left" },
    ] as unknown as EditOp[]);
    const op = out.find((o) => o.op === "composite_bg") as Extract<EditOp, { op: "composite_bg" }>;
    expect(op.layout).toBe("vstack");
    expect(op.clipPos).toBe("top");
  });

  it("keeps hstack with clipPos=right", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "composite_bg", layout: "hstack", bgUrl: "https://cdn/x.mp4", clipPos: "right" },
    ]);
    const op = out.find((o) => o.op === "composite_bg") as Extract<EditOp, { op: "composite_bg" }>;
    expect(op.layout).toBe("hstack");
    expect(op.clipPos).toBe("right");
  });

  it("drops a composite_bg with no bgUrl (load-bearing — would reference a missing input)", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "composite_bg", layout: "vstack" },
    ] as unknown as EditOp[]);
    expect(out.some((o) => o.op === "composite_bg")).toBe(false);
  });
});

describe("validateEditPlan — audio_overlay (Meme Audio)", () => {
  it("keeps a well-formed overlay and clamps a wild gainDb", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: 2.5, gainDb: 99, durationSec: 4 },
    ]);
    const op = out.find((o) => o.op === "audio_overlay") as Extract<EditOp, { op: "audio_overlay" }>;
    expect(op.audioUrl).toBe("https://cdn/s.mp3");
    expect(op.atSec).toBe(2.5);
    expect(op.gainDb).toBe(12); // clamped to the +12dB ceiling
    expect(op.durationSec).toBe(4);
  });

  it("accepts numeric-string atSec/gainDb (the LLM quotes numbers) and defaults gainDb to -3", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: "3" },
    ] as unknown as EditOp[]);
    const op = out.find((o) => o.op === "audio_overlay") as Extract<EditOp, { op: "audio_overlay" }>;
    expect(op.atSec).toBe(3);
    expect(op.gainDb).toBe(-3);
    expect(op.durationSec).toBeUndefined();
  });

  it("floors a negative atSec to 0", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: -5 },
    ]);
    const op = out.find((o) => o.op === "audio_overlay") as Extract<EditOp, { op: "audio_overlay" }>;
    expect(op.atSec).toBe(0);
  });

  it("drops an audio_overlay with no audioUrl (load-bearing — would reference a missing input)", () => {
    const out = validateEditPlan([
      { op: "reframe", mode: "crop" },
      { op: "audio_overlay", atSec: 1 },
    ] as unknown as EditOp[]);
    expect(out.some((o) => o.op === "audio_overlay")).toBe(false);
  });
});
