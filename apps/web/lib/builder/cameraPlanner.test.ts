import { describe, it, expect } from "vitest";
import { planCamera, panProgress, computeFramedGeometry, computeCoverGeometry, computeTrackedFaceGeometry, planFaceCrop, FACE_DEADBAND, MODE_TARGET_ZOOM, type ShotLike as Shot } from "./cameraPlanner";

const W = 1920, H = 1080, PW = 360, PH = 640; // 16:9 source into a 9:16 pane
const shot = (cx: number, cy: number, confident = true, startT = 0, endT = 10): Shot => ({ startT, endT, cx, cy, confident });
const none = shot(0.5, 0.5, false);

describe("planCamera", () => {
  it("nobody found → fit (letterbox) in every single-pane mode", () => {
    for (const m of ["auto", "zoom", "pan"] as const) {
      expect(planCamera(m, 1, none, none, none, W, H, PW, PH).fit).toBe(true);
    }
  });

  it("one face → face crop at the mode's zoom (auto / face crop / pan)", () => {
    const one = shot(0.3, 0.4);
    for (const m of ["auto", "zoom", "pan"] as const) {
      const t = planCamera(m, 1, one, none, none, W, H, PW, PH);
      expect(t.fit).toBe(false);
      expect(t.cx).toBeCloseTo(0.3);
      expect(t.zoom).toBe(MODE_TARGET_ZOOM[m]);
    }
    expect(MODE_TARGET_ZOOM.zoom).toBeGreaterThan(MODE_TARGET_ZOOM.auto); // Face Crop is tighter
  });

  it("face crop ignores the second head — always the primary face", () => {
    const t = planCamera("zoom", 1, shot(0.3, 0.4), shot(0.3, 0.4), shot(0.7, 0.4), W, H, PW, PH);
    expect(t.cx).toBeCloseTo(0.3);
    expect(t.zoom).toBe(MODE_TARGET_ZOOM.zoom);
  });

  it("auto frames BOTH heads when they fit in the pane", () => {
    // pane shows 9/16 ÷ 16/9 ≈ 0.316 of the frame width at 1×; heads 0.1 apart fit
    const t = planCamera("auto", 1, shot(0.45, 0.4), shot(0.45, 0.4), shot(0.55, 0.4), W, H, PW, PH);
    expect(t.fit).toBe(false);
    expect(t.cx).toBeCloseTo(0.5);
    expect(t.zoom).toBeLessThanOrEqual(MODE_TARGET_ZOOM.auto);
    expect(t.zoom).toBeGreaterThanOrEqual(1);
  });

  it("auto follows the SPEAKER (not a blind clock) when two heads are too far apart to share the pane", () => {
    // Auto's own contract is "frame both if they fit, else follow the main
    // speaker" — when the primary (speaker-prioritized) shot stays on the
    // LEFT head the whole time, auto must stay on the left the whole time
    // too, at every t, not ping-pong across to the right and back on a timer.
    const L = shot(0.2, 0.4), R = shot(0.8, 0.4);
    for (const t of [0.1, 1.2 + 0.8, 1.2 + 1.6 + 0.1]) {
      expect(planCamera("auto", t, L, L, R, W, H, PW, PH).cx).toBeCloseTo(0.2);
    }
  });

  it("auto follows the speaker when it switches sides mid-clip", () => {
    const L = shot(0.2, 0.4), R = shot(0.8, 0.4);
    // The speaker-prioritized primary shot is what decides the side — feeding
    // R as `shot` (3rd arg) while topShot/bottomShot stay L/R switches auto
    // onto the right head, even though L is still "topShot".
    expect(planCamera("auto", 5, L, L, R, W, H, PW, PH).cx).toBeCloseTo(0.2);
    expect(planCamera("auto", 5, R, L, R, W, H, PW, PH).cx).toBeCloseTo(0.8);
  });

  it("portrait source follows the speaking face instead of centering two distant faces", () => {
    const L = shot(0.18, 0.4), R = shot(0.82, 0.4);
    const target = planCamera("auto", 2, R, L, R, 1080, 1920, PW, PH);
    expect(target.fit).toBe(false);
    expect(target.cx).toBeCloseTo(0.82);
  });

  it("auto falls back to a real (not stale/undefined) side when the primary shot isn't confident", () => {
    const L = shot(0.2, 0.4), R = shot(0.8, 0.4);
    const t = planCamera("auto", 5, none, L, R, W, H, PW, PH);
    expect(t.fit).toBe(false);
    expect(t.cx === L.cx || t.cx === R.cx).toBe(true);
  });

  it("pan both animates L→R→L, clock restarts at the pair-shot start", () => {
    const L = shot(0.2, 0.4, true, 5), R = shot(0.8, 0.4, true, 5);
    expect(planCamera("pan", 5.1, L, L, R, W, H, PW, PH).cx).toBeCloseTo(0.2);
    expect(planCamera("pan", 5 + 1.2 + 1.6 + 0.5, L, L, R, W, H, PW, PH).cx).toBeCloseTo(0.8);
    expect(planCamera("pan", 5 + 2 * (1.2 + 1.6) + 0.1, L, L, R, W, H, PW, PH).cx).toBeCloseTo(0.2);
  });
});

describe("panProgress", () => {
  it("is continuous and eased (no jumps) across the whole cycle", () => {
    let prev = panProgress(0);
    for (let s = 0.02; s < 6; s += 0.02) {
      const cur = panProgress(s);
      expect(Math.abs(cur - prev)).toBeLessThan(0.03);
      expect(cur).toBeGreaterThanOrEqual(0);
      expect(cur).toBeLessThanOrEqual(1);
      prev = cur;
    }
  });
});

describe("computeFramedGeometry", () => {
  it("places the face above pane center (upper-third bias) and still covers the pane", () => {
    const g = computeFramedGeometry(0.5, 0.5, W, H, PW, PH, 1.2, 2.2);
    const faceY = g.top + 0.5 * g.height; // where the face lands in pane px
    expect(faceY).toBeLessThan(PH / 2);
    expect(faceY).toBeGreaterThan(PH * 0.3);
    expect(g.top).toBeLessThanOrEqual(0);
    expect(g.top + g.height).toBeGreaterThanOrEqual(PH);
    expect(g.left).toBeLessThanOrEqual(0);
    expect(g.left + g.width).toBeGreaterThanOrEqual(PW);
  });

  it("never exposes the frame edge for a face near the border", () => {
    const g = computeCoverGeometry(0.02, 0.98, W, H, PW, PH, 1.2, 2.2);
    expect(g.left).toBeLessThanOrEqual(0);
    expect(g.top + g.height).toBeGreaterThanOrEqual(PH - 0.5);
  });
});

describe("computeTrackedFaceGeometry", () => {
  it("keeps a portrait face centred at 0% extra zoom without enlarging the source", () => {
    const g = computeTrackedFaceGeometry(0.82, 0.4, 1080, 1920, 360, 640, 1);
    expect(g.width).toBe(360);
    expect(g.height).toBe(640);
    expect(g.left + 0.82 * g.width).toBeCloseTo(180);
    expect(g.left + g.width).toBeLessThan(360); // blurred fill, not a hidden zoom
    const relaxed = computeTrackedFaceGeometry(0.82, 0.4, 1080, 1920, 360, 640, 0.9);
    expect(relaxed.width).toBeCloseTo(324);
    expect(relaxed.top).toBeCloseTo(32); // modest breathing room, not a tiny frame
  });
});

describe("planFaceCrop", () => {
  const pts = (xs: (number | null)[]) => xs.map((x, i) => ({ t: i / 10, found: x !== null, cx: x ?? 0.5, cy: 0.4 }));
  it("always crops on a persistent face (tiny faces included)", () => {
    const s = pts([0.3, 0.31, 0.29, 0.3]);
    const t = planFaceCrop(s, 0.15, null);
    expect(t.fit).toBe(false);
    expect(t.cx).toBeCloseTo(0.3, 1);
    expect(t.zoom).toBe(1.35);
  });
  it("windowed median ignores a one-frame detector spike", () => {
    const s = pts([0.3, 0.3, 0.9, 0.3, 0.3, 0.3]);
    expect(planFaceCrop(s, 0.2, null).cx).toBeCloseTo(0.3);
  });
  it("a lone false positive (no temporal support) never steers the crop", () => {
    // one hit on a sweater at t=0.3 amid nothing → not a face; whole scan is faceless → fit
    const s = pts([null, null, null, 0.7, null, null, null]);
    expect(planFaceCrop(s, 0.3, null).fit).toBe(true);
  });
  it("bridges a short detection gap from the nearest stable face", () => {
    const s = pts([0.3, 0.3, 0.3, null, null, null, null, 0.3, 0.3, 0.3]);
    const t = planFaceCrop(s, 0.5, null);
    expect(t.fit).toBe(false);
    expect(t.cx).toBeCloseTo(0.3);
  });
  it("letterboxes a long no-face stretch (title card) instead of holding a stale crop", () => {
    const s = pts([0.3, 0.3, 0.3, ...Array(30).fill(null), 0.7, 0.7, 0.7]);
    expect(planFaceCrop(s, 1.8, { cx: 0.3, cy: 0.4 }).fit).toBe(true);
  });
  it("deadband: sub-threshold motion keeps the current camera", () => {
    const s = pts([0.3, 0.3, 0.3 + FACE_DEADBAND / 2, 0.3]);
    const t = planFaceCrop(s, 0.2, { cx: 0.3, cy: 0.4 });
    expect(t.cx).toBe(0.3);
  });
  it("fits only when the whole scan has no face", () => {
    expect(planFaceCrop(pts([null, null, null]), 0.1, null).fit).toBe(true);
  });
});
