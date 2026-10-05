import { describe, it, expect } from "vitest";
import {
  derivePricedSkillsFromOps,
  opsRequireBillingIdentity,
  EXCLUSIVE_PRICED_SKILL_BY_OP,
  EXCLUSIVE_PRICED_SKILL_BY_EMPHASIS_KIND,
} from "./clipOpsBilling";
import { CLIP_SKILL_PRICE_USDC } from "../economy/servicePrices";

/**
 * #23 (free-skilled-clips): the render route derives PRICED skills from the ffmpeg
 * `ops` server-side. The inversion is deliberately CONSERVATIVE — it charges a
 * skill ONLY for ops that are emitted EXCLUSIVELY by that one priced skill
 * (SKILL_OP_KINDS, lib/server/clipEditPlanner.ts). Ambiguous op kinds
 * (subtitles/text_overlay/audio_overlay/composite_bg) have FREE sibling emitters
 * (built-in Captions node, clip.sticker, clip.memeaudio, clip.brainrot,
 * clip.captionstyle, clip.style.*) — charging them would MIS-CHARGE real users,
 * so they only require a billing IDENTITY (the 402 gate), never a charge.
 */
describe("derivePricedSkillsFromOps (exclusive-emitter inversion)", () => {
  it.each([
    [{ op: "face_reframe", mode: "auto" }, "clip.facetrack"],
    [{ op: "remove_fillers" }, "clip.fillercut"],
    [{ op: "color_filter", preset: "warm" }, "clip.filters"],
    [{ op: "title_card", text: "T", durationSec: 1.5, style: {} }, "clip.title"],
    [{ op: "emphasis", kind: "zoom_punch", atSec: 2 }, "clip.zoom"],
  ])("maps %j exclusively to %s", (op, skillId) => {
    expect(derivePricedSkillsFromOps([op])).toEqual([skillId]);
  });

  it("does NOT charge the stripped/free emphasis kinds (speed, freeze)", () => {
    expect(derivePricedSkillsFromOps([
      { op: "emphasis", kind: "speed", atSec: 1 },
      { op: "emphasis", kind: "freeze", atSec: 2 },
    ])).toEqual([]);
  });

  it.each([
    [{ op: "subtitles", style: {} }],
    [{ op: "text_overlay", text: "HOOK", position: "top", startSec: 0, endSec: 3, style: {} }],
    [{ op: "audio_overlay", audioUrl: "https://x/a.mp3", atSec: 0, gainDb: -16 }],
    [{ op: "composite_bg", layout: "vstack", bgUrl: "https://x/bg.mp4" }],
  ])("never charges the ambiguous op %j (free sibling emitters exist)", (op) => {
    expect(derivePricedSkillsFromOps([op])).toEqual([]);
  });

  it("ignores non-skill ops (reframe, logo_overlay)", () => {
    expect(derivePricedSkillsFromOps([
      { op: "reframe", mode: "crop" },
      { op: "logo_overlay", imageUrl: "https://x/l.png", corner: "tr", opacity: 0.8 },
    ])).toEqual([]);
  });

  it("dedupes repeated ops to one charge per skill", () => {
    expect(derivePricedSkillsFromOps([
      { op: "face_reframe" },
      { op: "face_reframe", mode: "pan" },
    ])).toEqual(["clip.facetrack"]);
  });

  it("tolerates garbage input without throwing", () => {
    expect(derivePricedSkillsFromOps(undefined)).toEqual([]);
    expect(derivePricedSkillsFromOps("ops")).toEqual([]);
    expect(derivePricedSkillsFromOps({ op: "face_reframe" })).toEqual([]); // not an array
    expect(derivePricedSkillsFromOps([null, 5, "x", {}, { op: 42 }, { op: "unknown_op" }])).toEqual([]);
  });

  it("every skill in the inversion map is priced > 0 in CLIP_SKILL_PRICE_USDC (repricing guard)", () => {
    const skills = [
      ...Object.values(EXCLUSIVE_PRICED_SKILL_BY_OP),
      ...Object.values(EXCLUSIVE_PRICED_SKILL_BY_EMPHASIS_KIND),
    ];
    expect(skills.length).toBeGreaterThan(0);
    for (const skillId of skills) {
      expect(CLIP_SKILL_PRICE_USDC[skillId], `${skillId} must be priced`).toBeGreaterThan(0);
    }
  });
});

describe("opsRequireBillingIdentity (the 402 gate class)", () => {
  it.each([
    [{ op: "subtitles", style: {} }],
    [{ op: "text_overlay", text: "x", position: "top", startSec: 0, endSec: 3, style: {} }],
    [{ op: "audio_overlay", audioUrl: "https://x/a.mp3", atSec: 0 }],
    [{ op: "composite_bg", layout: "vstack", bgUrl: "https://x/bg.mp4" }],
    [{ op: "face_reframe" }],
    [{ op: "title_card", text: "T", durationSec: 1.5, style: {} }],
    [{ op: "remove_fillers" }],
    [{ op: "color_filter", preset: "vivid" }],
    [{ op: "emphasis", kind: "zoom_punch", atSec: 1 }],
  ])("requires a billing identity for skill-class op %j", (op) => {
    expect(opsRequireBillingIdentity([op])).toBe(true);
  });

  it("lets a plain cut through without billing identity", () => {
    expect(opsRequireBillingIdentity([])).toBe(false);
    expect(opsRequireBillingIdentity(undefined)).toBe(false);
    expect(opsRequireBillingIdentity([
      { op: "reframe", mode: "crop" },
      { op: "logo_overlay", imageUrl: "https://x/l.png", corner: "tr", opacity: 0.8 },
      { op: "emphasis", kind: "speed", atSec: 1 }, // stripped by the graph, renders nothing
    ])).toBe(false);
  });
});
