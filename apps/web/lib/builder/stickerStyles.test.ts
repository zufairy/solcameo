import { describe, it, expect, vi } from "vitest";
import { STICKER_STYLES, stickerStyleById, isStickerStyleId, isStickerPosition } from "./stickerStyles";
import { CLIP_SKILL_BY_ID, stickerOverlayOp, STICKER_START_SEC } from "./clipSkillsCatalog";
import { transformStickerText } from "../server/stickerTransform";
import { planClipEdits } from "../server/clipEditPlanner";
import type { ClipConfig, ClipMoment, TranscriptSegment } from "../server/clipTypes";

describe("STICKER_STYLES registry", () => {
  it("unique ids, resolvable default, guards", () => {
    const ids = STICKER_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(stickerStyleById("classic")?.id).toBe("classic");
    expect(stickerStyleById("nope")).toBeUndefined();
    expect(isStickerStyleId("classic")).toBe(true);
    expect(isStickerStyleId("x")).toBe(false);
    expect(isStickerPosition("top")).toBe(true);
    expect(isStickerPosition("diagonal")).toBe(false);
  });
  it("every style carries a box color + a preview", () => {
    for (const s of STICKER_STYLES) {
      expect(typeof s.render.boxColor).toBe("string");
      expect(s.render.fontSize).toBeGreaterThan(0);
      expect(s.preview).toBeTruthy();
    }
  });
});

describe("stickerOverlayOp + clip.sticker floor", () => {
  const m = { title: "t", captionText: "joining the defi trend with a bet", startSeconds: 0, endSeconds: 30 };

  it("emits a boxed text_overlay at the sticker slot (0.3) with the chosen style + position", () => {
    const op = stickerOverlayOp("JOINING THE TREND", "money", "center");
    if (op.op !== "text_overlay") throw new Error("unreachable");
    expect(op.startSec).toBe(STICKER_START_SEC);
    expect(op.position).toBe("center");
    expect(op.style.bgColor).toBe("#00E5A0"); // money box
    expect(op.text).toBe("JOINING THE TREND");
  });

  it("defaults to the classic style + top when unset", () => {
    const op = stickerOverlayOp("hi");
    if (op.op !== "text_overlay") throw new Error("unreachable");
    expect(op.position).toBe("top");
    expect(op.style.bgColor).toBe("#000000"); // classic black box
  });

  it("the clip.sticker floor produces a context-aware sticker from the caption", () => {
    const ops = CLIP_SKILL_BY_ID["clip.sticker"].floor!(m, {
      captionsOn: false, captionStyle: { mode: "line", fontColor: "#fff", fontSize: 40, position: "bottom" },
    });
    const op = ops[0];
    if (op.op !== "text_overlay") throw new Error("unreachable");
    expect(op.text.length).toBeGreaterThan(0);
    expect(op.startSec).toBe(STICKER_START_SEC);
  });
});

describe("transformStickerText", () => {
  it("returns the deterministic fallback when there is no prompt", async () => {
    const r = await transformStickerText("some clip caption", "", "FALLBACK PHRASE", "");
    expect(r.text).toBe("FALLBACK PHRASE");
    expect(r.mode).toBe("fallback");
  });
  it("returns the fallback when no apiKey (can't call the LLM)", async () => {
    const r = await transformStickerText("cap", "make it about a trend", "FB", "");
    expect(r.text).toBe("FB");
    expect(r.mode).toBe("fallback");
  });
});

describe("hook + sticker + meme overlays all coexist (distinct start times)", () => {
  const config: ClipConfig = {
    clipLength: { min: 20, max: 40 }, maxClipsPerSource: 3, captionsOn: false,
    captionStyle: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" },
    hookStyle: "cold_open", platforms: ["tiktok"], autoPost: false,
  };
  const moment: ClipMoment = { startSeconds: 0, endSeconds: 30, title: "t", reason: "x", viralScore: 80, captionText: "watch this insane moment" };
  const window: TranscriptSegment[] = [{ start: 0, end: 30, text: "watch this insane moment" }];

  it("renders hook@0, sticker@0.3 and meme@1 together", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [{ op: "reframe", mode: "crop" }] });
    const skills = [
      { skillId: "clip.hook", name: "Hook", instructions: "hook", hookTemplateId: "bold_impact" },
      { skillId: "clip.sticker", name: "Sticker", instructions: "sticker", stickerStyleId: "hype" },
      { skillId: "clip.meme", name: "Meme", instructions: "meme" },
    ];
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    const overlays = out.filter((o) => o.op === "text_overlay");
    expect(overlays.length).toBe(3);
    expect(overlays.some((o) => o.op === "text_overlay" && o.startSec === 0)).toBe(true);                       // hook
    expect(overlays.some((o) => o.op === "text_overlay" && Math.abs(o.startSec - STICKER_START_SEC) < 0.01)).toBe(true); // sticker
    expect(overlays.some((o) => o.op === "text_overlay" && o.startSec === 1)).toBe(true);                       // meme
    // the sticker carries a box style (hype = pink box)
    const sticker = overlays.find((o) => o.op === "text_overlay" && Math.abs(o.startSec - STICKER_START_SEC) < 0.01);
    if (!sticker || sticker.op !== "text_overlay") throw new Error("no sticker");
    expect(sticker.style.bgColor).toBe("#FF2D78");
  });
});
