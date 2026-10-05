import { spawn } from "node:child_process";

/**
 * Detect camera-change / shot-boundary timestamps inside a clip window via ffmpeg's
 * scene-score. Runs a DECODE-ONLY pre-pass (`-an -f null`) over [startSec, startSec+durSec]
 * and parses the `pts_time` of every frame whose scene score exceeds `threshold`
 * (0.4 = balanced: clear cuts, not in-shot motion). The returned times are RELATIVE to
 * the clip start (input `-ss` makes pts 0-based), so the caller can drop a transition at
 * each one. Cuts within `edgeGuardSec` of either end are dropped (the clip's own start/end
 * isn't a "camera change"). Best-effort: any failure resolves to `[]` (no transitions),
 * never throws, so a detection hiccup can't fail the clip.
 */
export function detectSceneCuts(
  bin: string,
  srcPath: string,
  startSec: number,
  durSec: number,
  opts?: { threshold?: number; timeoutMs?: number; edgeGuardSec?: number; maxCuts?: number },
): Promise<number[]> {
  const threshold = opts?.threshold ?? 0.4;
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const edgeGuard = opts?.edgeGuardSec ?? 0.35;
  const maxCuts = opts?.maxCuts ?? 60;

  return new Promise((resolve) => {
    const args = [
      "-hide_banner", "-nostats",
      "-ss", String(startSec), "-t", String(durSec), "-i", srcPath,
      "-vf", `select='gt(scene,${threshold})',showinfo`,
      "-an", "-f", "null", "-",
    ];
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); if (err.length > 400_000) err = err.slice(-400_000); });

    let settled = false;
    const finish = (cuts: number[]) => { if (settled) return; settled = true; clearTimeout(timer); resolve(cuts); };
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* gone */ } finish(parse()); }, timeoutMs);

    const parse = (): number[] => {
      const out: number[] = [];
      // showinfo logs `... pts_time:12.3400 ...` for each selected (scene-change) frame.
      const re = /pts_time:([0-9]+\.?[0-9]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(err)) !== null) {
        const t = parseFloat(m[1]);
        if (Number.isFinite(t) && t >= edgeGuard && t <= durSec - edgeGuard) out.push(Math.round(t * 1000) / 1000);
      }
      // De-dupe near-identical detections (<250ms apart → same cut) and cap the count.
      out.sort((a, b) => a - b);
      const merged: number[] = [];
      for (const t of out) if (merged.length === 0 || t - merged[merged.length - 1] > 0.25) merged.push(t);
      return merged.slice(0, maxCuts);
    };

    proc.on("error", () => finish([]));
    proc.on("close", () => finish(parse()));
  });
}
