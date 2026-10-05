"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scan, Loader2, AlertCircle, Play, Pause, Crosshair, Code2, RotateCw, Users, Volume2, VolumeX } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { LabTabs } from "@/components/dev-lab/lab-tabs";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import {
  type Shot, MODE_TARGET_ZOOM, MODE_MAX_ZOOM, CAM_TAU_S,
  computeCoverGeometry, computeFramedGeometry, planCamera, planFaceCrop,
} from "./camera";

/* ════════ /dev/face-detect — Face detection playground ════════
   Every mode reads ONE dense, real-time local scan — /api/video/detect-face-track
   (CenterFace, lib/server/centerface.ts, ~5fps), no external API, no per-call
   cost, no rate limits. That dense timeline is segmented into discrete
   fixed-position "shots" (buildPositionShots below, OpusClips-style): a
   static, averaged crop for as long as the same subject holds roughly the
   same spot, and a hard CUT (not a pan) once a different position/confidence
   state has been sustained long enough to be real rather than a misdetected
   frame. Membership is judged against a FIXED anchor set when the shot
   starts, not a running average — that's what stops the crop drift-walking
   off a subject's real position over a run of individually-small steps.

   1. Single-crop modes (Auto/Zoom/Pan/Fit) — one shot timeline (`shots`) off
      each frame's primary (largest) detected face.

   2. Dual mode — reads the SAME stream's `pair` field (the two largest
      faces per frame, left-to-right) into two independent shot timelines,
      so both panes render live, at once, off one continuous local scan —
      no separate identity pass. Fewer than 2 faces on screen collapses to
      ONE full pane, fixed-cropped on whoever's found (or centered if no
      one is). */

// Default test clip — a real talking-head source, preloaded + auto-scanned on
// mount so the page is immediately useful instead of an empty URL box. Served
// from /public (Next only serves that dir).
const DEFAULT_VIDEO = "/face-detect-sample.mp4";

// Preview + scan only the first slice of the source — scanning is sequential
// per-sample ffmpeg extraction, so a long source means a long wait before the
// crop has any data to follow. 20s is plenty to see the algorithm work and
// keeps a full rescan fast.
const PREVIEW_MAX_S = 20;
// Single-crop modes (Auto/Zoom/Pan/Fit/Dual) get their samples from ONE batched
// /api/video/detect-face-track call — must match that route's SAMPLE_FPS, or
// "still live" here reads the wrong tolerance window against the real gap
// between samples.
const CROP_SAMPLE_FPS = 10;
const CROP_LIVE_THRESHOLD_S = (1 / CROP_SAMPLE_FPS) * 3;

/** /api/video/detect-face(s) requires an absolute http(s) URL (it streams the
 *  source server-side, no relative-path resolution) — the sample lives under
 *  /public, so a root-relative path needs the browser's own origin prefixed. */
function toAbsoluteUrl(u: string): string {
  if (/^https?:\/\//i.test(u)) return u;
  if (typeof window !== "undefined" && u.startsWith("/")) return `${window.location.origin}${u}`;
  return u;
}

/** One scanned single-crop timeline point — always has a usable (cx, cy)
 *  even when nothing was found (falls back to frame-center), so
 *  interpolation never has a hole. `pair` (left-to-right by x) is present
 *  only when 2+ faces were seen this frame — the SAME dense real-time scan
 *  Dual mode's split now reads directly, instead of a separate sparse scan. */
type SamplePoint = {
  t: number; found: boolean; recommendFit: boolean; kind?: "face" | "subject"; cx: number; cy: number; faceCount: number;
  pair?: { cx: number; cy: number; w: number }[];
  /** A real edit cut lands on this sample — an unconditional hard shot
   *  boundary (see buildPositionShots below), never smoothed through. */
  cut?: boolean;
  /** Width of the face this sample's cx/cy came from — lets buildPositionShots
   *  reject a merged two-person detection near the midpoint (see faceShots.ts). */
  w?: number;
};

type FramingMode = "auto" | "zoom" | "pan" | "dual" | "full";

const CAMERA_MODES: { id: FramingMode; name: string; blurb: string }[] = [
  { id: "auto", name: "Auto", blurb: "Decides per shot: one face → face crop; two faces that fit → frame both; two faces too far apart → pan between them; nobody → letterbox. Eased cuts." },
  { id: "zoom", name: "Face Crop", blurb: "Always a tight crop on the main face, head in the upper third, same eased shot cuts as Auto." },
  { id: "pan", name: "Pan both", blurb: "Two people on screen: a slow eased camera move from one head to the other and back. One person: face crop. Nobody: letterbox." },
  { id: "dual", name: "Dual (split)", blurb: "Real-time split top/bottom only while 2 people are actually on screen together; a lone speaker or empty shot plays as one full centered pane." },
  { id: "full", name: "Fit (safe)", blurb: "Letterbox the whole shot — no crop, no detection needed." },
];
const ASPECTS: { id: "9:16" | "1:1" | "16:9"; label: string }[] = [
  { id: "9:16", label: "9:16" },
  { id: "1:1", label: "1:1" },
  { id: "16:9", label: "16:9" },
];

// Target "intentional" zoom per mode — the ACTUAL zoom applied is
// max(this, the minimum needed to keep the point in frame), so a face near
// the edge always gets more zoom automatically rather than clipping/gapping.

const DUAL_TARGET_ZOOM = 1.3;
const DUAL_MAX_ZOOM = 2.4;
// How long a state must be requested before it actually takes effect — stops
// Dual's split⟷single-pane switch from flickering on a single borderline
// sample.
const DEBOUNCE_MS = 350;

function nearestPoint<T extends { t: number }>(points: T[], t: number): T | undefined {
  if (points.length === 0) return undefined;
  let best = points[0];
  for (const p of points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}


// How long a different state (a position jump beyond SHOT_POSITION_TOLERANCE,
// or a confidence flip — found vs. not) must be sustained before it's treated
// as a real cut to a new shot rather than a one-frame misdetection/head-bob.
// This + MIN_SHOT_DURATION_S below is the total time-to-first-crop, so both
// need to stay small — a real, sub-2s speaker turn must still be able to
// commit AND survive the merge pass, or Auto/Zoom/Pan never crops in at all.
const SHOT_MIN_HOLD_S = 0.5;
// A shot should absorb normal head/body motion without splitting, but must
// NOT be so loose it blends two actually-different speaker positions into
// one drifted average (confirmed live on the sample clip: two real speakers
// at cx≈0.83 and cx≈0.36 — a wider tolerance let the shot "walk" between
// them frame by frame since each step was individually small). 0.15 keeps
// same-speaker jitter (≤0.03 observed) well inside while cleanly separating
// distinct speakers (≥0.23 observed).
const SHOT_POSITION_TOLERANCE = 0.15;
// Any committed shot shorter than this is noise (a single-frame flicker that
// juuust cleared the hold timer) — merged into its neighbor. Kept short: a
// real, brief speaker turn is a legitimate shot, not noise.
const MIN_SHOT_DURATION_S = 0.6;

function sameShotState(a: { confident: boolean; cx: number; cy: number }, b: { confident: boolean; cx: number; cy: number }): boolean {
  if (a.confident !== b.confident) return false;
  if (!a.confident) return true; // unconfident is one uniform "no crop" state — position noise there is meaningless
  return Math.hypot(a.cx - b.cx, a.cy - b.cy) <= SHOT_POSITION_TOLERANCE;
}

// `alts`, when present, are OTHER faces also seen this frame — used to keep
// a shot locked onto the SAME subject even when the server's per-frame
// "largest face" pick (cx, cy) flips between two people of similar size
// both on screen at once (confirmed live: this produced "cropping wrong in
// some places" — the crop briefly snapping to whichever person happened to
// be a few pixels wider that particular frame).
// NOT alts: s.pair (dropped below). `alts` let a shot re-anchor to whichever
// of {primary, alt} best matched the anchor — built for the OLD largest-face
// world, where a same-position two-shot's "primary" could flip between two
// similarly-sized co-located faces (pure detector noise to smooth over). The
// active-speaker signal (speakerTrack.ts, via /api/video/detect-face-track)
// already picks cx deliberately — it's not noise to reconcile — and the
// OTHER on-screen face is exactly where the anchor was a moment ago, so an
// alt would let the old closestCandidate silently snap every genuine speaker
// switch back to the previous speaker's position, forever.
type PosPoint = { t: number; confident: boolean; cx: number; cy: number; cut?: boolean; w?: number };

/** True when `w` is far enough from `anchorW` that it's almost certainly a
 *  merged two-person box, not the anchor's own face measured differently. */
function widthMismatch(w: number | undefined, anchorW: number | undefined): boolean {
  if (!w || !anchorW) return false;
  const ratio = w / anchorW;
  return ratio < 0.55 || ratio > 1.8;
}

/** OpusClips-style shot segmentation — turns a dense per-frame position
 *  timeline into discrete fixed-position "shots". Within a shot the crop is
 *  ONE averaged, static point (no continuous motion-tracking jitter); moving
 *  to the next shot is a hard cut, not a pan. A candidate state change only
 *  commits once sustained for SHOT_MIN_HOLD_S, so a single misdetected frame
 *  never splits a shot in two.
 *
 *  Membership is tested against a FIXED anchor (the position the shot/
 *  candidate started at) — NOT the running average. Comparing against a
 *  constantly-updated mean let the crop silently "walk" from one real
 *  speaker's position to a different one over several small in-tolerance
 *  steps, each individually under SHOT_POSITION_TOLERANCE, ending on neither
 *  speaker's actual position (confirmed live: this was the "face isn't
 *  centered" bug). An anchor that never moves during the shot makes that
 *  drift impossible — every sample is judged against where the shot began. */
function buildPositionShots(points: PosPoint[]): Shot[] {
  if (points.length === 0) return [];
  const shots: Shot[] = [];
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
    // A same-position sample whose width doesn't match the anchor's is very
    // likely a MERGED detection (two people fused into one wide box near
    // their midpoint) — reject it even though cx/cy alone would have matched,
    // so a crop centered on the empty gap between two real people can never
    // get built from this.
    const widthOk = !p.confident || !widthMismatch(p.w, anchorW);
    const state = { confident: p.confident, cx: p.confident ? p.cx : 0.5, cy: p.confident ? p.cy : 0.5 };
    if (widthOk && sameShotState(state, anchor)) {
      pendingStart = null;
      if (p.confident) { sumCx += p.cx; sumCy += p.cy; n++; } // anchor stays fixed — accumulate for display averaging only
      continue;
    }
    const pendingWidthOk = !p.confident || !widthMismatch(p.w, pendingAnchorW);
    const stateP = { confident: p.confident, cx: p.confident ? p.cx : 0.5, cy: p.confident ? p.cy : 0.5 };
    if (pendingStart === null || pendingConfident !== stateP.confident || !pendingWidthOk || !sameShotState(stateP, pendingAnchor)) {
      pendingStart = p.t;
      pendingConfident = state.confident;
      pendingAnchor = { confident: state.confident, cx: state.cx, cy: state.cy };
      pendingAnchorW = state.confident ? p.w : undefined;
      pendingSumCx = state.confident ? state.cx : 0;
      pendingSumCy = state.confident ? state.cy : 0;
      pendingN = state.confident ? 1 : 0;
      continue;
    }
    if (stateP.confident) { pendingSumCx += stateP.cx; pendingSumCy += stateP.cy; pendingN++; }
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
  commitShot(points[points.length - 1].t + 1); // extend the last shot forward past the final sample
  return mergeShortShots(shots);
}

function buildShots(samples: SamplePoint[]): Shot[] {
  return buildPositionShots(samples.map((s) => ({ t: s.t, confident: s.found && !s.recommendFit, cx: s.cx, cy: s.cy, cut: s.cut, w: s.w })));
}

/** Dual mode's top/bottom shot timelines — built from the SAME dense
 *  real-time detect-face-track stream Auto uses (samples[].pair, the two
 *  largest faces per frame, left-to-right), not a separate sparse identity
 *  scan. Left face → top pane, right face → bottom pane; a frame with fewer
 *  than 2 faces contributes no confident point to either side, same
 *  unconfident-gap handling buildPositionShots already does for Auto. */
function buildPairShots(samples: SamplePoint[]): { top: Shot[]; bottom: Shot[] } {
  const left: PosPoint[] = samples.map((s) => {
    const has = !!s.pair && s.pair.length >= 2;
    return { t: s.t, confident: has, cx: has ? s.pair![0].cx : 0.5, cy: has ? s.pair![0].cy : 0.5 };
  });
  const right: PosPoint[] = samples.map((s) => {
    const has = !!s.pair && s.pair.length >= 2;
    return { t: s.t, confident: has, cx: has ? s.pair![1].cx : 0.5, cy: has ? s.pair![1].cy : 0.5 };
  });
  return { top: buildPositionShots(left), bottom: buildPositionShots(right) };
}

/** Folds any shot shorter than MIN_SHOT_DURATION_S into its neighbor —
 *  buildShots' hold timer filters single-frame misdetections, but a state
 *  that clears the hold and then immediately flips back (a quick head turn
 *  and back) still produces a real, correctly-detected shot that's just too
 *  short to be worth cutting to. Repeated because a merge can itself leave a
 *  newly-adjacent pair that should also merge. */
function mergeShortShots(shots: Shot[]): Shot[] {
  let cur = shots;
  for (let pass = 0; pass < 4; pass++) {
    const shortIdx = cur.findIndex((sh, i) => i > 0 && sh.endT - sh.startT < MIN_SHOT_DURATION_S);
    if (shortIdx === -1) break;
    const merged = cur.slice();
    const prev = merged[shortIdx - 1];
    merged[shortIdx - 1] = { ...prev, endT: merged[shortIdx].endT };
    merged.splice(shortIdx, 1);
    cur = merged;
  }
  return cur;
}

/** Current shot covering time t — a linear scan is fine here; shot count is
 *  tiny (a handful over a ≤20s preview window). */
function shotAt(shots: Shot[], t: number): Shot | undefined {
  for (const sh of shots) if (t >= sh.startT && t < sh.endT) return sh;
  return shots[shots.length - 1];
}

export default function FaceDetectPlayground() {
  // Privy session readiness — the auto-scan fires as soon as the video's
  // metadata loads, which can beat Privy finishing session restore on a
  // fresh page load. The global fetch interceptor's getFreshToken() returns
  // null while !authenticated, so a scan that races auth-readiness 401s on
  // EVERY sample ("Single-crop scan error: Unauthorized", timeline all
  // "nothing found") even though auth is fine moments later — confirmed live
  // (an identical fetch succeeds once the page has settled). Gate the scan
  // trigger on `loading` (== !Privy-ready) so it waits for that race to end.
  const { loading: authLoading } = useSupabaseAuth();
  const authLoadingRef = useRef(authLoading);
  useEffect(() => { authLoadingRef.current = authLoading; }, [authLoading]);
  const [videoUrl, setVideoUrl] = useState(DEFAULT_VIDEO);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_VIDEO);
  const [duration, setDuration] = useState(0);

  // Single-crop scan (Auto/Zoom/Pan/Fit/Dual — Dual's split now reads the
  // SAME dense stream via samples[].pair, no separate identity scan).
  const [samples, setSamples] = useState<SamplePoint[]>([]);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [scanError, setScanError] = useState<string | null>(null);

  const [algoOn, setAlgoOn] = useState(true);
  const [mode, setMode] = useState<FramingMode>("auto");
  const [showOverlay, setShowOverlay] = useState(true);
  const [playing, setPlaying] = useState(true);
  // Read by the watchdog effect below (which can't take `playing` as a
  // dependency without tearing down/rebuilding its interval on every toggle).
  const playingRef = useRef(true);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  // Starts muted (required for autoplay to actually start at all — an
  // unmuted <video autoPlay> is silently blocked by the browser and never
  // plays). Unmuting is a real click, i.e. a user gesture, so the browser
  // allows it — that's how audio ends up actually working here.
  const [muted, setMuted] = useState(true);
  const [aspect, setAspect] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [liveFaceCount, setLiveFaceCount] = useState<number | null>(null);

  // ONE <video> for every mode, including Dual — it's an invisible (opacity:0)
  // decode source only; drawImage() reads its current frame into whichever
  // canvas(es) are visible, so Dual's two panes draw from the SAME element/
  // instant instead of two independently-seeking <video>s (also what "run at
  // one time, same frame" asked for).
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasTopRef = useRef<HTMLCanvasElement>(null);
  const canvasBottomRef = useRef<HTMLCanvasElement>(null);
  const cellTopRef = useRef<HTMLDivElement>(null);
  const cellBottomRef = useRef<HTMLDivElement>(null);
  const dualDividerRef = useRef<HTMLDivElement>(null);
  const labelTopRef = useRef<HTMLSpanElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const faceCountRef = useRef<HTMLSpanElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const scanTokenRef = useRef(0);
  // The capped (PREVIEW_MAX_S) duration, mirrored from `duration` state so
  // the tick loop can read it every frame without depending on it (which
  // would tear down/rebuild the rAF loop on every load).
  const durationRef = useRef(0);
  // Dual's split⟷single-pane decision — debounced the same way (a one-frame
  // headcount blip shouldn't flip the whole layout).
  const dualSplitActiveRef = useRef(false);
  const dualSplitPendingWantRef = useRef(false);
  const dualSplitPendingSinceRef = useRef(0);
  // Auto/Zoom/Pan's cropped⟷full-frame decision — same debounce pattern as
  // Dual's split toggle above, so a single isolated "not found" frame amid a
  // run of confident ones doesn't flash the view to letterbox for one frame.
  const autoFitActiveRef = useRef(false);
  const autoFitPendingWantRef = useRef(false);
  const autoFitPendingSinceRef = useRef(0);
  const lastFrameTsRef = useRef(0);
  const camRef = useRef<{ cx: number; cy: number; zoom: number } | null>(null);
  const modeSeenRef = useRef<FramingMode>("auto");

  // Auto/Zoom/Pan's shot segmentation (see buildShots) — recomputed only when
  // a fresh scan lands, not per animation frame.
  const shots = useMemo(() => buildShots(samples), [samples]);
  // Dual mode's split shot timelines (see buildPairShots) — same dense
  // real-time stream as `shots` above, no separate identity scan.
  const { top: topShots, bottom: bottomShots } = useMemo(() => buildPairShots(samples), [samples]);

  // ── Single-crop scan: ONE /api/video/detect-face-track call extracts +
  //    detects every SAMPLE_FPS-th frame across the whole window in a single
  //    ffmpeg process (see that route's header comment for why this replaced
  //    N separate per-timestamp calls — process-spawn overhead was the real
  //    cost, not detection itself). Far denser (dozens of points/sec instead
  //    of a handful over the whole clip) for the same or less total work. ──
  const scanVideo = useCallback(async (url: string, durationS: number) => {
    const token = ++scanTokenRef.current;
    setScanning(true);
    setScanError(null);
    setSamples([]);
    setScanProgress({ done: 0, total: 0 });
    try {
      const res = await fetch("/api/video/detect-face-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: toAbsoluteUrl(url), durationS }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok: boolean; error?: string;
        points?: { t: number; found: boolean; cx: number; cy: number; recommendFit: boolean; faceCount: number; pair?: { cx: number; cy: number; w: number }[]; cut?: boolean; w?: number }[];
      };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (scanTokenRef.current !== token) return;
      const collected: SamplePoint[] = (j.points ?? []).map((p) => ({
        t: p.t, found: p.found, recommendFit: p.recommendFit, kind: p.found ? "face" : "subject",
        cx: p.cx, cy: p.cy, faceCount: p.faceCount, pair: p.pair, cut: p.cut, w: p.w,
      }));
      setSamples(collected);
      setScanProgress({ done: collected.length, total: collected.length });
    } catch (e) {
      if (scanTokenRef.current !== token) return;
      setScanError(e instanceof Error ? e.message : "Scan failed");
    }
    if (scanTokenRef.current === token) setScanning(false);
  }, []);

  // Kick off the single-crop scan whenever a NEW video actually starts
  // playing (duration known) — not on every render. Fires once per activeUrl.
  //
  // NOT solely driven by the <video>'s onLoadedMetadata React prop: for a
  // video the browser already has cached (e.g. re-visiting this page in the
  // same tab), readyState/duration can already be available the instant the
  // element mounts, and the native "loadedmetadata" event that prop listens
  // for can fire (or may already have fired) before React finishes wiring
  // the listener — leaving `duration` stuck at 0 forever, no scan, and the
  // PREVIEW_MAX_S loop-cap below never engaging (confirmed live: currentTime
  // drifting to 87s+ with zero raw scan points). captureMetadata() is instead
  // called BOTH from that event AND, as a self-healing fallback, from every
  // tick() frame — a plain idempotent guard (scannedForUrlRef) makes calling
  // it redundantly from both places harmless.
  const scannedForUrlRef = useRef<string | null>(null);
  const captureMetadata = useCallback((el: HTMLVideoElement) => {
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    // Duration capture is independent of auth and idempotent — safe to
    // (re)do every call; only the SCAN trigger below needs a once-per-url
    // guard, and it deliberately waits for authLoadingRef so it doesn't fire
    // (and 401) before Privy's session restore finishes — EXCEPT for a local
    // /public asset (the bundled sample video): the API routes now skip auth
    // entirely for that one allow-listed file (see detect-face-track/route.ts),
    // so there's no 401 race to wait out, and waiting anyway is exactly the
    // "doesn't work signed out" bug this page had (the auto-trigger stayed
    // gated indefinitely while genuinely signed out, not just mid-restore).
    const d = Math.min(el.duration, PREVIEW_MAX_S);
    setDuration(d);
    durationRef.current = d;
    const isLocalAsset = activeUrl.startsWith("/");
    if (scannedForUrlRef.current === activeUrl || (!isLocalAsset && authLoadingRef.current)) return;
    scannedForUrlRef.current = activeUrl;
    void scanVideo(activeUrl, d);
  }, [activeUrl, scanVideo]);
  const onLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    captureMetadata(e.currentTarget);
  }, [captureMetadata]);

  const loadUrl = useCallback(() => {
    const raw = videoUrl.trim();
    if (!raw) return;
    scannedForUrlRef.current = null; // force a rescan once the new video's metadata loads
    setActiveUrl(raw);
  }, [videoUrl]);

  // ── Playback watchdog. Two real failure modes it recovers from:
  //    1. Autoplay silently never actually starts (the `autoplay` attribute
  //       firing before the media pipeline is warmed up is a known no-op —
  //       readyState can even reach HAVE_ENOUGH_DATA with .paused still
  //       true and nothing else ever retries it) — this reads as a
  //       permanently black/empty preview with a "Pause" button showing.
  //    2. A large progressive-download video hits a decode/buffering hiccup
  //       mid-playback where currentTime freezes (or the element errors out)
  //       while still marked playing; our crosshair/crop keep animating off
  //       interpolated sample data regardless, so this reads as a sudden
  //       black frame under a still-moving overlay.
  //    Polls every second: if playback is WANTED but paused, retry .play();
  //    if it's supposedly playing but currentTime hasn't moved for 2.5s+ (or
  //    the element errors), reload it in place and resume. ─────────────────
  useEffect(() => {
    if (!activeUrl) return;
    const lastTime = new Map<HTMLVideoElement, number>();
    const stuckSince = new Map<HTMLVideoElement, number>();
    const recover = (v: HTMLVideoElement) => {
      const t = v.currentTime;
      stuckSince.delete(v);
      lastTime.delete(v);
      v.load();
      v.currentTime = t;
      void v.play().catch(() => {});
    };
    const onError = (e: Event) => recover(e.currentTarget as HTMLVideoElement);
    const watched = [videoRef].map((r) => r.current).filter((v): v is HTMLVideoElement => !!v);
    for (const v of watched) v.addEventListener("error", onError);
    const watchdog = setInterval(() => {
      const now = Date.now();
      for (const v of watched) {
        if (v.ended || v.seeking) { stuckSince.delete(v); lastTime.set(v, v.currentTime); continue; }
        if (playingRef.current && v.paused) {
          // Autoplay never took (or a prior recover() left it paused) — keep
          // retrying rather than staying black forever with no way to
          // recover short of the user manually toggling Pause/Play twice.
          stuckSince.delete(v);
          lastTime.set(v, v.currentTime);
          void v.play().catch(() => {});
          continue;
        }
        if (!playingRef.current) { stuckSince.delete(v); lastTime.set(v, v.currentTime); continue; }
        const prev = lastTime.get(v);
        if (prev !== undefined && Math.abs(v.currentTime - prev) < 0.01) {
          const since = stuckSince.get(v) ?? now;
          stuckSince.set(v, since);
          if (now - since > 2500) recover(v);
        } else {
          stuckSince.delete(v);
        }
        lastTime.set(v, v.currentTime);
      }
    }, 1000);
    return () => {
      clearInterval(watchdog);
      for (const v of watched) v.removeEventListener("error", onError);
    };
  }, [activeUrl, mode]);

  // ── Continuous tracking loop — every animation frame, interpolate the
  //    subject's position(s) at the video's CURRENT time and apply the crop
  //    directly to the DOM (no React state per frame; runs ~60x/sec). ──────
  useEffect(() => {
    let raf = 0;
    // The visible surface is a <canvas>, redrawn every frame via drawImage()
    // from the (invisible, opacity:0) <video> decode source — NOT a CSS
    // transform/resize on the video element itself. A CSS-transformed
    // <video>'s own hardware-overlay compositor was observed live rendering
    // solid black on some frames while the decoded frame was provably fine
    // underneath (a canvas drawImage() readback showed normal brightness at
    // the exact same instant) — a real Chromium GPU-compositor artifact of
    // resizing/transforming a <video> element, reproduced with the algorithm
    // OFF (plain, untransformed cover) too. Canvas drawImage() pulls frames
    // directly from the decoder, bypassing that compositing path entirely.
    const drawCropped = (canvas: HTMLCanvasElement, video: HTMLVideoElement, g: { width: number; height: number; left: number; top: number }, naturalW: number, destW: number, destH: number) => {
      if (canvas.width !== destW) canvas.width = destW;
      if (canvas.height !== destH) canvas.height = destH;
      if (naturalW <= 0 || g.width <= 0 || video.readyState < 2 || destW <= 0 || destH <= 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scale = g.width / naturalW;
      ctx.drawImage(video, -g.left / scale, -g.top / scale, destW / scale, destH / scale, 0, 0, destW, destH);
    };
    // True letterbox (Fit safe) — the whole frame visible, centered, with
    // real black bars filled explicitly (no CSS involved at all).
    const drawContain = (canvas: HTMLCanvasElement, video: HTMLVideoElement, naturalW: number, naturalH: number, destW: number, destH: number) => {
      if (canvas.width !== destW) canvas.width = destW;
      if (canvas.height !== destH) canvas.height = destH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, destW, destH);
      if (naturalW <= 0 || naturalH <= 0 || video.readyState < 2 || destW <= 0 || destH <= 0) return;
      const scale = Math.min(destW / naturalW, destH / naturalH);
      const w = naturalW * scale, h = naturalH * scale;
      ctx.drawImage(video, 0, 0, naturalW, naturalH, (destW - w) / 2, (destH - h) / 2, w, h);
    };

    const tick = () => {
      const v = videoRef.current;
      const box = previewBoxRef.current;
      if (v && box) {
        // Self-healing fallback for onLoadedMetadata not firing, AND for
        // retrying the scan trigger once Privy's session-restore race clears
        // (see captureMetadata's comment) — cheap no-op once already scanned.
        captureMetadata(v);
        // Natural dims read LIVE off the element every frame (not a ref
        // captureMetadata populates separately) — removes any chance of a
        // stale-value ordering hazard between the two.
        const naturalW = v.videoWidth, naturalH = v.videoHeight;
        // Loop within the PREVIEW_MAX_S-capped window, not the source's real
        // (possibly much longer) duration — the scan only ever covers this
        // window, so playing past it would run with stale/absent tracking data.
        const cap = durationRef.current;
        if (cap > 0 && v.currentTime >= cap) v.currentTime = 0;
        const t = v.currentTime;
        const boxW = box.clientWidth, boxH = box.clientHeight;
        const now = performance.now();
        const prevTs = lastFrameTsRef.current || now;
        lastFrameTsRef.current = now;

        if (mode === "dual") {
          // Split ONLY when 2 people are actually on screen together, read
          // straight off the SAME dense real-time detect-face-track stream
          // Auto uses (samples[].pair) — not a separate sparse identity
          // scan. Both panes render live, at once, from that one continuous
          // feed; a lone speaker or empty/b-roll moment collapses to ONE
          // full centered pane (same fixed-shot treatment Auto gives a
          // single-person moment) instead of ever needing "dual" at all.
          // Debounced so a single-frame miscount doesn't flicker the layout.
          const topShot = algoOn ? shotAt(topShots, t) : undefined;
          const bottomShot = algoOn ? shotAt(bottomShots, t) : undefined;
          const wantSplit = !!topShot?.confident && !!bottomShot?.confident;
          if (wantSplit !== dualSplitPendingWantRef.current) { dualSplitPendingWantRef.current = wantSplit; dualSplitPendingSinceRef.current = now; }
          if (wantSplit !== dualSplitActiveRef.current && now - dualSplitPendingSinceRef.current >= DEBOUNCE_MS) {
            dualSplitActiveRef.current = wantSplit;
          }
          const splitActive = dualSplitActiveRef.current;

          if (cellTopRef.current) cellTopRef.current.style.height = splitActive ? "50%" : "100%";
          if (cellBottomRef.current) cellBottomRef.current.style.height = splitActive ? "50%" : "0%";
          if (dualDividerRef.current) dualDividerRef.current.style.opacity = splitActive ? "1" : "0";
          if (labelTopRef.current) labelTopRef.current.style.opacity = splitActive ? "1" : "0";
          const canvasTop = canvasTopRef.current, canvasBottom = canvasBottomRef.current;

          const shot = algoOn ? shotAt(shots, t) : undefined; // single-pane fallback, same as Auto
          const confident = !!shot?.confident;
          const headcount = confident && wantSplit ? 2 : confident ? 1 : 0;

          if (splitActive && topShot && bottomShot) {
            const cellH = boxH / 2;
            if (canvasTop) { canvasTop.style.opacity = "1"; drawCropped(canvasTop, v, computeCoverGeometry(topShot.cx, topShot.cy, naturalW, naturalH, boxW, cellH, DUAL_TARGET_ZOOM, DUAL_MAX_ZOOM), naturalW, boxW, cellH); }
            if (canvasBottom) { canvasBottom.style.opacity = "1"; drawCropped(canvasBottom, v, computeCoverGeometry(bottomShot.cx, bottomShot.cy, naturalW, naturalH, boxW, cellH, DUAL_TARGET_ZOOM, DUAL_MAX_ZOOM), naturalW, boxW, cellH); }
            if (cellTopRef.current) cellTopRef.current.style.boxShadow = "inset 0 0 0 3px #a3e635";
            if (cellBottomRef.current) cellBottomRef.current.style.boxShadow = "inset 0 0 0 3px #a3e635";
          } else {
            // Single pane, full container — fixed-crop on the lone speaker
            // (same shot data Auto uses). NO face at all → full uncropped
            // frame (same drawContain as Auto/Fit), not a guessed center
            // crop — there's nothing to justify cropping to.
            if (cellTopRef.current) cellTopRef.current.style.boxShadow = "none";
            if (cellBottomRef.current) cellBottomRef.current.style.boxShadow = "none";
            if (canvasTop) canvasTop.style.opacity = "1";
            if (canvasTop) {
              if (confident && shot) drawCropped(canvasTop, v, computeCoverGeometry(shot.cx, shot.cy, naturalW, naturalH, boxW, boxH, MODE_TARGET_ZOOM.auto, MODE_MAX_ZOOM.auto), naturalW, boxW, boxH);
              else drawContain(canvasTop, v, naturalW, naturalH, boxW, boxH);
            }
          }

          if (faceCountRef.current) faceCountRef.current.textContent = String(headcount);
          if (headcount !== liveFaceCount) setLiveFaceCount(headcount);
        } else if (mode === "full") {
          // "Fit (safe)" IS the letterbox mode — true no-crop, no tracking.
          if (canvasRef.current) drawContain(canvasRef.current, v, naturalW, naturalH, boxW, boxH);
          if (markerRef.current) markerRef.current.style.opacity = "0";
          const nearest = nearestPoint(samples, t);
          const fc = nearest && Math.abs(nearest.t - t) <= CROP_LIVE_THRESHOLD_S ? nearest.faceCount : 0;
          if (faceCountRef.current) faceCountRef.current.textContent = String(fc);
          if (fc !== liveFaceCount) setLiveFaceCount(fc);
        } else {
          // Auto / Face Crop / Pan both — buildShots decides the cut points;
          // planCamera decides the framing for the current shot (and the
          // moving pan target); the rendered camera eases toward it. Nothing
          // confidently found → the FULL uncropped frame (debounced so a
          // single-frame shot-boundary flicker doesn't flash the letterbox).
          const shot = algoOn ? shotAt(shots, t) : undefined;
          const topShot = algoOn ? shotAt(topShots, t) : undefined;
          const bottomShot = algoOn ? shotAt(bottomShots, t) : undefined;
          // Face Crop follows the dense scan directly (always cropped, holds
          // through gaps); Auto / Pan both frame per committed shot.
          const target = !algoOn ? { fit: true, cx: 0.5, cy: 0.5, zoom: 1, maxZoom: 1 }
            : mode === "zoom" ? planFaceCrop(samples, t, camRef.current)
            : planCamera(mode, t, shot, topShot, bottomShot, naturalW, naturalH, boxW, boxH);
          const confident = !target.fit;
          const wantFit = target.fit;
          if (wantFit !== autoFitPendingWantRef.current) { autoFitPendingWantRef.current = wantFit; autoFitPendingSinceRef.current = now; }
          if (wantFit !== autoFitActiveRef.current && now - autoFitPendingSinceRef.current >= DEBOUNCE_MS) {
            autoFitActiveRef.current = wantFit;
          }
          const showFit = mode === "zoom" ? target.fit : autoFitActiveRef.current;
          if (modeSeenRef.current !== mode) { modeSeenRef.current = mode; camRef.current = null; }
          // Critically-damped chase: k = 1 - e^(-dt/τ). Seeded on the first
          // frame (and after a fit→crop return) so there is no glide from 0.5.
          const dtS = Math.min(0.1, Math.max(0, (now - prevTs) / 1000));
          const k = 1 - Math.exp(-dtS / CAM_TAU_S);
          const goal = confident ? { cx: target.cx, cy: target.cy, zoom: target.zoom } : { cx: 0.5, cy: 0.5, zoom: 1 };
          const cam = camRef.current && !showFit
            ? { cx: camRef.current.cx + (goal.cx - camRef.current.cx) * k, cy: camRef.current.cy + (goal.cy - camRef.current.cy) * k, zoom: camRef.current.zoom + (goal.zoom - camRef.current.zoom) * k }
            : goal;
          camRef.current = cam;
          if (canvasRef.current) {
            if (showFit) drawContain(canvasRef.current, v, naturalW, naturalH, boxW, boxH);
            else drawCropped(canvasRef.current, v, computeFramedGeometry(cam.cx, cam.cy, naturalW, naturalH, boxW, boxH, cam.zoom, Math.max(cam.zoom, target.maxZoom)), naturalW, boxW, boxH);
          }
          if (markerRef.current) {
            markerRef.current.style.left = `${cam.cx * 100}%`;
            markerRef.current.style.top = `${cam.cy * 100}%`;
            markerRef.current.style.opacity = confident ? "1" : "0";
          }
          const nearest = nearestPoint(samples, t);
          const fc = nearest && Math.abs(nearest.t - t) <= CROP_LIVE_THRESHOLD_S ? nearest.faceCount : 0;
          if (faceCountRef.current) faceCountRef.current.textContent = String(fc);
          if (fc !== liveFaceCount) setLiveFaceCount(fc);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // liveFaceCount intentionally excluded — it's set FROM this loop, not a trigger for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algoOn, mode, samples, shots, topShots, bottomShots, captureMetadata]);

  const confidentCount = samples.filter((s) => s.found && !s.recommendFit).length;

  return (
    <div className="min-h-screen bg-[#08080a] px-6 py-6 text-white">
      <LabTabs active="face-detect" />
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight">
            <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04]">
              <Scan className="size-4.5 text-white/80" strokeWidth={1.75} />
            </span>
            Face Detection Playground
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13px] text-zinc-500">
            Runs entirely locally — <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11.5px]">CenterFace</code> via onnxruntime-node, no external API, no cost, no rate limit.
            With 2+ people on screen, the crop follows whoever&apos;s actually <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11.5px]">speakerTrack</code> hears talking
            (mouth motion gated by the audio track) — not just the biggest/nearest face — the same signal Dual mode splits top/bottom from.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          {/* ── Left: preview ── */}
          <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") loadUrl(); }}
                placeholder="https://…/video.mp4"
                className="min-w-[260px] flex-1 rounded-lg border border-[#27272a] bg-black/40 px-3 py-2 text-[13px] text-white outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
              />
              <button
                type="button"
                onClick={loadUrl}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272a] bg-black/30 px-3.5 py-2 text-[12.5px] font-semibold text-zinc-200 transition-colors hover:bg-white/5"
              >
                Load
              </button>
              <button
                type="button"
                onClick={() => activeUrl && void scanVideo(activeUrl, duration)}
                disabled={scanning || !activeUrl}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-[12.5px] font-bold text-black transition-colors hover:bg-emerald-400 disabled:opacity-50"
              >
                {scanning ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                {scanning ? `Scanning ${scanProgress.done}/${scanProgress.total}…` : "Rescan"}
              </button>
              <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-[#27272a] bg-black/30 px-3 py-2 text-[12px] font-semibold text-zinc-300">
                <Users className="size-3.5 text-lime-400" />
                <span ref={faceCountRef}>{liveFaceCount ?? "—"}</span> face{liveFaceCount === 1 ? "" : "s"}
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-600">
              Every request runs local CenterFace inference, including Dual mode&apos;s split — read straight off the same dense real-time scan Auto uses. Preview + scan cover the first {PREVIEW_MAX_S}s only, for a fast iteration loop.
            </p>

            {scanError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span><b>Single-crop scan error:</b> {scanError}</span>
              </div>
            )}

            {/* Aspect + playback controls */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1 rounded-lg border border-[#27272a] bg-black/30 p-1">
                {ASPECTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAspect(a.id)}
                    className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                      aspect === a.id ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPlaying((p) => !p);
                  const v = videoRef.current;
                  if (v) { if (v.paused) void v.play(); else v.pause(); }
                }}
                disabled={!activeUrl}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272a] bg-black/30 px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-40"
              >
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {playing ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => {
                  // The click itself is the user gesture that lets the
                  // browser actually allow audio — starting unmuted would
                  // have silently blocked autoplay entirely.
                  const next = !muted;
                  setMuted(next);
                  if (videoRef.current) videoRef.current.muted = next;
                }}
                disabled={!activeUrl}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272a] bg-black/30 px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-40"
              >
                {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                {muted ? "Unmute" : "Mute"}
              </button>
            </div>

            {/* Preview box */}
            <div className="mt-4 flex justify-center">
              <div
                ref={previewBoxRef}
                className="relative overflow-hidden rounded-xl border border-white/10 bg-black"
                style={{ aspectRatio: aspect === "9:16" ? "9/16" : aspect === "16:9" ? "16/9" : "1/1", height: 520, maxHeight: "70vh" }}
              >
                {!activeUrl && (
                  <div className="flex h-full w-full items-center justify-center px-6 text-center text-[13px] text-zinc-600">
                    Paste a video URL and hit Load
                  </div>
                )}

                {/* The ONE decode source for every mode — invisible; every
                    visible pixel below comes from a <canvas> drawImage()
                    read of this element each frame (see the tick loop's
                    drawCropped/drawContain). Kept in normal layout (not
                    display:none) so Chrome never pauses its decode. */}
                {activeUrl && (
                  <video
                    ref={videoRef}
                    key={activeUrl}
                    src={activeUrl}
                    muted={muted}
                    loop
                    autoPlay
                    playsInline
                    onLoadedMetadata={onLoadedMetadata}
                    style={{ position: "absolute", width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }}
                  />
                )}

                {activeUrl && mode === "dual" ? (
                  <div className="flex h-full w-full flex-col">
                    <div ref={cellTopRef} className="relative h-1/2 w-full overflow-hidden bg-zinc-900 transition-shadow">
                      <canvas ref={canvasTopRef} className="absolute inset-0 h-full w-full" />
                      <span ref={labelTopRef} className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white/70">Guest A</span>
                    </div>
                    <div ref={dualDividerRef} className="h-px w-full bg-white/10" />
                    <div ref={cellBottomRef} className="relative h-1/2 w-full overflow-hidden bg-zinc-900 transition-shadow">
                      <canvas ref={canvasBottomRef} className="absolute inset-0 h-full w-full" />
                      <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white/70">Guest B</span>
                    </div>
                  </div>
                ) : activeUrl ? (
                  <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
                ) : null}

                {/* Live tracked-point marker (single-crop modes only) —
                    continuously moves via the rAF loop above, drawn on the
                    UNTRANSFORMED frame coordinates. */}
                {mode !== "dual" && showOverlay && samples.length > 0 && (
                  <div
                    ref={markerRef}
                    className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-lime-400 shadow-[0_0_0_2px_rgba(0,0,0,0.6)]"
                    style={{ left: "50%", top: "50%" }}
                  />
                )}

                {!algoOn && (
                  <div className="absolute left-2 top-2 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-300 backdrop-blur-sm">
                    Algorithm off — raw video
                  </div>
                )}
                {scanning && (
                  <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-lime-300 backdrop-blur-sm">
                    <Loader2 className="size-3 animate-spin" /> Scanning {scanProgress.done}/{scanProgress.total}
                  </div>
                )}
              </div>
            </div>

            {/* ── Timeline — where the single-crop scan is confident vs. not,
                  across the WHOLE video. Click a point to seek there. ── */}
            {(samples.length > 0 || scanning) && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-[10.5px] text-zinc-500">
                  <span>Detection timeline</span>
                  <span>{confidentCount}/{samples.length || scanProgress.total} confident</span>
                </div>
                <div className="relative mt-1.5 h-8 rounded-lg border border-[#27272a] bg-black/30">
                  {samples.map((s) => (
                    <button
                      key={s.t}
                      type="button"
                      title={`${s.t.toFixed(1)}s — ${!s.found ? "no face/subject" : s.recommendFit ? "low confidence" : s.kind}`}
                      onClick={() => { if (videoRef.current) videoRef.current.currentTime = s.t; }}
                      className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-black transition-transform hover:scale-125 ${
                        !s.found ? "bg-zinc-600" : s.recommendFit ? "bg-amber-400" : "bg-emerald-400"
                      }`}
                      style={{ left: `${duration > 0 ? (s.t / duration) * 100 : 0}%` }}
                    />
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-zinc-600">
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-400" /> confident</span>
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-400" /> low-confidence</span>
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-zinc-600" /> nothing found</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Right: controls + raw result ── */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white">Face detection</span>
                <Switch size="sm" checked={algoOn} onCheckedChange={setAlgoOn} />
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-zinc-500">
                Off = the plain source video, no crop. On = the continuous tracked crop. Flip this to confirm the algorithm is actually changing anything.
              </p>

              <div className="mt-4 space-y-1.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-600">Camera mode</p>
                {CAMERA_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    disabled={!algoOn}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40 ${
                      mode === m.id ? "border-emerald-500/50 bg-emerald-500/[0.08]" : "border-[#27272a] bg-black/20 hover:bg-white/5"
                    }`}
                  >
                    <p className="text-[12.5px] font-semibold text-white">{m.name}</p>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-zinc-500">{m.blurb}</p>
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[#1e1e24] pt-3.5">
                <span className="flex items-center gap-1.5 text-[12px] text-zinc-400"><Crosshair className="size-3.5" /> Show tracked-point marker</span>
                <Switch size="sm" checked={showOverlay} onCheckedChange={setShowOverlay} />
              </div>
            </div>

            {/* Raw API responses — every scanned point, unmodified */}
            <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                <Code2 className="size-3.5" /> Raw scan points ({samples.length})
              </p>
              <pre className="mt-2.5 max-h-72 overflow-auto rounded-lg border border-[#27272a] bg-black/40 p-3 text-[11px] leading-relaxed text-zinc-300">
{samples.length ? JSON.stringify(samples, null, 2) : scanning ? "Scanning…" : "— load a video to scan —"}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
