import { detectFaces, fingerprintOf, fingerprintDistance, type FaceBox } from "./centerface";

/**
 * Whole-video face IDENTITY tracking — the Face Detect Playground's Dual
 * mode. LOCAL and free (lib/server/centerface.ts — no external API, no
 * cost, no rate limit): runs CenterFace on every requested frame, then
 * re-identifies which detected face is WHICH of at most 2 recurring guests
 * using a cheap local appearance fingerprint (a 4x4-grid color average of
 * the face crop — see centerface.ts's fingerprintOf).
 *
 * This matters because most real 2-person interviews are shot as a mix of a
 * wide 2-shot (both guests visible, clearly separated left/right) AND
 * single-camera close-up cuts where each solo speaker is framed centered in
 * roughly the SAME position regardless of who they are. Position alone
 * (cx/cy) cannot tell two centered close-ups apart — only appearance can.
 *
 * ANCHORING: the first frame with 2 separated faces gives ground-truth
 * fingerprints for person 0 (left) / person 1 (right). Every other detected
 * face (in a solo shot) is assigned to whichever anchor's fingerprint is
 * closer. If no simultaneous 2-face frame occurs anywhere in the scan, falls
 * back to bootstrapping anchors from the two most visually DIFFERENT single
 * faces found across the whole scan (best-effort — without a true
 * co-presence frame there's no ground truth, just "these two probably
 * aren't the same person").
 *
 * DELIBERATELY separate from lib/server/faceTrack.ts (the real per-clip
 * render algorithm) — a rendered clip is one short segment with no "who is
 * this across the whole video" question to answer, so this has no reason to
 * run in that path. This is exploratory tooling for the playground only.
 */

export interface IdentifiedFace { person: number; cx: number; cy: number; w: number }
export interface IdentifiedFrame { i: number; faces: IdentifiedFace[] }

type Detected = { box: FaceBox; fp: number[] };

export async function identifyFacesAcrossFrames(framePaths: string[]): Promise<IdentifiedFrame[]> {
  if (framePaths.length === 0) return [];

  let failures = 0;
  const perFrame: Detected[][] = await Promise.all(
    framePaths.map(async (p) => {
      try {
        const boxes = (await detectFaces(p)).sort((a, b) => a.cx - b.cx); // stable left-to-right
        return await Promise.all(boxes.map(async (box) => ({ box, fp: await fingerprintOf(p, box.px) })));
      } catch (e) {
        failures++;
        console.warn(`[faceIdentity] frame detect failed for ${p}: ${e instanceof Error ? e.message : e}`);
        return [];
      }
    }),
  );
  // A handful of unreadable frames is normal (past clip end, corrupt extract).
  // EVERY frame failing means something systemic (model missing, etc.) — that
  // must surface as a real error, not silently read as "no faces anywhere".
  if (failures > 0 && failures === framePaths.length) {
    throw new Error("face detection failed for every sampled frame");
  }

  // Anchors: the first frame with 2+ faces gives real ground truth (leftmost
  // + rightmost of that frame, in case 3+ were detected).
  let anchor0: number[] | null = null;
  let anchor1: number[] | null = null;
  for (const faces of perFrame) {
    if (faces.length >= 2 && faces[0].fp.length > 0 && faces[faces.length - 1].fp.length > 0) {
      anchor0 = faces[0].fp;
      anchor1 = faces[faces.length - 1].fp;
      break;
    }
  }
  if (!anchor0 || !anchor1) {
    // Bootstrap from the two most visually different single-face detections.
    const singles = perFrame.flat().map((f) => f.fp).filter((fp) => fp.length > 0);
    let bestDist = -1;
    for (let i = 0; i < singles.length; i++) {
      for (let j = i + 1; j < singles.length; j++) {
        const d = fingerprintDistance(singles[i], singles[j]);
        if (d > bestDist) { bestDist = d; anchor0 = singles[i]; anchor1 = singles[j]; }
      }
    }
  }

  return perFrame.map((faces, i) => ({
    i,
    faces: faces.map((f): IdentifiedFace => {
      let person = 0;
      if (anchor0 && anchor1 && f.fp.length > 0) {
        person = fingerprintDistance(f.fp, anchor1) < fingerprintDistance(f.fp, anchor0) ? 1 : 0;
      }
      return { person, cx: f.box.cx, cy: f.box.cy, w: f.box.w };
    }),
  }));
}
