import * as ort from "onnxruntime-node";
import sharp from "sharp";
import path from "node:path";

/**
 * Local, free, offline face detection — CenterFace (the same detector
 * ORB-HD/deface uses for anonymization), run via onnxruntime-node. No
 * external API, no per-call cost, no rate limits, no credits to run out of.
 * ~3-4ms per frame on CPU at typical clip-preview resolutions.
 *
 * The .onnx file (models/centerface.onnx) is deface's published weights,
 * pre-converted to dynamic input/output shapes via onnx's
 * update_inputs_outputs_dims (the raw upstream export bakes in fixed dims
 * like [10,3,32,32], which onnxruntime rejects for any other image size —
 * see deface's CenterFace.dynamicize_shapes, replicated once at conversion
 * time instead of on every load since Node has no `onnx` package).
 *
 * Preprocessing/decode ported line-for-line from deface/centerface.py
 * (input 'input.1' NCHW/RGB/0-255 float32, resized to the nearest multiple
 * of 32; outputs '537' heatmap, '538' scale, '539' offset, '540' landmarks,
 * all at stride 4) — verified against deface's real reference weights on
 * real video frames before wiring this in.
 */

const MODEL_PATH = path.join(process.cwd(), "models", "centerface.onnx");
const SCORE_THRESHOLD = 0.5;
const NMS_IOU_THRESHOLD = 0.3;

export interface FaceBox {
  cx: number; cy: number; w: number; h: number;
  score: number;
  /** Pixel box in the ORIGINAL image's coordinate space — used to crop a
   *  fingerprint thumbnail for cross-cut re-identification (faceIdentity.ts). */
  px: { x1: number; y1: number; x2: number; y2: number };
}

// ── Resource limits ──────────────────────────────────────────────────────────
// This runs INSIDE the web server. A clip render samples up to 600 frames
// (60s × 10fps) and callers fan them out with Promise.all; unthrottled, every
// frame's decode + float tensor + ORT activations were in flight at once, and
// ORT's default thread pool is one thread per HOST core. With a few clips
// rendering together that exhausted the container's memory/CPU — Railway killed
// it and every page hung until the restart. Now: one process-wide queue with a
// small number of concurrent detections, and a fixed, small ORT thread pool.
const MAX_CONCURRENT = Math.max(1, Number(process.env.FACE_DETECT_CONCURRENCY) || 2);
const ORT_THREADS = Math.max(1, Number(process.env.FACE_DETECT_THREADS) || 2);
let active = 0;
const waiters: Array<() => void> = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((res) => waiters.push(res));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_PATH, {
      // "all" lets ORT const-fold the initializers that happen to appear in
      // graph inputs (a common artifact of older exporters). Without this the
      // runtime emits a [W:graph.cc] warning for every such initializer and
      // skips the optimisation pass, which can noticeably slow inference.
      graphOptimizationLevel: "all",
      intraOpNumThreads: ORT_THREADS,
      interOpNumThreads: 1,
      executionMode: "sequential",
      // Silence the per-initializer [W:graph.cc] warnings that flood the logs.
      logSeverityLevel: 3,
    });
    // A failed load must not be cached forever.
    sessionPromise.catch(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

function iou(a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a): number {
  const xx1 = Math.max(a.x1, b.x1), yy1 = Math.max(a.y1, b.y1);
  const xx2 = Math.min(a.x2, b.x2), yy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, xx2 - xx1), ih = Math.max(0, yy2 - yy1);
  const inter = iw * ih;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter <= 0 ? 0 : inter / (areaA + areaB - inter);
}

/** Detect every face in a local image file. Returns cx/cy/w/h as fractions
 *  of the image's own width/height (0-1), matching the shape the rest of the
 *  reframe pipeline (faceTrack.ts) already expects. */
export function detectFaces(imagePath: string): Promise<FaceBox[]> {
  return withSlot(() => detectFacesNow(imagePath));
}

async function detectFacesNow(imagePath: string): Promise<FaceBox[]> {
  const session = await getSession();
  const img = sharp(imagePath);
  const meta = await img.metadata();
  const wOrig = meta.width, hOrig = meta.height;
  if (!wOrig || !hOrig) return [];
  const wNew = Math.ceil(wOrig / 32) * 32;
  const hNew = Math.ceil(hOrig / 32) * 32;
  const { data } = await img.resize(wNew, hNew, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const plane = wNew * hNew;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    chw[i] = data[i * 3];
    chw[plane + i] = data[i * 3 + 1];
    chw[2 * plane + i] = data[i * 3 + 2];
  }

  const inputTensor = new ort.Tensor("float32", chw, [1, 3, hNew, wNew]);
  const results = await session.run({ "input.1": inputTensor });
  const heatmap = results["537"].data as Float32Array;
  const scale = results["538"].data as Float32Array;
  const offset = results["539"].data as Float32Array;
  const h = results["537"].dims[2] as number;
  const w = results["537"].dims[3] as number;
  const scaleW = wNew / wOrig, scaleH = hNew / hOrig;

  type RawBox = { x1: number; y1: number; x2: number; y2: number; score: number };
  const raw: RawBox[] = [];
  for (let c0 = 0; c0 < h; c0++) {
    for (let c1 = 0; c1 < w; c1++) {
      const score = heatmap[c0 * w + c1];
      if (score <= SCORE_THRESHOLD) continue;
      const s0 = Math.exp(scale[0 * h * w + c0 * w + c1]) * 4; // box height, model-input px
      const s1 = Math.exp(scale[1 * h * w + c0 * w + c1]) * 4; // box width, model-input px
      const o0 = offset[0 * h * w + c0 * w + c1];
      const o1 = offset[1 * h * w + c0 * w + c1];
      let x1 = Math.max(0, (c1 + o1 + 0.5) * 4 - s1 / 2);
      let y1 = Math.max(0, (c0 + o0 + 0.5) * 4 - s0 / 2);
      x1 = Math.min(x1, wNew);
      y1 = Math.min(y1, hNew);
      const x2 = Math.min(x1 + s1, wNew);
      const y2 = Math.min(y1 + s0, hNew);
      raw.push({ x1, y1, x2, y2, score });
    }
  }
  raw.sort((a, b) => b.score - a.score);
  const kept: RawBox[] = [];
  for (const b of raw) if (kept.every((k) => iou(k, b) < NMS_IOU_THRESHOLD)) kept.push(b);

  return kept.map((b): FaceBox => {
    const x1 = b.x1 / scaleW, y1 = b.y1 / scaleH, x2 = b.x2 / scaleW, y2 = b.y2 / scaleH;
    return {
      cx: (x1 + x2) / 2 / wOrig, cy: (y1 + y2) / 2 / hOrig,
      w: (x2 - x1) / wOrig, h: (y2 - y1) / hOrig,
      score: b.score,
      px: { x1, y1, x2, y2 },
    };
  });
}

/** Crude, cheap, LOCAL appearance fingerprint for one detected face — a
 *  4x4-grid average-RGB vector (48 numbers, 0-1) of the face crop. Not a
 *  real face-recognition embedding; just enough signal (hair/skin-tone/
 *  clothing color bleeding into the crop) to tell two visually different
 *  people apart across a hard cut, which position alone cannot do when both
 *  are framed centered in solo close-ups (faceIdentity.ts's whole reason for
 *  existing). Best-effort — returns [] on any crop failure. */
export async function fingerprintOf(imagePath: string, box: FaceBox["px"]): Promise<number[]> {
  try {
    const left = Math.max(0, Math.round(box.x1));
    const top = Math.max(0, Math.round(box.y1));
    const width = Math.max(1, Math.round(box.x2 - box.x1));
    const height = Math.max(1, Math.round(box.y2 - box.y1));
    const { data } = await sharp(imagePath)
      .extract({ left, top, width, height })
      .resize(16, 16, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const grid = 4, cell = 16 / grid;
    const vec: number[] = [];
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = gy * cell; y < (gy + 1) * cell; y++) {
          for (let x = gx * cell; x < (gx + 1) * cell; x++) {
            const idx = (y * 16 + x) * 3;
            r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; n++;
          }
        }
        vec.push(r / n / 255, g / n / 255, b / n / 255);
      }
    }
    return vec;
  } catch {
    return [];
  }
}

/** Euclidean distance between two fingerprints — smaller = more visually
 *  similar. Returns +Infinity if either vector is empty/mismatched. */
export function fingerprintDistance(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}
