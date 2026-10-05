import { describe, it, expect } from "vitest";
import { buildClipGraph, sanitizeText, wrapDrawtext } from "./clipFilterGraph";
import type { EditOp } from "./clipEditOps";
import { hookBlockLayout } from "@/lib/builder/hookDesigns";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const reframe: EditOp = { op: "reframe", mode: "crop" };
const subtitles: EditOp = { op: "subtitles", style: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" } };
const base = { startSeconds: 10, endSeconds: 30 };

describe("buildClipGraph — simple (-vf) path", () => {
  it("uses -vf with crop-to-fill 9:16 when no extra-input ops are present", () => {
    const g = buildClipGraph({ ...base, ops: [reframe] });
    expect(g.usesComplex).toBe(false);
    expect(g.inputArgs).toEqual([]);
    expect(g.filterArgs[0]).toBe("-vf");
    expect(g.filterArgs[1]).toContain("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920");
    expect(g.warnings).toEqual([]);
  });

  it("uses pad for reframe mode=pad", () => {
    const g = buildClipGraph({ ...base, ops: [{ op: "reframe", mode: "pad" }] });
    expect(g.filterArgs[1]).toContain("pad=1080:1920");
  });

  it("burns subtitles from the ASS file path", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, subtitles], assPath: "/tmp/x/subs.ass" });
    expect(g.usesComplex).toBe(false);
    expect(g.filterArgs[1]).toContain("subtitles=/tmp/x/subs.ass");
  });

  it("renders a text_overlay drawtext with a clip-relative enable window", () => {
    const op: EditOp = { op: "text_overlay", text: "POV: you ship", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 56, bold: true } };
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    expect(g.usesComplex).toBe(false);
    expect(g.filterArgs[1]).toContain("drawtext=");
    expect(g.filterArgs[1]).toContain("enable='between(t,0,2)'");
  });

  it("falls back to white for a non-hex fontColor that would break the filtergraph", () => {
    const op: EditOp = { op: "text_overlay", text: "ship it", position: "top", startSec: 0, endSec: 2, style: { fontColor: "rgb(255,215,0)", fontSize: 56, bold: true } };
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    expect(g.filterArgs[1]).toContain("fontcolor=white");
    expect(g.filterArgs[1]).not.toContain("rgb(");
  });

  it("passes a whitelisted named fontColor through, and expands 3-digit hex", () => {
    const gold: EditOp = { op: "text_overlay", text: "gold", position: "top", startSec: 0, endSec: 2, style: { fontColor: "gold", fontSize: 56, bold: true } };
    expect(buildClipGraph({ ...base, ops: [reframe, gold] }).filterArgs[1]).toContain("fontcolor=gold");
    const short: EditOp = { op: "text_overlay", text: "short", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#abc", fontSize: 56, bold: true } };
    expect(buildClipGraph({ ...base, ops: [reframe, short] }).filterArgs[1]).toContain("fontcolor=#aabbcc");
  });

  it("anchors a top overlay in the upper third, not jammed at the top edge", () => {
    const op: EditOp = { op: "text_overlay", text: "big hook here", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 56, bold: true } };
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    // The single top overlay (stacker slot 0) sits at the top band's base y — which
    // must be ~30% down (inside the upper third, clear of the phone UI + readable),
    // not the 8% top edge or the old cramped 16%.
    expect(g.filterArgs[1]).toContain("y=h*0.30");
    expect(g.filterArgs[1]).not.toContain("y=h*0.08");
  });

  it("centers a dragged yPct overlay on that spot (Editor preview parity), clamped on-frame", () => {
    const op: EditOp = { op: "text_overlay", text: "dragged hook", position: "top", yPct: 40, startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 56, bold: true } };
    const f = buildClipGraph({ ...base, ops: [reframe, op] }).filterArgs[1];
    expect(f).toContain("y='max(0,min(h-text_h,h*0.4-text_h/2))'");
    expect(f).not.toContain("y=h*0.30");
  });
});

describe("buildClipGraph — Smart Framing (face_reframe modes)", () => {
  const face: EditOp = { op: "face_reframe" };
  const faceMode = (mode: "auto" | "pan" | "zoom" | "full"): EditOp => ({ op: "face_reframe", mode });

  it("auto with multi-subject bounds: fits the bbox or falls back to the primary face (if(lte ...))", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, faceMode("auto")], faceCx: 0.3, faceCy: 0.4, faceXMin: 0.25, faceXMax: 0.75 });
    const f = g.filterArgs[1];
    expect(f).toContain("if(lte(");        // fit-test branch
    expect(f).toContain("force_original_aspect_ratio=increase");
  });

  it("pan: emits a TIME-VARYING crop x (sweeps between guests)", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, faceMode("pan")], faceCx: 0.3, faceCy: 0.4, faceXMin: 0.25, faceXMax: 0.75 });
    const f = g.filterArgs[1];
    expect(f).toMatch(/min\(t\\?,/);       // x depends on t
    expect(f).toContain("crop=1080:1920");
  });

  it("zoom: tighter crop then scales back to the canvas", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, faceMode("zoom")], faceCx: 0.3, faceCy: 0.4 });
    const f = g.filterArgs[1];
    expect(f).toMatch(/crop=\d+:\d+:/);    // a sub-canvas crop window
    expect(f).toContain(",scale=1080:1920"); // scaled back up after the tight crop
  });

  it("full: letterboxes the whole shot (pad, no crop)", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, faceMode("full")] });
    const f = g.filterArgs[1];
    expect(f).toContain("pad=1080:1920");
    expect(f).not.toContain("crop=1080:1920:");
  });

  it("auto→fit fallback: graph-level framingMode='full' letterboxes even when the op carries NO mode + a face was found", () => {
    // This is the path clipRender takes when face-detect returns recommendFit in AUTO:
    // it passes framingMode='full' (and mirrors it onto the op). Letterbox the whole
    // scene rather than tight-crop the (unlocalizable) speaker / dead-center table.
    const g = buildClipGraph({ ...base, ops: [reframe, { op: "face_reframe" }], framingMode: "full", faceCx: 0.5, faceCy: 0.4 });
    const f = g.filterArgs[1];
    expect(f).toContain("pad=1080:1920");
    expect(f).not.toContain("crop=1080:1920:");
  });

  it("backward compat: face_reframe with no mode + no bounds → single-point crop", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, face], faceCx: 0.7, faceCy: 0.45 });
    const f = g.filterArgs[1];
    expect(f).toContain("crop=1080:1920:");
    expect(f).not.toContain("if(lte(");    // no bbox logic
    expect(f).not.toMatch(/min\(t\\?,/);   // not a pan
  });
});

describe("buildClipGraph — logo_overlay", () => {
  const logo: EditOp = { op: "logo_overlay", imageUrl: "https://x/logo.png", corner: "br", opacity: 0.85 };

  it("escalates to filter_complex, adds the logo input, applies opacity + corner", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, logo], logoPaths: ["/tmp/x/logo0.png"] });
    expect(g.usesComplex).toBe(true);
    expect(g.inputArgs).toEqual(["-i", "/tmp/x/logo0.png"]);
    expect(g.filterArgs[0]).toBe("-filter_complex");
    const graph = g.filterArgs[1];
    expect(graph).toContain("colorchannelmixer=aa=0.85");
    expect(graph).toContain("overlay=");
    expect(graph).toContain("[vout]");
    // bottom-right anchors against W-w / H-h
    expect(graph).toMatch(/overlay=W-w-\d+:H-h-\d+/);
    // maps the source audio through
    expect(g.filterArgs).toContain("-map");
    expect(g.filterArgs).toContain("0:a?");
  });

  it("drops a logo op (with warning) when its file path is missing, falling back to -vf", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, logo], logoPaths: [] });
    expect(g.usesComplex).toBe(false);
    expect(g.warnings.some((w) => w.includes("logo_overlay"))).toBe(true);
  });
});

describe("buildClipGraph — image_overlay", () => {
  const overlay: EditOp = { op: "image_overlay", imageUrl: "https://x/watermark.png", position: "top", opacity: 0.6 };

  it("escalates to filter_complex, adds the image input, applies opacity + position", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, overlay], imagePaths: ["/tmp/x/overlay0.png"] });
    expect(g.usesComplex).toBe(true);
    expect(g.inputArgs).toEqual(["-i", "/tmp/x/overlay0.png"]);
    expect(g.filterArgs[0]).toBe("-filter_complex");
    const graph = g.filterArgs[1];
    expect(graph).toContain("colorchannelmixer=aa=0.6");
    expect(graph).toContain("overlay=");
    expect(graph).toContain("[vout]");
    // top anchors against 40px from the top, horizontally centered
    expect(graph).toMatch(/overlay=\(W-w\)\/2:40/);
    // maps the source audio through
    expect(g.filterArgs).toContain("-map");
    expect(g.filterArgs).toContain("0:a?");
  });

  it("burns bottom / center positions to their anchors", () => {
    const g = buildClipGraph({
      ...base,
      ops: [reframe, { ...overlay, position: "bottom" }, { ...overlay, position: "center", opacity: 1 }],
      imagePaths: ["/tmp/x/a.png", "/tmp/x/b.png"],
    });
    const graph = g.filterArgs[1];
    expect(graph).toMatch(/overlay=\(W-w\)\/2:H-h-40/);
    expect(graph).toMatch(/overlay=\(W-w\)\/2:\(H-h\)\/2/);
  });

  it("drops an image_overlay op (with warning) when its file path is missing, falling back to -vf", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, overlay], imagePaths: [] });
    expect(g.usesComplex).toBe(false);
    expect(g.warnings.some((w) => w.includes("image_overlay"))).toBe(true);
  });

  it("frame mode scales the video down and burns the full-canvas image behind it", () => {
    const frame: EditOp = { op: "image_overlay", imageUrl: "https://x/frame.png", mode: "frame", position: "center", opacity: 0.8, frameScale: 0.85 };
    const g = buildClipGraph({ ...base, ops: [reframe, frame], imagePaths: ["/tmp/x/frame0.png"] });
    expect(g.usesComplex).toBe(true);
    expect(g.inputArgs).toEqual(["-i", "/tmp/x/frame0.png"]);
    const graph = g.filterArgs[1];
    // image fills the canvas (cover-crop) with the frame opacity
    expect(graph).toContain("force_original_aspect_ratio=increase");
    expect(graph).toContain(`colorchannelmixer=aa=0.8`);
    // video box is 85% of the canvas, centered over the image
    expect(graph).toContain("scale=918:1632");
    expect(graph).toContain("overlay=(W-w)/2:(H-h)/2");
  });

  it("frame mode honors a custom video-box size via frameScale", () => {
    const frame: EditOp = { op: "image_overlay", imageUrl: "https://x/frame.png", mode: "frame", position: "center", opacity: 1, frameScale: 0.7 };
    const g = buildClipGraph({ ...base, ops: [reframe, frame], imagePaths: ["/tmp/x/frame0.png"] });
    const graph = g.filterArgs[1];
    expect(graph).toContain("scale=756:1344");
  });
});

describe("buildClipGraph — title_card (retired)", () => {
  const title: EditOp = { op: "title_card", text: "How I ship fast", durationSec: 2, style: { fontColor: "#fff", fontSize: 64, bold: true } };

  it("drops the opening slate: no lavfi card, no concat — the clip starts on its first frame", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, title] });
    expect(g.inputArgs.join(" ")).not.toContain("lavfi");
    expect((g.filterArgs[1] ?? "")).not.toContain("concat=");
    expect(g.warnings.some((w) => w.includes("title_card"))).toBe(true);
  });
});

describe("buildClipGraph — editorial hook motion", () => {
  const motion = { entrance: "wipe" as const, shine: { color: "#FFFFFF", alpha: 0.22, periodSec: 3.2 } };
  const hook = (endSec: number): EditOp => ({
    op: "text_overlay", text: "The story behind this", position: "top", startSec: 0, endSec,
    style: { fontColor: "#FFFFFF", fontSize: 100, bold: false, bgColor: "#191919", hookLayout: "pov", hookMotion: motion },
  });

  it("wipes the boxes in, sweeps a repeating shine, and fades the text", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, hook(5)] });
    const f = g.filterArgs.join(" ");
    // wipe: a box enabled only for the first slice of the entrance
    expect(f).toContain("enable='between(t,0,0.05)'");
    // shine: a libass diagonal streak (moving, clipped to the box, blurred),
    // drawn between the boxes and the text, repeating every period
    expect(f).toMatch(/subtitles=hookfx\d+\.ass/);
    const ass = g.textFiles.find((t) => t.name.endsWith(".ass"))!.content;
    expect(ass).toContain("Dialogue: 3,0:00:00.60,");
    expect(ass).toContain("Dialogue: 3,0:00:03.80,");
    expect(ass).toMatch(/\\move\(0,0,\d+,0,0,850\)\\clip\(/);
    expect(ass).toContain("\\blur");
    expect(f.indexOf("subtitles=hookfx")).toBeLessThan(f.indexOf("drawtext"));
    // text: time-aware alpha (fade in + fade out at endSec)
    expect(f).toMatch(/alpha='min\(min\(1,max\(0,\(t-/);
  });

  it("Always on (endSec past the clip) keeps the hook + shine enabled to the end", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, hook(3600)] });
    const f = g.filterArgs.join(" ");
    expect(f).toContain("between(t,0,3600)");
    expect(f).not.toContain("between(t,0,5)");
  });

  it("without motion renders the same static boxes as before (no shine)", () => {
    const plain: EditOp = { ...hook(5), style: { ...(hook(5) as Extract<EditOp, { op: "text_overlay" }>).style, hookMotion: undefined } } as EditOp;
    const g = buildClipGraph({ ...base, ops: [reframe, plain] });
    expect(g.filterArgs.join(" ")).not.toContain("hookfx");
  });

  it("fx templates (banner / cinematic / poster) render entirely through one libass script", () => {
    for (const [layout, font] of [["banner-left", "barlowcondensed"], ["banner-right", "anton"], ["cinematic", "montserratblack"], ["poster", "montserratblack"]] as const) {
      const h = hook(5) as Extract<EditOp, { op: "text_overlay" }>;
      const op = { ...h, text: "Do what you love and the rest will come", style: { ...h.style, hookLayout: layout, font } } as EditOp;
      const g = buildClipGraph({ ...base, ops: [reframe, op] });
      const f = g.filterArgs.join(" ");
      expect(f).toMatch(/subtitles=hookfx\d+\.ass/);
      expect(f).not.toContain("drawbox");
      const ass = g.textFiles.find((t) => t.name.endsWith(".ass"))!.content;
      expect(ass).toContain("PlayResX: 1080");
      expect(ass).toMatch(/\\fn(Barlow Condensed|Anton|Montserrat Black)\\fs\d+/);
      if (layout === "poster") expect(ass).toContain("\\fnDM Serif Display");
    }
  });
});

describe("buildClipGraph — emphasis zoom_punch / freeze", () => {
  it("zoom_punch uses an inline per-frame scale pulse (eased sin ramp at atSec) + a recrop to the canvas", () => {
    const op: EditOp = { op: "emphasis", kind: "zoom_punch", atSec: 4, amount: 1.3 };
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    expect(g.usesComplex).toBe(true);
    const graph = g.filterArgs[1];
    // the scale factor is a continuous raised-cosine pulse of t, anchored at atSec=4
    expect(graph).toContain("scale=w='iw*(1+(1.300-1)*sin(PI*clip((t-4.000)/0.6\\,0\\,1)))'");
    expect(graph).toContain(":eval=frame");
    // recropped back to the canvas, centered (no face supplied)
    expect(graph).toContain("crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2");
    // the old hard swap (split + time-windowed static overlay) is gone
    expect(graph).not.toContain("split");
    expect(graph).not.toContain("enable='between(t,4,");
  });

  it("zoom_punch with a detected face anchors on the ALREADY-reframed position, not the raw source fraction", () => {
    // Regression: the reframe op (always first) already crops the source into
    // this canvas USING faceCx/faceCy, landing the face at horizontal-center +
    // faceBiasTop from the top. The zoom_punch crop used to re-apply the SAME
    // raw faceCx/faceCy against this already-cropped, already-rescaled frame —
    // a coordinate-space bug that clamped the punch to a frame edge for any
    // off-center source face instead of tracking it ("zoom punch selected but
    // face isn't followed"). It must now punch toward center-x / faceBiasTop-y
    // — the face's CURRENT position — never the raw off-center faceCx (0.85 here).
    const op: EditOp = { op: "emphasis", kind: "zoom_punch", atSec: 4, amount: 1.3 };
    const g = buildClipGraph({ ...base, ops: [reframe, op], faceCx: 0.85, faceCy: 0.6, faceBiasTop: 0.38 });
    const graph = g.filterArgs[1];
    // Isolate the zoom_punch segment (the second crop, after the eval=frame
    // scale pulse) from the reframe segment before it — the reframe segment
    // LEGITIMATELY contains the raw 0.8500*in_w/0.6000*in_h (that's its job);
    // the assertion is about the punch's OWN crop, not the whole graph.
    const punchSegment = graph.split("eval=frame,")[1];
    // horizontal: always plain-centered post-reframe (never the raw 0.85)
    expect(punchSegment).toContain("crop=1080:1920:(in_w-1080)/2:");
    expect(punchSegment).not.toContain("0.8500*in_w");
    // vertical: biased to faceBiasTop (0.38), not the raw faceCy (0.6) and not 0.5
    expect(punchSegment).toContain("0.3800*in_h-960");
    expect(punchSegment).not.toContain("0.6000*in_h");
  });

  it("zoom_punch with a face but no bias (b-roll subject, faceBiasTop 0.5) stays plain-centered", () => {
    const op: EditOp = { op: "emphasis", kind: "zoom_punch", atSec: 4, amount: 1.3 };
    const g = buildClipGraph({ ...base, ops: [reframe, op], faceCx: 0.2, faceCy: 0.2, faceBiasTop: 0.5 });
    const graph = g.filterArgs[1];
    expect(graph).toContain("crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2");
  });

  it("freeze holds a frame via a time-windowed overlay", () => {
    const op: EditOp = { op: "emphasis", kind: "freeze", atSec: 6, amount: 0.6 };
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    expect(g.usesComplex).toBe(true);
    const graph = g.filterArgs[1];
    expect(graph).toContain("overlay=");
    expect(graph).toContain("enable='between(t,6,");
  });
});

describe("buildClipGraph — blur_frame (Zoom Punch full-person frame)", () => {
  it("static: blurred cover background + fully-contained foreground, centered, no time window", () => {
    const op: EditOp = { op: "blur_frame", style: "static" };
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    expect(g.usesComplex).toBe(true); // blur_frame forces the composite path
    const graph = g.filterArgs[1];
    expect(graph).toContain("split=2");
    expect(graph).toContain("gblur=sigma=");                                   // frosted-glass background
    expect(graph).toContain("force_original_aspect_ratio=increase");           // bg covers
    expect(graph).toContain("force_original_aspect_ratio=decrease");           // fg CONTAINS the whole person (never crops)
    expect(graph).toContain("overlay=");                                       // fg composited over bg
    expect(graph).not.toContain("zoompan");                                    // static → no motion
  });

  it("zoom_out: adds a zoompan reveal on the composite", () => {
    const op: EditOp = { op: "blur_frame", style: "zoom_out" };
    const g = buildClipGraph({ ...base, ops: [reframe, op] });
    const graph = g.filterArgs[1];
    expect(graph).toContain("gblur=sigma=");
    expect(graph).toContain("zoompan=");
  });

  it("smart-framing no-face fit: face_reframe + blur_frame → blurred-bg fit, NOT black bars", () => {
    // The no-face fallback (clipRender) appends blur_frame; buildClipGraph lets it
    // replace the crop reframe, so the podcast shot fits over a blurred background
    // instead of the old `pad=…:black` letterbox.
    const g = buildClipGraph({
      ...base,
      ops: [reframe, { op: "face_reframe", mode: "full" } as EditOp, { op: "blur_frame", style: "static" } as EditOp],
      framingMode: "full",
    });
    const graph = g.filterArgs[1];
    expect(graph).toContain("gblur=sigma=");                          // blurred background fill
    expect(graph).toContain("force_original_aspect_ratio=decrease");  // whole frame contained
    expect(graph).not.toContain(":black");                           // NOT a black letterbox
  });
});

describe("buildClipGraph — color_filter (Video Filters)", () => {
  it("applies a preset color chain on the simple (-vf) path", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, { op: "color_filter", preset: "vintage" }] });
    expect(g.usesComplex).toBe(false);
    expect(g.filterArgs[1]).toContain("curves=preset=vintage");
  });

  it("applies saturation/brightness via eq", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, { op: "color_filter", saturation: 1.4, brightness: 0.1 }] });
    expect(g.filterArgs[1]).toContain("eq=saturation=1.40:brightness=0.10");
  });

  it("color grade runs BEFORE the caption burn (after reframe)", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, { op: "color_filter", preset: "bw" }, subtitles], assPath: "/tmp/x/subs.ass" });
    const graph = g.filterArgs[1];
    expect(graph.indexOf("hue=s=0")).toBeLessThan(graph.indexOf("subtitles="));
  });
});

describe("buildClipGraph — composite_bg (Brain Rot)", () => {
  it("vstack: adds the bg VIDEO input, fills the FULL canvas with it, and contain-fits the clip into the top half box, ending at [vout]", () => {
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" };
    const g = buildClipGraph({ ...base, ops: [reframe, op], bgPaths: ["/tmp/x/bg0.mp4"] });
    expect(g.usesComplex).toBe(true);
    // bg is looped (-stream_loop -1) so it's never shorter than the clip; the
    // overlay shortest=1 below cuts the output to the clip length.
    expect(g.inputArgs).toEqual(["-stream_loop", "-1", "-i", "/tmp/x/bg0.mp4"]);
    expect(g.filterArgs[0]).toBe("-filter_complex");
    const graph = g.filterArgs[1];
    // the 2nd video input (fps-normalized) cover-fills the WHOLE canvas
    expect(graph).toContain("[1:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920");
    // the clip is contain-fit (never cropped) into its half-height box (1920/2 = 960)
    expect(graph).toContain("scale=1080:960:force_original_aspect_ratio=decrease:force_divisible_by=2");
    // the clip pane is overlaid on the fullscreen bg, centered in the top box
    expect(graph).toContain("overlay=x=0+(1080-overlay_w)/2:y=0+(960-overlay_h)/2:shortest=1:eof_action=pass");
    expect(graph.trimEnd().endsWith("[vout]")).toBe(true);
    // audio passes through unchanged (no overlay) — mapped via 0:a?
    expect(g.filterArgs).toContain("0:a?");
  });

  it("a bg start offset is NOT input-seeked (-ss + -stream_loop -1 corrupts looped PTS → dup explosion)", () => {
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" };
    // Even with a non-zero offset, the bg input is ONLY looped — no -ss. Seeking a
    // -stream_loop -1 input desyncs its PTS and vstack framesync runaway-dups frames.
    const g = buildClipGraph({ ...base, ops: [reframe, op], bgPaths: ["/tmp/x/bg0.mp4"], bgStartOffsets: [42] });
    expect(g.inputArgs).toEqual(["-stream_loop", "-1", "-i", "/tmp/x/bg0.mp4"]);
  });
  it("bgStartOffsets 0 (or absent) → looped, no -ss", () => {
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" };
    const g = buildClipGraph({ ...base, ops: [reframe, op], bgPaths: ["/tmp/x/bg0.mp4"], bgStartOffsets: [0] });
    expect(g.inputArgs).toEqual(["-stream_loop", "-1", "-i", "/tmp/x/bg0.mp4"]);
  });

  it("hstack: contain-fits the clip into a half-WIDTH box over the fullscreen bg", () => {
    const op: EditOp = { op: "composite_bg", layout: "hstack", bgUrl: "https://cdn/x.mp4", clipPos: "left" };
    const g = buildClipGraph({ ...base, ops: [reframe, op], bgPaths: ["/tmp/x/bg0.mp4"] });
    const graph = g.filterArgs[1];
    // clip box: half width (1080/2 = 540), full height — contain-fit, never cropped
    expect(graph).toContain("scale=540:1920:force_original_aspect_ratio=decrease:force_divisible_by=2");
    // centered in the LEFT box (x offset 0)
    expect(graph).toContain("overlay=x=0+(540-overlay_w)/2:y=0+(1920-overlay_h)/2");
  });

  it("clipPos=bottom moves the clip box to the BOTTOM half (bg still fills the whole canvas)", () => {
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "bottom" };
    const g = buildClipGraph({ ...base, ops: [reframe, op], bgPaths: ["/tmp/x/bg0.mp4"] });
    const graph = g.filterArgs[1];
    // the clip pane is overlaid with the box origin at y=960 (the bottom half)
    expect(graph).toContain("overlay=x=0+(1080-overlay_w)/2:y=960+(960-overlay_h)/2");
  });

  it("drops the composite (with warning) and falls back to -vf when the bg file is missing", () => {
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4" };
    const g = buildClipGraph({ ...base, ops: [reframe, op], bgPaths: [] });
    expect(g.usesComplex).toBe(false);
    expect(g.warnings.some((w) => w.includes("composite_bg"))).toBe(true);
  });

  it("vstack: the source REFRAME crop tracks faceCy (face-aware, not dead-center)", () => {
    // Face-awareness moved out of the (now contain-fit, never-cropped) clip pane and
    // into the initial reframe crop of the source; faceCy only engages alongside faceCx.
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" };
    const g = buildClipGraph({ ...base, ops: [reframe, op], bgPaths: ["/tmp/x/bg0.mp4"], faceCx: 0.5, faceCy: 0.7 });
    const graph = g.filterArgs[1];
    // reframe crop y follows the face (0.7*in_h - bias 960), clamped — not centered
    expect(graph).toContain("crop=1080:1920:min(max(0.5000*in_w-540\\,0)\\,in_w-1080):min(max(0.7000*in_h-960\\,0)\\,in_h-1920)");
  });

  it("hstack: the source REFRAME crop tracks faceCx", () => {
    const op: EditOp = { op: "composite_bg", layout: "hstack", bgUrl: "https://cdn/x.mp4", clipPos: "left" };
    const g = buildClipGraph({ ...base, ops: [reframe, op], bgPaths: ["/tmp/x/bg0.mp4"], faceCx: 0.7 });
    const graph = g.filterArgs[1];
    // reframe crop x follows the face (0.7*in_w - 540), clamped into the frame
    expect(graph).toContain("crop=1080:1920:min(max(0.7000*in_w-540\\,0)\\,in_w-1080):0");
  });

  it("no face → source reframe crop stays centered and the clip pane is centered in its box (backward-compatible)", () => {
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" };
    const g = buildClipGraph({ ...base, ops: [reframe, op], bgPaths: ["/tmp/x/bg0.mp4"] });
    const graph = g.filterArgs[1];
    // centered reframe crop (no face offsets)
    expect(graph).toContain("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1");
    // clip pane centered inside the top box via overlay's own w/h vars
    expect(graph).toContain("overlay=x=0+(1080-overlay_w)/2:y=0+(960-overlay_h)/2");
  });

  it("subtitles burn on the CLIP pane (before the composite), not the full frame", () => {
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" };
    const g = buildClipGraph({ ...base, ops: [reframe, subtitles, op], bgPaths: ["/tmp/x/bg0.mp4"], assPath: "/tmp/x/subs.ass" });
    const graph = g.filterArgs[1];
    expect(graph).toContain("subtitles=/tmp/x/subs.ass");
    // caption is applied BEFORE the composite overlay (so it rides the clip pane,
    // not the fullscreen gameplay bg)
    expect(graph.indexOf("subtitles=")).toBeLessThan(graph.indexOf("overlay=x="));
    // the subtitled stream is what gets contain-fit (with a CFR fps normalization
    // baked into the same pane chain) and overlaid as the FOREGROUND operand:
    // subtitles→[subOut]; [subOut]scale=…box…,…,fps=fps=N→[pane]; [bg][pane]overlay.
    const subOut = graph.match(/subtitles=[^\[]+\[(v\d+)\]/)?.[1];
    expect(subOut).toBeTruthy();
    const pane = graph.match(new RegExp(`\\[${subOut}\\]scale=1080:960:[^\\[]*fps=fps=\\d+\\[(v\\d+)\\]`))?.[1];
    expect(pane, "subtitled clip pane should be contain-fit + fps-normalized before the composite").toBeTruthy();
    const m = graph.match(/\[(v\d+)\]\[(v\d+)\]overlay=x=/);
    expect(m?.[2]).toBe(pane);
  });

  it("text_overlay burns on the CLIP pane (before the composite)", () => {
    const ov: EditOp = { op: "text_overlay", text: "HOOK", position: "center", startSec: 0, endSec: 2, style: { fontColor: "#ffffff", fontSize: 60, bold: true } };
    const op: EditOp = { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" };
    const g = buildClipGraph({ ...base, ops: [reframe, ov, op], bgPaths: ["/tmp/x/bg0.mp4"] });
    const graph = g.filterArgs[1];
    expect(graph).toContain("drawtext=");
    expect(graph.indexOf("drawtext=")).toBeLessThan(graph.indexOf("overlay=x="));
  });
});

describe("buildClipGraph — audio_overlay (Meme Audio)", () => {
  it("adds the audio input, delays + gains it, amixes with the source into [aout]", () => {
    const op: EditOp = { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: 2, gainDb: -3 };
    const g = buildClipGraph({ ...base, ops: [reframe, op], audioPaths: ["/tmp/x/audio0"] });
    expect(g.usesComplex).toBe(true);
    expect(g.inputArgs).toEqual(["-i", "/tmp/x/audio0"]);
    const graph = g.filterArgs[1];
    // delayed to 2000ms on both channels
    expect(graph).toContain("adelay=2000|2000");
    // gain in dB
    expect(graph).toContain("volume=-3.00dB");
    // mixed and labelled [aout]
    expect(graph).toContain("amix=inputs=2");
    expect(graph).toContain("[aout]");
    // the video chain still ends at [vout]; the audio map is [aout]
    expect(graph).toContain("[vout]");
    expect(g.filterArgs).toContain("[aout]");
    expect(g.filterArgs).not.toContain("0:a?");
  });

  it("respects durationSec via an atrim before the delay", () => {
    const op: EditOp = { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: 1, gainDb: 0, durationSec: 3 };
    const g = buildClipGraph({ ...base, ops: [reframe, op], audioPaths: ["/tmp/x/audio0"] });
    expect(g.filterArgs[1]).toContain("atrim=0:3.000");
  });

  it("mixes onto generated silence when the source has NO audio stream", () => {
    const op: EditOp = { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: 1 };
    const g = buildClipGraph({ ...base, ops: [reframe, op], audioPaths: ["/tmp/x/audio0"], hasAudio: false });
    // The silence is a generated lavfi INPUT (in inputArgs), referenced as a
    // labelled stream inside the graph — not a literal "anullsrc" in the graph.
    expect(g.inputArgs.join(" ")).toContain("anullsrc");
    const graph = g.filterArgs[1];
    expect(graph).toContain("amix=inputs=2");
    expect(graph).toContain("[aout]");
    // never selects the maybe-absent source audio stream
    expect(graph).not.toContain("[0:a]");
  });

  it("a stray (retired) title_card doesn't disturb the overlay mix — no slate concat", () => {
    const title: EditOp = { op: "title_card", text: "Hook", durationSec: 1.5, style: { fontColor: "#fff", fontSize: 64, bold: true } };
    const audio: EditOp = { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: 0.5, gainDb: -2 };
    const g = buildClipGraph({ ...base, ops: [reframe, title, audio], audioPaths: ["/tmp/x/audio0"] });
    const graph = g.filterArgs[1];
    expect(graph).not.toContain("concat=");
    expect(graph).toContain("amix=inputs=2");
    expect(graph).toContain("[aout]");
    expect(g.filterArgs).toContain("[aout]");
  });

  it("drops the overlay (with warning) when the audio file is missing", () => {
    const op: EditOp = { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: 1 };
    const g = buildClipGraph({ ...base, ops: [reframe, op], audioPaths: [] });
    expect(g.usesComplex).toBe(false);
    expect(g.warnings.some((w) => w.includes("audio_overlay"))).toBe(true);
  });
});

// ── Regression tests for the 2026-06-29 clipping bug-hunt (clippingbughunt1.md) ──
describe("buildClipGraph — bug-hunt regressions", () => {
  it("[#13] full/pad letterbox fits-then-pads (force_original_aspect_ratio=decrease) so a taller-than-canvas source can't crash pad", () => {
    const g = buildClipGraph({ ...base, ops: [reframe, { op: "face_reframe", mode: "full" }] });
    const f = g.filterArgs[1];
    expect(f).toContain("scale=1080:1920:force_original_aspect_ratio=decrease");
    expect(f).toContain("pad=1080:1920");
    expect(f).not.toContain("scale=1080:-2,pad"); // the old width-only scale that overflowed the height
  });

  it("[#2/#7] composite_bg with a FAILED bg fetch + another complex op still burns captions + overlays full-frame (no silent drop)", () => {
    const ops: EditOp[] = [
      reframe,
      subtitles,
      { op: "text_overlay", text: "WAIT FOR IT", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 56, bold: true } },
      { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" },
      { op: "emphasis", kind: "zoom_punch", atSec: 1, amount: 1.2 },
    ];
    // bgPaths:[undefined] = the gameplay fetch FAILED; the zoom punch still forces complex.
    const g = buildClipGraph({ ...base, ops, assPath: "subs.ass", bgPaths: [undefined] });
    expect(g.usesComplex).toBe(true);
    const graph = g.filterArgs[1];
    expect(graph).toContain("subtitles=subs.ass"); // caption NOT dropped
    expect(graph).toContain("drawtext=");          // hook overlay NOT dropped
    expect(graph).not.toContain("vstack");         // composite correctly skipped (no bg file)
  });

  it("[#11] composite on a 4:5 (1080x1350) canvas: panes sum to EXACTLY the canvas", () => {
    const ops: EditOp[] = [
      reframe,
      { op: "composite_bg", layout: "vstack", bgUrl: "https://cdn/x.mp4", clipPos: "top" },
    ];
    const g = buildClipGraph({ ...base, ops, bgPaths: ["/tmp/bg0.mp4"], width: 1080, height: 1350 });
    const graph = g.filterArgs[1];
    // bg fills the FULL 4:5 canvas; the clip contain-fits into an even half-height
    // box (1350/2 = 675 → 674 even) — the composite output is always exactly the canvas.
    expect(graph).toContain("crop=1080:1350"); // fullscreen bg (cover-crop)
    expect(graph).toContain("scale=1080:674:force_original_aspect_ratio=decrease"); // clip box (even half)
  });

  it("[#3] amix sums with normalize=0 (no static post-gain) so the base stays unity after the SFX EOF", () => {
    const op: EditOp = { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: 2, gainDb: -3 };
    const g = buildClipGraph({ ...base, ops: [reframe, op], audioPaths: ["/tmp/x/audio0"] });
    const graph = g.filterArgs[1];
    expect(graph).toContain("amix=inputs=2:duration=first:dropout_transition=0:normalize=0");
    expect(graph).not.toMatch(/amix=[^;]*,volume=\d/); // no static post-amix gain (blew up the base after EOF)
  });

  it("[#8/#12] with the slate retired, the SFX adelay is the clip-relative beat (no slate offset)", () => {
    const title: EditOp = { op: "title_card", text: "Hook", durationSec: 1.5, style: { fontColor: "#fff", fontSize: 64, bold: true } };
    const audio: EditOp = { op: "audio_overlay", audioUrl: "https://cdn/s.mp3", atSec: 1.6, gainDb: -3 };
    const g = buildClipGraph({ ...base, ops: [reframe, title, audio], audioPaths: ["/tmp/x/audio0"] });
    const graph = g.filterArgs[1];
    // The dropped title_card must not shift the SFX: 1.6s → 1600ms.
    expect(graph).toContain("adelay=1600|1600");
    expect(graph).not.toContain("adelay=3100|3100");
  });
});

// ── Fix A: emoji stripping (the "▯ tofu box" bug — drawtext's font has no
// emoji glyphs, so an unstripped emoji renders as an empty box) ──────────────
describe("sanitizeText — emoji stripping", () => {
  it("strips a trailing emoji and the space left behind", () => {
    expect(sanitizeText("YOU KNOW THE TYPE 😂")).toBe("YOU KNOW THE TYPE");
  });

  it("strips a mid-sentence emoji, collapsing the doubled space it leaves", () => {
    expect(sanitizeText("a 🔥 b")).toBe("a b");
  });

  it("leaves a normal ASCII string unchanged", () => {
    expect(sanitizeText("WAIT FOR IT")).toBe("WAIT FOR IT");
  });

  it("still normalizes curly quotes and ellipsis", () => {
    expect(sanitizeText("“It’s wild… right”")).toBe(`"It's wild... right"`);
  });

  it("preserves \\n (the drawtext line breaks wrapDrawtext produces)", () => {
    expect(sanitizeText("line one\nline two")).toBe("line one\nline two");
  });

  it("preserves renderable BMP symbols the render fonts have glyphs for (unlike the old \\p{Extended_Pictographic} strip)", () => {
    const out = sanitizeText("DEAL ✔ I ♥ IT ™");
    expect(out).toContain("✔");
    expect(out).toContain("♥");
    expect(out).toContain("™");
  });

  it("preserves a leading/trailing newline (only SPACES are trimmed, not all whitespace)", () => {
    const out = sanitizeText("\nhi\n");
    expect(out.startsWith("\n")).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
  });
});

// ── Fix B: conservative width estimate (the "clipped on both edges" bug — a
// bold/all-caps overlay line rendered WIDER than the frame) ──────────────────
describe("wrapDrawtext — conservative width estimate", () => {
  it("wraps a long ALL-CAPS hook to <=2 lines, shrinks the font, and keeps every line within the new per-line char budget", () => {
    const result = wrapDrawtext("3M FOLLOWERS BUT NEVER SHOWS UP TO BROKEN EVENTS YOU KNOW THE TYPE", 56, 1080);
    const lines = result.text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(2);
    // Regression guard: the old 0.58 factor under-estimated glyph width enough to
    // let this text fit within the old (looser) per-line budget without shrinking.
    expect(result.fontSize).toBeLessThan(56);
    const budget = Math.floor((1080 - 80) / (0.68 * result.fontSize));
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(budget);
    }
  });

  it("leaves a short hook unwrapped at full size", () => {
    const result = wrapDrawtext("WAIT FOR IT", 56, 1080);
    expect(result.text.split("\n")).toEqual(["WAIT FOR IT"]);
    expect(result.fontSize).toBe(56);
  });
});

describe("buildClipGraph — combined", () => {
  it("composes logo + subtitles + text_overlay + zoom into one coherent complex graph (reframe first, ends at [vout])", () => {
    const ops: EditOp[] = [
      reframe,
      { op: "emphasis", kind: "zoom_punch", atSec: 3 },
      { op: "text_overlay", text: "hook", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 48, bold: true } },
      subtitles,
      { op: "logo_overlay", imageUrl: "https://x/l.png", corner: "tl", opacity: 0.7 },
    ];
    const g = buildClipGraph({ ...base, ops, assPath: "/tmp/x/subs.ass", logoPaths: ["/tmp/x/logo0.png"] });
    expect(g.usesComplex).toBe(true);
    expect(g.warnings).toEqual([]);
    const graph = g.filterArgs[1];
    expect(graph.indexOf("scale=1080:1920:force_original_aspect_ratio=increase")).toBeGreaterThanOrEqual(0);
    expect(graph).toContain("subtitles=/tmp/x/subs.ass");
    expect(graph).toContain("drawtext=");
    expect(graph).toContain("colorchannelmixer=aa=0.7");
    expect(graph.trimEnd().endsWith("[vout]")).toBe(true);
  });
});

describe("buildClipGraph — camera-change dip transitions", () => {
  const reframeOp: EditOp = { op: "reframe", mode: "crop" };

  it("dips to black (fade out→in) at each detected cut, simple path", () => {
    const g = buildClipGraph({ ...base, ops: [reframeOp], cutTimesSec: [2.5, 6.0] });
    const vf = g.filterArgs[1];
    expect(vf).toContain("fade=t=out:st=2.440:d=0.060:color=black");
    expect(vf).toContain("fade=t=in:st=2.500:d=0.060:color=black");
    expect(vf).toContain("fade=t=in:st=6.000:d=0.060:color=black");
  });

  it("no cuts → no fade filters", () => {
    const g = buildClipGraph({ ...base, ops: [reframeOp], cutTimesSec: [] });
    expect(g.filterArgs[1]).not.toContain("color=black");
  });

  it("applies on the final [vout] in the complex path (with captions)", () => {
    // blur_frame forces the complex (filter_complex) path.
    const g = buildClipGraph({ ...base, ops: [reframeOp, { op: "blur_frame", style: "static" } as EditOp], cutTimesSec: [3.0] });
    const graph = g.filterArgs[1];
    expect(g.usesComplex).toBe(true);
    expect(graph).toContain("[vpredip]fade=t=out:st=2.940:d=0.060:color=black,fade=t=in:st=3.000:d=0.060:color=black[vout]");
  });
});

describe("buildClipGraph — face-tracked shots (Editor Camera tool)", () => {
  const base = { startSeconds: 0, endSeconds: 10 };
  const reframe: EditOp = { op: "reframe", mode: "crop" };
  const shots = [
    { startT: 0, endT: 3, cx: 0.83, cy: 0.4, confident: true },
    { startT: 3, endT: 6, cx: 0.5, cy: 0.5, confident: false },
    { startT: 6, endT: 11, cx: 0.36, cy: 0.42, confident: true },
  ];
  it("emits one piecewise crop of t with a hard cut at each shot boundary", () => {
    const g = buildClipGraph({ ...base, ops: [reframe], faceShots: shots, framingMode: "auto", width: 1080, height: 1920 });
    const f = g.filterArgs.join(" ");
    expect(f).toContain("if(lt(t\\,3.0000)\\,0.8300\\,if(lt(t\\,6.0000)\\,0.5000\\,0.3600))");
    expect(f).toContain("crop=1080:1920:");
    // auto's 1.2 target zoom on top of the cover scale
    expect(f).toContain("scale=1296:2304:force_original_aspect_ratio=increase");
  });
  it("smooth camera: a PAN transition emits a smoothstep ease from the previous shot's point", () => {
    const pan = [
      { startT: 0, endT: 3, cx: 0.3, cy: 0.4, confident: true },
      { startT: 3, endT: 8, cx: 0.55, cy: 0.4, confident: true, transition: { kind: "pan" as const, durS: 0.6 } },
    ];
    const g = buildClipGraph({ ...base, ops: [reframe], faceShots: pan, framingMode: "auto", width: 1080, height: 1920 });
    const f = g.filterArgs.join(" ");
    // from 0.3 → own 0.55 over 0.6s starting at t=3, smoothstep u*u*(3-2u)
    expect(f).toContain("if(lt(t\\,3.6000)\\,0.3000+((0.5500)-0.3000)*");
    expect(f).toContain("*(3-2*(");
    expect(f).toContain("(t-3.0000)/0.6000");
  });
  it("smooth camera: a FOLLOW shot emits piecewise-linear keyframes instead of one frozen point", () => {
    const follow = [
      { startT: 0, endT: 4, cx: 0.5, cy: 0.4, confident: true, path: [
        { t: 0.25, cx: 0.45, cy: 0.4 }, { t: 0.75, cx: 0.55, cy: 0.4 }, { t: 1.25, cx: 0.5, cy: 0.4 },
      ] },
    ];
    const g = buildClipGraph({ ...base, ops: [reframe], faceShots: follow, framingMode: "auto", width: 1080, height: 1920 });
    const f = g.filterArgs.join(" ");
    expect(f).toContain("if(lt(t\\,0.2500)\\,0.4500\\,");
    expect(f).toContain("0.4500+(0.1000)*(t-0.2500)/0.5000");
    expect(f).not.toContain("\\,0.5000\\,0.5000)"); // not collapsed to the mean
  });
  it("zoom mode honors shotZoom; full mode ignores shots and letterboxes", () => {
    const g = buildClipGraph({ ...base, ops: [reframe], faceShots: shots, framingMode: "zoom", shotZoom: 1.6, width: 1080, height: 1920 });
    expect(g.filterArgs.join(" ")).toContain("scale=1728:3072:force_original_aspect_ratio=increase");
    expect(g.filterArgs.join(" ")).toContain("overlay=x='");
    const noExtra = buildClipGraph({ ...base, ops: [reframe], faceShots: shots, framingMode: "zoom", shotZoom: 1, width: 1080, height: 1920 });
    expect(noExtra.filterArgs.join(" ")).toContain("scale=1080:1920:force_original_aspect_ratio=increase");
    expect(noExtra.filterArgs.join(" ")).toContain("overlay_w");
    const full = buildClipGraph({ ...base, ops: [{ op: "reframe", mode: "pad" }], faceShots: shots, framingMode: "full", width: 1080, height: 1920 });
    expect(full.filterArgs.join(" ")).toContain("pad=1080:1920");
    expect(full.filterArgs.join(" ")).not.toContain("if(lt(t");
  });

  it("renders an edge-tracked portrait face at minimum tightness with soft fill", () => {
    const g = buildClipGraph({ ...base, ops: [reframe], faceShots: [{ startT: 0, endT: 1, cx: 0.83, cy: 0.4, confident: true }], framingMode: "zoom", shotZoom: 0.9, width: 180, height: 320 });
    const run = spawnSync(ffmpegPath!, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=180x320:r=1:d=1",
      "-vf", `drawbox=x=145:y=100:w=20:h=40:color=red:t=fill,${g.filterArgs[1]}`,
      "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ], { timeout: 15_000 });
    expect(run.status, run.stderr?.toString()).toBe(0);
    const facePixel = (120 * 180 + 90) * 3;
    expect(run.stdout[facePixel]).toBeGreaterThan(150); // red face moved from x≈155 to centre x≈90
    expect(run.stdout[facePixel + 1]).toBeLessThan(70);
  });

  it("renders a no-face interval as the whole source instead of an empty held crop", () => {
    const intervals = [
      { startT: 0, endT: 0.4, cx: 0.83, cy: 0.4, confident: true },
      { startT: 0.4, endT: 1.2, cx: 0.5, cy: 0.5, confident: false },
    ];
    const g = buildClipGraph({ ...base, ops: [reframe], faceShots: intervals, framingMode: "zoom", shotZoom: 1, width: 180, height: 320 });
    const run = spawnSync(ffmpegPath!, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=180x320:rate=5:duration=1",
      ...g.filterArgs, "-frames:v", "5", "-f", "null", "-",
    ], { encoding: "utf8", timeout: 15_000 });
    expect(run.status, run.stderr).toBe(0);
  });

  it("dual mode renders two independently tracked half-height panes over the single-person fallback", () => {
    const top = [{ startT: 0, endT: 6, cx: 0.24, cy: 0.38, confident: true }];
    const bottom = [{ startT: 0, endT: 6, cx: 0.78, cy: 0.41, confident: true }];
    const g = buildClipGraph({
      ...base, ops: [reframe], faceShots: shots, framingMode: "dual",
      dualFaceShots: { top, bottom }, width: 1080, height: 1920,
    });
    const f = g.filterArgs.join(" ");
    expect(g.usesComplex).toBe(true);
    expect(f).toContain("split=3[dual");
    expect(f).toContain("crop=1080:960:");
    expect(f).toContain("vstack=inputs=2");
    expect(f).toContain("enable=between(t\\,0.000\\,6.000)");
  });
});

describe("reframe letterboxes the no-face stretches of a shot timeline", () => {
  it("emits a split + fit branch overlaid only during unconfident shots", () => {
    const shots = [
      { startT: 0, endT: 3, cx: 0.3, cy: 0.4, confident: true },
      { startT: 3, endT: 6, cx: 0.5, cy: 0.5, confident: false },
      { startT: 6, endT: 1e6, cx: 0.7, cy: 0.4, confident: true },
    ];
    const g = buildClipGraph({ ops: [{ op: "reframe", mode: "crop" }], startSeconds: 0, endSeconds: 10, width: 1080, height: 1920, faceShots: shots, framingMode: "auto" });
    const f = g.filterArgs.join(" ");
    expect(f).toContain("split[rf");
    expect(f).toContain("force_original_aspect_ratio=decrease,pad=1080:1920");
    expect(f).toMatch(/overlay=x=0:y=0:eof_action=pass:enable=between\(t\\,3\.000\\,6\.000\)/);
    expect(f).not.toMatch(/between\(t\\,0\.000/); // confident ranges stay cropped
    // all-confident timeline → plain crop chain, no split
    const g2 = buildClipGraph({ ops: [{ op: "reframe", mode: "crop" }], startSeconds: 0, endSeconds: 10, width: 1080, height: 1920, faceShots: [shots[0]], framingMode: "auto" });
    expect(g2.filterArgs.join(" ")).not.toContain("split[rf");
  });
});

describe("hook placement parity — burn uses hookBlockLayout exactly (Editor preview draws the same)", () => {
  const style = { fontColor: "#FFFFFF", fontSize: 100, bold: false, bgColor: "#191919", hookLayout: "pov" as const, font: "barlowcondensed" };
  const layoutFor = (yPct: number, W = 1080, H = 1920) => hookBlockLayout({
    text: "The story behind this", fontSize: 100, layout: "pov", font: "barlowcondensed",
    fontColor: "#FFFFFF", boxColor: "#191919", position: "top", yPct, width: W, height: H,
  })!;

  it("centres the block on the dragged yPct, to the pixel", () => {
    for (const yPct of [20, 37.5, 50, 63.2, 80]) {
      const g = layoutFor(yPct);
      expect(Math.abs(g.top + g.totalH / 2 - 1920 * yPct / 100)).toBeLessThanOrEqual(1);
    }
  });

  it("clamps the block fully on-frame at the edges", () => {
    expect(layoutFor(0).top).toBe(0);
    const g = layoutFor(100);
    expect(g.top + g.totalH).toBe(1920);
  });

  it("the burned drawbox/drawtext coordinates ARE the layout's rects and line ys", () => {
    const op: EditOp = { op: "text_overlay", text: "The story behind this", position: "top", yPct: 63.2, startSec: 0, endSec: 4, style };
    const f = buildClipGraph({ ...base, ops: [reframe, op] }).filterArgs.join(" ");
    const g = layoutFor(63.2);
    for (const l of g.lines) {
      expect(f).toContain(`drawbox=x=${l.box!.x}:y=${l.box!.y}:w=${l.box!.w}:h=${l.box!.h}`);
      expect(f).toContain(`:y=${l.y}:`);
    }
  });

  it("scales uniformly: same yPct → same fractional spot on a 720×1280 canvas", () => {
    const a = layoutFor(63.2);
    const b = layoutFor(63.2, 720, 1280);
    expect(Math.abs((a.top + a.totalH / 2) / 1920 - (b.top + b.totalH / 2) / 1280)).toBeLessThan(0.002);
  });
});
