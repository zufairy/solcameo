// @vitest-environment node
import { describe, it, expect } from "vitest";
import { assignTracks, voicedFlags, chooseSpeakers, isHardCut, mouthMotion, toSamplePoints, type Gray, type SpeakerFrame } from "./speakerTrack";

describe("assignTracks", () => {
  it("keeps the same id for a face that barely moves frame to frame", () => {
    const frames = [
      { t: 0, faces: [{ cx: 0.3, cy: 0.5, w: 0.1 }] },
      { t: 0.1, faces: [{ cx: 0.31, cy: 0.5, w: 0.1 }] },
      { t: 0.2, faces: [{ cx: 0.29, cy: 0.5, w: 0.1 }] },
    ];
    const ids = assignTracks(frames);
    expect(ids[0][0]).toBe(ids[1][0]);
    expect(ids[1][0]).toBe(ids[2][0]);
  });

  it("keeps two side-by-side faces on distinct tracks (a podcast two-shot)", () => {
    const frame = { faces: [{ cx: 0.2, cy: 0.5, w: 0.08 }, { cx: 0.8, cy: 0.5, w: 0.1 }] };
    const frames = [{ t: 0, ...frame }, { t: 0.1, ...frame }, { t: 0.2, ...frame }];
    const ids = assignTracks(frames);
    expect(ids[0][0]).not.toBe(ids[0][1]);
    expect(ids[2][0]).toBe(ids[0][0]);
    expect(ids[2][1]).toBe(ids[0][1]);
  });

  it("starts a NEW track when a face jumps far (a different person, not the same one moving)", () => {
    const frames = [
      { t: 0, faces: [{ cx: 0.2, cy: 0.5, w: 0.1 }] },
      { t: 0.1, faces: [{ cx: 0.8, cy: 0.5, w: 0.1 }] },
    ];
    const ids = assignTracks(frames);
    expect(ids[0][0]).not.toBe(ids[1][0]);
  });

  it("keeps a track alive through a brief detection gap (within TRACK_TTL_S)", () => {
    const frames = [
      { t: 0, faces: [{ cx: 0.5, cy: 0.5, w: 0.1 }] },
      { t: 0.5, faces: [] },
      { t: 1.0, faces: [{ cx: 0.5, cy: 0.5, w: 0.1 }] },
    ];
    const ids = assignTracks(frames);
    expect(ids[2][0]).toBe(ids[0][0]);
  });

  it("does NOT continue a track across a camera cut, even at the same position", () => {
    const frames = [
      { t: 0, faces: [{ cx: 0.5, cy: 0.5, w: 0.1 }] },
      { t: 0.1, faces: [{ cx: 0.5, cy: 0.5, w: 0.1 }] },
    ];
    const ids = assignTracks(frames, [false, true]);
    expect(ids[1][0]).not.toBe(ids[0][0]);
  });
});

describe("voicedFlags", () => {
  it("flags loud samples as voiced and quiet ones as not", () => {
    const sr = 1000, fps = 10; // 100 samples/frame
    const loud = new Array(100).fill(0).map((_, i) => Math.sin(i) * 0.8);
    const quiet = new Array(100).fill(0).map((_, i) => Math.sin(i) * 0.01);
    const pcm = new Float32Array([...loud, ...quiet, ...loud]);
    const flags = voicedFlags(pcm, sr, fps, 3);
    expect(flags).toEqual([true, false, true]);
  });

  it("an all-silent track never reports voiced (no false speech from noise floor)", () => {
    const pcm = new Float32Array(1000).fill(0);
    const flags = voicedFlags(pcm, 1000, 10, 10);
    expect(flags.every((f) => !f)).toBe(true);
  });
});

describe("chooseSpeakers — the bug this module fixes: largest ≠ talking", () => {
  const fps = 10;

  it("picks the SMALLER face when only it has mouth motion during voiced frames (not the largest)", () => {
    const n = 20;
    const frames = Array.from({ length: n }, (_, i) => ({
      t: i / fps,
      faces: [{ cx: 0.2, cy: 0.5, w: 0.06, h: 0.12 }, { cx: 0.8, cy: 0.5, w: 0.15, h: 0.2 }],
    }));
    const trackIds = frames.map(() => [0, 1]);
    // Track 0 (small, left) talks; track 1 (large, right) sits still.
    const mouth = frames.map(() => [0.08, 0.001]);
    const voiced = frames.map(() => true);
    const out = chooseSpeakers(frames, trackIds, mouth, voiced, fps);
    const mid = out[Math.floor(n / 2)];
    expect(mid.speakerId).toBe(0);
    expect(mid.faces.find((f) => f.trackId === 0)!.cx).toBeCloseTo(0.2);
  });

  it("switches speaker when the OTHER face starts talking (evidence lead, not just louder single frame)", () => {
    const n = 40;
    const frames = Array.from({ length: n }, (_, i) => ({
      t: i / fps,
      faces: [{ cx: 0.2, cy: 0.5, w: 0.08, h: 0.15 }, { cx: 0.8, cy: 0.5, w: 0.08, h: 0.15 }],
    }));
    const trackIds = frames.map(() => [0, 1]);
    // First half: track 0 talks. Second half: track 1 talks.
    const mouth = frames.map((_, i) => (i < n / 2 ? [0.08, 0.001] : [0.001, 0.08]));
    const voiced = frames.map(() => true);
    const out = chooseSpeakers(frames, trackIds, mouth, voiced, fps);
    expect(out[5].speakerId).toBe(0);
    expect(out[n - 5].speakerId).toBe(1);
  });

  it("a brief single-frame blip from the listener does NOT flip the speaker", () => {
    const n = 30;
    const frames = Array.from({ length: n }, (_, i) => ({
      t: i / fps,
      faces: [{ cx: 0.2, cy: 0.5, w: 0.08, h: 0.15 }, { cx: 0.8, cy: 0.5, w: 0.08, h: 0.15 }],
    }));
    const trackIds = frames.map(() => [0, 1]);
    // Track 0 talks throughout; track 1 has one glitchy frame in the middle.
    const mouth = frames.map((_, i) => (i === 15 ? [0.08, 0.12] : [0.08, 0.001]));
    const voiced = frames.map(() => true);
    const out = chooseSpeakers(frames, trackIds, mouth, voiced, fps);
    expect(out.every((f) => f.speakerId === 0)).toBe(true);
  });

  it("falls back to the largest face when nobody has any evidence yet (cold start / silence)", () => {
    const frames = [{ t: 0, faces: [{ cx: 0.2, cy: 0.5, w: 0.06, h: 0.1 }, { cx: 0.8, cy: 0.5, w: 0.15, h: 0.2 }] }];
    const trackIds = [[0, 1]];
    const mouth = [[0, 0]];
    const voiced = [false];
    const out = chooseSpeakers(frames, trackIds, mouth, voiced, fps);
    expect(out[0].speakerId).toBe(1); // the larger face
  });

  it("holds the speaker's crop at their last box through a brief missed detection (ghost)", () => {
    const frames = [
      { t: 0, faces: [{ cx: 0.2, cy: 0.5, w: 0.08, h: 0.15 }, { cx: 0.8, cy: 0.5, w: 0.08, h: 0.15 }] },
      { t: 0.1, faces: [{ cx: 0.8, cy: 0.5, w: 0.08, h: 0.15 }] }, // speaker's face missed this frame
      { t: 0.2, faces: [{ cx: 0.2, cy: 0.5, w: 0.08, h: 0.15 }, { cx: 0.8, cy: 0.5, w: 0.08, h: 0.15 }] },
    ];
    const trackIds = [[0, 1], [1], [0, 1]];
    const mouth = [[0.08, 0.001], [0.001], [0.08, 0.001]];
    const voiced = [true, true, true];
    const out = chooseSpeakers(frames, trackIds, mouth, voiced, fps);
    expect(out[0].speakerId).toBe(0);
    // Frame 1: track 0 (the speaker) wasn't detected, but is held as a ghost box.
    expect(out[1].speakerId).toBe(0);
    expect(out[1].faces.find((f) => f.trackId === 0)?.ghost).toBe(true);
    expect(out[1].faces.find((f) => f.trackId === 0)?.cx).toBeCloseTo(0.2);
  });

  it("resets the speaker decision at a camera cut instead of carrying the old pick's track id", () => {
    const frames = [
      { t: 0, faces: [{ cx: 0.2, cy: 0.5, w: 0.08, h: 0.15 }] },
      { t: 0.1, faces: [{ cx: 0.2, cy: 0.5, w: 0.3, h: 0.4 }] }, // new shot: a close-up, different track id
    ];
    const trackIds = [[0], [1]];
    const mouth = [[0.08], [0]];
    const voiced = [true, false];
    const out = chooseSpeakers(frames, trackIds, mouth, voiced, fps, [false, true]);
    expect(out[1].speakerId).toBe(1);
  });

  it("returns no speaker and empty faces when nothing is detected", () => {
    const out = chooseSpeakers([{ t: 0, faces: [] }], [[]], [[]], [false], fps);
    expect(out[0].speakerId).toBeNull();
    expect(out[0].faces).toEqual([]);
  });
});

function solidGray(width: number, height: number, value = 128): Gray {
  return { data: Buffer.alloc(width * height, value), width, height };
}

describe("isHardCut", () => {
  it("is false for two identical frames", () => {
    const a = solidGray(64, 36, 100);
    expect(isHardCut(a, a)).toBe(false);
  });

  it("is true when the whole frame changes brightness at once (an edit cut)", () => {
    const a = solidGray(64, 36, 20);
    const b = solidGray(64, 36, 220);
    expect(isHardCut(a, b)).toBe(true);
  });

  it("is false for a small localized change (a face moving within the shot)", () => {
    const a = solidGray(64, 36, 100);
    const b = solidGray(64, 36, 100);
    // Only a small corner patch changes — well under the whole-frame threshold.
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) b.data[y * 64 + x] = 250;
    expect(isHardCut(a, b)).toBe(false);
  });
});

describe("mouthMotion", () => {
  it("reports near-zero when the whole face patch is static", () => {
    const px = { x1: 10, y1: 10, x2: 40, y2: 50 };
    const a = solidGray(64, 64, 120);
    const b = solidGray(64, 64, 120);
    expect(mouthMotion(a, b, px)).toBeLessThan(0.02);
  });

  it("reports motion when the mouth region changes but ignores a pure head-shift (rigid translation)", () => {
    const px = { x1: 10, y1: 10, x2: 40, y2: 50 };
    const w = 64, h = 64;
    const a = solidGray(w, h, 100);
    // Draw a vertical gradient stripe through the whole patch so a rigid shift
    // is detectable but alignable.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.data[y * w + x] = (x * 3) % 256;
    // b = a shifted right by 1px (a head move, not talking).
    const bShift = solidGray(w, h, 100);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bShift.data[y * w + x] = a.data[y * w + Math.max(0, x - 1)];
    const shiftMotion = mouthMotion(a, bShift, px);

    // b2 = a with a genuinely different (non-shiftable) pattern in the mouth band only.
    const bTalk = Buffer.from(a.data);
    const mouthY0 = Math.floor(px.y1 + 0.55 * (px.y2 - px.y1)), mouthY1 = Math.floor(px.y1 + 1.02 * (px.y2 - px.y1));
    for (let y = mouthY0; y < Math.min(h, mouthY1); y++) {
      for (let x = px.x1; x < px.x2; x++) bTalk[y * w + x] = (bTalk[y * w + x] + 128) % 256;
    }
    const talkMotion = mouthMotion(a, { data: bTalk, width: w, height: h }, px);

    expect(shiftMotion).toBeLessThan(0.05);
    expect(talkMotion).toBeGreaterThan(shiftMotion);
  });
});

describe("toSamplePoints — the shared glue BOTH /dev/face-detect and the cloud clip-render pipeline build their camera plan from", () => {
  it("uses the SPEAKER's face for cx/cy, not just the largest one on screen", () => {
    const frames: SpeakerFrame[] = [{
      t: 1.2,
      faces: [
        { cx: 0.75, cy: 0.5, w: 0.2, h: 0.3, trackId: 1, speaking: 0.001 }, // bigger, silent
        { cx: 0.25, cy: 0.45, w: 0.08, h: 0.15, trackId: 2, speaking: 0.05 }, // smaller, talking
      ],
      speakerId: 2,
      secondId: 1,
      voiced: true,
      cut: false,
    }];
    const points = toSamplePoints(frames);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ t: 1.2, found: true, cx: 0.25, cy: 0.45, faceCount: 2 });
    // pair is left-to-right regardless of who's speaking — the speaker (0.25) then the other (0.75).
    expect(points[0].pair).toEqual([{ cx: 0.25, cy: 0.45, w: 0.08 }, { cx: 0.75, cy: 0.5, w: 0.2 }]);
  });

  it("flags recommendFit for a tiny (<2% wide) speaker face", () => {
    const frames: SpeakerFrame[] = [{
      t: 0, faces: [{ cx: 0.5, cy: 0.5, w: 0.015, h: 0.03, trackId: 1, speaking: 0.01 }],
      speakerId: 1, secondId: null, voiced: true, cut: false,
    }];
    expect(toSamplePoints(frames)[0].recommendFit).toBe(true);
  });

  it("does NOT flag a wide 2-shot podcast face (~4% of a 16:9 frame) — the active speaker stays trackable", () => {
    // Regression: at the old 5% floor every face in a left/right podcast 2-shot
    // was "tiny" → the whole speaker signal was dropped and the camera parked.
    const frames: SpeakerFrame[] = [{
      t: 0,
      faces: [
        { cx: 0.27, cy: 0.33, w: 0.039, h: 0.07, trackId: 1, speaking: 0.02 },
        { cx: 0.77, cy: 0.33, w: 0.042, h: 0.07, trackId: 2, speaking: 0.001 },
      ],
      speakerId: 2, secondId: 1, voiced: true, cut: false,
    }];
    const [p] = toSamplePoints(frames);
    expect(p.recommendFit).toBe(false);
    expect(p.cx).toBeCloseTo(0.77);
  });

  it("a not-found frame (no speaker, or no faces) becomes an unconfident centered point", () => {
    const frames: SpeakerFrame[] = [
      { t: 0, faces: [], speakerId: null, secondId: null, voiced: false, cut: false },
      { t: 0.1, faces: [{ cx: 0.4, cy: 0.4, w: 0.1, h: 0.2, trackId: 1, speaking: 0 }], speakerId: null, secondId: null, voiced: false, cut: false },
    ];
    const points = toSamplePoints(frames);
    expect(points[0]).toMatchObject({ found: false, cx: 0.5, cy: 0.5, recommendFit: true, faceCount: 0 });
    expect(points[1]).toMatchObject({ found: false, cx: 0.5, cy: 0.5, recommendFit: true });
  });

  it("a ghost box (speaker held through a missed detection) does NOT count toward faceCount", () => {
    const frames: SpeakerFrame[] = [{
      t: 0.5,
      faces: [{ cx: 0.3, cy: 0.5, w: 0.08, h: 0.15, trackId: 1, speaking: 0.02, ghost: true }],
      speakerId: 1, secondId: null, voiced: true, cut: false,
    }];
    const points = toSamplePoints(frames);
    expect(points[0]).toMatchObject({ found: true, cx: 0.3, faceCount: 0 }); // the only face is a ghost — 0 REAL detections
  });

  it("with no second speaker on screen, pair is omitted", () => {
    const frames: SpeakerFrame[] = [{
      t: 0, faces: [{ cx: 0.5, cy: 0.5, w: 0.2, h: 0.3, trackId: 1, speaking: 0.02 }],
      speakerId: 1, secondId: null, voiced: true, cut: false,
    }];
    expect(toSamplePoints(frames)[0].pair).toBeUndefined();
  });
});

describe("toSamplePoints — merged-detection guard (regression: crop landing on the empty gap between two real people)", () => {
  it("flags recommendFit for a solo detection much wider than the clip's own typical single-face width", () => {
    // 8 frames of a normal single face (w≈0.06), then one frame reporting a
    // single, much-wider box (w=0.20 — 3x the clip's own baseline) at the
    // SAME position. That one frame is very likely a merged two-person box
    // whose center happens to land near the real face, not a genuine close-up.
    const normal = (t: number): SpeakerFrame => ({
      t, faces: [{ cx: 0.4, cy: 0.5, w: 0.06, h: 0.1, trackId: 1, speaking: 0.02 }],
      speakerId: 1, secondId: null, voiced: true, cut: false,
    });
    const wide: SpeakerFrame = {
      t: 0.8, faces: [{ cx: 0.4, cy: 0.5, w: 0.2, h: 0.3, trackId: 1, speaking: 0.02 }],
      speakerId: 1, secondId: null, voiced: true, cut: false,
    };
    const frames = [...Array.from({ length: 8 }, (_, i) => normal(i / 10)), wide];
    const points = toSamplePoints(frames);
    expect(points.slice(0, 8).every((p) => !p.recommendFit)).toBe(true);
    expect(points[8].recommendFit).toBe(true);
  });

  it("does NOT flag a clip that's genuinely all close-ups (no small reference frames to compare against)", () => {
    const frames: SpeakerFrame[] = Array.from({ length: 10 }, (_, i) => ({
      t: i / 10, faces: [{ cx: 0.5, cy: 0.5, w: 0.18 + (i % 2) * 0.01, h: 0.3, trackId: 1, speaking: 0.02 }],
      speakerId: 1, secondId: null, voiced: true, cut: false,
    }));
    const points = toSamplePoints(frames);
    expect(points.every((p) => !p.recommendFit)).toBe(true);
  });
});
