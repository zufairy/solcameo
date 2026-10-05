import { describe, it, expect } from "vitest";
import { buildDualShotPlan, buildShots, shotAt, computeCoverGeometry, sanitizeShots, buildCameraPlan, DEFAULT_CAMERA_GEOMETRY, type SamplePoint } from "@/lib/builder/faceShots";

const pt = (t: number, cx: number, found = true): SamplePoint => ({ t, found, recommendFit: !found, cx, cy: 0.4, faceCount: found ? 1 : 0 });

describe("buildShots (ported from /dev/face-detect)", () => {
  it("one steady speaker → one confident shot at the averaged position", () => {
    const samples = Array.from({ length: 30 }, (_, i) => pt(i / 10, 0.3 + (i % 3) * 0.01));
    const shots = buildShots(samples);
    expect(shots).toHaveLength(1);
    expect(shots[0].confident).toBe(true);
    expect(shots[0].cx).toBeGreaterThan(0.29);
    expect(shots[0].cx).toBeLessThan(0.33);
  });
  it("a sustained jump to a second speaker hard-cuts into a new shot; a 1-frame blip does not", () => {
    const samples = [
      ...Array.from({ length: 20 }, (_, i) => pt(i / 10, 0.83)),
      pt(2.0, 0.36), // single-frame blip
      ...Array.from({ length: 9 }, (_, i) => pt(2.1 + i / 10, 0.83)),
      ...Array.from({ length: 20 }, (_, i) => pt(3.0 + i / 10, 0.36)),
    ];
    const shots = buildShots(samples);
    expect(shots).toHaveLength(2);
    expect(shots[0].cx).toBeCloseTo(0.83, 2);
    expect(shots[1].cx).toBeCloseTo(0.36, 2);
    expect(shots[1].startT).toBeCloseTo(3.0, 1);
  });
  it("no face → unconfident shot; shotAt past the end returns the last shot", () => {
    const shots = buildShots(Array.from({ length: 10 }, (_, i) => pt(i / 10, 0.5, false)));
    expect(shots[0].confident).toBe(false);
    expect(shotAt(shots, 99)).toBe(shots[shots.length - 1]);
  });
});

describe("computeCoverGeometry", () => {
  it("always covers the container, never reveals a gap, even at a frame edge", () => {
    for (const cx of [0, 0.02, 0.5, 0.98, 1]) {
      const g = computeCoverGeometry(cx, 0.5, 1920, 1080, 360, 640, 1.2, 2.2);
      expect(g.left).toBeLessThanOrEqual(0.001);
      expect(g.left + g.width).toBeGreaterThanOrEqual(360 - 0.001);
      expect(g.top).toBeLessThanOrEqual(0.001);
      expect(g.top + g.height).toBeGreaterThanOrEqual(640 - 0.001);
    }
  });
});

describe("buildDualShotPlan", () => {
  it("tracks the left face into the top pane and right face into the bottom pane", () => {
    const samples: SamplePoint[] = Array.from({ length: 30 }, (_, i) => ({
      t: i / 10, found: true, recommendFit: true, cx: 0.5, cy: 0.4, faceCount: 2,
      pair: [{ cx: 0.24, cy: 0.38, w: 0.12 }, { cx: 0.78, cy: 0.41, w: 0.11 }],
    }));
    const dual = buildDualShotPlan(samples);
    expect(dual.top[0]).toMatchObject({ confident: true });
    expect(dual.top[0].cx).toBeCloseTo(0.24, 2);
    expect(dual.bottom[0].cx).toBeCloseTo(0.78, 2);
  });

  it("collapses both pane tracks when fewer than two faces remain", () => {
    const samples = Array.from({ length: 20 }, (_, i) => pt(i / 10, 0.4));
    const dual = buildDualShotPlan(samples);
    expect(dual.top.every((s) => !s.confident)).toBe(true);
    expect(dual.bottom.every((s) => !s.confident)).toBe(true);
  });
});

describe("sanitizeShots", () => {
  it("drops junk, clamps, sorts", () => {
    const out = sanitizeShots([{ startT: 5, endT: 9, cx: 1.4, cy: -1, confident: true }, "x", { startT: 0, endT: 5, cx: 0.5, cy: 0.5 }, { startT: 3, endT: 2, cx: 0, cy: 0 }]);
    expect(out).toEqual([
      { startT: 0, endT: 5, cx: 0.5, cy: 0.5, confident: false },
      { startT: 5, endT: 9, cx: 1, cy: 0, confident: true },
    ]);
  });
});

// ── Smooth-camera v2: jitter-proof segmentation, cut cadence, pan-vs-cut
//    transitions, follow shots for busy subjects, motion-aware zoom hint. ──────
import { buildShotPlan, cropAt } from "@/lib/builder/faceShots";

const steady = (n: number, cx: number, t0 = 0) => Array.from({ length: n }, (_, i) => pt(t0 + i / 10, cx));

describe("buildShotPlan — smooth camera", () => {
  it("detector jitter (±0.1 single-frame flicker) never splits a shot", () => {
    const samples = Array.from({ length: 60 }, (_, i) => pt(i / 10, 0.4 + (i % 2 === 0 ? 0.1 : -0.1) * (i % 5 === 0 ? 1 : 0)));
    const { shots } = buildShotPlan(samples);
    expect(shots).toHaveLength(1);
    expect(shots[0].cx).toBeCloseTo(0.4, 1);
  });

  it("a 1s glance at another speaker does not produce a cut (min shot 1.5s)", () => {
    const samples = [...steady(30, 0.3), ...steady(10, 0.8, 3.0), ...steady(40, 0.3, 4.0)];
    const { shots } = buildShotPlan(samples);
    expect(shots).toHaveLength(1);
  });

  it("a moderate reposition (<0.4) becomes an eased PAN, a real speaker switch stays a CUT", () => {
    const pan = buildShotPlan([...steady(30, 0.3), ...steady(30, 0.55, 3.0)]).shots;
    expect(pan).toHaveLength(2);
    expect(pan[1].transition?.kind).toBe("pan");
    expect(pan[1].transition!.durS).toBeGreaterThanOrEqual(0.35);
    expect(pan[1].transition!.durS).toBeLessThanOrEqual(0.8);

    const cut = buildShotPlan([...steady(30, 0.2), ...steady(30, 0.8, 3.0)]).shots;
    expect(cut).toHaveLength(2);
    expect(cut[1].transition?.kind ?? "cut").toBe("cut");
  });

  it("cropAt eases through a pan: holds before, lands after, monotonic in between", () => {
    const { shots } = buildShotPlan([...steady(30, 0.3), ...steady(30, 0.55, 3.0)]);
    const start = shots[1].startT;
    const dur = shots[1].transition!.durS;
    expect(cropAt(shots, start - 0.2).cx).toBeCloseTo(shots[0].cx, 2);
    expect(cropAt(shots, start + dur + 0.05).cx).toBeCloseTo(shots[1].cx, 2);
    let prev = cropAt(shots, start).cx;
    for (let k = 1; k <= 10; k++) {
      const c = cropAt(shots, start + (dur * k) / 10).cx;
      expect(c).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = c;
    }
    const mid = cropAt(shots, start + dur / 2).cx;
    expect(mid).toBeGreaterThan(shots[0].cx + 0.05);
    expect(mid).toBeLessThan(shots[1].cx - 0.05);
  });

  it("a subject swaying ±0.1 stays ONE shot that FOLLOWS (path), not a stream of cuts", () => {
    const samples = Array.from({ length: 80 }, (_, i) => pt(i / 10, 0.5 + 0.1 * Math.sin((i / 10) * Math.PI / 1.5)));
    const { shots } = buildShotPlan(samples);
    expect(shots).toHaveLength(1);
    expect(shots[0].path && shots[0].path.length > 2).toBe(true);
    // Peak of the sway at t≈0.75s (sin=1) → the crop is near 0.6, not the mean 0.5.
    expect(cropAt(shots, 0.75).cx).toBeGreaterThan(0.56);
    // Trough at t≈2.25s → near 0.4.
    expect(cropAt(shots, 2.25).cx).toBeLessThan(0.44);
  });

  it("zoom hint: steady speaker keeps the mode zoom, busy footage pulls it toward 1", () => {
    const calm = buildShotPlan(steady(60, 0.4), "auto");
    expect(calm.zoomHint).toBeCloseTo(1.2, 2);
    const busy = buildShotPlan(Array.from({ length: 80 }, (_, i) => pt(i / 10, 0.5 + 0.12 * Math.sin(i / 2))), "auto");
    expect(busy.zoomHint).toBeLessThan(1.1);
    expect(busy.zoomHint).toBeGreaterThanOrEqual(1);
  });

  it("existing consumers: buildShots still returns the plan's shots; sanitizeShots keeps transition + path", () => {
    const samples = [...steady(30, 0.3), ...steady(30, 0.55, 3.0)];
    expect(buildShots(samples)).toEqual(buildShotPlan(samples).shots);
    const out = sanitizeShots([{ startT: 0, endT: 3, cx: 0.3, cy: 0.4, confident: true, transition: { kind: "pan", durS: 0.5 }, path: [{ t: 0, cx: 0.3, cy: 0.4 }, { t: 1, cx: 0.35, cy: 0.4 }] }]);
    expect(out[0].transition).toEqual({ kind: "pan", durS: 0.5 });
    expect(out[0].path).toHaveLength(2);
  });
});

describe("buildShots — merged-detection guard (regression: crop landing on the empty gap between two real people)", () => {
  it("a same-position sample with a mismatched width does NOT get averaged into the anchor's shot", () => {
    // 20 samples steady at 0.3, width ~0.06 (a normal single face), then 5
    // samples STILL reporting cx≈0.3 but width 0.18 (3x wider — a merged
    // detection whose box happens to center near this anchor), then back to
    // normal. Without the width guard, those 5 points would just accumulate
    // into the shot average like any other matching sample.
    const samples: SamplePoint[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ ...pt(i / 10, 0.3), w: 0.06 })),
      ...Array.from({ length: 5 }, (_, i) => ({ ...pt(2 + i / 10, 0.3), w: 0.18 })),
      ...Array.from({ length: 20 }, (_, i) => ({ ...pt(2.5 + i / 10, 0.3), w: 0.06 })),
    ];
    const shots = buildShots(samples);
    // The whole run stays one shot at the TRUE normal-face position — the
    // wide samples must not shift it even slightly toward a fabricated value.
    expect(shots).toHaveLength(1);
    expect(shots[0].cx).toBeCloseTo(0.3, 2);
  });
});

describe("buildCameraPlan — a run that eases straight from one committed shot into the next must split (regression: midpoint-of-two-speakers crop)", () => {
  it("does NOT average a continuously-cropped run across a real position change into one midpoint shot", () => {
    // Two real, well-separated speakers (0.28 and 0.82) with NO letterbox gap
    // between them (both always confident) — a run that stays "cropped" the
    // whole time in zoom/pan/auto mode. Before the shotKey fix, buildCameraPlan
    // grouped this into ONE run (since `fit` never toggles) and reported its
    // mean cx (~0.55) — landing the crop on empty space between both people.
    const samples: SamplePoint[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ ...pt(i / 10, 0.28), w: 0.07 })),
      ...Array.from({ length: 30 }, (_, i) => ({ ...pt(3 + i / 10, 0.82), w: 0.07 })),
    ];
    const geom = { ...DEFAULT_CAMERA_GEOMETRY, outW: 1080, outH: 1920 };
    for (const mode of ["zoom", "pan", "auto"] as const) {
      const plan = buildCameraPlan(samples, mode, geom);
      const confidentCx = plan.shots.filter((s) => s.confident).map((s) => s.cx);
      // Every confident shot must land NEAR one of the two real speakers —
      // never at the midpoint (~0.55) between them.
      for (const cx of confidentCx) {
        const nearEither = Math.abs(cx - 0.28) < 0.12 || Math.abs(cx - 0.82) < 0.12;
        expect(nearEither, `mode=${mode} shot cx=${cx} is neither near 0.28 nor 0.82 (midpoint collapse)`).toBe(true);
      }
    }
  });
});
