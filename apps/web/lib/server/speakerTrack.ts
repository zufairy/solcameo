import sharp from "sharp";
import type { FaceBox } from "./centerface";
import type { SamplePoint } from "@/lib/builder/faceShots";

/**
 * Active-speaker detection for the dense face scan (/api/video/detect-face-track
 * → /dev/face-detect, the Editor's Camera tool, and the burn).
 *
 * Why: the scan used to crop on the LARGEST face in every frame. On a podcast
 * two-shot the person nearer the camera is always biggest, so the crop sat on
 * them even while the other guest was talking — "it clips the one not talking".
 *
 * How (local, no API): a visual voice-activity signal per face, gated by the
 * audio track.
 *  1. Faces are linked frame-to-frame into tracks (nearest center, similar size).
 *  2. Per face per frame: mean abs pixel change of the MOUTH region between
 *     consecutive frames, minus the same measure on the upper face (eyes/brow).
 *     Talking moves the jaw/lips far more than the brow; a head turn, nod, or
 *     camera move moves both, so it cancels out.
 *  3. Audio RMS per sample decides when anyone is speaking at all — mouth
 *     motion only counts as speech evidence on voiced samples.
 *  4. The scan is OFFLINE (the whole clip is already decoded), so each track's
 *     evidence at a frame is the mean of its OWN voiced-frame motion in a small
 *     window CENTERED on that frame (±EVIDENCE_WINDOW_S), not a causal running
 *     average — a mid-word dip never looks like silence. The speaker is the
 *     argmax; switching to a new track needs a clear lead (SWITCH_RATIO) so a
 *     listener's single "mm-hmm" doesn't yank the camera. With no evidence yet
 *     (a new shot, nobody talking), the largest face is the fallback.
 */

export interface TrackedFace {
  cx: number; cy: number; w: number; h: number;
  trackId: number;
  /** Speaking evidence for this face's track around this frame (≥ 0). */
  speaking: number;
  /** This frame's raw mouth-motion measure (diagnostics / eval). */
  motion?: number;
  /** Not detected this frame — the speaker's last box, held through a flicker. */
  ghost?: boolean;
}

export interface SpeakerFrame {
  t: number;
  faces: TrackedFace[];
  /** Track id of the active speaker, or null with no faces. */
  speakerId: number | null;
  /** Most recent OTHER speaker still on screen (for Dual's second pane). */
  secondId: number | null;
  voiced: boolean;
  /** This frame starts a new camera SHOT (a real edit cut — see isHardCut),
   *  not just a reposition within the same continuous take. Downstream shot
   *  segmentation (lib/builder/faceShots.ts's buildPositionShots) must treat
   *  this as an unconditional hard boundary: a source that CUTS from a wide
   *  shot to a close-up cutaway (or back) is a genuinely different framing,
   *  not jitter to smooth through — trying to "hold" across it just averages
   *  two unrelated positions into a meaningless midpoint. */
  cut: boolean;
}

// ── Tuning ──────────────────────────────────────────────────────────────────
/** Max center distance (frame fractions) to continue a track between samples. */
const TRACK_MAX_DIST = 0.12;
/** A track missing longer than this is retired (person left / hard cut). Long
 *  on purpose: small/profile faces flicker in and out of detection, and a face
 *  that comes back at the same spot must keep its id (and its evidence). */
const TRACK_TTL_S = 6.0;
/** While the speaker's face is briefly undetected, hold their last box this long
 *  instead of jumping the crop to whoever else is visible. */
const GHOST_HOLD_S = 1.5;
/** Half-width of the centered evidence window. */
const EVIDENCE_WINDOW_S = 0.6;
/** A challenger must beat the current speaker's evidence by this factor. */
const SWITCH_RATIO = 1.15;
/** Evidence at or below this is "nobody clearly talking" — keep the speaker. */
const MIN_EVIDENCE = 0.002;

/** Link per-frame detections into tracks. Pure — exported for tests. */
export function assignTracks(frames: { t: number; faces: { cx: number; cy: number; w: number }[] }[], cuts: boolean[] = []): number[][] {
  type Track = { id: number; cx: number; cy: number; w: number; lastT: number };
  let nextId = 0;
  let live: Track[] = [];
  return frames.map(({ t, faces }, i) => {
    live = cuts[i] ? [] : live.filter((tr) => t - tr.lastT <= TRACK_TTL_S);
    const ids = new Array<number>(faces.length).fill(-1);
    // Greedy global nearest-pair matching (few faces per frame, so O(n²) is fine).
    const pairs: { fi: number; ti: number; d: number }[] = [];
    faces.forEach((f, fi) => live.forEach((tr, ti) => {
      const ratio = f.w / Math.max(1e-6, tr.w);
      if (ratio < 0.55 || ratio > 1.8) return;
      const d = Math.hypot(f.cx - tr.cx, f.cy - tr.cy);
      if (d <= TRACK_MAX_DIST) pairs.push({ fi, ti, d });
    }));
    pairs.sort((a, b) => a.d - b.d);
    const usedT = new Set<number>();
    for (const p of pairs) {
      if (ids[p.fi] !== -1 || usedT.has(p.ti)) continue;
      ids[p.fi] = live[p.ti].id;
      usedT.add(p.ti);
      Object.assign(live[p.ti], { cx: faces[p.fi].cx, cy: faces[p.fi].cy, w: faces[p.fi].w, lastT: t });
    }
    faces.forEach((f, fi) => {
      if (ids[fi] !== -1) return;
      const tr = { id: nextId++, cx: f.cx, cy: f.cy, w: f.w, lastT: t };
      live.push(tr);
      ids[fi] = tr.id;
    });
    return ids;
  });
}

/** Per-sample voiced flags from mono float PCM. Adaptive threshold between the
 *  noise floor and loud speech, so it works on quiet and hot mixes alike. */
export function voicedFlags(pcm: Float32Array, sampleRate: number, fps: number, count: number): boolean[] {
  const win = Math.max(1, Math.round(sampleRate / fps));
  const rms: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * win, b = Math.min(pcm.length, a + win);
    let s = 0;
    for (let j = a; j < b; j++) s += pcm[j] * pcm[j];
    rms.push(b > a ? Math.sqrt(s / (b - a)) : 0);
  }
  const sorted = rms.slice().sort((x, y) => x - y);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const floor = q(0.1), loud = q(0.9);
  if (loud <= 1e-4) return rms.map(() => false);
  const thr = floor + 0.2 * (loud - floor);
  return rms.map((r) => r > thr);
}

/** Choose the speaker per frame from per-face mouth motion + voiced flags.
 *  Pure — exported for tests. `mouth[i][k]` is face k of frame i's motion.
 *
 *  The scan is OFFLINE (the whole window is known), so evidence is a CENTERED
 *  window — no causal lag. Per track and frame: mean mouth motion over
 *  ±EVIDENCE_WINDOW_S of voiced frames inside the same camera shot (falls back
 *  to all frames of the window when nobody spoke in it). The speaker is the
 *  argmax, with light hysteresis so near-ties don't flicker. */
export function chooseSpeakers(
  frames: { t: number; faces: { cx: number; cy: number; w: number; h: number }[] }[],
  trackIds: number[][],
  mouth: number[][],
  voiced: boolean[],
  fps: number,
  /** cuts[i] = frame i starts a new camera shot (hard edit cut). */
  cuts: boolean[] = [],
): SpeakerFrame[] {
  const n = frames.length;
  // Shot index per frame (windows never cross a cut).
  const shot: number[] = [];
  for (let i = 0, sh = 0; i < n; i++) { if (i > 0 && cuts[i]) sh++; shot.push(sh); }
  // Per-track motion series (NaN = not detected that frame).
  const series = new Map<number, Float64Array>();
  trackIds.forEach((ids, i) => ids.forEach((id, k) => {
    let a = series.get(id);
    if (!a) { a = new Float64Array(n).fill(NaN); series.set(id, a); }
    a[i] = mouth[i]?.[k] ?? 0;
  }));
  const W = Math.max(1, Math.round(EVIDENCE_WINDOW_S * fps));
  const evidenceAt = (id: number, i: number): number => {
    const a = series.get(id);
    if (!a) return 0;
    let sv = 0, nv = 0, sa = 0, na = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
      if (shot[j] !== shot[i] || Number.isNaN(a[j])) continue;
      sa += a[j]; na++;
      if (voiced[j]) { sv += a[j]; nv++; }
    }
    return nv >= 2 ? sv / nv : na ? (sa / na) * 0.5 : 0;
  };

  const lastBox = new Map<number, { cx: number; cy: number; w: number; h: number; t: number }>();
  const lastSpokeAt = new Map<number, number>();
  let speaker: number | null = null;

  return frames.map((fr, i) => {
    const ids = trackIds[i];
    const v = voiced[i] ?? false;
    if (cuts[i]) { speaker = null; lastBox.clear(); }
    fr.faces.forEach((f, k) => lastBox.set(ids[k], { cx: f.cx, cy: f.cy, w: f.w, h: f.h, t: fr.t }));
    const faces: TrackedFace[] = fr.faces.map((f, k) => ({
      cx: f.cx, cy: f.cy, w: f.w, h: f.h, trackId: ids[k], speaking: evidenceAt(ids[k], i), motion: mouth[i]?.[k] ?? 0,
    }));
    // Speaker momentarily undetected (profile turn, hand over mouth, a missed
    // frame) → keep them at their last spot rather than cutting away.
    if (speaker !== null && !ids.includes(speaker) && faces.length > 0) {
      const b = lastBox.get(speaker);
      if (b && fr.t - b.t <= GHOST_HOLD_S) {
        faces.push({ cx: b.cx, cy: b.cy, w: b.w, h: b.h, trackId: speaker, speaking: evidenceAt(speaker, i), ghost: true });
      }
    }
    if (faces.length === 0) return { t: fr.t, faces, speakerId: null, secondId: null, voiced: v, cut: cuts[i] === true };

    const best = faces.slice().sort((a, b) => b.speaking - a.speaking)[0];
    const largest = faces.filter((f) => !f.ghost).sort((a, b) => b.w - a.w)[0] ?? best;
    const cur = speaker === null ? undefined : faces.find((f) => f.trackId === speaker);
    if (faces.length === 1) {
      speaker = faces[0].trackId;
    } else if (!cur) {
      speaker = best.speaking > MIN_EVIDENCE ? best.trackId : largest.trackId;
    } else if (best.trackId !== cur.trackId && best.speaking > MIN_EVIDENCE && best.speaking > cur.speaking * SWITCH_RATIO) {
      speaker = best.trackId;
    }
    if (v) lastSpokeAt.set(speaker!, fr.t);

    // Second pane: the other face that spoke most recently, else the one with
    // the most evidence, else the next largest.
    const others = faces.filter((f) => f.trackId !== speaker && !f.ghost);
    const secondId = others.length === 0 ? null : others.slice().sort((a, b) =>
      (lastSpokeAt.get(b.trackId) ?? -1) - (lastSpokeAt.get(a.trackId) ?? -1)
      || b.speaking - a.speaking
      || b.w - a.w,
    )[0].trackId;
    return { t: fr.t, faces, speakerId: speaker, secondId, voiced: v, cut: cuts[i] === true };
  });
}

/** Grayscale raw frame loaded once per sample for mouth-motion diffs. */
export interface Gray { data: Buffer; width: number; height: number }
export async function loadGray(path: string): Promise<Gray> {
  const { data, info } = await sharp(path).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Mean abs diff (0..1) of region R in `cur` vs the same region shifted by
 *  (dx, dy) in `prev`. */
function shiftedDiff(prev: Gray, cur: Gray, xa: number, ya: number, xb: number, yb: number, dx: number, dy: number): number {
  let s = 0, n = 0;
  for (let y = ya; y < yb; y++) {
    const py = y + dy;
    if (py < 0 || py >= prev.height) continue;
    const rc = y * cur.width, rp = py * prev.width;
    for (let x = xa; x < xb; x++) {
      const px = x + dx;
      if (px < 0 || px >= prev.width) continue;
      s += Math.abs(cur.data[rc + x] - prev.data[rp + px]); n++;
    }
  }
  return n ? s / n / 255 : 1;
}

/** Non-rigid motion of the lower face between two frames: the residual change
 *  after the best small rigid alignment. A head bob, lean, or camera drift is a
 *  translation of the whole patch and aligns away; an opening/closing jaw and
 *  moving lips can't, so what's left is (mostly) talking. The band spans the
 *  full box width plus a margin — on a profile face the lips sit at the box's
 *  front edge, not its center. */
export function mouthMotion(prev: Gray, cur: Gray, px: FaceBox["px"]): number {
  const w = px.x2 - px.x1, h = px.y2 - px.y1;
  const xa = Math.max(0, Math.floor(px.x1 - 0.12 * w)), xb = Math.min(cur.width, Math.ceil(px.x2 + 0.12 * w));
  const ya = Math.max(0, Math.floor(px.y1 + 0.55 * h)), yb = Math.min(cur.height, Math.ceil(px.y1 + 1.02 * h));
  if (xb - xa < 3 || yb - ya < 3) return 0;
  // Search radius scales with face size (~6% of face width, ≥1px).
  const r = Math.max(1, Math.round(0.06 * w));
  let best = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = shiftedDiff(prev, cur, xa, ya, xb, yb, dx, dy);
      if (d < best) best = d;
    }
  }
  return Number.isFinite(best) ? best : 0;
}

/** Decode the source's audio to mono float PCM (16 kHz) via an injected runner. */
export async function readMonoPcm(
  runFfmpeg: (args: string[]) => Promise<void>,
  srcPath: string, outPath: string, durationS: number, startS = 0,
): Promise<Float32Array | null> {
  try {
    const { runWithMonoFallback } = await import("./ffmpegBin");
    await runWithMonoFallback(runFfmpeg, ["-y", ...(startS > 0 ? ["-ss", String(startS)] : []), "-i", srcPath, "-t", String(durationS), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", outPath]);
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(outPath);
    return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  } catch {
    return null; // no audio stream → every frame unvoiced → largest-face fallback
  }
}

/** A hard edit cut between two consecutive samples: most of the frame changed
 *  at once (coarse 16×9 luma grid, so motion inside a shot doesn't trigger). */
export function isHardCut(prev: Gray, cur: Gray): boolean {
  const gx = 16, gy = 9;
  let changed = 0;
  for (let cy = 0; cy < gy; cy++) {
    for (let cx = 0; cx < gx; cx++) {
      const x0 = Math.floor((cx * cur.width) / gx), x1 = Math.floor(((cx + 1) * cur.width) / gx);
      const y0 = Math.floor((cy * cur.height) / gy), y1 = Math.floor(((cy + 1) * cur.height) / gy);
      let a = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y += 2) {
        const row = y * cur.width;
        for (let x = x0; x < x1; x += 2) { a += prev.data[row + x]; b += cur.data[row + x]; n++; }
      }
      if (n && Math.abs(a - b) / n > 18) changed++;
    }
  }
  return changed / (gx * gy) > 0.35;
}

/** Full pass: tracks + mouth motion + speaker choice for a scanned frame list. */
export async function analyzeSpeakers(
  frames: { t: number; path: string; faces: FaceBox[] }[],
  pcm: Float32Array | null,
  fps: number,
): Promise<SpeakerFrame[]> {
  const mouth: number[][] = [];
  const cuts: boolean[] = [];
  let prev: Gray | null = null;
  for (const f of frames) {
    let cur: Gray | null = null;
    try { cur = await loadGray(f.path); } catch { cur = null; }
    const same = !!(prev && cur && prev.width === cur.width && prev.height === cur.height);
    cuts.push(same ? isHardCut(prev!, cur!) : true);
    mouth.push(f.faces.map((face) => (same && !cuts[cuts.length - 1] ? mouthMotion(prev!, cur!, face.px) : 0)));
    prev = cur;
  }
  // Tracks never continue across a cut (a close-up face at x=0.5 is not the
  // wide shot's face that happened to sit near x=0.5).
  const trackIds = assignTracks(frames.map((f) => ({ t: f.t, faces: f.faces })), cuts);
  const voiced = pcm ? voicedFlags(pcm, 16000, fps, frames.length) : frames.map(() => false);
  return chooseSpeakers(frames, trackIds, mouth, voiced, fps, cuts);
}

/** A face narrower than this fraction of frame width is a distant/background
 *  figure — matches faceTrack.ts's TINY_W. Was 0.05, which flagged EVERY face
 *  in a normal wide podcast 2-shot (two guests left/right, heads ~4% of a 16:9
 *  frame) as "tiny" → recommendFit → the active-speaker signal was discarded
 *  and the camera parked on one side (or the middle) for the whole clip. A 9:16
 *  crop of 16:9 is ~26% of the frame wide at the 1.2x Auto zoom, so a 2% face
 *  is still ~8% of the crop — a clearly visible head. Only genuinely distant
 *  figures (a stage, a crowd) fall under this now. */
const TINY_FACE_W = 0.02;
/** A single detection wider than this multiple of the clip's OWN typical
 *  single-face width is treated as a MERGED box (CenterFace fusing two
 *  overlapping/adjacent people into one wide box near their midpoint), not a
 *  genuine close-up. Adaptive rather than a fixed pixel/fraction ceiling, so
 *  a clip that's ALL close-ups (naturally wide single faces throughout)
 *  isn't punished just for having no "small" reference frames. */
const MERGED_WIDTH_RATIO = 2.0;

/** SpeakerFrame[] (this module's output) → SamplePoint[] (lib/builder/
 *  faceShots.ts's input) — the single mapping BOTH the dense-scan API route
 *  (/api/video/detect-face-track, feeding /dev/face-detect + the Editor's
 *  Camera tool) and the cloud clip-render pipeline (lib/server/clipRender.ts,
 *  AI Clipping's clip.facetrack skill) build their camera plan from, so the
 *  two surfaces can never quietly drift apart into two different algorithms.
 *  cx/cy come from whoever `chooseSpeakers` picked as the active speaker —
 *  NOT the largest face — and `pair` carries the speaker + whoever spoke most
 *  recently, for Dual mode / multi-guest fit-and-pan framing. */
export function toSamplePoints(frames: SpeakerFrame[]): SamplePoint[] {
  // Adaptive "normal single face" baseline for THIS scan: the median width of
  // frames where exactly one real face was seen. Frames with 2+ faces are
  // excluded — a merged box's width is only diagnostic when there's nothing
  // else on screen to have legitimately caused a wide detection.
  const soloWidths = frames
    .map((fr) => ({ n: fr.faces.filter((f) => !f.ghost).length, w: fr.faces.find((f) => !f.ghost)?.w }))
    .filter((x) => x.n === 1 && typeof x.w === "number")
    .map((x) => x.w!)
    .sort((a, b) => a - b);
  const typicalSoloW = soloWidths.length >= 5 ? soloWidths[Math.floor(soloWidths.length / 2)] : undefined;

  return frames.map((fr) => {
    const rawCount = fr.faces.filter((f) => !f.ghost).length;
    if (fr.speakerId === null || fr.faces.length === 0) {
      return { t: fr.t, found: false, cx: 0.5, cy: 0.5, recommendFit: true, faceCount: rawCount, cut: fr.cut };
    }
    const primary = fr.faces.find((f) => f.trackId === fr.speakerId);
    if (!primary) return { t: fr.t, found: false, cx: 0.5, cy: 0.5, recommendFit: true, faceCount: rawCount, cut: fr.cut };
    const secondFace = fr.secondId === null ? undefined : fr.faces.find((f) => f.trackId === fr.secondId);
    const pair = secondFace
      ? [primary, secondFace].sort((a, b) => a.cx - b.cx).map((f) => ({ cx: f.cx, cy: f.cy, w: f.w }))
      : undefined;
    // A solo detection much wider than typical is very likely a merged box —
    // don't trust its position as a real anchor; letterbox this instant
    // instead of confidently cropping to the (fabricated) midpoint it implies.
    const likelyMerged = rawCount === 1 && !!typicalSoloW && primary.w > typicalSoloW * MERGED_WIDTH_RATIO;
    const recommendFit = primary.w < TINY_FACE_W || likelyMerged;
    return { t: fr.t, found: true, cx: primary.cx, cy: primary.cy, recommendFit, faceCount: rawCount, pair, cut: fr.cut, w: primary.w };
  });
}
