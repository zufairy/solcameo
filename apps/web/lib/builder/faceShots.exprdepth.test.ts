import { describe, it, expect } from "vitest";
import { buildCameraPlan, cropAt, shotCropExpr, sanitizeShots, type FaceShot, type SamplePoint } from "@/lib/builder/faceShots";

const pt = (t: number, cx: number, found = true): SamplePoint => ({ t, found, cx, cy: 0.4, w: 0.2 } as SamplePoint);

/** Minimal evaluator for the subset of ffmpeg's expression language the crop
 *  expression uses (if/lt/min/max, + - * /, parentheses) — tracks nesting
 *  depth the way libavutil/eval.c's parse_expr does. */
function evalExpr(src: string, t: number): { value: number; depth: number } {
  let i = 0, depth = 0, maxDepth = 0;
  const peek = () => src[i];
  const expr = (): number => {
    depth++; maxDepth = Math.max(maxDepth, depth);
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = src[i++]; const r = term(); v = op === "+" ? v + r : v - r; }
    depth--;
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = src[i++]; const r = factor(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  const factor = (): number => {
    if (peek() === "-") { i++; return -factor(); }
    if (peek() === "(") { i++; const v = expr(); i++; return v; }
    const fn = /^[a-z]+/.exec(src.slice(i));
    if (fn) {
      const name = fn[0]; i += name.length;
      if (name === "t") return t;
      i++; // (
      const args: number[] = [expr()];
      while (peek() === ",") { i++; args.push(expr()); }
      i++; // )
      if (name === "if") return args[0] ? args[1] : args[2];
      if (name === "lt") return args[0] < args[1] ? 1 : 0;
      if (name === "min") return Math.min(args[0], args[1]);
      if (name === "max") return Math.max(args[0], args[1]);
      throw new Error(`fn ${name}`);
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i))!;
    i += num[0].length;
    return Number(num[0]);
  };
  const value = expr();
  return { value, depth: maxDepth };
}

describe("shotCropExpr stays inside ffmpeg's parser depth limit", () => {
  const long = Array.from({ length: 1200 }, (_, i) => pt(i / 10, 0.5 + 0.3 * Math.sin(i / 7), true));

  it("a 240-keyframe camera plan nests only a few levels deep", () => {
    const shots = sanitizeShots(buildCameraPlan(long, "zoom").shots);
    const expr = shotCropExpr(shots, "cx");
    expect(evalExpr(expr, 10).depth).toBeLessThan(40); // ffmpeg rejects ~100
  });

  it("evaluates to exactly what the Editor preview (cropAt) shows", () => {
    for (const mode of ["zoom", "auto", "pan"] as const) {
      const shots = sanitizeShots(buildCameraPlan(long, mode).shots);
      for (const axis of ["cx", "cy"] as const) {
        const expr = shotCropExpr(shots, axis);
        for (let t = 0; t < 125; t += 0.37) {
          expect(evalExpr(expr, t).value).toBeCloseTo(Math.min(1, Math.max(0, cropAt(shots, t)[axis])), 3);
        }
      }
    }
  });

  it("handles pans, unconfident gaps and single shots", () => {
    const shots: FaceShot[] = [
      { startT: 0, endT: 2, cx: 0.3, cy: 0.4, confident: true },
      { startT: 2, endT: 5, cx: 0.7, cy: 0.4, confident: true, transition: { kind: "pan", durS: 1 },
        path: [{ t: 2, cx: 0.7, cy: 0.4 }, { t: 2.5, cx: 0.6, cy: 0.4 }, { t: 4, cx: 0.8, cy: 0.5 }] },
      { startT: 5, endT: 6, cx: 0.5, cy: 0.5, confident: false },
      { startT: 6, endT: 9, cx: 0.2, cy: 0.3, confident: true },
    ];
    for (const axis of ["cx", "cy"] as const) {
      const expr = shotCropExpr(shots, axis);
      for (let t = 0; t < 11; t += 0.05) expect(evalExpr(expr, t).value).toBeCloseTo(cropAt(shots, t)[axis], 3);
    }
    expect(shotCropExpr([shots[0]], "cx")).toBe("0.3000");
    expect(shotCropExpr([], "cx")).toBe("0.5000");
  });
});
