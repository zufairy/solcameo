import { detectFaces, type FaceBox } from "./centerface";
import { loadGray, mouthMotion } from "./speakerTrack";

/**
 * Face-aware reframe ("Face Track" skill). Samples a few frames from the clip
 * and runs LOCAL CenterFace detection (lib/server/centerface.ts — the same
 * detector ORB-HD/deface uses, via onnxruntime-node; no external API, no
 * per-call cost, no rate limits) for the main speaker's face position. The
 * crop window then centers on the median face instead of the frame center.
 * Detection failure degrades to the normal centered crop — never blocks a
 * render.
 *
 * Previously this called out to KIE's hosted Gemini vision — replaced
 * because (a) it cost money and had a rate/credit ceiling that silently
 * degraded every render to a centered crop once exhausted, indistinguishable
 * from "no face found", and (b) CenterFace is dramatically faster (~3-4ms/
 * frame vs. 45-75s per vision call) and fully deterministic.
 */

/** Where to center the vertical crop. kind="face" → bias the face into the upper
 *  third; kind="subject" → center the main object (b-roll: food/hands/product —
 *  CenterFace is face-only, so "subject" now just means "no face was found,
 *  center the frame" rather than a real object-detection guess).
 *  cx is the PRIMARY (most prominent) face; xMin/xMax are the horizontal bounds of
 *  ALL detected faces (set only when 2+ separated faces exist — e.g. a podcast),
 *  so the reframe can fit/pan between guests instead of centering on the gap.
 *  w = the PRIMARY face WIDTH (0..1 of frame width) — small = a far/wide shot.
 *  recommendFit = a PERSON is present but could NOT be reliably localized (jittery,
 *  too small, or only low-confidence detections). The caller should LETTERBOX the
 *  whole scene into 9:16 rather than guess-crop the dead-center (which frames the
 *  podcast table, not the speaker). cx is still carried as a best-effort bias. */
export interface SubjectCenter {
  cx: number; cy: number; kind: "face" | "subject"; xMin?: number; xMax?: number; w?: number; recommendFit?: boolean;
  /** How many faces CenterFace actually saw (max across sampled frames) — the
   *  real headcount, independent of the crop-decision logic above (which can
   *  collapse 2 close/overlapping faces to a single-point crop via the
   *  `xMax - xMin > 0.08` separation gate). Callers that just want "how many
   *  people are on screen" should read this, not infer it from xMin/xMax. */
  faceCount: number;
}

/** Per-process cache so face detection is DETERMINISTIC within a run and across
 *  retries of the same clip (the route can re-enter). Keyed by the frame set's
 *  identity; bounded so it can't grow unbounded. CenterFace is fast enough that
 *  this is now mostly a determinism guarantee rather than a real cost saver. */
const detectCache = new Map<string, SubjectCenter | null>();
const cacheKey = (paths: string[]) => paths.join("|");
function rememberDetect(key: string, val: SubjectCenter | null): SubjectCenter | null {
  if (detectCache.size > 256) detectCache.clear();
  detectCache.set(key, val);
  return val;
}

/** Pick which of a frame's detected faces is the one to treat as "primary".
 *  With no burst frames (or only one face), this is the plain largest-face
 *  pick, byte-identical to the original behavior. With burst frames — a
 *  couple more stills taken ~100ms after the anchor, at the SAME spot in the
 *  clip a transcript word already told the caller someone is speaking — the
 *  face whose mouth region moved between the anchor and the burst wins
 *  instead, so a 2+ guest anchor doesn't default to whoever is nearer/bigger
 *  on camera while the OTHER guest is the one actually talking. Falls back to
 *  largest-face when nothing moves clearly (a still photo, motion too small
 *  to trust, or the burst frames failed to extract) — never worse than before. */
async function pickPrimaryFace(stillPath: string, faces: FaceBox[], burstPaths: string[] | undefined): Promise<FaceBox> {
  const byWidth = faces.slice().sort((a, b) => b.w - a.w);
  if (faces.length <= 1 || !burstPaths || burstPaths.length === 0) return byWidth[0];
  try {
    const anchor = await loadGray(stillPath);
    const motion = new Array(faces.length).fill(0);
    let used = 0;
    for (const bp of burstPaths) {
      let burst;
      try { burst = await loadGray(bp); } catch { continue; }
      if (burst.width !== anchor.width || burst.height !== anchor.height) continue;
      used++;
      faces.forEach((f, i) => { motion[i] += mouthMotion(anchor, burst, f.px); });
    }
    if (used === 0) return byWidth[0];
    const ranked = faces.map((f, i) => ({ f, m: motion[i] })).sort((a, b) => b.m - a.m);
    const [top, second] = ranked;
    // A clear, non-noise lead is required — the smallest observed real signal
    // (see speakerTrack.ts's mouthAUC eval) is well above this floor.
    const clear = top.m > 0.003 && (!second || top.m > second.m * 1.15);
    return clear ? top.f : byWidth[0];
  } catch {
    return byWidth[0];
  }
}

export async function detectFaceCenter(
  framePaths: string[],
  /** Per-anchor extra frames (~100ms after the anchor) enabling speaker-aware
   *  primary selection — see pickPrimaryFace. Absent/empty index = old
   *  largest-face behavior for that anchor. */
  burstPaths?: (string[] | undefined)[],
): Promise<SubjectCenter | null> {
  if (framePaths.length === 0) return null;
  const ck = cacheKey(framePaths);
  if (detectCache.has(ck)) return detectCache.get(ck)!;

  try {
    // Per-frame face list, in the SAME shape the downstream decision logic
    // (unchanged from the Gemini-vision version) already expects, but with
    // the PRIMARY (first entry) chosen by who's actually talking when burst
    // frames are available, not just who's biggest. A frame that fails to
    // decode (corrupt/unreadable) contributes an empty list rather than
    // failing the whole detection.
    const perFrame: { cx: number; cy: number; w: number }[][] = await Promise.all(
      framePaths.map(async (p, i) => {
        try {
          const faces = await detectFaces(p);
          if (faces.length === 0) return [];
          const primary = await pickPrimaryFace(p, faces, burstPaths?.[i]);
          const rest = faces.filter((f) => f !== primary);
          return [primary, ...rest].map((f) => ({ cx: f.cx, cy: f.cy, w: f.w }));
        } catch (e) {
          console.warn(`[faceTrack] frame detect failed for ${p}: ${e instanceof Error ? e.message : e}`);
          return [];
        }
      }),
    );

    const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const anyFaceFrames = perFrame.filter((fs) => fs.length > 0).length;
    const withFace = perFrame.filter((fs) => fs.length > 0);
    // Max simultaneous faces across the sampled frames — the true headcount
    // signal, kept separate from the crop-decision gates below.
    const faceCount = perFrame.reduce((m, fs) => Math.max(m, fs.length), 0);

    // Faces in at least half the frames → candidate for speaker tracking.
    if (withFace.length > 0 && withFace.length >= Math.ceil(perFrame.length / 2)) {
      // PRIMARY = index 0 of each frame's face list — pickPrimaryFace already
      // put the talking face there (or the largest, with no burst evidence).
      const primary = withFace.map((fs) => fs[0]);
      const pxs = primary.map((p) => p.cx);
      const cy = median(primary.map((p) => p.cy));
      const primaryW = median(primary.map((p) => p.w));
      const xMin = median(withFace.map((fs) => Math.min(...fs.map((p) => p.cx))));
      const xMax = median(withFace.map((fs) => Math.max(...fs.map((p) => p.cx))));
      // MULTI-FACE (podcast/interview): most frames carry 2+ separated faces. The
      // "primary" (largest) legitimately FLIPS between guests frame-to-frame, so the
      // single-face agreement gate below would wrongly reject it — but the xMin/xMax
      // BOUNDS are valid, so trust them and frame BETWEEN the guests (reframe pans/fits).
      // This MUST come before the gate, or 2-person clips lose their pan to a center crop.
      const multiFace = withFace.filter((fs) => fs.length >= 2).length >= Math.ceil(withFace.length / 2);
      if (multiFace && xMax - xMin > 0.08) {
        // cx MUST be the PRIMARY (largest) face per the SubjectCenter contract — NOT
        // the bbox midpoint (xMin+xMax)/2, which is the empty GAP between two guests.
        // reframeFilter's AUTO "doesn't fit" fallback centers on cx; with the midpoint
        // it collapses both if(lte(...)) branches to the gap and crops BOTH guests out
        // of a wide 2-shot. median(pxs) lands on a real speaker; the xMin/xMax bounds
        // (still returned) drive the fit/pan.
        return rememberDetect(ck, { cx: median(pxs), cy, kind: "face", xMin, xMax, w: primaryW, faceCount });
      }
      // AGREEMENT GATE (single face): the per-frame primary faces must cluster. If
      // they're scattered (spread > 0.25 of frame width) the "primary" is a phantom /
      // flipping detection on a lone subject — don't trust a median that lands on the gap.
      const spread = Math.max(...pxs) - Math.min(...pxs);
      if (spread <= 0.25) {
        // SMALL/FAR speaker: the head agrees frame-to-frame but is small. Since we
        // KNOW where the speaker is (stable cx), a vertical-slice crop CENTERED on the
        // face keeps them in frame far better than letterboxing the whole wide shot
        // (which shrinks the person to a tiny figure — the "I can't see the person
        // talking" complaint). Only genuinely TINY heads (< 5% wide — a distant figure
        // on a stage/wide table) still letterbox, where a crop really would frame the
        // background. So: crop-follow a small-but-present face; letterbox only the tiny.
        const TINY_W = 0.02; // same floor as speakerTrack.ts TINY_FACE_W — see its note
        if (primaryW > 0 && primaryW < TINY_W) {
          return rememberDetect(ck, { cx: median(pxs), cy, kind: "face", w: primaryW, recommendFit: true, faceCount });
        }
        return rememberDetect(ck, {
          cx: median(pxs),
          cy,
          kind: "face",
          w: primaryW,
          faceCount,
          // Only surface bounds for 2+ SEPARATED faces (multi-guest); a lone face
          // collapses to xMin≈xMax, leaving the single-point crop path.
          ...(xMax - xMin > 0.08 ? { xMin, xMax } : {}),
        });
      }
      // JITTER (spread > 0.25): a person IS present but the primary flips around the
      // frame — can't be reliably localized. Do NOT drop to a dead-center subject crop
      // (that frames the table on a wide shot); letterbox the whole scene instead,
      // carrying the median cx as a best-effort bias.
      return rememberDetect(ck, { cx: median(pxs), cy, kind: "face", w: primaryW, recommendFit: true, faceCount });
    }
    // Faces detected in FEWER than half the frames but at least one — a
    // borderline/occasional detection (motion blur, brief occlusion). Trust
    // it as a best-effort bias rather than discarding it outright.
    if (anyFaceFrames > 0) {
      return rememberDetect(ck, { cx: 0.5, cy: 0.5, kind: "face", recommendFit: true, faceCount });
    }
    // No face in ANY frame — CenterFace is face-only (unlike the old Gemini
    // prompt, which could also guess a generic "main object" for b-roll), so
    // there's no subject-detection fallback to fall back to; center the frame.
    return rememberDetect(ck, { cx: 0.5, cy: 0.5, kind: "subject", faceCount });
  } catch (e) {
    // Any unexpected failure degrades to a centered crop — detection is
    // best-effort and must NEVER fail the clip.
    console.warn(`[faceTrack] detection failed: ${e instanceof Error ? e.message : e} — degrading to centered crop`);
    return rememberDetect(ck, null);
  }
}
