// @vitest-environment node
// Real-ffmpeg regression for the UGC-sample story-burn hang: a stock clip with a
// broken container timescale probes as ~16 HOURS, the graph's fps filter then
// tries to synthesize hours of frames, and the encode dies on the 280s wall
// clock ("time=16:49:15 … frame=97"). Proves the permanent chain:
//   broken source → repairInsaneTimestamps → clean short clip →
//   story graph (long text overlay + music bed over an AUDIO-LESS source,
//   which forces the generated-silence amix base) → fast, bounded output.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { buildClipGraph } from "./clipFilterGraph";
import { repairInsaneTimestamps, INSANE_DURATION_SECONDS } from "./videoNormalize";
import type { EditOp } from "./clipEditOps";

const BIN = ffmpegPath as string;

function run(args: string[], cwd?: string, killMs?: number): Promise<{ code: number; err: string; killed: boolean }> {
  return new Promise((resolve) => {
    const p = spawn(BIN, args, { stdio: ["ignore", "ignore", "pipe"], cwd });
    let err = "", killed = false;
    const t = killMs ? setTimeout(() => { killed = true; try { p.kill("SIGKILL"); } catch { /* gone */ } }, killMs) : null;
    p.stderr.on("data", (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); });
    p.on("error", (e) => { if (t) clearTimeout(t); resolve({ code: -1, err: String(e), killed }); });
    p.on("close", (c) => { if (t) clearTimeout(t); resolve({ code: c ?? -1, err, killed }); });
  });
}

async function probeDuration(path: string): Promise<number> {
  const { err } = await run(["-hide_banner", "-i", path]);
  const m = err.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
  return m ? parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]) : 0;
}

let work: string;
let brokenPath: string;
let musicPath: string;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "vnorm-"));
  // A 12s AUDIO-LESS clip REMUXED with 3600×-inflated timestamps (-itsscale
  // -c copy): few REAL frames spread across a ~12-hour container timeline —
  // exactly the broken downloader-mp4 shape from production. (Re-ENCODING with
  // inflated PTS would physically write hours of duplicate frames — a different,
  // wrong fixture.)
  const cleanPath = join(work, "clean.mp4");
  const mkClean = await run(["-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=10:duration=12",
    "-an", "-c:v", "libx264", "-preset", "ultrafast", cleanPath]);
  expect(mkClean.code, mkClean.err.slice(-400)).toBe(0);
  brokenPath = join(work, "broken.mp4");
  const mk = await run(["-y", "-itsscale", "3600", "-i", cleanPath, "-c", "copy", brokenPath]);
  expect(mk.code, mk.err.slice(-400)).toBe(0);
  expect(await probeDuration(brokenPath)).toBeGreaterThan(INSANE_DURATION_SECONDS);
  // A 30s music bed (longer than the clip — the bed must get cut, never extend).
  musicPath = join(work, "music.m4a");
  const ms = await run(["-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=30", "-c:a", "aac", musicPath]);
  expect(ms.code, ms.err.slice(-400)).toBe(0);
}, 60_000);

afterAll(async () => { await rm(work, { recursive: true, force: true }).catch(() => {}); });

describe("story-burn on a broken-timescale source", () => {
  it("repairInsaneTimestamps re-times it to a sane short clip; a healthy source passes through untouched", async () => {
    const untouched = await repairInsaneTimestamps(BIN, brokenPath, work, 20, false);
    expect(untouched).toEqual({ path: brokenPath, repaired: false });

    const repaired = await repairInsaneTimestamps(BIN, brokenPath, work, await probeDuration(brokenPath), false);
    expect(repaired.repaired).toBe(true);
    const dur = await probeDuration(repaired.path);
    expect(dur).toBeGreaterThan(1);
    expect(dur).toBeLessThan(60);
  }, 120_000);

  it("the full story burn (long text + music over silence base) then encodes fast and bounded", async () => {
    const repaired = await repairInsaneTimestamps(BIN, brokenPath, work, await probeDuration(brokenPath), false);
    const clipDur = Math.ceil(await probeDuration(repaired.path));

    const story = "pov you just saw a creator in the cafe open vello and start a whole campaign from scratch. no lighting rigs. no camera crew. no script drafts. literally just them clicking buttons like a maniac. not sure how they actually pull that off";
    const ops: EditOp[] = [
      { op: "reframe", mode: "crop" },
      { op: "text_overlay", text: story, position: "center", startSec: 0, endSec: 15,
        style: { fontColor: "#ffffff", fontSize: 46, bold: true, outlineColor: "#000000", outlineWidth: 2, maxLines: 10 } },
      { op: "audio_overlay", audioUrl: "music://test", atSec: 0, gainDb: -6 },
    ];
    // Mirrors the fixed route: endSeconds = the REAL probed duration (sizes the
    // generated-silence amix base), audio-less source, -shortest on the mux.
    const graph = buildClipGraph({
      ops, startSeconds: 0, endSeconds: clipDur, assPath: undefined, logoPaths: [],
      audioPaths: [musicPath], width: 360, height: 640, hasAudio: false, fps: 30,
    });
    for (const tf of graph.textFiles) await writeFile(join(work, tf.name), tf.content);

    const outPath = join(work, "out.mp4");
    const res = await run([
      "-y", "-i", repaired.path, ...graph.inputArgs, ...graph.filterArgs,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest", "-movflags", "+faststart", outPath,
      // The production hang burned 280s before the kill; a healthy run of this
      // tiny clip takes a few seconds. 90s is the "never hangs again" assertion.
    ], work, 90_000);
    expect(res.killed, `encode hit the kill timer — unbounded again: ${res.err.slice(-400)}`).toBe(false);
    expect(res.code, res.err.slice(-400)).toBe(0);

    // Output length ≈ the clip (music bed CUT to it, never extending it).
    const outDur = await probeDuration(outPath);
    expect(outDur).toBeGreaterThan(1);
    expect(outDur).toBeLessThanOrEqual(clipDur + 2);
  }, 180_000);
});
