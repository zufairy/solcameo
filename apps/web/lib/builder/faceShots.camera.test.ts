import { describe, it, expect } from "vitest";
import { buildCameraPlan, shouldUseCameraPlan, cropAt, shotCropExpr, sanitizeShots, type SamplePoint } from "@/lib/builder/faceShots";

const pt = (t: number, cx: number, found = true, pair?: [number, number]): SamplePoint => ({
  t, found, recommendFit: !found, cx, cy: 0.4, faceCount: found ? (pair ? 2 : 1) : 0,
  ...(pair ? { pair: [{ cx: pair[0], cy: 0.4, w: 0.1 }, { cx: pair[1], cy: 0.4, w: 0.1 }] } : {}),
});
const steady = (n: number, cx: number, t0 = 0) => Array.from({ length: n }, (_, i) => pt(t0 + i / 10, cx + ((i % 3) - 1) * 0.004));

describe("buildCameraPlan (lab algorithm baked into FaceShot paths)", () => {
  it("Face Crop: steady speaker → one cropped shot, path stays on the face", () => {
    const { shots, zoomHint } = buildCameraPlan(steady(60, 0.3), "zoom");
    expect(shots.filter((s) => s.confident)).toHaveLength(1);
    expect(zoomHint).toBe(1.35);
    for (const t of [0.5, 2, 4, 5.5]) expect(cropAt(shots, t).cx).toBeCloseTo(0.3, 1);
  });

  it("Face Crop: a speaker moving inside one shot keeps a follow path", () => {
    const moving = Array.from({ length: 60 }, (_, i) => pt(i / 10, 0.30 + 0.16 * i / 59));
    const { shots } = buildCameraPlan(moving, "zoom");
    expect(shots).toHaveLength(1);
    expect(shouldUseCameraPlan(shots, "zoom")).toBe(true);
    expect(shouldUseCameraPlan(shots, "auto")).toBe(true);
    expect(shots[0].path && shots[0].path.length).toBeGreaterThan(2);
    expect(cropAt(shots, 0.5).cx).toBeLessThan(0.34);
    expect(cropAt(shots, 5.5).cx).toBeGreaterThan(0.43);
  });

  it("Auto uses the dense plan even for a static off-centre speaker", () => {
    const { shots } = buildCameraPlan(steady(60, 0.3), "auto");
    expect(shouldUseCameraPlan(shots, "auto")).toBe(true);
    expect(shouldUseCameraPlan(shots, "zoom")).toBe(true);
  });

  it("Auto keeps an edge speaker centred in a portrait source and exports enough zoom", () => {
    const portrait = { srcW: 1080, srcH: 1920, outW: 1080, outH: 1920 };
    const speakingRight = Array.from({ length: 60 }, (_, i) => pt(i / 10, 0.82, true, [0.18, 0.82]));
    const plan = buildCameraPlan(speakingRight, "auto", portrait);
    expect(cropAt(plan.shots, 3).cx).toBeCloseTo(0.82, 1);
    expect(plan.zoomHint).toBeGreaterThanOrEqual(2.75);
    expect(plan.zoomHint).toBeLessThanOrEqual(3);
    expect(shouldUseCameraPlan(plan.shots, "auto")).toBe(true);
  });

  it("Face Crop: the selected zoom is preserved while the tracked face moves toward the edge", () => {
    const moving = Array.from({ length: 60 }, (_, i) => pt(i / 10, 0.30 - 0.20 * i / 59));
    const { shots, zoomHint } = buildCameraPlan(moving, "zoom");
    expect(zoomHint).toBe(1.35);
    expect(cropAt(shots, 5.8).cx).toBeLessThan(cropAt(shots, 0.2).cx);
    expect(buildCameraPlan(moving, "zoom", undefined, 1).zoomHint).toBe(1);
  });

  it("Face Crop: speaker switch is an eased move, not a jump", () => {
    const { shots } = buildCameraPlan([...steady(30, 0.2), ...steady(30, 0.8, 3)], "zoom");
    const xs = Array.from({ length: 40 }, (_, i) => cropAt(shots, 2.5 + i * 0.05).cx);
    expect(xs[0]).toBeCloseTo(0.2, 1);
    expect(xs[xs.length - 1]).toBeCloseTo(0.8, 1);
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(0.16); // 50ms steps, no teleport
    expect(xs.some((x) => x > 0.35 && x < 0.65)).toBe(true);                                       // passes through the middle
  });

  it("Pan both: two heads → the path sweeps between them", () => {
    const s = Array.from({ length: 80 }, (_, i) => pt(i / 10, 0.25, true, [0.25, 0.75]));
    const { shots } = buildCameraPlan(s, "pan");
    const xs = Array.from({ length: 70 }, (_, i) => cropAt(shots, i * 0.1).cx);
    expect(Math.min(...xs)).toBeLessThan(0.32);
    expect(Math.max(...xs)).toBeGreaterThan(0.68);
  });

  it("Auto: two heads that fit → frame both at a lowered zoom", () => {
    const close = Array.from({ length: 40 }, (_, i) => pt(i / 10, 0.45, true, [0.45, 0.55]));
    const near = buildCameraPlan(close, "auto");
    expect(cropAt(near.shots, 2).cx).toBeCloseTo(0.5, 1);
    expect(near.zoomHint).toBeLessThanOrEqual(1.2);
  });

  it("Auto: two heads too far apart to share the pane → crops tight on whoever's SPEAKING, not a blind side-to-side pan", () => {
    // The primary (speaker-prioritized) position stays on the LEFT head the
    // whole time — auto must stay there too, never drifting toward the right
    // head just because time passed (that's Pan both's job, a different mode).
    const far = Array.from({ length: 80 }, (_, i) => pt(i / 10, 0.15, true, [0.15, 0.85]));
    const xs = Array.from({ length: 70 }, (_, i) => cropAt(buildCameraPlan(far, "auto").shots, i * 0.1).cx);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.05);
    expect(xs[0]).toBeCloseTo(0.15, 1);
  });

  it("Auto: follows a real speaker switch between two far-apart heads", () => {
    // First half: primary/speaker position matches the left head (0.15).
    // Second half: it switches to match the right head (0.85) — auto's crop
    // must follow that switch, landing on the right head afterward.
    const far = [
      ...Array.from({ length: 40 }, (_, i) => pt(i / 10, 0.15, true, [0.15, 0.85])),
      ...Array.from({ length: 40 }, (_, i) => pt(4 + i / 10, 0.85, true, [0.15, 0.85])),
    ];
    const { shots } = buildCameraPlan(far, "auto");
    expect(cropAt(shots, 1).cx).toBeCloseTo(0.15, 1);
    expect(cropAt(shots, 7).cx).toBeCloseTo(0.85, 1);
  });

  it("nobody in frame → letterbox shot; Fit mode → no shots", () => {
    const { shots } = buildCameraPlan(Array.from({ length: 20 }, (_, i) => pt(i / 10, 0.5, false)), "auto");
    expect(shots.every((s) => !s.confident)).toBe(true);
    expect(shouldUseCameraPlan(shots, "auto")).toBe(true);
    expect(buildCameraPlan(steady(20, 0.3), "full").shots).toHaveLength(0);
  });

  it("fits a real no-face gap in every tracked mode instead of holding an empty crop", () => {
    const source = [
      ...steady(30, 0.2),
      ...Array.from({ length: 10 }, (_, i) => pt(3 + i / 10, 0.5, false)),
      ...steady(30, 0.8, 4),
    ];
    for (const mode of ["auto", "zoom", "pan", "dual"] as const) {
      const { shots } = buildCameraPlan(source, mode);
      expect(shots.some((s) => !s.confident && s.startT <= 3.5 && s.endT > 3.5), `${mode} held a crop through an empty scene`).toBe(true);
      expect(shots.some((s) => s.confident && s.startT <= 1 && s.endT > 1), `${mode} lost the earlier face`).toBe(true);
      expect(shots.some((s) => s.confident && s.startT <= 5 && s.endT > 5), `${mode} failed to reacquire the next face`).toBe(true);
    }
  });

  it("keyframe budget holds on a long busy clip and survives the burn's sanitize + expr", () => {
    const long = Array.from({ length: 1200 }, (_, i) => pt(i / 10, 0.5 + 0.3 * Math.sin(i / 7), true));
    const { shots } = buildCameraPlan(long, "zoom");
    const keys = shots.reduce((n, s) => n + (s.path?.length ?? 0), 0);
    expect(keys).toBeLessThanOrEqual(240);
    const clean = sanitizeShots(shots);
    expect(clean.reduce((n, s) => n + (s.path?.length ?? 0), 0)).toBe(keys); // nothing truncated
    const expr = shotCropExpr(clean, "cx");
    expect(expr.length).toBeLessThan(40_000);
    expect(expr).toContain("if(lt(t,");
  });
});
