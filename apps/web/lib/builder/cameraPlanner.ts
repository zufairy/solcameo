/* Camera planner — the /dev/face-detect algorithm, shared by the lab page, the
   Editor preview and the burn (via lib/builder/faceShots.buildCameraPlan).
   Pure functions, no React, no ffmpeg.

   Two layers:
   - planCamera / planFaceCrop decide WHERE the camera should be at time t
     (a CamTarget) from the scan — per committed shot for Auto / Pan both,
     straight off the dense scan for Face Crop.
   - The caller eases the rendered camera toward that target with a
     critically-damped exponential (CAM_TAU_S), so a shot cut reads as a fast
     eased move (~3τ ≈ 0.5s) instead of a one-frame jump, and a moving pan
     target is followed without lag artifacts. */

export type FramingMode = "auto" | "zoom" | "pan" | "dual" | "full";
/** One committed shot: a fixed framing held over [startT, endT). */
export type ShotLike = { startT: number; endT: number; cx: number; cy: number; confident: boolean };
export type CamTarget = { fit: boolean; cx: number; cy: number; zoom: number; maxZoom: number };

export const MODE_TARGET_ZOOM: Record<FramingMode, number> = { auto: 1.2, zoom: 1.35, pan: 1.12, dual: 1.3, full: 1 };
export const MODE_MAX_ZOOM: Record<FramingMode, number> = { auto: 3, zoom: 2.6, pan: 2.2, dual: 2.4, full: 1 };
export const FACE_CROP_MIN_ZOOM = 0.9;
export const FACE_CROP_MAX_ZOOM = 2;

export const CAM_TAU_S = 0.16;            // cut ease time constant
export const FACE_BIAS_Y = 0.40;          // face lands at 40% of pane height (upper third-ish)
export const PAN_HOLD_S = 1.2;            // dwell on each head
export const PAN_MOVE_S = 1.6;            // eased travel between heads
export const BOTH_MARGIN = 0.16;          // extra width (frame fraction) around a 2-shot
export const FIT_DEBOUNCE_S = 0.35;       // a crop⟷letterbox flip must hold this long to be real
const ease = (x: number) => x * x * (3 - 2 * x); // smoothstep

export const FIT_TARGET: CamTarget = { fit: true, cx: 0.5, cy: 0.5, zoom: 1, maxZoom: 1 };

/** Cover-fit geometry: scale the source so it covers the pane at ≥ targetZoom ×
 *  the covering scale (raised as needed so the point can sit at pane centre
 *  without exposing an edge, capped at maxZoom), then position it. */
export function computeCoverGeometry(
  cx: number, cy: number, naturalW: number, naturalH: number, containerW: number, containerH: number,
  targetZoom: number, maxZoom: number,
): { width: number; height: number; left: number; top: number } {
  if (!naturalW || !naturalH || !containerW || !containerH) {
    return { width: containerW, height: containerH, left: 0, top: 0 };
  }
  const baseScale = Math.max(containerW / naturalW, containerH / naturalH);
  const EPS = 0.02; // guards the /0 as cx/cy approach a frame edge
  const needScaleX = containerW / (naturalW * 2 * Math.max(EPS, Math.min(cx, 1 - cx)));
  const needScaleY = containerH / (naturalH * 2 * Math.max(EPS, Math.min(cy, 1 - cy)));
  const scale = Math.min(baseScale * maxZoom, Math.max(baseScale * targetZoom, needScaleX, needScaleY));
  const width = naturalW * scale, height = naturalH * scale;
  const minCx = containerW / (2 * width), minCy = containerH / (2 * height);
  const ccx = Math.min(Math.max(cx, minCx), 1 - minCx);
  const ccy = Math.min(Math.max(cy, minCy), 1 - minCy);
  return { width, height, left: containerW / 2 - ccx * width, top: containerH / 2 - ccy * height };
}

/** Cover geometry with the face biased toward the upper part of the pane. */
export function computeFramedGeometry(cx: number, cy: number, naturalW: number, naturalH: number, paneW: number, paneH: number, zoom: number, maxZoom: number) {
  const g0 = computeCoverGeometry(cx, cy, naturalW, naturalH, paneW, paneH, zoom, maxZoom);
  const paneFrac = paneH / g0.height; // pane height as a fraction of the scaled frame
  return computeCoverGeometry(cx, cy + (0.5 - FACE_BIAS_Y) * paneFrac, naturalW, naturalH, paneW, paneH, zoom, maxZoom);
}

/** Face Crop keeps the operator's chosen size instead of silently zooming in
 * to hide a source edge. An off-centre portrait face can therefore be centred
 * with a blurred extension behind the uncovered side of the sharp frame. */
export function computeTrackedFaceGeometry(cx: number, cy: number, naturalW: number, naturalH: number, paneW: number, paneH: number, zoom: number) {
  const scale = Math.max(paneW / naturalW, paneH / naturalH) * Math.max(FACE_CROP_MIN_ZOOM, zoom);
  const width = naturalW * scale, height = naturalH * scale;
  return {
    width, height,
    left: paneW / 2 - cx * width,
    top: height < paneH ? (paneH - height) / 2 : Math.min(0, Math.max(paneH - height, paneH * FACE_BIAS_Y - cy * height)),
  };
}

/** Visible frame-width fraction of a cover crop at `zoom` for this pane. */
export function visibleWidthFrac(naturalW: number, naturalH: number, paneW: number, paneH: number, zoom: number): number {
  const baseScale = Math.max(paneW / naturalW, paneH / naturalH);
  return paneW / (naturalW * baseScale * zoom);
}

/** Ping-pong between two heads: hold L → ease to R → hold R → ease to L … */
export function panProgress(sinceS: number): number {
  const cycle = 2 * (PAN_HOLD_S + PAN_MOVE_S);
  const u = ((sinceS % cycle) + cycle) % cycle;
  if (u < PAN_HOLD_S) return 0;
  if (u < PAN_HOLD_S + PAN_MOVE_S) return ease((u - PAN_HOLD_S) / PAN_MOVE_S);
  if (u < 2 * PAN_HOLD_S + PAN_MOVE_S) return 1;
  return 1 - ease((u - 2 * PAN_HOLD_S - PAN_MOVE_S) / PAN_MOVE_S);
}

/** Auto / Pan both target for time t from the primary shot + the two-head
 *  (left/right) shot timelines. Geometry (source + pane size) decides whether
 *  two heads can share one pane. */
export function planCamera(
  mode: "auto" | "pan" | "zoom", t: number,
  shot: ShotLike | undefined, topShot: ShotLike | undefined, bottomShot: ShotLike | undefined,
  naturalW: number, naturalH: number, paneW: number, paneH: number,
): CamTarget {
  const one = !!shot?.confident;
  const two = !!topShot?.confident && !!bottomShot?.confident;
  if (!one && !two) return FIT_TARGET;
  const face = (cx: number, cy: number, zoom: number, maxZoom: number): CamTarget => ({ fit: false, cx, cy, zoom, maxZoom });
  const primary = shot?.confident ? shot : (topShot as ShotLike);
  const single = face(primary.cx, primary.cy, MODE_TARGET_ZOOM[mode], MODE_MAX_ZOOM[mode]);
  if (mode === "zoom" || !two) return single;
  const L = topShot!, R = bottomShot!;
  const span = Math.abs(R.cx - L.cx) + BOTH_MARGIN;
  const midCx = (L.cx + R.cx) / 2, midCy = (L.cy + R.cy) / 2;
  if (mode === "auto") {
    // A portrait source can technically fit two widely separated heads at 1×,
    // but doing so strands the active speaker at the edge. Only share the
    // frame when the heads are actually close; otherwise follow the speaker.
    const fitZoom = visibleWidthFrac(naturalW, naturalH, paneW, paneH, 1) / span;
    if (fitZoom >= 1 && Math.abs(R.cx - L.cx) <= 0.18) return face(midCx, midCy, Math.min(MODE_TARGET_ZOOM.auto, fitZoom), Math.min(MODE_MAX_ZOOM.auto, fitZoom));
    // When the heads cannot share a comfortable close frame, follow the main
    // speaker rather than using a blind
    // metronome. `shot` is the speaker-prioritized single-track pick (built
    // from the SAME dense scan L/R came from), so pick whichever of L/R it
    // currently sits closer to and crop tight on THAT one. The caller's own
    // eased-camera loop smooths the cut when the active side changes, same
    // as every other branch here — no separate ease-in needed.
    const activeCx = shot?.confident ? shot.cx : midCx;
    const nearL = Math.abs(activeCx - L.cx) <= Math.abs(activeCx - R.cx);
    return face(nearL ? L.cx : R.cx, nearL ? L.cy : R.cy, MODE_TARGET_ZOOM.auto, MODE_MAX_ZOOM.auto);
  }
  // Pan both: a deliberate, scripted L⇄R animation so each guest is shown in
  // turn regardless of who's currently talking — that IS this mode's whole
  // point ("Pan both, keyframe-pan left→right so each guest is seen"), unlike
  // Auto's speaker-follow above. Clock starts when this pair-shot began so a
  // cut restarts the dwell.
  const since = t - Math.max(L.startT, R.startT);
  const k = panProgress(since);
  return face(L.cx + (R.cx - L.cx) * k, L.cy + (R.cy - L.cy) * k, MODE_TARGET_ZOOM.pan, MODE_MAX_ZOOM.pan);
}

/* ── Face Crop: continuous face follow off the DENSE scan ──
   The shot timeline only trusts "confident" samples (face found AND not tiny)
   and letterboxes everything else — right for Auto, wrong for a mode whose
   whole promise is "always cropped on the face". Face Crop reads the raw
   samples: any found face counts (tiny included), the target is a windowed
   MEDIAN of face positions around t (kills per-frame detector jitter without
   lag), and a short gap in detection is bridged from the nearest stable face.
   Only a long faceless stretch (title card, empty room) letterboxes. */
export type FacePoint = { t: number; found: boolean; cx: number; cy: number };
export const FACE_WINDOW_S = 0.22;    // ± window for the median; short enough to follow a quick move
export const FACE_HOLD_S = 0.45;      // brief detector flicker only; don't linger on an empty crop
export const FACE_DEADBAND = 0.012;   // ignore target moves smaller than this (frame fraction)
export const FACE_STABLE_S = 0.3;     // a detection counts only if ≥2 neighbours within ±this…
export const FACE_STABLE_DIST = 0.12; // …also found the face within this distance (kills one-off false positives)

const median = (xs: number[]) => { const a = xs.slice().sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };

/** Temporal-consistency filter: keep a found sample only when the face is
 *  also found nearby in time at roughly the same spot. A detector spike on a
 *  sweater/hand/back-of-head appears for a frame or two and jumps around; a
 *  real face persists. Memoised per samples array (called every frame). */
const stableCache = new WeakMap<FacePoint[], FacePoint[]>();
export function stableFaces(samples: FacePoint[]): FacePoint[] {
  const hit = stableCache.get(samples);
  if (hit) return hit;
  const out: FacePoint[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s.found) continue;
    let support = 0;
    for (let j = i - 1; j >= 0 && s.t - samples[j].t <= FACE_STABLE_S; j--) if (samples[j].found && Math.hypot(samples[j].cx - s.cx, samples[j].cy - s.cy) <= FACE_STABLE_DIST) support++;
    for (let j = i + 1; j < samples.length && samples[j].t - s.t <= FACE_STABLE_S; j++) if (samples[j].found && Math.hypot(samples[j].cx - s.cx, samples[j].cy - s.cy) <= FACE_STABLE_DIST) support++;
    if (support >= 2) out.push(s);
  }
  stableCache.set(samples, out);
  return out;
}

export function planFaceCrop(samples: FacePoint[], t: number, prev: { cx: number; cy: number } | null, zoom = MODE_TARGET_ZOOM.zoom): CamTarget {
  const faces = stableFaces(samples);
  if (faces.length === 0) return FIT_TARGET;
  const inWin = faces.filter((s) => Math.abs(s.t - t) <= FACE_WINDOW_S);
  let cx: number, cy: number;
  if (inWin.length > 0) {
    cx = median(inWin.map((s) => s.cx)); cy = median(inWin.map((s) => s.cy));
  } else {
    let best: FacePoint | undefined;
    for (const s of faces) if (Math.abs(s.t - t) <= FACE_HOLD_S && (!best || Math.abs(s.t - t) < Math.abs(best.t - t))) best = s;
    if (!best) return FIT_TARGET;
    cx = best.cx; cy = best.cy;
  }
  // Deadband: a target that barely moved keeps the current camera, so a
  // still speaker doesn't breathe with detector noise.
  if (prev && Math.hypot(cx - prev.cx, cy - prev.cy) < FACE_DEADBAND) { cx = prev.cx; cy = prev.cy; }
  return { fit: false, cx, cy, zoom, maxZoom: Math.max(zoom, MODE_MAX_ZOOM.zoom) };
}

/** One step of the eased camera: chase `goal` from `cam` over dtS. */
export function easeCamera(cam: { cx: number; cy: number; zoom: number } | null, goal: { cx: number; cy: number; zoom: number }, dtS: number) {
  if (!cam) return { ...goal };
  const k = 1 - Math.exp(-Math.min(0.1, Math.max(0, dtS)) / CAM_TAU_S);
  return { cx: cam.cx + (goal.cx - cam.cx) * k, cy: cam.cy + (goal.cy - cam.cy) * k, zoom: cam.zoom + (goal.zoom - cam.zoom) * k };
}
