import { spawn } from "node:child_process";
import { join } from "node:path";

// Repair for sources with BROKEN container timestamps — mp4s written with a
// wrong timescale (common in downloader-ripped clips) report durations inflated
// ~1000-3600× (a 16.8s clip probing as 16h49m). Downstream that poisons every
// duration-derived decision: the fps filter tries to synthesize HOURS of frames
// (the "ffmpeg killed: exceeded wall clock … time=16:49:15, frame=97" hang),
// silence/music beds get sized to the bogus length, players show a 16h video.
//
// The repair re-times the stream by FRAME INDEX (setpts=N/FR/TB at a fixed CFR)
// — the only ground truth a broken container leaves us is the frame sequence
// itself. The result is a clean, short, correctly-flowing clip. Frame-accurate
// speed can't be recovered from a lying container; a deterministic 30fps clip
// beats an un-encodable 16-hour one every time.

/** A probed duration above this is treated as broken metadata, not a real
 *  length — nothing this pipeline burns overlays onto is legitimately >30min. */
export const INSANE_DURATION_SECONDS = 1800;

const NORM_FPS_DEFAULT = 30;

function runBin(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    let settled = false;
    const settle = (r: { code: number; err: string }) => { if (!settled) { settled = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } settle({ code: -9, err: `${err.slice(-400)} [killed: repair exceeded ${timeoutMs}ms]` }); }, timeoutMs);
    p.stderr.on("data", (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
    p.on("error", (e) => settle({ code: -1, err: String(e) }));
    p.on("close", (c) => settle({ code: c ?? -1, err }));
  });
}

/**
 * When `probedDurationSeconds` is insane, re-encode `srcPath` with regenerated
 * frame-index timestamps into `workDir` and return the repaired path; otherwise
 * return `srcPath` untouched. Throws only if the source is broken AND the
 * repair itself fails — a broken source must never proceed un-repaired (that's
 * the 280s wall-clock hang).
 */
export async function repairInsaneTimestamps(
  bin: string,
  srcPath: string,
  workDir: string,
  probedDurationSeconds: number,
  hasAudio: boolean,
  /** The stream's DECLARED nominal fps (ffmpeg's "NN fps" stream line) — the
   *  container's PTS lie but the fps hint usually survives, so re-timing at it
   *  restores the clip's true real-time length. Unparseable → 30. */
  declaredFps?: number,
): Promise<{ path: string; repaired: boolean }> {
  if (!(probedDurationSeconds > INSANE_DURATION_SECONDS)) return { path: srcPath, repaired: false };
  const fps = Math.round(Math.min(60, Math.max(5, declaredFps && declaredFps > 0 ? declaredFps : NORM_FPS_DEFAULT)));
  const outPath = join(workDir, "norm-src.mp4");
  console.warn(`[videoNormalize] source reports ${Math.round(probedDurationSeconds)}s — broken container timestamps; re-timing by frame index at ${fps}fps`);
  // setpts=N/fps/TB replaces the lying PTS with frame-index times; the fps
  // filter right after re-emits uniform CFR frame durations (without it the mp4
  // muxer inherits the LAST sample's inflated duration and the file still
  // probes minutes long). Verified live: an ~12h-probing 120-frame fixture
  // repairs to its true length in ~0.1s.
  const res = await runBin(bin, [
    "-y", "-i", srcPath,
    "-vf", `setpts=N/${fps}/TB,fps=${fps}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    // Broken video PTS usually means broken audio PTS too — resync from zero.
    ...(hasAudio ? ["-af", "aresample=async=1:first_pts=0", "-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    "-shortest", "-movflags", "+faststart", outPath,
    // A genuinely short clip repairs in seconds; anything past this is not a
    // short-clip repair and must fail fast instead of eating the route budget.
  ], 90_000);
  if (res.code !== 0) throw new Error(`timestamp repair failed (ffmpeg ${res.code}): ${res.err.slice(-300)}`);
  return { path: outPath, repaired: true };
}
