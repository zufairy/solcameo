// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

// detectFaceCenter now runs local CenterFace inference per frame (no external
// API) — mock the detector itself so the test exercises ONLY the decision/
// selection logic that sits on top of it (the part bug #4 lives in).
const mockDetectFaces = vi.fn();
vi.mock("./centerface", () => ({ detectFaces: (...args: unknown[]) => mockDetectFaces(...args) }));

// Burst-based primary selection calls loadGray/mouthMotion (speakerTrack.ts) —
// mocked so these tests exercise the SELECTION logic (which face wins, and
// only with a clear lead) without decoding real images.
const mockLoadGray = vi.fn();
const mockMouthMotion = vi.fn();
vi.mock("./speakerTrack", () => ({
  loadGray: (...args: unknown[]) => mockLoadGray(...args),
  mouthMotion: (...args: unknown[]) => mockMouthMotion(...args),
}));

import { detectFaceCenter } from "./faceTrack";

/** Stubs detectFaces to return the given per-frame face list, in order, one
 *  call per path passed to detectFaceCenter. */
function stubFrames(perFrame: { cx: number; cy: number; w: number }[][]) {
  mockDetectFaces.mockReset();
  for (const faces of perFrame) {
    mockDetectFaces.mockImplementationOnce(async () => faces.map((f) => ({ ...f, h: f.w, score: 0.9, px: { x1: 0, y1: 0, x2: 1, y2: 1 } })));
  }
}

describe("detectFaceCenter — multi-face primary (bug #4: never the gap)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the PRIMARY (largest) face center, NOT the bbox midpoint between two guests", async () => {
    // Two guests every frame: LEFT @0.2 is the larger/primary (w 0.25), RIGHT @0.8 (w 0.15).
    const face = (cx: number, w: number) => ({ cx, cy: 0.45, w });
    const frame = [face(0.2, 0.25), face(0.8, 0.15)];
    stubFrames([frame, frame, frame]);

    // unique paths → fresh (uncached) detection
    const subj = await detectFaceCenter(["/bug4-a.jpg", "/bug4-b.jpg", "/bug4-c.jpg"]);
    expect(subj).toBeTruthy();
    expect(subj!.kind).toBe("face");
    // cx must be the primary speaker @0.2 — NOT the midpoint (0.2+0.8)/2 = 0.5 (the empty gap).
    expect(subj!.cx).toBeCloseTo(0.2);
    // bounds are still surfaced so the reframe can fit/pan between guests.
    expect(subj!.xMin).toBeCloseTo(0.2);
    expect(subj!.xMax).toBeCloseTo(0.8);
  });
});

describe("detectFaceCenter — letterbox/fit fallback (speaker can't be localized → recommendFit, NOT a table crop)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a small off-center single face (w≈0.05, jittering cx) → recommendFit, NOT a dead-center subject crop of the table", async () => {
    // A wide podcast shot: one tiny head that jitters across the frame (spread 0.5 >
    // the 0.25 gate). The OLD Gemini-vision code could fall back to a generic
    // "subject" guess for the table; CenterFace is face-only, so this now
    // letterboxes instead — never a dead-center crop pretending to know the shot.
    const f = (cx: number) => [{ cx, cy: 0.4, w: 0.05 }];
    stubFrames([f(0.2), f(0.7), f(0.3)]);
    const subj = await detectFaceCenter(["/fit-a.jpg", "/fit-b.jpg", "/fit-c.jpg"]);
    expect(subj).toBeTruthy();
    expect(subj!.recommendFit).toBe(true);
    // Must letterbox, NOT collapse to a subject crop centered on the table.
    expect(subj!.kind).toBe("face");
  });

  it("a small but STABLE single face (w≈0.06) → crop-follows the face (NOT letterbox — we know where the speaker is)", async () => {
    // Head agrees frame-to-frame (no jitter). Even though it's smallish, we KNOW the
    // speaker's position, so crop-follow it (keeps them in frame) rather than shrink
    // them to a tiny figure by letterboxing the whole wide shot.
    const f = [{ cx: 0.5, cy: 0.42, w: 0.06 }];
    stubFrames([f, f, f]);
    const subj = await detectFaceCenter(["/small-a.jpg", "/small-b.jpg", "/small-c.jpg"]);
    expect(subj!.recommendFit).toBeFalsy();
    expect(subj!.kind).toBe("face");
    expect(subj!.cx).toBeCloseTo(0.5);
  });

  it("a TINY stable face (w≈0.015, a distant figure) → still letterboxes (a crop would frame the background)", async () => {
    const f = [{ cx: 0.5, cy: 0.42, w: 0.015 }];
    stubFrames([f, f, f]);
    const subj = await detectFaceCenter(["/tiny-a.jpg", "/tiny-b.jpg", "/tiny-c.jpg"]);
    expect(subj!.recommendFit).toBe(true);
  });

  it("a wide-podcast-sized face (w≈0.04 of a 16:9 frame) → face crop, NOT letterbox (it's ~13% of a 9:16 crop)", async () => {
    const f = [{ cx: 0.27, cy: 0.33, w: 0.04 }];
    stubFrames([f, f, f]);
    const subj = await detectFaceCenter(["/pod-a.jpg", "/pod-b.jpg", "/pod-c.jpg"]);
    expect(subj!.recommendFit).toBeFalsy();
    expect(subj!.cx).toBeCloseTo(0.27);
  });

  it("a large, centered, confident face → a normal face crop (NOT recommendFit)", async () => {
    const f = [{ cx: 0.5, cy: 0.42, w: 0.4 }];
    stubFrames([f, f, f]);
    const subj = await detectFaceCenter(["/big-a.jpg", "/big-b.jpg", "/big-c.jpg"]);
    expect(subj!.kind).toBe("face");
    expect(subj!.recommendFit).toBeFalsy();
    expect(subj!.cx).toBeCloseTo(0.5);
    expect(subj!.w).toBeCloseTo(0.4);
  });

  it("zero detected faces in every frame (genuine b-roll) → kind:subject, centered (CenterFace is face-only, no generic object guess)", async () => {
    stubFrames([[], [], []]);
    const subj = await detectFaceCenter(["/broll-a.jpg", "/broll-b.jpg", "/broll-c.jpg"]);
    expect(subj!.kind).toBe("subject");
    expect(subj!.cx).toBeCloseTo(0.5);
    expect(subj!.recommendFit).toBeFalsy();
  });

  it("a face in only ONE of several frames (occasional/borderline detection) → recommendFit, best-effort centered bias", async () => {
    stubFrames([[{ cx: 0.3, cy: 0.4, w: 0.2 }], [], []]);
    const subj = await detectFaceCenter(["/occasional-a.jpg", "/occasional-b.jpg", "/occasional-c.jpg"]);
    expect(subj!.kind).toBe("face");
    expect(subj!.recommendFit).toBe(true);
  });
});

describe("detectFaceCenter — burst-based active-speaker primary (podcast: crop who's TALKING, not who's bigger)", () => {
  afterEach(() => { vi.unstubAllGlobals(); mockLoadGray.mockReset(); mockMouthMotion.mockReset(); });

  // A bigger guest on the right, a smaller one on the left — px.x1 tags each
  // face so the mouthMotion mock can tell them apart.
  const bigRight = { cx: 0.75, cy: 0.4, w: 0.2, h: 0.3, score: 0.9, px: { x1: 700, y1: 100, x2: 900, y2: 400 } };
  const smallLeft = { cx: 0.25, cy: 0.4, w: 0.08, h: 0.15, score: 0.9, px: { x1: 100, y1: 100, x2: 180, y2: 250 } };
  const frame = [bigRight, smallLeft];

  it("picks the SMALLER face as primary when the burst shows only IT has mouth motion", async () => {
    mockDetectFaces.mockReset();
    mockDetectFaces.mockImplementation(async () => frame);
    mockLoadGray.mockImplementation(async (p: string) => ({ data: Buffer.from(p), width: 10, height: 10 }));
    mockMouthMotion.mockImplementation((_a: unknown, _b: unknown, px: { x1: number }) => (px.x1 === 100 ? 0.05 : 0.0001));

    const subj = await detectFaceCenter(
      ["/burst-a.jpg", "/burst-b.jpg", "/burst-c.jpg"],
      [["/burst-a-2.jpg"], ["/burst-b-2.jpg"], ["/burst-c-2.jpg"]],
    );
    expect(subj!.cx).toBeCloseTo(0.25); // the talker (smallLeft), NOT the bigger bigRight
    expect(subj!.w).toBeCloseTo(0.08);
  });

  it("falls back to the largest face when the burst shows no clear lead (both near-silent)", async () => {
    mockDetectFaces.mockReset();
    mockDetectFaces.mockImplementation(async () => frame);
    mockLoadGray.mockImplementation(async (p: string) => ({ data: Buffer.from(p), width: 10, height: 10 }));
    mockMouthMotion.mockImplementation(() => 0.0001); // no signal either way

    const subj = await detectFaceCenter(
      ["/burst2-a.jpg", "/burst2-b.jpg", "/burst2-c.jpg"],
      [["/burst2-a-2.jpg"], ["/burst2-b-2.jpg"], ["/burst2-c-2.jpg"]],
    );
    expect(subj!.cx).toBeCloseTo(0.75); // largest face, unchanged behavior
  });

  it("with no burstPaths argument at all, behaves exactly as the original largest-face selection (no image decode)", async () => {
    mockDetectFaces.mockReset();
    mockDetectFaces.mockImplementation(async () => frame);

    const subj = await detectFaceCenter(["/nobust-a.jpg", "/nobust-b.jpg", "/nobust-c.jpg"]);
    expect(subj!.cx).toBeCloseTo(0.75);
    expect(mockLoadGray).not.toHaveBeenCalled();
    expect(mockMouthMotion).not.toHaveBeenCalled();
  });

  it("a single face with burst frames present skips the burst entirely (nothing to disambiguate)", async () => {
    mockDetectFaces.mockReset();
    mockDetectFaces.mockImplementation(async () => [bigRight]);

    const subj = await detectFaceCenter(["/one-a.jpg", "/one-b.jpg", "/one-c.jpg"], [["/one-a-2.jpg"], undefined, undefined]);
    expect(subj!.cx).toBeCloseTo(0.75);
    expect(mockLoadGray).not.toHaveBeenCalled();
  });
});
