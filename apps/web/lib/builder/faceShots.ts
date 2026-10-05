/**
 * Face-tracked "shot" segmentation — the algorithm behind /dev/face-detect,
 * lifted out of that page so the Editor tab's Camera tool (preview AND burn)
 * runs the exact same thing.
 *
 * Input: one dense timeline from /api/video/detect-face-track (CenterFace at
 * SAMPLE_FPS, one point per sampled frame). Output: discrete fixed-position
 * shots (OpusClips-style): within a shot the crop is ONE averaged static point
 * (no per-frame jitter); moving to the next shot is a hard cut, not a pan. A
 * candidate state change only commits once sustained for SHOT_MIN_HOLD_S, so a
 * single misdetected frame never splits a shot. Membership is judged against a
 * FIXED anchor set when the shot starts (never a running mean), which is what
 * stops the crop drift-walking between two real speakers.
 *
 * Pure (no DOM, no server imports) — shared by the client preview and the
 * ffmpeg crop expression builder (lib/server/clipFilterGraph reframeFilter).
 */

import {
  type FramingMode, type FacePoint, MODE_TARGET_ZOOM, MODE_MAX_ZOOM, FIT_DEBOUNCE_S,
  planCamera, planFaceCrop, easeCamera, FIT_TARGET,
} from "@/lib/builder/cameraPlanner";
export {
  type FramingMode, MODE_TARGET_ZOOM, MODE_MAX_ZOOM, FACE_CROP_MIN_ZOOM, FACE_CROP_MAX_ZOOM, FACE_BIAS_Y, CAM_TAU_S,
  computeCoverGeometry, computeFramedGeometry, computeTrackedFaceGeometry,
} from "@/lib/builder/cameraPlanner";

/** One scanned point — always carries a usable (cx, cy) (frame-center when
 *  nothing was found) so interpolation never has a hole. `pair` = the two
 *  largest faces this frame (left-to-right), present only for 2+ faces. */
export interface SamplePoint {
  t: number; found: boolean; recommendFit: boolean; cx: number; cy: number; faceCount: number;
  pair?: { cx: number; cy: number; w: number }[];
  /** This sample starts a new camera SHOT (a real edit cut, from the dense
   *  scan's isHardCut pass) — an unconditional hard boundary for shot
   *  segmentation, never smoothed/held across like an ordinary reposition.
   *  Optional so a caller with no cut signal (a legacy/synthetic sample list)
   *  degrades to the old jitter-tolerant behavior everywhere. */
  cut?: boolean;
  /** Width (0..1 of frame) of the face this sample's cx/cy came from. Lets
   *  shot segmentation reject a same-position-looking sample that's actually
   *  a MERGED detection (CenterFace fusing two overlapping/adjacent people
   *  into one wide box sitting near the midpoint between them) — without
   *  this, a shot anchored on one real speaker silently averages in that
   *  merged box's midpoint position, and the committed crop ends up centered
   *  on the empty gap between both people instead of on either one. */
  w?: number;
}

/** How the camera arrives at this shot from the previous one. Absent = hard cut. */
export type ShotTransition = { kind: "pan"; durS: number };
/** A low-pass keyframe of the subject inside a FOLLOW shot (linear between). */
export interface ShotKey { t: number; cx: number; cy: number }
export interface FaceShot {
  startT: number; endT: number; cx: number; cy: number; confident: boolean;
  /** Present when the camera should EASE into this shot instead of cutting. */
  transition?: ShotTransition;
  /** Present when the subject moves enough inside the shot that a frozen point
   *  would leave them at the crop edge — the crop follows these keyframes. */
  path?: ShotKey[];
}

/** Must match detect-face-track/route.ts SAMPLE_FPS. */
export const FACE_SAMPLE_FPS = 10;
/** Longest window the tracker scans (route clamps durationS to this). */
export const FACE_SCAN_MAX_S = 120;

// Target "intentional" zoom per mode — the ACTUAL zoom applied is
// max(this, the minimum needed to keep the point in frame), capped by MAX.
/** How long a cropped⟷letterbox flip must be requested before it takes effect. */
export const FRAMING_DEBOUNCE_MS = 350;

// ── Smooth-camera tuning ──────────────────────────────────────────────────────
// A candidate new position must persist this long before it becomes a shot
// change (single-frame misdetections + brief head turns never cut).
const SHOT_MIN_HOLD_S = 0.7;
// Movement inside this radius is the SAME shot (a follow path absorbs it);
// beyond it a new shot starts. Two heads side by side sit ≥ ~0.3 apart.
const SHOT_POSITION_TOLERANCE = 0.22;
// Cut cadence: nothing shorter than this survives as its own shot — it merges
// into the positionally-closer neighbour. Rapid-fire cuts read as "unedited".
const MIN_SHOT_DURATION_S = 1.5;
// Between two confident shots, a reposition under this distance is an eased
// PAN; a real speaker switch (further) is a hard cut.
const PAN_MAX_DISTANCE = 0.4;
const PAN_MIN_S = 0.35, PAN_MAX_S = 0.8;
// A shot whose subject wanders (p90 deviation from the mean) past this becomes
// a FOLLOW shot: the crop rides a low-pass path instead of a frozen point.
const FOLLOW_SPREAD = 0.06;
const FOLLOW_KEY_S = 0.5;
const FOLLOW_MAX_KEYS = 400;
// Motion → zoom hint: busy footage pulls the mode's target zoom toward 1 so the
// wider window absorbs motion instead of the crop chasing it.
const ZOOM_MOTION_FLOOR = 0.03, ZOOM_MOTION_GAIN = 4;
const MEDIAN_RADIUS = 2;   // 5-sample median (10 fps → 0.5 s window)
const EMA_ALPHA = 0.35;    // follow-path smoothing

type PosPoint = { t: number; confident: boolean; cx: number; cy: number; alts?: { cx: number; cy: number }[]; cut?: boolean; w?: number };

/** True when `w` is far enough from `anchorW` that it's almost certainly a
 *  DIFFERENT kind of detection — a merged two-person box vs. a normal single
 *  face — rather than the same face measured slightly differently. Either
 *  width missing (legacy caller) always passes: no signal, no rejection. */
function widthMismatch(w: number | undefined, anchorW: number | undefined): boolean {
  if (!w || !anchorW) return false;
  const ratio = w / anchorW;
  return ratio < 0.55 || ratio > 1.8;
}

function sameShotState(a: { confident: boolean; cx: number; cy: number }, b: { confident: boolean; cx: number; cy: number }): boolean {
  if (a.confident !== b.confident) return false;
  if (!a.confident) return true;
  return Math.hypot(a.cx - b.cx, a.cy - b.cy) <= SHOT_POSITION_TOLERANCE;
}

function closestCandidate(p: PosPoint, ref: { cx: number; cy: number }): { cx: number; cy: number } {
  let best = { cx: p.cx, cy: p.cy };
  if (!p.alts) return best;
  let bestD = Math.hypot(best.cx - ref.cx, best.cy - ref.cy);
  for (const a of p.alts) {
    const d = Math.hypot(a.cx - ref.cx, a.cy - ref.cy);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

export function buildPositionShots(points: PosPoint[]): FaceShot[] {
  if (points.length === 0) return [];
  const shots: FaceShot[] = [];
  let curStart = points[0].t;
  let curConfident = points[0].confident;
  let anchor = { confident: curConfident, cx: curConfident ? points[0].cx : 0.5, cy: curConfident ? points[0].cy : 0.5 };
  let anchorW = curConfident ? points[0].w : undefined;
  let sumCx = curConfident ? points[0].cx : 0, sumCy = curConfident ? points[0].cy : 0, n = curConfident ? 1 : 0;

  let pendingStart: number | null = null;
  let pendingConfident = curConfident;
  let pendingAnchor = anchor;
  let pendingAnchorW = anchorW;
  let pendingSumCx = 0, pendingSumCy = 0, pendingN = 0;

  const commitShot = (endT: number) => {
    shots.push({ startT: curStart, endT, cx: n ? sumCx / n : 0.5, cy: n ? sumCy / n : 0.5, confident: curConfident });
  };

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    // A real edit cut — unconditional hard boundary. The wide-shot/close-up
    // cutaway on the other side is a genuinely different framing, not jitter
    // to hold through; committing immediately (instead of waiting out
    // SHOT_MIN_HOLD_S like an ordinary reposition) stops its position from
    // ever being averaged together with whatever came before the cut.
    if (p.cut && p.t > curStart) {
      commitShot(p.t);
      curStart = p.t;
      curConfident = p.confident;
      anchor = { confident: p.confident, cx: p.confident ? p.cx : 0.5, cy: p.confident ? p.cy : 0.5 };
      anchorW = p.confident ? p.w : undefined;
      sumCx = p.confident ? p.cx : 0;
      sumCy = p.confident ? p.cy : 0;
      n = p.confident ? 1 : 0;
      pendingStart = null;
      continue;
    }
    // A same-position-LOOKING sample whose width doesn't match the anchor's
    // is very likely a MERGED detection (two people fused into one wide box
    // near their midpoint), not the anchor's own face measured slightly
    // differently — treat it as a mismatch even though cx/cy alone would
    // have passed, so it can never get averaged into this shot's position.
    const widthOk = !p.confident || !widthMismatch(p.w, anchorW);
    const posVsCur = p.confident ? closestCandidate(p, anchor) : { cx: 0.5, cy: 0.5 };
    const state = { confident: p.confident, cx: posVsCur.cx, cy: posVsCur.cy };
    if (widthOk && sameShotState(state, anchor)) {
      pendingStart = null;
      if (p.confident) { sumCx += posVsCur.cx; sumCy += posVsCur.cy; n++; }
      continue;
    }
    const pendingWidthOk = !p.confident || !widthMismatch(p.w, pendingAnchorW);
    const posVsPending = p.confident ? closestCandidate(p, pendingAnchor) : { cx: 0.5, cy: 0.5 };
    const stateP = { confident: p.confident, cx: posVsPending.cx, cy: posVsPending.cy };
    if (pendingStart === null || pendingConfident !== stateP.confident || !pendingWidthOk || !sameShotState(stateP, pendingAnchor)) {
      pendingStart = p.t;
      pendingConfident = state.confident;
      pendingAnchor = { confident: state.confident, cx: posVsCur.cx, cy: posVsCur.cy };
      pendingAnchorW = state.confident ? p.w : undefined;
      pendingSumCx = state.confident ? posVsCur.cx : 0;
      pendingSumCy = state.confident ? posVsCur.cy : 0;
      pendingN = state.confident ? 1 : 0;
      continue;
    }
    if (stateP.confident) { pendingSumCx += posVsPending.cx; pendingSumCy += posVsPending.cy; pendingN++; }
    if (p.t - pendingStart >= SHOT_MIN_HOLD_S) {
      commitShot(pendingStart);
      curStart = pendingStart;
      curConfident = pendingConfident;
      anchor = pendingAnchor;
      anchorW = pendingAnchorW;
      sumCx = pendingConfident ? pendingSumCx : 0;
      sumCy = pendingConfident ? pendingSumCy : 0;
      n = pendingConfident ? pendingN : 0;
      pendingStart = null;
    }
  }
  commitShot(points[points.length - 1].t + 1);
  return mergeShortShots(shots);
}

function shotDist(a: FaceShot, b: FaceShot): number {
  if (a.confident !== b.confident) return Infinity;
  return a.confident ? Math.hypot(a.cx - b.cx, a.cy - b.cy) : 0;
}

/** Fold every too-short shot into the neighbour it is positionally closest to
 *  (the first shot may only fold forward). Repeats until nothing is short. */
function mergeShortShots(shots: FaceShot[]): FaceShot[] {
  let cur = shots;
  for (let pass = 0; pass < shots.length + 1; pass++) {
    if (cur.length < 2) break;
    const shortIdx = cur.findIndex((sh) => sh.endT - sh.startT < MIN_SHOT_DURATION_S);
    if (shortIdx === -1) break;
    const merged = cur.slice();
    const sh = merged[shortIdx];
    const prev = shortIdx > 0 ? merged[shortIdx - 1] : undefined;
    const next = shortIdx < merged.length - 1 ? merged[shortIdx + 1] : undefined;
    const intoPrev = prev && (!next || shotDist(sh, prev) <= shotDist(sh, next));
    if (intoPrev && prev) {
      merged[shortIdx - 1] = { ...prev, endT: sh.endT };
      merged.splice(shortIdx, 1);
    } else if (next) {
      merged[shortIdx + 1] = { ...next, startT: sh.startT };
      merged.splice(shortIdx, 1);
    } else break;
    cur = merged;
  }
  return coalesceSimilar(cur);
}

/** After folding, two neighbours can be the same state (a glance folded into
 *  A leaves A | A). Join them so the camera doesn't "cut" to where it already is. */
function coalesceSimilar(shots: FaceShot[]): FaceShot[] {
  const out: FaceShot[] = [];
  for (const sh of shots) {
    const prev = out[out.length - 1];
    if (prev && sameShotState(prev, sh)) {
      const dp = prev.endT - prev.startT, ds = sh.endT - sh.startT;
      const w = dp + ds || 1;
      out[out.length - 1] = {
        ...prev, endT: sh.endT,
        cx: prev.confident ? (prev.cx * dp + sh.cx * ds) / w : prev.cx,
        cy: prev.confident ? (prev.cy * dp + sh.cy * ds) / w : prev.cy,
      };
    } else out.push({ ...sh });
  }
  return out;
}

/** Sliding median over the confident points only (unconfident frames are left
 *  untouched so a real no-face gap still reads as a gap). Kills single-frame
 *  detector flicker without lagging a genuine step. */
function medianTrack(points: PosPoint[]): PosPoint[] {
  const med = (vals: number[]) => { const v = vals.slice().sort((a, b) => a - b); return v[v.length >> 1]; };
  return points.map((p, i) => {
    if (!p.confident) return p;
    const xs: number[] = [], ys: number[] = [];
    for (let k = Math.max(0, i - MEDIAN_RADIUS); k <= Math.min(points.length - 1, i + MEDIAN_RADIUS); k++) {
      if (points[k].confident) { xs.push(points[k].cx); ys.push(points[k].cy); }
    }
    return xs.length ? { ...p, cx: med(xs), cy: med(ys) } : p;
  });
}

/** Per-shot statistics off the (median-filtered) track: mean, p90 deviation,
 *  and an EMA-smoothed follow path bucketed at FOLLOW_KEY_S. */
function shotStats(track: PosPoint[], sh: FaceShot): { cx: number; cy: number; spread: number; path: ShotKey[] } {
  const pts = track.filter((p) => p.confident && p.t >= sh.startT && p.t < sh.endT);
  if (!pts.length) return { cx: sh.cx, cy: sh.cy, spread: 0, path: [] };
  const cx = pts.reduce((a, p) => a + p.cx, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.cy, 0) / pts.length;
  const dev = pts.map((p) => Math.hypot(p.cx - cx, p.cy - cy)).sort((a, b) => a - b);
  const spread = dev[Math.min(dev.length - 1, Math.floor(dev.length * 0.9))];
  // EMA both directions (forward then backward) → zero-lag low-pass.
  const fwd: { t: number; cx: number; cy: number }[] = [];
  let ex = pts[0].cx, ey = pts[0].cy;
  for (const p of pts) { ex += EMA_ALPHA * (p.cx - ex); ey += EMA_ALPHA * (p.cy - ey); fwd.push({ t: p.t, cx: ex, cy: ey }); }
  ex = fwd[fwd.length - 1].cx; ey = fwd[fwd.length - 1].cy;
  for (let i = fwd.length - 1; i >= 0; i--) { ex += EMA_ALPHA * (fwd[i].cx - ex); ey += EMA_ALPHA * (fwd[i].cy - ey); fwd[i] = { t: fwd[i].t, cx: ex, cy: ey }; }
  const dur = sh.endT - sh.startT;
  const bucket = Math.max(FOLLOW_KEY_S, dur / FOLLOW_MAX_KEYS);
  const path: ShotKey[] = [];
  for (let b0 = sh.startT; b0 < sh.endT; b0 += bucket) {
    const inB = fwd.filter((p) => p.t >= b0 && p.t < b0 + bucket);
    if (!inB.length) continue;
    path.push({
      t: Math.min(sh.endT, b0 + bucket / 2),
      cx: inB.reduce((a, p) => a + p.cx, 0) / inB.length,
      cy: inB.reduce((a, p) => a + p.cy, 0) / inB.length,
    });
  }
  return { cx, cy, spread, path };
}

export interface ShotPlan {
  shots: FaceShot[];
  /** Duration-weighted p90 subject motion across confident shots (0 = static). */
  motionScore: number;
  /** Zoom to use for `mode` given the motion: the mode's target for calm
   *  footage, pulled toward 1 (never below) as the subject moves more. */
  zoomHint: number;
}

export interface DualShotPlan {
  top: FaceShot[];
  bottom: FaceShot[];
}

/** Use the dense camera even when it found NO face: that is a deliberate fit
 * instruction, not permission to fall back to a blind centre crop. */
export function shouldUseCameraPlan(shots: FaceShot[], mode: FramingMode): boolean {
  return mode !== "full" && shots.length > 0;
}

/** Dual mode's two independent timelines from the detector's left-to-right
 * pair. Both sides become unconfident unless two faces persist, which makes
 * the preview/export collapse back to the primary single-person framing. */
export function buildDualShotPlan(samples: SamplePoint[]): DualShotPlan {
  const side = (idx: 0 | 1): PosPoint[] => medianTrack(samples.map((s) => {
    const hasPair = !!s.pair && s.pair.length >= 2;
    return {
      t: s.t,
      confident: hasPair,
      cx: hasPair ? s.pair![idx].cx : 0.5,
      cy: hasPair ? s.pair![idx].cy : 0.5,
    };
  }));
  return { top: buildPositionShots(side(0)), bottom: buildPositionShots(side(1)) };
}

/** Shot plan off the dense face track: jitter-proof segmentation with a cut
 *  cadence, eased pans for moderate repositions, follow paths for a moving
 *  subject, and a motion-aware zoom hint. The plan is the single source the
 *  Editor preview (cropAt) and the ffmpeg crop expression (shotCropExpr) share. */
export function buildShotPlan(samples: SamplePoint[], mode: FramingMode = "auto"): ShotPlan {
  // NOT alts: s.pair. `alts` lets a shot re-anchor to whichever of {primary,
  // alt} best matches the shot's existing anchor — built for the OLD largest-
  // face world, where a same-position two-shot's "primary" could flip between
  // two similarly-sized co-located faces (pure detector noise to smooth over).
  // The active-speaker signal (speakerTrack.ts) already picked cx deliberately
  // — it's not noise to reconcile — and the OTHER on-screen face is exactly
  // where the anchor was a moment ago, so passing it as an alt would let
  // closestCandidate silently snap every genuine speaker switch back to the
  // previous speaker's position, forever.
  const raw: PosPoint[] = samples.map((s) => ({ t: s.t, confident: s.found && !s.recommendFit, cx: s.cx, cy: s.cy, cut: s.cut, w: s.w }));
  const track = medianTrack(raw);
  const base = buildPositionShots(track);
  let weighted = 0, total = 0;
  const shots: FaceShot[] = base.map((sh) => {
    if (!sh.confident) return { ...sh };
    const st = shotStats(track, sh);
    const dur = Math.max(0, sh.endT - sh.startT);
    weighted += st.spread * dur; total += dur;
    const follow = st.spread > FOLLOW_SPREAD && st.path.length > 2;
    return { ...sh, cx: st.cx, cy: st.cy, ...(follow ? { path: st.path } : {}) };
  });
  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1], cur = shots[i];
    if (!prev.confident || !cur.confident) continue;
    const from = valueAt(prev, prev.endT), to = valueAt(cur, cur.startT);
    const d = Math.hypot(to.cx - from.cx, to.cy - from.cy);
    if (d < PAN_MAX_DISTANCE) {
      const durS = Math.min(PAN_MAX_S, Math.max(PAN_MIN_S, PAN_MIN_S + d * 1.1));
      shots[i] = { ...cur, transition: { kind: "pan", durS: Math.min(durS, Math.max(0.1, cur.endT - cur.startT)) } };
    }
  }
  const motionScore = total > 0 ? weighted / total : 0;
  return { shots, motionScore, zoomHint: zoomHintFor(mode, motionScore) };
}

/** The mode's target zoom, pulled toward 1 (never below) by subject motion —
 *  so the Editor can re-derive the hint when the operator switches modes. */
export function zoomHintFor(mode: FramingMode, motionScore: number): number {
  const target = MODE_TARGET_ZOOM[mode] ?? 1.2;
  return Math.max(1, Math.min(target, target - Math.max(0, motionScore - ZOOM_MOTION_FLOOR) * ZOOM_MOTION_GAIN));
}

/** Single-crop shot timeline off each frame's primary (largest) face, with the
 *  frame's other faces as alternates so a shot stays locked on ONE person. */
export function buildShots(samples: SamplePoint[]): FaceShot[] {
  return buildShotPlan(samples).shots;
}

export function shotAt(shots: FaceShot[], t: number): FaceShot | undefined {
  for (const sh of shots) if (t >= sh.startT && t < sh.endT) return sh;
  return shots[shots.length - 1];
}

/** The shot's own crop point at time t (path-interpolated for follow shots,
 *  frame-center when unconfident). Ignores the entry transition. */
function valueAt(sh: FaceShot, t: number): { cx: number; cy: number } {
  if (!sh.confident) return { cx: 0.5, cy: 0.5 };
  const path = sh.path;
  if (!path || path.length === 0) return { cx: sh.cx, cy: sh.cy };
  if (t <= path[0].t) return { cx: path[0].cx, cy: path[0].cy };
  for (let i = 1; i < path.length; i++) {
    if (t < path[i].t) {
      const a = path[i - 1], b = path[i];
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u };
    }
  }
  const last = path[path.length - 1];
  return { cx: last.cx, cy: last.cy };
}

const smoothstep = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

/** Crop center at time t — pans eased (smoothstep) from the previous shot's
 *  last point, follow shots interpolated along their path, cuts instantaneous.
 *  The ffmpeg expression from shotCropExpr evaluates to exactly this. */
export function cropAt(shots: FaceShot[], t: number): { cx: number; cy: number } {
  if (shots.length === 0) return { cx: 0.5, cy: 0.5 };
  let i = shots.findIndex((sh) => t >= sh.startT && t < sh.endT);
  if (i === -1) i = shots.length - 1;
  const sh = shots[i];
  const own = valueAt(sh, t);
  const tr = sh.transition;
  if (i > 0 && tr && tr.kind === "pan" && t < sh.startT + tr.durS) {
    const prev = shots[i - 1];
    const from = valueAt(prev, prev.endT);
    const s = smoothstep((t - sh.startT) / tr.durS);
    return { cx: from.cx + (own.cx - from.cx) * s, cy: from.cy + (own.cy - from.cy) * s };
  }
  return own;
}

const f4 = (v: number) => (Math.round(v * 10000) / 10000).toFixed(4);

/** ffmpeg per-frame expression (in `t`) for one axis of the crop center, in
 *  0..1 source-normalized units — the same piecewise/smoothstep/linear math as
 *  cropAt. Commas are UNESCAPED; the filtergraph builder escapes them.
 *
 *  ffmpeg's expression parser (libavutil/eval.c) refuses anything nested
 *  deeper than ~100 levels, and a dense camera plan carries up to
 *  MAX_PATH_KEYS_PER_CLIP keyframes — a linear if(lt(t,…),…,if(…)) chain over
 *  those fails every render with "Invalid argument". So the function is first
 *  flattened into ordered, non-nested pieces (one per shot × keyframe segment
 *  × pan window) and then emitted as a BALANCED binary search on t: depth is
 *  log2(pieces), a dozen levels even for thousands of pieces. */
export function shotCropExpr(shots: FaceShot[], axis: "cx" | "cy"): string {
  if (shots.length === 0) return "0.5000";
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  type Piece = { t0: number; expr: string };
  // The shot's own value as ordered pieces, each valid from t0 until the next.
  const ownPieces = (sh: FaceShot): Piece[] => {
    if (!sh.confident) return [{ t0: -Infinity, expr: "0.5000" }];
    const path = sh.path;
    if (!path || path.length === 0) return [{ t0: -Infinity, expr: f4(clamp01(sh[axis])) }];
    // Piecewise-linear over keyframes: before the first → first, after the last → last.
    const out: Piece[] = [{ t0: -Infinity, expr: f4(clamp01(path[0][axis])) }];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      const dt = Math.max(1e-6, b.t - a.t);
      out.push({ t0: a.t, expr: `${f4(clamp01(a[axis]))}+(${f4(clamp01(b[axis]) - clamp01(a[axis]))})*(t-${f4(a.t)})/${f4(dt)}` });
    }
    out.push({ t0: path[path.length - 1].t, expr: f4(clamp01(path[path.length - 1][axis])) });
    return out;
  };
  // Pieces restricted to [lo, hi): the piece active at lo, then every later one before hi.
  const clip = (pieces: Piece[], lo: number, hi: number): Piece[] => {
    const out: Piece[] = [];
    for (let k = 0; k < pieces.length; k++) {
      const next = k + 1 < pieces.length ? pieces[k + 1].t0 : Infinity;
      if (next <= lo || pieces[k].t0 >= hi) continue;
      out.push({ t0: Math.max(lo, pieces[k].t0), expr: pieces[k].expr });
    }
    return out;
  };

  const flat: Piece[] = [];
  for (let i = 0; i < shots.length; i++) {
    const sh = shots[i];
    // Shot i owns [end_{i-1}, end_i); the first reaches back to -∞ and the
    // last forward to +∞ so t past the scanned window keeps the final position.
    const lo = i === 0 ? -Infinity : shots[i - 1].endT;
    const hi = i === shots.length - 1 ? Infinity : sh.endT;
    if (!(hi > lo)) continue;
    const own = ownPieces(sh);
    const tr = sh.transition;
    if (i > 0 && tr && tr.kind === "pan" && sh.confident) {
      const prev = shots[i - 1];
      const from = f4(clamp01(valueAt(prev, prev.endT)[axis]));
      const u = `min(1,max(0,(t-${f4(sh.startT)})/${f4(tr.durS)}))`;
      const s = `(${u})*(${u})*(3-2*(${u}))`;
      const panEnd = Math.min(hi, sh.startT + tr.durS);
      for (const p of clip(own, lo, panEnd)) flat.push({ t0: p.t0, expr: `${from}+((${p.expr})-${from})*${s}` });
      for (const p of clip(own, Math.max(lo, panEnd), hi)) flat.push(p);
    } else {
      for (const p of clip(own, lo, hi)) flat.push(p);
    }
  }
  if (flat.length === 0) return "0.5000";
  // Drop pieces shadowed by a later one starting at the same instant.
  const pieces: Piece[] = [];
  for (const p of flat) {
    if (pieces.length && p.t0 <= pieces[pieces.length - 1].t0) pieces[pieces.length - 1] = { t0: pieces[pieces.length - 1].t0, expr: p.expr };
    else pieces.push(p);
  }
  // Balanced search: pieces[lo..hi], each valid from its t0 to the next's.
  const build = (lo: number, hi: number): string => {
    if (lo === hi) return pieces[lo].expr;
    const mid = (lo + hi + 1) >> 1;
    return `if(lt(t,${f4(pieces[mid].t0)}),${build(lo, mid - 1)},${build(mid, hi)})`;
  };
  return build(0, pieces.length - 1);
}


/** Compact, validated copy of a shot list for transport (burn payload /
 *  localStorage draft) — drops junk, clamps to 0..1, sorts by time. */
export function sanitizeShots(raw: unknown, maxShots = 400): FaceShot[] {
  if (!Array.isArray(raw)) return [];
  const out: FaceShot[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const startT = Number(o.startT), endT = Number(o.endT), cx = Number(o.cx), cy = Number(o.cy);
    if (![startT, endT, cx, cy].every(Number.isFinite) || endT <= startT) continue;
    const shot: FaceShot = {
      startT: Math.max(0, startT), endT, cx: Math.min(1, Math.max(0, cx)), cy: Math.min(1, Math.max(0, cy)),
      confident: o.confident === true,
    };
    const tr = o.transition as { kind?: unknown; durS?: unknown } | undefined;
    if (tr && typeof tr === "object" && tr.kind === "pan" && Number.isFinite(Number(tr.durS)) && Number(tr.durS) > 0) {
      shot.transition = { kind: "pan", durS: Math.min(5, Number(tr.durS)) };
    }
    if (Array.isArray(o.path)) {
      const path: ShotKey[] = [];
      for (const k of o.path as unknown[]) {
        if (!k || typeof k !== "object") continue;
        const kk = k as Record<string, unknown>;
        const kt = Number(kk.t), kx = Number(kk.cx), ky = Number(kk.cy);
        if (![kt, kx, ky].every(Number.isFinite)) continue;
        path.push({ t: kt, cx: Math.min(1, Math.max(0, kx)), cy: Math.min(1, Math.max(0, ky)) });
        if (path.length >= FOLLOW_MAX_KEYS) break;
      }
      if (path.length) shot.path = path.sort((a, b) => a.t - b.t);
    }
    out.push(shot);
    if (out.length >= maxShots) break;
  }
  return out.sort((a, b) => a.startT - b.startT);
}

/* ── Camera plan: the /dev/face-detect algorithm, baked into FaceShot paths ──
   buildShotPlan above is the legacy hard-cut segmentation. buildCameraPlan
   runs the SAME planner the lab page draws with (lib/builder/cameraPlanner):
   Auto / Pan both frame per committed shot (two heads → frame both or an
   animated L⇄R pan), Face Crop follows the dense scan, and the rendered camera
   is eased toward every target. The simulated camera path is then baked into
   ordinary FaceShot `path` keyframes, so the existing Editor preview (cropAt)
   and the burn (shotCropExpr → ffmpeg crop x/y expressions) play it back
   verbatim — one algorithm, three surfaces. */
export interface CameraGeometry { srcW: number; srcH: number; outW: number; outH: number }
export const DEFAULT_CAMERA_GEOMETRY: CameraGeometry = { srcW: 1920, srcH: 1080, outW: 1080, outH: 1920 };
const SIM_FPS = 30;
const PATH_TOLERANCE = 0.003;      // keyframe simplification error (frame fraction)
const MAX_PATH_KEYS_PER_CLIP = 240; // keeps the ffmpeg expression parse-safe

type SimFrame = { t: number; fit: boolean; cx: number; cy: number; zoom: number; shotKey: string };

/** Ramer–Douglas–Peucker on (t → cx,cy): keep only the keyframes needed to
 *  linearly reproduce the eased track within `tol`. */
function simplifyPath(pts: ShotKey[], tol: number): ShotKey[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a], B = pts[b];
    let worst = -1, worstErr = tol;
    for (let i = a + 1; i < b; i++) {
      const u = (pts[i].t - A.t) / Math.max(1e-6, B.t - A.t);
      const err = Math.max(Math.abs(A.cx + (B.cx - A.cx) * u - pts[i].cx), Math.abs(A.cy + (B.cy - A.cy) * u - pts[i].cy));
      if (err > worstErr) { worstErr = err; worst = i; }
    }
    if (worst !== -1) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function buildCameraPlan(samples: SamplePoint[], mode: FramingMode, geom: CameraGeometry = DEFAULT_CAMERA_GEOMETRY, zoomOverride?: number): ShotPlan {
  if (mode === "full" || samples.length === 0) return { shots: [], motionScore: 0, zoomHint: 1 };
  // Shot timelines for Auto / Pan both — same segmentation the lab uses.
  // NOT alts: s.pair. `alts` lets a shot re-anchor to whichever of {primary,
  // alt} best matches the shot's existing anchor — built for the OLD largest-
  // face world, where a same-position two-shot's "primary" could flip between
  // two similarly-sized co-located faces (pure detector noise to smooth over).
  // The active-speaker signal (speakerTrack.ts) already picked cx deliberately
  // — it's not noise to reconcile — and the OTHER on-screen face is exactly
  // where the anchor was a moment ago, so passing it as an alt would let
  // closestCandidate silently snap every genuine speaker switch back to the
  // previous speaker's position, forever.
  const raw: PosPoint[] = samples.map((s) => ({ t: s.t, confident: s.found && !s.recommendFit, cx: s.cx, cy: s.cy, cut: s.cut, w: s.w }));
  const track = medianTrack(raw);
  const shots = buildPositionShots(track);
  const pairPts = (idx: 0 | 1): PosPoint[] => samples.map((s) => {
    const has = !!s.pair && s.pair.length >= 2;
    return { t: s.t, confident: has, cx: has ? s.pair![idx].cx : 0.5, cy: has ? s.pair![idx].cy : 0.5 };
  });
  const leftShots = buildPositionShots(pairPts(0)), rightShots = buildPositionShots(pairPts(1));
  const faces: FacePoint[] = samples.map((s) => ({ t: s.t, found: s.found && !s.recommendFit, cx: s.cx, cy: s.cy }));
  const reliableTimes = samples.filter((s) => s.found && !s.recommendFit).map((s) => s.t);
  let nextReliable = 0;
  const zoom = zoomOverride ?? MODE_TARGET_ZOOM[mode];

  // Simulate the eased camera exactly as the lab's draw loop does.
  const endT = samples[samples.length - 1].t + 1 / FACE_SAMPLE_FPS;
  const frames: SimFrame[] = [];
  let cam: { cx: number; cy: number; zoom: number } | null = null;
  let fitActive = false, fitWant = false, fitSince = 0;
  let minAutoZoom = zoom;
  for (let f = 0; ; f++) {
    const t = f / SIM_FPS;
    if (t > endT) break;
    while (nextReliable < reliableTimes.length && reliableTimes[nextReliable] < t) nextReliable++;
    const nearestReliable = Math.min(
      nextReliable > 0 ? t - reliableTimes[nextReliable - 1] : Infinity,
      nextReliable < reliableTimes.length ? reliableTimes[nextReliable] - t : Infinity,
    );
    // Shot segmentation intentionally merges short gaps to suppress jitter,
    // but it must never keep a crop on empty space after the face genuinely
    // leaves. A >0.35s gap in the dense scan immediately fits the whole source.
    const noFaceNow = nearestReliable > 0.35;
    // Identity of the underlying discrete shot(s) active at this instant —
    // used ONLY to split simulated runs below, independent of which function
    // (planFaceCrop for zoom, planCamera for auto/pan) produced the target.
    // Without this, a "cropped" run that eases straight from one committed
    // shot to the next (never passing through a letterbox gap) was one giant
    // run whose reported cx/cy is the MEAN of its whole eased path — i.e. the
    // midpoint between two real, opposite speakers, not either one.
    const shotKey = `${shotAt(shots, t)?.startT ?? "-"}|${shotAt(leftShots, t)?.startT ?? "-"}|${shotAt(rightShots, t)?.startT ?? "-"}`;
    const target = noFaceNow ? FIT_TARGET : mode === "zoom"
      ? planFaceCrop(faces, t, cam, zoom)
      : planCamera(mode === "dual" ? "auto" : mode, t, shotAt(shots, t), shotAt(leftShots, t), shotAt(rightShots, t), geom.srcW, geom.srcH, geom.outW, geom.outH);
    if (f === 0) { fitWant = fitActive = target.fit; } // seed from the first frame — no phantom 0.35s crop before a letterbox
    if (target.fit !== fitWant) { fitWant = target.fit; fitSince = t; }
    if (fitWant !== fitActive && t - fitSince >= FIT_DEBOUNCE_S) fitActive = fitWant;
    const showFit = (noFaceNow || mode === "zoom") ? target.fit : fitActive;
    if (showFit) { cam = null; frames.push({ t, fit: true, cx: 0.5, cy: 0.5, zoom: 1, shotKey }); continue; }
    const goal = target.fit ? { cx: 0.5, cy: 0.5, zoom } : { cx: target.cx, cy: target.cy, zoom: target.zoom };
    cam = easeCamera(cam, goal, 1 / SIM_FPS);
    if (!target.fit && mode === "auto") minAutoZoom = Math.min(minAutoZoom, target.zoom);
    frames.push({ t, fit: false, cx: cam.cx, cy: cam.cy, zoom: cam.zoom, shotKey });
  }

  // Runs of cropped / letterboxed frames → FaceShots; cropped runs carry the
  // eased path as keyframes. The last shot extends past the final sample.
  // A run ALSO breaks when the underlying shot changes (see shotKey above),
  // even while staying continuously cropped — otherwise easing from one
  // committed shot straight into the next never shows up as two shots, and
  // gets averaged into one midpoint-of-both-speakers position instead.
  const out: FaceShot[] = [];
  let runStart = 0;
  for (let i = 1; i <= frames.length; i++) {
    if (i < frames.length && frames[i].fit === frames[runStart].fit && frames[i].shotKey === frames[runStart].shotKey) continue;
    const run = frames.slice(runStart, i);
    const startT = run[0].t, endT2 = i < frames.length ? frames[i].t : endT + 1;
    if (run[0].fit) out.push({ startT, endT: endT2, cx: 0.5, cy: 0.5, confident: false });
    else {
      const path = run.map((fr) => ({ t: fr.t, cx: fr.cx, cy: fr.cy }));
      const cx = path.reduce((a, k) => a + k.cx, 0) / path.length, cy = path.reduce((a, k) => a + k.cy, 0) / path.length;
      out.push({ startT, endT: endT2, cx, cy, confident: true, path });
    }
    runStart = i;
  }
  // Simplify every path; tighten further if the clip would exceed the key budget.
  let tol = PATH_TOLERANCE;
  for (let pass = 0; pass < 12; pass++) {
    let total = 0;
    for (const sh of out) if (sh.path) { sh.path = simplifyPath(sh.path, tol); total += sh.path.length; }
    if (total <= MAX_PATH_KEYS_PER_CLIP) break;
    tol *= 1.6;
  }
  for (const sh of out) if (sh.path && sh.path.length <= 1) delete sh.path;
  const motion = out.filter((sh) => sh.confident && sh.path).reduce((m, sh) => {
    const p = sh.path!; let d = 0;
    for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].cx - p[i - 1].cx, p[i].cy - p[i - 1].cy);
    return m + d;
  }, 0);
  // The burn uses one fixed zoom for the clip. Give it enough horizontal room
  // to center every tracked face; otherwise ffmpeg clamps the crop at the edge
  // even though the preview's cover geometry can zoom further at that instant.
  let zoomHint = mode === "auto" ? Math.max(1, minAutoZoom) : zoom;
  if (mode === "auto" && geom.srcW > 0 && geom.srcH > 0 && geom.outW > 0 && geom.outH > 0) {
    const baseScale = Math.max(geom.outW / geom.srcW, geom.outH / geom.srcH);
    const edgeZooms: number[] = [];
    for (const frame of frames) {
      if (frame.fit) continue;
      const edge = Math.max(0.02, Math.min(frame.cx, 1 - frame.cx));
      edgeZooms.push(geom.outW / (geom.srcW * baseScale * 2 * edge));
    }
    // One detector outlier should not force an entire clip to a tight crop.
    // The 95th percentile covers the sustained speaker position instead.
    edgeZooms.sort((a, b) => a - b);
    if (edgeZooms.length) zoomHint = Math.max(zoomHint, edgeZooms[Math.ceil((edgeZooms.length - 1) * 0.95)]);
    zoomHint = Math.min(MODE_MAX_ZOOM[mode], zoomHint);
  }
  return { shots: out, motionScore: motion / Math.max(1, endT), zoomHint };
}
