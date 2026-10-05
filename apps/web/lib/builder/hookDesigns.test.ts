import { describe, it, expect, vi } from "vitest";
import {
  HOOK_DESIGNS,
  HOOK_DESIGN_BY_ID,
  hookDesignById,
  isHookDesignId,
  clampHookDuration,
  resolveHookRender,
  DEFAULT_HOOK_DESIGN_ID,
  DEFAULT_HOOK_DURATION_SEC,
  HOOK_DURATION_MIN,
  HOOK_DURATION_MAX,
} from "./hookDesigns";
import { CLIP_SKILL_BY_ID, hookOverlayOp } from "./clipSkillsCatalog";
import { validateEditPlan, type EditOp } from "../server/clipEditOps";
import { buildClipGraph } from "../server/clipFilterGraph";
import { planClipEdits } from "../server/clipEditPlanner";
import type { ClipConfig, ClipMoment, TranscriptSegment } from "../server/clipTypes";

describe("HOOK_DESIGNS registry", () => {
  it("has unique ids and a resolvable default", () => {
    const ids = HOOK_DESIGNS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(HOOK_DESIGN_BY_ID[DEFAULT_HOOK_DESIGN_ID]).toBeDefined();
  });
  it("every design carries render params + a preview", () => {
    for (const d of HOOK_DESIGNS) {
      expect(typeof d.render.fontColor).toBe("string");
      expect(d.render.fontSize).toBeGreaterThan(0);
      expect(["top", "center", "bottom"]).toContain(d.render.position);
      expect(d.preview).toBeTruthy();
    }
  });
  it("isHookDesignId guards real ids only", () => {
    expect(isHookDesignId("bold_impact")).toBe(true);
    expect(isHookDesignId("not_a_design")).toBe(false);
    expect(isHookDesignId(undefined)).toBe(false);
    expect(isHookDesignId(5)).toBe(false);
  });
  it("hookDesignById returns undefined for unknown / missing", () => {
    expect(hookDesignById("bold_impact")?.id).toBe("bold_impact");
    expect(hookDesignById("nope")).toBeUndefined();
    expect(hookDesignById(undefined)).toBeUndefined();
  });
  it("clampHookDuration clamps + defaults", () => {
    expect(clampHookDuration(undefined)).toBe(DEFAULT_HOOK_DURATION_SEC);
    expect(clampHookDuration(NaN)).toBe(DEFAULT_HOOK_DURATION_SEC);
    expect(clampHookDuration(0)).toBe(HOOK_DURATION_MIN);
    expect(clampHookDuration(999)).toBe(HOOK_DURATION_MAX);
    expect(clampHookDuration(7.5)).toBe(6);
  });
});

describe("hookOverlayOp + clip.hook floor", () => {
  const moment = { title: "Hook", captionText: "this changes everything for traders", startSeconds: 0, endSeconds: 30 };

  it("applies the chosen duration + design template", () => {
    // yellow_pop: centered, ALL CAPS. Duration 9 clamps to the 3–6s window (→6).
    const op = hookOverlayOp("watch this now", 9, "yellow_pop");
    expect(op.op).toBe("text_overlay");
    if (op.op !== "text_overlay") throw new Error("unreachable");
    expect(op.startSec).toBe(0);
    expect(op.endSec).toBe(6); // clamped from 9
    expect(op.position).toBe("center"); // yellow_pop is centered
    expect(op.text).toBe("WATCH THIS NOW"); // yellow_pop is allCaps
    expect(op.style.fontColor).toBe("#FFFFFF");
    expect(op.style.hookLayout).toBe("stacked");
  });

  it("defaults to bold_impact + 5s when config omitted", () => {
    const op = hookOverlayOp("keep it short");
    if (op.op !== "text_overlay") throw new Error("unreachable");
    expect(op.endSec).toBe(DEFAULT_HOOK_DURATION_SEC);
    expect(op.position).toBe("top");
    expect(op.text).toBe("KEEP IT SHORT");
    expect(op.style.hookLayout).toBe("pov");
  });

  it("the clip.hook floor reads hookDurationSec + hookTemplateId from config", () => {
    const def = CLIP_SKILL_BY_ID["clip.hook"];
    const ops = def.floor!(moment, {
      captionsOn: false,
      captionStyle: { mode: "line", fontColor: "#fff", fontSize: 40, position: "bottom" },
      hookDurationSec: 3,
      hookTemplateId: "yellow_pop",
    });
    expect(ops).toHaveLength(1);
    const op = ops[0];
    if (op.op !== "text_overlay") throw new Error("unreachable");
    expect(op.endSec).toBe(3);
    expect(op.style.fontColor).toBe("#FFFFFF");
    expect(op.text).toBe(op.text.toUpperCase()); // yellow_pop allCaps
  });

  it("legacy clip.hook node (no config) still renders the default hook", () => {
    const def = CLIP_SKILL_BY_ID["clip.hook"];
    const ops = def.floor!(moment, {
      captionsOn: false,
      captionStyle: { mode: "line", fontColor: "#fff", fontSize: 40, position: "bottom" },
    });
    const op = ops[0];
    if (op.op !== "text_overlay") throw new Error("unreachable");
    expect(op.endSec).toBe(DEFAULT_HOOK_DURATION_SEC);
  });
});

describe("coerceTextStyle preserves hook-design outline knobs through validation", () => {
  it("keeps outlineColor/outlineWidth/bgColor so the clip route's re-validate doesn't strip them", () => {
    const raw: EditOp[] = [
      { op: "reframe", mode: "crop" },
      {
        op: "text_overlay", text: "boxed hook", position: "bottom", startSec: 0, endSec: 4,
        style: { fontColor: "#fff", fontSize: 50, bold: true, outlineColor: "#000000", outlineWidth: 1, bgColor: "#000000" },
      },
    ];
    const out = validateEditPlan(raw);
    const ov = out.find((o) => o.op === "text_overlay");
    if (!ov || ov.op !== "text_overlay") throw new Error("overlay dropped");
    expect(ov.style.outlineColor).toBe("#000000");
    expect(ov.style.outlineWidth).toBe(1);
    expect(ov.style.bgColor).toBe("#000000");
  });
  it("clamps an out-of-range outlineWidth", () => {
    const out = validateEditPlan([
      { op: "text_overlay", text: "x", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 40, bold: true, outlineWidth: 99 } } as EditOp,
    ]);
    const ov = out.find((o) => o.op === "text_overlay");
    if (!ov || ov.op !== "text_overlay") throw new Error("overlay dropped");
    expect(ov.style.outlineWidth).toBe(12);
  });
});

describe("drawtext render honors design (box + outline) and stays backward-compatible", () => {
  const base = { startSeconds: 0, endSeconds: 30 };
  const reframe: EditOp = { op: "reframe", mode: "crop" };

  it("a news card draws a separate panel behind its text", () => {
    const op = hookOverlayOp("boxed", 4, "black_box");
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    const vf = g.filterArgs[1];
    expect(vf).toContain("drawbox=");
    expect(vf).not.toContain("box=1");
    expect(vf).toContain("borderw=0");
  });

  it("burns the Auto Hook in the template's bundled font (drawtext fontfile=)", () => {
    // Front Page uses the bundled Barlow Condensed file.
    const op = hookOverlayOp("branded hook", 4, "clean_slide");
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    const vf = g.filterArgs[1];
    expect(vf).toContain("BarlowCondensed-Bold.ttf");
  });

  it("a plain text_overlay (no design fields) renders the legacy borderw=3 black outline, no box", () => {
    const op: EditOp = { op: "text_overlay", text: "legacy", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 56, bold: true } };
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    const vf = g.filterArgs[1];
    expect(vf).toContain("borderw=3");
    expect(vf).toContain("bordercolor=black");
    expect(vf).not.toContain("box=1");
  });
});

describe("applyHookStyle: the operator's pick wins over the LLM editor", () => {
  const config: ClipConfig = {
    clipLength: { min: 20, max: 40 }, maxClipsPerSource: 3, captionsOn: false,
    captionStyle: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" },
    hookStyle: "cold_open", platforms: ["tiktok"], autoPost: false,
  };
  const moment: ClipMoment = { startSeconds: 5, endSeconds: 30, title: "Hook", reason: "x", viralScore: 90, captionText: "Ship fast" };
  const window: TranscriptSegment[] = [{ start: 5, end: 30, text: "ship fast and learn" }];

  it("forces the opening overlay onto the chosen duration + design even when the LLM set its own style", async () => {
    // LLM emits a hook text_overlay with its OWN (default) style + 2s duration.
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "text_overlay", text: "POV you ship", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#ffffff", fontSize: 56, bold: true } },
    ] });
    const skills = [{ skillId: "clip.hook", name: "Auto Hook", instructions: "Add a hook overlay.", hookDurationSec: 6, hookTemplateId: "yellow_pop" }];
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    const ov = out.find((o) => o.op === "text_overlay");
    if (!ov || ov.op !== "text_overlay") throw new Error("hook overlay missing");
    expect(ov.endSec).toBe(6); // operator duration won over the LLM's 2s
    expect(ov.style.fontColor).toBe("#FFFFFF");
    expect(ov.style.hookLayout).toBe("stacked");
    expect(ov.position).toBe("center");
    // The hook line is now REWRITTEN from the clip's own caption (transformHookText;
    // no apiKey here → deterministic hookText fallback + allCaps), replacing the
    // LLM editor's text — so per-clip hooks can't collide.
    expect(ov.text).toBe("SHIP FAST");
  });

  it("hookPosition (the Text-position dropdown) overrides the template's baked position", async () => {
    // yellow_pop's design position is "center"; the operator picks "bottom".
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "text_overlay", text: "POV you ship", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#ffffff", fontSize: 56, bold: true } },
    ] });
    const skills = [{ skillId: "clip.hook", name: "Auto Hook", instructions: "Add a hook overlay.", hookTemplateId: "yellow_pop", hookPosition: "bottom" as const }];
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    const ov = out.find((o) => o.op === "text_overlay");
    if (!ov || ov.op !== "text_overlay") throw new Error("hook overlay missing");
    expect(ov.position).toBe("bottom"); // dropdown won over the template's center
    expect(ov.style.fontColor).toBe("#FFFFFF");
  });

  it("does nothing when clip.hook is not wired", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "text_overlay", text: "meme moment", position: "center", startSec: 5, endSec: 7, style: { fontColor: "#fff", fontSize: 48, bold: true } },
    ] });
    const skills = [{ skillId: "clip.meme", name: "Meme", instructions: "Add a meme overlay." }];
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    const ov = out.find((o) => o.op === "text_overlay");
    if (!ov || ov.op !== "text_overlay") throw new Error("overlay missing");
    expect(ov.endSec).toBe(7); // untouched
  });

  it("keeps a clip.meme overlay (startSec 1) AND applies the hook at 0 when BOTH are wired", async () => {
    // The audit's edge case: hook + meme both map to op-kind text_overlay. The hook
    // must apply at 0 without clobbering the meme that sits at startSec 1.
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "text_overlay", text: "meme moment", position: "top", startSec: 1, endSec: 3, style: { fontColor: "#fff", fontSize: 48, bold: true } },
    ] });
    const skills = [
      { skillId: "clip.hook", name: "Auto Hook", instructions: "hook", hookDurationSec: 6, hookTemplateId: "yellow_pop" },
      { skillId: "clip.meme", name: "Meme", instructions: "meme" },
    ];
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    const overlays = out.filter((o) => o.op === "text_overlay");
    expect(overlays.length).toBe(2);
    const hookOv = overlays.find((o) => o.op === "text_overlay" && o.startSec === 0);
    const memeOv = overlays.find((o) => o.op === "text_overlay" && o.startSec === 1);
    if (!hookOv || hookOv.op !== "text_overlay" || !memeOv || memeOv.op !== "text_overlay") throw new Error("missing overlay");
    expect(hookOv.endSec).toBe(6);
    expect(hookOv.style.fontColor).toBe("#FFFFFF");
    expect(memeOv.text).toBe("meme moment"); // meme NOT clobbered
  });

  it("adds the meme floor even when the LLM emits ONLY an opening hook overlay (both wired)", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "text_overlay", text: "wait for it", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 56, bold: true } },
    ] });
    const skills = [
      { skillId: "clip.hook", name: "Auto Hook", instructions: "hook", hookDurationSec: 5, hookTemplateId: "bold_impact" },
      { skillId: "clip.meme", name: "Meme", instructions: "meme" },
    ];
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    const overlays = out.filter((o) => o.op === "text_overlay");
    expect(overlays.length).toBe(2); // hook@0 (transformed) + meme floor@1
    expect(overlays.some((o) => o.op === "text_overlay" && o.startSec === 0)).toBe(true);
    expect(overlays.some((o) => o.op === "text_overlay" && o.startSec >= 1)).toBe(true);
  });

  it("ensures a hook overlay exists even when the LLM emits none", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [{ op: "reframe", mode: "crop" }] });
    const skills = [{ skillId: "clip.hook", name: "Auto Hook", instructions: "hook", hookDurationSec: 4, hookTemplateId: "clean_slide" }];
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    const hookOv = out.find((o) => o.op === "text_overlay");
    if (!hookOv || hookOv.op !== "text_overlay") throw new Error("hook not added");
    expect(hookOv.startSec).toBe(0);
    expect(hookOv.endSec).toBe(4);
  });
});

describe("custom hook design (resolveHookRender + hookOverlayOp)", () => {
  it("custom fields override the base template; unset fields keep the base", () => {
    const r = resolveHookRender("bold_impact", { position: "center", fontColor: "#FF0000" });
    expect(r.position).toBe("center");          // overridden
    expect(r.fontColor).toBe("#FF0000");        // overridden
    expect(r.outlineWidth).toBe(HOOK_DESIGN_BY_ID["bold_impact"].render.outlineWidth); // kept
  });

  it("no custom → the template's render verbatim", () => {
    expect(resolveHookRender("black_box", null)).toEqual(HOOK_DESIGN_BY_ID["black_box"].render);
  });

  it("boxColor '' removes the box; a hex sets it", () => {
    expect(resolveHookRender("black_box", { boxColor: "" }).boxColor).toBeUndefined();
    expect(resolveHookRender("clean_slide", { boxColor: "#000000" }).boxColor).toBe("#000000");
  });

  it("hookOverlayOp applies the custom look (position + box + caps) to the op", () => {
    const op = hookOverlayOp("hello", 4, "bold_impact", { position: "bottom", boxColor: "#000000", allCaps: true });
    if (op.op !== "text_overlay") throw new Error("expected text_overlay");
    expect(op.position).toBe("bottom");
    expect(op.text).toBe("HELLO");              // allCaps
    expect(op.style.bgColor).toBe("#000000");   // box
  });

  it("custom yPct rides through to the op (exact vertical position wins over the band)", () => {
    const op = hookOverlayOp("hello", 4, "bold_impact", { yPct: 62.5 });
    if (op.op !== "text_overlay") throw new Error("expected text_overlay");
    expect(op.yPct).toBe(62.5);
    expect(op.position).toBe(HOOK_DESIGN_BY_ID["bold_impact"].render.position); // band kept as fallback anchor
  });

  it("no custom yPct → op carries no yPct (band anchor only)", () => {
    const op = hookOverlayOp("hello", 4, "bold_impact", null);
    if (op.op !== "text_overlay") throw new Error("expected text_overlay");
    expect(op.yPct).toBeUndefined();
  });

  it("junk yPct (out of range / non-finite) is clamped or dropped", () => {
    const over = hookOverlayOp("h", 4, "bold_impact", { yPct: 250 });
    if (over.op !== "text_overlay") throw new Error("expected text_overlay");
    expect(over.yPct).toBe(100);
    const nan = hookOverlayOp("h", 4, "bold_impact", { yPct: Number.NaN });
    if (nan.op !== "text_overlay") throw new Error("expected text_overlay");
    expect(nan.yPct).toBeUndefined();
  });

  it("custom fontSize overrides the (bigger) template default", () => {
    const op = hookOverlayOp("hello", 4, "bold_impact", { fontSize: 92 });
    if (op.op !== "text_overlay") throw new Error("expected text_overlay");
    expect(op.style.fontSize).toBe(92);
  });
});

describe("resolveHookBurnPayload honors the saved style overrides", () => {
  it("style.fontSize + style.yPct override the design's defaults in the payload", async () => {
    const { resolveHookBurnPayload } = await import("./hookDesigns");
    const p = resolveHookBurnPayload(
      { source: "auto", templateId: "bold_impact", style: { fontSize: 92, yPct: 62 } },
      "watch this",
    );
    expect(p?.fontSize).toBe(92);
    expect(p?.yPct).toBe(62);
  });
  it("no style → the design's (bigger) default size, no yPct", async () => {
    const { resolveHookBurnPayload, HOOK_DESIGN_BY_ID } = await import("./hookDesigns");
    const p = resolveHookBurnPayload({ source: "auto", templateId: "bold_impact" }, "watch this");
    expect(p?.fontSize).toBe(HOOK_DESIGN_BY_ID["bold_impact"].render.fontSize);
    expect(p?.yPct).toBeUndefined();
  });
});

describe("bigger hook defaults", () => {
  it("every template renders at ≥64px on the 1080x1920 canvas", () => {
    for (const d of HOOK_DESIGNS) expect(d.render.fontSize).toBeGreaterThanOrEqual(64);
  });
});

describe("redesign: fonts, animations, migration", () => {
  it("has 8 aesthetic templates, each with a bundled font token, an animation + a theme", async () => {
    const { HOOK_FONT_FAMILY } = await import("@/lib/server/hookFonts");
    expect(HOOK_DESIGNS).toHaveLength(13);
    for (const d of HOOK_DESIGNS) {
      expect(Object.keys(HOOK_FONT_FAMILY)).toContain(d.render.font);
      expect(d.render.animation).toBeTruthy();
      expect(typeof d.theme).toBe("string");
      expect(d.theme.length).toBeGreaterThan(0);
    }
  });

  it("migrates legacy ids to a valid current id", async () => {
    const { migrateHookTemplateId } = await import("./hookDesigns");
    expect(HOOK_DESIGNS.some((d) => d.id === migrateHookTemplateId("bold_white"))).toBe(true);
    expect(HOOK_DESIGNS.some((d) => d.id === migrateHookTemplateId("mint"))).toBe(true);
    expect(HOOK_DESIGNS.some((d) => d.id === migrateHookTemplateId(undefined))).toBe(true);
    expect(migrateHookTemplateId("bold_impact")).toBe("bold_impact");
  });

  it("resolveHookRender applies custom font/animation over the template", () => {
    const r = resolveHookRender("bold_impact", { font: "poppins", animation: "fade" });
    expect(r.font).toBe("poppins");
    expect(r.animation).toBe("fade");
  });
});

describe("hookFxLayout (animated entrance templates)", () => {
  it("poster sets keywords big in the palette and connectors small in serif, grouped like set type", async () => {
    const { hookFxLayout } = await import("./hookDesigns");
    const g = hookFxLayout({ text: "Do what you love and the rest will come", kind: "poster", fontSize: 230, font: "montserratblack", fontColor: "#FFFFFF", accentColor: "#E0409B", boxColor: "#F2C94C", position: "center", width: 1080, height: 1920 })!;
    expect(g.lines.map((l) => l.tokens.map((t) => t.text).join(" "))).toEqual(["do", "what you", "love", "and the rest will", "come"]);
    const love = g.lines[2].tokens[0];
    expect(love.color).toBe("#E0409B");
    expect(g.lines[1].tokens[0]).toMatchObject({ small: true, font: "dmserif" });
  });

  it("banner bar is flush with its screen edge and balances its lines", async () => {
    const { hookFxLayout } = await import("./hookDesigns");
    const L = hookFxLayout({ text: "THIS CHANGED EVERYTHING FOR ME", kind: "banner-left", fontSize: 96, font: "barlowcondensed", fontColor: "#fff", boxColor: "#E0262B", position: "top", width: 1080, height: 1920 })!;
    expect(L.bar!.x).toBe(0);
    expect(L.lines.at(-1)!.tokens[0].text).not.toBe("ME");
    const R = hookFxLayout({ text: "NOBODY TALKS ABOUT THIS", kind: "banner-right", fontSize: 92, font: "anton", fontColor: "#000", boxColor: "#FFD60A", position: "center", width: 1080, height: 1920 })!;
    expect(R.bar!.x + R.bar!.w).toBe(1080);
  });

  it("cinematic gradient darkens toward the nearest frame edge", async () => {
    const { hookFxLayout } = await import("./hookDesigns");
    const low = hookFxLayout({ text: "The moment he realized", kind: "cinematic", fontSize: 84, font: "montserratblack", fontColor: "#fff", position: "bottom", width: 1080, height: 1920 })!;
    expect(low.gradient!.dark).toBe("bottom");
    expect(low.gradient!.y + low.gradient!.h).toBe(1920);
    const high = hookFxLayout({ text: "The moment he realized", kind: "cinematic", fontSize: 84, font: "montserratblack", fontColor: "#fff", position: "top", width: 1080, height: 1920 })!;
    expect(high.gradient!.dark).toBe("top");
  });
});
